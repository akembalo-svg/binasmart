/* One hotel card for /hotels, drawn the same way in the browser and on the server (hotels/directory.js). */
(function (root) {
  var FAC = { wifi: ['\uD83D\uDCF6', 'Wi-Fi'], pool: ['\uD83C\uDFCA', 'Pool'], spa: ['\uD83D\uDC86', 'Spa'], gym: ['\uD83C\uDFCB\uFE0F', 'Gym'], restaurant: ['\uD83C\uDF7D\uFE0F', 'Restaurant'],
    bar: ['\uD83C\uDF78', 'Bar'], parking: ['\uD83C\uDD7F\uFE0F', 'Parking'], airport: ['\u2708\uFE0F', 'Airport shuttle'], meeting: ['\uD83C\uDFA4', 'Meeting rooms'], breakfast: ['\uD83E\uDD50', 'Breakfast'],
    laundry: ['\uD83E\uDDFA', 'Laundry'], roomservice: ['\uD83D\uDECE\uFE0F', 'Room service'], reception24: ['\uD83D\uDD50', '24h reception'], aircon: ['\u2744\uFE0F', 'Air conditioning'], elevator: ['\uD83D\uDED7', 'Elevator'], garden: ['\uD83C\uDF33', 'Garden'] };
  var KIND = { hotel: ['Hotel', '\u1206\u1274\u120d', '\uD83C\uDFE8'], guest_house: ['Guest house', '\u12e8\u12a5\u1295\u130d\u12f3 \u121b\u1228\u134a\u12eb', '\uD83C\uDFE0'], apartment: ['Apartment', '\u12a0\u1353\u122d\u1275\u1218\u1295\u1275', '\uD83C\uDFE2'],
    hostel: ['Hostel', '\u1206\u1235\u1274\u120d', '\uD83D\uDECF\uFE0F'], motel: ['Motel', '\u121e\u1274\u120d', '\uD83D\uDE97'] };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stars(n) { n = +n || 0; return n ? '<span class="st" aria-label="' + n + ' stars">' + new Array(n + 1).join('\u2605') + '</span>' : ''; }
  // recommended order: photos, then a way to reach the place, then stars, then closer to the airport
  function score(p) { return (p.photos ? 4 : 0) + (p.phone || p.website ? 2 : 0) + (p.claimed ? 3 : 0) + (+p.stars || 0) * 0.6 - (p.air ? p.air.km / 50 : 0.5) + (p.rating ? (p.rating.avg - 3) + Math.min(p.rating.n, 10) * 0.2 : 0); }
  function sortHotels(l, how) {
    l = l.slice();
    if (how === 'air') return l.sort(function (a, b) { return (a.air ? a.air.km : 99) - (b.air ? b.air.km : 99); });
    if (how === 'stars') return l.sort(function (a, b) { return (+b.stars || 0) - (+a.stars || 0) || score(b) - score(a); });
    // top rated: the average from BinaSmart riders, then how many rated, then the usual order
    if (how === 'rating') return l.sort(function (a, b) { return (b.rating ? b.rating.avg : 0) - (a.rating ? a.rating.avg : 0) || (b.rating ? b.rating.n : 0) - (a.rating ? a.rating.n : 0) || score(b) - score(a); });
    if (how === 'name') return l.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return l.sort(function (a, b) { return score(b) - score(a) || String(a.name).localeCompare(String(b.name)); });
  }
  function hotelCard(p) {
    var k = KIND[p.kind] || KIND.hotel, href = '/hotels/' + encodeURIComponent(p.slug);
    var ph = p.photo ? '<div class="ph" style="background-image:url(\'' + esc(String(p.photo).replace(/[()'"\\]/g, '')) + '\')">' : '<div class="ph np"><span class="ic">' + k[2] + '</span>';
    ph += '<span class="kb">' + esc(k[0]) + ' \u00b7 <span class="am">' + k[1] + '</span></span>' + (p.claimed ? '<span class="okb">\u2713 Owner confirmed</span>' : '') + (p.photos > 1 ? '<span class="pc">\uD83D\uDCF7 ' + p.photos + '</span>' : '') + '</div>';
    var fac = (p.fac || []).filter(function (x) { return FAC[x]; }).slice(0, 5).map(function (x) { return '<i title="' + FAC[x][1] + '">' + FAC[x][0] + '</i>'; }).join('');
    var tags = [p.phone ? '\uD83D\uDCDE Phone' : '', p.website ? '\uD83C\uDF10 Website' : ''].filter(Boolean).join(' \u00b7 ');
    return '<a class="hc" id="h-' + esc(p.slug) + '" href="' + href + '">' + ph + '<div class="bd"><h3>' + esc(p.name) + '</h3>' + (p.nameAm ? '<div class="an am">' + esc(p.nameAm) + '</div>' : '')
      + '<div class="m">' + (p.rating ? '<span class="rt" title="Rated by BinaSmart riders">\u2605 ' + (+p.rating.avg).toFixed(1) + ' <small>(' + (+p.rating.n) + ')</small></span> ' : '') + stars(p.stars) + (p.stars && p.sub ? ' \u00b7 ' : '') + esc(p.sub || '') + (p.subAm ? ' <span class="am">' + esc(p.subAm) + '</span>' : '') + '</div>'
      + (p.air ? '<div class="air">\u2708\uFE0F ' + p.air.km + ' km \u00b7 ' + p.air.min + ' min from Bole airport' + (p.air.fare ? ' \u00b7 ride <b>' + p.air.fare + ' birr</b>' : '') + '</div>' : '')
      + (fac ? '<div class="fc">' + fac + '</div>' : '') + (p.from ? '<div class="fr">Rooms from <b>' + esc(p.from) + '</b></div>' : '')
      + (tags ? '<div class="tg">' + tags + '</div>' : '') + '</div></a>';
  }
  var api = { hotelCard: hotelCard, sortHotels: sortHotels, FAC: FAC, KIND: KIND, esc: esc };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BinaHotels = api;
})(this);
