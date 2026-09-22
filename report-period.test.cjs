const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const inicio = app.indexOf('function calcularJanelaRelatorio');
const fim = app.indexOf('// Filtra somente pedidos', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'função de janela não encontrada');

const OriginalDate = Date;
function janela(hojeISO, tipo, offset) {
  class DataFixa extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [hojeISO])); }
  }
  const contexto = { Date: DataFixa, fmt: d => d.toISOString().slice(0, 10), dataBR: d => d };
  vm.runInNewContext(app.slice(inicio, fim), contexto);
  return JSON.parse(JSON.stringify(contexto.calcularJanelaRelatorio(tipo, offset)));
}

// Quinzenas fixas: o período não depende do dia em que o relatório é aberto.
assert.deepEqual(janela('2026-09-16T12:00:00Z', 'quinzenal', 0),
  { ini: '2026-09-16', fim: '2026-09-30', label: 'Quinzena 2026-09-16 — 2026-09-30' });
assert.deepEqual(janela('2026-09-29T12:00:00Z', 'quinzenal', 0),
  { ini: '2026-09-16', fim: '2026-09-30', label: 'Quinzena 2026-09-16 — 2026-09-30' });
assert.deepEqual(janela('2026-09-16T12:00:00Z', 'quinzenal', -1),
  { ini: '2026-09-01', fim: '2026-09-15', label: 'Quinzena 2026-09-01 — 2026-09-15' });
assert.deepEqual(janela('2026-01-05T12:00:00Z', 'quinzenal', -1),
  { ini: '2025-12-16', fim: '2025-12-31', label: 'Quinzena 2025-12-16 — 2025-12-31' });
assert.equal(janela('2026-03-20T12:00:00Z', 'quinzenal', -2).fim, '2026-02-28');

// Navegando para trás, cada período começa no dia seguinte ao fim do anterior:
// nenhum dia fica de fora e nenhum é contado duas vezes.
for (const tipo of ['semanal', 'quinzenal', 'mensal']) {
  let atual = janela('2026-09-22T12:00:00Z', tipo, 0);
  for (let o = -1; o >= -30; o--) {
    const anterior = janela('2026-09-22T12:00:00Z', tipo, o);
    const diff = (new OriginalDate(atual.ini) - new OriginalDate(anterior.fim)) / 86400000;
    assert.equal(diff, 1, `${tipo} offset ${o}: lacuna ou sobreposição`);
    assert.ok(anterior.ini <= anterior.fim);
    atual = anterior;
  }
}

console.log('Períodos fixos do calendário, contíguos, sem lacuna nem sobreposição.');
