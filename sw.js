// COLLECT – Service Worker (Offline-Modus)
// Bei jeder Änderung an dieser Datei SHELL_CACHE hochzählen.
const SHELL_CACHE = 'collect-shell-v2.7';
const COVER_CACHE = 'collect-covers-v1';
const COVER_MAX = 2500;

const PRECACHE_LOCAL = [
  './',
  'index.html',
  'site.webmanifest',
  'covers.json',
  'favicon.webp',
  'icon-192.png',
  'icon-512.png',
  'img/3ds.png', 'img/amiga.png', 'img/atari.png', 'img/gamecube.png', 'img/gb.png',
  'img/gba.png', 'img/gbc.png', 'img/konsole.png', 'img/mastersystem.png', 'img/megadrive.png',
  'img/n64.png', 'img/nds.png', 'img/nes.png', 'img/pc.png', 'img/ps1.png', 'img/ps2.png',
  'img/ps3.png', 'img/ps4.png', 'img/ps5.png', 'img/saturn.png', 'img/snes.png', 'img/switch.png'
];
const PRECACHE_REMOTE = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js'
];

// Statische Fremd-Ressourcen (Skripte, Schriften)
const STATIC_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
// Cover-Bilder
const COVER_HOSTS = ['images.weserv.nl', 'raw.githubusercontent.com', 'upload.wikimedia.org', 'thumb.wikimedia.org'];

self.addEventListener('install', function(event) {
  event.waitUntil((async function() {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(PRECACHE_LOCAL.map(function(u) {
      return cache.add(u).catch(function() {});
    }));
    await Promise.all(PRECACHE_REMOTE.map(function(u) {
      return fetch(new Request(u, { mode: 'no-cors' }))
        .then(function(r) { return cache.put(u, r); })
        .catch(function() {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function(event) {
  event.waitUntil((async function() {
    const keys = await caches.keys();
    await Promise.all(keys.map(function(k) {
      if (k.indexOf('collect-shell-') === 0 && k !== SHELL_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;              // Video-Streaming nicht anfassen
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('.mp4')) return;
    if (req.mode === 'navigate') { event.respondWith(networkFirst(req)); return; }
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (STATIC_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
  if (COVER_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req, COVER_CACHE));
    return;
  }
  // Alles andere (Firestore, Login, eBay, GitHub-API, Wikipedia-API) läuft normal übers Netz
});

// Seite: erst Netz (damit Updates sofort kommen), bei Offline/Timeout aus dem Cache
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise(function(_, rej) { setTimeout(function() { rej(new Error('timeout')); }, 5000); })
    ]);
    if (res && res.ok) cache.put('index.html', res.clone());
    return res;
  } catch(e) {
    return (await cache.match(req, { ignoreSearch: true })) ||
           (await cache.match('index.html')) ||
           (await cache.match('./')) ||
           new Response('<h1 style="font-family:sans-serif">Offline</h1>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: false });
  const net = fetch(req).then(function(res) {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(function() { return null; });
  if (cached) { net.catch(function() {}); return cached; }
  const res = await net;
  return res || new Response('', { status: 504 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      trimCache(cache);
    }
    return res;
  } catch(e) {
    return new Response('', { status: 504 });
  }
}

let trimming = false;
async function trimCache(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const extra = keys.length - COVER_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
