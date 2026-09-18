'use strict';
// The document behind the post (design §5.6).
//
// NBE's channel is why this exists: nine pack-grade notices in a month, every one a 41–79-character title
// whose substance is an image or a PDF on nbe.gov.et. The channel tells you a document exists and when; it
// does not tell you what is in it.
//
// Where the bytes go is the whole discipline. They land in /root/storage/packs/watch-manual/<host>/ with a
// manifest in exactly the shape ops/packs/fetch-pack.js --from-dir reads, and the pack is then built from that
// harvest by a person or by the 02:10 trigger — `node ops/packs/fetch-pack.js --pack banking --from-dir
// /root/storage/packs/watch-manual`. The watch never writes into a pack directory itself: a pack is curated,
// and a Telegram link is not curation. assertHarvestRoot refuses any other directory under packs/.
//
// And a failure is not a lost item. mols, ecc, mint, fsc, egov, esl, daro and eeu all time out from this VPS
// today, so a failed fetch sets `pendingDocument` on the item — the watch document is written anyway, with
// pending_document: "yes", and the daily note names it so the file can be fetched by the laptop route,
// exactly as the banking manual harvest was done on 17 September.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OFFICES } = require('./classify');
// The pack fetcher's own user agent, not a new one: an office that has decided to answer BinaSmart should not
// have to decide again for every script we write.
const { UA } = require('../../packs/fetch-pack');

const HARVEST_ROOT = '/root/storage/packs/watch-manual';
const DELAY_MS = 5000;
const TIMEOUT_MS = 40000;
const MAX_BYTES = 25 * 1024 * 1024;

// A harvest root that is a pack's own directory would put an uncurated Telegram attachment where a curated
// document lives. Under /root/storage/packs only watch-manual is ours; a temp directory in a test is nobody's.
function assertHarvestRoot(root) {
  const r = String(root || '').replace(/\/+$/, '');
  if (!r.startsWith('/root/storage/packs/')) return r;
  if (path.basename(r) !== 'watch-manual') throw new Error('the watch writes only into watch-manual, never into ' + r);
  return r;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } }
function pathOf(u) { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return '/'; } }
const NEVER = /(^|\.)(t\.me|telegram\.org|telegram\.me|telesco\.pe)$/i;

const EXT = [[/pdf/, '.pdf'], [/json/, '.json'], [/msword|officedocument\.wordprocessing/, '.doc'],
  [/excel|officedocument\.spreadsheet/, '.xls'], [/image\/jpeg/, '.jpg'], [/image\/png/, '.png'],
  [/xml/, '.xml'], [/text\/plain/, '.txt']];
// The file name is the sha1 of the url, as the banking harvest names its files, so the same url fetched twice
// overwrites itself instead of growing a second copy nobody can tell from the first.
function fileNameFor(url, contentType) {
  const ct = String(contentType || '');
  let ext = '.html';
  for (const [re, e] of EXT) if (re.test(ct)) { ext = e; break; }
  if (ext === '.html' && /\.pdf($|\?)/i.test(String(url))) ext = '.pdf';
  return crypto.createHash('sha1').update(String(url)).digest('hex') + ext;
}

// Which of an item's links is the document behind it: a PDF anywhere, or a page on a .gov.et host or one of
// the office's own hosts at an address deeper than that host's front page. Never the Telegram post itself, and
// never a newspaper article — a Fana story about a directive is not the directive.
function documentLinks(item) {
  const post = (item && item.post) || {};
  const office = String((item && item.office) || (item && item.source && item.source.office) || '');
  const hosts = ((OFFICES[office] || {}).hosts) || [];
  const out = [];
  for (const u of post.links || []) {
    const h = hostOf(u);
    if (!h || NEVER.test(h)) continue;
    if (!/^https?:$/.test((() => { try { return new URL(u).protocol; } catch (e) { return ''; } })())) continue;
    const isPdf = /\.pdf($|\?)/i.test(u);
    const mine = /\.gov\.et$/.test(h) || hosts.some(x => h === x || h.endsWith('.' + x));
    if (!isPdf && !mine) continue;
    // A signature link to http://www.ecc.gov.et/ sits under every post the commission writes. A front page is
    // not this post's document; a deeper address, a file, or one of the office's subdomains is.
    const deeper = pathOf(u).replace(/\/+$/, '').length > 0;
    const sub = hosts.some(x => h !== x && h.endsWith('.' + x));
    if (!isPdf && !deeper && !sub) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

function readManifest(dir) {
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); return Array.isArray(j) ? j : []; }
  catch (e) { return []; }
}

// items: the admitted items, as the classifier hands them over. Mutates each one it could not fetch for with
// `pendingDocument = true`, because that flag has to reach both the writer and the note.
async function fetchDocuments(items, { fetchImpl, sleep, root = HARVEST_ROOT, delayMs = DELAY_MS,
  ua = UA, timeoutMs = TIMEOUT_MS, now, log = () => {} } = {}) {
  const dir0 = assertHarvestRoot(root);
  const f = fetchImpl || ((...a) => fetch(...a));
  const zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const fetched = [], pending = [];
  let first = true;
  for (const item of items || []) {
    const urls = documentLinks(item);
    if (!urls.length) continue;
    const url = urls[0];
    if (first) first = false; else await zz(delayMs);
    const at = String(now || new Date().toISOString());
    let r = null, why = '';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      r = await f(url, { signal: ctrl.signal, redirect: 'follow',
        headers: { 'user-agent': ua, 'accept-language': 'en', accept: 'application/pdf,text/html,application/xhtml+xml,*/*;q=0.8' } });
    } catch (e) {
      r = null;
      why = e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e).slice(0, 60);
    } finally { clearTimeout(t); }
    if (r && r.status !== 200) why = 'http_' + r.status;
    let buf = null;
    if (r && r.status === 200) {
      try { buf = Buffer.from(await r.arrayBuffer()); } catch (e) { why = 'unreadable'; }
      if (buf && !buf.length) why = 'empty';
      if (buf && buf.length > MAX_BYTES) { why = 'too_big'; buf = null; }
    }
    if (!buf || why) {
      item.pendingDocument = true;
      pending.push({ item, url, why: why || 'unreachable', office: item.office || null, post: (item.post || {}).url || '' });
      log('[watch] document pending (' + (why || 'unreachable') + '): ' + url);
      continue;
    }
    const host = hostOf(url);
    const dir = path.join(dir0, host);
    fs.mkdirSync(dir, { recursive: true });
    const ct = String((r.headers && r.headers.get('content-type')) || '');
    const file = fileNameFor(url, ct);
    fs.writeFileSync(path.join(dir, file), buf);
    const entry = { url, file, status: 200, contentType: ct || 'application/octet-stream', bytes: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'), fetchedAt: at,
      // where it came from, so a later reader of the harvest can see this was a channel item and not a crawl
      from: 'watch', postUrl: (item.post || {}).url || '', office: item.office || null };
    const man = readManifest(dir).filter(e => e.url !== url);
    man.push(entry);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
    item.document = { url, file, host, dir };
    fetched.push({ item, url, host, file, bytes: buf.length });
    log('[watch] document fetched: ' + url + ' (' + buf.length + ' bytes)');
  }
  return { fetched, pending };
}

module.exports = { documentLinks, fetchDocuments, assertHarvestRoot, fileNameFor, readManifest,
  HARVEST_ROOT, DELAY_MS, TIMEOUT_MS };
