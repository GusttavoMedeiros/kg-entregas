const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const helpers = fs.readFileSync('entregador-db.test.cjs', 'utf8').split("test('Postgres:")[0];
const { bancoAtual, pedidos, quem, dados, completa, parcial, hojeBrasil, linha, lerMigration, fatia, NOVA } =
  new Function('require', helpers + '\nreturn { bancoAtual, pedidos, quem, dados, completa, parcial, hojeBrasil, linha, lerMigration, fatia, NOVA };')(require);

async function preparar() {
  const db = await bancoAtual();
  await db.exec('create table public.produtos (id bigint primary key, nome text, preco numeric); grant select on public.produtos to authenticated;');
  const rls = lerMigration('20260813153543_optimize_rls_policies.sql');
  for (const p of ['itens_insert', 'itens_delete']) await db.exec(fatia(rls, 'create policy ' + p, ';'));
  await db.exec('grant usage, select on all sequences in schema public to authenticated');
  await db.exec(lerMigration(NOVA));
  await db.exec(lerMigration('../tests/fixtures/20261030165247_conflitos_pedidos.sql'));
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


test('migração conserva pedidos e itens existentes', async () => {
  const db = await bancoAtual();
  try {
    await db.exec('create table public.produtos (id bigint primary key, nome text, preco numeric)');
    await db.exec(lerMigration(NOVA));
    await pedidos(db);
    const antes = (await db.query('select id, cliente_id, descricao, valor, status, vendedor from public.pedidos order by id')).rows;
    const itens = (await db.query('select * from public.itens_pedido order by id')).rows;
    await db.exec(lerMigration('../tests/fixtures/20261030165247_conflitos_pedidos.sql'));
    assert.deepEqual((await db.query('select id, cliente_id, descricao, valor, status, vendedor from public.pedidos order by id')).rows, antes);
    assert.deepEqual((await db.query('select * from public.itens_pedido order by id')).rows, itens);
    assert.ok((await db.query('select versao from public.pedidos')).rows.every(p => Number(p.versao) === 1));
  } finally { await db.close(); }
});


test('peso: migração preserva pedidos e peso do item não muda ao editar o produto', async () => {
  const db = await preparar();
  try {
    await db.exec(`alter table public.produtos add column categoria text;
      create table public.produto_custos (produto_id bigint primary key, preco_custo numeric);
      create table public.historico_precos (produto_id bigint, preco_venda numeric, preco_custo numeric, alterado_por text);
      grant select, insert, update on public.produtos, public.produto_custos, public.historico_precos to authenticated;
      insert into public.produtos(id,nome,preco) values (1,'Milho',10)`);
    const antes = (await db.query('select id, descricao, valor, status from public.pedidos order by id')).rows;
    await db.exec(lerMigration('../tests/fixtures/20261030170027_peso_pedido.sql'));
    assert.deepEqual((await db.query('select id, descricao, valor, status from public.pedidos order by id')).rows, antes);
    assert.ok((await db.query('select peso_unitario_kg from public.itens_pedido')).rows.every(i => i.peso_unitario_kg === null));
    await quem(db, 'admin');
    const produto = {nome:'Milho', categoria:'Agropecuário', preco:10, preco_custo:null, peso_kg:15};
    await db.query('select public.salvar_produto($1::jsonb,1)', [JSON.stringify(produto)]);
    const pedido = { cliente_id: 1, data_entrega: '2026-11-01', forma_pagamento: 'avista', versao: 1 };
    const itens = [{produto_id:1,qtd:2,preco_unit:10}];
    const r = await db.query('select public.salvar_pedido($1::jsonb,$2::jsonb,1,null) r', [JSON.stringify(pedido), JSON.stringify(itens)]);
    assert.equal(Number(r.rows[0].r.itens[0].peso_unitario_kg), 15);
    produto.peso_kg = 20;
    await db.query('select public.salvar_produto($1::jsonb,1)', [JSON.stringify(produto)]);
    assert.equal(Number((await db.query('select peso_unitario_kg from public.itens_pedido where pedido_id=1')).rows[0].peso_unitario_kg), 15);
    produto.peso_kg = -1;
    await assert.rejects(db.query('select public.salvar_produto($1::jsonb,1)', [JSON.stringify(produto)]), /Peso inválido/);
  } finally { await db.close(); }
});
