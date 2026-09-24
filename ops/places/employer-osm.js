#!/usr/bin/env node
'use strict';
// A map point for employers that have none, from OpenStreetMap — only where the match is certain.
//
//   node --env-file=.env ops/places/employer-osm.js            report the matches, write nothing
//   node --env-file=.env ops/places/employer-osm.js --apply    write them
//
// prisma/schema.prisma is strict about employer locations: researched, never guessed from an advert, and
// locationChecked means a PERSON confirmed the point. So this:
//   · writes only to employers with no lat/lng and no address — it never replaces anything;
//   · matches on the whole company name, legal suffixes removed ("PLC", "S.C.", "Share Company"), and only
//     when exactly one mapped place carries it — a bank with two hundred branches gets nothing, because
//     "which branch is the office?" is not something a name can answer;
//   · says where the point came from in locationNote and leaves locationChecked empty, so the company page
//     keeps its "not confirmed, call before travelling" line and offers no ride until somebody checks.
const fs = require('fs');
const APPLY = process.argv.includes('--apply');
const API = 'https://overpass-api.de/api/interpreter';
const UA = 'BinaSmart-directory/1.0 (info@bina.et)';
const CITY_AREA = 3601707699;

const SUFFIX = /\b(p\.?\s?l\.?\s?c|s\.?\s?c|share\s+company|private\s+limited\s+company|pvt\.?\s+ltd|ltd|llc|limited|inc|co|company|enterprise|ent|group|trading|general\s+trading|import\s+(and|&)\s+export|in\s+ethiopia|ethiopia|et)\b\.?/g;
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[''`´]/g, '').replace(/[^a-z0-9ሀ-፿]+/g, ' ')
  .replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
// Names that are a sector, not a company: equal strings prove nothing.
const TOO_GENERIC = /^(hotel|hospital|clinic|school|college|university|bank|pharmacy|consultancy|consulting|construction|trading|import export|ngo|project|office|church|mosque)$/;

async function overpass(q) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(API, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }).catch(() => null);
    if (r && r.ok) return r.json();
    await new Promise(x => setTimeout(x, 8000 * (i + 1)));
  }
  throw new Error('Overpass did not answer');
}

(async () => {
  const q = `[out:json][timeout:180];area(${CITY_AREA})->.a;(
    nwr["name"]["office"](area.a); nwr["name"]["amenity"~"^(bank|university|college|school|hospital|clinic|ngo|kindergarten)$"](area.a);
    nwr["name"]["tourism"~"^(hotel|guest_house)$"](area.a); nwr["name"]["shop"~"^(supermarket|mall|department_store)$"](area.a);
    nwr["name"]["man_made"="works"](area.a); nwr["name"]["industrial"](area.a); nwr["name"]["building"~"^(commercial|office)$"](area.a););out tags center;`;
  const osm = (await overpass(q)).elements;
  const index = new Map();   // normalised name -> [elements]
  // A bank point on the map is a branch; the employer is the bank. Matching one to the other files the head
  // office at whichever branch happens to carry the bare name (24 September 2026: Abyssinia Bank -> "block 23").
  for (const e of osm.filter(x => x.tags.amenity !== 'bank' || /head\s*office|headquarter|ዋና መሥሪያ|ዋና መስሪያ/i.test(x.tags.name || ''))) for (const n of new Set([e.tags.name, e.tags['name:en'], e.tags.operator && e.tags.office ? null : null].filter(Boolean))) {
    const k = norm(n); if (k.length < 6 || TOO_GENERIC.test(k)) continue;
    (index.get(k) || index.set(k, []).get(k)).push(e);
  }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const emps = await prisma.employer.findMany({ where: { lat: null, address: null }, select: { id: true, name: true, slug: true, city: true } });
  const day = new Date().toISOString().slice(0, 10);
  const found = [];
  let ambiguous = 0;
  for (const e of emps) {
    if (e.city && !/addis/i.test(e.city)) continue;          // the map data is Addis Ababa only
    const k = norm(e.name); if (k.length < 6 || TOO_GENERIC.test(k)) continue;
    const hits = index.get(k) || [];
    if (!hits.length) continue;
    // Several points with the same name are one place only if they sit within 250 m of each other.
    const pt = h => ({ lat: h.lat != null ? h.lat : h.center.lat, lon: h.lon != null ? h.lon : h.center.lon });
    const p0 = pt(hits[0]);
    const near = hits.every(h => { const p = pt(h); return Math.hypot((p.lat - p0.lat) * 111000, (p.lon - p0.lon) * 109500) < 250; });
    if (!near) { ambiguous++; continue; }
    const t = hits[0].tags;
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const where = [street, t['addr:suburb'] || t['addr:neighbourhood']].filter(Boolean).join(', ');
    found.push({ e, lat: p0.lat, lng: p0.lon, osm: hits[0].type + '/' + hits[0].id, osmName: t.name, where });
  }
  console.log('employers without a location: ' + emps.length + '; certain matches: ' + found.length + '; same name in two places (skipped): ' + ambiguous);
  for (const f of found) console.log('  ' + f.e.name.slice(0, 44).padEnd(45) + '= ' + String(f.osmName).slice(0, 40).padEnd(41) + f.lat.toFixed(4) + ',' + f.lng.toFixed(4) + (f.where ? ' · ' + f.where.slice(0, 40) : ''));
  if (APPLY) {
    let n = 0;
    for (const f of found) {
      const r = await prisma.employer.updateMany({ where: { id: f.e.id, lat: null, address: null },
        data: { lat: f.lat, lng: f.lng, ...(f.where ? { address: f.where + ', Addis Ababa' } : {}),
          locationNote: 'Map point from OpenStreetMap (' + f.osm + ', read ' + day + ', matched by company name) — not yet confirmed by BinaSmart; call before travelling.' } });
      n += r.count;
    }
    console.log('written: ' + n);
    fs.writeFileSync('/root/storage/employer-osm-' + day + '.json', JSON.stringify(found.map(f => ({ id: f.e.id, slug: f.e.slug, osm: f.osm, lat: f.lat, lng: f.lng })), null, 1));
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
