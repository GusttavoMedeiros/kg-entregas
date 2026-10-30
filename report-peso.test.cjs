const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8');
const c = { foiPago: () => false, dataRealEntrega: () => '' };
vm.runInNewContext(app.slice(app.indexOf('function calcularDadosRelatorio('), app.indexOf('// "Ana (10)')), c);

test('relatório distingue peso registrado, estimado e ausente sem alterar pedidos', () => {
  const catalogo = [{id: 1, nome: 'Milho', peso_kg: 60}, {id: 2, nome: 'Milho', peso_kg: 30},
    {id: 3, nome: 'Farelo', peso_kg: 50}, {id: 4, nome: 'Farelo 50KG', produto_principal_id: 3}];
  const pedidos = [{id: 1, itens: [
    {produto_id: 1, qtd: 2, peso_unitario_kg: 55},
    {produto_id: 1, qtd: 1}, {produto_id: 2, qtd: 3},
    {produto_id: 3, qtd: 1}, {produto_id: 4, qtd: 2},
    {produto_id: 9, nome: 'Sem peso', qtd: 1}
  ]}, {id: 2, itens: []}];
  const antes = JSON.stringify(pedidos);
  const d = c.calcularDadosRelatorio(pedidos, catalogo);
  assert.equal(d.pesoConfirmado, 110);
  assert.equal(d.pesoEstimado, 300);
  assert.equal(d.itensSemPeso, 1);
  assert.equal(d.pedidosSemItens, 1);
  assert.match(c.textoPesoRelatorio(d), /Peso parcial: 410 kg.*300 kg estimados.*1 item\(ns\) sem peso.*1 pedido\(s\) sem itens/);
  assert.equal(d.produtos.find(p => p.nome === 'Farelo · 50 kg').qtd, 3);
  assert.ok(d.produtos.some(p => p.nome === 'Milho · 55 kg'));
  assert.ok(d.produtos.some(p => p.nome === 'Milho · 60 kg'));
  assert.ok(d.produtos.some(p => p.nome === 'Milho · 30 kg'));
  assert.equal(JSON.stringify(pedidos), antes);
});
