'use strict';
// Retention (design §5.10). A watch item is news, and news stops being true.
//
// Three rules, and the customs item is the reason all three exist. On 17 September the commission announced
// that every branch would serve until 19:00 from Meskerem 7 to Meskerem 30, 2019 EC. That is the single most
// useful item in the survey, and on 11 October it is a false statement about opening hours.
//
//   1. expires_at. Ninety days by default; an item that names its own end date takes that date. The date is
//      read in both calendars through assistant/dates.js — the announcement says መስከረም 30 ቀን 2019 ዓ.ም, and
//      that is 10 October 2026, not a date in December.
//   2. Superseded by curation. When the curated document behind the announcement lands in a pack, the watch
//      item steps aside with status: "superseded" and superseded_by naming the document that replaced it.
//   3. A nightly sweep retires what is past.
//
// NOTHING is deleted from disk, ever. knowledge/index.js skips a document whose status is not live and one
// whose expires_at has passed, so retiring an item removes it from the index and leaves the record of what was
// announced exactly where it was. The ingest's orphan collection drops its chunks on the next run.

const fs = require('fs');
const path = require('path');
const { parseDates, ethToGreg } = require('../../../assistant/dates');
const { PACK_SOURCES } = require('../../../knowledge/index');

const DEFAULT_TTL_DAYS = 90;
const MAX_AHEAD_DAYS = 400;   // a date further off than this is a proclamation year, not this notice's last day
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);
function addDays(day, n) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

// The last day an announcement says it is true for, or ''. Every full date in the text is read in its own
// calendar; an Ethiopian one is converted. Only a date AFTER the day it was announced can be an end date, and
// only one inside the next 400 days — "Regulation 394/2016" is a number, and 2016 is not next October.
function endDateIn(text, { reportedAt } = {}) {
  const from = ISO.test(String(reportedAt || '')) ? reportedAt : '';
  const out = [];
  for (const d of parseDates(String(text || ''))) {
    let y = d.y, m = d.m, day = d.d;
    if (d.cal === 'eth') {
      const g = ethToGreg(d.y, d.m, d.d);
      if (!g) continue;
      y = g.y; m = g.m; day = g.d;
    }
    if (!y || !m || !day) continue;
    const s = iso(y, m, day);
    if (!from) { out.push(s); continue; }
    const ahead = daysBetween(from, s);
    if (ahead < 0 || ahead > MAX_AHEAD_DAYS) continue;
    out.push(s);
  }
  if (!out.length) return '';
  // The end of a range is its later date: "from Meskerem 7 to Meskerem 30" ends on the 30th.
  return out.sort().pop();
}

// expires_at for one item: its own end date if it named one, otherwise ninety days.
function expiresFor(text, { reportedAt, ttlDays = DEFAULT_TTL_DAYS } = {}) {
  const own = endDateIn(text, { reportedAt });
  return own || (ISO.test(String(reportedAt || '')) ? addDays(reportedAt, ttlDays) : '');
}

// ---------- the sweep ----------
function splitDoc(raw) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!fm) return null;
  const meta = {}; const order = [];
  for (const line of fm[1].split('\n')) {
    const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line);
    if (m) { meta[m[1]] = m[2].replace(/\\"/g, '"'); order.push(m[1]); }
  }
  return { meta, order, body: raw.slice(fm[0].length) };
}
function renderDoc(d) {
  const keys = d.order.filter(k => d.meta[k] !== undefined);
  for (const k of Object.keys(d.meta)) if (!keys.includes(k)) keys.push(k);
  return ['---', ...keys.map(k => k + ': "' + String(d.meta[k]).replace(/"/g, '\\"') + '"'), '---', ''].join('\n') + d.body;
}

// Every url a curated document already carries, mapped to the document that carries it. `watch` is not in it:
// a watch item cannot supersede another watch item.
function curatedUrls(root) {
  const out = new Map();
  for (const [source] of PACK_SOURCES) {
    if (source === 'watch') continue;
    const dir = path.join(root, 'knowledge', source);
    let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch (e) { continue; }
    for (const f of files) {
      let raw; try { raw = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { continue; }
      const d = splitDoc(raw);
      if (!d || !d.meta.url) continue;
      if (d.meta.status && d.meta.status !== 'live') continue;
      out.set(String(d.meta.url).replace(/\/$/, ''), source + '/' + f.replace(/\.md$/, ''));
    }
  }
  return out;
}

// The links an announcement carried, read back off the document it became.
const LINKED = /^(?:Linked|የተያያዙ አድራሻዎች፦|Source|ምንጭ፦)[:፦]?\s*(.+)$/gm;
function linkedUrls(body) {
  const out = [];
  for (const m of String(body || '').matchAll(LINKED))
    for (const u of String(m[1]).split(/\s+/)) if (/^https?:\/\//.test(u) && !/t\.me/.test(u)) out.push(u.replace(/\/$/, ''));
  return [...new Set(out)];
}

// today's sweep. Returns what it retired; writes only status, superseded_by and lastChecked, and never removes
// a file. dryRun reads everything and writes nothing.
function sweep({ root, today, dryRun = false, log = () => {} } = {}) {
  const day = String(today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const dir = path.join(root, 'knowledge', 'watch');
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch (e) { return { expired: [], superseded: [], live: 0 }; }
  const curated = curatedUrls(root);
  const expired = [], superseded = [];
  let live = 0;
  for (const f of files) {
    let raw; try { raw = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { continue; }
    const d = splitDoc(raw);
    if (!d || (d.meta.status && d.meta.status !== 'live')) continue;
    const slug = f.replace(/\.md$/, '');
    // Curation first: a superseded item is superseded whether or not it had also run out of days, and that is
    // the more useful thing for the record to say.
    const by = linkedUrls(d.body).map(u => curated.get(u)).find(Boolean);
    if (by) {
      d.meta.status = 'superseded';
      d.meta.superseded_by = by;
      d.meta.lastChecked = day;
      superseded.push({ slug, by });
      log('[watch-retention] ' + slug + ': superseded by ' + by + (dryRun ? ' [DRY RUN]' : ''));
    } else if (d.meta.expires_at && ISO.test(d.meta.expires_at) && d.meta.expires_at < day) {
      d.meta.status = 'expired';
      d.meta.lastChecked = day;
      expired.push({ slug, expires_at: d.meta.expires_at });
      log('[watch-retention] ' + slug + ': past its last day, ' + d.meta.expires_at + (dryRun ? ' [DRY RUN]' : ''));
    } else { live++; continue; }
    if (!dryRun) fs.writeFileSync(path.join(dir, f), renderDoc(d));
  }
  return { expired, superseded, live };
}

module.exports = { endDateIn, expiresFor, sweep, curatedUrls, linkedUrls, splitDoc, renderDoc, addDays, DEFAULT_TTL_DAYS };
