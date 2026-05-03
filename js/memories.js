/* memories.js — Chashma: The Archive
   Depends on : window.Utils, window.db, window.currentUser, window.userRole
   Reads      : window.memories  (array, kept in sync optimistically)
   Calls      : window.showToast, window.openModal, window.closeModal,
                window.logAct, window.handleMarkRead, window.openRateModal
   Exposes    : window.renderMemories, window.openMemDetail, window.openWriter
*/

(function () {
  'use strict';

  const U = window.Utils;

  // ─── STATE ────────────────────────────────────────────────────────────────
  let editMemId = null;
  let memSort   = 'num';   // 'num' | 'date' | 'title'
  let memDir    = 1;       // 1 = asc, -1 = desc
  let memTagA   = null;    // active tag filter (string with leading #, or null)

  // ─── ROLE HELPERS ─────────────────────────────────────────────────────────
  // Utils.isOwner / isEdit check window.userRole (app-level role).
  // For per-document ownership (private toggle, delete) we check authorId.

  function docOwner(m) {
    return window.currentUser && m.authorId === window.currentUser.uid;
  }
  function canEdit()   { return U.isEdit();  } // owner-role or admin
  function canSeeAll() { return U.isEdit();  } // sees private memories

  // ─── TIMESTAMP HELPERS ────────────────────────────────────────────────────

  /** Firestore Timestamp | Date | string → 'YYYY-MM-DD' */
  function toIso(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toISOString().slice(0, 10);
  }

  /** Timestamp → human-readable date string */
  function fmtDate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // ─── TAG STRIP ────────────────────────────────────────────────────────────

  function buildTagStrip(baseItems) {
    const strip = document.getElementById('memTagStrip');
    const row   = document.getElementById('memTagRow');
    if (!strip || !row) return;

    const seen = new Set();
    baseItems.forEach(m => (m.tags || []).forEach(t => seen.add(t)));
    const tags = [...seen].sort();

    if (!tags.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    row.innerHTML = '';

    row.appendChild(_chip('All', !memTagA, () => { memTagA = null; renderMemories(); }));
    tags.forEach(tag => {
      row.appendChild(_chip(tag, memTagA === tag, () => {
        memTagA = (memTagA === tag) ? null : tag;
        renderMemories();
      }));
    });
  }

  function _chip(label, active, onClick) {
    const btn = document.createElement('button');
    btn.className = 'tag-chip' + (active ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── RENDER MEMORIES (TIMELINE) ───────────────────────────────────────────

  function renderMemories() {
    const container = document.querySelector('.mem-timeline');
    if (!container) return;

    const query = (document.getElementById('memSearch')?.value || '').trim().toLowerCase();
    const all   = window.memories || [];

    // 1. Privacy filter
    const baseVisible = all.filter(m => canSeeAll() ? true : !m.private);

    // 2. Search filter
    let items = baseVisible;
    if (query) {
      items = items.filter(m =>
        (m.title   || '').toLowerCase().includes(query) ||
        (m.content || '').toLowerCase().includes(query) ||
        (m.tags    || []).some(t => t.toLowerCase().includes(query))
      );
    }

    // 3. Tag filter
    if (memTagA) {
      items = items.filter(m => (m.tags || []).includes(memTagA));
    }

    // 4. Tag strip (built from full privacy-filtered set)
    buildTagStrip(baseVisible);

    // 5. Sort via Utils.sortItems
    // Utils reads item.date for 'date' sort; normalise Timestamps to ISO string
    const normalised = items.map(m => ({ ...m, date: toIso(m.createdAt) }));
    const sortKey    = memSort === 'num' ? 'num' : memSort === 'date' ? 'date' : 'title';
    const sorted     = U.sortItems(normalised, sortKey, memDir);

    // 6. Render
    container.innerHTML = '';
    if (!sorted.length) {
      container.innerHTML = '<p class="mem-empty">No memories found.</p>';
      return;
    }

    // 7. Group by month
    // Utils.groupByMonth(items, dateField) uses string comparison on item[dateField].
    // item.date = 'YYYY-MM-DD', so slice(0,7) gives 'YYYY-MM' key internally.
    const grouped = U.groupByMonth(sorted, 'date'); // returns { 'YYYY-MM': [...], ... }

    Object.entries(grouped).forEach(([monthKey, group]) => {
      const label = monthKey === 'undated'
        ? 'Undated'
        : U.formatDateLabel(monthKey + '-01'); // formatDateLabel accepts 'YYYY-MM-DD' prefix

      const header = document.createElement('div');
      header.className = 'mem-month-header';
      header.innerHTML =
        `<span class="mem-month-line"></span>` +
        `<span class="mem-month-label">${U.esc(label)}</span>` +
        `<span class="mem-month-line"></span>`;
      container.appendChild(header);

      const list = document.createElement('div');
      list.className = 'mem-list';
      group.forEach((m, idx) => list.appendChild(buildMemCard(m, idx, query)));
      container.appendChild(list);
    });
  }

  // ─── MEMORY CARD ──────────────────────────────────────────────────────────

  function buildMemCard(m, idx, query) {
    const card = document.createElement('div');
    card.className = 'mem-card' + (m.private ? ' mem-card--private' : '');
    card.style.animationDelay = `${idx * 40}ms`;

    const titleHtml = m.title
      ? `<div class="mem-title">${query ? U.highlightText(m.title, query) : U.esc(m.title)}</div>`
      : '';

    const tagsHtml = (m.tags || []).length
      ? `<div class="mem-tags">${m.tags.map(t => `<span class="mem-tag">${U.esc(t)}</span>`).join('')}</div>`
      : '';

    const editedHtml = m.updatedAt && toIso(m.updatedAt) !== toIso(m.createdAt)
      ? `<span class="mem-edited">· edited ${fmtDate(m.updatedAt)}</span>`
      : '';

    card.innerHTML =
      (m.private ? `<span class="mem-lock" title="Private">🔒</span>` : '') +
      `<div class="mem-num">Memory #${U.esc(String(m.num ?? '?'))}</div>` +
      titleHtml +
      `<div class="mem-meta">${fmtDate(m.createdAt)}${editedHtml}</div>` +
      tagsHtml +
      `<div class="mem-preview">${buildPreview(m, query)}</div>` +
      `<div class="mem-stats">` +
        `<span title="Total reads">📖 ${U.totalR(m)}</span>` +
        `<span title="My reads">👤 ${U.myRC(m)}</span>` +
        `<span title="Avg rating">⭐ ${U.avgStr(m.ratings ?? {})}</span>` +
      `</div>` +
      `<div class="mem-acts">${buildActionBtns(m)}</div>`;

    card.addEventListener('click', e => {
      if (e.target.closest('.mem-acts')) return;
      openMemDetail(m.id);
    });

    wireActions(card, m);
    return card;
  }

  function buildPreview(m, query) {
    const content = m.content || '';
    if (query) return U.excerptAround(content, query); // already escaped + <mark>
    return `<span class="mem-clamp">${U.esc(content.split('\n').slice(0, 3).join('\n'))}</span>`;
  }

  function buildActionBtns(m, inDetail = false) {
    const cls  = inDetail ? 'mem-btn mem-btn--detail' : 'mem-btn';
    const lbl  = t => inDetail ? ` ${t}` : '';
    const parts = [
      `<button class="${cls}" data-action="read">📖${lbl('Mark Read')}</button>`,
      `<button class="${cls}" data-action="rate">⭐${lbl('Rate')}</button>`,
    ];
    if (canEdit()) {
      parts.push(`<button class="${cls}" data-action="edit">✏️${lbl('Edit')}</button>`);
    }
    if (docOwner(m)) {
      parts.push(
        `<button class="${cls}" data-action="private" title="${m.private ? 'Make public' : 'Make private'}">` +
          (m.private ? `🔓${lbl('Make Public')}` : `🔒${lbl('Make Private')}`) +
        `</button>`,
        `<button class="${cls} mem-btn--danger" data-action="delete">🗑️${lbl('Delete')}</button>`
      );
    }
    return parts.join('');
  }

  function wireActions(root, m, onAfter) {
    root.querySelector('[data-action="read"]')?.addEventListener('click', e => {
      e.stopPropagation();
      window.handleMarkRead?.(m.id);
    });
    root.querySelector('[data-action="rate"]')?.addEventListener('click', e => {
      e.stopPropagation();
      onAfter?.();
      window.openRateModal?.(m.id);
    });
    root.querySelector('[data-action="edit"]')?.addEventListener('click', e => {
      e.stopPropagation();
      onAfter?.();
      openWriter(m.id);
    });
    root.querySelector('[data-action="private"]')?.addEventListener('click', e => {
      e.stopPropagation();
      onAfter?.();
      togglePrivate(m.id);
    });
    root.querySelector('[data-action="delete"]')?.addEventListener('click', e => {
      e.stopPropagation();
      onAfter?.();
      deleteMem(m.id);
    });
  }

  // ─── MEMORY DETAIL OVERLAY ────────────────────────────────────────────────
  // Injected into <body> once on init, reused on every open.

  let _detOverlay = null;

  function ensureOverlay() {
    if (_detOverlay) return _detOverlay;
    _detOverlay = document.createElement('div');
    _detOverlay.id = 'mem-det-ov';
    _detOverlay.className = 'det-overlay';
    _detOverlay.innerHTML =
      `<div class="det-panel">` +
        `<button class="det-close" aria-label="Close">✕</button>` +
        `<div class="det-body"></div>` +
      `</div>`;
    _detOverlay.addEventListener('click', e => {
      if (e.target === _detOverlay) closeDetail();
    });
    _detOverlay.querySelector('.det-close').addEventListener('click', closeDetail);
    document.body.appendChild(_detOverlay);
    return _detOverlay;
  }

  function openMemDetail(id) {
    const m = (window.memories || []).find(x => x.id === id);
    if (!m) return;

    const overlay = ensureOverlay();
    const body    = overlay.querySelector('.det-body');

    const tagsHtml = (m.tags || []).length
      ? `<div class="det-tags">${m.tags.map(t => `<span class="mem-tag">${U.esc(t)}</span>`).join('')}</div>`
      : '';

    const editedHtml = m.updatedAt && toIso(m.updatedAt) !== toIso(m.createdAt)
      ? `<div class="det-edited">Edited ${fmtDate(m.updatedAt)}</div>`
      : '';

    body.innerHTML =
      `<div class="det-header">` +
        `<div class="det-num">Memory #${U.esc(String(m.num ?? '?'))}` +
          (m.private ? ` <span class="det-lock-badge">🔒 Private</span>` : '') +
        `</div>` +
        (m.title ? `<div class="det-title">${U.esc(m.title)}</div>` : '') +
        `<div class="det-meta">${fmtDate(m.createdAt)}</div>` +
        editedHtml +
        tagsHtml +
        `<div class="det-stats">` +
          `<span title="Total reads">📖 ${U.totalR(m)}</span>` +
          `<span title="My reads">👤 ${U.myRC(m)}</span>` +
          `<span title="Avg rating">⭐ ${U.avgStr(m.ratings ?? {})}</span>` +
        `</div>` +
      `</div>` +
      `<div class="det-content">${U.esc(m.content || '')}</div>` +
      `<div class="det-acts">${buildActionBtns(m, true)}</div>`;

    wireActions(body, m, closeDetail);
    overlay.classList.add('open');
  }

  function closeDetail() {
    _detOverlay?.classList.remove('open');
  }

  // ─── PRIVATE TOGGLE ───────────────────────────────────────────────────────

  async function togglePrivate(id) {
    const m = (window.memories || []).find(x => x.id === id);
    if (!m || !docOwner(m)) return;
    try {
      await window.db.collection('memories').doc(id).update({ private: !m.private });
      m.private = !m.private;
      window.showToast?.(m.private ? 'Memory set to private.' : 'Memory is now public.');
      window.logAct?.('toggle_private', { id, private: m.private });
      renderMemories();
    } catch (err) {
      console.error('togglePrivate:', err);
      window.showToast?.('Failed to update privacy.', 'error');
    }
  }

  // ─── DELETE ───────────────────────────────────────────────────────────────

  async function deleteMem(id) {
    if (!confirm('Delete this memory? This cannot be undone.')) return;
    try {
      await window.db.collection('memories').doc(id).delete();
      window.memories = (window.memories || []).filter(x => x.id !== id);
      window.showToast?.('Memory deleted.');
      window.logAct?.('delete_memory', { id });
      renderMemories();
    } catch (err) {
      console.error('deleteMem:', err);
      window.showToast?.('Failed to delete memory.', 'error');
    }
  }

  // ─── WRITER ───────────────────────────────────────────────────────────────

  function openWriter(id) {
    editMemId = id || null;
    const writer = document.getElementById('memWriter');
    if (!writer) return;

    const headEl = writer.querySelector('.writer-heading');

    if (editMemId) {
      const m = (window.memories || []).find(x => x.id === editMemId);
      if (!m) return;
      // Strip leading # for display — parseTags will re-add them on save
      _wVal('writerTitle',   m.title   || '');
      _wVal('writerContent', m.content || '');
      _wVal('writerTags',    (m.tags || []).map(t => t.replace(/^#/, '')).join(', '));
      _wChk('writerPrivate', !!m.private);
      if (headEl) headEl.textContent = 'Edit Memory';
    } else {
      _wVal('writerTitle',   '');
      _wVal('writerContent', '');
      _wVal('writerTags',    '');
      _wChk('writerPrivate', false);
      if (headEl) headEl.textContent = 'New Memory';
    }

    writer.classList.add('open');
    document.getElementById('writerContent')?.focus();
  }

  function _wVal(id, v) { const el = document.getElementById(id); if (el) el.value   = v; }
  function _wChk(id, v) { const el = document.getElementById(id); if (el) el.checked = v; }

  async function saveMemory() {
    const title   = (document.getElementById('writerTitle')?.value   || '').trim();
    const content = (document.getElementById('writerContent')?.value || '').trim();
    const tagsRaw = (document.getElementById('writerTags')?.value    || '').trim();
    const isPriv  = !!(document.getElementById('writerPrivate')?.checked);

    if (!content) {
      window.showToast?.('Content cannot be empty.', 'error');
      return;
    }

    // Utils.parseTags returns ['#foo', '#bar']
    const tags = U.parseTags(tagsRaw);

    try {
      const now = firebase.firestore.FieldValue.serverTimestamp();

      if (editMemId) {
        await window.db.collection('memories').doc(editMemId).update({
          title, content, tags, updatedAt: now,
        });
        const m = (window.memories || []).find(x => x.id === editMemId);
        if (m) Object.assign(m, { title, content, tags, updatedAt: new Date() });
        window.showToast?.('Memory updated.');
        window.logAct?.('edit_memory', { id: editMemId });
      } else {
        const maxNum = (window.memories || []).reduce((mx, m) => Math.max(mx, m.num || 0), 0);
        const num    = maxNum + 1;
        const ref    = await window.db.collection('memories').add({
          title, content, tags, num,
          private:    isPriv,
          authorId:   window.currentUser?.uid || '',
          ratings:    {},
          readCounts: {},
          createdAt:  now,
          updatedAt:  now,
        });
        window.memories = window.memories || [];
        window.memories.push({
          id: ref.id, title, content, tags, num,
          private: isPriv,
          authorId: window.currentUser?.uid || '',
          ratings: {}, readCounts: {},
          createdAt: new Date(), updatedAt: new Date(),
        });
        window.showToast?.(`Memory #${num} saved.`);
        window.logAct?.('create_memory', { id: ref.id, num });
      }

      writerDiscard();
      renderMemories();
    } catch (err) {
      console.error('saveMemory:', err);
      window.showToast?.('Failed to save memory.', 'error');
    }
  }

  function writerDiscard() {
    editMemId = null;
    document.getElementById('memWriter')?.classList.remove('open');
  }

  // ─── EXPORT ───────────────────────────────────────────────────────────────

  function exportMemories() {
    const query = (document.getElementById('memSearch')?.value || '').trim().toLowerCase();
    let items   = (window.memories || []).filter(m => canSeeAll() ? true : !m.private);

    if (query) {
      items = items.filter(m =>
        (m.title   || '').toLowerCase().includes(query) ||
        (m.content || '').toLowerCase().includes(query) ||
        (m.tags    || []).some(t => t.toLowerCase().includes(query))
      );
    }
    if (memTagA) items = items.filter(m => (m.tags || []).includes(memTagA));

    const normalised = items.map(m => ({ ...m, date: toIso(m.createdAt) }));
    const sortKey    = memSort === 'num' ? 'num' : memSort === 'date' ? 'date' : 'title';
    const sorted     = U.sortItems(normalised, sortKey, memDir);

    const rows = sorted.map(m => ({
      '#':      m.num ?? '',
      title:    m.title   || '',
      tags:     (m.tags   || []).join(' '),
      date:     fmtDate(m.createdAt),
      content:  m.content || '',
      private:  m.private ? 'yes' : 'no',
      reads:    U.totalR(m),
      myReads:  U.myRC(m),
      rating:   U.avgStr(m.ratings ?? {}),
    }));

    U.copyClip(U.toTsv(rows), 'Memories TSV');
    window.showToast?.(`Exported ${rows.length} memories to clipboard.`);
  }

  // ─── CONTROLS BINDING ─────────────────────────────────────────────────────

  function bindControls() {
    document.getElementById('memSearch')
      ?.addEventListener('input', debounce(renderMemories, 250));

    document.getElementById('memSort')
      ?.addEventListener('change', e => { memSort = e.target.value; renderMemories(); });

    const dirBtn = document.getElementById('memDir');
    dirBtn?.addEventListener('click', () => {
      memDir            *= -1;
      dirBtn.textContent = memDir === 1 ? '↑' : '↓';
      renderMemories();
    });

    document.getElementById('btnExportMem') ?.addEventListener('click', exportMemories);
    document.getElementById('btnNewMem')    ?.addEventListener('click', () => openWriter(null));
    document.getElementById('btnSaveMem')   ?.addEventListener('click', saveMemory);
    document.getElementById('btnDiscardMem')?.addEventListener('click', writerDiscard);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────

  function init() {
    ensureOverlay();
    bindControls();
    renderMemories();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────

  window.renderMemories = renderMemories;
  window.openMemDetail  = openMemDetail;
  window.openWriter     = openWriter;

})();
