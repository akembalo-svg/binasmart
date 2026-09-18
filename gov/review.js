'use strict';
// The review queue for "report a wrong answer". Only on the visitor's explicit consent (add() and
// gov/routes.js both check consent === true), only scrubbed text (gov/filters.js scrub), and only for 90 days. This is the one place a
// government visitor's question can reach our disk (design §7).
const fs = require('fs');
const path = require('path');
const { scrub } = require('./filters');

const ROOT = '/root/storage/gov/review';
const RETAIN_DAYS = 90;
const ID = /^[a-z0-9-]{2,32}$/;
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

function cleanSources(list) {
  return (Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object' && /^https?:\/\//.test(String(s.url || '')))
    .slice(0, 3).map(s => Object.assign({ title: scrub(s.title, 120), url: String(s.url).slice(0, 500) },
      /^\d{4}-\d{2}-\d{2}$/.test(String(s.fetched || '')) ? { fetched: s.fetched } : {}));
}

function makeReview({ root = process.env.GOV_REVIEW_DIR || ROOT, now = Date.now } = {}) {
  let prunedAt = -Infinity;
  function prune(force = false) {
    const t = now();
    if (!force && t - prunedAt < 3_600_000) return;
    prunedAt = t;
    const cutoff = new Date(t - RETAIN_DAYS * 86_400_000).toISOString().slice(0, 10);
    let offices = [];
    try { offices = fs.readdirSync(root).filter(d => ID.test(d)); } catch { return; }
    for (const o of offices) for (const f of fs.readdirSync(path.join(root, o))) {
      const m = DAY_FILE.exec(f);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(root, o, f));
    }
  }
  return {
    add(office, item) {
      item = item && typeof item === 'object' ? item : {};
      if (item.consent !== true) return false;   // no tick, no text: enforced here as well as in the route
      if (!ID.test(String(office))) return false;
      const t = now();
      const row = { at: new Date(t).toISOString(), office, lang: ['am', 'en', 'om'].includes(item.lang) ? item.lang : '',
        q: scrub(item.q, 2000), a: scrub(item.a, 4000), sources: cleanSources(item.sources), note: scrub(item.note, 500) };
      const dir = path.join(root, office);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, new Date(t).toISOString().slice(0, 10) + '.jsonl');
      fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      prune();
      return true;
    },
    prune,
  };
}

module.exports = { makeReview, RETAIN_DAYS };
