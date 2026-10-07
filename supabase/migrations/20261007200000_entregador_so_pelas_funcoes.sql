-- Entregador: só conclui entregas pelas funções do aplicativo, com datas recentes.
--
-- Até aqui o gatilho impedia o entregador de mudar valor, cliente, datas previstas
-- etc., mas ele ainda podia mandar um PATCH direto na tabela (fora do aplicativo)
-- e marcar o pedido como entregue sem informar se o cliente pagou, ou com uma
-- data de entrega/pagamento antiga. Agora:
--   * a alteração precisa vir de concluir_entrega / concluir_entrega_parcial,
--     que conferem a forma e a data do recebimento;
--   * a data da entrega pode ter no máximo 7 dias (fila sem internet) e não pode
--     estar no futuro (regra que já existia);
--   * a data do pagamento registrada pelo entregador também: de hoje ou até 7 dias.
-- Administrador e vendedor não mudam. Nenhum pedido existente é alterado.
--
-- Compatível com o aplicativo no ar (kg-v61): o entregador já usa só as funções.

create or replace function public.restringir_update_entregador()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  hoje date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if (select private.app_role()) = 'entregador' then
    -- Só pelas funções de entrega, que conferem o pagamento. Um PATCH direto na
    -- tabela pulava essa conferência (ex.: entregue sem dizer se o cliente pagou).
    if coalesce(pg_catalog.current_setting('kg.concluir_entrega', true), '') is distinct from old.id::text then
      raise exception 'Entregador só pode concluir a entrega pelo aplicativo';
    end if;
    if new.id is distinct from old.id
      or new.cliente_id is distinct from old.cliente_id
      or ((new.descricao is distinct from old.descricao or new.valor is distinct from old.valor)
          and coalesce(pg_catalog.current_setting('kg.entrega_parcial', true), '') is distinct from old.id::text)
      or new.data_entrega is distinct from old.data_entrega
      or new.data_vencimento is distinct from old.data_vencimento
      or new.vendedor is distinct from old.vendedor
      or new.forma_pagamento is distinct from old.forma_pagamento
      or new.prazo_dias is distinct from old.prazo_dias
      or new.prazos_boleto is distinct from old.prazos_boleto
      or old.status is distinct from 'pendente'
      or new.status is distinct from 'entregue'
    then
      raise exception 'entregador só pode concluir uma entrega';
    end if;
    -- Datas: a entrega guardada sem internet pode chegar alguns dias depois, mas
    -- não pode cair num mês já acertado nem no futuro. Mais antigo que 7 dias,
    -- quem registra é o administrador.
    if new.data_entregue_em < hoje - 7 then
      raise exception 'Data da entrega com mais de 7 dias: peça ao administrador para registrar esta entrega';
    end if;
    if new.data_pagamento is distinct from old.data_pagamento
      and (new.data_pagamento < hoje - 7 or new.data_pagamento > hoje) then
      raise exception 'Data do pagamento inválida: precisa ser de hoje ou dos últimos 7 dias';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.restringir_update_entregador() from public, anon, authenticated;

create or replace function public.concluir_entrega(p_id bigint,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pedido public.pedidos;
begin
  if coalesce(private.app_role(),'') not in ('admin','entregador') then raise exception 'Sem permissão para concluir entrega'; end if;
  select * into pedido from public.pedidos where id=p_id for update;
  -- O entregador pode ler entregues, mas a RLS só permite bloquear/alterar
  -- pendentes. Reconsulta sem bloqueio para reconhecer um envio já concluído.
  if not found then
    select * into pedido from public.pedidos where id=p_id;
    if found and pedido.status='entregue' then return to_jsonb(pedido); end if;
    raise exception 'Pedido não encontrado ou indisponível';
  end if;
  -- Repetir um envio após perder a resposta não altera a data nem o pagamento.
  if pedido.status='entregue' then return to_jsonb(pedido); end if;
  if pedido.status_pagamento is distinct from 'pago' then
    if coalesce(p_dados->>'status_pagamento','') not in ('pago','pendente','recusado') then
      raise exception 'Informe o resultado do recebimento';
    end if;
    if p_dados->>'status_pagamento'='pago' and
      (coalesce(p_dados->>'forma_pagamento_real','') not in ('dinheiro','pix','cheque') or p_dados->>'data_pagamento' is null) then
      raise exception 'Informe a forma e a data do recebimento';
    end if;
  end if;
  -- Marca, só para este UPDATE, que a alteração vem desta função (o gatilho do
  -- entregador recusa qualquer outra). Some ao fim da transação.
  perform pg_catalog.set_config('kg.concluir_entrega', p_id::text, true);
  update public.pedidos set status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
    observacao=p_dados->>'observacao',status_pagamento=p_dados->>'status_pagamento',
    forma_pagamento_real=case when p_dados->>'status_pagamento'='pago' then p_dados->>'forma_pagamento_real' end,
    data_pagamento=case when p_dados->>'status_pagamento'='pago' then (p_dados->>'data_pagamento')::date end
    where id=p_id returning * into pedido;
  if not found then raise exception 'Entrega não atualizada'; end if;
  perform pg_catalog.set_config('kg.concluir_entrega', '', true);
  return to_jsonb(pedido);
end; $$;

create or replace function public.concluir_entrega_parcial(p_id bigint, p_dados jsonb, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pedido public.pedidos; item public.itens_pedido; elemento jsonb; entregue integer;
  n_itens integer; total numeric; nova_descricao text;
  reduzido boolean := false; algum_entregue boolean := false;
begin
  if coalesce(private.app_role(),'') not in ('admin','entregador') then
    raise exception 'Sem permissão para concluir entrega';
  end if;
  select * into pedido from public.pedidos where id=p_id for update;
  if not found then raise exception 'Pedido não encontrado ou indisponível'; end if;
  -- Repetir um envio após perder a resposta não altera nada.
  if pedido.status='entregue' then
    return to_jsonb(pedido) || jsonb_build_object('itens',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.itens_pedido i where i.pedido_id=p_id));
  end if;

  select count(*) into n_itens from public.itens_pedido where pedido_id=p_id;
  if jsonb_typeof(p_itens) is distinct from 'array' or n_itens=0
    or jsonb_array_length(p_itens) <> n_itens
    or (select count(distinct v->>'id') from jsonb_array_elements(p_itens) v) <> n_itens then
    raise exception 'Informe a quantidade entregue de cada item do pedido';
  end if;
  for item in select * from public.itens_pedido where pedido_id=p_id order by id loop
    select v into elemento from jsonb_array_elements(p_itens) v where (v->>'id')::bigint=item.id;
    if elemento is null or (elemento->>'qtd_entregue') is null
      or (elemento->>'qtd_entregue')::numeric is distinct from trunc((elemento->>'qtd_entregue')::numeric) then
      raise exception 'Quantidade entregue deve ser um número inteiro';
    end if;
    entregue := (elemento->>'qtd_entregue')::integer;
    if entregue < 0 or entregue > item.qtd then
      raise exception 'Quantidade entregue inválida: não pode passar do que foi pedido';
    end if;
    if entregue < item.qtd then reduzido := true; end if;
    if entregue > 0 then algum_entregue := true; end if;
  end loop;
  if not algum_entregue then
    raise exception 'Nada foi entregue: não confirme a entrega';
  end if;
  -- Quem pagou adiantado teria pago mais do que recebeu; o administrador ajusta antes.
  if reduzido and pedido.status_pagamento = 'pago' then
    raise exception 'Pedido já pago: peça ao administrador para ajustar o pedido antes da entrega parcial';
  end if;

  if pedido.status_pagamento is distinct from 'pago' then
    if coalesce(p_dados->>'status_pagamento','') not in ('pago','pendente','recusado') then
      raise exception 'Informe o resultado do recebimento';
    end if;
    if p_dados->>'status_pagamento'='pago' and
      (coalesce(p_dados->>'forma_pagamento_real','') not in ('dinheiro','pix','cheque') or p_dados->>'data_pagamento' is null) then
      raise exception 'Informe a forma e a data do recebimento';
    end if;
  end if;

  if reduzido then
    for item in select * from public.itens_pedido where pedido_id=p_id order by id loop
      select v into elemento from jsonb_array_elements(p_itens) v where (v->>'id')::bigint=item.id;
      entregue := (elemento->>'qtd_entregue')::integer;
      if entregue = 0 then
        delete from public.itens_pedido where id=item.id;
      elsif entregue < item.qtd then
        update public.itens_pedido set qtd=entregue, qtd_pedida=coalesce(qtd_pedida,item.qtd) where id=item.id;
      end if;
    end loop;
    select sum(qtd*preco_unit), string_agg(qtd::text || 'x ' || nome, ', ' order by id)
      into total, nova_descricao from public.itens_pedido where pedido_id=p_id;
    perform pg_catalog.set_config('kg.entrega_parcial', p_id::text, true);
  end if;

  -- Um único UPDATE: o gatilho do entregador exige que toda alteração já conclua a entrega.
  -- Marca, só para este UPDATE, que a alteração vem desta função (o gatilho do
  -- entregador recusa qualquer outra). Some ao fim da transação.
  perform pg_catalog.set_config('kg.concluir_entrega', p_id::text, true);
  update public.pedidos set status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
    valor=coalesce(total,valor), descricao=coalesce(nova_descricao,descricao),
    observacao=p_dados->>'observacao',status_pagamento=case when pedido.status_pagamento='pago' then 'pago' else p_dados->>'status_pagamento' end,
    forma_pagamento_real=case
      when pedido.status_pagamento='pago' then pedido.forma_pagamento_real
      when p_dados->>'status_pagamento'='pago' then p_dados->>'forma_pagamento_real' end,
    data_pagamento=case
      when pedido.status_pagamento='pago' then pedido.data_pagamento
      when p_dados->>'status_pagamento'='pago' then (p_dados->>'data_pagamento')::date end
    where id=p_id returning * into pedido;
  if not found then raise exception 'Entrega não atualizada'; end if;
  perform pg_catalog.set_config('kg.concluir_entrega', '', true);
  perform pg_catalog.set_config('kg.entrega_parcial', '', true);
  return to_jsonb(pedido) || jsonb_build_object('itens',
    (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.itens_pedido i where i.pedido_id=p_id));
end; $$;
