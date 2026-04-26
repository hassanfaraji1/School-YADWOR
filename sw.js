// ============================================================
// YADWOR – sw.js  (Service Worker للإشعارات)
// ============================================================

const CACHE_NAME = 'yadwor-sw-v1';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

// استقبال رسائل من الصفحة الرئيسية
self.addEventListener('message', function(event) {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const title = event.data.title || 'YADWOR';
    const body  = event.data.body  || 'إشعار جديد';
    const url   = event.data.url   || 'notifications.html';

    event.waitUntil(
      self.registration.showNotification(title, {
        body:  body,
        icon:  'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
        badge: 'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
        vibrate: [200, 100, 200],
        tag:  'yadwor-notif',
        renotify: true,
        data: { url: url }
      })
    );
  }
});

// عند النقر على الإشعار → فتح صفحة الإشعارات
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'notifications.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // إذا كانت الصفحة مفتوحة → ركّز عليها وانتقل
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // إذا لم تكن مفتوحة → افتح نافذة جديدة
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Push event — لو دعم المتصفح Web Push Protocol
self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}

  const title = data.title || 'YADWOR – إشعار جديد';
  const body  = data.body  || 'لديك إشعار جديد';
  const url   = data.url   || 'notifications.html';

  event.waitUntil(
    self.registration.showNotification(title, {
      body:  body,
      icon:  'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
      badge: 'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
      vibrate: [200, 100, 200],
      tag:  'yadwor-notif',
      renotify: true,
      data: { url: url }
    })
  );
});
