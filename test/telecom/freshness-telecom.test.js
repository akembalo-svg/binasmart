'use strict';
// The weekly check for the telecom pack, which is a hand harvest: it must never try to fetch the hosts this
// server cannot reach, it says so once a month, and the one host that answers (safaricom.et) is compared page
// by page without rewriting anything. Every network, database and Telegram call is injected.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const F = require('../../ops/packs/freshness.js');
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'telecom', 'sources.json'), 'utf8'));

test('the registry declares the pack manual, names the one server check and points at the how-to', () => {
  const m = reg.pack.manual;
  assert.ok(m, 'pack.manual is missing');
  assert.deepEqual(m.serverChecks, ['safaricom']);
  assert.equal(m.reminderDayMax, 7);
  assert.match(m.howTo, /ops\/harvest\/telecom\/README\.md/);
  assert.match(m.harvestRoot, /telecom-manual$/);
});

test('no telecom site is fetched by the weekly job: every one is a hand harvest', () => {
  assert.ok(reg.sites.length >= 3);
  for (const s of reg.sites) assert.equal(s.fetch, 'dir', s.id + ' would be fetched from the server');
  assert.ok(!reg.sites.some(s => s.fetch === 'sitemap' || s.fetch === 'urls'));
});

test('only the host this server cannot reach is knocked on; the two that answer are silent', async () => {
  const asked = [];
  await F.probeManual(reg.sites.filter(s => s.fetch === 'manual' || s.fetch === 'dir'),
    { get: async u => { asked.push(u); return { ok: false, why: 'timeout' }; } });
  assert.deepEqual(asked, ['https://www.ethiotelecom.et/'], 'eca.et and safaricom.et answer, and a weekly note that says so is the alert nobody reads');
  for (const id of ['eca', 'safaricom']) assert.equal(reg.sites.find(s => s.id === id).reach, 'up', id);
});

test('the reminder is due on the first Sunday of a month and never on the other three', () => {
  for (const d of ['2026-10-04', '2026-11-01', '2026-12-06', '2026-10-01', '2026-10-07']) assert.equal(F.isReminderDay(d), true, d);
  for (const d of ['2026-10-11', '2026-10-18', '2026-10-25', '2026-10-08', '2026-09-27']) assert.equal(F.isReminderDay(d), false, d);
  // exactly one Sunday of any month falls on days 1-7
  const sundays = [];
  for (let day = 1; day <= 31; day++) { const dt = new Date(Date.UTC(2026, 9, day)); if (dt.getUTCDay() === 0) sundays.push('2026-10-' + String(day).padStart(2, '0')); }
  assert.equal(sundays.filter(d => F.isReminderDay(d)).length, 1);
});

// ---- a tiny harvest on disk, so the real reader (extract) runs on real bytes ----
const PAGE = price => '<html><head><title>Data packages</title></head><body><main><h1>Data packages</h1>'
  + '<p>Enjoy daily data packages with clear prices and clear validity for every customer of this operator.</p>'
  + '<p>1 GB — ' + price + ' ETB for one day, usable on the operator network across the whole country.</p>'
  + '<p>The operator publishes every price on this page and changes them with notice to its customers.</p></main></body></html>';
function harvest(price) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tel-harvest-'));
  const dir = path.join(root, 'example.et'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'aaa.html'), PAGE(price));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify([{ url: 'https://example.et/en/data', file: 'aaa.html', status: 200,
    contentType: 'text/html', bytes: 500, sha256: 'x', fetchedAt: '2026-09-21T10:00:00Z', lang: 'en' }]));
  return root;
}
const site = { id: 'safaricom', name: 'Example Operator', host: 'example.et', dir: 'example.et', fetch: 'dir', lang: 'en',
  allow: ['^/en/data$'], deny: [], minChars: 100, reach: 'up', harvestedAt: '2026-09-21', sections: [] };
const PACK = root => ({ id: 'telecom', logPrefix: 'telecom', noteTitle: '📡 Telecom knowledge pack',
  manual: { reminderDayMax: 7, serverChecks: ['safaricom'], harvestRoot: root, howTo: 'ops/harvest/telecom/README.md' } });
const live = price => async () => ({ ok: true, html: PAGE(price) });

async function week({ day, root, get, dryRun = false }) {
  const sent = []; let ingests = 0;
  const r = await F.run({ packId: 'telecom', pack: PACK(root), sites: [], manualSites: [site], dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tel-pack-')),
    triggerDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tel-trig-')), today: day, dryRun, getLive: get, log: () => {},
    sendTg: async t => { sent.push(t); return true; }, runIngest: async () => { ingests++; return {}; } });
  return { r, sent, ingests };
}

test('an ordinary Sunday with nothing changed sends nothing at all', async () => {
  const root = harvest(45);
  const w = await week({ day: '2026-10-11', root, get: live(45) });
  assert.equal(w.r.quiet, true);
  assert.deepEqual(w.sent, []);
  assert.equal(w.r.manual.checks[0].unchanged.length, 1);
});

test('the first Sunday of the month says the pack is manual and to re-harvest from the laptop', async () => {
  const root = harvest(45);
  const w = await week({ day: '2026-10-04', root, get: live(45) });
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0], /manual/i);
  assert.match(w.sent[0], /re-harvest from the laptop/);
  assert.match(w.sent[0], /2026-09-21 \(13 days old\)/);
  assert.match(w.sent[0], /ops\/harvest\/telecom\/README\.md/);
  assert.equal(w.ingests, 0, 'a reminder must not start an ingest');
});

test('a Safaricom price that changed is reported by page and nothing is rewritten', async () => {
  const root = harvest(45);
  const before = fs.readFileSync(path.join(root, 'example.et', 'aaa.html'), 'utf8');
  const w = await week({ day: '2026-10-11', root, get: live(55) });
  assert.equal(w.r.quiet, false);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0], /1 of 1 page\(s\) read differently from the harvest/);
  assert.match(w.sent[0], /\/en\/data/);
  assert.match(w.sent[0], /Nothing was rewritten/);
  assert.equal(w.ingests, 0, 'no rewrite without review means no ingest');
  assert.equal(fs.readFileSync(path.join(root, 'example.et', 'aaa.html'), 'utf8'), before, 'the harvest was touched');
});

test('a page that now answers "not found" is reported as gone, and a host that does not answer is a warning', async () => {
  const root = harvest(45);
  const gone = await week({ day: '2026-10-11', root, get: async () => ({ ok: true, html: '<html><body>Page data not found</body></html>' }) });
  assert.match(gone.sent[0], /now answer "not found"/);
  const down = await week({ day: '2026-10-11', root, get: async () => ({ ok: false, why: 'timeout' }) });
  assert.match(down.sent[0], /did not answer this time/);
});

test('a dry run does all of it and sends nothing', async () => {
  const root = harvest(45);
  const w = await week({ day: '2026-10-04', root, get: live(99), dryRun: true });
  assert.deepEqual(w.sent, []);
  assert.equal(w.ingests, 0);
  assert.equal(w.r.quiet, false, 'it knew there was news');
});

test('the note of a pack with no fetched site does not claim that "0 things moved"', () => {
  const t = F.noteFor([], { today: '2026-10-04', pack: { id: 'telecom', noteTitle: '📡 Telecom knowledge pack' }, extra: '\n\nhello' });
  assert.ok(!/thing\(s\) moved/.test(t));
  assert.match(t, /^📡 Telecom knowledge pack\n\nhello/);
});

test('the banking note is exactly what it was', () => {
  const rep = { name: 'Zemen', total: 3, changed: ['a'], added: [], gone: [], missed: [], revived: [], uncorrected: [], failed: 0, titles: { a: 'Tariff' } };
  const t = F.noteFor([rep], { today: '2026-10-04', pack: { id: 'banking', noteTitle: '🏦 Banking' } });
  assert.match(t, /^🏦 Banking — 1 thing\(s\) moved/);
});
