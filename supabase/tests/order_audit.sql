begin;

insert into public.clientes (id, nome)
values (-910001, 'Cliente teste auditoria');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"app_role":"vendedor","app_login":"vendedor"}}',
  true
);

insert into public.pedidos (id, cliente_id, descricao, valor, status, vendedor)
values (-910001, -910001, 'Pedido inicial', 10, 'pendente', 'vendedor');

update public.pedidos
set descricao = 'Pedido editado', valor = 12
where id = -910001;

do $$
begin
  if (select count(*) from public.historico_pedidos where pedido_id = -910001) <> 2 then
    raise exception 'vendedor deveria ver criação e edição';
  end if;

  if not exists (
    select 1 from public.historico_pedidos
    where pedido_id = -910001
      and acao = 'editado'
      and alterado_por = 'vendedor'
      and campos @> array['descricao', 'valor']
  ) then
    raise exception 'edição não foi auditada corretamente';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"app_role":"entregador","app_login":"entregador"}}',
  true
);

update public.pedidos
set status = 'entregue'
where id = -910001;

do $$
begin
  if (select count(*) from public.historico_pedidos where pedido_id = -910001) <> 0 then
    raise exception 'entregador não deveria consultar auditoria';
  end if;
end
$$;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"app_role":"vendedor","app_login":"vendedor"}}',
  true
);

do $$
begin
  if not exists (
    select 1 from public.historico_pedidos
    where pedido_id = -910001
      and acao = 'entregue'
      and alterado_por = 'entregador'
      and campos @> array['status']
  ) then
    raise exception 'entrega não foi auditada corretamente';
  end if;
end
$$;

rollback;
