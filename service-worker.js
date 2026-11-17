/*!
 * Anti-Suppression Practice — service worker
 * Cache-first for app shell, network fallback.
 */

const VERSION = 'antisup-v3-2026-11-17';
const CACHE_NAME = VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/store.js',
  './src/display.js',
  './src/anaglyph.js',
  './src/observations/targets.js',
  './src/screens/home.js',
  './src/screens/readiness.js',
  './src/screens/observations.js',
  './src/screens/calibration.js',
  './src/screens/settings.js',
  './src/screens/gameselect.js',
  './src/screens/log.js',
  './src/games/tetris.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll fails wholesale if any single request 404s; add individually.
      await Promise.all(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch (err) {
            // Non-fatal: keep install alive so a partial shell still works.
            console.warn('[sw] failed to precache', url, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) {
        // Refresh in the background (stale-while-revalidate-ish), but always
        // answer from cache first for instant loads.
        event.waitUntil(
          fetch(req)
            .then((res) => (res && res.ok ? cache.put(req, res.clone()) : undefined))
            .catch(() => undefined)
        );
        return cached;
      }

      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') {
          cache.put(req, res.clone()).catch(() => undefined);
        }
        return res;
      } catch (err) {
        // Offline fallback for navigations.
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./index.html', { ignoreSearch: true });
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
