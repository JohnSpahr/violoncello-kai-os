/**
 * Violoncello Service Worker
 * Provides basic offline support and caching
 */

const CACHE_NAME = 'violoncello-v1.0.13';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/src/app.js',
    '/src/css/style.css',
    '/src/kaios-native-ui.js',
    '/src/kaios-native-ui.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.log('Cache addAll failed:', err);
                // Continue even if some assets fail to cache
                return Promise.resolve();
            });
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }

            return fetch(event.request).then((response) => {
                // Don't cache non-successful responses
                if (!response || response.status !== 200 || response.type === 'error') {
                    return response;
                }

                // Clone and cache successful responses
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache).catch((err) => {
                        console.log('Cache put failed:', err);
                    });
                });

                return response;
            }).catch(() => {
                // Network request failed - try to serve offline page if available
                return caches.match('/index.html');
            });
        })
    );
});
