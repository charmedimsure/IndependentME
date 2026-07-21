/* IndependentME service worker
   -------------------------------------------------------------
   Bump VERSION on every deploy. That alone retires the old cache
   and pulls fresh files down.

   Pages are fetched network first, so a new deploy lands as soon
   as the tablet has signal. The cache exists only so the app still
   opens when the wifi is down. */

const VERSION = '2026-07-21-d';
const CACHE   = 'independentme-' + VERSION;
const SHELL   = ['./', './index.html', './care.html', './manifest.json', './manifest-care.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;   // never intercept the worker or weather API

  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

// Lets the app force a clean slate from its setup screen
self.addEventListener('message', e => {
  if (e.data === 'wipe') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister());
  }
});
