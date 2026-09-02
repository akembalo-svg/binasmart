'use strict';
// Fare table + dispatch knobs. Single DB row (id 'default') holding JSON, deep-merged over DEFAULTS.
// update() validates every numeric knob so a stray string (e.g. "80") can never reach the fare math.
const DEFAULTS = {
  commissionPct: 15,
  offerWindowS: 20,
  conciergeAfterS: 60,
  freeCancelMin: 2,
  cancelFeeEtb: 30,
  radiiKm: [3, 6, 10],
  tiers: {
    moto:    { label: 'Moto',     labelAm: 'ሞተር',   icon: '🛵', base: 40,  perKm: 12, perMin: 1.5, min: 60,  seats: 1 },
    bajaj:   { label: 'Bajaj',    labelAm: 'ባጃጅ',   icon: '🛺', base: 50,  perKm: 15, perMin: 2,   min: 80,  seats: 3 },
    economy: { label: 'Economy',  labelAm: 'ኢኮኖሚ',  icon: '🚗', base: 80,  perKm: 28, perMin: 3,   min: 150, seats: 4 },
    comfort: { label: 'Comfort',  labelAm: 'ኮምፎርት', icon: '🚙', base: 120, perKm: 40, perMin: 4,   min: 230, seats: 4 },
    xl:      { label: 'XL / Van', labelAm: 'ቫን',     icon: '🚐', base: 180, perKm: 55, perMin: 5,   min: 350, seats: 7 }
  }
};
const NUM_KNOBS = ['offerWindowS', 'conciergeAfterS', 'freeCancelMin', 'cancelFeeEtb'];
const TIER_NUMS = ['base', 'perKm', 'perMin', 'min', 'seats'];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) out[k] = (isObj(b[k]) && isObj(a[k])) ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
function safeJson(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
function isNum(v, lo, hi) { return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi; }

function validate(s) {
  if (!isNum(s.commissionPct, 0, 100)) throw new Error('invalid_settings: commissionPct must be a number 0-100');
  for (const k of NUM_KNOBS) if (!isNum(s[k], 0, 1e9)) throw new Error('invalid_settings: ' + k + ' must be a non-negative number');
  if (!Array.isArray(s.radiiKm) || s.radiiKm.length === 0 || !s.radiiKm.every(r => isNum(r, 0.1, 1000))) throw new Error('invalid_settings: radiiKm must be a non-empty array of positive numbers');
  if (!isObj(s.tiers) || Object.keys(s.tiers).length === 0) throw new Error('invalid_settings: tiers');
  for (const t of Object.keys(s.tiers)) {
    if (!isObj(s.tiers[t])) throw new Error('invalid_settings: tiers.' + t);
    for (const f of TIER_NUMS) if (!isNum(s.tiers[t][f], 0, 1e9)) throw new Error('invalid_settings: tiers.' + t + '.' + f + ' must be a non-negative number');
  }
  return s;
}

function makeSettings(prisma) {
  let cache = null, cachedAt = 0;
  async function get() {
    if (cache && Date.now() - cachedAt < 30000) return cache;
    const row = await prisma.rideSetting.findUnique({ where: { id: 'default' } });
    cache = row ? deepMerge(DEFAULTS, safeJson(row.json)) : DEFAULTS;
    cachedAt = Date.now();
    return cache;
  }
  async function update(patch) {
    const next = validate(deepMerge(await get(), patch || {}));
    const json = JSON.stringify(next);
    await prisma.rideSetting.upsert({ where: { id: 'default' }, update: { json }, create: { id: 'default', json } });
    cache = next; cachedAt = Date.now();
    return next;
  }
  return { get, update, DEFAULTS };
}

module.exports = { makeSettings, DEFAULTS, deepMerge, validate };
