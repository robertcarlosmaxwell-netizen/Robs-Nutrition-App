// Bump the version any time index.html/app.js/manifest.json/icons change.
// The browser re-installs the service worker whenever this file's bytes change,
// which is what pushes updated files to the installed app.
//
// The prefix matters. This app and the Workout App share one github.io origin,
// and every service worker on an origin sees every cache on it. activate below
// deletes only caches with OUR prefix, never "everything that isn't mine".
const CACHE_PREFIX = 'nutrition-app-';
const CACHE_NAME = CACHE_PREFIX + 'v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache:'reload' skips the HTTP cache, so a fresh deploy can't re-cache a
      // stale app.js under the new version name.
      //
      // Any file failing fails the whole install, so the previous version keeps
      // running instead of activating with a file missing from both caches.
      await Promise.all(ASSETS.map(async (url) => {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res || !res.ok) throw new Error(`${url}: HTTP ${res && res.status}`);
        await cache.put(url, res);
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys
        .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell, falling back to network. Same-origin GETs are
// cached as they come in, which also rebuilds this cache if something outside
// this app deleted it. Proxy calls are POSTs and never touch the cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('', { status: 503, statusText: 'Offline' }));
    })
  );
});
