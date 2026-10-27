/* sw.js - Service Worker בסיסי ל-PWA: Network First, רק בקשות GET מאותו מקור.
   Hebcal ו-GAS הם מקורות אחרים ולכן אינם עוברים דרכו. */
const CACHE_NAME = 'shabbat-v3-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './manifest.web_manifest',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-apple.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // קובץ שחסר לא מפיל את ההתקנה
      Promise.allSettled(ASSETS.map((a) => cache.add(a)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const index = await caches.match('./index.html');
          if (index) return index;
        }
        return Response.error();
      })
  );
});
