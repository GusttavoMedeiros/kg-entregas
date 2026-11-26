CREATE OR REPLACE FUNCTION public.salvar_pedido(p_pedido jsonb, p_itens jsonb, p_id bigint DEFAULT NULL::bigint, p_chave uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare pedido public.pedidos; item jsonb; produto public.produtos;
  itens jsonb := '[]'; total numeric := 0; qtd integer; unitario numeric; catalogo numeric;
  manter_itens boolean := false;
  usar_ids boolean;
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
  if p_id is not null then
    -- Compare o carrinho com as linhas originais. Versões anteriores do app
    -- agrupavam linhas com o mesmo produto, preço de venda e preço de catálogo.
    usar_ids := jsonb_path_exists(p_itens, '$[*].item_id');
    with originais as (
      select i.id, i.produto_id, i.qtd, i.preco_unit,
        coalesce(i.preco_catalogo, p.preco, i.preco_unit) as catalogo
      from public.itens_pedido i left join public.produtos p on p.id=i.produto_id
      where i.pedido_id=p_id
    ), linhas(origem, item_id, produto_id, qtd, preco_unit) as (
      select 'recebido', x.item_id, x.produto_id, x.qtd, x.preco_unit
      from jsonb_to_recordset(p_itens) x(item_id bigint, produto_id bigint, qtd numeric, preco_unit numeric)
      union all
      select 'original', case when usar_ids then o.id end, o.produto_id, o.qtd, o.preco_unit from originais o
      union all
      select 'agrupado', null, o.produto_id, sum(o.qtd), o.preco_unit from originais o
      where not usar_ids group by o.produto_id, o.preco_unit, o.catalogo
    ), carrinhos as (
      select l.origem, jsonb_agg(jsonb_build_array(l.item_id,l.produto_id,l.qtd,l.preco_unit)
        order by l.item_id,l.produto_id,l.qtd,l.preco_unit) as conteudo
      from linhas l group by l.origem
    )
    select exists (
      select 1 from carrinhos r join carrinhos o using (conteudo)
      where r.origem='recebido' and o.origem in ('original','agrupado')
    ) into manter_itens;
  end if;
  if manter_itens then
    total := pedido.valor;
    v_descricao := pedido.descricao;
  else
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
  end if;
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
    if not manter_itens then
      delete from public.itens_pedido where pedido_id=p_id;
    end if;
  end if;
  if not manter_itens then
    insert into public.itens_pedido(pedido_id,produto_id,nome,qtd,preco_unit,preco_catalogo)
      select pedido.id,x.produto_id,x.nome,x.qtd,x.preco_unit,x.preco_catalogo
      from jsonb_to_recordset(itens) x(produto_id bigint,nome text,qtd integer,preco_unit numeric,preco_catalogo numeric);
  end if;
  return to_jsonb(pedido) || jsonb_build_object('itens',
    (select jsonb_agg(to_jsonb(i) order by i.id) from public.itens_pedido i where i.pedido_id=pedido.id));
end; $function$;
