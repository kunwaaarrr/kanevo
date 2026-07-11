// ponytail: simple cache-first offline shell; bump VERSION on deploys
const VERSION = 'sapientspend-v23';
const ASSETS = [
  './', 'index.html', 'manifest.json', 'fonts/figtree-var.woff2',
  'css/app.css', 'css/budget.css',
  'css/register.css', 'css/reports.css', 'css/loans.css',
  'css/fifty.css', 'css/forecast.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/seed.js',
  'js/lib/fifty.js', 'js/lib/forecast.js', 'js/lib/csv.js', 'js/lib/categorize.js',
  'js/views/budget.js', 'js/views/register.js', 'js/views/reports.js',
  'js/views/loans.js', 'js/views/settings.js',
  'js/views/fifty.js', 'js/views/forecast.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // network-first (bypassing the HTTP cache) so edits ship immediately; cache answers when offline
  e.respondWith(fetch(e.request, { cache: 'no-store' }).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
