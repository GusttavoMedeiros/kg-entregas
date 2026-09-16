-- Somente em banco de teste já migrado. Tudo é revertido ao terminar.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/robustez.sql
begin;
insert into public.clientes(id,nome) values(-910001,'Cliente fictício robustez');
insert into public.produtos(id,nome,preco) values
  (-910001,'Produto fictício',100),(-910002,'Produto falha simulada',50);
insert into public.produto_custos values(-910001,60);

-- Falha durante a inserção: deve reverter cabeçalho, itens e auditoria.
create function pg_temp.falhar_item() returns trigger language plpgsql as $$
begin
  if new.produto_id=-910002 then raise exception 'falha simulada item'; end if;
  return new;
end; $$;
create trigger falhar_item_teste before insert on public.itens_pedido
  for each row execute function pg_temp.falhar_item();
create function pg_temp.falhar_historico() returns trigger language plpgsql as $$
begin
  if new.preco_venda=123 then raise exception 'falha simulada histórico'; end if;
  return new;
end; $$;
create trigger falhar_historico_teste before insert on public.historico_precos
  for each row execute function pg_temp.falhar_historico();

set local role authenticated;
select set_config('request.jwt.claims','{"app_metadata":{"app_role":"vendedor","app_login":"vendedor"}}',true);
do $$
declare
  dados jsonb := jsonb_build_object('cliente_id',-910001,'data_entrega',
    (statement_timestamp() at time zone 'America/Sao_Paulo')::date,'forma_pagamento','avista');
  itens jsonb := '[{"produto_id":-910001,"qtd":2,"preco_unit":90,"preco_catalogo":1}]';
  salvo jsonb; repetido jsonb; pid bigint; n bigint; antes jsonb; entregue jsonb; invalido jsonb;
begin
  if exists(select 1 from public.produto_custos) then raise exception 'Vendedor leu custos'; end if;
  if not exists(select 1 from public.produtos where id=-910001) then raise exception 'Catálogo inacessível'; end if;
  salvo := public.salvar_pedido(dados,itens,null,'00000000-0000-4000-8000-000000910001');
  pid := (salvo->>'id')::bigint;
  if (salvo->>'valor')::numeric<>180 or salvo->>'vendedor'<>'vendedor'
    or (salvo->'itens'->0->>'preco_catalogo')::numeric<>100 then
    raise exception 'Total, autor ou preço original incorreto';
  end if;
  repetido := public.salvar_pedido(dados,itens,null,'00000000-0000-4000-8000-000000910001');
  if (repetido->>'id')::bigint<>pid then raise exception 'Tentativa duplicou pedido'; end if;
  for invalido in select value from jsonb_array_elements('[
    [{"produto_id":-910001,"qtd":0,"preco_unit":10}],
    [{"produto_id":-910001,"qtd":1.5,"preco_unit":10}],
    [{"produto_id":-910001,"qtd":1,"preco_unit":-1}],
    [{"produto_id":-910001,"qtd":1,"preco_unit":"NaN"}]
  ]') loop
    begin
      perform public.salvar_pedido(dados,invalido,pid);
      raise exception 'Item inválido aceito';
    exception when raise_exception then
      if sqlerrm not in ('Quantidade ou preço inválido','Quantidade deve ser inteira') then raise; end if;
    end;
  end loop;

  select count(*) into n from public.pedidos;
  begin
    perform public.salvar_pedido(dados,itens || '[{"produto_id":-910002,"qtd":1,"preco_unit":50}]',
      null,'00000000-0000-4000-8000-000000910002');
    raise exception 'Criação parcial aceita';
  exception when raise_exception then if sqlerrm<>'falha simulada item' then raise; end if; end;
  if (select count(*) from public.pedidos)<>n then raise exception 'Sobrou cabeçalho parcial'; end if;
  select to_jsonb(p) into antes from public.pedidos p where id=pid;
  begin
    perform public.salvar_pedido(dados || '{"observacao":"não persistir"}',
      itens || '[{"produto_id":-910002,"qtd":1,"preco_unit":50}]',pid);
    raise exception 'Edição parcial aceita';
  exception when raise_exception then if sqlerrm<>'falha simulada item' then raise; end if; end;
  if (select to_jsonb(p) from public.pedidos p where id=pid)<>antes
    or (select count(*) from public.itens_pedido where pedido_id=pid)<>1 then
    raise exception 'Edição com falha alterou dados';
  end if;
  salvo := public.salvar_pedido(dados,'[{"produto_id":-910001,"qtd":1,"preco_unit":0}]',pid);
  if (salvo->>'valor')::numeric<>0 then raise exception 'Preço zero foi perdido'; end if;
  begin
    update public.pedidos set status_pagamento='pago' where id=pid;
    raise exception 'Vendedor alterou recebimento';
  exception when raise_exception then
    if sqlerrm<>'Vendedor não pode alterar recebimentos ou entregas' then raise; end if;
  end;
  begin
    perform public.salvar_produto('{"nome":"Proibido","preco":10}');
    raise exception 'Vendedor criou produto';
  exception when raise_exception then
    if sqlerrm<>'Somente administrador pode alterar produtos' then raise; end if;
  end;
  begin
    update public.pedidos set valor=999 where id=pid;
    set constraints all immediate;
    raise exception 'Total divergente aceito';
  exception when raise_exception then
    if sqlerrm<>'Pedido deve conter itens e total igual à soma dos itens' then raise; end if;
  end;

  perform set_config('request.jwt.claims','{"app_metadata":{"app_role":"admin","app_login":"admin"}}',true);
  if (select preco_custo from public.produto_custos where produto_id=-910001)<>60 then
    raise exception 'Admin não leu custo'; end if;
  begin
    perform public.salvar_produto('{"nome":"Alterado","preco":123,"categoria":"Outros","preco_custo":80}',-910001);
    raise exception 'Produto sem histórico aceito';
  exception when raise_exception then if sqlerrm<>'falha simulada histórico' then raise; end if; end;
  if (select preco from public.produtos where id=-910001)<>100
    or (select preco_custo from public.produto_custos where produto_id=-910001)<>60 then
    raise exception 'Falha de histórico não reverteu preço/custo'; end if;
  perform public.salvar_produto('{"nome":"Produto fictício","preco":110,"categoria":"Outros","preco_custo":70}',-910001);
  if (select count(*) from public.historico_precos where produto_id=-910001)<>1 then
    raise exception 'Histórico ausente ou duplicado'; end if;
  perform public.salvar_produto('{"nome":"Produto fictício","preco":110,"categoria":"Outros","preco_custo":70}',-910001);
  if (select count(*) from public.historico_precos where produto_id=-910001)<>1 then
    raise exception 'Repetição gerou histórico duplicado'; end if;

  perform set_config('request.jwt.claims','{"app_metadata":{"app_role":"entregador","app_login":"entregador"}}',true);
  if exists(select 1 from public.produto_custos) then raise exception 'Entregador leu custos'; end if;
  begin
    perform public.concluir_entrega(pid,jsonb_build_object('status_pagamento','pendente',
      'data_entregue_em',current_date+2));
    raise exception 'Entrega futura aceita';
  exception when raise_exception then if sqlerrm<>'Data da entrega não pode estar no futuro' then raise; end if; end;
  entregue := public.concluir_entrega(pid,jsonb_build_object('status_pagamento','pendente',
    'data_entregue_em',current_date-1));
  repetido := public.concluir_entrega(pid,jsonb_build_object('status_pagamento','recusado','data_entregue_em',current_date));
  if repetido<>entregue then raise exception 'Reenvio modificou entrega concluída'; end if;
  if entregue->>'status'<>'entregue' then raise exception 'Entrega não concluída'; end if;

  perform set_config('request.jwt.claims','{"app_metadata":{"app_role":"admin","app_login":"admin"}}',true);
  delete from public.pedidos where id=pid;
  if exists(select 1 from public.itens_pedido where pedido_id=pid) then raise exception 'Exclusão deixou itens órfãos'; end if;
end; $$;
set constraints all immediate;
do $$ begin
  if has_function_privilege('anon','public.salvar_pedido(jsonb,jsonb,bigint,uuid)','execute')
    or has_function_privilege('anon','public.salvar_produto(jsonb,bigint)','execute')
    or has_function_privilege('anon','public.concluir_entrega(bigint,jsonb)','execute') then
    raise exception 'Usuário anônimo pode executar operações';
  end if;
end; $$;
rollback;
