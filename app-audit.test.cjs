const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync('index.html', 'utf8').replace(/\r\n/g, '\n');

// Datas usadas em todo o aplicativo respeitam o dia civil do Brasil.
const inicioDatas = app.indexOf('const fmt =');
const fimDatas = app.indexOf('\n}\n', app.indexOf('function dadosEntregaConcluida', inicioDatas)) + 2;
const datas = {};
vm.runInNewContext(
  app.slice(inicioDatas, fimDatas) + '\nthis.fmtTeste = fmt; this.dataHojeBrasilTeste = dataHojeBrasil;',
  datas,
);
const aindaDiaPrimeiroNoBrasil = new Date('2026-09-02T02:30:00.000Z');
assert.equal(datas.fmtTeste(aindaDiaPrimeiroNoBrasil), '2026-09-01');

// Chamadas paralelas compartilham uma única rotação do refresh token.
const inicioRefresh = app.indexOf('let _refreshEmAndamento');
const fimRefresh = app.indexOf('// Garante um token válido', inicioRefresh);
let chamadasRefresh = 0;
const auth = {
  sessao: { refresh_token: 'refresh-antigo' },
  usuario: null,
  SUPABASE_URL: 'https://projeto.supabase.co',
  SUPABASE_KEY: 'publica',
  fetch: async () => {
    chamadasRefresh++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ok: true, json: async () => ({ access_token: 'novo', refresh_token: 'refresh-novo' }) };
  },
  montarSessao: dados => dados,
  usuarioDoToken: () => ({ login: 'entregador', perfil: 'entregador' }),
  persistirSessao: () => {},
  setTimeout,
};
vm.runInNewContext(app.slice(inicioRefresh, fimRefresh) + '\nthis.authRefreshTeste = authRefresh;', auth);

// A fila offline identifica o usuário e substitui ações repetidas do mesmo pedido.
const memoria = new Map();
const filaContexto = {
  usuario: { login: 'entregador', perfil: 'entregador' },
  localStorage: {
    getItem: chave => memoria.get(chave) ?? null,
    setItem: (chave, valor) => memoria.set(chave, valor),
  },
  console,
  Date,
};
const inicioFila = app.indexOf("const FILA_OFFLINE_KEY = 'kg-fila-offline'");
const fimFila = app.indexOf('let _processandoFila', inicioFila);
vm.runInNewContext(
  app.slice(inicioFila, fimFila) +
    '\nthis.adicionarTeste = adicionarNaFilaOffline; this.lerTeste = lerFilaOffline; this.pertenceTeste = acaoOfflinePertenceAoUsuario;',
  filaContexto,
);

(async () => {
  const resultados = await Promise.all([auth.authRefreshTeste(), auth.authRefreshTeste(), auth.authRefreshTeste()]);
  assert.deepEqual(resultados, [true, true, true]);
  assert.equal(chamadasRefresh, 1);

  let liberarRefresh;
  auth.sessao = { refresh_token: 'refresh-logout' };
  auth.usuario = null;
  auth.fetch = async () => {
    await new Promise(resolve => { liberarRefresh = resolve; });
    return { ok: true, json: async () => ({ access_token: 'tardio', refresh_token: 'novo-tardio' }) };
  };
  const refreshDuranteLogout = auth.authRefreshTeste();
  auth.sessao = null;
  liberarRefresh();
  assert.equal(await refreshDuranteLogout, false);
  assert.equal(auth.sessao, null);
  assert.equal(auth.usuario, null);

  filaContexto.adicionarTeste({ tipo: 'marcar-entregue', pedidoId: 10, payload: { observacao: 'primeira' } });
  filaContexto.adicionarTeste({ tipo: 'marcar-entregue', pedidoId: 10, payload: { observacao: 'final' } });
  assert.equal(filaContexto.lerTeste().length, 1);
  assert.equal(filaContexto.lerTeste()[0].usuarioLogin, 'entregador');
  assert.equal(filaContexto.lerTeste()[0].payload.observacao, 'final');
  assert.equal(filaContexto.pertenceTeste(filaContexto.lerTeste()[0]), true);

  filaContexto.usuario = { login: 'admin', perfil: 'admin' };
  assert.equal(filaContexto.pertenceTeste(filaContexto.lerTeste()[0]), false);

  const sair = app.slice(app.indexOf('function sair()'), app.indexOf('// NAV BOTTOM'));
  assert.doesNotMatch(sair, /removeItem\(FILA_OFFLINE_KEY\)/);
  assert.match(sair, /entrega\(s\) offline foram preservadas/);

  const reset = app.slice(app.indexOf('async function executarResetPedidos'), app.indexOf('// ============================================================\n// ENTREGAS'));
  assert.doesNotMatch(reset, /supabase\('itens_pedido','DELETE'/);
  const excluir = app.slice(app.indexOf('async function excluirPedido'), app.indexOf('// MODAL PRODUTO'));
  assert.doesNotMatch(excluir, /supabase\('itens_pedido','DELETE'/);

  const baixa = app.slice(app.indexOf('async function marcarPagoCliente'), app.indexOf('// MODAL NOVO PEDIDO'));
  assert.match(baixa, /\?id=in\.\(\$\{ids\.join\(','\)\}\)/);
  assert.doesNotMatch(baixa, /Promise\.all\(paraPagar/);

  assert.match(app, /metodo === 'PATCH'\) headers\['Prefer'\] = 'return=minimal'/);
  assert.match(app, /i\.preco_catalogo \?\? ''/);
  assert.match(app, /c\.inscricao_estadual\|\|''/);
  assert.match(app, /if \(!usuario \|\| usuario\.login !== loginInicial\) return/);
  assert.match(html, /<label>Entrega prevista<\/label>/);

  console.log('Auditoria: datas, refresh, fila offline, exclusões, baixa e sincronização validados.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
