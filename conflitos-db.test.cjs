const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const helpers = fs.readFileSync('entregador-db.test.cjs', 'utf8').split("test('Postgres:")[0];
const { bancoAtual, pedidos, quem, dados, completa, parcial, hojeBrasil, linha, lerMigration, fatia, NOVA } =
  new Function('require', helpers + '\nreturn { bancoAtual, pedidos, quem, dados, completa, parcial, hojeBrasil, linha, lerMigration, fatia, NOVA };')(require);

async function preparar() {
  const db = await bancoAtual();
  await db.exec('create table public.produtos (id bigint primary key, nome text, preco numeric); grant select on public.produtos to authenticated;');
  const rls = lerMigration('20260813153429_optimize_rls_policies.sql');
  for (const p of ['itens_insert', 'itens_delete']) await db.exec(fatia(rls, 'create policy ' + p, ';'));
  await db.exec('grant usage, select on all sequences in schema public to authenticated');
  await db.exec(lerMigration(NOVA));
  await db.exec(lerMigration('20261030165247_conflitos_pedidos.sql'));
  await pedidos(db);
  return db;
}
const a = 'e6c55c54-3769-4e88-a1a9-875dc07a4e1a';
const b = 'e6c55c54-3769-4e88-a1a9-875dc07a4e1b';

test('entrega: repetição confirmada, conflito preservado e ação antiga após desfazer recusada', async () => {
  const db = await preparar();
  try {
    const hoje = await hojeBrasil(db);
    const original = dados(hoje, { acao_id: a, versao: 1 });
    await quem(db, 'entregador');
    assert.equal((await completa(db, 1, original)).rows[0].r.versao, 2);
    assert.equal((await completa(db, 1, original)).rows[0].r.acao_entrega, a);
    await assert.rejects(completa(db, 1, dados(hoje, { acao_id: b, versao: 1 })), /indisponível|Conflito/);
    await assert.rejects(parcial(db, 1, dados(hoje, { acao_id: b, versao: 1 }), []), /Conflito/);
    await quem(db, 'admin');
    await db.exec("update public.pedidos set status='pendente' where id=1");
    await quem(db, 'entregador');
    await assert.rejects(completa(db, 1, original), /Conflito/);
    await assert.rejects(completa(db, 1, dados(hoje, {})), /sem identificação ou versão/);
    assert.equal((await linha(db, 1)).status, 'pendente');
  } finally { await db.close(); }
});

test('edição: a segunda cópia antiga é recusada sem substituir a primeira', async () => {
  const db = await preparar();
  try {
    await db.exec("insert into public.produtos values (1,'Milho',10)");
    await quem(db, 'admin');
    const pedido = { cliente_id: 1, data_entrega: '2026-11-01', forma_pagamento: 'avista', versao: 1 };
    const itens = [{ produto_id: 1, qtd: 1, preco_unit: 10 }];
    const salvar = p => db.query('select public.salvar_pedido($1::jsonb,$2::jsonb,1,null) r', [JSON.stringify(p), JSON.stringify(itens)]);
    assert.equal((await salvar(pedido)).rows[0].r.versao, 2);
    await assert.rejects(salvar(pedido), /Conflito/);
    assert.equal(Number((await linha(db, 1)).valor), 10);
  } finally { await db.close(); }
});



test('entrega parcial aceita repetição da mesma ação e recusa outra', async () => {
  const db = await preparar();
  try {
    const ids = (await db.query('select id from public.itens_pedido where pedido_id=1 order by id')).rows.map(r => r.id);
    const hoje = await hojeBrasil(db);
    const payload = dados(hoje, { acao_id: a, versao: 1 });
    const itens = [{ id: ids[0], qtd_entregue: 8 }, { id: ids[1], qtd_entregue: 0 }];
    await quem(db, 'entregador');
    assert.equal(Number((await parcial(db, 1, payload, itens)).rows[0].r.valor), 80);
    assert.equal(Number((await parcial(db, 1, payload, itens)).rows[0].r.valor), 80);
    await assert.rejects(parcial(db, 1, dados(hoje, { acao_id: b, versao: 1 }), itens), /Conflito/);
  } finally { await db.close(); }
});
