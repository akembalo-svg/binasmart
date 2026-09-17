'use strict';
// Bilingual query retrieval: an Amharic question is also searched under an English rendering of itself,
// and the two candidate lists are fused before the reranker sees them.
//
// Why it exists. Measured 2026-09-17 on the 90-question banking gold set: questions whose gold page is in
// the question's own language score 86.2% on retrieval, and the 32 Amharic questions whose only gold page
// is English score 43.8%. Only some institutions publish Amharic, so an Amharic question is captured by
// whatever Amharic page is nearest even when the right English page exists. The Amharic key-fact headers
// (ops/packs/am-headers.js) fixed part of this from the document side; this is the query side.
//
// The promise this file holds: with the flag off, retrieval is byte for byte what it was. The fixture below
// was captured from the code as it stood at 8e47cf6, before any of this existed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, DIMS, toBuf, bilingualEnabled, bilingualEn2AmEnabled, makeQueryTranslator } = require('../knowledge/index');

const ROOT = path.join(__dirname, '..');

const DOCS = [
  { source: 'banking', slug: 'zemen-tariff', title: 'Zemen Bank - Tariff', lang: 'en',
    text: 'Zemen Bank tariff card issuance fee charges for digital channels ATM card replacement fee' },
  { source: 'banking', slug: 'zemen-am-forex-service', title: 'Zemen Bank - forex', lang: 'am',
    text: 'ዘመን ባንክ የውጭ ምንዛሪ አገልግሎት ሂሳብ ካርድ ክፍያ' },
  { source: 'banking', slug: 'cbe-diaspora', title: 'CBE diaspora account', lang: 'en',
    text: 'Commercial Bank of Ethiopia diaspora account remittance transfer money from abroad' },
  { source: 'guide', slug: 'open-bank-account-ethiopia', title: 'Open a bank account', lang: 'en',
    text: 'how to open a bank account in Ethiopia documents needed fee for a new card' },
  { source: 'web', slug: 'site/news', title: 'A news page', lang: 'am',
    text: 'ባንክ ዜና ካርድ ክፍያ ስለ ባንኮች' },
];

// The same in-memory store and token-hashing embedder the other knowledge tests use, plus a count of how
// many query embeddings were actually asked for.
function store(docs, opts = {}) {
  const { withKey = true } = opts;
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  let id = 0;
  const rows = docs.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: 'https://example.et/' + d.slug, title: d.title, lang: d.lang, ord: 0,
    text: d.text, embedding: withKey ? toBuf(fakeVec(d.text)) : null }));
  const prisma = { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } };
  const embedded = [];
  const fetchImpl = async (url, o) => {
    const text = JSON.parse(o.body).content.parts[0].text;
    embedded.push(text);
    return { status: 200, json: async () => ({ embedding: { values: fakeVec(text) } }) };
  };
  const lines = [];
  const k = makeKnowledge({ prisma, apiKey: withKey ? 'k' : '', fetchImpl, root: ROOT, sleep: async () => {},
    localFallback: false, queryLog: s => lines.push(s),
    bilingual: opts.bilingual, bilingualEn2Am: opts.bilingualEn2Am, translateQuery: opts.translateQuery,
    bilingualFusion: opts.bilingualFusion, bilingualKeywordMode: opts.bilingualKeywordMode });
  return { k, embedded, lines };
}
const ranking = hits => hits.map(h => h.source + '/' + h.slug + '@' + h.score);

// Captured from HEAD 8e47cf6 (scratch script, same docs, same fake embedder) before bilingual retrieval existed.
const TODAY = {
  'የካርድ ክፍያ ስንት ነው': ['web/site/news@0.2416', 'banking/zemen-am-forex-service@0.2143', 'guide/open-bank-account-ethiopia@0.06'],
  'card issuance fee': ['banking/zemen-tariff@0.8304', 'guide/open-bank-account-ethiopia@0.4401'],
  'remittance from abroad': ['banking/cbe-diaspora@0.6722', 'guide/open-bank-account-ethiopia@0.06'],
  'sint new yikirta': ['guide/open-bank-account-ethiopia@0.25'],
};

test('the flag is read from the environment, and both flags are off when nothing is set', () => {
  assert.equal(bilingualEnabled({ KNOWLEDGE_BILINGUAL_QUERY: '1' }), true);
  assert.equal(bilingualEnabled({ KNOWLEDGE_BILINGUAL_QUERY: '0' }), false);
  assert.equal(bilingualEnabled({ KNOWLEDGE_BILINGUAL_QUERY: 'off' }), false);
  assert.equal(bilingualEn2AmEnabled({}), false);
  assert.equal(bilingualEn2AmEnabled({ KNOWLEDGE_BILINGUAL_EN2AM: '1' }), true);
});

test('flag OFF: the candidate ranking is exactly the one measured before this existed, and no translation is asked for', async () => {
  let calls = 0;
  const { k, embedded } = store(DOCS, { bilingual: false, translateQuery: async () => { calls++; return 'card issuance fee'; } });
  for (const [q, expected] of Object.entries(TODAY)) assert.deepEqual(ranking(await k.search(q, { k: 5 })), expected, q);
  assert.equal(calls, 0, 'the translator must never be called with the flag off');
  assert.equal(embedded.length, 4, 'one query embedding per question, as before');
});

test('flag ON: an Amharic question is also searched under its English rendering, and max-fusion lifts the English page', async () => {
  const { k, embedded } = store(DOCS, { bilingual: true, translateQuery: async (q, to) => { assert.equal(to, 'en'); return 'card issuance fee'; } });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 });
  assert.deepEqual(embedded, ['የካርድ ክፍያ ስንት ነው', 'card issuance fee'], 'both renderings are embedded');
  assert.equal(hits[0].source + '/' + hits[0].slug, 'banking/zemen-tariff',
    'the English tariff page, invisible to the Amharic question alone, is now first');
  // Fused by the MAX of the two hybrid scores, not their sum or their mean: the page keeps the score the
  // English rendering gave it (cosine 0.6804 plus 0.15 x the union keyword score 3/7), and gains nothing
  // from also being scored against the Amharic one.
  assert.ok(hits[0].score > 0.70 && hits[0].score < 0.80, 'fused score is the max of the two, got ' + hits[0].score);
  // and the Amharic pages the question found on its own are still there
  assert.ok(hits.some(h => h.slug === 'zemen-am-forex-service'), 'the Amharic page is not thrown away');
});

test('flag ON: the keyword score is the union of the hits of both renderings', async () => {
  // No vectors at all, so the score IS the keyword score: the English page can only be found here through
  // the English rendering's tokens.
  const { k } = store(DOCS, { withKey: false, bilingual: true, translateQuery: async () => 'card issuance fee' });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 });
  const tariff = hits.find(h => h.slug === 'zemen-tariff');
  assert.ok(tariff, 'the English page is reachable by the union of both renderings keywords');
  // union tokens: የካርድ ክፍያ ስንት ነው (4, folded) + card issuance fee (3) = 7; the tariff page holds card, issuance, fee
  assert.equal(tariff.score, +(3 / 7).toFixed(4), 'keyword score over the union, got ' + tariff.score);
});

test('keyword mode per: a page the question itself matched keeps its own denominator', async () => {
  // The cost of the union: a question of four Amharic words that matched all four is scored 4/7 once the
  // English rendering brings three more tokens. `per` gives each rendering its own tokens, so the Amharic
  // page keeps the score the Amharic question gave it. This is the difference the banking benchmark
  // measured at 8.6 points on the same-language slice; see the report.
  const q = 'የካርድ ክፍያ ስንት ነው';
  const translateQuery = async () => 'card issuance fee';
  const union = store(DOCS, { bilingual: true, translateQuery });
  const per = store(DOCS, { bilingual: true, translateQuery, bilingualKeywordMode: 'per' });
  const find = (hits, slug) => hits.find(h => h.slug === slug);
  const u = await union.k.search(q, { k: 5 }), p = await per.k.search(q, { k: 5 });
  assert.ok(find(p, 'site/news').score > find(u, 'site/news').score,
    'per ' + find(p, 'site/news').score + ' should beat union ' + find(u, 'site/news').score);
  // and the English page the rendering found is still there either way
  assert.ok(find(u, 'zemen-tariff') && find(p, 'zemen-tariff'));
});

test('fusion rrf: both renderings candidates are returned, ordered by their two ranks', async () => {
  const { k } = store(DOCS, { bilingual: true, bilingualFusion: 'rrf', translateQuery: async () => 'card issuance fee' });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 });
  const slugs = hits.map(h => h.slug);
  assert.ok(slugs.includes('zemen-tariff'), 'the English rendering candidate is in the list');
  assert.ok(slugs.includes('site/news') || slugs.includes('zemen-am-forex-service'), 'so is an Amharic one');
});

test('the translator times out: the search falls back to the single-query behaviour and says why', async () => {
  const { k, lines, embedded } = store(DOCS, {
    bilingual: true,
    translateQuery: async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; },
  });
  assert.deepEqual(ranking(await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 })), TODAY['የካርድ ክፍያ ስንት ነው'], 'exactly the old ranking');
  assert.equal(embedded.length, 1, 'only the question itself was embedded');
  assert.ok(lines.some(l => l === '[knowledge] bilingual: skipped (timeout)'), 'logged: ' + JSON.stringify(lines));
});

test('makeQueryTranslator gives up at its own timeout rather than holding the answer', async () => {
  const translate = makeQueryTranslator({ apiKey: 'k', timeoutMs: 30, fetchImpl: (url, o) => new Promise((res, rej) => { o.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); }) });
  await assert.rejects(() => translate('የካርድ ክፍያ ስንት ነው', 'en'), e => e.name === 'AbortError');
});

test('an English question is left exactly as it is, unless EN2AM is switched on', async () => {
  let calls = 0;
  const off = store(DOCS, { bilingual: true, translateQuery: async () => { calls++; return 'x'; } });
  assert.deepEqual(ranking(await off.k.search('card issuance fee', { k: 5 })), TODAY['card issuance fee']);
  assert.equal(calls, 0, 'an English question asks for no rendering by default');
  const on = store(DOCS, { bilingual: true, bilingualEn2Am: true, translateQuery: async (q, to) => { calls++; assert.equal(to, 'am'); return 'የካርድ ክፍያ'; } });
  await on.k.search('card issuance fee', { k: 5 });
  assert.equal(calls, 1, 'with EN2AM the English question gets an Amharic rendering');
  assert.equal(on.embedded.length, 2);
});

test('Latin-letter Amharic counts as Amharic here too, and the rendering is cached across searches', async () => {
  let calls = 0;
  const { k } = store(DOCS, { bilingual: true, translateQuery: async () => { calls++; return 'how much is the card fee'; } });
  await k.search('sint new yikirta', { k: 5 });
  assert.equal(calls, 1, 'Latin-letter Amharic is Amharic');
  await k.search('sint new yikirta', { k: 5 });
  await k.search('  Sint New Yikirta  ', { k: 5 });
  assert.equal(calls, 1, 'a cache hit must not call the translator again, whatever the spacing or case');
});

test('the voice corpora are searched in the question language only', async () => {
  let calls = 0;
  const { k } = store([{ source: 'style', slug: 'amharic-voice', title: 'voice', lang: 'am', text: 'ሰላም እንዴት ነህ ካርድ ክፍያ' }],
    { bilingual: true, translateQuery: async () => { calls++; return 'card fee'; } });
  await k.search('የካርድ ክፍያ ስንት ነው', { k: 4, sources: ['style'] });
  assert.equal(calls, 0, 'a voice-example lookup is about register, not about facts: no English rendering');
});

// ---------- augment: the rendering may rescue, never displace ----------
// Max fusion bought one cross-lingual hit and sold one same-language hit (report §4: six Amharic questions
// lost an Amharic gold page to the English rendering). These two modes keep the question's own ranking and
// let the rendering add to it: `augment` strictly after it, `augment-top` merged in with first place pinned.

test('fusion augment: the question keeps the ranking it has today, and the rendering only APPENDS a page it never held', async () => {
  const q = 'የካርድ ክፍያ ስንት ነው';
  const { k } = store(DOCS, { bilingual: true, bilingualFusion: 'augment', translateQuery: async () => 'card issuance fee' });
  const hits = ranking(await k.search(q, { k: 5 }));
  assert.deepEqual(hits.slice(0, 3), TODAY[q], 'the first three are the single-query ranking, scores and all');
  assert.deepEqual(hits.slice(3), ['banking/zemen-tariff@0.8304'],
    'and the English page the question never surfaced is appended after them, with its own score');
});

test('fusion augment: a page the question already ranked is neither re-scored nor appended a second time', async () => {
  // The guide scores 0.06 under the Amharic question and 0.4401 under the English rendering. Under `augment`
  // it must keep 0.06 and appear once: the rendering has no vote on a page the question already found.
  const { k } = store(DOCS, { bilingual: true, bilingualFusion: 'augment', translateQuery: async () => 'card issuance fee' });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 });
  const guide = hits.filter(h => h.slug === 'open-bank-account-ethiopia');
  assert.equal(guide.length, 1, 'once, not twice');
  assert.equal(guide[0].score, 0.06, 'the score the question gave it, not the 0.4401 the rendering would');
});

test('fusion augment-top: the rescued page is merged in by its own score, and top-1 is pinned', async () => {
  const q = 'የካርድ ክፍያ ስንት ነው';
  const { k } = store(DOCS, { bilingual: true, bilingualFusion: 'augment-top', translateQuery: async () => 'card issuance fee' });
  const hits = ranking(await k.search(q, { k: 5 }));
  assert.equal(hits[0], TODAY[q][0], 'the page the question itself ranked first is still first');
  assert.equal(hits[1], 'banking/zemen-tariff@0.8304', 'the rescued page takes the place its own score earns');
  assert.deepEqual(hits.slice(2), TODAY[q].slice(1), 'everything under it keeps its score and its order');
});

test('fusion augment: the rescued pages obey the same two-chunks-per-page rule as everything else', async () => {
  const many = DOCS.concat([0, 1, 2].map(i => ({ source: 'banking', slug: 'dashen-cards', title: 'Dashen cards ' + i, lang: 'en',
    text: 'Dashen Bank card issuance fee schedule part ' + i + ' debit prepaid' })));
  const { k } = store(many, { bilingual: true, bilingualFusion: 'augment', translateQuery: async () => 'card issuance fee' });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 12 });
  assert.equal(hits.filter(h => h.slug === 'dashen-cards').length, 2, 'two chunks of the rescued page, not three');
});

test('an unknown fusion name falls back to max rather than silently retrieving nothing', async () => {
  const { k } = store(DOCS, { bilingual: true, bilingualFusion: 'augmentt', translateQuery: async () => 'card issuance fee' });
  const hits = await k.search('የካርድ ክፍያ ስንት ነው', { k: 5 });
  assert.equal(hits[0].slug, 'zemen-tariff', 'max fusion, which is what a typo must not turn into no fusion');
});

test('flag OFF beats any fusion setting: an augment run with the flag off is the single-query search', async () => {
  let calls = 0;
  const { k, embedded } = store(DOCS, { bilingual: false, bilingualFusion: 'augment-top', translateQuery: async () => { calls++; return 'card issuance fee'; } });
  for (const [q, expected] of Object.entries(TODAY)) assert.deepEqual(ranking(await k.search(q, { k: 5 })), expected, q);
  assert.equal(calls, 0);
  assert.equal(embedded.length, 4);
});
