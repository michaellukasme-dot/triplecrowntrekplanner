/* Triple Crown Trek Planner — service worker
 * ----------------------------------------------------------------------------
 * STRATEGY (chosen deliberately for this app):
 *   - Navigations / HTML : NETWORK-FIRST, fall back to cached shell when offline.
 *       The whole app is ONE frequently-redeployed index.html. A cache-first
 *       document would trap hikers on a stale build — never do that here.
 *   - Versioned libs/fonts: CACHE-FIRST (stale-while-revalidate). These URLs are
 *       immutable (leaflet@x, supabase-js@2, html2pdf 0.10.1, Google Fonts).
 *   - Supabase API, map tiles, PDFs: NETWORK-ONLY. Dynamic/online; never cached.
 *
 * UPDATE RITUAL: bump CACHE_VERSION whenever you want old caches dropped. Because
 * the SW file changes, the browser detects the update; skipWaiting + clients.claim
 * make it take effect promptly. (HTML is network-first, so the shell is never stuck.)
 * ----------------------------------------------------------------------------
 */

const CACHE_VERSION = 'v40';                       // ⬅ bump on meaningful asset changes (v40: All Treks Farrah full-function — scrub + fullscreen parity; map polish M-2/6/7/9)
const SHELL_CACHE  = 'tctp-shell-'  + CACHE_VERSION;
const ASSET_CACHE  = 'tctp-assets-' + CACHE_VERSION;

// Same-origin shell kept available offline.
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

// Cross-origin hosts that are safe to cache-first (versioned / immutable).
const ASSET_HOSTS = [
  'fonts.googleapis.com', 'fonts.gstatic.com',
  'unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'
];

// Always go to the network for these (substring match on the URL).
const NETWORK_ONLY = [
  'supabase.co',            // Supabase REST/realtime — online only
  'maps.googleapis.com', 'maps.gstatic.com', 'mt0.', 'mt1.', 'mt2.', 'mt3.', // map tiles
  '/og-image.jpg'           // social card, not needed offline
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_URLS).catch(() => {})) // tolerate a missing entry
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((s) => url.includes(s));
}
function isAssetHost(url) {
  let h = '';
  try { h = new URL(url).hostname; } catch (_) {}
  return ASSET_HOSTS.indexOf(h) !== -1;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;               // never intercept writes (Supabase inserts, etc.)
  const url = req.url;
  if (isNetworkOnly(url)) return;                 // let the browser handle it normally

  // 1) Navigations / HTML documents → network-first, cached shell as offline fallback.
  const accept = req.headers.get('accept') || '';
  if (req.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('/')))
    );
    return;
  }

  // 2) Versioned libs/fonts → cache-first, revalidate in the background.
  if (isAssetHost(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // 3) Same-origin static assets (icons, etc.) → cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => cached))
  );
});
