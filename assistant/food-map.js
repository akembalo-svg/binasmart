'use strict';
// Food places from the city map (OpenStreetMap contributors), for when the BinaSmart directory has no shop for a
// food question. 30 Sep 2026: the directory had no live restaurant and one cafe, so "cheap restaurant near Piassa"
// was answered "none" over a map with thousands. Used by Bini's search_shops, by GET /api/places/food and, through
// that endpoint, by the MCP server's search_places: one rule on all three surfaces.
// Food with no directory hit (30 Sep 2026): the directory had no live restaurant and one cafe, so "cheap restaurant near
// Piassa" and "lunch near Megenagna" were answered "none" over a city map with thousands. A known dish or cuisine word
// filters by name; any other word ("cheap", "good") is dropped, because the map has no prices or ratings to test it on.
const FOOD_RE = /restaurant|cafe|café|coffee|\bfood|\beat\b|lunch|dinner|breakfast|pizza|burger|kitfo|tibs|ምግብ|ምሳ|እራት|ቁርስ|ካፌ|ሬስቶራንት|ቡና ቤት|ክትፎ|ጥብስ|ልብላ|እንብላ/i;
const DISH_WORDS = [['pizza', 'pizza', 'ፒዛ'], ['burger', 'burger', 'በርገር'], ['kitfo', 'kitfo', 'ክትፎ'], ['tibs', 'tibs', 'ጥብስ'], ['pasta', 'pasta', 'ፓስታ'],
  ['fish', 'fish', 'አሳ'], ['chicken', 'chicken', 'ዶሮ'], ['shiro', 'shiro', 'ሽሮ'], ['juice', 'juice', 'ጭማቂ'], ['cake', 'cake', 'ኬክ'], ['pastry', 'pastry', 'ፓስትሪ'],
  ['bakery', 'bakery', 'ዳቦ ቤት'], ['chinese', 'chinese', 'ቻይና'], ['indian', 'indian', 'ህንድ'], ['italian', 'italian', 'ጣሊያን'], ['arab', 'arab', 'ዓረብ'],
  ['shawarma', 'shawarma', 'ሻዋርማ'], ['cultural', 'cultural', 'ባህላዊ'], ['traditional', 'traditional', 'ባህላዊ'], ['gurage', 'gurage', 'ጉራጌ']];
// The sub-cities, as AREA_GROUPS names them (lower case): these filter by sub-city; any other area becomes a point.
const SUBCITY = /^(bole|kirkos|arada|yeka|gulele|lideta|addis ketema|akaki|kality|kaliti|akaki kality|kolfe|kolfe keranio|nifas silk|nifas silk-lafto|lemi kura)$/i;
const NOTE = 'From the city map (OpenStreetMap contributors), not the BinaSmart directory: names, area, distance, map and ride links only. '
  + 'No phone, opening hours, prices, menus or ratings unless a place has confirmed: true (its own number and hours): otherwise say so, never guess them, and never call these places BinaSmart partners. Name 3 to 5 of them with their distance, and give each one\'s page link when it has one.';

async function findFood(term, category, { gazetteer, fetchImpl, base = 'https://bina.et' } = {}) {
  const G = gazetteer || require('../ride/gazetteer').shared();
  const { AREA_GROUPS, squash } = require('./areas');
  const k = squash(term), g = AREA_GROUPS.find(x => x.some(v => k.includes(squash(v))));
  const dish = DISH_WORDS.find(([, en, am]) => new RegExp('\\b' + en + '|' + am, 'i').test(term));
  if (!g && !dish) return { places: [] };   // "a good restaurant in Addis": ask where, as before
  const opt = { kinds: category === 'CAFE' ? ['cafe'] : ['restaurant', 'fast food'], words: dish ? [dish[0]] : [], limit: 6 };
  let near = null;
  if (g) {
    if (SUBCITY.test(g[0])) opt.sub = g[0];
    else { const p = await require('./health-args').locate(g[0], fetchImpl || globalThis.fetch); if (p) { opt.lat = +p.lat; opt.lng = +p.lng; near = p.label || p.name || g[0]; } else opt.sub = null; }
  }
  if (opt.lat == null && !opt.sub && !dish) return { places: [] };   // the area could not be placed: no city-wide list
  let hits = G.around(opt), unmatched = null;
  // A restaurant question gets restaurants first: near Piassa the list was one restaurant and five cafes, and the
  // model named the one (30 Sep 2026). Cafes fill in only when fewer than three restaurants are near.
  if (category !== 'CAFE' && hits.length < 3) { const more = G.around(Object.assign({}, opt, { kinds: ['cafe'], limit: 6 - hits.length })); hits = hits.concat(more); }
  if (!hits.length && dish && (opt.lat != null || opt.sub)) { hits = G.around(Object.assign({}, opt, { words: [] })); unmatched = dish[0]; }
  // each place's own page on bina.et/restaurants when it has one (1 Oct 2026); none in tests or scripts without the map
  // and, for a restaurant that has claimed its page, the number it chose to show
  let pageOf = () => null, own = () => null;
  try {
    const R = require('../restaurants/directory');
    pageOf = ref => (ref ? R.pageUrl(ref) : null);
    own = ref => { const p = ref && R.places().byRef.get(ref); if (!p) return null; const f = R.placeOut(p); return f.confirmed ? { phone: f.phones[0] || undefined, hours: f.hours || undefined } : null; };
  } catch (e) { /* no directory here */ }
  return { near, unmatched: hits.length ? unmatched : null, places: hits.map(h => ({ name: h.label, nameAm: h.labelAm || null, kind: h.kind, area: h.sub || null, page: pageOf(h.ref) || undefined, confirmed: own(h.ref) ? true : undefined, phone: (own(h.ref) || {}).phone, hours: (own(h.ref) || {}).hours,
    distanceKm: h.m != null ? +(h.m / 1000).toFixed(1) : null, lat: h.lat, lng: h.lng,
    map: 'https://www.openstreetmap.org/?mlat=' + h.lat + '&mlon=' + h.lng + '#map=18/' + h.lat + '/' + h.lng,
    ride: base + '/ride?to=' + encodeURIComponent(h.label) + '&lat=' + h.lat + '&lng=' + h.lng })) };
}

module.exports = { FOOD_RE, DISH_WORDS, findFood, NOTE };
