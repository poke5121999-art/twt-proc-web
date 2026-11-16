// Service worker: thử lại khi GitHub Pages / CDN trả 5xx hoặc mất mạng giữa chừng (phiên 8).
// Không lưu cache gì cả: mọi yêu cầu cùng nguồn (GET) đi thẳng ra mạng, chỉ khác là lỗi 5xx / fetch hỏng được thử lại
// tối đa 4 lần (0,4 s, 0,8 s, 1,6 s, 3,2 s). Trước đây một lần 503 cho một module con (robots/robo-hats.js) làm
// import() của cả plug-in tay hỏng và trình duyệt nhớ lỗi đó tới khi tải lại trang.
const TRIES = 5;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function retrying(req) {
  let last = null;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(req.mode === 'navigate' ? req.url : req.clone());
      if (res.status < 500 || i === TRIES - 1) return res;
      last = res;
      console.warn('[sw] ' + res.status + ' ' + req.url + ', retry ' + (i + 1));
    } catch (err) {
      if (i === TRIES - 1) throw err;
      console.warn('[sw] fetch failed ' + req.url + ' (' + (err && err.message) + '), retry ' + (i + 1));
    }
    await wait(400 * Math.pow(2, i));
  }
  return last;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || req.headers.has('range')) return;
  e.respondWith(retrying(req));
});
