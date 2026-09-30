#!/usr/bin/env node
'use strict';
// Writes knowledge/places/ethiopia-government-contacts.md from the newest /root/storage/offices/raw-*.json
// (ops/places/office-contacts.js) and the OpenStreetMap fetch (ops/places/osm-addis.js).
//
//   node ops/places/office-contacts-md.js [--raw <file>] [--dry-run]
//
// Rules: a number or address is published only when it was read on the office's OWN pages and those pages
// carry the office's name. Every office line says where it was read and when (or which archived copy).
// An office whose pages gave nothing is still listed with what it handles and its website, so Bini can send
// people to the right place without inventing a number. A map point is added only for a clear name match.
const fs = require('fs');
const path = require('path');
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const DRY = process.argv.includes('--dry-run');

const dir = '/root/storage/offices';
// Every pass of the newest day (a full run, then --only re-runs of the offices that gave nothing), merged: per
// office the record that was read on its own named pages and gave the most, a live read before an archived one.
const newest = fs.readdirSync(dir).map(f => (/^raw-(\d{4}-\d{2}-\d{2})/.exec(f) || [])[1]).filter(Boolean).sort().pop();
const files = arg('--raw') ? [arg('--raw')] : fs.readdirSync(dir).filter(f => f.startsWith('raw-' + newest)).map(f => path.join(dir, f));
const score = o => !o.named ? 0 : (o.phones.length + o.emails.length + o.boxes.length + o.shorts.length) * (o.reached ? 2 : 1);
const best = new Map();
for (const f of files) for (const o of JSON.parse(fs.readFileSync(f, 'utf8'))) {
  const had = best.get(o.id); if (!had || score(o) > score(had)) best.set(o.id, o);
}
const order = require('./offices.json').map(o => o.id);
const raw = order.filter(id => best.has(id)).map(id => best.get(id));
const rawFile = files.map(f => path.basename(f)).join(' + ');
let osm = [];
try { osm = JSON.parse(fs.readFileSync('/root/storage/osm-addis-latest.json', 'utf8')).elements
  .filter(e => e.tags && (e.tags.office === 'government' || e.tags.amenity === 'townhall')); } catch (e) { /* no map points */ }

const GENERIC = /^(ministry|ethiopian?|addis|ababa|authority|service|services|bureau|administration|commission|city|federal|national|public|agency|and|the|of|for|office)$/i;
function mapPoint(o) {
  const words = o.en.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3 && !GENERIC.test(w));
  if (!words.length) return null;
  const hits = osm.filter(e => { const n = String(e.tags['name:en'] || e.tags.name || '').toLowerCase();
    return words.every(w => n.includes(w)) && /(ministry|authority|commission|bureau|service|administration|agency|court|bank|utility)/.test(n) === /(ministry|authority|commission|bureau|service|administration|agency|court|bank|utility)/.test(o.en.toLowerCase()); });
  if (hits.length !== 1) return null;          // none, or ambiguous: no pin rather than a wrong one
  const e = hits[0]; const lat = e.lat != null ? e.lat : e.center.lat, lon = e.lon != null ? e.lon : e.center.lon;
  return 'https://www.openstreetmap.org/?mlat=' + lat.toFixed(5) + '&mlon=' + lon.toFixed(5) + '#map=18/' + lat.toFixed(5) + '/' + lon.toFixed(5);
}
// Review rules (24 September 2026, reading the first build):
//  · a number found under two different offices belongs to neither: the Customs Commission's archived page
//    still carried the Ministry of Revenues' number from before the two were separated;
//  · a short code is four digits (8482, 9430); a three-digit number next to "hotline" is an emergency line or a
//    fragment, never the office's own code;
//  · e-mail: the office's role addresses only (info@, contact@, pr@ …), never a named member of staff.
const digitsOf = p => p.replace(/[^\d]/g, '').replace(/^2510?/, '0');   // +251 (0) 11… as well as +251 11…
// A number read on two offices' pages that one of them demonstrably owns: its own site lists it as its main line.
const SHARED_OWNER = { '0118931743': 'mor' };
const shared = (() => { const seen = new Map(); for (const o of raw) if (o.named) for (const p of new Set(o.phones.map(digitsOf))) seen.set(p, (seen.get(p) || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([p]) => p)); })();
const ROLE = /^(info|infopr|contact|contacts|pr|public|press|media|communications?|comm|webmaster|webadmin|support|customer|customerservice|complain\w*|compliant\w*|consultation|enquir\w*|inquir\w*|office|mail|trademark|patent|copyright|hotline|peace|\d+|[a-z]+\.(info|comm)|info\.[a-z]+)$/i;
for (const o of raw) {
  o.phones = o.phones.filter(p => !shared.has(digitsOf(p)) || SHARED_OWNER[digitsOf(p)] === o.id);
  o.shorts = o.shorts.filter(s => /^\d{4}$/.test(s));
  o.emails = o.emails.filter(e => ROLE.test(e.split('@')[0]) || e.split('@')[0].toLowerCase().includes(o.id));
}
const fmtPhone = p => { const d = digitsOf(p); return d.length === 10 ? '+251 ' + d.slice(1, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6) : p; };
const isoDay = s => s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);

function entry(o) {
  const ok = o.named && (o.phones.length || o.emails.length || o.boxes.length || o.shorts.length);
  const lines = ['### ' + o.en + ' · ' + o.am, '', '- Handles: ' + o.handles, '- Website: ' + o.url];
  if (ok) {
    if (o.shorts.length) lines.push('- Hotline / short code: ' + o.shorts.join(', '));
    if (o.phones.length) lines.push('- Telephone: ' + [...new Set(o.phones.map(fmtPhone))].slice(0, 4).join(' / '));
    if (o.emails.length) lines.push('- E-mail: ' + o.emails.slice(0, 3).join(', '));
    if (o.boxes.length) lines.push('- P.O. Box: ' + o.boxes.slice(0, 2).join(', ') + ', Addis Ababa');
    const src = o.pages.filter(p => !p.err);
    const arch = src.filter(p => p.archivedAt);
    lines.push('- Source: ' + (arch.length && !o.reached
      ? 'the office\'s own site as archived by the Wayback Machine on ' + isoDay(arch[0].archivedAt) + ' (' + arch[0].url + '); the live site did not answer from outside Ethiopia on ' + o.read
      : 'the office\'s own site (' + (src[0] ? src[0].url : o.url) + '), read ' + o.read) + '. Numbers change: confirm on the site before you travel.');
  } else {
    lines.push('- Contact: not published on the pages we could read (' + (o.reached ? 'site read ' + o.read : 'site did not answer from outside Ethiopia on ' + o.read) + '). Use the website, or ask at the office.');
  }
  const pin = mapPoint(o);
  if (pin) lines.push('- Map (OpenStreetMap, © contributors, ODbL): ' + pin);
  return lines.join('\n');
}

const fed = raw.filter(o => o.level === 'federal'), city = raw.filter(o => o.level === 'city');
const withContact = raw.filter(o => o.named && (o.phones.length || o.emails.length || o.boxes.length || o.shorts.length)).length;
const day = raw[0] ? raw[0].read : new Date().toISOString().slice(0, 10);
const doc = ['---', 'title: "Government offices of Ethiopia and Addis Ababa: what each handles and how to contact it"',
  'url: "https://bina.et/static/official-sources.html"', 'lang: "en"', 'source_name: "Each office\'s own website"', 'fetched: "' + day + '"', '---', '',
  '# Government offices: what each handles and how to contact it · የመንግሥት ተቋማት፦ ምን እንደሚሠሩና እንዴት እንደሚገኙ', '',
  raw.length + ' offices. Contacts are taken only from each office\'s own website, with the page and the day they were read; ' + withContact
  + ' published a phone, e-mail or P.O. Box on the pages we could read. Where nothing was published, the office is listed with its website only — no number is guessed. '
  + 'BinaSmart is not a government office. Emergency numbers: Federal Police 991, ambulance 907, fire 939.', '',
  '## Federal offices · የፌዴራል ተቋማት', '', ...fed.map(entry).map(s => s + '\n'), '## Addis Ababa city offices · የአዲስ አበባ ከተማ ተቋማት', '', ...city.map(entry).map(s => s + '\n')].join('\n');

const MOBILE = /(?:\+?251[ -]?|\b0)[79](?:[ -]?\d){8}/;
if (MOBILE.test(doc.replace(/https?:\/\/\S+/g, ''))) { console.error('MOBILE NUMBER IN OUTPUT - nothing written'); process.exit(1); }
console.log('offices ' + raw.length + ', with a published contact ' + withContact + ', map points ' + raw.filter(mapPoint).length + ' (from ' + rawFile + ')');
if (DRY) { console.log(doc.slice(0, 3000)); return; }
const out = path.join(__dirname, '..', '..', 'knowledge', 'places', 'ethiopia-government-contacts.md');
fs.writeFileSync(out, doc); console.log('written ' + out);
