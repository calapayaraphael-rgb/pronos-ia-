// Service worker Pronos IA — PWA installable.
// Strategie : les appels API ne sont JAMAIS caches (donnees temps reel,
// token d'auth) ; les fichiers statiques sont servis reseau d'abord avec
// repli cache hors ligne (network-first).
const CACHE = "pronos-ia-v1";
const OFFLINE_URLS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API (meme origine via proxy, ou backend Render) : reseau uniquement.
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await cache.match(e.request);
        return hit || cache.match("/index.html");
      }
    })
  );
});
