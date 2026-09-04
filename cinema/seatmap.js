'use strict';
// The hall template is the ONLY source of seats. The server expands it; the client draws it; nobody
// invents a seat id. Pure (no DB, no IO) so it is trivially testable and safe to call anywhere.
const MAX_ROWS = 26, MAX_PER_ROW = 40;
const ROW_RE = /^[A-Z]{1,2}$/;

function validateLayout(L) {
  if (!L || typeof L !== 'object') return { ok: false, error: 'layout must be an object' };
  if (!Array.isArray(L.rows) || !L.rows.length) return { ok: false, error: 'rows must be a non-empty list' };
  if (L.rows.length > MAX_ROWS) return { ok: false, error: 'at most ' + MAX_ROWS + ' rows' };
  if (L.rows.some(r => typeof r !== 'string' || !ROW_RE.test(r))) return { ok: false, error: 'row labels must be A-Z or AA-ZZ' };
  if (!Number.isInteger(L.seatsPerRow) || L.seatsPerRow < 1 || L.seatsPerRow > MAX_PER_ROW) return { ok: false, error: 'seatsPerRow must be 1-' + MAX_PER_ROW };
  if (new Set(L.rows).size !== L.rows.length) return { ok: false, error: 'duplicate row label' };
  for (const k of ['aisles', 'blocked', 'wheelchair']) if (L[k] != null && !Array.isArray(L[k])) return { ok: false, error: k + ' must be a list' };
  const secs = Array.isArray(L.sections) ? L.sections : [];
  if (!secs.length) return { ok: false, error: 'at least one section' };
  const covered = new Map();
  for (const s of secs) {
    if (!s || !s.name) return { ok: false, error: 'section needs a name' };
    for (const r of (s.rows || [])) {
      if (!L.rows.includes(r)) return { ok: false, error: 'section ' + s.name + ' names unknown row ' + r };
      if (covered.has(r)) return { ok: false, error: 'row ' + r + ' is in two sections' };
      covered.set(r, s.name);
    }
  }
  for (const r of L.rows) if (!covered.has(r)) return { ok: false, error: 'row ' + r + ' has no section' };
  return { ok: true };
}

function splitId(id) {
  const m = typeof id === 'string' && id.match(/^([A-Z]{1,2})(\d{1,2})$/);
  return m ? { row: m[1], n: Number(m[2]) } : null;
}

function sectionOf(L, seatId) {
  const p = splitId(seatId); if (!p) return null;
  const s = (L.sections || []).find(x => (x.rows || []).includes(p.row));
  return s ? s.name : null;
}

function seatsFor(L) {
  const aisles = new Set(L.aisles || []), blocked = new Set(L.blocked || []), wc = new Set(L.wheelchair || []);
  const out = [];
  for (const row of L.rows) for (let n = 1; n <= L.seatsPerRow; n++) {
    const id = row + n;
    out.push({ id, row, n, section: sectionOf(L, id), blocked: blocked.has(id), wheelchair: wc.has(id), aisleAfter: aisles.has(n) });
  }
  return out;
}

function capacityOf(L) { return seatsFor(L).filter(s => !s.blocked).length; }

function isSeat(L, id) {
  const p = splitId(id); if (!p) return false;
  if (!L.rows.includes(p.row) || p.n < 1 || p.n > L.seatsPerRow) return false;
  return !(L.blocked || []).includes(id);
}

function priceOf(L, prices, seatId) {
  const sec = sectionOf(L, seatId);
  if (!sec) throw new Error('seat ' + seatId + ' is in no section');
  const p = prices && prices[sec];
  if (!Number.isFinite(p) || p < 0) throw new Error('no price for section ' + sec);
  return p;
}

module.exports = { validateLayout, seatsFor, capacityOf, isSeat, sectionOf, priceOf, MAX_ROWS, MAX_PER_ROW };
