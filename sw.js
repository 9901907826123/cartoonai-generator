const CACHE = 'cartoonai-shell-v17';
const SHELL = ['./', './index.html', './styles.css?v=10', './app.js?v=13', './storage.js', './three-d.js?v=1', './video-studio.js?v=2', './providers.js?v=6', './manifest.json', './editor-icon-192.png', './editor-icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok){ const copy=response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
