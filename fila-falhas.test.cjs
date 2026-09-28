const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto: crypto } = require('node:crypto');

// Uma entrega feita offline que o servidor recusa de vez (ex.: pedido apagado)
// não pode ficar para sempre como "aguardando envio" sem explicação. Ela fica
// guardada com o motivo, para o usuário tentar de novo ou descartar.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function fila() {
  const memoria = new Map();
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', hidden: true, classList: { contains: () => false } }); return els.get(id); };
  const c = {
    usuario: { login: 'entregador', perfil: 'entregador' }, geracaoAcesso: 0, MODO_DEMO: false,
    navigator: { onLine: true }, crypto, console, Date, JSON,
    localStorage: { getItem: k => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v) },
    document: { getElementById: el }, registrarMudancaLocal: () => {}, toasts: [], sincronizacoes: 0,
    toast: m => c.toasts.push(m), solicitarSincronizacao: () => { c.sincronizacoes++; },
    abrirModal() {}, fecharModal() {}, respostaConfirmar: true, confirmar: async () => c.respostaConfirmar,
    esc: t => String(t ?? ''), dataBR: d => d || '–',
    todosOsPedidos: [{ id: 1, status: 'pendente', cliente_nome: 'Ração & Cia' }, { id: 2, status: 'pendente', cliente_nome: 'Outro' }],
    envios: [], respostas: {},
  };
  c.apiSupabase = async (t, m, d) => { c.envios.push(d.p_id); return c.respostas[d.p_id] || { ok: true, dados: { id: d.p_id, status: 'entregue' } }; };
  vm.createContext(c);
  vm.runInContext(trecho('const FILA_OFFLINE_KEY =', '// Tenta processar a fila'), c);
  c.el = el;
  return c;
}
const acao = id => ({ tipo: 'marcar-entregue', pedidoId: id, payload: { status: 'entregue', data_entregue_em: '2026-09-20' } });
const pedidoApagado = { ok: false, status: 400,
  erro: 'HTTP 400: {"code":"P0001","details":null,"hint":null,"message":"Pedido não encontrado ou indisponível"}' };

test('Recusa definitiva fica guardada com o motivo e não é reenviada sozinha', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline(acao(1));
  await c.adicionarNaFilaOffline(acao(2));
  c.respostas[1] = pedidoApagado;
  await c.processarFilaOffline();
  const f = c.lerFilaOffline();
  assert.equal(f.length, 1, 'a enviada sai, a recusada fica');
  assert.equal(f[0].pedidoId, 1);
  assert.equal(f[0].falha.motivo, 'Pedido não encontrado ou indisponível');
  assert.equal(c.sincronizacoes, 1, 'recarrega para desfazer o "entregue" mostrado localmente');

  c.envios.length = 0;
  await c.processarFilaOffline();
  assert.deepEqual(c.envios, [], 'não tenta de novo sozinha');

  c.aplicarFilaOffline(c.todosOsPedidos);
  assert.equal(c.todosOsPedidos[0].status, 'pendente', 'recusada não aparece como entregue');
});

test('Falhas passageiras continuam tentando sem marcar recusa', async () => {
  for (const resposta of [{ ok: false, rede: true }, { ok: false, status: 503 }, { ok: false, status: 401 },
    { ok: false, status: 429 }, { ok: false, status: 408 }, { ok: false, status: 499 }]) {
    const c = fila();
    await c.adicionarNaFilaOffline(acao(1));
    c.respostas[1] = resposta;
    await c.processarFilaOffline();
    assert.equal(c.lerFilaOffline()[0].falha, undefined, JSON.stringify(resposta));
  }
});

test('Aviso separa entregas aguardando envio das recusadas', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline(acao(1));
  await c.adicionarNaFilaOffline(acao(2));
  c.respostas[1] = pedidoApagado;
  c.respostas[2] = { ok: false, rede: true };
  await c.processarFilaOffline();
  const aviso = c.el('aviso-fila-offline');
  assert.equal(aviso.hidden, false);
  assert.match(aviso.innerHTML, /1 entrega\(s\) aguardando envio/);
  assert.match(aviso.innerHTML, /1 entrega\(s\) recusada\(s\) pelo servidor/);
  assert.match(aviso.innerHTML, /abrirFalhasFila\(\)/);

  c.abrirFalhasFila();
  const lista = c.el('fila-falhas-conteudo').innerHTML;
  assert.match(lista, /Ração & Cia/);
  assert.match(lista, /Motivo: Pedido não encontrado ou indisponível/);
  assert.match(lista, /tentarNovamenteFila\(/);
  assert.match(lista, /descartarAcaoFila\(/);
});

test('Tentar de novo reenvia e remove a entrega quando o servidor aceita', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline(acao(1));
  c.respostas[1] = pedidoApagado;
  await c.processarFilaOffline();
  const chave = c.chaveAcaoFila(c.lerFilaOffline()[0]);
  delete c.respostas[1];
  await c.tentarNovamenteFila(chave);
  assert.equal(c.lerFilaOffline().length, 0);
  assert.equal(c.el('aviso-fila-offline').hidden, true);
});

test('Descartar só remove depois de confirmar', async () => {
  const c = fila();
  await c.adicionarNaFilaOffline(acao(1));
  c.respostas[1] = pedidoApagado;
  await c.processarFilaOffline();
  const chave = c.chaveAcaoFila(c.lerFilaOffline()[0]);
  c.respostaConfirmar = false;
  await c.descartarAcaoFila(chave);
  assert.equal(c.lerFilaOffline().length, 1, 'cancelar mantém a entrega');
  c.respostaConfirmar = true;
  await c.descartarAcaoFila(chave);
  assert.equal(c.lerFilaOffline().length, 0);
});

test('Ação antiga sem acaoId ganha identificador ao ser recusada', async () => {
  const c = fila();
  c.localStorage.setItem('kg-fila-offline', JSON.stringify([{ ...acao(1), usuarioLogin: 'entregador', ts: 123 }]));
  c.respostas[1] = pedidoApagado;
  await c.processarFilaOffline();
  const [a] = c.lerFilaOffline();
  assert.ok(a.acaoId);
  assert.ok(a.falha);
});
