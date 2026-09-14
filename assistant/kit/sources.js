'use strict';
// The "From: …" line under an answer on /afiya and /asmat.
//
// knowledge.contextFor numbers every retrieved document on a line of its own — "[n] <title> — <url>" —
// followed by the document's text (knowledge/index.js, contextFor). Those numbered lines are exactly the
// documents a reply could draw on, so they are parsed here instead of changing what contextFor returns:
// the engine's dependency stays a string, and every other caller of contextFor is untouched.
//
// Rules: numbered lines only, in sequence ([1], [2], … so a line inside a document that merely looks like
// one cannot jump the order); only http(s) urls; one entry per url; at most `max`. HIDDEN lists documents
// indexed for Bini's own use, which are not somewhere to send a person.
const HIDDEN = new Set(['BinaSmart system']);
const HEAD = /^\[(\d+)\] (.+)$/;
const URL_TAIL = / — (https?:\/\/\S+)$/;
const TITLE_MAX = 90;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Crawled page titles arrive with entities in them ("Managed Security Services &#8211; Ethio telecom").
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

function sourcesFrom(ctx, max = 2) {
  const out = [], seen = new Set();
  let next = 1;
  for (const line of String(ctx || '').split('\n')) {
    const m = HEAD.exec(line);
    if (!m || Number(m[1]) !== next) continue;
    next++;
    const u = URL_TAIL.exec(m[2]);
    if (!u) continue; // a document with no url still takes its number
    const url = u[1];
    const title = decode(m[2].slice(0, u.index)).replace(/\s+/g, ' ').trim();
    if (!title || HIDDEN.has(title) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: title.length > TITLE_MAX ? title.slice(0, TITLE_MAX - 1).trimEnd() + '…' : title, url });
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { sourcesFrom, HIDDEN };
