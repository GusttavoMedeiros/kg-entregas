const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const cached = new Map();
const cachePutRequests = [];
global.self = {
  location: { origin: 'https://kg-entregas.vercel.app', href: 'https://kg-entregas.vercel.app/sw.js' },
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

async function requestApp(search = '') {
  let response;
  handlers.fetch({
    request: { method: 'GET', url: 'https://kg-entregas.vercel.app/app.js' + search, mode: 'no-cors', destination: 'script' },
    respondWith: promise => { response = promise; },
  });
  return response;
}

async function requestEstilo(search = '') {
  let response;
  handlers.fetch({
    request: { method: 'GET', url: 'https://kg-entregas.vercel.app/ios-like.css' + search, mode: 'no-cors', destination: 'style' },
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
  // Primeiro acesso offline: apenas o arquivo sem query foi pré-cacheado.
  cached.set('https://kg-entregas.vercel.app/app.js', new Response('pre-cache'));
  cached.set('https://kg-entregas.vercel.app/ios-like.css?v=5', new Response('estilo-pre-cache'));
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal(await (await requestApp('?v=53')).text(), 'pre-cache');
  assert.equal(await (await requestEstilo('?v=5')).text(), 'estilo-pre-cache');
  assert.equal((await requestApp('?v=53&outra=1')).status, 503);

  // Atualização conserva os dados offline compatíveis e caches de outros apps.
  const removidos = [];
  global.caches.keys = async () => ['kg-v22-assets', 'kg-v22-data', 'kg-v23-assets', 'kg-v23-data', 'kg-v24-assets', 'kg-v25-assets', 'kg-v26-assets', 'kg-v27-assets', 'kg-v28-assets', 'outro-app'];
  global.caches.delete = async key => { removidos.push(key); return true; };
  let ativacao;
  handlers.activate({ waitUntil: promise => { ativacao = promise; } });
  await ativacao;
  assert.deepEqual(removidos.sort(), ['kg-v22-assets', 'kg-v22-data', 'kg-v23-assets', 'kg-v24-assets', 'kg-v25-assets', 'kg-v26-assets', 'kg-v27-assets', 'kg-v28-assets']);

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
  assert.match(sw, /CACHE_VERSION = 'kg-v29'/);
  assert.match(sw, /\.\/ios-like\.css\?v=5/);
  assert.match(index, /ios-like\.css\?v=5/);
  assert.match(index, /app\.js\?v=53/);
  assert.match(app, /updateViaCache:\s*'none'/);
  assert.match(app, /reg\.update\(\)/);
  console.log('Atualização forçada e fallback offline validados.');
})();
