const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

// Observação com limite no banco (PGlite em memória, nunca produção) e lista de
// Entregas em lotes com "Ver mais".
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('Banco: observação acima de 1000 caracteres é recusada em pedidos e clientes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.pedidos (id bigint primary key, observacao text);
      create table public.clientes (id bigint primary key, observacao text);
      insert into public.pedidos values (1, 'ok'), (2, null);
      insert into public.clientes values (1, repeat('x', 45));
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20261008120000_limite_observacao.sql', 'utf8'));
    await db.exec(`insert into public.pedidos values (3, repeat('é', 1000)), (4, ''), (5, null)`);
    await db.exec(`insert into public.clientes values (2, repeat('é', 1000))`);
    for (const tabela of ['pedidos', 'clientes']) {
      await assert.rejects(db.exec(`insert into public.${tabela} values (99, repeat('x', 1001))`), /check/i);
      await assert.rejects(db.exec(`update public.${tabela} set observacao = repeat('x', 1000000) where id = 1`), /check/i);
    }
  } finally { await db.close(); }
});

test('Campos de observação do app têm maxlength de 1000', () => {
  for (const id of ['pedido-obs', 'cliente-observacao', 'entrega-obs'])
    assert.match(html, new RegExp(`<textarea id="${id}" maxlength="1000"`));
});

function montar(perfil, pedidos) {
  const el = { innerHTML: '' };
  const c = {
    usuario: { perfil }, todosOsPedidos: pedidos, todosOsClientes: [], modoEntregas: 'lista', filtroEntregas: 'pendente',
    document: { getElementById: id => (id === 'lista-entregas' ? el : null) },
    isEntregaAtrasada: () => false, cardEntrega: p => `<i data-id="${p.id}"></i>`, esc: s => s, fmt: () => '', moeda: v => v,
    window: { scrollY: 0, scrollTo() {} },
  };
  vm.createContext(c);
  vm.runInContext(trecho('function renderizarEntregas', '// Endereço salvo'), c);
  vm.runInContext('globalThis.renderizarEntregas = renderizarEntregas; globalThis.verMaisEntregas = verMaisEntregas;', c);
  return { c, el, ids: () => [...el.innerHTML.matchAll(/data-id="(\d+)"/g)].map(m => Number(m[1])) };
}
const gerar = (n, status) => Array.from({ length: n }, (_, i) => ({ id: i + 1, status, data_entrega: `2026-0${1 + (i % 9)}-${10 + (i % 18)}` }));

test('Admin: 100 entregas aparecem em lotes de 30 e "Ver mais" mostra o resto', () => {
  const m = montar('admin', gerar(100, 'pendente'));
  m.c.renderizarEntregas('pendente');
  assert.equal(m.ids().length, 30);
  assert.match(m.el.innerHTML, /Ver mais 30/);
  assert.match(m.el.innerHTML, /70 restantes/);
  m.c.verMaisEntregas(); m.c.verMaisEntregas();
  assert.equal(m.ids().length, 90);
  m.c.verMaisEntregas();
  assert.equal(m.ids().length, 100);
  assert.doesNotMatch(m.el.innerHTML, /btn-ver-mais/);
  assert.match(m.el.innerHTML, /Todas as 100 entregas exibidas/);
});

test('Admin: pendentes vêm antes das entregues, e entregues da mais recente para a mais antiga', () => {
  const ped = [
    { id: 1, status: 'entregue', data_entrega: '2026-01-01' },
    { id: 2, status: 'entregue', data_entrega: '2026-03-01' },
    { id: 3, status: 'pendente', data_entrega: '2026-05-02' },
    { id: 4, status: 'pendente', data_entrega: '2026-05-01' },
  ];
  const m = montar('admin', ped);
  m.c.renderizarEntregas('todos');
  assert.deepEqual(m.ids(), [4, 3, 2, 1]);
});

test('Entregador: vê todas as pendentes, sem paginar', () => {
  const m = montar('entregador', gerar(100, 'pendente'));
  m.c.renderizarEntregas('pendente');
  assert.equal(m.ids().length, 100);
  assert.doesNotMatch(m.el.innerHTML, /Ver mais/);
});

test('Trocar de aba recomeça do primeiro lote', () => {
  assert.match(trecho('function filtrarEntregas', '// ====='), /entregasVisiveis = ENTREGAS_LOTE/);
});
