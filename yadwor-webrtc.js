/**
 * ============================================================
 * YADWOR WebRTC Signaling Manager — نظام WebRTC الاحترافي
 * ============================================================
 *
 * يحل هذا الملف المشاكل التالية كاملاً:
 * 1. الطالب لا يرى/يسمع الأستاذ عند الدخول الأول (Race Condition)
 * 2. مشاكل ICE Candidates قبل setRemoteDescription
 * 3. تضارب localStorage مع Firebase state
 * 4. تسرب Memory عند الخروج
 * 5. مشكلة تبديل الكاميرا
 * 6. Duplicate connections و Duplicate streams
 * 7. مشكلة reconnect عند تغيير الشبكة
 *
 * Architecture:
 * - FirebaseSignalingManager: يدير الـ signaling عبر Firebase
 * - PeerConnectionManager: يدير RTCPeerConnections
 * - StreamManager: يدير MediaStreams
 * - PresenceManager: يدير حضور المستخدمين
 * - ConnectionStateManager: يدير حالة الاتصال
 */

'use strict';

// ═══════════════════════════════════════════════
// ICE Servers — يمكن إضافة TURN servers لاحقاً
// ═══════════════════════════════════════════════
const YADWOR_ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
};

// ═══════════════════════════════════════════════════════════════
// StreamManager — يدير الـ MediaStreams المحلية والبعيدة
// ═══════════════════════════════════════════════════════════════
class StreamManager {
    constructor() {
        this.localStream = null;
        this._remoteStreams = new Map(); // peerId → MediaStream
    }

    async getLocalStream(constraints) {
        // إذا كان الـ stream موجوداً ونشطاً — أرجعه فوراً
        if (this.localStream && this.localStream.active) {
            // تأكد أن جميع الـ tracks لا تزال حية
            const tracks = this.localStream.getTracks();
            const allLive = tracks.every(t => t.readyState === 'live');
            if (allLive && tracks.length > 0) return this.localStream;
        }
        // طلب جديد
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.localStream = stream;
        return stream;
    }

    async getAudioOnlyStream() {
        return this.getLocalStream({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
            }
        });
    }

    async getVideoAudioStream(facingMode = 'user') {
        return this.getLocalStream({
            video: {
                facingMode: facingMode,
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
            }
        });
    }

    // تبديل الكاميرا بدون إعادة بناء PeerConnections
    async switchCamera(facingMode, peerConnections) {
        if (!this.localStream) throw new Error('لا يوجد stream محلي');

        // الحصول على الـ track الجديد من الكاميرا الجديدة
        let newVideoStream;
        try {
            newVideoStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode },
                audio: false
            });
        } catch (e) {
            throw new Error('تعذّر فتح الكاميرا: ' + e.message);
        }

        const newVideoTrack = newVideoStream.getVideoTracks()[0];
        if (!newVideoTrack) {
            newVideoStream.getTracks().forEach(t => t.stop());
            throw new Error('لم يتم الحصول على video track');
        }

        // استبدال الـ track القديم في localStream
        const oldVideoTrack = this.localStream.getVideoTracks()[0];
        if (oldVideoTrack) {
            oldVideoTrack.stop();
            this.localStream.removeTrack(oldVideoTrack);
        }
        this.localStream.addTrack(newVideoTrack);

        // استبدال الـ track في جميع PeerConnections بدون إعادة negotiation
        const replacePromises = [];
        for (const [key, conn] of peerConnections) {
            const senders = conn.pc.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                replacePromises.push(
                    videoSender.replaceTrack(newVideoTrack).catch(e => {
                        console.warn(`[StreamManager] replaceTrack فشل لـ ${key}:`, e);
                    })
                );
            }
        }
        await Promise.allSettled(replacePromises);

        // تنظيف الـ stream المؤقت (نحتفظ بـ track فقط)
        newVideoStream.getVideoTracks().forEach(t => {
            if (t !== newVideoTrack) t.stop();
        });

        return newVideoTrack;
    }

    setAudioEnabled(enabled) {
        if (!this.localStream) return;
        this.localStream.getAudioTracks().forEach(t => { t.enabled = enabled; });
    }

    setVideoEnabled(enabled) {
        if (!this.localStream) return;
        this.localStream.getVideoTracks().forEach(t => { t.enabled = enabled; });
    }

    addRemoteStream(peerId, stream) {
        this._remoteStreams.set(peerId, stream);
    }

    getRemoteStream(peerId) {
        return this._remoteStreams.get(peerId);
    }

    stopAll() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        this._remoteStreams.clear();
    }
}

// ═══════════════════════════════════════════════════════════════
// FirebaseSignalingManager — يدير signaling عبر Firebase
// ═══════════════════════════════════════════════════════════════
class FirebaseSignalingManager {
    constructor(db, roomId) {
        this.db = db;
        this.roomId = roomId;
        this._listeners = []; // { ref, type, callback } لتنظيفها عند الخروج
    }

    // ── مسارات Firebase ──
    get _base()   { return `rooms/${this.roomId}`; }
    _offerPath(sid)     { return `${this._base}/signaling/${sid}/offer`; }
    _answerPath(sid)    { return `${this._base}/signaling/${sid}/answer`; }
    _icePath(sid, dir)  { return `${this._base}/signaling/${sid}/ice/${dir}`; }
    _statusPath(sid)    { return `${this._base}/signaling/${sid}/status`; }
    _studentsPath()     { return `${this._base}/students`; }
    _studentPath(sid)   { return `${this._base}/students/${sid}`; }
    _viewersPath()      { return `${this._base}/viewers`; }
    _presencePath(uid)  { return `${this._base}/presence/${uid}`; }
    _seatsPath()        { return `${this._base}/seats`; }
    _seatPath(idx)      { return `${this._base}/seats/${idx}`; }
    _chatPath()         { return `${this._base}/chat`; }
    _roomPath()         { return `${this._base}`; }
    _statePath()        { return `${this._base}/roomState`; }
    _ownerStatePath()   { return `${this._base}/ownerState`; }
    _reconnectPath()    { return `${this._base}/reconnect`; }

    // ── كتابة offer ──
    async writeOffer(sid, offer) {
        await this.db.ref(this._offerPath(sid)).set(JSON.stringify(offer));
    }

    // ── كتابة answer ──
    async writeAnswer(sid, answer) {
        await this.db.ref(this._answerPath(sid)).set(JSON.stringify(answer));
    }

    // ── كتابة ICE candidate ──
    async writeIceCandidate(sid, dir, candidate) {
        await this.db.ref(this._icePath(sid, dir)).push(JSON.stringify(candidate));
    }

    // ── قراءة offer مرة واحدة ──
    async readOffer(sid) {
        const snap = await this.db.ref(this._offerPath(sid)).get();
        if (!snap.exists()) return null;
        try { return JSON.parse(snap.val()); } catch { return null; }
    }

    // ── مستمع offer (realtime) ──
    onOffer(sid, callback) {
        const ref = this.db.ref(this._offerPath(sid));
        const handler = snap => {
            if (!snap.exists()) return;
            try { callback(JSON.parse(snap.val())); } catch(e) {}
        };
        ref.on('value', handler);
        this._listeners.push({ ref, type: 'value', handler });
        return () => ref.off('value', handler);
    }

    // ── مستمع answer (realtime) ──
    onAnswer(sid, callback) {
        const ref = this.db.ref(this._answerPath(sid));
        const handler = snap => {
            if (!snap.exists()) return;
            try { callback(JSON.parse(snap.val())); } catch(e) {}
        };
        ref.on('value', handler);
        this._listeners.push({ ref, type: 'value', handler });
        return () => ref.off('value', handler);
    }

    // ── مستمع ICE candidates (realtime) ──
    onIceCandidates(sid, dir, callback) {
        const ref = this.db.ref(this._icePath(sid, dir));
        const handler = snap => {
            if (!snap.exists()) return;
            try { callback(JSON.parse(snap.val())); } catch(e) {}
        };
        ref.on('child_added', handler);
        this._listeners.push({ ref, type: 'child_added', handler });
        return () => ref.off('child_added', handler);
    }

    // ── مستمع الطلاب ──
    onStudentAdded(callback) {
        const ref = this.db.ref(this._studentsPath());
        const handler = snap => { if (snap.val()) callback(snap.key, snap.val()); };
        ref.on('child_added', handler);
        this._listeners.push({ ref, type: 'child_added', handler });
        return () => ref.off('child_added', handler);
    }

    onStudentRemoved(callback) {
        const ref = this.db.ref(this._studentsPath());
        const handler = snap => { callback(snap.key, snap.val()); };
        ref.on('child_removed', handler);
        this._listeners.push({ ref, type: 'child_removed', handler });
        return () => ref.off('child_removed', handler);
    }

    // ── حالة الطالب في Firebase ──
    async registerStudent(sid, data) {
        const ref = this.db.ref(this._studentPath(sid));
        await ref.set({ ...data, ts: Date.now() });
        ref.onDisconnect().remove();
        return ref;
    }

    async removeStudent(sid) {
        await this.db.ref(this._studentPath(sid)).remove();
    }

    // ── تنظيف signaling قديم ──
    async cleanupSignaling(sid) {
        const base = `${this._base}/signaling/${sid}`;
        try {
            await this.db.ref(base).remove();
        } catch(e) {}
    }

    // ── تنظيف جميع المستمعات ──
    detachAll() {
        for (const { ref, type, handler } of this._listeners) {
            try { ref.off(type, handler); } catch(e) {}
        }
        this._listeners = [];
    }

    // ── حالة المالك ──
    async updateOwnerState(state) {
        await this.db.ref(this._ownerStatePath()).update({ ...state, ts: Date.now() });
    }

    async getOwnerState() {
        const snap = await this.db.ref(this._ownerStatePath()).get();
        return snap.val() || {};
    }

    onOwnerState(callback) {
        const ref = this.db.ref(this._ownerStatePath());
        const handler = snap => callback(snap.val() || {});
        ref.on('value', handler);
        this._listeners.push({ ref, type: 'value', handler });
        return () => ref.off('value', handler);
    }

    // ── طلب إعادة الاتصال ──
    async requestReconnect(sid) {
        await this.db.ref(`${this._reconnectPath()}/${sid}`).set({ ts: Date.now() });
    }

    onReconnectRequests(callback) {
        const ref = this.db.ref(this._reconnectPath());
        const handler = snap => {
            if (snap.val()) callback(snap.key, snap.val());
        };
        ref.on('child_added', handler);
        this._listeners.push({ ref, type: 'child_added', handler });
        return () => ref.off('child_added', handler);
    }

    async removeReconnectRequest(sid) {
        await this.db.ref(`${this._reconnectPath()}/${sid}`).remove();
    }
}

// ═══════════════════════════════════════════════════════════════
// PeerConnectionManager — يدير RTCPeerConnections
// ═══════════════════════════════════════════════════════════════
class PeerConnectionManager {
    constructor(signalingManager, streamManager) {
        this.signaling = signalingManager;
        this.streams = streamManager;
        // Map: sid → { pc, audioEl, videoEl, uid, unsubscribers[], icePending[] }
        this._peers = new Map();
        this._icePendingQueues = new Map(); // sid → RTCIceCandidate[]
    }

    // ── ينشئ PC للمالك مع طالب جديد ──
    // هذا هو الحل الصحيح لمشكلة "الطالب لا يرى/يسمع عند الدخول الأول"
    async createOwnerPeerForStudent(sid, studentUid, localStream) {
        // منع الـ duplicate
        if (this._peers.has(sid)) {
            const existing = this._peers.get(sid);
            const state = existing.pc.connectionState || existing.pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                console.log(`[PeerManager] اتصال موجود ومتصل مع ${sid} — تجاهل`);
                return existing;
            }
            // إعادة بناء الاتصال الفاشل
            await this._closePeer(sid);
        }

        console.log(`[PeerManager] إنشاء peer للمالك مع الطالب: ${sid}`);

        const pc = new RTCPeerConnection(YADWOR_ICE_SERVERS);
        const icePending = []; // ICE candidates معلقة قبل setRemoteDescription

        // ── عنصر الصوت لاستقبال صوت الطالب ──
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.muted = false;
        document.body.appendChild(audioEl);

        const conn = { pc, audioEl, uid: studentUid || '', icePending, unsubscribers: [] };
        this._peers.set(sid, conn);

        // ── إضافة tracks المالك قبل createOffer ──
        if (localStream) {
            localStream.getTracks().forEach(track => {
                try { pc.addTrack(track, localStream); } catch(e) {}
            });
        }

        // ── استقبال صوت الطالب ──
        pc.ontrack = (e) => {
            if (e.track.kind === 'audio') {
                audioEl.srcObject = e.streams[0] || new MediaStream([e.track]);
                this._playWithRetry(audioEl);
            }
        };

        // ── ICE candidates → Firebase ──
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.signaling.writeIceCandidate(sid, 'fromOwner', e.candidate)
                    .catch(err => console.warn('[PeerManager] فشل كتابة ICE:', err));
            }
        };

        // ── مراقبة حالة الاتصال ──
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            console.log(`[PeerManager] connectionState مع ${sid}: ${state}`);
            if (state === 'failed' || state === 'disconnected') {
                // إعادة المحاولة بعد 3 ثوانٍ
                setTimeout(() => this._rebuildOwnerPeer(sid, studentUid, localStream), 3000);
            }
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            console.log(`[PeerManager] iceConnectionState مع ${sid}: ${state}`);
        };

        // ── مستمع answer من الطالب ──
        const unsubAnswer = this.signaling.onAnswer(sid, async (answer) => {
            if (pc.signalingState !== 'have-local-offer') return;
            if (pc.currentRemoteDescription) return;
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log(`[PeerManager] ✅ تم setRemoteDescription مع ${sid}`);
                // تطبيق الـ ICE candidates المعلقة
                await this._flushPendingIce(sid);
            } catch(e) {
                console.warn(`[PeerManager] فشل setRemoteDescription مع ${sid}:`, e);
            }
        });
        conn.unsubscribers.push(unsubAnswer);

        // ── مستمع ICE من الطالب ──
        const unsubIce = this.signaling.onIceCandidates(sid, 'fromStudent', async (candidateData) => {
            const candidate = new RTCIceCandidate(candidateData);
            if (pc.remoteDescription) {
                try { await pc.addIceCandidate(candidate); } catch(e) {}
            } else {
                // نخزن حتى يتم setRemoteDescription
                conn.icePending.push(candidate);
            }
        });
        conn.unsubscribers.push(unsubIce);

        // ── إنشاء Offer وإرساله ──
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false, // المالك لا يستقبل فيديو من الطلاب عادةً
            });
            await pc.setLocalDescription(offer);
            // انتظر تجميع ICE candidates (أو timeout)
            await this._waitForIceGathering(pc, 3000);
            await this.signaling.writeOffer(sid, pc.localDescription);
            console.log(`[PeerManager] ✅ تم إرسال offer للطالب ${sid}`);
        } catch(err) {
            console.error(`[PeerManager] فشل createOffer مع ${sid}:`, err);
            await this._closePeer(sid);
            return null;
        }

        return conn;
    }

    // ── ينشئ PC للطالب ويرد على offer المالك ──
    // الحل الصحيح: ننتظر offer أولاً، ثم ننشئ PC ونرد
    async createStudentPeerAndAnswer(sid, offerData, localStream, onOwnerTrack) {
        // إغلاق الاتصال القديم أولاً
        if (this._peers.has(sid)) {
            await this._closePeer(sid);
        }

        console.log(`[PeerManager] إنشاء peer للطالب — الرد على offer المالك`);

        const pc = new RTCPeerConnection(YADWOR_ICE_SERVERS);
        const icePending = [];

        const conn = { pc, uid: sid, icePending, unsubscribers: [], audioEl: null };
        this._peers.set(sid, conn);

        // ── استقبال stream المالك ──
        const remoteStream = new MediaStream();
        pc.ontrack = (e) => {
            if (!remoteStream.getTracks().find(t => t.id === e.track.id)) {
                remoteStream.addTrack(e.track);
            }
            console.log(`[PeerManager] ✅ استقبال track من المالك: ${e.track.kind}`);
            if (onOwnerTrack) onOwnerTrack(e.track, remoteStream, e.streams);
        };

        // ── ICE candidates → Firebase ──
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.signaling.writeIceCandidate(sid, 'fromStudent', e.candidate)
                    .catch(err => console.warn('[PeerManager] فشل كتابة ICE:', err));
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`[PeerManager] connectionState (طالب): ${pc.connectionState}`);
        };

        // ── إضافة tracks الطالب (صوت فقط مبدئياً) ──
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                try { pc.addTrack(track, localStream); } catch(e) {}
            });
        }

        // ── setRemoteDescription (offer المالك) ──
        try {
            const offer = new RTCSessionDescription(offerData);
            await pc.setRemoteDescription(offer);
            console.log(`[PeerManager] ✅ تم setRemoteDescription (offer المالك)`);
        } catch(e) {
            console.error('[PeerManager] فشل setRemoteDescription:', e);
            await this._closePeer(sid);
            return null;
        }

        // ── مستمع ICE من المالك — يُطبَّق بعد setRemoteDescription مباشرة ──
        const unsubIce = this.signaling.onIceCandidates(sid, 'fromOwner', async (candidateData) => {
            const candidate = new RTCIceCandidate(candidateData);
            if (pc.remoteDescription) {
                try { await pc.addIceCandidate(candidate); } catch(e) {}
            } else {
                conn.icePending.push(candidate);
            }
        });
        conn.unsubscribers.push(unsubIce);

        // ── إنشاء Answer والرد ──
        try {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this._waitForIceGathering(pc, 3000);
            await this.signaling.writeAnswer(sid, pc.localDescription);
            console.log(`[PeerManager] ✅ تم إرسال answer للمالك`);
        } catch(err) {
            console.error('[PeerManager] فشل createAnswer:', err);
            await this._closePeer(sid);
            return null;
        }

        conn.remoteStream = remoteStream;
        return conn;
    }

    // ── تطبيق ICE candidates المعلقة ──
    async _flushPendingIce(sid) {
        const conn = this._peers.get(sid);
        if (!conn || !conn.icePending.length) return;
        const pending = [...conn.icePending];
        conn.icePending = [];
        for (const candidate of pending) {
            try { await conn.pc.addIceCandidate(candidate); } catch(e) {}
        }
        console.log(`[PeerManager] تم تطبيق ${pending.length} ICE candidates معلقة لـ ${sid}`);
    }

    // ── انتظار اكتمال ICE gathering ──
    _waitForIceGathering(pc, timeout = 3000) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') { resolve(); return; }
            const timer = setTimeout(resolve, timeout);
            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timer);
                    resolve();
                }
            };
        });
    }

    // ── إعادة بناء اتصال المالك مع طالب ──
    async _rebuildOwnerPeer(sid, studentUid, localStream) {
        console.log(`[PeerManager] إعادة بناء peer مع ${sid}`);
        await this._closePeer(sid);
        await this.signaling.cleanupSignaling(sid);
        await new Promise(r => setTimeout(r, 500));
        await this.createOwnerPeerForStudent(sid, studentUid, localStream);
    }

    // ── تشغيل الصوت مع retry ──
    _playWithRetry(audioEl, maxTries = 5) {
        let tries = 0;
        const tryPlay = () => {
            audioEl.play().catch(() => {
                if (++tries < maxTries) setTimeout(tryPlay, 800);
            });
        };
        tryPlay();
    }

    // ── استبدال tracks في جميع peers (عند تبديل الكاميرا) ──
    async replaceTracksInAllPeers(newStream) {
        const replacePromises = [];
        for (const [sid, conn] of this._peers) {
            if (!conn.pc || conn.pc.signalingState === 'closed') continue;
            for (const track of newStream.getTracks()) {
                const sender = conn.pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                if (sender) {
                    replacePromises.push(sender.replaceTrack(track).catch(e => {
                        console.warn(`[PeerManager] replaceTrack فشل لـ ${sid}:`, e);
                    }));
                }
            }
        }
        await Promise.allSettled(replacePromises);
    }

    // ── إضافة track جديد لجميع peers ──
    addTrackToAllPeers(track, stream) {
        for (const [sid, conn] of this._peers) {
            if (!conn.pc || conn.pc.signalingState === 'closed') continue;
            try { conn.pc.addTrack(track, stream); } catch(e) {}
        }
    }

    // ── إغلاق peer واحد وتنظيفه ──
    async _closePeer(sid) {
        const conn = this._peers.get(sid);
        if (!conn) return;
        for (const unsub of conn.unsubscribers) {
            try { if (typeof unsub === 'function') unsub(); } catch(e) {}
        }
        try { if (conn.pc) conn.pc.close(); } catch(e) {}
        try { if (conn.audioEl) { conn.audioEl.srcObject = null; conn.audioEl.remove(); } } catch(e) {}
        this._peers.delete(sid);
        console.log(`[PeerManager] تم إغلاق peer ${sid}`);
    }

    // ── إغلاق جميع الـ peers ──
    async closeAll() {
        const sids = [...this._peers.keys()];
        for (const sid of sids) {
            await this._closePeer(sid);
        }
    }

    hasPeer(sid) {
        return this._peers.has(sid);
    }

    getPeer(sid) {
        return this._peers.get(sid);
    }

    getAllPeerIds() {
        return [...this._peers.keys()];
    }
}

// ═══════════════════════════════════════════════════════════════
// PresenceManager — يدير حضور المستخدمين في الغرفة
// ═══════════════════════════════════════════════════════════════
class PresenceManager {
    constructor(db, roomId, uid) {
        this.db = db;
        this.roomId = roomId;
        this.uid = uid;
        this._presenceRef = null;
        this._heartbeatInterval = null;
    }

    async join(userData) {
        const ref = this.db.ref(`rooms/${this.roomId}/presence/${this.uid}`);
        this._presenceRef = ref;
        await ref.set({
            ...userData,
            online: true,
            ts: Date.now(),
            lastSeen: Date.now(),
        });
        ref.onDisconnect().update({ online: false, lastSeen: Date.now() });

        // Heartbeat كل 30 ثانية
        this._heartbeatInterval = setInterval(async () => {
            try {
                await ref.update({ lastSeen: Date.now() });
            } catch(e) {}
        }, 30000);
    }

    async leave() {
        clearInterval(this._heartbeatInterval);
        if (this._presenceRef) {
            try {
                await this._presenceRef.update({ online: false, lastSeen: Date.now() });
            } catch(e) {}
        }
    }

    onPresenceChanged(callback) {
        const ref = this.db.ref(`rooms/${this.roomId}/presence`);
        ref.on('value', snap => callback(snap.val() || {}));
        return () => ref.off('value');
    }
}

// ═══════════════════════════════════════════════════════════════
// YadworRoomManager — المدير الرئيسي للغرفة
// الاستخدام: new YadworRoomManager(db, roomId, userInfo, isOwner)
// ═══════════════════════════════════════════════════════════════
class YadworRoomManager {
    constructor(db, roomId, userInfo, isOwner) {
        this.db = db;
        this.roomId = roomId;
        this.user = userInfo; // { uid, name, avatar, type, frame, badge }
        this.isOwner = isOwner;

        this.streamManager = new StreamManager();
        this.signaling = new FirebaseSignalingManager(db, roomId);
        this.peerManager = new PeerConnectionManager(this.signaling, this.streamManager);
        this.presence = new PresenceManager(db, roomId, userInfo.uid);

        this._myStudentId = null; // ID في /students (للطالب)
        this._myStudentRef = null;
        this._listeners = [];
        this._initialized = false;

        // Callbacks
        this.onOwnerStreamReady = null;    // (stream) — عندما يصل stream المالك للطالب
        this.onStudentJoined = null;       // (sid, data)
        this.onStudentLeft = null;         // (sid)
        this.onMicStateChanged = null;     // (uid, micOn)
        this.onChatMessage = null;         // (messageData)
        this.onRoomClosed = null;          // ()
        this.onError = null;               // (error)
    }

    // ═══════════════════════
    // دخول الغرفة
    // ═══════════════════════
    async enter() {
        if (this._initialized) return;
        this._initialized = true;

        console.log(`[YadworRoom] دخول الغرفة ${this.roomId} — isOwner: ${this.isOwner}`);

        // تسجيل الحضور في Firebase
        await this.presence.join({
            uid: this.user.uid,
            name: this.user.name,
            avatar: this.user.avatar || '',
            isOwner: this.isOwner,
        });

        if (this.isOwner) {
            await this._enterAsOwner();
        } else {
            await this._enterAsStudent();
        }

        // مراقبة إغلاق الغرفة
        this._listenRoomClosed();
    }

    // ═══════════════════════
    // دخول المالك (الأستاذ)
    // ═══════════════════════
    async _enterAsOwner() {
        // 1. طلب الكاميرا والمايك
        let localStream;
        try {
            localStream = await this.streamManager.getVideoAudioStream('user');
        } catch(e) {
            // محاولة بدون فيديو
            try {
                localStream = await this.streamManager.getAudioOnlyStream();
                console.warn('[YadworRoom] تعذّر فتح الكاميرا، بدء بالصوت فقط');
            } catch(e2) {
                if (this.onError) this.onError('تعذّر الوصول إلى الميكروفون: ' + e2.message);
                return;
            }
        }

        // 2. تحديث حالة المالك في Firebase
        await this.signaling.updateOwnerState({
            uid: this.user.uid,
            name: this.user.name,
            avatar: this.user.avatar || '',
            hasVideo: localStream.getVideoTracks().length > 0,
            hasAudio: localStream.getAudioTracks().length > 0,
            micOn: false,
            camOn: localStream.getVideoTracks().length > 0,
        });

        // 3. الاتصال بالطلاب الموجودين مسبقاً
        try {
            const snap = await this.db.ref(`rooms/${this.roomId}/students`).get();
            if (snap.exists()) {
                const students = snap.val();
                const promises = Object.entries(students).map(([sid, data]) =>
                    this.peerManager.createOwnerPeerForStudent(sid, data.uid || data.userId, localStream)
                );
                await Promise.allSettled(promises);
                console.log(`[YadworRoom] تم الاتصال بـ ${Object.keys(students).length} طالب موجود`);
            }
        } catch(e) {
            console.warn('[YadworRoom] خطأ في جلب الطلاب الموجودين:', e);
        }

        // 4. مستمع الطلاب الجدد
        const unsubAdded = this.signaling.onStudentAdded(async (sid, data) => {
            if (this.peerManager.hasPeer(sid)) {
                const peer = this.peerManager.getPeer(sid);
                const state = peer.pc.connectionState || peer.pc.iceConnectionState;
                if (state === 'connected' || state === 'completed') return;
            }
            console.log(`[YadworRoom] طالب جديد دخل: ${sid}`);
            // تأخير قصير لضمان أن الطالب بدأ مستمع الـ offer
            await new Promise(r => setTimeout(r, 300));
            await this.peerManager.createOwnerPeerForStudent(sid, data.uid || data.userId, localStream);
            if (this.onStudentJoined) this.onStudentJoined(sid, data);
        });
        this._listeners.push(unsubAdded);

        // 5. مستمع خروج الطلاب
        const unsubRemoved = this.signaling.onStudentRemoved(async (sid) => {
            await this.peerManager._closePeer(sid);
            await this.signaling.cleanupSignaling(sid);
            if (this.onStudentLeft) this.onStudentLeft(sid);
            console.log(`[YadworRoom] طالب غادر: ${sid}`);
        });
        this._listeners.push(unsubRemoved);

        // 6. مستمع طلبات إعادة الاتصال
        const unsubReconnect = this.signaling.onReconnectRequests(async (sid, data) => {
            await this.signaling.removeReconnectRequest(sid);
            const snap = await this.db.ref(`rooms/${this.roomId}/students/${sid}`).get();
            const studentData = snap.val() || {};
            if (this.peerManager.hasPeer(sid)) {
                await this.peerManager._closePeer(sid);
                await this.signaling.cleanupSignaling(sid);
                await new Promise(r => setTimeout(r, 200));
            }
            await this.peerManager.createOwnerPeerForStudent(sid, studentData.uid || studentData.userId, localStream);
            console.log(`[YadworRoom] إعادة اتصال مع ${sid}`);
        });
        this._listeners.push(unsubReconnect);
    }

    // ═══════════════════════════
    // دخول الطالب / المشاهد
    // ═══════════════════════════
    async _enterAsStudent() {
        // 1. طلب الميكروفون (الصوت فقط)
        let localStream;
        try {
            localStream = await this.streamManager.getAudioOnlyStream();
            localStream.getAudioTracks().forEach(t => { t.enabled = false; }); // مكتوم مبدئياً
        } catch(e) {
            console.warn('[YadworRoom] تعذّر الوصول للميكروفون:', e);
            localStream = new MediaStream(); // stream فارغ
        }

        // 2. التسجيل في /students — هذا يُعلم المالك بالدخول
        const sid = `st_${this.user.uid}_${Date.now()}`;
        this._myStudentId = sid;
        const studentRef = await this.signaling.registerStudent(sid, {
            uid: this.user.uid,
            userId: this.user.uid,
            name: this.user.name,
            avatar: this.user.avatar || '',
            frame: this.user.frame || '',
            badge: this.user.badge || '',
            mic: false,
        });
        this._myStudentRef = studentRef;

        // 3. الاستماع لـ offer من المالك — هذا هو القلب الصحيح للنظام
        // المالك سيُرسل offer بعد أن يلاحظ دخولنا في /students
        const unsubOffer = this.signaling.onOffer(sid, async (offerData) => {
            console.log(`[YadworRoom] ✅ وصل offer من المالك`);

            // إنشاء PeerConnection والرد على الـ offer
            const conn = await this.peerManager.createStudentPeerAndAnswer(
                sid,
                offerData,
                localStream,
                (track, remoteStream, streams) => {
                    // هذا يُستدعى عند وصول track من المالك
                    if (this.onOwnerStreamReady) {
                        this.onOwnerStreamReady(track, remoteStream);
                    }
                }
            );

            if (!conn) {
                // فشل الاتصال — طلب إعادة المحاولة
                console.warn('[YadworRoom] فشل إنشاء PC — طلب إعادة الاتصال');
                await this.signaling.requestReconnect(sid);
            }
        });
        this._listeners.push(unsubOffer);

        // 4. مراقبة حالة المالك (mic, cam, overlay)
        const unsubOwnerState = this.signaling.onOwnerState((state) => {
            // يمكن استخدام هذا لتحديث UI
        });
        this._listeners.push(unsubOwnerState);

        // 5. مراقبة انقطاع الاتصال وإعادة الاتصال
        this._setupStudentReconnect(sid, localStream);
    }

    // ── مراقبة إعادة الاتصال للطالب ──
    _setupStudentReconnect(sid, localStream) {
        let isPageVisible = !document.hidden;

        document.addEventListener('visibilitychange', async () => {
            const wasHidden = !isPageVisible;
            isPageVisible = !document.hidden;

            if (isPageVisible && wasHidden) {
                // العودة من الخلفية — تحقق من حالة الاتصال
                const peer = this.peerManager.getPeer(sid);
                if (peer) {
                    const state = peer.pc.connectionState || peer.pc.iceConnectionState;
                    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                        console.log('[YadworRoom] إعادة اتصال بعد العودة من الخلفية');
                        await this.signaling.requestReconnect(sid);
                    }
                }
            }
        });

        // مراقبة تغيير الشبكة
        window.addEventListener('online', async () => {
            console.log('[YadworRoom] استعادة الشبكة — إعادة الاتصال');
            await this.signaling.requestReconnect(sid);
        });
    }

    // ═══════════════════
    // مراقبة إغلاق الغرفة
    // ═══════════════════
    _listenRoomClosed() {
        const ref = this.db.ref(`rooms/${this.roomId}/closed`);
        ref.on('value', snap => {
            if (snap.val() === true) {
                if (this.onRoomClosed) this.onRoomClosed();
            }
        });
    }

    // ═══════════════════
    // تبديل الكاميرا (للمالك)
    // ═══════════════════
    async switchCamera(facingMode) {
        if (!this.isOwner) return;
        const localStream = this.streamManager.localStream;
        if (!localStream) return;

        try {
            const newTrack = await this.streamManager.switchCamera(
                facingMode,
                this.peerManager._peers
            );
            // تحديث حالة المالك في Firebase
            await this.signaling.updateOwnerState({ camOn: true });
            return newTrack;
        } catch(e) {
            if (this.onError) this.onError('تعذّر تبديل الكاميرا: ' + e.message);
            throw e;
        }
    }

    // ═══════════════════
    // تفعيل/إيقاف الميكروفون
    // ═══════════════════
    async setMicOn(enabled) {
        this.streamManager.setAudioEnabled(enabled);
        // تحديث حالة في Firebase
        if (this.isOwner) {
            await this.signaling.updateOwnerState({ micOn: enabled });
        } else if (this._myStudentRef) {
            await this._myStudentRef.update({ mic: enabled });
        }
    }

    // ═══════════════════
    // تفعيل/إيقاف الكاميرا (للمالك)
    // ═══════════════════
    async setCamOn(enabled) {
        this.streamManager.setVideoEnabled(enabled);
        await this.signaling.updateOwnerState({ camOn: enabled });
    }

    // ═══════════════════
    // إرسال رسالة دردشة
    // ═══════════════════
    async sendChat(text, accountType) {
        if (!text || text.length > 90) return;
        const data = {
            uid: this.user.uid,
            name: this.user.name,
            avatar: this.user.avatar || '',
            text,
            ts: Date.now(),
            isOwner: this.isOwner,
        };
        if (accountType) data.accountType = accountType;
        await this.db.ref(`rooms/${this.roomId}/chat`).push(data);
    }

    // ═══════════════════
    // الخروج من الغرفة
    // ═══════════════════
    async leave() {
        console.log('[YadworRoom] مغادرة الغرفة...');

        // إيقاف جميع المستمعين
        for (const unsub of this._listeners) {
            try { if (typeof unsub === 'function') unsub(); } catch(e) {}
        }
        this._listeners = [];
        this.signaling.detachAll();

        // إغلاق جميع الاتصالات
        await this.peerManager.closeAll();

        // إيقاف الـ streams
        this.streamManager.stopAll();

        // إزالة تسجيل الطالب
        if (!this.isOwner && this._myStudentId) {
            await this.signaling.removeStudent(this._myStudentId);
            await this.signaling.cleanupSignaling(this._myStudentId);
        }

        // إغلاق الغرفة إذا كان المالك
        if (this.isOwner) {
            await this.db.ref(`rooms/${this.roomId}`).update({
                closed: true,
                closedAt: Date.now(),
            });
        }

        // تحديث الحضور
        await this.presence.leave();

        this._initialized = false;
        console.log('[YadworRoom] تم مغادرة الغرفة بنجاح');
    }

    // ── معلومات ──
    get myStudentId() { return this._myStudentId; }
    get localStream() { return this.streamManager.localStream; }
}

// ═══════════════════════════════════════════════
// UserStateManager — بديل localStorage
// يخزن بيانات المستخدم في Firebase ويجلبها منه
// ═══════════════════════════════════════════════
class UserStateManager {
    constructor(db) {
        this.db = db;
        this._cache = null;
    }

    // ── جلب بيانات المستخدم من Firebase ──
    async getCurrentUser(uid) {
        if (this._cache && this._cache.uid === uid) return this._cache;
        if (!uid) return this._getGuestUser();

        try {
            const snap = await this.db.ref('users/' + uid).get();
            const data = snap.val() || {};
            this._cache = {
                uid,
                name: data.name || data.yourname || data.displayName || 'مستخدم',
                avatar: data.avatar || data.avatarUrl || '',
                type: data.accountType || data.profileType || 'user',
                frame: data.activeFrameUrl || '',
                badge: data.badge || '',
                points: data.points || 0,
                coins: data.coins || 0,
            };
            return this._cache;
        } catch(e) {
            console.warn('[UserStateManager] فشل جلب المستخدم من Firebase:', e);
            return this._getGuestUser();
        }
    }

    // ── جلب roomId من URL params أو Firebase session ──
    static getRoomIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('roomId') || params.get('room') || null;
    }

    // ── جلب uid من URL params ──
    static getUidFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return params.get('uid') || null;
    }

    _getGuestUser() {
        return {
            uid: 'guest_' + Date.now(),
            name: 'ضيف',
            avatar: '',
            type: 'user',
            frame: '',
            badge: '',
            points: 0,
            coins: 0,
        };
    }

    // ── قراءة uid من localStorage (للتوافق مع الكود الحالي) ──
    static getUidFromLocalStorage() {
        try { return localStorage.getItem('yadwor-uid') || ''; } catch { return ''; }
    }
}

// ═════════════════════════════════
// RoomNavigator — بدل localStorage
// ينقل بيانات الغرفة عبر URL params
// ═════════════════════════════════
class RoomNavigator {
    // ── الانتقال لغرفة ──
    static navigateToRoom(roomId, isOwner, uid) {
        const params = new URLSearchParams({
            roomId,
            uid,
            isOwner: isOwner ? '1' : '0',
        });
        window.location.href = 'roomvideo.html?' + params.toString();
    }

    // ── قراءة بيانات الغرفة من URL ──
    static getRoomParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            roomId: params.get('roomId') || '',
            uid: params.get('uid') || '',
            isOwner: params.get('isOwner') === '1',
        };
    }

    // ── التحقق من وجود بيانات صالحة ──
    static hasValidParams() {
        const { roomId, uid } = RoomNavigator.getRoomParams();
        return !!(roomId && uid);
    }

    // ── قراءة من localStorage كـ fallback للتوافق مع الكود القديم ──
    static getRoomIdFallback() {
        // أولاً: URL params
        const fromUrl = RoomNavigator.getRoomParams().roomId;
        if (fromUrl) return fromUrl;

        // ثانياً: localStorage (للتوافق)
        try {
            const rt = JSON.parse(localStorage.getItem('yw_room_target') || 'null');
            if (rt && rt.roomId) return rt.roomId;
        } catch {}
        try {
            const rt = JSON.parse(sessionStorage.getItem('yw_room_target') || 'null');
            if (rt && rt.roomId) return rt.roomId;
        } catch {}

        return '';
    }

    static getOwnerFallback() {
        // URL params أولاً
        const { isOwner } = RoomNavigator.getRoomParams();
        // localStorage كـ fallback
        try {
            const active = JSON.parse(localStorage.getItem('yw_active_room') || 'null');
            if (active && typeof active.isOwner === 'boolean') return active.isOwner;
        } catch {}
        return isOwner;
    }
}

// تصدير للاستخدام
window.YadworRoomManager = YadworRoomManager;
window.UserStateManager = UserStateManager;
window.RoomNavigator = RoomNavigator;
window.FirebaseSignalingManager = FirebaseSignalingManager;
window.StreamManager = StreamManager;
window.PeerConnectionManager = PeerConnectionManager;
window.PresenceManager = PresenceManager;
