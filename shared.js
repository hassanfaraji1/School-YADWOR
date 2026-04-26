// ============================================================
// YADWOR – shared.js  (نسخة نظيفة كاملة)
// ============================================================

// =================== ثوابت Firebase / Cloudinary ===================
const FB_DB_URL  = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
const FB_API_KEY = 'AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA';
const CLD_NAME   = 'dlujoziwz';
const CLD_PRESET = 'my_app_upload';

// ============================================================
// دوال المطابقة المنطقية بين الأستاذ والتلميذ والتمارين
// ============================================================

function isStudentMatchingTeacher(student, teacher) {
  if (!student || !teacher) return false;
  const studentInst = (student.institutionUid || student.institutionId || '').trim();
  const teacherInst = (teacher.institutionUid  || teacher.institutionId  || '').trim();
  if (!studentInst || !teacherInst || studentInst !== teacherInst) return false;
  const studentLevel = (student.levelId || '').trim();
  const teacherLevel = (teacher.levelId  || '').trim();
  if (!studentLevel || !teacherLevel || studentLevel !== teacherLevel) return false;
  const studentSubjects = (student.subjects || []).map(s => (s.name || s).trim());
  let teacherSubject = (teacher.subject || '').trim();
  if (!teacherSubject && teacher.subjects && teacher.subjects.length) {
    teacherSubject = (teacher.subjects[0].name || teacher.subjects[0] || '').trim();
  }
  if (!teacherSubject) return false;
  return studentSubjects.includes(teacherSubject);
}

function canStudentSeeExercise(student, exercise) {
  if (!student || !exercise) return false;
  const studentInst = (student.institutionUid || student.institutionId || '').trim();
  const examInst    = (exercise.institutionUid || exercise.institutionId || '').trim();
  if (!examInst || !studentInst || studentInst !== examInst) return false;
  const studentLevel = (student.levelId  || '').trim();
  const examLevel    = (exercise.levelId || '').trim();
  if (!examLevel || !studentLevel || studentLevel !== examLevel) return false;
  const studentSubjects = (student.subjects || []).map(s => (s.name || s).trim());
  const examSubject     = (exercise.subject  || '').trim();
  if (!examSubject) return false;
  return studentSubjects.includes(examSubject);
}

// ============================================================
// جلب بيانات المستخدم الحالي كاملةً من Firebase
// ============================================================
async function fetchMyUserDataFromFirebase() {
  const uid = localStorage.getItem('yadwor-uid') || '';
  if (!uid) return null;
  try {
    const res = await fetch(`${FB_DB_URL}/users/${uid}.json?auth=${FB_API_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data || null;
  } catch(e) { return null; }
}

async function fetchMyAcceptedJoinRequestFromFirebase() {
  const uid = localStorage.getItem('yadwor-uid') || '';
  if (!uid) return null;
  try {
    const res = await fetch(`${FB_DB_URL}/joinRequests.json?auth=${FB_API_KEY}`);
    if (!res.ok) return null;
    const allInstitutions = await res.json();
    if (!allInstitutions) return null;
    for (const instUid of Object.keys(allInstitutions)) {
      const instReqs = allInstitutions[instUid];
      if (!instReqs) continue;
      const found = Object.values(instReqs).find(r =>
        r && r.status === 'accepted' && (r.uid === uid || r.userId === uid)
      );
      if (found) return found;
    }
    return null;
  } catch(e) { return null; }
}

// ============================================================
// STATE (بيانات التطبيق في الذاكرة)
// ============================================================
let state = {
  posts:         [],
  myUid:         localStorage.getItem('yadwor-uid') || '',
  myName:        localStorage.getItem('yadwor-settings-name') || localStorage.getItem('yadwor-user-name') || '',
  myAvatar:      localStorage.getItem('yadwor-avatar-preview') || '',
  myType:        localStorage.getItem('yadwor-account-type') || localStorage.getItem('yadwor-profile-type') || '',
  composerMode:  'post',
  draftImages:   [],
  draftImageFiles: [],
  draftVideo:    '',
  draftVideoFile: null,
  joinRequests:  [],
  _fbLastPostKey: null,
  _allLoaded:    false,
  _loading:      false
};

// تحميل المنشورات من localStorage
try {
  const saved = localStorage.getItem('yadwor-posts');
  if (saved) state.posts = JSON.parse(saved);
} catch(e) { state.posts = []; }

function saveData() {
  try { localStorage.setItem('yadwor-posts', JSON.stringify(state.posts)); } catch(e) {}
}

// ============================================================
// Toast
// ============================================================
function showToast(msg, dur) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur || 2500);
}

// ============================================================
// وقت نسبي
// ============================================================
function formatTimeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'الآن';
  if (m < 60) return `منذ ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} س`;
  const d = Math.floor(h / 24);
  if (d < 30) return `منذ ${d} يوم`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `منذ ${mo} شهر`;
  return `منذ ${Math.floor(mo / 12)} سنة`;
}

// ============================================================
// Shimmer للمنشورات
// ============================================================
function shimmerPostCard() {
  return `<div class="mb-4 rounded-[20px] border border-zinc-200 bg-white p-4 shadow-sm">
    <div class="flex items-center gap-2 mb-4">
      <div class="shimmer h-10 w-10 rounded-full shrink-0"></div>
      <div class="flex-1 space-y-2">
        <div class="shimmer h-3.5 w-1/3 rounded-full"></div>
        <div class="shimmer h-3 w-1/4 rounded-full"></div>
      </div>
    </div>
    <div class="shimmer h-40 w-full rounded-[14px] mb-4"></div>
    <div class="space-y-2">
      <div class="shimmer h-3 w-3/4 rounded-full"></div>
      <div class="shimmer h-3 w-1/2 rounded-full"></div>
    </div>
  </div>`;
}

// ============================================================
// Cloudinary رفع الصور والفيديو
// ============================================================
async function uploadImageToCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLD_NAME}/image/upload`, { method: 'POST', body: fd });
  const data = await res.json();
  return data.secure_url || '';
}

async function uploadVideoToCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLD_NAME}/video/upload`, { method: 'POST', body: fd });
  const data = await res.json();
  return { url: data.secure_url || '', thumbnail: data.secure_url ? data.secure_url.replace('/upload/', '/upload/so_0/').replace(/\.[^.]+$/, '.jpg') : '' };
}

// ============================================================
// Firebase – منشورات
// ============================================================
async function syncPostsFromFirebase() {
  try {
    const res = await fetch(`${FB_DB_URL}/posts.json?auth=${FB_API_KEY}&orderBy="$key"&limitToLast=30`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data) return;
    const fbPosts = Object.entries(data).map(([id, p]) => ({ ...p, id })).reverse();
    // دمج مع المحلية (المنشورات المملوكة للمستخدم الحالي)
    const myUid = state.myUid;
    const localOwned = state.posts.filter(p => p.uid === myUid && !fbPosts.find(f => f.id === p.id));
    state.posts = [...fbPosts, ...localOwned].sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    saveData();
  } catch(e) {}
}

async function savePostToFirebase(post) {
  try {
    await fetch(`${FB_DB_URL}/posts/${post.id}.json?auth=${FB_API_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post)
    });
  } catch(e) {}
}

async function deletePostFromFirebase(postId) {
  try {
    await fetch(`${FB_DB_URL}/posts/${postId}.json?auth=${FB_API_KEY}`, { method: 'DELETE' });
  } catch(e) {}
}

async function updatePostInFirebase(postId, updates) {
  try {
    await fetch(`${FB_DB_URL}/posts/${postId}.json?auth=${FB_API_KEY}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch(e) {}
}

// ============================================================
// Firebase – تعليقات
// ============================================================
async function fetchCommentsFromFirebase(postId) {
  try {
    const res = await fetch(`${FB_DB_URL}/comments/${postId}.json?auth=${FB_API_KEY}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data) return [];
    return Object.entries(data).map(([id, c]) => ({ ...c, id })).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  } catch(e) { return []; }
}

async function saveCommentToFirebase(postId, comment) {
  try {
    await fetch(`${FB_DB_URL}/comments/${postId}/${comment.id}.json?auth=${FB_API_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(comment)
    });
  } catch(e) {}
}

// ============================================================
// Firebase – إشعارات التفاعل (لايك / تعليق / رد)
// يُستدعى عند وضع لايك أو تعليق أو رد
// ============================================================
async function saveInteractionNotif(targetUid, notifObj) {
  if (!targetUid || !notifObj) return;
  // لا ترسل إشعاراً لنفسك
  const myUid = localStorage.getItem('yadwor-uid') || '';
  if (targetUid === myUid) return;
  try {
    const id = 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await fetch(`${FB_DB_URL}/interactions/${targetUid}/${id}.json?auth=${FB_API_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...notifObj, id, publishedAt: Date.now() })
    });
  } catch(e) {}
}

// ============================================================
// renderPostCard — بطاقة المنشور الرئيسية
// ============================================================
function renderPostCard(p) {
  if (!p) return '';
  const myUid    = state.myUid;
  const isOwner  = p.uid === myUid;
  const liked    = (p.likedBy || {})[myUid];
  const saved    = (p.savedBy || {})[myUid];
  const likesArr = Object.keys(p.likedBy || {});
  const commCount= p.commentCount || 0;
  const viewCount= p.viewCount || 0;

  const typeLabel = p.accountType === 'institution' ? 'مؤسسة تعليمية'
                  : p.accountType === 'teacher'     ? 'أستاذ'
                  : p.accountType === 'student'     ? 'تلميذ'
                  : '';

  // صور متعددة
  let mediaHtml = '';
  if (p.type === 'reel' && p.video) {
    mediaHtml = `<div class="relative mt-3 overflow-hidden rounded-[16px] bg-black" style="max-height:480px;">
      <video src="${p.video}" ${p.thumbnail ? `poster="${p.thumbnail}"` : ''} controls playsinline preload="metadata" class="w-full object-contain" style="max-height:480px;"></video>
    </div>`;
  } else if (p.images && p.images.length) {
    if (p.images.length === 1) {
      mediaHtml = `<div class="mt-3 overflow-hidden rounded-[16px] cursor-pointer" onclick="openImageViewer(${JSON.stringify(p.images)},0)">
        <img src="${p.images[0]}" class="w-full object-cover rounded-[16px]" style="max-height:420px;" loading="lazy" />
      </div>`;
    } else {
      const cols = p.images.length === 2 ? 'grid-cols-2' : 'grid-cols-2';
      mediaHtml = `<div class="mt-3 grid ${cols} gap-1.5 rounded-[16px] overflow-hidden">
        ${p.images.slice(0,4).map((img, i) => `
          <div class="relative overflow-hidden rounded-[10px] cursor-pointer ${p.images.length === 3 && i === 0 ? 'col-span-2' : ''}" onclick="openImageViewer(${JSON.stringify(p.images)},${i})" style="padding-top:${p.images.length === 3 && i === 0 ? '55' : '75'}%;">
            <img src="${img}" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            ${p.images.length > 4 && i === 3 ? `<div class="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[22px] font-extrabold">+${p.images.length - 4}</div>` : ''}
          </div>`).join('')}
      </div>`;
    }
  }

  return `
  <div class="mb-4 rounded-[20px] border border-zinc-200 bg-white shadow-sm overflow-hidden" id="post-${p.id}">
    <div class="p-4">
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2.5 cursor-pointer" onclick="window.location.href='profile.html?uid=${p.uid}'">
          <div class="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-200">
            ${p.avatar ? `<img src="${p.avatar}" class="h-10 w-10 object-cover" loading="lazy" onerror="this.style.display='none'"/>` : `<div class="h-10 w-10 flex items-center justify-center text-zinc-400"><svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" stroke-width="1.8"><path d="M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/></svg></div>`}
          </div>
          <div>
            <p class="text-[14px] font-extrabold text-zinc-900">${p.name || 'مجهول'}</p>
            <p class="text-[11px] text-zinc-400">${typeLabel ? typeLabel + ' · ' : ''}${formatTimeAgo(p.publishedAt)}</p>
          </div>
        </div>
        ${isOwner ? `<button onclick="openPostMenu('${p.id}')" class="flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-100 text-zinc-400">
          <svg viewBox="0 0 24 24" class="h-4 w-4 fill-current"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
        </button>` : ''}
      </div>
      ${p.text ? `<p class="mt-3 text-[14px] leading-relaxed text-zinc-800 whitespace-pre-wrap">${p.text}</p>` : ''}
      ${mediaHtml}
    </div>
    <div class="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5">
      <div class="flex items-center gap-3">
        <button onclick="toggleLike('${p.id}')" class="flex items-center gap-1.5 text-[13px] font-bold ${liked ? 'text-rose-500' : 'text-zinc-500'} hover:text-rose-400">
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          ${likesArr.length || 0}
        </button>
        <button onclick="openComments('${p.id}')" class="flex items-center gap-1.5 text-[13px] font-bold text-zinc-500 hover:text-zinc-700">
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] fill-none stroke-current" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${commCount}
        </button>
        <span class="flex items-center gap-1.5 text-[13px] font-bold text-zinc-400">
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] fill-none stroke-current" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          ${viewCount}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="sharePost('${p.id}')" class="flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-100 text-zinc-400">
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px] fill-none stroke-current" stroke-width="2" stroke-linecap="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </button>
        <button onclick="toggleSave('${p.id}')" class="flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-100 ${saved ? 'text-zinc-900' : 'text-zinc-400'}">
          <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

// ============================================================
// تفاعلات المنشور (لايك / حفظ / مشاركة)
// ============================================================
async function toggleLike(postId) {
  const myUid = state.myUid;
  if (!myUid) { showToast('سجّل دخولك أولاً'); return; }
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;
  if (!post.likedBy) post.likedBy = {};
  const wasLiked = !!post.likedBy[myUid];
  if (wasLiked) { delete post.likedBy[myUid]; }
  else          { post.likedBy[myUid] = true; }
  saveData();
  if (typeof renderHome === 'function') renderHome();
  // تحديث Firebase
  try {
    await fetch(`${FB_DB_URL}/posts/${postId}/likedBy/${myUid}.json?auth=${FB_API_KEY}`, {
      method: wasLiked ? 'DELETE' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: wasLiked ? undefined : 'true'
    });
  } catch(e) {}
  // إشعار صاحب المنشور
  if (!wasLiked && post.uid && post.uid !== myUid) {
    const myName = state.myName || localStorage.getItem('yadwor-settings-name') || 'شخص';
    await saveInteractionNotif(post.uid, {
      type:     'like',
      fromUid:  myUid,
      fromName: myName,
      postId:   postId,
      text:     myName + ' أعجب بمنشورك'
    });
  }
}

async function toggleSave(postId) {
  const myUid = state.myUid;
  if (!myUid) { showToast('سجّل دخولك أولاً'); return; }
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;
  if (!post.savedBy) post.savedBy = {};
  const wasSaved = !!post.savedBy[myUid];
  if (wasSaved) { delete post.savedBy[myUid]; } else { post.savedBy[myUid] = true; }
  saveData();
  if (typeof renderHome === 'function') renderHome();
  try {
    await fetch(`${FB_DB_URL}/posts/${postId}/savedBy/${myUid}.json?auth=${FB_API_KEY}`, {
      method: wasSaved ? 'DELETE' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: wasSaved ? undefined : 'true'
    });
  } catch(e) {}
}

function sharePost(postId) {
  const url = window.location.origin + '/home.html?post=' + postId;
  if (navigator.share) { navigator.share({ url }).catch(() => {}); }
  else { navigator.clipboard.writeText(url).then(() => showToast('تم نسخ الرابط')).catch(() => {}); }
}

// ============================================================
// فتح قائمة المنشور (تعديل / حذف)
// ============================================================
let _menuPostId = null;
function openPostMenu(postId) {
  _menuPostId = postId;
  const existing = document.getElementById('_post-menu-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = '_post-menu-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(0,0,0,0.4);display:flex;align-items:flex-end;justify-content:center;padding:0;font-family:Tajawal,sans-serif;direction:rtl;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:12px 0 28px;" onclick="event.stopPropagation()">
      <div style="width:36px;height:4px;background:#e4e4e7;border-radius:4px;margin:0 auto 14px;"></div>
      <button onclick="openEditModal('${postId}')" style="display:flex;align-items:center;gap:14px;width:100%;padding:14px 20px;background:none;border:none;font-family:Tajawal,sans-serif;font-size:15px;font-weight:700;color:#18181b;cursor:pointer;">
        <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:#18181b;stroke-width:2;stroke-linecap:round;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        تعديل المنشور
      </button>
      <button onclick="openDeleteModal('${postId}')" style="display:flex;align-items:center;gap:14px;width:100%;padding:14px 20px;background:none;border:none;font-family:Tajawal,sans-serif;font-size:15px;font-weight:700;color:#e53935;cursor:pointer;">
        <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:none;stroke:#e53935;stroke-width:2;stroke-linecap:round;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        حذف المنشور
      </button>
    </div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

function openEditModal(postId) {
  const overlay = document.getElementById('_post-menu-overlay');
  if (overlay) overlay.remove();
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;
  const modal = document.getElementById('edit-modal');
  const textarea = document.getElementById('edit-text');
  if (!modal || !textarea) return;
  textarea.value = post.text || '';
  _menuPostId = postId;
  modal.classList.remove('hidden');
}
function closeEditModal() { document.getElementById('edit-modal')?.classList.add('hidden'); }
async function saveEdit() {
  const postId = _menuPostId;
  const newText = document.getElementById('edit-text')?.value.trim() || '';
  const post = state.posts.find(p => p.id === postId);
  if (!post) return;
  if ((post.editCount || 0) >= 2) { showToast('لا يمكن التعديل أكثر من مرتين'); return; }
  post.text = newText;
  post.editCount = (post.editCount || 0) + 1;
  saveData();
  closeEditModal();
  if (typeof renderHome === 'function') renderHome();
  await updatePostInFirebase(postId, { text: newText, editCount: post.editCount });
  showToast('تم حفظ التعديل');
}

function openDeleteModal(postId) {
  const overlay = document.getElementById('_post-menu-overlay');
  if (overlay) overlay.remove();
  _menuPostId = postId;
  document.getElementById('delete-modal')?.classList.remove('hidden');
}
function closeDeleteModal() { document.getElementById('delete-modal')?.classList.add('hidden'); }
async function confirmDelete() {
  const postId = _menuPostId;
  state.posts = state.posts.filter(p => p.id !== postId);
  saveData();
  closeDeleteModal();
  if (typeof renderHome === 'function') renderHome();
  await deletePostFromFirebase(postId);
  showToast('تم حذف المنشور');
}

// ============================================================
// Image viewer
// ============================================================
let _ivImages = [], _ivIdx = 0;
function openImageViewer(imgs, idx) {
  _ivImages = imgs; _ivIdx = idx || 0;
  const viewer = document.getElementById('image-viewer');
  if (!viewer) return;
  viewer.classList.remove('hidden');
  _updateViewer();
}
function closeImageViewer() { document.getElementById('image-viewer')?.classList.add('hidden'); }
function _updateViewer() {
  document.getElementById('image-viewer-img').src = _ivImages[_ivIdx];
  document.getElementById('image-viewer-counter').textContent = (_ivIdx + 1) + ' / ' + _ivImages.length;
}
function prevImage() { _ivIdx = (_ivIdx - 1 + _ivImages.length) % _ivImages.length; _updateViewer(); }
function nextImage() { _ivIdx = (_ivIdx + 1) % _ivImages.length; _updateViewer(); }

// ============================================================
// Comments modal
// ============================================================
let _openPostId = null;
async function openComments(postId) {
  _openPostId = postId;
  const modal = document.getElementById('comments-modal');
  const authorEl = document.getElementById('comments-post-author');
  const listEl = document.getElementById('comments-list');
  if (!modal) return;
  const post = state.posts.find(p => p.id === postId);
  if (authorEl) authorEl.textContent = 'منشور ' + (post?.name || '');
  if (listEl) listEl.innerHTML = '<div class="shimmer h-10 w-full rounded-[10px]"></div>';
  modal.classList.remove('hidden');
  // تحديث عداد المشاهدات
  if (post) {
    post.viewCount = (post.viewCount || 0) + 1;
    saveData();
    updatePostInFirebase(postId, { viewCount: post.viewCount });
  }
  const comments = await fetchCommentsFromFirebase(postId);
  if (!listEl) return;
  if (!comments.length) { listEl.innerHTML = '<p class="text-center text-zinc-400 text-[13px] py-8">لا توجد تعليقات بعد</p>'; return; }
  listEl.innerHTML = comments.map(c => `
    <div class="flex items-start gap-2.5 py-2">
      <div class="h-8 w-8 shrink-0 rounded-full overflow-hidden bg-zinc-200">
        ${c.avatar ? `<img src="${c.avatar}" class="h-8 w-8 object-cover" loading="lazy"/>` : '<div class="h-8 w-8 flex items-center justify-center text-zinc-400 text-xs">👤</div>'}
      </div>
      <div class="flex-1 rounded-[14px] bg-white border border-zinc-100 px-3 py-2">
        <p class="text-[13px] font-bold text-zinc-900">${c.name || 'مجهول'}</p>
        <p class="text-[13px] text-zinc-700 mt-0.5">${c.text || ''}</p>
        <p class="text-[11px] text-zinc-400 mt-1">${formatTimeAgo(c.ts)}</p>
      </div>
    </div>`).join('');
}

function closeCommentsModal() { document.getElementById('comments-modal')?.classList.add('hidden'); _openPostId = null; }

async function submitComment() {
  const myUid = state.myUid;
  if (!myUid) { showToast('سجّل دخولك أولاً'); return; }
  const inp = document.getElementById('comment-input');
  const text = inp?.value.trim();
  if (!text || !_openPostId) return;
  inp.value = '';
  const comment = {
    id:        'c_' + Date.now(),
    uid:       myUid,
    name:      state.myName || 'مجهول',
    avatar:    state.myAvatar || '',
    text:      text,
    ts:        Date.now()
  };
  await saveCommentToFirebase(_openPostId, comment);
  // تحديث عداد التعليقات
  const post = state.posts.find(p => p.id === _openPostId);
  if (post) {
    post.commentCount = (post.commentCount || 0) + 1;
    saveData();
    updatePostInFirebase(_openPostId, { commentCount: post.commentCount });
  }
  // إشعار صاحب المنشور
  if (post && post.uid && post.uid !== myUid) {
    const myName = state.myName || 'شخص';
    await saveInteractionNotif(post.uid, {
      type:     'comment',
      fromUid:  myUid,
      fromName: myName,
      postId:   _openPostId,
      text:     myName + ' علّق على منشورك'
    });
  }
  openComments(_openPostId);
}

// ============================================================
// Sidebar
// ============================================================
function openSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('-translate-x-full');
}
function closeSidebar() {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.add('-translate-x-full');
}

// ============================================================
// Composer modes
// ============================================================
function setComposerMode(mode) {
  state.composerMode = mode;
  document.getElementById('post-composer-area').style.display  = mode === 'post'  ? '' : 'none';
  document.getElementById('reel-composer-area').style.display  = mode === 'reel'  ? '' : 'none';
  document.getElementById('composer-post-btn').className = 'rounded-[12px] px-4 py-3 text-[13px] font-bold ' + (mode === 'post' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700');
  document.getElementById('composer-reel-btn').className = 'rounded-[12px] px-4 py-3 text-[13px] font-bold ' + (mode === 'reel' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700');
}

function handleDraftImages(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  state.draftImageFiles = files;
  state.draftImages = [];
  const preview = document.getElementById('draft-images-preview');
  if (preview) preview.innerHTML = '';
  files.forEach((file, i) => {
    const reader = new FileReader();
    reader.onload = e => {
      state.draftImages[i] = e.target.result;
      if (preview) {
        const div = document.createElement('div');
        div.style.cssText = 'position:relative;padding-top:75%;border-radius:10px;overflow:hidden;';
        div.innerHTML = `<img src="${e.target.result}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">`;
        preview.appendChild(div);
      }
    };
    reader.readAsDataURL(file);
  });
}

function handleDraftVideo(input) {
  const file = input.files?.[0];
  if (!file) return;
  state.draftVideoFile = file;
  state.draftVideo = URL.createObjectURL(file);
  const preview = document.getElementById('draft-video-preview');
  if (preview) preview.innerHTML = `<video src="${state.draftVideo}" controls playsinline preload="metadata" class="max-h-[280px] w-full object-contain"></video>`;
}

// ============================================================
// BELL BADGE — Firebase Realtime Listener
// ============================================================

// آخر وقت قراءة — يُجلب من Firebase
let _bellLastReadTs = 0;

// جلب آخر وقت قراءة من Firebase عند التشغيل
(async function _initBellLastRead() {
  const uid = localStorage.getItem('yadwor-uid') || '';
  if (!uid) return;
  try {
    const res = await fetch(`${FB_DB_URL}/userMeta/${uid}/notifLastRead.json?auth=${FB_API_KEY}`);
    if (res.ok) {
      const val = await res.json();
      if (val && typeof val === 'number') _bellLastReadTs = val;
    }
  } catch(e) {}
  // أرسل بيانات المستخدم للـ Service Worker
  _sendInitToSW();
})();

// إرسال بيانات المستخدم للـ SW
function _sendInitToSW() {
  if (!('serviceWorker' in navigator)) return;
  const uid  = localStorage.getItem('yadwor-uid') || '';
  const type = localStorage.getItem('yadwor-account-type') || localStorage.getItem('yadwor-profile-type') || '';
  if (!uid) return;
  navigator.serviceWorker.ready.then(function(reg) {
    if (reg.active) {
      reg.active.postMessage({
        type:     'INIT_SW',
        uid:      uid,
        userType: type,
        lastRead: _bellLastReadTs
      });
    }
  }).catch(function() {});
}

// حساب عدد الإشعارات غير المقروءة وتحديث الـ badge
async function _computeAndUpdateBadge() {
  const badgeEl = document.getElementById('notif-badge');
  if (!badgeEl) return;

  const myUid  = localStorage.getItem('yadwor-uid') || '';
  const myType = localStorage.getItem('yadwor-account-type') || localStorage.getItem('yadwor-profile-type') || '';
  if (!myUid) { badgeEl.style.display = 'none'; return; }

  const lastRead = _bellLastReadTs;

  try {
    // إشعارات التمارين
    let examUnread = 0;
    const resN = await fetch(`${FB_DB_URL}/notifications.json?auth=${FB_API_KEY}`);
    if (resN.ok) {
      const dataN = await resN.json();
      if (dataN && typeof dataN === 'object') {
        const examList = Object.values(dataN).filter(n => n && n.type === 'exam');
        if (myType === 'teacher') {
          examUnread = 0;
        } else if (myType === 'institution') {
          examUnread = examList.filter(n => (n.institutionUid || '') === myUid && (n.publishedAt || 0) > lastRead).length;
        } else if (myType === 'student') {
          let myReq = null;
          try {
            const resAll = await fetch(`${FB_DB_URL}/joinRequests.json?auth=${FB_API_KEY}`);
            if (resAll.ok) {
              const allInst = await resAll.json();
              if (allInst) {
                for (const instUid of Object.keys(allInst)) {
                  const found = Object.values(allInst[instUid] || {}).find(r =>
                    r && r.status === 'accepted' && (r.uid === myUid || r.userId === myUid)
                  );
                  if (found) { myReq = found; break; }
                }
              }
            }
          } catch(e) {}
          if (myReq) {
            const mySubs = (myReq.subjects || []).map(s => (s.name || s).trim());
            examUnread = examList.filter(n => {
              if ((n.publishedAt || 0) <= lastRead) return false;
              const sameInst  = (myReq.institutionUid || myReq.institutionId || '') === (n.institutionUid || '');
              const sameLevel = myReq.levelId === n.levelId;
              const sameSub   = mySubs.includes((n.subject || '').trim());
              return sameInst && sameLevel && sameSub;
            }).length;
          }
        }
      }
    }

    // إشعارات التفاعلات (لايك + تعليق + رد)
    let interactionUnread = 0;
    try {
      const resI = await fetch(`${FB_DB_URL}/interactions/${myUid}.json?auth=${FB_API_KEY}`);
      if (resI.ok) {
        const dataI = await resI.json();
        if (dataI && typeof dataI === 'object') {
          interactionUnread = Object.values(dataI).filter(n =>
            n && (n.type === 'like' || n.type === 'comment' || n.type === 'reply') &&
            (n.publishedAt || n.timestamp || 0) > lastRead
          ).length;
        }
      }
    } catch(e) {}

    // إشعارات غرف البث
    let roomUnread = 0;
    try {
      const resR = await fetch(`${FB_DB_URL}/notificationsRoom.json?auth=${FB_API_KEY}`);
      if (resR.ok) {
        const dataR = await resR.json();
        if (dataR && typeof dataR === 'object') {
          const roomList = Object.values(dataR).filter(n => n && n.roomId && n.ownerUid !== myUid);
          if (myType === 'student') {
            let myReqR = null;
            try {
              const resAllR = await fetch(`${FB_DB_URL}/joinRequests.json?auth=${FB_API_KEY}`);
              if (resAllR.ok) {
                const allInstR = await resAllR.json();
                if (allInstR) {
                  for (const iUid of Object.keys(allInstR)) {
                    const found = Object.values(allInstR[iUid] || {}).find(r =>
                      r && r.status === 'accepted' && (r.uid === myUid || r.userId === myUid)
                    );
                    if (found) { myReqR = found; break; }
                  }
                }
              }
            } catch(e) {}
            if (myReqR) {
              const mySubs = (myReqR.subjects || []).map(s => (s.name || s).trim());
              roomUnread = roomList.filter(n => {
                if ((n.ts || 0) <= lastRead) return false;
                const sameLevel = !n.levelId  || myReqR.levelId === n.levelId;
                const sameSub   = !n.subject  || mySubs.includes((n.subject || '').trim());
                const sameInst  = !n.institutionOnly ||
                  (myReqR.institutionUid || myReqR.institutionId || '') === (n.institutionUid || '');
                return sameLevel && sameSub && sameInst;
              }).length;
            }
          } else if (myType !== 'teacher') {
            roomUnread = roomList.filter(n =>
              (n.ts || 0) > lastRead && (n.noTarget || n.institutionUid === myUid)
            ).length;
          }
        }
      }
    } catch(e) {}

    const total = examUnread + interactionUnread + roomUnread;
    if (total > 0) {
      badgeEl.textContent = total > 99 ? '99+' : String(total);
      badgeEl.style.display = '';
    } else {
      badgeEl.style.display = 'none';
    }
  } catch(e) {
    badgeEl.style.display = 'none';
  }
}

// جلب lastRead من Firebase ثم حساب badge
async function _fbGetLastReadThenCompute() {
  const uid = localStorage.getItem('yadwor-uid') || '';
  if (!uid) return;
  try {
    const res = await fetch(`${FB_DB_URL}/userMeta/${uid}/notifLastRead.json?auth=${FB_API_KEY}`);
    if (res.ok) {
      const val = await res.json();
      if (val && typeof val === 'number') _bellLastReadTs = val;
    }
  } catch(e) {}
  _computeAndUpdateBadge();
}

// الدالة الرئيسية — Realtime listener
function updateBellBadgeFromFirebase() {
  const myUid = localStorage.getItem('yadwor-uid') || '';
  if (!myUid) return;

  _fbGetLastReadThenCompute();

  function _startSSE(path) {
    var url = FB_DB_URL + '/' + path + '.json?auth=' + FB_API_KEY;
    try {
      var src = new EventSource(url);
      src.addEventListener('put',   function() { _computeAndUpdateBadge(); });
      src.addEventListener('patch', function() { _computeAndUpdateBadge(); });
      src.onerror = function() {
        src.close();
        setTimeout(function() { _startSSE(path); }, 10000);
      };
    } catch(e) {}
  }

  _startSSE('notificationsRoom');
  _startSSE('notifications');
  _startSSE('interactions/' + myUid);

  // مراقبة تغيير notifLastRead من Firebase (عند فتح notifications.html من جهاز آخر)
  var lrUrl = FB_DB_URL + '/userMeta/' + myUid + '/notifLastRead.json?auth=' + FB_API_KEY;
  try {
    var lrSrc = new EventSource(lrUrl);
    lrSrc.addEventListener('put', function(e) {
      try {
        var p = JSON.parse(e.data);
        if (p && p.data && typeof p.data === 'number') {
          _bellLastReadTs = p.data;
          _computeAndUpdateBadge();
        }
      } catch(x) {}
    });
    lrSrc.onerror = function() { lrSrc.close(); };
  } catch(e) {}
}

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================

// تسجيل SW وطلب إذن الإشعارات
async function requestPushPermission() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // تسجيل sw.js
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    // انتظر حتى يصبح جاهزاً
    await navigator.serviceWorker.ready;
    // طلب إذن الإشعارات
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    // أرسل بيانات المستخدم للـ SW
    _sendInitToSW();
  } catch(e) {}
}

// إرسال إشعار محلي عبر SW
function sendBrowserNotification(title, body, url) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type:  'SHOW_NOTIFICATION',
        title: title,
        body:  body,
        url:   url || 'notifications.html'
      });
    } else {
      var n = new Notification(title, {
        body:  body,
        icon:  'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png',
        data:  { url: url || 'notifications.html' }
      });
      n.onclick = function() { window.focus(); window.location.href = url || 'notifications.html'; n.close(); };
    }
  } catch(e) {}
}

// إخبار SW بأن المستخدم قرأ الإشعارات + حفظ في Firebase
function markNotificationsRead(ts) {
  _bellLastReadTs = ts || Date.now();
  var uid = localStorage.getItem('yadwor-uid') || '';
  if (uid) {
    fetch(FB_DB_URL + '/userMeta/' + uid + '/notifLastRead.json?auth=' + FB_API_KEY, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(_bellLastReadTs)
    }).catch(function() {});
  }
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'MARK_READ', ts: _bellLastReadTs });
  }
  var badgeEl = document.getElementById('notif-badge');
  if (badgeEl) badgeEl.style.display = 'none';
}
