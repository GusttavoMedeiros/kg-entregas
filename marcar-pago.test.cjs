const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// "Marcar como Pago" do cliente: só quita o que foi marcado, com a forma de
// pagamento escolhida e depois de confirmar. Antes, um toque quitava tudo o que o
// cliente devia (até pedido não entregue) como dinheiro.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente() {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', className: '', dataset: {}, disabled: false, style: {},
      classList: { _a: new Set(), contains(c) { return this._a.has(c); }, add(c) { this._a.add(c); }, remove(c) { this._a.delete(c); } } });
    return els.get(id);
  };
  const c = {
    todosOsClientes: [{ id: 1, nome: 'Ração & Cia', whatsapp: '81999990000' }, { id: 2, nome: 'Outro Cliente' }],
    todosOsPedidos: [
      { id: 1, cliente_id: 1, status: 'entregue', status_pagamento: 'pendente', valor: 100, descricao: '10x Milho', data_vencimento: '2026-09-01' },
      { id: 2, cliente_id: 1, status: 'entregue', status_pagamento: 'recusado', valor: 50.5, descricao: '5x Farelo', data_vencimento: '2026-12-01' },
      { id: 3, cliente_id: 1, status: 'pendente', status_pagamento: null, valor: 200, descricao: '20x Sal', data_vencimento: '2026-12-10' },
      { id: 4, cliente_id: 1, status: 'entregue', status_pagamento: 'pago', valor: 999, descricao: 'Já pago', data_vencimento: '2026-09-01' },
      { id: 5, cliente_id: 2, status: 'entregue', status_pagamento: 'pendente', valor: 70, descricao: 'Do outro', data_vencimento: '2026-12-01' },
    ],
    clienteSelecionado: null, salvando: false, MODO_DEMO: false,
    document: { getElementById: el, querySelectorAll: () => c.nodes || [] },
    fmt: () => '2026-09-28', console, Date, encodeURIComponent,
    toasts: [], confirmacoes: [], respostaConfirmar: true, chamadas: [], sincronizacoes: 0, mudancas: 0, fechados: [],
    toast: m => c.toasts.push(m),
    confirmar: async m => { c.confirmacoes.push(m); return c.respostaConfirmar; },
    abrirModal: id => el(id).classList.add('aberto'),
    fecharModal: id => { el(id).classList.remove('aberto'); c.fechados.push(id); },
    botaoSalvando() {}, registrarMudancaLocal: () => { c.mudancas++; }, solicitarSincronizacao: () => { c.sincronizacoes++; },
    apiSupabase: async (tabela, metodo, corpo, filtros) => {
      c.chamadas.push({ tabela, metodo, corpo, filtros });
      const ids = filtros.match(/id=in\.\(([\d,]+)\)/)[1].split(',').map(Number);
      const linhas = c.todosOsPedidos.filter(p => ids.includes(p.id) && p.status_pagamento !== 'pago' && !c.jaPagosNoServidor?.includes(p.id))
        .map(p => ({ ...p, ...corpo }));
      return { ok: true, dados: linhas, count: linhas.length };
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

test('Janela do cliente: cada pedido em aberto tem sua caixa, todas desmarcadas', () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  const html = c.el('fin-cliente-conteudo').innerHTML;
  assert.equal((html.match(/type="checkbox"/g) || []).length, 3, 'só os 3 pedidos em aberto do cliente 1');
  assert.doesNotMatch(html, / checked/, 'nada vem marcado');
  assert.doesNotMatch(html, /Já pago|Do outro/);
  assert.match(html, /Atrasado/);
  assert.match(html, /Cliente não pagou na entrega/);
  assert.match(html, /Ainda não entregue/);
  assert.match(html, /data-forma="dinheiro"/);
  assert.match(html, /data-forma="pix"/);
  // A classe do modal de entrega fica escondida por padrão: o bloco não pode reaproveitá-la.
  assert.doesNotMatch(html, /bloco-pagamento-entrega/);
  assert.match(html, /Total em aberto: R\$ 350,50/);
  assert.equal(c.el('fin-resumo-selecao').textContent, 'Nenhum pedido marcado.');
});

test('Escolha em andamento sobrevive a atualização automática, mas não passa para outro cliente', () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(2, true);
  c.escolherFormaPaga('pix');
  c.verFinanceiroCliente(1); // atualização automática com a janela aberta
  assert.match(c.el('fin-cliente-conteudo').innerHTML, /data-pedido="2"[^>]*checked/);
  assert.match(c.el('fin-cliente-conteudo').innerHTML, /pagto-pago ativo" data-forma="pix"/);
  assert.equal(c.el('fin-resumo-selecao').textContent, '1 pedido(s) marcado(s): R$ 50,50');
  // Pedido quitado em outro aparelho sai da escolha.
  c.todosOsPedidos.find(p => p.id === 2).status_pagamento = 'pago';
  c.verFinanceiroCliente(1);
  assert.equal(c.el('fin-resumo-selecao').textContent, 'Nenhum pedido marcado.');
  // Fechar e abrir de novo começa limpo.
  c.alternarPedidoPago(1, true);
  c.fecharModal('modal-fin-cliente');
  c.verFinanceiroCliente(1);
  assert.equal(c.el('fin-resumo-selecao').textContent, 'Nenhum pedido marcado.');
  assert.doesNotMatch(c.el('fin-cliente-conteudo').innerHTML, /pagto-pago ativo/);
});

test('Marcar todos e Limpar', () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.nodes = [1, 2, 3].map(id => ({ dataset: { pedido: String(id) }, checked: false }));
  c.selecionarPedidosPagos(true);
  assert.deepEqual(c.nodes.map(n => n.checked), [true, true, true]);
  assert.equal(c.el('fin-resumo-selecao').textContent, '3 pedido(s) marcado(s): R$ 350,50');
  c.selecionarPedidosPagos(false);
  assert.deepEqual(c.nodes.map(n => n.checked), [false, false, false]);
});

test('Sem marcar nenhum pedido ou sem escolher a forma, nada é enviado', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  await c.marcarPagoCliente();
  assert.match(c.toasts.at(-1), /Marque os pedidos/);
  c.alternarPedidoPago(1, true);
  await c.marcarPagoCliente();
  assert.match(c.toasts.at(-1), /Escolha como o cliente pagou/);
  assert.equal(c.chamadas.length, 0);
  assert.equal(c.confirmacoes.length, 0);
});

test('Só o pedido marcado é quitado, com a forma escolhida, e só depois de confirmar', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(1, true);
  c.escolherFormaPaga('pix');
  c.respostaConfirmar = false;
  await c.marcarPagoCliente();
  assert.equal(c.chamadas.length, 0, 'cancelar na confirmação não grava nada');
  assert.equal(c.confirmacoes.length, 1);

  c.respostaConfirmar = true;
  await c.marcarPagoCliente();
  assert.match(c.confirmacoes.at(-1), /Pedido\(s\) nº 1\n/);
  assert.match(c.confirmacoes.at(-1), /Total: R\$ 100,00/);
  assert.match(c.confirmacoes.at(-1), /Forma: PIX \/ Cartão/);
  assert.doesNotMatch(c.confirmacoes.at(-1), /ainda não foi entregue/);
  assert.equal(c.chamadas.length, 1);
  const { corpo, filtros } = c.chamadas[0];
  assert.match(filtros, /^\?id=in\.\(1\)&or=\(status_pagamento\.is\.null,status_pagamento\.neq\.pago\)$/);
  assert.equal(corpo.status_pagamento, 'pago');
  assert.equal(corpo.forma_pagamento_real, 'pix');
  assert.equal(corpo.data_pagamento, '2026-09-28');
  const pago = id => c.todosOsPedidos.find(p => p.id === id).status_pagamento;
  assert.equal(pago(1), 'pago');
  assert.equal(pago(2), 'recusado', 'os outros pedidos do cliente não são tocados');
  assert.equal(pago(3), null);
  assert.equal(pago(5), 'pendente', 'nem os de outro cliente');
  assert.deepEqual(c.fechados.slice(-1), ['modal-fin-cliente']);
  assert.match(c.toasts.at(-1), /1 pedido\(s\) de "Ração & Cia" marcado\(s\) como pago: R\$ 100,00/);
});

test('Pedido ainda não entregue exige atenção na confirmação e continua pendente de entrega', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(3, true);
  c.alternarPedidoPago(1, true);
  c.escolherFormaPaga('dinheiro');
  await c.marcarPagoCliente();
  assert.match(c.confirmacoes.at(-1), /Pedido\(s\) nº 1, 3/);
  assert.match(c.confirmacoes.at(-1), /Total: R\$ 300,00/);
  assert.match(c.confirmacoes.at(-1), /Forma: Dinheiro/);
  assert.match(c.confirmacoes.at(-1), /1 ainda não foi entregue \(pagamento adiantado\)/);
  const p3 = c.todosOsPedidos.find(p => p.id === 3);
  assert.equal(p3.status, 'pendente', 'a baixa não mexe na entrega');
  assert.equal(p3.status_pagamento, 'pago');
});

test('Se o servidor confirmar menos pedidos do que o esperado, avisa e recarrega', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(1, true);
  c.alternarPedidoPago(2, true);
  c.escolherFormaPaga('dinheiro');
  c.jaPagosNoServidor = [2]; // outro aparelho quitou o pedido 2 enquanto a janela estava aberta
  await c.marcarPagoCliente();
  assert.match(c.toasts.at(-1), /Só 1 de 2 pedido\(s\) foram atualizados/);
  assert.equal(c.sincronizacoes, 1);
  assert.equal(c.todosOsPedidos.find(p => p.id === 1).status_pagamento, 'pago');
  assert.equal(c.todosOsPedidos.find(p => p.id === 2).status_pagamento, 'recusado', 'não afirma o que o servidor não confirmou');
});

test('Falha do servidor não altera nada e mantém a janela aberta com a escolha', async () => {
  const c = ambiente();
  c.verFinanceiroCliente(1);
  c.alternarPedidoPago(1, true);
  c.escolherFormaPaga('pix');
  c.apiSupabase = async () => ({ ok: false, status: 503 });
  await c.marcarPagoCliente();
  assert.match(c.toasts.at(-1), /Erro ao atualizar/);
  assert.equal(c.todosOsPedidos.find(p => p.id === 1).status_pagamento, 'pendente');
  assert.equal(c.fechados.length, 0);
  assert.equal(c.finSelecionados?.has?.(1) ?? vm.runInContext('finSelecionados.has(1)', c), true);
});
