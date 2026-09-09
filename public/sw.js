// BinaSmart app-shell service worker v3 — every product page opens instantly and still works with no network.
//   navigations  : network first (4 s), then the cached copy of that page, then /offline
//   /static/?v=  : cache first (versioned = immutable); other /static/ : stale-while-revalidate
//   /api/ GET    : network first, cached copy when offline (marked with x-bina-cache: stale)
//   telegram.org : stale-while-revalidate (mini app shell opens offline)
//   map tiles    : cache first with a small LRU; Range requests (pmtiles) are never touched
const VERSION = 'bina-v3';
const SHELL = VERSION + '-shell', STATIC = VERSION + '-static', API = VERSION + '-api', TILES = VERSION + '-tiles';
const PAGES = ['/', '/ride', '/pool', '/watch', '/cinema', '/hotels', '/airport', '/ai', '/offline'];
const CORE = ['/icon-192.png', '/icon-512.png', '/icon-32.png', '/manifest.webmanifest',
  '/static/vendor/maplibre-gl.js', '/static/vendor/maplibre-gl.css', '/static/vendor/pmtiles.js', '/static/fonts/fonts.css?v=1', '/static/ride/style.json'];
const API_SKIP = /\/api\/(assistant|telebirr|pay|knowledge|.*\/ops\/|auth)/;
const TILE_HOST = /(^|\.)maptiler\.com$|(^|\.)tile\./;
const TILE_MAX = 400;

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(PAGES.concat(CORE).map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

function timeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
async function put(name, req, res) { try { const c = await caches.open(name); await c.put(req, res); } catch (e) {} }
function stale(res) {
  const h = new Headers(res.headers); h.set('x-bina-cache', 'stale');
  return res.body ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }) : res;
}
async function trim(name, max) {
  try { const c = await caches.open(name); const keys = await c.keys(); if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k))); } catch (e) {}
}

async function pageFallback(url) {
  const c = await caches.open(SHELL);
  return (await c.match(url.pathname, { ignoreSearch: true })) || (await c.match('/offline')) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await timeout(fetch(req), 4000);
        if (res.ok && url.origin === location.origin && PAGES.includes(url.pathname)) put(SHELL, url.pathname, res.clone());
        return res;
      } catch (err) { return pageFallback(url); }
    })());
    return;
  }

  if (url.origin !== location.origin) {
    if (url.hostname === 'telegram.org') { e.respondWith(swr(STATIC, req)); return; }
    if (TILE_HOST.test(url.hostname) && /\.(png|jpe?g|webp|pbf)(\?|$)/.test(url.pathname)) {
      e.respondWith((async () => {
        const hit = await caches.match(req); if (hit) return hit;
        const res = await fetch(req); if (res.ok) { put(TILES, req, res.clone()); trim(TILES, TILE_MAX); } return res;
      })());
    }
    return;
  }

  if (url.pathname.startsWith('/static/') || /^\/(icon-\d+\.png|manifest\.webmanifest|favicon\.ico)$/.test(url.pathname)) {
    if (url.searchParams.has('v')) {
      e.respondWith((async () => { const hit = await caches.match(req); if (hit) return hit; const res = await fetch(req); if (res.ok) put(STATIC, req, res.clone()); return res; })());
    } else e.respondWith(swr(STATIC, req));
    return;
  }

  if (url.pathname.startsWith('/api/') && !API_SKIP.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const res = await timeout(fetch(req), 8000);
        if (res.ok) put(API, req, res.clone());
        return res;
      } catch (err) {
        const hit = await caches.match(req);
        return hit ? stale(hit) : new Response(JSON.stringify({ ok: false, error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json', 'x-bina-cache': 'offline' } });
      }
    })());
  }
});

async function swr(name, req) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
