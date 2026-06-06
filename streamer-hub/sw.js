// DualPost Appraisal Service Worker
const CACHE = 'appraisal-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Network-first strategy — always fetch fresh, fall back to cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push notifications ──────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch(err) { data = { title: 'Streamer Hub', body: e.data.text() }; }
  const options = {
    body: data.body || '',
    icon: '/streamer-hub/icon-192.png',
    badge: '/streamer-hub/icon-192.png',
    tag: data.url || 'streamer-hub-notif',
    renotify: true,
    data: { url: data.url || 'https://twitch.tv' },
  };
  e.waitUntil(self.registration.showNotification(data.title || 'Streamer Hub', options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url ? e.notification.data.url : 'https://twitch.tv';
  e.waitUntil(clients.openWindow(url));
});
