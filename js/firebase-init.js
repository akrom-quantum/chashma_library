/* ═══════════════════════════════════════════════════════════════
   firebase-init.js — Chashma: The Archive
   Initializes Firebase app, exposes db + auth as window globals.
════════════════════════════════════════════════════════════════ */
const firebaseConfig = {
  apiKey:            'AIzaSyDr6Ff7QsmtEOmE-AtAWmTOOYWO8Nf4Dnk',
  authDomain:        'chashma-akrom.firebaseapp.com',
  projectId:         'chashma-akrom',
  storageBucket:     'chashma-akrom.firebasestorage.app',
  messagingSenderId: '81405507085',
  appId:             '1:81405507085:web:4c9e891715374987454744'
};

firebase.initializeApp(firebaseConfig);
window.auth = firebase.auth();
window.db   = firebase.firestore();

// Offline persistence — silent fail (multiple tabs or private mode)
db.settings({ cache: { kind: 'persistent' } });

// Keep auth session across browser restarts
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

// Global owner email — set by auth.js after sign-in
window.OWNER = '';
