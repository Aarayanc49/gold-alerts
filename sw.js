// Gold Alerts service worker: shows each push as a notification and keeps a copy in
// IndexedDB so the app can list everything that arrived, even while it was closed.
const SHELL = 'gold-alerts-v4';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // network first so a new version shows up at once; the cache covers no signal
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(SHELL).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request)));
});

function db() {
  return new Promise((ok, no) => {
    const r = indexedDB.open('gold-alerts', 2);
    r.onupgradeneeded = () => {
      const names = r.result.objectStoreNames;
      if (!names.contains('alerts')) r.result.createObjectStore('alerts', { keyPath: 'id' });
      if (!names.contains('config')) r.result.createObjectStore('config');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function save(a) {
  const d = await db();
  await new Promise((ok, no) => {
    const tx = d.transaction(['alerts', 'config'], 'readwrite');
    tx.objectStore('alerts').put(a);
    // the PC sends the levels feed's address inside every push, so it never sits in this repo
    if (a.feed) tx.objectStore('config').put(a.feed, 'feed');
    tx.oncomplete = ok; tx.onerror = () => no(tx.error);
  });
  const n = await new Promise(ok => {
    const q = d.transaction('alerts').objectStore('alerts').getAll();
    q.onsuccess = () => ok(q.result.filter(x => !x.read).length);
    q.onerror = () => ok(0);
  });
  if (self.navigator.setAppBadge) self.navigator.setAppBadge(n).catch(() => {});
}

self.addEventListener('push', e => {
  let a;
  try { a = e.data.json(); } catch (_) { a = { title: 'Gold Alerts', body: e.data ? e.data.text() : '' }; }
  a.id = a.id || String(Date.now()) + Math.random().toString(36).slice(2, 6);
  a.t = a.t || Date.now() / 1000;
  a.kind = a.kind || 'info';
  a.read = false;
  e.waitUntil(Promise.all([
    save(a),
    self.registration.showNotification(a.title, {
      body: a.body, tag: a.id, icon: './icon-192.png', badge: './icon-192.png', data: { id: a.id },
    }),
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ type: 'alert' }))),
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    if (cs.length) return cs[0].focus();
    return self.clients.openWindow('./');
  }));
});
