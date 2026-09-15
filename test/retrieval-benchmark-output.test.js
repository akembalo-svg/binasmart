'use strict';
// The retrieval benchmark named its output retrieval-<UTC date>.json. Addis is UTC+3, so a run after
// 21:00 UTC and one the next morning in Addis shared a UTC date, and the second silently replaced the
// first: the 14 September "before the news source" run was overwritten by the "after" run ten minutes
// later. A measurement a public page quotes must not be destroyable by the next measurement.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resultName, writeResult, goldPath, goldTag, latestName, pagesContaining, GOLD,
  normalizeGold, goldKeys, pageRank, searchOptionsFor, forceFailMode, runTag, knowledgeOptions } = require('../ops/bini/rerun-retrieval-benchmark');

// Forced embedder failure (2026-09-15): a test-only flag of this script, for measuring the BGE-M3 fallback and
// keyword-only search. Without the flag the options are exactly what they were.
test('--force-embed-fail: off by default, gemini or all, anything else refused', () => {
  assert.equal(forceFailMode(['node', 'x']), '');
  assert.equal(forceFailMode(['node', 'x', '--force-embed-fail', 'gemini']), 'gemini');
  assert.equal(forceFailMode(['node', 'x', '--force-embed-fail', 'all']), 'all');
  assert.throws(() => forceFailMode(['node', 'x', '--force-embed-fail']), /gemini or all/);
  assert.throws(() => forceFailMode(['node', 'x', '--force-embed-fail', 'yes']), /gemini or all/);
});

test('a forced run gets its own file tag, so it can never be mistaken for a normal run', () => {
  assert.equal(runTag('', ''), '');
  assert.equal(runTag('gold-v3-agents', ''), 'gold-v3-agents');
  assert.equal(runTag('gold-v3-agents', 'gemini'), 'gold-v3-agents-forced-gemini-fail');
  assert.equal(runTag('gold-v3-agents', 'all'), 'gold-v3-agents-forced-keyword-only');
  assert.equal(runTag('', 'gemini'), 'forced-gemini-fail');
});

test('knowledgeOptions: normal run passes only prisma and the key; forced runs fail only the query embedding', async () => {
  const prisma = {};
  assert.deepEqual(knowledgeOptions('', { prisma, apiKey: 'k' }), { prisma, apiKey: 'k' });
  const seen = [];
  const g = knowledgeOptions('gemini', { prisma, apiKey: 'k', fetchImpl: async url => { seen.push(url); return { ok: true }; } });
  await assert.rejects(g.fetchImpl('https://x/models/gemini-embedding-001:embedContent?key=k', {}), /forced/);
  await g.fetchImpl('https://x/models/gemini-embedding-001:batchEmbedContents?key=k', {});
  assert.deepEqual(seen, ['https://x/models/gemini-embedding-001:batchEmbedContents?key=k']);
  assert.equal(g.localEmbedder, undefined, 'the real bina-embed answers in the gemini mode');
  assert.equal(g.localFallback, true);
  const all = knowledgeOptions('all', { prisma, apiKey: 'k' });
  await assert.rejects(all.localEmbedder.query('q'), /forced/);
});

test('the file name carries the UTC date and time to the second', () => {
  assert.equal(resultName(new Date('2026-09-13T22:09:55.990Z')), 'retrieval-20260913-220955.json');
});

test('two runs never overwrite each other, even in the same second', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  const at = new Date('2026-09-13T22:18:25Z');
  const a = writeResult(dir, { run: 'before' }, at);
  const b = writeResult(dir, { run: 'after' }, at);
  assert.notEqual(a, b);
  assert.equal(JSON.parse(fs.readFileSync(a, 'utf8')).run, 'before');
  assert.equal(JSON.parse(fs.readFileSync(b, 'utf8')).run, 'after');
});

test('retrieval-latest.json is a copy of the newest run, and a dated file is never it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  writeResult(dir, { run: 1 }, new Date('2026-09-12T21:57:41Z'));
  const second = writeResult(dir, { run: 2 }, new Date('2026-09-13T22:09:55Z'));
  const latest = path.join(dir, 'retrieval-latest.json');
  assert.equal(JSON.parse(fs.readFileSync(latest, 'utf8')).run, 2);
  assert.equal(fs.lstatSync(latest).isSymbolicLink(), false);
  assert.notEqual(second, latest);
  const dated = fs.readdirSync(dir).filter(f => f !== 'retrieval-latest.json');
  assert.deepEqual(dated.sort(), ['retrieval-20260912-215741.json', 'retrieval-20260913-220955.json']);
});

test('a partial (--limit) run is kept but does not become latest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  writeResult(dir, { run: 'full' }, new Date('2026-09-13T22:09:55Z'));
  const partial = writeResult(dir, { run: 'partial' }, new Date('2026-09-13T22:30:00Z'), { latest: false });
  assert.equal(JSON.parse(fs.readFileSync(partial, 'utf8')).run, 'partial');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'retrieval-latest.json'), 'utf8')).run, 'full');
});

test('requiring the script does not run the benchmark', () => {
  // it would open a DB connection and spend Gemini calls just by being tested
  const mod = require('../ops/bini/rerun-retrieval-benchmark');
  assert.equal(typeof mod.writeResult, 'function');
});

// A second gold set (v2, 14 September) must be selectable without changing what a plain run measures,
// and its results must never land in the files the v1 figures are read from.
test('the gold set defaults to v1; --gold beats $BINI_GOLD', () => {
  assert.equal(goldPath(['node', 'x'], {}), GOLD);
  assert.equal(goldPath(['node', 'x'], { BINI_GOLD: '/tmp/g2.json' }), '/tmp/g2.json');
  assert.equal(goldPath(['node', 'x', '--gold', '/tmp/g3.json'], { BINI_GOLD: '/tmp/g2.json' }), '/tmp/g3.json');
});

test('v1 keeps its file names; another gold set gets its own dated file and its own latest', () => {
  assert.equal(goldTag(GOLD), '');
  assert.equal(goldTag('/root/storage/bina-embed/eval/gold-v2.json'), 'gold-v2');
  assert.equal(resultName(new Date('2026-09-14T10:15:00Z'), 'gold-v2'), 'retrieval-gold-v2-20260914-101500.json');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bini-eval-'));
  writeResult(dir, { run: 'v1' }, new Date('2026-09-13T22:18:25Z'));
  writeResult(dir, { run: 'v2' }, new Date('2026-09-14T10:15:00Z'), { tag: 'gold-v2' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'retrieval-latest.json'), 'utf8')).run, 'v1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, latestName('gold-v2')), 'utf8')).run, 'v2');
});

test('"any page" finds every page holding the passage, across line breaks, and nothing else', () => {
  const chunks = [
    { slug: 'ena/a', text: 'ዜና\nኡስማን ደምቤሌ   የወቅቱ\nየባሎን ዶር አሸናፊ ነው።' },
    { slug: 'fana/b', text: 'ኡስማን ደምቤሌ የወቅቱ የባሎን ዶር አሸናፊ ነው' },
    { slug: 'ebc/c', text: 'ኡስማን ደምቤሌ ተጫዋች ነው' },
  ];
  assert.deepEqual([...pagesContaining(chunks, 'ኡስማን ደምቤሌ የወቅቱ የባሎን ዶር አሸናፊ ነው')].sort(), ['ena/a', 'fana/b']);
  assert.equal(pagesContaining(chunks, '').size, 0);
});

// v3 (gold-v3-agents.json, 14 September): the 120 gap-audit questions asked of Dr Afiya and Asmat. It is an
// object, not a list: scored questions (one or more gold pages each, graded GOOD or PARTIAL) plus the NONE
// questions kept as coverage gaps that are never scored. Each question belongs to an agent and must be run
// with that agent's own knowledge preference, or the benchmark measures a retrieval nobody ships.
test('a v1/v2 list and a v3 object both normalise to questions with gold pages; v3 gaps stay out of the score', () => {
  const v1 = normalizeGold([{ qid: 1, question: 'q', gold_slug: 'fayda', gold_source: 'guide', lang: 'am' }]);
  assert.equal(v1.questions.length, 1);
  assert.deepEqual(v1.questions[0].goldPages, [{ source: 'guide', slug: 'fayda' }]);
  assert.deepEqual(v1.gaps, []);
  const v3 = normalizeGold({ questions: [{ qid: 'A01', agent: 'afiya', question: 'q', lang: 'am', grade: 'GOOD',
    gold_source: 'health', gold_slug: 'x', gold_pages: [{ source: 'health', slug: 'x', lang: 'en' }, { source: 'health', slug: 'x-am', lang: 'am' }] }],
  coverage_gaps: [{ qid: 'A19', agent: 'afiya', question: 'yellow fever', lang: 'am', grade: 'NONE' }] });
  assert.equal(v3.questions.length, 1);
  assert.deepEqual(v3.questions[0].goldPages.map(p => p.slug), ['x', 'x-am']);
  assert.equal(v3.gaps.length, 1);
  assert.equal(v3.questions[0].agent, 'afiya');
});

test('v1/v2 match a gold page by slug, as they always did; v3 by source and slug', () => {
  assert.deepEqual(goldKeys({ goldPages: [{ source: 'guide', slug: 'fayda' }] }), ['fayda']);
  assert.deepEqual(goldKeys({ agent: 'asmat', goldPages: [{ source: 'law', slug: 'a' }, { source: 'news', slug: 'b' }] }), ['law:a', 'news:b']);
});

test('pageRank is the 1-based rank of the first gold PAGE, counting a page once however many chunks it has', () => {
  const hits = [{ source: 'law', slug: 'a' }, { source: 'law', slug: 'a' }, { source: 'guide', slug: 'b' }, { source: 'news', slug: 'c' }];
  assert.equal(pageRank(hits, ['news:c'], true), 3);
  assert.equal(pageRank(hits, ['b'], false), 2);
  assert.equal(pageRank(hits, ['law:zzz'], true), null);
  // same slug under another source is not the gold page in v3
  assert.equal(pageRank([{ source: 'guide', slug: 'a' }], ['law:a'], true), null);
});

test('a question without an agent gets the plain benchmark options; an agent question gets exactly what contextFor builds for that agent', () => {
  const cso = ({ k = 6, prefer, exclude } = {}) => ({ k: k * 3, exclude: ['style', 'style-om'].concat(exclude || []), rerankTo: k, ...(prefer ? { prefer } : {}) });
  const none = searchOptionsFor({}, { contextSearchOptions: cso, knowledgeOf: () => { throw new Error('not called'); } });
  assert.deepEqual(none.plain, { k: 18, exclude: ['style', 'style-om'] });
  assert.deepEqual(none.shipped, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
  const agent = searchOptionsFor({ agent: 'afiya' }, { contextSearchOptions: cso, knowledgeOf: a => (a === 'afiya' ? { prefer: ['health'], exclude: ['page'] } : null) });
  assert.deepEqual(agent.shipped, { k: 18, exclude: ['style', 'style-om', 'page'], rerankTo: 6, prefer: ['health'] });
  assert.deepEqual(agent.plain, { k: 18, exclude: ['style', 'style-om', 'page'], prefer: ['health'] });
  assert.equal('rerankTo' in agent.plain, false);
});
