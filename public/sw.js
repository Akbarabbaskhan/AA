/*
 * Volt service worker — the offline shell.
 *
 * Two rules, and the second one was learned the hard way:
 *
 *   1. The build's own output is content-hashed and immutable, so it is cached first and
 *      served from cache. That is what makes the app open on a corridor with no signal.
 *   2. Everything else is a page or a page's data, and is fetched from the network first with
 *      the cache as the offline fallback. Stale data is worse than an error.
 *
 * The attendance register's own offline queue is M1 and lives in the client, not here.
 */
const SHELL_CACHE = 'volt-shell-v2';
const SHELL_ASSETS = ['/', '/login', '/dashboard', '/manifest.webmanifest', '/icon.svg'];

/** Paths whose content never changes for a given deploy. */
const STATIC_FILES = new Set(['/manifest.webmanifest', '/icon.svg', '/favicon.ico']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A single missing asset must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

function cacheFirst(request) {
  return caches
    .match(request)
    .then((cached) => cached ?? fetch(request).then((response) => store(request, response)));
}

function networkFirst(request, offlineFallback) {
  return fetch(request)
    .then((response) => store(request, response))
    .catch(() =>
      caches
        .match(request)
        .then((cached) =>
          cached ?? (offlineFallback ? caches.match(offlineFallback) : Response.error()),
        ),
    );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never serve an API response from cache — stale marks or attendance would be worse
  // than an error.
  if (url.pathname.startsWith('/api/')) return;

  // Content-hashed build output, and the handful of files that do not change within a deploy.
  if (url.pathname.startsWith('/_next/static/') || STATIC_FILES.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /*
   * A document, or the RSC payload the App Router fetches for a soft navigation or a
   * `router.refresh()`. Network first either way; the cache is the fallback when the signal
   * drops, which in a lab or on a sports ground it will.
   *
   * This branch used to be cache-first for everything that was not a document, which quietly
   * included those RSC payloads — and their URLs are keyed by the router's state rather than
   * by the moment, so every refresh after the first one was a cache hit. The screen then kept
   * showing the state from before the write: a student who left a society was still told they
   * were in it, and a student who changed their mind about a leaderboard opt-out could not see
   * that it had worked. Nothing in the app said so, because everything had returned 200.
   */
  event.respondWith(networkFirst(request, request.mode === 'navigate' ? '/dashboard' : null));
});
