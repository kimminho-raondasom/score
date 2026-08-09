// score Service Worker — 오프라인 캐싱 (2026-08-09)
const CACHE_NAME = 'score-v2';
const ASSETS = [
  '/score/',
  '/score/index.html',
  '/score/data/score_data.js',
  '/score/terms.html',
  '/score/privacy.html',
  '/score/404.html',
  '/score/manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100;300;400;500;700&family=Outfit:wght@100;300;400;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap',
];

// 설치: 핵심 자산 캐시
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리: 캐시 우선, 실패 시 네트워크
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request).then((resp) => {
        // Google Fonts / TMDB 이미지 등 외부 리소스도 캐시
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => {
        // 네트워크 오류 — HTML 요청 시 오프라인 페이지 반환
        if (e.request.headers.get('Accept')?.includes('text/html')) {
          return caches.match('/score/404.html');
        }
      });
    })
  );
});
