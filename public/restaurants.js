/* BinaSmart Restaurants pages (1 Oct 2026): scroll reveal, and the hub's search, kind filter and "show all"
   (the same behaviour as the Health directory, public/health.js). No form here: a restaurant claims its page
   through Bini (?bini=restaurant), and nothing shows until the team has called. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' }) : null;
  function watch(root) { $$('.rv:not(.in)', root).forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); }); }
  watch();

  var KI = { restaurant: ['🍽️', 'Restaurant', 'ምግብ ቤት'], cafe: ['☕', 'Café', 'ካፌ'], fast_food: ['🍔', 'Fast food', 'ፈጣን ምግብ'] };
  function card(f) {
    var K = KI[f.kind] || KI.restaurant, cu = f.cuisine || [];
    return '<a class="fc rv" href="/restaurants/' + esc(f.slug) + '" data-k="' + esc(f.kind) + '" data-q="' + esc((f.name + ' ' + (f.nameAm || '') + ' ' + (f.sub || '') + ' ' + K[1] + ' ' + cu.join(' ')).toLowerCase()) + '">'
      + '<span class="ki">' + K[0] + '</span><span class="tx"><b>' + esc(f.name) + '</b>' + (f.nameAm ? '<small class="am">' + esc(f.nameAm) + '</small>' : '')
      + '<em>' + K[0] + ' ' + K[1] + ' · <span class="am">' + K[2] + '</span>' + (f.sub ? ' · ' + esc(f.sub) : '') + '</em>' + (cu.length ? '<i class="sv">' + esc(cu.slice(0, 3).join(' · ')) + '</i>' : '')
      + '<span class="bd">' + (f.confirmed ? '<u class="ok">✓ Confirmed</u>' : '') + (f.phone ? '<u>☎️ Phone</u>' : '') + (f.dishes ? '<u>🍲 Dishes</u>' : '') + '</span></span></a>';
  }
  var DIR = null, wait = null;
  function dir() { if (DIR) return Promise.resolve(DIR); if (!wait) wait = fetch('/api/restaurants/directory').then(function (r) { return r.json(); }).then(function (d) { DIR = d; return d; }); return wait; }

  var fg = $('#fg'), hq = $('#hq'), more = $('#more'), kind = '', all = false;
  function loadAll() {
    if (all || !fg || !more) return Promise.resolve();
    all = true; more.hidden = true;
    return dir().then(function (d) { fg.innerHTML = d.places.map(card).join(''); watch(fg); });
  }
  function apply() {
    var q = (hq && hq.value || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), shown = 0;
    $$('#fg .fc').forEach(function (el) {
      var ok = (!kind || el.getAttribute('data-k') === kind) && words.every(function (w) { return (el.getAttribute('data-q') || '').indexOf(w) >= 0; });
      el.hidden = !ok; if (ok) { shown++; el.classList.add('in'); }
    });
    var none = $('#none'); if (none) none.hidden = shown > 0;
  }
  if (fg && more) {
    $$('#hk button').forEach(function (b) { b.addEventListener('click', function () {
      $$('#hk button').forEach(function (x) { x.classList.toggle('on', x === b); }); kind = b.getAttribute('data-k') || ''; loadAll().then(apply); apply(); }); });
    var t; if (hq) hq.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { loadAll().then(apply); apply(); }, 160); });
    more.addEventListener('click', function () { loadAll().then(apply); });
    var q0 = new URLSearchParams(location.search).get('q'); if (q0 && hq) { hq.value = q0; loadAll().then(apply); }
  }
})();
