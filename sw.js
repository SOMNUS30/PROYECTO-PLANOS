/* ==========================================================================
   ECOSOL PLANOS - Service Worker (PWA Offline & Desktop Installation)
   ========================================================================== */

const CACHE_NAME = 'ecosol-planos-cache-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './assets/ecosol-logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './js/mock-data.js',
  './js/cloud-sync.js',
  './js/auth.js',
  './js/pdf-editor.js',
  './js/admin.js',
  './js/app.js',
  './js/pwa.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('PWA Precache warning (some files skipped):', err);
      });
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

// Network-First strategy: Always prioritize real-time cloud data, fallback to cache
self.addEventListener('fetch', (event) => {
  const req = event.request;
  
  // Only handle GET requests with http/https schemes
  if (req.method !== 'GET' || !req.url.startsWith('http')) {
    return;
  }

  // Do not intercept Supabase or Render backend API calls
  if (req.url.includes('supabase.co') || req.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkResponse) => {
        // Cache successful responses for offline use
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(req).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If HTML request failed and not in cache, fallback to index.html
          if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
