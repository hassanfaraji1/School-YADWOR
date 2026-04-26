// ============================================================
// YADWOR – sw.js  (Service Worker – نسخة محسّنة)
// ============================================================

const SW_VERSION = 'yadwor-sw-v3';
const FB_DB_URL_SW  = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
const FB_API_KEY_SW = 'AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA';

// ── حالة داخلية في Service Worker ──
let _swUid      = '';
let _swType     = '';
let _swLastRead = 0;
let _knownRoomKeys  = new Set();
let _knownExamKeys  = new Set();
let _knownInterKeys = new Set();
let _swInitialized  = false;
let _watchTimer     = null;

// ── دوال مساعدة ──
function _fbGet(path) {
  return fetch(`${FB_DB_URL_SW}/${path}.json?auth=${FB_API_KEY_SW}`)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

function _showNotif(title, body, tag, url) {
  return self.registration.showNotification(title, {
    body:     body,
    icon:     'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
    badge:    'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
    vibrate:  [200, 100, 200],
    tag:      tag || 'yadwor-notif',
    renotify: true,
    requireInteraction: false,
    data:     { url: url || 'notifications.html' }
  });
}

// ================================================================
// تثبيت وتفعيل
// ================================================================
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

// ================================================================
// استقبال رسائل من الصفحة الرئيسية
// ================================================================
self.addEventListener('message', function(event) {
  if (!event.data) return;

  // الصفحة ترسل بيانات المستخدم للـ SW عند كل تحميل
  if (event.data.type === 'INIT_SW') {
    _swUid      = event.data.uid      || '';
    _swType     = event.data.userType || '';
    _swLastRead = event.data.lastRead || 0;
    // إعادة التهيئة عند تغيير المستخدم
    _swInitialized = false;
    _knownRoomKeys.clear();
    _knownExamKeys.clear();
    _knownInterKeys.clear();
    // إلغاء أي timer سابق وابدأ من جديد
    if (_watchTimer) clearTimeout(_watchTimer);
    _watchTimer = null;
    _checkForNewNotifications();
  }

  // الصفحة تخبر SW بأن المستخدم قرأ الإشعارات
  if (event.data.type === 'MARK_READ') {
    _swLastRead = event.data.ts || Date.now();
  }

  // طلب إرسال إشعار مباشر من الصفحة
  if (event.data.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(
      _showNotif(
        event.data.title || 'YADWOR',
        event.data.body  || 'إشعار جديد',
        'yadwor-manual',
        event.data.url   || 'notifications.html'
      )
    );
  }
});

// ================================================================
// النقر على الإشعار → فتح صفحة الإشعارات
// ================================================================
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'notifications.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.focus();
            if ('navigate' in client) client.navigate(targetUrl);
            return;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ================================================================
// Push event من خادم FCM
// ================================================================
self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  event.waitUntil(
    _showNotif(
      data.title || 'YADWOR – إشعار جديد',
      data.body  || 'لديك إشعار جديد',
      'yadwor-push',
      data.url   || 'notifications.html'
    )
  );
});

// ================================================================
// المراقبة الدورية في الخلفية
// تعمل حتى عند إغلاق جميع نوافذ الموقع
// ================================================================
function _checkForNewNotifications() {
  if (!_swUid) {
    _watchTimer = setTimeout(_checkForNewNotifications, 30000);
    return;
  }

  var checkPromise = Promise.resolve()

  // ── جلب آخر وقت قراءة من Firebase ──
  .then(function() {
    if (_swLastRead) return;
    return _fbGet('userMeta/' + _swUid + '/notifLastRead')
      .then(function(ts) {
        if (ts && typeof ts === 'number') _swLastRead = ts;
      });
  })

  // ── 1. مراقبة إشعارات الغرف ──
  .then(function() {
    return _fbGet('notificationsRoom').then(function(roomData) {
      if (!roomData || typeof roomData !== 'object') return;
      var keys = Object.keys(roomData);

      if (!_swInitialized) {
        keys.forEach(function(k) { _knownRoomKeys.add(k); });
        return;
      }

      var notifPromises = [];
      keys.forEach(function(k) {
        if (_knownRoomKeys.has(k)) return;
        _knownRoomKeys.add(k);
        var n = roomData[k];
        if (!n || n.ownerUid === _swUid) return;
        if ((n.ts || 0) <= _swLastRead) return;

        notifPromises.push(
          _showNotif(
            'YADWOR – بث مباشر جديد 🔴',
            n.text || ((n.ownerName || 'أستاذ') + ' بدأ بثاً مباشراً'),
            'yadwor-room-' + k,
            'notifications.html'
          )
        );
      });
      return Promise.all(notifPromises);
    });
  })

  // ── 2. مراقبة إشعارات التمارين ──
  .then(function() {
    return _fbGet('notifications').then(function(examData) {
      if (!examData || typeof examData !== 'object') return;
      var keys = Object.keys(examData);

      if (!_swInitialized) {
        keys.forEach(function(k) { _knownExamKeys.add(k); });
        return;
      }

      var notifPromises = [];
      keys.forEach(function(k) {
        if (_knownExamKeys.has(k)) return;
        _knownExamKeys.add(k);
        var n = examData[k];
        if (!n || n.type !== 'exam') return;
        if (n.teacherUid === _swUid) return;
        if (_swType === 'teacher') return;
        if ((n.publishedAt || 0) <= _swLastRead) return;

        notifPromises.push(
          _showNotif(
            'YADWOR – تمرين أو اختبار جديد 📋',
            n.text || ('تمرين جديد في مادة ' + (n.subject || '')),
            'yadwor-exam-' + k,
            'notifications.html'
          )
        );
      });
      return Promise.all(notifPromises);
    });
  })

  // ── 3. مراقبة التفاعلات (لايك / تعليق) ──
  .then(function() {
    return _fbGet('interactions/' + _swUid).then(function(interData) {
      if (!interData || typeof interData !== 'object') return;
      var keys = Object.keys(interData);

      if (!_swInitialized) {
        keys.forEach(function(k) { _knownInterKeys.add(k); });
        return;
      }

      var notifPromises = [];
      keys.forEach(function(k) {
        if (_knownInterKeys.has(k)) return;
        _knownInterKeys.add(k);
        var n = interData[k];
        if (!n) return;
        if ((n.publishedAt || n.timestamp || 0) <= _swLastRead) return;

        var typeLabel = n.type === 'like' ? 'أعجب بمنشورك ❤️' : 'علّق على منشورك 💬';
        notifPromises.push(
          _showNotif(
            'YADWOR – ' + typeLabel,
            n.text || typeLabel,
            'yadwor-inter-' + k,
            'notifications.html'
          )
        );
      });
      return Promise.all(notifPromises);
    });
  })

  // ── نهاية الدورة ──
  .then(function() {
    _swInitialized = true;
  })

  .catch(function() {})

  .then(function() {
    // جدولة الفحص التالي بعد 30 ثانية
    _watchTimer = setTimeout(_checkForNewNotifications, 30000);
  });

  return checkPromise;
}
