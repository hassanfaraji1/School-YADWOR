// ============================================================
// YADWOR – sw.js  (Service Worker v4)
// يعمل في الخلفية حتى عند إغلاق المتصفح تماماً
// ============================================================

const SW_VER        = 'yadwor-v4';
const FB_URL        = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
const FB_KEY        = 'AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA';
const ICON          = 'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png';
const NOTIF_PAGE    = 'notifications.html';

// ── حالة داخلية ──
let _uid        = '';
let _type       = '';
let _lastRead   = 0;
let _roomKeys   = new Set();
let _examKeys   = new Set();
let _interKeys  = new Set();
let _ready      = false;   // true بعد أول فحص (لا نرسل إشعارات عن بيانات قديمة)
let _timer      = null;

// ================================================================
// تثبيت + تفعيل
// ================================================================
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});

// ================================================================
// رسائل من الصفحة
// ================================================================
self.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'INIT_SW') {
    var changed = (_uid !== (e.data.uid || ''));
    _uid      = e.data.uid      || '';
    _type     = e.data.userType || '';
    _lastRead = e.data.lastRead || 0;
    if (changed) {
      _ready = false;
      _roomKeys.clear(); _examKeys.clear(); _interKeys.clear();
      if (_timer) { clearTimeout(_timer); _timer = null; }
    }
    if (_uid && !_timer) _scheduleCheck(0);
  }

  if (e.data.type === 'MARK_READ') {
    _lastRead = e.data.ts || Date.now();
  }

  if (e.data.type === 'SHOW_NOTIFICATION') {
    e.waitUntil(
      _notify(e.data.title || 'YADWOR', e.data.body || 'إشعار', 'manual', NOTIF_PAGE)
    );
  }
});

// ================================================================
// نقر على الإشعار → فتح صفحة الإشعارات
// ================================================================
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) ? e.notification.data.url : NOTIF_PAGE;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { c.focus(); if ('navigate' in c) c.navigate(url); return; }
      }
      return self.clients.openWindow ? self.clients.openWindow(url) : null;
    })
  );
});

// ================================================================
// Push من FCM (احتياطي)
// ================================================================
self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(x) {}
  e.waitUntil(_notify(d.title || 'YADWOR', d.body || 'إشعار جديد', 'push', d.url || NOTIF_PAGE));
});

// ================================================================
// عرض الإشعار
// ================================================================
function _notify(title, body, tag, url) {
  return self.registration.showNotification(title, {
    body:     body,
    icon:     ICON,
    badge:    ICON,
    vibrate:  [200, 100, 200],
    tag:      tag || 'yadwor',
    renotify: true,
    data:     { url: url || NOTIF_PAGE }
  });
}

// ================================================================
// جلب من Firebase
// ================================================================
function _get(path) {
  return fetch(FB_URL + '/' + path + '.json?auth=' + FB_KEY)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

// ================================================================
// جدولة الفحص
// ================================================================
function _scheduleCheck(delay) {
  _timer = setTimeout(function() {
    _timer = null;
    _check().then(function() { _scheduleCheck(30000); });
  }, delay == null ? 30000 : delay);
}

// ================================================================
// الفحص الرئيسي
// ================================================================
function _check() {
  if (!_uid) return Promise.resolve();

  // جلب lastRead من Firebase إذا لم يُحدَّد
  var p = Promise.resolve();
  if (!_lastRead) {
    p = _get('userMeta/' + _uid + '/notifLastRead').then(function(v) {
      if (v && typeof v === 'number') _lastRead = v;
    });
  }

  return p
    .then(function() { return _checkRooms(); })
    .then(function() { return _checkExams(); })
    .then(function() { return _checkInter(); })
    .then(function() { _ready = true; })
    .catch(function() {});
}

// ── غرف البث ──
function _checkRooms() {
  return _get('notificationsRoom').then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);
    if (!_ready) { keys.forEach(function(k) { _roomKeys.add(k); }); return; }
    var ps = [];
    keys.forEach(function(k) {
      if (_roomKeys.has(k)) return;
      _roomKeys.add(k);
      var n = data[k];
      if (!n || n.ownerUid === _uid) return;
      if ((n.ts || 0) <= _lastRead) return;
      ps.push(_notify(
        'YADWOR – بث مباشر جديد',
        (n.ownerName || 'أستاذ') + ' بدأ بثاً مباشراً',
        'room-' + k,
        NOTIF_PAGE
      ));
    });
    return Promise.all(ps);
  });
}

// ── تمارين واختبارات ──
function _checkExams() {
  return _get('notifications').then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);
    if (!_ready) { keys.forEach(function(k) { _examKeys.add(k); }); return; }
    if (_type === 'teacher') return;
    var ps = [];
    keys.forEach(function(k) {
      if (_examKeys.has(k)) return;
      _examKeys.add(k);
      var n = data[k];
      if (!n || n.type !== 'exam') return;
      if (n.teacherUid === _uid) return;
      if ((n.publishedAt || 0) <= _lastRead) return;
      ps.push(_notify(
        'YADWOR – تمرين جديد',
        (n.text || ('تمرين جديد في مادة ' + (n.subject || ''))),
        'exam-' + k,
        NOTIF_PAGE
      ));
    });
    return Promise.all(ps);
  });
}

// ── لايكات وتعليقات وردود ──
function _checkInter() {
  return _get('interactions/' + _uid).then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);
    if (!_ready) { keys.forEach(function(k) { _interKeys.add(k); }); return; }
    var ps = [];
    keys.forEach(function(k) {
      if (_interKeys.has(k)) return;
      _interKeys.add(k);
      var n = data[k];
      if (!n) return;
      if ((n.publishedAt || n.timestamp || 0) <= _lastRead) return;
      var title = 'YADWOR';
      var body  = n.text || 'تفاعل جديد';
      if (n.type === 'like')         { title = 'YADWOR – إعجاب جديد';    body = (n.fromName || 'شخص') + ' أعجب بمنشورك'; }
      else if (n.type === 'comment') { title = 'YADWOR – تعليق جديد';    body = (n.fromName || 'شخص') + ' علّق على منشورك'; }
      else if (n.type === 'reply')   { title = 'YADWOR – رد جديد';       body = (n.fromName || 'شخص') + ' ردّ على تعليقك'; }
      ps.push(_notify(title, body, 'inter-' + k, NOTIF_PAGE));
    });
    return Promise.all(ps);
  });
}
