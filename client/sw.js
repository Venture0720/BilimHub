const CACHE_NAME = 'educenter-v4';
const STATIC_ASSETS = ['/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Network-first for API calls and HTML pages
  if (url.pathname.startsWith('/api/') || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cache the fresh response for offline
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then(cached =>
            cached || new Response(JSON.stringify({ error: 'Нет подключения к интернету' }), {
              status: 503, headers: { 'Content-Type': 'application/json' }
            })
          )
        )
    );
    return;
  }
  // Cache-first for other static assets (CSS, JS libs, fonts)
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});




