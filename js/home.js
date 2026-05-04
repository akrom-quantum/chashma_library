/* ============================================================
   home.js — Chashma Home Page Renderer
   Depends on: window.Utils, window.db, window.currentUser,
               window.userRole, window.texts, window.videos,
               window.models, window.memories, window.allUsers
   Exports:    window.renderHome, window.computeLb,
               window.computeStreaks
   ============================================================ */

(() => {
  /* ── Local shortcuts ─────────────────────────────────────── */
  const $   = id => document.getElementById(id);
  const esc = s  => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );

  /* ── Collection accessors ────────────────────────────────── */
  const col = () => ({
    texts:    window.texts    ?? [],
    videos:   window.videos   ?? [],
    models:   window.models   ?? [],
    memories: window.memories ?? [],
  });
  const allItems = () => {
    const c = col();
    return [
      ...c.texts   .map(i => ({ ...i, _type: 'text'   })),
      ...c.videos  .map(i => ({ ...i, _type: 'video'  })),
      ...c.models  .map(i => ({ ...i, _type: 'model'  })),
      ...c.memories.map(i => ({ ...i, _type: 'memory' })),
    ];
  };

  /* ── Read-count helpers ──────────────────────────────────── */
  // My read count for an item (keyed by encoded email)
  function myRC(item) {
    const ek = emailKey();
    return item?.readCounts?.[ek] ?? 0;
  }
  // Total read count across all users for an item
  function totalR(item) {
    if (!item?.readCounts) return 0;
    return Object.values(item.readCounts).reduce((s, v) => s + (v || 0), 0);
  }
  // Encoded email key (dots → commas, matching Firestore convention)
  function emailKey(email) {
    const e = email ?? window.currentUser?.email ?? '';
    return e.replace(/\./g, ',');
  }

  /* ── Date helpers ────────────────────────────────────────── */
  function toDate(val) {
    if (!val) return null;
    if (val.toDate) return val.toDate();
    if (val instanceof Date) return val;
    return new Date(val);
  }
  function ymd(date) {
    if (!date) return '';
    const d = toDate(date) ?? new Date(date);
    return d.toISOString().slice(0, 10);
  }
  function relDate(val) {
    const d = toDate(val);
    if (!d) return '';
    const diff = Math.floor((Date.now() - d) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7)  return `${diff}d ago`;
    if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }

  /* ── Type metadata ───────────────────────────────────────── */
  const TYPE_META = {
    text:   { label: 'Text',   icon: 'article',      color: 'badge-text'   },
    video:  { label: 'Video',  icon: 'play_circle',  color: 'badge-video'  },
    model:  { label: 'Model',  icon: 'psychology',   color: 'badge-model'  },
    memory: { label: 'Memory', icon: 'auto_stories', color: 'badge-memory' },
  };

  /* ── Open item ───────────────────────────────────────────── */
  function openItem(item) {
    const t = item._type;
    if (t === 'text') {
      if (item.link) window.open(item.link, '_blank', 'noopener,noreferrer');
    } else if (t === 'video') {
      if (item.link) window.open(item.link, '_blank', 'noopener,noreferrer');
    } else if (t === 'model') {
      window.openModelViewer?.(item.id);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     1. renderHome
     ═══════════════════════════════════════════════════════════ */
  function renderHome() {
    _renderGreet();
    renderContinueReading();
    renderWeeklyGoal();
    renderRecentlyAdded();
    renderHeatmaps();
    renderHomeStreaks();
    renderLbPreview();
  }

  /* ── Greeting ────────────────────────────────────────────── */
  function _renderGreet() {
    const h    = new Date().getHours();
    const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
    const name = (window.currentUser?.displayName ?? '').split(' ')[0] || 'there';

    const greet = $('homeGreet');
    if (greet) greet.textContent = `Good ${part}, ${name} 👋`;

    const sub = $('homeSub');
    if (sub) {
      const days = window.userJoinDate
        ? Math.floor((Date.now() - window.userJoinDate.getTime()) / 86_400_000)
        : 0;
      sub.textContent = `Day ${days} of your learning journey`;
    }
  }

  /* ── Stat cards ──────────────────────────────────────────── */
  function _renderStats() {
    const c    = col();
    const ek   = emailKey();
    const sets = {
      texts:    c.texts,
      videos:   c.videos,
      models:   c.models,
      memories: c.memories,
    };

    Object.entries(sets).forEach(([key, items]) => {
      const countEl = $(`stat-${key}-count`);
      if (countEl) countEl.textContent = items.length;

      const read   = items.filter(i => (i.readCounts?.[ek] ?? 0) > 0).length;
      const pct    = items.length ? Math.round((read / items.length) * 100) : 0;
      const barEl  = $(`stat-${key}-bar`);
      const pctEl  = $(`stat-${key}-pct`);
      if (barEl) barEl.style.width = `${pct}%`;
      if (pctEl) pctEl.textContent = `${pct}%`;
    });
  }

  /* ═══════════════════════════════════════════════════════════
     WEEKLY GOAL
     ═══════════════════════════════════════════════════════════ */

  function _weekStart() {
    const today = new Date();
    const day   = today.getDay();
    const diff  = day === 0 ? -6 : 1 - day;
    const mon   = new Date(today);
    mon.setDate(today.getDate() + diff);
    return mon.toISOString().slice(0, 10);
  }

  function _readsThisWeek() {
    const ek  = emailKey();
    const ws  = _weekStart();
    let total = 0;
    [...(window.texts||[]), ...(window.videos||[]), ...(window.models||[])].forEach(item => {
      const rd = item.readDates?.[ek];
      if (rd) {
        Object.entries(rd).forEach(([date, n]) => { if (date >= ws) total += (n || 0); });
      } else if ((item.readCounts?.[ek] ?? 0) > 0) {
        // Fallback: no per-day data; count item as 1 read if ever read
        // Only count if createdAt is this week (proxy for "recent")
        const d = ymd(item.createdAt);
        if (d && d >= ws) total += 1;
      }
    });
    return total;
  }

  function renderWeeklyGoal() {
    const el = $('homeGoal');
    if (!el) return;

    const GOAL_KEY = 'ch_weeklyGoal';
    const goal     = parseInt(localStorage.getItem(GOAL_KEY) || '0', 10);

    if (!goal) {
      el.innerHTML = `
        <div class="goal-widget">
          <span class="goal-icon">🎯</span>
          <div class="goal-info">
            <div class="goal-title">Set a weekly reading goal</div>
            <p class="goal-meta">Track how many items you read each week.</p>
          </div>
          <button class="goal-edit-btn" id="btnSetGoal">Set goal</button>
        </div>`;
      $('btnSetGoal')?.addEventListener('click', () => {
        const n = parseInt(prompt('Weekly reading goal (number of items):', '5') || '0', 10);
        if (n > 0) { localStorage.setItem(GOAL_KEY, n); renderWeeklyGoal(); }
      });
      return;
    }

    const done = _readsThisWeek();
    const pct  = Math.min(100, Math.round((done / goal) * 100));
    const met  = done >= goal;

    el.innerHTML = `
      <div class="goal-widget${met ? ' goal-done' : ''}">
        <span class="goal-icon">${met ? '🏆' : '🎯'}</span>
        <div class="goal-info">
          <div class="goal-title">${met ? 'Weekly goal reached!' : 'Weekly goal'}</div>
          <div class="goal-bar-wrap">
            <div class="goal-bar" style="width:${pct}%"></div>
          </div>
          <p class="goal-meta">${done} / ${goal} reads this week (${pct}%)</p>
        </div>
        <button class="goal-edit-btn" id="btnEditGoal">Edit</button>
      </div>`;

    $('btnEditGoal')?.addEventListener('click', () => {
      const raw = prompt('Weekly reading goal (0 to remove):', goal);
      if (raw === null) return;
      const n = parseInt(raw, 10);
      if (n > 0) { localStorage.setItem(GOAL_KEY, n); renderWeeklyGoal(); }
      else       { localStorage.removeItem(GOAL_KEY); renderWeeklyGoal(); }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     2. renderContinueReading
     ═══════════════════════════════════════════════════════════ */
  function renderContinueReading() {
    const el = $('continueReading');
    if (!el) return;

    const unread = allItems()
      .filter(i => !i.hidden && myRC(i) === 0)
      .sort((a, b) => (toDate(b.createdAt) ?? 0) - (toDate(a.createdAt) ?? 0));

    if (!unread.length) {
      el.innerHTML = `<p class="cr-empty">You're all caught up! 🎉</p>`;
      return;
    }

    const item = unread[0];
    const meta = TYPE_META[item._type] ?? TYPE_META.text;
    const sub  = _itemSubtitle(item);

    el.innerHTML = `
      <div class="cr-card" role="button" tabindex="0">
        <span class="type-badge ${meta.color}">${esc(meta.label)}</span>
        <p class="cr-title">${esc(item.title ?? 'Untitled')}</p>
        ${sub ? `<p class="cr-sub">${esc(sub)}</p>` : ''}
        <span class="cr-cta">Continue reading →</span>
      </div>`;

    el.querySelector('.cr-card')?.addEventListener('click', () => openItem(item));
  }

  /* ═══════════════════════════════════════════════════════════
     3. renderRecentlyAdded
     ═══════════════════════════════════════════════════════════ */
  function renderRecentlyAdded() {
    const el = $('recentlyAdded');
    if (!el) return;

    const recent = allItems()
      .filter(i => !i.hidden)
      .sort((a, b) => (toDate(b.createdAt) ?? 0) - (toDate(a.createdAt) ?? 0))
      .slice(0, 5);

    if (!recent.length) {
      el.innerHTML = `<p class="ra-empty">No content yet.</p>`;
      return;
    }

    const rows = recent.map(item => {
      const meta = TYPE_META[item._type] ?? TYPE_META.text;
      const sub  = _itemSubtitle(item);
      return `
        <div class="ra-item" role="button" tabindex="0" data-id="${esc(item.id)}" data-type="${item._type}">
          <span class="material-symbols-outlined ra-icon">${meta.icon}</span>
          <div class="ra-info">
            <p class="ra-title">${esc(item.title ?? 'Untitled')}</p>
            ${sub ? `<p class="ra-sub">${esc(sub)}</p>` : ''}
          </div>
          <span class="ra-date">${relDate(item.createdAt)}</span>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="ra-feed">${rows}</div>`;

    el.querySelectorAll('.ra-item').forEach((el, idx) => {
      el.addEventListener('click', () => openItem(recent[idx]));
    });
  }

  /* ── Subtitle helper ─────────────────────────────────────── */
  function _itemSubtitle(item) {
    switch (item._type) {
      case 'text':   return item.author  ?? '';
      case 'video':  return item.channel ?? '';
      case 'model':  return item.field   ?? '';
      case 'memory': return relDate(item.createdAt);
      default:       return '';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     4. renderHeatmaps
     ═══════════════════════════════════════════════════════════ */
  function renderHeatmaps() {
    const items = allItems().filter(i => !i.hidden);
    const ek    = emailKey();

    const myAct     = {};   // date → my count
    const globalAct = {};   // date → global count
    const actIndex  = {};   // date → [{col, title, id, total, my}]

    items.forEach(item => {
      const rcs = item.readCounts ?? {};
      // Global: sum per day from all users  (we only have total counts, not per-day)
      // Use createdAt as proxy for "activity date" when per-day data absent
      // If per-read timestamps exist use them; otherwise fall back to createdAt
      const dates = _readDates(item);

      dates.forEach(({ date, userEk, count }) => {
        if (userEk === ek) {
          myAct[date] = (myAct[date] ?? 0) + count;
        }
        globalAct[date] = (globalAct[date] ?? 0) + count;

        if (!actIndex[date]) actIndex[date] = [];
        const existing = actIndex[date].find(e => e.id === item.id);
        if (!existing) {
          actIndex[date].push({
            col:   TYPE_META[item._type]?.color ?? '',
            title: item.title ?? 'Untitled',
            id:    item.id,
            total: totalR(item),
            my:    myRC(item),
          });
        }
      });
    });

    // Store for popup use
    window._hmActIndex = actIndex;

    renderHeatmap('myHm',     myAct,     true);
    renderHeatmap('globalHm', globalAct, false);
  }

  // Produce synthetic per-date read events from readCounts
  // If item has readDates map use it; else attribute all reads to createdAt date
  function _readDates(item) {
    const out = [];
    const rcs = item.readCounts ?? {};

    if (item.readDates && typeof item.readDates === 'object') {
      // readDates: { encodedEmail: { 'YYYY-MM-DD': count } }
      Object.entries(item.readDates).forEach(([userEk, days]) => {
        Object.entries(days).forEach(([date, count]) => {
          out.push({ date, userEk, count });
        });
      });
      return out;
    }

    // Fallback: attribute each user's reads to createdAt date
    const date = ymd(item.createdAt) || ymd(new Date());
    Object.entries(rcs).forEach(([userEk, count]) => {
      if (count > 0) out.push({ date, userEk, count });
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════
     5. renderHeatmap
     ═══════════════════════════════════════════════════════════ */
  function renderHeatmap(containerId, actMap, isMine) {
    const el = $(containerId);
    if (!el) return;

    const WEEKS  = 16;
    const today  = new Date();
    today.setHours(0, 0, 0, 0);

    // Build grid: 16 cols (weeks), 7 rows (days), newest week = rightmost
    const cols   = [];
    let   cursor = new Date(today);
    // Align to Sunday
    cursor.setDate(cursor.getDate() - cursor.getDay());
    // Move back WEEKS-1 more weeks
    cursor.setDate(cursor.getDate() - (WEEKS - 1) * 7);

    for (let w = 0; w < WEEKS; w++) {
      const week = { month: null, days: [] };
      for (let d = 0; d < 7; d++) {
        const dateStr  = ymd(cursor);
        const count    = actMap[dateStr] ?? 0;
        const intensity = count === 0 ? 0
          : count === 1 ? 1
          : count <= 3  ? 2
          : count <= 6  ? 3
          : 4;
        week.days.push({ dateStr, count, intensity });

        // Record month for label on first day of week (Monday = d===1)
        if (d === 1 || (w === 0 && d === 0)) {
          const m = cursor.toLocaleDateString('en', { month: 'short' });
          if (!week.month) week.month = m;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      // Month label: show if first week or month changed vs previous
      const lastWeekMonth = cols[w - 1]?.month;
      week.monthLabel = (!lastWeekMonth || week.month !== lastWeekMonth) ? week.month : '';
      cols.push(week);
    }

    // Render
    const colsHtml = cols.map(week => {
      const cells = week.days.map(({ dateStr, count, intensity }) =>
        `<div class="hm-cell" data-v="${intensity}" data-d="${dateStr}" data-c="${count}" title="${dateStr}: ${count}"></div>`
      ).join('');
      return `
        <div class="hm-col">
          ${cells}
          <div class="hm-month">${week.monthLabel ?? ''}</div>
        </div>`;
    }).join('');

    el.innerHTML = `<div class="hm-grid">${colsHtml}</div>`;

    el.querySelectorAll('.hm-cell').forEach(cell => {
      cell.addEventListener('click', e => {
        showHmPopup(cell.dataset.d, isMine, e.clientX, e.clientY);
        e.stopPropagation();
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════
     6. showHmPopup
     ═══════════════════════════════════════════════════════════ */
  function showHmPopup(date, isMine, cx, cy) {
    // Remove any existing popup
    document.querySelector('.hm-popup')?.remove();

    const items   = (window._hmActIndex?.[date]) ?? [];
    const label   = isMine ? 'My activity' : 'Global activity';
    const dateObj = new Date(date + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('en', { weekday:'short', month:'short', day:'numeric' });

    const rows = items.length
      ? items.map(it => `
          <div class="hm-pop-row">
            <span class="type-badge ${it.col} badge-sm">${esc(it.col.replace('badge-',''))}</span>
            <span class="hm-pop-title">${esc(it.title)}</span>
            <span class="hm-pop-count">${isMine ? it.my : it.total}×</span>
          </div>`).join('')
      : `<p class="hm-pop-empty">No activity</p>`;

    const popup = document.createElement('div');
    popup.className = 'hm-popup';
    popup.innerHTML = `
      <p class="hm-pop-head"><strong>${esc(dateStr)}</strong> · ${label}</p>
      ${rows}`;

    document.body.appendChild(popup);

    // Position avoiding edges
    const PAD  = 8;
    const rect = popup.getBoundingClientRect();
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;
    let   left = cx + 12;
    let   top  = cy + 12;
    if (left + rect.width  + PAD > vw) left = cx - rect.width  - 12;
    if (top  + rect.height + PAD > vh) top  = cy - rect.height - 12;
    popup.style.left = `${Math.max(PAD, left)}px`;
    popup.style.top  = `${Math.max(PAD, top)}px`;

    // Dismiss on next click
    const dismiss = () => { popup.remove(); document.removeEventListener('click', dismiss); };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  /* ═══════════════════════════════════════════════════════════
     7. renderHomeStreaks
     ═══════════════════════════════════════════════════════════ */
  function renderHomeStreaks() {
    const el = $('homeStreaks');
    if (!el) return;

    const streaks = computeStreaks().slice(0, 5);

    if (!streaks.length) {
      el.innerHTML = `<p class="streak-empty">No streaks yet. Start reading!</p>`;
      return;
    }

    el.innerHTML = streaks.map((s, i) => `
      <div class="streak-row">
        <span class="streak-rank">${i + 1}</span>
        <span class="streak-name">${esc(s.name || s.email)}</span>
        <span class="streak-val">
          <span class="material-symbols-outlined">local_fire_department</span>
          ${s.streak}d
        </span>
      </div>`).join('');
  }

  /* ═══════════════════════════════════════════════════════════
     8. renderLbPreview
     ═══════════════════════════════════════════════════════════ */
  function renderLbPreview() {
    const el = $('homeLbPreview');
    if (!el) return;

    const MEDALS = ['🥇', '🥈', '🥉'];
    const top3   = computeLb(allItems()).slice(0, 3);

    if (!top3.length) {
      el.innerHTML = `<p class="lb-empty">No reads recorded yet.</p>`;
      return;
    }

    const rows = top3.map((entry, i) => `
      <div class="lb-preview-item">
        <span class="lb-medal">${MEDALS[i]}</span>
        <span class="lb-prev-name">${esc(entry.name || entry.email)}</span>
        <span class="lb-prev-val">${entry.total} reads</span>
      </div>`).join('');

    el.innerHTML = `
      ${rows}
      <button class="lb-view-all link-btn" onclick="window.switchTab('insights')">
        View all →
      </button>`;
  }

  /* ═══════════════════════════════════════════════════════════
     computeLb(items) — exported
     ═══════════════════════════════════════════════════════════ */
  function computeLb(items) {
    const users   = window.allUsers ?? [];
    const totals  = {}; // encodedEmail → total

    items.forEach(item => {
      const rcs = item.readCounts ?? {};
      Object.entries(rcs).forEach(([ek, count]) => {
        totals[ek] = (totals[ek] ?? 0) + (count || 0);
      });
    });

    return Object.entries(totals)
      .map(([ek, total]) => {
        const email   = ek.replace(/,/g, '.');
        const userRec = users.find(u => u.email === email);
        return { ek, email, name: userRec?.name ?? userRec?.displayName ?? '', total };
      })
      .sort((a, b) => b.total - a.total);
  }

  /* ═══════════════════════════════════════════════════════════
     computeStreaks() — exported
     ═══════════════════════════════════════════════════════════ */
  function computeStreaks() {
    const users = window.allUsers ?? [];
    const items = allItems();

    // Build userDays: encodedEmail → Set of 'YYYY-MM-DD' strings with ≥1 read
    const userDays = {};

    items.forEach(item => {
      const dates = _readDates(item);
      dates.forEach(({ date, userEk, count }) => {
        if (count > 0) {
          if (!userDays[userEk]) userDays[userEk] = new Set();
          userDays[userEk].add(date);
        }
      });
    });

    const todayStr     = ymd(new Date());
    const yesterdayStr = ymd(new Date(Date.now() - 86_400_000));

    const result = users.map(u => {
      const ek   = emailKey(u.email);
      const days = userDays[ek];

      if (!days || !days.size) return { name: u.name ?? u.displayName ?? '', email: u.email, streak: 0 };

      const sorted = [...days].sort().reverse(); // newest first
      // Only count if active today or yesterday
      if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) {
        return { name: u.name ?? u.displayName ?? '', email: u.email, streak: 0 };
      }

      let streak  = 1;
      let current = sorted[0];

      for (let i = 1; i < sorted.length; i++) {
        const prev = ymd(new Date(new Date(current).getTime() - 86_400_000));
        if (sorted[i] === prev) {
          streak++;
          current = sorted[i];
        } else {
          break;
        }
      }

      return { name: u.name ?? u.displayName ?? '', email: u.email, streak };
    });

    return result.sort((a, b) => b.streak - a.streak);
  }

  /* ── Exports ─────────────────────────────────────────────── */
  window.renderHome     = renderHome;
  window.computeLb      = computeLb;
  window.computeStreaks  = computeStreaks;
})();
