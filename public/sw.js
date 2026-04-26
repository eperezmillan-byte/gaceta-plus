/* ============================================================
   GACETA+ · Service Worker
   - Pre-cachea el "shell" (HTML/CSS/JS/iconos) para abrir
     instantánea aunque no haya red.
   - Para /api/*: network-first con fallback a la última
     respuesta cacheada (datos "stale" mejor que pantalla vacía).
   - Para HTML: network-first, fallback al index.html cacheado.
============================================================ */

const VERSION = 'v1.1.0';
const SHELL_CACHE = `gaceta-shell-${VERSION}`;
const API_CACHE   = `gaceta-api-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// ── Install: precache shell ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: cleanup old caches ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(k => k !== SHELL_CACHE && k !== API_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ── Fetch routing ──────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interceptar dominios externos (YouTube embeds, fuentes, etc.)
  if (url.origin !== self.location.origin) return;

  // /api/* → network-first, fallback a respuesta cacheada
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Navegación HTML → network-first con fallback al shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Guardamos copia fresca del HTML
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Estáticos (CSS, JS, iconos, fuentes locales) → cache-first
  event.respondWith(cacheFirst(req, SHELL_CACHE));
});

// ── Strategies ─────────────────────────────────────────────
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', stale: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    return cached || new Response('', { status: 504 });
  }
}

// ── Periodic Background Sync ──────────────────────────────
// Cuando el navegador lo permite (Android Chrome PWA instalada),
// se dispara este evento periódicamente y refrescamos la caché de la API
// para que al abrir la app los datos ya estén actualizados.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'gaceta-refresh') {
    event.waitUntil(refreshAllData());
  }
});

// Background Sync clásico — fallback cuando vuelve la red tras estar offline.
self.addEventListener('sync', (event) => {
  if (event.tag === 'gaceta-refresh') {
    event.waitUntil(refreshAllData());
  }
});

const ENDPOINTS = [
  '/api/quotes',
  '/api/feed?source=actualidad',
  '/api/feed?source=cnv',
  '/api/youtube'
];

async function refreshAllData() {
  const cache = await caches.open(API_CACHE);
  await Promise.allSettled(
    ENDPOINTS.map(async (url) => {
      try {
        const fresh = await fetch(url, { cache: 'no-store' });
        if (fresh && fresh.ok) {
          await cache.put(url, fresh.clone());
        }
      } catch (err) {
        // En background sync los errores son silenciosos a propósito.
      }
    })
  );

  // Avisar a las pestañas abiertas (si las hay) para que refresquen UI.
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'data-refreshed', at: Date.now() });
  });
}
