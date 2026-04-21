// ============================================================
// YADWOR – shared.js  (نسخة نظيفة كاملة)
// ============================================================

// =================== ثوابت Firebase / Cloudinary ===================
const FB_DB_URL  = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
const FB_API_KEY = 'AIzaSyAP-xRJ5zvHvMmqkkVvXnWdqwfuuj58CcA';
const CLD_NAME   = 'dlujoziwz';
const CLD_PRESET = 'my_app_upload';

// =================== بيانات المستخدم الحالي ===================
function _myUid()      { return localStorage.getItem('yadwor-uid')            || ''; }
function _myUsername() { return localStorage.getItem('yadwor-username')        || ''; }
function _myAvatar()   { return localStorage.getItem('yadwor-avatar-preview')  || ''; }
function _myCover()    { return localStorage.getItem('yadwor-cover-preview')   || ''; }
function _myName()     { return localStorage.getItem('yadwor-settings-name')   || localStorage.getItem('yadwor-user-name') || 'مستخدم'; }
function _myType()     { return localStorage.getItem('yadwor-account-type')    || 'influencer'; }

// هل هذا المنشور ينتمي للمستخدم الحالي؟
// الاعتماد على uid الفريد فقط — لا username لأنه قابل للتكرار
function _isMine(post) {
  if (!post) return false;
  const uid = _myUid();
  if (!uid || !post.uid) return false;
  return String(post.uid) === String(uid);
}

// =================== بيانات ثابتة ===================
const moroccanLevels = [
  { id:"1p", name:"الأولى ابتدائي",   cycle:"ابتدائي" },
  { id:"2p", name:"الثانية ابتدائي",  cycle:"ابتدائي" },
  { id:"3p", name:"الثالثة ابتدائي",  cycle:"ابتدائي" },
  { id:"4p", name:"الرابعة ابتدائي",  cycle:"ابتدائي" },
  { id:"5p", name:"الخامسة ابتدائي",  cycle:"ابتدائي" },
  { id:"6p", name:"السادسة ابتدائي",  cycle:"ابتدائي" },
  { id:"1c", name:"الأولى إعدادي",    cycle:"إعدادي"  },
  { id:"2c", name:"الثانية إعدادي",   cycle:"إعدادي"  },
  { id:"3c", name:"الثالثة إعدادي",   cycle:"إعدادي"  },
  { id:"tc", name:"الجذع المشترك",    cycle:"ثانوي"   },
  { id:"1b", name:"الأولى باكالوريا", cycle:"ثانوي"   },
  { id:"2b", name:"الثانية باكالوريا",cycle:"ثانوي"   },
];
const subjectsByCycle = {
  ابتدائي:["اللغة العربية","اللغة الفرنسية","الرياضيات","النشاط العلمي","التربية الإسلامية","الاجتماعيات","الأمازيغية"],
  إعدادي: ["اللغة العربية","اللغة الفرنسية","اللغة الإنجليزية","الرياضيات","الفيزياء والكيمياء","علوم الحياة والأرض","الاجتماعيات","المعلوميات"],
  ثانوي:  ["اللغة العربية","اللغة الفرنسية","اللغة الإنجليزية","الرياضيات","الفيزياء والكيمياء","علوم الحياة والأرض","الفلسفة","التاريخ والجغرافيا","المعلوميات"]
};

// profiles للعرض التجريبي
const profiles = {
  institution: {
    name:"مؤسسة الريادة للتعليم", username:"riyada.school", type:"institution",
    avatar:"https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400&auto=format&fit=crop",
    cover:"https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=1400&auto=format&fit=crop",
    bio:"مؤسسة تعليمية رائدة بالمغرب.", verified:true, location:"الدار البيضاء، المغرب",
    followers:12400, following:86, teachers:47, students:1280
  },
  teacher: {
    name:"أ. سارة المهدي", username:"sara.mehdi", type:"teacher",
    avatar:"https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop",
    cover:"https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=1400&auto=format&fit=crop",
    bio:"أستاذة الرياضيات والفيزياء.", verified:true, institution:"مؤسسة الريادة للتعليم",
    location:"الرباط", followers:3420, following:215
  },
  student: {
    name:"يوسف أمين", username:"youssef.amine", type:"student",
    avatar:"https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop",
    cover:"https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1400&auto=format&fit=crop",
    bio:"تلميذ بالسنة الثانية باكالوريا.", verified:false,
    location:"مراكش", followers:486, following:392
  },
  user: {
    name:"ليلى بناني", username:"leila.bennani", type:"user",
    avatar:"https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&auto=format&fit=crop",
    cover:"https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1400&auto=format&fit=crop",
    bio:"مهتمة بالتعليم.", verified:false, followers:128, following:240
  }
};

// influencer = المستخدم الحقيقي من localStorage
profiles['influencer'] = {
  name:     _myName(),
  username: _myUsername() || 'user',
  type:     'influencer',
  avatar:   _myAvatar()   || '',   // لا صورة وهمية — إما الحقيقية أو فارغ
  cover:    _myCover()    || '',
  bio:      localStorage.getItem('yadwor-bio') || '',
  location: localStorage.getItem('yadwor-location') || '',
  verified: false, followers: 0, following: 0
};

function getRealUser() {
  const raw = localStorage.getItem('yadwor-user-data');
  if (raw) { try { return JSON.parse(raw); } catch(e) {} }
  return {
    uid: _myUid(), name: _myName(), username: _myUsername(),
    avatar: _myAvatar(), cover: _myCover(),
    bio: localStorage.getItem('yadwor-bio') || '',
    location: localStorage.getItem('yadwor-location') || '',
    accountType: _myType(), followers: 0, following: 0, verified: false
  };
}

// =================== STATE ===================
let state = {
  page:        'home',
  profileType: localStorage.getItem('yadwor-profile-type') || _myType(),
  activeTab:   'posts',
  isFollowing: false,
  authMode:    'login',
  settingsName:          _myName(),
  settingsLanguage:      'العربية',
  settingsAccountType:   _myType(),
  settingsAvatarPreview: _myAvatar(),
  settingsCoverPreview:  _myCover(),
  searchQuery: '', searchMode: 'users',
  draftImages: [], draftVideo: '', draftHashtags: '',
  composerMode: 'post',
  editingPostId: null, deletingPostId: null,
  likedPosts:    JSON.parse(localStorage.getItem('yadwor-liked-posts') || '[]'),
  likedComments: [],
  commentingPostId: null,
  imageViewerData:  null,
  selectedJoinRequest: null,
  selectedLevel: '', selectedSubjects: [], subjectPricing: {},
  joinRole: null, joinStep: 1,
  activeChat: null,
  chatMessages: [
    { fromMe:false, text:"مرحباً، هل تحتاج المساعدة في الدرس؟" },
    { fromMe:true,  text:"نعم، أريد توضيحاً حول التمارين الأخيرة." },
    { fromMe:false, text:"سأرسل لك الشرح والملخص بعد قليل." },
  ],
  posts:        JSON.parse(localStorage.getItem('yadwor-posts') || '[]'),
  postComments: JSON.parse(localStorage.getItem('yadwor-post-comments') || '{}'),
  notifications: [],
  institutionCatalog: {
    "الرياضيات":          {enabled:true,free:false,price:"120"},
    "الفيزياء والكيمياء": {enabled:true,free:false,price:"150"},
    "اللغة العربية":      {enabled:true,free:true, price:"0"},
    "اللغة الفرنسية":     {enabled:true,free:false,price:"90"},
    "المعلوميات":         {enabled:true,free:true, price:"0"}
  },
  joinRequests:    JSON.parse(localStorage.getItem('yadwor-join-requests') || '[]'),
  _userAvatarCache: {}
};

// =================== Firebase helpers ===================
async function fetchPostsFromFirebase() {
  try {
    const res = await fetch(`${FB_DB_URL}/posts.json?auth=${FB_API_KEY}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data)
      .filter(p => p && p.id)  // لا نشترط content لأن الريلز قد تكون بدون نص
      .sort((a,b) => (b.timestamp||0)-(a.timestamp||0));
  } catch(e) { return null; }
}

async function fetchCommentsFromFirebase() {
  try {
    const res = await fetch(`${FB_DB_URL}/comments.json?auth=${FB_API_KEY}`);
    if (!res.ok) return null;
    return (await res.json()) || {};
  } catch(e) { return null; }
}

// جلب صور جميع المستخدمين من Firebase → خريطة
async function fetchUserAvatarMap() {
  try {
    const res = await fetch(`${FB_DB_URL}/users.json?auth=${FB_API_KEY}`);
    if (!res.ok) return {};
    const data = await res.json();
    if (!data) return {};
    const map = {};
    Object.values(data).forEach(u => {
      if (!u || !u.avatar) return;
      if (u.uid)      map['uid:'   + u.uid]      = u.avatar;
      if (u.username) map['uname:' + u.username] = u.avatar;
    });
    return map;
  } catch(e) { return {}; }
}

// تطبيق الصورة الصحيحة على منشور واحد
function _applyAvatar(post, avatarMap) {
  // منشورات المستخدم الحالي: صورته من localStorage دائماً
  if (_isMine(post)) {
    const av = _myAvatar();
    return av ? Object.assign({}, post, {avatar: av}) : post;
  }
  // منشورات الآخرين: من الخريطة
  const av = (post.uid && avatarMap['uid:' + post.uid])
          || (post.username && avatarMap['uname:' + post.username]);
  return av ? Object.assign({}, post, {avatar: av}) : post;
}

// =================== syncPostsFromFirebase ===================
async function syncPostsFromFirebase() {
  const myUid  = _myUid();
  const myName = _myName();
  const myAv   = _myAvatar();

  // 1) جلب جميع المنشورات من Firebase
  const fbPosts = await fetchPostsFromFirebase();
  if (fbPosts !== null) {
    if (fbPosts.length > 0) {
      // كل منشور يحمل بيانات صاحبه مدمجة (uid, avatar, author)
      // نحدّث فقط منشوراتي بصورتي الحالية — الآخرين نتركهم كما هم تماماً
      const processed = fbPosts.map(p => {
        if (myUid && p.uid && String(p.uid) === String(myUid)) {
          // هذا منشوري — حدّث اسمي وصورتي فقط
          return Object.assign({}, p, {
            avatar: myAv   || p.avatar || '',
            author: myName || p.author || 'مستخدم'
          });
        }
        // منشور شخص آخر — يُعرض بـ p.avatar و p.author المدمجَين معه
        return p;
      });
      // إضافة منشوراتي المحلية غير المرفوعة بعد
      const fbIds = new Set(fbPosts.map(p => String(p.id)));
      const localPosts = JSON.parse(localStorage.getItem('yadwor-posts') || '[]');
      const pending = localPosts.filter(p =>
        myUid && p.uid && String(p.uid) === String(myUid) && !fbIds.has(String(p.id))
      );
      state.posts = [...processed, ...pending].sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    } else {
      state.posts = [];
    }
  }

  // 2) حفظ محلي
  try { localStorage.setItem('yadwor-posts', JSON.stringify(state.posts)); } catch(e) {}

  // 3) التعليقات
  const fbComments = await fetchCommentsFromFirebase();
  if (fbComments) {
    const local = JSON.parse(localStorage.getItem('yadwor-post-comments') || '{}');
    state.postComments = Object.assign({}, fbComments, local);
  }
}

async function savePostToFirebase(post) {
  // تأكد أن المنشور يحمل uid و username و avatar قبل الحفظ
  const toSave = Object.assign({}, post, {
    uid:      post.uid      || _myUid(),
    username: post.username || _myUsername(),
    avatar:   post.avatar   || _myAvatar(),
    author:   post.author   || _myName()
  });
  // احذف خاصية owned لأنها مصدر الخلط
  delete toSave.owned;
  try {
    await fetch(`${FB_DB_URL}/posts/${toSave.id}.json?auth=${FB_API_KEY}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(toSave)
    });
  } catch(e) {}
}

async function saveCommentToFirebase(postId, comment) {
  try {
    await fetch(`${FB_DB_URL}/comments/${postId}/${comment.id}.json?auth=${FB_API_KEY}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(comment)
    });
  } catch(e) {}
}

async function saveUserProfileToFirebase() {
  const uid = _myUid(); if (!uid) return;
  const data = {
    uid, name:_myName(), username:_myUsername(),
    avatar:_myAvatar(), cover:_myCover(),
    bio: localStorage.getItem('yadwor-bio') || '',
    location: localStorage.getItem('yadwor-location') || '',
    country: localStorage.getItem('yadwor-country') || '',
    city: localStorage.getItem('yadwor-city') || '',
    accountType: _myType(), updatedAt: Date.now()
  };
  try {
    await fetch(`${FB_DB_URL}/users/${uid}.json?auth=${FB_API_KEY}`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
    // حدّث الـ cache
    state._userAvatarCache['uid:'+uid]            = _myAvatar();
    state._userAvatarCache['uname:'+_myUsername()] = _myAvatar();
  } catch(e) {}
}

// تحديث avatar في جميع منشوراتي على Firebase
async function updateMyPostsAvatarInFirebase(newAvatar) {
  const myPosts = state.posts.filter(p => _isMine(p));
  for (const p of myPosts) {
    try {
      await fetch(`${FB_DB_URL}/posts/${p.id}/avatar.json?auth=${FB_API_KEY}`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(newAvatar)
      });
    } catch(e) {}
  }
}

// =================== saveData ===================
function saveData() {
  const myUid  = _myUid();
  const myAv   = state.settingsAvatarPreview || _myAvatar();
  const myName = state.settingsName || _myName();

  // حدّث فقط منشوراتي بالـ uid الفريد — لا تمسّ منشورات الآخرين أبداً
  if (myUid) {
    state.posts = state.posts.map(p => {
      if (!p.uid || String(p.uid) !== String(myUid)) return p; // ليس منشوري
      return Object.assign({}, p, {
        avatar: myAv   || p.avatar || '',
        author: myName || p.author || 'مستخدم'
      });
    });
  }

  localStorage.setItem('yadwor-posts',         JSON.stringify(state.posts));
  localStorage.setItem('yadwor-liked-posts',    JSON.stringify(state.likedPosts));
  localStorage.setItem('yadwor-post-comments',  JSON.stringify(state.postComments));
  localStorage.setItem('yadwor-profile-type',   state.profileType || '');
  localStorage.setItem('yadwor-settings-name',  state.settingsName || '');
  localStorage.setItem('yadwor-avatar-preview', state.settingsAvatarPreview || '');
  localStorage.setItem('yadwor-cover-preview',  state.settingsCoverPreview  || '');

  const ru = getRealUser();
  ru.name   = state.settingsName          || ru.name;
  ru.avatar = state.settingsAvatarPreview || ru.avatar;
  ru.cover  = state.settingsCoverPreview  || ru.cover;
  localStorage.setItem('yadwor-user-data', JSON.stringify(ru));
}

// =================== HELPERS ===================
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return `${(num/1000000).toFixed(1).replace(/\.0$/,'')}م`;
  if (num >= 1000)    return `${(num/1000).toFixed(1).replace(/\.0$/,'')}ألف`;
  return String(num);
}
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
function currentProfile() { return profiles[state.profileType] || profiles['influencer']; }
function typeLabel() {
  return {institution:'مؤسسة تعليمية',teacher:'أستاذ',student:'تلميذ',user:'مستخدم',influencer:'مؤثر تعليمي'}[state.profileType] || 'مؤثر تعليمي';
}

// =================== SHIMMER ===================
function shimmerPostCard() {
  return `<article class="mb-3 mx-3 rounded-[22px] border border-zinc-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
    <div class="flex items-center gap-3">
      <div class="shimmer h-12 w-12 rounded-full shrink-0"></div>
      <div class="flex-1 space-y-2">
        <div class="shimmer h-3.5 w-32 rounded-full"></div>
        <div class="shimmer h-3 w-20 rounded-full"></div>
      </div>
    </div>
    <div class="mt-4 space-y-2">
      <div class="shimmer h-3.5 w-full rounded-full"></div>
      <div class="shimmer h-3.5 w-4/5 rounded-full"></div>
    </div>
    <div class="shimmer mt-4 h-48 w-full rounded-[14px]"></div>
    <div class="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3">
      <div class="shimmer h-5 w-16 rounded-full"></div>
      <div class="shimmer h-5 w-16 rounded-full"></div>
      <div class="shimmer h-5 w-16 rounded-full"></div>
    </div>
  </article>`;
}

function imgWithShimmer(src, cls, alt) {
  const id = 'img_' + Math.random().toString(36).slice(2,8);
  return `<div class="relative overflow-hidden ${cls}">
    <div id="sh_${id}" class="shimmer absolute inset-0"></div>
    <img src="${src}" alt="${alt||''}" class="w-full h-full object-cover relative z-[1]"
      onload="var e=document.getElementById('sh_${id}');if(e)e.remove()"
      onerror="var e=document.getElementById('sh_${id}');if(e)e.remove()" />
  </div>`;
}

// =================== NAVIGATION ===================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('page-'+page);
  if (pg) pg.classList.add('active');
  state.page = page;
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = (page==='auth'||page==='reels') ? 'none' : 'block';
  ['home','search','reels','profile','messages'].forEach(id => {
    const btn = document.getElementById('nav-'+id);
    if (btn) btn.className = `flex flex-col items-center justify-center gap-1 rounded-[12px] py-2 text-[10px] font-bold transition ${page===id?'bg-zinc-900 text-white':'text-zinc-500'}`;
  });
  renderPage(page);
}
function renderPage(page) {
  if (page==='home')         { if(typeof renderHome    ==='function') renderHome();    }
  else if(page==='search')   { if(typeof renderSearch  ==='function') renderSearch();  }
  else if(page==='reels')    { if(typeof renderReels   ==='function') renderReels();   }
  else if(page==='profile')  { if(typeof renderProfile ==='function') renderProfile(); }
  else if(page==='messages') { if(typeof renderMessages==='function') renderMessages();}
}

// =================== POST CARD ===================
function formatTimeAgo(v) {
  if (!v) return 'الآن';
  const ts = typeof v==='number' ? v : Date.parse(v);
  if (!isNaN(ts)) {
    const d = Math.floor((Date.now()-ts)/1000);
    if (d<60)     return 'الآن';
    if (d<3600)   return `منذ ${Math.floor(d/60)} دقيقة`;
    if (d<86400)  return `منذ ${Math.floor(d/3600)} ساعة`;
    if (d<172800) return 'أمس';
    if (d<604800) return `منذ ${Math.floor(d/86400)} أيام`;
    return `منذ ${Math.floor(d/604800)} أسبوع`;
  }
  return String(v);
}

function renderPostCard(post) {
  const isLiked   = state.likedPosts.includes(post.id);
  const heartFill = isLiked ? 'currentColor' : 'none';
  const heartCls  = isLiked ? 'text-rose-500' : '';
  const savedFill = post.saved ? 'currentColor' : 'none';
  const timeLabel = formatTimeAgo(post.timestamp || post.time);
  const roleLabels= {institution:'مؤسسة تعليمية',teacher:'أستاذ',student:'تلميذ',influencer:'مؤثر تعليمي',user:'مستخدم'};
  const roleLabel = roleLabels[post.accountType] || roleLabels[post.role] || post.role || 'مستخدم';
  // post.avatar مدمجة مع المنشور تمثل صورة صاحبه الحقيقية — لا نستبدلها بصورة المستخدم الحالي
  const postAv    = post.avatar || 'https://images.unsplash.com/photo-1511367461989-f85a21fda167?w=400&auto=format&fit=crop';
  const isMinePost= _isMine(post);

  let mediaHTML = '';
  if (post.type==='gallery' && post.images && post.images.length) {
    if (post.images.length===1) {
      mediaHTML = `<button onclick="openImageViewer(${post.id},0)"
        class="mt-3 block w-full overflow-hidden rounded-[12px] bg-zinc-100 relative" style="aspect-ratio:1/1;max-height:320px;">
        <div class="absolute inset-0">${imgWithShimmer(post.images[0],'w-full h-full rounded-[12px]','')}</div>
      </button>`;
    } else {
      const imgs = post.images.slice(0,4).map((img,i)=>
        `<button onclick="openImageViewer(${post.id},${i})"
          class="overflow-hidden rounded-[6px] bg-zinc-100 relative" style="aspect-ratio:1/1;">
          ${imgWithShimmer(img,'h-full w-full rounded-[6px]','')}
        </button>`).join('');
      mediaHTML = `<div class="mt-3 grid grid-cols-2 gap-1">${imgs}</div>`;
    }
  } else if (post.type==='video' && post.images && post.images.length) {
    const vSrc   = post.images[0];
    const shimId = 'vsh_'+post.id;
    const hasCloud = vSrc && vSrc.startsWith('http');
    const thumbSrc = post.thumbnail || (hasCloud ? vSrc.replace('/video/upload/','/video/upload/so_0,w_600/').replace(/\.[^/.]+$/,'.jpg') : '');
    const tH = thumbSrc ? `<img src="${thumbSrc}" class="absolute inset-0 w-full h-full object-cover z-[1]"
        onload="var s=document.getElementById('${shimId}');if(s)s.remove();"
        onerror="var s=document.getElementById('${shimId}');if(s)s.style.display='none';" />` : '';
    mediaHTML = `<button onclick="goToReel(${post.id})"
      class="relative mt-3 block w-full overflow-hidden rounded-[12px] bg-zinc-900" style="aspect-ratio:16/9">
      <div id="${shimId}" class="shimmer absolute inset-0 z-[0]"></div>${tH}
      <div class="absolute inset-0 flex flex-col items-center justify-center z-[2]">
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg">
          <svg viewBox="0 0 24 24" class="h-7 w-7 fill-current ml-0.5"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <span class="mt-2 text-[11px] text-white font-bold bg-black/40 px-2 py-0.5 rounded-full">ريلز</span>
      </div>
    </button>`;
  }

  const menuItems = isMinePost ? `
    <button onclick="openEditModal(${post.id})"   class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] hover:bg-zinc-100">تعديل</button>
    <button onclick="openDeleteModal(${post.id})" class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] text-red-600 hover:bg-red-50">حذف</button>
  ` : `
    <button onclick="toggleSave(${post.id})" class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] hover:bg-zinc-100">${post.saved?'إزالة من المحفوظات':'حفظ'}</button>
    <button class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-right text-[13px] text-red-600 hover:bg-red-50">إبلاغ</button>
  `;

  const txt = (post.content||'').length>120
    ? `<p id="txt-${post.id}" class="mt-2.5 text-[14px] leading-7 text-zinc-700 line-clamp-2">${post.content}</p>
       <button onclick="expandPost(${post.id})" class="text-[13px] font-bold text-zinc-500">المزيد</button>`
    : `<p class="mt-2.5 text-[14px] leading-7 text-zinc-700">${post.content||''}</p>`;

  return `
  <article class="mb-3 mx-3 rounded-[22px] border border-zinc-200 bg-white px-4 py-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        <a href="profile.html?uid=${encodeURIComponent(post.uid||'')}&username=${encodeURIComponent(post.username||'')}"
           class="relative h-10 w-10 shrink-0 rounded-full overflow-hidden block">
          <div id="avsh_${post.id}" class="shimmer absolute inset-0 rounded-full"></div>
          <img src="${postAv}" alt="${post.author||''}" class="h-10 w-10 rounded-full object-cover relative z-[1]"
            onload="var e=document.getElementById('avsh_${post.id}');if(e)e.remove()"
            onerror="this.src='https://images.unsplash.com/photo-1511367461989-f85a21fda167?w=400&auto=format&fit=crop';var e=document.getElementById('avsh_${post.id}');if(e)e.remove()" />
        </a>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <a href="profile.html?uid=${encodeURIComponent(post.uid||'')}&username=${encodeURIComponent(post.username||'')}"
               class="text-[13px] font-extrabold truncate hover:underline">${post.author||'مستخدم'}</a>
            <span class="text-[10px] text-zinc-400 font-medium shrink-0">${roleLabel}</span>
          </div>
          <p class="text-[11px] text-zinc-400">${timeLabel}</p>
        </div>
      </div>
      <div class="relative shrink-0">
        <button onclick="togglePostMenu(${post.id})"
          class="flex h-7 w-7 items-center justify-center rounded-full hover:bg-zinc-100 text-zinc-400">
          <svg viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v.01M12 12v.01M12 19v.01"/></svg>
        </button>
        <div id="post-menu-${post.id}" class="hidden absolute left-0 top-9 z-20 w-36 rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl">${menuItems}</div>
      </div>
    </div>
    ${txt}${mediaHTML}
    <div class="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2.5 text-zinc-500">
      <button onclick="toggleLike(${post.id})" class="flex items-center gap-1 text-[13px] transition ${heartCls}">
        <svg viewBox="0 0 24 24" class="h-5 w-5" fill="${heartFill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 21s-7-4.35-9-8.68C1.38 8.92 3.44 5 7.5 5c2.04 0 3.11 1.03 4.5 2.5C13.39 6.03 14.46 5 16.5 5 20.56 5 22.62 8.92 21 12.32 19 16.65 12 21 12 21"/></svg>
        <span id="likes-count-${post.id}">${post.likes||0}</span>
      </button>
      <button onclick="openComments(${post.id})" class="flex items-center gap-1 text-[13px] hover:text-zinc-900">
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" stroke-width="1.8" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${post.comments||0}</span>
      </button>
      <div class="flex items-center gap-1 text-[13px]">
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg>
        <span>${post.shares||0}</span>
      </div>
      <button onclick="sharePost(${post.id})" class="flex items-center gap-1 text-[13px] hover:text-zinc-900">
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" stroke-width="1.8" stroke-linecap="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 16V4M8 8l4-4 4 4"/></svg>
      </button>
      <button onclick="toggleSave(${post.id})" class="flex items-center gap-1 text-[13px] hover:text-zinc-900">
        <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" fill="${savedFill}" stroke-width="1.8" stroke-linecap="round"><path d="M7 3h10a2 2 0 0 1 2 2v14l-7-4-7 4V5a2 2 0 0 1 2-2Z"/></svg>
      </button>
    </div>
  </article>`;
}

function expandPost(id) {
  const el = document.getElementById('txt-'+id);
  const p  = state.posts.find(p=>p.id===id);
  if (el && p) { el.className='mt-3 text-[14px] leading-7 text-zinc-700'; el.textContent=p.content; if(el.nextElementSibling)el.nextElementSibling.remove(); }
}
function togglePostMenu(id) {
  document.querySelectorAll('[id^="post-menu-"]').forEach(m=>{if(m.id!=='post-menu-'+id)m.classList.add('hidden');});
  document.getElementById('post-menu-'+id).classList.toggle('hidden');
}
document.addEventListener('click', e => {
  if (!e.target.closest('[id^="post-menu-"]') && !e.target.closest('button[onclick*="togglePostMenu"]'))
    document.querySelectorAll('[id^="post-menu-"]').forEach(m=>m.classList.add('hidden'));
});

// =================== LIKES ===================
function toggleLike(id) {
  const post = state.posts.find(p=>p.id===id); if(!post) return;
  const idx = state.likedPosts.indexOf(id);
  if (idx>-1){ state.likedPosts.splice(idx,1); post.likes=Math.max(0,(post.likes||1)-1); }
  else        { state.likedPosts.push(id);      post.likes=(post.likes||0)+1; }
  saveData();
  const btn = document.querySelector(`button[onclick="toggleLike(${id})"]`);
  if (btn) {
    const isLiked=state.likedPosts.includes(id);
    const svg=btn.querySelector('svg'); const span=btn.querySelector('span')||document.getElementById('likes-count-'+id);
    if(svg)  svg.setAttribute('fill', isLiked?'currentColor':'none');
    if(span) span.textContent=post.likes;
    btn.className=`flex items-center gap-1 text-[13px] transition ${isLiked?'text-rose-500':'text-zinc-500'}`;
  }
  try { fetch(`${FB_DB_URL}/posts/${id}/likes.json?auth=${FB_API_KEY}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(post.likes)}); } catch(e){}
}
function toggleSave(id) {
  const post=state.posts.find(p=>p.id===id); if(!post)return;
  post.saved=!post.saved;
  showToast(post.saved?'تم حفظ المنشور':'تمت الإزالة من المحفوظات');
  saveData();
}
function sharePost(id) {
  const url=window.location.origin+'/home.html#post/'+id;
  navigator.clipboard.writeText(url).then(()=>showToast('تم نسخ الرابط')).catch(()=>showToast('تعذر النسخ'));
}

// =================== EDIT / DELETE ===================
function openEditModal(id) {
  state.editingPostId=id;
  const post=state.posts.find(p=>p.id===id); if(!post)return;
  document.getElementById('edit-text').value=post.content;
  document.getElementById('save-edit-btn').disabled=(post.editCount||0)>=2;
  document.getElementById('edit-modal').classList.remove('hidden');
}
function closeEditModal(){ document.getElementById('edit-modal').classList.add('hidden'); }
function saveEdit() {
  const post=state.posts.find(p=>p.id===state.editingPostId);
  if(!post||(post.editCount||0)>=2)return;
  post.content=document.getElementById('edit-text').value;
  post.editCount=(post.editCount||0)+1;
  closeEditModal(); saveData();
  try { fetch(`${FB_DB_URL}/posts/${post.id}.json?auth=${FB_API_KEY}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:post.content,editCount:post.editCount})}); }catch(e){}
  if(typeof renderHome==='function')renderHome();
}
function openDeleteModal(id){ state.deletingPostId=id; document.getElementById('delete-modal').classList.remove('hidden'); }
function closeDeleteModal(){ document.getElementById('delete-modal').classList.add('hidden'); }
function confirmDelete(){
  const id=state.deletingPostId;
  state.posts=state.posts.filter(p=>p.id!==id);
  closeDeleteModal(); saveData();
  try { fetch(`${FB_DB_URL}/posts/${id}.json?auth=${FB_API_KEY}`,{method:'DELETE'}); }catch(e){}
  if(typeof renderHome==='function')renderHome();
}

// =================== COMMENTS ===================
function openComments(id){
  state.commentingPostId=id;
  const post=state.posts.find(p=>p.id===id);
  const el=document.getElementById('comments-post-author'); if(el)el.textContent=post?post.author:'';
  const inp=document.getElementById('comment-input'); if(inp)inp.value='';
  renderComments();
  const modal=document.getElementById('comments-modal'); if(modal)modal.classList.remove('hidden');
}
function closeCommentsModal(){ const m=document.getElementById('comments-modal'); if(m)m.classList.add('hidden'); }
function renderComments(){
  const id=state.commentingPostId;
  const comments=state.postComments[id]||[];
  const list=document.getElementById('comments-list'); if(!list)return;
  if(!comments.length){ list.innerHTML=`<div class="rounded-[14px] border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-[13px] text-zinc-500">لا توجد تعليقات بعد</div>`; return; }
  list.innerHTML=comments.map(c=>{
    const cKey=Number(`${id}${c.id}`), liked=state.likedComments.includes(cKey);
    const replies=(c.replies||[]).map((r,ri)=>{
      const rKey=Number(`${id}${c.id}${ri}`), rLiked=state.likedComments.includes(rKey);
      return `<div class="rounded-[14px] bg-blue-50 border border-blue-100 px-3 py-2.5 text-[13px]">
        <div class="mb-1.5 flex items-center justify-between gap-2">
          <div><p class="font-extrabold text-zinc-900">${r.author}</p><p class="text-[10px] text-zinc-500">↳ رد • ${r.time}</p></div>
          <button onclick="likeReply(${id},${c.id},${ri})" class="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${rLiked?'bg-rose-100 text-rose-600':'bg-white text-zinc-600 border border-zinc-200'}">
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="${rLiked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21s-7-4.35-9-8.68C1.38 8.92 3.44 5 7.5 5c2.04 0 3.11 1.03 4.5 2.5C13.39 6.03 14.46 5 16.5 5 20.56 5 22.62 8.92 21 12.32 19 16.65 12 21 12 21"/></svg> ${r.likes||0}
          </button>
        </div>
        <p class="leading-6 text-zinc-700">${r.text}</p>
      </div>`;
    }).join('');
    return `<div class="rounded-[16px] bg-zinc-50 border border-zinc-200 px-4 py-3 text-[14px] text-zinc-700">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div><p class="text-[13px] font-extrabold text-zinc-900">${c.author}</p><p class="text-[11px] text-zinc-500">${c.time}</p></div>
        <div class="flex items-center gap-2">
          <button onclick="likeComment(${id},${c.id})" class="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${liked?'bg-rose-100 text-rose-600':'bg-white text-zinc-600 border border-zinc-200'}">
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="${liked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21s-7-4.35-9-8.68C1.38 8.92 3.44 5 7.5 5c2.04 0 3.11 1.03 4.5 2.5C13.39 6.03 14.46 5 16.5 5 20.56 5 22.62 8.92 21 12.32 19 16.65 12 21 12 21"/></svg> ${c.likes||0}
          </button>
          <button onclick="setReply(${id},${c.id},'${c.author.replace(/'/g,"\\'")}' )" class="rounded-full bg-zinc-900 text-white px-2 py-1 text-[11px] font-bold">رد</button>
        </div>
      </div>
      <p class="leading-7">${c.text}</p>
      ${replies?`<div class="mt-3 space-y-2 border-r-2 border-blue-200 pr-3">${replies}</div>`:''}
    </div>`;
  }).join('');
}
function likeComment(postId,commentId){
  const key=Number(`${postId}${commentId}`),idx=state.likedComments.indexOf(key);
  const comment=(state.postComments[postId]||[]).find(c=>c.id===commentId); if(!comment)return;
  if(idx>-1){state.likedComments.splice(idx,1);comment.likes=Math.max(0,(comment.likes||1)-1);}
  else{state.likedComments.push(key);comment.likes=(comment.likes||0)+1;}
  saveData();renderComments();
}
function likeReply(postId,commentId,ri){
  const key=Number(`${postId}${commentId}${ri}`),idx=state.likedComments.indexOf(key);
  const comment=(state.postComments[postId]||[]).find(c=>c.id===commentId); if(!comment||!comment.replies||!comment.replies[ri])return;
  const reply=comment.replies[ri];
  if(idx>-1){state.likedComments.splice(idx,1);reply.likes=Math.max(0,(reply.likes||1)-1);}
  else{state.likedComments.push(key);reply.likes=(reply.likes||0)+1;}
  saveData();renderComments();
}
let replyTarget=null;
function setReply(postId,commentId,author){
  replyTarget={postId,commentId,author};
  const inp=document.getElementById('comment-input'); if(inp){inp.value=`@${author} `;inp.focus();}
}
function submitComment(){
  const inp=document.getElementById('comment-input');
  const text=inp?inp.value.trim():'';
  if(!text||!state.commentingPostId)return;
  const id=state.commentingPostId, post=state.posts.find(p=>p.id===id);
  if(replyTarget&&replyTarget.postId===id){
    const comment=(state.postComments[id]||[]).find(c=>c.id===replyTarget.commentId);
    if(comment){comment.replies=comment.replies||[];comment.replies.push({id:Date.now(),author:_myName(),time:"الآن",text:text.replace(`@${replyTarget.author} `,''),likes:0});}
    if(post)post.comments=(post.comments||0)+1;
    replyTarget=null; showToast('تم إرسال الرد');
  } else {
    if(!state.postComments[id])state.postComments[id]=[];
    const nc={id:Date.now(),author:_myName(),time:"الآن",text,likes:0,replies:[]};
    state.postComments[id].push(nc);
    if(post)post.comments=(post.comments||0)+1;
    saveCommentToFirebase(id,nc); showToast('تمت إضافة تعليقك');
  }
  if(inp)inp.value='';
  saveData(); renderComments();
}

// =================== IMAGE VIEWER ===================
function openImageViewer(postId,index){
  const post=state.posts.find(p=>p.id===postId); if(!post||!post.images)return;
  state.imageViewerData={images:post.images,index,postId};
  updateImageViewer();
  const v=document.getElementById('image-viewer'); if(v)v.classList.remove('hidden');
}
function updateImageViewer(){
  const d=state.imageViewerData; if(!d)return;
  const img=document.getElementById('image-viewer-img'); if(img)img.src=d.images[d.index];
  const ctr=document.getElementById('image-viewer-counter'); if(ctr)ctr.textContent=`${d.index+1} / ${d.images.length}`;
}
function closeImageViewer(){ const v=document.getElementById('image-viewer'); if(v)v.classList.add('hidden'); }
function prevImage(){ if(!state.imageViewerData)return; const d=state.imageViewerData; d.index=d.index===0?d.images.length-1:d.index-1; updateImageViewer(); }
function nextImage(){ if(!state.imageViewerData)return; const d=state.imageViewerData; d.index=d.index===d.images.length-1?0:d.index+1; updateImageViewer(); }

// =================== CERT VIEWER ===================
function openCertViewer(title,type,preview){
  const t=document.getElementById('cert-title'),tp=document.getElementById('cert-type'),im=document.getElementById('cert-img'),v=document.getElementById('cert-viewer');
  if(t)t.textContent=title; if(tp)tp.textContent=type==='pdf'?'ملف PDF':'صورة شهادة'; if(im)im.src=preview; if(v)v.classList.remove('hidden');
}
function closeCertViewer(){ const v=document.getElementById('cert-viewer'); if(v)v.classList.add('hidden'); }

// =================== NAVIGATE TO REEL ===================
function goToReel(postId){ localStorage.setItem('yadwor-goto-reel',postId); window.location.href='reels.html'; }

// =================== OPEN CHAT ===================
function openChat(name,avatar){
  state.activeChat={name,avatar}; navigateTo('messages');
  setTimeout(()=>{
    const av=document.getElementById('chat-avatar'),nm=document.getElementById('chat-name');
    const lv=document.getElementById('messages-list-view'),cv=document.getElementById('messages-chat-view'),nav=document.getElementById('bottom-nav');
    if(av)av.src=avatar; if(nm)nm.textContent=name;
    if(lv)lv.style.display='none'; if(cv)cv.style.display='flex'; if(nav)nav.style.display='none';
    if(typeof renderChatMessages==='function')renderChatMessages();
  },50);
}

// =================== MISC ===================
function openDrawer(){  const d=document.getElementById('drawer'); if(d)d.classList.remove('hidden'); }
function closeDrawer(){ const d=document.getElementById('drawer'); if(d)d.classList.add('hidden'); }
function getDefaultTab(type){ if(type==='institution')return'teachers'; if(type==='teacher')return'students'; if(type==='student')return'teachers'; return'posts'; }
