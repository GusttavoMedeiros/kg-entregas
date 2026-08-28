const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const handlers = {};
const cached = new Map();
global.self = {
  location: { origin: 'https://kg-entregas.vercel.app' },
  addEventListener: (name, handler) => { handlers[name] = handler; },
  skipWaiting: () => {},
  clients: { claim: () => {} },
};
global.caches = {
  open: async () => ({
    match: async request => cached.get(request.url)?.clone(),
    put: async (request, response) => cached.set(request.url, response.clone()),
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

(async () => {
  global.fetch = async () => new Response('versao-nova', { status: 200 });
  assert.equal(await (await requestApp()).text(), 'versao-nova');

  global.fetch = async () => { throw new Error('offline'); };
  assert.equal(await (await requestApp()).text(), 'versao-nova');

  const app = fs.readFileSync('app.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(sw, /CACHE_VERSION = 'kg-v20'/);
  assert.match(index, /app\.js\?v=47/);
  assert.match(app, /updateViaCache:\s*'none'/);
  assert.match(app, /reg\.update\(\)/);
  console.log('Atualização forçada e fallback offline validados.');
})();
