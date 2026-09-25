#!/usr/bin/env node
'use strict';
// Addis Ababa's public places, from OpenStreetMap, as knowledge documents Bini can answer from:
// "which hospitals are in Bole?", "where is the Kenyan embassy?", "the nearest police station to Piassa".
//
//   node ops/places/osm-addis.js               fetch, write knowledge/places/*.md, print what changed
//   node ops/places/osm-addis.js --dry-run     fetch and print the counts, write nothing
//   node ops/places/osm-addis.js --from <json> build from a saved fetch (no network)
//
// Why OpenStreetMap. On 24 September 2026 BinaSmart held no directory of Addis offices at all, and OSM held
// 1,731 named places with a map point: 255 government offices, 131 hospitals, 117 embassies and missions,
// 80 bus and rail stations, 62 police stations, 22 courts. It is the only open source with the map points.
// Its data is ODbL: every document says "© OpenStreetMap contributors, ODbL" and links the source.
//
// What it will not publish:
//   · A mobile number. OSM holds numbers typed by anybody, and a pharmacy's "phone" is often the owner's own
//     mobile. Only area-coded landlines (011 …) and short codes survive; any 09/07 number is dropped. The
//     18 September incident (1,208 personal mobiles served from the index) is the reason, and
//     knowledge/ingest.js --check-masks would catch one that slipped through.
//   · A sub-city it is not sure of. OSM maps 10 sub-cities; Lemi Kura (formed in 2020 from parts of Bole and
//     Yeka) has no boundary there, so a place inside the old Bole or Yeka boundary is labelled with that
//     caveat rather than with a sub-city it may not be in.
//   · A place with no name: an unnamed pin answers nothing.
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const FROM = (() => { const i = process.argv.indexOf('--from'); return i > -1 ? process.argv[i + 1] : null; })();
const OUT = path.join(__dirname, '..', '..', 'knowledge', 'places');
// Two public Overpass servers, tried in turn: one busy server (runtime error, 504) should not fail the month's refresh.
const APIS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = 'BinaSmart-directory/1.0 (info@bina.et)';

// OSM relation ids of Addis Ababa's sub-cities (admin_level 6), read 24 September 2026.
const SUBCITIES = [
  [11589433, 'Arada', 'አራዳ'], [11589457, 'Bole', 'ቦሌ'], [11589481, 'Addis Ketema', 'አዲስ ከተማ'],
  [11589495, 'Kirkos', 'ቂርቆስ'], [11589562, 'Gulele', 'ጉለሌ'], [11589571, 'Lideta', 'ልደታ'],
  [11589590, 'Yeka', 'የካ'], [11589616, 'Nifas Silk-Lafto', 'ንፋስ ስልክ ላፍቶ'], [11589637, 'Akaki Kality', 'አቃቂ ቃሊቲ'],
  [11589660, 'Kolfe Keranio', 'ኮልፌ ቀራኒዮ'],
];
const CITY_AREA = 3601707699;   // Addis Ababa, admin_level 4
const LEMI_KURA_NOTE = 'within the old boundary; since 2020 part of this area is Lemi Kura sub-city';

// One document per kind. `q` is the Overpass filter; `am`/`en` name the document.
const KINDS = [
  { slug: 'government-offices', q: ['nwr["office"="government"]', 'nwr["amenity"="townhall"]'], en: 'Government offices', am: 'የመንግሥት ተቋማት' },
  { slug: 'hospitals', q: ['nwr["amenity"="hospital"]'], en: 'Hospitals', am: 'ሆስፒታሎች' },
  { slug: 'clinics', q: ['nwr["amenity"="clinic"]'], en: 'Clinics and health centres', am: 'ክሊኒኮችና ጤና ጣቢያዎች' },
  { slug: 'embassies', q: ['nwr["amenity"="embassy"]', 'nwr["office"="diplomatic"]'], en: 'Embassies, consulates and international missions', am: 'ኤምባሲዎችና ዓለም አቀፍ ተቋማት' },
  { slug: 'police', q: ['nwr["amenity"="police"]'], en: 'Police stations', am: 'ፖሊስ ጣቢያዎች' },
  { slug: 'courts', q: ['nwr["amenity"="courthouse"]'], en: 'Courts', am: 'ፍርድ ቤቶች' },
  { slug: 'transport-stations', q: ['nwr["amenity"="bus_station"]', 'nwr["railway"="station"]'], en: 'Bus and rail stations', am: 'የአውቶቡስና የባቡር ጣቢያዎች' },
  { slug: 'banks', q: ['nwr["amenity"="bank"]'], en: 'Bank branches', am: 'የባንክ ቅርንጫፎች' },
  { slug: 'pharmacies', q: ['nwr["amenity"="pharmacy"]'], en: 'Pharmacies', am: 'ፋርማሲዎች' },
  // Added 25 September 2026 (owner: "all Addis locations"): the rest of the named city - where people live,
  // eat, sleep, study, pray, shop and fill up, and the streets between them.
  { slug: 'neighbourhoods', q: ["nwr[\"place\"=\"suburb\"]", "nwr[\"place\"=\"neighbourhood\"]", "nwr[\"place\"=\"quarter\"]", "nwr[\"place\"=\"locality\"]", "nwr[\"place\"=\"square\"]"], en: 'Neighbourhoods, areas and squares', am: 'ሰፈሮችና አደባባዮች' },
  { slug: 'landmarks', q: ["nwr[\"tourism\"=\"attraction\"]", "nwr[\"tourism\"=\"museum\"]", "nwr[\"tourism\"=\"viewpoint\"]", "nwr[\"tourism\"=\"gallery\"]", "nwr[\"tourism\"=\"artwork\"]", "nwr[\"historic\"=\"monument\"]", "nwr[\"historic\"=\"memorial\"]", "nwr[\"historic\"=\"building\"]", "nwr[\"historic\"=\"castle\"]", "nwr[\"historic\"=\"palace\"]", "nwr[\"historic\"=\"church\"]", "nwr[\"historic\"=\"archaeological_site\"]", "nwr[\"historic\"=\"yes\"]", "nwr[\"leisure\"=\"park\"]", "nwr[\"leisure\"=\"stadium\"]", "nwr[\"leisure\"=\"garden\"]", "nwr[\"amenity\"=\"theatre\"]", "nwr[\"amenity\"=\"cinema\"]", "nwr[\"amenity\"=\"library\"]"], en: 'Landmarks, museums, parks, cinemas and libraries', am: 'ታዋቂ ቦታዎች፣ ሙዚየሞች፣ መናፈሻዎችና ሲኒማዎች' },
  { slug: 'hotels', q: ["nwr[\"tourism\"=\"hotel\"]", "nwr[\"tourism\"=\"guest_house\"]", "nwr[\"tourism\"=\"hostel\"]"], en: 'Hotels and guest houses', am: 'ሆቴሎችና የእንግዳ ማረፊያዎች' },
  { slug: 'restaurants-cafes', q: ["nwr[\"amenity\"=\"restaurant\"]", "nwr[\"amenity\"=\"cafe\"]", "nwr[\"amenity\"=\"fast_food\"]", "nwr[\"amenity\"=\"bar\"]"], en: 'Restaurants, cafes and bars', am: 'ምግብ ቤቶች፣ ካፌዎችና መጠጥ ቤቶች' },
  { slug: 'schools-universities', q: ["nwr[\"amenity\"=\"school\"]", "nwr[\"amenity\"=\"college\"]", "nwr[\"amenity\"=\"university\"]", "nwr[\"amenity\"=\"kindergarten\"]"], en: 'Schools, colleges and universities', am: 'ትምህርት ቤቶች፣ ኮሌጆችና ዩኒቨርሲቲዎች' },
  { slug: 'places-of-worship', q: ["nwr[\"amenity\"=\"place_of_worship\"]"], en: 'Churches, mosques and other places of worship', am: 'ቤተ ክርስቲያናትና መስጊዶች' },
  { slug: 'shopping-markets', q: ["nwr[\"shop\"=\"mall\"]", "nwr[\"shop\"=\"supermarket\"]", "nwr[\"shop\"=\"department_store\"]", "nwr[\"amenity\"=\"marketplace\"]"], en: 'Malls, supermarkets and markets', am: 'የገበያ ማዕከላት፣ ሱፐርማርኬቶችና ገበያዎች' },
  { slug: 'fuel-stations', q: ["nwr[\"amenity\"=\"fuel\"]"], en: 'Fuel stations', am: 'ነዳጅ ማደያዎች' },
  { slug: 'community-post', q: ["nwr[\"amenity\"=\"community_centre\"]", "nwr[\"amenity\"=\"post_office\"]"], en: 'Community centres and post offices', am: 'የማኅበረሰብ ማዕከላትና ፖስታ ቤቶች' },
  { slug: 'streets', q: ["way[\"highway\"=\"trunk\"]", "way[\"highway\"=\"primary\"]", "way[\"highway\"=\"secondary\"]", "way[\"highway\"=\"tertiary\"]", "way[\"highway\"=\"residential\"]"], en: 'Streets and roads', am: 'መንገዶች', street: true },
];

// Ethiopian numbers. Mobiles are dropped; an area-coded landline or a 3-4 digit short code is kept.
const MOBILE = /(?:\+?251[ -]?|0)[79](?:[ -]?\d){8}/;
const LANDLINE = /^(?:\+?251[ -]?(?:\(0\)[ -]?)?|0)([1-5]\d)[ -]?(\d{3})[ -]?(\d{4})$/;
function phonesOf(tags) {
  const raw = [tags.phone, tags['contact:phone'], tags['phone:mobile']].filter(Boolean).join(';');
  const kept = [];
  for (const p of raw.split(/[;,/]/).map(s => s.trim()).filter(Boolean)) {
    if (MOBILE.test(p)) continue;
    const digits = p.replace(/[^\d+]/g, '');
    const m = LANDLINE.exec(p.replace(/\s+/g, ' ').trim()) || LANDLINE.exec(digits);
    if (m) kept.push('+251 ' + m[1] + ' ' + m[2] + ' ' + m[3]);
    else if (/^\d{3,4}$/.test(digits)) kept.push(digits);
  }
  return [...new Set(kept)];
}

async function overpass(query, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(APIS[i % APIS.length], { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query) }).catch(e => ({ ok: false, status: 0, text: async () => e.message }));
    if (r.ok) {
      const j = await r.json().catch(() => null);
      // A mirror can be months behind (overpass.kumi.systems served map data from 31 May 2026 on 25 September):
      // an answer older than 14 days counts as no answer, so stale places never replace fresh ones.
      const base = j && j.osm3s && Date.parse(j.osm3s.timestamp_osm_base);
      if (j && j.elements && !(base && Date.now() - base > 14 * 864e5)) return j;
    }
    await new Promise(res => setTimeout(res, 5000 * (i + 1)));
  }
  throw new Error('Overpass did not answer: ' + query.slice(0, 80));
}

const filters = KINDS.flatMap(k => k.q.map(q => q + '(area.a);')).join('');
async function fetchAll() {
  const bySub = {};
  for (const [id, en] of SUBCITIES) {
    const d = await overpass(`[out:json][timeout:300];area(${3600000000 + id})->.a;(${filters});out ids;`);
    for (const e of d.elements) bySub[e.type + e.id] = en;
    console.log('  ' + en.padEnd(18) + d.elements.length);
  }
  const all = await overpass(`[out:json][timeout:300];area(${CITY_AREA})->.a;(${filters});out tags center;`);
  return { at: all.osm3s && all.osm3s.timestamp_osm_base, elements: all.elements, bySub };
}

const kindOf = t => KINDS.find(k => k.q.some(q => {
  const [, key, val] = /"([^"]+)"="([^"]+)"/.exec(q);
  return t[key] === val;
}));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const mdEsc = s => clean(s).replace(/([\\*_`[\]])/g, '\\$1');

function entryLine(e, sub) {
  const t = e.tags || {};
  const lat = e.lat != null ? e.lat : e.center && e.center.lat;
  const lon = e.lon != null ? e.lon : e.center && e.center.lon;
  const name = clean(t['name:en'] || t.name);
  const am = clean(t['name:am'] || (/[ሀ-፿]/.test(t.name || '') ? t.name : ''));
  const parts = ['- **' + mdEsc(name) + '**' + (am && am !== name ? ' (' + mdEsc(am) + ')' : '')];
  if (t.amenity === 'place_of_worship') { const r = [t.denomination, t.religion].filter(Boolean).join(' '); if (r) parts.push(mdEsc(r.replace(/_/g, ' '))); }
  if (t.cuisine && /^(restaurant|cafe|fast_food)$/.test(t.amenity)) parts.push(mdEsc(t.cuisine.replace(/[_;]/g, ' ')));
  if (t.place) parts.push(t.place);
  if (t.operator && clean(t.operator) !== name) parts.push('run by ' + mdEsc(t.operator));
  const street = clean([t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '));
  const place = clean(t['addr:suburb'] || t['addr:neighbourhood'] || '');
  const where = [street, place].filter(Boolean).join(', ');
  parts.push((where ? where + ', ' : '') + (sub ? sub.label : 'Addis Ababa'));
  const ph = phonesOf(t);
  if (ph.length) parts.push('tel ' + ph.join(' / '));
  const web = clean(t.website || t['contact:website']);
  if (web && /^https?:\/\/[^\s]+$/i.test(web)) parts.push(web);
  if (t.opening_hours) parts.push('hours ' + mdEsc(t.opening_hours));
  if (lat != null) parts.push('map https://www.openstreetmap.org/?mlat=' + lat.toFixed(5) + '&mlon=' + lon.toFixed(5) + '#map=18/' + lat.toFixed(5) + '/' + lon.toFixed(5));
  return parts.join(' · ');
}

function build({ at, elements, bySub }) {
  const day = (at || new Date().toISOString()).slice(0, 10);
  const subMeta = Object.fromEntries(SUBCITIES.map(([, en, am]) => [en, { en, am,
    label: en + ' sub-city (' + am + ' ክፍለ ከተማ)' + (en === 'Bole' || en === 'Yeka' ? ' — ' + LEMI_KURA_NOTE : '') }]));
  const docs = {};
  const streets = new Map();   // name -> { subs:Set, e }
  let dropped = 0, mobilesDropped = 0, mobileLines = 0;
  for (const e of elements) {
    const t = e.tags || {};
    if (!clean(t['name:en'] || t.name)) { dropped++; continue; }
    const k = kindOf(t); if (!k) continue;
    if (k.street) {
      const n = clean(t['name:en'] || t.name);
      const st = streets.get(n) || { subs: new Set(), e, am: clean(t['name:am'] || '') };
      if (bySub[e.type + e.id]) st.subs.add(bySub[e.type + e.id]);
      streets.set(n, st); continue;
    }
    const rawPh = [t.phone, t['contact:phone'], t['phone:mobile']].filter(Boolean).join(';');
    if (MOBILE.test(rawPh)) mobilesDropped++;
    const subName = bySub[e.type + e.id];
    (docs[k.slug] ||= { k, groups: {} });
    const g = subName || 'Addis Ababa (sub-city not given in OpenStreetMap)';
    // A mobile can hide outside the phone field - typed into a name ("Cafe 09…"), a website or opening hours.
    // Such an entry is left out whole; the final guard below still refuses to write if one slips through.
    const line = entryLine(e, subName ? subMeta[subName] : null);
    if (MOBILE.test(line.replace(/map https:\/\/\S+/g, ''))) { mobileLines++; continue; }
    (docs[k.slug].groups[g] ||= []).push(line);
  }
  const files = {};
  if (streets.size) {
    const lines = [...streets].sort((a, b) => a[0].localeCompare(b[0])).map(([n, st]) => {
      const c = st.e.center; const where = st.subs.size ? [...st.subs].map(x => subMeta[x].en + ' (' + subMeta[x].am + ')').join(', ') : 'Addis Ababa';
      return '- **' + mdEsc(n) + '**' + (st.am && st.am !== n ? ' (' + mdEsc(st.am) + ')' : '') + ' · ' + where + (c ? ' · map https://www.openstreetmap.org/?mlat=' + c.lat.toFixed(5) + '&mlon=' + c.lon.toFixed(5) + '#map=17/' + c.lat.toFixed(5) + '/' + c.lon.toFixed(5) : '');
    });
    const fm = ['---', 'title: "Streets and roads in Addis Ababa (መንገዶች)"', 'url: "https://www.openstreetmap.org/relation/1707699"', 'lang: "en"', 'source_name: "OpenStreetMap contributors (ODbL)"', 'fetched: "' + day + '"', 'count: "' + lines.length + '"', '---', ''].join('\n');
    files['addis-streets.md'] = fm + '# Streets and roads in Addis Ababa · በአዲስ አበባ ያሉ መንገዶች\n\n' + lines.length + ' named streets, each with the sub-cities it runs through. Source: OpenStreetMap (© OpenStreetMap contributors, ODbL), map data as of ' + day + '. Street names in Addis are often not what people use; ask for the landmark or neighbourhood too.\n\n' + lines.join('\n') + '\n';
  }
  for (const { k, groups } of Object.values(docs)) {
    const n = Object.values(groups).reduce((a, b) => a + b.length, 0);
    const order = [...SUBCITIES.map(s => s[1]), 'Addis Ababa (sub-city not given in OpenStreetMap)'].filter(g => groups[g]);
    let body = '# ' + k.en + ' in Addis Ababa · በአዲስ አበባ ያሉ ' + k.am + '\n\n'
      + n + ' named places, grouped by sub-city. Source: OpenStreetMap (© OpenStreetMap contributors, ODbL), map data as of ' + day + '. '
      + 'This is a map of where places are, not an official register: names and numbers are as volunteers mapped them. '
      + 'Confirm opening hours and services with the place itself before you go. Only landline numbers are listed; mobile numbers are left out on purpose.\n';
    for (const g of order) {
      const lines = groups[g].sort((a, b) => a.localeCompare(b));
      const sm = subMeta[g];
      body += '\n## ' + (sm ? sm.en + ' sub-city · ' + sm.am + ' ክፍለ ከተማ' : g) + ' — ' + lines.length + '\n\n' + lines.join('\n') + '\n';
    }
    const fm = ['---', 'title: "' + k.en + ' in Addis Ababa (' + k.am + ')"', 'url: "https://www.openstreetmap.org/relation/1707699"',
      'lang: "en"', 'source_name: "OpenStreetMap contributors (ODbL)"', 'fetched: "' + day + '"', 'count: "' + n + '"', '---', ''].join('\n');
    files['addis-' + k.slug + '.md'] = fm + body;
  }
  return { files, dropped, mobilesDropped, mobileLines };
}

if (require.main === module) (async () => {
  const data = FROM ? JSON.parse(fs.readFileSync(FROM, 'utf8')) : await fetchAll();
  if (!FROM && !DRY) fs.writeFileSync('/root/storage/osm-addis-latest.json', JSON.stringify(data));
  const { files, dropped, mobilesDropped, mobileLines } = build(data);
  for (const [f, text] of Object.entries(files)) {
    const n = (text.match(/^- \*\*/gm) || []).length;
    const prev = fs.existsSync(path.join(OUT, f)) ? (fs.readFileSync(path.join(OUT, f), 'utf8').match(/^- \*\*/gm) || []).length : 0;
    console.log(f.padEnd(36) + String(n).padStart(5) + (prev ? '  (was ' + prev + ')' : '  (new)'));
  }
  console.log('unnamed places skipped: ' + dropped + ' · entries whose mobile number was left out: ' + mobilesDropped + ' · entries left out whole (a mobile in the name or text): ' + mobileLines);
  const leak = Object.values(files).some(t => MOBILE.test(t.replace(/map https:\/\/\S+/g, '')));
  if (leak) { console.error('MOBILE NUMBER IN OUTPUT - nothing written'); process.exit(1); }
  if (DRY) return;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), text);
  console.log('written to ' + OUT);
})().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { phonesOf, build, MOBILE, LANDLINE };
