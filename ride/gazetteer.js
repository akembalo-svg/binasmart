'use strict';
// Addis Ababa's named places for the ride search - the same OpenStreetMap fetch Bini's places knowledge is built
// from (ops/places/osm-addis.js writes /root/storage/osm-addis-latest.json), held in memory and searched locally.
//
// Why: the pickup/drop-off box asked Photon (photon.komoot.io), which ranks by string similarity, knows Amharic
// names poorly and sends every keystroke out of the server. On 25 September 2026 the city file held 8,937 named
// places - churches, mosques, hotels, cafes, schools, neighbourhoods, fuel stations, streets - with their Amharic
// names where mapped. A rider typing «ቅድስት ሥላሴ» or "Lime Tree Bole" should get the place, not a guess.
//
// The file is re-read when it changes (the monthly refresh), checked at most every ten minutes. A missing file is
// not an error: the search simply works as it did before.
const fs = require('fs');
let fold = s => s;
try { fold = require('../assistant/lang').foldEthiopic || fold; } catch (e) { /* folding is a nicety */ }

const KIND = [
  ['amenity', { hospital: 'hospital', clinic: 'clinic', pharmacy: 'pharmacy', bank: 'bank', police: 'police', courthouse: 'court',
    embassy: 'embassy', school: 'school', college: 'college', university: 'university', kindergarten: 'kindergarten',
    place_of_worship: 'place of worship', restaurant: 'restaurant', cafe: 'cafe', fast_food: 'fast food', bar: 'bar',
    marketplace: 'market', fuel: 'fuel station', cinema: 'cinema', theatre: 'theatre', library: 'library',
    post_office: 'post office', community_centre: 'community centre', townhall: 'town hall', bus_station: 'bus station' }],
  ['tourism', { hotel: 'hotel', guest_house: 'guest house', hostel: 'hostel', museum: 'museum', attraction: 'landmark', viewpoint: 'viewpoint', gallery: 'gallery' }],
  ['shop', { mall: 'mall', supermarket: 'supermarket', department_store: 'department store' }],
  ['leisure', { park: 'park', stadium: 'stadium', garden: 'garden' }],
  ['place', { suburb: 'area', neighbourhood: 'area', quarter: 'area', locality: 'area', square: 'square' }],
  ['railway', { station: 'rail station' }],
  ['office', { government: 'government office', diplomatic: 'embassy' }],
  ['highway', { trunk: 'street', primary: 'street', secondary: 'street', tertiary: 'street', residential: 'street' }],
];
// The rest of the named map (25 September 2026, full Geofabrik extract): a bus stop, a bakery, a company, a named
// building is a real destination too. The tag's own value names it ("car repair", "bakery").
const TYPE_KEYS = ['shop', 'office', 'craft', 'healthcare', 'amenity', 'tourism', 'leisure', 'building'];
// Street furniture has names in OSM too; nobody books a ride to a bench.
const NOT_A_DESTINATION = /^(bench|waste_basket|waste_disposal|recycling|toilets|drinking_water|parking_space|parking_entrance|bicycle_parking|vending_machine|telephone|post_box|clock|shelter|grit_bin|fountain)$/;
const kindOf = t => {
  for (const [k, m] of KIND) if (t[k] && m[t[k]]) return m[t[k]];
  if (t.historic) return 'landmark';
  if (t.public_transport || t.highway === 'bus_stop' || t.amenity === 'taxi' || t.railway === 'light_rail' || t.railway === 'tram_stop') return t.amenity === 'taxi' ? 'taxi rank' : 'stop';
  if (t.highway && /^(unclassified|living_street|service)$/.test(t.highway)) return 'street';
  if (NOT_A_DESTINATION.test(t.amenity || '')) return null;
  for (const k of TYPE_KEYS) if (t[k] && t[k] !== 'no') return t[k] === 'yes' ? (k === 'building' ? 'building' : k) : String(t[k]).replace(/_/g, ' ');
  return null;
};
const norm = s => fold(String(s || '')).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function makeGazetteer({ file = process.env.PLACES_GAZETTEER || '/root/storage/osm-addis-latest.json', now = Date.now } = {}) {
  let entries = [], mtime = 0, checked = 0;
  function load() {
    const t = now();
    if (t - checked < 600000 && entries.length) return;
    checked = t;
    let st; try { st = fs.statSync(file); } catch (e) { return; }
    if (st.mtimeMs === mtime) return;
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const bySub = d.bySub || {}, seen = new Set(), out = [];
      for (const e of d.elements || []) {
        const tg = e.tags || {};
        const label = String(tg['name:en'] || tg.name || '').trim();
        if (!label) continue;
        const kind = kindOf(tg); if (!kind) continue;
        const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
        if (lat == null || lng == null) continue;
        // One entry per street name: a road is many ways, and the rider means the street, not segment 14.
        if (kind === 'street') { if (seen.has(label.toLowerCase())) continue; seen.add(label.toLowerCase()); }
        const labelAm = /[ሀ-፿]/.test(tg['name:am'] || '') ? tg['name:am'] : (/[ሀ-፿]/.test(tg.name || '') ? tg.name : '');
        const names = [label, labelAm, tg.name, tg.alt_name, tg.old_name, tg.short_name].filter(Boolean);
        out.push({ label, labelAm, kind, sub: bySub[e.type + e.id] || '', lat, lng, keys: [...new Set(names.map(norm).filter(Boolean))] });
      }
      entries = out; mtime = st.mtimeMs;
    } catch (e) { /* keep the last good list */ }
  }

  // Exact name, then a name that starts with the words, then one that contains them; nearer first within each;
  // streets after places of the same rank - a rider who types "Bole" means the area before the road.
  function search(q, bias, limit = 6) {
    load();
    const n = norm(q);
    if (n.length < 2 || !entries.length) return [];
    const scored = [];
    // Rank 3 (checked against AddisMap's featured places, 25 September 2026): people write "Dinapoli" for
    // "Di Napoli Hotel" and "AU Conference Center" for "African Union Conference Center". So a name also matches
    // when it contains the words typed with the spaces taken out, or when every typed word starts a word of the
    // name, in any order ("AU" -> "African Union" is left to the words that do match: "conference", "center").
    const compact = n.replace(/ /g, '');
    const words = n.split(' ').filter(w => w.length > 1);
    for (const e of entries) {
      let r = 9;
      for (const k of e.keys) {
        if (k === n) { r = 0; break; }
        if (k.startsWith(n)) r = Math.min(r, 1); else if (k.includes(n)) r = Math.min(r, 2);
        else if (compact.length >= 5 && k.replace(/ /g, '').includes(compact)) r = Math.min(r, 3);
        else if (words.length > 1) {
          const kw = k.split(' ');
          const hitw = words.filter(w => kw.some(x => x.startsWith(w))).length;
          if (hitw === words.length || (words.length >= 3 && hitw >= words.length - 1 && hitw >= 2)) r = Math.min(r, 3);
        }
      }
      if (r === 9) continue;
      const d = bias ? Math.hypot((e.lat - bias.lat) * 111, (e.lng - bias.lng) * 109.5) : 0;
      scored.push({ e, s: r * 1000 + (e.kind === 'street' ? 500 : e.kind === 'stop' || e.kind === 'taxi rank' ? 450 : 0) + Math.min(d, 400) });   // the area before its stops and streets
    }
    return scored.sort((a, b) => a.s - b.s).slice(0, limit).map(({ e }) => ({
      kind: 'place', label: e.label, labelAm: e.labelAm, sub: [e.kind, e.sub, 'Addis Ababa'].filter(Boolean).join(' · '), lat: e.lat, lng: e.lng }));
  }
  return { search, size: () => { load(); return entries.length; } };
}

module.exports = { makeGazetteer, kindOf, norm };
