/* IndependentME service worker
   -------------------------------------------------------------
   Bump VERSION on every deploy. That alone retires the old cache
   and pulls fresh files down.

   Pages are fetched network first, so a new deploy lands as soon
   as the tablet has signal. The cache exists only so the app still
   opens when the wifi is down. */

const VERSION = '2026-07-21-z';
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

/* ============================================================
   Web Push

   A push arrives here even when the app is closed and the phone is
   locked. We show it as a normal notification; tapping it opens (or
   focuses) the care app.
   ============================================================ */
self.addEventListener('push', event => {
  let data = { title: 'IndependentME', body: '' };
  try { if (event.data) data = event.data.json(); } catch (e) {
    try { data.body = event.data.text(); } catch (_) {}
  }
  const title = data.title || 'IndependentME';
  const body  = data.body  || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: 'icon-care-192.png',
      badge: 'icon-care-192.png',
      tag: 'ime-' + Date.now(),
      renotify: true,
      vibrate: [120, 60, 120]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('care.html') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('./care.html');
    })
  );
});
