// YADWOR – sw.js  (Service Worker v6)
var FB   = 'https://a-comment-5a3e5-default-rtdb.firebaseio.com';
var ICON = 'https://res.cloudinary.com/dlujoziwz/image/upload/v1/yadwor-icon.png';
var PAGE = 'notifications.html';
var _uid='', _type='', _lastRead=0, _roomKeys={}, _examKeys={}, _interKeys={}, _ready=false, _timer=null;

self.addEventListener('install', function(e){ e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim().then(function(){ if(_uid) _scheduleCheck(5000); })); });

self.addEventListener('message', function(e){
  if(!e||!e.data) return;
  var msg=e.data;
  if(msg.type==='INIT_SW'){
    var changed=(_uid!==(msg.uid||''));
    _uid=msg.uid||''; _type=msg.userType||''; _lastRead=msg.lastRead||0;
    if(changed){ _ready=false; _roomKeys={}; _examKeys={}; _interKeys={}; if(_timer){clearTimeout(_timer);_timer=null;} }
    if(_uid&&!_timer) _scheduleCheck(0);
  }
  if(msg.type==='MARK_READ'){ _lastRead=msg.ts||Date.now(); _roomKeys={}; _examKeys={}; _interKeys={}; _ready=false; _check(true); }
  if(msg.type==='SHOW_NOTIFICATION'){ e.waitUntil(_notify(msg.title||'YADWOR',msg.body||'إشعار جديد','manual',msg.url||PAGE)); }
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url=(e.notification.data&&e.notification.data.url)?e.notification.data.url:PAGE;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if(list[i].url.indexOf(url)!==-1&&'focus' in list[i]) return list[i].focus(); }
    for(var j=0;j<list.length;j++){ if('focus' in list[j]){ list[j].focus(); if('navigate' in list[j]) list[j].navigate(url); return; } }
    if(self.clients.openWindow) return self.clients.openWindow(url);
  }));
});

self.addEventListener('push', function(e){
  var d={}; try{d=e.data?e.data.json():{}}catch(x){}
  e.waitUntil(_notify(d.title||'YADWOR',d.body||'إشعار جديد','push',d.url||PAGE));
});

function _notify(title,body,tag,url){
  return self.registration.showNotification(title,{
    body:body, icon:ICON, badge:ICON, vibrate:[200,100,200,100,200],
    tag:tag||'yadwor', renotify:true, requireInteraction:false, data:{url:url||PAGE}
  });
}

// جلب من Firebase بدون auth param
function _get(path){
  return fetch(FB+'/'+path+'.json')
    .then(function(r){ return r.ok?r.json():null; })
    .catch(function(){ return null; });
}

function _scheduleCheck(delay){
  if(_timer) return;
  _timer=setTimeout(function(){
    _timer=null;
    _check(false).then(function(){ _scheduleCheck(25000); });
  }, delay==null?25000:delay);
}

function _check(silentMode){
  if(!_uid) return Promise.resolve();
  var p=Promise.resolve();
  if(!_lastRead){
    p=_get('userMeta/'+_uid+'/notifLastRead').then(function(v){ if(v&&typeof v==='number') _lastRead=v; });
  }
  return p
    .then(function(){ return _checkRooms(silentMode); })
    .then(function(){ return _checkExams(silentMode); })
    .then(function(){ return _checkInter(silentMode); })
    .then(function(){ _ready=true; })
    .catch(function(){});
}

function _checkRooms(silent){
  return _get('notificationsRoom').then(function(data){
    if(!data||typeof data!=='object') return;
    var keys=Object.keys(data);
    if(!_ready||silent){ keys.forEach(function(k){ _roomKeys[k]=true; }); return; }
    var ps=[];
    keys.forEach(function(k){
      if(_roomKeys[k]) return; _roomKeys[k]=true;
      var n=data[k]; if(!n||n.ownerUid===_uid) return;
      if((n.ts||0)<=_lastRead) return;
      ps.push(_notify('📡 بث مباشر — YADWOR',(n.ownerName||'أستاذ')+' بدأ بثاً مباشراً'+(n.roomName?' "'+n.roomName+'"':''),'room-'+k,PAGE));
    });
    return Promise.all(ps);
  });
}

function _checkExams(silent){
  if(_type==='teacher') return Promise.resolve();
  return _get('notifications').then(function(data){
    if(!data||typeof data!=='object') return;
    var keys=Object.keys(data);
    if(!_ready||silent){ keys.forEach(function(k){ _examKeys[k]=true; }); return; }
    var ps=[];
    keys.forEach(function(k){
      if(_examKeys[k]) return; _examKeys[k]=true;
      var n=data[k]; if(!n||n.type!=='exam') return;
      if(n.teacherUid===_uid) return;
      if((n.publishedAt||0)<=_lastRead) return;
      var body=(n.teacherName?n.teacherName+' نشر ':'')+(n.examType||'تمرين')+(n.title?': '+n.title:'')+(n.subject?' — '+n.subject:'');
      ps.push(_notify('📝 تمرين جديد — YADWOR',body,'exam-'+k,PAGE));
    });
    return Promise.all(ps);
  });
}

function _checkInter(silent){
  if(!_uid) return Promise.resolve();
  return _get('interactions/'+_uid).then(function(data){
    if(!data||typeof data!=='object') return;
    var keys=Object.keys(data);
    if(!_ready||silent){ keys.forEach(function(k){ _interKeys[k]=true; }); return; }
    var ps=[];
    keys.forEach(function(k){
      if(_interKeys[k]) return; _interKeys[k]=true;
      var n=data[k]; if(!n) return;
      var ts=n.publishedAt||n.timestamp||0;
      if(ts<=_lastRead) return;
      var title='🔔 YADWOR', body='تفاعل جديد', url=PAGE;
      if(n.type==='like'){ title='❤️ إعجاب — YADWOR'; body=(n.fromName||'شخص')+' أعجب بمنشورك'; url='home.html'; }
      else if(n.type==='comment'){ title='💬 تعليق جديد — YADWOR'; body=(n.fromName||'شخص')+' علّق على منشورك'; if(n.commentText) body+=': "'+String(n.commentText).slice(0,40)+'"'; url='home.html'; }
      else if(n.type==='reply'){ title='↩️ رد جديد — YADWOR'; body=(n.fromName||'شخص')+' ردّ على تعليقك'; url='home.html'; }
      else if(n.type==='follow'){ title='👤 متابع جديد — YADWOR'; body=(n.fromName||'شخص')+' بدأ متابعتك'; url='profile.html'; }
      else return;
      ps.push(_notify(title,body,'inter-'+k,url));
    });
    return Promise.all(ps);
  });
}
