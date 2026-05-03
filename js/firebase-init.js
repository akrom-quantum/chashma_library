/* ═══════════════════════════════════════════════════════════════
   firebase-init.js — Chashma: The Archive
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

// Keep auth session across browser restarts
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

window.OWNER = '';
