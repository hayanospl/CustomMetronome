const CACHE_NAME = 'polyrhythm-metronome-v1.0.0';
const urlsToCache = [
  '/',
  '/index.html',
  '/assets/index.css',
  '/assets/index.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/favicon.ico'
];

// Service Workerのインストール
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('キャッシュを開いています');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('キャッシュの作成中にエラーが発生しました:', error);
      })
  );
});

// Service Workerの起動
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('古いキャッシュを削除しています:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// ネットワークリクエストの処理
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // キャッシュから応答を返すか、ネットワークから取得
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
      .catch(() => {
        // オフライン時の代替応答
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      })
  );
});

// バックグラウンド同期（将来的な機能拡張用）
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

function doBackgroundSync() {
  return Promise.resolve();
}

// プッシュ通知の処理（将来的な機能拡張用）
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : '新しい通知があります',
    icon: '/icon-192.svg',
    badge: '/icon-72.svg',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('メトロノーム', options)
  );
});

// プッシュ通知クリック時の処理
self.addEventListener('notificationclick', event => {
  console.log('通知がクリックされました');
  event.notification.close();

  event.waitUntil(
    clients.openWindow('/')
  );
}); 