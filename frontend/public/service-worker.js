const CACHE_VERSION = "clinicos-static-v1";
const CORE_ASSETS = ["/", "/manifest.json", "/offline.html", "/favicon.ico", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function isStaticAsset(requestUrl) {
  const pathname = requestUrl.pathname || "";
  if (pathname.startsWith("/api/")) return false;
  if (pathname.includes("/auth/")) return false;
  if (pathname.endsWith(".js") || pathname.endsWith(".css") || pathname.endsWith(".woff2") || pathname.endsWith(".woff") || pathname.endsWith(".ttf")) return true;
  if (pathname.endsWith(".png") || pathname.endsWith(".jpg") || pathname.endsWith(".jpeg") || pathname.endsWith(".webp") || pathname.endsWith(".svg") || pathname.endsWith(".ico")) return true;
  if (pathname === "/" || pathname === "/manifest.json" || pathname === "/offline.html") return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isStaticAsset(url)) return;

  if (url.pathname === "/api/" || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        const copy = networkResponse.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match("/offline.html");
        }
        throw new Error("offline");
      }),
  );
});
