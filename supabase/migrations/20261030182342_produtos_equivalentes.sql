alter table public.produtos
  add column produto_principal_id bigint references public.produtos(id),
  add constraint produtos_principal_diferente check (produto_principal_id is null or produto_principal_id <> id);

create index produtos_principal_id_idx on public.produtos (produto_principal_id) where produto_principal_id is not null;
