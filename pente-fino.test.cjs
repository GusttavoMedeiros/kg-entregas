const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Correções do pente fino de 07/10/2026.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function elemento(id) {
  return { id, innerHTML: '', textContent: '', className: '', dataset: {}, classList: {
    _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    filhos: [], appendChild(f) { this.filhos.push(f); }, querySelector() { return { textContent: '' }; },
    addEventListener() {} };
}

function dom() {
  const els = new Map();
  return { els, getElementById: id => { if (!els.has(id)) els.set(id, elemento(id)); return els.get(id); },
    createElement: () => elemento(''), body: elemento('body') };
}

test('Aviso de falha aparece como erro, nunca como sucesso', () => {
  const document = dom();
  const c = { document, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(trecho('function toast(', '// Confirmação com visual'), c);
  const classe = msg => { c.toast(msg); return document.els.get('toast-wrap').filhos.at(-1).className; };
  for (const msg of [
    'Pedido não salvo. Seus itens continuam aqui para tentar novamente.',
    'Produto não salvo. Tente novamente.',
    'Cliente não atualizado. Ele pode ter sido alterado ou removido em outra sessão.',
    'Cliente não excluído. Atualize os dados e tente novamente.',
    'Produto não excluído. Ele pode estar vinculado a pedidos ou ter sido alterado.',
    'A entrega não foi desfeita.\n\nDetalhes: x',
    'O acerto não foi registrado. rede caiu',
    'A entrega não foi registrada. x',
    'Não consegui buscar os pedidos no servidor: x',
    'A fila offline não pôde ser lida.',
    'Não foi possível gerar o PDF do relatório: x',
  ]) assert.equal(classe(msg), 'toast erro', msg);
  assert.equal(classe('Cliente salvo com sucesso'), 'toast ok');
  assert.equal(classe('Pedido excluído'), 'toast ok');
  assert.equal(classe('Este cliente não tem WhatsApp cadastrado.'), 'toast info');
  assert.equal(classe('Não há pedidos para apagar.'), 'toast info');
});

test('"Cobrar atrasados" não herda o pedido aberto antes', () => {
  const document = dom();
  const modal = document.getElementById('modal-detalhe-pedido');
  modal.dataset.registroId = '7';
  document.getElementById('detalhe-pedido-acoes-via').innerHTML = '<button onclick="desfazerEntrega(7)">↩ Desfazer entrega</button>';
  const c = {
    document, abertos: [], reabertos: [],
    todosOsPedidos: [{ id: 1, cliente_id: 5, valor: 30, data_vencimento: '2026-09-01' }],
    todosOsClientes: [{ id: 5, nome: 'Sítio Boa Vista', whatsapp: '81999990000' }],
    isPagamentoAtrasado: () => true, montarMensagemCobranca: () => 'msg', moeda: v => `R$ ${v}`,
    esc: s => String(s), toast() {},
    abrirModal: id => { c.abertos.push(id); document.getElementById(id).classList.add('aberto'); },
    verDetalhePedido: id => c.reabertos.push(id), verDetalheCliente() {}, verFinanceiroCliente() {},
  };
  vm.runInNewContext(trecho('function cobrarTodosAtrasados(', '// ====') +
    trecho('function atualizarDetalhesAbertos(', "if (entidades.includes('produtos'))") + '}', c);
  c.cobrarTodosAtrasados();
  assert.deepEqual(c.abertos, ['modal-detalhe-pedido']);
  assert.equal(modal.dataset.registroId, undefined);
  assert.equal(document.getElementById('detalhe-pedido-acoes-via').innerHTML, '', 'sem os botões do pedido anterior');
  assert.equal(document.getElementById('detalhe-pedido-titulo').textContent, '📲 Cobrar Atrasados (1 cliente)');
  const html = document.getElementById('detalhe-pedido-conteudo').innerHTML;
  assert.match(html, /Sítio Boa Vista/);
  assert.doesNotMatch(html, /Fechar/, 'a janela já tem o botão Fechar');
  // Atualização automática não troca a lista de cobrança pelo pedido antigo.
  c.atualizarDetalhesAbertos(['pedidos']);
  assert.deepEqual(c.reabertos, []);
});

test('Catálogo: margem negativa sai "-17%", sem "+-"', () => {
  const c = { mostrarMargem: true, moeda: v => `R$ ${v.toFixed(2)}`, esc: s => String(s), badgeCategoria: () => '',
    highlightBusca: s => s };
  vm.runInNewContext(trecho('function montarCardProduto(', 'function filtrarCatalogo('), c);
  const negativa = c.montarCardProduto({ id: 1, nome: 'Milho', preco: 50, preco_custo: 60 }, true);
  assert.match(negativa, /-17% \(R\$ -10\.00\)/);
  assert.doesNotMatch(negativa, /\+-/);
  assert.match(c.montarCardProduto({ id: 1, nome: 'Milho', preco: 60, preco_custo: 50 }, true), /\+20% \(R\$ 10\.00\)/);
});

test('Erro no PDF do relatório usa o aviso do app, não alert()', () => {
  const imprimir = trecho('async function imprimirRelatorio(', '// ====');
  assert.doesNotMatch(imprimir, /alert\(/);
  assert.match(imprimir, /toast\('Não foi possível gerar o PDF do relatório: ' \+ e\.message, 'erro'\)/);
  assert.doesNotMatch(app, /\balert\(/, 'nenhum alert() no app');
});
