/* ============================================================
   auth.js — Chashma: The Archive
   ============================================================ */

(() => {
  const $ = id => document.getElementById(id);

  /* ── Show / Hide (HTML attribute, not class) ─────────────── */
  function show(id) { const el = $(id); if (el) { el.removeAttribute('hidden'); el.style.display = ''; } }
  function hide(id) { const el = $(id); if (el) { el.setAttribute('hidden', ''); el.style.display = 'none'; } }

  /* ── Initial state ───────────────────────────────────────── */
  hide('authScreen');
  hide('appShell');
  show('loadingScreen');

  /* ── Tab switching ───────────────────────────────────────── */
  function setTab(tab) {
    $('panelSignin')?.classList.toggle('active', tab === 'signin');
    $('panelSignup')?.classList.toggle('active', tab === 'signup');
  }

  document.querySelectorAll('[data-auth]').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.auth));
  });

  setTab('signin'); // default

  /* ── Errors ──────────────────────────────────────────────── */
  const ERRORS = {
    'auth/user-not-found':          'No account with this email.',
    'auth/wrong-password':          'Wrong password.',
    'auth/invalid-email':           'Invalid email address.',
    'auth/too-many-requests':       'Too many attempts. Try again later.',
    'auth/invalid-credential':      'Incorrect email or password.',
    'auth/email-already-in-use':    'An account with this email already exists.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/operation-not-allowed':   'Email/password sign-in is not enabled. Enable it in the Firebase console → Authentication → Sign-in methods.',
    'auth/network-request-failed':  'Network error. Check your connection.',
    'auth/popup-blocked':           'Popup blocked. Allow popups for this site.',
    'fill':                         'Please fill in all fields.',
  };

  function showErr(elId, code) {
    const el = $(elId);
    if (el) el.textContent = ERRORS[code] || ('Error: ' + (code || 'unknown'));
  }
  function clearErr(elId) {
    const el = $(elId); if (el) el.textContent = '';
  }

  /* ── Email Sign In ───────────────────────────────────────── */
  $('btnSignIn')?.addEventListener('click', async () => {
    clearErr('siErr');
    const email = $('siEmail')?.value.trim();
    const pass  = $('siPass')?.value;
    if (!email || !pass) { showErr('siErr', 'fill'); return; }
    try {
      await window.auth.signInWithEmailAndPassword(email, pass);
    } catch (err) { showErr('siErr', err.code); }
  });

  /* ── Email Sign Up ───────────────────────────────────────── */
  $('btnSignUp')?.addEventListener('click', async () => {
    clearErr('suErr');
    const name  = $('suName')?.value.trim();
    const email = $('suEmail')?.value.trim();
    const pass  = $('suPass')?.value;
    if (!name)               { $('suErr').textContent = 'Name is required.';           return; }
    if (!email)              { $('suErr').textContent = 'Email is required.';          return; }
    if (!pass||pass.length<6){ $('suErr').textContent = 'Password: min 6 characters.'; return; }
    try {
      const cred = await window.auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name });
    } catch (err) { showErr('suErr', err.code); }
  });

  /* ── Google — popup (works on file:// and https://) ─────── */
  async function googleSignIn() {
    clearErr('siErr');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await window.auth.signInWithPopup(provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showErr('siErr', err.code);
        console.error('Google sign-in:', err);
      }
    }
  }

  $('btnGoogle')?.addEventListener('click',  googleSignIn);
  $('btnGoogle2')?.addEventListener('click', googleSignIn);
  window.googleSignIn = googleSignIn;

  /* ── Sign Out ────────────────────────────────────────────── */
  $('btnSignOut')?.addEventListener('click', async () => {
    if (window.unsubs) {
      Object.values(window.unsubs).forEach(fn => { if (typeof fn === 'function') fn(); });
      window.unsubs = {};
    }
    window.closeDrops?.();
    await window.auth.signOut();
  });

  /* ── Determine Role ──────────────────────────────────────── */
  async function determineRole(user) {
    if (!window.OWNER) {
      try {
        const cfg = await window.db.collection('config').doc('app').get();
        window.OWNER = cfg.data()?.ownerEmail || '';
      } catch (_) {}
    }
    if (user.email === window.OWNER) return 'owner';
    try {
      const adminDoc = await window.db.collection('admins').doc(user.email).get();
      if (adminDoc.exists) return 'admin';
    } catch (_) {}
    return 'reader';
  }

  /* ── Auth State ──────────────────────────────────────────── */
  window.auth.onAuthStateChanged(async user => {
    if (!user) {
      window.currentUser = null;
      window.userRole    = null;
      showAuthScreen();
      return;
    }

    window.currentUser = user;

    try {
      const cfg = await window.db.collection('config').doc('app').get();
      if (cfg.exists && cfg.data()?.ownerEmail) window.OWNER = cfg.data().ownerEmail;
    } catch (_) {}

    const role = await determineRole(user);
    window.userRole = role;

    // Upsert user doc
    const ek      = (user.email || '').replace(/\./g, '_');
    const userRef = window.db.collection('users').doc(ek);
    const now     = firebase.firestore.FieldValue.serverTimestamp();

    // Show app immediately — don't wait for user doc upsert
    showApp(user);
    window.setupListeners?.();
    window.loadNotifs?.();

    // User doc upsert in background (non-blocking)
    userRef.get().then(snap => {
      if (!snap.exists) {
        return userRef.set({
          joinedAt: now, lastSeen: now,
          name: user.displayName || '', email: user.email || '',
          photoURL: user.photoURL || '', role,
        }).then(() => userRef.get()).then(fresh => {
          window.userJoinDate = fresh.data()?.joinedAt?.toDate?.() || new Date();
          window.updateDayCtr?.();
        });
      } else {
        window.userJoinDate = snap.data()?.joinedAt?.toDate?.() || new Date();
        window.updateDayCtr?.();
        return userRef.update({
          lastSeen: now,
          name:     user.displayName || snap.data().name     || '',
          email:    user.email       || snap.data().email    || '',
          photoURL: user.photoURL    || snap.data().photoURL || '',
        });
      }
    }).catch(err => {
      console.error('User doc error:', err);
      if (!window.userJoinDate) { window.userJoinDate = new Date(); window.updateDayCtr?.(); }
    });

    // Access banner
    if (role === 'reader' && !localStorage.getItem('chashma_ban_dismissed')) {
      try {
        const reqSnap = await window.db.collection('accessRequests')
          .where('email', '==', user.email).where('status', '==', 'pending').get();
        if (reqSnap.empty) show('accessBanner');
      } catch (_) { show('accessBanner'); }
    }
  });

  /* ── Show Auth ───────────────────────────────────────────── */
  function showAuthScreen() {
    hide('appShell');
    hide('loadingScreen');
    show('authScreen');
    // Force clickability
    const auth = $('authScreen');
    if (auth) {
      auth.style.zIndex        = '9000';
      auth.style.pointerEvents = 'all';
    }
  }

  /* ── Show App ────────────────────────────────────────────── */
  function showApp(user) {
    hide('authScreen');
    hide('loadingScreen');
    show('appShell');
    $('appShell')?.classList.add('visible');

    const ICON = `<span class="material-symbols-outlined">person</span>`;
    [$('profileAv'), $('ddAv')].forEach(el => {
      if (!el) return;
      el.innerHTML = user.photoURL
        ? `<img src="${user.photoURL}" alt="avatar" referrerpolicy="no-referrer">`
        : ICON;
    });

    const ddName = $('ddName'); if (ddName) ddName.textContent = user.displayName || user.email || 'User';
    const ddRole = $('ddRole'); if (ddRole) ddRole.textContent = window.userRole || 'reader';

    const canEdit = window.userRole === 'owner' || window.userRole === 'admin';
    document.querySelectorAll('.editable-only').forEach(el =>
      el.classList.toggle('hidden', !canEdit)
    );

    const ownerSet  = $('ownerSet');  if (ownerSet)  ownerSet.style.display  = window.userRole === 'owner'  ? '' : 'none';
    const readerSet = $('readerSet'); if (readerSet) readerSet.style.display = window.userRole === 'reader' ? '' : 'none';
    if (window.userRole === 'reader') window.setupReaderSettings?.();

    updateDayCtr();
    window.switchTab?.('home');
  }

  /* ── Day Counter ─────────────────────────────────────────── */
  function updateDayCtr() {
    const joined = window.userJoinDate;
    if (!joined) return;
    const days   = Math.floor((Date.now() - joined.getTime()) / 86_400_000);
    const dayNum = $('dayNum'); if (dayNum) dayNum.textContent = days;
    const ddStreak = $('ddStreak');
    if (ddStreak) ddStreak.innerHTML =
      `<span class="material-symbols-outlined">local_fire_department</span>` +
      `<span>${days} day${days !== 1 ? 's' : ''}</span>`;
  }

  /* ── Access Banner ───────────────────────────────────────── */
  $('btnBanDis')?.addEventListener('click', () => {
    hide('accessBanner');
    localStorage.setItem('chashma_ban_dismissed', '1');
  });

  $('btnBanReq')?.addEventListener('click', async () => {
    hide('accessBanner');
    const user = window.currentUser;
    if (!user) return;
    try {
      await window.db.collection('accessRequests').add({
        uid: user.uid, name: user.displayName || '',
        email: user.email || '', photoURL: user.photoURL || '',
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      window.showToast?.('Access request sent!');
    } catch (_) { window.showToast?.('Failed to send request.', 'err'); }
  });

  /* ── Exports ─────────────────────────────────────────────── */
  window.showAuth     = showAuthScreen;
  window.showApp      = showApp;
  window.updateDayCtr = updateDayCtr;

})();
