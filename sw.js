// 앱 껍데기만 캐시한다. Supabase·CDN 요청은 건드리지 않는다.
// 파일을 바꾸면 CACHE 이름의 버전을 올려서 옛 캐시가 지워지게 한다.
const CACHE = 'couple-v15';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/calc.js',
  './js/categories.js',
  './js/config.js',
  './js/ledger.js',
  './js/supabase.js',
  './js/todo.js',
  './js/schedule.js',
  './js/fixed.js',
  './js/home.js',
  './js/push.js',
  './js/weather.js',
  './js/anniv.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 같은 출처 GET 만: 네트워크 먼저, 실패하면 캐시.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
  );
});

// ---- 푸시 알림 ----
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text() }; }
  const title = data.title || '우리집';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.tag || 'couple',
      renotify: true,
      data: { url: data.url || './#home' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './#home', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin));
      if (open) return open.focus().then((c) => c.navigate?.(url) ?? c);
      return self.clients.openWindow(url);
    }),
  );
});
