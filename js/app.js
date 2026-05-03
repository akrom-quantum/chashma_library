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
   FIRESTORE LISTENERS
   ---------------------------------------------------------- */
window.setupListeners = function () {
  const { ek, isOwner, myRC, totalR } = Utils;
  const role = window.userRole;

  /* ── texts ── */
  window.unsubs.texts = db.collection('texts')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.texts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-texts');
      refreshActivePage('home');
    });

  /* ── videos ── */
  window.unsubs.videos = db.collection('videos')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-videos');
      refreshActivePage('home');
    });

  /* ── models ── */
  window.unsubs.models = db.collection('models')
    .orderBy('order', 'asc')
    .onSnapshot(snap => {
      window.models = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('library-models');
      refreshActivePage('home');
    });

  /* ── memories ── */
  window.unsubs.memories = db.collection('memories')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      window.memories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateCounts();
      refreshActivePage('memories');
      refreshActivePage('home');
    });

  /* ── owner-only real-time subscriptions ── */
  if (isOwner()) {
    window.unsubs.accessRequests = db.collection('accessRequests')
      .where('status', '==', 'pending')
      .onSnapshot(snap => {
        window.accessRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshActivePage('settings');
      });

    window.unsubs.admins = db.collection('admins')
      .onSnapshot(snap => {
        window.admins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshActivePage('settings');
      });

    window.unsubs.allUsers = db.collection('users')
      .onSnapshot(snap => {
        window.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        refreshActivePage('settings');
        refreshActivePage('insights');
        refreshActivePage('home');
      });
  } else {
    /* readers: one-time get for users list (for leaderboard display) */
    db.collection('users').get().then(snap => {
      window.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).catch(console.error);
  }
};

/* ----------------------------------------------------------
   COUNT BADGES
   ---------------------------------------------------------- */
function updateCounts () {
  /* lib-subnav badges */
  _setBadge('cntTexts',  window.texts.filter(t => !t.hidden).length);
  _setBadge('cntVideos', window.videos.filter(v => !v.hidden).length);
  _setBadge('cntModels', window.models.filter(m => !m.hidden).length);

  /* stat cards on home page (if rendered) */
  _setStatCard('stat-texts',   window.texts);
  _setStatCard('stat-videos',  window.videos);
  _setStatCard('stat-models',  window.models);
  _setStatCard('stat-memories', window.memories);
}

function _setBadge (id, count) {
  const el = Utils.$(id);
  if (!el) return;
  el.textContent = count;
}

function _setStatCard (cls, items) {
  /* Stat cards re-render themselves via renderHome(); nothing extra needed here
     unless we want lightweight live updates without full re-render. */
}

/* ----------------------------------------------------------
   ACTIVE PAGE DETECTION
   ---------------------------------------------------------- */

/* Returns the currently active tab id (e.g. 'home', 'library', 'memories') */
function activeTab () {
  const active = document.querySelector('.top-tab.active, .mn-item.active');
  return active ? active.dataset.tab : null;
}

/* Returns the currently active library sub-tab */
function activeLibTab () {
  const active = document.querySelector('.lib-tab.active');
  return active ? active.dataset.lib : null;
}

/* Trigger a re-render only if the relevant page/subtab is currently visible.
   key can be: 'home' | 'library-texts' | 'library-videos' | 'library-models'
             | 'memories' | 'insights' | 'settings' */
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
  /* Highlight nav buttons */
  document.querySelectorAll('.top-tab, .mn-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  /* Show/hide pages */
  document.querySelectorAll('.page').forEach(pg => {
    pg.classList.toggle('active', pg.id === 'page-' + tab);
  });

  renderPage(tab);
};

function renderPage (tab) {
  switch (tab) {
    case 'home':
      if (window.renderHome) window.renderHome();
      break;
    case 'library': {
      const lib = activeLibTab() || 'texts';
      renderLibSub(lib);
      break;
    }
    case 'memories':
      if (window.renderMemories) window.renderMemories();
      break;
    case 'insights':
      if (window.renderInsights) window.renderInsights();
      break;
    case 'settings':
      if (window.renderSettings) window.renderSettings();
      break;
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
  /* Toggle active class on lib-tab buttons */
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lib === lib);
  });

  /* Toggle active class on .lib-sub divs */
  document.querySelectorAll('.lib-sub').forEach(sub => {
    sub.classList.toggle('active', sub.id === 'lib' + _capitalize(lib));
  });

  window.renderLibSub(lib);
}

function _capitalize (s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ----------------------------------------------------------
   BIND NAV BUTTONS
   ---------------------------------------------------------- */
function bindNav () {
  /* Top tabs + mobile nav */
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => window.switchTab(btn.dataset.tab));
  });

  /* Library sub-tabs */
  document.querySelectorAll('.lib-tab').forEach(btn => {
    btn.addEventListener('click', () => switchLib(btn.dataset.lib));
  });
}

/* ----------------------------------------------------------
   DOM READY INIT
   ---------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  bindNav();

  /* Theme is applied by settings.js on load:
     applyTheme(lsG('ch_theme') || 'light')
     — no need to duplicate here. */
});

/* ----------------------------------------------------------
   EXPOSE
   ---------------------------------------------------------- */
window.switchTab    = window.switchTab;    // already set above
window.renderLibSub = window.renderLibSub; // already set above
window.setupListeners = window.setupListeners; // already set above
