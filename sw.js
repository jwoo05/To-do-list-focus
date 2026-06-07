/**
 * Focus Hub — Service Worker
 *
 * Two jobs:
 *   1. Make the site installable. Chrome / Edge / Brave only show the
 *      "Install app" prompt for sites that have a valid manifest AND
 *      a registered service worker. iOS doesn't require this for
 *      "Add to Home Screen" but having a SW improves the installed
 *      experience (offline shell, proper PWA detection).
 *
 *   2. Cache the app shell so launches from the home screen feel
 *      instant even on flaky networks. We do a "stale-while-revalidate"
 *      style fetch: serve from cache when we have it, then update the
 *      cache in the background for next time.
 *
 * NOTE on user data: we deliberately DO NOT cache Firebase calls or
 * any URL containing tokens / API responses. The app's real persistence
 * layer (S.brainDump, S.tasks, S.events, S.deleted, etc.) lives in
 * localStorage and Firebase Realtime Database — this SW only caches
 * the static shell (HTML/CSS/JS/fonts/icons).
 */

const SHELL_CACHE = 'focus-hub-shell-v3';

// Files that make up the static "app shell". Bump the cache version
// constant above whenever any of these change to force a re-fetch.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/focus-app.css',
  '/focus-logic.js',
  '/focus-auth.js',
  '/firebase-config.js',
  '/manifest.webmanifest',
  '/extension/icons/icon-192.png',
  '/extension/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // Pre-cache the shell so the very first install gets an instant
  // second-launch experience.
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Add files individually so a single 404 doesn't fail the whole
      // install (some routes might 404 in dev).
      Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) =>
            console.warn('[sw] failed to cache', url, err)
          )
        )
      )
    )
  );
  // Activate this SW immediately rather than waiting for tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clear any old shell caches from previous SW versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('focus-hub-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only intercept GET requests for our own origin.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // NEVER cache Firebase calls — user data must always be live.
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.pathname.startsWith('/api/')
  ) return;

  // For everything else: cache-first with background revalidation.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((response) => {
          // Only cache successful basic responses
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(req, response.clone());
          }
          return response;
        })
        .catch(() => cached); // network failed → fall back to cache
      // Serve cached version immediately if present; otherwise wait
      // for network.
      return cached || networkPromise;
    })
  );
});
