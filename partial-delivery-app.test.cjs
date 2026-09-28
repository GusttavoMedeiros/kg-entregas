const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto: crypto } = require('node:crypto');

// Entrega parcial no app: o entregador informa quanto chegou de cada item; o que
// faltou é cancelado e o cliente paga só o que recebeu. O banco faz a conta
// definitiva (partial-delivery-db.test.cjs); aqui vale a tela, o cálculo local
// e a fila offline.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

const pedido = () => ({
  id: 7, status: 'pendente', valor: 200, descricao: '10x Milho 60kg, 4x Farelo', status_pagamento: null,
  itens: [
    { id: 11, produto_id: 1, nome: 'Milho 60kg', qtd: 10, preco_unit: 10, preco_catalogo: 10 },
    { id: 12, produto_id: 2, nome: 'Farelo', qtd: 4, preco_unit: 25.5, preco_catalogo: 25.5 },
  ],
});

function ajudantes(extra = {}) {
  const c = { ...extra };
  vm.createContext(c);
  vm.runInContext(trecho('const chaveItemEntrega', 'function renderizarItensEntrega('), c);
  return c;
}

test('Valor da entrega parcial soma em centavos só o que chegou', () => {
  const c = ajudantes();
  const p = pedido();
  const e = (a, b) => [{ id: 11, chave: '11', qtd: 10, qtd_entregue: a }, { id: 12, chave: '12', qtd: 4, qtd_entregue: b }];
  assert.equal(c.valorEntregaParcial(p, e(10, 4)), 202);
  assert.equal(c.valorEntregaParcial(p, e(8, 0)), 80);
  assert.equal(c.valorEntregaParcial(p, e(0, 3)), 76.5);
  assert.equal(c.valorEntregaParcial(p, e(7, 1)), 95.5);
});

test('Entrega parcial local reduz itens, remove o zerado e guarda o que foi pedido', () => {
  const c = ajudantes();
  const p = pedido();
  c.aplicarEntregaParcialLocal(p, [{ id: 11, qtd_entregue: 8 }, { id: 12, qtd_entregue: 0 }]);
  assert.equal(p.valor, 80);
  assert.equal(p.descricao, '8x Milho 60kg');
  assert.deepEqual(Array.from(p.itens, i => [i.nome, i.qtd, i.qtd_pedida]), [['Milho 60kg', 8, 10]]);

  const inteiro = pedido();
  c.aplicarEntregaParcialLocal(inteiro, [{ id: 11, qtd_entregue: 10 }, { id: 12, qtd_entregue: 4 }]);
  assert.equal(inteiro.valor, 202);
  assert.ok(inteiro.itens.every(i => i.qtd_pedida === undefined), 'sem redução, nada é marcado');
});

test('Sem id (modo demonstração) a redução usa a posição do item', () => {
  const c = ajudantes();
  const p = pedido();
  p.itens.forEach(i => delete i.id);
  c.aplicarEntregaParcialLocal(p, [{ id: null, chave: 'n0', qtd_entregue: 9 }, { id: null, chave: 'n1', qtd_entregue: 4 }]);
  assert.deepEqual(Array.from(p.itens, i => i.qtd), [9, 4]);
});

function tela(pedidoAtual) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, { id, hidden: false, innerHTML: '', textContent: '', className: '' }); return els.get(id); };
  const entradas = [];
  const c = ajudantes({
    pedidoSelecionado: pedidoAtual, esc: t => String(t ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    moeda: v => 'R$ ' + Number(v).toFixed(2).replace('.', ','),
    document: {
      getElementById: el,
      querySelectorAll: () => entradas,
    },
    entradas,
  });
  vm.runInContext(trecho('function renderizarItensEntrega(', 'function abrirModalEntrega('), c);
  c.el = el;
  // Simula os campos numéricos criados pela tela.
  c.montarEntradas = () => {
    entradas.length = 0;
    (pedidoAtual.itens || []).forEach((i, idx) => entradas.push({
      value: String(i.qtd), dataset: { id: i.id != null ? String(i.id) : '', chave: String(i.id != null ? i.id : 'n' + idx), max: String(i.qtd) },
    }));
  };
  return c;
}

test('Tela: mostra um campo por item, já preenchido com o total pedido', () => {
  const p = pedido();
  const c = tela(p);
  c.renderizarItensEntrega(p);
  const html = c.el('entrega-itens-lista').innerHTML;
  assert.equal((html.match(/class="qtd-input entrega-item-qtd"/g) || []).length, 2);
  assert.match(html, /value="10"[^>]*data-id="11"/);
  assert.match(html, /max="4"/);
  assert.match(html, /pedido: 4/);
  assert.doesNotMatch(html, /disabled/);
  assert.equal(c.el('entrega-itens').hidden, false);
  c.renderizarItensEntrega({ ...p, itens: [] });
  assert.equal(c.el('entrega-itens').hidden, true, 'pedido sem itens não mostra o bloco');
});

test('Tela: pedido pago adiantado trava os campos e explica o motivo', () => {
  const p = { ...pedido(), status_pagamento: 'pago' };
  const c = tela(p);
  c.renderizarItensEntrega(p);
  const html = c.el('entrega-itens-lista').innerHTML;
  assert.equal((html.match(/disabled/g) || []).length, 6);
  assert.match(html, /Pedido já pago adiantado/);
});

test('Tela: o resumo avisa entrega parcial, valor novo, quantidade inválida e nada entregue', () => {
  const p = pedido();
  const c = tela(p);
  c.montarEntradas();
  c.atualizarResumoEntrega();
  assert.equal(c.el('entrega-itens-resumo').textContent, '', 'entrega completa: sem aviso');

  const [milho, farelo] = [c.document.querySelectorAll()[0], c.document.querySelectorAll()[1]];
  milho.value = '8'; farelo.value = '0';
  c.atualizarResumoEntrega();
  assert.match(c.el('entrega-itens-resumo').textContent, /Entrega parcial: R\$ 200,00 → R\$ 80,00/);
  assert.match(c.el('entrega-itens-resumo').textContent, /cliente paga só R\$ 80,00/);
  assert.equal(c.el('entrega-valor').textContent, 'R$ 80,00');

  milho.value = '11';
  c.atualizarResumoEntrega();
  assert.match(c.el('entrega-itens-resumo').textContent, /Confira as quantidades/);
  assert.equal(c.el('entrega-valor').textContent, 'R$ 200,00', 'valor original enquanto houver erro');
  milho.value = '2.5'; c.atualizarResumoEntrega();
  assert.match(c.el('entrega-itens-resumo').textContent, /Confira as quantidades/);
  milho.value = ''; c.atualizarResumoEntrega();
  assert.match(c.el('entrega-itens-resumo').textContent, /Confira as quantidades/);

  milho.value = '0'; farelo.value = '0'; c.atualizarResumoEntrega();
  assert.match(c.el('entrega-itens-resumo').textContent, /Nenhum item marcado como entregue/);
});

test('Botões + e − respeitam 0 e o total pedido', () => {
  const p = pedido();
  const c = tela(p);
  c.montarEntradas();
  const [milho] = c.document.querySelectorAll();
  c.ajustarQtdEntrega('11', 1);
  assert.equal(milho.value, '10', 'não passa do que foi pedido');
  c.ajustarQtdEntrega('11', -1);
  assert.equal(milho.value, '9');
  milho.value = '0'; c.ajustarQtdEntrega('11', -1);
  assert.equal(milho.value, '0', 'não fica negativo');
  milho.value = ''; c.ajustarQtdEntrega('11', -1);
  assert.equal(milho.value, '9', 'campo vazio volta ao total antes de ajustar');
});

function fila() {
  const memoria = new Map();
  const c = {
    usuario: { login: 'entregador', perfil: 'entregador' }, geracaoAcesso: 0, MODO_DEMO: false,
    navigator: { onLine: true }, crypto, console, Date, JSON,
    localStorage: { getItem: k => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) },
    document: { getElementById: () => null }, registrarMudancaLocal: () => {}, toast: () => {},
    solicitarSincronizacao: () => {}, todosOsPedidos: [pedido()], chamadas: [],
  };
  c.apiSupabase = async (tabela, metodo, corpo) => {
    c.chamadas.push({ tabela, corpo });
    return { ok: true, dados: { id: corpo.p_id, status: 'entregue' } };
  };
  vm.createContext(c);
  vm.runInContext(trecho('const chaveItemEntrega', 'function renderizarItensEntrega('), c);
  vm.runInContext(trecho('const FILA_OFFLINE_KEY =', '// Tenta processar a fila'), c);
  return c;
}
const payload = { status: 'entregue', data_entregue_em: '2026-09-21', status_pagamento: 'pendente' };

test('Fila offline: entrega parcial vai para a função nova, com as quantidades', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline({ tipo: 'marcar-entregue', pedidoId: 7, payload,
    itensEntregues: [{ id: 11, qtd_entregue: 8 }, { id: 12, qtd_entregue: 0 }] });
  await c.processarFilaOffline();
  assert.equal(c.chamadas.length, 1);
  assert.equal(c.chamadas[0].tabela, 'rpc/concluir_entrega_parcial');
  assert.deepEqual(JSON.parse(JSON.stringify(c.chamadas[0].corpo.p_itens)), [{ id: 11, qtd_entregue: 8 }, { id: 12, qtd_entregue: 0 }]);
  assert.equal(c.lerFilaOffline().length, 0);
});

test('Fila offline: entrega completa continua usando a função de sempre', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline({ tipo: 'marcar-entregue', pedidoId: 7, payload });
  await c.processarFilaOffline();
  assert.equal(c.chamadas[0].tabela, 'rpc/concluir_entrega');
  assert.equal(c.chamadas[0].corpo.p_itens, undefined);
});

test('Fila offline: enquanto não é enviada, a entrega parcial aparece reduzida neste aparelho', async () => {
  const c = fila();
  c.navigator.onLine = false;
  await c.adicionarNaFilaOffline({ tipo: 'marcar-entregue', pedidoId: 7, payload,
    itensEntregues: [{ id: 11, qtd_entregue: 8 }, { id: 12, qtd_entregue: 0 }] });
  const vindoDoServidor = [pedido()];
  c.aplicarFilaOffline(vindoDoServidor);
  assert.equal(vindoDoServidor[0].status, 'entregue');
  assert.equal(vindoDoServidor[0].valor, 80);
  assert.equal(vindoDoServidor[0].descricao, '8x Milho 60kg');
});

test('Código: confirmar entrega valida, pede confirmação e envia pela função certa', () => {
  const corpo = trecho('async function confirmarEntrega()', '// EXCLUIR PEDIDO');
  assert.match(corpo, /entregues\.every\(e => e\.qtd_entregue === 0\)/, 'bloqueia entrega sem nenhum item');
  assert.match(corpo, /parcial && pedidoSelecionado\.status_pagamento === 'pago'/, 'bloqueia parcial em pedido já pago');
  assert.match(corpo, /Entrega PARCIAL[\s\S]*?Confirmar a entrega parcial\?/, 'pede confirmação da entrega parcial');
  assert.match(corpo, /rpc\/concluir_entrega_parcial/);
  assert.match(corpo, /rpc\/concluir_entrega'/);
  assert.match(corpo, /adicionarNaFilaOffline\(acaoFila\)/);
  assert.doesNotMatch(corpo, /adicionarNaFilaOffline\(\{\s*tipo/, 'todas as filas levam as quantidades');
});
