'use strict';
// Per-agent source preference (knowledge: { prefer, exclude } on an agent definition).
// The promise that matters most: a caller that declares nothing — Bini's own route, the MCP, token-cost, the
// benchmark — gets exactly the retrieval it got before this existed. Then: what an agent excludes never reaches it,
// and what it prefers wins the close calls the old own-source boost used to hand to BinaSmart's marketing pages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, hybridScore, pageMatcher, contextSearchOptions, DIMS } = require('../knowledge/index');

// An in-memory store holding rows we write ourselves, and a fake embedder (token hashing), as in knowledge.test.js.
function store(docs, { withKey = true } = {}) {
  const rows = [];
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  const { toBuf } = require('../knowledge/index');
  let id = 0;
  for (const d of docs) rows.push({ id: 'r' + (++id), source: d.source, slug: d.slug, url: d.url || 'https://example.et/' + d.slug, title: d.title || d.slug,
    lang: 'en', ord: 0, text: d.text, embedding: withKey ? toBuf(fakeVec(d.text)) : null });
  const prisma = { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } };
  const fetchImpl = async (url, opts) => ({ status: 200, json: async () => ({ embedding: { values: fakeVec(JSON.parse(opts.body).content.parts[0].text) } }) });
  return makeKnowledge({ prisma, apiKey: withKey ? 'k' : '', fetchImpl, root: path.join(__dirname, '..'), sleep: async () => {} });
}

const DOCS = [
  { source: 'guide', slug: 'business-registration-ethiopia', title: 'Business Registration', text: 'check whether a business licence is valid licence checker etrade clinic shop licence registration number' },
  { source: 'guide', slug: 'mesob', title: 'Mesob', text: 'where is it located in Addis Ababa one stop service centre where can I find it' },
  { source: 'page', slug: 'airport', title: 'Airport transfer', text: 'transfer from the airport to your house in Addis Ababa book a transfer deed' },
  { source: 'health', slug: 'facility-standards', title: 'Health facility standards', text: 'health facility licence clinic licensed by the health regulator inspection' },
  { source: 'law', slug: 'property-transfer', title: 'Property transfer', text: 'transfer of a house title deed to a buyer registration at the land office' },
  { source: 'news', slug: 'law-2-house-rent', title: 'Rent law', text: 'rent may be raised once a year house rent law' },
  { source: 'news', slug: 'celebrity', title: 'Celebrity', text: 'rent a car for a celebrity wedding in Addis' },
  { source: 'web', slug: 'moh/abc', title: 'MoH', text: 'ministry of health clinic services where to find' },
  { source: 'skill', slug: 'binasmart-system', title: 'BinaSmart system', text: 'internal system notes licence clinic transfer' },
  { source: 'style', slug: 'amharic-voice', title: 'voice', text: 'clinic licence voice example' },
];

test('no declaration: contextFor builds exactly the search options it used before', () => {
  // `watch` is excluded by default now: a question with no recency marker must reach the law, not a Telegram post.
  // Nothing that existed before is retrieved any differently; the new source is the only entry added.
  assert.deepEqual(contextSearchOptions({}), { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6 });
  assert.deepEqual(contextSearchOptions({ k: 6 }), { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6 });
  assert.deepEqual(contextSearchOptions(), { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6 });
  assert.deepEqual(contextSearchOptions({ k: 3 }), { k: 9, exclude: ['style', 'style-om', 'watch'], rerankTo: 3 });
});

test('no preference: hybridScore is the old formula for every source, with and without a vector', () => {
  const old = ({ cos = 0, kw = 0, source, hasVec = true }) => {
    const own = new Set(['guide', 'page', 'addis', 'skill', 'llms', 'docs']).has(source) ? 0.06 : 0;
    return (hasVec ? cos + 0.15 * kw : kw) + (hasVec ? own : own * 0.5);
  };
  for (const source of ['guide', 'page', 'addis', 'skill', 'llms', 'docs', 'web', 'news', 'law', 'health', 'eservices'])
    for (const hasVec of [true, false])
      assert.equal(hybridScore({ cos: 0.61, kw: 0.4, source, hasVec }), old({ cos: 0.61, kw: 0.4, source, hasVec }), source + ' ' + hasVec);
});

test('no preference: search and contextFor return the same hits as the pre-preference call', async () => {
  // The reranker calls Gemini over the network, so ranking is compared with rerankTo left out (vectors on), and the
  // full contextFor call on a keyless store, where the reranker is skipped by design.
  const k = store(DOCS);
  const keyless = store(DOCS, { withKey: false });
  for (const q of ['is this clinic licensed', 'where can I find a clinic', 'transfer a house title deed', 'rent raised once a year']) {
    const legacy = await k.search(q, { k: 18, exclude: ['style', 'style-om'] });
    const { rerankTo, ...ranking } = contextSearchOptions({});
    assert.equal(rerankTo, 6);
    assert.deepEqual(await k.search(q, ranking), legacy, q);
    assert.deepEqual(await k.search(q, { k: 18, exclude: ['style', 'style-om'], prefer: undefined }), legacy, q);
    assert.deepEqual(await keyless.search(q, contextSearchOptions({})), await keyless.search(q, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 }), q);
    assert.equal(await keyless.contextFor(q, { lang: 'en' }), await keyless.contextFor(q, { lang: 'en', prefer: undefined, exclude: undefined }), q);
  }
});

test('pageMatcher: whole sources, single pages and star prefixes; empty lists match nothing', () => {
  const m = pageMatcher(['health', 'guide:mesob', 'web:moh/*', 'news:law-*']);
  assert.equal(m('health', 'anything'), true);
  assert.equal(m('guide', 'mesob'), true);
  assert.equal(m('guide', 'mesob-2'), false);
  assert.equal(m('guide', 'fayda'), false);
  assert.equal(m('web', 'moh/abc'), true);
  assert.equal(m('web', 'mohx/abc'), false);
  assert.equal(m('news', 'law-2-house-rent'), true);
  assert.equal(m('news', 'celebrity'), false);
  assert.equal(pageMatcher([]), null);
  assert.equal(pageMatcher(undefined), null);
  assert.equal(pageMatcher(['', ':x', 'guide:']), null);
});

test('exclude: an excluded page or source never comes back, however well it matches', async () => {
  const k = store(DOCS);
  const plain = await k.search('is this clinic licence valid licence checker', { k: 5 });
  assert.equal(plain[0].slug, 'business-registration-ethiopia', 'the fixture reproduces the audit: the business checker wins');
  const hits = await k.search('is this clinic licence valid licence checker', { k: 5, exclude: ['style', 'guide:business-registration-ethiopia', 'skill'] });
  assert.ok(hits.length);
  assert.equal(hits.some(h => h.slug === 'business-registration-ethiopia' || h.source === 'skill'), false);
  assert.ok(hits.some(h => h.source === 'guide' || h.source === 'health'), 'other pages of the same source still come back');
});

test('prefer: the boost moves to the preferred sources and away from the ones it used to favour', async () => {
  const guide = hybridScore({ cos: 0.60, kw: 0.5, source: 'guide', preferred: false });
  const health = hybridScore({ cos: 0.60, kw: 0.5, source: 'health', preferred: true });
  assert.ok(health > guide);
  assert.equal(hybridScore({ cos: 0.60, kw: 0.5, source: 'guide', preferred: true }), hybridScore({ cos: 0.60, kw: 0.5, source: 'guide' }));
  // an empty prefer list means "boost nothing", not "no preference"
  const k = store(DOCS);
  const none = await k.search('transfer house deed', { k: 3, prefer: [] });
  const legacy = await k.search('transfer house deed', { k: 3 });
  const pageLegacy = legacy.find(h => h.slug === 'airport'), pageNone = none.find(h => h.slug === 'airport');
  assert.ok(pageLegacy && pageNone && pageNone.score < pageLegacy.score, 'the page lost its boost');
});

test('the voice corpora stay out of the facts block whatever an agent lists', () => {
  const o = contextSearchOptions({ prefer: ['style'], exclude: ['page'] });
  assert.deepEqual(o.exclude, ['style', 'style-om', 'page', 'watch']);
  assert.deepEqual(o.prefer, ['style']);
});

// The declarations themselves, with the pages the gap audit (2026-09-14) found winning the wrong questions.
test('Dr Afiya never receives the business licence checker, the Mesob guide or BinaSmart marketing pages', async () => {
  const afiya = require('../agents/afiya/rules').knowledge;
  assert.ok(afiya && Array.isArray(afiya.prefer) && Array.isArray(afiya.exclude));
  const ex = pageMatcher(afiya.exclude), pre = pageMatcher(afiya.prefer);
  for (const [s, slug] of [['guide', 'business-registration-ethiopia'], ['guide', 'how-to-start-a-business-in-ethiopia'], ['guide', 'mesob'], ['page', 'amharic-ai'], ['page', 'airport'], ['skill', 'binasmart-system']])
    assert.equal(ex(s, slug), true, s + ':' + slug + ' must be excluded');
  for (const [s, slug] of [['health', 'ehsp-annex-service-levels-2019'], ['web', 'moh/1a7a920ed1af'], ['eservices', 'ethiopian-food-and-drug-authority'], ['law', 'labour-proclamation-1156-2019']])
    assert.equal(pre(s, slug), true, s + ':' + slug + ' must be preferred');
  assert.equal(pre('eservices', 'ministry-of-revenues'), false, 'only health offices of the eServices directory');
  const k = store(DOCS, { withKey: false });   // keyless: contextFor would otherwise call the real reranker
  const ctx = await k.contextFor('how can I check that a clinic is licensed', { lang: 'en', ...afiya });
  assert.match(ctx, /Relevant BinaSmart knowledge/);
  assert.equal(/Business Registration|Mesob|BinaSmart system/.test(ctx), false);
});

test('Asmat never receives the airport-transfer page and prefers the law library, the guides and the eServices directory', async () => {
  const asmat = require('../agents/asmat/rules').knowledge;
  assert.ok(asmat && Array.isArray(asmat.prefer) && Array.isArray(asmat.exclude));
  const ex = pageMatcher(asmat.exclude), pre = pageMatcher(asmat.prefer);
  for (const [s, slug] of [['page', 'airport'], ['page', 'property'], ['page', 'amharic-ai'], ['skill', 'binasmart-system']]) assert.equal(ex(s, slug), true, s + ':' + slug);
  for (const [s, slug] of [['law', 'fdre-constitution'], ['guide', 'rental-agreement-ethiopia'], ['eservices', 'document-authentication-and-registration-service'], ['news', 'law-2-house-rent'], ['web', 'justice/f5d8d49b9a49']]) assert.equal(pre(s, slug), true, s + ':' + slug);
  assert.equal(pre('news', 'celebrity'), false);
  const k = store(DOCS, { withKey: false });
  const ctx = await k.contextFor('how do I transfer a house title deed to a buyer', { lang: 'en', ...asmat });
  assert.equal(/Airport transfer/.test(ctx), false);
  assert.match(ctx.split('\n').find(l => /^\[1\]/.test(l)), /Property transfer/);
});
