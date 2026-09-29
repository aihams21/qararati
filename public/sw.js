// Service worker: يخزّن ملفات التطبيق ليعمل بدون إنترنت.
// ما يخزّن أبداً استدعاءات /api/* — البيانات تبقى حية.

const VERSION = 'v2';
const CACHE = `qararati-${VERSION}`;
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  // بنحدّث الكاش عند التثبيت، والـ activate بيمسح كل النسخ القديمة.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// لو المتصفح كان ماسكنا بالنسخة القديمة، نخلّيه يبلّش الجديد فوراً
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // ⚠️ ليش ما بنستخدم cache-first anymore:
  // cache-first مع اسم ثابت كان يخزّن نسخة app.js قديمة وبيرجّعها
  // للمستخدم للأبد — يعني أي إصلاح جديد ما بيوصل إلا بعد hard refresh
  // يدوي. هاد كان سبب «نص الأشياء مش شغالة» عند المستخدم.
  //
  // الحل: الشبكة أولاً. إذا نجح، بنحدّث الكاش ونرجّع النسخة الجديدة.
  // وإذا ما في نت (طيران/انقطاع)، بنرجع للنسخة المخزّنة.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)
        .then((hit) => hit || caches.match('/index.html')))
  );
});
