-- Execute com: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authorization.sql
begin;

insert into public.clientes (id, nome) values (-900001, 'Cliente de teste');
insert into public.pedidos (id, cliente_id, descricao, valor, status, vendedor)
values
  (-900001, -900001, 'Pedido admin', 10, 'pendente', 'admin'),
  (-900002, -900001, 'Pedido vendedor', 10, 'pendente', 'vendedor');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"app_role":"vendedor","app_login":"vendedor"}}',
  true
);

-- Vendedor enxerga e altera apenas o próprio pedido.
select 1 / case when count(*) = 1 then 1 else 0 end
from public.pedidos where id in (-900001, -900002);

with alterados as (
  update public.pedidos set observacao = 'não permitido'
  where id = -900001 returning 1
)
select 1 / case when count(*) = 0 then 1 else 0 end from alterados;

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","app_metadata":{"app_role":"entregador","app_login":"entregador"}}',
  true
);

-- Entregador não consegue alterar preço ou demais dados comerciais.
do $$
begin
  begin
    update public.pedidos set valor = 999, status = 'entregue' where id = -900001;
    raise exception 'update comercial foi aceito';
  exception when raise_exception then
    if sqlerrm <> 'entregador só pode concluir uma entrega' then
      raise;
    end if;
  end;
end;
$$;

-- A conclusão normal da entrega continua permitida.
with alterados as (
  update public.pedidos
  set status = 'entregue', status_pagamento = 'pago',
      forma_pagamento_real = 'pix', data_pagamento = current_date
  where id = -900001 returning 1
)
select 1 / case when count(*) = 1 then 1 else 0 end from alterados;

rollback;
