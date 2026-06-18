const CACHE_NAME = 'vidnestor-v3';
const ASSETS = [
  '/',
  '/manifest.json',
  '/logo.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Do not cache API proxy or download requests
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  // Network-First for HTML/page requests to prevent stale caching of main page
  const isHtml = event.request.headers.get('accept')?.includes('text/html');
  const isIndex = event.request.url === self.location.origin + '/';
  
  if (isHtml || isIndex) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-First for static assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((response) => {
          // Cache static assets dynamically
          if (response.status === 200 && (
            event.request.url.includes('/_next/static/') ||
            event.request.url.includes('.png') ||
            event.request.url.includes('.ico')
          )) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch((err) => {
          console.warn('Network request failed for static asset:', err);
        });
      })
    );
  }
});
