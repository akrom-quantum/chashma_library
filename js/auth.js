/* ============================================================
   auth.js — Chashma Authentication & Session Management
   Depends on: window.db, window.auth, window.OWNER, window.Utils
   Exports:    window.showAuth, window.showApp, window.updateDayCtr
   ============================================================ */

(() => {
  /* ── Initial loading state ───────────────────────────────── */
  document.getElementById('authScreen')?.classList.add('hidden');
  document.getElementById('loadingScreen')?.classList.remove('hidden');

  /* ── Helpers (local shortcuts) ───────────────────────────── */
  const $  = id => document.getElementById(id);
  const lsS = (k, v) => localStorage.setItem(k, v);
  const lsG = k => localStorage.getItem(k);

  /* ── 1. AUTH TAB SWITCHING ───────────────────────────────── */
  document.querySelectorAll('[data-auth]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.auth; // 'signin' | 'signup'

      document.querySelectorAll('[data-auth]').forEach(b =>
        b.classList.toggle('active', b.dataset.auth === target)
      );

      $('panelSignin')?.classList.toggle('hidden', target !== 'signin');
      $('panelSignup')?.classList.toggle('hidden', target !== 'signup');
    });
  });

  /* ── 2. SIGN IN ──────────────────────────────────────────── */
  const SIGNIN_ERRORS = {
    'auth/user-not-found':     'No account found with this email.',
    'auth/wrong-password':     'Incorrect password. Please try again.',
    'auth/invalid-email':      'Please enter a valid email address.',
    'auth/too-many-requests':  'Too many attempts. Try again later or reset your password.',
  };

  $('btnSignIn')?.addEventListener('click', async () => {
    const email = $('siEmail')?.value.trim();
    const pass  = $('siPass')?.value;
    const errEl = $('siErr');

    if (errEl) errEl.textContent = '';

    if (!email || !pass) {
      if (errEl) errEl.textContent = 'Please fill in all fields.';
      return;
    }

    try {
      await window.auth.signInWithEmailAndPassword(email, pass);
    } catch (err) {
      if (errEl)
        errEl.textContent = SIGNIN_ERRORS[err.code] || 'Sign in failed. Please try again.';
    }
  });

  /* ── 3. SIGN UP ──────────────────────────────────────────── */
  $('btnSignUp')?.addEventListener('click', async () => {
    const name  = $('suName')?.value.trim();
    const email = $('suEmail')?.value.trim();
    const pass  = $('suPass')?.value;
    const errEl = $('suErr');

    if (errEl) errEl.textContent = '';

    if (!name) {
      if (errEl) errEl.textContent = 'Display name is required.';
      return;
    }
    if (!email) {
      if (errEl) errEl.textContent = 'Email is required.';
      return;
    }
    if (!pass || pass.length < 6) {
      if (errEl) errEl.textContent = 'Password must be at least 6 characters.';
      return;
    }

    try {
      const cred = await window.auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name });
    } catch (err) {
      const msg = {
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/invalid-email':        'Please enter a valid email address.',
        'auth/weak-password':        'Password is too weak.',
      }[err.code] || 'Sign up failed. Please try again.';
      if (errEl) errEl.textContent = msg;
    }
  });

  /* ── 4. GOOGLE SIGN IN ───────────────────────────────────── */
  async function googleSignIn() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await window.auth.signInWithPopup(provider);
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        console.error('Google sign-in error:', err);
        window.Utils?.showToast?.('Google sign-in failed. Please try again.');
      }
    }
  }

  $('btnGoogle')?.addEventListener('click', googleSignIn);
  $('btnGoogle2')?.addEventListener('click', googleSignIn);

  window.googleSignIn = googleSignIn;

  /* ── 5. SIGN OUT ─────────────────────────────────────────── */
  $('btnSignOut')?.addEventListener('click', async () => {
    // Unsubscribe all active Firestore listeners
    if (window.unsubs && typeof window.unsubs === 'object') {
      Object.values(window.unsubs).forEach(unsub => {
        if (typeof unsub === 'function') unsub();
      });
      window.unsubs = {};
    }

    window.closeDrops?.();
    await window.auth.signOut();
  });

  /* ── 6. DETERMINE ROLE ───────────────────────────────────── */
  async function determineRole(user) {
    // Fetch OWNER from config if not already set
    let ownerEmail = window.OWNER;
    if (!ownerEmail) {
      try {
        const configDoc = await window.db.doc('config/app').get();
        ownerEmail = configDoc.data()?.ownerEmail || '';
        window.OWNER = ownerEmail;
      } catch (_) {}
    }

    if (user.email && user.email === ownerEmail) {
      window.userRole = 'owner';
      return 'owner';
    }

    try {
      const adminDoc = await window.db.doc(`admins/${user.uid}`).get();
      if (adminDoc.exists) {
        window.userRole = 'admin';
        return 'admin';
      }
    } catch (_) {}

    window.userRole = 'reader';
    return 'reader';
  }

  /* ── 7. AUTH STATE CHANGE ────────────────────────────────── */
  let authSettled = false;

  window.auth.onAuthStateChanged(async user => {
    authSettled = true;

    if (!user) {
      window.currentUser = null;
      window.userRole    = null;
      // Grace period — avoid flashing auth screen on slow cold starts
      setTimeout(() => {
        if (!window.currentUser) showAuth();
      }, 600);
      return;
    }

    /* ── Set current user immediately ── */
    window.currentUser = user;

    /* ── Fetch OWNER email from config ── */
    try {
      const configDoc = await window.db.doc('config/app').get();
      if (configDoc.exists && configDoc.data()?.ownerEmail) {
        window.OWNER = configDoc.data().ownerEmail;
      }
    } catch (_) {}

    /* ── Determine role ── */
    const role = await determineRole(user);

    /* ── Fetch or create users doc ── */
    const userRef = window.db.doc(`users/${user.uid}`);
    try {
      const userDoc = await userRef.get();
      const now = firebase.firestore.FieldValue.serverTimestamp();

      if (!userDoc.exists) {
        const newData = {
          joinedAt:  now,
          lastSeen:  now,
          name:      user.displayName || '',
          email:     user.email       || '',
          photoURL:  user.photoURL    || '',
          role,
        };
        await userRef.set(newData);
        // For joinedAt we need the actual date — re-fetch after set
        const fresh = await userRef.get();
        window.userJoinDate = fresh.data()?.joinedAt?.toDate?.() || new Date();
      } else {
        await userRef.update({
          lastSeen: now,
          name:     user.displayName || userDoc.data().name || '',
          email:    user.email       || userDoc.data().email || '',
          photoURL: user.photoURL    || userDoc.data().photoURL || '',
        });
        window.userJoinDate = userDoc.data()?.joinedAt?.toDate?.() || new Date();
      }
    } catch (err) {
      console.error('User doc error:', err);
      window.userJoinDate = new Date();
    }

    /* ── Show app UI ── */
    showApp(user);
    window.setupListeners?.();
    window.loadNotifs?.();

    /* ── Access banner for readers ── */
    if (role === 'reader') {
      const DISMISS_KEY = 'chashma_ban_dismissed';
      if (!lsG(DISMISS_KEY)) {
        try {
          const reqSnap = await window.db
            .collection('accessRequests')
            .where('uid', '==', user.uid)
            .where('status', '==', 'pending')
            .get();
          if (reqSnap.empty) {
            $('accessBanner')?.classList.remove('hidden');
          }
        } catch (_) {
          $('accessBanner')?.classList.remove('hidden');
        }
      }
    }
  });

  /* ── 8. SHOW AUTH ────────────────────────────────────────── */
  function showAuth() {
    $('authScreen')?.classList.remove('hidden');
    $('loadingScreen')?.classList.add('hidden');
    $('appShell')?.classList.remove('visible');
  }

  /* ── 9. SHOW APP ─────────────────────────────────────────── */
  function showApp(user) {
    $('authScreen')?.classList.add('hidden');
    $('loadingScreen')?.classList.add('hidden');
    $('appShell')?.classList.add('visible');

    /* Avatars */
    const PERSON_ICON = `<span class="material-symbols-outlined">person</span>`;
    [$('profileAv'), $('ddAv')].forEach(el => {
      if (!el) return;
      if (user.photoURL) {
        el.innerHTML = `<img src="${user.photoURL}" alt="avatar" referrerpolicy="no-referrer">`;
      } else {
        el.innerHTML = PERSON_ICON;
      }
    });

    /* Name & role badge */
    const ddName = $('ddName');
    if (ddName) ddName.textContent = user.displayName || user.email || 'User';

    const ddRole = $('ddRole');
    if (ddRole) ddRole.textContent = window.userRole || 'reader';

    /* Editable-only elements */
    const canEdit = window.isEdit?.() ?? false;
    document.querySelectorAll('.editable-only').forEach(el => {
      el.classList.toggle('hidden', !canEdit);
    });

    /* Settings panel */
    $('ownerSet')?.classList.toggle('hidden', window.userRole !== 'owner');
    $('readerSet')?.classList.toggle('hidden', window.userRole !== 'reader');

    if (window.userRole === 'reader') {
      window.setupReaderSettings?.();
    }

    /* Day counter */
    updateDayCtr();

    /* Navigate to home tab */
    window.switchTab?.('home');
  }

  /* ── 10. DAY COUNTER ─────────────────────────────────────── */
  function updateDayCtr() {
    const joined  = window.userJoinDate;
    const dayNum  = $('dayNum');
    const ddStreak = $('ddStreak');

    if (!joined) return;

    const msPerDay = 86_400_000;
    const days = Math.floor((Date.now() - joined.getTime()) / msPerDay);

    if (dayNum) dayNum.textContent = days;

    if (ddStreak) {
      ddStreak.innerHTML =
        `<span class="material-symbols-outlined">local_fire_department</span>` +
        `<span>${days} day${days !== 1 ? 's' : ''}</span>`;
    }
  }

  /* ── 11. ACCESS BANNER ───────────────────────────────────── */
  const DISMISS_KEY = 'chashma_ban_dismissed';

  $('btnBanDis')?.addEventListener('click', () => {
    $('accessBanner')?.classList.add('hidden');
    lsS(DISMISS_KEY, '1');
  });

  $('btnBanReq')?.addEventListener('click', async () => {
    $('accessBanner')?.classList.add('hidden');
    const user = window.currentUser;
    if (!user) return;

    try {
      await window.db.collection('accessRequests').add({
        uid:       user.uid,
        name:      user.displayName || '',
        email:     user.email       || '',
        photoURL:  user.photoURL    || '',
        status:    'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      window.Utils?.showToast?.('Access request sent! The owner will review it shortly.');
    } catch (err) {
      console.error('Access request failed:', err);
      window.Utils?.showToast?.('Failed to send request. Please try again.');
    }
  });

  /* ── Exports ─────────────────────────────────────────────── */
  window.showAuth      = showAuth;
  window.showApp       = showApp;
  window.updateDayCtr  = updateDayCtr;
})();
