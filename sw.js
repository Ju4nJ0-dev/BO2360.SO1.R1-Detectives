/* Service Worker — Quiz Kahoot PWA
   - Shell (HTML/CSS/JS/íconos): precache + cache-first  → abre sin internet.
   - Fuentes Google y librería QR: cache en runtime.
   - Google Sheets (CSV) y Apps Script: SIEMPRE red (nunca se cachean).
     El respaldo offline de las preguntas lo maneja app.js en localStorage.
*/
const VERSION = 'kahoot-pwa-v3';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/Logo ABC.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Sheets / Apps Script: siempre red, sin cache.
  if (url.hostname.includes('docs.google.com') ||
      url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('google.com')) {
    return;
  }

  // Fuentes y QR (jsDelivr / Google Fonts): cache-first en runtime.
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const res = await fetch(req); c.put(req, res.clone()); return res; }
        catch (err) { return hit || Response.error(); }
      })
    );
    return;
  }

  // Shell (mismo origen): cache-first con respaldo de red.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
