alter table public.pedidos
  add column if not exists data_entregue_em date;

comment on column public.pedidos.data_entregue_em is
  'Data civil em que o pedido foi efetivamente marcado como entregue.';

-- A interface envia a data capturada no momento da entrega para manter o fluxo
-- offline correto. O gatilho fornece um fallback no fuso do Brasil e impede que
-- uma edição comum de um pedido já entregue altere a data original.
create or replace function private.definir_data_entrega_real()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
    -- Em uma nova entrega, aceita a data capturada offline pelo aplicativo.
    -- Se ela não veio (ou é apenas a data preservada de uma entrega revertida),
    -- registra o dia atual no Brasil.
    if new.data_entregue_em is null
      or new.data_entregue_em is not distinct from old.data_entregue_em
    then
      new.data_entregue_em := hoje_brasil;
    end if;
  else
    -- Reversões preservam o registro anterior; edições normais não o reescrevem.
    new.data_entregue_em := old.data_entregue_em;
  end if;

  return new;
end;
$$;

revoke all on function private.definir_data_entrega_real() from public, anon, authenticated;

drop trigger if exists pedidos_definir_data_entrega_real on public.pedidos;
create trigger pedidos_definir_data_entrega_real
before insert or update on public.pedidos
for each row execute function private.definir_data_entrega_real();
