'use strict';
// Every place to stay in Addis Ababa, from the city map, and the way an owner claims theirs.
//
//   GET  /api/hotels/directory               all of them (hotels, guest houses, hostels, motels, apartments)
//   GET  /hotels/:slug                        one place: what the map knows, and "is this your hotel?"
//   POST /api/hotels/claim                    an owner's claim - stored; a person decides. ref "new" = a hotel that is
//                                             not in the list (the map does not draw every one); it is added by hand
//   GET  /ops/hotel-claims/:id/:action?t=…    approve | reject, one tap from the Telegram message
//
// Source: /root/storage/osm-addis-latest.json (ops/places/refresh.sh, monthly) - the file ride/gazetteer.js
// and the places knowledge already read, so the directory, the ride search and Bini name the same places -
// plus Wikidata's Addis hotels (/root/storage/wikidata-addis-hotels.json, ops/places/wikidata-hotels.js).
//
// What a listing will not show:
//   · A mobile number. On the map a hotel's number is often the owner's own phone, typed in by a stranger.
//     Landlines (011…) are the hotel's; a mobile appears only after the owner claims the listing and says so.
//   · "Book". Only hotels that list rooms on BinaSmart (/hotel/<slug>) can be booked; a map entry is a map entry.
// A claim is not ownership. Anyone can type "I am the manager of the Hilton"; a person calls the number
// before anything changes, which is why approval is a tap by the owner of BinaSmart and nothing more.
const fs = require('fs');
const { brandTile, suffix } = require('../brand/sections');
const crypto = require('crypto');
const path = require('path');

const FILE = process.env.BINA_OSM_ADDIS || '/root/storage/osm-addis-latest.json';
const WD_FILE = process.env.BINA_WD_HOTELS || '/root/storage/wikidata-addis-hotels.json';
// Listings a hotel asked us to take down ("reply remove"): a JSON array of refs, e.g. ["node/123"]. Edited by hand.
const HIDDEN_FILE = process.env.BINA_HOTELS_HIDDEN || '/root/storage/hotel-outreach/hidden.json';
const KINDS = {
  hotel: { en: 'Hotel', am: 'ሆቴል' },
  guest_house: { en: 'Guest house', am: 'የእንግዳ ማረፊያ' },
  hostel: { en: 'Hostel', am: 'ሆስቴል' },
  motel: { en: 'Motel', am: 'ሞቴል' },
  apartment: { en: 'Apartment', am: 'አፓርትመንት' },
};
const SUB_AM = { 'Addis Ketema': 'አዲስ ከተማ', 'Akaki Kality': 'አቃቂ ቃሊቲ', Arada: 'አራዳ', Bole: 'ቦሌ', Gulele: 'ጉለሌ',
  Kirkos: 'ቂርቆስ', 'Kolfe Keranio': 'ኮልፌ ቀራኒዮ', Lideta: 'ልደታ', 'Nifas Silk-Lafto': 'ንፋስ ስልክ ላፍቶ', Yeka: 'የካ', 'Lemi Kura': 'ለሚ ኩራ' };
const MOBILE = /^(?:\+?251|0)?[79]\d{8}$/;

// "+251116292329/30, 0911…" -> the landline parts only, as written.
// A part is dropped when a mobile appears ANYWHERE in it, not only when the whole part is one: the map has
// "+251 9… (bookings +251 114 …)" and "00251 9…" (26 Sep 2026 - both reached a public page before this).
const MOBILE_ANY = /(?:\+?251[\s-]?|\b0)[79](?:[\s-]?\d){8}/;
function landlines(raw) {
  return String(raw || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)
    .filter(s => { const d = s.split('/')[0].replace(/[^\d+]/g, ''); return d.replace(/\D/g, '').length >= 9 && !MOBILE.test(d) && !MOBILE_ANY.test(s); });
}
const kebab = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const slugOf = e => (kebab(e.tags.name) || 'place') + '-' + e.type[0] + e.id;
const website = t => { const w = String(t.website || t['contact:website'] || t.url || '').trim().split(/[;\s]/)[0];
  return !w ? null : /^https?:\/\//i.test(w) ? w : /^[\w.-]+\.[a-z]{2,}/i.test(w) ? 'https://' + w : null; };

// A place the map does not tag as lodging, but whose name says it is one: "Besha Hotel" drawn as a building,
// "TM Pension" drawn as a restaurant. In Addis "ሆቴል" is also the word for an eatery ("… Kitfo and Hotel"), so
// a restaurant, bar or café counts only when its name says pension, guest house, lodge, inn or apartment - never
// on "hotel" alone. These listings say so on their page: call to check it takes guests.
const LODGE_WORD = /\b(hotels?|pension|guest ?house|lodge|inn|resort|hostel|motel|apartments?|suites)\b|ሆቴል|ፔንሲዮን|ፔኒሲዮን|ፔንስዮን|እንግዳ ማረፊያ|መኝታ ቤት|አፓርታማ|አፓርትመንት|ሪዞርት|ሎጅ/i;
const STAY_WORD = /\b(pension|guest ?house|lodge|inn|hostel|motel|apartments?)\b|ፔንሲዮን|ፔኒሲዮን|ፔንስዮን|እንግዳ ማረፊያ|መኝታ ቤት|አፓርታማ|አፓርትመንት|ሎጅ/i;
const NOT_STAY = /institute|college|collage|school|training|academy|embassy|residence|bowling|mall|\bbus\b|\bstop\b|terminal|lobby|lounge|homeowners|real ?estate|association|university|bank/i;
const EATERY = new Set(['restaurant', 'bar', 'cafe', 'fast_food', 'pub', 'hospital', 'clinic']);
const NOT_A_PLACE = ['public_transport', 'highway', 'railway', 'shop', 'healthcare'];
const GENERIC = new Set(['hotel', 'hotels', 'pension', 'guest', 'house', 'guesthouse', 'lodge', 'inn', 'resort', 'hostel', 'motel', 'apartment', 'apartments', 'suites',
  'addis', 'ababa', 'international', 'the', 'and', 'spa', 'by', 'plc', 'complex']);
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(w => w && !GENERIC.has(w)).join(' ');
const kindFromName = n => /apartment|suites|አፓርት|አፓርታማ/i.test(n) ? 'apartment' : /pension|guest ?house|ፔን|ፔኒ|እንግዳ ማረፊያ|መኝታ/i.test(n) ? 'guest_house'
  : /hostel/i.test(n) ? 'hostel' : /motel/i.test(n) ? 'motel' : 'hotel';
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 109.5);
// On the Addis map "tourism=apartment" mostly means somebody marking their own house for delivery and taxi
// drivers, not a flat to rent: a Jev audit on 26 Sep 2026 found 447 of 462 were homes or condominium blocks
// ("Beti and Abel's Home", "Block 282", "Land -1", one with the owner's phone on it). So an apartment is listed
// only when its name says it rents - apartment(s), suites, furnished, guest house, pension, hotel... - and nothing
// in the name says people live there. The 453 found that day are also in hidden.json; this rule stops new ones.
const RENTS = /\b(ap+art?ments?|suites?|furnish\w*|serviced|guest ?house|pension|hotel|lodge|inn|hostel|motel|rentals?|for rent|kiray|holiday|airbnb|short.?(stay|term))\b|ኪራይ|ፔንሲዮን|እንግዳ ማረፊያ|ሆቴል|አፓርታማ|አፓርትመንት/i;
const LIVES = /condo\w*|cindominium|conduminium|ኮን[ዶደ]ሚኒ|\bblock\b|ብሎክ|\bG\+\d|residen\w*|real ?estate|for sal|\bland\b|dormitor|\bhome\b|\bhouse\b|ቤት|['’]s\b/i;
const rentsByName = n => RENTS.test(n) && !LIVES.test(n.replace(/guest ?house|መኝታ ቤት|እንግዳ ማረፊያ ቤት/gi, ''));

// wikidata: [{ qid, name, nameAm, lat, lng }] from ops/places/wikidata-hotels.js (CC0) - hotels the map draws
// only as a bus stop or a building get their own listing at Wikidata's point.
function buildDirectory(osm, wikidata) {
  const els = (osm && osm.elements) || [], bySub = (osm && osm.bySub) || {};
  const out = [], extra = [];
  for (const e of els) {
    const t = e.tags || {};
    if (!(t.name || t['name:en'] || t['name:am'])) continue;
    let kind = t.tourism, unsure = false;
    // Many Addis entries carry the Amharic name as "name" and the English one as "name:en": list them by the
    // English name, with the Amharic under it, so "Semien Hotel" is found by the name a visitor types.
    const ethiopic = /[ሀ-፿]/.test(t.name || '') && !/[a-z]/i.test(t.name || '');
    const name = String((ethiopic && t['name:en']) || t.name || t['name:en'] || t['name:am']).trim();
    if (!KINDS[kind]) {
      const all = [t.name, t['name:en'], t['name:am']].filter(Boolean).join(' ');
      // ("ማረፊያ" alone is also the airport - አውሮፕላን ማረፊያ - so only "እንግዳ ማረፊያ" counts.) Any amenity other than an
      // eatery is a different business that borrowed a hotel's name: "Merab hotel" the bank, "111396 National Hotel" the internet café.
      if (!LODGE_WORD.test(all) || NOT_STAY.test(all) || NOT_A_PLACE.some(k => k in t) || t.tourism || t.office || (t.amenity && !EATERY.has(t.amenity))) continue;
      if (EATERY.has(t.amenity) && !STAY_WORD.test(all)) continue;
      if (!nameKey(name) && !/[ሀ-፿]/.test(name)) continue;          // just "Guest house"
      kind = kindFromName(all); unsure = true;
    }
    if (kind === 'apartment' && !rentsByName([t.name, t['name:en'], t['name:am']].filter(Boolean).join(' '))) continue;
    const lat = e.lat != null ? e.lat : e.center && e.center.lat, lng = e.lon != null ? e.lon : e.center && e.center.lon;
    if (lat == null || lng == null) continue;
    const nameAm = String(t['name:am'] || (ethiopic ? t.name : '') || '').trim();
    const stars = parseInt(t.stars, 10);
    const sub = bySub[e.type + e.id] || '';
    (unsure ? extra : out).push({ ref: e.type + '/' + e.id, slug: slugOf({ ...e, tags: { ...t, name } }), name, nameAm: nameAm && nameAm !== name ? nameAm : '',
      kind, sub, subAm: SUB_AM[sub] || '', lat: +lat.toFixed(6), lng: +lng.toFixed(6), stars: stars >= 1 && stars <= 5 ? stars : null,
      phones: landlines(t.phone || t['contact:phone']), website: website(t), street: t['addr:street'] || '', unsure, rich: Object.keys(t).length });
  }
  // The same place is often mapped twice (a node and a building): one name within 300 m is one listing.
  out.sort((a, b) => b.rich - a.rich);
  const kept = [];
  for (const p of out) {
    if (kept.some(k => k.name.toLowerCase() === p.name.toLowerCase() && km(k, p) < 0.3)) continue;
    kept.push(p);
  }
  // An extra is dropped when a listing within 300 m already carries its name ("Ghion Hotel ግዮን ሆቴል" beside "Ghion Hotel").
  // Wikidata's "Jupiter International Hotel - Cazanchis" is the map's "Jupiter International Hotel (Kazanchis)": at the
  // same spot (250 m), the same first word is enough.
  const same = (a, b) => { const x = nameKey(a.name), y = nameKey(b.name);
    return (x && y && (x === y || (x.length > 3 && y.length > 3 && (x.includes(y) || y.includes(x)))
      || (km(a, b) < 0.25 && x.split(' ')[0].length > 2 && x.split(' ')[0] === y.split(' ')[0])
      || (km(a, b) < 0.1 && x.length > 3 && x.slice(0, 4) === y.slice(0, 4)))) || a.name.toLowerCase() === b.name.toLowerCase(); };   // "Elily" / "Elilly", 40 m apart
  for (const p of extra.sort((a, b) => b.rich - a.rich)) if (!kept.some(k => km(k, p) < 0.3 && same(k, p))) kept.push(p);
  // Wikidata's hotels, where nothing on the map within 1.5 km has the name. Sub-city from the nearest mapped place.
  const located = els.filter(e => bySub[e.type + e.id] && (e.lat != null || e.center));
  for (const w of wikidata || []) {
    if (!w || !w.name || w.lat == null || w.lng == null) continue;
    if (kept.some(k => km(k, w) < 1.5 && same(k, w))) continue;
    let near = null, best = 0.8;
    for (const e of located) { const d = km({ lat: e.lat != null ? e.lat : e.center.lat, lng: e.lon != null ? e.lon : e.center.lon }, w); if (d < best) { best = d; near = e; } }
    const sub = near ? bySub[near.type + near.id] : '';
    kept.push({ ref: 'wikidata/' + w.qid, slug: (kebab(w.name) || 'hotel') + '-' + String(w.qid).toLowerCase(), name: w.name, nameAm: w.nameAm && w.nameAm !== w.name ? w.nameAm : '',
      kind: kindFromName(w.name), sub, subAm: SUB_AM[sub] || '', lat: +(+w.lat).toFixed(6), lng: +(+w.lng).toFixed(6), stars: null, phones: [], website: null, street: '', unsure: false });
  }
  kept.forEach(p => delete p.rich);
  return kept.sort((a, b) => (b.stars || 0) - (a.stars || 0) || a.name.localeCompare(b.name));
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Sent by @bina_smart_bot (BINA_RIDER_BOT_TOKEN) to the admin chats. Not BINASMART_TG_TOKEN: that is the old
// @gccandconectbot, which the owner never started - getChat on 26 Sep 2026 said "chat not found" for both chats,
// so every claim would have vanished. The sending bot and the chat must belong together.
async function tellOwner(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN;
  const chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
      ok = (await r.json()).ok === true || ok;
    } catch (e) { /* the other chat may still get it */ }
  }
  return ok;
}

// A hotel search engines and AI assistants should know: a real place (not "unsure") that a guest can reach - it has a
// phone, a website or stars. Only those are indexable; a name alone from the map stays noindex (28 Sep 2026).
// Photos and details from ops/places/hotel-import.js (the hotel's own website, Wikimedia Commons, our ride fares), re-read on change.
const DETAILS = '/root/storage/hotels/details.json';
let det = { mtime: 0, map: {} };
function detailsMap() { try { const st = fs.statSync(DETAILS); if (st.mtimeMs !== det.mtime) det = { mtime: st.mtimeMs, map: JSON.parse(fs.readFileSync(DETAILS, 'utf8')) }; } catch (e) {} return det.map; }
// Photos a hotel sent through Bini and the team approved (/ops/hotel-photos): they lead the gallery.
const OWNER = '/root/storage/hotels/owner-photos.json';
let own = { mtime: 0, map: {} };
function ownerMap() { try { const st = fs.statSync(OWNER); if (st.mtimeMs !== own.mtime) own = { mtime: st.mtimeMs, map: JSON.parse(fs.readFileSync(OWNER, 'utf8')) }; } catch (e) {} return own.map; }
// Rooms and prices a hotel sent through Bini (company_request rooms) wait beside its claim in CLAIM_ROOMS; when the team
// approves the claim they move to OWNER_ROOMS and replace what we read on the hotel's website (28 Sep 2026).
// The env overrides are for rehearsals and tests only (1 Oct 2026): a test claim must never put prices on a real hotel.
const OWNER_ROOMS = process.env.HOTEL_OWNER_ROOMS_FILE || '/root/storage/hotels/owner-rooms.json', CLAIM_ROOMS = process.env.HOTEL_CLAIM_ROOMS_FILE || '/root/storage/hotels/claim-rooms.json';
let orm = { mtime: 0, map: {} };
function ownerRooms() { try { const st = fs.statSync(OWNER_ROOMS); if (st.mtimeMs !== orm.mtime) orm = { mtime: st.mtimeMs, map: JSON.parse(fs.readFileSync(OWNER_ROOMS, 'utf8')) }; } catch (e) {} return orm.map; }
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return {}; } };
const writeJson = (f, o) => { fs.writeFileSync(f + '.part', JSON.stringify(o, null, 1)); fs.renameSync(f + '.part', f); };
// each room: a name and a price per night in birr (200 to 500,000) or US dollars (5 to 5,000); anything else is dropped
function cleanRooms(v) {
  if (!Array.isArray(v)) return [];
  const rooms = [];
  for (const r of v.slice(0, 12)) {
    if (!r || typeof r !== 'object') continue;
    const name = String(r.name || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const cur = /usd|\$|dollar/i.test(String(r.currency || '') + ' ' + String(r.price || '')) ? 'USD' : 'ETB';
    const n = Math.round(Number(String(r.price == null ? '' : r.price).replace(/[^\d.]/g, '')));
    if (name.length < 2 || !Number.isFinite(n) || (cur === 'ETB' ? n < 200 || n > 500000 : n < 5 || n > 5000)) continue;
    rooms.push({ name, price: cur + ' ' + n.toLocaleString('en-US'), n, cur });
  }
  return rooms.slice(0, 10);
}
// the cheapest room, in birr when the hotel gives birr prices (a dollar price is never compared with a birr one)
function roomMin(rooms) {
  const n = r => r.n || Number(String(r.price).replace(/[^\d]/g, '')) || 0;
  const etb = (rooms || []).filter(r => !/usd|\$/i.test(r.price)), pool = etb.length ? etb : (rooms || []);
  return pool.slice().sort((a, b) => n(a) - n(b))[0] || null;
}
const roomsLine = rooms => rooms.length ? '\n\u{1F6CF} Rooms: ' + rooms.map(r => esc(r.name) + ' <b>' + esc(r.price) + '</b>').join(', ') + ' (on the page when you approve)' : '';
// the hotel's website: one we found and checked (it names the hotel and Addis) beats the map's tag; a map tag that
// turned out to be another city's hotel is never shown
const siteOf = p => { const d = detailsMap()[p.ref] || {}; return d.website || (p.website && !d.foreignWebsite ? p.website : null); };
const dOf = p => { const d = detailsMap()[p.ref] || {}, o = ownerMap()[p.ref] || [], r = ownerRooms()[p.ref];
  const hasRooms = !!(r && r.rooms && r.rooms.length);
  if (!o.length && !hasRooms) return d;
  const res = Object.assign({}, d);
  if (o.length) Object.assign(res, { photos: o.map(x => x.url).concat(d.photos || []).slice(0, 12), card: o[0].card || o[0].url,
    credits: [{ credit: 'Photo: the hotel (sent to BinaSmart)' }].concat(d.credits || []) });
  if (hasRooms) Object.assign(res, { rooms: r.rooms, roomsFrom: 'hotel', roomsDate: r.date });
  return res; };
const FAC = { wifi: ['\u{1F4F6}', 'Free Wi-Fi', 'ዋይፋይ'], pool: ['\u{1F3CA}', 'Swimming pool', 'መዋኛ ገንዳ'], spa: ['\u{1F486}', 'Spa', 'ስፓ'], gym: ['\u{1F3CB}️', 'Gym', 'ጂም'],
  restaurant: ['\u{1F37D}️', 'Restaurant', 'ምግብ ቤት'], bar: ['\u{1F378}', 'Bar', 'ባር'], parking: ['\u{1F17F}️', 'Parking', 'ፓርኪንግ'], airport: ['✈️', 'Airport shuttle', 'የአየር ማረፊያ ትራንስፖርት'],
  meeting: ['\u{1F3A4}', 'Meeting rooms', 'የስብሰባ አዳራሽ'], breakfast: ['\u{1F950}', 'Breakfast', 'ቁርስ'], laundry: ['\u{1F9FA}', 'Laundry', 'ልብስ ማጠቢያ'], roomservice: ['\u{1F6CE}️', 'Room service', 'የክፍል አገልግሎት'],
  reception24: ['\u{1F550}', '24-hour reception', 'የ24 ሰዓት መስተንገዶ'], aircon: ['❄️', 'Air conditioning', 'አየር ማቀዝቀዣ'], elevator: ['\u{1F6D7}', 'Elevator', 'ሊፍት'], garden: ['\u{1F333}', 'Garden / terrace', 'የአትክልት ስፍራ'] };
const findable = p => !p.unsure && !!(p.phones.length || siteOf(p) || p.stars || (dOf(p).photos || []).length);
function hotelLd(p, rt) {
  return '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': p.kind === 'hotel' || p.kind === 'motel' ? 'Hotel' : p.kind === 'hostel' ? 'Hostel' : 'LodgingBusiness',
    name: p.name, alternateName: p.nameAm || undefined, url: 'https://bina.et/hotels/' + p.slug, sameAs: siteOf(p) ? [siteOf(p)] : undefined, telephone: p.phones[0] || undefined,
    starRating: p.stars ? { '@type': 'Rating', ratingValue: p.stars } : undefined,
    address: { '@type': 'PostalAddress', streetAddress: p.street || undefined, addressLocality: p.sub || 'Addis Ababa', addressRegion: 'Addis Ababa', addressCountry: 'ET' },
    geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
    image: (dOf(p).photos || []).map(u => u.split('?')[0]).slice(0, 6), amenityFeature: (dOf(p).facilities || []).filter(k => FAC[k]).map(k => ({ '@type': 'LocationFeatureSpecification', name: FAC[k][1], value: true })),
    checkinTime: dOf(p).checkin || undefined, checkoutTime: dOf(p).checkout || undefined, priceRange: (dOf(p).rooms || []).length ? dOf(p).rooms.map(r => r.price).join(' / ').slice(0, 100) : undefined,
    aggregateRating: rt && rt.count ? { '@type': 'AggregateRating', ratingValue: rt.avg, ratingCount: rt.count, bestRating: 5, worstRating: 1 } : undefined }).replace(/</g, '\\u003c') + '</script>';
}
function page(p, claimed, rating) {
  const k = KINDS[p.kind];
  // guest ratings: only riders whose BinaSmart ride ended here (ride/placeReviews.js); written words only after approval
  const rt = rating && rating.count ? rating : null, starRow = n => '\u2605'.repeat(Math.round(n)) + '\u2606'.repeat(5 - Math.round(n));
  const rateTop = rt ? '<a class="rate" href="#reviews"><b>\u2605 ' + rt.avg.toFixed(1) + '</b> \u00b7 ' + rt.count + (rt.count === 1 ? ' rating' : ' ratings') + ' from BinaSmart riders</a>' : '';
  const rateBox = '<h2 class="h2" id="reviews">Guest ratings <span class="am">የእንግዶች ግምገማ</span></h2>'
    + (rt ? '<p class="rbig"><b>' + rt.avg.toFixed(1) + '</b>/5 <span class="rst">' + starRow(rt.avg) + '</span> <span class="rn">' + rt.count + (rt.count === 1 ? ' rating' : ' ratings') + '</span></p>'
      + (rt.reviews || []).map(r => '<blockquote class="rv"><span class="rst">' + starRow(r.stars) + '</span> ' + esc(r.text || '') + ' <i>' + esc(new Date(r.createdAt).toISOString().slice(0, 10)) + '</i></blockquote>').join('')
      : '<p class="sum">No ratings yet. <span class="am">እስካሁን ደረጃ የለም</span></p>')
    + '<p class="src">Only a rider whose BinaSmart ride ended here can rate this place, so every rating comes from a real visit: nobody can buy, copy or write one without a ride. <span class="am">ደረጃ የሚሰጡት እዚህ በቢናስማርት የደረሱ ተሳፋሪዎች ብቻ ናቸው።</span></p>';
  const d = dOf(p), photos = d.photos || [], fac = (d.facilities || []).filter(x => FAC[x]), rooms = d.rooms || [], site = siteOf(p);
  const tel = p.phones[0] || (d.contacts && d.contacts.phone) || null, wa = d.contacts && d.contacts.whatsapp ? String(d.contacts.whatsapp).replace(/\D/g, '') : null;
  const air = d.airport || null, rideTo = 'to=' + encodeURIComponent(p.name) + '&lat=' + p.lat + '&lng=' + p.lng;
  const credits = [...new Set((d.credits || []).map(c => c.page && /wikimedia/.test(c.page) ? '<a href="' + esc(c.page) + '" rel="nofollow noopener" target="_blank">' + esc(c.credit) + '</a> (Wikimedia Commons)' : esc(c.credit)))];
  const gal = !photos.length ? '<a class="addph" href="?bini=hotel">\u{1F4F7} No photos yet. Owner or manager? <b>Add your photos free</b>: send them to Bini <span class="am">\u134e\u1276 \u12ed\u120b\u12a9</span></a>' : photos.length ? '<div class="gal"><button type="button" class="gm" onclick="hbOpen(0)"><img src="' + esc(photos[0]) + '" alt="' + esc(p.name) + '" fetchpriority="high"></button>'
    + (photos.length > 1 ? '<div class="gt">' + photos.slice(1, 5).map((u, i) => '<button type="button" onclick="hbOpen(' + (i + 1) + ')"><img src="' + esc(u) + '" alt="' + esc(p.name) + ' photo ' + (i + 2) + '" loading="lazy">' + (i === 3 && photos.length > 5 ? '<span>+' + (photos.length - 5) + '</span>' : '') + '</button>').join('') + '</div>' : '')
    + '</div><p class="credit">Photos: ' + credits.join(' · ') + '</p>' : '';
  const airBox = air ? '<div class="air"><div>✈️ <b>' + air.km + ' km</b> from Bole airport · about <b>' + air.min + ' min</b> by car' + (air.fareFrom ? ' · BinaSmart ride from <b>' + air.fareFrom + ' birr</b>' : '')
    + '<br><span class="am">ከቦሌ አየር ማረፊያ ' + air.km + ' ኪ.ሜ · ' + air.min + ' ደቂቃ' + (air.fareFrom ? ' · ግልቢት ከ' + air.fareFrom + ' ብር' : '') + '</span></div>'
    + '<a class="btn pri" href="/ride?airport=1&amp;tier=economy&amp;' + esc(rideTo) + '">Book the ride →</a></div>' : '';
  const minRoom = (roomMin(rooms) || {}).price;
  const summary = p.name + ' is a ' + (p.stars ? p.stars + '-star ' : '') + k.en.toLowerCase() + ' in ' + (p.sub ? p.sub + ', ' : '') + 'Addis Ababa'
    + (air ? ', ' + air.km + ' km (about ' + air.min + ' minutes by car) from Bole International Airport' : '') + '.'
    + (fac.length ? ' Facilities listed by the hotel: ' + fac.slice(0, 7).map(x => FAC[x][1].toLowerCase()).join(', ') + '.' : '')
    + (minRoom ? ' Rooms from ' + minRoom + ', as the hotel publishes them.' : '')
    + ' Contact the hotel directly: BinaSmart takes no commission.';
  const extra = (fac.length ? '<h2 class="h2">Facilities <span class="am">አገልግሎቶች</span></h2><div class="fac">' + fac.map(x => '<span>' + FAC[x][0] + ' ' + FAC[x][1] + ' <i class="am">' + FAC[x][2] + '</i></span>').join('') + '</div><p class="src">As listed on the hotel\'s own website.</p>' : '')
    + (rooms.length ? '<h2 class="h2">Rooms &amp; prices <span class="am">ክፍሎችና ዋጋ</span></h2><table class="rooms">' + rooms.map(r => '<tr><td>' + esc(r.name) + '</td><td><b>' + esc(r.price) + '</b></td></tr>').join('') + '</table><p class="src">' + (d.roomsFrom === 'hotel' ? 'Prices given by the hotel to BinaSmart' + (d.roomsDate ? ' on ' + esc(d.roomsDate) : '') : 'As published on the hotel\'s website' + (d.updated ? ' (read ' + esc(d.updated) + ')' : '')) + '. Call the hotel to confirm today\'s price.</p>' : '')
    + '<h2 class="h2">About <span class="am">ስለ ' + esc(p.nameAm || p.name) + '</span></h2><p class="sum">' + esc(summary) + '</p>'
    + (d.ownText ? '<button type="button" class="btn" id="ownb" onclick="ownText()">Read ' + esc(p.name) + '\'s own description</button><div id="own" class="own" hidden></div>' : '');
  const acts = [tel ? '<a class="btn pri" href="tel:' + esc(tel.replace(/[^\d+]/g, '')) + '">\u{1F4DE} Call</a>' : '',
    wa ? '<a class="btn wa" href="https://wa.me/' + wa + '?text=' + encodeURIComponent('Hello, I found ' + p.name + ' on BinaSmart (bina.et). Do you have a room?') + '" target="_blank" rel="noopener">WhatsApp</a>' : '',
    site ? '<a class="btn" href="' + esc(site) + '" target="_blank" rel="nofollow noopener">\u{1F310} Website</a>' : ''].join('');
  const wd = p.ref.startsWith('wikidata/');
  const map = wd ? 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=18/' + p.lat + '/' + p.lng
    : 'https://www.openstreetmap.org/' + p.ref + '#map=18/' + p.lat + '/' + p.lng;
  const facts = [
    '<li><span>Type · ዓይነት</span><b>' + esc(k.en) + ' · <span class="am">' + k.am + '</span></b></li>',
    p.sub ? '<li><span>Sub-city · ክፍለ ከተማ</span><b>' + esc(p.sub) + (p.subAm ? ' · <span class="am">' + p.subAm + '</span>' : '') + '</b></li>' : '',
    p.street ? '<li><span>Street · መንገድ</span><b>' + esc(p.street) + '</b></li>' : '',
    p.stars ? '<li><span>Stars · ኮከብ</span><b>' + '★'.repeat(p.stars) + '</b></li>' : '',
    p.phones.length ? '<li><span>Phone · ስልክ</span><b>' + p.phones.map(esc).join('<br>') + '</b></li>' : '',
    site ? '<li><span>Website · ድረ ገጽ</span><b><a href="' + esc(site) + '" rel="nofollow noopener" target="_blank">' + esc(site.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</a></b></li>' : '',
  ].join('');
  return `<!DOCTYPE html><html lang="am"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(p.name)} · ${esc(k.en)} in ${esc(p.sub || 'Addis Ababa')} · BinaSmart</title>
<meta name="description" content="${esc((p.name + ': ' + (p.stars ? p.stars + '-star ' : '') + k.en.toLowerCase() + (p.sub ? ' in ' + p.sub : '') + ', Addis Ababa.' + (air ? ' ' + air.km + ' km from Bole airport, ride from ' + (air.fareFrom || '') + ' birr.' : '') + (photos.length ? ' Photos,' : '') + ' phone and map. No commission.').slice(0, 158))}">
<meta name="robots" content="${findable(p) ? 'index, follow' : 'noindex, follow'}"><link rel="canonical" href="https://bina.et/hotels/${esc(p.slug)}"><meta property="og:title" content="${esc(p.name)} \u00b7 ${esc(k.en)} in ${esc(p.sub || 'Addis Ababa')}"><meta property="og:description" content="${esc(p.name)}: ${esc(k.en.toLowerCase())}${p.sub ? ' in ' + esc(p.sub) : ''}, Addis Ababa. Location, phone and website on BinaSmart."><meta property="og:url" content="https://bina.et/hotels/${esc(p.slug)}"><meta property="og:type" content="website"><meta property="og:image" content="${esc(photos[0] ? photos[0].split('?')[0] : 'https://bina.et/static/og-hotels.png')}"><meta name="twitter:card" content="summary_large_image">${findable(p) ? hotelLd(p, rt) : ''}
<link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#F8FAFC;--ink:#081120;--mut:#64748B;--em:#7c70e8;--em2:#5146b7;--line:rgba(8,17,32,.08);--ok:#047857}
.brandbar{display:flex;align-items:center;font-weight:900;font-size:21px;letter-spacing:-.5px;color:var(--ink);text-decoration:none;margin-bottom:4px}.brandbar .g{color:#00C896}.brandbar .zena{color:#F59E0B;font-size:15px;margin-left:4px}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink);-webkit-font-smoothing:antialiased;padding:0 16px 60px}
.am{font-family:'Noto Sans Ethiopic','Plus Jakarta Sans',system-ui,sans-serif}
a{color:var(--em2);text-decoration:none}
.w{max-width:720px;margin:0 auto}
.top{display:flex;align-items:center;gap:10px;padding:16px 0;font-weight:800}
.top a{font-size:13px}
.card{background:#fff;border:1px solid var(--line);border-radius:22px;padding:20px;margin-top:12px}
.kind{display:inline-flex;gap:6px;font-size:11.5px;font-weight:800;color:var(--em2);background:rgba(124,112,232,.1);padding:5px 10px;border-radius:999px}
h1{font-size:30px;line-height:1.15;font-weight:900;letter-spacing:-.4px;margin-top:10px;text-wrap:balance}
.amn{font-size:18px;font-weight:700;color:var(--em2);margin-top:4px}
.ok{display:inline-block;margin-top:10px;font-size:12px;font-weight:800;color:var(--ok);background:rgba(4,120,87,.1);padding:5px 10px;border-radius:999px}
ul{list-style:none;margin-top:14px;display:grid;gap:8px}
li{display:flex;justify-content:space-between;gap:14px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}
li span{color:var(--mut);font-weight:600}li b{text-align:right;font-weight:700;overflow-wrap:anywhere}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.gal{margin:14px -6px 4px;display:grid;gap:6px}.gal button{display:block;width:100%;height:auto;min-height:0;margin:0;font:inherit;color:inherit;border:0;padding:0;background:#e2e8f0;border-radius:14px;overflow:hidden;cursor:zoom-in;position:relative}.gal img{width:100%;height:100%;object-fit:cover;display:block}.gal .gm{aspect-ratio:16/10}.gt{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.gt button{aspect-ratio:4/3}.gt span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,17,32,.55);color:#fff;font-weight:900;font-size:18px}
.credit{font-size:11px;color:var(--mut);margin:2px 0 10px}.credit a{color:var(--mut);text-decoration:underline}
.air{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;background:linear-gradient(135deg,#ecfdf5,#eef2ff);border:1px solid rgba(4,120,87,.18);border-radius:16px;padding:12px 14px;margin:12px 0;font-size:14px;line-height:1.5}.air .am{font-size:12.5px;color:var(--mut)}
.h2{font-size:18px;font-weight:900;margin:20px 0 8px}.h2 .am{font-size:14px;color:var(--mut);font-weight:700}
.fac{display:flex;flex-wrap:wrap;gap:8px}.fac span{display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700}.fac i{font-style:normal;color:var(--mut);font-weight:600;font-size:12px}
.rooms{width:100%;border-collapse:collapse;font-size:14px}.rooms td{padding:9px 4px;border-bottom:1px solid var(--line)}.rooms td:last-child{text-align:right}
.rate{display:inline-block;margin:2px 0 12px;padding:6px 12px;border-radius:999px;background:#fff7e6;color:#92400e;font-size:14px;text-decoration:none}.rbig{font-size:15px;margin:6px 0 10px;color:#667085}.rbig b{font-size:30px;color:#111827}.rst{color:#f59e0b;letter-spacing:1px}.rn{margin-left:6px}.rv{margin:8px 0;padding:10px 12px;border-left:3px solid #f59e0b;background:#fffbf2;border-radius:8px;font-size:14px}.rv i{color:#667085;font-size:12px;font-style:normal}
.sum{font-size:15px;line-height:1.65;color:#1e293b}.own{margin-top:10px;font-size:14px;line-height:1.65;color:#334155;white-space:pre-line;background:#f8fafc;border-radius:12px;padding:12px}
.btn.wa{background:#25D366;color:#fff;border:0}
.addph{display:block;margin:14px 0 6px;padding:14px;border-radius:16px;border:1.5px dashed rgba(81,70,183,.35);background:#f5f3ff;color:#3730a3;font-size:14px;line-height:1.5}
.lb{position:fixed;inset:0;z-index:99;background:rgba(3,7,18,.93);display:flex;align-items:center;justify-content:center}.lb[hidden]{display:none}.lb img{max-width:94vw;max-height:86vh;border-radius:10px}.lb button{position:absolute;margin:0;padding:0;min-height:0;background:rgba(255,255,255,.14);color:#fff;border:0;width:46px;height:46px;border-radius:50%;font-size:26px;cursor:pointer}.lb .x{top:14px;right:14px}.lb .pv{left:10px}.lb .nx{right:10px}
.btn{display:inline-flex;align-items:center;height:42px;padding:0 16px;border-radius:13px;border:1px solid var(--line);background:#fff;font-weight:800;font-size:13px;color:var(--ink)}
.btn.pri{background:linear-gradient(135deg,var(--em),var(--em2));color:#fff;border:0}
h2{font-size:21px;font-weight:900;letter-spacing:-.2px}
.claim p{font-size:14px;line-height:1.6;color:#334155;margin-top:6px}
form{display:grid;gap:10px;margin-top:14px}
label{display:grid;gap:4px;font-size:12px;font-weight:700;color:var(--mut)}
input,select,textarea{font:inherit;font-size:15px;color:var(--ink);padding:12px;border-radius:12px;border:1px solid rgba(8,17,32,.15);background:#fff;width:100%}
button{height:48px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--em),var(--em2));color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer}
#msg{font-size:14px;font-weight:700}
.src{font-size:12px;color:var(--mut);margin-top:14px;line-height:1.5}
</style></head><body><div class="w">
<a class="brandbar" href="/">${brandTile('hotels')}Bina<span class="g">Smart</span><span class="zena">${suffix('hotels')}</span></a>
<div class="top"><a href="/hotels#all">← <span class="am">ሁሉም ማረፊያዎች</span> · All places to stay</a></div>
<div class="card">
<span class="kind"><span class="am">${k.am}</span> · ${esc(k.en)}</span>
<h1>${esc(p.name)}</h1>${p.nameAm ? '<div class="amn am">' + esc(p.nameAm) + '</div>' : ''}
${gal}${claimed ? '<span class="ok">✓ Owner confirmed · <span class="am">ባለቤቱ አረጋግጧል</span></span>' : ''}
${rateTop}${airBox}<ul>${facts}</ul>
${acts ? '<div class="acts">' + acts + '</div>' : ''}${extra}${rateBox}
<div class="acts"><a class="btn pri" href="${esc(map)}" target="_blank" rel="noopener">📍 Map · <span class="am">ካርታ</span></a><a class="btn" href="/ride?${esc(rideTo)}">🚕 Ride there · <span class="am">ይሂዱ</span></a><a class="btn" href="/airport">✈️ From Bole airport</a></div>
${p.unsure ? '<p class="src"><b>The map marks this place as a building or a restaurant, not as somewhere to stay.</b> Its name says it is one; call to check it takes guests.</p>' : ''}
<p class="src">${wd ? 'From Wikidata (CC0), <a href="https://www.wikidata.org/wiki/' + esc(p.ref.slice(9)) + '" rel="nofollow noopener" target="_blank">' + esc(p.ref.slice(9)) + '</a>' : 'From the city map (© OpenStreetMap contributors, ODbL)'}. This is where the place is and what the source says about it, not an official licence register, and BinaSmart cannot book it yet. Call before you go.</p>
</div>
<div class="card claim" id="claim">
<h2 class="am">${claimed ? 'ይህ የእርስዎ ሆቴል ነው?' : 'ይህ የእርስዎ ሆቴል ነው? በነጻ ይረከቡት'}</h2>
<p><b>Is this your ${esc(k.en.toLowerCase())}?</b> Claim this listing free. We call you to confirm, then you can fix the details, add photos and rooms, and take bookings direct with 0% commission.</p><p style="margin:10px 0 12px"><a href="?bini=hotel" style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#0f766e;color:#fff;font-weight:700;text-decoration:none">💬 ቢኒን ይጠይቁ · Ask Bini, any time</a> <span style="font-size:13px;opacity:.75">Bini takes your changes; our team approves them.</span></p>
<p class="am">ስምዎንና ስልክዎን ይተዉ፤ ደውለን እናረጋግጣለን። ከዚያ ፎቶ፣ ክፍሎችና ዋጋ ጨምረው እንግዶች በቀጥታ እንዲያስይዙ ያደርጋሉ፤ ኮሚሽን የለም።</p>
<form id="f"><input type="hidden" name="ref" value="${esc(p.ref)}">
<label>Your name · <span class="am">ስምዎ</span><input name="name" required minlength="2" maxlength="80" autocomplete="name"></label>
<label>Your role · <span class="am">ኃላፊነትዎ</span><select name="role"><option value="owner">Owner · ባለቤት</option><option value="manager">Manager · ሥራ አስኪያጅ</option><option value="staff">Staff · ሠራተኛ</option></select></label>
<label>Phone · <span class="am">ስልክ</span><input name="phone" required inputmode="tel" autocomplete="tel" placeholder="09… / +251…"></label>
<label>Anything we should know? (optional) · <span class="am">ማስታወሻ</span><textarea name="note" rows="3" maxlength="500"></textarea></label>
<button type="submit"><span class="am">ይረከቡ</span> · Claim this listing</button><div id="msg" role="status"></div></form>
</div></div>
<div id="lb" class="lb" hidden onclick="if(event.target===this)hbClose()"><button type="button" class="x" onclick="hbClose()" aria-label="Close">\u00d7</button><button type="button" class="pv" onclick="hbStep(-1)" aria-label="Previous">\u2039</button><img id="lbi" alt=""><button type="button" class="nx" onclick="hbStep(1)" aria-label="Next">\u203a</button></div>
<script>
var HP=${JSON.stringify(photos).replace(/</g, '\\u003c')},hi=0;function hbOpen(i){if(!HP.length)return;hi=i;document.getElementById('lbi').src=HP[i];document.getElementById('lb').hidden=false}function hbClose(){document.getElementById('lb').hidden=true}function hbStep(s){hi=(hi+s+HP.length)%HP.length;document.getElementById('lbi').src=HP[hi]}
document.addEventListener('keydown',function(e){if(document.getElementById('lb').hidden)return;if(e.key==='Escape')hbClose();if(e.key==='ArrowRight')hbStep(1);if(e.key==='ArrowLeft')hbStep(-1)});
function ownText(){fetch('/api/hotel-text/${esc(p.slug)}').then(function(r){return r.json()}).then(function(d){var o=document.getElementById('own');o.textContent=(d.text||'')+(d.source?' \u2014 from '+d.source:'');o.hidden=false;document.getElementById('ownb').hidden=true})}
</script>
<script>
document.getElementById('f').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target, m = document.getElementById('msg'), b = f.querySelector('button');
  b.disabled = true; m.textContent = '…';
  try {
    const r = await fetch('/api/hotels/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const d = await r.json();
    if (d.ok) { f.innerHTML = '<p style="font-weight:800;color:#047857">✓ ተቀብለናል · Received. We will call you on the number you gave to confirm.</p>'; return; }
    m.textContent = ({ phone: 'Please check the phone number · ስልኩን ያረጋግጡ', name: 'Please write your name · ስምዎን ይጻፉ', slow_down: 'Too many tries, please wait an hour.' })[d.error] || 'Could not send. Please try again.';
  } catch (x) { m.textContent = 'Could not send. Please try again.'; }
  b.disabled = false;
});
</script><script src="/static/bina-assistant.js?v=14" defer></script><script src="/static/bina-footer.js?v=11" defer></script></body></html>`;
}

module.exports = function hotelDirectory(fastify, { prisma, limiter, tell }, done) {
  const tellTeam = tell || tellOwner;   // tests and rehearsals pass their own: no real Telegram
  let cache = { mtime: 0, list: [], bySlug: new Map(), byRef: new Map() };
  function load() {
    let st; try { st = fs.statSync(FILE); } catch (e) { return cache; }
    let wdm = 0; try { wdm = fs.statSync(WD_FILE).mtimeMs; } catch (e) { /* optional */ }
    try { wdm += fs.statSync(HIDDEN_FILE).mtimeMs; } catch (e) { /* optional */ }
    if (st.mtimeMs + wdm === cache.mtime) return cache;
    try {
      let wd = []; try { wd = JSON.parse(fs.readFileSync(WD_FILE, 'utf8')).hotels || []; } catch (e) { /* optional */ }
      let hidden = []; try { hidden = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8')); } catch (e) { /* optional */ }
      const list = buildDirectory(JSON.parse(fs.readFileSync(FILE, 'utf8')), wd).filter(p => !hidden.includes(p.ref));
      cache = { mtime: st.mtimeMs + wdm, list, bySlug: new Map(list.map(p => [p.slug, p])), byRef: new Map(list.map(p => [p.ref, p])) };
    } catch (e) { fastify.log.error('hotel directory: ' + e.message); }
    return cache;
  }
  // server.js's sitemap lists the hotel pages that are indexable (findable) from this same list.
  module.exports.findableList = () => load().list.filter(findable);
  module.exports.list = () => load().list;
  let claimed = { at: 0, set: new Set() };
  async function approved() {
    if (Date.now() - claimed.at < 60000) return claimed.set;
    const rows = await prisma.hotelClaim.findMany({ where: { status: 'approved' }, select: { placeRef: true } }).catch(() => []);
    claimed = { at: Date.now(), set: new Set(rows.map(r => r.placeRef)) };
    return claimed.set;
  }
  // guest ratings per place (average and count), from BinaSmart rides that ended there; refreshed every 5 minutes
  let rates = { at: 0, map: new Map() };
  async function ratings() {
    if (Date.now() - rates.at < 300000) return rates.map;
    const rows = await prisma.placeReview.groupBy({ by: ['placeRef'], _avg: { stars: true }, _count: { _all: true } }).catch(() => null);
    if (rows) rates = { at: Date.now(), map: new Map(rows.map(r => [r.placeRef, { avg: Math.round(r._avg.stars * 10) / 10, count: r._count._all }])) };
    return rates.map;
  }
  async function ratingFor(ref) {
    const x = (await ratings()).get(ref); if (!x) return null;
    const reviews = await prisma.placeReview.findMany({ where: { placeRef: ref, textStatus: 'published' }, orderBy: { createdAt: 'desc' }, take: 5, select: { stars: true, text: true, createdAt: true } }).catch(() => []);
    return Object.assign({}, x, { reviews });
  }

  // one place as the list page, the map and the server-drawn cards see it
  const placeOut = (p, ok, rm) => ({ slug: p.slug, name: p.name, nameAm: p.nameAm, kind: p.kind, sub: p.sub, subAm: p.subAm,
        stars: p.stars || dOf(p).starsClaim || undefined, phone: p.phones.length > 0 || !!(dOf(p).contacts && dOf(p).contacts.phone), website: !!siteOf(p), unsure: p.unsure || undefined, claimed: ok.has(p.ref),
        photo: dOf(p).card || null, photos: (dOf(p).photos || []).length, lat: p.lat, lng: p.lng, air: dOf(p).airport ? { km: dOf(p).airport.km, min: dOf(p).airport.min, fare: dOf(p).airport.fareFrom } : null,
        fac: (dOf(p).facilities || []).filter(x => FAC[x]).slice(0, 8), from: (roomMin(dOf(p).rooms || []) || {}).price || null,
        rating: rm && rm.get(p.ref) ? { avg: rm.get(p.ref).avg, n: rm.get(p.ref).count } : undefined });
  module.exports.cardPlaces = async () => { const { list } = load(), ok = await approved(), rm = await ratings(); return list.map(p => placeOut(p, ok, rm)); };
  fastify.get('/api/hotels/directory', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=600');
    const { list } = load(), ok = await approved(), rm = await ratings();
    return { count: list.length, source: 'OpenStreetMap contributors (ODbL)', kinds: KINDS,
      places: list.map(p => placeOut(p, ok, rm)) };
  });

  // Bini's search_hotels tool (assistant/tools.js): the directory by area, kind and stars. The city map has no prices,
  // so none are given - the hotel's own phone or website is how a guest gets one.
  // A hotel's own photo, sent through Bini on its page. Kept private until the team approves it; no AI sees it.
  const PEND = '/root/storage/hotels/pending', PJSON = '/root/storage/hotels/pending.json', photoRL = limiter(3600000, 12);
  const pend = () => { try { return JSON.parse(fs.readFileSync(PJSON, 'utf8')); } catch (e) { return []; } };
  const PY = (script, args) => require('child_process').execFileSync('python3', [path.join(__dirname, '..', 'ops', 'places', script)].concat(args), { timeout: 60000, stdio: 'pipe' }).toString().trim();
  fastify.post('/api/hotels/photo', { bodyLimit: 9 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body || {}, ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!photoRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const p = load().bySlug.get(String(b.slug || '')); if (!p) return reply.code(404).send({ ok: false, error: 'hotel' });
    const buf = Buffer.from(String(b.image || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (buf.length < 20000) return reply.code(400).send({ ok: false, error: 'too_small' });
    if (buf.length > 7 * 1024 * 1024) return reply.code(413).send({ ok: false, error: 'too_large' });
    fs.mkdirSync(PEND, { recursive: true });
    const id = crypto.randomBytes(8).toString('hex'), file = path.join(PEND, id + '.img');
    fs.writeFileSync(file, buf);
    const [w, h] = PY('img-size.py', [file]).split(/\s+/).map(Number);
    if (w < 800 || h < 450) { fs.unlinkSync(file); return reply.code(400).send({ ok: false, error: 'too_small' }); }
    const token = crypto.randomBytes(16).toString('hex'), list = pend();
    list.push({ id, ref: p.ref, slug: p.slug, name: p.name, file, w, h, note: clean(b.note, 200), at: new Date().toISOString(), token });
    fs.writeFileSync(PJSON, JSON.stringify(list));
    const base = 'https://bina.et/ops/hotel-photos/' + id + '/';
    await tellTeam('\u{1F4F7} <b>Hotel photo sent through Bini</b> · ' + esc(p.name) + (p.sub ? ' (' + esc(p.sub) + ')' : '') + ' · ' + w + '×' + h + (b.note ? '\n\u{1F4DD} ' + esc(clean(b.note, 200)) : '')
      + '\n\nCheck it shows this hotel before approving.\n<a href="' + base + 'view?t=' + token + '">\u{1F441} view</a> · <a href="' + base + 'approve?t=' + token + '">✅ approve</a> · <a href="' + base + 'reject?t=' + token + '">❌ reject</a> · <a href="https://bina.et/hotels/' + p.slug + '">page</a>');
    return { ok: true };
  });
  fastify.get('/ops/hotel-photos/:id/:action', async (req, reply) => {
    const list = pend(), i = list.findIndex(x => x.id === String(req.params.id)), x = list[i];
    const t = Buffer.from(String(req.query.t || '')), want = Buffer.from(x ? x.token : '');
    if (!x || t.length !== want.length || !crypto.timingSafeEqual(t, want)) return reply.code(404).send('not found');
    const act = req.params.action;
    if (act === 'view') return reply.header('X-Robots-Tag', 'noindex').type('image/jpeg').send(fs.readFileSync(x.file));
    if (act === 'reject') { try { fs.unlinkSync(x.file); } catch (e) {} list.splice(i, 1); fs.writeFileSync(PJSON, JSON.stringify(list)); return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">❌ Rejected: photo for ' + esc(x.name) + '.</p>'); }
    if (act !== 'approve') return reply.code(400).send('view, approve or reject');
    const dir = path.join(__dirname, '..', 'public', 'hotels', 'img'), map = ownerMap(), have = (map[x.ref] || []).length, n = have + 1;
    const g = x.slug + '-o' + n + '.webp', c = x.slug + '-oc.webp';
    PY('property-img.py', ['gallery', x.file, path.join(dir, g)]);
    if (!have) PY('property-img.py', ['photo', x.file, path.join(dir, c)]);
    const v = '?v=' + Math.floor(Date.now() / 1000), all = Object.assign({}, map);
    all[x.ref] = (all[x.ref] || []).concat([{ url: 'https://bina.et/static/hotels/img/' + g + v, card: have ? undefined : 'https://bina.et/static/hotels/img/' + c + v, at: new Date().toISOString() }]);
    fs.writeFileSync(OWNER, JSON.stringify(all)); try { fs.unlinkSync(x.file); } catch (e) {} list.splice(i, 1); fs.writeFileSync(PJSON, JSON.stringify(list));
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">✅ Approved: the photo now leads the gallery of <a href="/hotels/' + esc(x.slug) + '">' + esc(x.name) + '</a>.</p>');
  });
  fastify.get('/api/hotel-text/:slug', async (req, reply) => {
    const p = load().bySlug.get(String(req.params.slug)); const d = p ? dOf(p) : {};
    reply.header('X-Robots-Tag', 'noindex');
    return { text: d.ownText || '', source: d.ownText ? siteOf(p) : null };
  });
  fastify.get('/api/hotels/search', async (req) => {
    const q = req.query || {}, sq = v => String(v || '').toLowerCase().replace(/\s+/g, '');
    let list = load().list.filter(p => !p.unsure);
    if (q.area) { const a = sq(q.area); list = list.filter(p => [p.sub, p.subAm, p.street, p.name, p.nameAm].some(x => x && sq(x).includes(a))); }
    if (q.kind && KINDS[q.kind]) list = list.filter(p => p.kind === q.kind);
    if (Number(q.minStars) > 0) list = list.filter(p => (p.stars || 0) >= Number(q.minStars));
    if (q.q) { const w = sq(q.q); list = list.filter(p => sq(p.name + ' ' + (p.nameAm || '')).includes(w)); }
    const reach = p => (p.phones.length || siteOf(p) ? 1 : 0);   // a hotel you can call or open comes first, then stars
    list = list.slice().sort((a, b) => reach(b) - reach(a) || (b.stars || 0) - (a.stars || 0));
    const ok = await approved(), rm = await ratings(), limit = Math.min(Math.max(Number(q.limit) || 6, 1), 10);
    return { total: list.length, results: list.slice(0, limit).map(p => ({ name: p.name, nameAm: p.nameAm || null, kind: (KINDS[p.kind] || {}).en || p.kind,
      area: p.sub || null, stars: p.stars || null, phone: p.phones[0] || null, website: siteOf(p), confirmedByHotel: ok.has(p.ref),
      guestRating: rm.get(p.ref) ? rm.get(p.ref).avg + '/5 from ' + rm.get(p.ref).count + ' BinaSmart rider rating(s)' : null,
      roomsFrom: (roomMin(dOf(p).rooms || []) || {}).price || null, roomPrices: dOf(p).roomsFrom === 'hotel' ? 'given by the hotel on ' + dOf(p).roomsDate : (dOf(p).rooms || []).length ? 'from the hotel website' : null,
      photos: (dOf(p).photos || []).length, facilities: (dOf(p).facilities || []).filter(x => FAC[x]).map(x => FAC[x][1]), fromBoleAirport: dOf(p).airport ? dOf(p).airport.km + ' km, about ' + dOf(p).airport.min + ' min, BinaSmart ride from ' + dOf(p).airport.fareFrom + ' birr' : null,
      link: 'https://bina.et/hotels/' + p.slug, map: 'https://www.google.com/maps?q=' + p.lat + ',' + p.lng })) };
  });
  fastify.get('/hotels/:slug', async (req, reply) => {
    const p = load().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).type('text/html').send('<!DOCTYPE html><meta name="robots" content="noindex"><p style="font-family:system-ui;padding:60px;text-align:center">Not found. <a href="/hotels#all">All places to stay in Addis →</a></p>');
    if (!findable(p)) reply.header('X-Robots-Tag', 'noindex, follow');
    return reply.type('text/html; charset=utf-8').send(page(p, (await approved()).has(p.ref), await ratingFor(p.ref)));
  });

  const ipRL = limiter(3600000, 5);
  fastify.post('/api/hotels/claim', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    if (!ipRL(String(req.headers['x-real-ip'] || req.ip || ''))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const isNew = b.ref === 'new', hotel = clean(b.hotel, 120), area = clean(b.area, 80);
    if (isNew && hotel.length < 2) return reply.code(400).send({ ok: false, error: 'hotel' });
    const p = isNew ? { ref: 'new:' + (kebab(hotel) || 'hotel'), name: hotel, slug: '', kind: kindFromName(hotel), sub: area, phones: [] } : load().byRef.get(String(b.ref || ''));
    if (!p) return reply.code(404).send({ ok: false, error: 'place' });
    const name = clean(b.name, 80), role = ['owner', 'manager', 'staff'].includes(b.role) ? b.role : 'owner', note = clean(b.note, 500);
    const digits = String(b.phone || '').replace(/[^\d+]/g, '');
    if (name.length < 2) return reply.code(400).send({ ok: false, error: 'name' });
    if (!/^\+?\d{9,15}$/.test(digits)) return reply.code(400).send({ ok: false, error: 'phone' });
    const rooms = cleanRooms(b.rooms);
    const dup = await prisma.hotelClaim.findFirst({ where: { placeRef: p.ref, phone: digits, status: 'pending' } });
    if (dup) {
      // the same person again while the first request waits: new room prices replace the waiting ones
      if (rooms.length) {
        // the same prices again (Bini re-sends on "yes, send it") is not news for the team (1 Oct 2026 rehearsal)
        const m = readJson(CLAIM_ROOMS), same = !!m[dup.id] && JSON.stringify(m[dup.id].rooms) === JSON.stringify(rooms);
        m[dup.id] = { ref: p.ref, rooms, at: new Date().toISOString() }; writeJson(CLAIM_ROOMS, m);
        const base = 'https://bina.et/ops/hotel-claims/' + dup.id + '/';
        if (!same) await tellTeam('\u{1F6CF} <b>New room prices</b> for a waiting claim: ' + esc(p.name) + ' (' + esc(dup.name) + ', ' + esc(digits) + ')' + roomsLine(rooms)
          + '\n\n<a href="' + base + 'approve?t=' + dup.token + '">\u2705 approve</a> \u00b7 <a href="' + base + 'reject?t=' + dup.token + '">\u274c reject</a>');
      }
      return { ok: true };
    }
    const c = await prisma.hotelClaim.create({ data: { placeRef: p.ref, placeName: p.name, slug: p.slug, name, role, phone: digits, note: note || null,
      token: crypto.randomBytes(16).toString('hex') } });
    if (rooms.length) { const m = readJson(CLAIM_ROOMS); m[c.id] = { ref: p.ref, rooms, at: new Date().toISOString() }; writeJson(CLAIM_ROOMS, m); }
    const base = 'https://bina.et/ops/hotel-claims/' + c.id + '/';
    await tellTeam((isNew ? '🆕 <b>Hotel NOT in the list</b> (add it by hand after the call) · ' : '🏨 <b>Hotel claim</b> · ') + esc(p.name) + ' (' + esc(KINDS[p.kind].en) + (p.sub ? ', ' + esc(p.sub) : '') + ')\n'
      + '👤 ' + esc(name) + ' — ' + role + '\n📞 ' + esc(digits) + (p.phones.length ? '\n☎ map says: ' + esc(p.phones.join(', ')) : '') + (note ? '\n📝 ' + esc(note) : '')
      + roomsLine(rooms) + '\n\nCall before approving.\n' + (isNew ? '' : '<a href="https://bina.et/hotels/' + p.slug + '">listing</a> · ') + '<a href="' + base + 'approve?t=' + c.token + '">✅ approve</a> · <a href="' + base + 'reject?t=' + c.token + '">❌ reject</a>');
    return { ok: true };
  });

  fastify.get('/ops/hotel-claims/:id/:action', async (req, reply) => {
    const c = await prisma.hotelClaim.findUnique({ where: { id: String(req.params.id) } });
    const t = Buffer.from(String(req.query.t || '')), want = Buffer.from(c ? c.token : '');
    if (!c || t.length !== want.length || !crypto.timingSafeEqual(t, want)) return reply.code(404).send('not found');
    const action = req.params.action;
    if (!['approve', 'reject'].includes(action)) return reply.code(400).send('approve or reject');
    // The links stay valid after a decision (1 Oct 2026 rehearsal): a second approve does nothing, and a reject after an
    // approve takes back the prices that approve put on the page; before, the claim said "rejected" with the prices live.
    if (action === 'approve' && c.status === 'approved') return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">Already approved: ' + esc(c.placeName) + '</p>');
    await prisma.hotelClaim.update({ where: { id: c.id }, data: { status: action === 'approve' ? 'approved' : 'rejected', decidedAt: new Date() } });
    claimed.at = 0;
    // approved with room prices: they go on the page now (a hotel not on the map yet has no page to put them on)
    const cr = action === 'approve' ? readJson(CLAIM_ROOMS)[c.id] : null;
    if (cr && cr.rooms && cr.rooms.length && !String(c.placeRef).startsWith('new:')) {
      const m = readJson(OWNER_ROOMS); m[c.placeRef] = { rooms: cr.rooms, date: new Date().toISOString().slice(0, 10), claimId: c.id }; writeJson(OWNER_ROOMS, m);
    }
    if (action === 'reject') { const m = readJson(OWNER_ROOMS); if (m[c.placeRef] && m[c.placeRef].claimId === c.id) { delete m[c.placeRef]; writeJson(OWNER_ROOMS, m); } }
    return reply.type('text/html; charset=utf-8').send('<p style="font-family:system-ui;padding:40px">' + (action === 'approve' ? '✅ Approved' : '❌ Rejected') + ': ' + esc(c.placeName) + ' — ' + esc(c.name) + '. ' + (c.slug ? '<a href="/hotels/' + esc(c.slug) + '">listing</a>' : 'Not on the map yet: add it by hand.') + '</p>');
  });
  done();
};
module.exports.buildDirectory = buildDirectory;
module.exports.cleanRooms = cleanRooms;
module.exports.roomMin = roomMin;
module.exports.landlines = landlines;
module.exports.rentsByName = rentsByName;
