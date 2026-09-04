'use strict';
// The hall template is the ONLY source of seats. Two kinds:
//   seats: rows × seatsPerRow, ids "C7"           (Phase A)
//   ga:    tiers with capacity, ids "VIP-001"     (general admission: places, not chairs)
// The server expands it; the client draws it; nobody invents a seat id. Pure (no DB, no IO).
const MAX_ROWS = 26, MAX_PER_ROW = 40, GA_MAX_SECTIONS = 20, GA_MAX_CAP = 5000;
const ROW_RE = /^[A-Z]{1,2}$/;

const isGa = L => !!(L && L.kind === 'ga');
const gaPrefix = name => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'T';
const gaId = (name, i) => gaPrefix(name) + '-' + String(i).padStart(3, '0');

function validateGa(L) {
  const secs = Array.isArray(L.sections) ? L.sections : [];
  if (!secs.length) return { ok: false, error: 'at least one section (tier)' };
  if (secs.length > GA_MAX_SECTIONS) return { ok: false, error: 'at most ' + GA_MAX_SECTIONS + ' sections' };
  const seen = new Set();
  for (const s of secs) {
    if (!s || !s.name) return { ok: false, error: 'section needs a name' };
    if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > GA_MAX_CAP) return { ok: false, error: 'capacity for ' + s.name + ' must be 1-' + GA_MAX_CAP };
    const p = gaPrefix(s.name); if (seen.has(p)) return { ok: false, error: 'duplicate section ' + s.name }; seen.add(p);
  }
  return { ok: true };
}

function validateLayout(L) {
  if (!L || typeof L !== 'object') return { ok: false, error: 'layout must be an object' };
  if (isGa(L)) return validateGa(L);
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
function splitGa(L, id) {
  const m = typeof id === 'string' && id.match(/^([A-Z0-9]+)-(\d{3})$/);
  if (!m) return null;
  const sec = (L.sections || []).find(s => gaPrefix(s.name) === m[1]);
  return sec ? { section: sec, n: Number(m[2]) } : null;
}

function sectionOf(L, seatId) {
  if (isGa(L)) { const p = splitGa(L, seatId); return p ? p.section.name : null; }
  const p = splitId(seatId); if (!p) return null;
  const s = (L.sections || []).find(x => (x.rows || []).includes(p.row));
  return s ? s.name : null;
}

function seatsFor(L) {
  const out = [];
  if (isGa(L)) {
    for (const s of (L.sections || [])) for (let n = 1; n <= s.capacity; n++) out.push({ id: gaId(s.name, n), row: null, n, section: s.name, blocked: false, wheelchair: false, aisleAfter: false });
    return out;
  }
  const aisles = new Set(L.aisles || []), blocked = new Set(L.blocked || []), wc = new Set(L.wheelchair || []);
  for (const row of L.rows) for (let n = 1; n <= L.seatsPerRow; n++) {
    const id = row + n;
    out.push({ id, row, n, section: sectionOf(L, id), blocked: blocked.has(id), wheelchair: wc.has(id), aisleAfter: aisles.has(n) });
  }
  return out;
}

function capacityOf(L) { return seatsFor(L).filter(s => !s.blocked).length; }

function isSeat(L, id) {
  if (isGa(L)) { const p = splitGa(L, id); return !!p && p.n >= 1 && p.n <= p.section.capacity; }
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

// [{ section, nameAm, count }] in layout order — "VIP × 2, Regular × 1" for tickets and the door.
function summarise(L, seats) {
  const counts = {};
  for (const id of (seats || [])) { const s = sectionOf(L, id); if (s) counts[s] = (counts[s] || 0) + 1; }
  return (L.sections || []).filter(s => counts[s.name]).map(s => ({ section: s.name, nameAm: s.nameAm || null, count: counts[s.name] }));
}

module.exports = { validateLayout, seatsFor, capacityOf, isSeat, sectionOf, priceOf, isGa, gaId, gaPrefix, summarise, MAX_ROWS, MAX_PER_ROW, GA_MAX_SECTIONS, GA_MAX_CAP };
