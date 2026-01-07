const CACHE_NAME = 'selfie-shot-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/train.html',
    '/css/styles.css',
    '/js/app.js',
    '/js/train.js',
    '/js/face-api.min.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
    // Add models if offline is critical, but they are large. 
    // For now, core app shell is prioritized.
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
