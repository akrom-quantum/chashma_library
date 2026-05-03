/* ═══════════════════════════════════════════════════════════════
   utils.js — Chashma: The Archive
   Pure utility functions. No DOM side-effects. No Firebase calls.
   All exported via window.Utils.
════════════════════════════════════════════════════════════════ */

window.Utils = (() => {

  /* ─────────────────────────────────────────────────────────────
     1. SECURITY
  ────────────────────────────────────────────────────────────── */

  /** XSS-safe HTML escape. */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  /** Sanitize HTML via DOMPurify if available, else return as-is. */
  function safe(html) {
    return (typeof DOMPurify !== 'undefined')
      ? DOMPurify.sanitize(html)
      : html;
  }


  /* ─────────────────────────────────────────────────────────────
     2. LOCAL STORAGE
  ────────────────────────────────────────────────────────────── */

  /** Get + JSON-parse from localStorage. Returns null on any error. */
  function lsG(k) {
    try { return JSON.parse(localStorage.getItem(k)); }
    catch { return null; }
  }

  /** JSON-stringify + set in localStorage. */
  function lsS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch { /* storage full or private mode */ }
  }


  /* ─────────────────────────────────────────────────────────────
     3. DOM SHORTHAND
  ────────────────────────────────────────────────────────────── */

  /** document.getElementById shorthand. */
  function $(id) {
    return document.getElementById(id);
  }


  /* ─────────────────────────────────────────────────────────────
     4. MATH / RATINGS
  ────────────────────────────────────────────────────────────── */

  /**
   * Average of all numeric values in an object or array.
   * Returns NaN if the collection is empty.
   */
  function avg(r) {
    const vals = Array.isArray(r) ? r : Object.values(r ?? {});
    const nums = vals.filter(v => typeof v === 'number' && !isNaN(v));
    if (!nums.length) return NaN;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  /** avg() formatted to 1 decimal, or '—' if NaN. */
  function avgStr(r) {
    const n = avg(r);
    return isNaN(n) ? '—' : n.toFixed(1);
  }

  /** Returns a <span> with rating★ coloured gold, or '—★'. */
  function starsHtml(r) {
    const n = avg(r);
    if (isNaN(n)) return '<span style="color:var(--ink-4)">—★</span>';
    return `<span class="rating-txt">${n.toFixed(1)}★</span>`;
  }


  /* ─────────────────────────────────────────────────────────────
     5. USER / ROLE HELPERS
     These read window globals set by auth.js — documented as such.
  ────────────────────────────────────────────────────────────── */

  /** Email key: currentUser.email with dots → underscores. */
  function ek() {
    try { return (window.currentUser?.email ?? '').replace(/\./g, '_'); }
    catch { return ''; }
  }

  /** Rating for the current user from a ratings map. */
  function userRating(r) {
    return (r ?? {})[ek()] || 0;
  }

  /**
   * Read count for the current user.
   * Handles legacy items that stored a boolean `read` field.
   */
  function myRC(item) {
    const k = ek();
    if (!k) return 0;
    const counts = item?.readCounts;
    if (counts && typeof counts === 'object') return counts[k] || 0;
    // Legacy: boolean read flag counts as 1
    if (item?.read === true) return 1;
    return 0;
  }

  /** Whether the current user has read this item at least once. */
  function iRead(item) {
    return myRC(item) > 0;
  }

  /** Total reads across all users on an item. */
  function totalR(item) {
    const counts = item?.readCounts;
    if (counts && typeof counts === 'object') {
      return Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    }
    return Number(item?.readCount) || 0;
  }

  /** True if current user can edit (owner or admin). */
  function isEdit() {
    return window.userRole === 'owner' || window.userRole === 'admin';
  }

  /** True if current user is the owner. */
  function isOwner() {
    return window.userRole === 'owner';
  }


  /* ─────────────────────────────────────────────────────────────
     6. DATE / STRING HELPERS
  ────────────────────────────────────────────────────────────── */

  /** Returns today as 'YYYY-MM-DD'. */
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Parses a string of hashtags (with or without leading #).
   * Returns a deduplicated array of '#tag' strings, lowercased.
   * Accepts both '#foo #bar' and 'foo, bar' formats.
   */
  function parseTags(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const tokens = raw.split(/[\s,]+/).filter(Boolean);
    const seen = new Set();
    const result = [];
    for (const t of tokens) {
      const tag = '#' + t.replace(/^#+/, '').toLowerCase().trim();
      if (tag.length > 1 && !seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
    return result;
  }

  /**
   * Formats a 'YYYY-MM-DD' string to human-readable 'Jan 2025'.
   * Returns the original string if parsing fails.
   */
  function formatDateLabel(isoStr) {
    if (!isoStr || typeof isoStr !== 'string') return isoStr || '';
    try {
      // Append T00:00 to prevent UTC-offset day-shift
      const d = new Date(isoStr.slice(0, 7) + '-01T00:00');
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return isoStr;
    }
  }

  /**
   * Groups an array of items by 'YYYY-MM' from a given date field.
   * Returns an object sorted newest-first.
   * Items missing the dateField are placed under key 'undated'.
   */
  function groupByMonth(items, dateField) {
    const groups = {};
    for (const item of items) {
      const raw = item?.[dateField];
      const key = (typeof raw === 'string' && raw.length >= 7)
        ? raw.slice(0, 7)
        : 'undated';
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    // Sort keys newest-first; 'undated' goes last
    const sorted = {};
    const keys = Object.keys(groups).sort((a, b) => {
      if (a === 'undated') return 1;
      if (b === 'undated') return -1;
      return b.localeCompare(a);
    });
    for (const k of keys) sorted[k] = groups[k];
    return sorted;
  }


  /* ─────────────────────────────────────────────────────────────
     7. YOUTUBE
  ────────────────────────────────────────────────────────────── */

  const YT_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/;

  /** Extracts an 11-char YouTube video ID from any YouTube URL. */
  function extractYtId(url) {
    if (!url) return null;
    const m = String(url).match(YT_RE);
    return m ? m[1] : null;
  }

  /** Returns the hqdefault thumbnail URL for a YouTube link, or null. */
  function ytThumb(url) {
    const id = extractYtId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
  }


  /* ─────────────────────────────────────────────────────────────
     8. MARKDOWN PARSER
  ────────────────────────────────────────────────────────────── */

  /**
   * Full Markdown → HTML parser.
   * Supports: footnotes, wikilinks (unless skipWiki), callout blockquotes,
   * GFM tables, h1-h3, bold/italic/strikethrough, inline code, links,
   * hashtag obs-badges, ul/ol lists, hr, paragraph wrapping.
   * Returns a sanitized HTML string.
   *
   * @param {string} raw       - Raw markdown input
   * @param {boolean} skipWiki - If true, skip [[wikilink]] processing
   */
  function parseMd(raw, skipWiki = false) {
    if (!raw) return '';
    let s = String(raw);

    // ── Footnote definitions: [^n]: text → collect, strip, append
    const footnotes = {};
    s = s.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_, n, text) => {
      footnotes[n] = text.trim();
      return '';
    });

    // ── Escape HTML except in code blocks (we'll handle code inline)
    // Strategy: process block-level first, protect code spans, then inline

    // ── Fenced code blocks ```lang\n...\n```
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const cls = lang ? ` class="language-${esc(lang)}"` : '';
      return `<pre><code${cls}>${esc(code.trim())}</code></pre>`;
    });

    // ── Protect inline code from further processing
    const codeStash = [];
    s = s.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeStash.push(`<code>${esc(code)}</code>`) - 1;
      return `\x00CODE${idx}\x00`;
    });

    // ── Horizontal rule
    s = s.replace(/^[-*_]{3,}\s*$/gm, '<hr>');

    // ── Headings
    s = s.replace(/^### (.+)$/gm,  (_, t) => `<h3>${t.trim()}</h3>`);
    s = s.replace(/^## (.+)$/gm,   (_, t) => `<h2>${t.trim()}</h2>`);
    s = s.replace(/^# (.+)$/gm,    (_, t) => `<h1>${t.trim()}</h1>`);

    // ── GFM Tables
    s = s.replace(
      /^\|(.+)\|\s*\n\|[-:| ]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm,
      (_, header, body) => {
        const th = header.split('|').filter(c => c.trim())
          .map(c => `<th>${c.trim()}</th>`).join('');
        const rows = body.trim().split('\n').filter(Boolean).map(row => {
          const tds = row.split('|').filter(c => c.trim())
            .map(c => `<td>${c.trim()}</td>`).join('');
          return `<tr>${tds}</tr>`;
        }).join('');
        return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
      }
    );

    // ── Callout blockquotes: > [!TYPE] Title\n> body
    s = s.replace(
      /^> \[!(\w+)\]\s*(.*)\n((?:> .*\n?)*)/gm,
      (_, type, title, body) => {
        const t = type.toLowerCase();
        const content = body.replace(/^> ?/gm, '').trim();
        const titleHtml = title ? `<strong>${esc(title)}</strong><br>` : '';
        return `<blockquote class="callout callout-${esc(t)}">${titleHtml}${content}</blockquote>`;
      }
    );

    // ── Standard blockquotes
    s = s.replace(/^((?:> .+\n?)+)/gm, block => {
      const inner = block.replace(/^> ?/gm, '').trim();
      return `<blockquote>${inner}</blockquote>`;
    });

    // ── Unordered lists
    s = s.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, block => {
      const items = block.trim().split('\n').map(line =>
        `<li>${line.replace(/^[ \t]*[-*+] /, '').trim()}</li>`
      ).join('');
      return `<ul>${items}</ul>`;
    });

    // ── Ordered lists
    s = s.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, block => {
      const items = block.trim().split('\n').map(line =>
        `<li>${line.replace(/^[ \t]*\d+\. /, '').trim()}</li>`
      ).join('');
      return `<ol>${items}</ol>`;
    });

    // ── Wikilinks: [[Title]] → obs-badge (unless skipWiki)
    if (!skipWiki) {
      s = s.replace(/\[\[([^\]]+)\]\]/g, (_, title) =>
        `<span class="obs-badge">${esc(title)}</span>`
      );
    }

    // ── Hashtags → obs-badge
    s = s.replace(/(^|\s)(#[A-Za-z][A-Za-z0-9_-]*)/g, (_, pre, tag) =>
      `${pre}<span class="obs-badge">${esc(tag)}</span>`
    );

    // ── Footnote references: [^n] → superscript link
    s = s.replace(/\[\^([^\]]+)\]/g, (_, n) =>
      `<sup class="fn-n" title="${esc(footnotes[n] || '')}"><a href="#fn-${esc(n)}">[${esc(n)}]</a></sup>`
    );

    // ── Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) =>
      `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    );

    // ── Inline formatting (order matters)
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    s = s.replace(/~~(.+?)~~/g,          '<del>$1</del>');
    s = s.replace(/_(.+?)_/g,            '<em>$1</em>');

    // ── Restore code spans
    s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeStash[+i]);

    // ── Paragraph wrapping
    // Wrap lines that are not already block-level elements
    const blockTags = /^<(h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|pre|hr|div)/i;
    const lines = s.split('\n');
    const out = [];
    let pBuf = [];

    const flushP = () => {
      const text = pBuf.join(' ').trim();
      if (text) out.push(`<p>${text}</p>`);
      pBuf = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushP();
      } else if (blockTags.test(trimmed)) {
        flushP();
        out.push(trimmed);
      } else {
        pBuf.push(trimmed);
      }
    }
    flushP();
    s = out.join('\n');

    // ── Footnote definitions block
    if (Object.keys(footnotes).length) {
      const fnHtml = Object.entries(footnotes).map(([n, text]) =>
        `<p id="fn-${esc(n)}"><span class="fn-n">[${esc(n)}]</span> ${text}</p>`
      ).join('');
      s += `<div class="md-footnotes">${fnHtml}</div>`;
    }

    return safe(s);
  }

  /**
   * Replaces [[Title]] wikilinks with clickable .wikilink spans
   * (or .wikilink.cs if not found in models), then calls parseMd.
   *
   * @param {string}   raw    - Raw markdown
   * @param {Array}    models - Array of model objects with a `title` field
   */
  function parseMdWiki(raw, models = []) {
    if (!raw) return '';
    const modelMap = new Set((models || []).map(m => (m.title || '').toLowerCase()));

    const linked = String(raw).replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
      const found = modelMap.has(title.toLowerCase());
      const cls   = found ? 'wikilink' : 'wikilink cs';
      return `<span class="${cls}" data-title="${esc(title)}">${esc(title)}</span>`;
    });

    return parseMd(linked, true);
  }


  /* ─────────────────────────────────────────────────────────────
     9. SORTING
  ────────────────────────────────────────────────────────────── */

  /**
   * Sorts an array of items in place.
   * by: 'order' | 'rating' | 'reads' | 'title' | 'channel' | 'field' | 'num' | 'date'
   * dir: 1 (asc) | -1 (desc)
   * Tiebreaker: date then title alphabetically.
   */
  function sortItems(data, by = 'date', dir = -1) {
    if (!Array.isArray(data)) return data;

    const str = v => String(v ?? '').toLowerCase();
    const num = v => Number(v) || 0;

    return [...data].sort((a, b) => {
      let diff = 0;

      switch (by) {
        case 'order':
          diff = num(a.order) - num(b.order);
          break;
        case 'rating':
          diff = avg(a.ratings ?? {}) - avg(b.ratings ?? {});
          break;
        case 'reads':
          diff = totalR(a) - totalR(b);
          break;
        case 'title':
          diff = str(a.title).localeCompare(str(b.title));
          break;
        case 'channel':
          diff = str(a.channel).localeCompare(str(b.channel));
          break;
        case 'field':
          diff = str(a.field).localeCompare(str(b.field));
          break;
        case 'num':
          diff = num(a.num ?? a.order) - num(b.num ?? b.order);
          break;
        case 'date':
        default:
          diff = str(a.date ?? a.createdAt ?? '').localeCompare(str(b.date ?? b.createdAt ?? ''));
      }

      if (diff !== 0) return diff * dir;

      // Tiebreaker 1: date
      const dateDiff = str(a.date ?? a.createdAt ?? '').localeCompare(str(b.date ?? b.createdAt ?? ''));
      if (dateDiff !== 0) return dateDiff * -1; // newest first as tiebreaker

      // Tiebreaker 2: title alphabetically
      return str(a.title).localeCompare(str(b.title));
    });
  }


  /* ─────────────────────────────────────────────────────────────
     10. EXPORT
  ────────────────────────────────────────────────────────────── */

  /** Converts an array of objects to a TSV string. */
  function toTsv(rows) {
    if (!rows?.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join('\t'),
      ...rows.map(r =>
        headers.map(h => {
          const v = r[h] ?? '';
          const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
          return s.replace(/\t/g, ' ').replace(/\n/g, ' ');
        }).join('\t')
      )
    ];
    return lines.join('\n');
  }

  /**
   * Copies text to clipboard.
   * Falls back to execCommand if Clipboard API unavailable.
   * @param {string} text  - Text to copy
   * @param {string} label - Used for console confirmation only
   */
  function copyClip(text, label = 'Text') {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => _execCopy(text));
    } else {
      _execCopy(text);
    }
  }

  function _execCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* silent */ }
    document.body.removeChild(ta);
  }


  /* ─────────────────────────────────────────────────────────────
     11. SEARCH HELPERS
  ────────────────────────────────────────────────────────────── */

  /**
   * Wraps all case-insensitive matches of query in <mark> tags.
   * HTML-escapes the text first to prevent XSS.
   */
  function highlightText(text, query) {
    if (!query || !text) return esc(String(text ?? ''));
    const escaped = esc(String(text));
    const escapedQ = esc(String(query)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedQ, 'gi'), m => `<mark>${m}</mark>`);
  }

  /**
   * Returns a short excerpt (±radius chars) around the first match
   * of query in text, with <mark> wrapping the match.
   * Returns the full (escaped) text if no match found.
   */
  function excerptAround(text, query, radius = 60) {
    const s = String(text ?? '');
    if (!query) return esc(s);
    const idx = s.toLowerCase().indexOf(String(query).toLowerCase());
    if (idx === -1) return esc(s);

    const start  = Math.max(0, idx - radius);
    const end    = Math.min(s.length, idx + query.length + radius);
    const pre    = start > 0 ? '…' : '';
    const post   = end < s.length ? '…' : '';
    const before = esc(s.slice(start, idx));
    const match  = esc(s.slice(idx, idx + query.length));
    const after  = esc(s.slice(idx + query.length, end));

    return `${pre}${before}<mark>${match}</mark>${after}${post}`;
  }


  /* ─────────────────────────────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────────────────────────────── */

  return {
    esc,
    safe,
    lsG,
    lsS,
    $,
    avg,
    avgStr,
    starsHtml,
    ek,
    userRating,
    myRC,
    iRead,
    totalR,
    isEdit,
    isOwner,
    todayStr,
    parseTags,
    extractYtId,
    ytThumb,
    parseMd,
    parseMdWiki,
    sortItems,
    toTsv,
    copyClip,
    formatDateLabel,
    groupByMonth,
    highlightText,
    excerptAround
  };

})();
