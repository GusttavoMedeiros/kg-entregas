drop policy "admin consulta historico de pedidos" on public.historico_pedidos;
drop policy "vendedor consulta historico dos proprios pedidos" on public.historico_pedidos;

create policy "usuarios autorizados consultam historico de pedidos"
on public.historico_pedidos for select
to authenticated
using (
  (select private.app_role()) = 'admin'
  or (
    (select private.app_role()) = 'vendedor'
    and exists (
      select 1
      from public.pedidos
      where pedidos.id = historico_pedidos.pedido_id
        and pedidos.vendedor = (select private.app_login())
    )
  )
);
