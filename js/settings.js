/* ============================================================
   settings.js — Chashma: The Archive
   All Firebase calls use the COMPAT SDK (window.db.collection etc.)
   NO modular imports whatsoever.
   ============================================================ */

(function () {
  'use strict';

  const U = window.Utils;

  const CONTENT_COLS = ['texts', 'videos', 'models', 'memories'];

  function allItems() {
    return [
      ...(window.texts    || []),
      ...(window.videos   || []),
      ...(window.models   || []),
      ...(window.memories || []),
    ];
  }

  // ═══════════════════════════════════════════════════════════
  // THEME
  // ═══════════════════════════════════════════════════════════

  function applyTheme(t) {
    const theme = (t === 'dark') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ch_theme', theme); } catch(e) {}
    const icon = theme === 'dark' ? '☀️' : '🌙';
    document.querySelectorAll('#themeBtn, #setThemeBtn').forEach(btn => {
      if (btn) btn.textContent = icon;
    });
  }

  // Init theme immediately — no Utils dependency
  (function () {
    var saved;
    try { saved = localStorage.getItem('ch_theme'); } catch(e) {}
    applyTheme(saved || 'light');
  })();

  // ═══════════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════════

  let _toastTimer = null;

  function showToast(msg, type) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'show' + (type ? ' ' + type : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = ''; }, 2800);
  }

  // ═══════════════════════════════════════════════════════════
  // MODAL HELPERS
  // ═══════════════════════════════════════════════════════════

  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  function _bindModals() {
    document.querySelectorAll('[id^="close"][id$="M"], [id^="cancel"][id$="M"], .modal-close')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          const ov = btn.closest('.modal-ov, .overlay');
          if (ov) ov.classList.remove('open');
        });
      });

    document.querySelectorAll('.modal-ov, .overlay').forEach(ov => {
      ov.addEventListener('click', e => {
        if (e.target === ov) ov.classList.remove('open');
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.modal-ov.open, .overlay.open')];
      if (open.length) open[open.length - 1].classList.remove('open');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DROPDOWNS
  // ═══════════════════════════════════════════════════════════

  function closeDrops() {
    document.getElementById('profileDd')?.classList.remove('open');
    document.getElementById('notifPanel')?.classList.remove('open');
  }

  function _bindDropdowns() {
    const profileAv  = document.getElementById('profileAv');
    const profileDd  = document.getElementById('profileDd');
    const notifBtn   = document.getElementById('notifBtn');
    const notifPanel = document.getElementById('notifPanel');
    const brandBtn   = document.getElementById('brandBtn');

    profileAv?.addEventListener('click', e => {
      e.stopPropagation();
      profileDd?.classList.toggle('open');
      notifPanel?.classList.remove('open');
    });

    notifBtn?.addEventListener('click', e => {
      e.stopPropagation();
      notifPanel?.classList.toggle('open');
      profileDd?.classList.remove('open');
    });

    document.addEventListener('click', () => closeDrops());

    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeDrops();
        window.switchTab?.(btn.dataset.goto);
      });
    });

    document.querySelectorAll('.stat-card[data-goto]').forEach(card => {
      card.addEventListener('click', () => {
        closeDrops();
        window.switchTab?.(card.dataset.goto);
      });
    });

    brandBtn?.addEventListener('click', () => {
      closeDrops();
      window.switchTab?.('home');
    });

    document.getElementById('themeBtn')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('setThemeBtn')?.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════

  let _notifUnsubs = [];
  let _notifItems  = [];

  function _getLastSeen() {
    try { return Number(localStorage.getItem('ch_lastSeen')) || 0; } catch(e) { return 0; }
  }

  function loadNotifs() {
    _notifUnsubs.forEach(fn => fn());
    _notifUnsubs = [];
    _notifItems  = [];

    const uid = window.currentUser?.uid;
    if (!uid || !window.db) return;

    const cols = [
      { name: 'texts',    label: 'Text' },
      { name: 'videos',   label: 'Video' },
      { name: 'models',   label: 'Model' },
      { name: 'memories', label: 'Memory' },
    ];

    cols.forEach(({ name, label }) => {
      const unsub = window.db.collection(name)
        .onSnapshot(snap => {
          _notifItems = _notifItems.filter(n => n.col !== name);
          snap.forEach(d => {
            const data = d.data();
            const ts   = data.createdAt?.toMillis
              ? data.createdAt.toMillis()
              : (data.createdAt ? new Date(data.createdAt).getTime() : 0);
            if (ts > _getLastSeen() && data.authorId !== uid) {
              _notifItems.push({
                id:       d.id,
                col:      name,
                colLabel: label,
                title:    data.title || data.name || '(untitled)',
                createdAt: ts,
              });
            }
          });
          renderNotifs();
        }, err => console.warn('loadNotifs [' + name + ']:', err));

      _notifUnsubs.push(unsub);
    });
  }

  function renderNotifs() {
    const badge = document.getElementById('notifBadge');
    const list  = document.getElementById('notifList');
    const count = _notifItems.length;

    if (badge) {
      badge.textContent   = count > 9 ? '9+' : String(count);
      badge.style.display = count > 0 ? '' : 'none';
    }

    if (!list) return;

    if (!count) {
      list.innerHTML = '<p class="notif-empty">All caught up ✓</p>';
      return;
    }

    const sorted = [..._notifItems].sort((a, b) => b.createdAt - a.createdAt);
    list.innerHTML = sorted.map(n => `
      <div class="notif-item" data-col="${U.esc(n.col)}" data-id="${U.esc(n.id)}">
        <span class="notif-col">${U.esc(n.colLabel)}</span>
        <span class="notif-title">${U.esc(n.title)}</span>
      </div>`).join('');
  }

  function _bindNotifs() {
    document.getElementById('notifClr')?.addEventListener('click', () => {
      try { localStorage.setItem('ch_lastSeen', Date.now()); } catch(e) {}
      _notifItems = [];
      renderNotifs();
    });

    document.getElementById('btnResetNotifs')?.addEventListener('click', () => {
      try { localStorage.setItem('ch_lastSeen', '0'); } catch(e) {}
      showToast('Notification timestamp reset.');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ═══════════════════════════════════════════════════════════

  function logAct(id, col, type) {
    const ek = U.ek();
    if (!ek || !window.db) return;

    const today = U.todayStr();
    const docId = today + '__' + ek;
    const field = col + '__' + type;

    window.db.collection('activityLog').doc(docId).set({
      uid:   window.currentUser?.uid   || '',
      email: window.currentUser?.email || '',
      name:  window.currentUser?.displayName || '',
      ts:    firebase.firestore.FieldValue.serverTimestamp(),
      [field]: firebase.firestore.FieldValue.increment(1),
    }, { merge: true }).catch(err => console.warn('logAct:', err));
  }

  // ═══════════════════════════════════════════════════════════
  // READ / RATE
  // ═══════════════════════════════════════════════════════════

  let _pendingReadId  = null;
  let _pendingReadCol = null;

  function incRead(id, col) {
    const ek = U.ek();
    if (!ek || !id || !col) return;

    window.db.collection(col).doc(id).update({
      ['readCounts.' + ek]: firebase.firestore.FieldValue.increment(1),
    }).then(() => {
      const item = (window[col] || []).find(x => x.id === id);
      if (item) {
        item.readCounts = item.readCounts || {};
        item.readCounts[ek] = (item.readCounts[ek] || 0) + 1;
      }
      logAct(id, col, 'read');
      showToast('Marked as read!');
    }).catch(err => {
      console.error('incRead:', err);
      showToast('Failed to mark read.', 'err');
    });
  }

  function handleMarkRead(id, col, item) {
    if (!item) item = (window[col] || []).find(x => x.id === id);
    if (!item) return;

    if (U.myRC(item) === 0) {
      incRead(id, col);
    } else {
      _pendingReadId  = id;
      _pendingReadCol = col;
      const countEl = document.getElementById('raCount');
      if (countEl) countEl.textContent = U.myRC(item);
      openModal('ov-ra');
    }
  }

  function _bindReadAgain() {
    document.getElementById('raYes')?.addEventListener('click', () => {
      closeModal('ov-ra');
      if (_pendingReadId && _pendingReadCol) incRead(_pendingReadId, _pendingReadCol);
      _pendingReadId = _pendingReadCol = null;
    });
    document.getElementById('raNo')?.addEventListener('click', () => {
      closeModal('ov-ra');
      _pendingReadId = _pendingReadCol = null;
    });
  }

  // ─── RATE MODAL ───────────────────────────────────────────

  let _pendingRateId  = null;
  let _pendingRateCol = null;

  function openRateModal(id, col) {
    const item = (window[col] || []).find(x => x.id === id);
    if (!item) return;
    _pendingRateId  = id;
    _pendingRateCol = col;

    const existing = (item.ratings ?? {})[U.ek()] || 0;
    const prompt   = document.getElementById('ratePrompt');
    if (prompt) prompt.textContent = 'Rate "' + (item.title || item.name || 'this item') + '"';

    document.querySelectorAll('#ov-rate .star-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.value) <= existing);
    });
    openModal('ov-rate');
  }

  function _bindRateModal() {
    const stars = document.querySelectorAll('#ov-rate .star-btn');

    stars.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const v = Number(btn.dataset.value);
        stars.forEach(s => s.classList.toggle('hover', Number(s.dataset.value) <= v));
      });
      btn.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover'));
      });
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.value);
        stars.forEach(s => s.classList.toggle('active', Number(s.dataset.value) <= val));

        if (!_pendingRateId || !_pendingRateCol) return;
        const ek = U.ek();

        window.db.collection(_pendingRateCol).doc(_pendingRateId).update({
          ['ratings.' + ek]: val,
        }).then(() => {
          const item = (window[_pendingRateCol] || []).find(x => x.id === _pendingRateId);
          if (item) { item.ratings = item.ratings || {}; item.ratings[ek] = val; }
          logAct(_pendingRateId, _pendingRateCol, 'rate');
          showToast('Rated ' + val + '★');
          closeModal('ov-rate');
          _pendingRateId = _pendingRateCol = null;
        }).catch(err => {
          console.error('rate submit:', err);
          showToast('Failed to save rating.', 'err');
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════

  function delItem(col, id) {
    if (!U.isEdit()) { showToast('Not permitted.', 'err'); return; }
    if (!confirm('Delete this item permanently?')) return;

    window.db.collection(col).doc(id).delete().then(() => {
      window[col] = (window[col] || []).filter(x => x.id !== id);
      showToast('Item deleted.');
    }).catch(err => {
      console.error('delItem:', err);
      showToast('Failed to delete.', 'err');
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS — OWNER
  // ═══════════════════════════════════════════════════════════

  function renderSettings() {
    _renderProfile();

    const ownerSet  = document.getElementById('ownerSet');
    const readerSet = document.getElementById('readerSet');

    if (U.isOwner()) {
      if (ownerSet)  { ownerSet.removeAttribute('hidden');  ownerSet.style.display  = ''; }
      if (readerSet) { readerSet.setAttribute('hidden',''); readerSet.style.display = 'none'; }
      _ensureOwnerHtml();

      // Always do a fresh fetch so newly registered users appear immediately
      window.db.collection('users').get().then(snap => {
        const fresh = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.status !== 'removed');
        // Merge: keep live-listener entries that aren't in fresh (edge case)
        const freshEmails = new Set(fresh.map(u => u.email));
        const merged = [
          ...fresh,
          ...(window.allUsers || []).filter(u => !freshEmails.has(u.email)),
        ];
        window.allUsers = merged;
        _renderAllUsers();
      }).catch(() => _renderAllUsers());

      _renderPendingRequests();
      _renderAdmins();
      _bindResetReads();
    } else {
      if (ownerSet)  { ownerSet.setAttribute('hidden','');  ownerSet.style.display  = 'none'; }
      if (readerSet) { readerSet.setAttribute('hidden',''); readerSet.style.display = 'none'; }
    }
  }

  function _ensureOwnerHtml() {
    const el = document.getElementById('ownerSet');
    if (!el || el.dataset.built) return;
    el.dataset.built = '1';
    el.innerHTML = `
      <h2 class="set-heading">User Management</h2>
      <div id="allUsersTbl" class="users-tbl-wrap"></div>

      <h2 class="set-heading" style="margin-top:32px">Pending Access Requests (<span id="pendCnt">0</span>)</h2>
      <div id="pendList"></div>

      <h2 class="set-heading" style="margin-top:32px">Admins</h2>
      <div id="adminList"></div>

      <div class="set-danger">
        <h2 class="set-heading">Danger Zone</h2>
        <button id="btnResetReads" class="btn-danger">Reset all read counts</button>
        <span id="resetSt" style="font-size:.8rem;color:var(--ink-3);margin-left:8px;"></span>
      </div>`;
  }

  /* ── Encoded email key (commas — matches library.js readCounts) */
  function _ek(email) { return (email || '').replace(/\./g, ','); }

  /* ── Per-user stats ─────────────────────────────────────────── */
  function _userStats(email) {
    const ek = _ek(email);

    const textsByS = {};
    (window.texts ?? []).forEach(t => {
      if ((t.readCounts?.[ek] ?? 0) > 0) {
        const s = t.series || '(standalone)';
        textsByS[s] = (textsByS[s] ?? 0) + 1;
      }
    });

    const vidsByS = {};
    (window.videos ?? []).forEach(v => {
      if ((v.readCounts?.[ek] ?? 0) > 0) {
        const s = v.series || '(standalone)';
        vidsByS[s] = (vidsByS[s] ?? 0) + 1;
      }
    });

    const modelsRead = (window.models ?? []).filter(m => (m.readCounts?.[ek] ?? 0) > 0).length;

    return { textsByS, vidsByS, modelsRead };
  }

  function _seriesHtml(map) {
    const entries = Object.entries(map);
    if (!entries.length) return '<span class="stat-zero">0</span>';
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const rows  = entries.map(([s, n]) => `<li>${U.esc(s)}: <strong>${n}</strong></li>`).join('');
    return `<details class="series-det"><summary>${total}</summary><ul>${rows}</ul></details>`;
  }

  /* ── All users table ────────────────────────────────────────── */
  function _renderAllUsers() {
    const el = document.getElementById('allUsersTbl');
    if (!el) return;

    /* deduplicate by email — keep first occurrence */
    const seen  = new Set();
    const users = (window.allUsers ?? []).filter(u => {
      if (!u.email || seen.has(u.email)) return false;
      seen.add(u.email);
      return true;
    });

    const ownerEmail  = window.OWNER || '';
    const adminEmails = new Set((window.admins ?? []).map(a => a.email));

    if (!users.length) {
      el.innerHTML = '<p class="set-empty">No users yet.</p>';
      return;
    }

    const rows = users.map(u => {
      const email = u.email || '';
      const docId = u.id   || '';          /* actual Firestore document ID */
      const name  = u.displayName || u.name || '—';
      const role  = email === ownerEmail ? 'owner'
                  : adminEmails.has(email) ? 'admin'
                  : 'reader';

      const { textsByS, vidsByS, modelsRead } = _userStats(email);
      const isMe = email === (window.currentUser?.email || '');

      return `
        <tr>
          <td class="ut-name">${U.esc(name)}</td>
          <td class="ut-email">${U.esc(email)}</td>
          <td class="ut-role">
            ${role === 'owner'
              ? `<span class="role-badge role-owner">Owner</span>`
              : `<select class="role-sel" data-email="${U.esc(email)}" data-cur="${role}">
                  <option value="reader"  ${role==='reader' ?'selected':''}>Reader</option>
                  <option value="admin"   ${role==='admin'  ?'selected':''}>Admin</option>
                </select>`}
          </td>
          <td class="ut-stat">${_seriesHtml(textsByS)}</td>
          <td class="ut-stat">${_seriesHtml(vidsByS)}</td>
          <td class="ut-stat">${modelsRead || '<span class="stat-zero">0</span>'}</td>
          <td class="ut-act">
            ${!isMe && role !== 'owner'
              ? `<button class="btn-remove-user"
                   data-email="${U.esc(email)}"
                   data-docid="${U.esc(docId)}"
                   title="Remove user">
                  <span class="material-symbols-outlined">person_remove</span>
                 </button>`
              : ''}
          </td>
        </tr>`;
    }).join('');

    el.innerHTML = `
      <table class="users-tbl">
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Role</th>
            <th>Texts read</th><th>Videos watched</th><th>Models read</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    /* role change */
    el.querySelectorAll('.role-sel').forEach(sel => {
      sel.addEventListener('change', () => _changeRole(sel.dataset.email, sel.value, sel.dataset.cur));
    });

    /* remove */
    el.querySelectorAll('.btn-remove-user').forEach(btn => {
      btn.addEventListener('click', () => _removeUser(btn.dataset.email, btn.dataset.docid));
    });
  }

  async function _changeRole(email, newRole, oldRole) {
    if (newRole === oldRole) return;
    const db = window.db;
    try {
      if (newRole === 'admin' && oldRole === 'reader') {
        await db.collection('admins').doc(email).set({
          email, approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
          approvedBy: window.currentUser?.email || '',
        });
      } else if (newRole === 'reader' && oldRole === 'admin') {
        await db.collection('admins').doc(email).delete();
      }
      const ek = email.replace(/\./g, '_');
      await db.collection('users').doc(ek).update({ role: newRole }).catch(() => {});
      if (newRole === 'admin') {
        window.admins = window.admins ?? [];
        window.admins.push({ email });
      } else {
        window.admins = (window.admins ?? []).filter(a => a.email !== email);
      }
      showToast(`${email} is now ${newRole}.`);
      renderSettings();
    } catch (err) {
      console.error('_changeRole:', err);
      showToast('Failed to change role.', 'err');
    }
  }

  async function _removeUser(email, docId) {
    if (!confirm(`Remove ${email}? They will no longer appear in the app.`)) return;
    const db = window.db;
    const payload = {
      status:    'removed',
      removedAt: firebase.firestore.FieldValue.serverTimestamp(),
      removedBy: window.currentUser?.email || '',
    };
    let ok = false;
    /* try with the actual doc ID first, then fallback to computed keys */
    const candidates = [...new Set([
      docId,
      email.replace(/\./g, '_'),
      email.replace(/\./g, ','),
    ])].filter(Boolean);

    for (const id of candidates) {
      try {
        await db.collection('users').doc(id).set(payload, { merge: true });
        ok = true;
        break;
      } catch (err) {
        console.warn('_removeUser attempt', id, err.code);
      }
    }

    await db.collection('admins').doc(email).delete().catch(() => {});

    if (ok) {
      window.allUsers = (window.allUsers ?? []).filter(u => u.email !== email);
      window.admins   = (window.admins   ?? []).filter(a => a.email !== email);
      showToast(`${email} removed.`);
      renderSettings();
    } else {
      showToast('Failed to remove user. Check Firestore rules.', 'err');
    }
  }

  function _renderProfile() {
    const el = document.getElementById('profileSection');
    if (!el) return;

    const user  = window.currentUser;
    const name  = user?.displayName || user?.email?.split('@')[0] || '—';
    const email = user?.email || '—';
    const ek    = U.ek();

    const textsRead = (window.texts ?? []).filter(t => (t.readCounts?.[ek] ?? 0) > 0).length;
    const vidsWatch = (window.videos ?? []).filter(v => (v.readCounts?.[ek] ?? 0) > 0).length;
    const joinDate  = window.userJoinDate
      ? window.userJoinDate.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
      : '—';

    el.innerHTML = `
      <div class="profile-card">
        <div class="profile-av-lg">${U.esc(name.charAt(0).toUpperCase())}</div>
        <div class="profile-info">
          <h2 class="profile-name">${U.esc(name)}</h2>
          <p class="profile-email">${U.esc(email)}</p>
          <p class="profile-joined">Member since ${U.esc(joinDate)}</p>
        </div>
        <div class="profile-stats">
          <div class="pstat">
            <span class="pstat-val">${textsRead}</span>
            <span class="pstat-lbl">Texts read</span>
          </div>
          <div class="pstat">
            <span class="pstat-val">${vidsWatch}</span>
            <span class="pstat-lbl">Videos watched</span>
          </div>
        </div>
      </div>

      <div class="account-edit">
        <h3 class="set-heading">Account</h3>
        <div class="acct-field">
          <label class="acct-label">Full Name</label>
          <div class="acct-row">
            <input id="acctName" class="acct-input" type="text" value="${U.esc(name)}" />
            <button id="btnSaveName" class="btn-save-acct">Save</button>
          </div>
        </div>
        <div class="acct-field">
          <label class="acct-label">Email</label>
          <input class="acct-input acct-disabled" type="email" value="${U.esc(email)}" disabled />
        </div>
        <div class="acct-field">
          <label class="acct-label">New Password</label>
          <div class="acct-row">
            <input id="acctPass" class="acct-input" type="password" placeholder="Min 6 characters" />
            <button id="btnSavePass" class="btn-save-acct">Save</button>
          </div>
        </div>
        <p id="acctMsg" class="acct-msg"></p>
      </div>`;

    document.getElementById('btnSaveName')?.addEventListener('click', _saveName);
    document.getElementById('btnSavePass')?.addEventListener('click', _savePassword);
  }

  async function _saveName() {
    const name = document.getElementById('acctName')?.value.trim();
    if (!name) { _acctMsg('Name cannot be empty.', true); return; }
    try {
      await window.auth.currentUser.updateProfile({ displayName: name });
      const ek = (window.currentUser?.email || '').replace(/\./g, '_');
      await window.db.collection('users').doc(ek).update({ name, displayName: name }).catch(() => {});
      window.currentUser = window.auth.currentUser;
      _acctMsg('Name updated.');
      renderSettings();
    } catch (err) {
      _acctMsg('Failed: ' + (err.message || err.code), true);
    }
  }

  async function _savePassword() {
    const pass = document.getElementById('acctPass')?.value;
    if (!pass || pass.length < 6) { _acctMsg('Password must be at least 6 characters.', true); return; }
    try {
      await window.auth.currentUser.updatePassword(pass);
      document.getElementById('acctPass').value = '';
      _acctMsg('Password updated.');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        _acctMsg('Sign out and sign back in first, then change password.', true);
      } else {
        _acctMsg('Failed: ' + (err.message || err.code), true);
      }
    }
  }

  function _acctMsg(msg, isErr = false) {
    const el = document.getElementById('acctMsg');
    if (!el) return;
    el.textContent  = msg;
    el.className    = 'acct-msg' + (isErr ? ' acct-err' : ' acct-ok');
    setTimeout(() => { el.textContent = ''; el.className = 'acct-msg'; }, 4000);
  }

  function _renderPendingRequests() {
    const list     = document.getElementById('pendList');
    const cntEl    = document.getElementById('pendCnt');
    const requests = (window.accessRequests || []).filter(r => r.status === 'pending');

    if (cntEl) cntEl.textContent = requests.length;
    if (!list) return;

    if (!requests.length) {
      list.innerHTML = '<p class="set-empty">No pending requests.</p>';
      return;
    }

    list.innerHTML = requests.map(r => `
      <div class="req-item">
        <div class="req-info">
          <span class="req-name">${U.esc(r.name || '—')}</span>
          <span class="req-email">${U.esc(r.email || '—')}</span>
          <span class="req-time">${_fmtTs(r.createdAt)}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-approve"
            data-id="${U.esc(r.id)}"
            data-email="${U.esc(r.email || '')}"
            data-name="${U.esc(r.name || '')}">Approve</button>
          <button class="btn-reject" data-id="${U.esc(r.id)}">Reject</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.btn-approve').forEach(btn => {
      btn.addEventListener('click', () => _approveRequest(btn.dataset));
    });
    list.querySelectorAll('.btn-reject').forEach(btn => {
      btn.addEventListener('click', () => _rejectRequest(btn.dataset.id));
    });
  }

  function _approveRequest({ id, email, name }) {
    const db = window.db;

    // Add to admins keyed by email
    db.collection('admins').doc(email).set({
      email:      email || '',
      name:       name  || '',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: window.currentUser?.email || '',
    }).then(() => {
      return db.collection('accessRequests').doc(id).update({ status: 'approved' });
    }).then(() => {
      // Update user doc role
      const ek = (email || '').replace(/\./g, '_');
      return db.collection('users').doc(ek).update({ role: 'admin' }).catch(() => {});
    }).then(() => {
      const req = (window.accessRequests || []).find(r => r.id === id);
      if (req) req.status = 'approved';
      showToast((name || email) + ' approved as admin.');
      renderSettings();
    }).catch(err => {
      console.error('_approveRequest:', err);
      showToast('Failed to approve.', 'err');
    });
  }

  function _rejectRequest(id) {
    window.db.collection('accessRequests').doc(id).update({ status: 'rejected' })
      .then(() => {
        const req = (window.accessRequests || []).find(r => r.id === id);
        if (req) req.status = 'rejected';
        showToast('Request rejected.');
        renderSettings();
      }).catch(err => {
        console.error('_rejectRequest:', err);
        showToast('Failed to reject.', 'err');
      });
  }

  function _renderAdmins() {
    const list   = document.getElementById('adminList');
    const admins = window.admins || [];
    if (!list) return;

    if (!admins.length) {
      list.innerHTML = '<p class="set-empty">No admins yet.</p>';
      return;
    }

    list.innerHTML = admins.map(a => `
      <div class="req-item">
        <div class="req-info">
          <span class="req-name">${U.esc(a.name || '—')}</span>
          <span class="req-email">${U.esc(a.email || '—')}</span>
          <span class="req-time">Approved ${_fmtTs(a.approvedAt)}</span>
        </div>
        <button class="btn-revoke" data-id="${U.esc(a.id || a.email || '')}">Revoke</button>
      </div>`).join('');

    list.querySelectorAll('.btn-revoke').forEach(btn => {
      btn.addEventListener('click', () => _revokeAdmin(btn.dataset.id));
    });
  }

  function _revokeAdmin(docId) {
    if (!confirm('Revoke admin access for this user?')) return;
    const db = window.db;

    db.collection('admins').doc(docId).delete().then(() => {
      // Update user role — docId is email, convert to key
      const ek = docId.replace(/\./g, '_');
      return db.collection('users').doc(ek).update({ role: 'reader' }).catch(() => {});
    }).then(() => {
      window.admins = (window.admins || []).filter(a => (a.id || a.email) !== docId);
      showToast('Admin access revoked.');
      renderSettings();
    }).catch(err => {
      console.error('_revokeAdmin:', err);
      showToast('Failed to revoke.', 'err');
    });
  }

  function _renderReaders() {
    const list        = document.getElementById('readerList');
    const cntEl       = document.getElementById('readerCnt');
    const admins      = window.admins || [];
    const users       = window.allUsers || [];
    const ownerEmail  = window.OWNER || '';
    const adminEmails = new Set(admins.map(a => a.email).filter(Boolean));

    const readers = users.filter(u =>
      u.email !== ownerEmail && !adminEmails.has(u.email)
    );

    if (cntEl) cntEl.textContent = readers.length;
    if (!list) return;

    if (!readers.length) {
      list.innerHTML = '<p class="set-empty">No readers yet.</p>';
      return;
    }

    const pendingEmails = new Set(
      (window.accessRequests || [])
        .filter(r => r.status === 'pending')
        .map(r => r.email)
    );

    list.innerHTML = readers.map(u => `
      <div class="req-item">
        <div class="req-info">
          <span class="req-name">${U.esc(u.displayName || u.name || '—')}</span>
          <span class="req-email">${U.esc(u.email || '—')}</span>
          <span class="req-time">${u.lastSeen ? 'Last seen ' + _fmtTs(u.lastSeen) : 'Never'}</span>
        </div>
        ${pendingEmails.has(u.email) ? '<span class="reader-badge">Pending</span>' : ''}
      </div>`).join('');
  }

  function _bindResetReads() {
    const btn = document.getElementById('btnResetReads');
    if (!btn || btn._bound) return;
    btn._bound = true;

    btn.addEventListener('click', async () => {
      if (!confirm('Reset ALL read counts? This cannot be undone.')) return;
      const stEl = document.getElementById('resetSt');
      if (stEl) stEl.textContent = 'Working…';

      try {
        const db      = window.db;
        const BATCH_N = 400;
        let total     = 0;

        for (const col of CONTENT_COLS) {
          const snap = await db.collection(col).get();
          const ids  = snap.docs.map(d => d.id);

          for (let i = 0; i < ids.length; i += BATCH_N) {
            const batch = db.batch();
            ids.slice(i, i + BATCH_N).forEach(id => {
              batch.update(db.collection(col).doc(id), { readCounts: {}, readCount: 0 });
            });
            await batch.commit();
            total += ids.slice(i, i + BATCH_N).length;
          }

          (window[col] || []).forEach(item => {
            item.readCounts = {};
            item.readCount  = 0;
          });
        }

        if (stEl) stEl.textContent = 'Done — reset ' + total + ' items.';
        showToast('All read counts reset.');
      } catch (err) {
        console.error('btnResetReads:', err);
        if (document.getElementById('resetSt'))
          document.getElementById('resetSt').textContent = 'Error — see console.';
        showToast('Reset failed.', 'err');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS — READER
  // ═══════════════════════════════════════════════════════════

  function setupReaderSettings() {
    const statusEl = document.getElementById('readerReqStatus');
    const btn      = document.getElementById('btnReqAccess');
    if (!btn) return;

    const email    = window.currentUser?.email || '';
    const existing = (window.accessRequests || []).find(r => r.email === email);

    if (existing) {
      if (statusEl) {
        statusEl.textContent =
          existing.status === 'pending'  ? 'Your request is pending approval.' :
          existing.status === 'approved' ? 'Your request was approved.' :
          'Your request was rejected. Contact the owner.';
      }
      btn.disabled = true;
      return;
    }

    btn.disabled = false;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      if (statusEl) statusEl.textContent = 'Submitting…';

      window.db.collection('accessRequests').add({
        uid:       window.currentUser?.uid          || '',
        email:     window.currentUser?.email        || '',
        name:      window.currentUser?.displayName  || '',
        status:    'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).then(ref => {
        window.accessRequests = window.accessRequests || [];
        window.accessRequests.push({
          id: ref.id,
          email,
          name: window.currentUser?.displayName || '',
          status: 'pending',
        });
        if (statusEl) statusEl.textContent = 'Request submitted. Pending approval.';
        showToast('Access request sent.');
      }).catch(err => {
        console.error('btnReqAccess:', err);
        btn.disabled = false;
        if (statusEl) statusEl.textContent = 'Failed to submit. Try again.';
        showToast('Request failed.', 'err');
      });
    }, { once: true });
  }

  // ═══════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════

  function _fmtTs(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════

  function _init() {
    _bindModals();
    _bindDropdowns();
    _bindNotifs();
    _bindReadAgain();
    _bindRateModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // ═══════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════

  window.renderSettings      = renderSettings;
  window.setupReaderSettings = setupReaderSettings;
  window.applyTheme          = applyTheme;
  window.openModal           = openModal;
  window.closeModal          = closeModal;
  window.showToast           = showToast;
  window.logAct              = logAct;
  window.handleMarkRead      = handleMarkRead;
  window.incRead             = incRead;
  window.openRateModal       = openRateModal;
  window.closeDrops          = closeDrops;
  window.loadNotifs          = loadNotifs;
  window.renderNotifs        = renderNotifs;
  window.delItem             = delItem;

})();
