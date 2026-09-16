const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const inicio = app.indexOf('function calcularJanelaRelatorio');
const fim = app.indexOf('// Filtra somente pedidos', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'função de janela não encontrada');

const OriginalDate = Date;
class DataFixa extends OriginalDate {
  constructor(...args) {
    super(...(args.length ? args : ['2026-09-16T12:00:00Z']));
  }
}
const contexto = {
  Date: DataFixa,
  fmt: d => d.toISOString().slice(0, 10),
  dataBR: d => d,
};
vm.runInNewContext(app.slice(inicio, fim), contexto);

const atual = contexto.calcularJanelaRelatorio('quinzenal', 0);
assert.deepEqual(JSON.parse(JSON.stringify(atual)), {
  ini: '2026-09-02',
  fim: '2026-09-16',
  label: 'Quinzena · 2026-09-02 — 2026-09-16',
});

const anterior = contexto.calcularJanelaRelatorio('quinzenal', -1);
assert.deepEqual(JSON.parse(JSON.stringify(anterior)), {
  ini: '2026-08-18',
  fim: '2026-09-01',
  label: 'Quinzena · 2026-08-18 — 2026-09-01',
});

// As janelas são contíguas, sem sobreposição nem dia perdido.
const diff = (new OriginalDate(anterior.fim) - new OriginalDate(atual.ini)) / 86400000;
assert.equal(diff, -1);

console.log('Janela quinzenal móvel inclui os últimos 15 dias e navega sem lacunas.');
