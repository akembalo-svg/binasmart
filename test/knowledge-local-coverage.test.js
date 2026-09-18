'use strict';
// The local-fallback cliff, and the health line that shows a gap before an outage finds it.
// When the Gemini query embedding fails, search ranks on BGE-M3 vectors. A chunk with no local vector used to be
// scored cos 0 + 0.15 * kw there — next to nothing against chunks with a real cosine — so a source half-embedded
// after an ingest ranked worse than keyword-only (business, forced failure: 5.0% Page@3 with no local vectors,
// 56.7% keyword-only; docs/superpowers/notes/2026-09-18-local-fallback-backfill.md). Now such a chunk is scored
// on the local path exactly as keyword-only mode scores it. The Gemini path does not change at all.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, hybridScore, toBuf, DIMS, LOCAL_DIMS } = require('../knowledge/index');

const ROOT = path.join(__dirname, '..');
const gvec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
const onehot = i => { const v = new Array(LOCAL_DIMS).fill(0); v[i] = 1; return v; };

// "trade licence renewal" is answered by the business page, whose chunks have NO local vector (a fresh ingest).
// The law page has local vectors that sit weakly near the query (cosine 0.3) and shares one word with it.
const DOCS = [
  { source: 'business', slug: 'trade-licence', text: 'trade licence renewal fee and documents for trade licence renewal', local: null, gem: true },
  { source: 'business', slug: 'trade-licence', text: 'renewal of a trade licence after the deadline carries a penalty', local: null, gem: true },
  { source: 'law', slug: 'commercial-code', text: 'commercial registration of a business under the commercial code renewal', local: 'weak', gem: true },
  { source: 'health', slug: 'clinic', text: 'clinic standards inspection', local: 'none-match', gem: true },
  { source: 'news', slug: 'no-gemini', text: 'trade licence renewal news without a gemini vector', local: 'none-match', gem: false },
];
const weak = () => { const v = new Array(LOCAL_DIMS).fill(0); v[0] = 0.3; v[1] = Math.sqrt(1 - 0.09); return v; };

function store({ geminiDown = false, key = true, local = true } = {}) {
  let id = 0;
  const rows = DOCS.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: null, title: d.slug, lang: 'en', ord: 0, text: d.text,
    embedding: d.gem ? toBuf(gvec(d.text)) : null,
    embeddingLocal: d.local === null ? null : toBuf(d.local === 'weak' ? weak() : onehot(7)) }));
  const fetchImpl = async (url, opts) => {
    if (geminiDown) throw new Error('network down');
    return { status: 200, json: async () => ({ embedding: { values: gvec(JSON.parse(opts.body).content.parts[0].text) } }) };
  };
  const localEmbedder = local ? { query: async () => onehot(0), documents: async () => { throw new Error('not in search'); } } : undefined;
  return makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } }, apiKey: key ? 'k' : '', fetchImpl, root: ROOT,
    sleep: async () => {}, localEmbedder, localFallback: local, queryLog: () => {} });
}

test('fallback: a chunk with no local vector is scored as keyword-only scores it, not as zero', async () => {
  const q = 'trade licence renewal';
  const fb = await store({ geminiDown: true }).search(q, { k: 10 });
  const kwOnly = await store({ key: false, local: false }).search(q, { k: 10 });
  const top = fb[0];
  assert.equal(top.slug, 'trade-licence', 'the unembedded page that answers is first:\n' + JSON.stringify(fb));
  const kwTop = kwOnly.find(h => h.slug === 'trade-licence');
  assert.equal(top.score, kwTop.score, 'the same score keyword-only mode gives it');
  assert.equal(top.score, +hybridScore({ kw: 1, source: 'business', hasVec: false }).toFixed(4));
});

test('fallback: chunks that do have a local vector keep cos + 0.15 * kw, unchanged', async () => {
  const fb = await store({ geminiDown: true }).search('trade licence renewal', { k: 10 });
  const law = fb.find(h => h.slug === 'commercial-code');
  // cosine 0.3 with the query's local vector, and 1 of 3 query words ("renewal")
  assert.equal(law.score, +(0.3 + 0.15 * (1 / 3)).toFixed(4));
});

test('the Gemini path is untouched: a chunk without a Gemini vector still gets only 0.15 * kw there', async () => {
  const ok = await store().search('trade licence renewal', { k: 10 });
  const news = ok.find(h => h.slug === 'no-gemini');
  assert.ok(news, JSON.stringify(ok));
  assert.equal(news.score, +(0.15 * 1).toFixed(4), 'Gemini mode: cos 0 + 0.15 * kw, exactly as before');
  // and the same search with local vectors taken away altogether is identical, key for key
  const noLocal = await store({ local: false }).search('trade licence renewal', { k: 10 });
  assert.deepEqual(ok, noLocal);
});

test('health reports local coverage per source', () => {
  const k = store();
  return k.load().then(() => {
    const h = k.health();
    assert.deepEqual(h.localCoverage, {
      business: { chunks: 2, local: 0 }, law: { chunks: 1, local: 1 }, health: { chunks: 1, local: 1 }, news: { chunks: 1, local: 1 } });
    assert.equal(h.embeddedLocal, 3);
  });
});

test('health with the fallback off: coverage is reported as zero local, not hidden', async () => {
  const k = store({ local: false });
  await k.load();
  assert.deepEqual(k.health().localCoverage.business, { chunks: 2, local: 0 });
  assert.deepEqual(k.health().localCoverage.law, { chunks: 1, local: 0 });
});
