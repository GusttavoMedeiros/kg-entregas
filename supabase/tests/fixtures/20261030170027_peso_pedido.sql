-- Campos opcionais: pedidos e produtos existentes permanecem sem alteração.
alter table public.produtos add column peso_kg numeric check (peso_kg > 0 and peso_kg < 1000000);
alter table public.itens_pedido add column peso_unitario_kg numeric check (peso_unitario_kg > 0 and peso_unitario_kg < 1000000);

-- Guarda o peso do catálogo no item, sem recalcular pedidos históricos.
create function private.registrar_peso_item() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  select p.peso_kg into new.peso_unitario_kg from public.produtos p where p.id = new.produto_id;
  return new;
end; $$;
revoke all on function private.registrar_peso_item() from public, anon, authenticated;
create trigger itens_registrar_peso before insert on public.itens_pedido
for each row execute function private.registrar_peso_item();

create or replace function public.salvar_produto(p_produto jsonb,p_id bigint default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare produto public.produtos; anterior numeric; custo_anterior numeric;
  custo numeric := (p_produto->>'preco_custo')::numeric;
  peso numeric := nullif(p_produto->>'peso_kg','')::numeric;
  v_preco numeric := round((p_produto->>'preco')::numeric,2);
begin
  if coalesce(private.app_role(),'') <> 'admin' then raise exception 'Somente administrador pode alterar produtos'; end if;
  if peso is not null and not (peso > 0 and peso < 1000000) then raise exception 'Peso inválido'; end if;
  if nullif(trim(p_produto->>'nome'),'') is null or v_preco is null or not(v_preco>0 and v_preco<'Infinity'::numeric)
    or (custo is not null and not(custo>=0 and custo<'Infinity'::numeric)) then raise exception 'Produto ou preço inválido'; end if;
  if p_id is null then
    insert into public.produtos(nome,categoria,preco,peso_kg) values(trim(p_produto->>'nome'),p_produto->>'categoria',v_preco,peso)
      returning * into produto;
  else
    select p.preco,c.preco_custo into anterior,custo_anterior from public.produtos p
      left join public.produto_custos c on c.produto_id=p.id where p.id=p_id for update of p;
    if not found then raise exception 'Produto não encontrado'; end if;
    update public.produtos set nome=trim(p_produto->>'nome'),categoria=p_produto->>'categoria',preco=v_preco,
      peso_kg=case when p_produto ? 'peso_kg' then peso else peso_kg end
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
  return to_jsonb(pedido) || jsonb_build_object('itens',
    (select jsonb_agg(to_jsonb(i) order by i.id) from public.itens_pedido i where i.pedido_id=pedido.id));
end; $$;
