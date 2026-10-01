'use strict';
// Links to bina.et pages that do not exist are taken out of Bini's reply before it is sent.
//
// 1 Oct 2026: the nightly guard caught "/Cashier" (a job title turned into a link) - a user tapping it lands on a
// 404. A fixed list of pages cannot decide this: many real pages are routes, not files (/employers, /agent,
// /health?q=…, every /hotel/<slug>). So each bina.et link is checked against the live site once and the answer is
// cached for an hour. Anything uncertain (timeout, network error, 5xx) keeps the link: this guard only removes a
// link the site itself says is not there (404 / 410).
//
//   [label](/missing)                 -> label
//   https://bina.et/missing, bina.et/missing -> bina.et
//   /missing (bare)                   -> missing

const TTL = 3600 * 1000;
const cache = new Map();   // path -> { ok, t }

// A bina.et link in any of the three shapes. Group 1 = markdown label, 2 = path inside markdown,
// 3 = path after an explicit bina.et host, 4 = a bare /path.
const LINK = /\[([^\]]{1,120})\]\((?:https?:\/\/(?:www\.)?bina\.et)?(\/[^)\s]*)\)|(?:https?:\/\/)?(?:www\.)?bina\.et(\/[A-Za-z0-9][A-Za-z0-9\-_/]*(?:\?[A-Za-z0-9=&%+\-_.]+)?)|(?<![\w/:.\])])(\/[A-Za-z][A-Za-z0-9\-_]*(?:\/[A-Za-z0-9\-_]+)*)(?![\w/])/g;

function clean(p) { return String(p || '').replace(/[።,.;:!?)\]]+$/, ''); }

async function defaultExists(p, base) {
  try {
    const r = await fetch(base + p, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'BiniLinkCheck/1.0' }, signal: AbortSignal.timeout(2000) });
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (e) { /* body already closed */ }
    return !(r.status === 404 || r.status === 410);
  } catch (e) { return true; }   // cannot tell -> keep the link
}

async function pathOk(p, opts) {
  const now = Date.now(), hit = cache.get(p);
  if (hit && now - hit.t < TTL) return hit.ok;
  const ok = await (opts.exists || defaultExists)(p, opts.base || 'https://bina.et');
  cache.set(p, { ok, t: now });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return ok;
}

async function fix(text, opts = {}) {
  if (!text || typeof text !== 'string') return text;
  const found = new Map();
  for (const m of text.matchAll(LINK)) {
    const p = clean(m[2] || m[3] || m[4]);
    if (p && p !== '/' && !/^\/\d/.test(p)) found.set(p, true);
  }
  if (!found.size) return text;
  const bad = new Set();
  await Promise.all([...found.keys()].slice(0, 12).map(async p => { if (!(await pathOk(p, opts))) bad.add(p); }));
  if (!bad.size) return text;
  if (opts.log) opts.log('[bini] removed dead link(s): ' + [...bad].join(' '));
  return text.replace(LINK, (all, label, mdPath, hostPath, barePath) => {
    const raw = mdPath || hostPath || barePath, p = clean(raw), tail = raw.slice(p.length);
    if (!bad.has(p)) return all;
    if (mdPath) return label;
    if (hostPath) return all.slice(0, all.length - raw.length) + tail;   // keep "https://bina.et" / "bina.et"
    return p.slice(1).replace(/[-_]/g, ' ') + tail;
  });
}

module.exports = { fix, _cache: cache };
