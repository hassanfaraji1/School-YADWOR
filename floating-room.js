/* =====================================================
   YADWOR — الصندوق العائم للغرفة النشطة (مشترك)
   floating-room.js
   ===================================================== */

(function() {
  'use strict';

  /* ---- CSS ---- */
  var style = document.createElement('style');
  style.textContent = `
    #yw-frb {
      position: fixed;
      bottom: 80px;
      left: 12px;
      z-index: 9990;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 22px rgba(0,0,0,0.22);
      display: none;
      align-items: center;
      gap: 8px;
      padding: 8px 10px 8px 8px;
      min-width: 175px;
      max-width: 215px;
      border: 1px solid rgba(0,0,0,0.08);
      cursor: grab;
      touch-action: none;
      user-select: none;
      direction: rtl;
      font-family: 'Tajawal', Tahoma, sans-serif;
      transition: box-shadow .15s;
    }
    #yw-frb.show { display: flex; }
    #yw-frb:active { cursor: grabbing; box-shadow: 0 8px 32px rgba(0,0,0,0.28); }
    #yw-frb-av {
      width: 36px; height: 36px; border-radius: 50%;
      border: 2px solid #0084ff; object-fit: cover;
      flex-shrink: 0; background: #e4e6eb;
    }
    #yw-frb-info {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 1px;
    }
    #yw-frb-name {
      font-size: 12px; font-weight: 700; color: #111;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #yw-frb-sub {
      font-size: 10px; color: #0084ff; font-weight: 600;
      display: flex; align-items: center; gap: 3px;
    }
    #yw-frb-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #e53935; animation: ywFrbPulse 1.3s infinite; flex-shrink: 0;
    }
    @keyframes ywFrbPulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:.35; transform:scale(.85); }
    }
    #yw-frb-close {
      width: 26px; height: 26px; border-radius: 50%;
      background: #f1f3f5; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background .15s;
    }
    #yw-frb-close:hover { background: #ffcdd2; }
    #yw-frb-close svg {
      width: 12px; height: 12px; fill: none;
      stroke: #e53935; stroke-width: 2.5; stroke-linecap: round;
      pointer-events: none;
    }
    /* Modal */
    #yw-frb-modal {
      position: fixed; inset: 0; z-index: 9995;
      background: rgba(0,0,0,0.5);
      display: none; align-items: center; justify-content: center;
      padding: 20px; font-family: 'Tajawal', Tahoma, sans-serif;
    }
    #yw-frb-modal.open { display: flex; }
    #yw-frb-mbox {
      background: #fff; border-radius: 16px; padding: 22px 20px;
      width: 100%; max-width: 300px; text-align: center;
      box-shadow: 0 10px 40px rgba(0,0,0,0.25); direction: rtl;
    }
    #yw-frb-mbox h3 {
      font-size: 16px; font-weight: 800; color: #111;
      margin-bottom: 8px; font-family: 'Tajawal', Tahoma, sans-serif;
    }
    #yw-frb-mbox p {
      font-size: 13px; color: #555; margin-bottom: 18px;
      line-height: 1.6; font-family: 'Tajawal', Tahoma, sans-serif;
    }
    .yw-frb-btns { display: flex; gap: 10px; }
    .yw-frb-yes {
      flex: 1; height: 42px; border: none; border-radius: 12px;
      background: #ff4757; color: #fff; font-weight: 800; font-size: 14px;
      cursor: pointer; font-family: 'Tajawal', Tahoma, sans-serif;
    }
    .yw-frb-no {
      flex: 1; height: 42px; border: none; border-radius: 12px;
      background: #f1f3f5; color: #333; font-weight: 700; font-size: 14px;
      cursor: pointer; font-family: 'Tajawal', Tahoma, sans-serif;
    }
  `;
  document.head.appendChild(style);

  /* ---- HTML ---- */
  var frbEl = document.createElement('div');
  frbEl.id = 'yw-frb';
  frbEl.innerHTML = `
    <img id="yw-frb-av" src="" alt=""
         onerror="this.style.background='#e4e6eb';this.removeAttribute('src')">
    <div id="yw-frb-info">
      <div id="yw-frb-name">الغرفة</div>
      <div id="yw-frb-sub">
        <span id="yw-frb-dot"></span>
        <span>مباشر</span>
      </div>
    </div>
    <button id="yw-frb-close" title="خروج من الغرفة">
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="6"  x2="6"  y2="18"/>
        <line x1="6"  y1="6"  x2="18" y2="18"/>
      </svg>
    </button>
  `;
  document.body.appendChild(frbEl);

  var modalEl = document.createElement('div');
  modalEl.id = 'yw-frb-modal';
  modalEl.innerHTML = `
    <div id="yw-frb-mbox">
      <h3>خروج من الغرفة</h3>
      <p>هل تريد حقاً الخروج من الغرفة؟</p>
      <div class="yw-frb-btns">
        <button class="yw-frb-yes" id="yw-frb-yes-btn">نعم، اخرج</button>
        <button class="yw-frb-no"  id="yw-frb-no-btn">إلغاء</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  /* ---- Init ---- */
  function ywFrbInit() {
    var box = document.getElementById('yw-frb');
    if (!box) return;

    var floatData = null;
    try { floatData = JSON.parse(localStorage.getItem('yw_floating_room') || 'null'); } catch(e) {}

    // إخفاء إذا لا توجد غرفة نشطة أو انتهت المدة (24 ساعة)
    if (!floatData || !floatData.roomId) { box.classList.remove('show'); return; }
    if (Date.now() - (floatData.ts || 0) > 24 * 60 * 60 * 1000) {
      localStorage.removeItem('yw_floating_room');
      box.classList.remove('show');
      return;
    }

    // تحديث المعلومات
    var nameEl = document.getElementById('yw-frb-name');
    var avEl   = document.getElementById('yw-frb-av');
    if (nameEl) nameEl.textContent = floatData.roomName || 'الغرفة';
    if (avEl && floatData.avatar) { avEl.src = floatData.avatar; }

    box.classList.add('show');

    // ── السحب المُحسَّن (Drag) ──
    ywFrbInitDrag(box);

    // ── النقر للعودة للغرفة ──
    box.addEventListener('click', function(e) {
      // لا نفتح الغرفة إذا ضغط على زر الإغلاق
      if (e.target.closest('#yw-frb-close')) return;
      // لا نفتح إذا كان مجرد انتهاء سحب
      if (box._wasDragged) { box._wasDragged = false; return; }
      try {
        localStorage.setItem('yw_room_target', JSON.stringify({ roomId: floatData.roomId }));
        sessionStorage.setItem('targetRoom', floatData.roomId);
      } catch(ex) {}
      window.location.href = 'roomvideo.html';
    });

    // ── زر الإغلاق ──
    var closeBtn = document.getElementById('yw-frb-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        ywFrbAskLeave();
      });
    }

    // ── أزرار المودال ──
    var yesBtn = document.getElementById('yw-frb-yes-btn');
    var noBtn  = document.getElementById('yw-frb-no-btn');
    if (yesBtn) yesBtn.addEventListener('click', ywFrbDoLeave);
    if (noBtn)  noBtn.addEventListener('click',  ywFrbCloseModal);
  }

  /* ---- السحب المُحسَّن ---- */
  function ywFrbInitDrag(box) {
    var dragging = false;
    var startX, startY, startLeft, startTop;
    var moveThreshold = 5; // بكسل — لتمييز النقر عن السحب

    function getLeft() {
      return parseInt(box.style.left) || box.getBoundingClientRect().left;
    }
    function getTop() {
      var st = box.style.top;
      if (st && st !== 'auto') return parseInt(st);
      // حوّل bottom إلى top
      var bot = box.style.bottom;
      var botVal = (bot && bot !== 'auto') ? parseInt(bot) : 80;
      return window.innerHeight - box.offsetHeight - botVal;
    }

    function onStart(cx, cy) {
      dragging = true;
      box._wasDragged = false;
      startX = cx; startY = cy;
      startLeft = getLeft();
      startTop  = getTop();
      // نثبّت الموضع
      box.style.bottom = 'auto';
      box.style.top    = startTop + 'px';
      box.style.left   = startLeft + 'px';
    }
    function onMove(cx, cy) {
      if (!dragging) return;
      var dx = cx - startX;
      var dy = cy - startY;
      if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
        box._wasDragged = true;
      }
      var nx = startLeft + dx;
      var ny = startTop  + dy;
      nx = Math.max(4, Math.min(window.innerWidth  - box.offsetWidth  - 4, nx));
      ny = Math.max(4, Math.min(window.innerHeight - box.offsetHeight - 4, ny));
      box.style.left = nx + 'px';
      box.style.top  = ny + 'px';
    }
    function onEnd() { dragging = false; }

    /* Touch */
    box.addEventListener('touchstart', function(e) {
      if (e.target.closest('#yw-frb-close')) return;
      var t = e.touches[0];
      onStart(t.clientX, t.clientY);
    }, { passive: true });
    box.addEventListener('touchmove', function(e) {
      var t = e.touches[0];
      onMove(t.clientX, t.clientY);
      if (box._wasDragged) e.preventDefault();
    }, { passive: false });
    box.addEventListener('touchend', onEnd);

    /* Pointer (Desktop + الأجهزة الحديثة) */
    box.addEventListener('pointerdown', function(e) {
      if (e.target.closest('#yw-frb-close')) return;
      onStart(e.clientX, e.clientY);
      try { box.setPointerCapture(e.pointerId); } catch(_) {}
    });
    box.addEventListener('pointermove', function(e) {
      onMove(e.clientX, e.clientY);
    });
    box.addEventListener('pointerup',     onEnd);
    box.addEventListener('pointercancel', onEnd);
  }

  /* ---- طلب الخروج ---- */
  function ywFrbAskLeave() {
    var m = document.getElementById('yw-frb-modal');
    if (m) m.classList.add('open');
  }
  function ywFrbCloseModal() {
    var m = document.getElementById('yw-frb-modal');
    if (m) m.classList.remove('open');
  }
  function ywFrbDoLeave() {
    var m   = document.getElementById('yw-frb-modal');
    var box = document.getElementById('yw-frb');
    if (m)   m.classList.remove('open');
    if (box) box.classList.remove('show');

    var floatData = null;
    try { floatData = JSON.parse(localStorage.getItem('yw_floating_room') || 'null'); } catch(e) {}

    localStorage.removeItem('yw_floating_room');
    localStorage.removeItem('yw_active_room');
    localStorage.removeItem('yw_room_target');
    localStorage.removeItem('yw_room_mode');

    // إغلاق الغرفة في Firebase إذا كان صاحبها
    if (floatData && floatData.roomId && floatData.isOwner) {
      try {
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
          firebase.database().ref('rooms/' + floatData.roomId).update({
            closed: true,
            closedReason: 'تم إخراج الجميع بسبب خروج صاحب الغرفة',
            closedAt: Date.now(),
            closedBy: null
          });
          setTimeout(function() {
            firebase.database().ref('rooms/' + floatData.roomId).remove().catch(function(){});
          }, 5000);
        }
      } catch(ex) {}
    }
  }

  // تصدير للاستخدام الخارجي
  window.ywFrbAskLeave    = ywFrbAskLeave;
  window.ywFrbCloseModal  = ywFrbCloseModal;
  window.ywFrbDoLeave     = ywFrbDoLeave;
  window.ywInitFloatingBox = ywFrbInit;

  // تشغيل عند اكتمال الصفحة
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ywFrbInit);
  } else {
    ywFrbInit();
  }

})();
