#!/usr/bin/env node
'use strict';
// Wikidata's hotels in Addis Ababa (CC0), for the hotel directory (hotels/directory.js): a hotel the city map
// draws only as a bus stop or a building still gets a listing, at Wikidata's point.
//
//   node ops/places/wikidata-hotels.js     writes /root/storage/wikidata-addis-hotels.json
//
// Monthly from ops/places/refresh.sh. Anything instance-of a subclass of hotel (Q27686) within 18 km of the
// centre of Addis Ababa. A failed fetch keeps last month's file.
const fs = require('fs');
const OUT = process.env.BINA_WD_HOTELS || '/root/storage/wikidata-addis-hotels.json';
// Everything with a point within 18 km of the centre first, then the hotel test: the other way round (every
// hotel on Earth, then where) times out.
const Q = `SELECT DISTINCT ?h ?hLabel ?am ?coord WHERE {
  SERVICE wikibase:around { ?h wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(38.7578 9.0107)"^^geo:wktLiteral . bd:serviceParam wikibase:radius "18" . }
  ?h wdt:P31/wdt:P279* wd:Q27686 .
  OPTIONAL { ?h rdfs:label ?am FILTER(lang(?am) = "am") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" } }`;

(async () => {
  const r = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(Q),
    { headers: { accept: 'application/sparql-results+json', 'user-agent': 'BinaSmart hotel directory (https://bina.et)' } });
  if (!r.ok) throw new Error('wikidata ' + r.status);
  const rows = (await r.json()).results.bindings;
  const by = new Map();
  for (const b of rows) {
    const qid = b.h.value.split('/').pop(), name = b.hLabel.value;
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
    if (!m || /^Q\d+$/.test(name) || by.has(qid)) continue;
    by.set(qid, { qid, name, nameAm: b.am ? b.am.value : '', lat: +m[2], lng: +m[1] });
  }
  const hotels = [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (hotels.length < 20) throw new Error('only ' + hotels.length + ' hotels - keeping the old file');
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), source: 'Wikidata (CC0)', hotels }, null, 1));
  console.log('wikidata hotels: ' + hotels.length + ' -> ' + OUT);
})().catch(e => { console.error(e.message); process.exit(1); });
