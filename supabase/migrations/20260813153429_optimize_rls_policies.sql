create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.app_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select auth.jwt() -> 'app_metadata' ->> 'app_role' $$;

create or replace function private.app_login()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select auth.jwt() -> 'app_metadata' ->> 'app_login' $$;

revoke all on function private.app_role(), private.app_login() from public, anon;
grant execute on function private.app_role(), private.app_login() to authenticated;

drop policy if exists clientes_select on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
drop policy if exists pedidos_select on public.pedidos;
drop policy if exists pedidos_insert on public.pedidos;
drop policy if exists pedidos_update on public.pedidos;
drop policy if exists pedidos_delete on public.pedidos;
drop policy if exists itens_select on public.itens_pedido;
drop policy if exists itens_insert on public.itens_pedido;
drop policy if exists itens_delete on public.itens_pedido;
drop policy if exists produtos_select on public.produtos;
drop policy if exists produtos_admin on public.produtos;
drop policy if exists historico_admin on public.historico_precos;

create policy clientes_select on public.clientes for select to authenticated
using ((select private.app_role()) in ('admin', 'vendedor', 'entregador'));

create policy clientes_insert on public.clientes for insert to authenticated
with check ((select private.app_role()) in ('admin', 'vendedor'));

create policy clientes_update on public.clientes for update to authenticated
using ((select private.app_role()) in ('admin', 'vendedor'))
with check ((select private.app_role()) in ('admin', 'vendedor'));

create policy clientes_delete on public.clientes for delete to authenticated
using ((select private.app_role()) = 'admin');

create policy pedidos_select on public.pedidos for select to authenticated
using (
  (select private.app_role()) = 'admin'
  or ((select private.app_role()) = 'vendedor' and vendedor = (select private.app_login()))
  or (select private.app_role()) = 'entregador'
);

create policy pedidos_insert on public.pedidos for insert to authenticated
with check (
  (select private.app_role()) = 'admin'
  or (
    (select private.app_role()) = 'vendedor'
    and vendedor = (select private.app_login())
    and status = 'pendente'
  )
);

create policy pedidos_update on public.pedidos for update to authenticated
using (
  (select private.app_role()) = 'admin'
  or (
    (select private.app_role()) = 'vendedor'
    and vendedor = (select private.app_login())
    and status = 'pendente'
  )
  or ((select private.app_role()) = 'entregador' and status = 'pendente')
)
with check (
  (select private.app_role()) = 'admin'
  or (
    (select private.app_role()) = 'vendedor'
    and vendedor = (select private.app_login())
    and status = 'pendente'
  )
  or ((select private.app_role()) = 'entregador' and status = 'entregue')
);

create policy pedidos_delete on public.pedidos for delete to authenticated
using (
  (select private.app_role()) = 'admin'
  or (
    (select private.app_role()) = 'vendedor'
    and vendedor = (select private.app_login())
    and status = 'pendente'
  )
);

create policy itens_select on public.itens_pedido for select to authenticated
using (exists (
  select 1 from public.pedidos where pedidos.id = itens_pedido.pedido_id
));

create policy itens_insert on public.itens_pedido for insert to authenticated
with check (
  (select private.app_role()) = 'admin'
  or exists (
    select 1 from public.pedidos
    where pedidos.id = itens_pedido.pedido_id
      and pedidos.status = 'pendente'
      and pedidos.vendedor = (select private.app_login())
  )
);

create policy itens_delete on public.itens_pedido for delete to authenticated
using (
  (select private.app_role()) = 'admin'
  or exists (
    select 1 from public.pedidos
    where pedidos.id = itens_pedido.pedido_id
      and pedidos.status = 'pendente'
      and pedidos.vendedor = (select private.app_login())
  )
);

create policy produtos_select on public.produtos for select to authenticated
using ((select private.app_role()) in ('admin', 'vendedor'));

create policy produtos_insert on public.produtos for insert to authenticated
with check ((select private.app_role()) = 'admin');

create policy produtos_update on public.produtos for update to authenticated
using ((select private.app_role()) = 'admin')
with check ((select private.app_role()) = 'admin');

create policy produtos_delete on public.produtos for delete to authenticated
using ((select private.app_role()) = 'admin');

create policy historico_admin on public.historico_precos for all to authenticated
using ((select private.app_role()) = 'admin')
with check ((select private.app_role()) = 'admin');

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
      or new.descricao is distinct from old.descricao
      or new.valor is distinct from old.valor
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
