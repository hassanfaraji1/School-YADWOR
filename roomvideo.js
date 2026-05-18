    firebase.initializeApp({
        apiKey: "AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA",
        authDomain: "a-comment-5a3e5.firebaseapp.com",
        databaseURL: "https://a-comment-5a3e5-default-rtdb.firebaseio.com",
        projectId: "a-comment-5a3e5",
        storageBucket: "a-comment-5a3e5.appspot.com",
        messagingSenderId: "557343451166",
        appId: "1:557343451166:web:d181f098cdeccf7691260f"
    });
    const db = firebase.database(), auth = firebase.auth();

    // ─── حالة ───
    let me = null, roomId = null, roomData = null, isOwner = false, ownerUid = null;
    let mySeatIdx = null, localStream = null;
    let micOn = false, spkOn = true, handUp = false, chatVis = false;
    // ── WebRTC — متغيرات الحالة ──
    let studentPC = null;       // PC المشاهد (جهة المشاهد)
    let studentRef = null;      // Firebase ref للمشاهد في /students
    const teacherPeerConns = {}; // { studentKey: {pc, audioEl, uid} } — جهة الأستاذ
    // servers مُعرَّف لاحقاً في قسم WebRTC مع STUN متعددة
    let usingFrontCamera = true;
    let isSwitchingCamera = false;
    let currentCameraIndex = 0;
    let SEATS = 20;

    // ─── جلب بيانات المستخدم — المصدر الوحيد الموثوق هو localStorage ───
    function getLocalUser() {
        // uid الحقيقي المحفوظ عند التسجيل
        const uid  = localStorage.getItem('yadwor-uid') || '';
        const name = localStorage.getItem('yadwor-settings-name')
                  || localStorage.getItem('yadwor-user-name')
                  || 'مستخدم';
        // الصورة الحقيقية المحفوظة من Cloudinary أو التسجيل
        const avatar = localStorage.getItem('yadwor-avatar-preview') || '';
        const type   = localStorage.getItem('yadwor-profile-type')
                    || localStorage.getItem('yadwor-account-type')
                    || 'influencer';
        return {
            uid:    uid || ('guest_' + Date.now()),
            name,
            avatar,
            type
        };
    }

    // ─── بدء — لا نعتمد على Firebase Auth لأن المستخدمين يسجلون عبر localStorage ───
    function initRoomUser() {
        const localUser = getLocalUser();

        // قراءة roomId
        let rt = null;
        try { rt = JSON.parse(sessionStorage.getItem('yw_room_target')); } catch {}
        if (!rt) { try { rt = JSON.parse(localStorage.getItem('yw_room_target')); } catch {} }
        roomId = (rt && rt.roomId)
            || sessionStorage.getItem('targetRoom')
            || sessionStorage.getItem('targetVoiceRoom')
            || localStorage.getItem('targetRoom');
        if (!roomId) { showRoomError('لم يتم تحديد الغرفة', 'roomhom.html'); return; }

        // جلب بيانات المستخدم من Firebase/users إن وُجدت — لتحديث الصورة فقط
        if (localUser.uid && !localUser.uid.startsWith('guest_')) {
            db.ref('users/' + localUser.uid).once('value', snap => {
                const u = snap.val() || {};
                const fbAvatar = u.avatar || '';
                // الأولوية: localStorage > Firebase
                me = {
                    uid:    localUser.uid,
                    name:   localUser.name,
                    avatar: localUser.avatar || fbAvatar || '',
                    frame:  u.activeFrameUrl || '',
                    badge:  u.badge || '',
                    points: u.points || 0,
                    coins:  u.coins || 0
                };
                // إذا وجدنا صورة في Firebase ولم تكن محفوظة محلياً — احفظها
                if (fbAvatar && !localUser.avatar) {
                    try { localStorage.setItem('yadwor-avatar-preview', fbAvatar); } catch(e) {}
                    me.avatar = fbAvatar;
                }
                loadRoom();
            }).catch(() => {
                me = { uid: localUser.uid, name: localUser.name, avatar: localUser.avatar, frame:'', badge:'', points:0, coins:0 };
                loadRoom();
            });
        } else {
            // ضيف بدون uid حقيقي
            me = { uid: localUser.uid, name: localUser.name, avatar: localUser.avatar, frame:'', badge:'', points:0, coins:0 };
            loadRoom();
        }
    }

    // نبدأ مباشرة بدون انتظار Firebase Auth
    initRoomUser();

    function loadRoom() {
        // تفعيل keepSynced للحصول على البيانات فوراً
        try { db.ref('rooms/' + roomId).keepSynced(true); } catch(e) {}
        db.ref('rooms/' + roomId).once('value', snap => {
            roomData = snap.val();

            // إذا لم تكن الغرفة في Firebase، ابحث عنها في localStorage
            if (!roomData) {
                try {
                    const localRooms = JSON.parse(localStorage.getItem('yadwor-rooms') || '[]');
                    const localRoom = localRooms.find(r => r.roomId === roomId);
                    if (localRoom) { roomData = localRoom; }
                } catch(e) {}
            }
            if (!roomData) { showRoomError('الغرفة غير موجودة أو تم حذفها', 'roomhom.html'); return; }

            // دعم كل مفاتيح الـ owner الممكنة
            ownerUid = roomData.ownerId || roomData.teacherUid || roomData.ownerUid || null;
            isOwner  = !!(ownerUid && me.uid && ownerUid === me.uid);

            // تحقق إضافي من yw_active_room
            if (!isOwner) {
                try {
                    const activeRoom = JSON.parse(localStorage.getItem('yw_active_room') || '{}');
                    if (activeRoom && activeRoom.isOwner === true && activeRoom.roomId === roomId) {
                        // تحقق إضافي: uid المالك المحفوظ
                        const savedOwnerUid = localStorage.getItem('yw_room_owner_uid') || '';
                        if (!savedOwnerUid || savedOwnerUid === me.uid) {
                            isOwner = true;
                        }
                    }
                } catch(e) {}
            }

            // تأكد أن بيانات صاحب الغرفة تطابق shared.js عند الإنشاء
            if (isOwner) {
                const localUser = getLocalUser();
                if (!me.name || me.name === 'مستخدم' || me.name === 'U') me.name = localUser.name;
                if (!me.avatar) me.avatar = localUser.avatar;
            }

            if (isOwner && !me.frame) { me.frame = roomData.ownerFrame || roomData.ownerFrameUrl || roomData.frame || ''; }
            SEATS = 20;
            document.getElementById('roomLabel').textContent = roomData.roomName || 'YADWOR';
            document.title = roomData.roomName || 'غرفة فيديو';
            // عدد المشاهدين يظهر للجميع
            document.getElementById('pCount').style.display = 'flex';
            if (isOwner) {
                document.getElementById('switchCamBtn').style.display = 'flex';
                document.getElementById('boardBtn').style.display = 'flex';
                // ابدأ heartbeat الأستاذ
                startOwnerHeartbeat();
            } else {
                // المشاهدون: زر العدد يفتح قائمة مشاهدين فقط (بدون صلاحية تحكم)
                document.getElementById('pCount').onclick = function() { openViewersModalReadOnly(); };
            }
            buildSeatsHTML();
            listenSeats();
            listenChatDB();
            listenRoomState();
            enterRoom();
            listenKicksAndBans();
            listenSeatInvites();
            listenSpotlight();
            listenOwnerOverlay();
            bindProfileButtons();
            // ── بدء مستمعات Firebase للسبورة مبكراً لجميع المستخدمين ──
            // هذا يضمن أن الطلاب يستمعون لـ boardOpen قبل أن يضغط الأستاذ على السبورة
            setTimeout(function() {
                if (typeof brdStartFirebaseListeners === 'function') {
                    brdStartFirebaseListeners();
                }
            }, 500);
            document.getElementById('loader').style.display = 'none';
            document.getElementById('roomPage').style.display = 'flex';
            // إظهار صورة الأستاذ تلقائياً عند الدخول — يمكنه إظهار الكاميرا بنفسه لاحقاً
            if (isOwner) {
                setTimeout(function() {
                    if (typeof initOwnerAvatarOverlay === 'function') initOwnerAvatarOverlay();
                }, 1200);
            }
        });
    }

    // ─── بناء HTML للمقاعد ───
    function buildSeatsHTML() {
        const wrap = document.getElementById('seatsWrap');
        wrap.innerHTML = '';
        for (let row = 0; row < Math.ceil(SEATS / 4); row++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'vrow';
            for (let col = 0; col < 4; col++) {
                const i = row * 4 + col;
                if (i >= SEATS) break;
                rowDiv.innerHTML += `
                    <div class="vsb" id="vsb${i}">
                        <div class="vci" id="vci${i}" onclick="onSeat(${i})">
                            <i class="fas fa-plus vplus"></i>
                        </div>
                        <span class="vlb" id="vlb${i}">متاح</span>
                    </div>`;
            }
            wrap.appendChild(rowDiv);
        }
    }

    // ─── المقاعد ───
    const __lastEmoTs = {}; // تتبع آخر ts إيموجي لكل مقعد لتجنب التكرار
    function listenSeats() {
        // تفعيل الذاكرة المحلية لـ Firebase لضمان الظهور الفوري عند الدخول
        const seatsRef = db.ref('rooms/' + roomId + '/seats');
        try { seatsRef.keepSynced(true); } catch(e) {}

        // اجلب البيانات فوراً أولاً (once) لضمان الرسم السريع دون انتظار المستمع
        seatsRef.once('value', function(initSnap) {
            const initAll = initSnap.val() || {};
            let cnt = 0;
            window._seatsUids = new Set();
            for (let i = 0; i < SEATS; i++) {
                renderSeat(i, initAll[i] || null);
                if (initAll[i] && initAll[i].userId) {
                    cnt++;
                    window._seatsUids.add(initAll[i].userId);
                }
            }
            // أضف المشاهدين غير الجالسين فقط
            db.ref('rooms/' + roomId + '/viewers').once('value', function(vs) {
                var vd = vs.val() || {};
                var vCnt = Object.keys(vd).filter(uid => !window._seatsUids.has(uid)).length;
                document.getElementById('pCnt').textContent = cnt + vCnt;
                window._viewersCnt = vCnt;
            });
        });

        // مستمع /viewers لتحديث العداد فوراً عند كل دخول/خروج
        db.ref('rooms/' + roomId + '/viewers').on('value', function(vs) {
            var vd = vs.val() || {};
            var seatsUids = window._seatsUids || new Set();
            // احسب فقط المشاهدين غير الجالسين في مقاعد
            window._viewersCnt = Object.keys(vd).filter(uid => !seatsUids.has(uid)).length;
            _updateTotalCount();
        });

        // ثم ابدأ الاستماع المباشر للتغييرات
        seatsRef.on('value', snap => {
            const all = snap.val() || {};
            let cnt = 0;
            window._seatsUids = new Set();
            for (let i = 0; i < SEATS; i++) {
                const seatData = all[i] || null;
                // كشف إيموجي جديد — أظهر الإشعار لجميع المستخدمين
                if (seatData && seatData.emoji && seatData.emoji.ts) {
                    const emoTs = seatData.emoji.ts;
                    if (emoTs !== __lastEmoTs[i] && (Date.now() - emoTs < 9000)) {
                        __lastEmoTs[i] = emoTs;
                        showEmojiNotif(i, seatData.name || 'مستخدم', seatData.avatar || '', seatData.emoji.imgUrl || '');
                    }
                }
                renderSeat(i, seatData);
                if (seatData && seatData.userId) {
                    cnt++;
                    window._seatsUids.add(seatData.userId);
                }
            }
            window._seatsCnt = cnt;
            // أعد حساب المشاهدين بعد تحديث المقاعد
            db.ref('rooms/' + roomId + '/viewers').once('value', function(vs) {
                var vd = vs.val() || {};
                window._viewersCnt = Object.keys(vd).filter(uid => !window._seatsUids.has(uid)).length;
                _updateTotalCount();
            });
        });
    }

    // دالة مساعدة لتحديث عداد الأشخاص (بدون تكرار)
    function _updateTotalCount() {
        var seats   = window._seatsCnt   || 0;
        var viewers = window._viewersCnt || 0;
        var el = document.getElementById('pCnt');
        if (el) el.textContent = seats + viewers;
    }

    function renderSeat(i, data) {
        const ci = document.getElementById('vci' + i);
        const lb = document.getElementById('vlb' + i);
        const sb = document.getElementById('vsb' + i);
        if (!ci || !lb || !sb) return;
        ci.innerHTML = ''; ci.className = 'vci'; ci.onclick = () => onSeat(i);
        sb.querySelectorAll('.vmic').forEach(el => el.remove());
        ci.querySelectorAll('.vfr').forEach(el => el.remove());
        if (data && data.userId) {
            const name   = data.name   || 'مستخدم';
            const avatar = data.avatar || '';
            const frame  = data.frame  || '';
            const isMe   = data.userId === me.uid;
            ci.classList.add('active');
            ci.dataset.uid = data.userId;
            ci.dataset.seat = String(i);
            ci.dataset.name = name;
            ci.onclick = () => openProfile(name, avatar, data.userId, i, true);
            // shimmer Facebook لصورة المقعد
            const sh = document.createElement('div'); sh.className = 'vci-shimmer'; ci.appendChild(sh);
            const img = document.createElement('img'); img.className = 'avim';
            img._tryN = 0; img._srcBase = avatar || '';
            // أضف الصورة للـ DOM أولاً قبل ضبط src لضمان تفعيل load event
            ci.appendChild(img);
            img.addEventListener('load', () => {
                ci.classList.add('loaded');
            });
            function __tryLoadAvatar() {
                if (!img._srcBase) {
                    ci.classList.add('loaded');
                    return;
                }
                img._tryN++;
                var sep = img._srcBase.includes('?') ? '&' : '?';
                img.src = img._srcBase + sep + '_t=' + Date.now();
            }
            img.addEventListener('error', () => {
                if (img._tryN < 2) {
                    setTimeout(__tryLoadAvatar, 800);
                } else if (img._tryN === 2) {
                    // محاولة أخيرة بالرابط الأصلي بدون cache-busting
                    img._tryN++;
                    img.src = img._srcBase;
                } else {
                    // فشل التحميل — أظهر الشيمر بشكل دائم
                    ci.classList.add('loaded');
                    sh.style.animation = 'none';
                    sh.style.background = '#dde3ee';
                    try { img.removeAttribute('src'); } catch(e) {}
                }
            });
            if (avatar) {
                img.src = avatar;
                // إذا كانت الصورة محفوظة في cache فلن يُطلَق load event — نتحقق يدوياً
                if (img.complete && img.naturalWidth > 0) {
                    ci.classList.add('loaded');
                }
            } else {
                ci.classList.add('loaded');
                sh.style.animation = 'none';
                sh.style.background = '#dde3ee';
            }
            // الإيموجي — دائماً أنشئ عنصراً جديداً داخل ci (لأن ci.innerHTML يُمسح في كل render)
            const em = document.createElement('div'); em.className = 'vemo'; sb._emoEl = em; ci.appendChild(em);
            const emo = data.emoji || null;
            if (emo && emo.ts) {
                const now = Date.now(); const left = (emo.ts + 8000) - now;
                if (left > 0) {
                    clearTimeout(sb._emoTO);
                    sb._emoEl.classList.remove('show');
                    // دعم صور URL من Firebase وكذلك SVG القديم
                    if (emo.imgUrl) {
                        sb._emoEl.innerHTML = `<img src="${emo.imgUrl}" style="width:34px;height:34px;object-fit:contain;display:block;" onerror="this.style.display='none'">`;
                    } else {
                        const svgMap = window.__EMOJI_SVGS__ || {};
                        const svg = (emo.id && svgMap[emo.id]) ? svgMap[emo.id] : '';
                        sb._emoEl.innerHTML = svg || `<span style="font-size:24px;">😊</span>`;
                    }
                    void sb._emoEl.offsetWidth;
                    sb._emoEl.classList.add('show');
                    sb._emoTO = setTimeout(() => { if (sb && sb._emoEl) sb._emoEl.classList.remove('show'); }, left);
                } else { if (sb._emoEl) { sb._emoEl.classList.remove('show'); clearTimeout(sb._emoTO); } }
            } else { if (sb._emoEl) { sb._emoEl.classList.remove('show'); clearTimeout(sb._emoTO); } }
            if (frame) {
                const fr = document.createElement('img'); fr.className = 'vfr'; fr.src = frame;
                fr.onerror = () => fr.remove(); ci.appendChild(fr);
            }
            if (isMe) {
                const mc = document.createElement('div');
                mc.className = 'vmic me ' + (micOn ? 'on' : 'off');
                mc.id = 'vMyMic';
                mc.onclick = e => { e.stopPropagation(); toggleMic(); };
                mc.innerHTML = micOn
                    ? '<i class="fas fa-microphone" style="font-size:6px"></i>'
                    : '<i class="fas fa-microphone-slash" style="font-size:6px"></i>';
                sb.appendChild(mc);  // على vsb لكي لا يُقطع بـ overflow:hidden
                var mcBtnEl2 = document.getElementById('mcBtn');
                if (mcBtnEl2) mcBtnEl2.style.display = '';
            } else {
                if (data.micOn !== undefined) {
                    const omc = document.createElement('div');
                    if (data.ownerMuted) {
                        omc.className = 'vmic owner-muted';
                        omc.innerHTML = '<i class="fas fa-microphone-slash" style="font-size:6px"></i>';
                    } else {
                        omc.className = 'vmic ' + (data.micOn ? 'on' : 'off');
                        omc.innerHTML = data.micOn
                            ? '<i class="fas fa-microphone" style="font-size:6px"></i>'
                            : '<i class="fas fa-microphone-slash" style="font-size:6px"></i>';
                    }
                    sb.appendChild(omc);  // على vsb لكي لا يُقطع
                }
            }
            // بادج رفع اليد — محذوف
            var seatDisplayName = name.length > 8 ? name.slice(0,8)+'…' : name;
            var seatVerifyBadge = _pmVerifyBadge(data.userId, data.verified || data.isVerified || false);
            if (seatVerifyBadge) {
                lb.style.overflow = 'visible';
                lb.innerHTML = seatDisplayName + seatVerifyBadge;
            } else {
                lb.style.overflow = '';
                lb.textContent = seatDisplayName;
                // tag للتحديث اللاحق
                lb.dataset.verifyUid = data.userId;
            }
            if (i === 0) ci.style.borderColor = '#f1c40f';
        } else {
            ci.classList.remove('active'); ci.classList.remove('loaded');
            try { delete ci.dataset.uid; delete ci.dataset.seat; delete ci.dataset.name; } catch(e) {}
            ci.innerHTML = '<i class="fas fa-plus vplus"></i>';
            lb.textContent = 'متاح';
        }
    }

    function onSeat(i) {
        if (isOwner) {
            // صاحب الغرفة: مقعد 0 هو مقعده الثابت، بقية المقاعد يفتحها لاختيار مشاهد
            if (i === 0) return;
            openSeatPicker(i);
            return;
        }
        // المشاهد / المنضم
        if (i === 0) return; // مقعد 0 حصري لصاحب الغرفة
        // تحقق هل المقعد مشغول بشخص آخر
        db.ref('rooms/' + roomId + '/seats/' + i).once('value', snap => {
            const seatData = snap.val();
            if (seatData && seatData.userId && seatData.userId !== me.uid) {
                // المقعد مشغول — افتح ملف الشخص الجالس
                openProfile(seatData.name || 'مستخدم', seatData.avatar || '', seatData.userId, i, true);
                return;
            }
            // المقعد فارغ أو أنا جالس فيه
            if (mySeatIdx === i) {
                // اضغط مرة ثانية على مقعدي = قم
                db.ref('rooms/' + roomId + '/seats/' + i).remove();
                mySeatIdx = null;
                if (studentRef) studentRef.update({ seated: false, seatIndex: null });
                handUp = false;
                // أعِد التسجيل كمشاهد بعد القيام من المقعد
                db.ref('rooms/' + roomId + '/viewers/' + me.uid).set({ name: me.name, avatar: me.avatar || '', ts: Date.now() });
                // إخفاء زر المايك وإطفاء المايك عند القيام من المقعد
                if (micOn) { micOn = false; if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false; }); }
                var mcBtnEl = document.getElementById('mcBtn');
                if (mcBtnEl) mcBtnEl.style.display = 'none';
                var mcIcoEl = document.getElementById('mcIco');
                if (mcIcoEl) { mcIcoEl.className = 'fas fa-microphone-slash'; mcIcoEl.style.color = '#ff4757'; }
            } else {
                // انتقل للمقعد الجديد
                if (mySeatIdx !== null) {
                    // إذا كان لديّ مقعد بالفعل (قبلني المالك سابقاً) — يمكنني التنقل بحرية
                    db.ref('rooms/' + roomId + '/seats/' + mySeatIdx).remove();
                    mySeatIdx = null;
                    takeSeat(i);
                    return;
                }
                // هل الطابور مفعّل؟
                if (window._roomQueueOn) {
                    // تحقق هل تم حظر الشخص مؤقتاً من الطلب (بعد الإزالة)
                    if (window._seatRemovedUntil && Date.now() < window._seatRemovedUntil) {
                        showSnack('لا يمكنك طلب الجلوس الآن. انتظر لحظة', '🚫');
                        return;
                    }
                    // تحقق هل لديّ طلب معلّق بالفعل
                    db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).once('value', function(rs) {
                        if (rs.exists()) {
                            // حدّث المقعد المطلوب فقط
                            db.ref('rooms/' + roomId + '/queueRequests/' + me.uid + '/seatWanted').set(i);
                            showSnack('تم تحديث طلبك — انتظر موافقة أدمين الغرفة', '🪑');
                        } else {
                            requestSeat(i);
                        }
                    });
                } else {
                    takeSeat(i);
                }
            }
        });
    }

    function takeSeat(i) {
        const sd = {
            userId: me.uid, name: me.name, avatar: me.avatar,
            frame: me.frame || '', badge: me.badge || '',
            micOn: false, ts: Date.now()
        };
        var seatRef = db.ref('rooms/' + roomId + '/seats/' + i);
        seatRef.set(sd);
        // عند انقطاع الاتصال فجأة — أزل المقعد تلقائياً (للطلاب فقط)
        if (!isOwner) seatRef.onDisconnect().remove();
        mySeatIdx = i;
        // احذف من /viewers عند الجلوس لمنع الاحتساب المزدوج
        db.ref('rooms/' + roomId + '/viewers/' + me.uid).remove();
        if (!isOwner && studentRef) {
            studentRef.update({ seated: true, seatIndex: i });
        }
        // تفعيل mic عند الجلوس
        if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
        // إظهار زر المايك عند الجلوس
        var mcBtnEl = document.getElementById('mcBtn');
        if (mcBtnEl) mcBtnEl.style.display = '';
    }

    // ══════════════════════════════════════════════════════════════
    //  WebRTC — نظام احترافي Production-Ready
    //  مُصمَّم مثل Zoom / Google Meet
    //  الأستاذ (isOwner) = Broadcaster
    //  المنظم (!isOwner) = Viewer/Participant
    // ══════════════════════════════════════════════════════════════

    // ── ICE Servers المتقدمة ──
    const servers = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun.services.mozilla.com' }
        ],
        iceCandidatePoolSize: 10
    };

    // ── Logger احترافي ──
    var _rtcLog = function(tag, msg, data) {
        var ts = new Date().toISOString().substr(11, 8);
        if (data !== undefined) {
            console.log('[RTC ' + ts + '] [' + tag + '] ' + msg, data);
        } else {
            console.log('[RTC ' + ts + '] [' + tag + '] ' + msg);
        }
    };

    // ══════════════════════════════════════════════════════════════
    //  BROADCASTER (isOwner) — يُنشئ PC لكل مشارك
    //  مثل createPeerForStudent في المثال الأصلي
    // ══════════════════════════════════════════════════════════════

    async function createPeerForOrganizer(studentKey, studentUid) {
        // منع التكرار
        if (teacherPeerConns[studentKey]) {
            _rtcLog('BC', 'peer already exists for ' + studentKey);
            return;
        }

        // انتظر localStream حد أقصى 12 ثانية
        if (!localStream || localStream.getTracks().every(function(t){ return t.readyState === 'ended'; })) {
            _rtcLog('BC', 'waiting for localStream...');
            var _waited = 0;
            await new Promise(function(resolve) {
                var _check = setInterval(function() {
                    _waited += 150;
                    if ((localStream && localStream.getTracks().some(function(t){ return t.readyState === 'live'; })) || _waited >= 12000) {
                        clearInterval(_check);
                        resolve();
                    }
                }, 150);
            });
        }

        if (!localStream || localStream.getTracks().every(function(t){ return t.readyState === 'ended'; })) {
            _rtcLog('BC', 'no localStream — aborting peer for ' + studentKey);
            return;
        }

        // تحقق مرة أخرى بعد الانتظار (قد يكون أُنشئ بالفعل)
        if (teacherPeerConns[studentKey]) return;

        _rtcLog('BC', 'creating peer for student=' + studentKey + ' uid=' + studentUid);

        // ── إنشاء RTCPeerConnection ──
        var pc = new RTCPeerConnection(servers);

        // ── عنصر صوت المشارك (لاستقبال صوته) ──
        var audioEl = document.createElement('audio');
        audioEl.id = 'remoteAudio_' + studentKey;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.setAttribute('playsinline', '');
        audioEl.muted = false;
        audioEl.volume = spkOn ? 1.0 : 0.0;
        document.body.appendChild(audioEl);

        // ── ICE buffer محلي لهذا الـ peer ──
        var _iceBuf = [];
        var _remoteSet = false;
        var _answerRef = db.ref('rooms/' + roomId + '/answers/' + studentKey);
        var _iceRef    = db.ref('rooms/' + roomId + '/candidates/' + studentKey + '/fromStudent');
        var _reconnectTimer = null;
        var _isDestroyed = false;

        // ── تسجيل الـ peer ──
        teacherPeerConns[studentKey] = {
            pc: pc,
            audioEl: audioEl,
            uid: studentUid || '',
            _offRef: _answerRef,
            _iceRef: _iceRef,
            _iceBuf: _iceBuf
        };

        // ── ICE candidates → Firebase ──
        pc.onicecandidate = function(ev) {
            if (ev.candidate) {
                db.ref('rooms/' + roomId + '/candidates/' + studentKey + '/fromTeacher')
                    .push(JSON.stringify(ev.candidate.toJSON()));
            }
        };

        // ── استقبال tracks من المشارك ──
        pc.ontrack = function(ev) {
            _rtcLog('BC', 'ontrack ' + ev.track.kind + ' from ' + studentKey);
            ev.track.onunmute = function() {
                _rtcLog('BC', 'track unmuted: ' + ev.track.kind + ' from ' + studentKey);
            };
            if (ev.track.kind === 'audio') {
                var stream = (ev.streams && ev.streams[0]) ? ev.streams[0] : new MediaStream([ev.track]);
                audioEl.srcObject = stream;
                audioEl.muted = false;
                audioEl.volume = spkOn ? 1.0 : 0.0;
                _bcPlayAudio(audioEl, 0);
            }
            if (ev.track.kind === 'video') {
                // spotlight: حفظ stream فيديو المشارك إذا كان في spotlight
                teacherPeerConns[studentKey]._videoStream = (ev.streams && ev.streams[0])
                    ? ev.streams[0]
                    : new MediaStream([ev.track]);
            }
        };

        // ── helper: تشغيل صوت مع retry ──
        function _bcPlayAudio(el, attempt) {
            if (_isDestroyed) return;
            if (!el || !el.srcObject) return;
            el.play().catch(function() {
                if (attempt < 15 && !_isDestroyed) {
                    setTimeout(function() { _bcPlayAudio(el, attempt + 1); }, 600);
                }
            });
        }

        // ── مراقبة حالة ICE ──
        pc.oniceconnectionstatechange = function() {
            var st = pc.iceConnectionState;
            _rtcLog('BC', 'ICE state [' + studentKey + ']: ' + st);
            if (st === 'connected' || st === 'completed') {
                clearTimeout(_reconnectTimer);
                if (audioEl.srcObject && audioEl.paused) {
                    _bcPlayAudio(audioEl, 0);
                    setTimeout(function() { _bcPlayAudio(audioEl, 0); }, 500);
                }
            }
            if (st === 'failed') {
                _rtcLog('BC', 'ICE failed for ' + studentKey + ' — attempting restart');
                clearTimeout(_reconnectTimer);
                _reconnectTimer = setTimeout(function() {
                    if (_isDestroyed) return;
                    if (teacherPeerConns[studentKey] && teacherPeerConns[studentKey].pc === pc) {
                        _bcTryIceRestart(studentKey, pc, _iceBuf, _remoteSet);
                    }
                }, 1500);
            }
            if (st === 'disconnected') {
                clearTimeout(_reconnectTimer);
                _reconnectTimer = setTimeout(function() {
                    if (_isDestroyed) return;
                    if (teacherPeerConns[studentKey] && teacherPeerConns[studentKey].pc === pc) {
                        _rebuildPeerForOrganizer(studentKey, studentUid || '');
                    }
                }, 4000);
            }
        };

        pc.onconnectionstatechange = function() {
            var st = pc.connectionState;
            _rtcLog('BC', 'conn state [' + studentKey + ']: ' + st);
            if (st === 'failed') {
                clearTimeout(_reconnectTimer);
                _reconnectTimer = setTimeout(function() {
                    if (_isDestroyed) return;
                    if (teacherPeerConns[studentKey] && teacherPeerConns[studentKey].pc === pc) {
                        _rebuildPeerForOrganizer(studentKey, studentUid || '');
                    }
                }, 2000);
            }
        };

        // ── إضافة جميع tracks من localStream قبل createOffer ──
        // نستخدم addTransceiver لضمان وجود sender حتى مع video مستقبَل
        var _videoTrack = localStream.getVideoTracks()[0];
        var _audioTrack = localStream.getAudioTracks()[0];

        if (_videoTrack) {
            try {
                pc.addTransceiver(_videoTrack, {
                    direction: 'sendrecv',
                    streams: [localStream]
                });
            } catch(e) {
                try { pc.addTrack(_videoTrack, localStream); } catch(e2) {}
            }
        } else {
            // لا يوجد video حالياً — جهّز transceiver استقبال فقط
            try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch(e) {}
        }

        if (_audioTrack) {
            try {
                pc.addTransceiver(_audioTrack, {
                    direction: 'sendrecv',
                    streams: [localStream]
                });
            } catch(e) {
                try { pc.addTrack(_audioTrack, localStream); } catch(e2) {}
            }
        } else {
            try { pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch(e) {}
        }

        // ── createOffer ──
        var offer;
        try {
            offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            _rtcLog('BC', 'offer created for ' + studentKey);
        } catch(err) {
            _rtcLog('BC', 'createOffer failed: ' + err.message);
            _bcDestroyPeer(studentKey);
            return;
        }

        // ── رفع الـ offer لـ Firebase ──
        try {
            await db.ref('rooms/' + roomId + '/offers/' + studentKey).set(JSON.stringify(offer));
        } catch(err) {
            _rtcLog('BC', 'firebase set offer failed: ' + err.message);
            _bcDestroyPeer(studentKey);
            return;
        }

        // ── استقبال Answer ──
        _answerRef.on('value', async function(snap) {
            if (!snap.exists() || _isDestroyed) return;
            var answerStr = snap.val();
            if (!answerStr) return;
            if (pc.signalingState === 'closed') return;
            if (pc.currentRemoteDescription) return; // تم التطبيق مسبقاً
            try {
                var answerDesc = new RTCSessionDescription(JSON.parse(answerStr));
                await pc.setRemoteDescription(answerDesc);
                _remoteSet = true;
                teacherPeerConns[studentKey]._remoteSet = true;
                _rtcLog('BC', 'remote description set for ' + studentKey);
                // تطبيق ICE candidates المحجوزة
                var buffered = _iceBuf.splice(0);
                for (var i = 0; i < buffered.length; i++) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(buffered[i]));
                    } catch(e) {}
                }
            } catch(e) {
                _rtcLog('BC', 'setRemoteDescription error: ' + e.message);
            }
        });

        // ── استقبال ICE candidates من المشارك ──
        _iceRef.on('child_added', async function(snap) {
            if (!snap.val() || _isDestroyed) return;
            try {
                var cand = JSON.parse(snap.val());
                if (_remoteSet && pc.remoteDescription && pc.signalingState !== 'closed') {
                    await pc.addIceCandidate(new RTCIceCandidate(cand));
                } else {
                    _iceBuf.push(cand);
                }
            } catch(e) {}
        });

        // ── ICE Restart helper ──
        async function _bcTryIceRestart(key, peerConn, iceBuf, remoteSet) {
            if (!peerConn || peerConn.signalingState === 'closed') {
                _rebuildPeerForOrganizer(key, studentUid || '');
                return;
            }
            try {
                var restartOffer = await peerConn.createOffer({ iceRestart: true });
                await peerConn.setLocalDescription(restartOffer);
                await db.ref('rooms/' + roomId + '/offers/' + key).set(JSON.stringify(restartOffer));
                _rtcLog('BC', 'ICE restart offer sent for ' + key);
            } catch(e) {
                _rebuildPeerForOrganizer(key, studentUid || '');
            }
        }

        // ── Destroy helper ──
        function _bcDestroyPeer(key) {
            _isDestroyed = true;
            clearTimeout(_reconnectTimer);
            try { _answerRef.off(); } catch(e) {}
            try { _iceRef.off(); } catch(e) {}
            var conn = teacherPeerConns[key];
            if (conn) {
                try { if (conn.pc) { conn.pc.ontrack = null; conn.pc.onicecandidate = null; conn.pc.oniceconnectionstatechange = null; conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch(e) {}
                try { if (conn.audioEl) conn.audioEl.remove(); } catch(e) {}
                delete teacherPeerConns[key];
            }
        }
    }

    // ── الأستاذ: إعادة بناء اتصال موجود مع منظم ──
    async function _rebuildPeerForOrganizer(studentKey, studentUid) {
        _rtcLog('BC', 'rebuilding peer for ' + studentKey);
        var oldConn = teacherPeerConns[studentKey];
        if (oldConn) {
            try { if (oldConn._offRef) oldConn._offRef.off(); } catch(e) {}
            try { if (oldConn._iceRef) oldConn._iceRef.off(); } catch(e) {}
            try {
                if (oldConn.pc) {
                    oldConn.pc.ontrack = null;
                    oldConn.pc.onicecandidate = null;
                    oldConn.pc.oniceconnectionstatechange = null;
                    oldConn.pc.onconnectionstatechange = null;
                    oldConn.pc.close();
                }
            } catch(e) {}
            try { if (oldConn.audioEl) oldConn.audioEl.remove(); } catch(e) {}
            delete teacherPeerConns[studentKey];
        }
        // احذف بيانات Firebase القديمة
        try {
            await db.ref('rooms/' + roomId + '/offers/'     + studentKey).remove();
            await db.ref('rooms/' + roomId + '/answers/'    + studentKey).remove();
            await db.ref('rooms/' + roomId + '/candidates/' + studentKey).remove();
        } catch(e) {}
        // انتظر قليلاً ثم أنشئ اتصالاً جديداً
        await new Promise(function(r){ setTimeout(r, 400); });
        await createPeerForOrganizer(studentKey, studentUid);
    }

    // ══════════════════════════════════════════════════════════════
    //  VIEWER (المنظم) — يستقبل البث ويرد على offer الأستاذ
    // ══════════════════════════════════════════════════════════════

    // متغيرات ICE buffer للمشاهد
    var _scIceBuf = [];
    var _scRemoteSet = false;
    var _scAnswerRef = null;
    var _scIceRef    = null;
    var _scReconnectTimer = null;
    var _scDestroyed = false;

    async function createOrganizerPeerAndAnswer(offerStr) {
        _rtcLog('VW', 'createOrganizerPeerAndAnswer called');

        // أغلق الاتصال القديم
        if (studentPC) {
            _scDestroyed = true;
            clearTimeout(_scReconnectTimer);
            try { if (_scAnswerRef) _scAnswerRef.off(); } catch(e) {}
            try { if (_scIceRef)   _scIceRef.off();   } catch(e) {}
            try {
                studentPC.ontrack = null;
                studentPC.onicecandidate = null;
                studentPC.oniceconnectionstatechange = null;
                studentPC.onconnectionstatechange = null;
                studentPC.onnegotiationneeded = null;
                studentPC.close();
            } catch(e) {}
            studentPC = null;
        }

        _scIceBuf = [];
        _scRemoteSet = false;
        _scDestroyed = false;

        var myKey = studentRef ? studentRef.key : null;
        if (!myKey) {
            _rtcLog('VW', 'no studentRef key — aborting');
            return;
        }

        // ── إنشاء RTCPeerConnection ──
        studentPC = new RTCPeerConnection(servers);
        var _pc = studentPC; // مرجع محلي ثابت

        // ── عنصر صوت الأستاذ ──
        var sAudio = document.getElementById('studentRemoteAudio');
        if (!sAudio) {
            sAudio = document.createElement('audio');
            sAudio.id = 'studentRemoteAudio';
            document.body.appendChild(sAudio);
        }
        sAudio.autoplay = true;
        sAudio.playsInline = true;
        sAudio.setAttribute('playsinline', '');
        sAudio.muted = false;
        sAudio.volume = 1.0;

        // ── helper تشغيل الصوت مع retry ──
        function _vwPlayAudio(el, attempt) {
            if (_scDestroyed) return;
            if (!el || !el.srcObject) return;
            el.play().catch(function() {
                if (attempt < 20 && !_scDestroyed) {
                    setTimeout(function() { _vwPlayAudio(el, attempt + 1); }, 400 + attempt * 30);
                }
            });
        }

        // ── helper تشغيل الفيديو مع retry ──
        function _vwPlayVideo(el, attempt) {
            if (_scDestroyed) return;
            if (!el || !el.srcObject) return;
            el.play().catch(function() {
                if (attempt < 20 && !_scDestroyed) {
                    setTimeout(function() { _vwPlayVideo(el, attempt + 1); }, 400);
                }
            });
        }

        // ── أضف tracks الميكروفون إذا كانت جاهزة ──
        var _audioTrack = (localStream && localStream.getAudioTracks().find(function(t){ return t.readyState === 'live'; }))
                        || window.__pendingAudioTrack || null;

        if (_audioTrack && _audioTrack.readyState !== 'ended') {
            try {
                _pc.addTransceiver(_audioTrack, {
                    direction: 'sendrecv',
                    streams: [localStream || new MediaStream([_audioTrack])]
                });
            } catch(e) {
                try { _pc.addTrack(_audioTrack, localStream || new MediaStream([_audioTrack])); } catch(e2) {}
            }
        } else {
            // سنُضيف الميك لاحقاً عند وصوله
            try { _pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch(e) {}
        }

        // video transceiver لاستقبال الفيديو
        try { _pc.addTransceiver('video', { direction: 'recvonly' }); } catch(e) {}

        // ── ontrack — قلب النظام ──
        var _remoteVideoStream = new MediaStream();
        var _remoteAudioStream = new MediaStream();
        var _videoTrackReceived = false;

        _pc.ontrack = function(ev) {
            _rtcLog('VW', 'ontrack: ' + ev.track.kind + ' readyState=' + ev.track.readyState);
            var tvEl = document.getElementById('tv');

            // منع إضافة tracks مكررة
            if (ev.track.kind === 'video') {
                if (!_remoteVideoStream.getTracks().find(function(t){ return t.id === ev.track.id; })) {
                    _remoteVideoStream.addTrack(ev.track);
                }
                _videoTrackReceived = true;

                ev.track.onunmute = function() {
                    _rtcLog('VW', 'video track unmuted');
                    if (tvEl && tvEl.srcObject !== _remoteVideoStream) {
                        tvEl.srcObject = _remoteVideoStream;
                    }
                    if (tvEl && tvEl.paused) _vwPlayVideo(tvEl, 0);
                    // إخفاء avatar overlay
                    _vwHideAvatarIfCamera();
                };

                ev.track.onended = function() {
                    _rtcLog('VW', 'video track ended');
                };

                if (tvEl) {
                    tvEl.srcObject = _remoteVideoStream;
                    tvEl.muted = true;
                    tvEl.playsInline = true;
                    tvEl.autoplay = true;
                    tvEl.setAttribute('playsinline', '');
                    tvEl.style.visibility = '';
                    _vwPlayVideo(tvEl, 0);
                    setTimeout(function() { _vwPlayVideo(tvEl, 0); }, 500);
                    setTimeout(function() { _vwPlayVideo(tvEl, 0); }, 1500);
                    // إخفاء avatar overlay
                    _vwHideAvatarIfCamera();
                }
            }

            if (ev.track.kind === 'audio') {
                if (!_remoteAudioStream.getTracks().find(function(t){ return t.id === ev.track.id; })) {
                    _remoteAudioStream.addTrack(ev.track);
                }
                ev.track.onunmute = function() {
                    _rtcLog('VW', 'audio track unmuted');
                    sAudio.srcObject = _remoteAudioStream;
                    _vwPlayAudio(sAudio, 0);
                };
                sAudio.srcObject = _remoteAudioStream;
                sAudio.muted = false;
                sAudio.volume = 1.0;
                _vwPlayAudio(sAudio, 0);
                setTimeout(function() { _vwPlayAudio(sAudio, 0); }, 500);
                setTimeout(function() { _vwPlayAudio(sAudio, 0); }, 1500);
            }
        };

        function _vwHideAvatarIfCamera() {
            // أخفِ spinner التحميل دائماً عند وصول الفيديو
            var vbi = document.getElementById('videoBufferingIndicator');
            if (vbi) vbi.classList.remove('show');
            // فقط أخفِ avatarOverlay إذا لم يكن الأستاذ قد أخفى كاميرته عمداً
            db.ref('rooms/' + roomId + '/ownerOverlay').once('value', function(s) {
                var d = s.val();
                if (!d || d.on !== true) {
                    var ov = document.getElementById('avatarOverlay');
                    if (ov) ov.classList.remove('show');
                    var tvEl2 = document.getElementById('tv');
                    if (tvEl2) { tvEl2.style.opacity = '1'; tvEl2.style.visibility = ''; }
                }
            });
        }

        // ── ICE candidates → Firebase ──
        _pc.onicecandidate = function(ev) {
            if (ev.candidate) {
                db.ref('rooms/' + roomId + '/candidates/' + myKey + '/fromStudent')
                    .push(JSON.stringify(ev.candidate.toJSON()));
            }
        };

        // ── مراقبة حالة ICE ──
        _pc.oniceconnectionstatechange = function() {
            if (_pc !== studentPC) return;
            var st = _pc.iceConnectionState;
            _rtcLog('VW', 'ICE state: ' + st);

            if (st === 'connected' || st === 'completed') {
                clearTimeout(_scReconnectTimer);
                // ضمان تشغيل الوسائط
                _vwEnsureMedia();
                setTimeout(_vwEnsureMedia, 500);
                setTimeout(_vwEnsureMedia, 1500);
                setTimeout(_vwEnsureMedia, 3000);
            }

            if (st === 'failed') {
                clearTimeout(_scReconnectTimer);
                _rtcLog('VW', 'ICE failed — trying ICE restart');
                _scReconnectTimer = setTimeout(async function() {
                    if (_scDestroyed || _pc !== studentPC) return;
                    // طلب offer جديد من الأستاذ
                    try {
                        await db.ref('rooms/' + roomId + '/offers/' + myKey).remove();
                        await db.ref('rooms/' + roomId + '/answers/' + myKey).remove();
                        await db.ref('rooms/' + roomId + '/candidates/' + myKey).remove();
                        db.ref('rooms/' + roomId + '/connectRequest/' + myKey).set({ uid: me.uid, ts: Date.now(), reason: 'iceRestart' });
                    } catch(e) {}
                }, 2000);
            }

            if (st === 'disconnected') {
                clearTimeout(_scReconnectTimer);
                _scReconnectTimer = setTimeout(async function() {
                    if (_scDestroyed || _pc !== studentPC) return;
                    _rtcLog('VW', 'ICE disconnected — rebuilding');
                    try {
                        var ofSnap = await db.ref('rooms/' + roomId + '/offers/' + myKey).get();
                        if (ofSnap.exists()) {
                            await createOrganizerPeerAndAnswer(ofSnap.val());
                        } else {
                            db.ref('rooms/' + roomId + '/connectRequest/' + myKey).set({ uid: me.uid, ts: Date.now() });
                        }
                    } catch(e) {}
                }, 4000);
            }
        };

        _pc.onconnectionstatechange = function() {
            if (_pc !== studentPC) return;
            var st = _pc.connectionState;
            _rtcLog('VW', 'conn state: ' + st);
            if (st === 'failed') {
                clearTimeout(_scReconnectTimer);
                _scReconnectTimer = setTimeout(async function() {
                    if (_scDestroyed || _pc !== studentPC) return;
                    try {
                        var ofSnap = await db.ref('rooms/' + roomId + '/offers/' + myKey).get();
                        if (ofSnap.exists()) {
                            await createOrganizerPeerAndAnswer(ofSnap.val());
                        } else {
                            db.ref('rooms/' + roomId + '/connectRequest/' + myKey).set({ uid: me.uid, ts: Date.now() });
                        }
                    } catch(e) {}
                }, 2500);
            }
            if (st === 'connected') {
                clearTimeout(_scReconnectTimer);
                _vwEnsureMedia();
                setTimeout(_vwEnsureMedia, 800);
            }
        };

        // ── helper ضمان تشغيل الوسائط ──
        function _vwEnsureMedia() {
            if (_scDestroyed) return;
            var _sa = document.getElementById('studentRemoteAudio');
            if (_sa && _sa.srcObject && _sa.paused) {
                _sa.muted = false;
                _sa.volume = 1.0;
                _sa.play().catch(function(){});
            }
            var _tv = document.getElementById('tv');
            if (_tv && _tv.srcObject && _tv.paused) {
                _tv.playsInline = true;
                _tv.play().catch(function(){});
            }
        }

        // ── setRemoteDescription → createAnswer → setLocalDescription ──
        try {
            var parsedOffer = JSON.parse(offerStr);
            await _pc.setRemoteDescription(new RTCSessionDescription(parsedOffer));
            _scRemoteSet = true;
            _rtcLog('VW', 'remote description set');

            // تطبيق ICE candidates المحجوزة
            var _buffered = _scIceBuf.splice(0);
            for (var _bi = 0; _bi < _buffered.length; _bi++) {
                try { await _pc.addIceCandidate(new RTCIceCandidate(_buffered[_bi])); } catch(e) {}
            }

            var _answer = await _pc.createAnswer();
            await _pc.setLocalDescription(_answer);
            await db.ref('rooms/' + roomId + '/answers/' + myKey).set(JSON.stringify(_answer));
            _rtcLog('VW', 'answer sent to Firebase');
        } catch(err) {
            _rtcLog('VW', 'SDP error: ' + err.message);
            return;
        }

        // ── إضافة ميك لاحقاً إن لم يكن جاهزاً ──
        if (!_audioTrack) {
            var _waitMicInterval = setInterval(function() {
                if (_scDestroyed) { clearInterval(_waitMicInterval); return; }
                var _at2 = (localStream && localStream.getAudioTracks().find(function(t){ return t.readyState === 'live'; }))
                         || window.__pendingAudioTrack;
                if (!_at2 || _at2.readyState === 'ended') return;
                clearInterval(_waitMicInterval);
                if (_pc && _pc.signalingState !== 'closed' && _pc === studentPC) {
                    var _hasMic2 = _pc.getSenders().some(function(s){ return s.track && s.track.kind === 'audio'; });
                    if (!_hasMic2) {
                        var _ms2 = localStream || new MediaStream([_at2]);
                        try { _pc.addTrack(_at2, _ms2); } catch(e) {}
                    }
                }
            }, 300);
            setTimeout(function(){ clearInterval(_waitMicInterval); }, 20000);
        }

        // مرجع ICE listener الحالي
        _scAnswerRef = _answerRef;
        _scIceRef    = db.ref('rooms/' + roomId + '/candidates/' + myKey + '/fromTeacher');
    }

    var roomJoinTime = null;
    var _cachedRoomTasks = null; // المهام المحملة مسبقاً عند الدخول

    function enterRoom() {
        roomJoinTime = Date.now();
        // ── تحميل المهام مسبقاً لضمان الحفظ الصحيح عند الخروج ──
        db.ref('tasks').once('value').then(function(tsSnap) {
            _cachedRoomTasks = tsSnap.val() || {};
        }).catch(function() { _cachedRoomTasks = {}; });
        // إيقاف أي interval سابق (لم يعد مستخدماً)
        if (window.__roomPointsInt) { clearInterval(window.__roomPointsInt); window.__roomPointsInt = null; }
        db.ref('rooms/' + roomId + '/viewers/' + me.uid).set({ name: me.name, avatar: me.avatar || '', ts: Date.now() });
        db.ref('rooms/' + roomId + '/viewers/' + me.uid).onDisconnect().remove();

        // ── مراقبة الداخلين الجدد لعرض تأثير الدخولية ──
        var _rvViewersInitDone = false;
        var _rvViewersKnown = {};
        // وقت آخر رجوع من الخلفية — نتجاهل الدخول خلال 5 ثوانٍ من العودة
        var _rvLastVisibleAt = Date.now();
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) _rvLastVisibleAt = Date.now();
        });
        db.ref('rooms/' + roomId + '/viewers').on('value', function(vSnap) {
            var now = vSnap.val() || {};
            if (!_rvViewersInitDone) {
                Object.keys(now).forEach(function(uid) { _rvViewersKnown[uid] = true; });
                _rvViewersInitDone = true;
                return;
            }
            Object.keys(now).forEach(function(uid) {
                if (!_rvViewersKnown[uid]) {
                    _rvViewersKnown[uid] = true;
                    // تجاهل المستخدم نفسه
                    if (me && uid === me.uid) return;
                    // تجاهل الدخول خلال 5 ثوانٍ من العودة للواجهة (منع ظهور الإشعار عند الرجوع من الخلفية)
                    if (Date.now() - _rvLastVisibleAt < 5000) return;
                    // أولاً: ابحث عن بيانات المستخدم في المقاعد (أدق)
                    db.ref('rooms/' + roomId + '/seats').once('value', function(seatsSnap) {
                        var seats = seatsSnap.val() || {};
                        var seatData = null;
                        for (var si = 0; si < 20; si++) {
                            if (seats[si] && seats[si].userId === uid) { seatData = seats[si]; break; }
                        }
                        if (seatData) {
                            // استخدم بيانات المقعد مباشرة
                            var entryName   = seatData.name   || now[uid].name   || 'مستخدم';
                            var entryAvatar = seatData.avatar || now[uid].avatar || '';
                            db.ref('users/' + uid).once('value', function(us) {
                                var uv = us.val() || {};
                                var entryImgUrl = uv.activeEntryUrl || '';
                                rvShowEntryEffect(entryName, entryAvatar, entryImgUrl);
                            });
                        } else {
                            // المستخدم مشاهد فقط — اجلب من /users
                            db.ref('users/' + uid).once('value', function(us) {
                                var uv = us.val() || {};
                                var entryImgUrl = uv.activeEntryUrl || '';
                                var entryName   = uv.yourname || uv.name || now[uid].name   || 'مستخدم';
                                var entryAvatar = uv.avatar   || now[uid].avatar || '';
                                rvShowEntryEffect(entryName, entryAvatar, entryImgUrl);
                            });
                        }
                    });
                }
            });
            Object.keys(_rvViewersKnown).forEach(function(uid) {
                if (!now[uid]) delete _rvViewersKnown[uid];
            });
        });

        if (isOwner) {
            // ── صاحب الغرفة: يسجل مقعده — بيانات shared.js أولاً، ثم Firebase كمكمّل ──
            const localUser = getLocalUser();
            // تسجيل المقعد 0 فوراً بالبيانات المحلية لضمان الظهور السريع
            const registerOwnerSeat = (ownerName, ownerAvatar, ownerFrame, ownerBadge) => {
                me.name   = ownerName;
                me.avatar = ownerAvatar;
                me.frame  = ownerFrame || '';
                me.badge  = ownerBadge || '';
                db.ref('rooms/' + roomId + '/seats/0').set({
                    userId: me.uid, name: ownerName, avatar: ownerAvatar,
                    frame: ownerFrame || '', badge: ownerBadge || '',
                    micOn: false, ts: Date.now(), isOwner: true
                });
                // تسجيل heartbeat مع المقعد لمنع الإخراج الخاطئ للطلاب
                db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
            };

            // سجّل فوراً بالبيانات المحلية
            registerOwnerSeat(
                me.name   || localUser.name,
                me.avatar || localUser.avatar,
                me.frame  || '',
                me.badge  || ''
            );

            // ثم حاول تحديث من Firebase إذا كان هناك uid حقيقي
            if (me.uid && !me.uid.startsWith('guest_')) {
                db.ref('users/' + me.uid).once('value', uSnap => {
                    const ud = uSnap.val() || {};
                    // البيانات المحلية (localStorage) لها الأولوية، Firebase كبديل فقط
                    const ownerName   = me.name   || ud.name   || localUser.name;
                    const ownerAvatar = me.avatar || ud.avatar || localUser.avatar;
                    const ownerFrame  = ud.activeFrameUrl || me.frame || '';
                    const ownerBadge  = ud.badge || me.badge || '';
                    registerOwnerSeat(ownerName, ownerAvatar, ownerFrame, ownerBadge);
                }).catch(() => {});
            }
            mySeatIdx = 0;
            // ❌ لا نضع onDisconnect().remove() — مقعد المالك يبقى دائماً حتى الضغط على doLeave
            // db.ref('rooms/' + roomId + '/seats/0').onDisconnect().remove();
            // إظهار زر المايك للمالك (هو دائماً جالس في مقعد 0)
            var mcBtnOwner = document.getElementById('mcBtn');
            if (mcBtnOwner) mcBtnOwner.style.display = '';

            // فتح الكاميرا فوراً وعرضها في #tv
            const constraints = { video: { facingMode: usingFrontCamera ? 'user' : 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
            navigator.mediaDevices.getUserMedia(constraints).then(async s => {
                localStream = s;
                const tvEl = document.getElementById('tv');
                if (tvEl) {
                    tvEl.srcObject = s;
                    tvEl.muted = true;
                    tvEl.playsInline = true;
                    tvEl.autoplay = true;
                    tvEl.setAttribute('playsinline', '');
                    tvEl.play().catch(function(){});
                }
                localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });

                // ── إعادة بناء أو تحديث الـ tracks لكل peers موجودين ──
                const existingKeys = Object.keys(teacherPeerConns);
                for (const key of existingKeys) {
                    const conn = teacherPeerConns[key];
                    if (!conn || !conn.pc) continue;
                    const pcSt = conn.pc.iceConnectionState;
                    const sigSt = conn.pc.signalingState;
                    if (pcSt === 'failed' || pcSt === 'disconnected' || pcSt === 'closed' || sigSt === 'closed') {
                        await _rebuildPeerForOrganizer(key, conn.uid || '');
                    } else {
                        // الـ peer متصل — استبدل tracks مباشرة
                        for (const track of localStream.getTracks()) {
                            const sender = conn.pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                            if (sender) { try { await sender.replaceTrack(track); } catch(e) {} }
                            else { try { conn.pc.addTrack(track, localStream); } catch(e) {} }
                        }
                    }
                }

                // بعد الحصول على localStream — أنشئ connections لمن كانوا موجودين مسبقاً ولا يوجد لهم peer
                db.ref('rooms/' + roomId + '/students').once('value', snap => {
                    snap.forEach(c => {
                        const v = c.val();
                        if (v && !teacherPeerConns[c.key]) {
                            createPeerForOrganizer(c.key, v.uid || v.userId);
                        }
                    });
                });

                // استمع لمن يدخل بعد الأستاذ
                db.ref('rooms/' + roomId + '/students').on('child_added', snap => {
                    const key = snap.key; const val = snap.val();
                    if (!val || teacherPeerConns[key]) return;
                    createPeerForOrganizer(key, val.uid || val.userId);
                });

                db.ref('rooms/' + roomId + '/students').on('child_removed', snap => {
                    const key = snap.key;
                    const conn = teacherPeerConns[key];
                    if (conn) {
                        try { if (conn._offRef) conn._offRef.off(); } catch(e) {}
                        try { if (conn._iceRef)  conn._iceRef.off(); } catch(e) {}
                        try { if (conn.pc) conn.pc.close(); } catch(e) {}
                        try { if (conn.audioEl) conn.audioEl.remove(); } catch(e) {}
                        delete teacherPeerConns[key];
                    }
                    db.ref('rooms/' + roomId + '/offers/'     + key).remove();
                    db.ref('rooms/' + roomId + '/answers/'    + key).remove();
                    db.ref('rooms/' + roomId + '/candidates/' + key).remove();
                });

                // connectRequest — المشاهد يطلب اتصالاً مباشراً
                db.ref('rooms/' + roomId + '/connectRequest').on('child_added', async function(reqSnap) {
                    const reqKey = reqSnap.key; const reqVal = reqSnap.val();
                    if (!reqVal || !reqKey) return;
                    db.ref('rooms/' + roomId + '/connectRequest/' + reqKey).remove();
                    const reason = reqVal.reason || '';
                    const existing = teacherPeerConns[reqKey];
                    // spotlight_rebuild / spotlight_new / cameraFlip: أعد بناء الـ peer دائماً
                    if (reason === 'spotlight_rebuild' || reason === 'spotlight_new' || reason === 'cameraFlip') {
                        await _rebuildPeerForOrganizer(reqKey, reqVal.uid || '');
                        return;
                    }
                    // spotlight: إذا كان متصلاً — أعد بناء لأن video track تغيّر
                    if (reason === 'spotlight' && existing && existing.pc) {
                        await _rebuildPeerForOrganizer(reqKey, reqVal.uid || '');
                        return;
                    }
                    if (existing && existing.pc) {
                        const st = existing.pc.iceConnectionState;
                        if (st === 'connected' || st === 'completed') return;
                        await _rebuildPeerForOrganizer(reqKey, reqVal.uid || '');
                    } else {
                        await createPeerForOrganizer(reqKey, reqVal.uid || '');
                    }
                });

                // أشعر المشاهدين بعودة الأستاذ — يُعيد بناء الـ peers من جانبهم
                try { db.ref('rooms/' + roomId + '/ownerReoffer').set(Date.now()); } catch(e) {}
            }).catch(() => {});

        } else {
            // ── المنظم / المشاهد ──
            // إظهار صورة ترحيبية ريثما يصل فيديو الأستاذ
            // ── عرض spinner انتظار ريثما يصل الفيديو ──
            (function showWelcomeOverlay() {
                var ov  = document.getElementById('avatarOverlay');
                var tv  = document.getElementById('tv');
                var vbi = document.getElementById('videoBufferingIndicator');
                // فحص Firebase: هل الأستاذ أخفى كاميرته عمداً؟
                db.ref('rooms/' + roomId + '/ownerOverlay').once('value', function(snap) {
                    var d = snap.val();
                    if (d && d.on === true) {
                        var avatar = (d.avatar && d.avatar.trim() !== '') ? d.avatar.trim() : '';
                        // لا نُظهر overlay بدون صورة
                        if (!avatar) {
                            if (vbi) {
                                vbi.classList.add('show');
                                setTimeout(function(){ vbi.classList.remove('show'); }, 8000);
                            }
                            return;
                        }
                        var img = document.getElementById('avatarOverlayImg');
                        var nm  = document.getElementById('avatarOverlayName');
                        var sub = document.getElementById('avatarOverlaySubject');
                        if (nm)  nm.textContent  = d.name    || 'المضيف';
                        if (sub) sub.textContent = d.roomName || '';
                        if (tv)  { tv.style.opacity = '0'; tv.style.visibility = 'hidden'; }
                        if (img) {
                            img.style.background = '#2a2a4a';
                            img.onerror = function() {
                                // فشل تحميل صورة الأستاذ — أظهر spinner فقط
                                if (ov)  ov.classList.remove('show');
                                if (tv)  { tv.style.opacity = '1'; tv.style.visibility = ''; }
                                if (vbi) {
                                    vbi.classList.add('show');
                                    setTimeout(function(){ vbi.classList.remove('show'); }, 8000);
                                }
                            };
                            img.onload = function() {
                                img.style.background = 'transparent';
                                if (ov) ov.classList.add('show');
                            };
                            img.src = avatar;
                        } else {
                            if (ov) ov.classList.add('show');
                        }
                    } else {
                        // الأستاذ كاميرته مفتوحة — spinner فقط، لا overlay أسود
                        if (vbi) {
                            vbi.classList.add('show');
                            setTimeout(function(){ vbi.classList.remove('show'); }, 8000);
                        }
                    }
                });
            })();

            // ══════════════════════════════════════════════════════════════
            // الترتيب الصحيح لتجنب race condition:
            // 1) أنشئ studentRef (الـ key) أولاً بدون كتابة Firebase
            // 2) ابدأ جميع مستمعات Firebase (offers, ICE)
            // 3) ثم سجّل في /students — هذا يُبلّغ الأستاذ بوجودك
            // 4) الأستاذ سيُرسل offer — ومستمعك جاهز لاستقباله
            // ══════════════════════════════════════════════════════════════

            // ① أنشئ مفتاح فريد للطالب
            const sid = 'org_' + me.uid + '_' + Date.now();
            studentRef = db.ref('rooms/' + roomId + '/students/' + sid);

            // ── فتح سياق الصوت مبكراً (يحل مشكلة autoplay على Android WebView) ──
            var _audioCtxUnlocked = false;
            function _unlockAudioCtx() {
                if (_audioCtxUnlocked) return;
                _audioCtxUnlocked = true;
                try {
                    var ctx = new (window.AudioContext || window.webkitAudioContext)();
                    if (ctx.state === 'suspended') {
                        ctx.resume().then(function() {
                            try { ctx.close(); } catch(e) {}
                        }).catch(function(){});
                    } else {
                        var buf = ctx.createBuffer(1, 1, 22050);
                        var src = ctx.createBufferSource();
                        src.buffer = buf;
                        src.connect(ctx.destination);
                        src.start(0);
                        setTimeout(function() { try { ctx.close(); } catch(e) {} }, 1000);
                    }
                } catch(e) {}
                // شغّل جميع عناصر الصوت فوراً
                document.querySelectorAll('audio').forEach(function(a) {
                    a.muted = false;
                    a.volume = 1.0;
                    if (a.srcObject && a.paused) a.play().catch(function(){});
                });
                var tvEl = document.getElementById('tv');
                if (tvEl && tvEl.srcObject && tvEl.paused) {
                    tvEl.playsInline = true;
                    tvEl.play().catch(function(){});
                }
            }
            // استمع لأي تفاعل — once لكل نوع
            ['touchstart','touchend','click','keydown','pointerdown'].forEach(function(ev) {
                document.addEventListener(ev, _unlockAudioCtx, { once: true, passive: true });
            });
            // محاولة تلقائية بعد 1 ثانية
            setTimeout(_unlockAudioCtx, 1000);

            // ② ابدأ مستمع ICE من الأستاذ أولاً (قبل أي شيء)
            // كل candidate يصل قبل setRemoteDescription يُخزّن في _scIceBuf
            db.ref('rooms/' + roomId + '/candidates/' + sid + '/fromTeacher').on('child_added', async function(snap) {
                if (!snap.val()) return;
                try {
                    var cand = JSON.parse(snap.val());
                    if (studentPC && _scRemoteSet && studentPC.remoteDescription && studentPC.signalingState !== 'closed') {
                        await studentPC.addIceCandidate(new RTCIceCandidate(cand));
                    } else {
                        // buffer المبكر — سيُطبّق في createOrganizerPeerAndAnswer بعد setRemoteDescription
                        _scIceBuf.push(cand);
                    }
                } catch(e) {}
            });

            // ③ ابدأ مستمع offer من الأستاذ
            var _lastOfferStr = null;
            var _offerProcessing = false;
            db.ref('rooms/' + roomId + '/offers/' + sid).on('value', async function(snap) {
                if (!snap.exists()) return;
                var offerStr = snap.val();
                if (!offerStr) return;
                // تجنب معالجة نفس الـ offer مرتين
                if (offerStr === _lastOfferStr && studentPC && studentPC.signalingState !== 'closed' && studentPC.currentRemoteDescription) return;
                // تجنب race condition — انتظر انتهاء المعالجة السابقة
                if (_offerProcessing) return;
                _offerProcessing = true;
                _lastOfferStr = offerStr;
                try {
                    await createOrganizerPeerAndAnswer(offerStr);
                } catch(e) {
                    _rtcLog('VW', 'offer processing error: ' + e.message);
                } finally {
                    _offerProcessing = false;
                }
            });

            // ④ سجّل في /students — هذا يُبلّغ الأستاذ بوجودك ويبدأ signaling
            studentRef.set({ userId: me.uid, uid: me.uid, name: me.name, avatar: me.avatar, frame: me.frame, badge: me.badge, mic: false, seated: false, ts: Date.now() });
            // عند انقطاع الاتصال فجأة — أزل سجل الطالب من /students تلقائياً
            studentRef.onDisconnect().remove();

            // ⑤ أرسل connectRequest كضمان إضافي (للحالات التي يكون فيها الأستاذ مشغولاً)
            // يُرسل بعد 200ms للتأكد من وصول child_added للأستاذ أولاً
            setTimeout(function() {
                try {
                    db.ref('rooms/' + roomId + '/connectRequest/' + sid).set({ uid: me.uid, ts: Date.now() });
                    db.ref('rooms/' + roomId + '/connectRequest/' + sid).onDisconnect().remove();
                } catch(e) {}
            }, 200);

            // ── مراقب صحة الاتصال — يُعيد الاتصال إذا لم يصل فيديو خلال 15 ثانية ──
            var _healthCheckTimer = setTimeout(function() {
                var tvEl = document.getElementById('tv');
                var hasVideo = tvEl && tvEl.srcObject && tvEl.srcObject.getVideoTracks().some(function(t){ return t.readyState === 'live'; });
                if (!hasVideo) {
                    _rtcLog('VW', 'health check: no video after 15s — retrying connection');
                    // إرسال connectRequest من جديد
                    try {
                        db.ref('rooms/' + roomId + '/connectRequest/' + sid).set({ uid: me.uid, ts: Date.now(), reason: 'healthCheck' });
                    } catch(e) {}
                }
            }, 15000);

            // ⑥ طلب الميكروفون — يعمل بالتوازي مع signaling
            navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
            .then(audioStream => {
                localStream = audioStream;
                const at = localStream.getAudioTracks()[0];
                if (at) {
                    at.enabled = false; // مكتوم مبدئياً — يُفتح عند ضغط المايك
                    window.__pendingAudioTrack = at;
                    if (studentPC && studentPC.signalingState !== 'closed') {
                        const senders = studentPC.getSenders();
                        const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
                        if (!hasAudio) {
                            try { studentPC.addTrack(at, localStream); } catch(e) {}
                        }
                    }
                }
                // طلب الكاميرا في الخلفية
                navigator.mediaDevices.getUserMedia({ video: { facingMode: usingFrontCamera ? 'user' : 'environment' }, audio: false })
                .then(vidStream => {
                    vidStream.getVideoTracks().forEach(vt => {
                        vt.enabled = true;
                        localStream.addTrack(vt);
                    });
                }).catch(() => {});
            }).catch(() => {
                navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
                    localStream = s;
                    const at = localStream.getAudioTracks()[0];
                    if (at) {
                        at.enabled = false;
                        window.__pendingAudioTrack = at;
                        if (studentPC && studentPC.signalingState !== 'closed') {
                            const senders = studentPC.getSenders();
                            if (!senders.some(s => s.track && s.track.kind === 'audio')) {
                                try { studentPC.addTrack(at, localStream); } catch(e) {}
                            }
                        }
                    }
                }).catch(() => {});
            });

            // مستمع ownerReoffer — يُعيد بناء الاتصال عند رجوع الأستاذ أو تغيير الكاميرا
            var _lastReoffer = 0;
            var _reofferProcessing = false;
            db.ref('rooms/' + roomId + '/ownerReoffer').on('value', async function(reofferSnap) {
                var ts = reofferSnap.val();
                if (!ts || ts <= _lastReoffer) return;
                _lastReoffer = ts;
                if (Date.now() - ts > 30000) return;
                if (_reofferProcessing) return;
                _reofferProcessing = true;
                _rtcLog('VW', 'ownerReoffer received — reconnecting');
                setTimeout(async function() {
                    try {
                        // إعادة ضبط ICE buffer
                        _scIceBuf = [];
                        _scRemoteSet = false;
                        var offerSnap = await db.ref('rooms/' + roomId + '/offers/' + sid).get();
                        if (offerSnap.exists()) {
                            await createOrganizerPeerAndAnswer(offerSnap.val());
                        } else {
                            // لا يوجد offer بعد — طلب connectRequest
                            db.ref('rooms/' + roomId + '/connectRequest/' + sid).set({ uid: me.uid, ts: Date.now() });
                        }
                        // ضمان تشغيل الوسائط
                        var _forcePlay = function() {
                            document.querySelectorAll('audio').forEach(function(a) {
                                a.muted = false;
                                a.volume = 1.0;
                                if (a.paused && a.srcObject) a.play().catch(function(){});
                            });
                            var tvEl = document.getElementById('tv');
                            if (tvEl && tvEl.srcObject) {
                                tvEl.playsInline = true;
                                if (tvEl.paused) tvEl.play().catch(function(){});
                            }
                        };
                        setTimeout(_forcePlay, 600);
                        setTimeout(_forcePlay, 1500);
                        setTimeout(_forcePlay, 3000);
                    } catch(e) {
                        _rtcLog('VW', 'ownerReoffer error: ' + e.message);
                    } finally {
                        _reofferProcessing = false;
                    }
                }, 600);
            });

            // مستمع spotlight_requests — يستقبل الدعوات الموجهة بـ uid المستخدم الحالي
            db.ref('rooms/' + roomId + '/spotlight_requests').on('child_added', snap => {
                const req = snap.val();
                if (!req) return;
                // التحقق: هل الدعوة لي؟ (toUid أولاً، ثم to للتوافق القديم)
                const isForMe = (req.toUid && me && req.toUid === me.uid) ||
                                (studentRef && req.to === studentRef.key);
                if (!isForMe) return;

                // إظهار نافذة القبول/الرفض
                showConfirm(
                    'دعوة للظهور في البث 📺',
                    (req.byName || 'صاحب الغرفة') + ' يريد إظهارك في البث الرئيسي.\nهل توافق؟',
                    async () => {
                        // قبول — طلب الكاميرا إذا لم تكن جاهزة
                        if (!localStream || localStream.getVideoTracks().length === 0) {
                            try {
                                const newSpotStream = await navigator.mediaDevices.getUserMedia({
                                    video: { facingMode: usingFrontCamera ? 'user' : 'environment' },
                                    audio: { echoCancellation: true, noiseSuppression: true }
                                });
                                // دمج tracks الكاميرا الجديدة مع localStream إن وجد
                                if (localStream) {
                                    newSpotStream.getTracks().forEach(t => localStream.addTrack(t));
                                } else {
                                    localStream = newSpotStream;
                                }
                            } catch(e) {
                                showSnack('تعذّر فتح الكاميرا: ' + e.message, '⚠️');
                                await db.ref('rooms/' + roomId + '/spotlight_requests/' + snap.key).remove();
                                return;
                            }
                        }
                        if (localStream) {
                            localStream.getVideoTracks().forEach(t => { t.enabled = true; });
                            localStream.getAudioTracks().forEach(t => { t.enabled = micOn !== false; });

                            const vt = localStream.getVideoTracks()[0];
                            const at = localStream.getAudioTracks()[0];
                            const mySpotKey = (studentRef && studentRef.key) ? studentRef.key : null;

                            if (studentPC && studentPC.signalingState !== 'closed') {
                                const senders = studentPC.getSenders();
                                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

                                if (videoSender && vt) {
                                    // لدينا sender فيديو — استبدل فقط
                                    await videoSender.replaceTrack(vt).catch(() => {});
                                    if (audioSender && at) await audioSender.replaceTrack(at).catch(() => {});
                                    // أبلغ الأستاذ بإعادة التحقق
                                    try { db.ref('rooms/' + roomId + '/connectRequest/' + mySpotKey).set({ uid: me.uid, ts: Date.now(), reason: 'spotlight' }); } catch(e2) {}
                                } else {
                                    // لا يوجد video sender — يجب إعادة بناء الـ peer كاملاً
                                    // حذف بيانات الـ signaling القديمة أولاً
                                    if (mySpotKey) {
                                        try {
                                            await db.ref('rooms/' + roomId + '/offers/'     + mySpotKey).remove();
                                            await db.ref('rooms/' + roomId + '/answers/'    + mySpotKey).remove();
                                            await db.ref('rooms/' + roomId + '/candidates/' + mySpotKey).remove();
                                        } catch(e2) {}
                                    }
                                    // أغلق الـ peer القديم
                                    try {
                                        if (_scAnswerRef) _scAnswerRef.off();
                                        if (_scIceRef)   _scIceRef.off();
                                        studentPC.ontrack = null; studentPC.onicecandidate = null;
                                        studentPC.oniceconnectionstatechange = null; studentPC.onconnectionstatechange = null;
                                        studentPC.close();
                                    } catch(e2) {}
                                    studentPC = null;
                                    _scIceBuf = []; _scRemoteSet = false;
                                    // أخبر الأستاذ لإنشاء offer جديد مع video
                                    if (mySpotKey) {
                                        try { db.ref('rooms/' + roomId + '/connectRequest/' + mySpotKey).set({ uid: me.uid, ts: Date.now(), reason: 'spotlight_rebuild' }); } catch(e2) {}
                                    }
                                    // انتظر offer جديد من الأستاذ
                                    if (mySpotKey) {
                                        var _spWait = 0;
                                        var _spCheck = setInterval(async function() {
                                            _spWait += 500;
                                            if (_spWait > 12000) { clearInterval(_spCheck); return; }
                                            try {
                                                var ofSnap = await db.ref('rooms/' + roomId + '/offers/' + mySpotKey).get();
                                                if (ofSnap.exists()) {
                                                    clearInterval(_spCheck);
                                                    await createOrganizerPeerAndAnswer(ofSnap.val());
                                                }
                                            } catch(e2) {}
                                        }, 500);
                                    }
                                }
                            } else if (mySpotKey) {
                                // studentPC مغلق أو null — أخبر الأستاذ بالاتصال من جديد
                                try { db.ref('rooms/' + roomId + '/connectRequest/' + mySpotKey).set({ uid: me.uid, ts: Date.now(), reason: 'spotlight_new' }); } catch(e2) {}
                            }
                        }
                        const studentKey = (studentRef && studentRef.key) ? studentRef.key : ('uid_' + me.uid);
                        await db.ref('rooms/' + roomId + '/spotlight').set({
                            studentId: studentKey,
                            studentName: me.name || '',
                            uid: me.uid,
                            avatar: me.avatar || '',
                            ts: Date.now()
                        });
                        await db.ref('rooms/' + roomId + '/spotlight_requests/' + snap.key).remove();
                        const scb = document.getElementById('switchCamBtn');
                        if (scb) scb.style.display = 'flex';
                        showSnack('كاميرتك تعمل — أنت الآن في البث', '');
                    }
                );
                // زر الرفض
                const noBtn = document.getElementById('cmNo');
                if (noBtn) {
                    const prev = noBtn.onclick;
                    noBtn.onclick = async ev => {
                        try { ev && ev.stopPropagation(); } catch(_) {}
                        await db.ref('rooms/' + roomId + '/spotlight_requests/' + snap.key).remove();
                        if (typeof prev === 'function') prev(ev);
                        closeAll();
                    };
                }
            });
        }

        pingNet();
        // مستمع cameraFlip — يحل مشكلة الشاشة السوداء عند قلب الكاميرا للمشاهدين
        if (!isOwner) {
            var _lastFlipTs = 0;
            var _flipProcessing = false;
            db.ref('rooms/' + roomId + '/cameraFlip').on('value', function(flipSnap) {
                if (!flipSnap.exists()) return;
                var flipData = flipSnap.val();
                if (!flipData || !flipData.ts) return;
                if (flipData.ts <= _lastFlipTs) return;
                _lastFlipTs = flipData.ts;
                if (Date.now() - flipData.ts > 10000) return;
                if (_flipProcessing) return;
                _flipProcessing = true;
                _rtcLog('VW', 'cameraFlip detected — reconnecting');
                // أعِد بناء الـ peer بالكامل لاستقبال الـ video track الجديد
                setTimeout(async function() {
                    try {
                        var sidKey = studentRef && studentRef.key ? studentRef.key : null;
                        if (!sidKey) { _flipProcessing = false; return; }
                        // إعادة ضبط ICE buffer
                        _scIceBuf = []; _scRemoteSet = false;
                        // احذف signaling قديم
                        await db.ref('rooms/' + roomId + '/offers/'     + sidKey).remove().catch(function(){});
                        await db.ref('rooms/' + roomId + '/answers/'    + sidKey).remove().catch(function(){});
                        await db.ref('rooms/' + roomId + '/candidates/' + sidKey).remove().catch(function(){});
                        // أخبر الأستاذ بإنشاء offer جديد
                        db.ref('rooms/' + roomId + '/connectRequest/' + sidKey).set({ uid: me.uid, ts: Date.now(), reason: 'cameraFlip' });
                        // انتظر الـ offer الجديد — حد أقصى 12 ثانية
                        var _cfWait = 0;
                        var _cfCheck = setInterval(async function() {
                            _cfWait += 400;
                            if (_cfWait > 12000) {
                                clearInterval(_cfCheck);
                                _flipProcessing = false;
                                return;
                            }
                            try {
                                var ofSnap = await db.ref('rooms/' + roomId + '/offers/' + sidKey).get();
                                if (ofSnap.exists()) {
                                    clearInterval(_cfCheck);
                                    await createOrganizerPeerAndAnswer(ofSnap.val());
                                    // بعد الاتصال: شغّل الفيديو
                                    setTimeout(function() {
                                        var tvElF = document.getElementById('tv');
                                        if (tvElF && tvElF.srcObject) {
                                            tvElF.playsInline = true;
                                            if (tvElF.paused) tvElF.play().catch(function(){});
                                        }
                                    }, 800);
                                    _flipProcessing = false;
                                }
                            } catch(e) {}
                        }, 400);
                    } catch(e) {
                        _flipProcessing = false;
                    }
                }, 600);
            });
        }
        // ── مراقبة إشارة كتم الأستاذ للمستخدم الحالي ──
        if (me && me.uid) {
            db.ref('rooms/' + roomId + '/ownerMuteSignal/' + me.uid).on('value', snap => {
                if (!snap.exists()) return;
                const v = snap.val();
                if (v && v.muted) {
                    // كتم تلقائي من الأستاذ
                    if (micOn) {
                        micOn = false;
                        if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
                        const ico = document.getElementById('mcIco');
                        if (ico) { ico.className = 'fas fa-microphone-slash'; ico.style.color = '#ff4757'; }
                        const vmic = document.getElementById('vMyMic');
                        if (vmic) { vmic.className = 'vmic owner-muted'; vmic.innerHTML = '<i class="fas fa-microphone-slash" style="font-size:7px"></i>'; vmic.onclick = e => { e.stopPropagation(); showSnack('تم كتمك من الأستاذ. ارفع يدك لطلب الكلام ✋', '🔇'); }; }
                    }
                    showSnack('قام الأستاذ بكتم مايكك. ارفع يدك للتحدث ✋', '🔇');
                    // نظّف الإشارة بعد الاستقبال
                    snap.ref.remove();
                }
            });
        }
        // ── الأستاذ: مراقبة وضع الطابور ──
        if (isOwner) {
            // ── مستمع حالة الطابور للمالك — يبدأ الاستماع للطلبات إذا كان الطابور مفعّلاً ──
            db.ref('rooms/' + roomId + '/queueMode').on('value', function(snap) {
                _queueOn = snap.val() === true;
                window._roomQueueOn = _queueOn;
                if (_queueOn) {
                    _startQueueListener();
                } else {
                    _stopQueueListener();
                    _queueRequests = {};
                    _updateQueueDots();
                }
                _updateQueueBtnUI();
            });
        }
        // ── مستمع وضع الطابور للمشاهدين ──
        listenQueueMode();

        // ── مستمع إزالة من المقعد (للمنظمين/الطلاب) ──
        if (!isOwner && me && me.uid) {
            db.ref('rooms/' + roomId + '/seatRemoved/' + me.uid).on('value', function(snap) {
                var data = snap.val();
                if (!data) return;
                // تم إزالتي من المقعد
                mySeatIdx = null;
                // إخفاء زر المايك وإطفاؤه
                if (micOn) { micOn = false; if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false; }); }
                var mcBtnRm = document.getElementById('mcBtn');
                if (mcBtnRm) mcBtnRm.style.display = 'none';
                var mcIcoRm = document.getElementById('mcIco');
                if (mcIcoRm) { mcIcoRm.className = 'fas fa-microphone-slash'; mcIcoRm.style.color = '#ff4757'; }
                showSnack('تمت إزالتك من المقعد من قِبل ' + (data.byName || 'المشرف'), '🪑');
                // إلغاء أي طلب طابور معلّق
                db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).remove();
                // نظّف الإشارة
                db.ref('rooms/' + roomId + '/seatRemoved/' + me.uid).remove();
                // تسجيل إشارة حظر مؤقت من إعادة الطلب (30 ثانية)
                window._seatRemovedUntil = Date.now() + 30000;
            });
        }
    }

    // ── منح المايك من الأستاذ ──
    function ownerGrantMic(seatIdx) {
        db.ref('rooms/' + roomId + '/seats/' + seatIdx).update({ ownerMuted: false, hand: false });
        db.ref('rooms/' + roomId + '/handRaised/' + seatIdx).remove();
        showSnack('تم السماح بالكلام', '✅');
    }
    function ownerDenyHand(seatIdx) {
        db.ref('rooms/' + roomId + '/seats/' + seatIdx).update({ hand: false });
        db.ref('rooms/' + roomId + '/handRaised/' + seatIdx).remove();
    }

    // ─── صوت/مايك ───
    function toggleMic() {
        // فحص كتم الأستاذ
        if (!micOn && mySeatIdx !== null) {
            // إذا كان الأستاذ كتمني لا يمكنني فتح المايك
            db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/ownerMuted').once('value', snap => {
                if (snap.val() === true) {
                    showSnack('تم كتمك من الأستاذ', '🔇');
                    return;
                }
                _doToggleMic();
            });
        } else {
            _doToggleMic();
        }
    }

    function _doToggleMic() {
        const newState = !micOn;
        // إذا أريد فتح المايك — تحقق من عدد المايكات المفتوحة (الحد 2 فقط)
        if (newState) {
            db.ref('rooms/' + roomId + '/seats').once('value', snap => {
                const all = snap.val() || {};
                let openCount = 0;
                for (let i = 0; i < SEATS; i++) {
                    if (all[i] && all[i].micOn && all[i].userId !== me.uid) openCount++;
                }
                if (openCount >= 2) {
                    showSnack('المايكات الـ 2 مشغولة حالياً', '🎤');
                    return;
                }
                _applyMicState(newState);
            });
        } else {
            _applyMicState(newState);
        }
    }

    function _applyMicState(newState) {
        micOn = newState;

        function __doApply() {
            if (localStream) {
                // تفعيل/إيقاف الـ audio track الموجود
                const tracks = localStream.getAudioTracks();
                tracks.forEach(t => { t.enabled = micOn; });
                // إذا فتحنا المايك وكل tracks مغلقة (ended) — أنشئ stream جديد
                const allEnded = tracks.length > 0 && tracks.every(t => t.readyState === 'ended');
                if (allEnded && micOn) {
                    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
                    .then(newStream => {
                        const at = newStream.getAudioTracks()[0];
                        if (!at) return;
                        const oldTracks = localStream.getAudioTracks();
                        oldTracks.forEach(t => { localStream.removeTrack(t); t.stop(); });
                        localStream.addTrack(at);
                        at.enabled = true;
                        _replaceAudioTrackInPeers(at);
                    }).catch(() => {});
                    return;
                }
                // تأكد أن الـ track موجود في peer connections (حل مشكلة الصوت أول مرة)
                if (micOn && tracks.length > 0) {
                    const at = tracks[0];
                    at.enabled = true;
                    // إذا لم يكن الـ track مضافاً للـ peer بعد، أضفه الآن
                    _ensureAudioTrackInPeers(at);
                }
            } else if (micOn) {
                // localStream فارغ تماماً — اطلبه الآن
                navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
                .then(s => {
                    localStream = s;
                    localStream.getAudioTracks().forEach(t => { t.enabled = true; });
                    // أضف الـ track للـ peer connection مباشرة
                    _ensureAudioTrackInPeers(localStream.getAudioTracks()[0]);
                    _replaceAudioTrackInPeers(localStream.getAudioTracks()[0]);
                }).catch(err => {
                    micOn = false;
                    showSnack('تعذّر الوصول للميكروفون. تأكد من الإذن في المتصفح 🎤', '❌');
                    const ico2 = document.getElementById('mcIco');
                    if (ico2) { ico2.className = 'fas fa-microphone-slash'; ico2.style.color = '#ff4757'; }
                    return;
                });
                return;
            }

            const ico = document.getElementById('mcIco');
            if (ico) { ico.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash'; ico.style.color = micOn ? '#0084ff' : '#ff4757'; }
            const mc = document.getElementById('vMyMic');
            if (mc) { mc.className = 'vmic ' + (micOn ? 'on' : 'off'); mc.innerHTML = micOn ? '<i class="fas fa-microphone" style="font-size:7px"></i>' : '<i class="fas fa-microphone-slash" style="font-size:7px"></i>'; }
            if (mySeatIdx !== null) db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/micOn').set(micOn);
        }

        __doApply();

        // تحديث الواجهة فوراً بغض النظر
        const ico = document.getElementById('mcIco');
        if (ico) { ico.className = micOn ? 'fas fa-microphone' : 'fas fa-microphone-slash'; ico.style.color = micOn ? '#0084ff' : '#ff4757'; }
        const mc = document.getElementById('vMyMic');
        if (mc) { mc.className = 'vmic ' + (micOn ? 'on' : 'off'); mc.innerHTML = micOn ? '<i class="fas fa-microphone" style="font-size:7px"></i>' : '<i class="fas fa-microphone-slash" style="font-size:7px"></i>'; }
        if (mySeatIdx !== null) db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/micOn').set(micOn);
    }

    // إضافة الـ audio track للـ peer connections إذا لم يكن موجوداً (يحل مشكلة الصوت أول مرة)
    function _ensureAudioTrackInPeers(track) {
        if (!track) return;
        // studentPC (المنظم يرسل للأستاذ)
        if (typeof studentPC !== 'undefined' && studentPC && studentPC.signalingState !== 'closed') {
            const senders = studentPC.getSenders();
            const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
            if (!hasAudio && localStream) {
                try { studentPC.addTrack(track, localStream); } catch(e) {}
            }
        }
        // teacherPeerConns (الأستاذ يرسل للمنظمين)
        if (typeof teacherPeerConns !== 'undefined') {
            for (const key in teacherPeerConns) {
                const conn = teacherPeerConns[key];
                if (conn && conn.pc && conn.pc.signalingState !== 'closed') {
                    const senders = conn.pc.getSenders();
                    const hasAudio = senders.some(s => s.track && s.track.kind === 'audio');
                    if (!hasAudio && localStream) {
                        try { conn.pc.addTrack(track, localStream); } catch(e) {}
                    }
                }
            }
        }
    }

    // استبدال الـ audio track في كل peer connections النشطة
    function _replaceAudioTrackInPeers(newTrack) {
        if (!newTrack) return;
        // teacherPeerConns (المنظمون)
        if (typeof teacherPeerConns !== 'undefined') {
            for (const key in teacherPeerConns) {
                const conn = teacherPeerConns[key];
                if (conn && conn.pc && conn.pc.signalingState !== 'closed') {
                    conn.pc.getSenders().forEach(sender => {
                        if (sender.track && sender.track.kind === 'audio') {
                            sender.replaceTrack(newTrack).catch(() => {});
                        }
                    });
                }
            }
        }
        // studentPC (الطالب)
        if (typeof studentPC !== 'undefined' && studentPC && studentPC.signalingState !== 'closed') {
            studentPC.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                    sender.replaceTrack(newTrack).catch(() => {});
                }
            });
        }
    }
    function toggleSpk() {
        spkOn = !spkOn;
        const vol = spkOn ? 1.0 : 0.0;
        const tv = document.getElementById('tv');
        if (!isOwner && tv) { tv.muted = !spkOn; }
        // تحديث جميع عناصر الصوت بـ volume بدلاً من muted
        document.querySelectorAll('audio').forEach(function(el) {
            el.volume = vol;
            // لا نستخدم muted لأنه يمنع التشغيل على Android
            if (spkOn && el.srcObject && el.paused) el.play().catch(function(){});
        });
        // teacherPeerConns audio elements
        for (const key in teacherPeerConns) {
            const ae = teacherPeerConns[key] && teacherPeerConns[key].audioEl;
            if (ae) {
                ae.volume = vol;
                if (spkOn && ae.srcObject && ae.paused) ae.play().catch(function(){});
            }
        }
        const ico = document.getElementById('spkIco');
        if (ico) { ico.className = spkOn ? 'fas fa-volume-up' : 'fas fa-volume-mute'; ico.style.color = spkOn ? '#636e72' : '#ff4757'; }
    }
    function toggleHand() {
        // زر رفع اليد محذوف — الدالة موجودة للتوافق فقط
    }

    // ===== Emoji =====
    window.__EMOJI_SVGS__ = {
      like: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21h4V9H2v12zm20-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L13 1 7.59 6.41C7.22 6.78 7 7.3 7 7.83V19c0 1.1.9 2 2 2h8c.82 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>',
      love: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 6 4 4 6.5 4c1.74 0 3.41.81 4.5 2.09C12.09 4.81 13.76 4 15.5 4 18 4 20 6 20 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
      clap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 11V5a2 2 0 0 1 4 0v6h1V3a2 2 0 1 1 4 0v8h1V5a2 2 0 1 1 4 0v9c0 4-3 7-7 7H10c-2 0-3-1-4-3l-3-5a2 2 0 0 1 4-2l0 0z"/></svg>',
      fire: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 0S14 3 12 5c-1.5 1.5-2 3-2 4.5 0 2.5 2 4.5 4.5 4.5 1.7 0 3.2-.9 4-2.3.9 1.4 1.5 3 1.5 4.8C20 20.1 16.4 24 12 24S4 20.1 4 15.5c0-4 2.7-7.4 6.4-8.6C10.1 3.8 11.6 1.7 13.5 0z"/></svg>',
      wow:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm-4-11a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-4 8c-2.21 0-4-1.79-4-4h8c0 2.21-1.79 4-4 4z"/></svg>',
      sad:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22c5.52 0 10-4.48 10-10S17.52 2 12 2 2 6.48 2 12s4.48 10 10 10zm-4.5-9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm9 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm-9.3 5.3a1 1 0 0 1 0-1.41C8.38 15.72 10.06 15 12 15s3.62.72 4.8 1.89a1 1 0 1 1-1.41 1.41C14.6 17.5 13.4 17 12 17s-2.6.5-3.39 1.3a1 1 0 0 1-1.41 0z"/></svg>'
    };

    function openEmojiPicker() {
        document.getElementById('emojiPickerBackdrop').classList.add('show');
        document.getElementById('emojiPicker').classList.add('show');
        // تحميل الإيموجيات من Firebase
        const emc = document.getElementById('rvEmojiContainer');
        if (!emc) return;
        emc.innerHTML = '<div style="text-align:center;color:#aaa;font-size:12px;padding:10px;">جاري التحميل...</div>';
        db.ref('settings/emojis').once('value', snap => {
            emc.innerHTML = '';
            let count = 0;
            snap.forEach(s => {
                const e = s.val(); if (!e || !e.imgUrl) return;
                count++;
                const btn = document.createElement('button');
                btn.title = e.name || '';
                const img = document.createElement('img'); img.src = e.imgUrl;
                img.style.cssText = 'width:26px;height:26px;object-fit:contain;';
                img.onerror = () => { img.style.display='none'; };
                btn.appendChild(img);
                btn.addEventListener('click', () => sendEmojiImg(s.key, e.imgUrl));
                emc.appendChild(btn);
            });
            if (!count) emc.innerHTML = '<div style="text-align:center;color:#aaa;font-size:12px;padding:10px;">لا توجد إيموجيات</div>';
        });
    }
    function closeEmojiPicker() {
        document.getElementById('emojiPickerBackdrop').classList.remove('show');
        document.getElementById('emojiPicker').classList.remove('show');
    }
    // مؤقتات الإيموجي — مفتاح: seatIdx
    const __emoTimers = {};

    function sendEmoji(id) {
        closeEmojiPicker();
        if (!me || !me.uid || mySeatIdx === null) return;
        // إلغاء المؤقت القديم إن وُجد
        if (__emoTimers[mySeatIdx]) clearTimeout(__emoTimers[mySeatIdx]);
        const ts = Date.now();
        const emo = { id: id, ts: ts };
        db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/emoji').set(emo);
        // إزالة من Firebase بعد 8 ثوانٍ
        __emoTimers[mySeatIdx] = setTimeout(() => {
            if (mySeatIdx !== null) db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/emoji').remove();
        }, 8000);
    }

    function sendEmojiImg(id, imgUrl) {
        closeEmojiPicker();
        if (!me || !me.uid || mySeatIdx === null) return;
        if (__emoTimers[mySeatIdx]) clearTimeout(__emoTimers[mySeatIdx]);
        db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/emoji').set({ id: id, imgUrl: imgUrl, ts: Date.now(), senderName: me.name, senderAvatar: me.avatar });
        __emoTimers[mySeatIdx] = setTimeout(() => {
            if (mySeatIdx !== null) db.ref('rooms/' + roomId + '/seats/' + mySeatIdx + '/emoji').remove();
        }, 8000);
    }

    // ===== إشعار الإيموجي فوق الفيديو =====
    const __emoNotifTimers = {};
    function showEmojiNotif(seatIdx, name, avatar, imgUrl) {
        const wrap = document.getElementById('emoNotifWrap');
        if (!wrap) return;
        // إزالة إشعار سابق لنفس المقعد إن وُجد
        const old = document.getElementById('emoNotif_' + seatIdx);
        if (old) { clearTimeout(__emoNotifTimers[seatIdx]); old.remove(); }

        const el = document.createElement('div');
        el.className = 'emo-notif';
        el.id = 'emoNotif_' + seatIdx;
        el.innerHTML = `
            <img class="emo-notif-av" src="${avatar || ''}" onerror="this.style.background='#888';this.removeAttribute('src')">
            <span class="emo-notif-name">${name || 'مستخدم'}</span>
            <img class="emo-notif-img" src="${imgUrl}" onerror="this.style.display='none'">
        `;
        wrap.appendChild(el);
        // تحديث موضع إشعار الدخول ليكون تحت إشعارات الإيموجي
        setTimeout(function() { if (typeof _rvPositionContainer==='function') _rvPositionContainer(); }, 50);
        // إزالة بعد 4 ثوانٍ (متزامن مع انتهاء animation)
        __emoNotifTimers[seatIdx] = setTimeout(() => {
            el.remove();
            setTimeout(function() { if (typeof _rvPositionContainer==='function') _rvPositionContainer(); }, 50);
        }, 4000);
    }

    // نفس switchCameraFunc من ExempleTools حرفياً
    async function switchCam() {
        if (isSwitchingCamera) return;
        isSwitchingCamera = true;
        const btn = document.getElementById('switchCamBtn');
        if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
        const videoEl = document.getElementById('tv');

        try {
            usingFrontCamera = !usingFrontCamera;
            const targetFacing = usingFrontCamera ? 'user' : 'environment';

            // وقف الـ stream القديم
            if (localStream) localStream.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
            if (videoEl && !isOwner) { /* المنظم لا يعرض في tv */ } else if (videoEl) { videoEl.srcObject = null; }
            localStream = null;

            if (isOwner && videoEl) {
                videoEl.style.opacity = '0';
            }

            let newStream = null;

            // محاولة 1: deviceId
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDev = devices.filter(d => d.kind === 'videoinput');
                if (videoDev.length >= 2) {
                    currentCameraIndex = (currentCameraIndex + 1) % videoDev.length;
                    newStream = await navigator.mediaDevices.getUserMedia({
                        video: { deviceId: { exact: videoDev[currentCameraIndex].deviceId } },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });
                }
            } catch(e1) {}

            // محاولة 2: facingMode ideal
            if (!newStream) {
                try {
                    newStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: targetFacing } },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });
                } catch(e2) {}
            }

            // محاولة 3: facingMode exact
            if (!newStream) {
                try {
                    newStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { exact: targetFacing } },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });
                } catch(e3) {}
            }

            // محاولة 4: أي كاميرا
            if (!newStream) {
                newStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: { echoCancellation: true, noiseSuppression: true }
                });
            }

            localStream = newStream;
            const newVideoTrack = newStream.getVideoTracks()[0];

            // الأستاذ: عرض في tv
            if (isOwner && videoEl) {
                videoEl.srcObject = localStream;
                videoEl.muted = true;
                await videoEl.play().catch(() => {});
            }

            // حالة الميك
            localStream.getAudioTracks().forEach(t => { t.enabled = micOn; });

            // مثل ExempleTools: replaceTrack في WebRTC — مع إضافة track إذا لم يوجد sender
            const newAudioTrack = localStream.getAudioTracks()[0];
            const replaceInPeer = async (pc) => {
                if (!pc || pc.signalingState === 'closed') return;
                const senders = pc.getSenders();
                const videoSender = senders.find(s => s.track && s.track.kind === 'video');
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

                if (videoSender && newVideoTrack) {
                    try { await videoSender.replaceTrack(newVideoTrack); } catch(e) {}
                } else if (newVideoTrack && !videoSender) {
                    // لا يوجد video sender — أضفه (يحدث عند أول تبديل كاميرا)
                    try { pc.addTrack(newVideoTrack, localStream); } catch(e) {}
                }
                if (audioSender && newAudioTrack) {
                    try { await audioSender.replaceTrack(newAudioTrack); } catch(e) {}
                } else if (newAudioTrack && !audioSender) {
                    try { pc.addTrack(newAudioTrack, localStream); } catch(e) {}
                }
            };

            if (isOwner) {
                // استبدل track في كل peers
                await Promise.all(Object.values(teacherPeerConns).map(conn => replaceInPeer(conn && conn.pc)));
                // أبلغ المشاهدين — ownerReoffer يُعيد بناء الـ peers كاملاً (يحل مشكلة الصوت)
                try {
                    if (db && roomId) {
                        db.ref('rooms/' + roomId + '/ownerReoffer').set(Date.now());
                        db.ref('rooms/' + roomId + '/cameraFlip').set({ ts: Date.now(), facing: usingFrontCamera ? 'user' : 'environment' });
                        db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now());
                    }
                } catch(e) {}
                if (_avOverlayOn) {
                    _avOverlayOn = false;
                    var ov2 = document.getElementById('avatarOverlay');
                    if (ov2) ov2.classList.remove('show');
                    var tvEl2 = document.getElementById('tv');
                    if (tvEl2) { tvEl2.srcObject = localStream; tvEl2.muted = true; tvEl2.style.visibility = ''; tvEl2.play().catch(function(){}); }
                    setTimeout(function() {
                        if (!_avOverlayOn) { showAvatarOverlay(); }
                    }, 1500);
                }
            } else if (studentPC) {
                await replaceInPeer(studentPC);
            }

            // ظهور سلس
            if (isOwner && videoEl) {
                setTimeout(() => {
                    videoEl.style.transition = 'opacity 0.3s';
                    videoEl.style.opacity = '1';
                    setTimeout(() => { videoEl.style.transition = ''; }, 300);
                }, 100);
            }

        } catch(err) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (isOwner) { document.getElementById('tv').srcObject = localStream; }
                usingFrontCamera = !usingFrontCamera;
            } catch(e2) {}
            showToast('تعذّر تبديل الكاميرا');
        } finally {
            isSwitchingCamera = false;
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
        }
    }

        // ─── الدردشة ───
    let chatUnread = false;
    function listenChatDB() {
        db.ref('rooms/' + roomId + '/chat').limitToLast(60).on('child_added', snap => {
            const m = snap.val(); if (!m) return;
            addVMsg(m);
            if (!chatVis) { chatUnread = true; document.getElementById('chatDot').style.display = 'block'; }
        });
    }
    function addVMsg(m) {
        const a = document.getElementById('chatArea');
        // هل المستخدم يقرأ رسائل قديمة؟ (لا نتحرك للأسفل إلا إذا كان قريباً من الأسفل)
        const isNearBottom = a.scrollHeight - a.scrollTop - a.clientHeight < 80;

        const d = document.createElement('div'); d.className = 'vmsg';
        var role = m.accountType || m.role || m.type || '';
        var roleClass = 'role-default';
        if (m.isOwner || role === 'teacher')      roleClass = 'role-teacher';
        else if (role === 'institution')           roleClass = 'role-institution';
        else if (role === 'influencer')            roleClass = 'role-influencer';
        else if (role === 'student')               roleClass = 'role-student';
        if (m.uid && typeof ownerUid !== 'undefined' && m.uid === ownerUid) roleClass = 'role-owner';
        d.innerHTML = '<span class="sndr ' + roleClass + '">' + esc(m.name||'مستخدم') + '</span>'
                    + '<span class="tx">' + esc(m.text||'') + '</span>';
        a.appendChild(d);
        // اذهب للأسفل فقط إذا كان المستخدم أصلاً في الأسفل
        if (isNearBottom) a.scrollTop = a.scrollHeight;
        // احتفظ بآخر 80 رسالة (زيادة من 60 للسماح بقراءة التاريخ)
        if (a.children.length > 80) a.removeChild(a.firstChild);
    }
    function toggleChat() {
        chatVis = !chatVis;
        document.getElementById('chatWin').style.display = chatVis ? 'flex' : 'none';
        if (chatVis) { chatUnread = false; document.getElementById('chatDot').style.display = 'none'; }
    }
    function sendMsg() {
        const inp = document.getElementById('msgInp');
        const text = inp.value.trim(); if (!text) return;
        if (text.length > 90) { inp.value = text.slice(0,90); return; }
        if (!chatVis) { chatVis = true; document.getElementById('chatWin').style.display = 'flex'; document.getElementById('chatDot').style.display = 'none'; chatUnread = false; }
        // جلب نوع الحساب من localStorage أو me
        var localU = (typeof getLocalUser === 'function') ? getLocalUser() : {};
        var accType = (localU && (localU.accountType || localU.type)) || (me && me.accountType) || '';
        var msgData = { uid: me.uid, name: me.name, avatar: me.avatar || '', text: text, ts: Date.now() };
        if (accType) msgData.accountType = accType;
        if (isOwner) msgData.isOwner = true;
        db.ref('rooms/' + roomId + '/chat').push(msgData);
        inp.value = '';
    }
    function pingNet() {
        setInterval(() => {
            const t = Date.now();
            db.ref('rooms/' + roomId + '/ping').set(t).then(() => { document.getElementById('netSpd').textContent = (Date.now() - t) + 'ms'; });
        }, 5000);
    }

    // ── إدارة مؤشر التحميل/Buffering ──
    (function initVideoMonitor() {
        var tv = document.getElementById('tv');
        if (!tv) return;

        var _showBuffering = false;
        var _bufferingTimer = null;

        function showBufferingIndicator() {
            if (_showBuffering) return;
            _showBuffering = true;
            var el = document.getElementById('videoBufferingIndicator');
            if (el) el.classList.add('show');
        }

        function hideBufferingIndicator() {
            _showBuffering = false;
            clearTimeout(_bufferingTimer);
            var el = document.getElementById('videoBufferingIndicator');
            if (el) el.classList.remove('show');
        }

        tv.addEventListener('waiting', function() {
            if (!isOwner) {
                clearTimeout(_bufferingTimer);
                _bufferingTimer = setTimeout(showBufferingIndicator, 1500);
            }
        });

        tv.addEventListener('playing', function() {
            hideBufferingIndicator();
            var ri = document.getElementById('reconnectIndicator');
            if (ri) ri.classList.remove('show');
        });

        tv.addEventListener('canplay', function() {
            hideBufferingIndicator();
        });

        tv.addEventListener('stalled', function() {
            if (!isOwner) {
                clearTimeout(_bufferingTimer);
                _bufferingTimer = setTimeout(showBufferingIndicator, 2000);
            }
        });
    })();

    // ─── الهدايا — متطابقة مع index.html ───
    // ── شارة التوثيق في النافذة والمقاعد ──
    var _pmVerifiedCache = {};
    function _pmVerifyBadge(uid, knownVerified) {
        if (!uid) return '';
        if (knownVerified === true) {
            _pmVerifiedCache[uid] = true;
        }
        var v = _pmVerifiedCache[uid];
        if (v === true) {
            return '<img src="verify.png" style="width:14px;height:14px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle;" alt="">';
        }
        if (v === false) return '';
        // غير معروف — جلب من Firebase وتحديث DOM
        if (typeof db !== 'undefined' && uid) {
            db.ref('users/' + uid + '/verified').once('value').then(function(snap) {
                var isV = snap.val() === true;
                _pmVerifiedCache[uid] = isV;
                if (isV) {
                    // تحديث اسم في النافذة إذا كانت مفتوحة لنفس المستخدم
                    if (window._pmUid === uid) {
                        var nmEl = document.getElementById('pmnm');
                        if (nmEl && !nmEl.querySelector('img[src="verify.png"]')) {
                            nmEl.innerHTML = nmEl.textContent.trim() + '<img src="verify.png" style="width:14px;height:14px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle;" alt="">';
                        }
                    }
                    // تحديث شارة في المقاعد (تسمية vlb)
                    document.querySelectorAll('[data-verify-uid="' + uid + '"]').forEach(function(el) {
                        if (!el.querySelector('img[src="verify.png"]')) {
                            var cur = el.textContent;
                            el.style.overflow = 'visible';
                            el.innerHTML = cur + '<img src="verify.png" style="width:11px;height:11px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle;" alt="">';
                        }
                    });
                }
            }).catch(function(){});
        }
        return '';
    }

    // ─── بروفايل ───
    function openProfile(name, src, uid, seatIdx, inRoom) {
        const pmav = document.getElementById('pmav');
        const pmsh = document.getElementById('pmsh');
        if (pmsh) { pmsh.style.display = 'block'; pmsh.style.background = 'linear-gradient(90deg,#e8edf2 25%,#f5f7fa 50%,#e8edf2 75%)'; pmsh.style.backgroundSize = '400% 100%'; pmsh.style.animation = 'shimmer 1.4s ease-in-out infinite'; }
        if (pmav) {
            pmav.style.opacity = '0';
            pmav.removeAttribute('src');
            pmav.removeAttribute('crossorigin');
            pmav._tryN = 0;
            pmav._srcBase = src || '';
            pmav.onload = function() {
                pmav.style.opacity = '1';
                if (pmsh) { pmsh.style.display = 'none'; pmsh.style.animation = 'none'; }
            };
            pmav.onerror = function() {
                if (!pmav._srcBase) {
                    if (pmsh) pmsh.style.display = 'none';
                    return;
                }
                pmav._tryN = (pmav._tryN || 0) + 1;
                if (pmav._tryN <= 3) {
                    var sep = pmav._srcBase.includes('?') ? '&' : '?';
                    setTimeout(function() {
                        if (pmav._tryN === 3) {
                            // المحاولة الأخيرة: جرب الرابط مباشرة بدون cache-busting
                            pmav.src = pmav._srcBase;
                        } else {
                            pmav.src = pmav._srcBase + sep + '_t=' + Date.now();
                        }
                    }, pmav._tryN * 500);
                } else {
                    pmav.style.opacity = '1';
                    if (pmsh) { pmsh.style.animation = 'none'; pmsh.style.background = '#dde3ee'; }
                }
            };
            if (src) {
                pmav.src = src;
            } else {
                pmav.style.opacity = '1';
                if (pmsh) pmsh.style.display = 'none';
            }
        }
        document.getElementById('pmnm').innerHTML = (name || 'مستخدم') + _pmVerifyBadge(uid);
        document.getElementById('pmid').textContent = '';

        // إعادة تعيين الإحصائيات
        var badgeEl = document.getElementById('pmAccountBadge');
        var locEl   = document.getElementById('pmLocation');
        var sfVal   = document.getElementById('pmStatFollow');
        var sfing   = document.getElementById('pmStatFollowing');
        var sfex    = document.getElementById('pmStatExtra');
        var sfexLbl = document.getElementById('pmStatExtraLbl');
        var sfexWr  = document.getElementById('pmStatExtraWrap');
        if (badgeEl) { badgeEl.textContent = ''; badgeEl.style.display = 'none'; }
        if (locEl)   { locEl.textContent = ''; locEl.style.display = 'none'; }
        if (sfVal)   sfVal.textContent   = '—';
        if (sfing)   sfing.textContent   = '—';
        if (sfex)    sfex.textContent    = '—';
        if (sfexWr)  sfexWr.style.display = 'none';

        // إعادة الغلاف للافتراضي
        var coverImg = document.getElementById('pmCoverImg');
        var coverPh  = document.getElementById('pmCoverPlaceholder');
        if (coverImg) { coverImg.style.display = 'none'; coverImg.src = ''; }
        if (coverPh)  coverPh.style.display = 'block';

        // إخفاء جميع الأقسام أولاً
        var slsBtns = document.getElementById('pmSelfBtns');
        var slsBtn  = document.getElementById('pmSelfLeaveSpotBtn');
        var slseat  = document.getElementById('pmSelfLeaveSeatBtn');
        var selfCamWrap = document.getElementById('pmSelfCamWrap');
        var pmFollowWrap = document.getElementById('pmFollowWrap');
        var queueBtn = document.getElementById('pmQueueBtn');
        if (slsBtns)    slsBtns.style.display    = 'none';
        if (slsBtn)     slsBtn.style.display      = 'none';
        if (slseat)     slseat.style.display      = 'none';
        if (selfCamWrap) selfCamWrap.style.display = 'none';
        if (pmFollowWrap) pmFollowWrap.style.display = '';
        if (queueBtn)   queueBtn.style.display    = 'none';

        // إعادة تعيين الأزرار
        const fb  = document.getElementById('pmFollowBtn');
        if (fb)  { fb.innerHTML  = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> متابعة'; fb.className  = 'bac bfl'; }

        // إخفاء أزرار نفسك
        const isSelf = me && uid === me.uid;
        if (fb)  fb.style.display  = isSelf ? 'none' : '';

        window._pmUid    = uid || '';
        window._pmSeat   = (typeof seatIdx === 'number') ? seatIdx : null;
        window._pmName   = name || '';
        window._pmAvatar = src || '';
        window._pmInRoom = (inRoom === true) || (typeof seatIdx === 'number');

        // ── أزرار نفسك ──
        if (isSelf) {
            if (pmFollowWrap) pmFollowWrap.style.display = 'none';

            if (isOwner && typeof seatIdx === 'number') {
                // الأستاذ على مقعده الخاص
                if (selfCamWrap) selfCamWrap.style.display = '';
                if (queueBtn)   { queueBtn.style.display = 'flex'; _updateQueueBtnUI(); }
                // تحديث نص زر الكاميرا
                var camBtn = document.getElementById('pmToggleCamBtn');
                if (camBtn) {
                    camBtn.innerHTML = _avOverlayOn
                        ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="2" y1="2" x2="22" y2="22"/></svg> إظهار الكاميرا'
                        : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> إخفاء الكاميرا';
                }
            } else if (!isOwner) {
                // الطالب على نفسه
                db.ref('rooms/' + roomId + '/spotlight').once('value', function(spSnap) {
                    var spData = spSnap.val();
                    var inSpot = spData && spData.uid && me && spData.uid === me.uid;
                    if (inSpot && slsBtn) {
                        if (slsBtns) slsBtns.style.display = '';
                        slsBtn.style.display = 'flex';
                    }
                });
                if (mySeatIdx !== null && slseat) {
                    if (slsBtns) slsBtns.style.display = '';
                    slseat.style.display = 'flex';
                }
            }
        }

        // فحص حالة المتابعة من Firebase
        if (!isSelf && me && uid) {
            db.ref('followers/' + me.uid + '_' + uid).once('value', snap => {
                if (snap.exists()) {
                    if (fb) { fb.innerHTML = 'يتابعه ✓'; fb.className = 'bac bfl following'; }
                } else {
                    if (fb) { fb.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> متابعة'; fb.className = 'bac bfl'; }
                }
            });
        }

        // جلب بيانات المستخدم من Firebase لعرض الغلاف واسم المستخدم والموقع والنوع
        if (uid && !uid.startsWith('guest_')) {
            db.ref('users/' + uid).once('value', function(uSnap) {
                var ud = uSnap.val() || {};

                // تحديث شارة التوثيق بعد معرفة الحالة
                var isVerified = !!(ud.verified || ud.isVerified);
                _pmVerifiedCache[uid] = isVerified;
                if (isVerified) {
                    var nmEl = document.getElementById('pmnm');
                    if (nmEl && !nmEl.querySelector('img[src="verify.png"]')) {
                        nmEl.innerHTML = (name || 'مستخدم') + '<img src="verify.png" style="width:14px;height:14px;object-fit:contain;flex-shrink:0;display:inline-block;vertical-align:middle;" alt="">';
                    }
                }

                // اسم المستخدم (@username)
                var username = ud.username || ud.userName || '';
                var pidEl = document.getElementById('pmid');
                if (pidEl) pidEl.textContent = username ? ('@' + username) : '';

                // المدينة والدولة
                var city    = ud.city    || ud.location || '';
                var country = ud.country || '';
                var locStr  = [city, country].filter(Boolean).join('، ');
                if (locEl && locStr) { locEl.textContent = locStr; locEl.style.display = 'block'; }

                // نوع الحساب
                var accType = ud.accountType || ud.type || ud.profileType || '';
                var badgeMap = {
                    'teacher':      { label: 'أستاذ',         bg: '#e8f5e9', color: '#2e7d32' },
                    'student':      { label: 'طالب',          bg: '#e3f2fd', color: '#1565c0' },
                    'institution':  { label: 'مؤسسة',         bg: '#fff3e0', color: '#e65100' },
                    'influencer':   { label: 'مؤثر تعليمي',   bg: '#f3e5f5', color: '#6a1b9a' },
                    'admin':        { label: 'مشرف',          bg: '#fce4ec', color: '#c62828' }
                };
                var badge = badgeMap[accType];
                if (badge && badgeEl) {
                    badgeEl.textContent = badge.label;
                    badgeEl.style.background = badge.bg;
                    badgeEl.style.color      = badge.color;
                    badgeEl.style.display    = 'inline-block';
                }

                // الغلاف (cover)
                var coverUrl = ud.coverUrl || ud.cover || ud.coverPhoto || '';
                if (coverUrl && coverImg && coverPh) {
                    coverImg.src = coverUrl;
                    coverImg.style.display = 'block';
                    coverPh.style.display  = 'none';
                    coverImg.onerror = function() { coverImg.style.display='none'; coverPh.style.display='block'; };
                }

                // إحصائيات المتابعين
                db.ref('followers').orderByChild('userId').equalTo(uid).once('value', function(fSnap) {
                    var fCount = fSnap.numChildren ? fSnap.numChildren() : (fSnap.val() ? Object.keys(fSnap.val()).length : 0);
                    if (sfVal) sfVal.textContent = fCount > 999 ? (Math.floor(fCount/1000)+'k') : String(fCount);
                });
                db.ref('followers').orderByChild('followerId').equalTo(uid).once('value', function(fiSnap) {
                    var fiCount = fiSnap.numChildren ? fiSnap.numChildren() : (fiSnap.val() ? Object.keys(fiSnap.val()).length : 0);
                    if (sfing) sfing.textContent = fiCount > 999 ? (Math.floor(fiCount/1000)+'k') : String(fiCount);
                });

                // إحصائيات خاصة بالنوع
                if (accType === 'teacher' || accType === 'institution') {
                    var studentsPath = accType === 'institution' ? ('institutions/' + uid + '/students') : ('teachers/' + uid + '/students');
                    db.ref(studentsPath).once('value', function(stSnap) {
                        var stCount = stSnap.numChildren ? stSnap.numChildren() : (stSnap.val() ? Object.keys(stSnap.val()).length : 0);
                        if (sfex) sfex.textContent = stCount > 999 ? (Math.floor(stCount/1000)+'k') : String(stCount);
                        if (sfexLbl) sfexLbl.textContent = 'طلاب';
                        if (sfexWr)  sfexWr.style.display = '';
                    });
                }
            });
        }

        updateOwnerPanel();
        openOv();
        document.getElementById('pm').classList.add('show');
    }

    // ── الطالب يخرج من البث بنفسه ──
    function _selfLeaveSpotlight() {
        closeAll();
        showConfirm('الخروج من البث', 'هل تريد الخروج من البث؟ سيعود الفيديو للأستاذ.', async function() {
            try { await db.ref('rooms/' + roomId + '/spotlight').remove(); } catch(e) {}
            // إطفاء الكاميرا
            if (localStream) localStream.getVideoTracks().forEach(function(t){ t.enabled = false; });
            var scb = document.getElementById('switchCamBtn');
            if (scb) scb.style.display = 'none';
            showSnack('خرجت من البث', '');
        });
    }

    // ── الطالب يزيل نفسه من المقعد ──
    function _selfLeaveSeat() {
        closeAll();
        showConfirm('إزالة نفسي من المقعد', 'هل تريد ترك المقعد؟', async function() {
            if (mySeatIdx === null) return;
            var sIdx = mySeatIdx;
            // تحقق: إذا كان في البث أيضاً — أزل spotlight أيضاً
            try {
                var spSnap = await db.ref('rooms/' + roomId + '/spotlight').get();
                var spData = spSnap.val();
                if (spData && spData.uid === me.uid) {
                    await db.ref('rooms/' + roomId + '/spotlight').remove();
                }
            } catch(e) {}
            // إطفاء الميك والكاميرا
            micOn = false;
            if (localStream) localStream.getTracks().forEach(function(t){ t.enabled = false; });
            var mcBtnRm = document.getElementById('mcBtn');
            if (mcBtnRm) mcBtnRm.style.display = 'none';
            // إزالة المقعد
            try { await db.ref('rooms/' + roomId + '/seats/' + sIdx).remove(); } catch(e) {}
            mySeatIdx = null;
            showSnack('تم ترك المقعد', '');
        });
    }

    function updateOwnerPanel() {
        const panel = document.getElementById('pmow');
        if (!panel) return;
        const uid     = window._pmUid || '';
        const seatIdx = window._pmSeat;
        const personInRoom = window._pmInRoom === true;
        if (isOwner && uid && me && me.uid && uid !== me.uid && personInRoom) {
            panel.style.display = 'block';
            const ib = document.getElementById('pmInviteBtn');
            if (ib) {
                if (typeof seatIdx === 'number') {
                    ib.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="13" rx="2"/><line x1="12" y1="3" x2="12" y2="12"/><polyline points="8 7 12 3 16 7"/></svg> إزالة من المقعد`;
                } else {
                    ib.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="13" rx="2"/><path d="M12 3v9m-4-4 4-5 4 5"/></svg> دعوة للمقعد`;
                }
            }
            // زر الكتم — يظهر فقط إذا كان الشخص في مقعد
            const mb = document.getElementById('pmOwnerMuteBtn');
            const boardBtn = document.getElementById('pmBoardBtn');
            if (mb) {
                if (typeof seatIdx === 'number') {
                    mb.style.display = 'flex';
                    mb.classList.remove('pmobtn-hidden');
                    if (boardBtn) boardBtn.style.gridColumn = '';
                    db.ref('rooms/' + roomId + '/seats/' + seatIdx + '/ownerMuted').once('value', snap => {
                        if (snap.val() === true) {
                            mb.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> رفع الكتم';
                            mb.style.background = '#166534'; mb.style.color = '#fff';
                        } else {
                            mb.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> كتم المايك';
                            mb.style.background = '#0f4c81'; mb.style.color = '#fff';
                        }
                    });
                } else {
                    mb.style.display = 'none';
                    // اجعل زر الكتابة يمتد على كامل الصف
                    if (boardBtn) boardBtn.style.gridColumn = '1 / -1';
                }
            }
        } else {
            panel.style.display = 'none';
        }
    }

    // ─── مساعد: إنشاء صورة بـ shimmer Facebook ───
    function mkAvImg(src, size, cls) {
        const wrap = document.createElement('div');
        wrap.className = 'av-shimmer-wrap ' + (cls||'');
        wrap.style.cssText = 'width:'+size+'px;height:'+size+'px;';
        const sh = document.createElement('div'); sh.className = 'av-sh';
        const im = document.createElement('img');
        im.width = size; im.height = size;
        im.style.cssText = 'width:'+size+'px;height:'+size+'px;border-radius:50%;background:#e4e6eb;';
        im._srcBase = src || '';
        im._tryN = 0;
        im.addEventListener('load', function() { wrap.classList.add('loaded'); });
        im.addEventListener('error', function() {
            im._tryN = (im._tryN || 0) + 1;
            if (im._tryN <= 2 && im._srcBase) {
                var sep = im._srcBase.includes('?') ? '&' : '?';
                setTimeout(function() { im.src = im._srcBase + sep + '_r=' + Date.now(); }, im._tryN * 600);
            } else {
                wrap.classList.add('loaded');
                im.style.background = '#e4e6eb';
            }
        });
        if (src) { im.src = src; } else { wrap.classList.add('loaded'); }
        wrap.appendChild(sh); wrap.appendChild(im);
        return { wrap, im };
    }

    // ─── ربط أزرار البروفايل ───
    function bindProfileButtons() {
        document.getElementById('pmInviteBtn').onclick = async function() {
            const uid = window._pmUid; const nm = window._pmName; const seatIdx = window._pmSeat;
            if (!uid) return;
            if (typeof seatIdx === 'number') {
                if (!isOwner) return;
                showConfirm('إزالة من المقعد', `هل تريد إزالة ${nm || 'المستخدم'} من المقعد؟`, async () => {
                    // أزل المقعد من Firebase — سينعكس فوراً على الجميع عبر listenSeats
                    await db.ref('rooms/' + roomId + '/seats/' + seatIdx).remove();
                    // أرسل إشارة للشخص المُزال ليعرف أنه أُزيل من المقعد
                    await db.ref('rooms/' + roomId + '/seatRemoved/' + uid).set({
                        seatIdx: seatIdx,
                        ts: Date.now(),
                        by: me.uid,
                        byName: me.name || 'المشرف'
                    });
                    closeAll();
                    showSnack('تمت إزالة ' + (nm || 'المستخدم') + ' من المقعد', '✅');
                });
                return;
            }
            await inviteToSeat(uid, nm, null);
        };

        // ───  زر المتابعة (toggle + Firebase) ───
        document.getElementById('pmFollowBtn').onclick = async function() {
            const uid = window._pmUid; const nm = window._pmName;
            if (!uid || !me || uid === me.uid) return;
            const followId = me.uid + '_' + uid;
            const snap = await db.ref('followers/' + followId).once('value');
            if (snap.exists()) {
                await db.ref('followers/' + followId).remove();
                this.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> متابعة';
                this.className = 'bac bfl';
                showSnack('تم إلغاء المتابعة', '');
            } else {
                await db.ref('followers/' + followId).set({ userId: uid, followerId: me.uid, createdAt: Date.now() });
                // إشعار للطرف الآخر
                db.ref('notifications').push({ type:'follow', fromUserId:me.uid, fromName:me.name||'', fromAvatar:me.avatar||'', toUserId:uid, createdAt:Date.now(), isRead:false });
                this.innerHTML = 'يتابعه ✓';
                this.className = 'bac bfl following';
                showSnack('تمت متابعة ' + (nm||'المستخدم'), '');
            }
        };

        document.getElementById('pmSpotBtn').onclick = function() {
            const uid = window._pmUid; const nm = window._pmName;
            if (!uid || !isOwner) return;
            // تحقق من حالة الـ peer — إذا كانت سيئة أعِد بناءه أولاً
            var targetConn = null;
            for (var k in teacherPeerConns) {
                var c = teacherPeerConns[k];
                if (c && c.uid === uid) { targetConn = c; break; }
            }
            if (targetConn && targetConn.pc) {
                var st = targetConn.pc.iceConnectionState;
                if (st === 'failed' || st === 'disconnected' || st === 'closed' || targetConn.pc.signalingState === 'closed') {
                    var badKey2 = null;
                    for (var k2 in teacherPeerConns) { if (teacherPeerConns[k2] === targetConn) { badKey2 = k2; break; } }
                    if (badKey2) {
                        showSnack('جاري إعادة الاتصال...', '');
                        _rebuildPeerForOrganizer(badKey2, uid).then(function() {
                            setTimeout(function() { sendSpotlightInvite(uid, nm); }, 1200);
                        }).catch(function() { sendSpotlightInvite(uid, nm); });
                        closeAll();
                        return;
                    }
                }
            }
            sendSpotlightInvite(uid, nm);
        };
        // ─── زر منح الكتابة على السبورة ───
        const pmBoardBtn = document.getElementById('pmBoardBtn');
        if (pmBoardBtn) {
            pmBoardBtn.onclick = function() {
                const uid = window._pmUid; const nm = window._pmName; const av = window._pmAvatar || '';
                if (!uid || !isOwner) return;
                closeAll();
                if (typeof window.brdGrantPermission === 'function') {
                    window.brdGrantPermission(uid, nm, av);
                }
                showSnack('تم منح ' + (nm || 'الطالب') + ' إذن الكتابة على السبورة', '');
                var bw = document.getElementById('boardWindow');
                if (bw && !bw.classList.contains('open')) openBoard();
            };
        }
        document.getElementById('pmKickBtn').onclick = function() {
            const uid = window._pmUid; const nm = window._pmName;
            if (!uid || !isOwner) return; kickUser(uid, nm);
        };
        document.getElementById('pmBanBtn').onclick = function() {
            const uid = window._pmUid; const nm = window._pmName;
            if (!uid || !isOwner) return; blacklistUser(uid, nm);
        };
        // زر كتم الأستاذ
        const pmOwnerMuteBtn = document.getElementById('pmOwnerMuteBtn');
        if (pmOwnerMuteBtn) {
            pmOwnerMuteBtn.onclick = function() {
                const uid = window._pmUid; const nm = window._pmName;
                const seatIdx = window._pmSeat;
                if (!uid || !isOwner || typeof seatIdx !== 'number') return;
                const seatRef = db.ref('rooms/' + roomId + '/seats/' + seatIdx);
                seatRef.once('value', snap => {
                    const s = snap.val();
                    if (!s) return;
                    if (s.ownerMuted) {
                        // رفع الكتم
                        seatRef.update({ ownerMuted: false });
                        showSnack('تم رفع كتم ' + (nm || 'المستخدم'), '🔊');
                        pmOwnerMuteBtn.textContent = 'كتم المايك';
                        pmOwnerMuteBtn.style.background = '#fff3e0';
                        pmOwnerMuteBtn.style.color = '#e67e22';
                    } else {
                        // كتم
                        seatRef.update({ ownerMuted: true, micOn: false });
                        // إشعار المستخدم المكتوم عبر Firebase
                        db.ref('rooms/' + roomId + '/ownerMuteSignal/' + uid).set({ muted: true, ts: Date.now() });
                        showSnack('تم كتم ' + (nm || 'المستخدم') + ' من الأستاذ', '🔇');
                        pmOwnerMuteBtn.textContent = 'رفع الكتم';
                        pmOwnerMuteBtn.style.background = '#e8f5e9';
                        pmOwnerMuteBtn.style.color = '#27ae60';
                    }
                    closeAll();
                });
            };
        }
        document.getElementById('pCount').onclick = function() { openViewersModal(); };
        document.getElementById('spCancel').onclick = closeAll;
        document.getElementById('spInvite').onclick = async function() {
            if (!window._seatPickUid || typeof window._seatPickIdx !== 'number') return;
            const uid = window._seatPickUid; const nm = window._seatPickName||''; const seat = window._seatPickIdx;
            closeAll(); await inviteToSeat(uid, nm, seat);
        };

        // ── ربط زر الطابور ──
        var qBtn = document.getElementById('pmQueueBtn');
        if (qBtn) qBtn.addEventListener('click', function() {
            toggleQueueMode();
            closeAll();
        });
    }

    // ══════════════════════════════════════════════════════
    //  نظام الطابور — Queue System
    // ══════════════════════════════════════════════════════
    var _queueOn = false;           // هل الطابور مفعّل؟
    var _queueListener = null;      // مستمع Firebase للطلبات
    var _queueRequests = {};        // الطلبات الحالية { uid: {name,avatar,seatWanted,ts} }

    // ── تحديث UI زر الطابور ──
    function _updateQueueBtnUI() {
        var btn   = document.getElementById('pmQueueBtn');
        var dot   = document.getElementById('pmQueueDot');
        var icon  = document.getElementById('pmQueueIcon');
        var label = document.getElementById('pmQueueLabel');
        if (!btn) return;
        if (_queueOn) {
            // مفعّل — أخضر مع أيقونة إيقاف (X)
            btn.style.background  = 'linear-gradient(135deg,#11998e,#38ef7d)';
            btn.style.color       = '#fff';
            btn.style.boxShadow   = '0 2px 8px rgba(17,153,142,0.4)';
            if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
            if (label) label.textContent = 'إيقاف الطابور';
        } else {
            // غير مفعّل — بنفسجي مع أيقونة تشغيل (check)
            btn.style.background  = 'linear-gradient(135deg,#667eea,#764ba2)';
            btn.style.color       = '#fff';
            btn.style.boxShadow   = '0 2px 8px rgba(102,126,234,0.35)';
            if (icon) icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="8,12 11,15 16,9"/></svg>';
            if (label) label.textContent = 'تفعيل الطابور';
        }
        // النقطة الحمراء إذا كان الطابور مفعّلاً وتوجد طلبات
        var hasReq = _queueOn && Object.keys(_queueRequests).length > 0;
        if (dot) dot.style.display = hasReq ? 'block' : 'none';
    }

    // ── تفعيل / إيقاف الطابور ──
    function toggleQueueMode() {
        if (!isOwner) return;
        _queueOn = !_queueOn;
        // حفظ حالة الطابور في Firebase حتى يعلم الجميع
        db.ref('rooms/' + roomId + '/queueMode').set(_queueOn);
        if (_queueOn) {
            showSnack('تم تفعيل الطابور — طلبات الجلوس ستحتاج موافقتك', '🪑');
            _startQueueListener();
        } else {
            showSnack('تم إيقاف الطابور — الجلوس متاح للجميع', '✅');
            _stopQueueListener();
            _queueRequests = {};
            _updateQueueBtnUI();
            _updateQueueDots();
        }
    }

    // ── مستمع طلبات الطابور (للمالك) ──
    function _startQueueListener() {
        if (!isOwner) return;
        if (_queueListener) {
            db.ref('rooms/' + roomId + '/queueRequests').off('value', _queueListener);
        }
        _queueListener = db.ref('rooms/' + roomId + '/queueRequests').on('value', function(snap) {
            _queueRequests = snap.val() || {};
            _updateQueueBtnUI();
            _updateQueueDots();
            // تحديث نافذة القائمة إن كانت مفتوحة على tab الطابور
            if (document.getElementById('viewersModal').classList.contains('open') &&
                window._viewersActiveTab === 'queue') {
                renderQueueList();
            }
        });
    }

    function _stopQueueListener() {
        if (_queueListener) {
            db.ref('rooms/' + roomId + '/queueRequests').off('value', _queueListener);
            _queueListener = null;
        }
    }

    // ── تحديث نقاط الإشعار على pCount وزر الطابور ──
    function _updateQueueDots() {
        var count = Object.keys(_queueRequests).length;
        var hasReq = _queueOn && count > 0;
        var pDot = document.getElementById('pCountQueueDot');
        if (pDot) pDot.style.display = hasReq ? 'block' : 'none';
        var tabBadge = document.getElementById('queueTabBadge');
        if (tabBadge) {
            tabBadge.textContent = count > 0 ? count : '';
            tabBadge.style.display = (hasReq) ? 'flex' : 'none';
        }
    }

    // ── المشاهد: مستمع لحالة الطابور ──
    function listenQueueMode() {
        db.ref('rooms/' + roomId + '/queueMode').on('value', function(snap) {
            var qOn = snap.val() === true;
            window._roomQueueOn = qOn;
            if (!qOn) {
                // إلغاء أي طلب جلوس معلّق للمشاهد الحالي
                if (!isOwner && me && me.uid) {
                    db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).once('value', function(rs) {
                        if (rs.exists()) {
                            db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).remove();
                        }
                    });
                }
            }
        });
    }

    // ── عند ضغط مشاهد على مقعد فارغ وكان الطابور مفعّلاً ──
    // نُستدعى من onSeat() بدلاً من takeSeat()
    function requestSeat(seatIdx) {
        if (!me || !me.uid) return;
        // أرسل طلباً للمالك
        db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).set({
            uid:       me.uid,
            name:      me.name || 'مستخدم',
            avatar:    me.avatar || '',
            seatWanted: seatIdx,
            ts:        Date.now()
        });
        showSnack('تم إرسال طلب الجلوس — انتظر موافقة أدمين الغرفة', '🪑');
    }

    // ── المالك: قبول طلب جلوس ──
    async function acceptQueueRequest(uid) {
        if (!isOwner || !uid) return;
        var req = _queueRequests[uid];
        if (!req) return;
        var seatWanted = typeof req.seatWanted === 'number' ? req.seatWanted : null;
        var target = null;

        // تحقق من المقعد المطلوب
        if (seatWanted !== null && seatWanted !== 0) {
            var snap = await db.ref('rooms/' + roomId + '/seats/' + seatWanted).get();
            if (!snap.val() || !snap.val().userId) {
                target = seatWanted; // المقعد فارغ
            }
        }
        // إذا كان المقعد مشغولاً، اختر أي مقعد فارغ
        if (target === null) {
            var seatsSnap = await db.ref('rooms/' + roomId + '/seats').get();
            var seats = seatsSnap.val() || {};
            for (var i = 1; i < SEATS; i++) {
                if (!seats[i] || !seats[i].userId) { target = i; break; }
            }
        }
        if (target === null) { showToast('لا توجد مقاعد فارغة'); return; }

        // أرسل دعوة مقعد عادية
        await db.ref('rooms/' + roomId + '/seatInvites/' + uid).set({
            seat: target, ts: Date.now(), by: me.uid, byName: me.name || 'مشرف',
            fromQueue: true
        });
        // احذف الطلب
        await db.ref('rooms/' + roomId + '/queueRequests/' + uid).remove();
        showSnack('تم قبول ' + (req.name || 'المستخدم') + ' للجلوس', '✅');
        // تحديث القائمة
        renderQueueList();
    }

    // ── تبديل الـ tabs في نافذة المشاهدين ──
    window._viewersActiveTab = 'viewers';
    function switchViewersTab(tab) {
        window._viewersActiveTab = tab;
        var tv = document.getElementById('tabViewers');
        var tq = document.getElementById('tabQueue');
        var vb = document.getElementById('viewersModalBody');
        var qb = document.getElementById('queueModalBody');
        if (tab === 'viewers') {
            if (tv) { tv.style.color = '#1877f2'; tv.style.borderBottomColor = '#1877f2'; }
            if (tq) { tq.style.color = '#888';    tq.style.borderBottomColor = 'transparent'; }
            if (vb) vb.style.display = '';
            if (qb) qb.style.display = 'none';
        } else {
            if (tv) { tv.style.color = '#888';    tv.style.borderBottomColor = 'transparent'; }
            if (tq) { tq.style.color = '#e65100'; tq.style.borderBottomColor = '#e65100'; }
            if (vb) vb.style.display = 'none';
            if (qb) qb.style.display = '';
            renderQueueList();
        }
    }

    // ── رسم قائمة الطابور ──
    function renderQueueList() {
        var body = document.getElementById('queueModalBody');
        if (!body) return;
        var reqs = _queueRequests || {};
        var keys = Object.keys(reqs);
        if (!keys.length) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;font-size:13px;">🪑 لا توجد طلبات جلوس حالياً</div>';
            return;
        }
        body.innerHTML = '';
        keys.forEach(function(uid) {
            var req = reqs[uid];
            if (!req) return;
            var nm = req.name || 'مستخدم';
            var av = req.avatar || '';
            var item = document.createElement('div');
            item.className = 'viewer-item';
            item.innerHTML = `
                <div class="viewer-info">
                    <div class="viewer-name">${esc(nm)}</div>
                    <div class="viewer-sub">يطلب الجلوس في المقعد ${(req.seatWanted !== null && req.seatWanted !== undefined) ? (req.seatWanted + 1) : ''}</div>
                </div>
                <div class="viewer-ac">
                    <button class="orgb orgs" id="qAccept_${uid}">✓ قبول</button>
                    <button class="orgb orgx" id="qReject_${uid}">✕ رفض</button>
                </div>`;
            // صورة
            var avWrap = document.createElement('div');
            avWrap.style.cssText = 'width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#e4e6eb;';
            if (av) {
                var img = document.createElement('img');
                img.src = av; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
                img.onerror = function(){ this.style.background='#e4e6eb'; this.removeAttribute('src'); };
                avWrap.appendChild(img);
            }
            item.prepend(avWrap);
            // زر قبول
            item.querySelector('#qAccept_'+uid).addEventListener('click', function(e) {
                e.stopPropagation();
                acceptQueueRequest(uid);
            });
            // زر رفض
            item.querySelector('#qReject_'+uid).addEventListener('click', function(e) {
                e.stopPropagation();
                db.ref('rooms/' + roomId + '/queueRequests/' + uid).remove();
                showSnack('تم رفض طلب ' + nm, '');
                renderQueueList();
            });
            body.appendChild(item);
        });
    }

    // ═══════════════════════════════════════════════
    //  نافذة الدردشة المصغرة — Mini Chat
    // ═══════════════════════════════════════════════
    let mc = { chatId:null, otherUid:null, otherName:'', otherAv:'', listener:null, onlineListener:null, typingListener:null, pendingImg:null, mediaRecorder:null, audioChunks:[], isRecording:false, recInterval:null, recSec:0, lastDate:'', lastSender:null, audioPlayers:{} };

    function openMiniChat(uid, name, av) {
        if (!me) return;
        mc.otherUid  = uid;
        mc.otherName = name || 'مستخدم';
        mc.otherAv   = av   || '';
        mc.chatId    = [me.uid, uid].sort().join('_');
        mc.lastDate  = ''; mc.lastSender = null;

        // هيدر
        const hdrAv = document.getElementById('mcHdrAv');
        hdrAv.src = mc.otherAv || ('https://ui-avatars.com/api/?name='+encodeURIComponent(mc.otherName)+'&background=1877f2&color=fff&size=84');
        hdrAv.onerror = () => { hdrAv.src = 'https://ui-avatars.com/api/?name=U&background=1877f2&color=fff&size=84'; };
        document.getElementById('mcHdrName').textContent = mc.otherName;
        document.getElementById('mcHdrStatus').textContent = '';

        // إظهار النافذة
        document.getElementById('mcWrap').classList.add('open');
        document.body.style.overflow = 'hidden';

        // تحميل + استماع للرسائل
        mcLoadMessages();
        // إنشاء node الشات إذا لم يكن موجوداً
        mcEnsureChat();
        // استماع للـ online
        mc.onlineListener && db.ref('chats/'+mc.chatId+'/online/'+mc.otherUid).off('value', mc.onlineListener);
        mc.onlineListener = db.ref('chats/'+mc.chatId+'/online/'+mc.otherUid).on('value', snap => {
            document.getElementById('mcHdrStatus').textContent = snap.val() ? '🟢 متصل الآن' : '';
        });
        // استماع لـ "يكتب"
        mc.typingListener && db.ref('chats/'+mc.chatId+'/typing/'+mc.otherUid).off('value', mc.typingListener);
        mc.typingListener = db.ref('chats/'+mc.chatId+'/typing/'+mc.otherUid).on('value', snap => {
            const area = document.getElementById('mcMsgs');
            const ex = document.getElementById('mcTyping');
            if (snap.val()) {
                if (!ex) {
                    const el = document.createElement('div');
                    el.id = 'mcTyping'; el.className = 'mc-row theirs';
                    el.style.direction = 'ltr';
                    el.innerHTML = `<img class="mc-av" src="${esc(mc.otherAv||'')}" onerror="this.style.background='#ddd';this.removeAttribute('src')"><div class="mc-bubble" style="padding:10px 14px;"><span style="letter-spacing:2px;color:#aaa;">●●●</span></div>`;
                    area.appendChild(el); area.scrollTop = area.scrollHeight;
                }
            } else { if (ex) ex.remove(); }
        });
        // تعيين online
        db.ref('chats/'+mc.chatId+'/online/'+me.uid).set(true);
        db.ref('chats/'+mc.chatId+'/online/'+me.uid).onDisconnect().set(false);
        // قراءة
        db.ref('chats/'+mc.chatId+'/unread/'+me.uid).set(0);
    }

    function mcEnsureChat() {
        if (!mc.chatId || !mc.otherUid || !me) return;
        db.ref('chats/'+mc.chatId).once('value', snap => {
            if (!snap.exists()) {
                db.ref('chats/'+mc.chatId).set({
                    participants:{ [me.uid]:true, [mc.otherUid]:true },
                    participantDetails:{
                        [me.uid]:       { name:me.name||'',     avatar:me.avatar||''     },
                        [mc.otherUid]:  { name:mc.otherName||'', avatar:mc.otherAv||''   }
                    },
                    lastMessage:'', lastMessageTime:Date.now(),
                    unread:{ [me.uid]:0, [mc.otherUid]:0 }
                });
            } else {
                const v = snap.val()||{};
                const det = v.participantDetails||{};
                const ups = {};
                if (!det[mc.otherUid]||!det[mc.otherUid].name) ups['participantDetails/'+mc.otherUid+'/name'] = mc.otherName;
                if (!det[mc.otherUid]||!det[mc.otherUid].avatar) ups['participantDetails/'+mc.otherUid+'/avatar'] = mc.otherAv;
                if (Object.keys(ups).length) db.ref('chats/'+mc.chatId).update(ups);
            }
        });
        // تحميل صورة الطرف الآخر من users/ إذا لم تكن موجودة
        if (!mc.otherAv) {
            db.ref('users/'+mc.otherUid).once('value', snap => {
                const u = snap.val()||{};
                if (u.avatar) { mc.otherAv = u.avatar; document.getElementById('mcHdrAv').src = u.avatar; }
                if (u.yourname||u.name) { mc.otherName = u.yourname||u.name||mc.otherName; document.getElementById('mcHdrName').textContent = mc.otherName; }
            });
        }
    }

    function mcLoadMessages() {
        const area = document.getElementById('mcMsgs');
        area.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">⏳</div>';
        // إلغاء المستمع القديم
        if (mc.listener) { try { db.ref('chats/'+mc.chatId+'/messages').off('child_added', mc.listener); } catch(_){} }
        let firstLoad = true;
        mc.listener = db.ref('chats/'+mc.chatId+'/messages').orderByChild('createdAt').limitToLast(60).on('child_added', (snap) => {
            if (firstLoad) { area.innerHTML = ''; firstLoad = false; }
            mcRenderMsg(snap.val(), snap.key);
            db.ref('chats/'+mc.chatId+'/unread/'+me.uid).set(0);
        });
    }

    function mcRenderMsg(msg, key) {
        if (!msg) return;
        const area = document.getElementById('mcMsgs');
        const isMine = msg.senderId === me.uid;
        const ts = typeof msg.createdAt === 'number' ? msg.createdAt : Date.now();
        const dateStr = new Date(ts).toLocaleDateString('ar');
        const timeStr = new Date(ts).toLocaleTimeString('ar', {hour:'2-digit',minute:'2-digit'});

        // فاصل التاريخ
        if (dateStr !== mc.lastDate) {
            mc.lastDate = dateStr; mc.lastSender = null;
            const sep = document.createElement('div'); sep.className = 'mc-date-sep';
            sep.innerHTML = `<span>${dateStr}</span>`;
            area.appendChild(sep);
        }

        const avSrc = isMine ? (me.avatar||'') : (mc.otherAv||'');
        const isNewGroup = msg.senderId !== mc.lastSender;

        // إخفاء صورة الرسالة السابقة من نفس الشخص
        if (!isNewGroup) {
            const prevRows = area.querySelectorAll('.mc-row.'+(isMine?'mine':'theirs'));
            if (prevRows.length > 0) prevRows[prevRows.length-1].querySelector('.mc-av')?.classList.add('hidden');
        }
        mc.lastSender = msg.senderId;

        // محتوى الفقاعة
        let content = '';
        if (msg.text) {
            content = `<div style="white-space:pre-wrap;">${esc(msg.text)}</div>`;
        } else if (msg.imageUrl) {
            content = `<img class="mc-img-bubble" src="${esc(msg.imageUrl)}" onclick="mcOpenImg('${esc(msg.imageUrl)}')" loading="lazy">`;
        } else if (msg.audioUrl) {
            const aid = 'mcaud_'+key;
            content = `<div class="mc-audio-bubble">
              <button class="mc-audio-play" onclick="mcToggleAudio('${aid}','${esc(msg.audioUrl)}')" id="mcbtn_${aid}">
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="white"/></svg>
              </button>
              <div class="mc-audio-wave" id="mcwave_${aid}">
                <span style="height:6px"></span><span style="height:14px"></span><span style="height:20px"></span>
                <span style="height:10px"></span><span style="height:18px"></span><span style="height:8px"></span>
                <span style="height:16px"></span><span style="height:12px"></span>
              </div>
              <span class="mc-audio-dur" id="mcdur_${aid}">0:00</span>
            </div>`;
        }

        const tickSvg = isMine ? (msg.isRead
            ? `<svg viewBox="0 0 16 11" width="14"><path d="M1 5.5L5 9.5L11 1" stroke="#4fc3f7" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 5.5L9 9.5L15 1" stroke="#4fc3f7" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
            : `<svg viewBox="0 0 16 11" width="14"><path d="M1 5.5L5 9.5L11 1" stroke="#aaa" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`) : '';

        const row = document.createElement('div');
        row.className = `mc-row ${isMine?'mine':'theirs'}`;
        const avHtml = `<img class="mc-av" src="${esc(avSrc)}" onerror="this.style.background='#ddd';this.removeAttribute('src')">`;
        const bubbleHtml = `<div class="mc-bubble">${content}<div class="mc-meta"><span class="mc-time">${timeStr}</span>${isMine?`<span>${tickSvg}</span>`:''}</div></div>`;
        row.innerHTML = isMine ? bubbleHtml + avHtml : avHtml + bubbleHtml;
        area.appendChild(row);
        area.scrollTop = area.scrollHeight;
    }

    function mcSendText() {
        const ta = document.getElementById('mcTxt');
        if (mc.pendingImg) { mcDoSendImg(); return; }
        const text = ta.value.trim();
        if (!text || !me || !mc.chatId) return;
        ta.value = ''; ta.style.height = 'auto';
        const msg = { senderId:me.uid, text, createdAt:Date.now(), isRead:false };
        db.ref('chats/'+mc.chatId+'/messages').push(msg);
        db.ref('chats/'+mc.chatId).update({
            lastMessage:text, lastMessageTime:Date.now(),
            ['unread/'+mc.otherUid]: Date.now(), // trigger
            ['participants/'+me.uid]:true, ['participants/'+mc.otherUid]:true,
            ['participantDetails/'+me.uid+'/name']:me.name||'',
            ['participantDetails/'+me.uid+'/avatar']:me.avatar||'',
            ['participantDetails/'+mc.otherUid+'/name']:mc.otherName||'',
            ['participantDetails/'+mc.otherUid+'/avatar']:mc.otherAv||''
        });
        // unread بشكل صحيح
        db.ref('chats/'+mc.chatId+'/unread/'+mc.otherUid).transaction(v=>(v||0)+1);
        // إشعار
        db.ref('notifications').push({ type:'message', fromUserId:me.uid, fromName:me.name||'', fromAvatar:me.avatar||'', toUserId:mc.otherUid, text:'أرسل لك رسالة', createdAt:Date.now(), isRead:false });
        db.ref('chats/'+mc.chatId+'/typing/'+me.uid).set(false);
    }

    function mcNotifyTyping() {
        if (!me||!mc.chatId) return;
        db.ref('chats/'+mc.chatId+'/typing/'+me.uid).set(true);
        clearTimeout(mc._typingTimeout);
        mc._typingTimeout = setTimeout(() => db.ref('chats/'+mc.chatId+'/typing/'+me.uid).set(false), 2500);
    }

    // ─ صورة ─
    function mcOnImgSelected(input) {
        const file = input.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w=img.width, h=img.height, max=900;
                if(w>max){h=h*(max/w);w=max;}
                canvas.width=w; canvas.height=h;
                canvas.getContext('2d').drawImage(img,0,0,w,h);
                canvas.toBlob(blob => {
                    mc.pendingImg = blob;
                    document.getElementById('mcImgThumb').src = e.target.result;
                    document.getElementById('mcImgPrev').classList.add('show');
                }, 'image/jpeg', 0.82);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
        input.value = '';
    }
    function mcCancelImg() { mc.pendingImg = null; document.getElementById('mcImgPrev').classList.remove('show'); }
    function mcDoSendImg() {
        if (!mc.pendingImg) return;
        const blob = mc.pendingImg; mcCancelImg();
        if (typeof storage === 'undefined') { showToast('رفع الصور غير متاح حالياً'); return; }
        uploadToCloudinary(blob).then(function(url) {
            const msg={senderId:me.uid,imageUrl:url,createdAt:Date.now(),isRead:false};
            db.ref('chats/'+mc.chatId+'/messages').push(msg);
            db.ref('chats/'+mc.chatId).update({lastMessage:'صورة',lastMessageTime:Date.now(),['unread/'+mc.otherUid]:Date.now()});
            db.ref('chats/'+mc.chatId+'/unread/'+mc.otherUid).transaction(v=>(v||0)+1);
        }).catch(e=>console.warn('img upload',e));
    }

    // ─ صوت ─
    async function mcToggleRecord() {
        if (mc.isRecording) return;
        // إذا كان المايك مشغولاً في الغرفة
        if (localStream && localStream.getAudioTracks().some(t=>t.enabled)) {
            showToast('أوقف مايكروفون الغرفة أولاً لإرسال رسالة صوتية');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio:true});
            mc.mediaRecorder = new MediaRecorder(stream);
            mc.audioChunks = [];
            mc.mediaRecorder.ondataavailable = e => mc.audioChunks.push(e.data);
            mc.mediaRecorder.start();
            mc.isRecording = true; mc.recSec = 0;
            document.getElementById('mcRecTimer').textContent = '0:00';
            document.getElementById('mcRecBar').classList.add('show');
            mc.recInterval = setInterval(() => {
                mc.recSec++;
                const m=Math.floor(mc.recSec/60), s=mc.recSec%60;
                document.getElementById('mcRecTimer').textContent = m+':'+(s<10?'0':'')+s;
            }, 1000);
        } catch(e) { showToast('تعذّر الوصول للمايكروفون'); }
    }
    function mcStopSendAudio() {
        if (!mc.isRecording || !mc.mediaRecorder) return;
        mc.mediaRecorder.onstop = _mcDoSendAudio;
        mc.mediaRecorder.stop(); mc.mediaRecorder.stream.getTracks().forEach(t=>t.stop());
        mc.isRecording = false; clearInterval(mc.recInterval);
        document.getElementById('mcRecBar').classList.remove('show');
    }
    function mcCancelRecord() {
        if (!mc.isRecording || !mc.mediaRecorder) return;
        mc.mediaRecorder.onstop = null;
        mc.mediaRecorder.stop(); mc.mediaRecorder.stream.getTracks().forEach(t=>t.stop());
        mc.isRecording = false; clearInterval(mc.recInterval);
        document.getElementById('mcRecBar').classList.remove('show');
        mc.audioChunks = [];
    }
    function _mcDoSendAudio() {
        if (!mc.audioChunks.length) return;
        const blob = new Blob(mc.audioChunks, {type:'audio/webm'});
        uploadToCloudinary(blob).then(function(url) {
            const msg={senderId:me.uid,audioUrl:url,createdAt:Date.now(),isRead:false};
            db.ref('chats/'+mc.chatId+'/messages').push(msg);
            db.ref('chats/'+mc.chatId).update({lastMessage:'رسالة صوتية',lastMessageTime:Date.now()});
            db.ref('chats/'+mc.chatId+'/unread/'+mc.otherUid).transaction(v=>(v||0)+1);
        });
    }

    function mcOpenImg(url) {
        const m = document.getElementById('mcImgModal');
        const fi = document.getElementById('mcImgFull');
        if (m && fi) { fi.src = url; m.style.display = 'flex'; }
        else { window.open(url,'_blank'); }
    }

    function mcToggleAudio(id, url) {
        const wave=document.getElementById('mcwave_'+id), btn=document.getElementById('mcbtn_'+id), dur=document.getElementById('mcdur_'+id);
        if (!wave) return;
        if (!mc.audioPlayers[id]) {
            const a = new Audio(url);
            mc.audioPlayers[id] = a;
            a.addEventListener('timeupdate', () => { if(dur){const t=Math.floor(a.currentTime),m2=Math.floor(t/60),s2=t%60;dur.textContent=m2+':'+(s2<10?'0':'')+s2;} });
            a.addEventListener('ended', () => { if(wave)wave.classList.remove('playing'); if(btn)btn.querySelector('polygon')?btn.querySelector('polygon').setAttribute('points','5 3 19 12 5 21 5 3'):null; });
        }
        const a = mc.audioPlayers[id];
        if (a.paused) { a.play(); wave.classList.add('playing'); if(btn&&btn.querySelector('polygon'))btn.querySelector('polygon').setAttribute('points','6 4 10 4 10 20 6 20 M14 4 18 4 18 20 14 20'); }
        else { a.pause(); wave.classList.remove('playing'); if(btn&&btn.querySelector('polygon'))btn.querySelector('polygon').setAttribute('points','5 3 19 12 5 21 5 3'); }
    }

    function closeMiniChat() {
        document.getElementById('mcWrap').classList.remove('open');
        document.body.style.overflow = '';
        // تنظيف المستمعين
        if (mc.listener && mc.chatId) { try { db.ref('chats/'+mc.chatId+'/messages').off('child_added', mc.listener); } catch(_){} mc.listener = null; }
        if (mc.onlineListener && mc.chatId) { try { db.ref('chats/'+mc.chatId+'/online/'+mc.otherUid).off('value', mc.onlineListener); } catch(_){} mc.onlineListener = null; }
        if (mc.typingListener && mc.chatId) { try { db.ref('chats/'+mc.chatId+'/typing/'+mc.otherUid).off('value', mc.typingListener); } catch(_){} mc.typingListener = null; }
        if (mc.chatId) db.ref('chats/'+mc.chatId+'/online/'+me.uid).set(false);
        mc.chatId = null;
    }



    // ─── نافذة المشاهدين ───
    function openViewersModal() {
        const modal = document.getElementById('viewersModal');
        const body  = document.getElementById('viewersModalBody');
        body.innerHTML = '<div style="text-align:center;padding:30px;color:#ccc;">⏳ جاري التحميل...</div>';
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        // إظهار الـ tabs للمالك فقط وإخفاؤها للمشاهدين
        var tabs = document.getElementById('viewersTabs');
        if (tabs) tabs.style.display = isOwner ? 'flex' : 'none';
        // ابدأ دائماً بـ tab المشاهدين
        window._viewersActiveTab = 'viewers';
        switchViewersTab('viewers');
        db.ref('rooms/' + roomId + '/viewers').once('value', snap => {
            const viewers = snap.val() || {};
            const list = Object.entries(viewers);
            document.getElementById('viewersTotalCount').textContent = list.length;
            if (!list.length) { body.innerHTML = '<div style="text-align:center;padding:40px;color:#ccc;font-size:13px;">لا يوجد مشاهدون حالياً</div>'; return; }
            body.innerHTML = '';
            list.forEach(([uid, v]) => {
                if (!uid) return;
                const item = document.createElement('div'); item.className = 'viewer-item';
                const av = (v && v.avatar) ? v.avatar : '';
                const nm = (v && v.name)   ? v.name   : 'مستخدم';
                const isMe = me && uid === me.uid;

                // أزرار الإجراءات — للمالك فقط وعلى الآخرين
                const ownerBtns = (isOwner && !isMe) ? `
                    <button class="orgb orgs" data-a="seat" data-u="${uid}" data-n="${esc(nm)}">جلوس</button>
                    <button class="orgb orgk"  data-a="kick" data-u="${uid}" data-n="${esc(nm)}">طرد</button>
                    <button class="orgb orgx"  data-a="ban"  data-u="${uid}" data-n="${esc(nm)}">حظر</button>` : '';

                item.innerHTML = `
                    <div class="viewer-info">
                        <div class="viewer-name">${esc(nm)}</div>
                        <div class="viewer-sub">${isMe ? 'أنت' : 'مشاهد'}</div>
                    </div>
                    <div class="viewer-ac">${ownerBtns}</div>`;

                // صورة بـ shimmer
                const { wrap: avWrap, im: avIm } = mkAvImg(av, 44, '');
                avWrap.style.cursor = 'pointer'; avWrap.style.flexShrink = '0';
                avIm.style.cssText += 'width:44px;height:44px;border:2px solid #eee;';
                item.prepend(avWrap);

                // الصورة → ملف شخصي (للجميع)
                avWrap.addEventListener('click', () => {
                    closeViewersModal();
                    openProfile(nm, av, uid, null, true);
                });

                // أزرار إجراءات المالك
                item.querySelectorAll('button.orgb').forEach(b => {
                    b.addEventListener('click', e => {
                        e.stopPropagation();
                        const a  = b.dataset.a;
                        const bu = b.dataset.u;
                        const bn = b.dataset.n || '';
                        if (a === 'seat') { closeViewersModal(); inviteToSeat(bu, bn, null); }
                        if (a === 'kick') kickUser(bu, bn);
                        if (a === 'ban')  blacklistUser(bu, bn);
                    });
                });

                body.appendChild(item);
            });
        });
    }
    function closeViewersModal() {
        document.getElementById('viewersModal').classList.remove('open');
        document.body.style.overflow = '';
    }

    // ── قائمة المشاهدين للقراءة فقط (للطلاب/المنظمين) ──
    function openViewersModalReadOnly() {
        var modal = document.getElementById('viewersModal');
        var body  = document.getElementById('viewersModalBody');
        if (!modal || !body) return;
        body.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;font-size:13px;">جاري التحميل...</div>';
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
        db.ref('rooms/' + roomId + '/viewers').once('value', function(vSnap) {
            var viewers = vSnap.val() || {};
            body.innerHTML = '';
            var keys = Object.keys(viewers);
            if (!keys.length) {
                body.innerHTML = '<div style="text-align:center;padding:30px;color:#ccc;font-size:13px;">لا يوجد مشاهدون حالياً</div>';
                return;
            }
            keys.forEach(function(uid) {
                var v  = viewers[uid] || {};
                var nm = v.name || 'مستخدم';
                var av = v.avatar || '';
                var item = document.createElement('div');
                item.className = 'viewer-item';
                item.innerHTML = '<div class="viewer-info"><div class="viewer-name">' + esc(nm) + '</div></div>';
                var avWrap = document.createElement('div');
                avWrap.style.cssText = 'width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;background:#e4e6eb;';
                if (av) {
                    var img = document.createElement('img');
                    img.src = av;
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
                    img.onerror = function(){ this.style.background='#e4e6eb'; this.removeAttribute('src'); };
                    avWrap.appendChild(img);
                }
                item.prepend(avWrap);
                body.appendChild(item);
            });
        });
    }

    // ─── أدوات المالك ───
    async function removeUserFromRoom(uid) {
        if (!uid) return;
        try {
            const seatsSnap = await db.ref('rooms/' + roomId + '/seats').get();
            const seats = seatsSnap.val() || {};
            const ups = [];
            for (let i = 0; i < SEATS; i++) { if (seats[i] && seats[i].userId === uid) ups.push(db.ref('rooms/' + roomId + '/seats/' + i).remove()); }
            ups.push(db.ref('rooms/' + roomId + '/viewers/' + uid).remove());
            ups.push(db.ref('rooms/' + roomId + '/seatInvites/' + uid).remove());
            await Promise.allSettled(ups);
        } catch(_) {}
    }

    function kickUser(uid, name) {
        if (!isOwner || !uid || (me && uid === me.uid)) return;
        showConfirm('طرد المستخدم', `هل أنت متأكد من طرد ${name || 'المستخدم'}؟\nلن يتمكن من العودة لمدة 10 دقائق.`, async () => {
            await db.ref('rooms/' + roomId + '/kickedUsers/' + uid).set(Date.now());
            try { await db.ref('users/' + uid + '/kicks/' + roomId).set({ roomId, kickedAt: Date.now(), kickedBy: me.uid, minutes: 10 }); } catch(e) {}
            await removeUserFromRoom(uid);
            db.ref('rooms/' + roomId + '/chat').push({ uid: me.uid, name: me.name, avatar: me.avatar, text: `تم طرد ${name || 'مستخدم'} لمدة 10 دقائق`, ts: Date.now() });
        });
    }

    async function blacklistUser(uid, name) {
        if (!isOwner || !uid || (me && uid === me.uid)) return;
        showConfirm('حظر نهائي', `تحذير: هل أنت متأكد من حظر ${name || 'المستخدم'} نهائياً؟\nلن يتمكن من دخول الغرفة مرة أخرى.`, async () => {
            await db.ref('rooms/' + roomId + '/blacklistedUsers/' + uid).set(true);
            try { await db.ref('users/' + uid + '/bans/' + roomId).set({ roomId, bannedAt: Date.now(), bannedBy: me.uid }); } catch(e) {}
            await removeUserFromRoom(uid);
            db.ref('rooms/' + roomId + '/chat').push({ uid: me.uid, name: me.name, avatar: me.avatar, text: `تم حظر ${name || 'مستخدم'} نهائياً`, ts: Date.now() });
        });
    }

    async function inviteToSeat(uid, name, seatForced) {
        if (!isOwner || !uid || (me && uid === me.uid)) return;
        let target = (typeof seatForced === 'number') ? seatForced : null;
        if (target === null) {
            const seatsSnap = await db.ref('rooms/' + roomId + '/seats').get();
            const seats = seatsSnap.val() || {};
            for (let i = 1; i < SEATS; i++) { if (!seats[i] || !seats[i].userId) { target = i; break; } }
        }
        if (target === null) { showToast('لا يوجد مقاعد فارغة'); return; }
        await db.ref('rooms/' + roomId + '/seatInvites/' + uid).set({ seat: target, ts: Date.now(), by: me.uid, byName: me.name || 'مشرف' });
        db.ref('rooms/' + roomId + '/chat').push({ uid: me.uid, name: me.name, avatar: me.avatar, text: `تمت دعوة ${name || 'مستخدم'} للجلوس في المقعد`, ts: Date.now() });
        closeAll();
        showSnack('تم إرسال دعوة المقعد', '');
    }

    async function sendSpotlightInvite(targetUid, targetName) {
        if (!roomId || !targetUid || !isOwner) return;

        // أرسل الدعوة مباشرةً بـ uid — يعمل سواء كان في /students أو مشاهداً فقط
        const reqKey = 'inv_' + targetUid + '_' + Date.now();
        await db.ref('rooms/' + roomId + '/spotlight_requests/' + reqKey).set({
            toUid: targetUid,
            to: reqKey,          // للتوافق مع الكود القديم
            byName: (me && me.name) ? me.name : 'المضيف',
            byUid: (me && me.uid) ? me.uid : '',
            timestamp: Date.now()
        });
        closeAll();
        showSnack('تمت دعوة ' + (targetName || 'المستخدم') + ' للظهور في البث', '');
    }

    // ─── قائمة المنظمين (من المقاعد) — مع زر ملف شخصي + جلوس + طرد + حظر ───
    async function openOrganizersList() {
        const list = document.getElementById('orgl'); list.innerHTML = '';
        const seatsSnap = await db.ref('rooms/' + roomId + '/seats').get();
        const seats = seatsSnap.val() || {};
        let hasAny = false;
        for (let i = 0; i < SEATS; i++) {
            const s = seats[i];
            if (!s || !s.userId) continue;
            if (me && s.userId === me.uid) continue;
            hasAny = true;
            const uid = s.userId;
            const nm  = s.name   || 'مستخدم';
            const av  = s.avatar || '';

            const item = document.createElement('div');
            item.className = 'orgit';
            // أزرار الإجراءات — تظهر فقط للمالك
            const ownerBtns = isOwner ? `
                <button class="orgb orgs" data-a="seat" data-u="${uid}" data-n="${esc(nm)}">جلوس</button>
                <button class="orgb orgk"  data-a="kick" data-u="${uid}" data-n="${esc(nm)}">طرد</button>
                <button class="orgb orgx"  data-a="ban"  data-u="${uid}" data-n="${esc(nm)}">حظر</button>` : '';

            item.innerHTML = `
                <div class="orgav" data-u="${uid}" data-n="${esc(nm)}" data-av="${esc(av)}">
                    <div class="vsh"></div>
                    <img src="${esc(av)}" onerror="this.style.background='#e4e6eb';this.removeAttribute('src')">
                </div>
                <div class="orgnm">${esc(nm)}</div>
                <div class="orgac">${ownerBtns}</div>`;

            // الصورة → ملف شخصي
            const avatarDiv = item.querySelector('.orgav');
            const sh = avatarDiv.querySelector('.vsh');
            const imgEl = avatarDiv.querySelector('img');
            if (imgEl) imgEl.onload = () => { if (sh && sh.parentNode) sh.remove(); };

            avatarDiv.addEventListener('click', e => {
                e.stopPropagation();
                closeAll();
                openProfile(nm, av, uid, null, true);
            });
            item.querySelectorAll('button.orgb').forEach(b => {
                b.addEventListener('click', e => {
                    e.stopPropagation();
                    const a  = b.dataset.a;
                    const bu = b.dataset.u;
                    const bn = b.dataset.n || '';
                    if (a === 'seat') inviteToSeat(bu, bn, null);
                    if (a === 'kick') kickUser(bu, bn);
                    if (a === 'ban')  blacklistUser(bu, bn);
                });
            });

            list.appendChild(item);
        }
        if (!hasAny) list.innerHTML = '<div style="text-align:center;padding:30px;color:#ccc;font-size:13px;">لا يوجد أحد في المقاعد حالياً</div>';
        document.getElementById('orgm').classList.add('open');
    }

    // ─── نافذة دعوة للمقعد ───
    window._seatPickIdx  = null;
    window._seatPickUid  = null;
    window._seatPickName = null;

    async function openSeatPicker(seatIdx) {
        if (!isOwner) return;
        window._seatPickIdx = seatIdx; window._seatPickUid = null; window._seatPickName = null;
        document.getElementById('spmt').textContent = 'اختر شخصاً للمقعد رقم ' + (seatIdx + 1);
        const list = document.getElementById('spl'); list.innerHTML = '';
        const vSnap = await db.ref('rooms/' + roomId + '/viewers').get();
        const viewers = vSnap.val() || {};
        const sSnap = await db.ref('rooms/' + roomId + '/seats').get();
        const seats = sSnap.val() || {};
        const seated = {};
        for (let i = 0; i < SEATS; i++) { if (seats[i] && seats[i].userId) seated[seats[i].userId] = true; }
        let hasAny = false;
        Object.keys(viewers).forEach(uid => {
            if (!uid || (me && uid === me.uid)) return;
            hasAny = true;
            const nm = (viewers[uid] && viewers[uid].name) ? viewers[uid].name : 'مستخدم';
            const av = (viewers[uid] && viewers[uid].avatar) ? viewers[uid].avatar : '';
            const sub = seated[uid] ? 'جالس حالياً' : 'مشاهد';

            const it = document.createElement('div');
            it.className = 'sp-check-item';
            it.dataset.u = uid; it.dataset.n = nm;
            it.innerHTML = `
                <div class="sp-checkbox"></div>
                <div class="orgav" style="flex-shrink:0;">
                    <div class="vsh"></div>
                    <img src="${esc(av)}" onerror="this.style.background='#e4e6eb';this.removeAttribute('src')">
                </div>
                <div class="sp-check-info">
                    <div class="sp-check-name">${esc(nm)}</div>
                    <div class="sp-check-sub">${sub}</div>
                </div>`;
            const img = it.querySelector('img'); const sh = it.querySelector('.vsh');
            img.onload = () => { if (sh) sh.remove(); };

            it.addEventListener('click', () => {
                // إلغاء تحديد أي عنصر سابق
                list.querySelectorAll('.sp-check-item').forEach(el => el.classList.remove('checked'));
                it.classList.add('checked');
                window._seatPickUid = uid; window._seatPickName = nm;
            });
            list.appendChild(it);
        });
        if (!hasAny) list.innerHTML = '<div style="text-align:center;padding:30px;color:#ccc;font-size:13px;">لا يوجد مشاهدون حالياً</div>';
        document.getElementById('spm').classList.add('open');
    }

    // ══════════════════════════════════════════════════════════
    //  Spotlight — مثل ExempleTools.handleSpotlightChange حرفياً
    //  الأستاذ يأخذ videoTrack من teacherPeerConns ويضعه في #tv
    // ══════════════════════════════════════════════════════════

    // مثل handleSpotlightChange في ExempleTools
    async function handleSpotlightChange(spotlightData) {
        const tv = document.getElementById('tv');
        const backBtn = document.getElementById('backToOwnerBtn');

        if (!spotlightData) {
            // انتهى الـ spotlight — الأستاذ يرجع لكاميرته
            if (isOwner && localStream) {
                tv.srcObject = localStream;
                tv.muted = true;
                tv.style.opacity = '1'; tv.style.visibility = '';
                try { tv.play(); } catch(e) {}
                // إخفاء overlay الصورة إن كان مفعّلاً
                if (_avOverlayOn) { hideAvatarOverlay(); }
                // أعِد track الأستاذ لكل PCs
                for (const key in teacherPeerConns) {
                    const pc = teacherPeerConns[key].pc;
                    if (pc && localStream.getVideoTracks()[0]) {
                        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                        if (sender) sender.replaceTrack(localStream.getVideoTracks()[0]).catch(() => {});
                    }
                }
                // أبلغ المشاهدين بالعودة للفيديو الأصلي
                try { db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now()); } catch(e) {}
            }
            if (backBtn) backBtn.style.display = 'none';
            return;
        }

        if (!isOwner) return; // المشاهدون لا يتحكمون

        // إذا كان الـ spotlight للأستاذ نفسه — عرض localStream بدون زر العودة
        if (spotlightData.uid && me && spotlightData.uid === me.uid) {
            if (localStream && localStream.getVideoTracks().length > 0) {
                tv.srcObject = localStream;
                tv.muted = true;
                tv.style.opacity = '1'; tv.style.visibility = '';
                try { tv.play(); } catch(e) {}
            }
            // لا تُظهر backToOwnerBtn — الأستاذ يتحكم بنفسه عبر إخفاء/إظهار الكاميرا
            if (backBtn) backBtn.style.display = 'none';
            return;
        }

        // الأستاذ: ابحث عن connection المنظم
        let conn = teacherPeerConns[spotlightData.studentId];
        if (!conn && spotlightData.uid) {
            for (const key in teacherPeerConns) {
                const c = teacherPeerConns[key];
                if (c && c.uid && c.uid === spotlightData.uid) { conn = c; break; }
            }
        }

        // إيجاد الـ key الخاص بهذا الـ connection
        var spotKey = spotlightData.studentId || null;
        if (!spotKey && conn) {
            for (var sk in teacherPeerConns) {
                if (teacherPeerConns[sk] === conn) { spotKey = sk; break; }
            }
        }
        if (!spotKey && spotlightData.uid) {
            // البحث في /students
            try {
                var sSnap = await db.ref('rooms/' + roomId + '/students').orderByChild('uid').equalTo(spotlightData.uid).get();
                var sVals = sSnap.val();
                if (sVals) spotKey = Object.keys(sVals)[0];
            } catch(e) {}
        }

        if (!spotKey) {
            setTimeout(() => handleSpotlightChange(spotlightData), 1000);
            return;
        }

        // ── الإصلاح الجذري: تحقق أولاً من وجود video receiver ──
        // إذا لم يكن الـ peer موجوداً أو لم يكن له video receiver — أعِد البناء
        var hasVideoReceiver = false;
        if (conn && conn.pc && conn.pc.signalingState !== 'closed') {
            var recvs = conn.pc.getReceivers();
            hasVideoReceiver = recvs.some(function(r) {
                return r.track && r.track.kind === 'video' && r.track.readyState !== 'ended';
            });
        }

        if (!conn || !conn.pc || conn.pc.signalingState === 'closed' ||
            conn.pc.iceConnectionState === 'failed' || !hasVideoReceiver) {
            // إعادة بناء الـ peer بالكامل مع video transceiver
            try {
                await _rebuildPeerForOrganizer(spotKey, spotlightData.uid || '');
                // انتظر اكتمال الاتصال ثم حاول مرة أخرى
                var _spRetry = 0;
                var _spPoll = setInterval(async function() {
                    _spRetry++;
                    if (_spRetry > 20) { clearInterval(_spPoll); return; }
                    var newConn = teacherPeerConns[spotKey];
                    if (!newConn || !newConn.pc) return;
                    var newRecvs = newConn.pc.getReceivers();
                    var hasVid = newRecvs.some(function(r) {
                        return r.track && r.track.kind === 'video' && r.track.readyState !== 'ended';
                    });
                    var iceOk = newConn.pc.iceConnectionState === 'connected' ||
                                newConn.pc.iceConnectionState === 'completed';
                    if (hasVid && iceOk) {
                        clearInterval(_spPoll);
                        handleSpotlightChange(spotlightData);
                    }
                }, 500);
            } catch(e) {
                setTimeout(() => handleSpotlightChange(spotlightData), 1500);
            }
            return;
        }

        // مثل ExempleTools: اقرأ track من getReceivers()
        const receivers = conn.pc.getReceivers();
        const videoReceiver = receivers.find(r => r.track && r.track.kind === 'video');
        const studentVideoTrack = videoReceiver ? videoReceiver.track : null;

        // فعّل الـ track إذا كان معطّلاً
        if (studentVideoTrack) studentVideoTrack.enabled = true;

        if (studentVideoTrack && studentVideoTrack.readyState !== 'ended') {
            // مثل ExempleTools: ابنِ stream جديد بـ video المنظم + audio الأستاذ
            const mainStream = new MediaStream([studentVideoTrack]);
            if (localStream && localStream.getAudioTracks().length > 0) {
                mainStream.addTrack(localStream.getAudioTracks()[0]);
            }
            tv.srcObject = mainStream;
            tv.muted = true;
            tv.playsInline = true;
            tv.autoplay = true;
            tv.style.opacity = '1'; tv.style.visibility = '';
            // تشغيل مع إعادة محاولات لضمان ظهور الفيديو (يحل مشكلة الشاشة السوداء)
            const _tryPlaySpot = function(n) {
                tv.play().catch(function() {
                    if (n < 8) setTimeout(function() { _tryPlaySpot(n + 1); }, 400);
                });
            };
            _tryPlaySpot(1);
            // تأكيد إضافي بعد 800ms
            setTimeout(function() {
                if (tv.paused && tv.srcObject) tv.play().catch(function(){});
            }, 800);
            if (backBtn) backBtn.style.display = 'flex';

            // استبدل video track في كل PCs للبث
            for (const key in teacherPeerConns) {
                const pc = teacherPeerConns[key].pc;
                if (pc && pc.signalingState !== 'closed') {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(studentVideoTrack).catch(() => {});
                }
            }
            // أبلغ المشاهدين بأن الـ track تغيّر — يعيدون تشغيل #tv
            try { db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now()); } catch(e) {}
        } else {
            // Track غير جاهز بعد — استمع على ontrack مباشرة لإمساك الـ track عند وصوله
            if (!conn._spotWaiting) {
                conn._spotWaiting = true;
                conn._spotRetries = (conn._spotRetries || 0) + 1;
                if (conn._spotRetries <= 10) {
                    // استمع على الـ PC مباشرة للـ track الجديد
                    const origOntrack = conn.pc.ontrack;
                    conn.pc.ontrack = function(e) {
                        // نادِ المعالج الأصلي أولاً
                        if (typeof origOntrack === 'function') origOntrack.call(conn.pc, e);
                        if (e.track && e.track.kind === 'video') {
                            conn._spotWaiting = false;
                            conn.pc.ontrack = origOntrack; // استعد المعالج الأصلي
                            // أعِد محاولة handleSpotlightChange مع الـ track الجديد
                            setTimeout(() => handleSpotlightChange(spotlightData), 200);
                        }
                    };
                    // في نفس الوقت استمر بالمحاولة الدورية
                    setTimeout(() => {
                        conn._spotWaiting = false;
                        handleSpotlightChange(spotlightData);
                    }, 2000);
                } else {
                    // وصلنا للحد الأقصى — أظهر على الأقل صوت الأستاذ فقط
                    conn._spotRetries = 0;
                    if (backBtn) backBtn.style.display = 'flex';
                    showSnack('تعذّر إظهار فيديو الشخص حالياً', '⚠️');
                }
            }
        }
    }

    // الأستاذ: العودة لكاميرته (مثل returnToTeacherViewBtn)
    // ── الأستاذ يُظهر نفسه في البث (يعمل حتى بعد ريفريش) ──
    async function _ownerShowSelfInSpot() {
        closeAll();
        if (!isOwner || !me) return;

        // إذا كان localStream غير جاهز أو فيديوه منتهٍ — أعِد الحصول عليه
        var needNewStream = !localStream ||
            localStream.getVideoTracks().length === 0 ||
            localStream.getVideoTracks()[0].readyState === 'ended';

        if (needNewStream) {
            showSnack('جاري تشغيل الكاميرا...', '');
            try {
                var constraints = { video: true, audio: true };
                var newStr = await navigator.mediaDevices.getUserMedia(constraints);
                window.localStream = newStr;
                localStream = newStr;
                localStream.getAudioTracks().forEach(function(t){ t.enabled = micOn; });
                var tvEl = document.getElementById('tv');
                if (tvEl) { tvEl.srcObject = localStream; tvEl.muted = true; tvEl.play().catch(function(){}); }
            } catch(err) {
                showSnack('تعذّر تشغيل الكاميرا', '⚠️');
                return;
            }
        }

        // أعِد تفعيل video track إذا كان معطلاً
        if (localStream) {
            localStream.getVideoTracks().forEach(function(t){ t.enabled = true; });
        }

        // أخفِ avatarOverlay إن كان ظاهراً
        _avOverlayOn = false;
        var ov = document.getElementById('avatarOverlay');
        if (ov) ov.classList.remove('show');
        var tv2 = document.getElementById('tv');
        if (tv2) { tv2.style.visibility = ''; tv2.srcObject = localStream; tv2.muted = true; tv2.play().catch(function(){}); }

        // أبلغ ownerOverlay بالإيقاف
        try { db.ref('rooms/' + roomId + '/ownerOverlay').set({ on: false, ts: Date.now() }); } catch(e) {}

        // اكتب spotlight بـ uid الأستاذ نفسه — بدون إظهار backToOwnerBtn
        var spData = {
            uid:    me.uid,
            name:   me.name   || '',
            avatar: me.avatar || '',
            seatIdx: typeof mySeatIdx === 'number' ? mySeatIdx : -1,
            isOwnerSelf: true,   // علامة تمنع ظهور زر العودة
            ts: Date.now()
        };
        try { await db.ref('rooms/' + roomId + '/spotlight').set(spData); } catch(e) {}

        // استبدل video + audio tracks في peers الموجودة
        var vt = localStream ? localStream.getVideoTracks()[0] : null;
        var at = localStream ? localStream.getAudioTracks()[0]  : null;
        for (var k in teacherPeerConns) {
            var conn2 = teacherPeerConns[k];
            if (!conn2 || !conn2.pc || conn2.pc.signalingState === 'closed') continue;
            var pcSt2 = conn2.pc.iceConnectionState;
            if (pcSt2 === 'failed' || pcSt2 === 'disconnected' || pcSt2 === 'closed') {
                (function(rk, ru){ _rebuildPeerForOrganizer(rk, ru).catch(function(){}); })(k, conn2.uid || '');
            } else {
                var senders2 = conn2.pc.getSenders();
                var vSender2 = senders2.find(function(s){ return s.track && s.track.kind === 'video'; });
                var aSender2 = senders2.find(function(s){ return s.track && s.track.kind === 'audio'; });
                if (vSender2 && vt) vSender2.replaceTrack(vt).catch(function(){});
                else if (vt && !vSender2) { try { conn2.pc.addTrack(vt, localStream); } catch(e) {} }
                if (aSender2 && at) aSender2.replaceTrack(at).catch(function(){});
                else if (at && !aSender2) { try { conn2.pc.addTrack(at, localStream); } catch(e) {} }
            }
        }
        // أبلغ المشاهدين بتحديث track — ownerReoffer يُعيد بناء الـ peer عندهم
        try { db.ref('rooms/' + roomId + '/ownerReoffer').set(Date.now()); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now()); } catch(e) {}

        showSnack('أنت الآن في البث', '');
    }

    async function backToOwnerTV() {
        try { await db.ref('rooms/' + roomId + '/spotlight').remove(); } catch(e) {}

        const backBtn = document.getElementById('backToOwnerBtn');
        if (backBtn) backBtn.style.display = 'none';

        if (!isOwner) { showSnack('تمت العودة للبث الرئيسي', ''); return; }

        // أخفِ overlay الصورة أولاً بغض النظر عن حالته
        _avOverlayOn = false;
        const ov = document.getElementById('avatarOverlay');
        if (ov) ov.classList.remove('show');
        const tv = document.getElementById('tv');
        if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }

        // تحديث زر الكاميرا
        const camBtn = document.getElementById('pmToggleCamBtn');
        if (camBtn) {
            camBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> إخفاء الكاميرا';
            camBtn.style.background = '';
        }

        // إعادة localStream لـ #tv
        if (localStream && localStream.getVideoTracks().length > 0 && localStream.getVideoTracks()[0].readyState !== 'ended') {
            if (tv) {
                tv.srcObject = localStream;
                tv.muted = true;
                tv.style.opacity = '1'; tv.style.visibility = '';
                try { await tv.play(); } catch(e) {}
            }
            // إعادة video + audio tracks لجميع PCs
            var ownerVT = localStream.getVideoTracks()[0];
            var ownerAT = localStream.getAudioTracks()[0];
            for (const key in teacherPeerConns) {
                const conn = teacherPeerConns[key];
                if (!conn || !conn.pc || conn.pc.signalingState === 'closed') continue;
                const pcSt = conn.pc.iceConnectionState;
                if (pcSt === 'failed' || pcSt === 'disconnected' || pcSt === 'closed') {
                    _rebuildPeerForOrganizer(key, conn.uid || '').catch(function(){});
                } else {
                    const senders = conn.pc.getSenders();
                    const vSender = senders.find(s => s.track && s.track.kind === 'video');
                    const aSender = senders.find(s => s.track && s.track.kind === 'audio');
                    if (vSender && ownerVT) vSender.replaceTrack(ownerVT).catch(() => {});
                    else if (ownerVT && !vSender) { try { conn.pc.addTrack(ownerVT, localStream); } catch(e) {} }
                    if (aSender && ownerAT) aSender.replaceTrack(ownerAT).catch(() => {});
                    else if (ownerAT && !aSender) { try { conn.pc.addTrack(ownerAT, localStream); } catch(e) {} }
                }
            }
            // أبلغ المشاهدين بالعودة + إعادة بناء الـ peer من جانبهم
            try { db.ref('rooms/' + roomId + '/ownerReoffer').set(Date.now()); } catch(e) {}
            try { db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now()); } catch(e) {}
            try { db.ref('rooms/' + roomId + '/ownerOverlay').set({ on: false, ts: Date.now() }); } catch(e) {}
        } else {
            // localStream غير جاهز — أعِد تشغيل الكاميرا
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                window.localStream = newStream;
                if (tv) {
                    tv.srcObject = newStream;
                    tv.muted = true;
                    try { await tv.play(); } catch(e) {}
                }
                for (const key in teacherPeerConns) {
                    const pc = teacherPeerConns[key] && teacherPeerConns[key].pc;
                    if (pc && pc.signalingState !== 'closed') {
                        const vTrack = newStream.getVideoTracks()[0];
                        const aTrack = newStream.getAudioTracks()[0];
                        if (vTrack) { const sv = pc.getSenders().find(s => s.track && s.track.kind === 'video'); if (sv) sv.replaceTrack(vTrack).catch(()=>{}); }
                        if (aTrack) { const sa = pc.getSenders().find(s => s.track && s.track.kind === 'audio'); if (sa) sa.replaceTrack(aTrack).catch(()=>{}); }
                    }
                }
                try { db.ref('rooms/' + roomId + '/ownerOverlay').set({ on: false, ts: Date.now() }); } catch(e) {}
            } catch(err) {
                showSnack('تعذّر تشغيل الكاميرا: ' + err.message, '⚠️');
            }
        }
        showSnack('تمت العودة للبث الرئيسي', '');
    }

        function listenSpotlight() {
        // مستمع spotlightTrackTs — للمشاهدين فقط — يعيد تشغيل #tv عند كل تغيير track
        if (!isOwner) {
            var _lastSpotTs = 0;
            var _spotProcessing = false;
            db.ref('rooms/' + roomId + '/spotlightTrackTs').on('value', function(tsSnap) {
                var ts = tsSnap.val();
                if (!ts || ts <= _lastSpotTs) return;
                _lastSpotTs = ts;
                if (Date.now() - ts > 15000) return;
                if (_spotProcessing) return;
                _spotProcessing = true;
                setTimeout(async function() {
                    try {
                        var tvEl = document.getElementById('tv');
                        var sra  = document.getElementById('studentRemoteAudio');
                        // محاولة تشغيل ما هو موجود
                        if (tvEl && tvEl.srcObject) {
                            tvEl.playsInline = true;
                            tvEl.muted = true;
                            if (tvEl.paused) tvEl.play().catch(function(){});
                        }
                        if (sra && sra.srcObject && sra.paused) {
                            sra.muted = false;
                            sra.volume = 1.0;
                            sra.play().catch(function(){});
                        }
                        // إذا لم يكن هناك video — اطلب إعادة اتصال
                        var hasLiveVideo = tvEl && tvEl.srcObject && tvEl.srcObject.getVideoTracks().some(function(t){ return t.readyState === 'live'; });
                        if (!hasLiveVideo && studentRef) {
                            var myKeyR = studentRef.key;
                            if (myKeyR) {
                                _rtcLog('VW', 'spotlightTrackTs: no live video — requesting reconnect');
                                // إعادة بناء كاملة
                                _scIceBuf = []; _scRemoteSet = false;
                                await db.ref('rooms/' + roomId + '/offers/'     + myKeyR).remove().catch(function(){});
                                await db.ref('rooms/' + roomId + '/answers/'    + myKeyR).remove().catch(function(){});
                                await db.ref('rooms/' + roomId + '/candidates/' + myKeyR).remove().catch(function(){});
                                db.ref('rooms/' + roomId + '/connectRequest/' + myKeyR).set({ uid: me.uid, ts: Date.now(), reason: 'spotlightTrack' });
                                // انتظر offer جديد
                                var _spWait2 = 0;
                                var _spCheck2 = setInterval(async function() {
                                    _spWait2 += 400;
                                    if (_spWait2 > 10000) { clearInterval(_spCheck2); return; }
                                    try {
                                        var ofSnap2 = await db.ref('rooms/' + roomId + '/offers/' + myKeyR).get();
                                        if (ofSnap2.exists()) {
                                            clearInterval(_spCheck2);
                                            await createOrganizerPeerAndAnswer(ofSnap2.val());
                                        }
                                    } catch(e) {}
                                }, 400);
                            }
                        }
                    } catch(e) {} finally {
                        _spotProcessing = false;
                    }
                }, 400);
            });
        }

        // مستمع spotlight لجميع المستخدمين
        db.ref('rooms/' + roomId + '/spotlight').on('value', snap => {
            const sp = snap.val() || null;

            // تمييز المقعد في الـ UI
            for (let i = 0; i < SEATS; i++) { const sb = document.getElementById('vsb' + i); if (sb) sb.classList.remove('spot'); }
            const chip    = document.getElementById('spotChip');
            const chipImg = document.getElementById('spotChipImg');
            const chipTxt = document.getElementById('spotChipTxt');
            if (chip) chip.style.display = 'none';

            if (sp && (sp.studentId || sp.uid)) {
                // تمييز مقعد المنظم بالـ uid
                const spUid = sp.uid || '';
                for (let i = 0; i < SEATS; i++) {
                    const ci = document.getElementById('vci' + i);
                    if (ci && ci.dataset && ci.dataset.uid === spUid) {
                        const sb = document.getElementById('vsb' + i); if (sb) sb.classList.add('spot'); break;
                    }
                }
                // Chip الاسم
                const nm = sp.studentName || sp.name || '';
                const av = sp.avatar || '';
                if (chip) {
                    if (chipTxt) chipTxt.textContent = nm;
                    if (chipImg && av) { chipImg.src = av; chipImg.style.display = 'block'; }
                    else if (chipImg) chipImg.style.display = 'none';
                    if (sp.uid !== ownerUid) chip.style.display = 'flex';
                }

                // الأستاذ: استدعي handleSpotlightChange (مثل ExempleTools)
                if (isOwner) handleSpotlightChange(sp);

                // المنظم: إظهار switchCam إن كان هو المختار
                if (!isOwner && me && spUid === me.uid) {
                    const scb = document.getElementById('switchCamBtn');
                    if (scb) scb.style.display = 'flex';
                }

            } else {
                // انتهى spotlight
                if (isOwner) handleSpotlightChange(null);
                if (!isOwner) {
                    // إذا كان هذا المستخدم في الـ spotlight، أطفئ كاميرته
                    if (localStream) localStream.getVideoTracks().forEach(t => { t.enabled = false; });
                    const scb = document.getElementById('switchCamBtn');
                    if (scb) scb.style.display = 'none';
                    // نظّف فيديو المنظم المعروض — يعود لفيديو الأستاذ عبر WebRTC
                }
            }
        });
    }

        // ─── Kick / Ban / Invites ───

    // ── مستمع ownerOverlay للطلاب — يظهر صورة الأستاذ عند إخفاء الكاميرا ──
    function listenOwnerOverlay() {
        if (isOwner) return;
        db.ref('rooms/' + roomId + '/ownerOverlay').on('value', function(snap) {
            var data = snap.val();
            var tv   = document.getElementById('tv');
            var ov   = document.getElementById('avatarOverlay');
            if (!ov) return;

            if (data && data.on === true) {
                var avatar = (data.avatar && data.avatar.trim() !== '') ? data.avatar.trim() : '';

                // لا نُظهر overlay إذا لم تكن هناك صورة
                if (!avatar) {
                    if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
                    ov.classList.remove('show');
                    return;
                }

                var img = document.getElementById('avatarOverlayImg');
                var nm  = document.getElementById('avatarOverlayName');
                var sub = document.getElementById('avatarOverlaySubject');

                if (nm)  nm.textContent  = data.name    || 'المضيف';
                if (sub) sub.textContent = data.roomName || '';

                // أخفِ الفيديو
                if (tv) { tv.style.opacity = '0'; tv.style.visibility = 'hidden'; }

                if (img) {
                    img._ovTryN = 0;
                    img.style.background = '#2a2a4a';
                    img.removeAttribute('src');

                    img.onerror = function() {
                        img._ovTryN = (img._ovTryN || 0) + 1;
                        if (img._ovTryN < 3) {
                            setTimeout(function() {
                                img.src = avatar + (avatar.includes('?') ? '&' : '?') + '_t=' + Date.now();
                            }, img._ovTryN * 600);
                        } else {
                            // فشل تحميل الصورة — أخفِ overlay وأعِد الفيديو
                            ov.classList.remove('show');
                            if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
                        }
                    };

                    img.onload = function() {
                        img.style.background = 'transparent';
                        // أظهر overlay فقط بعد تحميل الصورة
                        ov.classList.add('show');
                    };

                    img.src = avatar;
                } else {
                    ov.classList.add('show');
                }
            } else {
                // أخفِ overlay وأظهر الفيديو
                ov.classList.remove('show');
                if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
            }
        });
    }

    function listenKicksAndBans() {
        db.ref('rooms/' + roomId + '/kickedUsers/' + me.uid).on('value', snap => {
            const ts = snap.val(); if (!ts) return;
            const diff = Date.now() - ts;
            if (diff < 10 * 60 * 1000) { gotoRoomHome('تم طردك من الغرفة. يمكنك العودة بعد 10 دقائق.'); }
            else { db.ref('rooms/' + roomId + '/kickedUsers/' + me.uid).remove(); }
        });
        db.ref('rooms/' + roomId + '/blacklistedUsers/' + me.uid).on('value', snap => {
            if (snap.val()) gotoRoomHome('تم حظرك نهائياً من الغرفة ولا يمكنك الدخول.');
        });
    }

    function listenSeatInvites() {
        if (isOwner) return;
        db.ref('rooms/' + roomId + '/seatInvites/' + me.uid).on('value', async snap => {
            const inv = snap.val();
            if (!inv || typeof inv.seat !== 'number') return;
            const seat = inv.seat;
            if (seat === 0) { try { await db.ref('rooms/' + roomId + '/seatInvites/' + me.uid).remove(); } catch(_) {} return; }
            const inviterName = inv.byName || 'المشرف';
            // رسالة مختلفة إذا كانت الدعوة من قبول طلب الطابور
            const msgTitle = inv.fromQueue ? 'تمت الموافقة على طلبك 🎉' : 'دعوة للمقعد';
            const msgBody  = inv.fromQueue
                ? `وافق ${inviterName} على طلبك للجلوس.\nهل تريد الجلوس الآن؟`
                : `لقد دعاك ${inviterName} للجلوس.\nهل تريد الجلوس في المقعد الآن؟`;
            showConfirm(msgTitle, msgBody, async () => {
                if (mySeatIdx !== null && mySeatIdx !== seat) { await db.ref('rooms/' + roomId + '/seats/' + mySeatIdx).remove(); }
                const sSnap = await db.ref('rooms/' + roomId + '/seats/' + seat).get();
                const s = sSnap.val();
                if (s && s.userId && s.userId !== me.uid) { await db.ref('rooms/' + roomId + '/seats/' + seat).remove(); }
                takeSeat(seat);
                // إلغاء طلب الطابور إن وجد بعد الجلوس
                if (inv.fromQueue) {
                    try { await db.ref('rooms/' + roomId + '/queueRequests/' + me.uid).remove(); } catch(_) {}
                }
            });
            const yesBtn = document.getElementById('cmYes'); const noBtn = document.getElementById('cmNo');
            if (yesBtn) { const prevY = yesBtn.onclick; yesBtn.onclick = async (e) => { try { await db.ref('rooms/' + roomId + '/seatInvites/' + me.uid).remove(); } catch(_) {} if (typeof prevY === 'function') return prevY(e); }; }
            if (noBtn)  { const prevN = noBtn.onclick;  noBtn.onclick  = async (e) => { try { await db.ref('rooms/' + roomId + '/seatInvites/' + me.uid).remove(); } catch(_) {} if (typeof prevN === 'function') return prevN(e); }; }
        });
    }

    // ─── مراقبة مقعد المالك — إذا اختفى بسبب onDisconnect أعِده فوراً ───
    if (isOwner) {
        db.ref('rooms/' + roomId + '/seats/0').on('value', function(sSnap) {
            var sv = sSnap.val();
            // إذا اختفى المقعد وصاحب الغرفة لا يزال في الصفحة ولم يضغط خروج
            if (!sv && !window.__doingLeave && me && me.uid) {
                // أعِد تسجيل المقعد فوراً
                db.ref('rooms/' + roomId + '/seats/0').set({
                    userId: me.uid, name: me.name, avatar: me.avatar || '',
                    frame: me.frame || '', badge: me.badge || '',
                    micOn: false, ts: Date.now(), isOwner: true
                });
                // لا نضع onDisconnect هنا — المقعد يبقى دائماً
            }
        });
    }

    // ─── مراقبة حالة الغرفة ───
    function showRoomError(msg, redirect) {
        const wrap = document.getElementById('roomErrWrap');
        const title = document.getElementById('reTitle');
        const btn   = document.getElementById('reBtn');
        if (title) title.textContent = msg || 'حدث خطأ';
        if (wrap)  wrap.classList.add('show');
        if (btn) {
            btn.onclick = () => {
                if (wrap) wrap.classList.remove('show');
                setTimeout(() => { location.href = redirect || 'roomhom.html'; }, 200);
            };
            // تحويل تلقائي بعد 4 ثوانٍ
            setTimeout(() => { location.href = redirect || 'roomhom.html'; }, 4000);
        }
    }

    function gotoRoomHome(reason) {
        try { sessionStorage.setItem('roomKickReason', reason || ''); } catch(e) {}
        window.location.href = 'roomhom.html' + (reason ? ('?reason=' + encodeURIComponent(reason)) : '');
    }
    // متغيرات grace period للإخراج
    let __roomNullGraceTO = null;
    let __roomClosedGraceTO = null;

    function listenRoomState() {
        db.ref('rooms/' + roomId).on('value', snap => {
            const v = snap.val();
            if (!v) {
                // إذا كان صاحب الغرفة فلا يُخرَج أبداً بسبب اختفاء الداتا
                if (isOwner) return;
                // انتظر 30 ثانية grace period قبل الإخراج — ربما انقطاع مؤقت بالشبكة
                if (__roomNullGraceTO) return;
                __roomNullGraceTO = setTimeout(() => {
                    __roomNullGraceTO = null;
                    // تحقق مجدداً من وجود الغرفة (3 محاولات)
                    var _checkCount = 0;
                    function _checkRoom() {
                        _checkCount++;
                        db.ref('rooms/' + roomId).once('value', snap2 => {
                            var val2 = snap2.val();
                            if (!val2 && _checkCount < 3) {
                                // انتظر 5 ثوانٍ إضافية وحاول مرة أخرى
                                setTimeout(_checkRoom, 5000);
                            } else if (!val2) {
                                gotoRoomHome('تم إخراج الجميع بسبب خروج صاحب الغرفة');
                            }
                            // إذا عادت البيانات لا شيء يحدث
                        });
                    }
                    _checkRoom();
                }, 30000);
                return;
            }
            // إذا عادت البيانات — ألغِ أي grace period
            if (__roomNullGraceTO) { clearTimeout(__roomNullGraceTO); __roomNullGraceTO = null; }

            if (v.closed) {
                // إذا كان صاحب الغرفة ولم يضغط doLeave — تجاهل الإغلاق وانظّف العلامة
                if (isOwner) {
                    if (window.__doingLeave) {
                        gotoRoomHome('لقد تم اخراج الجميع بسبب خروجك من الغرفة');
                        return;
                    }
                    // heartbeat حديث = ربما إغلاق مؤقت بسبب الشبكة، احذف علامة closed
                    try { db.ref('rooms/' + roomId + '/closed').remove(); db.ref('rooms/' + roomId + '/closedReason').remove(); db.ref('rooms/' + roomId + '/closedBy').remove(); } catch(e) {}
                    return;
                }
                // للمشتركين: انتظر 20 ثانية grace period قبل الإخراج
                if (__roomClosedGraceTO) return;
                __roomClosedGraceTO = setTimeout(() => {
                    __roomClosedGraceTO = null;
                    db.ref('rooms/' + roomId).once('value', snap3 => {
                        const v3 = snap3.val();
                        if (v3 && v3.closed) {
                            // تحقق إضافي: هل ownerHeartbeat حديث (خلال 60 ثانية)؟
                            var hb = v3.ownerHeartbeat || 0;
                            if (Date.now() - hb < 60000) {
                                // الأستاذ لا يزال موجوداً — لا تخرج، انظف closed
                                return;
                            }
                            let rs = v3.closedReason || 'تم إخراج الجميع بسبب خروج صاحب الغرفة';
                            if (!window.__roomRemoveScheduled) { window.__roomRemoveScheduled = true; setTimeout(() => { db.ref('rooms/' + roomId).remove().catch(() => {}); }, 5000); }
                            gotoRoomHome(rs);
                        }
                    });
                }, 20000);
                return;
            }
            // الغرفة مفتوحة — ألغِ أي grace period للإغلاق
            if (__roomClosedGraceTO) { clearTimeout(__roomClosedGraceTO); __roomClosedGraceTO = null; }
        });
    }
    function endRoom(reason) {
        db.ref('rooms/' + roomId).update({ closed: true, closedReason: reason || 'تم إغلاق الغرفة', closedAt: Date.now(), closedBy: (me && me.uid) ? me.uid : null });
        setTimeout(() => { db.ref('rooms/' + roomId).remove(); }, 6000);
    }

    // ─── منطق خروج صاحب الغرفة ───
    // صاحب الغرفة لا يُخرَج أبداً بسبب:
    //   - تبديل التطبيقات / الشاشة الرئيسية / الخلفية
    //   - انقطاع الإنترنت المؤقت
    //   - فتح نوافذ أو مودالات داخل الصفحة
    // يُخرَج فقط إذا:
    //   - أغلق الصفحة/المتصفح نهائياً (pagehide غير مخزّن)
    //   - غاب عن الصفحة > 5 دقائق متواصلة دون أن يعود

    let __ownerHiddenTO = null;
    let __ownerBgSince  = 0;
    const OWNER_BG_LIMIT = 24 * 60 * 60 * 1000; // 24 ساعة — صاحب الغرفة لا يُخرَج عند الذهاب للخلفية

    // heartbeat: يُسجّل وجود الأستاذ كل 30 ثانية في Firebase
    // إذا عاد الاتصال قبل انتهاء الوقت، يُلغى العداد
    let __ownerHeartbeatInt = null;

    function startOwnerHeartbeat() {
        if (!isOwner || __ownerHeartbeatInt) return;
        __ownerHeartbeatInt = setInterval(function() {
            if (!isOwner || !roomId) return;
            try {
                db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
            } catch(e) {}
        }, 30000);
    }

    function stopOwnerHeartbeat() {
        if (__ownerHeartbeatInt) { clearInterval(__ownerHeartbeatInt); __ownerHeartbeatInt = null; }
    }

    function startOwnerHiddenCountdown() {
        if (!isOwner || __ownerHiddenTO) return;
        __ownerBgSince = Date.now();
        __ownerHiddenTO = setTimeout(() => {
            __ownerHiddenTO = null;
            // تحقق مزدوج: لا يزال مختفياً فعلاً وليس مجرد تبديل نافذة سريع
            if (document.hidden && (Date.now() - __ownerBgSince) >= OWNER_BG_LIMIT - 2000) {
                endRoom('تم إغلاق الغرفة بسبب غياب المضيف');
                gotoRoomHome('لقد تم إغلاق الغرفة بسبب غيابك لأكثر من 5 دقائق');
            }
        }, OWNER_BG_LIMIT);
    }

    function stopOwnerHiddenCountdown() {
        if (__ownerHiddenTO) { clearTimeout(__ownerHiddenTO); __ownerHiddenTO = null; }
        __ownerBgSince = 0;
    }

    // تبديل الخلفية — يبدأ العداد عند الاختفاء، يلغيه عند العودة
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (isOwner) startOwnerHiddenCountdown();
        } else {
            if (isOwner) {
                // عاد الأستاذ → ألغِ العداد فوراً
                stopOwnerHiddenCountdown();
                try {
                    if (db && roomId) db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
                } catch(e) {}
                // إعادة تفعيل الكاميرا إذا كانت tracks منتهية (ended)
                try {
                    var hasValidVideo = localStream && localStream.getVideoTracks().length > 0 && localStream.getVideoTracks().some(function(t){ return t.readyState !== 'ended'; });
                    var hasValidAudio = localStream && localStream.getAudioTracks().length > 0 && localStream.getAudioTracks().some(function(t){ return t.readyState !== 'ended'; });
                    if (!hasValidVideo || !hasValidAudio) {
                        var tvElRet = document.getElementById('tv');
                        var constraintsRet = { video: { facingMode: usingFrontCamera ? 'user' : 'environment' }, audio: { echoCancellation: true, noiseSuppression: true } };
                        navigator.mediaDevices.getUserMedia(constraintsRet).then(function(retStream) {
                            localStream = retStream;
                            localStream.getAudioTracks().forEach(function(t){ t.enabled = micOn; });
                            if (tvElRet && !_avOverlayOn) { tvElRet.srcObject = retStream; tvElRet.muted = true; tvElRet.play().catch(function(){}); }
                            // استبدل track في peers — إذا حالة الاتصال سيئة أعد بناءه كاملاً
                            var newVT = retStream.getVideoTracks()[0];
                            var newAT = retStream.getAudioTracks()[0];
                            for (var retKey in teacherPeerConns) {
                                var retConn = teacherPeerConns[retKey];
                                if (!retConn || !retConn.pc) continue;
                                var pcSt = retConn.pc.iceConnectionState;
                                if (pcSt === 'failed' || pcSt === 'disconnected' || pcSt === 'closed' || retConn.pc.signalingState === 'closed') {
                                    // إعادة بناء كاملة للـ peer الذي انقطع
                                    (function(rk, ru){ _rebuildPeerForOrganizer(rk, ru).catch(function(){}); })(retKey, retConn.uid || '');
                                } else {
                                    retConn.pc.getSenders().forEach(function(sender) {
                                        if (sender.track) {
                                            if (sender.track.kind === 'video' && newVT) sender.replaceTrack(newVT).catch(function(){});
                                            else if (sender.track.kind === 'audio' && newAT) sender.replaceTrack(newAT).catch(function(){});
                                        }
                                    });
                                }
                            }
                        }).catch(function() {
                            // إعادة الصوت فقط إذا فشل الفيديو
                            navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function(aStream) {
                                var newAT2 = aStream.getAudioTracks()[0];
                                if (newAT2 && localStream) {
                                    var oldATs = localStream.getAudioTracks();
                                    oldATs.forEach(function(t){ localStream.removeTrack(t); t.stop(); });
                                    localStream.addTrack(newAT2);
                                    newAT2.enabled = micOn;
                                    _replaceAudioTrackInPeers(newAT2);
                                }
                            }).catch(function(){});
                        });
                    } else {
                        // الـ tracks سليمة — فقط تأكد من إعادة إرسال الصوت
                        var existingAT = localStream.getAudioTracks()[0];
                        if (existingAT) {
                            existingAT.enabled = micOn;
                            _ensureAudioTrackInPeers(existingAT);
                        }
                        // أعِد تشغيل #tv للأستاذ
                        var tvOwn = document.getElementById('tv');
                        if (tvOwn && tvOwn.srcObject && tvOwn.paused) {
                            tvOwn.play().catch(function(){});
                        }
                    }
                } catch(e) {}
            }
            // ألغِ أي grace period للإخراج عند العودة (مهم للطلاب أيضاً)
            if (__roomNullGraceTO)   { clearTimeout(__roomNullGraceTO);   __roomNullGraceTO   = null; }
            if (__roomClosedGraceTO) { clearTimeout(__roomClosedGraceTO); __roomClosedGraceTO = null; }

            // ── إعادة تسجيل المقعد فوراً عند العودة ──
            // (يُصلح مشكلة onDisconnect الذي يمسح المقعد عند الخلفية على الهواتف)
            try {
                if (db && roomId && me && me.uid) {
                    if (isOwner) {
                        // المالك: أعِد تسجيل مقعده فوراً بدون انتظار
                        const ownerSeatData = {
                            userId: me.uid, name: me.name, avatar: me.avatar || '',
                            frame: me.frame || '', badge: me.badge || '',
                            micOn: micOn || false, ts: Date.now(), isOwner: true
                        };
                        db.ref('rooms/' + roomId + '/seats/0').set(ownerSeatData);
                        // لا نضع onDisconnect — المقعد يبقى دائماً
                        db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
                    } else if (mySeatIdx !== null) {
                        // الطالب/المنظم: أعِد تسجيل مقعده فوراً
                        const sIdx = mySeatIdx;
                        const studentSeatData = {
                            userId: me.uid, name: me.name, avatar: me.avatar || '',
                            frame: me.frame || '', badge: me.badge || '',
                            micOn: micOn || false, ts: Date.now()
                        };
                        db.ref('rooms/' + roomId + '/seats/' + sIdx).set(studentSeatData);
                        // لا نضع onDisconnect — المقعد يبقى دائماً
                    }
                    // أعِد تسجيل المشاهد في /viewers
                    db.ref('rooms/' + roomId + '/viewers/' + me.uid).set({ name: me.name, avatar: me.avatar || '', ts: Date.now() });
                    // لا نضع onDisconnect على viewers أيضاً
                }
            } catch(e) {}

            // ── إعادة رسم المقاعد بعد العودة ──
            try {
                if (db && roomId) {
                    db.ref('rooms/' + roomId + '/seats').once('value', function(snap) {
                        var all = snap.val() || {};
                        for (var i = 0; i < SEATS; i++) {
                            renderSeat(i, all[i] || null);
                        }
                    });
                }
            } catch(e) {}

            // ── إعادة تشغيل الصوت والفيديو عند العودة من الخلفية ──
            try {
                setTimeout(function() {
                    // 1) أعِد تشغيل #tv
                    var tvEl = document.getElementById('tv');
                    if (tvEl && tvEl.srcObject) {
                        if (tvEl.paused) tvEl.play().catch(function() {});
                        tvEl.muted = isOwner ? true : !spkOn;
                    }
                    // 2) أعِد تشغيل كل عناصر audio
                    document.querySelectorAll('audio').forEach(function(a) {
                        a.muted = !spkOn;
                        if (a.paused && a.srcObject) {
                            a.play().catch(function() {});
                        }
                    });
                    // 3) تفعيل audio tracks في localStream إذا كان المايك مشغولاً
                    if (localStream) {
                        localStream.getAudioTracks().forEach(function(t) {
                            if (t.readyState !== 'ended') t.enabled = micOn;
                        });
                    }
                    // 4) إذا كان studentPC موجوداً وحالته سيئة — أعِد بناءه
                    if (!isOwner && studentRef && studentRef.key) {
                        var pcState = studentPC ? studentPC.iceConnectionState : 'closed';
                        if (!studentPC || pcState === 'failed' || pcState === 'closed' || pcState === 'disconnected') {
                            db.ref('rooms/' + roomId + '/offers/' + studentRef.key).once('value', function(offerSnap) {
                                if (offerSnap.exists()) {
                                    try { createOrganizerPeerAndAnswer(offerSnap.val()); } catch(e) {}
                                }
                            });
                        } else {
                            // الاتصال موجود — تأكد من تشغيل الـ audio streams
                            var sra = document.getElementById('studentRemoteAudio');
                            if (sra && sra.srcObject && sra.paused) {
                                sra.muted = !spkOn;
                                sra.play().catch(function() {});
                            }
                            // تحقق إضافي: هل يصلنا صوت فعلاً؟
                            if (studentPC && studentPC.getReceivers) {
                                studentPC.getReceivers().forEach(function(receiver) {
                                    if (receiver.track && receiver.track.kind === 'audio') {
                                        receiver.track.enabled = true;
                                    }
                                });
                            }
                        }
                    }
                    // 5) الأستاذ: تأكد من أن audio peers لا تزال تعمل
                    if (isOwner) {
                        for (var k in teacherPeerConns) {
                            var conn = teacherPeerConns[k];
                            if (conn && conn.audioEl) {
                                conn.audioEl.muted = !spkOn;
                                if (conn.audioEl.paused && conn.audioEl.srcObject) {
                                    conn.audioEl.play().catch(function() {});
                                }
                            }
                        }
                    }
                }, 600);
            } catch(e) {}
        }
    });

    // انقطاع الإنترنت: استمع لإعادة الاتصال وألغِ العداد
    if (typeof window !== 'undefined') {
        window.addEventListener('online', function() {
            if (!isOwner) return;
            // الاتصال عاد — ألغِ أي عداد خروج
            stopOwnerHiddenCountdown();
            try {
                if (db && roomId) {
                    db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
                    db.ref('rooms/' + roomId + '/teacherOnline').set(true);
                }
            } catch(e) {}
        });
    }

    // خروج نهائي حقيقي من الصفحة — لا نغلق الغرفة عند الانتقال للخلفية أو صفحة أخرى
    window.addEventListener('pagehide', (e) => {
        if (!isOwner) return;
        // e.persisted=true يعني المتصفح خزّنها للعودة السريعة (bfcache) — لا نحذف
        // لا نغلق الغرفة نهائياً هنا؛ صاحب الغرفة يجب أن يضغط doLeave لإغلاقها
        try {
            db.ref('rooms/' + roomId + '/teacherOnline').set(false);
        } catch(_) {}
        // تسجيل الوقت فقط — لا نضع closed
        saveRoomTime();
    });
    window.addEventListener('beforeunload', () => {
        saveRoomTime();
        if (isOwner && db && roomId) {
            try { db.ref('rooms/' + roomId + '/teacherOnline').set(false); } catch(_) {}
        }
        // لا نستدعي cleanup() هنا — نترك الغرفة مفتوحة
    });

    // ─── نافذة الخروج ───
    function showLeave() {
        document.getElementById('lov').style.display = 'block';
        setTimeout(() => { document.getElementById('lov').style.opacity = '1'; document.getElementById('lm').classList.add('show'); }, 10);
    }
    function hideLeave() {
        document.getElementById('lm').classList.remove('show');
        document.getElementById('lov').style.opacity = '0';
        setTimeout(() => { document.getElementById('lov').style.display = 'none'; }, 300);
    }
    function saveRoomTime() {
        if (!me || !me.uid || !roomJoinTime) return;
        var joinTime = roomJoinTime;
        roomJoinTime = null;
        var totalSecs = Math.floor((Date.now() - joinTime) / 1000);
        var totalMins = Math.floor(totalSecs / 60);
        // نقاط الغرفة — نقطة لكل دقيقتين
        if (totalMins >= 2) {
            db.ref('users/' + me.uid + '/videoRoomTime').transaction(function(v) { return (v || 0) + totalMins; });
            db.ref('users/' + me.uid + '/roomPoints').transaction(function(v) { return (v || 0) + Math.floor(totalMins / 2); });
        }
        // ── تحديث تقدم مهام غرفة الفيديو (من المهام المحملة مسبقاً) ──
        if (totalSecs < 60) return;
        var tasks = _cachedRoomTasks || {};
        Object.keys(tasks).forEach(function(tid) {
            var t = tasks[tid];
            if (t.type !== 'video-room') return;
            if (!t.active) return;
            var taskCreatedAt = t.createdAt || 0;
            if (taskCreatedAt > joinTime) return;
            var action = t.roomAction || 'any';
            if (action === 'create' && !isOwner) return;
            if (action === 'join' && isOwner) return;
            var required = t.roomMinutes || 1;
            if (totalMins >= required) {
                db.ref('userTaskProgress/' + me.uid + '/' + tid).transaction(function(v) {
                    var cur = v || 0;
                    var goal = t.target || 1;
                    if (cur < goal) return cur + 1;
                    return cur;
                });
            }
        });
    }
    function doLeave() {
        window.__doingLeave = true;
        // مسح بيانات الغرفة النشطة من localStorage
        try { localStorage.removeItem('yw_floating_room'); } catch(e) {}
        try { localStorage.removeItem('yw_active_room'); } catch(e) {}
        try { localStorage.removeItem('targetRoom'); } catch(e) {}
        try { sessionStorage.removeItem('targetRoom'); } catch(e) {}
        saveRoomTime();
        if (isOwner) {
            db.ref('rooms/' + roomId + '/teacherOnline').set(false);
            // إغلاق الغرفة فعلاً وحذفها من قائمة الغرف النشطة
            endRoom('تم إخراج الجميع بسبب خروج صاحب الغرفة');
            // حذف الغرفة من قائمة الغرف فوراً لمنع ظهورها في "الغرف النشطة"
            db.ref('rooms/' + roomId).update({ closed: true, closedAt: Date.now(), closedBy: me.uid });
            setTimeout(function() {
                db.ref('rooms/' + roomId).remove().catch(function(){});
            }, 3000);
        } else {
            // الطالب يغادر: أزل مقعده فوراً من Firebase
            if (mySeatIdx !== null) {
                try { db.ref('rooms/' + roomId + '/seats/' + mySeatIdx).remove(); } catch(e) {}
                mySeatIdx = null;
            }
            // إذا كان في البث — أزل spotlight
            try {
                db.ref('rooms/' + roomId + '/spotlight').once('value', function(spSnap) {
                    var spData = spSnap.val();
                    if (spData && spData.uid && me && spData.uid === me.uid) {
                        db.ref('rooms/' + roomId + '/spotlight').remove().catch(function(){});
                    }
                });
            } catch(e) {}
            // أزل من المشاهدين
            try { db.ref('rooms/' + roomId + '/viewers/' + me.uid).remove(); } catch(e) {}
        }
        cleanup();
        location.href = 'roomhom.html';
    }

    // ─── الذهاب للرئيسية مع الإبقاء في الغرفة ───
    function goHomeKeepRoom() {
        // إذا كان الطالب في البث — امنعه من المغادرة
        if (!isOwner) {
            db.ref('rooms/' + roomId + '/spotlight').once('value', function(spSnap) {
                var spData = spSnap.val();
                if (spData && spData.uid && me && spData.uid === me.uid) {
                    showToast('لا يمكنك مغادرة الغرفة وأنت في البث. اضغط على مقعدك لإزالة نفسك من البث أولاً.');
                    return;
                }
                // ليس في البث — اسمح بالخروج
                _doGoHomeKeepRoom();
            });
            return;
        }
        _doGoHomeKeepRoom();
    }
    function _doGoHomeKeepRoom() {
        // إذا كان الأستاذ — أظهر صورته (أخفِ الكاميرا) عند الذهاب للرئيسية
        if (isOwner && !_avOverlayOn) {
            try { showAvatarOverlay(); } catch(e) {}
        }
        // المقعد يبقى ظاهراً للجميع — لا نحذف أي شيء
        const floatData = {
            roomId: roomId,
            roomName: (roomData && roomData.roomName) ? roomData.roomName : (document.getElementById('roomLabel') ? document.getElementById('roomLabel').textContent : 'الغرفة'),
            avatar: me ? (me.avatar || '') : '',
            isOwner: isOwner,
            ts: Date.now()
        };
        try { localStorage.setItem('yw_floating_room', JSON.stringify(floatData)); } catch(e) {}
        // تأكد من بقاء المقعد مسجلاً في Firebase — المالك والطالب معاً
        try {
            if (isOwner && me && me.uid && roomId) {
                db.ref('rooms/' + roomId + '/seats/0').set({
                    userId: me.uid, name: me.name, avatar: me.avatar || '',
                    frame: me.frame || '', badge: me.badge || '',
                    micOn: micOn || false, ts: Date.now(), isOwner: true
                });
                db.ref('rooms/' + roomId + '/ownerHeartbeat').set(Date.now());
            } else if (!isOwner && me && me.uid && roomId && mySeatIdx !== null) {
                // الطالب: أبقِ مقعده مسجلاً
                db.ref('rooms/' + roomId + '/seats/' + mySeatIdx).set({
                    userId: me.uid, name: me.name, avatar: me.avatar || '',
                    frame: me.frame || '', badge: me.badge || '',
                    micOn: micOn || false, ts: Date.now()
                });
            }
        } catch(e) {}
        // لا نستدعي cleanup — نبقى متصلين بالغرفة
        location.href = 'home.html';
    }
    function cleanup() {
        if (window.__roomPointsInt) { clearInterval(window.__roomPointsInt); window.__roomPointsInt = null; }
        if (isOwner) { try { stopOwnerHeartbeat(); stopOwnerHiddenCountdown(); } catch(e) {} }
        if (mySeatIdx !== null) db.ref('rooms/' + roomId + '/seats/' + mySeatIdx).remove();
        if (studentRef) studentRef.remove();
        db.ref('rooms/' + roomId + '/viewers/' + me.uid).remove();
        db.ref('rooms/' + roomId).off();
        // إيقاف جميع مستمعات Firebase الفرعية
        try { db.ref('rooms/' + roomId + '/students').off(); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/connectRequest').off(); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/ownerReoffer').off(); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/cameraFlip').off(); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/spotlight').off(); } catch(e) {}
        try { db.ref('rooms/' + roomId + '/spotlightTrackTs').off(); } catch(e) {}
        if (localStream) localStream.getTracks().forEach(t => t.stop());
        // أغلق studentPC (جهة المنظم)
        if (studentPC) {
            try { if (_scAnswerRef) _scAnswerRef.off(); } catch(e) {}
            try { if (_scIceRef)   _scIceRef.off();   } catch(e) {}
            try { studentPC.ontrack = null; studentPC.onicecandidate = null; studentPC.oniceconnectionstatechange = null; studentPC.onconnectionstatechange = null; studentPC.close(); } catch(e) {}
            studentPC = null;
        }
        // أغلق teacherPeerConns (جهة الأستاذ)
        for (const key in teacherPeerConns) {
            const conn = teacherPeerConns[key];
            try { if (conn._offRef) conn._offRef.off(); } catch(e) {}
            try { if (conn._iceRef)  conn._iceRef.off(); } catch(e) {}
            try { if (conn.pc) { conn.pc.ontrack = null; conn.pc.onicecandidate = null; conn.pc.oniceconnectionstatechange = null; conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch(e) {}
            try { if (conn.audioEl) conn.audioEl.remove(); } catch(e) {}
            delete teacherPeerConns[key];
        }
    }
    const _lovEl = document.getElementById('lov');
    if (_lovEl) _lovEl.addEventListener('click', hideLeave);

    // ─── منطق الصندوق العائم (في هذه الصفحة — يُخفى دائماً) ───
    // الصندوق يظهر فقط في الصفحات الأخرى، ليس في صفحة الغرفة نفسها
    (function initFloatingBoxInRoom() {
        const box = document.getElementById('floatingRoomBox');
        if (box) box.style.display = 'none';
    })();

    // ─── نافذة التأكيد ───
    function showConfirm(title, body, onYes) {
        const cm = document.getElementById('cm');
        document.getElementById('cmt').textContent = title || '';
        document.getElementById('cmb').textContent = body || '';
        const yes = document.getElementById('cmYes'); const no = document.getElementById('cmNo');
        yes.onclick = null; no.onclick = null;
        no.onclick = (e) => { try { e && e.stopPropagation(); } catch(_) {} closeAll(); };
        yes.onclick = async (e) => { try { e && e.stopPropagation(); } catch(_) {} closeAll(); try { if (typeof onYes === 'function') await onYes(); } catch(_) {} };
        cm.classList.add('open');
        openOv();
    }

    // ─── مودالات ───
    function openOv() { const ov = document.getElementById('ov'); if(!ov) return; ov.style.display = 'block'; ov.classList.add('vis'); }
    function closeAll() {
        document.getElementById('pm').classList.remove('show');
        document.getElementById('orgm').classList.remove('open');
        document.getElementById('spm').classList.remove('open');
        document.getElementById('cm').classList.remove('open');
        document.getElementById('viewersModal').classList.remove('open');
        const ov = document.getElementById('ov');
        if (ov) { ov.classList.remove('vis'); setTimeout(() => { ov.style.display = 'none'; }, 300); }
        document.body.style.overflow = '';
    }

    // منع غلق النوافذ عند الضغط داخلها
    ['pm','orgm','spm','cm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', e => { try { e.stopPropagation(); } catch(_) {} });
    });

    const _ovEl = document.getElementById('ov');
    if (_ovEl) _ovEl.addEventListener('click', closeAll);

    // ─── Toast ───
    let __toastTO = null;
    function showToast(msg) {
        const t = document.getElementById('toast');
        if (!t) { try { alert(msg); } catch(_) {} return; }
        t.textContent = msg || ''; t.style.display = 'block';
        clearTimeout(__toastTO); __toastTO = setTimeout(() => { t.style.display = 'none'; }, 2200);
    }

    // ─── إشعارات الدخول — تدعم تعدد الإشعارات وتظهر تحت إشعارات الإيموجي ───
    var _rvEntryCards = []; // مصفوفة البطاقات النشطة

    function _rvPositionContainer() {
        // احسب ارتفاع إشعارات الإيموجي ليظهر الإشعار تحتها
        var emoWrap = document.getElementById('emoNotifWrap');
        var emoH = emoWrap ? emoWrap.offsetHeight : 0;
        var topOffset = 10 + (emoH > 0 ? emoH + 6 : 0);
        var c = document.getElementById('rvEntryEffect');
        if (c) c.style.top = topOffset + 'px';
    }

    function rvShowEntryEffect(name, avatar, entryImgUrl) {
        var c = document.getElementById('rvEntryEffect');
        if (!c) return;
        c.style.display = 'flex';
        _rvPositionContainer();

        // أنشئ البطاقة
        var card = document.createElement('div');
        card.className = 'rv-entry-card';
        var avHtml  = avatar ? `<img src="${avatar}" class="rv-entry-av" onerror="this.style.background='#555'">` : '';
        var icoHtml = entryImgUrl ? `<img src="${entryImgUrl}" class="rv-entry-ico" onerror="this.style.display='none'">` : '';
        card.innerHTML = avHtml + `<div class="rv-entry-txt"><strong>${name}</strong> دخل الغرفة</div>` + icoHtml;
        c.appendChild(card);
        _rvEntryCards.push(card);

        // إذا تجاوز العدد 2 — احذف الأقدم
        if (_rvEntryCards.length > 2) {
            var old = _rvEntryCards.shift();
            if (old && old.parentNode) old.parentNode.removeChild(old);
        }

        // احذف هذه البطاقة بعد 5 ثوانٍ
        var cardRef = card;
        setTimeout(function() {
            cardRef.style.animation = 'rvEntryOut .35s ease forwards';
            setTimeout(function() {
                if (cardRef.parentNode) cardRef.parentNode.removeChild(cardRef);
                _rvEntryCards = _rvEntryCards.filter(function(x){ return x !== cardRef; });
                if (_rvEntryCards.length === 0 && c) c.style.display = 'none';
            }, 350);
        }, 5000);
    }

    let __snackTO = null;
    function showSnack(msg, icon) {
        const s = document.getElementById('snack');
        const sm = document.getElementById('snackMsg');
        const si = document.getElementById('snackIcon');
        if (!s || !sm) return;
        sm.textContent = msg || '';
        // الأيقونة: أُخفيها إذا كانت فارغة، وأُظهرها فقط إذا مُرّرت قيمة
        if (si) {
            if (icon) { si.textContent = icon; si.style.display = ''; }
            else { si.style.display = 'none'; }
        }
        // لون الشريط الجانبي
        s.style.borderRightColor = '#1877f2';
        s.classList.add('show');
        clearTimeout(__snackTO);
        __snackTO = setTimeout(() => { s.classList.remove('show'); if(si) si.style.display=''; }, 3000);
    }

    function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Cloudinary Upload Helper ── */
async function uploadToCloudinary(file, onProgress) {
    return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        var fd  = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', 'my_app_upload');
        var resType = (file.type && (file.type.startsWith('video/') || file.type.startsWith('audio/'))) ? 'video' : 'image';
        if (xhr.upload && onProgress) {
            xhr.upload.addEventListener('progress', function(e) {
                if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
            });
        }
        xhr.addEventListener('load', function() {
            if (xhr.status === 200) {
                var d = JSON.parse(xhr.responseText);
                d.secure_url ? resolve(d.secure_url) : reject(new Error(d.error ? d.error.message : 'Upload failed'));
            } else { reject(new Error('HTTP ' + xhr.status)); }
        });
        xhr.addEventListener('error', function() { reject(new Error('Network error')); });
        xhr.open('POST', 'https://api.cloudinary.com/v1_1/dlujoziwz/' + resType + '/upload');
        xhr.send(fd);
    });
}


    // ═══════════════════════════════════════════════
    //  Avatar Overlay — إخفاء الكاميرا وإظهار الصورة
    // ═══════════════════════════════════════════════
    var _avOverlayOn = false;        // هل الـ overlay مفعّل؟
    var _avAnalyser  = null;         // Web Audio AnalyserNode
    var _avAudioCtx  = null;
    var _avAnimFrame = null;

    // ── تفعيل / تعطيل Overlay ──
    function toggleAvatarOverlay() {
        if (_avOverlayOn) {
            hideAvatarOverlay();
            // إذا كان الأستاذ في spotlight — أعِد broadcast localStream للمشاهدين
            try {
                db.ref('rooms/' + roomId + '/spotlight').once('value', function(sp) {
                    var spd = sp.val();
                    if (spd && spd.uid && me && spd.uid === me.uid) {
                        // أعِد تفعيل video track وأبلغ المشاهدين
                        if (localStream) localStream.getVideoTracks().forEach(function(t){ t.enabled = true; });
                        db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now());
                    }
                });
            } catch(e) {}
        } else {
            showAvatarOverlay();
            // إذا كان الأستاذ في spotlight — أبلغ المشاهدين بتحديث track (سيرون البلاك فريم)
            try {
                db.ref('rooms/' + roomId + '/spotlight').once('value', function(sp) {
                    var spd = sp.val();
                    if (spd && spd.uid && me && spd.uid === me.uid) {
                        db.ref('rooms/' + roomId + '/spotlightTrackTs').set(Date.now());
                    }
                });
            } catch(e) {}
        }
        // تحديث نص زر الكاميرا
        var btn = document.getElementById('pmToggleCamBtn');
        if (btn) {
            btn.innerHTML = _avOverlayOn
                ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="2" y1="2" x2="22" y2="22"/></svg> إظهار الكاميرا'
                : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> إخفاء الكاميرا';
        }
        closeAll();
    }

    function showAvatarOverlay() {
        var tv  = document.getElementById('tv');
        var ov  = document.getElementById('avatarOverlay');
        var img = document.getElementById('avatarOverlayImg');
        var nm  = document.getElementById('avatarOverlayName');
        var sub = document.getElementById('avatarOverlaySubject');

        var avatar = (me && me.avatar && me.avatar.trim() !== '') ? me.avatar.trim() : '';
        var name   = (me && me.name)  ? me.name   : 'المضيف';

        // ── الشرط الأساسي: لا نُظهر الـ overlay أبداً إذا لم تكن هناك صورة ──
        if (!avatar) {
            // أخفِ overlay وأعِد الفيديو كما كان
            _avOverlayOn = false;
            if (ov) ov.classList.remove('show');
            if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
            return;
        }

        _avOverlayOn = true;
        // أخفِ الفيديو
        if (tv) { tv.style.opacity = '0'; tv.style.visibility = 'hidden'; }

        // ملء بيانات الـ overlay
        if (nm)  nm.textContent  = name;
        var roomInfo = '';
        try {
            var fd = JSON.parse(localStorage.getItem('yw_floating_room') || '{}');
            roomInfo = fd.roomName || (roomData && roomData.roomName) || '';
        } catch(e) {}
        if (sub) sub.textContent = roomInfo;

        if (img) {
            img._avTryN = 0;
            img.style.background = '#2a2a4a';
            img.removeAttribute('src');

            img.onerror = function() {
                img._avTryN = (img._avTryN || 0) + 1;
                if (img._avTryN < 3) {
                    // إعادة المحاولة مرة أخرى
                    setTimeout(function() {
                        img.src = avatar + (avatar.includes('?') ? '&' : '?') + '_ot=' + Date.now();
                    }, 800 * img._avTryN);
                } else {
                    // فشل تحميل الصورة نهائياً — أخفِ overlay وأعِد الفيديو
                    _avOverlayOn = false;
                    if (ov) ov.classList.remove('show');
                    if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
                    if (localStream) {
                        localStream.getVideoTracks().forEach(function(t){ t.enabled = true; });
                    }
                    _avStopVoiceDetector();
                }
            };

            img.onload = function() {
                img.style.background = 'transparent';
                // الصورة حُمِّلت بنجاح — أظهر overlay الآن
                if (ov && _avOverlayOn) ov.classList.add('show');
            };

            // ابدأ تحميل الصورة
            img.src = avatar;
        } else {
            // لا يوجد عنصر img — أظهر مباشرة بدون صورة
            if (ov) ov.classList.add('show');
        }

        // أوقف video tracks (الصوت يبقى)
        if (localStream) {
            localStream.getVideoTracks().forEach(function(t){ t.enabled = false; });
        }
        // أخبر الطلاب عبر Firebase
        if (typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/ownerOverlay').set({
                on: true,
                avatar: avatar || '',
                name: name || '',
                roomName: (roomData && roomData.roomName) ? roomData.roomName : '',
                ts: Date.now()
            });
        }
        _avSendBlackFrame();
        _avStartVoiceDetector();
    }

    function hideAvatarOverlay() {
        _avOverlayOn = false;
        var tv = document.getElementById('tv');
        var ov = document.getElementById('avatarOverlay');
        if (tv) { tv.style.opacity = '1'; tv.style.visibility = ''; }
        if (ov) ov.classList.remove('show');
        if (localStream) {
            localStream.getVideoTracks().forEach(function(t){ t.enabled = true; });
        }
        if (typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/ownerOverlay').set({ on: false, ts: Date.now() });
        }
        _avStopVoiceDetector();
    }

    // ── إرسال إطار أسود عند إخفاء الكاميرا (يُبقي الاتصال حياً) ──
    function _avSendBlackFrame() {
        if (!isOwner || !localStream) return;
        // لا نوقف الفيديو track — نكتفي بـ enabled=false
        // الـ WebRTC سيرسل إطارات سوداء تلقائياً
    }

    // ── كاشف الصوت — يُحرّك الحلقات عند الكلام ──
    function _avStartVoiceDetector() {
        if (!localStream) return;
        try {
            _avAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var src = _avAudioCtx.createMediaStreamSource(localStream);
            _avAnalyser = _avAudioCtx.createAnalyser();
            _avAnalyser.fftSize = 256;
            src.connect(_avAnalyser);
            var buf = new Uint8Array(_avAnalyser.frequencyBinCount);
            var ov  = document.getElementById('avatarOverlay');
            var img = document.getElementById('avatarOverlayImg');
            var speaking = false;
            function tick() {
                if (!_avOverlayOn) { _avStopVoiceDetector(); return; }
                _avAnalyser.getByteFrequencyData(buf);
                var sum = 0;
                for (var i = 0; i < buf.length; i++) sum += buf[i];
                var avg = sum / buf.length;
                var nowSpeaking = avg > 18;
                if (nowSpeaking !== speaking) {
                    speaking = nowSpeaking;
                    if (ov) ov.classList.toggle('speaking', speaking);
                    // border يتحكم به CSS animation — لا نلمسه هنا
                }
                _avAnimFrame = requestAnimationFrame(tick);
            }
            tick();
        } catch(e) {}
    }

    function _avStopVoiceDetector() {
        if (_avAnimFrame) { cancelAnimationFrame(_avAnimFrame); _avAnimFrame = null; }
        if (_avAudioCtx) { try { _avAudioCtx.close(); } catch(e) {} _avAudioCtx = null; }
        _avAnalyser = null;
        var ov = document.getElementById('avatarOverlay');
        if (ov) ov.classList.remove('speaking');
    }

    // ── ربط زر التبديل في نافذة البروفايل ──
    (function bindToggleCamBtn() {
        var btn = document.getElementById('pmToggleCamBtn');
        if (btn) btn.addEventListener('click', function() {
            // إذا الـ overlay شغال وأراد إظهار الكاميرا مجدداً
            if (_avOverlayOn) {
                // تأكد من أن localStream فيه video track جاهز
                var hasVideo = localStream && localStream.getVideoTracks().length > 0 &&
                               localStream.getVideoTracks().some(function(t){ return t.readyState !== 'ended'; });
                if (!hasVideo) {
                    // أعِد فتح الكاميرا
                    var constraints = { video: { facingMode: usingFrontCamera ? 'user' : 'environment' }, audio: { echoCancellation: true, noiseSuppression: true } };
                    navigator.mediaDevices.getUserMedia(constraints).then(function(newStream) {
                        if (localStream) {
                            // أضف tracks الجديدة
                            newStream.getVideoTracks().forEach(function(vt) {
                                localStream.addTrack(vt);
                            });
                            // استبدل الـ audio track إن لزم
                        } else {
                            localStream = newStream;
                        }
                        document.getElementById('tv').srcObject = localStream;
                        document.getElementById('tv').muted = true;
                        document.getElementById('tv').play().catch(function(){});
                        localStream.getAudioTracks().forEach(function(t){ t.enabled = micOn; });
                        hideAvatarOverlay();
                        _avOverlayOn = false;
                        // تحديث نص الزر
                        var b = document.getElementById('pmToggleCamBtn');
                        if (b) b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> إخفاء الكاميرا / إظهار ملفي';
                        closeAll();
                        showSnack('تم تفعيل الكاميرا', '📷');
                    }).catch(function(err) {
                        showSnack('تعذّر فتح الكاميرا. تأكد من الإذن', '❌');
                    });
                    return;
                }
            }
            toggleAvatarOverlay();
        });
    })();

    // ── إظهار Overlay تلقائياً عند الدخول لأول مرة (للمضيف فقط) ──
    function initOwnerAvatarOverlay() {
        if (!isOwner) return;
        // ننتظر حتى تتحمل بيانات me.avatar من Firebase (3 ثوانٍ كافية)
        // ثم نستدعي showAvatarOverlay مع التحقق من وجود الصورة
        var _waitCount = 0;
        function _tryShow() {
            _waitCount++;
            if ((me && me.avatar) || _waitCount >= 8) {
                showAvatarOverlay();
                var btn = document.getElementById('pmToggleCamBtn');
                if (btn) btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><line x1="2" y1="2" x2="22" y2="22" stroke-width="2"/></svg> إظهار الكاميرا مجدداً';
            } else {
                setTimeout(_tryShow, 400);
            }
        }
        setTimeout(_tryShow, 600);
    }

// ================================================================
// =================== السبورة العائمة ===========================
// ================================================================
(function() {
    var brdTool    = 'pen';
    var brdColor   = '#000000';
    var brdSize    = 5;
    var brdScale   = 1;          // تكبير محتوى السبورة
    var brdDrawing = false;
    var brdCanvas, brdCtx;
    var brdUndoStack = [];
    var brdRedoStack = [];
    var brdPendingImg = null;
    var brdMinimized  = false;
    var brdElements   = [];
    var brdSelected   = null;

    // ── متغيرات السكرول ──
    var brdScrollY    = 0;       // إزاحة Canvas الرأسية الحالية (px)
    var brdVirtualH   = 2000;    // ارتفاع السبورة الافتراضي (px)
    var brdThumbDrag  = false;
    var brdThumbStartY = 0;
    var brdThumbStartScroll = 0;

    // ── صلاحيات السبورة ──
    // المستخدم المسموح له بالكتابة (uid) — null = لا أحد غير الأستاذ
    var brdGrantedUid  = null;
    var brdGrantedName = null;
    var brdGrantedAv   = null;
    var brdAmGranted   = false;  // هل أنا (الطالب) لديه إذن؟

    // ── مزامنة Firebase ──
    // نرسل snapshot كل ما رسم الأستاذ/المسموح له، ونستقبله الطلاب
    var brdSyncTO   = null;      // debounce لإرسال الكانفاس
    var brdListening = false;    // هل بدأنا الاستماع؟
    var brdIgnoreNext = false;   // لتجاهل snap ناتج عن كتابتنا
    var brdLastSentTs = 0;       // آخر ts أرسلناه — لتمييز snapshots المُرسَلة منّا

    // ── سحب النافذة ──
    function initWindowDrag() {
        var win  = document.getElementById('boardWindow');
        var bar  = document.getElementById('boardTitleBar');
        if (!win || !bar) return;
        var dragging = false, sx, sy, sl, st;
        bar.addEventListener('pointerdown', function(e) {
            if (e.target.closest('button')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            sl = win.offsetLeft; st = win.offsetTop;
            bar.setPointerCapture(e.pointerId);
        });
        bar.addEventListener('pointermove', function(e) {
            if (!dragging) return;
            var nx = sl + (e.clientX - sx);
            var ny = st + (e.clientY - sy);
            nx = Math.max(0, Math.min(window.innerWidth  - win.offsetWidth,  nx));
            ny = Math.max(0, Math.min(window.innerHeight - win.offsetHeight, ny));
            win.style.left = nx + 'px';
            win.style.top  = ny + 'px';
        });
        bar.addEventListener('pointerup',     function() { dragging = false; });
        bar.addEventListener('pointercancel', function() { dragging = false; });
    }

    // ── تغيير حجم النافذة من الزاوية ──
    function initWindowResize() {
        var win = document.getElementById('boardWindow');
        var hdl = document.getElementById('boardResizeHandle');
        if (!win || !hdl) return;
        var resizing = false, sx, sy, sw, sh;
        hdl.addEventListener('pointerdown', function(e) {
            resizing = true;
            sx = e.clientX; sy = e.clientY;
            sw = win.offsetWidth; sh = win.offsetHeight;
            hdl.setPointerCapture(e.pointerId);
            e.stopPropagation();
        });
        hdl.addEventListener('pointermove', function(e) {
            if (!resizing) return;
            var nw = Math.max(220, sw + (e.clientX - sx));
            var nh = Math.max(200, sh + (e.clientY - sy));
            win.style.width  = nw + 'px';
            win.style.height = nh + 'px';
            brdResizeCanvas();
        });
        hdl.addEventListener('pointerup',     function() { resizing = false; });
        hdl.addEventListener('pointercancel', function() { resizing = false; });
    }

    // ── تصغير / تكبير النافذة ──
    window.toggleBoardMin = function() {
        var win  = document.getElementById('boardWindow');
        var area = document.getElementById('boardArea');
        var tb   = document.getElementById('boardToolbar');
        var bb   = document.getElementById('boardBottom');
        var pb   = document.getElementById('boardPermBar');
        brdMinimized = !brdMinimized;
        var els = [area, tb, bb, win.children[2]];
        els.forEach(function(el) { if (el) el.style.display = brdMinimized ? 'none' : ''; });
        if (pb) pb.style.display = brdMinimized ? 'none' : (pb.classList.contains('active') ? 'flex' : 'none');
        document.getElementById('boardMinBtn').textContent = brdMinimized ? '□' : '—';
        if (!brdMinimized) setTimeout(brdResizeCanvas, 50);
    };

    // ── تهيئة السبورة ──
    function brdInit() {
        brdCanvas = document.getElementById('boardCanvas');
        if (!brdCanvas) return;
        brdCtx = brdCanvas.getContext('2d');
        brdResizeCanvas();
        // تأكد من خلفية بيضاء للكانفاس
        brdCtx.fillStyle = '#ffffff';
        brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
        window.addEventListener('resize', brdResizeCanvas);

        brdCanvas.addEventListener('pointerdown', brdOnDown);
        brdCanvas.addEventListener('pointermove', brdOnMove);
        brdCanvas.addEventListener('pointerup',   brdOnUp);
        brdCanvas.addEventListener('pointercancel', brdOnUp);

        var sl = document.getElementById('boardSizeSlider');
        if (sl) { sl.value = brdSize; sl.oninput = function() { brdSize = parseInt(this.value); }; }

        brdUpdateColor('#000000');
        initWindowDrag();
        initWindowResize();
        initScrollBar();
        window.brdStartFirebaseListeners();
        brdUpdatePermUI();
    }

    function brdResizeCanvas() {
        if (!brdCanvas) return;
        var wrap = document.getElementById('boardScrollWrap');
        if (!wrap) return;
        var visW = wrap.clientWidth  || 300;
        // حفظ المحتوى الحالي قبل تغيير الأبعاد
        var saved = null;
        if (brdCanvas.width > 0 && brdCanvas.height > 0) {
            try { saved = brdCanvas.toDataURL(); } catch(e) { saved = null; }
        }
        var oldW = brdCanvas.width;
        var oldH = brdCanvas.height;
        brdCanvas.width  = visW;
        brdCanvas.height = brdVirtualH;
        brdCanvas.style.width  = visW + 'px';
        brdCanvas.style.height = brdVirtualH + 'px';
        // خلفية بيضاء
        brdCtx.fillStyle = '#ffffff';
        brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
        // إعادة الـ transform إذا كانت مُفعّلة (CSS transform — لا نحتاج ctx.setTransform)
        // ضبط الإزاحة
        brdApplyScroll();
        // استعادة المحتوى
        if (saved) {
            var img = new Image();
            img.onload = function() {
                if (brdCtx && brdCanvas) {
                    brdCtx.fillStyle = '#ffffff';
                    brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
                    brdCtx.drawImage(img, 0, 0);
                }
            };
            img.src = saved;
        }
        updateScrollThumb();
        var layer = document.getElementById('boardElementsLayer');
        if (layer) {
            layer.style.width  = visW + 'px';
            layer.style.height = brdVirtualH + 'px';
        }
    }

    // ── السكرول ──
    function brdApplyScroll() {
        if (!brdCanvas) return;
        var wrap = document.getElementById('boardScrollWrap');
        if (!wrap) return;
        var maxScroll = Math.max(0, brdVirtualH - (wrap.clientHeight || 200));
        brdScrollY = Math.max(0, Math.min(brdScrollY, maxScroll));
        brdCanvas.style.top = -brdScrollY + 'px';
        var layer = document.getElementById('boardElementsLayer');
        if (layer) layer.style.top = -brdScrollY + 'px';
        updateScrollThumb();
    }

    function updateScrollThumb() {
        var track = document.getElementById('boardScrollTrack');
        var thumb = document.getElementById('boardScrollThumb');
        var wrap  = document.getElementById('boardScrollWrap');
        if (!track || !thumb || !wrap) return;
        var visH    = wrap.clientHeight || 200;
        var trackH  = track.clientHeight || 200;
        var ratio   = Math.min(1, visH / brdVirtualH);
        var thumbH  = Math.max(22, trackH * ratio);
        thumb.style.height = thumbH + 'px';
        var maxScroll  = Math.max(1, brdVirtualH - visH);
        var thumbRange = Math.max(1, trackH - thumbH);
        var thumbTop   = (brdScrollY / maxScroll) * thumbRange;
        thumb.style.top = thumbTop + 'px';
    }

    function initScrollBar() {
        var thumb    = document.getElementById('boardScrollThumb');
        var track    = document.getElementById('boardScrollTrack');
        var upBtn    = document.getElementById('boardScrollUp');
        var downBtn  = document.getElementById('boardScrollDown');
        var wrap     = document.getElementById('boardScrollWrap');
        if (!thumb || !track) return;

        // سحب الـ thumb
        thumb.addEventListener('pointerdown', function(e) {
            brdThumbDrag = true;
            brdThumbStartY = e.clientY;
            brdThumbStartScroll = brdScrollY;
            thumb.setPointerCapture(e.pointerId);
            e.stopPropagation();
        });
        thumb.addEventListener('pointermove', function(e) {
            if (!brdThumbDrag) return;
            var trackH  = track.clientHeight || 200;
            var visH    = wrap ? (wrap.clientHeight || 200) : 200;
            var thumbH  = thumb.clientHeight || 22;
            var thumbRange = Math.max(1, trackH - thumbH);
            var dy = e.clientY - brdThumbStartY;
            var ratio = dy / thumbRange;
            brdScrollY = brdThumbStartScroll + ratio * Math.max(1, brdVirtualH - visH);
            brdApplyScroll();
        });
        thumb.addEventListener('pointerup',     function() { brdThumbDrag = false; });
        thumb.addEventListener('pointercancel', function() { brdThumbDrag = false; });

        // ضغط الأسهم
        if (upBtn)   upBtn.addEventListener('click',   function() { brdScrollY -= 60; brdApplyScroll(); });
        if (downBtn) downBtn.addEventListener('click', function() { brdScrollY += 60; brdApplyScroll(); });

        // Wheel داخل منطقة الرسم — فقط للأستاذ أو المسموح له
        var area = document.getElementById('boardArea');
        if (area) {
            area.addEventListener('wheel', function(e) {
                if (!brdCanDraw()) return;
                e.preventDefault();
                brdScrollY += e.deltaY;
                brdApplyScroll();
                // مزامنة السكرول لجميع المشاهدين
                brdSyncScrollToFirebase();
            }, { passive: false });
        }
    }

    // ── صلاحية الرسم ──
    // يمكن للأستاذ دائماً، وللطالب المسموح له فقط
    function brdCanDraw() {
        if (typeof isOwner !== 'undefined' && isOwner) return true;
        return brdAmGranted;
    }

    // تحديث واجهة صلاحيات الأستاذ
    function brdUpdatePermUI() {
        var pb   = document.getElementById('boardPermBar');
        var tb   = document.getElementById('boardToolbar');
        var txtB = document.getElementById('boardTxtInput');
        var addB = document.getElementById('boardAddTxt');
        var area = document.getElementById('boardArea');
        var notif = document.getElementById('boardStudentPermNotif');
        var isT  = (typeof isOwner !== 'undefined' && isOwner);

        if (isT) {
            // الأستاذ: شريط أدواته مرئي دائماً
            if (tb) tb.style.display = 'flex';
            // شريط النص للأستاذ مرئي دائماً
            var textBar = document.getElementById('boardTextBar');
            if (textBar) textBar.style.display = 'flex';
            // شريط الطالب: مخفي دائماً عند الأستاذ
            var studentBar = document.getElementById('boardStudentBar');
            if (studentBar) studentBar.style.display = 'none';
            // أزرار إغلاق وتصغير السبورة: مرئية للأستاذ
            var closeBtn = document.getElementById('boardCloseBtn');
            var minBtn   = document.getElementById('boardMinBtn');
            if (closeBtn) closeBtn.style.display = '';
            if (minBtn)   minBtn.style.display   = '';
            if (area) area.style.cursor = brdTool === 'move' ? 'default' : 'crosshair';
            // شريط الإذن المُعطى
            if (pb) {
                if (brdGrantedUid) {
                    pb.classList.add('active');
                    var av = document.getElementById('boardPermAvatar');
                    var nm = document.getElementById('boardPermName');
                    if (av) av.src = brdGrantedAv || '';
                    if (nm) nm.textContent = brdGrantedName || 'طالب';
                } else {
                    pb.classList.remove('active');
                }
            }
            if (notif) notif.style.display = 'none';
        } else {
            // الطالب: شريط أدوات الأستاذ مخفي دائماً
            if (tb) tb.style.display = 'none';
            // شريط النص للأستاذ: دائماً مخفي عن الطالب
            var textBar2 = document.getElementById('boardTextBar');
            if (textBar2) textBar2.style.display = 'none';
            // إخفاء زر الإغلاق (×) وزر التصغير (—) عن الطالب نهائياً
            var closeBtn2 = document.getElementById('boardCloseBtn');
            var minBtn2   = document.getElementById('boardMinBtn');
            if (closeBtn2) closeBtn2.style.display = 'none';
            if (minBtn2)   minBtn2.style.display   = 'none';
            // شريط الطالب المخصص: يظهر فقط إذا لديه إذن
            var studentBar2 = document.getElementById('boardStudentBar');
            if (studentBar2) studentBar2.style.display = brdAmGranted ? 'flex' : 'none';
            if (area) area.style.cursor = brdAmGranted ? 'crosshair' : 'not-allowed';
            if (pb) pb.classList.remove('active');
            // إشعار الطالب
            if (notif) {
                if (brdAmGranted) {
                    notif.style.display = 'block';
                    setTimeout(function() { if (notif) notif.style.display = 'none'; }, 4000);
                } else {
                    notif.style.display = 'none';
                }
            }
        }
    }

    // ── منح الإذن للطالب (يُستدعى من bindProfileButtons) ──
    window.brdGrantPermission = function(uid, name, avatar) {
        if (typeof isOwner === 'undefined' || !isOwner) return;
        brdGrantedUid  = uid;
        brdGrantedName = name || 'طالب';
        brdGrantedAv   = avatar || '';
        // نشر في Firebase
        if (typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/boardPerm').set({
                uid:    uid,
                name:   name || '',
                avatar: avatar || '',
                ts:     Date.now()
            });
        }
        brdUpdatePermUI();
    };

    // ── سحب الإذن ──
    window.brdRevokePermission = function() {
        if (typeof isOwner === 'undefined' || !isOwner) return;
        brdGrantedUid  = null;
        brdGrantedName = null;
        brdGrantedAv   = null;
        if (typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/boardPerm').remove();
        }
        brdUpdatePermUI();
    };

    // ── Firebase: مزامنة السبورة ──
    window.brdStartFirebaseListeners = function brdStartFirebaseListeners() {
        if (brdListening) return;
        brdListening = true;
        if (typeof db === 'undefined' || typeof roomId === 'undefined' || !roomId) {
            // إعادة المحاولة بعد ثانية
            setTimeout(window.brdStartFirebaseListeners, 1000);
            brdListening = false;
            return;
        }

        // الاستماع لصلاحية الكتابة
        db.ref('rooms/' + roomId + '/boardPerm').on('value', function(snap) {
            var perm = snap.val();
            var myUid = (typeof me !== 'undefined' && me) ? me.uid : null;
            var isT   = (typeof isOwner !== 'undefined' && isOwner);
            if (perm && perm.uid) {
                if (isT) {
                    brdGrantedUid  = perm.uid;
                    brdGrantedName = perm.name || '';
                    brdGrantedAv   = perm.avatar || '';
                } else {
                    brdAmGranted = (myUid && perm.uid === myUid);
                }
            } else {
                if (isT) {
                    brdGrantedUid  = null;
                    brdGrantedName = null;
                    brdGrantedAv   = null;
                } else {
                    brdAmGranted = false;
                }
            }
            brdUpdatePermUI();
        });

        // الاستماع لمحتوى الكانفاس — كل المستخدمين يستقبلون (المرسل يتجنب التكرار بـ ts)
        db.ref('rooms/' + roomId + '/boardCanvas').on('value', function(snap) {
            var data = snap.val();
            if (!data) return;
            // تجاهل فقط إذا كان هذا هو الـ snapshot الذي أرسلناه نفسه بالـ ts ذاته
            // ملاحظة: لا نستخدم brdIgnoreNext لأنه قد يمنع تحديثات المستخدمين الآخرين
            if (data.ts && data.ts === brdLastSentTs && brdIgnoreNext) {
                brdIgnoreNext = false;
                return;
            }
            brdIgnoreNext = false;
            // إذا السبورة مغلقة — لا تطبّق حتى تُفتح
            var win = document.getElementById('boardWindow');
            if (!brdCanvas && win && !win.classList.contains('open')) return;
            // إذا الكانفاس غير جاهز، هيّئه أولاً
            if (!brdCanvas) {
                brdInit();
                setTimeout(function() { _brdApplySnap(data); }, 200);
                return;
            }
            _brdApplySnap(data);
        });

        // دالة مساعدة لتطبيق بيانات السبورة
        function _brdApplySnap(data) {
            if (!data) return;
            if (data.imgData && brdCanvas && brdCtx) {
                var img = new Image();
                img.onload = function() {
                    if (brdCtx && brdCanvas) {
                        // خلفية بيضاء ثم رسم المحتوى
                        brdCtx.fillStyle = '#ffffff';
                        brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
                        brdCtx.drawImage(img, 0, 0);
                    }
                };
                img.src = data.imgData;
            } else if (brdCanvas && brdCtx) {
                brdCtx.fillStyle = '#ffffff';
                brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
            }
            if (data.elements) {
                try {
                    var els = JSON.parse(data.elements);
                    brdRestoreElements(els);
                } catch(e) {}
            }
        }

        // الاستماع لتمرير السبورة
        db.ref('rooms/' + roomId + '/boardScroll').on('value', function(snap) {
            var isT = (typeof isOwner !== 'undefined' && isOwner);
            if (isT) return; // الأستاذ يتحكم هو
            var sc = snap.val();
            if (sc && typeof sc.y === 'number') {
                brdScrollY = sc.y;
                brdApplyScroll();
            }
        });

        // الاستماع لفتح/إغلاق السبورة من الأستاذ (للطلاب) — Realtime
        db.ref('rooms/' + roomId + '/boardOpen').on('value', function(snap) {
            var isT = (typeof isOwner !== 'undefined' && isOwner);
            if (isT) return; // الأستاذ يتحكم بنفسه
            var isOpen = snap.val();
            if (isOpen === true) {
                var win = document.getElementById('boardWindow');
                if (win && !win.classList.contains('open')) {
                    win.classList.add('open');
                    setTimeout(function() {
                        if (!brdCanvas) {
                            brdInit();
                            setTimeout(function() {
                                db.ref('rooms/' + roomId + '/boardCanvas').once('value', function(cs) {
                                    if (cs.val()) _brdApplySnap(cs.val());
                                });
                            }, 200);
                        } else {
                            brdResizeCanvas();
                            db.ref('rooms/' + roomId + '/boardCanvas').once('value', function(cs) {
                                if (cs.val()) _brdApplySnap(cs.val());
                            });
                        }
                    }, 80);
                }
            } else if (isOpen === false) {
                var win2 = document.getElementById('boardWindow');
                if (win2) win2.classList.remove('open');
            }
        });
    }

    // إرسال محتوى الكانفاس لـ Firebase (debounced بـ 200ms للاستجابة السريعة)
    function brdSyncToFirebase() {
        if (typeof db === 'undefined' || typeof roomId === 'undefined' || !roomId) return;
        // تأكد أن من يرسل لديه صلاحية
        if (!brdCanDraw()) return;
        clearTimeout(brdSyncTO);
        brdSyncTO = setTimeout(function() {
            if (!brdCanvas) return;
            var imgData = brdCanvas.toDataURL('image/jpeg', 0.7);
            // تسلسل العناصر
            var elsData = brdElements.map(function(div) {
                var type = div.dataset.type;
                var x    = parseFloat(div.style.left) || 0;
                var y    = parseFloat(div.style.top)  || 0;
                var w    = div.offsetWidth  || 120;
                if (type === 'image') {
                    var im = div.querySelector('img');
                    return { type: 'image', src: im ? im.src : '', x: x, y: y, w: w };
                } else if (type === 'text') {
                    var sp = div.querySelector('.brd-txt-el');
                    return { type: 'text', text: sp ? sp.textContent : '', x: x, y: y, w: w, color: sp ? sp.style.color : '#222', fontSize: sp ? parseFloat(sp.style.fontSize) || 16 : 16, dir: sp ? (sp.style.direction || 'rtl') : 'rtl' };
                }
                return null;
            }).filter(Boolean);
            var nowTs = Date.now();
            brdLastSentTs = nowTs;
            brdIgnoreNext = true;
            db.ref('rooms/' + roomId + '/boardCanvas').set({
                imgData:  imgData,
                elements: JSON.stringify(elsData),
                ts:       nowTs
            });
        }, 80);
    }

    // إرسال موضع السكرول (الأستاذ أو من لديه إذن فقط)
    function brdSyncScrollToFirebase() {
        if (typeof db === 'undefined' || typeof roomId === 'undefined' || !roomId) return;
        if (!brdCanDraw()) return;
        db.ref('rooms/' + roomId + '/boardScroll').set({ y: brdScrollY, ts: Date.now() });
    }

    // استعادة العناصر من Firebase
    function brdRestoreElements(els) {
        var layer = document.getElementById('boardElementsLayer');
        if (!layer) return;
        // إزالة العناصر الحالية
        brdElements.forEach(function(div) { try { layer.removeChild(div); } catch(e) {} });
        brdElements = [];
        brdSelected = null;
        els.forEach(function(item) {
            if (!item) return;
            var div = brdCreateElSilent(item.type, item);
            if (div) {
                layer.appendChild(div);
                brdElements.push(div);
            }
        });
    }

    // إنشاء عنصر بدون تشغيل المزامنة (للاستعادة من Firebase)
    function brdCreateElSilent(type, opts) {
        var div = document.createElement('div');
        div.className = 'brd-el selectable';
        div.dataset.type = type;
        div.style.left = (opts.x || 40) + 'px';
        div.style.top  = (opts.y || 40) + 'px';
        div.style.position = 'absolute';

        if (type === 'text') {
            div.style.width  = (opts.w || 160) + 'px';
            div.style.height = 'auto';
            var span = document.createElement('span');
            span.className   = 'brd-txt-el';
            span.textContent = opts.text || 'نص';
            span.style.color      = opts.color || '#222';
            span.style.fontSize   = (opts.fontSize || 16) + 'px';
            span.style.direction  = (opts.dir === 'ltr' || opts.dir === 'en') ? 'ltr' : 'rtl';
            span.style.textAlign  = (opts.dir === 'ltr' || opts.dir === 'en') ? 'left' : 'right';
            div.appendChild(span);
        } else if (type === 'image') {
            var img = document.createElement('img');
            img.src = opts.src || '';
            img.draggable = false;
            img.style.width        = (opts.w || 120) + 'px';
            img.style.height       = 'auto';
            img.style.display      = 'block';
            img.style.borderRadius = '6px';
            div.appendChild(img);
        }
        // لا نضيف أحداث للعناصر المستعادة (للطلاب: pointer-events:none على الـ layer)
        return div;
    }

    // ── تغيير الأداة ──
    window.setBrdTool = function(tool) {
        brdTool = tool;
        ['brdPenBtn','brdEraserBtn','brdMoveBtn'].forEach(function(id) {
            var b = document.getElementById(id);
            if (b) b.classList.remove('active');
        });
        var map = { pen:'brdPenBtn', eraser:'brdEraserBtn', move:'brdMoveBtn' };
        var btn = document.getElementById(map[tool]);
        if (btn) btn.classList.add('active');
        var layer = document.getElementById('boardElementsLayer');
        var canvas = document.getElementById('boardCanvas');
        if (tool === 'move') {
            // في وضع التحريك: الـ layer يستقبل الأحداث، الكانفاس لا
            if (layer)  layer.style.pointerEvents  = 'auto';
            if (canvas) canvas.style.pointerEvents = 'none';
        } else {
            // في وضع الرسم/الممحاة: الكانفاس يستقبل الأحداث، الـ layer لا
            if (layer)  layer.style.pointerEvents  = 'none';
            if (canvas) canvas.style.pointerEvents = 'auto';
        }
        var area = document.getElementById('boardArea');
        if (area && brdCanDraw()) area.style.cursor = tool === 'move' ? 'grab' : 'crosshair';
        brdDeselectAll();
    };

    window.brdUpdateColor = function(val) {
        brdColor = val;
        var sw = document.getElementById('boardColorSwatch');
        if (sw) sw.style.background = val;
        var cp = document.getElementById('boardColorPick');
        if (cp) cp.value = val;
    };

    // ── رسم ── (تحويل إحداثيات الإصبع إلى إحداثيات Canvas الافتراضية)
    function brdGetPos(e) {
        var rect = brdCanvas.getBoundingClientRect();
        var src  = e.touches ? e.touches[0] : e;
        return {
            x: src.clientX - rect.left,
            y: src.clientY - rect.top + brdScrollY
        };
    }

    function brdOnDown(e) {
        if (!brdCanDraw()) return;
        if (brdTool === 'move') return;
        e.preventDefault();
        brdCanvas.setPointerCapture(e.pointerId);
        brdSaveUndo();
        brdDrawing = true;
        var pos = brdGetPos(e);
        brdCtx.beginPath();
        brdCtx.moveTo(pos.x, pos.y);
    }

    function brdOnMove(e) {
        if (!brdDrawing) return;
        if (!brdCanDraw()) return;
        e.preventDefault();
        var pos = brdGetPos(e);
        brdCtx.lineWidth   = brdTool === 'eraser' ? brdSize * 3 : brdSize;
        brdCtx.strokeStyle = brdTool === 'eraser' ? 'rgba(255,255,255,1)' : brdColor;
        brdCtx.lineCap     = 'round';
        brdCtx.lineJoin    = 'round';
        brdCtx.globalCompositeOperation = brdTool === 'eraser' ? 'destination-out' : 'source-over';
        brdCtx.lineTo(pos.x, pos.y);
        brdCtx.stroke();
    }

    function brdOnUp(e) {
        if (brdDrawing) {
            brdDrawing = false;
            brdCtx.globalCompositeOperation = 'source-over';
            // مزامنة بعد انتهاء الرسم
            brdSyncToFirebase();
        }
    }

    // ── تراجع / إعادة ──
    function brdSaveUndo() {
        brdUndoStack.push(brdCanvas.toDataURL());
        if (brdUndoStack.length > 30) brdUndoStack.shift();
        brdRedoStack = [];
    }

    window.brdUndo = function() {
        if (!brdCanDraw()) return;
        if (!brdUndoStack.length) return;
        brdRedoStack.push(brdCanvas.toDataURL());
        var prev = brdUndoStack.pop();
        var img = new Image();
        img.onload = function() {
            brdCtx.fillStyle = '#ffffff';
            brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
            brdCtx.drawImage(img, 0, 0);
            brdSyncToFirebase();
        };
        img.src = prev;
    };

    window.brdRedo = function() {
        if (!brdCanDraw()) return;
        if (!brdRedoStack.length) return;
        brdUndoStack.push(brdCanvas.toDataURL());
        var next = brdRedoStack.pop();
        var img = new Image();
        img.onload = function() {
            brdCtx.fillStyle = '#ffffff';
            brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
            brdCtx.drawImage(img, 0, 0);
            brdSyncToFirebase();
        };
        img.src = next;
    };

    window.brdClearAll = function() {
        if (!brdCanDraw()) return;
        // افتح النافذة الجميلة بدل confirm()
        var modal = document.getElementById('brdClearModal');
        if (modal) modal.classList.add('open');
    };

    window.brdDoClearAll = function() {
        var modal = document.getElementById('brdClearModal');
        if (modal) modal.classList.remove('open');
        if (!brdCanvas) return;
        brdSaveUndo();
        // خلفية بيضاء بدلاً من clearRect الذي يُفرغ الكانفاس شفافياً (يبدو أسود)
        brdCtx.fillStyle = '#ffffff';
        brdCtx.fillRect(0, 0, brdCanvas.width, brdCanvas.height);
        var layer = document.getElementById('boardElementsLayer');
        if (layer) layer.innerHTML = '';
        brdElements = []; brdSelected = null;
        brdSyncToFirebase();
    };

    // ── تكبير المحتوى ──
    window.brdZoom = function(delta) {
        brdScale = Math.min(3, Math.max(0.3, brdScale + delta));
        var v = document.getElementById('boardZoomVal');
        if (v) v.textContent = Math.round(brdScale * 100) + '%';
        // استخدام CSS transform على الكانفاس بدلاً من ctx.setTransform (الذي يمسح المحتوى)
        if (brdCanvas) {
            brdCanvas.style.transform = 'scale(' + brdScale + ')';
            brdCanvas.style.transformOrigin = '0 0';
        }
        var layer = document.getElementById('boardElementsLayer');
        if (layer) { layer.style.transform = 'scale('+brdScale+')'; layer.style.transformOrigin = '0 0'; }
    };

    // ── نافذة تأكيد الحذف ──
    var brdDeleteTarget = null;

    window.openBrdDeleteModal = function(elDiv) {
        brdDeleteTarget = elDiv;
        var modal = document.getElementById('brdDeleteModal');
        if (modal) modal.classList.add('open');
    };

    window.closeBrdDeleteModal = function() {
        var modal = document.getElementById('brdDeleteModal');
        if (modal) modal.classList.remove('open');
        brdDeleteTarget = null;
    };

    window.brdConfirmDelete = function() {
        if (!brdDeleteTarget) { closeBrdDeleteModal(); return; }
        var layer = document.getElementById('boardElementsLayer');
        if (layer && brdDeleteTarget.parentNode === layer) layer.removeChild(brdDeleteTarget);
        var idx = brdElements.indexOf(brdDeleteTarget);
        if (idx !== -1) brdElements.splice(idx, 1);
        brdSelected = null;
        brdDeleteTarget = null;
        closeBrdDeleteModal();
        brdSyncToFirebase();
    };

    // ── نافذة إضافة/تعديل النص ──
    var brdTxtEditTarget = null;
    var brdTxtLang = 'ar'; // 'ar' أو 'en'

    window.setBrdLang = function(lang) {
        brdTxtLang = lang;
        var arBtn = document.getElementById('brdLangAr');
        var enBtn = document.getElementById('brdLangEn');
        var area  = document.getElementById('brdTxtArea');
        if (arBtn) arBtn.classList.toggle('active', lang === 'ar');
        if (enBtn) enBtn.classList.toggle('active', lang === 'en');
        if (area) {
            area.style.direction  = lang === 'ar' ? 'rtl' : 'ltr';
            area.style.textAlign  = lang === 'ar' ? 'right' : 'left';
        }
    };

    window.openBrdTextModal = function(elDiv) {
        if (!brdCanDraw()) return;
        brdTxtEditTarget = elDiv || null;
        var modal = document.getElementById('brdTextModal');
        var area  = document.getElementById('brdTxtArea');
        var title = document.getElementById('brdTxtModalTitle');
        var btn   = document.getElementById('brdTxtConfirmBtn');
        var sizeSlider = document.getElementById('brdTxtSizeSlider');
        var sizeVal    = document.getElementById('brdTxtSizeVal');
        if (!modal) return;

        if (brdTxtEditTarget) {
            // وضع التعديل
            var span = brdTxtEditTarget.querySelector('.brd-txt-el');
            if (area)  area.value = span ? span.textContent : '';
            var col = span ? (span.style.color || '#222222') : '#222222';
            var fs  = span ? (parseFloat(span.style.fontSize) || 18) : 18;
            var dir = span ? (span.style.direction || 'rtl') : 'rtl';
            brdTxtUpdateColor(col);
            if (document.getElementById('brdTxtColorPick')) document.getElementById('brdTxtColorPick').value = rgbToHex(col);
            if (sizeSlider) sizeSlider.value = fs;
            if (sizeVal)    sizeVal.textContent = fs;
            if (title) title.textContent = 'تعديل النص';
            if (btn)   btn.textContent   = 'حفظ التعديل';
            setBrdLang(dir === 'ltr' ? 'en' : 'ar');
        } else {
            // وضع الإضافة
            if (area)  area.value = '';
            brdTxtUpdateColor('#222222');
            if (document.getElementById('brdTxtColorPick')) document.getElementById('brdTxtColorPick').value = '#222222';
            if (sizeSlider) sizeSlider.value = 18;
            if (sizeVal)    sizeVal.textContent = '18';
            if (title) title.textContent = 'إضافة نص';
            if (btn)   btn.textContent   = 'إضافة إلى السبورة';
            setBrdLang('ar');
        }
        modal.classList.add('open');
        setTimeout(function() { if (area) area.focus(); }, 200);
    };

    window.closeBrdTextModal = function() {
        var modal = document.getElementById('brdTextModal');
        if (modal) modal.classList.remove('open');
        brdTxtEditTarget = null;
    };

    window.brdTxtUpdateColor = function(val) {
        var sw = document.getElementById('brdTxtColorSwatch');
        if (sw) sw.style.background = val;
    };

    window.brdTxtConfirm = function() {
        var area  = document.getElementById('brdTxtArea');
        var txt   = area ? area.value.trim() : '';
        if (!txt) { if (area) area.focus(); return; }
        var col   = document.getElementById('brdTxtColorPick') ? document.getElementById('brdTxtColorPick').value : '#222222';
        var fs    = document.getElementById('brdTxtSizeSlider') ? parseInt(document.getElementById('brdTxtSizeSlider').value) : 18;

        if (brdTxtEditTarget) {
            // تعديل عنصر موجود
            var span = brdTxtEditTarget.querySelector('.brd-txt-el');
            if (span) {
                span.textContent      = txt;
                span.style.color      = col;
                span.style.fontSize   = fs + 'px';
                span.style.direction  = brdTxtLang === 'en' ? 'ltr' : 'rtl';
                span.style.textAlign  = brdTxtLang === 'en' ? 'left' : 'right';
            }
        } else {
            // إضافة عنصر جديد
            var el = brdCreateEl('text', { text: txt, x: 40, y: 60 + brdScrollY, color: col, fontSize: fs, dir: brdTxtLang });
            var layer = document.getElementById('boardElementsLayer');
            if (layer) layer.appendChild(el);
            // ✅ إضافة العنصر لـ brdElements لضمان إرساله لـ Firebase
            brdElements.push(el);
        }
        closeBrdTextModal();
        brdSyncToFirebase();
    };

    // تحويل rgb() إلى hex للمدخل
    function rgbToHex(rgb) {
        if (!rgb || rgb.charAt(0) === '#') return rgb || '#222222';
        var m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return '#222222';
        return '#' + [m[1],m[2],m[3]].map(function(x){ return ('0'+parseInt(x).toString(16)).slice(-2); }).join('');
    }

    // ── إضافة نص (قديم — لا يُستخدم لكن نبقيه للتوافق) ──
    window.brdAddText = function() { openBrdTextModal(null); };

    // ── إنشاء عنصر ──
    function brdCreateEl(type, opts) {
        var div = document.createElement('div');
        div.className = 'brd-el selectable';
        div.dataset.type = type;
        div.style.left = (opts.x || 40) + 'px';
        div.style.top  = (opts.y || 40) + 'px';
        div.style.position = 'absolute';

        if (type === 'text') {
            div.style.width = (opts.w || 160) + 'px'; // عرض ابتدائي للنص
            div.style.height = 'auto';
            var span = document.createElement('span');
            span.className  = 'brd-txt-el';
            span.textContent = opts.text || 'نص';
            span.style.color      = opts.color || brdColor || '#222';
            span.style.fontSize   = (opts.fontSize || 16) + 'px';
            span.style.direction  = (opts.dir === 'en') ? 'ltr' : 'rtl';
            span.style.textAlign  = (opts.dir === 'en') ? 'left' : 'right';
            div.appendChild(span);
        } else if (type === 'image') {
            var img = document.createElement('img');
            img.src = opts.src;
            img.draggable = false;
            img.style.width     = (opts.w || 120) + 'px';
            img.style.height    = 'auto';
            img.style.display   = 'block';
            img.style.borderRadius = '6px';
            // عند تحميل الصورة: ارسم نسخة منها على الكانفاس لتمكين الكتابة فوقها
            img.addEventListener('load', function() {
                // لا نرسمها تلقائياً على الكانفاس — تبقى كـ element فوق الكانفاس
                // المستخدم يرسم فوقها بالكانفاس مباشرة (الكانفاس فوق layer)
            });
            div.appendChild(img);
        }

        // ذراع تكبير
        var rz = document.createElement('div');
        rz.className = 'brd-resize-handle';
        rz.textContent = '↔';
        div.appendChild(rz);

        // زر حذف العنصر (يظهر عند التحديد)
        var delBtn = document.createElement('div');
        delBtn.className = 'brd-delete-btn';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        delBtn.addEventListener('pointerdown', function(e) {
            e.stopPropagation(); e.preventDefault();
            openBrdDeleteModal(div);
        });
        div.appendChild(delBtn);

        // زر تعديل النص (يظهر عند التحديد — للنصوص فقط)
        if (type === 'text') {
            var editBtn = document.createElement('div');
            editBtn.className = 'brd-edit-btn';
            editBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            editBtn.addEventListener('pointerdown', function(e) {
                e.stopPropagation(); e.preventDefault();
                openBrdTextModal(div);
            });
            div.appendChild(editBtn);
        }

        // تعديل النص بالضغط المزدوج
        if (type === 'text') {
            div.addEventListener('dblclick', function(e) {
                if (!brdCanDraw()) return;
                if (brdTool !== 'move') return;
                e.stopPropagation();
                openBrdTextModal(div);
            });
        }

        // سحب العنصر
        div.addEventListener('pointerdown', function(e) {
            if (!brdCanDraw()) return;
            if (brdTool !== 'move') return;
            if (e.target === rz) return;
            e.stopPropagation(); e.preventDefault();
            brdSelectEl(div);
            var startX = e.clientX, startY = e.clientY;
            var startL = parseFloat(div.style.left) || 0;
            var startT = parseFloat(div.style.top)  || 0;
            div.setPointerCapture(e.pointerId);
            div.style.cursor = 'grabbing';
            var area = document.getElementById('boardArea');
            if (area) area.style.cursor = 'grabbing';
            function onMove(ev) {
                var dx = (ev.clientX - startX) / brdScale;
                var dy = (ev.clientY - startY) / brdScale;
                div.style.left = (startL + dx) + 'px';
                div.style.top  = (startT + dy) + 'px';
            }
            function onUp() {
                div.removeEventListener('pointermove', onMove);
                div.removeEventListener('pointerup', onUp);
                div.removeEventListener('pointercancel', onUp);
                div.style.cursor = 'grab';
                if (area) area.style.cursor = 'grab';
                brdSyncToFirebase();
            }
            div.addEventListener('pointermove', onMove);
            div.addEventListener('pointerup', onUp);
            div.addEventListener('pointercancel', onUp);
        });

        // تكبير/تصغير العنصر
        rz.addEventListener('pointerdown', function(e) {
            if (!brdCanDraw()) return;
            if (brdTool !== 'move') return;
            e.stopPropagation(); e.preventDefault();
            var startX  = e.clientX, startY = e.clientY;
            var startW  = div.offsetWidth  || 120;
            var startH  = div.offsetHeight || 40;
            var sp      = div.querySelector('.brd-txt-el');
            var im      = div.querySelector('img');
            var startFs = sp ? (parseFloat(sp.style.fontSize) || 16) : 16;
            rz.setPointerCapture(e.pointerId);
            function onMove(ev) {
                var dw = (ev.clientX - startX) / brdScale;
                var dy = (ev.clientY - startY) / brdScale;
                if (im) {
                    // صورة: غيّر العرض والارتفاع بشكل عادي
                    var nw = Math.max(50, startW + dw);
                    var nh = Math.max(30, startH + dy);
                    div.style.width  = nw + 'px';
                    div.style.height = nh + 'px';
                    im.style.width   = nw + 'px';
                    im.style.height  = 'auto';
                } else if (sp) {
                    // نص: العرض يتحكم في التفاف النص، الارتفاع للخط
                    var nw2 = Math.max(60, startW + dw);
                    // حجم الخط: يتغير بخطوات صغيرة بناءً على السحب الرأسي
                    var newFs = Math.max(8, Math.min(80, Math.round(startFs + dy * 0.3)));
                    div.style.width    = nw2 + 'px';
                    div.style.height   = 'auto';
                    sp.style.fontSize  = newFs + 'px';
                }
            }
            function onUp() {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup',  onUp);
                document.removeEventListener('pointercancel', onUp);
                brdSyncToFirebase();
            }
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup',   onUp);
            document.addEventListener('pointercancel', onUp);
        });

        brdElements.push(div);
        return div;
    }

    function brdSelectEl(el) {
        brdDeselectAll();
        el.classList.add('selected');
        brdSelected = el;
    }

    function brdDeselectAll() {
        document.querySelectorAll('.brd-el.selected').forEach(function(e) { e.classList.remove('selected'); });
        brdSelected = null;
    }

    // ── رفع صورة ──
    window.openBoardImgModal  = function() {
        if (!brdCanDraw()) return;
        document.getElementById('boardImgModal').classList.add('open');
    };
    window.closeBoardImgModal = function() {
        document.getElementById('boardImgModal').classList.remove('open');
        document.getElementById('boardImgPreview').style.display = 'none';
        document.getElementById('boardImgAddBtn').style.display  = 'none';
        document.getElementById('boardImgFileInput').value = '';
        brdPendingImg = null;
    };

    window.brdPreviewImg = function(input) {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            brdPendingImg = ev.target.result;
            var prev = document.getElementById('boardImgPreview');
            prev.src = brdPendingImg;
            prev.style.display = 'block';
            document.getElementById('boardImgAddBtn').style.display = 'block';
        };
        reader.readAsDataURL(file);
    };

    window.brdConfirmImg = function() {
        if (!brdPendingImg) return;
        var el = brdCreateEl('image', { src: brdPendingImg, x: 30, y: 30 + brdScrollY });
        document.getElementById('boardElementsLayer').appendChild(el);
        // ✅ إضافة العنصر لـ brdElements لضمان إرساله لـ Firebase
        brdElements.push(el);
        closeBoardImgModal();
        brdSyncToFirebase();
    };

    // ── فتح / إغلاق ──
    window.openBoard = function() {
        var win = document.getElementById('boardWindow');
        if (!win) return;
        win.classList.add('open');
        setTimeout(function() {
            if (!brdCanvas) brdInit();
            else brdResizeCanvas();
        }, 60);
        // إخبار الطلاب بفتح السبورة (الأستاذ فقط)
        if (typeof isOwner !== 'undefined' && isOwner && typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/boardOpen').set(true);
        }
    };

    window.closeBoard = function() {
        var win = document.getElementById('boardWindow');
        if (win) win.classList.remove('open');
        brdDeselectAll();
        // إخبار الطلاب بإغلاق السبورة (الأستاذ فقط)
        if (typeof isOwner !== 'undefined' && isOwner && typeof db !== 'undefined' && typeof roomId !== 'undefined' && roomId) {
            db.ref('rooms/' + roomId + '/boardOpen').set(false);
        }
    };
})();
