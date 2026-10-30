-- Gravações indivisíveis; permissões continuam sob RLS do usuário conectado.
-- Interrompe a migração se houver legado inconsistente, sem corrigir valores
-- comerciais automaticamente ou apagar pedidos para fazer a validação passar.
do $$ begin
  if exists (
    select 1 from public.pedidos p left join public.itens_pedido i on i.pedido_id=p.id
    group by p.id,p.valor having count(i.id)=0 or p.valor is distinct from sum(i.qtd*i.preco_unit)
  ) then raise exception 'Revise pedidos sem itens ou com total divergente antes de migrar'; end if;
end; $$;
alter table public.itens_pedido drop constraint itens_pedido_pedido_id_fkey;
alter table public.itens_pedido add constraint itens_pedido_pedido_id_fkey
  foreign key (pedido_id) references public.pedidos(id) on delete cascade;
alter table public.pedidos add column chave_criacao uuid unique;

-- RLS protege linhas, não uma coluna sensível dentro do catálogo compartilhado.
create table public.produto_custos (
  produto_id bigint primary key references public.produtos(id) on delete cascade,
  preco_custo numeric check (preco_custo >= 0 and preco_custo < 'Infinity'::numeric)
);
insert into public.produto_custos select id, preco_custo from public.produtos;
alter table public.produto_custos enable row level security;
revoke all on public.produto_custos from public, anon;
grant select, insert, update, delete on public.produto_custos to authenticated;
create policy custos_admin on public.produto_custos for all to authenticated
  using ((select private.app_role()) = 'admin')
  with check ((select private.app_role()) = 'admin');
alter table public.produtos drop column preco_custo;

create or replace function private.proteger_pagamento_vendedor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if private.app_role() = 'vendedor' then
    if tg_op = 'INSERT' then
      if new.status_pagamento is not null or new.forma_pagamento_real is not null
        or new.data_pagamento is not null or new.data_entregue_em is not null then
        raise exception 'Vendedor não pode registrar recebimentos ou entregas';
      end if;
    elsif new.status_pagamento is distinct from old.status_pagamento
      or new.forma_pagamento_real is distinct from old.forma_pagamento_real
      or new.data_pagamento is distinct from old.data_pagamento
      or new.data_entregue_em is distinct from old.data_entregue_em
      or new.chave_criacao is distinct from old.chave_criacao then
      raise exception 'Vendedor não pode alterar recebimentos ou entregas';
    end if;
  end if;
  if new.data_entregue_em > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Data da entrega não pode estar no futuro';
  end if;
  return new;
end; $$;
create trigger pedidos_proteger_pagamento_vendedor before insert or update on public.pedidos
  for each row execute function private.proteger_pagamento_vendedor();

create or replace function private.validar_total_pedido()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare ids bigint[]; pid bigint; total numeric; esperado numeric; quantidade bigint;
begin
  if tg_table_name = 'pedidos' then
    ids := array[coalesce(new.id,old.id)];
  elsif tg_op = 'INSERT' then ids := array[new.pedido_id];
  elsif tg_op = 'DELETE' then ids := array[old.pedido_id];
  else ids := array[old.pedido_id,new.pedido_id]; end if;
  foreach pid in array ids loop
    select valor into esperado from public.pedidos where id=pid for update;
    if not found then continue; end if;
    select sum(qtd * preco_unit), count(*) into total, quantidade
      from public.itens_pedido where pedido_id=pid;
    if quantidade=0 or esperado is distinct from total then
      raise exception 'Pedido deve conter itens e total igual à soma dos itens';
    end if;
  end loop;
  return null;
end; $$;
create constraint trigger pedidos_total_consistente after insert or update on public.pedidos
  deferrable initially deferred for each row execute function private.validar_total_pedido();
create constraint trigger itens_total_consistente after insert or update or delete on public.itens_pedido
  deferrable initially deferred for each row execute function private.validar_total_pedido();

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

create or replace function public.salvar_produto(p_produto jsonb,p_id bigint default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare produto public.produtos; anterior numeric; custo_anterior numeric;
  custo numeric := (p_produto->>'preco_custo')::numeric;
  v_preco numeric := round((p_produto->>'preco')::numeric,2);
begin
  if coalesce(private.app_role(),'') <> 'admin' then raise exception 'Somente administrador pode alterar produtos'; end if;
  if nullif(trim(p_produto->>'nome'),'') is null or v_preco is null or not(v_preco>0 and v_preco<'Infinity'::numeric)
    or (custo is not null and not(custo>=0 and custo<'Infinity'::numeric)) then raise exception 'Produto ou preço inválido'; end if;
  if p_id is null then
    insert into public.produtos(nome,categoria,preco) values(trim(p_produto->>'nome'),p_produto->>'categoria',v_preco)
      returning * into produto;
  else
    select p.preco,c.preco_custo into anterior,custo_anterior from public.produtos p
      left join public.produto_custos c on c.produto_id=p.id where p.id=p_id for update of p;
    if not found then raise exception 'Produto não encontrado'; end if;
    update public.produtos set nome=trim(p_produto->>'nome'),categoria=p_produto->>'categoria',preco=v_preco
      where id=p_id returning * into produto;
  end if;
  insert into public.produto_custos values(produto.id,custo)
    on conflict(produto_id) do update set preco_custo=excluded.preco_custo;
  if p_id is null or anterior is distinct from v_preco or custo_anterior is distinct from custo then
    insert into public.historico_precos(produto_id,preco_venda,preco_custo,alterado_por)
      values(produto.id,v_preco,custo,private.app_login());
  end if;
  return to_jsonb(produto) || jsonb_build_object('preco_custo',custo);
end; $$;

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
  if coalesce(p_dados->>'status_pagamento','') not in ('pago','pendente','recusado') then
    raise exception 'Informe o resultado do recebimento';
  end if;
  if p_dados->>'status_pagamento'='pago' and
    (coalesce(p_dados->>'forma_pagamento_real','') not in ('dinheiro','pix') or p_dados->>'data_pagamento' is null) then
    raise exception 'Informe a forma e a data do recebimento';
  end if;
  update public.pedidos set status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
    observacao=p_dados->>'observacao',status_pagamento=p_dados->>'status_pagamento',
    forma_pagamento_real=case when p_dados->>'status_pagamento'='pago' then p_dados->>'forma_pagamento_real' end,
    data_pagamento=case when p_dados->>'status_pagamento'='pago' then (p_dados->>'data_pagamento')::date end
    where id=p_id returning * into pedido;
  if not found then raise exception 'Entrega não atualizada'; end if;
  return to_jsonb(pedido);
end; $$;

revoke all on function private.proteger_pagamento_vendedor(),private.validar_total_pedido() from public,anon,authenticated;
revoke all on function public.salvar_pedido(jsonb,jsonb,bigint,uuid),public.salvar_produto(jsonb,bigint),public.concluir_entrega(bigint,jsonb) from public,anon;
grant execute on function public.salvar_pedido(jsonb,jsonb,bigint,uuid),public.salvar_produto(jsonb,bigint),public.concluir_entrega(bigint,jsonb) to authenticated;
