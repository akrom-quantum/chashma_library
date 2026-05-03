/* ============================================================
   library.js — Texts, Videos, Mental Models + shared overlays
   Depends on: window.Utils, window.db, window.auth,
               window.currentUser, window.userRole,
               window.texts, window.videos, window.models
   Exports:    renderTexts, renderVideos, renderModels,
               openDetail, openMdViewer, openModelViewer,
               openAddTxt, openAddVid, openAddModel
   ============================================================ */

(() => {
  /* ── Shortcuts ───────────────────────────────────────────── */
  const $   = id  => document.getElementById(id);
  const esc = s   => String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const qs  = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ── Encoded email key ───────────────────────────────────── */
  function ek(email) {
    return (email ?? window.currentUser?.email ?? '').replace(/\./g, ',');
  }
  const myEk = () => ek(window.currentUser?.email);

  /* ── Role helpers ────────────────────────────────────────── */
  const isOwner  = () => window.userRole === 'owner';
  const isEdit   = () => window.isEdit?.() ?? (window.userRole !== 'reader');

  /* ── Firestore timestamp ─────────────────────────────────── */
  const TS = () => firebase.firestore.FieldValue.serverTimestamp();

  /* ── Date helpers ────────────────────────────────────────── */
  function toDate(v) {
    if (!v) return null;
    if (v.toDate) return v.toDate();
    if (v instanceof Date) return v;
    return new Date(v);
  }
  function ymd(d) { return (toDate(d) ?? new Date()).toISOString().slice(0,10); }
  function relDate(v) {
    const d = toDate(v); if (!d) return '';
    const diff = Math.floor((Date.now() - d) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff <  7) return `${diff}d ago`;
    if (diff < 30) return `${Math.floor(diff/7)}w ago`;
    return d.toLocaleDateString('en',{month:'short',day:'numeric'});
  }
  function todayStr() { return new Date().toISOString().slice(0,10); }

  /* ── Read / rating helpers ───────────────────────────────── */
  function myRC(item) { return item?.readCounts?.[myEk()] ?? 0; }
  function myRating(item) { return item?.ratings?.[myEk()] ?? 0; }
  function avgRating(item) {
    const r = item?.ratings ?? {};
    const vals = Object.values(r).filter(Boolean);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—';
  }
  function totalReads(item) {
    return Object.values(item?.readCounts ?? {}).reduce((a,b)=>a+(b||0),0);
  }

  /* ── Toggle read (writes directly to Firestore) ──────────── */
  async function toggleRead(id, colName) {
    const arr  = window[colName] ?? [];
    const item = arr.find(x => x.id === id);
    if (!item) return;
    const key  = myEk();
    const cur  = item.readCounts?.[key] ?? 0;
    const next = cur > 0 ? 0 : 1;
    try {
      await window.db.doc(`${colName}/${id}`).update({
        [`readCounts.${key}`]: next,
      });
      if (!item.readCounts) item.readCounts = {};
      item.readCounts[key] = next;
      window.logAct?.(colName, id, next > 0 ? 'read' : 'unread');
      // Re-render whichever section owns this collection
      if (colName === 'texts')   renderTexts();
      if (colName === 'videos')  renderVideos();
      if (colName === 'models')  renderModels();
    } catch(e) { window.showToast?.('Failed to update read status.'); }
  }

  /* ── Star rating modal ───────────────────────────────────── */
  function openRateModal(id, colName) {
    const arr   = window[colName] ?? [];
    const item  = arr.find(x => x.id === id);
    if (!item)  return;
    const cur   = myRating(item);

    // Build modal
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay rate-overlay';
    overlay.innerHTML = `
      <div class="modal-box rate-box">
        <p class="rate-title">Rate: <em>${esc(item.title)}</em></p>
        <div class="star-row" id="starRow">
          ${[1,2,3,4,5].map(n=>`
            <button class="star-btn ${n<=cur?'active':''}" data-v="${n}">★</button>
          `).join('')}
        </div>
        <div class="rate-actions">
          <button class="btn-ghost" id="rateClear">Clear</button>
          <button class="btn-pri"   id="rateSave">Save</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    let selected = cur;

    const stars = qsa('.star-btn', overlay);
    stars.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        stars.forEach(s => s.classList.toggle('active', +s.dataset.v <= +btn.dataset.v));
      });
      btn.addEventListener('click', () => { selected = +btn.dataset.v; });
    });
    overlay.querySelector('#starRow').addEventListener('mouseleave', () => {
      stars.forEach(s => s.classList.toggle('active', +s.dataset.v <= selected));
    });

    const close = () => overlay.remove();
    overlay.querySelector('#rateClear').addEventListener('click', async () => {
      await _saveRating(id, colName, null);
      close();
    });
    overlay.querySelector('#rateSave').addEventListener('click', async () => {
      await _saveRating(id, colName, selected || null);
      close();
    });
    overlay.addEventListener('click', e => { if (e.target===overlay) close(); });
  }

  async function _saveRating(id, colName, val) {
    const key = myEk();
    const update = val === null
      ? { [`ratings.${key}`]: firebase.firestore.FieldValue.delete() }
      : { [`ratings.${key}`]: val };
    try {
      await window.db.doc(`${colName}/${id}`).update(update);
      const arr  = window[colName] ?? [];
      const item = arr.find(x => x.id === id);
      if (item) {
        if (!item.ratings) item.ratings = {};
        if (val === null) delete item.ratings[key];
        else item.ratings[key] = val;
      }
    } catch(e) { window.showToast?.('Failed to save rating.'); }
  }

  /* ── Delete helper ───────────────────────────────────────── */
  async function deleteItem(id, colName, onSuccess) {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    try {
      await window.db.doc(`${colName}/${id}`).delete();
      window[colName] = (window[colName] ?? []).filter(x => x.id !== id);
      onSuccess?.();
    } catch(e) { window.showToast?.('Delete failed.'); }
  }

  /* ── YouTube thumbnail ───────────────────────────────────── */
  function ytThumb(url) {
    if (!url) return '';
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : '';
  }

  /* ── Tag strip builder ───────────────────────────────────── */
  function buildTagStrip(stripId, items, activeTag, setTag, render) {
    const el = $(stripId);
    if (!el) return;
    const tags = [...new Set(items.flatMap(i => i.tags ?? []))].sort();
    el.innerHTML = [
      `<button class="htag ${!activeTag?'active':''}" data-tag="">All</button>`,
      ...tags.map(t => `<button class="htag ${activeTag===t?'active':''}" data-tag="${esc(t)}">${esc(t)}</button>`),
    ].join('');
    qsa('.htag', el).forEach(btn => {
      btn.addEventListener('click', () => { setTag(btn.dataset.tag || null); render(); });
    });
  }

  /* ── Unread banner ───────────────────────────────────────── */
  function renderUB(containerId, items, colName) {
    const el = $(containerId);
    if (!el) return;
    const unread = items
      .filter(i => !i.hidden && myRC(i) === 0)
      .sort((a,b) => (toDate(b.createdAt)??0) - (toDate(a.createdAt)??0));
    if (!unread.length) { el.innerHTML=''; return; }
    const item = unread[0];
    el.innerHTML = `
      <div class="ub" role="button" tabindex="0">
        <span class="ub-label">Continue →</span>
        <span class="ub-title">${esc(item.title)}</span>
        <span class="ub-count">${unread.length} unread</span>
      </div>`;
    qs('.ub', el).addEventListener('click', () => _openByCol(item, colName));
  }

  function _openByCol(item, colName) {
    if (colName === 'texts')  { item.notes ? openMdViewer(item.id) : openDetail(item.id,'texts'); }
    else if (colName === 'videos')  openDetail(item.id,'videos');
    else if (colName === 'models')  { window.modelStack=[]; openModelViewer(item.id); }
    else openDetail(item.id, colName);
  }

  /* ══════════════════════════════════════════════════════════
     TEXTS
     ══════════════════════════════════════════════════════════ */

  // State
  let tFilter='all', tSort='order', tDir=1, tAuthorF='', tTagA=null;
  let editTxtId=null;

  const PLAT_META = {
    essay:     { label:'Essay',     cls:'badge-essay'     },
    substack:  { label:'Substack',  cls:'badge-substack'  },
    twitter:   { label:'Twitter',   cls:'badge-twitter'   },
    article:   { label:'Article',   cls:'badge-article'   },
  };

  function renderTexts() {
    const el = $('textsRow') ?? $('textsList');
    if (!el) return;

    let items = (window.texts ?? []).filter(t => {
      if (t.hidden && !isOwner()) return false;
      if (tFilter !== 'all' && t.platform !== tFilter) return false;
      if (tAuthorF  && t.author !== tAuthorF) return false;
      if (tTagA     && !(t.tags ?? []).includes(tTagA)) return false;
      const q = ($('txtSearch')?.value ?? '').toLowerCase();
      if (q && !`${t.title} ${t.author} ${t.series}`.toLowerCase().includes(q)) return false;
      return true;
    });

    items = _sortItems(items, tSort, tDir);

    buildTagStrip('txtTagStrip', window.texts ?? [], tTagA,
      v => { tTagA = v; }, renderTexts);
    updateAuthorFilter();
    renderUB('txtUB', items, 'texts');

    // Group by series
    const seriesMap = {};
    const standalone = [];
    items.forEach(t => {
      if (t.series) { (seriesMap[t.series] = seriesMap[t.series]??[]).push(t); }
      else standalone.push(t);
    });

    el.innerHTML = '';

    // Build render queue: series groups and standalone items ordered by min order value
    const queue = [];
    Object.entries(seriesMap).forEach(([series, arr]) => {
      const minOrder = Math.min(...arr.map(t => t.order ?? Infinity));
      queue.push({ type: 'series', series, arr, minOrder });
    });
    standalone.forEach(t => queue.push({ type: 'item', item: t, minOrder: t.order ?? Infinity }));
    queue.sort((a, b) => {
      if (a.minOrder !== b.minOrder) return a.minOrder - b.minOrder;
      const ad = toDate(a.type==='item' ? a.item.createdAt : a.arr[0]?.createdAt) ?? 0;
      const bd = toDate(b.type==='item' ? b.item.createdAt : b.arr[0]?.createdAt) ?? 0;
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });

    queue.forEach((entry, i) => {
      if (entry.type === 'series') {
        const grp = document.createElement('div');
        grp.className = 'series-group';
        grp.innerHTML = `
          <div class="series-hdr" role="button" tabindex="0">
            <span class="material-symbols-outlined series-chevron">expand_more</span>
            <span class="series-name">${esc(entry.series)}</span>
            <span class="series-count">${entry.arr.length}</span>
          </div>
          <div class="series-body"></div>`;
        const body = qs('.series-body', grp);
        entry.arr.forEach((t, j) => body.appendChild(buildTxtCard(t, j)));
        qs('.series-hdr', grp).addEventListener('click', () => grp.classList.toggle('collapsed'));
        el.appendChild(grp);
      } else {
        el.appendChild(buildTxtCard(entry.item, i));
      }
    });

    if (!items.length) el.innerHTML = '<p class="empty-state">No texts match your filters.</p>';
  }

  function buildTxtCard(t, idx) {
    const read    = myRC(t) > 0;
    const pm      = PLAT_META[t.platform] ?? { label: t.platform ?? '', cls: 'badge-article' };
    const orderLbl = t.order != null ? String(t.order).padStart(2,'0') : '·';
    const card = document.createElement('div');
    card.className = `txt-card ${t.hidden ? 'item-hidden' : ''} ${read ? 'read' : ''}`;
    card.dataset.id = t.id;

    card.innerHTML = `
      <span class="item-order">${esc(orderLbl)}</span>
      <div class="txt-meta">
        <span class="type-badge ${esc(pm.cls)}">${esc(pm.label)}</span>
        ${t.author ? `<span class="author-badge">${esc(t.author)}</span>` : ''}
        ${(t.tags??[]).map(tag=>`<span class="tag-chip">${esc(tag)}</span>`).join('')}
      </div>
      <p class="txt-title">${esc(t.title)}</p>
      <div class="card-actions">
        ${t.link ? `<button class="act-btn" title="Open source" data-act="link">
          <span class="material-symbols-outlined">open_in_new</span></button>` : ''}
        <button class="act-btn ${t.notes?'':'dim'}" title="Notes" data-act="notes">
          <span class="material-symbols-outlined">description</span></button>
        <button class="act-btn read-toggle" title="${read?'Mark unread':'Mark read'}" data-act="read">
          <span class="material-symbols-outlined">${read?'check_circle':'radio_button_unchecked'}</span>
        </button>
        <button class="act-btn" title="Rate" data-act="rate">
          <span class="material-symbols-outlined">star</span></button>
        ${isOwner() ? `<button class="act-btn" title="${t.hidden?'Show':'Hide'}" data-act="hide">
          <span class="material-symbols-outlined">${t.hidden?'visibility':'visibility_off'}</span></button>` : ''}
        ${isEdit()  ? `<button class="act-btn" title="Edit" data-act="edit">
          <span class="material-symbols-outlined">edit</span></button>` : ''}
        ${isOwner() ? `<button class="act-btn danger" title="Delete" data-act="del">
          <span class="material-symbols-outlined">delete</span></button>` : ''}
      </div>`;

    // Action handlers
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'link')  { window.open(t.link,'_blank'); window.logAct?.('texts',t.id,'link'); }
      if (act === 'notes') { t.notes ? openMdViewer(t.id) : null; }
      if (act === 'read')  { toggleRead(t.id,'texts'); }
      if (act === 'rate')  { openRateModal(t.id,'texts'); }
      if (act === 'hide')  { toggleTxtVis(t.id); }
      if (act === 'edit')  { openEditTxt(t.id); }
      if (act === 'del')   { deleteItem(t.id,'texts', renderTexts); }
    });

    return card;
  }

  function updateAuthorFilter() {
    const sel = $('txtAuthorF');
    if (!sel) return;
    const cur    = sel.value;
    const authors = [...new Set((window.texts??[]).map(t=>t.author).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">All authors</option>`
      + authors.map(a=>`<option ${a===cur?'selected':''} value="${esc(a)}">${esc(a)}</option>`).join('');
  }

  async function toggleTxtVis(id) {
    if (!isOwner()) return;
    const t = (window.texts??[]).find(x=>x.id===id);
    if (!t) return;
    try {
      await window.db.doc(`texts/${id}`).update({ hidden: !t.hidden });
      t.hidden = !t.hidden;
      renderTexts();
    } catch(e) { window.showToast?.('Failed to update visibility.'); }
  }

  /* ── Text CRUD ───────────────────────────────────────────── */
  function openAddTxt() {
    editTxtId = null;
    _fillTxtModal({});
    window.openModal?.('txtModal');
  }
  function openEditTxt(id) {
    editTxtId = id;
    const t = (window.texts??[]).find(x=>x.id===id);
    if (!t) return;
    _fillTxtModal(t);
    window.openModal?.('txtModal');
  }
  function _fillTxtModal(t) {
    _v('tDate',   t.date   ?? todayStr());
    _v('tOrder',  t.order  ?? '');
    _v('tAuthor', t.author ?? '');
    _v('tTitle',  t.title  ?? '');
    _v('tLink',   t.link   ?? '');
    _v('tPlat',   t.platform ?? 'article');
    _v('tSeries', t.series ?? '');
    _v('tTags',   (t.tags??[]).join(', '));
    _v('tNotes',  t.notes  ?? '');
  }
  function _v(id, val) { const el=$(id); if(el) el.value=val; }

  async function saveTxt() {
    const data = {
      date:     $('tDate')?.value   || todayStr(),
      order:    $('tOrder')?.value  ? +$('tOrder').value : null,
      author:   $('tAuthor')?.value.trim() || '',
      title:    $('tTitle')?.value.trim()  || '',
      link:     $('tLink')?.value.trim()   || '',
      platform: $('tPlat')?.value   || 'article',
      series:   $('tSeries')?.value.trim() || '',
      tags:     ($('tTags')?.value??'').split(',').map(s=>s.trim()).filter(Boolean),
      notes:    $('tNotes')?.value  || '',
    };
    if (!data.title) { window.showToast?.('Title is required.'); return; }
    try {
      if (editTxtId) {
        await window.db.doc(`texts/${editTxtId}`).update(data);
        const idx = (window.texts??[]).findIndex(x=>x.id===editTxtId);
        if (idx>-1) window.texts[idx] = { ...window.texts[idx], ...data };
      } else {
        data.createdAt = TS();
        const ref = await window.db.collection('texts').add(data);
        (window.texts = window.texts??[]).push({ id: ref.id, ...data });
      }
      window.closeModal?.('txtModal');
      renderTexts();
    } catch(e) { window.showToast?.('Save failed.'); }
  }

  /* ── MD Viewer ───────────────────────────────────────────── */
  let mdHtmlCache='', mdTitleCache='';

  function openMdViewer(id) {
    const t = (window.texts??[]).find(x=>x.id===id);
    if (!t) return;
    const html = window.parseMd?.(t.notes ?? '') ?? `<pre>${esc(t.notes??'')}</pre>`;
    mdHtmlCache  = html;
    mdTitleCache = t.title ?? 'Notes';
    const body = $('mdBody');
    if (body) body.innerHTML = html;
    const title = $('mdTitle');
    if (title) title.textContent = mdTitleCache;
    $('mdViewer')?.classList.add('visible');
  }

  $('btnMdBack')?.addEventListener('click', () => $('mdViewer')?.classList.remove('visible'));

  $('btnDlHtml')?.addEventListener('click', () => {
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(mdTitleCache)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7}
  h1,h2,h3{margin-top:2rem} code{background:#f4f4f4;padding:.15em .4em;border-radius:4px}
  pre{background:#f4f4f4;padding:1rem;overflow-x:auto;border-radius:8px}
  blockquote{border-left:4px solid #ccc;margin:0;padding-left:1rem;color:#555}
</style></head><body>
<h1>${esc(mdTitleCache)}</h1>
${mdHtmlCache}
</body></html>`;
    const blob = new Blob([full],{type:'text/html'});
    const a = Object.assign(document.createElement('a'),{
      href: URL.createObjectURL(blob),
      download: `${mdTitleCache.replace(/\s+/g,'-')}.html`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  });

  /* ══════════════════════════════════════════════════════════
     VIDEOS
     ══════════════════════════════════════════════════════════ */

  let vSort='date', vDir=1, vTagA=null;
  let editVidId=null;

  function renderVideos() {
    const el = $('videosGrid') ?? $('videosList');
    if (!el) return;

    let items = (window.videos??[]).filter(v => {
      if (v.hidden && !isOwner()) return false;
      if (vTagA && !(v.tags??[]).includes(vTagA)) return false;
      const q = ($('vidSearch')?.value ?? '').toLowerCase();
      if (q && !`${v.title} ${v.channel}`.toLowerCase().includes(q)) return false;
      return true;
    });

    items = _sortItems(items, vSort, vDir);
    buildTagStrip('vidTagStrip', window.videos??[], vTagA,
      v => { vTagA = v; }, renderVideos);
    renderUB('vidUB', items, 'videos');

    el.innerHTML = '';
    if (!items.length) { el.innerHTML='<p class="empty-state">No videos match your filters.</p>'; return; }
    items.forEach((v,i) => el.appendChild(buildVidCard(v,i)));
  }

  function buildVidCard(v, idx) {
    const read  = myRC(v) > 0;
    const thumb = v.thumbnailUrl || ytThumb(v.link);
    const card  = document.createElement('div');
    card.className = `vid-card ${read?'read':''}`;
    card.dataset.id = v.id;

    card.innerHTML = `
      <div class="vid-thumb" role="button" tabindex="0">
        ${thumb
          ? `<img src="${esc(thumb)}" alt="${esc(v.title)}" loading="lazy">`
          : `<div class="vid-thumb-placeholder"><span class="material-symbols-outlined">play_circle</span></div>`}
      </div>
      <div class="vid-info">
        <p class="vid-title">${esc(v.title)}</p>
        ${v.channel ? `<span class="vid-channel">${esc(v.channel)}</span>` : ''}
        <div class="vid-persons">
          ${(v.persons??[]).map(p=>`<span class="vid-person">${esc(p)}</span>`).join('')}
        </div>
        <div class="card-actions">
          <button class="act-btn read-toggle" title="${read?'Mark unread':'Mark read'}" data-act="read">
            <span class="material-symbols-outlined">${read?'check_circle':'radio_button_unchecked'}</span>
          </button>
          <button class="act-btn" title="Rate" data-act="rate">
            <span class="material-symbols-outlined">star</span></button>
          ${isEdit()  ? `<button class="act-btn" title="Edit" data-act="edit">
            <span class="material-symbols-outlined">edit</span></button>` : ''}
          ${isOwner() ? `<button class="act-btn danger" title="Delete" data-act="del">
            <span class="material-symbols-outlined">delete</span></button>` : ''}
        </div>
      </div>`;

    qs('.vid-thumb', card).addEventListener('click', () => {
      if (v.link) {
        window.open(v.link,'_blank');
        window.logAct?.('videos',v.id,'watch');
        // Prompt rate after watching
        setTimeout(() => { if (!myRating(v)) openRateModal(v.id,'videos'); }, 1500);
      }
    });

    qs('.vid-title', card).addEventListener('click', e => {
      e.stopPropagation();
      openDetail(v.id,'videos');
    });

    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act==='read') toggleRead(v.id,'videos');
      if (act==='rate') openRateModal(v.id,'videos');
      if (act==='edit') openEditVid(v.id);
      if (act==='del')  deleteItem(v.id,'videos',renderVideos);
    });

    return card;
  }

  /* ── Video CRUD ──────────────────────────────────────────── */
  function openAddVid() {
    editVidId = null;
    _fillVidModal({});
    window.openModal?.('vidModal');
  }
  function openEditVid(id) {
    editVidId = id;
    const v = (window.videos??[]).find(x=>x.id===id);
    if (!v) return;
    _fillVidModal(v);
    window.openModal?.('vidModal');
  }
  function _fillVidModal(v) {
    _v('vLink',    v.link    ?? '');
    _v('vTitle',   v.title   ?? '');
    _v('vChannel', v.channel ?? '');
    _v('vPersons', (v.persons??[]).join(', '));
    _v('vSeries',  v.series  ?? '');
    _v('vSummary', v.summary ?? '');
    _v('vTags',    (v.tags??[]).join(', '));
    if (v.thumbnailUrl) _v('vThumb', v.thumbnailUrl);
  }

  // Auto-fill thumbnail on link blur
  $('vLink')?.addEventListener('blur', () => {
    const url   = $('vLink')?.value.trim();
    const thumb = ytThumb(url);
    if (thumb && !$('vThumb')?.value) _v('vThumb', thumb);
    if (!$('vTitle')?.value) _v('vTitle', '');
  });

  async function saveVid() {
    const data = {
      link:         $('vLink')?.value.trim()    || '',
      title:        $('vTitle')?.value.trim()   || '',
      channel:      $('vChannel')?.value.trim() || '',
      persons:      ($('vPersons')?.value??'').split(',').map(s=>s.trim()).filter(Boolean),
      series:       $('vSeries')?.value.trim()  || '',
      summary:      $('vSummary')?.value        || '',
      tags:         ($('vTags')?.value??'').split(',').map(s=>s.trim()).filter(Boolean),
      thumbnailUrl: $('vThumb')?.value.trim()   || ytThumb($('vLink')?.value.trim()),
    };
    if (!data.title) { window.showToast?.('Title is required.'); return; }
    try {
      if (editVidId) {
        await window.db.doc(`videos/${editVidId}`).update(data);
        const idx=(window.videos??[]).findIndex(x=>x.id===editVidId);
        if (idx>-1) window.videos[idx]={...window.videos[idx],...data};
      } else {
        data.createdAt=TS();
        const ref=await window.db.collection('videos').add(data);
        (window.videos=window.videos??[]).push({id:ref.id,...data});
      }
      window.closeModal?.('vidModal');
      renderVideos();
    } catch(e) { window.showToast?.('Save failed.'); }
  }

  /* ══════════════════════════════════════════════════════════
     MENTAL MODELS
     ══════════════════════════════════════════════════════════ */

  let mFilter='all', mSort='order', mDir=1, mFieldF='';
  let editModelId=null;
  window.modelStack = window.modelStack ?? [];

  function renderModels() {
    const el = $('modelsList');
    if (!el) return;

    let items = (window.models??[]).filter(m => {
      if (mFilter !== 'all' && m.type !== mFilter) return false;
      if (mFieldF  && m.field !== mFieldF) return false;
      const q = ($('modelSearch')?.value ?? '').toLowerCase();
      if (q && !`${m.title} ${m.field} ${m.description}`.toLowerCase().includes(q)) return false;
      return true;
    });

    items = _sortItems(items, mSort, mDir);
    updateFieldDl();
    updateFieldFilter();

    el.innerHTML = '';
    if (!items.length) { el.innerHTML='<p class="empty-state">No models match your filters.</p>'; return; }
    items.forEach((m,i) => el.appendChild(buildModelCard(m,i)));
  }

  function buildModelCard(m, idx) {
    const card = document.createElement('div');
    card.className = `model-card model-${m.type==='deep'?'deep':'clear'}`;
    card.dataset.id = m.id;

    card.innerHTML = `
      <div class="model-body" role="button" tabindex="0">
        <div class="model-meta">
          <span class="type-badge badge-${esc(m.type??'clear')}">${esc(m.type??'Clear')}</span>
          ${m.field ? `<span class="field-badge">${esc(m.field)}</span>` : ''}
          ${m.order!=null ? `<span class="model-order">#${m.order}</span>` : ''}
        </div>
        <p class="model-title">${esc(m.title)}</p>
        ${m.description ? `<p class="model-desc">${esc(m.description)}</p>` : ''}
      </div>
      <div class="card-actions model-acts">
        ${isEdit()  ? `<button class="act-btn" title="Edit" data-act="edit">
          <span class="material-symbols-outlined">edit</span></button>` : ''}
        ${isOwner() ? `<button class="act-btn danger" title="Delete" data-act="del">
          <span class="material-symbols-outlined">delete</span></button>` : ''}
      </div>`;

    qs('.model-body', card).addEventListener('click', () => {
      window.modelStack = [];
      openModelViewer(m.id);
    });
    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.stopPropagation();
      if (btn.dataset.act==='edit') openEditModel(m.id);
      if (btn.dataset.act==='del')  deleteItem(m.id,'models',renderModels);
    });
    return card;
  }

  /* ── Model viewer ────────────────────────────────────────── */
  function openModelViewer(id, fromNav=false) {
    const overlay = $('modelViewer');
    if (!overlay) return;

    overlay.classList.add('visible');

    const m = (window.models??[]).find(x=>x.id===id);
    if (!m) {
      overlay.innerHTML = `
        <div class="mv-coming-soon">
          <span class="material-symbols-outlined">psychology</span>
          <p>This model hasn't been written yet.</p>
          <button class="btn-ghost" id="mvClose">Close</button>
        </div>`;
      $('mvClose')?.addEventListener('click', () => overlay.classList.remove('visible'));
      return;
    }

    const html = m.content
      ? (window.parseMdWiki?.(m.content, window.models??[]) ?? window.parseMd?.(m.content) ?? `<pre>${esc(m.content)}</pre>`)
      : '';

    const header = $('modelVHeader');
    if (header) header.innerHTML = `
      <div class="mv-meta">
        <span class="type-badge badge-${esc(m.type??'clear')}">${esc(m.type??'Clear')}</span>
        ${m.field ? `<span class="field-badge">${esc(m.field)}</span>` : ''}
        ${m.order!=null ? `<span class="mv-order">#${m.order}</span>` : ''}
      </div>
      <h2 class="mv-title">${esc(m.title)}</h2>
      ${m.description ? `<p class="mv-desc"><em>${esc(m.description)}</em></p>` : ''}`;

    const body = $('modelVBody');
    if (body) body.innerHTML = html || '<p class="mv-empty">No content yet.</p>';

    // Wire wikilinks
    if (body) {
      qsa('.wikilink[data-mt]', body).forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          const targetId = link.dataset.mt;
          window.modelStack.push(id);
          renderModelNav(m);
          openModelViewer(targetId, true);
        });
      });
    }

    // Edit button
    const acts = $('modelVActs');
    if (acts) {
      acts.innerHTML = isEdit()
        ? `<button class="btn-ghost" id="mvEdit"><span class="material-symbols-outlined">edit</span> Edit</button>`
        : '';
      $('mvEdit')?.addEventListener('click', () => openEditModel(id));
    }

    renderModelNav(m);
  }

  function renderModelNav(currentModel) {
    const nav = $('modelNav');
    if (!nav) return;
    const stack = window.modelStack ?? [];

    if (!stack.length) { nav.classList.add('hidden'); return; }
    nav.classList.remove('hidden');

    nav.innerHTML = stack.map((sid, i) => {
      const sm = (window.models??[]).find(x=>x.id===sid);
      return `<button class="crumb-btn" data-idx="${i}">${esc(sm?.title??'…')}</button>
              <span class="crumb-sep">›</span>`;
    }).join('') + `<span class="crumb-current">${esc(currentModel?.title??'')}</span>`;

    qsa('.crumb-btn', nav).forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        const targetId = window.modelStack[idx];
        window.modelStack = window.modelStack.slice(0, idx);
        openModelViewer(targetId, true);
      });
    });
  }

  $('btnModelBack')?.addEventListener('click', () => {
    const stack = window.modelStack ?? [];
    if (stack.length) {
      const prevId = stack.pop();
      openModelViewer(prevId, true);
    } else {
      $('modelViewer')?.classList.remove('visible');
    }
  });

  /* ── Model CRUD ──────────────────────────────────────────── */
  function openAddModel() {
    editModelId = null;
    const maxOrder = Math.max(0, ...(window.models??[]).map(m=>m.order??0));
    _fillModelModal({ order: maxOrder+1 });
    window.openModal?.('modelModal');
  }
  function openEditModel(id) {
    editModelId = id;
    const m = (window.models??[]).find(x=>x.id===id);
    if (!m) return;
    _fillModelModal(m);
    window.openModal?.('modelModal');
  }
  function _fillModelModal(m) {
    _v('mOrder',  m.order ?? '');
    _v('mMTitle', m.title ?? '');
    _v('mDesc',   m.description ?? '');
    _v('mField',  m.field ?? '');
    _v('mType',   m.type  ?? 'clear');
    _v('mContent',m.content ?? '');
  }

  function updateFieldDl() {
    const dl = $('fieldDl');
    if (!dl) return;
    const fields = [...new Set((window.models??[]).map(m=>m.field).filter(Boolean))].sort();
    dl.innerHTML = fields.map(f=>`<option value="${esc(f)}">`).join('');
  }
  function updateFieldFilter() {
    const sel = $('modelFieldF');
    if (!sel) return;
    const cur = sel.value;
    const fields = [...new Set((window.models??[]).map(m=>m.field).filter(Boolean))].sort();
    sel.innerHTML = `<option value="">All fields</option>`
      + fields.map(f=>`<option ${f===cur?'selected':''} value="${esc(f)}">${esc(f)}</option>`).join('');
  }

  async function saveModel() {
    const data = {
      order:       $('mOrder')?.value   ? +$('mOrder').value : null,
      title:       $('mMTitle')?.value.trim() || '',
      description: $('mDesc')?.value.trim()   || '',
      field:       $('mField')?.value.trim()  || '',
      type:        $('mType')?.value          || 'clear',
      content:     $('mContent')?.value       || '',
    };
    if (!data.title) { window.showToast?.('Title is required.'); return; }
    try {
      if (editModelId) {
        await window.db.doc(`models/${editModelId}`).update(data);
        const idx=(window.models??[]).findIndex(x=>x.id===editModelId);
        if (idx>-1) window.models[idx]={...window.models[idx],...data};
      } else {
        data.createdAt=TS();
        const ref=await window.db.collection('models').add(data);
        (window.models=window.models??[]).push({id:ref.id,...data});
      }
      window.closeModal?.('modelModal');
      renderModels();
    } catch(e) { window.showToast?.('Save failed.'); }
  }

  /* ══════════════════════════════════════════════════════════
     DETAIL OVERLAY (shared: videos, texts, memories)
     ══════════════════════════════════════════════════════════ */

  function openDetail(id, colName) {
    const arr  = window[colName] ?? [];
    const item = arr.find(x=>x.id===id);
    if (!item) return;

    const overlay = $('detOverlay');
    if (!overlay) return;
    overlay.classList.add('visible');

    const read = myRC(item) > 0;

    // Header
    const header = $('detHeader');
    if (header) {
      let headerHtml = '';
      if (colName==='videos') {
        const thumb = item.thumbnailUrl || ytThumb(item.link);
        headerHtml = `
          ${thumb ? `<img class="det-thumb" src="${esc(thumb)}" alt="">` : ''}
          <div class="det-head-info">
            <p class="det-title">${esc(item.title)}</p>
            ${item.channel ? `<span class="det-channel">${esc(item.channel)}</span>` : ''}
            <div class="vid-persons">
              ${(item.persons??[]).map(p=>`<span class="vid-person">${esc(p)}</span>`).join('')}
            </div>
          </div>`;
      } else if (colName==='texts') {
        const pm = PLAT_META[item.platform] ?? { label:item.platform??'', cls:'badge-article' };
        headerHtml = `
          <div class="det-head-info">
            <div class="det-meta">
              <span class="type-badge ${esc(pm.cls)}">${esc(pm.label)}</span>
              ${item.author ? `<span class="author-badge">${esc(item.author)}</span>` : ''}
            </div>
            <p class="det-title">${esc(item.title)}</p>
          </div>`;
      } else {
        headerHtml = `<p class="det-title">${esc(item.title)}</p>`;
      }
      header.innerHTML = headerHtml;
    }

    // Actions
    const acts = $('detActs');
    if (acts) acts.innerHTML = `
      ${item.link ? `<button class="act-btn" id="detLink" title="Open source">
        <span class="material-symbols-outlined">open_in_new</span></button>` : ''}
      <button class="act-btn read-toggle" id="detRead" title="${read?'Mark unread':'Mark read'}">
        <span class="material-symbols-outlined">${read?'check_circle':'radio_button_unchecked'}</span>
      </button>
      <button class="act-btn" id="detRate" title="Rate">
        <span class="material-symbols-outlined">star</span></button>
      ${isEdit()  ? `<button class="act-btn" id="detEdit" title="Edit">
        <span class="material-symbols-outlined">edit</span></button>` : ''}
      ${isOwner() ? `<button class="act-btn danger" id="detDel" title="Delete">
        <span class="material-symbols-outlined">delete</span></button>` : ''}`;

    $('detLink')?.addEventListener('click', () => {
      window.open(item.link,'_blank');
      window.logAct?.(colName,id,'link');
    });
    $('detRead')?.addEventListener('click', async () => {
      await toggleRead(id, colName);
      openDetail(id, colName); // refresh
    });
    $('detRate')?.addEventListener('click', () => openRateModal(id, colName));
    $('detEdit')?.addEventListener('click', () => {
      overlay.classList.remove('visible');
      if (colName==='texts')   openEditTxt(id);
      if (colName==='videos')  openEditVid(id);
    });
    $('detDel')?.addEventListener('click', () => {
      deleteItem(id, colName, () => {
        overlay.classList.remove('visible');
        if (colName==='texts')   renderTexts();
        if (colName==='videos')  renderVideos();
      });
    });

    // Stats
    const stats = $('detStats');
    if (stats) stats.innerHTML = `
      <span class="stat-chip">👁 ${totalReads(item)} total reads</span>
      <span class="stat-chip">📖 My reads: ${myRC(item)}</span>
      <span class="stat-chip">⭐ Avg: ${avgRating(item)}</span>
      ${myRating(item) ? `<span class="stat-chip">My rating: ${myRating(item)}★</span>` : ''}`;

    // Content
    const content = $('detContent');
    if (content) {
      if (colName==='videos' && item.summary) {
        content.innerHTML = `<div class="md-body">${window.parseMd?.(item.summary)??esc(item.summary)}</div>`;
      } else if (colName==='texts' && item.notes) {
        content.innerHTML = `<div class="md-body">${window.parseMd?.(item.notes)??esc(item.notes)}</div>`;
      } else if (colName==='memories' && item.content) {
        content.innerHTML = `<pre class="mem-content">${esc(item.content)}</pre>`;
      } else {
        content.innerHTML = '';
      }
    }
  }

  $('btnDetBack')?.addEventListener('click', () => $('detOverlay')?.classList.remove('visible'));

  /* ══════════════════════════════════════════════════════════
     SORT HELPER
     ══════════════════════════════════════════════════════════ */
  function _sortItems(items, sortKey, dir) {
    return [...items].sort((a,b) => {
      let av, bv;
      if (sortKey==='order') { av=a.order??Infinity; bv=b.order??Infinity; }
      else if (sortKey==='date') { av=toDate(a.createdAt)??0; bv=toDate(b.createdAt)??0; }
      else if (sortKey==='title') { av=(a.title??'').toLowerCase(); bv=(b.title??'').toLowerCase(); }
      else if (sortKey==='reads') { av=myRC(a); bv=myRC(b); }
      else if (sortKey==='rating') { av=myRating(a); bv=myRating(b); }
      else { av=0; bv=0; }
      if (av<bv) return -dir;
      if (av>bv) return dir;
      // tiebreak: items with explicit order before those without; then by createdAt asc
      if (sortKey==='order') {
        const aHas = a.order != null, bHas = b.order != null;
        if (aHas !== bHas) return aHas ? -1 : 1;
      }
      const ad = toDate(a.createdAt) ?? 0;
      const bd = toDate(b.createdAt) ?? 0;
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }

  /* ══════════════════════════════════════════════════════════
     CONTROLS BINDING
     ══════════════════════════════════════════════════════════ */
  function _bindControls() {
    // Platform filter pills (texts)
    qsa('[data-tf]').forEach(btn => {
      btn.addEventListener('click', () => {
        tFilter = btn.dataset.tf;
        qsa('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===tFilter));
        renderTexts();
      });
    });
    // Model type filter pills
    qsa('[data-mf]').forEach(btn => {
      btn.addEventListener('click', () => {
        mFilter = btn.dataset.mf;
        qsa('[data-mf]').forEach(b=>b.classList.toggle('active',b.dataset.mf===mFilter));
        renderModels();
      });
    });

    // Sort selects
    $('txtSort')?.addEventListener('change', e => { tSort=e.target.value; renderTexts(); });
    $('vidSort')?.addEventListener('change', e => { vSort=e.target.value; renderVideos(); });
    $('modelSort')?.addEventListener('change', e => { mSort=e.target.value; renderModels(); });

    // Sort direction toggles
    _bindDirBtn('txtDir',   v => { tDir=v; renderTexts(); });
    _bindDirBtn('vidDir',   v => { vDir=v; renderVideos(); });
    _bindDirBtn('modelDir', v => { mDir=v; renderModels(); });

    // Search inputs
    $('txtSearch')?.addEventListener('input',   () => renderTexts());
    $('vidSearch')?.addEventListener('input',   () => renderVideos());
    $('modelSearch')?.addEventListener('input', () => renderModels());

    // Author / field filters
    $('txtAuthorF')?.addEventListener('change',  e => { tAuthorF=e.target.value; renderTexts(); });
    $('modelFieldF')?.addEventListener('change', e => { mFieldF=e.target.value;  renderModels(); });

    // Save buttons in modals
    $('btnSaveTxt')?.addEventListener('click',   saveTxt);
    $('btnSaveVid')?.addEventListener('click',   saveVid);
    $('btnSaveModel')?.addEventListener('click', saveModel);
  }

  function _bindDirBtn(id, cb) {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = btn.dataset.dir === '1' ? -1 : 1;
      btn.dataset.dir  = next;
      btn.textContent  = next === 1 ? '↑' : '↓';
      cb(next);
    });
  }

  /* ── Init ────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', _bindControls);
  // Also bind immediately in case DOM is already ready
  if (document.readyState !== 'loading') _bindControls();

   // ── ADD BUTTON BINDINGS ──
document.addEventListener('DOMContentLoaded', function() {
  const btnAddText  = document.getElementById('btnAddText');
  const btnAddVid   = document.getElementById('btnAddVid');
  const btnAddModel = document.getElementById('btnAddModel');

  if (btnAddText)  btnAddText.addEventListener('click',  openAddTxt);
  if (btnAddVid)   btnAddVid.addEventListener('click',   openAddVid);
  if (btnAddModel) btnAddModel.addEventListener('click', openAddModel);
});
   
  /* ── Exports ─────────────────────────────────────────────── */
  window.renderTexts      = renderTexts;
  window.renderVideos     = renderVideos;
  window.renderModels     = renderModels;
  window.openDetail       = openDetail;
  window.openMdViewer     = openMdViewer;
  window.openModelViewer  = openModelViewer;
  window.openAddTxt       = openAddTxt;
  window.openAddVid       = openAddVid;
  window.openAddModel     = openAddModel;
  window.openEditTxt      = openEditTxt;
  window.openEditVid      = openEditVid;
  window.openEditModel    = openEditModel;
  window.toggleTxtVis     = toggleTxtVis;
})();
