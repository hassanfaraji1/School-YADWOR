// ════════════════════════════════════════════════════════
// YADWOR – sw.js  (Service Worker v5)
// يعمل في الخلفية حتى عند إغلاق Chrome تماماً
// ════════════════════════════════════════════════════════

var FB  = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
var KEY = 'AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA';
var ICON = 'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png';
var PAGE = 'notifications.html';

// حالة داخلية
var _uid       = '';
var _type      = '';
var _lastRead  = 0;
var _roomKeys  = {};
var _examKeys  = {};
var _interKeys = {};
var _ready     = false;
var _timer     = null;

// ════════════════════════════════════════
// تثبيت + تفعيل فوري
// ════════════════════════════════════════
self.addEventListener('install', function(e) {
  // لا ننتظر — نتثبت فوراً
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(e) {
  // نتحكم بكل الصفحات فوراً
  e.waitUntil(
    self.clients.claim().then(function() {
      // ابدأ الفحص بعد التفعيل إذا كان uid موجوداً
      if (_uid) _scheduleCheck(5000);
    })
  );
});

// ════════════════════════════════════════
// رسائل من الصفحة
// ════════════════════════════════════════
self.addEventListener('message', function(e) {
  if (!e || !e.data) return;
  var msg = e.data;

  if (msg.type === 'INIT_SW') {
    var changed = (_uid !== (msg.uid || ''));
    _uid      = msg.uid      || '';
    _type     = msg.userType || '';
    _lastRead = msg.lastRead || 0;
    if (changed) {
      // مستخدم جديد — أعد التهيئة
      _ready    = false;
      _roomKeys = {}; _examKeys = {}; _interKeys = {};
      if (_timer) { clearTimeout(_timer); _timer = null; }
    }
    if (_uid && !_timer) _scheduleCheck(0);
  }

  if (msg.type === 'MARK_READ') {
    _lastRead = msg.ts || Date.now();
    // أعد تعيين المفاتيح المعروفة حتى لا تُرسل إشعارات قديمة بعد القراءة
    _roomKeys = {}; _examKeys = {}; _interKeys = {};
    _ready = false;
    // اجلب المفاتيح الحالية بدون إرسال إشعارات
    _check(true);
  }

  if (msg.type === 'SHOW_NOTIFICATION') {
    e.waitUntil(_notify(
      msg.title || 'YADWOR',
      msg.body  || 'إشعار جديد',
      'manual',
      msg.url   || PAGE
    ));
  }
});

// ════════════════════════════════════════
// النقر على الإشعار
// ════════════════════════════════════════
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) ? e.notification.data.url : PAGE;
  e.waitUntil(
    self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list) {
      // إذا كانت الصفحة مفتوحة → ركّز عليها
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(url) !== -1 && 'focus' in c) {
          return c.focus();
        }
      }
      // إذا كانت أي نافذة مفتوحة → وجّهها للصفحة
      for (var j = 0; j < list.length; j++) {
        if ('focus' in list[j]) {
          list[j].focus();
          if ('navigate' in list[j]) list[j].navigate(url);
          return;
        }
      }
      // افتح نافذة جديدة
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// ════════════════════════════════════════
// Push من خادم FCM (احتياطي)
// ════════════════════════════════════════
self.addEventListener('push', function(e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch(x) {}
  e.waitUntil(_notify(
    d.title || 'YADWOR',
    d.body  || 'إشعار جديد',
    'push',
    d.url   || PAGE
  ));
});

// ════════════════════════════════════════
// عرض إشعار
// ════════════════════════════════════════
function _notify(title, body, tag, url) {
  return self.registration.showNotification(title, {
    body:               body,
    icon:               ICON,
    badge:              ICON,
    vibrate:            [200, 100, 200],
    tag:                tag  || 'yadwor',
    renotify:           true,
    requireInteraction: false,
    data:               { url: url || PAGE }
  });
}

// ════════════════════════════════════════
// جلب من Firebase
// ════════════════════════════════════════
function _get(path) {
  return fetch(FB + '/' + path + '.json?auth=' + KEY)
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });
}

// ════════════════════════════════════════
// جدولة الفحص
// ════════════════════════════════════════
function _scheduleCheck(delay) {
  if (_timer) return; // لا تجدول مرتين
  _timer = setTimeout(function() {
    _timer = null;
    _check(false).then(function() {
      _scheduleCheck(30000); // كل 30 ثانية
    });
  }, delay == null ? 30000 : delay);
}

// ════════════════════════════════════════
// الفحص الرئيسي
// ════════════════════════════════════════
function _check(silentMode) {
  if (!_uid) return Promise.resolve();

  var p = Promise.resolve();

  // جلب lastRead من Firebase إذا لم يُحدَّد بعد
  if (!_lastRead) {
    p = _get('userMeta/' + _uid + '/notifLastRead').then(function(v) {
      if (v && typeof v === 'number') _lastRead = v;
    });
  }

  return p
    .then(function() { return _checkRooms(silentMode); })
    .then(function() { return _checkExams(silentMode); })
    .then(function() { return _checkInter(silentMode); })
    .then(function() { _ready = true; })
    .catch(function() {});
}

// ── غرف البث ──
function _checkRooms(silent) {
  return _get('notificationsRoom').then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);

    // أول تشغيل أو وضع صامت → سجّل فقط
    if (!_ready || silent) {
      keys.forEach(function(k) { _roomKeys[k] = true; });
      return;
    }

    var ps = [];
    keys.forEach(function(k) {
      if (_roomKeys[k]) return;
      _roomKeys[k] = true;
      var n = data[k];
      if (!n || n.ownerUid === _uid) return;
      if ((n.ts || 0) <= _lastRead) return;
      ps.push(_notify(
        'YADWOR – بث مباشر',
        (n.ownerName || 'أستاذ') + ' بدأ بثاً مباشراً' + (n.roomName ? ' "' + n.roomName + '"' : ''),
        'room-' + k,
        PAGE
      ));
    });
    return Promise.all(ps);
  });
}

// ── تمارين واختبارات ──
function _checkExams(silent) {
  if (_type === 'teacher') return Promise.resolve();
  return _get('notifications').then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);

    if (!_ready || silent) {
      keys.forEach(function(k) { _examKeys[k] = true; });
      return;
    }

    var ps = [];
    keys.forEach(function(k) {
      if (_examKeys[k]) return;
      _examKeys[k] = true;
      var n = data[k];
      if (!n || n.type !== 'exam') return;
      if (n.teacherUid === _uid) return;
      if ((n.publishedAt || 0) <= _lastRead) return;
      var body = (n.teacherName ? n.teacherName + ' نشر ' : '') +
                 (n.examType || 'تمرين') +
                 (n.examTitle ? ': ' + n.examTitle : '') +
                 (n.subject ? ' — ' + n.subject : '');
      ps.push(_notify('YADWOR – تمرين جديد', body, 'exam-' + k, PAGE));
    });
    return Promise.all(ps);
  });
}

// ── لايكات + تعليقات + ردود ──
function _checkInter(silent) {
  return _get('interactions/' + _uid).then(function(data) {
    if (!data || typeof data !== 'object') return;
    var keys = Object.keys(data);

    if (!_ready || silent) {
      keys.forEach(function(k) { _interKeys[k] = true; });
      return;
    }

    var ps = [];
    keys.forEach(function(k) {
      if (_interKeys[k]) return;
      _interKeys[k] = true;
      var n = data[k];
      if (!n) return;
      if ((n.publishedAt || n.timestamp || 0) <= _lastRead) return;
      var title = 'YADWOR';
      var body  = 'تفاعل جديد';
      if (n.type === 'like') {
        title = 'YADWOR – إعجاب جديد';
        body  = (n.fromName || 'شخص') + ' أعجب بمنشورك';
      } else if (n.type === 'comment') {
        title = 'YADWOR – تعليق جديد';
        body  = (n.fromName || 'شخص') + ' علّق على منشورك';
        if (n.commentText) body += ': "' + n.commentText.slice(0, 50) + '"';
      } else if (n.type === 'reply') {
        title = 'YADWOR – رد جديد';
        body  = (n.fromName || 'شخص') + ' ردّ على تعليقك';
      }
      ps.push(_notify(title, body, 'inter-' + k, PAGE));
    });
    return Promise.all(ps);
  });
}
