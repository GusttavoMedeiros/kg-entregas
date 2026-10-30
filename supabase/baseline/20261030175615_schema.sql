


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "private"."app_login"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select auth.jwt() -> 'app_metadata' ->> 'app_login' $$;


ALTER FUNCTION "private"."app_login"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."app_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$ select auth.jwt() -> 'app_metadata' ->> 'app_role' $$;


ALTER FUNCTION "private"."app_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."atualizar_versao_pedido"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.versao := old.versao + 1;
  if new.status is distinct from 'entregue' then new.acao_entrega := null; end if;
  return new;
end; $$;


ALTER FUNCTION "private"."atualizar_versao_pedido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."definir_data_entrega_real"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  hoje_brasil date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'INSERT' then
    if new.status = 'entregue' and new.data_entregue_em is null then
      new.data_entregue_em := hoje_brasil;
    elsif new.status is distinct from 'entregue' then
      new.data_entregue_em := null;
    end if;
    return new;
  end if;

  if old.status is distinct from 'entregue' and new.status = 'entregue' then
    if new.data_entregue_em is null
      or new.data_entregue_em is not distinct from old.data_entregue_em
    then
      new.data_entregue_em := hoje_brasil;
    end if;
  else
    new.data_entregue_em := old.data_entregue_em;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "private"."definir_data_entrega_real"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."impedir_cliente_duplicado"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' or new.cnpj_cpf is distinct from old.cnpj_cpf then
    if nullif(new.cnpj_cpf,'') is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.cnpj_cpf,0));
      if exists (
        select 1 from public.clientes c
        where c.cnpj_cpf = new.cnpj_cpf and c.id is distinct from new.id
      ) then raise exception 'Já existe cliente com este CPF/CNPJ'; end if;
    end if;
  end if;
  return new;
end; $$;


ALTER FUNCTION "private"."impedir_cliente_duplicado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."preservar_pagamento_na_entrega"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if old.status = 'pendente' and new.status = 'entregue'
    and old.status_pagamento = 'pago' then
    new.status_pagamento := old.status_pagamento;
    new.forma_pagamento_real := old.forma_pagamento_real;
    new.data_pagamento := old.data_pagamento;
  end if;
  return new;
end; $$;


ALTER FUNCTION "private"."preservar_pagamento_na_entrega"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."proteger_pagamento_vendedor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."proteger_pagamento_vendedor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."registrar_historico_pedido"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  acao_registrada text;
  campos_alterados text[] := '{}';
  autor text;
begin
  autor := coalesce(private.app_login(), new.vendedor, current_user);

  if tg_op = 'INSERT' then
    acao_registrada := 'criado';
  else
    select coalesce(array_agg(chave order by chave), '{}')
      into campos_alterados
    from jsonb_each(to_jsonb(new)) as atual(chave, valor)
    where atual.valor is distinct from to_jsonb(old) -> chave
      and chave <> 'created_at';

    if cardinality(campos_alterados) = 0 then
      return new;
    end if;

    acao_registrada := case
      when old.status is distinct from new.status and new.status = 'entregue' then 'entregue'
      when old.status_pagamento is distinct from new.status_pagamento
        or old.forma_pagamento_real is distinct from new.forma_pagamento_real
        or old.data_pagamento is distinct from new.data_pagamento then 'pagamento'
      else 'editado'
    end;
  end if;

  insert into public.historico_pedidos
    (pedido_id, acao, alterado_por, campos, antes, depois)
  values
    (new.id, acao_registrada, autor, campos_alterados,
     case when tg_op = 'UPDATE' then to_jsonb(old) end,
     to_jsonb(new));

  return new;
end;
$$;


ALTER FUNCTION "private"."registrar_historico_pedido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."registrar_peso_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  select p.peso_kg into new.peso_unitario_kg from public.produtos p where p.id = new.produto_id;
  return new;
end; $$;


ALTER FUNCTION "private"."registrar_peso_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."validar_total_pedido"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."validar_total_pedido"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."concluir_entrega"("p_id" bigint, "p_dados" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."concluir_entrega"("p_id" bigint, "p_dados" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."concluir_entrega_parcial"("p_id" bigint, "p_dados" "jsonb", "p_itens" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."concluir_entrega_parcial"("p_id" bigint, "p_dados" "jsonb", "p_itens" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."limpar_pedidos"("p_ids" bigint[]) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare apagados integer;
begin
  if coalesce(private.app_role(),'') <> 'admin' then
    raise exception 'Somente administrador pode limpar pedidos';
  end if;
  if coalesce(cardinality(p_ids),0) = 0 then return 0; end if;
  if cardinality(p_ids) > 10000 then raise exception 'Quantidade de pedidos excede o limite seguro'; end if;
  if cardinality(p_ids) <> (select count(distinct id) from unnest(p_ids) id) then
    raise exception 'Lista de pedidos duplicada';
  end if;
  delete from public.pedidos where id = any(p_ids);
  get diagnostics apagados = row_count;
  return apagados;
end; $$;


ALTER FUNCTION "public"."limpar_pedidos"("p_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_acerto"("p_vendedor" "text", "p_tipo" "text", "p_ini" "date", "p_fim" "date") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  lista jsonb;
  acerto public.acertos_comissao;
begin
  if coalesce(private.app_role(), '') <> 'admin' then
    raise exception 'Só o administrador registra acertos';
  end if;
  if coalesce(p_vendedor, '') = '' then
    raise exception 'Escolha o vendedor do acerto';
  end if;
  if coalesce(p_tipo, '') not in ('semanal', 'quinzenal', 'mensal') then
    raise exception 'Tipo de período inválido';
  end if;
  if p_ini is null or p_fim is null or p_fim < p_ini then
    raise exception 'Período inválido';
  end if;
  if p_ini > (statement_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Este período ainda não começou';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'cliente', coalesce(c.nome, 'Cliente'),
      'data', coalesce(p.data_entregue_em, p.data_entrega),
      'unidades', coalesce((select sum(i.qtd) from public.itens_pedido i where i.pedido_id = p.id), 0),
      'valor', coalesce(p.valor, 0)
    ) order by p.id), '[]'::jsonb)
    into lista
  from public.pedidos p
  left join public.clientes c on c.id = p.cliente_id
  where p.status = 'entregue'
    and p.vendedor = p_vendedor
    and coalesce(p.data_entregue_em, p.data_entrega) between p_ini and p_fim;

  insert into public.acertos_comissao (vendedor, tipo, ini, fim, pedidos, unidades, total, registrado_por)
  values (
    p_vendedor, p_tipo, p_ini, p_fim, lista,
    coalesce((select sum((e->>'unidades')::numeric) from jsonb_array_elements(lista) e), 0),
    coalesce((select sum((e->>'valor')::numeric) from jsonb_array_elements(lista) e), 0),
    coalesce(private.app_login(), 'admin')
  )
  returning * into acerto;
  return to_jsonb(acerto);
end; $$;


ALTER FUNCTION "public"."registrar_acerto"("p_vendedor" "text", "p_tipo" "text", "p_ini" "date", "p_fim" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restringir_update_entregador"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."restringir_update_entregador"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."salvar_pedido"("p_pedido" "jsonb", "p_itens" "jsonb", "p_id" bigint DEFAULT NULL::bigint, "p_chave" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."salvar_pedido"("p_pedido" "jsonb", "p_itens" "jsonb", "p_id" bigint, "p_chave" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."salvar_produto"("p_produto" "jsonb", "p_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."salvar_produto"("p_produto" "jsonb", "p_id" bigint) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."acertos_comissao" (
    "id" bigint NOT NULL,
    "vendedor" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "ini" "date" NOT NULL,
    "fim" "date" NOT NULL,
    "pedidos" "jsonb" NOT NULL,
    "unidades" numeric NOT NULL,
    "total" numeric NOT NULL,
    "registrado_por" "text" NOT NULL,
    "registrado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "acertos_comissao_pedidos_check" CHECK (("jsonb_typeof"("pedidos") = 'array'::"text")),
    CONSTRAINT "acertos_comissao_periodo_check" CHECK (("fim" >= "ini")),
    CONSTRAINT "acertos_comissao_tipo_check" CHECK (("tipo" = ANY (ARRAY['semanal'::"text", 'quinzenal'::"text", 'mensal'::"text"]))),
    CONSTRAINT "acertos_comissao_total_check" CHECK (("total" >= (0)::numeric)),
    CONSTRAINT "acertos_comissao_unidades_check" CHECK (("unidades" >= (0)::numeric))
);


ALTER TABLE "public"."acertos_comissao" OWNER TO "postgres";


ALTER TABLE "public"."acertos_comissao" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."acertos_comissao_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "responsavel" "text",
    "whatsapp" "text",
    "endereco" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cnpj_cpf" "text",
    "tipo_pessoa" "text" DEFAULT 'juridica'::"text",
    "inscricao_estadual" "text",
    "email" "text",
    "observacao" "text",
    CONSTRAINT "clientes_observacao_tamanho" CHECK (("char_length"("observacao") <= 1000)),
    CONSTRAINT "clientes_tipo_pessoa_check" CHECK ((("tipo_pessoa" IS NULL) OR ("tipo_pessoa" = ANY (ARRAY['fisica'::"text", 'juridica'::"text"]))))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."clientes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."clientes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."clientes_id_seq" OWNED BY "public"."clientes"."id";



CREATE TABLE IF NOT EXISTS "public"."historico_pedidos" (
    "id" bigint NOT NULL,
    "pedido_id" bigint NOT NULL,
    "acao" "text" NOT NULL,
    "alterado_por" "text" NOT NULL,
    "campos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "antes" "jsonb",
    "depois" "jsonb",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "historico_pedidos_acao_check" CHECK (("acao" = ANY (ARRAY['criado'::"text", 'editado'::"text", 'entregue'::"text", 'pagamento'::"text"])))
);


ALTER TABLE "public"."historico_pedidos" OWNER TO "postgres";


ALTER TABLE "public"."historico_pedidos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."historico_pedidos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."historico_precos" (
    "id" bigint NOT NULL,
    "produto_id" bigint NOT NULL,
    "preco_venda" numeric,
    "preco_custo" numeric,
    "alterado_por" "text",
    "criado_em" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "historico_preco_custo_check" CHECK ((("preco_custo" IS NULL) OR ("preco_custo" >= (0)::numeric))),
    CONSTRAINT "historico_preco_venda_check" CHECK ((("preco_venda" IS NULL) OR ("preco_venda" >= (0)::numeric)))
);


ALTER TABLE "public"."historico_precos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."historico_precos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."historico_precos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."historico_precos_id_seq" OWNED BY "public"."historico_precos"."id";



CREATE TABLE IF NOT EXISTS "public"."itens_pedido" (
    "id" bigint NOT NULL,
    "pedido_id" bigint,
    "produto_id" bigint,
    "nome" "text" NOT NULL,
    "qtd" integer DEFAULT 1 NOT NULL,
    "preco_unit" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "preco_catalogo" numeric,
    "qtd_pedida" integer,
    "peso_unitario_kg" numeric,
    CONSTRAINT "itens_pedido_peso_unitario_kg_check" CHECK ((("peso_unitario_kg" > (0)::numeric) AND ("peso_unitario_kg" < (1000000)::numeric))),
    CONSTRAINT "itens_preco_catalogo_check" CHECK ((("preco_catalogo" IS NULL) OR ("preco_catalogo" >= (0)::numeric))),
    CONSTRAINT "itens_preco_unit_check" CHECK (("preco_unit" >= (0)::numeric)),
    CONSTRAINT "itens_qtd_check" CHECK (("qtd" > 0)),
    CONSTRAINT "itens_qtd_pedida_check" CHECK ((("qtd_pedida" IS NULL) OR ("qtd_pedida" >= "qtd")))
);


ALTER TABLE "public"."itens_pedido" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."itens_pedido_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."itens_pedido_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."itens_pedido_id_seq" OWNED BY "public"."itens_pedido"."id";



CREATE TABLE IF NOT EXISTS "public"."pedidos" (
    "id" bigint NOT NULL,
    "cliente_id" bigint,
    "descricao" "text" NOT NULL,
    "valor" numeric(10,2) DEFAULT 0,
    "status" "text" DEFAULT 'pendente'::"text",
    "data_entrega" "date",
    "data_vencimento" "date",
    "observacao" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "vendedor" "text",
    "forma_pagamento" "text",
    "prazo_dias" integer,
    "prazos_boleto" "text",
    "status_pagamento" "text",
    "forma_pagamento_real" "text",
    "data_pagamento" "date",
    "data_entregue_em" "date",
    "chave_criacao" "uuid",
    "versao" bigint DEFAULT 1 NOT NULL,
    "acao_entrega" "uuid",
    CONSTRAINT "pedidos_forma_pagamento_check" CHECK ((("forma_pagamento" IS NULL) OR ("forma_pagamento" = ANY (ARRAY['avista'::"text", 'boleto'::"text", 'cheque'::"text"])))),
    CONSTRAINT "pedidos_forma_pagamento_real_check" CHECK ((("forma_pagamento_real" IS NULL) OR ("forma_pagamento_real" = ANY (ARRAY['dinheiro'::"text", 'pix'::"text", 'cheque'::"text"])))),
    CONSTRAINT "pedidos_observacao_tamanho" CHECK (("char_length"("observacao") <= 1000)),
    CONSTRAINT "pedidos_prazo_dias_check" CHECK ((("prazo_dias" IS NULL) OR ("prazo_dias" >= 0))),
    CONSTRAINT "pedidos_status_check" CHECK (("status" = ANY (ARRAY['pendente'::"text", 'entregue'::"text"]))),
    CONSTRAINT "pedidos_status_pagamento_check" CHECK ((("status_pagamento" IS NULL) OR ("status_pagamento" = ANY (ARRAY['pago'::"text", 'pendente'::"text", 'recusado'::"text"])))),
    CONSTRAINT "pedidos_valor_check" CHECK ((("valor" IS NULL) OR ("valor" >= (0)::numeric)))
);


ALTER TABLE "public"."pedidos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pedidos"."data_entregue_em" IS 'Data civil em que o pedido foi efetivamente marcado como entregue.';



CREATE SEQUENCE IF NOT EXISTS "public"."pedidos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pedidos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pedidos_id_seq" OWNED BY "public"."pedidos"."id";



CREATE TABLE IF NOT EXISTS "public"."produto_custos" (
    "produto_id" bigint NOT NULL,
    "preco_custo" numeric,
    CONSTRAINT "produto_custos_preco_custo_check" CHECK ((("preco_custo" >= (0)::numeric) AND ("preco_custo" < 'Infinity'::numeric)))
);


ALTER TABLE "public"."produto_custos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."produtos" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "categoria" "text" DEFAULT 'Ração'::"text" NOT NULL,
    "preco" numeric(10,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "peso_kg" numeric,
    CONSTRAINT "produtos_peso_kg_check" CHECK ((("peso_kg" > (0)::numeric) AND ("peso_kg" < (1000000)::numeric))),
    CONSTRAINT "produtos_preco_check" CHECK (("preco" >= (0)::numeric))
);


ALTER TABLE "public"."produtos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."produtos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."produtos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."produtos_id_seq" OWNED BY "public"."produtos"."id";



ALTER TABLE ONLY "public"."clientes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."clientes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."historico_precos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."historico_precos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."itens_pedido" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."itens_pedido_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pedidos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."pedidos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."produtos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."produtos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."acertos_comissao"
    ADD CONSTRAINT "acertos_comissao_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_pedidos"
    ADD CONSTRAINT "historico_pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."historico_precos"
    ADD CONSTRAINT "historico_precos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_chave_criacao_key" UNIQUE ("chave_criacao");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."produto_custos"
    ADD CONSTRAINT "produto_custos_pkey" PRIMARY KEY ("produto_id");



ALTER TABLE ONLY "public"."produtos"
    ADD CONSTRAINT "produtos_pkey" PRIMARY KEY ("id");



CREATE INDEX "acertos_comissao_periodo_idx" ON "public"."acertos_comissao" USING "btree" ("vendedor", "ini", "fim", "registrado_em" DESC);



CREATE INDEX "historico_pedidos_pedido_data_idx" ON "public"."historico_pedidos" USING "btree" ("pedido_id", "criado_em" DESC);



CREATE INDEX "idx_historico_produto" ON "public"."historico_precos" USING "btree" ("produto_id", "criado_em" DESC);



CREATE INDEX "itens_pedido_pedido_id_idx" ON "public"."itens_pedido" USING "btree" ("pedido_id");



CREATE INDEX "itens_pedido_produto_id_idx" ON "public"."itens_pedido" USING "btree" ("produto_id");



CREATE INDEX "pedidos_cliente_id_idx" ON "public"."pedidos" USING "btree" ("cliente_id");



CREATE OR REPLACE TRIGGER "clientes_impedir_duplicado" BEFORE INSERT OR UPDATE OF "cnpj_cpf" ON "public"."clientes" FOR EACH ROW EXECUTE FUNCTION "private"."impedir_cliente_duplicado"();



CREATE OR REPLACE TRIGGER "itens_registrar_peso" BEFORE INSERT ON "public"."itens_pedido" FOR EACH ROW EXECUTE FUNCTION "private"."registrar_peso_item"();



CREATE CONSTRAINT TRIGGER "itens_total_consistente" AFTER INSERT OR DELETE OR UPDATE ON "public"."itens_pedido" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."validar_total_pedido"();



CREATE OR REPLACE TRIGGER "pedidos_definir_data_entrega_real" BEFORE INSERT OR UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "private"."definir_data_entrega_real"();



CREATE OR REPLACE TRIGGER "pedidos_preservar_pagamento_na_entrega" BEFORE UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "private"."preservar_pagamento_na_entrega"();



CREATE OR REPLACE TRIGGER "pedidos_proteger_pagamento_vendedor" BEFORE INSERT OR UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "private"."proteger_pagamento_vendedor"();



CREATE OR REPLACE TRIGGER "pedidos_registrar_historico" AFTER INSERT OR UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "private"."registrar_historico_pedido"();



CREATE OR REPLACE TRIGGER "pedidos_restringir_update_entregador" BEFORE UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "public"."restringir_update_entregador"();



CREATE CONSTRAINT TRIGGER "pedidos_total_consistente" AFTER INSERT OR UPDATE ON "public"."pedidos" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "private"."validar_total_pedido"();



CREATE OR REPLACE TRIGGER "pedidos_versao" BEFORE UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "private"."atualizar_versao_pedido"();



ALTER TABLE ONLY "public"."historico_precos"
    ADD CONSTRAINT "historico_precos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."itens_pedido"
    ADD CONSTRAINT "itens_pedido_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id");



ALTER TABLE ONLY "public"."produto_custos"
    ADD CONSTRAINT "produto_custos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "public"."produtos"("id") ON DELETE CASCADE;



ALTER TABLE "public"."acertos_comissao" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "acertos_comissao_select" ON "public"."acertos_comissao" FOR SELECT TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login")))));



ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clientes_delete" ON "public"."clientes" FOR DELETE TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



CREATE POLICY "clientes_insert" ON "public"."clientes" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = ANY (ARRAY['admin'::"text", 'vendedor'::"text"])));



CREATE POLICY "clientes_select" ON "public"."clientes" FOR SELECT TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = ANY (ARRAY['admin'::"text", 'vendedor'::"text", 'entregador'::"text"])));



CREATE POLICY "clientes_update" ON "public"."clientes" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = ANY (ARRAY['admin'::"text", 'vendedor'::"text"]))) WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = ANY (ARRAY['admin'::"text", 'vendedor'::"text"])));



CREATE POLICY "custos_admin" ON "public"."produto_custos" TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text")) WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



CREATE POLICY "historico_admin" ON "public"."historico_precos" TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text")) WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



ALTER TABLE "public"."historico_pedidos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."historico_precos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "itens_delete" ON "public"."itens_pedido" FOR DELETE TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."pedidos"
  WHERE (("pedidos"."id" = "itens_pedido"."pedido_id") AND ("pedidos"."status" = 'pendente'::"text") AND ("pedidos"."vendedor" = ( SELECT "private"."app_login"() AS "app_login")))))));



CREATE POLICY "itens_insert" ON "public"."itens_pedido" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."pedidos"
  WHERE (("pedidos"."id" = "itens_pedido"."pedido_id") AND ("pedidos"."status" = 'pendente'::"text") AND ("pedidos"."vendedor" = ( SELECT "private"."app_login"() AS "app_login")))))));



ALTER TABLE "public"."itens_pedido" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "itens_select" ON "public"."itens_pedido" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."pedidos"
  WHERE ("pedidos"."id" = "itens_pedido"."pedido_id"))));



ALTER TABLE "public"."pedidos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedidos_delete" ON "public"."pedidos" FOR DELETE TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login")) AND ("status" = 'pendente'::"text"))));



CREATE POLICY "pedidos_insert" ON "public"."pedidos" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login")) AND ("status" = 'pendente'::"text"))));



CREATE POLICY "pedidos_select" ON "public"."pedidos" FOR SELECT TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login"))) OR (( SELECT "private"."app_role"() AS "app_role") = 'entregador'::"text")));



CREATE POLICY "pedidos_update" ON "public"."pedidos" FOR UPDATE TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login")) AND ("status" = 'pendente'::"text")) OR ((( SELECT "private"."app_role"() AS "app_role") = 'entregador'::"text") AND ("status" = 'pendente'::"text")))) WITH CHECK (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND ("vendedor" = ( SELECT "private"."app_login"() AS "app_login")) AND ("status" = 'pendente'::"text")) OR ((( SELECT "private"."app_role"() AS "app_role") = 'entregador'::"text") AND ("status" = 'entregue'::"text"))));



ALTER TABLE "public"."produto_custos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."produtos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "produtos_delete" ON "public"."produtos" FOR DELETE TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



CREATE POLICY "produtos_insert" ON "public"."produtos" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



CREATE POLICY "produtos_select" ON "public"."produtos" FOR SELECT TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = ANY (ARRAY['admin'::"text", 'vendedor'::"text"])));



CREATE POLICY "produtos_update" ON "public"."produtos" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text")) WITH CHECK ((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text"));



CREATE POLICY "usuarios autorizados consultam historico de pedidos" ON "public"."historico_pedidos" FOR SELECT TO "authenticated" USING (((( SELECT "private"."app_role"() AS "app_role") = 'admin'::"text") OR ((( SELECT "private"."app_role"() AS "app_role") = 'vendedor'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."pedidos"
  WHERE (("pedidos"."id" = "historico_pedidos"."pedido_id") AND ("pedidos"."vendedor" = ( SELECT "private"."app_login"() AS "app_login"))))))));



GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."app_login"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."app_login"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."app_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."app_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."atualizar_versao_pedido"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."definir_data_entrega_real"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."impedir_cliente_duplicado"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."preservar_pagamento_na_entrega"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."proteger_pagamento_vendedor"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."registrar_historico_pedido"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."registrar_peso_item"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."validar_total_pedido"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."concluir_entrega"("p_id" bigint, "p_dados" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."concluir_entrega"("p_id" bigint, "p_dados" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."concluir_entrega"("p_id" bigint, "p_dados" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."concluir_entrega_parcial"("p_id" bigint, "p_dados" "jsonb", "p_itens" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."concluir_entrega_parcial"("p_id" bigint, "p_dados" "jsonb", "p_itens" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."concluir_entrega_parcial"("p_id" bigint, "p_dados" "jsonb", "p_itens" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."limpar_pedidos"("p_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."limpar_pedidos"("p_ids" bigint[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."limpar_pedidos"("p_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_acerto"("p_vendedor" "text", "p_tipo" "text", "p_ini" "date", "p_fim" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_acerto"("p_vendedor" "text", "p_tipo" "text", "p_ini" "date", "p_fim" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_acerto"("p_vendedor" "text", "p_tipo" "text", "p_ini" "date", "p_fim" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."restringir_update_entregador"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restringir_update_entregador"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."salvar_pedido"("p_pedido" "jsonb", "p_itens" "jsonb", "p_id" bigint, "p_chave" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."salvar_pedido"("p_pedido" "jsonb", "p_itens" "jsonb", "p_id" bigint, "p_chave" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."salvar_pedido"("p_pedido" "jsonb", "p_itens" "jsonb", "p_id" bigint, "p_chave" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."salvar_produto"("p_produto" "jsonb", "p_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."salvar_produto"("p_produto" "jsonb", "p_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."salvar_produto"("p_produto" "jsonb", "p_id" bigint) TO "service_role";



GRANT ALL ON TABLE "public"."acertos_comissao" TO "service_role";
GRANT SELECT ON TABLE "public"."acertos_comissao" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."acertos_comissao_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."acertos_comissao_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."acertos_comissao_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."clientes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."clientes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."clientes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."historico_pedidos" TO "service_role";
GRANT SELECT ON TABLE "public"."historico_pedidos" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."historico_pedidos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."historico_pedidos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."historico_pedidos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."historico_precos" TO "authenticated";
GRANT ALL ON TABLE "public"."historico_precos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."historico_precos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."historico_precos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."historico_precos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."itens_pedido" TO "authenticated";
GRANT ALL ON TABLE "public"."itens_pedido" TO "service_role";



GRANT ALL ON SEQUENCE "public"."itens_pedido_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."itens_pedido_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."itens_pedido_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."produto_custos" TO "authenticated";
GRANT ALL ON TABLE "public"."produto_custos" TO "service_role";



GRANT ALL ON TABLE "public"."produtos" TO "authenticated";
GRANT ALL ON TABLE "public"."produtos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."produtos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."produtos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."produtos_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
