-- Versões impedem que uma edição ou entrega antiga sobrescreva outra operação.
alter table public.pedidos add column versao bigint not null default 1;
alter table public.pedidos add column acao_entrega uuid;

create function private.atualizar_versao_pedido() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.versao := old.versao + 1;
  if new.status is distinct from 'entregue' then new.acao_entrega := null; end if;
  return new;
end; $$;
revoke all on function private.atualizar_versao_pedido() from public, anon, authenticated;
create trigger pedidos_versao before update on public.pedidos
for each row execute function private.atualizar_versao_pedido();

create or replace function public.salvar_pedido(
  p_pedido jsonb, p_itens jsonb, p_id bigint default null, p_chave uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pedido public.pedidos; item jsonb; produto public.produtos;
  itens jsonb := '[]'; total numeric := 0; qtd integer; unitario numeric; catalogo numeric;
  v_descricao text := ''; prazos integer[]; vencimento date; forma text; entrega date;
begin
  if coalesce(private.app_role(),'') not in ('admin','vendedor') then
    raise exception 'Sem permissão para salvar pedidos';
  end if;
  if p_id is null then
    if p_chave is null then raise exception 'Chave de criação obrigatória'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_chave::text,0));
    select * into pedido from public.pedidos where chave_criacao=p_chave;
    if found then
      return to_jsonb(pedido) || jsonb_build_object('itens',
        (select jsonb_agg(to_jsonb(i) order by id) from public.itens_pedido i where pedido_id=pedido.id));
    end if;
  else
    select * into pedido from public.pedidos where id=p_id for update;
    if not found or pedido.status <> 'pendente' then raise exception 'Pedido indisponível para edição'; end if;
    if nullif(p_pedido->>'versao', '') is null or pedido.versao <> (p_pedido->>'versao')::bigint then
      raise exception 'Conflito: pedido alterado em outro aparelho. Recarregue antes de editar';
    end if;
  end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens)=0 then
    raise exception 'Inclua pelo menos um item';
  end if;
  for item in select value from jsonb_array_elements(p_itens) loop
    select * into produto from public.produtos where id=(item->>'produto_id')::bigint;
    if not found then raise exception 'Produto não encontrado'; end if;
    if (item->>'qtd')::numeric is distinct from trunc((item->>'qtd')::numeric) then
      raise exception 'Quantidade deve ser inteira';
    end if;
    qtd := (item->>'qtd')::integer;
    unitario := round((item->>'preco_unit')::numeric,2);
    select i.preco_catalogo into catalogo from public.itens_pedido i
      where i.pedido_id=p_id and i.produto_id=produto.id order by i.id limit 1;
    catalogo := round(coalesce(catalogo,produto.preco),2);
    if qtd is null or qtd<=0 or unitario is null or not(unitario>=0 and unitario<'Infinity'::numeric)
      or not(catalogo>=0 and catalogo<'Infinity'::numeric) then raise exception 'Quantidade ou preço inválido'; end if;
    total := total + qtd * unitario;
    v_descricao := concat_ws(', ',nullif(v_descricao,''),qtd::text || 'x ' || produto.nome);
    itens := itens || jsonb_build_array(jsonb_build_object('produto_id',produto.id,'nome',produto.nome,
      'qtd',qtd,'preco_unit',unitario,'preco_catalogo',catalogo));
  end loop;
  entrega := (p_pedido->>'data_entrega')::date;
  forma := p_pedido->>'forma_pagamento';
  if entrega is null or forma is null or forma not in ('avista','boleto','cheque') then
    raise exception 'Data de entrega e forma de pagamento obrigatórias';
  end if;
  if forma='boleto' then
    select array_agg(v order by v) into prazos from
      (select value::integer v from unnest(string_to_array(p_pedido->>'prazos_boleto',',')) value) s;
    if cardinality(prazos) is null or cardinality(prazos) not between 1 and 4
      or not(prazos <@ array[7,14,21,28])
      or cardinality(prazos) <> (select count(distinct v) from unnest(prazos) v) then
      raise exception 'Prazos do boleto inválidos';
    end if;
    vencimento := entrega + prazos[1];
  else vencimento := entrega; end if;
  if p_id is null then
    insert into public.pedidos(cliente_id,descricao,valor,status,data_entrega,data_vencimento,
      observacao,vendedor,forma_pagamento,prazo_dias,prazos_boleto,chave_criacao)
    values ((p_pedido->>'cliente_id')::bigint,v_descricao,total,'pendente',entrega,vencimento,
      p_pedido->>'observacao',private.app_login(),forma,prazos[1],array_to_string(prazos,','),p_chave)
    returning * into pedido;
  else
    update public.pedidos set cliente_id=(p_pedido->>'cliente_id')::bigint, descricao=v_descricao,
      valor=total,data_entrega=entrega,data_vencimento=vencimento,observacao=p_pedido->>'observacao',
      forma_pagamento=forma,prazo_dias=prazos[1],prazos_boleto=array_to_string(prazos,',')
    where id=p_id returning * into pedido;
    if not found then raise exception 'Sem permissão para editar pedido'; end if;
    delete from public.itens_pedido where pedido_id=p_id;
  end if;
  insert into public.itens_pedido(pedido_id,produto_id,nome,qtd,preco_unit,preco_catalogo)
    select pedido.id,x.produto_id,x.nome,x.qtd,x.preco_unit,x.preco_catalogo
    from jsonb_to_recordset(itens) x(produto_id bigint,nome text,qtd integer,preco_unit numeric,preco_catalogo numeric);
  return to_jsonb(pedido) || jsonb_build_object('itens',itens);
end; $$;

create or replace function public.concluir_entrega(p_id bigint,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pedido public.pedidos;
begin
  if coalesce(private.app_role(),'') not in ('admin','entregador') then raise exception 'Sem permissão para concluir entrega'; end if;
  if nullif(p_dados->>'acao_id', '') is null or nullif(p_dados->>'versao', '') is null then
    raise exception 'Entrega antiga sem identificação ou versão: peça ao administrador para conferir';
  end if;
  select * into pedido from public.pedidos where id=p_id for update;
  -- O entregador pode ler entregues, mas a RLS só permite bloquear/alterar
  -- pendentes. Reconsulta sem bloqueio para reconhecer um envio já concluído.
  if not found then
    select * into pedido from public.pedidos where id=p_id;
    if found and pedido.status='entregue' and pedido.acao_entrega = (p_dados->>'acao_id')::uuid then return to_jsonb(pedido); end if;
    raise exception 'Pedido não encontrado ou indisponível';
  end if;
  -- Repetir um envio após perder a resposta não altera a data nem o pagamento.
  if pedido.status='entregue' then
    if pedido.acao_entrega = (p_dados->>'acao_id')::uuid then return to_jsonb(pedido); end if;
    raise exception 'Conflito: pedido já foi entregue por outra ação';
  end if;
  if pedido.versao <> (p_dados->>'versao')::bigint then raise exception 'Conflito: pedido mudou desde a abertura da entrega'; end if;
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
  update public.pedidos set acao_entrega=(p_dados->>'acao_id')::uuid, status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
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
  if nullif(p_dados->>'acao_id', '') is null or nullif(p_dados->>'versao', '') is null then
    raise exception 'Entrega antiga sem identificação ou versão: peça ao administrador para conferir';
  end if;
  select * into pedido from public.pedidos where id=p_id for update;
  if not found then raise exception 'Pedido não encontrado ou indisponível'; end if;
  -- Repetir um envio após perder a resposta não altera nada.
  if pedido.status='entregue' then
    if pedido.acao_entrega is distinct from (p_dados->>'acao_id')::uuid then raise exception 'Conflito: pedido já foi entregue por outra ação'; end if;
    return to_jsonb(pedido) || jsonb_build_object('itens',
      (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.itens_pedido i where i.pedido_id=p_id));
  end if;

  if pedido.versao <> (p_dados->>'versao')::bigint then raise exception 'Conflito: pedido mudou desde a abertura da entrega'; end if;

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
  update public.pedidos set acao_entrega=(p_dados->>'acao_id')::uuid, status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
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
