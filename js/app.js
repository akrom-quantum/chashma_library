/* ============================================================
   js/app.js — Chashma: The Archive
   Main orchestration file. Loaded last.
   ============================================================ */

/* ----------------------------------------------------------
   GLOBAL STATE
   ---------------------------------------------------------- */
window.texts          = [];
window.videos         = [];
window.models         = [];
window.memories       = [];
window.admins         = [];
window.accessRequests = [];
window.allUsers       = [];
window.unsubs         = {};
window.userJoinDate   = null;
window.notifications  = [];
window.currentUser    = null;
window.userRole       = 'reader';

/* ----------------------------------------------------------
   SAFE HELPERS — never call Utils at module parse time
   ---------------------------------------------------------- */
function _isOwner () {
  return window.userRole === 'owner';
}

function _capitalize (s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ----------------------------------------------------------
   FIRESTORE LISTENERS
   ---------------------------------------------------------- */
window.setupListeners = function () {

  /* ── texts ── */
  window.unsubs.texts = db.collection('texts')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.texts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-texts');
      refreshActivePage('home');
    }, err => console.warn('texts listener:', err));

  /* ── videos ── */
  window.unsubs.videos = db.collection('videos')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-videos');
      refreshActivePage('home');
    }, err => console.warn('videos listener:', err));

  /* ── models ── */
  window.unsubs.models = db.collection('models')
    .orderBy('order', 'asc')
    .onSnapshot(snap => {
      window.models = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-models');
      refreshActivePage('home');
    }, err => console.warn('models listener:', err));

  /* ── memories ── */
  window.unsubs.memories = db.collection('memories')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.memories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('memories');
      refreshActivePage('home');
    }, err => console.warn('memories listener:', err));

  /* ── owner-only real-time subscriptions ── */
  if (_isOwner()) {
    window.unsubs.accessRequests = db.collection('accessRequests')
      .where('status', '==', 'pending')
      .onSnapshot(snap => {
        window.accessRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshActivePage('settings');
      }, err => console.warn('accessRequests listener:', err));

    window.unsubs.admins = db.collection('admins')
      .onSnapshot(snap => {
        window.admins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshActivePage('settings');
      }, err => console.warn('admins listener:', err));

    window.unsubs.allUsers = db.collection('users')
      .onSnapshot(snap => {
        window.allUsers = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.status !== 'removed');
        refreshActivePage('settings');
        refreshActivePage('insights');
        refreshActivePage('home');
      }, err => console.warn('allUsers listener:', err));

  } else {
    /* readers: one-time get for users list */
    db.collection('users').get()
      .then(snap => {
        window.allUsers = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.status !== 'removed');
      })
      .catch(err => console.warn('allUsers get (reader):', err));
  }
};

/* ----------------------------------------------------------
   COUNT BADGES
   ---------------------------------------------------------- */
function updateCounts () {
  _setBadge('cntTexts',  window.texts.filter(t => !t.hidden).length);
  _setBadge('cntVideos', window.videos.filter(v => !v.hidden).length);
  _setBadge('cntModels', window.models.filter(m => !m.hidden).length);
}

function _setBadge (id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count;
}

/* ----------------------------------------------------------
   ACTIVE PAGE DETECTION
   ---------------------------------------------------------- */
function activeTab () {
  const active = document.querySelector('.top-tab.active, .mn-item.active');
  return active ? active.dataset.tab : null;
}

function activeLibTab () {
  const active = document.querySelector('.lib-tab.active');
  return active ? active.dataset.lib : null;
}

function refreshActivePage (key) {
  const tab = activeTab();
  if (!tab) return;

  if (key === 'home'     && tab === 'home')     { if (window.renderHome)     window.renderHome();     return; }
  if (key === 'memories' && tab === 'memories') { if (window.renderMemories) window.renderMemories(); return; }
  if (key === 'insights' && tab === 'insights') { if (window.renderInsights) window.renderInsights(); return; }
  if (key === 'settings' && tab === 'settings') { if (window.renderSettings) window.renderSettings(); return; }

  if (tab === 'library') {
    const lib = activeLibTab();
    if (key === 'library-texts'  && lib === 'texts')  { if (window.renderTexts)  window.renderTexts();  return; }
    if (key === 'library-videos' && lib === 'videos') { if (window.renderVideos) window.renderVideos(); return; }
    if (key === 'library-models' && lib === 'models') { if (window.renderModels) window.renderModels(); return; }
  }
}

/* ----------------------------------------------------------
   TAB ROUTING
   ---------------------------------------------------------- */
window.switchTab = function (tab) {
  document.querySelectorAll('.top-tab, .mn-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.page').forEach(pg => {
    pg.classList.toggle('active', pg.id === 'page-' + tab);
  });
  renderPage(tab);
};

function renderPage (tab) {
  switch (tab) {
    case 'home':     if (window.renderHome)     window.renderHome();     break;
    case 'memories': if (window.renderMemories) window.renderMemories(); break;
    case 'insights': if (window.renderInsights) window.renderInsights(); break;
    case 'settings': if (window.renderSettings) window.renderSettings(); break;
    case 'library': {
      const lib = activeLibTab() || 'texts';
      switchLib(lib);
      break;
    }
  }
}

/* ----------------------------------------------------------
   LIBRARY SUB-ROUTING
   ---------------------------------------------------------- */
window.renderLibSub = function (lib) {
  switch (lib) {
    case 'texts':  if (window.renderTexts)  window.renderTexts();  break;
    case 'videos': if (window.renderVideos) window.renderVideos(); break;
    case 'models': if (window.renderModels) window.renderModels(); break;
  }
};

function switchLib (lib) {
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lib === lib);
  });
  document.querySelectorAll('.lib-sub').forEach(sub => {
    sub.classList.toggle('active', sub.id === 'lib' + _capitalize(lib));
  });
  window.renderLibSub(lib);
}

/* ----------------------------------------------------------
   BIND NAV BUTTONS
   ---------------------------------------------------------- */
function bindNav () {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => window.switchTab(btn.dataset.tab));
  });
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', () => switchLib(btn.dataset.lib));
  });
}

document.addEventListener('DOMContentLoaded', bindNav);
