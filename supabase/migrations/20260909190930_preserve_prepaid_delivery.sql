create or replace function public.concluir_entrega(p_id bigint,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare pedido public.pedidos;
begin
  if coalesce(private.app_role(),'') not in ('admin','entregador') then raise exception 'Sem permissão para concluir entrega'; end if;
  select * into pedido from public.pedidos where id=p_id for update;
  -- O entregador pode ler entregues, mas a RLS só permite bloquear/alterar
  -- pendentes. Reconsulta sem bloqueio para reconhecer um envio já concluído.
  if not found then
    select * into pedido from public.pedidos where id=p_id;
    if found and pedido.status='entregue' then return to_jsonb(pedido); end if;
    raise exception 'Pedido não encontrado ou indisponível';
  end if;
  -- Repetir um envio após perder a resposta não altera a data nem o pagamento.
  if pedido.status='entregue' then return to_jsonb(pedido); end if;
  if pedido.status_pagamento is distinct from 'pago' then
    if coalesce(p_dados->>'status_pagamento','') not in ('pago','pendente','recusado') then
      raise exception 'Informe o resultado do recebimento';
    end if;
    if p_dados->>'status_pagamento'='pago' and
      (coalesce(p_dados->>'forma_pagamento_real','') not in ('dinheiro','pix') or p_dados->>'data_pagamento' is null) then
      raise exception 'Informe a forma e a data do recebimento';
    end if;
  end if;
  update public.pedidos set status='entregue',data_entregue_em=(p_dados->>'data_entregue_em')::date,
    observacao=p_dados->>'observacao',status_pagamento=p_dados->>'status_pagamento',
    forma_pagamento_real=case when p_dados->>'status_pagamento'='pago' then p_dados->>'forma_pagamento_real' end,
    data_pagamento=case when p_dados->>'status_pagamento'='pago' then (p_dados->>'data_pagamento')::date end
    where id=p_id returning * into pedido;
  if not found then raise exception 'Entrega não atualizada'; end if;
  return to_jsonb(pedido);
end; $$;

-- Concluir entrega não é estornar pagamento. OLD é a versão da linha já
-- bloqueada pelo UPDATE, inclusive se o entregador sincroniza um cache antigo.
-- Protege também clientes anteriores que atualizem a tabela diretamente.
create or replace function private.preservar_pagamento_na_entrega()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.status = 'pendente' and new.status = 'entregue'
    and old.status_pagamento = 'pago' then
    new.status_pagamento := old.status_pagamento;
    new.forma_pagamento_real := old.forma_pagamento_real;
    new.data_pagamento := old.data_pagamento;
  end if;
  return new;
end; $$;

revoke all on function private.preservar_pagamento_na_entrega() from public, anon, authenticated;
create trigger pedidos_preservar_pagamento_na_entrega
  before update on public.pedidos for each row
  execute function private.preservar_pagamento_na_entrega();
