'use strict';
// The documents behind an answer, read from the knowledge block the engine already has. The last test runs
// the real contextFor, so a change to its line format fails here rather than silently emptying the page's
// "From:" line.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sourcesFrom } = require('../../assistant/kit/sources');
const { makeKnowledge } = require('../../knowledge/index');

const block = lines => '## Relevant BinaSmart knowledge (facts here override anything you remember; cite the page link when useful)\n' + lines.join('\n\n');

test('the numbered documents come back as title and url, at most two, in order', () => {
  const ctx = block([
    '[1] ፋይዳ · Fayda — የኢትዮጵያ ብሔራዊ ዲጂታል መታወቂያ — https://bina.et/fayda\nFayda text',
    '[2] Addis Ababa — https://bina.et/living-working-in-ethiopia-guide\nAddis text',
    '[3] Health Centre Requirements — http://www.moh.gov.et/\nmore',
  ]);
  assert.deepEqual(sourcesFrom(ctx), [
    { title: 'ፋይዳ · Fayda — የኢትዮጵያ ብሔራዊ ዲጂታል መታወቂያ', url: 'https://bina.et/fayda' },
    { title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide' },
  ]);
  assert.equal(sourcesFrom(ctx, 3).length, 3);
});

test('the same url twice is one source, and a document without a url still takes its number', () => {
  const ctx = block([
    '[1] Seera Hojjetaa — Labsii 1156/2019 — https://chilot.wordpress.com/labour-proclamation-no-1156-2019/\nom',
    '[2] የሠራተኛና አሠሪ ሕግ — አዋጅ 1156/2011 — https://chilot.wordpress.com/labour-proclamation-no-1156-2019/\nam',
    '[3] A law with no link\ntext',
    '[4] Addis Ababa — https://bina.et/living-working-in-ethiopia-guide\nx',
  ]);
  assert.deepEqual(sourcesFrom(ctx).map(s => s.url), ['https://chilot.wordpress.com/labour-proclamation-no-1156-2019/', 'https://bina.et/living-working-in-ethiopia-guide']);
});

test('only http(s) links, never the internal system document, never a line out of sequence', () => {
  const ctx = block([
    '[1] BinaSmart system — https://bina.et/llms.txt\ninternal',
    '[2] Trick — javascript:alert(1)\nx',
    '[9] Out of order — https://evil.example/\nx',
    '[3] Real — https://bina.et/passport\nThe text quotes [4] Fake — https://evil.example/ inside a document',
  ]);
  assert.deepEqual(sourcesFrom(ctx), [{ title: 'Real', url: 'https://bina.et/passport' }]);
});

test('entities in crawled titles are decoded, long titles are cut, empty input is empty', () => {
  const long = 'ኢትዮ ቴሌኮም · Managed Security Services &#8211; Ethio telecom &amp; partners ' + 'x'.repeat(120);
  const [s] = sourcesFrom('[1] ' + long + ' — https://www.ethiotelecom.et/managed-security-services/\ntext');
  assert.ok(s.title.startsWith('ኢትዮ ቴሌኮም · Managed Security Services – Ethio telecom & partners'));
  assert.equal(s.title.length, 90);
  assert.ok(s.title.endsWith('…'));
  assert.deepEqual(sourcesFrom(''), []);
  assert.deepEqual(sourcesFrom(null), []);
  assert.deepEqual(sourcesFrom('fee 50 birr'), []);
});

test('the real contextFor output parses: the line format is pinned here', async () => {
  const rows = []; let seq = 0;
  const prisma = { knowledgeChunk: {
    findMany: async ({ where } = {}) => rows.filter(r => !where || Object.keys(where).every(k => {
      const w = where[k]; if (w === null) return r[k] == null;
      if (w && typeof w === 'object' && 'notIn' in w) return !w.notIn.includes(r[k]);
      if (w && typeof w === 'object' && 'in' in w) return w.in.includes(r[k]);
      return r[k] === w; })).map(r => ({ ...r })),
    create: async ({ data }) => { const r = { id: 'c' + (++seq), embedding: null, ...data }; rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    deleteMany: async () => ({ count: 0 }),
  } };
  const k = makeKnowledge({ prisma, apiKey: '', fetchImpl: async () => { throw new Error('no network in tests'); }, root: path.join(__dirname, '..', '..'), sleep: async () => {} });
  await k.ingest({ only: ['addis'] });
  const ctx = await k.contextFor('what time is 1 o clock Ethiopian time');
  assert.deepEqual(sourcesFrom(ctx), [{ title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide' }]);
});
