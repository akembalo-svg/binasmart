'use strict';
const { AREA_GROUPS, squash } = require('./areas');

// A health-place question read without a model: the kind of place, the area, and a specialty only when the person asks
// for one ("children's clinic", "pediatrician"). "My child has a fever" is a child patient, and any hospital will do.
function healthArgsFromText(msg) {
  const m = String(msg || ''), k = squash(m), a = {};
  const g = AREA_GROUPS.find(x => x.some(v => k.includes(squash(v)))); if (g) a.area = g[0];
  if (/dentist|dental|ጥርስ/i.test(m)) a.kind = 'dentist';
  else if (/laborator|\blab\b|blood test|ላብራቶሪ|ላቦራቶሪ/i.test(m)) a.kind = 'lab';
  else if (/hospital|ሆስፒታል/i.test(m)) a.kind = 'hospital';
  else if (/clinic|ክሊኒክ|health cent|ጤና ጣቢያ/i.test(m)) a.kind = 'clinic';
  else if (/doctor|physician|specialist|pediatrician|paediatrician|gyn|ሐኪም|ሀኪም|ሃኪም|ዶክተር|ስፔሻሊስት/i.test(m)) a.kind = 'doctor';
  const sp = [[/children'?s (clinic|hospital|doctor)|p(a)?ediatric|የህፃናት|የሕፃናት|የህጻናት|የልጆች|ለልጆች|ለህፃናት|ለሕፃናት|ለህጻናት/i, 'children'], [/gyn|obstet|matern|ማህፀን|ማሕፀን|ፅንስ|እርግዝና/i, 'gynecology'],
    [/\beye\b|ophthalm|የአይን|የዓይን/i, 'eye'], [/heart|cardi|የልብ/i, 'heart'], [/bone|ortho|spine|የአጥንት/i, 'bone'], [/skin|dermat|የቆዳ/i, 'skin'],
    [/fertil|መካን/i, 'fertility'], [/mental|psychiatr|የአእምሮ/i, 'mental']].find(([re]) => re.test(m));
  if (sp) a.q = sp[1];
  return a;
}

// Where to look for a place to be seen, for Dr Afiya (30 Sep 2026): the same reading as Bini's safety net, a neighbourhood
// turned into a point on the map (nearest first) and a sub-city used as a filter. Returns null when the directory is not
// running in this process (tests, scripts), so the caller simply answers without it.
const SUBCITY = /^(bole|kirkos|arada|yeka|gulele|lideta|kolfe|akaki|kality|addis ketema|lemi kura|nifas silk)$/i;
const BOX = { latMin: 8.5, latMax: 9.5, lngMin: 38.4, lngMax: 39.2 };
async function locate(q, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl('http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/ride/search?q=' + encodeURIComponent(q), { signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    return (d.results || []).find(p => +p.lat >= BOX.latMin && +p.lat <= BOX.latMax && +p.lng >= BOX.lngMin && +p.lng <= BOX.lngMax) || null;
  } catch (e) { return null; }
}
async function findHealthPlaces(msg, { search, locateImpl = locate } = {}) {
  const run = search || require('../health/directory').searchHealth;
  if (typeof run !== 'function') return null;
  const a = healthArgsFromText(msg), q = { kind: a.kind, q: a.q, limit: 6 };
  if (a.area) {
    if (SUBCITY.test(a.area)) q.area = a.area;
    else { const p = await locateImpl(a.area); if (p) { q.lat = p.lat; q.lng = p.lng; q.near = p.label || p.name || a.area; } }
  }
  const out = run(q);
  return out ? Object.assign({ near: q.near || null, args: a }, out) : null;
}
module.exports = { healthArgsFromText, findHealthPlaces, locate };
