// Service worker：把遊戲殼快取起來，離線也能開單人模式；API 與 WebSocket 一律走網路。
// 版本號每次部署會由 server 的 /sw.js 注入（見 server/index.js），舊快取自動清掉。
const VERSION = self.__SW_VERSION__ || 'dev';
const CACHE = 'stardust-' + VERSION;
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.json', 'icon-192.png', 'icon-512.png',
  'js/main.js', 'js/game.js', 'js/render.js', 'js/effects.js', 'js/audio.js', 'js/input.js', 'js/net.js', 'js/predict.js', 'js/account.js', 'js/analytics.js', 'js/themes.js', 'js/i18n.js', 'js/i18n-extra.js', 'js/cardart.js',
  'shared/constants.js', 'shared/math.js', 'shared/snapshot.js', 'shared/daily.js', 'shared/meta.js',
  'img/bg-space.webp', 'img/bg-inferno.webp', 'img/bg-mercury.webp', 'img/bg-venom.webp', 'img/bg-abyss.webp', 'img/bg-glacier.webp', 'img/logo.webp', 'img/ship-falcon.webp'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname.startsWith('/admin') || url.pathname.startsWith('/music/')) return;
  // 網路優先（拿到就更新快取），斷線才用快取
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
