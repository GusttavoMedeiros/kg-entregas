const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260828165707_add_actual_delivery_date.sql',
  'utf8',
);

const inicioDatas = app.indexOf('function dataHojeBrasil');
const fimDatas = app.indexOf('\n}\n', app.indexOf('function dadosEntregaConcluida', inicioDatas)) + 2;
const contexto = {};
vm.runInNewContext(app.slice(inicioDatas, fimDatas), contexto);

// 1. Previsto e entregue no mesmo dia.
assert.equal(contexto.dataRealEntrega({ data_entrega: '2026-08-18', data_entregue_em: '2026-08-18' }), '2026-08-18');

// 2 e 3. A data real vence a previsão, inclusive após o fechamento da semana prevista.
assert.equal(contexto.dataRealEntrega({ data_entrega: '2026-08-10', data_entregue_em: '2026-08-18' }), '2026-08-18');

// 4. Pedido antigo sem a coluna preenchida mantém o comportamento anterior.
assert.equal(contexto.dataRealEntrega({ data_entrega: '2026-07-31' }), '2026-07-31');

// 5. A captura usa o dia civil do Brasil e entra no payload que será enfileirado offline.
const pertoDaMeiaNoite = new Date('2026-08-19T02:30:00.000Z'); // ainda é 18/08 em São Paulo
assert.deepEqual(
  JSON.parse(JSON.stringify(contexto.dadosEntregaConcluida(pertoDaMeiaNoite))),
  { status: 'entregue', data_entregue_em: '2026-08-18' },
);
assert.match(app, /const payload = \{\s*\.\.\.dadosEntregaConcluida\(\)/);
assert.match(app, /adicionarNaFilaOffline\(\{[\s\S]*?pedidoId: id,[\s\S]*?payload,/);

// 6. O app bloqueia uma segunda conclusão e o banco preserva a data em edições/reversões.
assert.match(app, /pedidoSelecionado\.status === 'entregue'/);
assert.match(migration, /new\.data_entregue_em := old\.data_entregue_em/);

// A migration não reescreve pedidos antigos e cria o registro automático no banco.
assert.match(migration, /add column if not exists data_entregue_em date/);
assert.doesNotMatch(migration, /update\s+public\.pedidos\s+set\s+data_entregue_em/i);
assert.match(migration, /America\/Sao_Paulo/);
assert.match(migration, /before insert or update on public\.pedidos/);

console.log('Data real, fuso do Brasil, offline, legado e preservação validados.');
