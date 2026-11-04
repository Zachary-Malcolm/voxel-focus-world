// Service worker template: vite.config.js fills in the version and file list at build time and
// writes it to dist/sw.js. Not imported by the app (and not used in dev).
//  - install: cache every file of this build, so the app opens with no network at all
//  - navigation: network first (picks up a new build when online), cached page when offline
//  - everything else: cache first, then the network (and keep a copy)
//  - activate: delete caches from older builds
const CACHE = 'vfw-__VERSION__';
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(new URL(f, self.registration.scope), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vfw-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const INDEX = new URL('./', self.registration.scope).href;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 3500); // a weak connection shouldn't hold the app up
          const res = await fetch(req, { signal: ctl.signal });
          clearTimeout(timer);
          if (res.ok) (await caches.open(CACHE)).put(INDEX, res.clone());
          return res;
        } catch {
          return (await caches.match(INDEX, { ignoreVary: true })) || (await caches.match(req, { ignoreVary: true })) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      // ignoreVary: servers often send "Vary: Origin", and module scripts carry an Origin header
      // that the precache requests didn't, which would otherwise make every lookup miss offline
      const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
