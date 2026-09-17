#!/usr/bin/env node
'use strict';
// The weekly freshness check for a knowledge pack - any of them.
//
//   node --env-file=.env ops/packs/freshness.js --pack banking             re-fetch, update, re-ingest, tell Ibrahim if something moved
//   node --env-file=.env ops/packs/freshness.js --pack banking --dry-run   do all of it and write, ingest and send NOTHING
//
// Cron, one pack an hour so that no two fetchers ever run at once:
//   0 4 * * 0  knowledge/crawl.js
//   0 5 * * 0  ops/travel/freshness.js                      (the airline, through its shim)
//   0 6 * * 0  ops/packs/freshness.js --pack banking
//
// The rule Ibrahim set: one note, and only when something changed or vanished. A week in which no bank and no
// airline edited a page sends nothing at all - an alert that arrives every week is an alert nobody reads.
//
// The exception is a failure. If the site could not be checked, that IS the news: a weekly check that fails
// silently is worse than no check, because the pack goes stale while the calendar says it is fresh.
//
// A page that did not answer is NOT a page that vanished. One bad fetch records a miss and keeps the
// document live; only an explicit 404/410/soft-404, or a second miss the following Sunday, marks it gone.
// The note says which of the two happened, because they call for different things from the reader.
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchSite: realFetchSite, stripPackBoilerplate, writePack, readMeta, makeFetcher, packDir,
  rerenderPack, AM_HEADERS, MIN_CHARS } = require('./fetch-pack');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const packFile = pack => path.join(packDir(pack), 'sources.json');
// The sidecar of Amharic headers lives in the pack directory beside the documents it describes, so a run that
// writes somewhere else - every test does - reads that directory's sidecar and never the live pack's.
const sidecarFile = dir => path.join(dir, AM_HEADERS);
const readSidecar = dir => { try { return JSON.parse(fs.readFileSync(sidecarFile(dir), 'utf8')); } catch (e) { return null; } };

// Telegram: the same bot and the same chats ops/health/weekly-audit.js already uses, so there is one place
// to change where operational news goes. One message, sent to each admin chat.
async function sendTgReal(text) {
  const token = process.env.BINA_RIDER_BOT_TOKEN || process.env.BINASMART_TG_TOKEN || '';
  const chats = [...new Set([process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].map(c => String(c || '').trim()).filter(Boolean))];
  if (!token || !chats.length) { console.error('[pack-freshness] no bot token or admin chat configured — the note is mute'); return false; }
  let delivered = false;
  for (const chat of chats) {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }),
    }).catch(() => null);
    if (r && r.ok) delivered = true;
  }
  if (!delivered) console.error('[pack-freshness] NO DELIVERY ROUTE WORKED — the note is mute');
  return delivered;
}

async function runIngestReal(pack = 'travel') {
  const out = execFileSync('/usr/bin/node', ['--env-file=.env', 'knowledge/ingest.js', '--source', pack],
    { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60 * 1000 });
  const last = out.trim().split('\n').pop();
  try { return JSON.parse(last); } catch (e) { return { raw: out.slice(-400) }; }
}

// ---------- the Amharic sidecar, when a page really changed ----------
// knowledge/<pack>/am-headers.json holds an Amharic title and summary for every English document, generated
// from ONE version of that page's text and stamped with that text's hash. The day a bank edits the page, the
// entry describes the page as it was last week: a fee that moved, a product that went. ops/packs/fetch-pack.js
// refuses to render an entry whose hash no longer matches, so nothing stale is ever published; dropping the
// entry here is what makes ops/packs/am-headers.js --only-missing write it again from the new text, at its own
// 4 s pacing and with its own grounding check on every digit.
function dropStaleAmHeaders(dir, slugs, { dryRun = false } = {}) {
  const side = readSidecar(dir);
  if (!side) return [];
  const dropped = slugs.filter(s => side[s]);
  if (!dropped.length || dryRun) return dropped;
  for (const s of dropped) delete side[s];
  fs.writeFileSync(sidecarFile(dir), JSON.stringify(side, null, 1) + '\n');
  return dropped;
}

// The generator, in its own process, with the pack's own API key from .env. --only-missing is exact after the
// drop above: the entries that are missing are precisely the pages that changed and the pages that are new.
function runAmHeadersReal(pack) {
  const out = execFileSync('/usr/bin/node', ['--env-file=.env', 'ops/packs/am-headers.js', '--pack', pack, '--only-missing'],
    { cwd: ROOT, encoding: 'utf8', timeout: 60 * 60 * 1000 });
  const last = out.trim().split('\n').pop();
  try { return JSON.parse(last); } catch (e) { return { raw: out.slice(-400) }; }
}

// Writing the new Amharic header into the documents is a re-render: no institution is asked for anything and
// no page text moves. It is what we did, not what a bank did, so it is counted in the log and never in the note.
async function rerenderReal(dir, packId) {
  const reg = JSON.parse(fs.readFileSync(packFile(packId), 'utf8'));
  return rerenderPack(dir, reg, { amHeaders: readSidecar(dir) });
}

// More than half the pages moving at once is the airline changing its template, not 32 separate edits.
const MASS_CHANGE = 0.5;
const label = (rep, slug) => (rep.titles && rep.titles[slug]) ? rep.titles[slug] : slug;

// One message. Written to be read on a phone.
function noteFor(reports, { today, pack, extra } = {}) {
  const lines = [];
  let headline = 0;
  for (const rep of reports) {
    if (rep.refused) { lines.push('⚠️ ' + rep.name + ': could not be checked — ' + rep.refusedWhy + '. The pack was left exactly as it was.'); headline++; continue; }
    if (rep.failed) lines.push('… ' + rep.name + ': ' + rep.failed + ' page(s) did not answer this time');
    if (rep.changed.length && rep.total && rep.changed.length > rep.total * MASS_CHANGE) {
      lines.push('⚠️ ' + rep.name + ': ' + rep.changed.length + ' of ' + rep.total + ' pages changed at once — that is a site-wide template change, not ' + rep.changed.length + ' edits');
      headline++;
    } else if (rep.changed.length) {
      lines.push('✏️ ' + rep.name + ': ' + rep.changed.length + ' page(s) changed');
      for (const s of rep.changed.slice(0, 8)) lines.push('   • ' + label(rep, s));
      if (rep.changed.length > 8) lines.push('   • … and ' + (rep.changed.length - 8) + ' more');
      headline += rep.changed.length;
    }
    if (rep.added.length) {
      lines.push('➕ ' + rep.name + ': ' + rep.added.length + ' new page(s)');
      for (const s of rep.added.slice(0, 6)) lines.push('   • ' + label(rep, s));
      headline += rep.added.length;
    }
    if (rep.gone.length) {
      lines.push('🗑 ' + rep.name + ': ' + rep.gone.length + ' page(s) gone from the site');
      for (const s of rep.gone.slice(0, 6)) lines.push('   • ' + label(rep, s) + ' — ' + ((rep.goneWhy && rep.goneWhy[s]) || '404'));
      headline += rep.gone.length;
    }
    // Not gone: not fetched. A page that timed out is still live, still indexed, still on disk - and is
    // named here so a second bad week is not a surprise when it marks the page gone.
    if (rep.missed && rep.missed.length) {
      lines.push('⏳ ' + rep.name + ': ' + rep.missed.length + ' page(s) could not be fetched this week (kept)');
      if (rep.missed.length <= 5) for (const s of rep.missed) lines.push('   • ' + label(rep, s) + ' — kept, marked gone only if it is missing again next week');
      else lines.push('   • kept as they are; any still missing next week is marked gone');
      headline += rep.missed.length;
    }
    if (rep.revived.length) lines.push('↩️ ' + rep.name + ': ' + rep.revived.length + ' page(s) are back');
    if (rep.ingest) lines.push('   re-indexed: +' + rep.ingest.inserted + ' chunks, −' + rep.ingest.deleted + ' stale');
  }
  return (pack && pack.noteTitle ? pack.noteTitle : '📚 Knowledge pack') + ' — ' + headline + ' thing(s) moved\n\n'
    + lines.join('\n') + (extra || '')
    + '\n\n' + (today || new Date().toISOString().slice(0, 10)) + ' · ops/packs/freshness.js --pack ' + ((pack && pack.id) || '');
}

// Called with the manual AND the dir sources: both are hosts this server could not reach, and the difference
// between them is only whether somebody has already fetched them by hand.
// A manual source is one we could not reach when the registry was written. Five of the banking pack's seven
// are unreachable hosts rather than blocked ones, so they may simply come back - and the day one does is the
// day it can become a fetched source. Probing them costs one request a week each and is the only way that day
// gets noticed. Two kinds are never probed. A source marked doNotFetch: awashbank.com currently resolves to
// somebody else's blocked page, and a weekly request to it is a weekly request to a stranger. And a source
// whose reach is already "up" - safaricom.et answers every time, and so does the airline's cargo site; both
// are manual for quite different reasons - because knocking on a door that always opens would send the same
// note every Sunday for ever, which is the alert nobody reads.
async function probeManual(sites, { get } = {}) {
  const fetcher = get || makeFetcher({ delayMs: 5000, timeoutMs: 20000 });
  const out = {};
  for (const s of sites) {
    if (s.doNotFetch || !s.host || /^up$/i.test(String(s.reach || '').trim())) continue;
    const r = await fetcher('https://' + s.host + '/');
    out[s.id] = r.ok ? { ok: true, chars: (r.html || '').length } : { ok: false, why: r.why };
  }
  return out;
}

// Only a source that has come back is news. One that is still unreachable is the same fact as last week.
function manualNote(sites, probed) {
  const back = sites.filter(s => probed[s.id] && probed[s.id].ok);
  if (!back.length) return '';
  return '\n\n🔓 ' + back.length + ' source(s) we could not reach now answer:\n'
    + back.map(s => '   • ' + s.name + ' (' + s.host + ') — ' + probed[s.id].chars
      + ' bytes. It can become a fetched source; that is a change to knowledge/' + (s.pack || 'banking') + '/sources.json, not something this job does.').join('\n');
}

// Everything injectable, so the tests run the real decisions with no network, no database and no Telegram.
async function run({ packId = 'travel', pack, dir, today, dryRun = false, sites, manualSites,
  fetchSite = realFetchSite, sendTg = sendTgReal, runIngest = runIngestReal,
  runAmHeaders = runAmHeadersReal, rerender = rerenderReal, log = m => console.log(m) } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const reg = (pack && sites) ? null : JSON.parse(fs.readFileSync(packFile(packId), 'utf8'));
  const cfg = pack || (reg && reg.pack) || { id: packId };
  dir = dir || packDir(cfg.id || packId);
  // A `dir` site is not fetched weekly either: its pages came off somebody's laptop, not off the network, and
  // re-importing a harvest that has not changed would be a fetch of nothing. It IS still knocked on below,
  // because the whole point of the door-knock is to notice the day nbe.gov.et answers this server reliably and
  // the hand harvest can stop.
  const list = sites || reg.sites.filter(s => s.fetch !== 'manual' && s.fetch !== 'dir');
  // A caller that names its own sites names its own manual sources too. Without that, a test that injects a
  // site list would still knock on every unreachable host in the registry on the real network, which is the
  // one thing every test here is built not to do.
  const manual = manualSites || ((reg && !sites) ? reg.sites.filter(s => s.fetch === 'manual' || s.fetch === 'dir') : []);
  // The Amharic sidecar has to reach writePack, or every unchanged English document would be re-rendered
  // without the Amharic header ops/packs/am-headers.js wrote for it: the weekly check would quietly undo it.
  const amHeaders = cfg.amHeaders ? readSidecar(dir) : null;
  // fetchSite tags its own progress lines with the pack it is given, so a banking run never says [travel].
  // The rewrite below is the belt to that pair of braces: an injected fetchSite, and any older caller that
  // still writes the tag itself, are corrected rather than believed.
  const prefix = cfg.logPrefix || cfg.id || packId;
  const say = m => log(String(m).replace(/^\[travel\]/, '[' + prefix + ']'));
  const reports = [];
  let moved = false, anyRefused = false;

  for (const site of list) {
    const { pages, failed } = await fetchSite(site, { log: say, tag: prefix });
    const docs = stripPackBoilerplate(pages).filter(d => d.text.trim().length >= MIN_CHARS);
    const r = writePack(dir, docs, site, { today: day, dryRun, failed, pack: cfg, amHeaders });
    const titles = {};
    for (const d of docs) titles[d.slug] = d.title;
    const total = r.added.length + r.changed.length + r.unchanged.length;
    const rep = { site: site.id, name: site.name, total, titles, failed: failed.length,
      added: r.added || [], changed: r.changed || [], unchanged: r.unchanged || [], gone: r.gone || [],
      reformatted: r.reformatted || [], goneWhy: r.goneWhy || {}, missed: r.missed || [],
      revived: r.revived || [], refused: !!r.refused, refusedWhy: r.refusedWhy };
    if (rep.refused) anyRefused = true;
    else if (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length || rep.missed.length) moved = true;
    log('[' + prefix + '-freshness] ' + site.id + ': +' + rep.added.length + ' new, ' + rep.changed.length + ' changed, '
      + rep.unchanged.length + ' unchanged, ' + rep.reformatted.length + ' re-rendered, ' + rep.gone.length + ' gone, ' + rep.missed.length + ' kept after a failed fetch, ' + rep.failed + ' failed'
      + (rep.refused ? '  REFUSED: ' + rep.refusedWhy : '') + (dryRun ? '  [DRY RUN]' : ''));
    reports.push(rep);
  }

  // A re-render is not a change and never breaks the silence: it is this repository writing a header, not an
  // institution editing a page. Only added, changed, gone, revived, a missed page, a refusal and a source that
  // has come back set `moved`, and only `moved` sends a note.
  let quiet = !moved && !anyRefused;
  const tag = '[' + prefix + '-freshness] ';
  const result = { quiet, refused: anyRefused, reports,
    added: reports.flatMap(r => r.added), changed: reports.flatMap(r => r.changed), gone: reports.flatMap(r => r.gone),
    missed: reports.flatMap(r => r.missed), reformatted: reports.flatMap(r => r.reformatted || []) };
  const setQuiet = v => { quiet = v; result.quiet = v; };

  // Probe the sources we could not reach, whatever else happened. A pack whose telebirr source came back and
  // nobody noticed for a month is a pack that was stale on purpose.
  const probed = manual.length ? await probeManual(manual).catch(() => ({})) : {};
  const back = manualNote(manual.map(s => ({ ...s, pack: cfg.id || packId })), probed);
  if (back) { result.manualBack = Object.keys(probed).filter(k => probed[k] && probed[k].ok); moved = true; setQuiet(false); }

  if (quiet && !back) { log(tag + 'nothing changed — no note sent, which is the point'); return result; }
  if (dryRun) { log(tag + 'would have sent:\n' + noteFor(reports, { today: day, pack: cfg, extra: back })); return result; }

  // The Amharic header of a page that really changed is a summary of the page as it was, so it is dropped,
  // written again from the new text and re-rendered into the documents BEFORE the ingest - otherwise the index
  // would carry last week's Amharic summary for a week. A pack that asks for no Amharic headers, and a pack
  // that has no sidecar on disk yet, skip all of it.
  const touched = [...result.added, ...result.changed];
  if (cfg.amHeaders && touched.length && readSidecar(dir)) {
    try {
      const dropped = dropStaleAmHeaders(dir, touched);
      const gen = await runAmHeaders(cfg.id || packId);
      const rr = await rerender(dir, cfg.id || packId);
      result.amHeaders = { dropped: dropped.length, entries: (gen && gen.entries) || 0,
        rerendered: (rr && rr.rerendered) ? rr.rerendered.length : 0 };
      log(tag + 'Amharic headers: ' + dropped.length + ' stale entry(ies) dropped and written again, '
        + result.amHeaders.rerendered + ' document(s) re-rendered');
    } catch (e) { result.amHeaders = { failed: e.message }; log(tag + 'Amharic headers failed: ' + e.message); }
  }

  if (moved) {
    for (const rep of reports) if (!rep.refused && (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length)) {
      try { rep.ingest = await runIngest(cfg.id || packId); } catch (e) { rep.ingest = null; log(tag + 'ingest failed: ' + e.message); }
      break;   // one ingest covers the whole source, whichever site moved
    }
  }
  const note = noteFor(reports, { today: day, pack: cfg, extra: back });
  log(note);
  await sendTg(note);
  return result;
}

module.exports = { run, noteFor, probeManual, manualNote, dropStaleAmHeaders, sendTgReal, runIngestReal,
  runAmHeadersReal, rerenderReal, MASS_CHANGE, packFile };

//   node --env-file=.env ops/packs/freshness.js --pack banking
//   node --env-file=.env ops/packs/freshness.js --pack banking --dry-run
if (require.main === module) {
  const argv = process.argv.slice(2);
  const packId = argv.includes('--pack') ? argv[argv.indexOf('--pack') + 1] : 'travel';
  run({ packId, dryRun: argv.includes('--dry-run') })
    .catch(e => { console.error('[' + packId + '-freshness] failed: ' + e.message); process.exit(1); });
}
