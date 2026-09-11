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
  // Delivery is tried in order and stops at the first success. This is not belt-and-braces: on
  // 2026-09-11 the app's own admin chat turned out to be unreachable by the bot configured for it
  // (@gccandconectbot -> 8825386029 returns "chat not found"), so alerts addressed to Ibrahim have
  // been going nowhere. A monitor that cannot raise an alarm is worse than no monitor, because it
  // buys false confidence — so it verifies the route rather than assuming it.
  const routes = [
    ['driver bot -> Ibrahim', process.env.BINA_DRIVER_BOT_TOKEN, '8825386029'],
    ['main bot -> ops', process.env.BINASMART_TG_TOKEN, process.env.BINASMART_OPS_TG_CHAT || '8096525984'],
    ['main bot -> admin', process.env.BINASMART_TG_TOKEN, process.env.BINASMART_ADMIN_TG_CHAT],
  ].filter(r => r[1] && r[2]);

  for (const [label, token, chat] of routes) {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    }).catch(() => null);
    if (r && r.ok) { console.log('[router-watch] alerted via ' + label); return true; }
  }
  console.error('[router-watch] NO DELIVERY ROUTE WORKED — the alarm is mute');
  return false;
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
