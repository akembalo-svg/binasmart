#!/usr/bin/env node
'use strict';
// 02:10 daily. Ten minutes after the watch, and only when the watch asked (design §5.12).
//
//   node --env-file=.env ops/watch/channels/refetch.js
//   node --env-file=.env ops/watch/channels/refetch.js --dry-run
//
// It fetches nothing itself. It reads /root/storage/packs/<pack>-refetch.json, and for each pack with
// something waiting it runs the freshness check that already exists — `ops/packs/freshness.js --pack <pack>` —
// one at a time. freshness.js clears the trigger at the top of its own run, so a pack is re-fetched once.
//
// A morning in which the offices announced nothing does nothing at all: no process, no note, no log line worth
// reading. That is the normal case, and the survey says it will be the case most days.
//
// The guard that matters: no two fetchers ever run at once. There is a lock file, and before it takes the lock
// this script looks in /proc for another freshness or fetch-pack process — a Sunday 06:00 banking run that is
// still going, or a hand-run import. /proc rather than pgrep, because pgrep -f matches its own command line
// and has silently matched itself here before.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pendingPacks, readTrigger, TRIGGER_DIR } = require('./trigger');

const ROOT = path.join(__dirname, '..', '..', '..');
const LOCK = path.join(TRIGGER_DIR, '.watch-refetch.lock');
const STALE_MS = 3 * 60 * 60 * 1000;   // a fetcher that has been running for three hours is not running
const OTHERS = [/ops\/packs\/freshness\.js/, /ops\/packs\/fetch-pack\.js/, /ops\/travel\/freshness\.js/,
  /ops\/packs\/am-headers\.js/];

// Another fetcher's pid, or 0. Read from /proc, never from pgrep: pgrep -f matches its own command line.
function otherFetcher({ proc = '/proc', self = process.pid } = {}) {
  let names = [];
  try { names = fs.readdirSync(proc); } catch (e) { return 0; }
  for (const n of names) {
    if (!/^\d+$/.test(n) || Number(n) === self) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(path.join(proc, n, 'cmdline'), 'utf8').replace(/\0/g, ' '); } catch (e) { continue; }
    if (OTHERS.some(re => re.test(cmd))) return Number(n);
  }
  return 0;
}

function takeLock({ lock = LOCK, now = Date.now() } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (raw && raw.at && now - Date.parse(raw.at) < STALE_MS) {
      let alive = false;
      try { process.kill(raw.pid, 0); alive = true; } catch (e) { alive = false; }
      if (alive) return { ok: false, why: 'another watch re-fetch is running, pid ' + raw.pid };
    }
  } catch (e) { /* no lock, or an unreadable one, is no lock */ }
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }) + '\n');
  return { ok: true };
}
function dropLock({ lock = LOCK } = {}) { try { fs.unlinkSync(lock); } catch (e) { /* nothing to drop */ } }

function runFreshnessReal(pack) {
  return execFileSync('/usr/bin/node', ['--env-file=.env', 'ops/packs/freshness.js', '--pack', pack],
    { cwd: ROOT, encoding: 'utf8', timeout: 60 * 60 * 1000 });
}

function refetch({ dir = TRIGGER_DIR, lock = LOCK, dryRun = false, runFreshness = runFreshnessReal,
  busy = otherFetcher, log = m => console.log(m) } = {}) {
  const packs = pendingPacks({ dir });
  if (!packs.length) { log('[watch-refetch] nothing was asked for — no pack re-fetched'); return { ran: [], packs: [] }; }
  for (const p of packs) log('[watch-refetch] ' + p + ': ' + readTrigger(p, { dir }).length + ' item(s) waiting');
  const other = busy();
  if (other) { log('[watch-refetch] another fetcher is running (pid ' + other + ') — nothing started'); return { ran: [], packs, blocked: other }; }
  if (dryRun) { log('[watch-refetch] would run: ' + packs.map(p => 'freshness --pack ' + p).join(', ') + '  [DRY RUN]'); return { ran: [], packs, dryRun: true }; }
  const got = takeLock({ lock });
  if (!got.ok) { log('[watch-refetch] ' + got.why + ' — nothing started'); return { ran: [], packs, blocked: got.why }; }
  const ran = [];
  try {
    for (const pack of packs) {
      log('[watch-refetch] ' + pack + ': running the freshness check the channel watch asked for');
      try { runFreshness(pack); ran.push({ pack, ok: true }); }
      catch (e) { log('[watch-refetch] ' + pack + ' failed: ' + String(e.message).slice(0, 200)); ran.push({ pack, ok: false, why: e.message }); }
    }
  } finally { dropLock({ lock }); }
  return { ran, packs };
}

module.exports = { refetch, takeLock, dropLock, otherFetcher, runFreshnessReal, LOCK };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const r = refetch({ dryRun: argv.includes('--dry-run') });
  if (r.ran.some(x => !x.ok)) process.exit(1);
}
