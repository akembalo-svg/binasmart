#!/usr/bin/env node
'use strict';
// Watch the routing server, because its failure is silent and expensive.
//
// If GraphHopper stops answering, ride/geo.js falls back to straight-line distance x 1.3. Nothing
// crashes, nothing logs an error to a human, and the app keeps quoting fares — wrong ones. A rider
// is overcharged or a driver is short-changed on every trip until somebody notices by accident.
// That is the worst shape a failure can have: invisible, ongoing, and it touches money.
//
// So this checks the thing itself rather than a proxy: it asks for a REAL Addis route and checks the
// answer is sane, not merely that the port is open. A router that returns 200 with a nonsense
// distance is still broken.
//
//   node --env-file=.env ops/ride/router-watch.js [--verbose]
// Cron every 10 minutes. It alerts on the transition only, so a long outage does not spam Telegram.

const fs = require('fs');
const ROUTER = process.env.ROUTER_URL || 'http://127.0.0.1:8989';
const STATE = '/root/storage/router-watch.state';
const VERBOSE = process.argv.includes('--verbose');

// Bole Medhanealem -> Piassa. A route every Addis driver knows: roughly 6-9 km by road.
const FROM = { lat: 9.0135, lng: 38.7625 }, TO = { lat: 9.0348, lng: 38.7520 };
const MIN_M = 3000, MAX_M = 20000;

async function check() {
  const url = ROUTER + '/route?point=' + FROM.lat + ',' + FROM.lng
    + '&point=' + TO.lat + ',' + TO.lng + '&profile=car&points_encoded=false';
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, why: 'HTTP ' + r.status, ms };
    const j = await r.json();
    const p = j && j.paths && j.paths[0];
    if (!p) return { ok: false, why: 'no path in response', ms };
    const m = Math.round(p.distance);
    // A router answering with a straight line, or with nonsense, is broken even at HTTP 200.
    if (m < MIN_M || m > MAX_M) return { ok: false, why: 'implausible distance ' + m + ' m', ms };
    if (!Array.isArray(p.points && p.points.coordinates) || p.points.coordinates.length < 10)
      return { ok: false, why: 'route has almost no geometry — probably a straight line', ms };
    return { ok: true, m, ms, pts: p.points.coordinates.length };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? 'timeout after 15s' : e.message, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

async function tg(text) {
  // Same token resolution as server.js sendTg, so the monitor alerts from the bot the platform
  // already uses and there is one place to change it. The ops chat is the second destination
  // because it has received operational alerts since launch.
  const token = process.env.BINA_RIDER_BOT_TOKEN || process.env.BINASMART_TG_TOKEN;
  const chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT || '8096525984']
    .map(c => String(c || '').trim()).filter(Boolean);
  if (!token || !chats.length) { console.error('[router-watch] no telegram token/chat configured'); return false; }

  let delivered = false;
  for (const chat of chats) {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    }).catch(() => null);
    if (r && r.ok) delivered = true;
  }
  // An alarm that cannot ring is worse than no alarm, so say so rather than failing quietly.
  if (!delivered) console.error('[router-watch] NO DELIVERY ROUTE WORKED — the alarm is mute');
  return delivered;
}

(async () => {
  const res = await check();
  let was = 'ok';
  try { was = fs.readFileSync(STATE, 'utf8').trim() || 'ok'; } catch (e) { /* first run */ }
  const now = res.ok ? 'ok' : 'down';

  if (VERBOSE || was !== now) {
    console.log('[router-watch] ' + now + (res.ok
      ? ' — ' + res.m + ' m, ' + res.pts + ' points, ' + res.ms + ' ms'
      : ' — ' + res.why + ' (' + res.ms + ' ms)'));
  }

  // Alert on the CHANGE only. A router down for six hours should send two messages, not thirty-six.
  if (was !== now) {
    const msg = now === 'down'
      ? '🔴 BinaRide routing server is DOWN\n\n' + res.why + '\n\nFares are now estimated from '
        + 'straight-line distance × 1.3, so quotes will be wrong until it is back. '
        + 'Check GraphHopper on ' + ROUTER
      : '✅ BinaRide routing server is back\n\nTest route answered in ' + res.ms + ' ms ('
        + res.m + ' m). Fares are accurate again.';
    const sent = await tg(msg);
    console.log('[router-watch] state ' + was + ' -> ' + now + ', telegram ' + (sent ? 'sent' : 'FAILED'));
  }

  try { fs.mkdirSync('/root/storage', { recursive: true }); fs.writeFileSync(STATE, now); } catch (e) {}
  process.exit(res.ok ? 0 : 1);
})();
