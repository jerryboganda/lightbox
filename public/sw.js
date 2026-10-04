// Lightbox service worker: hashed assets cache-first, pages network-first with an offline fallback.
// Only /api/data/* and /api/search-index are cached; every other API (exports, AI, notifications, comments, writes) goes straight to the network.
const V = 'lb-v2';
const STATIC = `${V}-static`, PAGES = `${V}-pages`, DATA = `${V}-data`;
const PRECACHE = ['/offline', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(V)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'clear') e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))));
});

const fromNetwork = async (req, cacheName, ms) => {
  const net = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic' && !res.redirected) caches.open(cacheName).then((c) => c.put(req, res.clone()));
    return res;
  });
  return ms ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), ms))]) : net;
};

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url), p = url.pathname;
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (p.startsWith('/_astro/') || p.startsWith('/_image') || p.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fromNetwork(req, STATIC)));
  } else if (p.startsWith('/api/data/') || p === '/api/search-index') {
    e.respondWith(caches.match(req).then((hit) => { const net = fromNetwork(req, DATA).catch(() => hit); return hit || net; }));
  } else if (req.mode === 'navigate' && !p.startsWith('/api/')) {
    e.respondWith(fromNetwork(req, PAGES, 4000).catch(async () => (await caches.match(req)) || (await caches.match('/offline'))));
  }
});
