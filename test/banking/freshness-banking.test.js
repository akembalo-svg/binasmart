'use strict';
// The weekly check for the banking pack, with no network, no database and no Telegram: every one of those is
// injected. What is tested is the decisions — when a note is sent, what it says, and what it refuses to do.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const F = require('../../ops/packs/freshness.js');
const P = require('../../ops/packs/fetch-pack.js');
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'banking', 'sources.json'), 'utf8'));

const site = { id: 'zemen', name: 'Zemen Bank', nameAm: 'የዘመን ባንክ', host: 'zemenbank.com', lang: 'en',
  fetch: 'sitemap', sitemaps: ['https://zemenbank.com/x.xml'], maxPages: 5, crawlDelaySeconds: 5,
  allow: ['^/tariff$'], deny: [], sections: [{ key: 'fees', titleAm: 'ክፍያዎችና ታሪፍ', match: '^/' }] };

const page = (slug, text) => ({ siteId: 'zemen', slug, path: '/' + slug, url: 'https://zemenbank.com/' + slug + '/',
  title: slug, section: 'fees', sectionTitleAm: 'ክፍያዎችና ታሪፍ', lang: 'en', text });
const LONG = ' The bank publishes this schedule of charges for its account holders and card holders.'.repeat(12);

function tmpPack() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  return d;
}

test('a week in which nothing changed sends nothing', async () => {
  const dir = tmpPack();
  const pages = [page('zemen-tariff', 'a' + LONG)];
  const fetchSite = async () => ({ pages, failed: [] });
  let sent = 0;
  await F.run({ dir, pack: reg.pack, sites: [site], today: '2026-09-20', fetchSite, log: () => {},
    sendTg: async () => { sent++; return true; }, runIngest: async () => ({ inserted: 0, deleted: 0 }) });
  const r = await F.run({ dir, pack: reg.pack, sites: [site], today: '2026-09-27', fetchSite, log: () => {},
    sendTg: async () => { sent++; return true; }, runIngest: async () => ({ inserted: 0, deleted: 0 }) });
  assert.equal(r.quiet, true, 'the second week changed nothing and must be quiet');
  assert.equal(sent, 1, 'only the first week, which added the page, should have sent anything');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a changed tariff sends a note that names the page', async () => {
  const dir = tmpPack();
  const first = [page('zemen-tariff', 'card issuance 50 birr.' + LONG)];
  const second = [page('zemen-tariff', 'card issuance 75 birr.' + LONG)];
  let note = '';
  const opts = { dir, pack: reg.pack, sites: [site], log: () => {}, sendTg: async t => { note = t; return true; },
    runIngest: async () => ({ inserted: 3, deleted: 1 }) };
  await F.run({ ...opts, today: '2026-09-20', fetchSite: async () => ({ pages: first, failed: [] }) });
  const r = await F.run({ ...opts, today: '2026-09-27', fetchSite: async () => ({ pages: second, failed: [] }) });
  assert.equal(r.quiet, false);
  assert.deepEqual(r.changed, ['zemen-tariff']);
  assert.match(note, /Zemen Bank/);
  assert.match(note, /Banking/i, 'the note must say which pack it is about');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('one bad fetch keeps the page and says it was kept', async () => {
  const dir = tmpPack();
  const pages = [page('zemen-tariff', 'x' + LONG)];
  let note = '';
  const opts = { dir, pack: reg.pack, sites: [site], log: () => {}, sendTg: async t => { note = t; return true; },
    runIngest: async () => ({ inserted: 0, deleted: 0 }) };
  await F.run({ ...opts, today: '2026-09-20', fetchSite: async () => ({ pages, failed: [] }) });
  const r = await F.run({ ...opts, today: '2026-09-27',
    fetchSite: async () => ({ pages: [], failed: [{ url: 'https://zemenbank.com/zemen-tariff/', why: 'timeout' }] }) });
  assert.deepEqual(r.gone, [], 'a timeout is not a deletion');
  assert.deepEqual(r.missed, ['zemen-tariff']);
  assert.match(note, /could not be fetched/);
  const still = fs.readFileSync(path.join(dir, 'zemen-tariff.md'), 'utf8');
  assert.match(still, /status: "live"/, 'the document stays live and indexed after one bad fetch');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a manual source that has come back is reported', async () => {
  const manual = [{ id: 'ethiotelecom', name: 'Ethio telecom — telebirr', host: 'www.ethiotelecom.et',
    fetch: 'manual', reach: 'unreachable from this server' }];
  const note = F.manualNote(manual, { 'ethiotelecom': { ok: true, status: 200, chars: 8000 } });
  assert.match(note, /ethiotelecom|Ethio telecom/);
  assert.match(note, /answer/i);
  assert.equal(F.manualNote(manual, { 'ethiotelecom': { ok: false, why: 'timeout' } }), '',
    'a source that is still unreachable is not news and says nothing');
});

test('a source marked doNotFetch is never probed', async () => {
  const awash = reg.sites.find(s => s.id === 'awash');
  assert.equal(awash.doNotFetch, true);
  const probed = [];
  await F.probeManual([awash], { get: async u => { probed.push(u); return { ok: true }; } });
  assert.deepEqual(probed, [], 'awashbank.com currently serves somebody else\'s page and must never be touched');
});

// A source that already answers every time is never probed: reporting "a source we could not reach now
// answers" every Sunday for ever is precisely the weekly alert this whole design exists to avoid. No site in
// the banking registry is in that state today — safaricom was until 2026-09-17, when the entry moved to
// m-pesa.safaricom.et, which does not answer — so the rule is pinned on a fixture rather than deleted.
test('a source that already answers is never probed either', async () => {
  const up = { id: 'anything', name: 'Anything', host: 'example.et', fetch: 'manual', reach: 'up' };
  const probed = [];
  await F.probeManual([up], { get: async u => { probed.push(u); return { ok: true }; } });
  assert.deepEqual(probed, [], 'a host that answers every week is not news any week');
  assert.ok(!reg.sites.some(s => s.fetch === 'manual' && /^up$/i.test(String(s.reach || ''))),
    'if a source is reachable it should be fetched, not listed as manual');
});

// A harvested (`fetch: dir`) source is not re-imported weekly — its bytes came off a laptop, not off the
// network — but it IS knocked on, because the day nbe.gov.et answers this server reliably is the day the hand
// harvest can stop. The knock is the only thing that will notice.
test('a harvested source is skipped by the weekly fetch and still knocked on', async () => {
  const dirSites = reg.sites.filter(s => s.fetch === 'dir');
  assert.equal(dirSites.length, 3, 'nbe, ethiotelecom and safaricom');
  const fetchedThisWeek = reg.sites.filter(s => s.fetch !== 'manual' && s.fetch !== 'dir').map(s => s.id);
  for (const s of dirSites) assert.ok(!fetchedThisWeek.includes(s.id), s.id + ' must not be fetched weekly');
  const probed = [];
  await F.probeManual(dirSites, { get: async u => { probed.push(u); return { ok: true, html: 'x'.repeat(9) }; } });
  assert.deepEqual(probed.sort(), ['https://m-pesa.safaricom.et/', 'https://nbe.gov.et/', 'https://www.ethiotelecom.et/'].sort());
  const note = F.manualNote(dirSites, Object.fromEntries(dirSites.map(s => [s.id, { ok: true, chars: 9 }])));
  assert.match(note, /National Bank of Ethiopia/, 'and a door that opens is said out loud');
});

test('the note for this pack says banking, the travel one says airline', () => {
  const travel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'travel', 'sources.json'), 'utf8'));
  assert.match(reg.pack.noteTitle, /Banking/i);
  assert.match(travel.pack.noteTitle, /Airline/i);
});

// ops/packs/fetch-pack.js tags its own fetch progress [travel] — it was written when travel was the only
// pack, and its main() rewrites the tag rather than threading one through every call site. The weekly check
// has to do the same, or the banking log reads as if the airline were being fetched.
test('the fetch progress lines carry the pack name, never travel', async () => {
  const dir = tmpPack();
  const lines = [];
  await F.run({ dir, pack: reg.pack, sites: [site], today: '2026-09-20', log: m => lines.push(String(m)),
    sendTg: async () => true, runIngest: async () => ({ inserted: 0, deleted: 0 }),
    fetchSite: async (s, o) => { o.log('[travel] ' + s.id + ': 233 urls in the sitemap, 65 selected');
      return { pages: [page('zemen-tariff', 'a' + LONG)], failed: [] }; } });
  assert.ok(lines.some(l => l.startsWith('[banking] zemen: 233 urls')), lines.join(' | '));
  assert.equal(lines.some(l => /^\[travel\]/.test(l)), false, 'a banking run said travel: ' + lines.join(' | '));
  fs.rmSync(dir, { recursive: true, force: true });
});

// And the tag is threaded into the fetcher rather than corrected on its way out: fetchSite itself prints
// the pack it was given. The network and the clock are injected, so this touches nothing.
test('fetchSite tags its own progress lines with the pack it was given', async () => {
  const body = '<!DOCTYPE html><html><head><title>Tariff</title></head><body><h1>Tariff</h1><p>'
    + 'padding sentence to clear the four hundred character floor. '.repeat(12) + '</p></body></html>';
  const xml = '<urlset><url><loc>https://zemenbank.com/tariff</loc></url></urlset>';
  const impl = async url => ({ status: 200, ok: true, headers: { get: () => 'text/html; charset=utf-8' },
    arrayBuffer: async () => Buffer.from(String(url).endsWith('.xml') ? xml : body) });
  const lines = [];
  await P.fetchSite(site, { fetchImpl: impl, sleep: async () => {}, log: m => lines.push(String(m)), tag: 'banking' });
  assert.ok(lines.some(l => l.startsWith('[banking] zemen:')), lines.join(' | '));
  assert.equal(lines.some(l => /^\[travel\]/.test(l)), false, 'fetchSite tagged a banking fetch travel');
});

// ---------- what Task 10b added, and what the weekly check has to do about it ----------

// A document can be written again because the HEADER changed — a new Amharic summary, a new template — while
// the bank changed nothing at all. That is our work, not news, and it must never reach Ibrahim's phone.
test('a header-only re-render is not a change and sends nothing', async () => {
  const dir = tmpPack();
  const pages = [page('zemen-tariff', 'card issuance 50 birr.' + LONG)];
  let sent = 0;
  const opts = { dir, sites: [site], log: () => {}, sendTg: async () => { sent++; return true; },
    runIngest: async () => ({ inserted: 0, deleted: 0 }), fetchSite: async () => ({ pages, failed: [] }) };
  await F.run({ ...opts, pack: reg.pack, today: '2026-09-20' });
  const reworded = { ...reg.pack, headerEnTemplate: reg.pack.headerEnTemplate + ' One more sentence.' };
  const r = await F.run({ ...opts, pack: reworded, today: '2026-09-27' });
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.changed, [], 'a header we rewrote is not a page the bank edited');
  assert.deepEqual(r.reformatted, ['zemen-tariff']);
  assert.equal(r.quiet, true);
  assert.equal(sent, 1, 'only the first week, which added the page, should have sent anything');
  assert.match(fs.readFileSync(path.join(dir, 'zemen-tariff.md'), 'utf8'), /One more sentence\./,
    'the document was not re-rendered at all');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The other half of the same problem: when the page really does change, the Amharic summary in the sidecar is
// a summary of the page as it was. It must not be published, it must be generated again, and the index must be
// rebuilt only after that — or Bini answers all week in Amharic with last week's fee.
test('a changed page drops its stale Amharic summary and has it written again before the ingest', async () => {
  const dir = tmpPack();
  const first = [page('zemen-tariff', 'card issuance 50 birr.' + LONG)];
  const second = [page('zemen-tariff', 'card issuance 75 birr.' + LONG)];
  const order = [];
  const stale = 'የካርድ ማውጫ ክፍያ 50 ብር ነው።';
  const opts = { dir, pack: reg.pack, sites: [site], log: () => {}, sendTg: async () => true,
    runIngest: async () => { order.push('ingest'); return { inserted: 1, deleted: 1 }; },
    runAmHeaders: async p => { order.push('am-headers ' + p); return { entries: 1 }; },
    rerender: async () => { order.push('rerender'); return { rerendered: ['zemen-tariff'] }; } };
  await F.run({ ...opts, today: '2026-09-20', fetchSite: async () => ({ pages: first, failed: [] }) });
  fs.writeFileSync(path.join(dir, P.AM_HEADERS), JSON.stringify({ 'zemen-tariff': { titleAm: 'የዘመን ባንክ ታሪፍ',
    summaryAm: stale, contentHash: P.contentHash(first[0].text), generatedAt: '2026-09-20', model: 'gemini-2.5-flash' } }, null, 1) + '\n');
  order.length = 0;   // the first week added the page and re-indexed it; this test is about the second
  const r = await F.run({ ...opts, today: '2026-09-27', fetchSite: async () => ({ pages: second, failed: [] }) });
  assert.deepEqual(r.changed, ['zemen-tariff']);
  assert.deepEqual(order, ['am-headers banking', 'rerender', 'ingest'],
    'the Amharic header must be written again before the index is rebuilt');
  assert.equal(r.amHeaders.dropped, 1);
  const side = JSON.parse(fs.readFileSync(path.join(dir, P.AM_HEADERS), 'utf8'));
  assert.equal(side['zemen-tariff'], undefined, 'the entry generated from last week\'s text must not survive');
  const md = fs.readFileSync(path.join(dir, 'zemen-tariff.md'), 'utf8');
  assert.equal(md.includes(stale), false, 'last week\'s Amharic summary was written onto this week\'s page');
  assert.equal(md.includes('75 birr'), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A pack that never asked for Amharic headers — the airline — must not gain the generator by accident, and a
// dry run must not write to the sidecar or call it at all.
test('a pack with no Amharic headers never calls the generator, and nor does a dry run', async () => {
  const dir = tmpPack();
  const first = [page('zemen-tariff', 'card issuance 50 birr.' + LONG)];
  const second = [page('zemen-tariff', 'card issuance 75 birr.' + LONG)];
  const calls = [];
  const noAm = { ...reg.pack }; delete noAm.amHeaders;
  const opts = { dir, sites: [site], log: () => {}, sendTg: async () => true,
    runIngest: async () => ({ inserted: 0, deleted: 0 }),
    runAmHeaders: async () => { calls.push('am-headers'); return { entries: 0 }; },
    rerender: async () => { calls.push('rerender'); return { rerendered: [] }; } };
  await F.run({ ...opts, pack: noAm, today: '2026-09-20', fetchSite: async () => ({ pages: first, failed: [] }) });
  fs.writeFileSync(path.join(dir, P.AM_HEADERS), JSON.stringify({ 'zemen-tariff': { titleAm: 'ታሪፍ', summaryAm: '',
    contentHash: 'old', generatedAt: '2026-09-20', model: 'gemini-2.5-flash' } }, null, 1) + '\n');
  await F.run({ ...opts, pack: noAm, today: '2026-09-27', fetchSite: async () => ({ pages: second, failed: [] }) });
  assert.deepEqual(calls, [], 'the airline pack asked for no Amharic headers and must not get the generator');
  const dry = await F.run({ ...opts, pack: reg.pack, dryRun: true, today: '2026-10-04',
    fetchSite: async () => ({ pages: [page('zemen-tariff', 'card issuance 90 birr.' + LONG)], failed: [] }) });
  assert.deepEqual(dry.changed, ['zemen-tariff']);
  assert.deepEqual(calls, [], 'a dry run reached the generator, which costs money and writes files');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, P.AM_HEADERS), 'utf8'))['zemen-tariff'].contentHash, 'old',
    'a dry run wrote to the sidecar');
  fs.rmSync(dir, { recursive: true, force: true });
});
