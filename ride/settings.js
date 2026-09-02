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
const TIER_NUMS = ['base', 'perKm', 'perMin', 'min'];
const TIER_STRS = ['label', 'labelAm', 'icon'];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = (isObj(b[k]) && isObj(a[k])) ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}
function safeJson(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
function isNum(v, lo, hi) { return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi; }
// Errors carry statusCode 400 so Fastify maps them to a 400 automatically (message contract: "invalid_settings: <path> …").
function bad(msg) { const e = new Error('invalid_settings: ' + msg); e.code = 'invalid_settings'; e.statusCode = 400; return e; }

function validate(s) {
  if (!isObj(s)) throw bad('settings must be an object');
  if (!isNum(s.commissionPct, 0, 100)) throw bad('commissionPct must be a number 0-100');
  for (const k of NUM_KNOBS) if (!isNum(s[k], 0, 1e9)) throw bad(k + ' must be a non-negative number');
  if (!Array.isArray(s.radiiKm) || s.radiiKm.length === 0 || !s.radiiKm.every(r => isNum(r, 0.1, 1000))) throw bad('radiiKm must be a non-empty array of positive numbers');
  if (!isObj(s.tiers) || Object.keys(s.tiers).length === 0) throw bad('tiers');
  for (const t of Object.keys(s.tiers)) {
    const tier = s.tiers[t];
    if (!isObj(tier)) throw bad('tiers.' + t);
    for (const f of TIER_NUMS) if (!isNum(tier[f], 0, 1e9)) throw bad('tiers.' + t + '.' + f + ' must be a non-negative number');
    if (!Number.isInteger(tier.seats) || tier.seats < 1 || tier.seats > 20) throw bad('tiers.' + t + '.seats must be an integer 1-20');
    for (const f of TIER_STRS) if (typeof tier[f] !== 'string' || tier[f].length === 0 || tier[f].length > 40) throw bad('tiers.' + t + '.' + f + ' must be a string (1-40 chars)');
  }
  return s;
}

function makeSettings(prisma) {
  let cache = null, cachedAt = 0;
  async function get() {
    if (cache && Date.now() - cachedAt < 30000) return cache;
    const row = await prisma.rideSetting.findUnique({ where: { id: 'default' } });
    let next = deepMerge(structuredClone(DEFAULTS), row ? safeJson(row.json) : {});
    try { validate(next); }
    catch (e) { console.error('[ride/settings] corrupt settings row, using DEFAULTS:', e.message); next = structuredClone(DEFAULTS); }
    cache = next; cachedAt = Date.now();
    return cache;
  }
  async function update(patch) {
    if (!isObj(patch)) throw bad('patch must be an object');
    const next = validate(deepMerge(await get(), patch));
    const json = JSON.stringify(next);
    await prisma.rideSetting.upsert({ where: { id: 'default' }, update: { json }, create: { id: 'default', json } });
    cache = next; cachedAt = Date.now();
    return next;
  }
  return { get, update, DEFAULTS };
}

module.exports = { makeSettings, DEFAULTS, deepMerge, validate };
