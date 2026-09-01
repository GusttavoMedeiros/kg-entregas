const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const cached = new Map();
const cachePutRequests = [];
global.self = {
  location: { origin: 'https://kg-entregas.vercel.app' },
  addEventListener: (name, handler) => { handlers[name] = handler; },
  skipWaiting: () => {},
  clients: { claim: () => {} },
};
global.caches = {
  open: async () => ({
    match: async request => cached.get(request.url)?.clone(),
    put: async (request, response) => {
      cachePutRequests.push(request);
      cached.set(request.url, response.clone());
    },
  }),
  keys: async () => [],
  delete: async () => true,
};

const sw = fs.readFileSync('sw.js', 'utf8');
vm.runInThisContext(sw);

async function requestApp() {
  let response;
  handlers.fetch({
    request: { method: 'GET', url: 'https://kg-entregas.vercel.app/app.js', mode: 'navigate', destination: 'script' },
    respondWith: promise => { response = promise; },
  });
  return response;
}

async function requestSupabase(token) {
  let response;
  handlers.fetch({
    request: new Request('https://eatmzxyckqrsjrlyosfg.supabase.co/rest/v1/pedidos?select=*', {
      headers: { Authorization: `Bearer ${token}` },
    }),
    respondWith: promise => { response = promise; },
  });
  return response;
}

async function requestAssetSemCache() {
  let response;
  handlers.fetch({
    request: { method: 'GET', url: 'https://kg-entregas.vercel.app/ausente.png', mode: 'no-cors', destination: 'image' },
    respondWith: promise => { response = promise; },
  });
  return response;
}

function tokenPara(sub) {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `cabecalho.${payload}.assinatura`;
}

(async () => {
  global.fetch = async () => new Response('versao-nova', { status: 200 });
  assert.equal(await (await requestApp()).text(), 'versao-nova');

  global.fetch = async () => { throw new Error('offline'); };
  assert.equal(await (await requestApp()).text(), 'versao-nova');

  // Sem cache e sem rede, imagens recebem uma resposta 503 válida (não null).
  assert.equal((await requestAssetSemCache()).status, 503);

  // Respostas autenticadas ficam separadas por usuário e o token não é salvo
  // como parte da Request usada no Cache Storage.
  const tokenA = tokenPara('usuario-a');
  const tokenB = tokenPara('usuario-b');
  global.fetch = async request => new Response(
    request.headers.get('Authorization') === `Bearer ${tokenA}` ? 'dados-a' : 'dados-b',
    { status: 200 },
  );
  assert.equal(await (await requestSupabase(tokenA)).text(), 'dados-a');
  assert.equal(await (await requestSupabase(tokenB)).text(), 'dados-b');

  global.fetch = async () => { throw new Error('offline'); };
  assert.equal(await (await requestSupabase(tokenA)).text(), 'dados-a');
  assert.equal(await (await requestSupabase(tokenB)).text(), 'dados-b');
  const chavesSupabase = cachePutRequests.filter(r => r.url.includes('supabase.co'));
  assert.ok(chavesSupabase.every(r => !r.headers.get('Authorization')));
  assert.equal(new Set(chavesSupabase.map(r => r.url)).size, 2);

  const app = fs.readFileSync('app.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(sw, /CACHE_VERSION = 'kg-v21'/);
  assert.match(index, /app\.js\?v=48/);
  assert.match(app, /updateViaCache:\s*'none'/);
  assert.match(app, /reg\.update\(\)/);
  console.log('Atualização forçada e fallback offline validados.');
})();
