/* settings.js — Chashma: The Archive
   Depends on : window.Utils, window.db, window.currentUser, window.userRole,
                window.OWNER, window.allUsers
   Reads      : window.admins, window.accessRequests
   Calls      : window.switchTab, window.showToast (self-defined below)
   Exposes    : window.renderSettings, window.setupReaderSettings,
                window.applyTheme, window.openModal, window.closeModal,
                window.showToast, window.logAct, window.handleMarkRead,
                window.incRead, window.openRateModal, window.closeDrops,
                window.loadNotifs, window.renderNotifs, window.delItem
*/

(function () {
  'use strict';

  const U = window.Utils;

  // ─── FIRESTORE LAZY IMPORT ────────────────────────────────────────────────

  let _fs = null;
  async function fs() {
    if (_fs) return _fs;
    _fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    return _fs;
  }

  // ─── COLLECTION REFERENCES ────────────────────────────────────────────────

  const CONTENT_COLS = ['texts', 'videos', 'models', 'memories'];

  function allItems() {
    return [
      ...(window.texts    || []),
      ...(window.videos   || []),
      ...(window.models   || []),
      ...(window.memories || []),
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THEME
  // ═══════════════════════════════════════════════════════════════════════════

  function applyTheme(t) {
    const theme = (t === 'dark') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    U.lsS('ch_theme', theme);

    const icon = theme === 'dark' ? '☀️' : '🌙';
    document.querySelectorAll('#themeBtn, #setThemeBtn').forEach(btn => {
      if (btn) btn.textContent = icon;
    });
  }

  // Init theme immediately
  applyTheme(U.lsG('ch_theme') || 'light');

  // ═══════════════════════════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════════════════════════

  let _toastTimer = null;

  function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent  = msg;
    el.className    = 'toast-show' + (type ? ` toast-${type}` : '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = ''; }, 2800);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  function _bindModals() {
    // Close buttons: ids matching closeXxxM or cancelXxxM
    document.querySelectorAll('[id^="close"][id$="M"], [id^="cancel"][id$="M"]')
      .forEach(btn => {
        btn.addEventListener('click', () => {
          const ov = btn.closest('.overlay, .modal-overlay, [class*="overlay"]');
          if (ov) ov.classList.remove('open');
        });
      });

    // Backdrop click closes overlays
    document.querySelectorAll('.overlay, .modal-overlay, [class*="overlay"]')
      .forEach(ov => {
        ov.addEventListener('click', e => {
          if (e.target === ov) ov.classList.remove('open');
        });
      });

    // Escape key: close topmost open overlay
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.overlay.open, .modal-overlay.open, [class*="overlay"].open')];
      if (open.length) open[open.length - 1].classList.remove('open');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DROPDOWNS
  // ═══════════════════════════════════════════════════════════════════════════

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

    // [data-goto] buttons in dropdowns / nav
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeDrops();
        window.switchTab?.(btn.dataset.goto);
      });
    });

    // .stat-card[data-goto]
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

    // Theme buttons
    document.getElementById('themeBtn')?.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    document.getElementById('setThemeBtn')?.addEventListener('click', () => {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  let _notifUnsubs = [];
  let _notifItems  = [];   // { id, col, title, createdAt, authorId }

  function _getLastSeen() {
    return U.lsG('ch_lastSeen') || 0;  // Unix ms
  }

  function loadNotifs() {
    // Unsubscribe any previous listeners
    _notifUnsubs.forEach(fn => fn());
    _notifUnsubs = [];
    _notifItems  = [];

    const uid = window.currentUser?.uid;
    if (!uid) return;

    const cols = [
      { name: 'texts',    label: 'Text' },
      { name: 'videos',   label: 'Video' },
      { name: 'models',   label: 'Model' },
      { name: 'memories', label: 'Memory' },
    ];

    fs().then(({ collection, onSnapshot }) => {
      cols.forEach(({ name, label }) => {
        const unsub = onSnapshot(
          collection(window.db, name),
          snap => {
            // Remove existing entries for this collection
            _notifItems = _notifItems.filter(n => n.col !== name);

            snap.forEach(d => {
              const data = d.data();
              const ts   = data.createdAt?.toMillis
                ? data.createdAt.toMillis()
                : (data.createdAt ? new Date(data.createdAt).getTime() : 0);

              // New = added after lastSeen, not by this user
              if (ts > _getLastSeen() && data.authorId !== uid) {
                _notifItems.push({
                  id:        d.id,
                  col:       name,
                  colLabel:  label,
                  title:     data.title || data.name || '(untitled)',
                  createdAt: ts,
                  authorId:  data.authorId,
                });
              }
            });

            renderNotifs();
          },
          err => console.warn(`loadNotifs [${name}]:`, err)
        );
        _notifUnsubs.push(unsub);
      });
    });
  }

  function renderNotifs() {
    const panel  = document.getElementById('notifPanel');
    const badge  = document.getElementById('notifBadge');
    const list   = document.getElementById('notifList');
    const count  = _notifItems.length;

    if (badge) {
      badge.textContent    = count > 9 ? '9+' : String(count);
      badge.style.display  = count > 0 ? '' : 'none';
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
      U.lsS('ch_lastSeen', Date.now());
      _notifItems = [];
      renderNotifs();
    });

    document.getElementById('btnResetNotifs')?.addEventListener('click', () => {
      U.lsS('ch_lastSeen', 0);
      showToast('Notification timestamp reset.');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVITY LOG
  // ═══════════════════════════════════════════════════════════════════════════

  async function logAct(id, col, type) {
    const ek = U.ek();
    if (!ek || !window.db) return;

    try {
      const { doc, setDoc, increment } = await fs();
      const today  = U.todayStr();                   // 'YYYY-MM-DD'
      const docId  = `${today}__${ek}`;
      const field  = `${col}__${type}`;
      const ref    = doc(window.db, 'activityLog', docId);

      await setDoc(ref, {
        uid:   window.currentUser?.uid  || '',
        email: window.currentUser?.email || '',
        name:  window.currentUser?.displayName || '',
        ts:    new Date(),
        [field]: increment(1),
      }, { merge: true });
    } catch (err) {
      console.warn('logAct:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ / RATE SHARED LOGIC
  // ═══════════════════════════════════════════════════════════════════════════

  // State for pending read-again confirmation
  let _pendingReadId  = null;
  let _pendingReadCol = null;

  async function incRead(id, col) {
    const ek = U.ek();
    if (!ek || !id || !col) return;
    try {
      const { doc, updateDoc, increment } = await fs();
      await updateDoc(doc(window.db, col, id), {
        [`readCounts.${ek}`]: increment(1),
      });
      // Optimistic update on local array
      const arr  = window[col] || [];
      const item = arr.find(x => x.id === id);
      if (item) {
        item.readCounts = item.readCounts || {};
        item.readCounts[ek] = (item.readCounts[ek] || 0) + 1;
      }
      logAct(id, col, 'read');
      showToast('Marked as read!');
    } catch (err) {
      console.error('incRead:', err);
      showToast('Failed to mark read.', 'err');
    }
  }

  function handleMarkRead(id, col, item) {
    if (!item) {
      item = (window[col] || []).find(x => x.id === id);
    }
    if (!item) return;

    if (U.myRC(item) === 0) {
      // First read — increment immediately
      incRead(id, col);
    } else {
      // Already read — prompt read-again
      _pendingReadId  = id;
      _pendingReadCol = col;

      const countEl = document.getElementById('raCount');
      if (countEl) countEl.textContent = U.myRC(item);

      openModal('ov-readAgain');
    }
  }

  function _bindReadAgain() {
    document.getElementById('raYes')?.addEventListener('click', () => {
      closeModal('ov-readAgain');
      if (_pendingReadId && _pendingReadCol) {
        incRead(_pendingReadId, _pendingReadCol);
      }
      _pendingReadId = _pendingReadCol = null;
    });

    document.getElementById('raNo')?.addEventListener('click', () => {
      closeModal('ov-readAgain');
      _pendingReadId = _pendingReadCol = null;
    });
  }

  // ─── RATE MODAL ───────────────────────────────────────────────────────────

  let _pendingRateId  = null;
  let _pendingRateCol = null;

  function openRateModal(id, col) {
    const item = (window[col] || []).find(x => x.id === id);
    if (!item) return;

    _pendingRateId  = id;
    _pendingRateCol = col;

    const existing = (item.ratings ?? {})[U.ek()] || 0;

    // Set prompt text
    const prompt = document.getElementById('ratePrompt');
    if (prompt) prompt.textContent = `Rate "${item.title || item.name || 'this item'}"`;

    // Pre-fill stars
    document.querySelectorAll('#ov-rate .star-btn').forEach(btn => {
      const v = Number(btn.dataset.value);
      btn.classList.toggle('active', v <= existing);
    });

    openModal('ov-rate');
  }

  function _bindRateModal() {
    const ov    = document.getElementById('ov-rate');
    const stars = ov?.querySelectorAll('.star-btn');

    let hovered = 0;

    stars?.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        hovered = Number(btn.dataset.value);
        stars.forEach(s => s.classList.toggle('hover', Number(s.dataset.value) <= hovered));
      });
      btn.addEventListener('mouseleave', () => {
        hovered = 0;
        stars.forEach(s => s.classList.remove('hover'));
      });
      btn.addEventListener('click', async () => {
        const val = Number(btn.dataset.value);
        stars.forEach(s => s.classList.toggle('active', Number(s.dataset.value) <= val));

        if (!_pendingRateId || !_pendingRateCol) return;
        const ek = U.ek();
        try {
          const { doc, updateDoc } = await fs();
          await updateDoc(doc(window.db, _pendingRateCol, _pendingRateId), {
            [`ratings.${ek}`]: val,
          });
          const item = (window[_pendingRateCol] || []).find(x => x.id === _pendingRateId);
          if (item) {
            item.ratings = item.ratings || {};
            item.ratings[ek] = val;
          }
          logAct(_pendingRateId, _pendingRateCol, 'rate');
          showToast(`Rated ${val}★`);
          closeModal('ov-rate');
          _pendingRateId = _pendingRateCol = null;
        } catch (err) {
          console.error('openRateModal submit:', err);
          showToast('Failed to save rating.', 'err');
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ═══════════════════════════════════════════════════════════════════════════

  async function delItem(col, id) {
    const role = window.userRole;
    const isOwn = role === 'owner';
    const isAdm = role === 'admin';

    // Permission check
    if (col === 'memories') {
      if (!U.isEdit()) { showToast('Not permitted.', 'err'); return; }
    } else {
      if (!isOwn && !isAdm) { showToast('Not permitted.', 'err'); return; }
    }

    if (!confirm('Delete this item permanently?')) return;

    try {
      const { doc, deleteDoc } = await fs();
      await deleteDoc(doc(window.db, col, id));
      window[col] = (window[col] || []).filter(x => x.id !== id);
      showToast('Item deleted.');
    } catch (err) {
      console.error('delItem:', err);
      showToast('Failed to delete.', 'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS PAGE — OWNER SECTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function renderSettings() {
    const ownerSet = document.getElementById('ownerSet');
    const readerSet = document.getElementById('readerSet');

    if (U.isOwner()) {
      if (ownerSet)  ownerSet.style.display  = '';
      if (readerSet) readerSet.style.display = 'none';
      _renderPendingRequests();
      _renderAdmins();
      _renderReaders();
      _bindResetReads();
    } else {
      if (ownerSet)  ownerSet.style.display  = 'none';
      if (readerSet) readerSet.style.display = '';
      setupReaderSettings();
    }
  }

  // ─── PENDING REQUESTS ─────────────────────────────────────────────────────

  function _renderPendingRequests() {
    const list    = document.getElementById('pendList');
    const cntEl   = document.getElementById('pendCnt');
    const requests = (window.accessRequests || []).filter(r => r.status === 'pending');

    if (cntEl) cntEl.textContent = requests.length;
    if (!list) return;

    if (!requests.length) {
      list.innerHTML = '<p class="set-empty">No pending requests.</p>';
      return;
    }

    list.innerHTML = requests.map(r => `
      <div class="set-req-row" data-id="${U.esc(r.id)}">
        <div class="set-req-info">
          <span class="set-req-name">${U.esc(r.name || '—')}</span>
          <span class="set-req-email">${U.esc(r.email || '—')}</span>
          <span class="set-req-date">${_fmtTs(r.createdAt)}</span>
        </div>
        <div class="set-req-acts">
          <button class="btn-approve" data-id="${U.esc(r.id)}"
            data-uid="${U.esc(r.uid || '')}"
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

  async function _approveRequest({ id, uid, email, name }) {
    try {
      const { doc, setDoc, updateDoc, collection, addDoc } = await fs();
      const db = window.db;

      // Add to admins collection
      await setDoc(doc(db, 'admins', uid || id), {
        uid:        uid || '',
        email:      email || '',
        name:       name  || '',
        approvedAt: new Date(),
        approvedBy: window.currentUser?.email || '',
      });

      // Update request status
      await updateDoc(doc(db, 'accessRequests', id), { status: 'approved' });

      // Update user role
      if (uid) await updateDoc(doc(db, 'users', uid), { role: 'admin' });

      // Optimistic
      const req = (window.accessRequests || []).find(r => r.id === id);
      if (req) req.status = 'approved';

      showToast(`${name || email} approved as admin.`);
      renderSettings();
    } catch (err) {
      console.error('_approveRequest:', err);
      showToast('Failed to approve.', 'err');
    }
  }

  async function _rejectRequest(id) {
    try {
      const { doc, updateDoc } = await fs();
      await updateDoc(doc(window.db, 'accessRequests', id), { status: 'rejected' });
      const req = (window.accessRequests || []).find(r => r.id === id);
      if (req) req.status = 'rejected';
      showToast('Request rejected.');
      renderSettings();
    } catch (err) {
      console.error('_rejectRequest:', err);
      showToast('Failed to reject.', 'err');
    }
  }

  // ─── ADMINS LIST ──────────────────────────────────────────────────────────

  function _renderAdmins() {
    const list   = document.getElementById('adminList');
    const admins = window.admins || [];
    if (!list) return;

    if (!admins.length) {
      list.innerHTML = '<p class="set-empty">No admins yet.</p>';
      return;
    }

    list.innerHTML = admins.map(a => `
      <div class="set-admin-row" data-id="${U.esc(a.id || a.uid || '')}">
        <div class="set-admin-info">
          <span class="set-admin-name">${U.esc(a.name || '—')}</span>
          <span class="set-admin-email">${U.esc(a.email || '—')}</span>
          <span class="set-admin-date">Approved ${_fmtTs(a.approvedAt)}</span>
        </div>
        <button class="btn-revoke" data-id="${U.esc(a.id || a.uid || '')}"
          data-uid="${U.esc(a.uid || '')}">Revoke</button>
      </div>`).join('');

    list.querySelectorAll('.btn-revoke').forEach(btn => {
      btn.addEventListener('click', () => _revokeAdmin(btn.dataset.id, btn.dataset.uid));
    });
  }

  async function _revokeAdmin(docId, uid) {
    if (!confirm('Revoke admin access for this user?')) return;
    try {
      const { doc, deleteDoc, updateDoc } = await fs();
      await deleteDoc(doc(window.db, 'admins', docId));
      if (uid) {
        await updateDoc(doc(window.db, 'users', uid), { role: 'reader' });
      }
      window.admins = (window.admins || []).filter(a => (a.id || a.uid) !== docId);
      showToast('Admin access revoked.');
      renderSettings();
    } catch (err) {
      console.error('_revokeAdmin:', err);
      showToast('Failed to revoke.', 'err');
    }
  }

  // ─── READERS LIST ─────────────────────────────────────────────────────────

  function _renderReaders() {
    const list   = document.getElementById('readerList');
    const cntEl  = document.getElementById('readerCnt');
    const admins = window.admins || [];
    const users  = window.allUsers || [];

    const adminUids   = new Set(admins.map(a => a.uid).filter(Boolean));
    const adminEmails = new Set(admins.map(a => a.email).filter(Boolean));
    const ownerEmail  = window.OWNER || '';

    const readers = users.filter(u =>
      u.email !== ownerEmail &&
      !adminUids.has(u.uid) &&
      !adminEmails.has(u.email)
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
      <div class="set-reader-row">
        <span class="set-reader-name">${U.esc(u.displayName || u.name || '—')}</span>
        <span class="set-reader-email">${U.esc(u.email || '—')}</span>
        <span class="set-reader-seen">${u.lastSeen ? 'Last seen ' + _fmtTs(u.lastSeen) : 'Never'}</span>
        ${pendingEmails.has(u.email) ? `<span class="set-pending-badge">Pending</span>` : ''}
      </div>`).join('');
  }

  // ─── RESET READ COUNTS ────────────────────────────────────────────────────

  function _bindResetReads() {
    document.getElementById('btnResetReads')?.addEventListener('click', async () => {
      if (!confirm('Reset ALL read counts across every collection? This cannot be undone.')) return;

      const stEl = document.getElementById('resetSt');
      if (stEl) stEl.textContent = 'Working…';

      try {
        const { doc, writeBatch, collection, getDocs } = await fs();
        const db      = window.db;
        const BATCH_N = 400;
        let total     = 0;

        for (const col of CONTENT_COLS) {
          const snap = await getDocs(collection(db, col));
          const docs = [];
          snap.forEach(d => docs.push(d.id));

          for (let i = 0; i < docs.length; i += BATCH_N) {
            const batch = writeBatch(db);
            docs.slice(i, i + BATCH_N).forEach(id => {
              batch.update(doc(db, col, id), { readCounts: {}, readCount: 0 });
            });
            await batch.commit();
            total += docs.slice(i, i + BATCH_N).length;
          }

          // Clear local arrays
          (window[col] || []).forEach(item => {
            item.readCounts = {};
            item.readCount  = 0;
          });
        }

        if (stEl) stEl.textContent = `Done — reset ${total} items.`;
        showToast('All read counts reset.');
      } catch (err) {
        console.error('btnResetReads:', err);
        const stEl = document.getElementById('resetSt');
        if (stEl) stEl.textContent = 'Error — see console.';
        showToast('Reset failed.', 'err');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS PAGE — READER SECTION
  // ═══════════════════════════════════════════════════════════════════════════

  function setupReaderSettings() {
    const statusEl = document.getElementById('readerReqStatus');
    const btn      = document.getElementById('btnReqAccess');
    if (!btn) return;

    const uid   = window.currentUser?.uid;
    const email = window.currentUser?.email || '';
    const name  = window.currentUser?.displayName || '';

    const existing = (window.accessRequests || []).find(
      r => r.uid === uid || r.email === email
    );

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
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (statusEl) statusEl.textContent = 'Submitting…';
      try {
        const { collection, addDoc } = await fs();
        const ref = await addDoc(collection(window.db, 'accessRequests'), {
          uid:       uid   || '',
          email:     email || '',
          name:      name  || '',
          status:    'pending',
          createdAt: new Date(),
        });
        window.accessRequests = window.accessRequests || [];
        window.accessRequests.push({
          id: ref.id, uid, email, name, status: 'pending', createdAt: new Date(),
        });
        if (statusEl) statusEl.textContent = 'Request submitted. Pending approval.';
        showToast('Access request sent.');
      } catch (err) {
        console.error('btnReqAccess:', err);
        btn.disabled = false;
        if (statusEl) statusEl.textContent = 'Failed to submit. Try again.';
        showToast('Request failed.', 'err');
      }
    }, { once: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  function _fmtTs(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

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
