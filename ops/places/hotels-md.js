#!/usr/bin/env node
'use strict';
// Every place to stay in Addis Ababa as knowledge Bini answers from, built from the same data as bina.et/hotels
// (hotels/directory.js), so Bini and the directory never disagree about what exists.
//
//   node ops/places/hotels-md.js [--dry-run]     writes knowledge/places/addis-hotels.md
//
// It replaces the file ops/places/osm-addis.js writes under the same name, which knew only what the map tags as
// lodging (524 on 25 Sep 2026): refresh.sh runs this after it. One line per place, grouped by sub-city: name,
// Amharic name, kind, stars, office landline, website, and the place's bina.et page, where an owner claims it.
// Never a mobile number (directory.js keeps landlines only; the guard below refuses to write if one slips in).
const fs = require('fs');
const path = require('path');
const { buildDirectory } = require('../../hotels/directory');
const OUT = path.join(__dirname, '..', '..', 'knowledge', 'places', 'addis-hotels.md');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const MOBILE = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;
const KIND = { hotel: 'hotel', guest_house: 'guest house / pension', hostel: 'hostel', motel: 'motel', apartment: 'apartment' };
const KIND_AM = { hotel: 'ሆቴል', guest_house: 'የእንግዳ ማረፊያ', hostel: 'ሆስቴል', motel: 'ሞቴል', apartment: 'አፓርትመንት' };
const md = s => String(s || '').replace(/\s+/g, ' ').trim().replace(/([\\*_`[\]])/g, '\\$1');

const osm = read(process.env.BINA_OSM_ADDIS || '/root/storage/osm-addis-latest.json', null);
if (!osm) { console.error('no map file'); process.exit(1); }
const hidden = read('/root/storage/hotel-outreach/hidden.json', []);
const list = buildDirectory(osm, (read('/root/storage/wikidata-addis-hotels.json', {}).hotels) || []).filter(p => !hidden.includes(p.ref));
const day = new Date().toISOString().slice(0, 10);
const bySub = {};
for (const p of list) (bySub[p.sub || 'Sub-city not known'] ||= []).push(p);
const count = k => list.filter(p => p.kind === k).length;
const lines = ['---', 'title: "Hotels, guest houses, hostels and apartments in Addis Ababa (ሆቴሎችና የእንግዳ ማረፊያዎች)"', 'url: "https://bina.et/hotels"', 'lang: "en"',
  'source_name: "BinaSmart hotel directory: OpenStreetMap contributors (ODbL) and Wikidata (CC0)"', 'fetched: "' + day + '"', 'count: "' + list.length + '"', '---', '',
  '# Places to stay in Addis Ababa · በአዲስ አበባ ያሉ ሆቴሎችና የእንግዳ ማረፊያዎች', '',
  list.length + ' places to stay, grouped by sub-city, as of ' + day + ': ' + count('hotel') + ' hotels, ' + count('guest_house') + ' guest houses and pensions, '
  + count('apartment') + ' apartments, ' + (count('hostel') + count('motel')) + ' hostels and motels. The full list with search is at https://bina.et/hotels. '
  + 'This is where each place is and what the city map says about it, not an official licence register or star rating. Only hotels that list their rooms on BinaSmart can be booked on bina.et; '
  + 'for the others, call the hotel. A hotel owner claims their listing free on its bina.et page ("Claim this listing"); a hotel that is not listed can be added from https://bina.et/hotels ("My hotel isn\'t in the list").', ''];
for (const sub of Object.keys(bySub).sort((a, b) => bySub[b].length - bySub[a].length)) {
  const rows = bySub[sub], am = rows[0].subAm;
  lines.push('## ' + (sub === 'Sub-city not known' ? sub : sub + ' sub-city') + (am ? ' · ' + am + ' ክፍለ ከተማ' : '') + ' — ' + rows.length, '');
  for (const p of rows) {
    const parts = ['- **' + md(p.name) + '**' + (p.nameAm ? ' (' + md(p.nameAm) + ')' : ''), KIND[p.kind] + ' · ' + KIND_AM[p.kind]];
    if (p.stars) parts.push(p.stars + '-star');
    if (p.street) parts.push(md(p.street));
    if (p.phones.length) parts.push('office phone ' + p.phones.join(', '));
    if (p.website) parts.push('website ' + p.website);
    if (p.unsure) parts.push('the map marks it as a building or restaurant: call to check it takes guests');
    parts.push('https://bina.et/hotels/' + p.slug);
    lines.push(parts.join(' · '));
  }
  lines.push('');
}
const text = lines.join('\n');
const hits = lines.filter(l => MOBILE.test(l));
if (hits.length) {
  for (const l of hits) console.error('  mobile-like in: ' + l.replace(MOBILE, '[MATCH]').slice(0, 160));
  console.error('MOBILE NUMBER IN OUTPUT - nothing written'); process.exit(1);
}
console.log('places to stay: ' + list.length + ' in ' + Object.keys(bySub).length + ' sub-city groups · ' + text.length + ' chars');
if (!process.argv.includes('--dry-run')) { fs.writeFileSync(OUT, text); console.log('written ' + OUT); }
