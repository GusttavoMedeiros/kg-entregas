-- Mudanças feitas por outra aba ou aparelho chegam ao cliente sem polling.
do $$
declare tabela text;
begin
  foreach tabela in array array['pedidos','clientes','produtos','produto_custos'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end; $$;

-- O reset apaga somente os IDs mostrados nas duas confirmações. Um pedido
-- criado simultaneamente em outro aparelho não entra por acidente no DELETE.
create or replace function public.limpar_pedidos(p_ids bigint[])
returns integer language plpgsql security invoker set search_path = '' as $$
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

revoke all on function public.limpar_pedidos(bigint[]) from public, anon;
grant execute on function public.limpar_pedidos(bigint[]) to authenticated;

-- Há cadastros legados repetidos, que permanecem intocados. Para novas
-- inclusões ou troca de documento, a trava evita que duas sessões cadastrem o
-- mesmo CPF/CNPJ ao mesmo tempo.
create or replace function private.impedir_cliente_duplicado()
returns trigger language plpgsql security invoker set search_path = '' as $$
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

revoke all on function private.impedir_cliente_duplicado() from public, anon, authenticated;
create trigger clientes_impedir_duplicado
  before insert or update of cnpj_cpf on public.clientes
  for each row execute function private.impedir_cliente_duplicado();
