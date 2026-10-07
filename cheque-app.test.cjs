const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Cheque como forma real de recebimento: aparece na entrega e no "Marcar como Pago",
// conta como pago e é gravado como forma_pagamento_real = 'cheque'.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente() {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', className: '', dataset: {}, disabled: false, style: {},
      classList: { _a: new Set(), contains(c) { return this._a.has(c); }, add(c) { this._a.add(c); }, remove(c) { this._a.delete(c); } } });
    return els.get(id);
  };
  const c = {
    todosOsClientes: [{ id: 1, nome: 'Cliente', whatsapp: '81999990000' }],
    todosOsPedidos: [{ id: 1, cliente_id: 1, status: 'entregue', status_pagamento: 'pendente', valor: 100, descricao: '10x Milho', data_vencimento: '2026-12-01' }],
    clienteSelecionado: null, salvando: false, MODO_DEMO: false,
    document: { getElementById: el, querySelectorAll: () => [] },
    fmt: () => '2026-10-07', console, Date, encodeURIComponent,
    toasts: [], chamadas: [],
    toast: m => c.toasts.push(m), confirmar: async () => true,
    abrirModal() {}, fecharModal() {}, botaoSalvando() {}, registrarMudancaLocal() {}, solicitarSincronizacao() {},
    apiSupabase: async (tabela, metodo, corpo, filtros) => {
      c.chamadas.push({ tabela, metodo, corpo, filtros });
      return { ok: true, dados: c.todosOsPedidos.map(p => ({ ...p, ...corpo })), count: 1 };
    },
  };
  vm.createContext(c);
  vm.runInContext(
    trecho('function dataBR(', 'function badgeCategoria(') +
    trecho('function foiPago(', '// Detecta se o pedido') +
    trecho('function isPagamentoAtrasado', 'let _scrollSalvo') +
    trecho('let finSelecionados', '// MODAL NOVO PEDIDO'), c);
  c.el = el;
  return c;
}

test('Modal de entrega: botão Cheque existe e, com 5 opções, o último ocupa a linha toda', () => {
  assert.match(html, /data-valor="cheque" onclick="selecionarPagamentoRecebido\('cheque'\)"/);
  const botoes = html.slice(html.indexOf('<div class="pagto-recebido-grupo">'), html.indexOf('</div>', html.indexOf('data-valor="recusado"')));
  assert.deepEqual([...botoes.matchAll(/data-valor="(\w+)"/g)].map(m => m[1]), ['dinheiro', 'pix', 'cheque', 'pendente', 'recusado']);
  assert.match(botoes, /data-valor="cheque"[\s\S]*?pagto-recebido-label">Cheque</);
  assert.match(html, /\.pagto-recebido-grupo>\.pagto-recebido:last-child:nth-child\(odd\)\{grid-column:1\/-1\}/);
  assert.match(html.match(/<button[^>]*data-valor="cheque" onclick="selecionarPagamentoRecebido/)[0], /pagto-pago/, 'cheque é botão de "pago" (fica verde)');
});

test('Entrega com cheque grava pago + forma "cheque"; pendente e recusado seguem sem forma', () => {
  const conf = trecho('async function confirmarEntrega(', '\n}\n');
  assert.match(conf, /if \(FIN_FORMAS\[pagtoEscolhido\]\) \{\s*status_pagamento = 'pago';\s*forma_pagamento_real = pagtoEscolhido;/);
  assert.match(conf, /pagtoEscolhido === 'pendente'/);
  assert.match(conf, /pagtoEscolhido === 'recusado'/);
  assert.match(conf, /Escolha uma das 5 opções[\s\S]*📝 Cheque/);
  // A regra de escolha, isolada: só dinheiro, pix e cheque viram "pago".
  const c = ambiente();
  const vale = v => vm.runInContext(`!!FIN_FORMAS[${JSON.stringify(v)}]`, c);
  for (const ok of ['dinheiro', 'pix', 'cheque']) assert.equal(vale(ok), true, ok);
  for (const nao of ['pendente', 'recusado', '', 'boleto', 'avista']) assert.equal(vale(nao), false, nao);
});

test('Marcar como Pago: Cheque é uma das formas, com ícone, e grava forma "cheque"', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  const tela = c.el('fin-cliente-conteudo').innerHTML;
  assert.deepEqual([...tela.matchAll(/data-forma="(\w+)"/g)].map(m => m[1]), ['dinheiro', 'pix', 'cheque']);
  assert.match(tela, /📝<\/span>\s*<span class="pagto-recebido-label">Cheque/);
  c.alternarPedidoPago(1, true);
  c.escolherFormaPaga('cheque');
  assert.equal(vm.runInContext('finForma', c), 'cheque');
  await c.marcarPagoCliente();
  assert.equal(c.chamadas[0].corpo.forma_pagamento_real, 'cheque');
  assert.equal(c.chamadas[0].corpo.status_pagamento, 'pago');
  assert.equal(c.chamadas[0].corpo.data_pagamento, '2026-10-07');
});

test('Marcar como Pago: forma inválida continua recusada, e a mensagem cita o cheque', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(1, true);
  c.escolherFormaPaga('boleto');
  await c.marcarPagoCliente();
  assert.equal(c.chamadas.length, 0);
  assert.match(c.toasts.at(-1), /dinheiro, PIX \/ Cartão ou cheque/);
});

test('Detalhe do pedido mostra "Pago (Cheque)"', () => {
  assert.match(app, /\(\{ dinheiro: 'Dinheiro', pix: 'PIX\/Cartão', cheque: 'Cheque' \}\)\[p\.forma_pagamento_real\] \|\| ''/);
});
