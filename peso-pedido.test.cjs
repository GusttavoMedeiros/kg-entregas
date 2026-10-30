const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js','utf8');
const c = {};
vm.runInNewContext(app.slice(app.indexOf('function resumoPeso('), app.indexOf('function renderizarCarrinho(')), c);
test('peso soma quantidades, destaca faltantes e não inventa peso para pedidos antigos', () => {
  assert.equal(c.resumoPeso([{peso_unitario_kg:15,qtd:2},{peso_unitario_kg:2.5,qtd:3}]), 'Peso total: 37,5 kg');
  assert.equal(c.resumoPeso([{produto:{peso_kg:15},qtd:2},{qtd:1}]), 'Peso parcial: 30 kg · 1 item(ns) sem peso');
  assert.equal(c.resumoPeso([{qtd:2}]), 'Peso: não informado');
  assert.equal(c.resumoPeso([]), 'Peso: não informado');
});
