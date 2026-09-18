'use strict';
// The pack re-fetch trigger (design §5.12): the channel says a document exists, and the pack that owns that
// office goes and gets it the same night instead of waiting for Sunday.
//
// The three things that keep it from becoming a second crawler are all asserted here: only a directive item
// from a pack-owning office writes anything, the trigger is read and CLEARED so a pack re-fetches once, and
// no two fetchers ever run at once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { triggersFor, appendTriggers, readTrigger, takeTrigger, pendingPacks, triggerFile } = require('../ops/watch/channels/trigger');
const { refetch, takeLock, dropLock, otherFetcher } = require('../ops/watch/channels/refetch');
const registry = require('../ops/watch/channels/registry.json');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wtrig-'));
const item = (over = {}, post = {}) => ({
  admit: true, label: 'pack-grade', office: 'nbe',
  source: { id: 'nbe', office: 'nbe', kind: 'office', handle: '@nbethiopia', name: 'National Bank of Ethiopia', pack: 'banking' },
  post: { id: 412, channel: '@nbethiopia', url: 'https://t.me/nbethiopia/412', date: '2026-09-11', lang: 'en',
    text: 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28', links: [], ...post },
  ...over,
});

test('a directive item from a pack-owning office queues that pack, and nothing else does', () => {
  const rows = triggersFor([
    item(),                                                                     // NBE notice -> banking
    item({ office: 'mols', source: { office: 'mols', pack: 'law', name: 'Ministry of Labour and Skills' } },
      { text: 'የሥራ ፈቃድ ክፍያ መመሪያ ተሻሽሏል', url: 'https://t.me/FDRE_MoLSofficial/91' }),   // directive -> law
    item({ office: 'ethiotelecom', source: { office: 'ethiotelecom', pack: null, name: 'ethio telecom' } },
      { text: 'NEW TARIFF NOTICE for data bundles', url: 'https://t.me/ethio_telecom/7' }),  // no pack: nothing
    item({ label: 'perishable' }, { text: 'Get 20 percent discount on your next bundle', url: 'https://t.me/x/1' }),
    item({ admit: false, label: 'excluded' }, { text: 'PUBLIC NOTICE about the auction deadline', url: 'https://t.me/y/2' }),
  ], { registry, now: '2026-09-18T02:05:00Z' });
  assert.deepEqual(rows.map(r => r.pack), ['banking', 'law']);
  assert.equal(rows[0].office, 'nbe');
  assert.equal(rows[0].directive, 'notice');
  assert.equal(rows[0].post, 'https://t.me/nbethiopia/412');
  assert.equal(rows[0].reported_at, '2026-09-11');
  assert.equal(rows[0].at, '2026-09-18T02:05:00Z');
  assert.match(rows[0].title, /AUCTION NO\. 28/);
});

test('a promotional item writes no file at all', () => {
  const dir = tmp();
  try {
    const w = appendTriggers([item({ label: 'perishable' }, { text: 'Win a prize in our game centre draw' })], { registry, dir });
    assert.deepEqual(w, {});
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.deepEqual(pendingPacks({ dir }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the trigger file is written once per post, and read and cleared by the run it asks for', () => {
  const dir = tmp();
  try {
    appendTriggers([item()], { registry, dir, now: '2026-09-18T02:05:00Z' });
    assert.deepEqual(pendingPacks({ dir }), ['banking']);
    assert.equal(readTrigger('banking', { dir }).length, 1);
    // the same morning again: no second row for the same post
    appendTriggers([item()], { registry, dir, now: '2026-09-18T02:06:00Z' });
    assert.equal(readTrigger('banking', { dir }).length, 1);
    // a different notice does add one
    appendTriggers([item({}, { url: 'https://t.me/nbethiopia/413', text: 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 29' })], { registry, dir });
    assert.equal(readTrigger('banking', { dir }).length, 2);
    // a dry run reads and leaves the file exactly as it was
    assert.equal(takeTrigger('banking', { dir, dryRun: true }).length, 2);
    assert.ok(fs.existsSync(triggerFile('banking', dir)));
    // and the real take clears it, so the pack is re-fetched once and not every night for ever
    assert.equal(takeTrigger('banking', { dir }).length, 2);
    assert.equal(fs.existsSync(triggerFile('banking', dir)), false);
    assert.deepEqual(readTrigger('banking', { dir }), []);
    assert.deepEqual(pendingPacks({ dir }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a dry-run append writes nothing but says what it would have queued', () => {
  const dir = tmp();
  try {
    const said = [];
    const w = appendTriggers([item()], { registry, dir, dryRun: true, log: m => said.push(m) });
    assert.deepEqual(Object.keys(w), ['banking']);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.match(said.join('\n'), /DRY RUN/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an empty trigger directory starts no process at all', () => {
  const dir = tmp();
  try {
    let called = 0;
    const r = refetch({ dir, lock: path.join(dir, '.lock'), runFreshness: () => { called++; }, busy: () => 0, log: () => {} });
    assert.deepEqual([r.ran.length, r.packs.length, called], [0, 0, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a queued pack runs its own freshness check, one at a time, and only that pack', () => {
  const dir = tmp();
  try {
    appendTriggers([item(), item({ office: 'mols', source: { office: 'mols', pack: 'law' } },
      { text: 'የሥራ ፈቃድ መመሪያ', url: 'https://t.me/FDRE_MoLSofficial/91' })], { registry, dir });
    const ran = [];
    const r = refetch({ dir, lock: path.join(dir, '.lock'), runFreshness: p => ran.push(p), busy: () => 0, log: () => {} });
    assert.deepEqual(ran, ['banking', 'law'], 'in order, one at a time, and no other pack');
    assert.deepEqual(r.ran.map(x => x.ok), [true, true]);
    assert.equal(fs.existsSync(path.join(dir, '.lock')), false, 'the lock is dropped when the run ends');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('another fetcher running means nothing is started', () => {
  const dir = tmp();
  try {
    appendTriggers([item()], { registry, dir });
    let called = 0;
    const said = [];
    const r = refetch({ dir, lock: path.join(dir, '.lock'), runFreshness: () => { called++; }, busy: () => 4242, log: m => said.push(m) });
    assert.equal(called, 0);
    assert.equal(r.blocked, 4242);
    assert.match(said.join('\n'), /another fetcher is running/);
    assert.equal(readTrigger('banking', { dir }).length, 1, 'and the trigger is still waiting for the next run');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a live lock held by a living process blocks a second run; a stale one does not', () => {
  const dir = tmp();
  const lock = path.join(dir, '.lock');
  try {
    assert.equal(takeLock({ lock }).ok, true);
    assert.equal(takeLock({ lock }).ok, false, 'this very process holds it');
    dropLock({ lock });
    assert.equal(takeLock({ lock }).ok, true);
    // a lock four hours old is not a running fetcher
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, at: new Date(Date.now() - 4 * 3600e3).toISOString() }));
    assert.equal(takeLock({ lock }).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the other-fetcher check reads /proc and never matches itself', () => {
  const proc = tmp();
  try {
    fs.mkdirSync(path.join(proc, '111'));
    fs.writeFileSync(path.join(proc, '111', 'cmdline'), '/usr/bin/node\0--env-file=.env\0ops/packs/freshness.js\0--pack\0banking\0');
    fs.mkdirSync(path.join(proc, '222'));
    fs.writeFileSync(path.join(proc, '222', 'cmdline'), '/usr/bin/node\0ops/watch/channels/refetch.js\0');
    assert.equal(otherFetcher({ proc, self: 222 }), 111);
    assert.equal(otherFetcher({ proc: path.join(proc, 'nothing') }), 0);
    fs.rmSync(path.join(proc, '111'), { recursive: true });
    assert.equal(otherFetcher({ proc, self: 222 }), 0, 'the watch re-fetch itself is not another fetcher');
  } finally { fs.rmSync(proc, { recursive: true, force: true }); }
});

test('freshness.js reads and clears the trigger at the top of its run', async () => {
  const dir = tmp();
  try {
    appendTriggers([item()], { registry, dir });
    const { run } = require('../ops/packs/freshness.js');
    const said = [];
    const r = await run({ packId: 'banking', pack: { id: 'banking' }, sites: [], manualSites: [],
      dir: tmp(), today: '2026-09-18', triggerDir: dir, log: m => said.push(String(m)),
      sendTg: async () => true, runIngest: async () => ({}), fetchSite: async () => ({ pages: [], failed: [] }) });
    assert.deepEqual(r.triggeredBy.map(t => t.office), ['nbe'], 'the run knows what asked for it');
    assert.match(said.join('\n'), /the channel watch asked for this run/);
    assert.deepEqual(readTrigger('banking', { dir }), [], 'and the trigger is cleared, so it runs once');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
