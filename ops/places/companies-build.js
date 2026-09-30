// Addis Ababa real estate companies and car sellers, for the /real-estate-companies and /car-dealers directories
// (owner's request, 27 Sep 2026: "add all Addis real estate companies and car sale companies").
//
//   node --env-file=.env ops/places/companies-build.js           writes /root/storage/directory/addis-companies.json
//   node --env-file=.env ops/places/companies-build.js --dry     prints, writes nothing
//
// Three sources, merged by name:
//   1. The city map (/root/storage/osm-addis-latest.json, © OpenStreetMap contributors, ODbL): estate agents,
//      car shops, and places whose name says real estate / motors / car sales.
//   2. Employers already on our job board that are real estate firms or car sellers (their page is /employer/<slug>).
//   3. Web research, confirmed per company (/root/storage/directory/research-*.json - name, type, website, area,
//      landline, source urls). Written by hand from the research, never scraped from another directory.
// Rules the pages rely on: landlines only (a mobile on the map or in research is dropped, as on /hotels);
// every listing keeps the sources it came from; /root/storage/directory/exclude.json (names or refs) takes
// anything out by hand, and a Jev check (ops/jev-audit-companies.js) proposes those removals.
const fs = require('fs');
const { landlines } = require('../../hotels/directory');

const OUT = '/root/storage/directory/addis-companies.json';
const DIR = '/root/storage/directory';
const DRY = process.argv.includes('--dry');
const SUB_AM = { 'Addis Ketema': 'አዲስ ከተማ', 'Akaki Kality': 'አቃቂ ቃሊቲ', Arada: 'አራዳ', Bole: 'ቦሌ', Gulele: 'ጉለሌ',
  Kirkos: 'ቂርቆስ', 'Kolfe Keranio': 'ኮልፌ ቀራኒዮ', Lideta: 'ልደታ', 'Nifas Silk-Lafto': 'ንፋስ ስልክ ላፍቶ', Yeka: 'የካ', 'Lemi Kura': 'ለሚ ኩራ' };

const RE_NAME = /real ?estate|realestate|real state|ሪል ?እ?ስቴት|ሪልእስቴት|\bproperties\b|property (develop|management)|\bhomes\b/i;
const CAR_NAME = /\bmotors?\b|\bautomotive\b|\bauto\b|car (sale|sales|market|import|trading|dealer)|cars\b|የመኪና (ሽያጭ|ገበያ)|መኪና ገበያ|ሞተርስ/i;
const NOT_RE = /housing development agency|registry|agency$|college|university|chair of|electric|entry line|project \d+ site|consumers|ሸማቾች|construction|contractor|plumbing|landscape|ericsson|cccc|ccecc|industr|engineering(?! .*real)/i;
const NOT_CAR = /garage|wash|እጥበት|rental|ኪራይ|driving|ማሰልጠኛ|licen[cs]e|spare|parts|repair|tyre|tire|gps|tracker|racing|መወዳደሪያ|service$/i;

const kebab = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const GENERIC = /\b(real ?estate|realestate|real state|properties|property|management|develop(er|ment)s?|homes?|plc|p\.?l\.?c|s\.?c|share company|pvt|ltd|llc|one member|motors?|motor vehicle|manufacturing|automotive|auto|cars?|car (sales?|market|import|trading|dealer)|import|and|the|ethiopia|ethiopian|addis|ababa|head office|branch|kality|apartments?|job|jobs|trainee|sales|graduate|program|fresh graduates|marketing|trading|company|co|group|toyota)\b/gi;
const nameKey = s => String(s || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[–—-].*(trainee|graduate|job|program).*$/i, '')
  .replace(/[^\x00-\x7f]/g, ' ').replace(/&#0?38;|&amp;/g, ' ').replace(GENERIC, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanName = s => String(s || '').replace(/&#0?38;|&amp;/g, '&').replace(/\s*[–—-]\s*(sales trainee|graduate trainee program|fresh graduates|job)\s*$/i, '')
  .replace(/\s+job$/i, '').replace(/\s+/g, ' ').trim();

function fromMap() {
  const osm = JSON.parse(fs.readFileSync(process.env.BINA_OSM_ADDIS || '/root/storage/osm-addis-latest.json', 'utf8'));
  const out = [];
  for (const e of osm.elements || []) {
    const t = e.tags || {};
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    const name = cleanName((ethiopic && t['name:en']) || t.name || t['name:en'] || '');
    const all = [t.name, t['name:en'], t['name:am']].filter(Boolean).join(' ');
    if (!name || !/[a-zሀ-፿]/i.test(name)) continue;                       // "중고차 거리" and bare numbers
    let kind = null;
    if ((['estate_agent', 'property_management'].includes(t.office) || t.shop === 'estate_agent' || RE_NAME.test(all))
      && !NOT_RE.test(all) && t.office !== 'government') kind = 'real_estate';
    else if ((['car', 'motorcycle'].includes(t.shop) || CAR_NAME.test(all)) && !NOT_CAR.test(all)
      && !['car_wash', 'car_rental', 'driving_school'].includes(t.amenity) && !['car_repair', 'car_parts', 'tyres'].includes(t.shop)) kind = 'car_seller';
    if (!kind) continue;
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    const nameAm = String(t['name:am'] || (ethiopic ? t.name : '') || '').trim();
    const tag = ['office', 'shop', 'amenity', 'building', 'craft'].map(k => t[k] ? k + '=' + t[k] : '').find(Boolean) || '';
    out.push({ kind, name, nameAm: nameAm && nameAm !== name ? nameAm : '', tag, website: t.website || t['contact:website'] || '',
      phones: landlines(t.phone || t['contact:phone']), street: t['addr:street'] || '',
      places: lat != null ? [{ ref: e.type + '/' + e.id, lat: +(+lat).toFixed(6), lng: +(+lng).toFixed(6), sub: (osm.bySub || {})[e.type + e.id] || '' }] : [],
      sources: ['map'] });
  }
  return out;
}

async function fromEmployers() {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const rows = await p.employer.findMany({ select: { slug: true, name: true, website: true, phone: true, address: true, lat: true, lng: true } });
    const out = [];
    for (const r of rows) {
      const name = cleanName(r.name);
      let kind = null;
      if (RE_NAME.test(name) && !NOT_RE.test(name)) kind = 'real_estate';
      else if (CAR_NAME.test(name) && !NOT_CAR.test(name)) kind = 'car_seller';
      if (!kind) continue;
      out.push({ kind, name, nameAm: '', website: r.website || '', phones: landlines(r.phone), street: '', address: r.address || '',
        places: r.lat != null ? [{ ref: 'employer/' + r.slug, lat: r.lat, lng: r.lng, sub: '' }] : [], employer: r.slug, sources: ['job board'] });
    }
    return out;
  } finally { await p.$disconnect(); }
}

function fromResearch() {
  const out = [];
  for (const f of ['research-realestate.json', 'research-cars.json']) {
    let list = []; try { list = JSON.parse(fs.readFileSync(DIR + '/' + f, 'utf8')); } catch (e) { continue; }
    for (const r of list) {
      if (!r.name || !r.kind) continue;
      out.push({ kind: r.kind, name: cleanName(r.name), nameAm: r.nameAm || '', website: r.website || '', phones: landlines(r.phone || ''),
        street: '', address: r.area || '', brands: r.brands || '', type: r.type || '', note: r.note || '', places: [],
        sources: ['web'], sourceUrls: (r.sources || []).slice(0, 3) });
    }
  }
  return out;
}

(async () => {
  const exclude = (() => { try { return JSON.parse(fs.readFileSync(DIR + '/exclude.json', 'utf8')); } catch (e) { return []; } })();
  const raw = [...fromMap(), ...(await fromEmployers()), ...fromResearch()];
  const merged = new Map();
  for (const c of raw) {
    const key = c.kind + ':' + (nameKey(c.name) || kebab(c.name) || c.nameAm);
    if (!key.split(':')[1]) continue;
    const m = merged.get(key);
    if (!m) { merged.set(key, { ...c, key }); continue; }
    if (c.sources.includes('web') && !m.sources.includes('web')) m.name = c.name;   // the company's own spelling wins
    m.nameAm = m.nameAm || c.nameAm; m.website = m.website || c.website; m.street = m.street || c.street;
    m.address = (c.sources.includes('web') && c.address) ? c.address : (m.address || c.address);   // the company's own website is the newest address m.brands = m.brands || c.brands; m.type = m.type || c.type; m.note = m.note || c.note;
    m.employer = m.employer || c.employer;
    m.phones = [...new Set([...(m.phones || []), ...(c.phones || [])])].slice(0, 3);
    m.places = [...m.places, ...c.places].slice(0, 6);
    m.sources = [...new Set([...m.sources, ...c.sources])];
    m.sourceUrls = [...new Set([...(m.sourceUrls || []), ...(c.sourceUrls || [])])].slice(0, 4);
  }
  // A company's branches and sites carry extra words ("Noah Real State - Summit", "Marathon Motor (Megenagna)",
  // "Lebu Real Estate - Varnero Appartments"): a key whose words all appear in a shorter key of the same kind is
  // folded into it. The shorter key must have a word of 4+ letters so "ab" cannot swallow everything.
  const vals = [...merged.values()].sort((x, y) => x.key.length - y.key.length);
  for (const small of vals) {
    if (!merged.has(small.key)) continue;
    const [kind, words] = small.key.split(':'); const sw = words.split(' ');
    if (!sw.some(w => w.length >= 4)) continue;
    for (const big of vals) {
      if (big === small || !merged.has(big.key) || !big.key.startsWith(kind + ':')) continue;
      const bw = big.key.split(':')[1].split(' ');
      if (bw.length > sw.length && sw.every(w => bw.includes(w))) {
        small.places = [...small.places, ...big.places].slice(0, 6); small.sources = [...new Set([...small.sources, ...big.sources])];
        small.website = small.website || big.website; small.nameAm = small.nameAm || big.nameAm; small.employer = small.employer || big.employer;
        small.phones = [...new Set([...(small.phones || []), ...(big.phones || [])])].slice(0, 3);
        small.branches = [...(small.branches || []), big.name];
        merged.delete(big.key);
      }
    }
  }
  const used = new Set();
  const list = [...merged.values()].filter(c => !exclude.includes(c.name) && !exclude.includes(c.key) && !c.places.some(p => exclude.includes(p.ref)))
    .map(c => {
      let slug = kebab(c.name) || 'company'; if (used.has(slug)) { let i = 2; while (used.has(slug + '-' + i)) i++; slug += '-' + i; } used.add(slug);
      const sub = (c.places.find(p => p.sub) || {}).sub || '';
      return { ...c, slug, sub, subAm: SUB_AM[sub] || '' };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const count = k => list.filter(c => c.kind === k).length;
  console.log('raw ' + raw.length + ' -> ' + list.length + ' companies · real estate ' + count('real_estate') + ' · car sellers ' + count('car_seller')
    + ' · by source ' + JSON.stringify(list.reduce((m, c) => (c.sources.forEach(s => m[s] = (m[s] || 0) + 1), m), {})));
  if (DRY) { for (const c of list) console.log('  ' + c.kind.padEnd(11) + ' ' + c.sources.join('+').padEnd(20) + ' ' + c.name + (c.sub ? ' · ' + c.sub : '')); return; }
  fs.writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), companies: list }, null, 1));
  console.log('written ' + OUT);
})().catch(e => { console.error('[companies-build] ' + e.message); process.exit(1); });
