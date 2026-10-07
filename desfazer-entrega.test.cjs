const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// "Desfazer entrega" (só admin): o pedido volta a pendente para ser corrigido
// (devolução, item errado) e entregue de novo. Pedido entregue não pode ser editado.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente({ perfil = 'admin', pedido = {}, resposta, online = true, demo = false } = {}) {
  const p = { id: 7, cliente_nome: 'Ração & Cia', status: 'entregue', valor: 150, data_entregue_em: '2026-10-02',
    status_pagamento: 'pendente', forma_pagamento_real: null, data_pagamento: null,
    itens: [{ nome: 'Milho', qtd: 10 }], ...pedido };
  const c = {
    usuario: { perfil, login: perfil }, MODO_DEMO: demo, navigator: { onLine: online }, Intl, Date, Number, Array, console,
    todosOsPedidos: [p],
    toasts: [], confirmacoes: [], respostaConfirmar: true, chamadas: [], fechados: [], mudancas: 0, sincronizacoes: 0,
    toast: m => c.toasts.push(m),
    confirmar: async (m, o) => { c.confirmacoes.push({ m, o }); return c.respostaConfirmar; },
    fecharModal: id => c.fechados.push(id),
    registrarMudancaLocal: () => { c.mudancas++; }, solicitarSincronizacao: () => { c.sincronizacoes++; },
    apiSupabase: async (tabela, metodo, corpo, filtros) => {
      c.chamadas.push({ tabela, metodo, corpo, filtros });
      return resposta || { ok: true, dados: [{ ...p, ...corpo, clientes: { nome: 'X' }, itens_pedido: [] }] };
    },
  };
  vm.createContext(c);
  vm.runInContext(trecho('const fmt = d =>', 'function badgeCategoria(') +
    trecho('// Desfazer entrega (só admin)', 'async function carregarHistoricoPedido('), c);
  c.p = p;
  return c;
}

test('Desfazer: confirma, volta para pendente e apaga o "a receber" (será perguntado de novo)', async () => {
  const c = ambiente();
  c.respostaConfirmar = false;
  await c.desfazerEntrega(7);
  assert.equal(c.chamadas.length, 0, 'cancelar não muda nada');
  const { m, o } = c.confirmacoes[0];
  assert.match(m, /^Pedido nº 7 — Ração & Cia\nEntregue em 02\/10\/2026 · R\$ 150,00/);
  assert.match(m, /volta para PENDENTE/);
  assert.match(m, /situação do pagamento é apagada/);
  assert.match(m, /comissão deste período já foi acertada/);
  assert.equal(o.perigo, true);
  assert.equal(o.okLabel, 'Desfazer entrega');

  c.respostaConfirmar = true;
  await c.desfazerEntrega(7);
  assert.equal(c.chamadas.length, 1);
  const { tabela, metodo, corpo, filtros } = c.chamadas[0];
  assert.equal(tabela, 'pedidos'); assert.equal(metodo, 'PATCH');
  assert.equal(filtros, '?id=eq.7&status=eq.entregue', 'só desfaz se ainda estiver entregue');
  assert.deepEqual({ ...corpo }, { status: 'pendente', status_pagamento: null, forma_pagamento_real: null, data_pagamento: null });
  assert.equal(c.p.status, 'pendente');
  assert.equal(c.p.status_pagamento, null);
  assert.equal(c.p.cliente_nome, 'Ração & Cia', 'não troca o nome por dados crus do servidor');
  assert.equal(c.p.itens.length, 1, 'mantém os itens');
  assert.equal(c.p.clientes, undefined);
  assert.deepEqual([...c.fechados], ['modal-detalhe-pedido']);
  assert.equal(c.mudancas, 1);
  assert.match(c.toasts.at(-1), /Entrega desfeita/);
});

test('Desfazer: pagamento já recebido continua valendo', async () => {
  const c = ambiente({ pedido: { status_pagamento: 'pago', forma_pagamento_real: 'pix', data_pagamento: '2026-10-02' } });
  await c.desfazerEntrega(7);
  assert.match(c.confirmacoes[0].m, /pagamento já registrado continua valendo/);
  assert.deepEqual({ ...c.chamadas[0].corpo }, { status: 'pendente' });
  assert.equal(c.p.status_pagamento, 'pago');
  assert.equal(c.p.forma_pagamento_real, 'pix');
});

test('Desfazer: entrega parcial avisa que os itens que faltaram não voltam', async () => {
  const c = ambiente({ pedido: { itens: [{ nome: 'Milho', qtd: 8, qtd_pedida: 10 }] } });
  c.respostaConfirmar = false;
  await c.desfazerEntrega(7);
  assert.match(c.confirmacoes[0].m, /itens que faltaram na entrega parcial não voltam sozinhos/);
  const d = ambiente();
  d.respostaConfirmar = false;
  await d.desfazerEntrega(7);
  assert.doesNotMatch(d.confirmacoes[0].m, /entrega parcial/);
});

test('Desfazer: só admin, só pedido entregue, só com internet', async () => {
  for (const perfil of ['vendedor', 'entregador']) {
    const c = ambiente({ perfil });
    await c.desfazerEntrega(7);
    assert.equal(c.confirmacoes.length + c.chamadas.length, 0, perfil);
  }
  const pend = ambiente({ pedido: { status: 'pendente' } });
  await pend.desfazerEntrega(7);
  assert.equal(pend.confirmacoes.length, 0);
  const off = ambiente({ online: false });
  await off.desfazerEntrega(7);
  assert.equal(off.confirmacoes.length, 0);
  assert.match(off.toasts.at(-1), /Sem internet/);
  const inexistente = ambiente();
  await inexistente.desfazerEntrega(999);
  assert.equal(inexistente.confirmacoes.length, 0);
});

test('Desfazer: erro do servidor ou pedido já desfeito em outro aparelho não muda a tela', async () => {
  const erro = ambiente({ resposta: { ok: false, erro: 'permission denied' } });
  await erro.desfazerEntrega(7);
  assert.equal(erro.p.status, 'entregue');
  assert.match(erro.toasts.at(-1), /não foi desfeita[\s\S]*permission denied/);
  assert.equal(erro.fechados.length, 0);

  const ja = ambiente({ resposta: { ok: true, dados: [] } });
  await ja.desfazerEntrega(7);
  assert.equal(ja.p.status, 'entregue');
  assert.equal(ja.sincronizacoes, 1, 'recarrega os dados');
  assert.match(ja.toasts.at(-1), /já não estava entregue/);

  const exc = ambiente();
  exc.apiSupabase = async () => { throw new Error('rede caiu'); };
  await exc.desfazerEntrega(7);
  assert.equal(exc.p.status, 'entregue');
  assert.match(exc.toasts.at(-1), /rede caiu/);
  // Depois do erro, dá para tentar de novo (a trava foi liberada).
  exc.apiSupabase = async (t, m, corpo) => ({ ok: true, dados: [{ ...exc.p, ...corpo }] });
  await exc.desfazerEntrega(7);
  assert.equal(exc.p.status, 'pendente');
});

test('Desfazer no modo demonstração muda só a tela', async () => {
  const c = ambiente({ demo: true, online: false });
  await c.desfazerEntrega(7);
  assert.equal(c.chamadas.length, 0);
  assert.equal(c.p.status, 'pendente');
});

test('Detalhe do pedido: botão só para admin em pedido entregue', () => {
  const det = trecho('function verDetalhePedido(', '// Desfazer entrega (só admin)');
  assert.match(det, /usuario\.perfil === 'admin' && p\.status === 'entregue'\s*\? `<button class="btn-perigo w100 mt-8" onclick="desfazerEntrega\(\$\{p\.id\}\)">↩ Desfazer entrega<\/button>`/);
});

test('Histórico do pedido mostra "Entrega desfeita"', () => {
  const hist = trecho('async function carregarHistoricoPedido(', '// HELPERS DE LÓGICA');
  assert.match(hist, /const titulo = h\.acao !== 'entregue' && \(h\.campos \|\| \[\]\)\.includes\('status'\) \? 'Entrega desfeita' : \(acoes\[h\.acao\] \|\| h\.acao\);/);
  assert.match(hist, /\$\{esc\(titulo\)\}/);
});
