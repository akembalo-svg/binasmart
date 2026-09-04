#!/usr/bin/env node
'use strict';
// BinaSmart health check. Runs every five minutes from cron; messages the owner on Telegram.
//
//   node ops/health/check.js            normal run (cron)
//   node ops/health/check.js --dry-run  print what would be sent, send nothing
//
// It only speaks when something CHANGES: one message when a check starts failing (with the list), one
// when everything is back, and one short "all clear" summary a day at 08:00 Addis. A monitor that
// messages every five minutes is muted within a week, at which point it is not a monitor.
//
// Alerts go the same way concierge alerts do: the BinaSmart bot to BINA_OWNER_TG_CHAT.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const DRY = process.argv.includes('--dry-run');
const STATE = '/root/storage/bina-health.json';
const TIMEOUT_MS = 8000;
const ADDIS_OFFSET_MIN = 180; // UTC+3, no DST
const SUMMARY_HOUR_ADDIS = 8;
const CONFIRM_RUNS = 2;           // consecutive failing runs before a page goes out (2 x 5 min)
// Dry-run only: pretend the named checks failed, so the streak logic can be proven without an outage.
const FAKE_FAIL = DRY ? String(process.env.HEALTH_FAKE_FAIL || '').split(',').map(s => s.trim()).filter(Boolean) : [];

const RIDER = process.env.BINA_RIDER_BOT_TOKEN, DRIVER = process.env.BINA_DRIVER_BOT_TOKEN;
const OWNER = process.env.BINA_OWNER_TG_CHAT;

async function fetchJson(url, opts) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...(opts || {}), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, json: j };
  } finally { clearTimeout(t); }
}
async function fetchStatus(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try { const r = await fetch(url, { signal: ctl.signal, redirect: 'manual' }); return r.status; }
  finally { clearTimeout(t); }
}

const CINEMA_ON = process.env.CINEMA_ENABLED === '1' || (() => { try { return /^CINEMA_ENABLED=1/m.test(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.env'), 'utf8')); } catch (e) { return false; } })();
// Each check returns null when healthy, or a short reason when not.
const CHECKS = {
  'API': async () => {
    const r = await fetchJson('http://127.0.0.1:4210/health');
    return r.json && r.json.ok ? null : 'health endpoint returned ' + r.status;
  },
  'MCP server': async () => {
    const r = await fetchJson('https://bina.et/mcp', { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    // Streamable HTTP answers as an SSE frame, so json may be null; fall back to the raw text.
    if (r.json && r.json.result && r.json.result.tools) return r.json.result.tools.length >= 9 ? null : 'only ' + r.json.result.tools.length + ' tools';
    const raw = await (await fetch('https://bina.et/mcp', { method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })).text();
    const n = (raw.match(/"name":"[a-z_]+"/g) || []).length;
    return n >= 9 ? null : 'tools/list returned ' + n + ' tools (HTTP ' + r.status + ')';
  },
  'Router (GraphHopper)': async () => {
    const r = await fetchJson('http://127.0.0.1:8989/route?point=9.0108,38.7578&point=9.0345,38.7549&profile=car&points_encoded=false&instructions=false');
    return r.json && r.json.paths && r.json.paths[0] ? null : 'no path (HTTP ' + r.status + ')';
  },
  'Rider bot webhook': async () => webhookOk(RIDER, '/api/tg/rider'),
  'Driver bot webhook': async () => webhookOk(DRIVER, '/api/tg/driver'),
  'Rider page': async () => { const s = await fetchStatus('https://bina.et/ride'); return s === 200 ? null : 'HTTP ' + s; },
  'Driver page': async () => { const s = await fetchStatus('https://bina.et/drive'); return s === 200 ? null : 'HTTP ' + s; },
  'Cinema page': async () => { if (!CINEMA_ON) return null; const s = await fetchStatus('https://bina.et/cinema'); return s === 200 ? null : 'HTTP ' + s; },
  'Cinema API': async () => { if (!CINEMA_ON) return null; const r = await fetchJson('https://bina.et/api/cinema/shows'); return r.json && r.json.ok ? null : 'shows endpoint HTTP ' + r.status; },
  'pm2 processes': async () => {
    const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8' }));
    const want = ['binasmart-api', 'bina-mcp', 'gh-routing'];
    const bad = want.filter(n => { const p = list.find(x => x.name === n); return !p || p.pm2_env.status !== 'online'; });
    return bad.length ? bad.join(', ') + ' not online' : null;
  },
  'Disk': async () => {
    const out = execSync("df -P / | awk 'NR==2{print $5}'", { encoding: 'utf8' }).trim();
    const pct = parseInt(out, 10);
    return pct >= 90 ? 'root filesystem ' + pct + '% full' : null;
  },
};

async function webhookOk(token, expectPath) {
  if (!token) return 'no token in .env';
  const r = await fetchJson('https://api.telegram.org/bot' + token + '/getWebhookInfo');
  const w = r.json && r.json.result;
  if (!w) return 'getWebhookInfo failed (HTTP ' + r.status + ')';
  if (!w.url || !w.url.endsWith(expectPath)) return 'webhook is ' + (w.url || 'unset') + ', expected …' + expectPath;
  // Telegram keeps the last error forever; only a recent one means it is failing now.
  if (w.last_error_date && Date.now() / 1000 - w.last_error_date < 600) return 'Telegram reports: ' + (w.last_error_message || 'delivery error') + ' (' + Math.round((Date.now() / 1000 - w.last_error_date) / 60) + ' min ago)';
  if ((w.pending_update_count || 0) > 50) return w.pending_update_count + ' updates queued and not being delivered';
  return null;
}

function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return { failing: [], since: null, lastSummaryDay: null }; } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s)); }
function addisNow() { return new Date(Date.now() + ADDIS_OFFSET_MIN * 60000); }
function addisDay(d) { return d.toISOString().slice(0, 10); }
function addisClock(d) { return d.toISOString().slice(11, 16); }

async function send(text) {
  if (DRY) { console.log('[dry-run] would send:\n' + text + '\n'); return true; }
  if (!RIDER || !OWNER) { console.error('cannot alert: BINA_RIDER_BOT_TOKEN or BINA_OWNER_TG_CHAT missing'); return false; }
  const r = await fetchJson('https://api.telegram.org/bot' + RIDER + '/sendMessage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: OWNER, text, disable_web_page_preview: true }),
  });
  return !!(r.json && r.json.ok);
}

(async () => {
  const t0 = Date.now();
  const names = Object.keys(CHECKS);
  const results = await Promise.allSettled(names.map(n => CHECKS[n]()));
  const failing = [];
  const lines = names.map((n, i) => {
    const r = results[i];
    let reason = r.status === 'fulfilled' ? r.value : (r.reason && r.reason.name === 'AbortError' ? 'timed out' : String(r.reason && r.reason.message || r.reason));
    if (FAKE_FAIL.includes(n)) reason = 'simulated failure (dry run)';
    if (reason) failing.push({ name: n, reason });
    return (reason ? '🔴 ' : '🟢 ') + n + (reason ? ' — ' + reason : '');
  });
  const ms = Date.now() - t0;
  const now = addisNow();
  console.log(addisDay(now) + ' ' + addisClock(now) + ' Addis · ' + failing.length + ' failing of ' + names.length + ' · ' + ms + 'ms' + (failing.length ? ' · ' + failing.map(f => f.name).join(', ') : ''));

  const state = loadState();
  state.streak = state.streak || {};

  // A check has to fail on two consecutive runs (10 minutes) before it pages. A one-minute host stall
  // at 3 AM woke the owner for a fault that had healed before the message was read; the log still
  // records every run, so nothing is lost - only the page is withheld until the fault is real.
  const rawNow = new Set(failing.map(f => f.name));
  for (const n of names) state.streak[n] = rawNow.has(n) ? (state.streak[n] || 0) + 1 : 0;
  const confirmed = new Set(names.filter(n => state.streak[n] >= CONFIRM_RUNS));
  const before = new Set(state.failing || []);
  const changed = before.size !== confirmed.size || [...confirmed].some(n => !before.has(n));
  const pending = failing.filter(f => !confirmed.has(f.name)).map(f => f.name);
  if (pending.length) console.log('  not paging yet (1st miss, needs ' + CONFIRM_RUNS + ' in a row): ' + pending.join(', '));

  if (changed) {
    if (confirmed.size) {
      const shown = lines.filter((_, i) => confirmed.has(names[i]) || !rawNow.has(names[i]));
      const head = '🚨 BinaSmart: ' + confirmed.size + ' check' + (confirmed.size > 1 ? 's' : '') + ' failing for ' + (CONFIRM_RUNS * 5) + '+ min';
      await send(head + '\n\n' + shown.join('\n') + '\n\n' + addisClock(now) + ' Addis · re-checks every 5 min, next message only on change');
      state.since = state.since || Date.now() - (CONFIRM_RUNS - 1) * 5 * 60000;
    } else {
      const mins = state.since ? Math.round((Date.now() - state.since) / 60000) : null;
      await send('✅ BinaSmart: all clear again' + (mins != null ? ' after ' + mins + ' min' : '') + '\n\n' + lines.join('\n'));
      state.since = null;
    }
    state.failing = [...confirmed];
  }

  // One line a day so silence is known to mean "fine" rather than "dead".
  const today = addisDay(now);
  if (!rawNow.size && !changed && now.getUTCHours() >= SUMMARY_HOUR_ADDIS && state.lastSummaryDay !== today) {
    await send('✅ BinaSmart daily check · ' + today + '\nAll ' + names.length + ' checks green: API, MCP, router, both bot webhooks, both pages, pm2, disk.');
    state.lastSummaryDay = today;
  }
  saveState(state);
  process.exitCode = rawNow.size ? 1 : 0;
})().catch(e => { console.error('health check crashed: ' + (e.stack || e)); process.exitCode = 2; });
