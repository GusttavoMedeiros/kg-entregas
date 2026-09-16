const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');
const inicio = app.indexOf('// SERVICE WORKER + ATUALIZAÇÃO AUTOMÁTICA + DETECÇÃO OFFLINE');
const fim = app.indexOf('// ============================================================\n// DETECÇÃO DE STATUS ONLINE/OFFLINE', inicio);
const codigo = app.slice(inicio, fim);

function contexto({ controller = {}, ocupado = false, login = null } = {}) {
  const eventos = {};
  let recarregamentos = 0;
  let intervalo = null;
  const registro = {
    waiting: { postMessage: mensagem => { registro.mensagem = mensagem; } },
    installing: null,
    update: async () => { registro.atualizou = true; },
    addEventListener: (nome, fn) => { registro.eventos = registro.eventos || {}; registro.eventos[nome] = fn; },
  };
  const usuarioInput = { value: '' };
  const senhaInput = { value: '' };
  const c = {
    usuario: login,
    salvando: false,
    sincronizandoDados: false,
    carregandoDados: false,
    _processandoFila: false,
    navigator: {
      onLine: true,
      serviceWorker: {
        controller,
        register: async () => registro,
        addEventListener: (nome, fn) => { eventos[nome] = fn; },
      },
    },
    window: { addEventListener: (nome, fn) => { eventos[nome] = fn; } },
    document: {
      hidden: false,
      activeElement: null,
      getElementById: id => id === 'input-usuario' ? usuarioInput : id === 'input-senha' ? senhaInput : null,
    },
    formularioDeDadosAberto: () => ocupado,
    toast: mensagem => { c.toastMensagem = mensagem; },
    setInterval: (fn) => { intervalo = fn; return 1; },
    clearInterval: () => { intervalo = null; },
    setTimeout: fn => { fn(); return 1; },
    location: { reload: () => { recarregamentos++; } },
    console: { warn() {} },
  };
  vm.runInNewContext(codigo, c);
  return { c, eventos, registro, usuarioInput, senhaInput, get recarregamentos() { return recarregamentos; }, dispararIntervalo: () => intervalo?.() };
}

test('login não exibe mais botão manual de atualização', () => {
  assert.doesNotMatch(html, /btn-atualizar-app|Atualizar aplicativo/);
  assert.doesNotMatch(app, /async function atualizarAplicativo/);
});

test('Service Worker verifica e aplica atualização automaticamente quando a tela está livre', async () => {
  const ctx = contexto({ controller: {} });
  ctx.eventos.load();
  await Promise.resolve();
  assert.equal(ctx.registro.atualizou, true);
  assert.equal(JSON.stringify(ctx.registro.mensagem), JSON.stringify({ type: 'SKIP_WAITING' }));
  ctx.eventos.controllerchange();
  assert.equal(ctx.recarregamentos, 1);
});

test('atualização automática aguarda formulário aberto e continua depois', async () => {
  const ctx = contexto({ controller: {}, ocupado: true, login: { login: 'admin' } });
  ctx.eventos.load();
  await Promise.resolve();
  ctx.eventos.controllerchange();
  assert.equal(ctx.recarregamentos, 0);
  ctx.c.formularioDeDadosAberto = () => false;
  ctx.dispararIntervalo();
  assert.equal(ctx.recarregamentos, 1);
});

test('atualização automática não apaga credenciais que estão sendo digitadas', async () => {
  const ctx = contexto({ controller: {} });
  ctx.senhaInput.value = 'rascunho';
  ctx.eventos.load();
  await Promise.resolve();
  ctx.eventos.controllerchange();
  assert.equal(ctx.recarregamentos, 0);
  ctx.senhaInput.value = '';
  ctx.dispararIntervalo();
  assert.equal(ctx.recarregamentos, 1);
});

test('primeira instalação não recarrega a tela', async () => {
  const ctx = contexto({ controller: null });
  ctx.eventos.load();
  await Promise.resolve();
  ctx.eventos.controllerchange();
  assert.equal(ctx.recarregamentos, 0);
  ctx.eventos.controllerchange();
  assert.equal(ctx.recarregamentos, 1);
});
