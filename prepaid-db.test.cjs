// PostgreSQL embutido em memória: nunca se conecta ao Supabase/produção.
// Dependência de teste: @electric-sql/pglite@0.3.14, resolvida via NODE_PATH.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('Postgres: pagamento antecipado preservado em RPC, retry e UPDATE direto', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema private;
      create function private.app_role() returns text language sql as
        $$ select current_setting('qa.role', true) $$;
      create function private.app_login() returns text language sql as
        $$ select current_setting('qa.role', true) $$;
      select set_config('qa.role','admin',false);
      create table public.pedidos (
        id bigint primary key, status text, status_pagamento text,
        data_entregue_em date, observacao text, forma_pagamento_real text, data_pagamento date, vendedor text
      );
      insert into pedidos values (1,'pendente','pago',null,null,'pix','2026-09-01','vendedor');
    `);
    const anterior = fs.readFileSync('supabase/migrations/20260908154035_atomic_orders_and_restricted_costs.sql', 'utf8');
    const inicio = anterior.indexOf('create or replace function public.concluir_entrega(');
    await db.exec(anterior.slice(inicio, anterior.indexOf('end; $$;', inicio) + 'end; $$;'.length));
    const payload = { status_pagamento: 'pendente', data_entregue_em: '2026-09-09' };
    let resposta = await db.query('select concluir_entrega(1,$1::jsonb) as pedido', [JSON.stringify(payload)]);
    assert.equal(resposta.rows[0].pedido.status_pagamento, 'pendente', 'Reproduz a falha anterior');

    await db.exec(fs.readFileSync('supabase/migrations/20260909185425_preserve_prepaid_delivery.sql', 'utf8'));
    const rls = fs.readFileSync('supabase/migrations/20260813153429_optimize_rls_policies.sql', 'utf8');
    for (const policy of ['pedidos_select', 'pedidos_update']) {
      const start = rls.indexOf('create policy ' + policy);
      await db.exec(rls.slice(start, rls.indexOf(';', start) + 1));
    }
    await db.exec('alter table pedidos enable row level security; grant usage on schema private to authenticated; grant select,update on pedidos to authenticated;');
    for (const role of ['admin', 'entregador']) {
      await db.query("select set_config('qa.role',$1,false)", [role]);
      for (const status of ['pendente', 'recusado', 'pago']) {
        await db.exec("reset role; update pedidos set status='pendente',status_pagamento='pago',forma_pagamento_real='pix',data_pagamento='2026-09-01' where id=1; set role authenticated;");
        resposta = await db.query('select concluir_entrega(1,$1::jsonb) as pedido', [JSON.stringify({ ...payload, status_pagamento: status })]);
        const pedido = resposta.rows[0].pedido;
        assert.equal(pedido.status, 'entregue');
        assert.equal(pedido.status_pagamento, 'pago');
        assert.equal(pedido.forma_pagamento_real, 'pix');
        assert.equal(pedido.data_pagamento, '2026-09-01');
        resposta = await db.query('select concluir_entrega(1,$1::jsonb) as pedido', [JSON.stringify({ ...payload, data_entregue_em: '2026-09-10' })]);
        assert.equal(resposta.rows[0].pedido.data_entregue_em, '2026-09-09');
      }
    }
    await db.exec("reset role; update pedidos set status='pendente' where id=1; set role authenticated; update pedidos set status='entregue',status_pagamento='recusado',forma_pagamento_real=null,data_pagamento=null where id=1;");
    assert.equal((await db.query('select status_pagamento from pedidos')).rows[0].status_pagamento, 'pago');
    // Pedido que ainda não foi pago continua aceitando recebimento na entrega.
    await db.exec("reset role; update pedidos set status='pendente',status_pagamento='pendente',forma_pagamento_real=null,data_pagamento=null where id=1; set role authenticated;");
    await assert.rejects(db.query('select concluir_entrega(1,$1::jsonb)', [JSON.stringify({ ...payload, status_pagamento: 'pago' })]), /forma e a data/);
    resposta = await db.query('select concluir_entrega(1,$1::jsonb) as pedido', [JSON.stringify({ ...payload, status_pagamento: 'pago', forma_pagamento_real: 'dinheiro', data_pagamento: '2026-09-09' })]);
    assert.equal(resposta.rows[0].pedido.data_pagamento, '2026-09-09');
    await db.exec("select set_config('qa.role','vendedor',false)");
    await assert.rejects(db.query('select concluir_entrega(1,$1::jsonb)', [JSON.stringify(payload)]), /Sem permissão/);
  } finally { await db.close(); }
});
