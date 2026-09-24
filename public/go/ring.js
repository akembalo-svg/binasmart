/* Bina · ቢና start page: every service on one turning glass ring. */
(function () {
  'use strict';
  var stage = document.getElementById('stage'), ring = document.getElementById('ring');
  if (!stage || !ring) return;

  var P = {
    pool: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M3.5 19c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5M11.5 19c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5"/>',
    plane: '<path d="M10.5 20l1.5-6-6.5-3V9l7 1.5L16 4.5a1.5 1.5 0 0 1 2.5 1.5L16 11.5l1.5 7-2 1-3-5.5-2 1 .5 5z"/>',
    gate: '<path d="M4 20V8l8-4 8 4v12"/><path d="M8 20v-6h8v6M8 10.5h8"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.8"/>',
    film: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
    play: '<rect x="3" y="5" width="18" height="13" rx="2.5"/><path d="M10.5 9v5l4-2.5z"/><path d="M8 21h8"/>',
    bag: '<rect x="3" y="7" width="18" height="12.5" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h6M9 19h3"/>',
    news: '<path d="M4 5h12v13a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M16 9h4v9a2 2 0 0 1-4 0M7.5 9h5M7.5 12.5h5M7.5 16h3"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.5 1.7-2.2 3-2.2s2.4.7 3 2.2M14 10h4M14 13.5h3"/>',
    heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/><path d="M8.5 12.5h2l1-2 1.5 4 1-2h1.5"/>',
    scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="M5 7l-2.5 6a2.8 2.8 0 0 0 5 0zM19 7l-2.5 6a2.8 2.8 0 0 0 5 0z"/>',
    basket: '<path d="M4 10h16l-1.6 9H5.6z"/><path d="M8 10l2.5-5M16 10l-2.5-5M9.5 14v2.5M14.5 14v2.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5z"/>',
    shield: '<path d="M12 3.5l7 3v5.2c0 4.3-3 7.4-7 8.8-4-1.4-7-4.5-7-8.8V6.5z"/><path d="M9 12l2 2 4-4"/>'
  };
  // [Amharic, English, one line, path, icon, colour]
  var S = [
    ['ቢናፑል', 'BinaPool', 'Share your daily commute', '/pool', 'pool', '#00A884'],
    ['በረራ', 'Flights', 'Find and request a flight', '/flights', 'plane', '#2F7BD9'],
    ['አየር ማረፊያ', 'Airport', 'Bole arrivals, transfers, tips', '/airport', 'gate', '#6C5CE0'],
    ['ሆቴሎች', 'Hotels', 'Rooms and prices in Addis', '/hotels', 'bed', '#C27B1E'],
    ['ሲኒማ', 'Cinema', 'What is showing this week', '/cinema', 'film', '#D1495B'],
    ['ቢና ዋች', 'Watch', 'Ethiopian films and shows', '/watch', 'play', '#8E44AD'],
    ['ሥራ', 'Jobs', 'New vacancies every day', '/jobs', 'bag', '#3A34B8'],
    ['ጨረታዎች', 'Tenders', 'Open tenders and deadlines', '/tenders', 'doc', '#1F8A70'],
    ['ዜና', 'News', 'Business and daily-life news', '/news', 'news', '#E29A2E'],
    ['መመሪያዎች', 'Guides', 'ID, passport, licences', '/guides', 'id', '#5A63C9'],
    ['አፊያ', 'Afiya', 'Health questions answered', '/afiya', 'heart', '#E0555F'],
    ['አስማት', 'Asmat', 'Legal procedures, step by step', '/asmat', 'scale', '#44506B'],
    ['መሶብ', 'Mesob', 'One-stop government services', '/mesob', 'basket', '#B7791F'],
    ['ዲያስፖራ', 'Diaspora', 'For Ethiopians abroad', '/diaspora', 'globe', '#0E8FA3'],
    ['ኢንሹራንስ', 'Insurance', 'Compare cover and quotes', '/insurance', 'shield', '#2E7D4F']
  ];
  var nav = window.navigator || {};
  var light = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4);
  var N = S.length, STEP = 360 / N, M = light ? 30 : 60, H = 168, R = 360;
  var tilt = document.getElementById('tilt'), rimTop = document.getElementById('rimTop'), rimBot = document.getElementById('rimBot');
  var dName = document.getElementById('dName'), dText = document.getElementById('dText'), dOpen = document.getElementById('dOpen'), count = document.getElementById('count');

  var strips = [], cards = [], frag = document.createDocumentFragment(), j;
  for (j = 0; j < M; j++) { var st = document.createElement('div'); st.className = 'strip'; strips.push(st); frag.appendChild(st); }
  S.forEach(function (s, i) {
    var a = document.createElement('a');
    a.className = 'card'; a.href = s[3]; a.tabIndex = -1;
    a.setAttribute('role', 'option'); a.id = 'svc-' + i;
    a.setAttribute('aria-label', s[0] + ' · ' + s[1]);
    var inner = '<span class="ic" style="background:' + s[5] + ';color:' + s[5] + '"><svg viewBox="0 0 24 24">' + P[s[4]] + '</svg></span>' +
      '<span><b>' + s[0] + '</b><small>' + s[1] + '</small></span>';
    a.innerHTML = '<span class="face out">' + inner + '</span><span class="face in" aria-hidden="true">' + inner + '</span>';
    cards.push(a); frag.appendChild(a);
  });
  ring.appendChild(frag);

  function wrapDeg(d) { d = d % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

  function layout() {
    R = Math.max(290, Math.min(400, stage.clientWidth * 0.95));
    var W = 2 * R * Math.sin(Math.PI / N) + 1.5, sw = 2 * R * Math.sin(Math.PI / M) + 0.4;
    cards.forEach(function (c, i) {
      c.style.width = W + 'px'; c.style.left = (-W / 2) + 'px';
      c.style.transform = 'rotateY(' + (i * STEP + STEP / 2) + 'deg) translateZ(' + R + 'px)';
    });
    strips.forEach(function (st, k) {
      st.style.width = sw + 'px'; st.style.left = (-sw / 2) + 'px';
      st.style.transform = 'rotateY(' + (k * 360 / M) + 'deg) translateZ(' + R + 'px)';
    });
    tilt.style.transform = 'translateZ(' + (-R) + 'px) translateY(' + (H / 2) + 'px) rotateX(-13deg) translateY(' + (-H / 2) + 'px)';
    [[rimTop, 0], [rimBot, H]].forEach(function (r) {
      var e = r[0]; e.style.width = e.style.height = (2 * R) + 'px'; e.style.left = e.style.top = (-R) + 'px';
      e.style.transform = 'translateY(' + r[1] + 'px) rotateX(90deg)';
    });
  }

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touched = false, angle = STEP / 2, vel = 0, target = null, dragging = false, lastX = 0, lastT = 0, moved = 0, front = -1, running = false;
  try { var saved = parseInt(sessionStorage.getItem('bina-ring'), 10); if (saved >= 0 && saved < N) angle = saved * STEP + STEP / 2; } catch (e) {}

  function render() {
    ring.style.transform = 'rotateY(' + (-angle) + 'deg)';
    var best = Math.round((((angle - STEP / 2) % 360) + 360) % 360 / STEP) % N;
    if (best === front) return;
    if (front >= 0) { cards[front].classList.remove('front'); if (touched && nav.vibrate) { try { nav.vibrate(6); } catch (e) {} } }
    front = best; cards[front].classList.add('front');
    stage.setAttribute('aria-activedescendant', cards[front].id);
    var s = S[front];
    dName.textContent = s[0] + ' · ' + s[1]; dText.textContent = s[2]; dOpen.href = s[3];
    count.textContent = (front + 1) + ' / ' + N;
    try { sessionStorage.setItem('bina-ring', String(front)); } catch (e) {}
  }
  function nearest() { return Math.round((angle - STEP / 2) / STEP) * STEP + STEP / 2; }
  function kick() { if (!running) { running = true; requestAnimationFrame(tick); } }
  function tick() {
    if (dragging) { running = false; return; }
    if (target === null) {
      angle += vel; vel *= 0.93;
      if (Math.abs(vel) < 0.35) { vel = 0; target = nearest(); }
    } else {
      var d = target - angle; angle += d * 0.16;
      if (Math.abs(d) < 0.05) { angle = target; target = null; render(); running = false; return; }
    }
    render(); requestAnimationFrame(tick);
  }
  function snapTo(deg) { vel = 0; target = deg; if (reduce) { angle = deg; target = null; render(); } else kick(); }

  stage.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    touched = true; dragging = true; moved = 0; lastX = e.clientX; lastT = performance.now(); vel = 0; target = null;
  });
  stage.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, now = performance.now();
    if (Math.abs(dx) < 1) return;
    moved += Math.abs(dx);
    if (moved > 6 && stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} }
    var dDeg = -dx * 180 / (Math.PI * R);
    angle += dDeg; vel = dDeg * (16 / Math.max(8, now - lastT));
    lastX = e.clientX; lastT = now; render();
  });
  function end() {
    if (!dragging) return; dragging = false;
    setTimeout(function () { moved = 0; }, 60);   // the click that ends a drag is swallowed; the next tap is a real tap
    if (reduce) { snapTo(nearest()); return; }
    vel = Math.max(-9, Math.min(9, vel)); kick();
  }
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  // a tap on the front service opens it; a tap on another brings it to the front; a drag never opens anything
  stage.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('.card');
    if (moved > 6) { e.preventDefault(); return; }
    if (c && cards.indexOf(c) !== front) { e.preventDefault(); snapTo(angle + wrapDeg(cards.indexOf(c) * STEP + STEP / 2 - angle)); }
  }, true);
  stage.addEventListener('wheel', function (e) {
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (!d) return;                         // vertical wheel keeps scrolling the page
    e.preventDefault(); target = null; vel = Math.max(-9, Math.min(9, vel + d * 0.02)); kick();
  }, { passive: false });
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); snapTo(nearest() + STEP); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); snapTo(nearest() - STEP); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.href = S[front][3]; }
  });
  document.getElementById('ringNext').addEventListener('click', function () { touched = true; snapTo(nearest() + STEP); });
  document.getElementById('ringPrev').addEventListener('click', function () { touched = true; snapTo(nearest() - STEP); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { layout(); render(); }, 120); });

  function nudge() {
    if (touched || reduce) return;
    try { if (sessionStorage.getItem('bina-ring-hint')) return; sessionStorage.setItem('bina-ring-hint', '1'); } catch (e) {}
    var home = nearest();
    target = home + 9; kick();
    setTimeout(function () { if (!touched) snapTo(home); }, 520);
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting && es[0].intersectionRatio > 0.6) { io.disconnect(); setTimeout(nudge, 450); }
    }, { threshold: [0.6] });
    io.observe(stage);
  }

  layout(); render();
})();
