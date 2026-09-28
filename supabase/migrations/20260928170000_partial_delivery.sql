-- Entrega parcial: o que não chegou é cancelado e o cliente paga só o que recebeu.
-- Mudança aditiva: uma coluna nova (vazia nos pedidos existentes), uma função
-- nova e um ajuste no gatilho do entregador. concluir_entrega não muda, então
-- o aplicativo antigo continua funcionando até ser atualizado.

-- Quantidade originalmente pedida; só é preenchida quando a entrega é parcial.
-- Nula significa "foi entregue tudo o que foi pedido".
alter table public.itens_pedido add column qtd_pedida integer;
alter table public.itens_pedido add constraint itens_qtd_pedida_check
  check (qtd_pedida is null or qtd_pedida >= qtd);

-- O entregador continua sem poder alterar valor ou descrição do pedido. A única
-- exceção é a entrega parcial, dentro da própria transação da função abaixo, que
-- marca o pedido com uma configuração local (some ao fim da transação e não pode
-- ser definida pela API, que só executa funções do esquema public).
create or replace function public.restringir_update_entregador()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select private.app_role()) = 'entregador' then
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
  end if;
  return new;
end;
$$;

revoke all on function public.restringir_update_entregador() from public, anon, authenticated;

-- p_itens: [{"id": <id do item>, "qtd_entregue": <inteiro>}, ...], com TODOS os
-- itens do pedido. Item com qtd_entregue = 0 sai do pedido; item com menos do que
-- o pedido fica com a quantidade entregue. O valor do pedido é recalculado.
-- Roda com os direitos do dono porque o entregador não tem permissão de alterar
-- itens; por isso valida tudo por conta própria.
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
      (coalesce(p_dados->>'forma_pagamento_real','') not in ('dinheiro','pix') or p_dados->>'data_pagamento' is null) then
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
  perform pg_catalog.set_config('kg.entrega_parcial', '', true);
  return to_jsonb(pedido) || jsonb_build_object('itens',
    (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.itens_pedido i where i.pedido_id=p_id));
end; $$;

revoke all on function public.concluir_entrega_parcial(bigint,jsonb,jsonb) from public, anon;
grant execute on function public.concluir_entrega_parcial(bigint,jsonb,jsonb) to authenticated;
