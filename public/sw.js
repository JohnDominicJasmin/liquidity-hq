const CACHE = 'lhq-v1';
const OFFLINE = '/offline';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.add(OFFLINE))
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

// Only intercept navigation requests — API calls and static assets fail naturally
// so JSON.parse() in API handlers isn't handed the offline HTML page
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {};
  const title = data.title ?? 'LiquidityHQ';
  const body  = data.body  ?? 'New signal';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag:   data.tag ?? 'lhq-alert',
      data:  { url: data.url ?? '/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
