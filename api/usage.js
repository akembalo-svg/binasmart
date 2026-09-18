'use strict';
// Durable request counters for the public knowledge endpoints.
//
// Why a file and not the process memory it replaces: binasmart-api restarted 115 times in the five days
// before this was written, and every restart emptied the old in-process Map. A limit that resets on a
// deploy is not a limit. Why a file and not a Prisma model: the two processes that must share one
// allowance (binasmart-api and bina-mcp) are separate, and a database round trip in front of every
// anonymous request buys nothing for a number that is allowed to be two seconds stale.
//
// Layout under `dir` (default /root/storage/api/usage):
//   live.<proc>.json             counters this process holds for the CURRENT minute / hour / day buckets
//   day-<YYYY-MM-DD>.<proc>.json the accounting rollup for that UTC day: caller, endpoint, count, denied
//
// A process only ever writes its own <proc> files, so two processes never race on one file. A combined
// count - the anonymous allowance spans /api/knowledge/search AND /mcp - is this process's count plus
// the other processes' live files, re-read at most every `peerCacheMs`.
//
// Nothing here may take the API down. If the directory cannot be written the counters keep working in
// memory, one line is logged, and the endpoints stay up.

const fs = require('fs');
const path = require('path');

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 };

const bucketOf = (unit, t) => Math.floor(t / UNIT_MS[unit]);
const dayStamp = t => new Date(t).toISOString().slice(0, 10);

// flushMs and peerCacheMs are the price of not having a shared lock: one process learns what the other
// has counted at most flushMs + peerCacheMs late, so a caller hammering BOTH doors at once can overshoot
// by about two seconds of traffic before the combined count catches up. Two seconds, not two hours -
// and both numbers are two small JSON files, so they are kept short rather than clever.
function makeUsage({ dir, proc = 'api', flushMs = 1000, peerCacheMs = 1000, retainDays = 90, now = Date.now, timer = true } = {}) {
  const live = new Map();    // "unit|bucket|caller" -> count
  const daily = new Map();   // "caller|endpoint"    -> { count, denied }
  let dailyDay = dayStamp(now());
  let dirty = false, broken = false, prunedAt = 0, handle = null;
  let peer = { at: -Infinity, counts: new Map() };

  const livePath = () => path.join(dir, 'live.' + proc + '.json');
  const dayPath = d => path.join(dir, 'day-' + d + '.' + proc + '.json');

  function warn(e, what) {
    if (!broken) console.error('[usage] ' + what + ' failed; counting in memory only: ' + (e && e.message));
    broken = true;
  }
  function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
  function writeJson(file, obj) {
    const tmp = file + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);           // atomic within one filesystem: a reader never sees half a file
  }
  // A stored counter is only meaningful while its bucket is the current one; an hour-old hour bucket is
  // history, not an allowance, and is dropped on the next flush.
  const isCurrent = (k, t) => { const p = k.split('|'); return !!UNIT_MS[p[0]] && Number(p[1]) === bucketOf(p[0], t); };

  function restore() {
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (e) { return warn(e, 'mkdir ' + dir); }
    const t = now();
    const l = readJson(livePath());
    if (l && l.counts) for (const [k, v] of Object.entries(l.counts)) if (isCurrent(k, t)) live.set(k, Number(v) || 0);
    const d = readJson(dayPath(dailyDay));
    if (d && d.callers) for (const [k, v] of Object.entries(d.callers)) daily.set(k, { count: Number(v.count) || 0, denied: Number(v.denied) || 0 });
  }

  function peerCounts(t) {
    if (t - peer.at < peerCacheMs) return peer.counts;
    const counts = new Map();
    try {
      for (const f of fs.readdirSync(dir)) {
        const m = /^live\.(.+)\.json$/.exec(f);
        if (!m || m[1] === proc) continue;
        const j = readJson(path.join(dir, f));
        if (!j || !j.counts) continue;
        for (const [k, v] of Object.entries(j.counts)) if (isCurrent(k, t)) counts.set(k, (counts.get(k) || 0) + (Number(v) || 0));
      }
    } catch (e) { warn(e, 'peer read'); }
    peer = { at: t, counts };
    return counts;
  }

  function roll(caller, endpoint, field, t) {
    const d = dayStamp(t);
    if (d !== dailyDay) { flush(t); daily.clear(); dailyDay = d; }
    const k = caller + '|' + endpoint;
    const row = daily.get(k) || { count: 0, denied: 0 };
    row[field] += 1; daily.set(k, row); dirty = true;
  }

  function prune(t) {
    if (t - prunedAt < UNIT_MS.hour) return;
    prunedAt = t;
    const cutoff = dayStamp(t - retainDays * UNIT_MS.day);
    try {
      for (const f of fs.readdirSync(dir)) {
        const m = /^day-(\d{4}-\d{2}-\d{2})\./.exec(f);
        if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f));
      }
    } catch (e) { warn(e, 'prune'); }
  }

  function flush(t = now()) {
    if (!dirty) return;
    dirty = false;
    for (const k of [...live.keys()]) if (!isCurrent(k, t)) live.delete(k);
    try {
      writeJson(livePath(), { proc, at: new Date(t).toISOString(), counts: Object.fromEntries(live) });
      writeJson(dayPath(dailyDay), { proc, day: dailyDay, callers: Object.fromEntries(daily) });
    } catch (e) { return warn(e, 'flush'); }
    prune(t);
  }

  restore();
  if (timer && flushMs > 0) {
    handle = setInterval(() => flush(), flushMs);
    if (handle.unref) handle.unref();
    process.on('exit', () => { try { flush(); } catch { /* a dying process must not throw here */ } });
  }

  return {
    // What this caller has spent in the current bucket of `unit`, this process and every other one.
    count(unit, caller, t = now()) {
      const k = unit + '|' + bucketOf(unit, t) + '|' + caller;
      return (live.get(k) || 0) + (peerCounts(t).get(k) || 0);
    },
    // A request that was allowed: charged to every unit named, and recorded for the day's accounting.
    hit(caller, endpoint, units = ['minute', 'hour', 'day'], t = now()) {
      for (const u of units) { const k = u + '|' + bucketOf(u, t) + '|' + caller; live.set(k, (live.get(k) || 0) + 1); }
      roll(caller, endpoint, 'count', t);
    },
    // A request that was refused: recorded, never charged. This is the number that says the limit bites.
    deny(caller, endpoint, t = now()) { roll(caller, endpoint, 'denied', t); },
    flush,
    snapshot() { return { day: dailyDay, callers: Object.fromEntries(daily) }; },
    stop() { if (handle) clearInterval(handle); flush(); },
  };
}

module.exports = { makeUsage, bucketOf, dayStamp, UNIT_MS };
