'use strict';
// The pack re-fetch trigger (design §5.12).
//
// The customs and NBE cases are the same shape: the channel says a document exists, and the pack that owns
// that office should go and get it the same night instead of waiting for Sunday. So an admitted item that
// carries a directive word and comes from an office that owns a pack appends one line to
// /root/storage/packs/<pack>-refetch.json, and at 02:10 ops/watch/channels/refetch.js runs
// ops/packs/freshness.js --pack <pack> for exactly the packs named there.
//
// Two things keep this from becoming a second crawler. It only ever calls the freshness check that already
// exists — it fetches nothing itself — and freshness.js reads and CLEARS the trigger at the top of its run,
// so a trigger is acted on once, the Sunday 05:00/06:00/07:00 runs are untouched, and a pack that was
// triggered and then ran on Sunday anyway does not run twice.
//
// An office with no pack (ethio telecom, the Addis bureaux) triggers nothing. That is not an oversight: there
// is no pack for the fetcher to refresh, and the watch document is already the answer.

const fs = require('fs');
const path = require('path');
const { firstHit, DIRECTIVE } = require('./classify');

const TRIGGER_DIR = '/root/storage/packs';
const PACK = /^[a-z][a-z0-9-]{1,30}$/;   // the same shape ops/packs/fetch-pack.js packDir accepts

function triggerFile(pack, dir = TRIGGER_DIR) {
  if (!PACK.test(String(pack || ''))) throw new Error('not a pack name: ' + pack);
  return path.join(dir, pack + '-refetch.json');
}

function readTrigger(pack, { dir = TRIGGER_DIR } = {}) {
  try { const j = JSON.parse(fs.readFileSync(triggerFile(pack, dir), 'utf8')); return Array.isArray(j) ? j : []; }
  catch (e) { return []; }
}

// Read and clear, in one step, because a trigger that is read and not cleared is a pack that re-fetches every
// night for ever. A dry run reads and leaves the file exactly as it was.
function takeTrigger(pack, { dir = TRIGGER_DIR, dryRun = false } = {}) {
  const rows = readTrigger(pack, { dir });
  if (!rows.length || dryRun) return rows;
  try { fs.unlinkSync(triggerFile(pack, dir)); } catch (e) { /* already gone is the state we wanted */ }
  return rows;
}

function packOf(item, registry) {
  const fromSource = item && item.source && item.source.pack;
  if (fromSource) return fromSource;
  const office = String((item && item.office) || '');
  const rows = (registry && registry.sources) || [];
  const hit = rows.find(s => s.office === office && s.pack);
  return hit ? hit.pack : null;
}

// The rows an admitted set of items would write, without writing anything.
function triggersFor(items, { registry, now } = {}) {
  const at = String(now || new Date().toISOString());
  const out = [];
  for (const item of items || []) {
    if (!item || !item.admit) continue;
    const pack = packOf(item, registry);
    if (!pack || !PACK.test(pack)) continue;
    const post = item.post || {};
    const word = firstHit(String(post.text || ''), DIRECTIVE);
    if (!word) continue;   // a price, an offer or a service note does not send a fetcher out at two in the morning
    out.push({ pack, office: item.office || (item.source && item.source.office) || null,
      directive: word, title: String(post.text || '').split('\n')[0].slice(0, 120).trim(),
      post: post.url || '', reported_at: post.date || '', at });
  }
  return out;
}

// Append, de-duplicated on the post url, so a re-run of the same morning does not queue the same notice twice.
function appendTriggers(items, { registry, dir = TRIGGER_DIR, now, dryRun = false, log = () => {} } = {}) {
  const rows = triggersFor(items, { registry, now });
  const byPack = {};
  for (const r of rows) (byPack[r.pack] || (byPack[r.pack] = [])).push(r);
  const written = {};
  for (const [pack, list] of Object.entries(byPack)) {
    const have = readTrigger(pack, { dir });
    const fresh = list.filter(r => !have.some(h => h.post && h.post === r.post));
    if (!fresh.length) continue;
    written[pack] = fresh;
    log('[watch] ' + pack + ': ' + fresh.length + ' item(s) queued for a pack re-fetch'
      + (dryRun ? ' [DRY RUN — nothing written]' : ''));
    if (dryRun) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(triggerFile(pack, dir), JSON.stringify(have.concat(fresh), null, 1) + '\n');
  }
  return written;
}

// Which packs have something waiting. Read-only: refetch.js decides what to do about it.
function pendingPacks({ dir = TRIGGER_DIR } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  for (const n of names) {
    const m = /^([a-z][a-z0-9-]{1,30})-refetch\.json$/.exec(n);
    if (!m) continue;
    if (readTrigger(m[1], { dir }).length) out.push(m[1]);
  }
  return out.sort();
}

module.exports = { triggersFor, appendTriggers, readTrigger, takeTrigger, pendingPacks, triggerFile, TRIGGER_DIR };
