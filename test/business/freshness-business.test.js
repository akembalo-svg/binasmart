'use strict';
// The weekly check for the business pack, with no network, no database and no Telegram: every one of those
// is injected. What is tested is the decisions - when a note is sent, what it says, and what it refuses to do.
//
// The plan's draft of this file injected `fetchImpl`. ops/packs/freshness.js takes `fetchSite`, and a run that
// names no `sites` reads the registry and knocks on every host in it on the real network. The draft therefore
// hung rather than failing. Convention 13 of the plan - verify the thing, not a proxy - and the plan's own
// instruction for this step ("adjust the test, never the module") say which of the two moves: the test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const F = require(path.join(ROOT, 'ops', 'packs', 'freshness.js'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'business', 'sources.json'), 'utf8'));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'biz-fresh-'));
// The site is the pack's own eic entry, not an invention, so a change to the registry that would break the
// weekly run breaks this test too.
const site = reg.sites.find(s => s.id === 'eic');
const sec = (site.sections && site.sections[0]) || { key: 'help' };
const page = (slug, text) => ({ siteId: 'eic', slug, path: '/' + slug, url: 'https://' + site.host + '/' + slug + '/',
  title: slug, section: sec.key, sectionTitleAm: sec.titleAm, lang: 'en', text });
const LONG = ' The Ethiopian Investment Commission registers a foreign investor and issues the investment permit.'.repeat(12);

test('the pack binds to the business registry and its own log prefix', () => {
  assert.equal(reg.pack.id, 'business');
  assert.equal(reg.pack.logPrefix, 'business');
  assert.ok(fs.existsSync(F.packFile('business')), 'freshness.js must resolve knowledge/business/sources.json');
  assert.equal(path.basename(path.dirname(F.packFile('business'))), 'business');
});

test('a week in which nothing changed sends nothing', async () => {
  const dir = tmp();
  const pages = [page('get-started', 'a' + LONG)];
  const sent = [];
  const opts = { dir, pack: reg.pack, sites: [site], manualSites: [], log: () => {},
    sendTg: async m => { sent.push(m); return true; }, runIngest: async () => ({ inserted: 0, deleted: 0 }),
    fetchSite: async () => ({ pages, failed: [] }) };
  await F.run({ ...opts, today: '2026-09-20' });          // the week the document arrives
  sent.length = 0;
  const r = await F.run({ ...opts, today: '2026-09-27' }); // the week nothing happened
  assert.equal(sent.length, 0, 'a quiet week sent a note');
  assert.equal(r.quiet, true);
  assert.equal(r.added.length + r.changed.length + r.gone.length, 0);
});

test('every manual source is probed, so one that comes back is noticed', () => {
  const manual = reg.sites.filter(s => s.fetch === 'manual' && !s.doNotFetch);
  assert.ok(manual.length >= 4, 'ecc, eipo, mor and moj are the hosts that might come back');
  for (const s of manual) assert.ok(s.host, s.id + ' needs a host to probe');
});

test('a dir source is never re-fetched from the network by the weekly run', () => {
  // Four of this pack's sources came off a hand harvest in /root/storage/packs/business-manual. Re-importing an
  // unchanged harvest would be a fetch of nothing, so they are out of the weekly fetch list - and a dir source
  // must never be reached for over the network, which is the whole reason it is a dir source.
  const dirIds = reg.sites.filter(s => s.fetch === 'dir').map(s => s.id).sort();
  assert.deepEqual(dirIds, ['etrade', 'mols', 'motri', 'poessa']);
  const fetched = reg.sites.filter(s => s.fetch !== 'manual' && s.fetch !== 'dir').map(s => s.id).sort();
  assert.deepEqual(fetched, ['aaccsa', 'eccsa', 'eic', 'ipdc'], 'only the four network sources are fetched weekly');
  for (const id of dirIds) assert.ok(!fetched.includes(id), id + ' must not be fetched weekly');
  const knocked = reg.sites.filter(s => s.fetch === 'manual' || s.fetch === 'dir');
  for (const id of dirIds) assert.ok(knocked.some(s => s.id === id), id + ' must be in the door-knock list');
});

test('the door-knock is one request per host, and only for hosts whose answer would be news', async () => {
  // probeManual skips a source whose reach is already "up": knocking on a door that always opens would send the
  // same note every Sunday for ever. motri, mols and poessa are dir sources for a different reason than ecc is
  // manual - their home pages answer this server and their deep paths time out - so they are up, and silent.
  // etrade is the one dir source that is knocked on, because its reach is "up but client-rendered": the day it
  // serves text to a plain user agent is the day the biggest hole in this pack closes, and that IS news.
  const asked = [];
  await F.probeManual(reg.sites.filter(s => s.fetch === 'manual' || s.fetch === 'dir'),
    { get: async url => { asked.push(url); return { ok: false, why: 'timeout' }; } });
  const hosts = asked.map(u => u.replace(/^https:\/\//, '').replace(/\/$/, '')).sort();
  assert.deepEqual(hosts, ['ecc.gov.et', 'eipo.gov.et', 'etrade.gov.et', 'moj.gov.et', 'mor.gov.et']);
  assert.equal(asked.length, new Set(asked).size, 'one request per host, not more');
  for (const id of ['motri', 'mols', 'poessa']) {
    const s = reg.sites.find(x => x.id === id);
    assert.equal(s.reach, 'up', id + ' is silent only because its host is already known to answer');
  }
});

test('a source marked doNotFetch is never probed, however reachable it is', async () => {
  const efda = reg.sites.find(s => s.id === 'efda');
  assert.equal(efda.doNotFetch, true);
  assert.match(String(efda.why || ''), /ClaudeBot/, 'the robots.txt that decided it is quoted in why');
  // and the probe itself skips it: reachability was never the question
  const asked = [];
  const probed = await F.probeManual(reg.sites.filter(s => s.fetch === 'manual' || s.fetch === 'dir'),
    { get: async url => { asked.push(url); return { ok: false, why: 'timeout' }; } });
  assert.ok(!asked.some(u => /efda/.test(u)), 'the weekly run knocked on efda.gov.et');
  assert.equal(probed.efda, undefined);
});

test('the note names the pack, so two packs cannot be confused on a Sunday morning', () => {
  assert.equal(reg.pack.logPrefix, 'business');
  assert.notEqual(reg.pack.logPrefix, 'banking');
  const note = F.noteFor([{ site: 'eic', name: 'Ethiopian Investment Commission', total: 1, titles: {},
    failed: 0, added: ['eic-get-started'], changed: [], unchanged: [], gone: [], reformatted: [], goneWhy: {},
    missed: [], revived: [] }], { today: '2026-09-27', pack: reg.pack });
  assert.match(note, /business/i, 'the note must name the pack it is about');
  assert.doesNotMatch(note, /banking/i);
});

test('a dry run sends nothing at all, which is how this pack was exercised', async () => {
  const dir = tmp();
  const pages = [page('get-started', 'a' + LONG)];
  let sends = 0;
  const r = await F.run({ dir, pack: reg.pack, sites: [site], manualSites: [], today: '2026-09-27',
    dryRun: true, log: () => {}, sendTg: async () => { sends++; return true; },
    runIngest: async () => { throw new Error('a dry run must not ingest'); },
    fetchSite: async () => ({ pages, failed: [] }) });
  assert.equal(sends, 0, 'a dry run sent a Telegram message');
  assert.equal(r.added.length, 1, 'the dry run still decided that a document was new');
});
