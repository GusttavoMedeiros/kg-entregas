const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const inicioHelper = app.indexOf('function dataRealEntrega');
const fimHelper = app.indexOf('\n}\n', inicioHelper) + 2;
const inicio = app.indexOf('function pedidosDoRelatorio');
const fim = app.indexOf('// Agrega os números', inicio);
const contexto = {
  usuario: { perfil: 'vendedor', login: 'vendedor1' },
  todosOsPedidos: [
    { id: 1, status: 'entregue', data_entrega: '2026-08-10', data_entregue_em: '2026-08-18', vendedor: 'vendedor1' },
    { id: 2, status: 'pendente', data_entrega: '2026-08-15', vendedor: 'vendedor1' },
    { id: 3, status: 'entregue', data_entrega: '2026-07-31', vendedor: 'vendedor1' },
    { id: 4, status: 'entregue', data_entrega: '2026-08-20', vendedor: 'vendedor2' },
    { id: 5, status: 'entregue', data_entrega: null, vendedor: 'vendedor1' },
  ],
};

vm.runInNewContext(app.slice(inicioHelper, fimHelper), contexto);
vm.runInNewContext(app.slice(inicio, fim), contexto);
assert.deepEqual(Array.from(contexto.pedidosDoRelatorio('2026-08-01', '2026-08-31'), p => p.id), [1]);
assert.deepEqual(Array.from(contexto.pedidosDoRelatorio('2026-08-10', '2026-08-16'), p => p.id), []);
assert.deepEqual(Array.from(contexto.pedidosDoRelatorio('2026-08-17', '2026-08-23'), p => p.id), [1]);

contexto.usuario = { perfil: 'admin', login: 'admin' };
assert.deepEqual(Array.from(contexto.pedidosDoRelatorio('2026-08-01', '2026-08-31'), p => p.id), [1, 4]);
assert.match(app, /Nenhum pedido entregue neste período/);
assert.match(app, /Pedidos entregues/);

console.log('Relatório usa a entrega real, com fallback legado, para admin e vendedor.');
