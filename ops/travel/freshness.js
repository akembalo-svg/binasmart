#!/usr/bin/env node
'use strict';
// The weekly freshness check for the travel knowledge pack.
//
//   node --env-file=.env ops/travel/freshness.js            re-fetch, update, re-ingest, tell Ibrahim if something moved
//   node --env-file=.env ops/travel/freshness.js --dry-run   do all of it and write, ingest and send NOTHING
//
// Cron, Sunday 05:00 UTC - an hour after knowledge/crawl.js at 04:00, so the two are never fetching at once:
//   0 5 * * 0 cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/travel/freshness.js >> /var/log/bina-travel-freshness.log 2>&1
//
// The rule Ibrahim set: one note, and only when something changed or vanished. A week in which the airline
// changed nothing sends nothing at all - an alert that arrives every week is an alert nobody reads.
//
// The exception is a failure. If the site could not be checked, that IS the news: a weekly check that fails
// silently is worse than no check, because the pack goes stale while the calendar says it is fresh.
//
// A page that did not answer is NOT a page that vanished. One bad fetch records a miss and keeps the
// document live; only an explicit 404/410/soft-404, or a second miss the following Sunday, marks it gone.
// The note says which of the two happened, because they call for different things from the reader.
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchSite: realFetchSite, stripPackBoilerplate, writePack, readMeta, OUT_DIR, REGISTRY, MIN_CHARS } =
  require('./fetch-airline');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

// Telegram: the same bot and the same chats ops/health/weekly-audit.js already uses, so there is one place
// to change where operational news goes. One message, sent to each admin chat.
async function sendTgReal(text) {
  const token = process.env.BINA_RIDER_BOT_TOKEN || process.env.BINASMART_TG_TOKEN || '';
  const chats = [...new Set([process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].map(c => String(c || '').trim()).filter(Boolean))];
  if (!token || !chats.length) { console.error('[travel-freshness] no bot token or admin chat configured — the note is mute'); return false; }
  let delivered = false;
  for (const chat of chats) {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }),
    }).catch(() => null);
    if (r && r.ok) delivered = true;
  }
  if (!delivered) console.error('[travel-freshness] NO DELIVERY ROUTE WORKED — the note is mute');
  return delivered;
}

async function runIngestReal() {
  const out = execFileSync('/usr/bin/node', ['--env-file=.env', 'knowledge/ingest.js', '--source', 'travel'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60 * 1000 });
  const last = out.trim().split('\n').pop();
  try { return JSON.parse(last); } catch (e) { return { raw: out.slice(-400) }; }
}

// More than half the pages moving at once is the airline changing its template, not 32 separate edits.
const MASS_CHANGE = 0.5;
const label = (rep, slug) => (rep.titles && rep.titles[slug]) ? rep.titles[slug] : slug;

// One message. Written to be read on a phone.
function noteFor(reports, { today } = {}) {
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
  return '✈️ Airline knowledge pack — ' + headline + ' thing(s) moved\n\n' + lines.join('\n')
    + '\n\n' + (today || new Date().toISOString().slice(0, 10)) + ' · ops/travel/freshness.js';
}

// Everything injectable, so the tests run the real decisions with no network, no database and no Telegram.
async function run({ dir = OUT_DIR, today, dryRun = false, sites, fetchSite = realFetchSite,
  sendTg = sendTgReal, runIngest = runIngestReal, log = m => console.log(m) } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const list = sites || JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).sites.filter(s => s.fetch !== 'manual');
  const reports = [];
  let moved = false, anyRefused = false;

  for (const site of list) {
    const { pages, failed } = await fetchSite(site, { log });
    const docs = stripPackBoilerplate(pages).filter(d => d.text.trim().length >= MIN_CHARS);
    const r = writePack(dir, docs, site, { today: day, dryRun, failed });
    const titles = {};
    for (const d of docs) titles[d.slug] = d.title;
    const total = r.added.length + r.changed.length + r.unchanged.length;
    const rep = { site: site.id, name: site.name, total, titles, failed: failed.length,
      added: r.added || [], changed: r.changed || [], unchanged: r.unchanged || [], gone: r.gone || [],
      goneWhy: r.goneWhy || {}, missed: r.missed || [],
      revived: r.revived || [], refused: !!r.refused, refusedWhy: r.refusedWhy };
    if (rep.refused) anyRefused = true;
    else if (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length || rep.missed.length) moved = true;
    log('[travel-freshness] ' + site.id + ': +' + rep.added.length + ' new, ' + rep.changed.length + ' changed, '
      + rep.unchanged.length + ' unchanged, ' + rep.gone.length + ' gone, ' + rep.missed.length + ' kept after a failed fetch, ' + rep.failed + ' failed'
      + (rep.refused ? '  REFUSED: ' + rep.refusedWhy : '') + (dryRun ? '  [DRY RUN]' : ''));
    reports.push(rep);
  }

  const quiet = !moved && !anyRefused;
  const result = { quiet, refused: anyRefused, reports,
    added: reports.flatMap(r => r.added), changed: reports.flatMap(r => r.changed), gone: reports.flatMap(r => r.gone),
    missed: reports.flatMap(r => r.missed) };

  if (quiet) { log('[travel-freshness] nothing changed — no note sent, which is the point'); return result; }
  if (dryRun) { log('[travel-freshness] would have sent:\n' + noteFor(reports, { today: day })); return result; }

  if (moved) {
    for (const rep of reports) if (!rep.refused && (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length)) {
      try { rep.ingest = await runIngest(); } catch (e) { rep.ingest = null; log('[travel-freshness] ingest failed: ' + e.message); }
      break;   // one ingest covers the whole `travel` source, whichever site moved
    }
  }
  const note = noteFor(reports, { today: day });
  log(note);
  await sendTg(note);
  return result;
}

module.exports = { run, noteFor, sendTgReal, runIngestReal, MASS_CHANGE };
if (require.main === module) run({ dryRun: process.argv.includes('--dry-run') })
  .catch(e => { console.error('[travel-freshness] failed: ' + e.message); process.exit(1); });
