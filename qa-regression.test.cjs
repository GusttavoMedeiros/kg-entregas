const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (inicio, fim) => app.slice(app.indexOf(inicio), app.indexOf(fim, app.indexOf(inicio)));

test('Atualização e primeira instalação preservam o formulário aberto', async () => {
  for (const controller of [null, {}]) {
    const eventos = {}; let reloads = 0;
    const c = {
      navigator: { serviceWorker: { controller,
        register: async () => ({ addEventListener() {}, update: async () => {} }),
        addEventListener: (n, f) => { eventos[n] = f; },
      } },
      window: { addEventListener: (n, f) => { eventos[n] = f; }, location: { reload: () => reloads++ } },
      toast() {}, console,
    };
    vm.runInNewContext(trecho('// REGISTRO AUTOMÁTICO DO SERVICE WORKER', '// DETECÇÃO DE STATUS ONLINE/OFFLINE'), c);
    eventos.load(); eventos.controllerchange();
    assert.equal(reloads, 0, 'Não pode destruir rascunho durante controllerchange');
  }
});

function authContext() {
  const timers = new Map(); let sequencia = 0;
  const c = {
    sessao: { access_token: 'a', refresh_token: 'r', expires_at: 0 }, usuario: { login: 'admin' },
    SUPABASE_URL: 'https://teste.invalid', SUPABASE_KEY: 'teste',
    montarSessao: x => x, usuarioDoToken: () => ({ login: 'admin' }), persistirSessao() {},
    atualizarTokenRealtime() {},
    AbortController,
    setTimeout: f => { timers.set(++sequencia, f); return sequencia; },
    clearTimeout: id => timers.delete(id),
    fetch: (_, options) => new Promise((resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
    }),
  };
  vm.runInNewContext(trecho('// Login real:', '// Garante um token válido'), c);
  return { c, timers };
}

test('Login com rede travada tem prazo e libera nova tentativa', async () => {
  const { c, timers } = authContext();
  const resultado = c.authLogin('teste', 'teste');
  assert.equal(timers.size, 1, 'Login sem timeout');
  [...timers.values()][0]();
  assert.equal((await resultado).rede, true);
  assert.equal(timers.size, 0);
});

test('Refresh travado termina e libera o bloqueio compartilhado', async () => {
  const { c, timers } = authContext();
  const resultado = c.authRefresh();
  assert.equal(c.authRefresh(), resultado);
  assert.equal(timers.size, 1, 'Refresh sem timeout');
  [...timers.values()][0]();
  assert.equal(await resultado, false);
  c.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'b', refresh_token: 's' }) });
  assert.equal(await c.authRefresh(), true);
  assert.equal(timers.size, 0);
});

test('Logout durante restauração não reabre app nem acessa sessão nula', async () => {
  for (const online of [true, false]) {
    let liberar; let entradas = 0;
    const c = { SESSAO_KEY: 'sessao', sessao: null, usuario: null, navigator: { onLine: online },
      localStorage: { getItem: () => JSON.stringify({ sessao: { refresh_token: 'r', expires_at: 0 }, usuario: { login: 'admin' } }) },
      authRefresh: () => new Promise(r => { liberar = r; }),
      entrarNoApp: () => entradas++, persistirSessao() {},
    };
    vm.runInNewContext(trecho('async function restaurarSessao()', '// LOGIN / SAIR'), c);
    const restaurando = c.restaurarSessao(); c.sessao = null; c.usuario = null;
    liberar(false); await restaurando;
    assert.equal(entradas, 0);
  }
});

test('Entrega de pedido pré-pago preserva recebimento no modo offline', async () => {
  for (const forma of ['avista', 'boleto']) {
    let payload;
    const pedido = { id: 1, status: 'pendente', status_pagamento: 'pago', forma_pagamento: forma,
      forma_pagamento_real: 'pix', data_pagamento: '2026-09-01' };
    const c = { salvando: false, pedidoSelecionado: pedido, todosOsPedidos: [pedido],
      usuario: { perfil: 'admin' }, MODO_DEMO: false, navigator: { onLine: false },
      document: { getElementById: () => ({ value: '' }), querySelector: () => ({ dataset: { precisaPagamento: '0' } }) },
      dadosEntregaConcluida: () => ({ status: 'entregue', data_entregue_em: '2026-09-09' }),
      adicionarNaFilaOffline: async a => { payload = a.payload; },
      toast() {}, limparChecklist() {}, fecharModal() {}, agendarRender() {},
      botaoSalvando() {}, registrarMudancaLocal() {}, console,
    };
    vm.runInNewContext(trecho('async function confirmarEntrega()', '// EXCLUIR PEDIDO'), c);
    await c.confirmarEntrega();
    assert.equal(payload.status_pagamento, 'pago');
    assert.equal(payload.forma_pagamento_real, 'pix');
    assert.equal(payload.data_pagamento, '2026-09-01');
  }
});
