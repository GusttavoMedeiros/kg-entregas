-- Papéis confiáveis: somente administradores do Supabase alteram app_metadata.
update auth.users
set raw_app_meta_data = raw_app_meta_data ||
  case email
    when 'admin@kgagropet.local' then '{"app_role":"admin","app_login":"admin","app_name":"Kleber"}'::jsonb
    when 'vendedor@kgagropet.local' then '{"app_role":"vendedor","app_login":"vendedor","app_name":"Vendedor"}'::jsonb
    when 'entregador@kgagropet.local' then '{"app_role":"entregador","app_login":"entregador","app_name":"Entregador"}'::jsonb
  end
where email in (
  'admin@kgagropet.local',
  'vendedor@kgagropet.local',
  'entregador@kgagropet.local'
);

-- A chave pública identifica o projeto; sem login não há acesso às tabelas.
revoke all on table public.clientes, public.pedidos, public.itens_pedido,
  public.produtos, public.historico_precos from anon;

grant select, insert, update, delete on table public.clientes, public.pedidos,
  public.itens_pedido, public.produtos, public.historico_precos to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Remove a política antiga que dava acesso total a qualquer usuário logado.
drop policy if exists app_interno_autenticado on public.clientes;
drop policy if exists app_interno_autenticado on public.pedidos;
drop policy if exists app_interno_autenticado on public.itens_pedido;
drop policy if exists app_interno_autenticado on public.produtos;
drop policy if exists app_interno_autenticado on public.historico_precos;

-- Clientes: vendedor cadastra/edita; entregador usa endereço e contato nas rotas.
create policy clientes_select on public.clientes for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') in ('admin', 'vendedor', 'entregador')
);

create policy clientes_insert on public.clientes for insert to authenticated
with check ((select auth.jwt() -> 'app_metadata' ->> 'app_role') in ('admin', 'vendedor'));

create policy clientes_update on public.clientes for update to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'app_role') in ('admin', 'vendedor'))
with check ((select auth.jwt() -> 'app_metadata' ->> 'app_role') in ('admin', 'vendedor'));

create policy clientes_delete on public.clientes for delete to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin');

-- Pedidos: vendedor só acessa os próprios; entregador só recebe os pendentes.
create policy pedidos_select on public.pedidos for select to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'vendedor'
    and vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
  )
  or (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'entregador'
);

create policy pedidos_insert on public.pedidos for insert to authenticated
with check (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'vendedor'
    and vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
    and status = 'pendente'
  )
);

create policy pedidos_update on public.pedidos for update to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'vendedor'
    and vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
    and status = 'pendente'
  )
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'entregador'
    and status = 'pendente'
  )
)
with check (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'vendedor'
    and vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
    and status = 'pendente'
  )
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'entregador'
    and status = 'entregue'
  )
);

create policy pedidos_delete on public.pedidos for delete to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or (
    (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'vendedor'
    and vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
    and status = 'pendente'
  )
);

-- Itens seguem o acesso do pedido pai.
create policy itens_select on public.itens_pedido for select to authenticated
using (exists (
  select 1 from public.pedidos where pedidos.id = itens_pedido.pedido_id
));

create policy itens_insert on public.itens_pedido for insert to authenticated
with check (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or exists (
    select 1 from public.pedidos
    where pedidos.id = itens_pedido.pedido_id
      and pedidos.status = 'pendente'
      and pedidos.vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
  )
);

create policy itens_delete on public.itens_pedido for delete to authenticated
using (
  (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin'
  or exists (
    select 1 from public.pedidos
    where pedidos.id = itens_pedido.pedido_id
      and pedidos.status = 'pendente'
      and pedidos.vendedor = (select auth.jwt() -> 'app_metadata' ->> 'app_login')
  )
);

-- Catálogo é leitura para vendas; custos e histórico ficam com o admin.
create policy produtos_select on public.produtos for select to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'app_role') in ('admin', 'vendedor'));

create policy produtos_admin on public.produtos for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin');

create policy historico_admin on public.historico_precos for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'admin');

-- RLS decide quais linhas; este gatilho impede o entregador de trocar outros campos.
create or replace function public.restringir_update_entregador()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.jwt() -> 'app_metadata' ->> 'app_role') = 'entregador' then
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

drop trigger if exists pedidos_restringir_update_entregador on public.pedidos;
create trigger pedidos_restringir_update_entregador
before update on public.pedidos
for each row execute function public.restringir_update_entregador();

revoke all on function public.restringir_update_entregador() from public, anon, authenticated;

-- Regras simples que evitam estados impossíveis mesmo fora da interface.
alter table public.clientes
  add constraint clientes_tipo_pessoa_check
  check (tipo_pessoa is null or tipo_pessoa in ('fisica', 'juridica'));

alter table public.pedidos
  add constraint pedidos_valor_check check (valor is null or valor >= 0),
  add constraint pedidos_status_check check (status in ('pendente', 'entregue')),
  add constraint pedidos_forma_pagamento_check
    check (forma_pagamento is null or forma_pagamento in ('avista', 'boleto', 'cheque')),
  add constraint pedidos_status_pagamento_check
    check (status_pagamento is null or status_pagamento in ('pago', 'pendente', 'recusado')),
  add constraint pedidos_forma_pagamento_real_check
    check (forma_pagamento_real is null or forma_pagamento_real in ('dinheiro', 'pix')),
  add constraint pedidos_prazo_dias_check check (prazo_dias is null or prazo_dias >= 0);

alter table public.produtos
  add constraint produtos_preco_check check (preco >= 0),
  add constraint produtos_preco_custo_check check (preco_custo is null or preco_custo >= 0);

alter table public.itens_pedido
  add constraint itens_qtd_check check (qtd > 0),
  add constraint itens_preco_unit_check check (preco_unit >= 0),
  add constraint itens_preco_catalogo_check
    check (preco_catalogo is null or preco_catalogo >= 0);

alter table public.historico_precos
  add constraint historico_preco_venda_check
    check (preco_venda is null or preco_venda >= 0),
  add constraint historico_preco_custo_check
    check (preco_custo is null or preco_custo >= 0);

create index if not exists pedidos_cliente_id_idx on public.pedidos (cliente_id);
create index if not exists itens_pedido_pedido_id_idx on public.itens_pedido (pedido_id);
create index if not exists itens_pedido_produto_id_idx on public.itens_pedido (produto_id);
