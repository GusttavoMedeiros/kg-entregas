// ============================================================
// KG ENTREGAS — Service Worker
// Estratégia:
//   - App principal (HTML/JS/CSS): network-first (sempre atualizado)
//   - Imagens: stale-while-revalidate (carrega instantâneo)
//   - Supabase API: network-first com fallback de cache
//   - Versão do cache muda → SW antigo é removido automaticamente
// ============================================================

const CACHE_VERSION = 'kg-v21';
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;
const DATA_CACHE   = `${CACHE_VERSION}-data`;

// Arquivos do app que ficam em cache permanente
const ASSETS_PARA_CACHEAR = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './logo.webp',
  './logo.png',
  './app-icon-180.png',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon-maskable-512.png',
];

// ============================================================
// INSTALAÇÃO: baixa todos os assets pro cache
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(ASSETS_CACHE)
      .then(cache => cache.addAll(ASSETS_PARA_CACHEAR))
      .then(() => self.skipWaiting()) // ativa imediatamente
  );
});

// ============================================================
// ATIVAÇÃO: remove caches antigos de versões anteriores
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(k => !k.startsWith(CACHE_VERSION))
          .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH: intercepta todas as requisições
// ============================================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1) Só intercepta GET (POST/PATCH/DELETE vão direto pra rede)
  if (event.request.method !== 'GET') return;

  // 2) Ignora requisições de outras origens que não interessam pro cache
  //    Mas DEIXA passar Supabase (pra fazer network-first com fallback)
  const ehSupabase  = url.hostname.endsWith('supabase.co');
  const ehBrasilAPI = url.hostname === 'brasilapi.com.br';
  const ehMesmaOrigem = url.origin === self.location.origin;

  if (!ehMesmaOrigem && !ehSupabase && !ehBrasilAPI) {
    return; // navegador trata normalmente
  }

  // 3) APIs externas (BrasilAPI): network-only com cache de sucesso
  //    Se falhar, devolve do cache (consultas de CNPJ antigas)
  if (ehBrasilAPI) {
    event.respondWith(estrategiaNetworkPrimeiro(event.request, DATA_CACHE));
    return;
  }

  // 4) Supabase: SEMPRE tenta rede primeiro. Cache só como último recurso (offline)
  if (ehSupabase) {
    event.respondWith(estrategiaNetworkPrimeiro(
      event.request, DATA_CACHE, 8000, chaveCacheSupabase(event.request)
    ));
    return;
  }

  // 5) O app principal busca a versão atual antes de recorrer ao cache.
  const ehAppPrincipal = event.request.mode === 'navigate' || ['script', 'style'].includes(event.request.destination);
  event.respondWith(ehAppPrincipal
    ? estrategiaNetworkPrimeiro(event.request, ASSETS_CACHE, 3000)
    : estrategiaStaleWhileRevalidate(event.request, ASSETS_CACHE));
});

// ============================================================
// ESTRATÉGIA: stale-while-revalidate (assets)
// Devolve do cache na hora (rápido!) e, em paralelo, busca a versão
// nova da rede pra atualizar o cache pro próximo acesso.
// O melhor dos dois mundos: velocidade + sempre atualizado.
// ============================================================
async function estrategiaStaleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Busca a versão nova em background (não bloqueia a resposta)
  const buscaRede = fetch(request).then(fresh => {
    if (fresh && fresh.status === 200) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  }).catch(() => null);

  // Se tem no cache, devolve já (instantâneo). Senão, espera a rede.
  if (cached) return cached;
  return (await buscaRede) || new Response('', { status: 503, statusText: 'Offline' });
}

// O Cache API normalmente compara só URL/método, não o Authorization. Cria uma
// chave local por usuário (sub do JWT), sem persistir o token no Cache Storage.
function chaveCacheSupabase(request) {
  let usuarioId = 'sem-usuario';
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const parte = token.split('.')[1];
    if (parte) {
      const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
      const claims = JSON.parse(atob(base64));
      usuarioId = claims.sub || claims.app_metadata?.app_login || usuarioId;
    }
  } catch (e) { /* token inválido: usa chave isolada sem usuário */ }
  const url = new URL(request.url);
  url.searchParams.set('__kg_cache_user', usuarioId);
  return new Request(url.toString(), { method: 'GET' });
}


// ============================================================
// ESTRATÉGIA: network-first (dados)
// Tenta rede com timeout. Se falhar, devolve cache.
// ============================================================
async function estrategiaNetworkPrimeiro(request, cacheName, timeoutMs = 8000, cacheRequest = request) {
  const cache = await caches.open(cacheName);
  try {
    // Timeout curto no app e maior nas APIs, evitando travamento sem perder o fallback offline.
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    let fresh;
    try {
      fresh = await fetch(request, { signal: ctrl.signal });
    } finally {
      clearTimeout(timeoutId);
    }

    // Só guarda no cache se a resposta deu certo
    if (fresh && fresh.status === 200) {
      cache.put(cacheRequest, fresh.clone()).catch(() => {/* ignora erro de quota */});
    }
    return fresh;
  } catch (e) {
    // Rede falhou → tenta cache
    const cached = await cache.match(cacheRequest);
    if (cached) {
      // Marca a resposta para o app saber que veio do cache (offline)
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: { ...Object.fromEntries(cached.headers.entries()), 'x-from-cache': '1' },
      });
    }
    // Sem cache nem rede → 503
    return new Response(JSON.stringify({ erro: 'offline', mensagem: 'Sem conexão e sem cache' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================
// MENSAGENS: o app pode pedir ao SW para skipWaiting (atualizar)
// ============================================================
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
