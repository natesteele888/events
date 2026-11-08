// Network first: updates show right away; the saved copy is only for offline.
const CACHE = "events-v8";
// Save the page itself at install. Without this, the first visit caches nothing
// (the page loaded before the worker existed), so opening it offline right after
// installing fails. Each file is added on its own so one miss can't block install.
// Same-origin app files only: no Firebase, no guest or RSVP data.
const SHELL = ["./", "index.html", "config.js", "manifest.json", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
});
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("events-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  // Same-origin only, so Firebase traffic is never touched and guest data is never cached.
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
