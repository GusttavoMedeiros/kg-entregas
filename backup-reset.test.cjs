const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// "Limpar histórico" exige uma cópia de segurança baixada do servidor e só apaga
// os pedidos que estão nela. Antes, bastava digitar LIMPAR e os pedidos sumiam.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

const pedidoServidor = (id, extra = {}) => ({
  id, cliente_id: 1, clientes: { nome: 'Ração & Cia' }, vendedor: 'vendedor', status: 'entregue',
  data_entrega: '2026-09-20', data_entregue_em: '2026-09-21', forma_pagamento: 'avista', status_pagamento: 'pago',
  forma_pagamento_real: 'pix', data_pagamento: '2026-09-22', data_vencimento: '2026-09-20', valor: 125.5,
  observacao: '=SOMA(A1)', itens_pedido: [
    { nome: 'Milho "60kg"; extra', qtd: 5, qtd_pedida: 6, preco_unit: 12.5 },
    { nome: 'Farelo', qtd: 2, preco_unit: 31.5 },
  ], ...extra,
});

function ambiente(opcoes = {}) {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, value: '', textContent: '', className: '', disabled: false });
    return els.get(id);
  };
  el('confirma-reset').value = 'limpar';
  const c = {
    usuario: { login: 'admin', perfil: 'admin' }, MODO_DEMO: false, salvando: false,
    todosOsPedidos: [{ id: 1 }, { id: 2 }, { id: 3 }],
    navigator: { onLine: opcoes.offline ? false : true },
    document: { getElementById: el },
    Intl, Date, Number, JSON, Blob, URL, console, Set, setTimeout: fn => fn(),
    toasts: [], confirmacoes: [], respostaConfirmar: true, chamadas: [], baixados: [], fechados: [], mudancas: 0, sincronizacoes: 0,
    servidor: opcoes.servidor || [pedidoServidor(1), pedidoServidor(2, { itens_pedido: [] }), pedidoServidor(3)],
    fila: opcoes.fila || [], deCache: !!opcoes.deCache,
    toast: m => c.toasts.push(m),
    confirmar: async m => { c.confirmacoes.push(m); return c.respostaConfirmar; },
    abrirModal: id => { c.aberto = id; }, fecharModal: id => c.fechados.push(id),
    limparChecklist() {}, registrarMudancaLocal: () => { c.mudancas++; }, solicitarSincronizacao: () => { c.sincronizacoes++; },
    processarFilaOffline: async () => {}, lerFilaOffline: () => c.fila, acaoOfflinePertenceAoUsuario: () => true,
    listarTodos: async () => opcoes.erroServidor ? { ok: false, erro: 'falhou' } : { ok: true, dados: c.servidor, deCache: c.deCache },
    apiSupabase: async (tabela, metodo, corpo) => { c.chamadas.push({ tabela, metodo, corpo }); return { ok: true, dados: corpo.p_ids.length }; },
  };
  vm.createContext(c);
  vm.runInContext(trecho('let resetBackup', '// ENTREGAS (admin'), c);
  c.baixarArquivoTexto = (nome, conteudo, tipo) => c.baixados.push({ nome, conteudo, tipo });
  c.el = el;
  c.backup = () => vm.runInContext('resetBackup', c);
  return c;
}

test('Modal: o botão de apagar nasce travado e há um passo da cópia de segurança', () => {
  assert.match(html, /id="btn-confirmar-reset"[^>]*disabled/);
  assert.match(html, /onclick="baixarBackupReset\(\)"/);
  assert.match(html, /Passo 1 — Cópia de segurança/);
});

test('Abrir o modal zera qualquer cópia anterior e mantém o botão travado', () => {
  const c = ambiente();
  c.abrirModalReset();
  assert.equal(c.backup(), null);
  assert.equal(c.el('btn-confirmar-reset').disabled, true);
  assert.equal(c.aberto, 'modal-reset');
});

test('Sem cópia, LIMPAR não apaga nada', async () => {
  const c = ambiente();
  c.abrirModalReset();
  c.el('confirma-reset').value = 'LIMPAR';
  await c.executarResetPedidos();
  assert.match(c.toasts.at(-1), /Baixe a cópia de segurança primeiro/);
  assert.equal(c.chamadas.length, 0);
  assert.equal(c.confirmacoes.length, 0);
});

test('A cópia vem do servidor, baixa CSV e JSON e libera o botão', async () => {
  const c = ambiente();
  c.abrirModalReset();
  await c.baixarBackupReset();
  assert.deepEqual(c.baixados.map(b => b.nome.replace(/\d{8}-\d+/, 'DATA')), ['kg-backup-pedidos-DATA.csv', 'kg-backup-pedidos-DATA.json']);
  assert.deepEqual([...c.backup().ids], [1, 2, 3]);
  assert.equal(c.el('btn-confirmar-reset').disabled, false);
  assert.match(c.el('reset-backup-status').textContent, /Cópia baixada \(3 pedidos\)/);
  const json = JSON.parse(c.baixados[1].conteudo);
  assert.equal(json.total, 3);
  assert.equal(json.pedidos[0].clientes.nome, 'Ração & Cia');
  assert.equal(json.pedidos[0].itens_pedido.length, 2, 'itens vão junto, pois são apagados em cascata');
});

test('CSV: uma linha por item, nome do cliente, decimais com vírgula e proteção contra fórmula', () => {
  const c = ambiente();
  const csv = c.montarCsvBackup([pedidoServidor(7), pedidoServidor(8, { itens_pedido: [] })]);
  assert.equal(csv.charCodeAt(0), 0xfeff, 'BOM para o Excel abrir com acentos');
  const linhas = csv.slice(1).split('\r\n');
  assert.equal(linhas.length, 1 + 2 + 1, 'cabeçalho + 2 itens + pedido sem itens');
  assert.match(linhas[0], /^Pedido;Cliente;Vendedor;/);
  assert.match(linhas[1], /^7;Ração & Cia;vendedor;entregue;/);
  assert.match(linhas[1], /;125,50;"Milho ""60kg""; extra";6;5;12,50;62,50;'=SOMA\(A1\)$/);
  assert.match(linhas[3], /^8;Ração & Cia;/);
});

test('Cópia recusada se o servidor não responder, vier do cache, ou se estiver sem internet', async () => {
  for (const [opcoes, texto] of [
    [{ erroServidor: true }, /Não consegui buscar/],
    [{ deCache: true }, /dados antigos/],
    [{ offline: true }, /Sem internet/],
  ]) {
    const c = ambiente(opcoes);
    c.abrirModalReset();
    await c.baixarBackupReset();
    assert.match(c.toasts.at(-1), texto);
    assert.equal(c.baixados.length, 0);
    assert.equal(c.backup(), null);
    assert.equal(c.el('btn-confirmar-reset').disabled, true);
  }
});

test('Entrega feita offline e ainda não enviada bloqueia a cópia e a limpeza', async () => {
  const c = ambiente({ fila: [{ tipo: 'marcar-entregue', pedidoId: 2 }] });
  c.abrirModalReset();
  await c.baixarBackupReset();
  assert.match(c.toasts.at(-1), /ainda não foram enviadas/);
  assert.equal(c.backup(), null);
  // Ação já recusada pelo servidor (falha) não trava.
  const d = ambiente({ fila: [{ tipo: 'marcar-entregue', pedidoId: 2, falha: { status: 400 } }] });
  d.abrirModalReset();
  await d.baixarBackupReset();
  assert.notEqual(d.backup(), null);
});

test('Só apaga os pedidos da cópia, depois de LIMPAR e da confirmação', async () => {
  const c = ambiente();
  c.abrirModalReset();
  await c.baixarBackupReset();
  c.todosOsPedidos.push({ id: 99 }); // pedido criado depois da cópia
  c.el('confirma-reset').value = 'talvez';
  await c.executarResetPedidos();
  assert.equal(c.chamadas.length, 0, 'sem digitar LIMPAR nada acontece');

  c.el('confirma-reset').value = 'limpar';
  c.respostaConfirmar = false;
  await c.executarResetPedidos();
  assert.equal(c.chamadas.length, 0, 'cancelar na confirmação não apaga');

  c.respostaConfirmar = true;
  await c.executarResetPedidos();
  assert.match(c.confirmacoes.at(-1), /apagar 3 pedido\(s\)/);
  assert.match(c.confirmacoes.at(-1), /kg-backup-pedidos-\d{8}-\d+/);
  assert.equal(c.chamadas.length, 1);
  assert.equal(c.chamadas[0].tabela, 'rpc/limpar_pedidos');
  assert.deepEqual([...c.chamadas[0].corpo.p_ids], [1, 2, 3], 'o pedido 99 não entra');
  assert.deepEqual(c.todosOsPedidos.map(p => p.id), [99]);
  assert.equal(c.backup(), null, 'a cópia vale para uma limpeza só');
  assert.deepEqual(c.fechados, ['modal-reset']);
});

test('Só o admin gera a cópia', async () => {
  const c = ambiente();
  c.usuario = { login: 'vendedor', perfil: 'vendedor' };
  await c.baixarBackupReset();
  assert.match(c.toasts.at(-1), /Apenas o admin/);
  assert.equal(c.baixados.length, 0);
});
