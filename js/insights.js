/* insights.js — Chashma: The Archive
   Depends on : window.Utils, window.db, window.currentUser, window.userRole, window.allUsers
   Reads      : window.texts, window.videos, window.models, window.memories
   Calls      : window.computeLb, window.computeStreaks, window.showToast
   Exposes    : window.renderInsights
*/

(function () {
  'use strict';

  const U = window.Utils;

  // ─── COLLECTION HELPERS ───────────────────────────────────────────────────

  function allItems() {
    return [
      ...(window.texts    || []),
      ...(window.videos   || []),
      ...(window.models   || []),
      ...(window.memories || []),
    ];
  }

  function allContent() {               // excludes memories for velocity/tags
    return [
      ...(window.texts  || []),
      ...(window.videos || []),
      ...(window.models || []),
    ];
  }

  // ─── TIMESTAMP → ISO STRING ───────────────────────────────────────────────

  function toIso(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }

  function toDate(ts) {
    if (!ts) return null;
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d) ? null : d;
  }

  // ─── WEEK HELPERS ─────────────────────────────────────────────────────────

  /** Returns 'YYYY-MM-DD' of the Monday of the week containing dateStr. */
  function getWeekStart(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '';
    const day = d.getDay();                      // 0 Sun … 6 Sat
    const diff = (day === 0) ? -6 : 1 - day;    // shift to Monday
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  /** Returns array of n 'YYYY-MM-DD' Monday strings, oldest first, ending this week. */
  function buildWeekBuckets(n) {
    const today = new Date();
    const day   = today.getDay();
    const diff  = (day === 0) ? -6 : 1 - day;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() + diff);
    thisMonday.setHours(0, 0, 0, 0);

    const buckets = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(thisMonday);
      d.setDate(thisMonday.getDate() - i * 7);
      buckets.push(d.toISOString().slice(0, 10));
    }
    return buckets;
  }

  /** Counts items added per week (by createdAt) for the last n weeks. */
  function countByWeek(items, n) {
    const buckets = buildWeekBuckets(n);
    const counts  = Object.fromEntries(buckets.map(b => [b, 0]));
    const oldest  = buckets[0];

    items.forEach(item => {
      const iso = toIso(item.createdAt || item.date);
      if (!iso || iso < oldest) return;
      const ws = getWeekStart(iso);
      if (ws in counts) counts[ws]++;
    });

    return buckets.map(b => ({ week: b, count: counts[b] }));
  }

  /** Short label for a week bucket: 'Jan 6' */
  function weekLabel(isoDate) {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ─── 1. PERSONAL STATS ────────────────────────────────────────────────────

  function renderPersonal() {
    const el = document.getElementById('insightsPersonal');
    if (!el) return;

    const items = allItems();

    // Total reads
    const totalReads = items.reduce((s, m) => s + U.myRC(m), 0);

    // Avg rating given (only items where current user rated > 0)
    const myRatings = items
      .map(m => (m.ratings ?? {})[U.ek()])
      .filter(r => typeof r === 'number' && r > 0);
    const avgRating  = myRatings.length ? U.avg(myRatings) : NaN;
    const avgRatStr  = isNaN(avgRating) ? 'Not yet rated' : avgRating.toFixed(1) + '★';

    // Top tag across items the user has read
    const tagFreq = {};
    items.forEach(item => {
      if (U.myRC(item) > 0) {
        (item.tags || []).forEach(t => { tagFreq[t] = (tagFreq[t] || 0) + 1; });
      }
    });
    const topTagEntry = Object.entries(tagFreq).sort((a, b) => b[1] - a[1])[0];
    const topTag      = topTagEntry ? topTagEntry[0] : '—';

    // Day streak from computeStreaks
    let streak = '—';
    if (window.computeStreaks) {
      try {
        const streaks = window.computeStreaks();
        const ek      = U.ek();
        const uid     = window.currentUser?.uid;
        const entry   = streaks.find(s => s.uid === uid || s.email?.replace(/\./g, '_') === ek);
        if (entry) streak = entry.longest ?? entry.current ?? '—';
      } catch (e) {
        console.warn('computeStreaks error:', e);
      }
    }

    el.innerHTML = `
      <div class="ins-personal">
        ${statCard('Total Reads', totalReads, '📖', true)}
        ${statCard('Avg Rating Given', avgRatStr, '⭐', false)}
        ${statCard('Top Tag', U.esc(topTag), '🏷️', false)}
        ${statCard('Longest Streak', streak === '—' ? '—' : `${streak} <small>days</small>`, '🔥', false)}
      </div>`;
  }

  function statCard(label, value, icon, primary) {
    return `
      <div class="ins-stat-item">
        <div class="ins-stat-icon">${icon}</div>
        <div class="ins-stat-value${primary ? ' ins-stat-primary' : ''}">${value}</div>
        <div class="ins-stat-label">${U.esc(label)}</div>
      </div>`;
  }

  // ─── 2. READING VELOCITY CHART (SVG) ─────────────────────────────────────

  function renderVelocity() {
    const el = document.getElementById('insightsVelocity');
    if (!el) return;

    const WEEKS = 12;
    const data  = countByWeek(allContent(), WEEKS);
    const max   = Math.max(...data.map(d => d.count), 1);

    el.innerHTML = `<h3 class="ins-chart-title">Items Added per Week — Last 12 Weeks</h3>`;

    if (data.every(d => d.count === 0)) {
      el.innerHTML += `<p class="ins-empty">No items added yet.</p>`;
      return;
    }

    // SVG dimensions
    const W    = 600, H = 180;
    const padL = 36, padR = 12, padT = 16, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const barW   = Math.floor(chartW / WEEKS);
    const barGap = Math.max(2, Math.floor(barW * 0.18));
    const bw     = barW - barGap;

    // Grid lines at 0, mid, max
    const gridVals = [0, Math.round(max / 2), max];

    let bars = '', xLabels = '', gridLines = '', yLabels = '';

    gridVals.forEach(v => {
      const y = padT + chartH - Math.round((v / max) * chartH);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"
        stroke="var(--rule)" stroke-width="1" stroke-dasharray="4 3"/>`;
      yLabels += `<text x="${padL - 4}" y="${y + 4}" text-anchor="end"
        fill="var(--ink-3)" font-size="10">${v}</text>`;
    });

    data.forEach(({ week, count }, i) => {
      const x      = padL + i * barW + barGap / 2;
      const barH   = Math.max(count === 0 ? 0 : 2, Math.round((count / max) * chartH));
      const y      = padT + chartH - barH;
      const lbl    = weekLabel(week);
      const midI   = Math.floor(WEEKS / 2);

      bars += `
        <rect class="ins-bar" x="${x}" y="${y}" width="${bw}" height="${barH}"
          rx="2" fill="var(--pri)"
          data-count="${count}" data-week="${U.esc(lbl)}">
          <title>${lbl}: ${count}</title>
        </rect>`;

      // X labels: first, middle, last
      if (i === 0 || i === midI || i === WEEKS - 1) {
        xLabels += `<text x="${x + bw / 2}" y="${H - padB + 14}" text-anchor="middle"
          fill="var(--ink-3)" font-size="10">${U.esc(lbl)}</text>`;
      }
    });

    el.innerHTML += `
      <div class="ins-svg-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"
             class="ins-velocity-svg" aria-label="Items added per week">
          ${gridLines}
          ${yLabels}
          ${bars}
          ${xLabels}
        </svg>
      </div>`;
  }

  // ─── 3. TAG FREQUENCY BAR CHART (CSS) ────────────────────────────────────

  function renderTagBar() {
    const el = document.getElementById('insightsTagBar');
    if (!el) return;

    el.innerHTML = `<h3 class="ins-chart-title">Top Tags Across All Content</h3>`;

    const freq = {};
    allItems().forEach(item => {
      (item.tags || []).forEach(t => { freq[t] = (freq[t] || 0) + 1; });
    });

    const entries = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    if (!entries.length) {
      el.innerHTML += `<p class="ins-empty">No tags found across content.</p>`;
      return;
    }

    const maxCount = entries[0][1];

    const rows = entries.map(([tag, count], i) => {
      const pct = Math.round((count / maxCount) * 100);
      return `
        <div class="ins-tag-row" style="--delay:${i * 50}ms">
          <span class="ins-tag-label">${U.esc(tag)}</span>
          <div class="ins-tag-track">
            <div class="ins-tag-bar" style="width:0%;transition:width .45s ease calc(var(--delay) + 80ms)"
                 data-pct="${pct}"></div>
          </div>
          <span class="ins-tag-count">${count}</span>
        </div>`;
    }).join('');

    el.innerHTML += `<div class="ins-tag-chart">${rows}</div>`;

    // Animate bars after paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.querySelectorAll('.ins-tag-bar').forEach(bar => {
        bar.style.width = bar.dataset.pct + '%';
      });
    }));
  }

  // ─── 4. PER-AUTHOR BREAKDOWN ──────────────────────────────────────────────

  function renderAuthors() {
    const el = document.getElementById('insightsAuthors');
    if (!el) return;

    el.innerHTML = `<h3 class="ins-chart-title">Per-Author Breakdown</h3>`;

    const texts = window.texts || [];
    if (!texts.length) {
      el.innerHTML += `<p class="ins-empty">No texts available.</p>`;
      return;
    }

    // Group by author
    const byAuthor = {};
    texts.forEach(t => {
      const author = (t.author || 'Unknown').trim();
      if (!byAuthor[author]) byAuthor[author] = { items: [], ratings: [] };
      byAuthor[author].items.push(t);
      const rVals = Object.values(t.ratings ?? {}).filter(v => typeof v === 'number' && v > 0);
      byAuthor[author].ratings.push(...rVals);
    });

    const rows = Object.entries(byAuthor)
      .map(([author, { items, ratings }]) => ({
        author,
        count:    items.length,
        reads:    items.reduce((s, i) => s + U.totalR(i), 0),
        avgRat:   ratings.length ? U.avg(ratings) : NaN,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    if (!rows.length) {
      el.innerHTML += `<p class="ins-empty">No author data found.</p>`;
      return;
    }

    const trs = rows.map(r => `
      <tr>
        <td class="ins-author-name">${U.esc(r.author)}</td>
        <td class="ins-num">${r.count}</td>
        <td class="ins-num">${r.reads}</td>
        <td class="ins-num">${isNaN(r.avgRat) ? '—' : r.avgRat.toFixed(1) + '★'}</td>
      </tr>`).join('');

    el.innerHTML += `
      <div class="ins-table-wrap">
        <table class="ins-author-table">
          <thead>
            <tr>
              <th>Author</th>
              <th class="ins-num">Items</th>
              <th class="ins-num">Total Reads</th>
              <th class="ins-num">Avg Rating</th>
            </tr>
          </thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`;
  }

  // ─── 5. LEADERBOARD ───────────────────────────────────────────────────────

  function renderLeaderboard() {
    const el = document.getElementById('insightsLb');
    if (!el) return;

    el.innerHTML = `<h3 class="ins-chart-title">Leaderboard</h3>`;

    if (!window.computeLb) {
      el.innerHTML += `<p class="ins-empty">Leaderboard unavailable.</p>`;
      return;
    }

    const texts    = window.texts    || [];
    const videos   = window.videos   || [];
    const models   = window.models   || [];
    const memories = window.memories || [];

    const combined = [...texts, ...videos, ...models, ...memories];
    const top10    = window.computeLb(combined).slice(0, 10);

    el.innerHTML += buildLbTable(top10, 'Combined — All Collections');

    // 2×2 sub-leaderboards
    const subs = [
      { label: 'Texts',    items: texts },
      { label: 'Videos',   items: videos },
      { label: 'Models',   items: models },
      { label: 'Memories', items: memories },
    ];

    const subHtml = subs.map(s => {
      const lb = window.computeLb(s.items).slice(0, 5);
      return `<div class="ins-sub-lb">${buildLbTable(lb, s.label, true)}</div>`;
    }).join('');

    el.innerHTML += `<div class="ins-lb-grid">${subHtml}</div>`;
  }

  function buildLbTable(entries, title, compact = false) {
    if (!entries.length) {
      return `<div class="ins-lb-block">
        <div class="ins-lb-subtitle">${U.esc(title)}</div>
        <p class="ins-empty">No data yet.</p>
      </div>`;
    }

    const medals = ['🥇', '🥈', '🥉'];

    const rows = entries.map((e, i) => {
      const rank     = i + 1;
      const medal    = medals[i] || `<span class="ins-rank">${rank}</span>`;
      const name     = U.esc(e.name || e.email || 'Unknown');
      const reads    = e.reads ?? 0;
      const avgRat   = isNaN(e.avgRating) || e.avgRating == null
        ? '—' : Number(e.avgRating).toFixed(1) + '★';

      return compact
        ? `<tr>
            <td class="ins-medal">${medal}</td>
            <td class="ins-lb-name">${name}</td>
            <td class="ins-num">${reads}</td>
           </tr>`
        : `<tr>
            <td class="ins-medal">${medal}</td>
            <td class="ins-lb-name">${name}</td>
            <td class="ins-num">${reads}</td>
            <td class="ins-num">${avgRat}</td>
           </tr>`;
    }).join('');

    const thead = compact
      ? `<tr><th></th><th>User</th><th class="ins-num">Reads</th></tr>`
      : `<tr><th></th><th>User</th><th class="ins-num">Reads</th><th class="ins-num">Avg ★</th></tr>`;

    return `
      <div class="ins-lb-block">
        <div class="ins-lb-subtitle">${U.esc(title)}</div>
        <table class="ins-lb-table">
          <thead>${thead}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ─── 6. OWNER ACTIVITY LOG ────────────────────────────────────────────────

  const ACTION_LABELS = {
    mark_read:    'Marked Read',
    rate:         'Rated',
    open:         'Opened',
    play:         'Played',
    open_link:    'Opened Link',
    view_detail:  'Viewed Detail',
    toggle_private: 'Toggled Private',
    create_memory:  'Created Memory',
    edit_memory:    'Edited Memory',
    delete_memory:  'Deleted Memory',
  };

  const COLL_LABELS = {
    text:    'Text',
    video:   'Video',
    model:   'Model',
    memory:  'Memory',
  };

  async function renderActLog() {
    const el = document.getElementById('insightsActLog');
    if (!el) return;

    if (!U.isOwner()) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.innerHTML = `<h3 class="ins-chart-title">Activity Log — Last 7 Days</h3>
      <p class="ins-loading">Loading…</p>`;

    try {
      const { collection, query, where, orderBy, getDocs, Timestamp } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const since  = new Date();
      since.setDate(since.getDate() - 7);
      const sinceTs = Timestamp.fromDate(since);

      const snap = await getDocs(
        query(
          collection(window.db, 'activityLog'),
          where('ts', '>=', sinceTs),
          orderBy('ts', 'desc')
        )
      );

      const logs = [];
      snap.forEach(d => logs.push({ id: d.id, ...d.data() }));

      if (!logs.length) {
        el.innerHTML = `<h3 class="ins-chart-title">Activity Log — Last 7 Days</h3>
          <p class="ins-empty">No activity in the last 7 days.</p>`;
        return;
      }

      // Group by user, then by day
      const byUser = {};
      logs.forEach(log => {
        const uid  = log.uid || 'unknown';
        const day  = toIso(log.ts);
        if (!byUser[uid]) byUser[uid] = { uid, name: log.name || log.email || uid, email: log.email || '', days: {} };
        if (!byUser[uid].days[day]) byUser[uid].days[day] = [];
        byUser[uid].days[day].push(log);
      });

      const userBlocks = Object.values(byUser).map(user => {
        const dayBlocks = Object.entries(user.days)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([day, entries]) => {
            // Count by action
            const actionCounts = {};
            entries.forEach(e => {
              const key = e.action || 'unknown';
              actionCounts[key] = (actionCounts[key] || 0) + 1;
            });
            const maxAct = Math.max(...Object.values(actionCounts), 1);

            const bars = Object.entries(actionCounts).map(([action, cnt]) => {
              const pct   = Math.round((cnt / maxAct) * 100);
              const label = ACTION_LABELS[action] || action;
              return `
                <div class="ins-act-row">
                  <span class="ins-act-label">${U.esc(label)}</span>
                  <div class="ins-act-track">
                    <div class="ins-act-bar" style="width:${pct}%"></div>
                  </div>
                  <span class="ins-act-count">${cnt}</span>
                </div>`;
            }).join('');

            const d = new Date(day + 'T00:00:00');
            const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

            return `
              <div class="ins-act-day">
                <div class="ins-act-day-label">${U.esc(dayStr)}</div>
                ${bars}
              </div>`;
          }).join('');

        return `
          <div class="ins-act-user">
            <div class="ins-act-user-header">
              <span class="ins-act-user-name">${U.esc(user.name)}</span>
              <span class="ins-act-user-email">${U.esc(user.email)}</span>
            </div>
            ${dayBlocks}
          </div>`;
      }).join('');

      el.innerHTML = `
        <h3 class="ins-chart-title">Activity Log — Last 7 Days</h3>
        <div class="ins-act-log">${userBlocks}</div>`;

    } catch (err) {
      console.error('renderActLog:', err);
      el.innerHTML = `<h3 class="ins-chart-title">Activity Log</h3>
        <p class="ins-empty ins-error">Failed to load activity log.</p>`;
    }
  }

  // ─── MAIN RENDER ──────────────────────────────────────────────────────────

  async function renderInsights() {
    renderPersonal();
    renderVelocity();
    renderTagBar();
    renderAuthors();
    renderLeaderboard();
    await renderActLog();
  }

  // ─── EXPOSE ───────────────────────────────────────────────────────────────

  window.renderInsights = renderInsights;

})();
