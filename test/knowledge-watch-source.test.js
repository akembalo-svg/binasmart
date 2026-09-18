'use strict';
// `watch` is a knowledge source of its own: the dated announcements ops/watch/channels writes, read whole
// (a watch item is a few hundred characters; there is nothing to truncate) and deliberately NOT in
// OWN_SOURCES, so it never gets the +0.06 that our own pages get. A ministry's Telegram post is not ours.
//
// Two things make it safe to index at all, and both are asserted here: an item stops being served when its
// expires_at has passed, and it stops being served when a curated document has superseded it. Nothing is
// deleted from disk either way — the record of what was announced survives even when it stops being an answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSources, sourceLine, docMeta, OWN_SOURCES, PACK_SOURCES } = require('../knowledge/index');

function doc(meta, body) {
  return ['---', ...Object.entries(meta).map(([k, v]) => k + ': "' + v + '"'), '---', '', body, ''].join('\n');
}
const BASE = {
  url: 'https://t.me/EthiopianCustomsCommission/205',
  title: 'Customs branch offices serve until 19:00',
  source_name: 'Ethiopian Customs Commission',
  office: 'ecc',
  reported_by: 'Ethiopian Customs Commission',
  channel: '@EthiopianCustomsCommission',
  reported_at: '2026-09-17',
  lang: 'am',
  status: 'live',
  expires_at: '2126-10-10',
  fetchedAt: '2026-09-18',
  lastChecked: '2026-09-18',
};
function root(files) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'kwatch-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'watch'), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(r, 'knowledge', 'watch', name), text);
  return r;
}

test('watch is a source read whole, and is not one of our own', () => {
  assert.ok(PACK_SOURCES.some(([s]) => s === 'watch'), 'watch is a directory of markdown with front matter');
  assert.equal(OWN_SOURCES.has('watch'), false, 'a ministry announcement must not be boosted like our own page');
});

test('a live item is indexed whole, with its own front matter', () => {
  const r = root({ 'a.md': doc(BASE, 'The commission announced longer opening hours.') });
  const docs = readSources(r, ['watch']);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'watch');
  assert.equal(docs[0].slug, 'a');
  assert.equal(docs[0].lang, 'am');
  assert.equal(docs[0].url, BASE.url);
  assert.ok(docs[0].text.includes('longer opening hours'));
  fs.rmSync(r, { recursive: true, force: true });
});

test('an item whose expires_at has passed is not returned, and stays on disk', () => {
  const r = root({ 'old.md': doc({ ...BASE, expires_at: '2026-10-10' }, 'The hours applied until Meskerem 30.') });
  assert.deepEqual(readSources(r, ['watch'], { today: '2026-10-11' }).map(d => d.slug), []);
  assert.deepEqual(readSources(r, ['watch'], { today: '2026-10-10' }).map(d => d.slug), ['old'], 'the last day it is true is still a day it is true');
  assert.ok(fs.existsSync(path.join(r, 'knowledge', 'watch', 'old.md')), 'nothing is deleted');
  fs.rmSync(r, { recursive: true, force: true });
});

test('an item a curated document has superseded is not returned', () => {
  const r = root({ 's.md': doc({ ...BASE, status: 'superseded', superseded_by: 'law/customs-hours-2019' }, 'x') });
  assert.deepEqual(readSources(r, ['watch']).map(d => d.slug), []);
  fs.rmSync(r, { recursive: true, force: true });
});

test('a status nobody recognises is refused, not guessed', () => {
  const r = root({ 'q.md': doc({ ...BASE, status: 'draft' }, 'x'), 'g.md': doc({ ...BASE, status: 'gone' }, 'x') });
  assert.deepEqual(readSources(r, ['watch']).map(d => d.slug), []);
  fs.rmSync(r, { recursive: true, force: true });
});

test('the Source line carries the day the office announced it, not only the day we read it', () => {
  const r = root({ 'a.md': doc(BASE, 'x') });
  const line = sourceLine({ source: 'watch', slug: 'a', title: 'Customs' }, { root: r });
  assert.ok(line.startsWith('Source: Ethiopian Customs Commission'), line);
  assert.ok(line.includes('https://t.me/EthiopianCustomsCommission/205'), line);
  assert.ok(line.includes('reported 2026-09-17'), line);
  assert.ok(line.includes('fetched 2026-09-18'), line);
  const am = sourceLine({ source: 'watch', slug: 'a', title: 'Customs' }, { root: r, am: true });
  assert.ok(am.startsWith('ምንጭ፦'), am);
  assert.ok(am.includes('2026-09-17'), am);
  assert.equal(docMeta(r, 'watch', 'a').reported_at, '2026-09-17');
  fs.rmSync(r, { recursive: true, force: true });
});

test('a curated pack document is unaffected: no status, no expiry, still indexed', () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'kwatch-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'law'), { recursive: true });
  fs.writeFileSync(path.join(r, 'knowledge', 'law', 'p.md'), doc({ title: 'Proclamation 1156/2019', lang: 'am' }, 'A statute with no status line at all.'));
  assert.deepEqual(readSources(r, ['law']).map(d => d.slug), ['p']);
  fs.rmSync(r, { recursive: true, force: true });
});
