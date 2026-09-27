const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// O relatório é o documento do acerto de comissão. Só pode dizer "conferido com
// o servidor" quando a resposta veio mesmo do servidor, e só soma no total o que
// o banco confirmou. Entregas feitas offline neste aparelho aparecem à parte.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function contextoApi(headers) {
  const c = {
    geracaoAcesso: 0, MODO_DEMO: false, sessao: { access_token: 'token' }, navigator: { onLine: true },
    garantirTokenValido: async () => true, SUPABASE_URL: 'https://teste.invalid', SUPABASE_KEY: 'publica',
    authRefresh: async () => false, forcarRelogin() {}, AbortController, setTimeout, clearTimeout, console,
    fetch: async () => new Response('[{"id":1}]', { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }),
  };
  vm.runInNewContext(trecho('async function apiSupabase(', '// AUTENTICAÇÃO'), c);
  return c;
}

test('Resposta devolvida pelo cache do service worker é marcada como deCache', async () => {
  assert.equal((await contextoApi({ 'x-from-cache': '1' }).apiSupabase('pedidos')).deCache, true);
  assert.equal((await contextoApi({}).apiSupabase('pedidos')).deCache, false);
});

test('listarTodos avisa quando qualquer página veio do cache', async () => {
  let chamadas = 0;
  const c = { apiSupabase: async () => (++chamadas === 1
    ? { ok: true, dados: [{ id: 1 }], deCache: true }
    : { ok: true, dados: [] }) };
  vm.runInNewContext(trecho('async function listarTodos(', 'async function carregarListas('), c);
  const res = await c.listarTodos('pedidos');
  assert.equal(res.ok, true);
  assert.equal(res.deCache, true);
});

function contextoBusca(respostaLista) {
  const memoria = new Map();
  const ordem = [];
  const c = {
    MODO_DEMO: false, usuario: { perfil: 'admin', login: 'admin' }, navigator: { onLine: true },
    localStorage: { getItem: k => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) },
    FILA_OFFLINE_KEY: 'kg-fila-offline',
    processarFilaOffline: async () => { ordem.push('fila'); },
    listarTodos: async () => { ordem.push('lista'); return respostaLista; },
    normalizarPedidos: dados => dados.map(p => ({ ...p, itens: p.itens_pedido || [] })),
    aplicarFilaOffline: () => { throw new Error('o relatório não pode aplicar a fila offline'); },
    ordem, memoria,
  };
  vm.runInNewContext(
    trecho('function lerFilaOffline', 'function gravarFilaOffline') +
    trecho('function acaoOfflinePertenceAoUsuario', 'function atualizarAvisoFila') +
    trecho('async function buscarPedidosRelatorio(', 'async function atualizarFonteRelatorio('), c);
  return c;
}

test('Dados vindos do cache não contam como conferidos com o servidor', async () => {
  const c = contextoBusca({ ok: true, dados: [{ id: 1, status: 'entregue' }], deCache: true });
  const r = await c.buscarPedidosRelatorio();
  assert.equal(r.ok, false);
  assert.match(r.erro, /servidor não respondeu/);
});

test('Relatório envia a fila antes de conferir e não soma entrega ainda não enviada', async () => {
  const c = contextoBusca({ ok: true, dados: [
    { id: 1, status: 'pendente', vendedor: 'vendedor', valor: 50 },
    { id: 2, status: 'entregue', vendedor: 'vendedor', valor: 30, data_entregue_em: '2026-09-10' },
  ] });
  c.memoria.set('kg-fila-offline', JSON.stringify([
    { tipo: 'marcar-entregue', pedidoId: 1, usuarioLogin: 'admin', payload: { status: 'entregue', data_entregue_em: '2026-09-12' } },
    { tipo: 'marcar-entregue', pedidoId: 2, usuarioLogin: 'admin', payload: { status: 'entregue', data_entregue_em: '2026-09-10' } },
    { tipo: 'marcar-entregue', pedidoId: 1, usuarioLogin: 'outro', payload: { status: 'entregue' } },
  ]));
  const r = await c.buscarPedidosRelatorio();
  assert.deepEqual(c.ordem, ['fila', 'lista'], 'tenta enviar a fila antes de buscar');
  assert.equal(r.ok, true);
  assert.equal(r.pedidos.find(p => p.id === 1).status, 'pendente', 'o total usa só o que o banco confirmou');
  assert.deepEqual(Array.from(r.filaPendente, p => [p.id, p.data_entregue_em]), [[1, '2026-09-12']],
    'só a entrega deste usuário ainda não confirmada fica na lista de envio');
});

test('Entrega não enviada aparece à parte, fora do total e fora dos "sem baixa"', () => {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', disabled: false }); return els.get(id); };
  const pedidos = [
    { id: 1, status: 'pendente', data_entrega: '2026-09-11', valor: 50, cliente_nome: 'Na Fila Ltda', vendedor: 'vendedor',
      itens: [{ produto_id: 1, nome: 'Milho 60kg', qtd: 4, preco_unit: 12.5 }] },
    { id: 2, status: 'entregue', data_entregue_em: '2026-09-10', valor: 30, cliente_nome: 'Confirmado', vendedor: 'vendedor',
      status_pagamento: 'pago', itens: [{ produto_id: 1, nome: 'Milho 60kg', qtd: 3, preco_unit: 10 }] },
    { id: 3, status: 'pendente', data_entrega: '2026-09-05', valor: 9, cliente_nome: 'Esquecido', vendedor: 'vendedor' },
  ];
  const contexto = {
    usuario: { perfil: 'admin', login: 'admin' }, todosOsPedidos: pedidos, todosOsProdutos: [{ id: 1, nome: 'Milho 60kg' }],
    relTipo: 'mensal', relOffset: 0, relVendedor: '',
    relFonte: { pedidos, filaPendente: [{ ...pedidos[0], data_entregue_em: '2026-09-12' }], atualizadoEm: new Date(), erro: null, carregando: false },
    document: { getElementById: el },
    calcularJanelaRelatorio: () => ({ ini: '2026-09-01', fim: '2026-09-30', label: 'Setembro de 2026' }),
  };
  vm.runInNewContext(
    trecho('function dataRealEntrega', 'function dadosEntregaConcluida') +
    trecho('function dataBR(', 'function badgeCategoria(') +
    trecho('function foiPago(', '// Detecta se o pedido') +
    trecho('function pedidosBaseRelatorio(', 'function abrirModalRelatorio(') +
    trecho('// Filtra somente pedidos', '// Gera o Blob do PDF'), contexto);

  const r = contexto.montarRelatorio();
  assert.equal(r.d.total, 30, 'entrega não enviada fica fora do total');
  assert.equal(r.d.produtos[0].qtd, 3);
  assert.deepEqual(Array.from(r.naFila, p => p.id), [1]);
  assert.deepEqual(Array.from(r.pendentes, p => p.id), [3], 'não repete a entrega da fila entre os sem baixa');

  contexto.renderizarRelatorio();
  const html = el('relatorio-conteudo').innerHTML;
  assert.match(html, /1 entrega\(s\) ainda não enviada\(s\) ao servidor/);
  assert.match(html, /Na Fila Ltda/);

  // Entrega da fila fora do período não aparece neste relatório.
  contexto.relFonte.filaPendente[0].data_entregue_em = '2026-10-01';
  assert.equal(contexto.montarRelatorio().naFila.length, 0);
});

test('PDF avisa sobre entregas não enviadas', () => {
  const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra');
  assert.match(pdf, /const \{ pendentes, naFila, d \} = montarRelatorio\(\)/);
  assert.match(pdf, /ainda não chegaram ao servidor e estão FORA do total/);
  assert.match(pdf, /Entregas não enviadas ao servidor/);
  assert.match(pdf, /ATENÇÃO: este relatório foi gerado SEM conferir com o servidor/);
});
