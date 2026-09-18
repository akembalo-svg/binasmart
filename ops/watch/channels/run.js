#!/usr/bin/env node
'use strict';
// The daily channel watch. 02:00, every day.
//
//   node --env-file=.env ops/watch/channels/run.js --dry-run    read everything, write nothing, send nothing
//   node --env-file=.env ops/watch/channels/run.js              the real run
//
// It harvests and writes; it does NOT ingest. The existing 03:30 daily knowledge/ingest.js picks the new
// documents up ninety minutes later, so the watch adds no ingest run and cannot collide with one.
//
// The order, and why: read the office channels and the feeds (5 s apart, one host at a time) -> classify by
// rule -> ask the model only about what the rules could not settle (4 s apart, and not at all under
// WATCH_NO_MODEL=1) -> fetch the document behind each admitted item -> write one dated document each ->
// queue the packs whose offices announced a directive -> sweep what has expired or been superseded -> send one
// note, and only if there is something in it.
//
// A dry run does every reading step against the live sources and writes nothing at all: no document, no
// trigger, no status change, no message. It is the only way to see what a morning would do before a morning
// does it, and the plan requires one before the cron is installed.

const fs = require('fs');
const path = require('path');
const { readPreview } = require('./preview');
const { readFeed } = require('./feeds');
const { classifyByRules } = require('./classify');
const { classifyWithModel } = require('./classify-model');
const { fetchDocuments } = require('./document');
const { watchDoc, writeWatchDoc } = require('./write');
const { appendTriggers } = require('./trigger');
const { sweep, expiresFor } = require('./retention');
const { buildNote, sendNote } = require('./note');

const ROOT = path.join(__dirname, '..', '..', '..');
const REGISTRY = path.join(__dirname, 'registry.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BinaSmart/1.0 (+https://bina.et/support)';
const PACE_MS = 5000;       // t.me is one host; the feeds get the same courtesy
const TIMEOUT_MS = 20000;
const WINDOW_DAYS = 2;      // yesterday and today: one missed morning is covered, a week of archive is not

const handleOf = h => String(h || '').replace(/^@/, '');
// One announcement, one document. The first dry run (18 September) found ethio telecom and telebirr posting
// the SAME text within minutes of each other — the fraud warning, the Fayda card printing note, the WiFi
// self-service note, the Ethio Call tariff, the Happy Hour bundle and the telebirr loan line, six pairs in one
// morning — and it would have written each of them twice. The key is the post's own words and its day, so two
// channels carrying one announcement collapse and two genuinely different notices never do.
const sameAs = post => String((post && post.text) || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  + ' | ' + String((post && post.date) || '');
const dayOf = (iso, back = 0) => { const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10); };

async function getText(url, { fetchImpl, ua = UA, timeoutMs = TIMEOUT_MS }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await f(url, { signal: ctrl.signal, redirect: 'follow',
      headers: { 'user-agent': ua, 'accept-language': 'am,en;q=0.8', accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8', connection: 'keep-alive' } });
    if (r.status !== 200) return { ok: false, why: 'http_' + r.status };
    return { ok: true, body: await r.text() };
  } catch (e) {
    return { ok: false, why: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e).slice(0, 60) };
  } finally { clearTimeout(t); }
}

// Every source, read once, paced. A source that answers 200 with no channel title and no dated bubble is DEAD,
// not empty: 109 non-existent handles answered 200 in the survey, and believing a status code is how this
// whole thing goes quietly blind.
async function harvest({ registry, today, fetchImpl, sleep, log = () => {}, windowDays = WINDOW_DAYS, pace = PACE_MS }) {
  const zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const since = dayOf(today, windowDays);
  const items = [], dead = [];
  const seen = new Map();
  let first = true, raw = 0, duplicates = 0;
  for (const s of (registry.sources || [])) {
    if (s.active === false || s.verified === false) continue;
    const url = s.feed ? s.feed : 'https://t.me/s/' + handleOf(s.handle);
    if (first) first = false; else await zz(pace);
    const got = await getText(url, { fetchImpl });
    if (!got.ok) { dead.push({ id: s.id, url, why: got.why }); log('[watch] ' + s.id + ': ' + got.why); continue; }
    const read = s.feed ? readFeed(got.body, { id: s.id, lang: s.lang, name: s.name })
      : readPreview(got.body, { handle: s.handle });
    if (!read.live) { dead.push({ id: s.id, url, why: read.error || 'no channel title and no dated post' }); log('[watch] ' + s.id + ': NOT LIVE — ' + (read.error || 'no title, no dated bubble')); continue; }
    const fresh = read.posts.filter(p => p.date >= since);
    raw += read.posts.length;
    let dup = 0;
    for (const post of fresh) {
      const key = sameAs(post);
      if (key.trim().length > 12 && seen.has(key)) { dup++; duplicates++; continue; }
      seen.set(key, s.id);
      items.push({ post, source: s });
    }
    log('[watch] ' + s.id + ': ' + read.posts.length + ' post(s) read, ' + fresh.length + ' inside the window'
      + (dup ? ', ' + dup + ' already carried by another channel' : ''));
  }
  return { items, dead, raw, since, duplicates };
}

// The three stages, in order, with the model last and only for what the rules left.
async function classifyAll(items, { env, fetchImpl, sleep, log = () => {} } = {}) {
  const settled = [], toModel = [];
  for (const it of items) {
    const v = classifyByRules(it.post, { source: it.source });
    if (v.settled) settled.push({ ...it, ...v });
    else toModel.push(it);
  }
  const m = await classifyWithModel(toModel, { env, fetchImpl, sleep, log });
  const modelled = m.results.map(r => ({ post: r.post, source: r.source, label: r.label, admit: r.admit, office: r.office, reason: r.reason, queued: r.queued }));
  const all = settled.concat(modelled);
  return { all, admitted: all.filter(x => x.admit), excluded: all.filter(x => x.label === 'excluded'),
    unsettled: all.filter(x => x.label === 'unsettled'), calls: m.calls, modelFailed: m.failed, modelSkipped: m.skipped };
}

async function run({ root = ROOT, registry, today, dryRun = false, fetchImpl, sleep, env = process.env,
  sendTg, log = m => console.log(m), windowDays = WINDOW_DAYS, pace = PACE_MS, harvestRoot, triggerDir } = {}) {
  const day = String(today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const reg = registry || JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  log('[watch] ' + day + (dryRun ? '  [DRY RUN — nothing is written, nothing is sent]' : ''));

  const h = await harvest({ registry: reg, today: day, fetchImpl, sleep, log, windowDays, pace });
  log('[watch] ' + h.raw + ' raw item(s) read, ' + h.items.length + ' inside the window since ' + h.since
    + ', ' + h.duplicates + ' already carried by another channel, ' + h.dead.length + ' source(s) did not answer');

  const c = await classifyAll(h.items, { env, fetchImpl, sleep, log });
  log('[watch] ' + c.admitted.length + ' admitted, ' + c.excluded.length + ' excluded, ' + c.unsettled.length
    + ' unsettled; ' + c.calls + ' model call(s)' + (c.modelSkipped ? ' (' + c.modelSkipped + ' skipped: the model is off)' : ''));

  // The document behind each admitted item. A dry run fetches nothing at all — a harvest directory is a write.
  let docs = { fetched: [], pending: [] };
  if (!dryRun) docs = await fetchDocuments(c.admitted, Object.assign({ fetchImpl, sleep, now: new Date().toISOString(), log },
    harvestRoot ? { root: harvestRoot } : {}));
  else for (const it of c.admitted) {
    const { documentLinks } = require('./document');
    for (const u of documentLinks(it)) log('[watch] would fetch the document behind ' + (it.post.url || it.source.id) + ': ' + u);
  }

  const written = [];
  for (const it of c.admitted) {
    const expiresAt = expiresFor(it.post.text, { reportedAt: it.post.date }) || undefined;
    const d = watchDoc(it, { today: day, expiresAt, pendingDocument: !!it.pendingDocument });
    const file = path.join(root, d.dir, d.name);
    if (fs.existsSync(file)) { log('[watch] already written: ' + d.name); continue; }
    if (dryRun) log('[watch] would write knowledge/watch/' + d.name + '  (' + it.office + ', expires '
      + d.meta.expires_at + ', ' + it.reason + ')\n           ' + d.meta.title);
    else writeWatchDoc(it, { root, today: day, expiresAt, pendingDocument: !!it.pendingDocument });
    written.push({ item: it, file, meta: d.meta, name: d.name });
  }
  log('[watch] ' + written.length + ' document(s) ' + (dryRun ? 'would be written' : 'written') + ' to knowledge/watch/');

  const triggers = appendTriggers(c.admitted, Object.assign({ registry: reg, dryRun, log }, triggerDir ? { dir: triggerDir } : {}));
  const swept = sweep({ root, today: day, dryRun, log });
  if (swept.expired.length || swept.superseded.length)
    log('[watch] retention: ' + swept.expired.length + ' expired, ' + swept.superseded.length + ' superseded, ' + swept.live + ' still live');

  const note = buildNote({ written, pending: docs.pending, unsettled: c.unsettled, today: day, dryRun });
  const sent = await sendNote(note, { sendTg, dryRun, log });
  return { day, dryRun, raw: h.raw, inWindow: h.items.length, dead: h.dead, admitted: c.admitted.length,
    excluded: c.excluded.length, unsettled: c.unsettled.length, calls: c.calls, modelFailed: c.modelFailed,
    written, fetched: docs.fetched, pending: docs.pending, triggers, swept, note, sent };
}

module.exports = { run, harvest, classifyAll, getText, REGISTRY, WINDOW_DAYS, PACE_MS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  run({ dryRun: argv.includes('--dry-run') })
    .then(r => { if (!r.dryRun && r.note.count) console.log('[watch] note sent: ' + r.sent.sent); })
    .catch(e => { console.error('[watch] failed: ' + (e && e.stack || e)); process.exit(1); });
}
