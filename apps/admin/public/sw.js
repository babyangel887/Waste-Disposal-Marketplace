/* Waste Admin service worker: login shell offline, never near auth data. */
const CACHE = 'waste-admin-v1';
const SHELL = ['/login', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Cross-origin (the API host) is network-only: never cached, never intercepted.
  if (url.origin !== self.location.origin) return;
  // Same-origin API calls are never cached either.
  if (url.pathname.startsWith('/api/')) return;
  // Static Next.js assets: cache first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }
  // Navigations (including authenticated pages and their RSC payloads):
  // network first, offline fallback to the cached login page. Responses are
  // never stored, so no authenticated data ends up in the cache.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/login')));
    return;
  }
  // Everything else passes through untouched.
});
