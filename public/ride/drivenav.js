/* BinaSmart Driver — Amharic turn-by-turn and audio alerts.
 *
 * Language: GraphHopper hands us a numeric `sign` per manoeuvre, never prose, so every word a driver
 * reads or hears is written here in Amharic first. English is the subtitle, not the source.
 *
 * Audio: tones are synthesised with Web Audio, so there are no files to download on a metered
 * connection and no CDN to be blocked. Mobile browsers refuse to make sound until the user has
 * touched the page, so unlock() is called from the first tap.
 *
 * Speech: only if the phone actually has an Amharic voice installed. Reading Amharic script through an
 * English voice produces gibberish, so when no am voice exists we stay silent and let the chime and
 * the big text do the work. voiceState() reports which case we are in.
 */
window.DNav = (function () {
  'use strict';

  // ---- Amharic manoeuvres, by GraphHopper sign code ----
  var TURN = {
    '-98': { am: 'ወደ ኋላ ተመልሰው ይሂዱ', en: 'Make a U-turn', ic: '⤺' },
    '-8': { am: 'ወደ ኋላ ተመልሰው ይሂዱ', en: 'Make a U-turn', ic: '⤺' },
    '-7': { am: 'በግራ በኩል ይቀጥሉ', en: 'Keep left', ic: '↰' },
    '-6': { am: 'ከክብ መንገዱ ይውጡ', en: 'Leave the roundabout', ic: '⤴' },
    '-3': { am: 'አጥብቀው ወደ ግራ ይታጠፉ', en: 'Sharp left', ic: '↰' },
    '-2': { am: 'ወደ ግራ ይታጠፉ', en: 'Turn left', ic: '⬅' },
    '-1': { am: 'በትንሹ ወደ ግራ ይያዙ', en: 'Slight left', ic: '↖' },
    '0': { am: 'ቀጥ ብለው ይቀጥሉ', en: 'Continue straight', ic: '⬆' },
    '1': { am: 'በትንሹ ወደ ቀኝ ይያዙ', en: 'Slight right', ic: '↗' },
    '2': { am: 'ወደ ቀኝ ይታጠፉ', en: 'Turn right', ic: '➡' },
    '3': { am: 'አጥብቀው ወደ ቀኝ ይታጠፉ', en: 'Sharp right', ic: '↱' },
    '4': { am: 'ደረሱ', en: 'You have arrived', ic: '🏁' },
    '5': { am: 'ይቀጥሉ', en: 'Continue', ic: '⬆' },
    '6': { am: 'ወደ ክብ መንገዱ ይግቡ', en: 'Enter the roundabout', ic: '🔄' },
    '7': { am: 'በቀኝ በኩል ይቀጥሉ', en: 'Keep right', ic: '↱' },
    '8': { am: 'ወደ ኋላ ተመልሰው ይሂዱ', en: 'Make a U-turn', ic: '⤻' },
  };
  var ORDINAL_AM = ['', 'አንደኛውን', 'ሁለተኛውን', 'ሦስተኛውን', 'አራተኛውን', 'አምስተኛውን', 'ስድስተኛውን'];

  function distAm(m) {
    if (m == null) return '';
    if (m < 30) return 'አሁን';
    if (m < 950) return 'በ' + (Math.round(m / 10) * 10) + ' ሜትር';
    return 'በ' + (Math.round(m / 100) / 10) + ' ኪሎ ሜትር';
  }
  function distEn(m) {
    if (m == null) return '';
    if (m < 30) return 'now';
    if (m < 950) return 'in ' + (Math.round(m / 10) * 10) + ' m';
    return 'in ' + (Math.round(m / 100) / 10) + ' km';
  }

  // ---- geometry ----
  function metres(a, b) {
    var R = 6371000, p = Math.PI / 180;
    var dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  var pts = [], cum = [], steps = [];

  // instructions/geometry as /api/drive/route returns them ([lng, lat] pairs).
  function plan(instructions, geometry) {
    pts = (geometry || []).map(function (c) { return { lat: c[1], lng: c[0] }; });
    steps = (instructions || []).filter(function (s) { return s.interval; });
    cum = [0];
    for (var i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + metres(pts[i - 1], pts[i]);
    return { points: pts.length, steps: steps.length };
  }
  function ready() { return pts.length > 1 && steps.length > 0; }

  // Projects a position onto one segment, in local metres. Snapping to the nearest VERTEX would
  // advance the instruction up to half a segment early — telling a driver "arrive ahead" while they
  // are still 55 m short of the turn. Projecting onto the segment gives the true distance travelled.
  function project(p, a, b) {
    var latRef = (a.lat + b.lat) / 2 * Math.PI / 180;
    var mx = 111320 * Math.cos(latRef), my = 110540;
    var bx = (b.lng - a.lng) * mx, by = (b.lat - a.lat) * my;
    var px = (p.lng - a.lng) * mx, py = (p.lat - a.lat) * my;
    var len2 = bx * bx + by * by;
    var t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    var dx = px - bx * t, dy = py - by * t;
    return { dist: Math.sqrt(dx * dx + dy * dy), along: Math.sqrt(len2) * t };
  }

  // Where the driver is on the plan, and what they must do next.
  function update(pos) {
    if (!ready() || !pos) return null;
    var seg = 0, bestD = Infinity, along = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var pr = project(pos, pts[i], pts[i + 1]);
      if (pr.dist < bestD) { bestD = pr.dist; seg = i; along = pr.along; }
    }
    // 120 m off the line means the plan is stale — the caller should re-route rather than lie.
    if (bestD > 120) return { offRoute: true, offBy: Math.round(bestD) };
    var travelled = cum[seg] + along;

    // An instruction's interval [a, b] covers the segments a .. b-1.
    var k = steps.length - 1;
    for (var j = 0; j < steps.length; j++) {
      var a = steps[j].interval[0], b = Math.max(steps[j].interval[1], a + 1);
      if (seg >= a && seg < b) { k = j; break; }
    }
    // A GraphHopper instruction's `sign` is the manoeuvre at the START of its interval, so the turn
    // ahead belongs to the NEXT step and the distance to it is what remains of this one.
    var next = steps[k + 1] || null;
    var endIdx = Math.min(steps[k].interval[1], pts.length - 1);
    var toTurn = Math.max(0, Math.round(cum[endIdx] - travelled));
    var remaining = Math.max(0, Math.round(cum[pts.length - 1] - travelled));

    var sign = next ? String(next.sign) : '4';
    var t = TURN[sign] || TURN['0'];
    var street = (next && next.street) || '';
    var am = t.am, en = t.en;
    if (next && next.sign === 6 && next.exitNumber && ORDINAL_AM[next.exitNumber]) {
      am += ' እና ' + ORDINAL_AM[next.exitNumber] + ' መውጫ ይውጡ';
      en += ' and take exit ' + next.exitNumber;
    }
    if (street) { am += ' — ' + street; en += ' onto ' + street; }

    return {
      offRoute: false, sign: sign, icon: t.ic, stepIndex: k,
      amharic: (next ? distAm(toTurn) + ' ' : '') + am,
      english: (next ? distEn(toTurn) + ' · ' : '') + en,
      spokenAm: (toTurn < 30 || !next ? '' : distAm(toTurn) + ' ') + t.am,
      metresToTurn: next ? toTurn : 0,
      // The finish is itself a manoeuvre (sign 4), so "arrived" cannot mean "no next step" — it means
      // the next manoeuvre is the finish and we are on top of it.
      remainingM: remaining, arrived: !next || (String(sign) === '4' && toTurn < 30),
    };
  }

  // ---- audio ----
  var ctx = null, muted = false;
  try { muted = localStorage.getItem('bina_drv_mute') === '1'; } catch (e) {}

  function unlock() {
    if (ctx) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (e) { ctx = null; }
  }
  function tone(freq, startAt, ms, gain) {
    if (!ctx) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    // A short ramp instead of a hard stop: a clipped tone clicks, and a clicking alert sounds broken.
    g.gain.setValueAtTime(0, startAt);
    g.gain.linearRampToValueAtTime(gain, startAt + 0.015);
    g.gain.linearRampToValueAtTime(0, startAt + ms / 1000);
    o.connect(g); g.connect(ctx.destination);
    o.start(startAt); o.stop(startAt + ms / 1000 + 0.02);
  }
  var PATTERNS = {
    offer: [[880, 0, 130], [1175, 0.16, 130], [1568, 0.32, 220]],   // urgent, rising, carries over road noise
    accepted: [[784, 0, 120], [1046, 0.13, 260]],
    turn: [[1046, 0, 90], [1046, 0.14, 90]],
    arrive: [[659, 0, 140], [880, 0.15, 140], [1318, 0.3, 300]],
    done: [[523, 0, 150], [659, 0.16, 150], [784, 0.32, 380]],
    warn: [[400, 0, 200], [330, 0.22, 260]],
  };
  function chime(kind) {
    if (muted) return;
    unlock();
    if (!ctx) return;
    var p = PATTERNS[kind] || PATTERNS.turn, t0 = ctx.currentTime + 0.02;
    p.forEach(function (n) { tone(n[0], t0 + n[1], n[2], kind === 'offer' ? 0.28 : 0.18); });
  }
  function buzz(pattern) {
    if (muted) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern || 200); } catch (e) {}
  }

  // ---- speech, only in a language the phone can actually pronounce ----
  var amVoice = null, voicesChecked = false;
  function findVoice() {
    voicesChecked = true;
    try {
      var vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      for (var i = 0; i < vs.length; i++) {
        var l = (vs[i].lang || '').toLowerCase();
        if (l === 'am' || l.indexOf('am-') === 0) { amVoice = vs[i]; return; }
      }
      amVoice = null;
    } catch (e) { amVoice = null; }
  }
  if (window.speechSynthesis) {
    findVoice();
    try { window.speechSynthesis.onvoiceschanged = findVoice; } catch (e) {}
  }
  function voiceState() {
    return { checked: voicesChecked, amharic: !!amVoice, name: amVoice ? amVoice.name : null };
  }
  // Amharic text through an English voice is noise, so no voice means no speech — the chime carries it.
  function say(amharic) {
    if (muted || !amharic || !amVoice || !window.speechSynthesis) return false;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(amharic);
      u.voice = amVoice; u.lang = amVoice.lang; u.rate = 0.95; u.volume = 1;
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }

  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('bina_drv_mute', muted ? '1' : '0'); } catch (e) {}
    if (muted && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    return muted;
  }
  function isMuted() { return muted; }

  return { plan: plan, update: update, ready: ready, chime: chime, buzz: buzz, say: say,
    unlock: unlock, setMuted: setMuted, isMuted: isMuted, voiceState: voiceState,
    distAm: distAm, distEn: distEn, TURN: TURN, _metres: metres };
})();
