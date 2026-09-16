'use strict';
// The weekly check. Everything is injected - the network, the clock, the ingest and the Telegram sender -
// so the tests exercise the real decisions and send nothing. The first REAL note is the proof, and it is
// sent by cron, in production, when the airline actually changes a page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, noteFor } = require('../../ops/travel/freshness');
const { writePack } = require('../../ops/travel/fetch-airline');

const SITE = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', lang: 'en' };
const page = (slug, body) => ({ siteId: 'ethiopian-airlines', slug, path: '/et/x/' + slug,
  url: 'https://www.ethiopianairlines.com/et/x/' + slug, title: slug, section: 'baggage', sectionTitleAm: 'ሻንጣ',
  text: body + ' ' + 'padding to clear the four hundred character floor. '.repeat(10) });

function dirWith(pages, today = '2026-09-16') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writePack(d, pages, SITE, { today });
  return d;
}
// A fake fetchSite: returns the pages it was given, in the shape the real one returns.
const fakeFetch = (pages, failed = []) => async () => ({ pages, failed });

function harness(dir, pages, opts = {}) {
  const sent = [], ingested = [];
  const res = { sent, ingested };
  res.run = () => run({
    dir, today: opts.today || '2026-09-23', dryRun: !!opts.dryRun, log: () => {},
    sites: [SITE], fetchSite: fakeFetch(pages, opts.failed || []),
    sendTg: async t => { sent.push(t); return true; },
    runIngest: async () => { ingested.push(1); return { inserted: 18, deleted: 12, total: 14000 }; },
  });
  return res;
}

test('a week where nothing changed sends nothing and does not re-ingest', async () => {
  const p = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const h = harness(dirWith(p), p);
  const r = await h.run();
  assert.equal(r.quiet, true);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.ingested, []);
});

test('a changed page is rewritten, re-ingested and reported once', async () => {
  const before = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const dir = dirWith(before);
  const after = [page('a', 'Maximum weight 32 kg.'), page('b', 'Carry-on 7 kg.')];
  const h = harness(dir, after);
  const r = await h.run();
  assert.deepEqual(r.changed, ['a']);
  assert.equal(h.ingested.length, 1);
  assert.equal(h.sent.length, 1, 'exactly one note');
  assert.match(h.sent[0], /changed/i);
  assert.match(h.sent[0], /\ba\b/);
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('32 kg'));
});

test('a vanished page is marked gone, kept on disk, and named in the note', async () => {
  const before = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const dir = dirWith(before);
  const h = harness(dir, [page('a', 'Maximum weight 23 kg.')]);
  const r = await h.run();
  assert.deepEqual(r.gone, ['b']);
  const b = fs.readFileSync(path.join(dir, 'b.md'), 'utf8');
  assert.match(b, /status: "gone"/);
  assert.ok(b.includes('Carry-on 7 kg.'), 'the last known text was deleted');
  assert.match(h.sent[0], /gone/i);
});

test('a dry run writes nothing, ingests nothing and sends nothing', async () => {
  const before = [page('a', 'Maximum weight 23 kg.')];
  const dir = dirWith(before);
  const h = harness(dir, [page('a', 'Maximum weight 32 kg.')], { dryRun: true });
  const r = await h.run();
  assert.deepEqual(r.changed, ['a']);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.ingested, []);
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('23 kg'), 'a dry run rewrote the file');
});

test('a failed fetch never empties the pack, and says so out loud', async () => {
  const before = [];
  for (let i = 0; i < 30; i++) before.push(page('p' + i, 'Page ' + i + ' content.'));
  const dir = dirWith(before);
  const h = harness(dir, [page('p0', 'Page 0 content.')], { failed: [{ url: 'x', why: 'timeout' }] });
  const r = await h.run();
  assert.equal(r.refused, true);
  assert.deepEqual(r.gone, []);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.md')).length, 30, 'files were removed or rewritten');
  assert.match(h.sent[0], /could not be checked|refus/i, 'a silent failure is the one thing this must not do');
  assert.deepEqual(h.ingested, []);
});

test('a site-wide template change is one line, not fifty', () => {
  const note = noteFor([{ site: 'ethiopian-airlines', name: 'Ethiopian Airlines', total: 40,
    added: [], changed: Array.from({ length: 32 }, (_, i) => 'p' + i), unchanged: [], gone: [], revived: [], failed: 0 }],
    { today: '2026-09-23' });
  assert.match(note, /32 of 40 pages changed at once/);
  assert.equal((note.match(/•/g) || []).length <= 3, true, 'the note listed every page: ' + note);
});

test('the note names the page, not only the slug, when the pack has a title for it', () => {
  const note = noteFor([{ site: 'ethiopian-airlines', name: 'Ethiopian Airlines', total: 40, added: [],
    changed: ['baggage-information-free-baggage-allowance'], unchanged: [], gone: [], revived: [], failed: 0,
    titles: { 'baggage-information-free-baggage-allowance': 'Free Baggage Allowance' } }], { today: '2026-09-23' });
  assert.match(note, /Free Baggage Allowance/);
});

test('writePack refuses a mass loss on a pack that already has pages', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(page('p' + i, 'Page ' + i + ' content.'));
  const dir = dirWith(many);
  const r = writePack(dir, [page('p0', 'Page 0 content.')], SITE, { today: '2026-09-23' });
  assert.equal(r.refused, true);
  assert.deepEqual(r.gone, []);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.md')).length, 30);
});

test('writePack still allows the first run, where everything is new', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  const many = [];
  for (let i = 0; i < 30; i++) many.push(page('p' + i, 'Page ' + i + ' content.'));
  const r = writePack(dir, many, SITE, { today: '2026-09-16' });
  assert.equal(r.refused, undefined);
  assert.equal(r.added.length, 30);
});
