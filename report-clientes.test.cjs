const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Relatório completo: além dos produtos, mostra para QUAIS clientes cada produto
// foi entregue e lista as entregas pedido a pedido, em papel ofício (2 folhas).
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente() {
  const c = { foiPago: p => p.status_pagamento === 'pago', dataRealEntrega: p => p.data_entregue_em, Map, Set, Number, Math };
  vm.createContext(c);
  vm.runInContext(trecho('function calcularDadosRelatorio(', 'function dataRealEntregaCurta(') +
    trecho('function qtdTexto(', 'function textoFonteRelatorio('), c);
  return c;
}

const item = (produto_id, nome, qtd, preco_unit, extra = {}) => ({ produto_id, nome, qtd, preco_unit, ...extra });
const pedidos = [
  { id: 10, cliente_id: 1, cliente_nome: 'Ana Silva', vendedor: 'vendedor', valor: 250, status_pagamento: 'pago', data_entregue_em: '2026-10-02',
    itens: [item(1, 'Milho 60kg', 10, 10), item(2, 'Farelo', 3, 50)] },
  { id: 11, cliente_id: 2, cliente_nome: 'Bruno & Cia', vendedor: 'admin', valor: 120, status_pagamento: 'pendente', data_entregue_em: '2026-10-03',
    itens: [item(1, 'Milho 60kg', 5, 10, { qtd_pedida: 8 }), item(3, 'Sal', 7, 10)] },
  { id: 12, cliente_id: 1, cliente_nome: 'Ana Silva', vendedor: 'vendedor', valor: 40, status_pagamento: 'pago', data_entregue_em: '2026-10-03',
    itens: [item(1, 'Milho 60kg', 4, 10), item(4, 'Cancelado', 0, 99)] },
];

test('Cada produto traz os clientes que o receberam, somando os pedidos do mesmo cliente', () => {
  const d = ambiente().calcularDadosRelatorio(pedidos);
  const milho = d.produtos.find(p => p.nome === 'Milho 60kg');
  assert.equal(milho.qtd, 19);
  assert.deepEqual(JSON.parse(JSON.stringify(milho.clientes)), [{ nome: 'Ana Silva', qtd: 14 }, { nome: 'Bruno & Cia', qtd: 5 }]);
  const farelo = d.produtos.find(p => p.nome === 'Farelo');
  assert.deepEqual(JSON.parse(JSON.stringify(farelo.clientes)), [{ nome: 'Ana Silva', qtd: 3 }]);
});

test('Resumo: clientes distintos, unidades e total batem com os pedidos', () => {
  const d = ambiente().calcularDadosRelatorio(pedidos);
  assert.equal(d.nClientes, 2);
  assert.equal(d.unidades, 10 + 3 + 5 + 7 + 4);
  assert.equal(d.nPedidos, 3);
  assert.equal(d.total, 410);
  assert.equal(d.aReceber, 120);
  assert.equal(d.produtos.reduce((s, p) => s + p.qtd, 0), d.unidades, 'item de quantidade 0 não conta');
});

test('Lista de entregas: um registro por pedido, com cliente, itens e se está pago', () => {
  const c = ambiente();
  const d = c.calcularDadosRelatorio(pedidos);
  assert.deepEqual(Array.from(d.entregas, e => e.id), [10, 11, 12], 'mantém a ordem recebida (data e número)');
  const e11 = d.entregas[1];
  assert.equal(e11.cliente, 'Bruno & Cia');
  assert.equal(e11.pago, false);
  assert.equal(e11.data, '2026-10-03');
  assert.equal(e11.vendedor, 'admin');
  assert.equal(d.entregas[0].pago, true);
  assert.equal(d.entregas[2].itens.length, 1, 'item com quantidade 0 não aparece na entrega');
  assert.equal(c.textoItensEntrega(d.entregas[0]), '10x Milho 60kg\n3x Farelo');
  assert.equal(c.textoItensEntrega(d.entregas[0], true), '10x Milho 60kg, 3x Farelo');
});

test('Entrega parcial mostra quanto foi pedido', () => {
  const c = ambiente();
  const d = c.calcularDadosRelatorio(pedidos);
  assert.equal(c.textoItensEntrega(d.entregas[1], true), '5x Milho 60kg (pediu 8), 7x Sal');
});

test('Texto de clientes do produto: "&" vira "e" só no PDF', () => {
  const c = ambiente();
  const milho = c.calcularDadosRelatorio(pedidos).produtos.find(p => p.nome === 'Milho 60kg');
  assert.equal(c.textoClientesProduto(milho), 'Ana Silva (14), Bruno & Cia (5)');
  assert.equal(c.textoClientesProduto(milho, true), 'Ana Silva (14), Bruno e Cia (5)');
});

test('Pedido sem cliente identificado não quebra e nomes iguais a propriedades de Object funcionam', () => {
  const c = ambiente();
  const d = c.calcularDadosRelatorio([{ id: 1, valor: 20, cliente_nome: 'constructor', status_pagamento: 'pago',
    itens: [item(null, '__proto__', 2, 10)] }, { id: 2, valor: 10, itens: [item(null, '__proto__', 1, 10)] }]);
  assert.equal(d.nClientes, 2);
  assert.equal(d.produtos[0].qtd, 3);
  assert.equal(d.entregas[1].cliente, 'Cliente');
});

test('PDF: papel ofício, 2 folhas com adensamento progressivo, linhas inteiras e sem a seção "Por cliente"', () => {
  const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra na overlay');
  assert.match(pdf, /new jsPDF\(\{ unit: 'mm', format: \[216, 330\] \}\)/);
  assert.match(pdf, /const NIVEIS = \[/);
  assert.match(pdf, /getNumberOfPages\(\) <= 2/);
  assert.match(app, /rowPageBreak: 'avoid'/);
  assert.match(pdf, /tituloSecao\('Entregas do período'\)/);
  assert.match(pdf, /Entregue para \(quantidade\)/);
  assert.match(pdf, /\['Clientes', String\(d\.nClientes\)\]/);
  assert.doesNotMatch(pdf, /Por cliente/);
  assert.doesNotMatch(trecho('function renderizarRelatorio(', 'async function gerarPdfRelatorio('), /Por cliente/);
});

test('Tela: mostra clientes por produto e a lista de entregas, com estilos definidos', () => {
  const tela = trecho('function renderizarRelatorio(', 'async function gerarPdfRelatorio(');
  assert.match(tela, /textoClientesProduto\(p\)/);
  assert.match(tela, /Entregas do período/);
  assert.match(tela, /d\.nClientes/);
  for (const classe of ['rel-bloco', 'rel-linha-sub', 'rel-resumo-sub', 'rel-pago', 'rel-a-receber']) {
    assert.match(html, new RegExp('\\.' + classe + '[{ ]'), classe + ' sem estilo');
  }
});
