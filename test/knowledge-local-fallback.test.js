'use strict';
// BGE-M3 (bina-embed on :3031) as the fallback query embedder, and an ingest that embeds until nothing is left.
// The promise that matters most: while Gemini answers, search is exactly what it was — the local vectors are not
// even looked at. Only when the Gemini query embedding throws does the query go to bina-embed, and then it is
// ranked against the BGE chunk vectors (never the Gemini ones) with the same scoring, preferences and page cap.
// Measured on gold v3, 2026-09-14: Page@3 96.4% Gemini, 85.6% BGE-M3, 59.5% keyword-only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, makeLocalEmbedder, localFallbackEnabled, toBuf, DIMS, LOCAL_DIMS, LOCAL_BATCH, LOCAL_MAX_PER_RUN } = require('../knowledge/index');

const ROOT = path.join(__dirname, '..');
const gvec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
const onehot = i => { const v = new Array(LOCAL_DIMS).fill(0); v[i] = 1; return v; };

// Documents: by words (Gemini + keywords) "licence clinic" belongs to A; the local vectors say B.
const DOCS = [
  { source: 'guide', slug: 'a-licence', text: 'clinic licence check licence clinic registration', local: 0 },
  { source: 'health', slug: 'b-standards', text: 'health facility standards inspection', local: 1 },
  { source: 'health', slug: 'b-standards', text: 'health facility standards second part', local: 1 },
  { source: 'health', slug: 'b-standards', text: 'health facility standards third part', local: 1 },
  { source: 'law', slug: 'c-property', text: 'title deed transfer land office', local: 2 },
  { source: 'news', slug: 'd-news', text: 'clinic opened in bole', local: 3 },
];

function store({ docs = DOCS, key = true, geminiDown = false, local = true, localDown = false, localFallback = true, lvecs = true, badDims = false } = {}) {
  let id = 0;
  const rows = docs.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: 'https://x.et/' + d.slug, title: d.slug, lang: 'en', ord: 0, text: d.text,
    embedding: toBuf(gvec(d.text)), embeddingLocal: lvecs ? (badDims ? Buffer.alloc(DIMS * 4, 1) : toBuf(onehot(d.local))) : null }));
  const prisma = { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } };
  const calls = { gemini: 0, local: [], log: [] };
  const fetchImpl = async (url, opts) => {
    calls.gemini++;
    if (geminiDown) throw new Error('network down');
    return { status: 200, json: async () => ({ embedding: { values: gvec(JSON.parse(opts.body).content.parts[0].text) } }) };
  };
  const localEmbedder = local ? {
    query: async (q, ms) => { calls.local.push({ q, ms }); if (localDown) throw new Error('bina-embed down'); return onehot(1); },
    documents: async () => { throw new Error('not in search'); },
  } : undefined;
  const k = makeKnowledge({ prisma, apiKey: key ? 'k' : '', fetchImpl, root: ROOT, sleep: async () => {}, localEmbedder, localFallback, queryLog: m => calls.log.push(m) });
  return { k, calls, rows };
}
const slugs = hits => hits.map(h => h.slug);

test('Gemini answering: results are identical with or without local vectors and bina-embed is never called', async () => {
  for (const q of ['clinic licence', 'health facility standards', 'title deed transfer', 'clinic in bole']) {
    for (const opts of [{ k: 18, exclude: ['style', 'style-om'] }, { k: 3 }, { k: 18, prefer: ['health'], exclude: ['news'] }]) {
      const withLocal = store();
      const without = store({ lvecs: false, localFallback: false, local: false });
      assert.deepEqual(await withLocal.k.search(q, opts), await without.k.search(q, opts), q);
      assert.equal(withLocal.calls.local.length, 0, 'no local call while Gemini works');
      assert.deepEqual(withLocal.calls.log, ['[knowledge] query embed: gemini']);
    }
  }
});

test('Gemini query embed throws: the query goes to bina-embed and is ranked on the BGE vectors', async () => {
  const s = store({ geminiDown: true });
  const hits = await s.k.search('clinic licence', { k: 3 });
  assert.equal(s.calls.local.length, 1);
  assert.equal(s.calls.local[0].ms, 3000, 'short timeout on the local query');
  assert.equal(hits[0].slug, 'b-standards', 'the local vectors decide, not the Gemini ones');
  assert.deepEqual(s.calls.log, ['[knowledge] query embed: local']);
  assert.equal(s.calls.log.some(l => /clinic|licence/.test(l)), false, 'the log line never carries the query');
  const h = s.k.health();
  assert.equal(h.embedErr, 1); assert.equal(h.localOk, 1); assert.equal(h.localUsed, 1); assert.equal(h.keywordOnly, 0);
  assert.equal(h.embeddedLocal, DOCS.length);
});

test('the local path keeps the hybrid score, exclude, prefer and the two-chunks-per-page cap', async () => {
  const s = store({ geminiDown: true });
  const hits = await s.k.search('health facility standards', { k: 10 });
  assert.equal(hits.filter(h => h.slug === 'b-standards').length, 2, 'at most two chunks of one page');
  // cos 1 + 0.15 * kw for B; the keyword part is still added
  const top = hits[0];
  assert.equal(top.slug, 'b-standards');
  assert.equal(top.score, +(1 + 0.15 * 1).toFixed(4));
  const ex = await store({ geminiDown: true }).k.search('health facility standards', { k: 10, exclude: ['health'] });
  assert.equal(ex.some(h => h.source === 'health'), false);
  const pre = await store({ geminiDown: true }).k.search('clinic', { k: 10, prefer: ['news'] });
  const plain = await store({ geminiDown: true }).k.search('clinic', { k: 10 });
  const newsPre = pre.find(h => h.slug === 'd-news'), newsPlain = plain.find(h => h.slug === 'd-news');
  assert.ok(newsPre && newsPlain && newsPre.score > newsPlain.score, 'prefer moves the boost on the local path too');
});

test('Gemini and bina-embed both down: keyword-only, exactly as a keyless search', async () => {
  const s = store({ geminiDown: true, localDown: true });
  const keyless = store({ key: false, local: false });
  for (const q of ['clinic licence', 'title deed transfer']) {
    assert.deepEqual(await s.k.search(q, { k: 5 }), await keyless.k.search(q, { k: 5 }), q);
  }
  assert.equal(s.k.health().localErr, 2); assert.equal(s.k.health().keywordOnly, 2);
  assert.deepEqual(s.calls.log, ['[knowledge] query embed: keyword', '[knowledge] query embed: keyword']);
});

test('only when Gemini was asked and failed: no key, or no local vectors, never reaches bina-embed', async () => {
  const noKey = store({ key: false });
  await noKey.k.search('clinic licence', { k: 3 });
  assert.equal(noKey.calls.local.length, 0); assert.deepEqual(noKey.calls.log, ['[knowledge] query embed: keyword']);
  const noLocalVecs = store({ geminiDown: true, lvecs: false });
  await noLocalVecs.k.search('clinic licence', { k: 3 });
  assert.equal(noLocalVecs.calls.local.length, 0);
  const wrongDims = store({ geminiDown: true, badDims: true });
  await wrongDims.k.search('clinic licence', { k: 3 });
  assert.equal(wrongDims.calls.local.length, 0, 'a vector of the wrong size is not a local vector');
  assert.equal(wrongDims.k.health().embeddedLocal, 0);
});

test('KNOWLEDGE_LOCAL_FALLBACK=0 switches the fallback off', async () => {
  assert.equal(localFallbackEnabled({}), true);
  assert.equal(localFallbackEnabled({ KNOWLEDGE_LOCAL_FALLBACK: '1' }), true);
  assert.equal(localFallbackEnabled({ KNOWLEDGE_LOCAL_FALLBACK: '0' }), false);
  assert.equal(localFallbackEnabled({ KNOWLEDGE_LOCAL_FALLBACK: ' 0 ' }), false);
  const off = store({ geminiDown: true, localFallback: false });
  const hits = await off.k.search('clinic licence', { k: 3 });
  assert.equal(off.calls.local.length, 0);
  assert.equal(hits[0].slug, 'a-licence', 'keyword ranking');
  assert.equal(off.k.health().localFallback, false);
  assert.equal(off.k.health().embeddedLocal, 0, 'local vectors are not even kept in memory');
  // and through the environment, when the caller does not decide
  const prev = process.env.KNOWLEDGE_LOCAL_FALLBACK;
  process.env.KNOWLEDGE_LOCAL_FALLBACK = '0';
  try {
    const rows = DOCS.map((d, i) => ({ id: 'e' + i, source: d.source, slug: d.slug, url: null, title: d.slug, lang: 'en', ord: 0, text: d.text, embedding: toBuf(gvec(d.text)), embeddingLocal: toBuf(onehot(d.local)) }));
    let localCalls = 0;
    const envOff = makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } }, apiKey: 'k', root: ROOT, sleep: async () => {},
      fetchImpl: async () => { throw new Error('down'); }, localEmbedder: { query: async () => { localCalls++; return onehot(1); } } });
    await envOff.search('clinic licence', { k: 3 });
    assert.equal(localCalls, 0);
    assert.equal(envOff.health().localFallback, false);
  } finally { if (prev === undefined) delete process.env.KNOWLEDGE_LOCAL_FALLBACK; else process.env.KNOWLEDGE_LOCAL_FALLBACK = prev; }
});

test('a failed Gemini call is retried on every search; the local vector is cached separately for the next failure', async () => {
  const s = store({ geminiDown: true });
  assert.equal((await s.k.search('clinic licence', { k: 3 }))[0].slug, 'b-standards');
  assert.equal((await s.k.search('clinic licence', { k: 3 }))[0].slug, 'b-standards');
  assert.equal(s.calls.local.length, 1, 'the local vector came from its own cache the second time');
  assert.equal(s.calls.gemini, 2, 'Gemini is still tried first every time');
});

test('the same knowledge object: after a local answer, a healthy Gemini call ranks on Gemini vectors again', async () => {
  let down = true;
  let id = 0;
  const rows = DOCS.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: null, title: d.slug, lang: 'en', ord: 0, text: d.text, embedding: toBuf(gvec(d.text)), embeddingLocal: toBuf(onehot(d.local)) }));
  const log = [];
  const k = makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } }, apiKey: 'k', root: ROOT, sleep: async () => {}, localFallback: true, queryLog: m => log.push(m),
    fetchImpl: async (url, opts) => { if (down) throw new Error('down'); return { status: 200, json: async () => ({ embedding: { values: gvec(JSON.parse(opts.body).content.parts[0].text) } }) }; },
    localEmbedder: { query: async () => onehot(1) } });
  assert.equal((await k.search('clinic licence', { k: 3 }))[0].slug, 'b-standards');
  down = false;
  assert.equal((await k.search('clinic licence', { k: 3 }))[0].slug, 'a-licence');
  down = true;
  assert.equal((await k.search('clinic licence', { k: 3 }))[0].slug, 'a-licence', 'a Gemini vector in the cache is still a Gemini vector');
  assert.deepEqual(log, ['[knowledge] query embed: local', '[knowledge] query embed: gemini', '[knowledge] query embed: gemini']);
});

test('makeLocalEmbedder: posts {texts, kind} to bina-embed, truncates like the service, checks the answer', async () => {
  const seen = [];
  const ok = makeLocalEmbedder({ url: 'http://127.0.0.1:3031/embed', fetchImpl: async (url, opts) => {
    const body = JSON.parse(opts.body); seen.push({ url, body, signal: !!opts.signal });
    return { status: 200, json: async () => ({ model: 'BAAI/bge-m3', dim: 1024, vectors: body.texts.map(() => onehot(5)) }) };
  } });
  assert.equal((await ok.query('hello')).length, LOCAL_DIMS);
  assert.deepEqual(seen[0], { url: 'http://127.0.0.1:3031/embed', body: { texts: ['hello'], kind: 'query' }, signal: true });
  const docs = await ok.documents(['a', 'x'.repeat(5000)]);
  assert.equal(docs.length, 2);
  assert.equal(seen[1].body.kind, 'document'); assert.equal(seen[1].body.texts[1].length, 4000);
  const short = makeLocalEmbedder({ fetchImpl: async () => ({ status: 200, json: async () => ({ vectors: [new Array(768).fill(0)] }) }) });
  await assert.rejects(short.query('x'), /unexpected response/);
  const err = makeLocalEmbedder({ fetchImpl: async () => ({ status: 503, json: async () => ({}) }) });
  await assert.rejects(err.query('x'), /bina-embed 503/);
  const slow = makeLocalEmbedder({ fetchImpl: (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  await assert.rejects(slow.query('x', 20), /aborted/);
});

// ---- ingest: embedding store with pending chunks ----
function pendingWorld({ n = 5, gemini = 'ok', local = 'ok', localFallback = true, persist = true } = {}) {
  const rows = []; for (let i = 0; i < n; i++) rows.push({ id: 'p' + String(i).padStart(4, '0'), source: 'x', slug: 's' + i, text: 'chunk number ' + i, embedding: null, embeddingLocal: null });
  const match = (r, where) => Object.keys(where || {}).every(key => (where[key] === null ? r[key] == null : r[key] === where[key]));
  const prisma = { knowledgeChunk: {
    findMany: async ({ where, take } = {}) => rows.filter(r => match(r, where)).slice(0, take || 1e9).map(r => ({ ...r })),
    count: async ({ where } = {}) => rows.filter(r => match(r, where)).length,
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); if (persist) Object.assign(r, data); return { ...r }; },
  } };
  const calls = { batches: [], local: [], sleeps: [], log: [] };
  let geminiCall = 0;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (/batchEmbedContents/.test(url)) {
      geminiCall++;
      calls.batches.push(body.requests.length);
      const fail = gemini === 'down' || (gemini === 'flaky' && geminiCall === 1);
      if (fail) return { status: 400, text: async () => 'bad', json: async () => ({}) };
      return { status: 200, json: async () => ({ embeddings: body.requests.map(r => ({ values: gvec(r.content.parts[0].text) })) }) };
    }
    throw new Error('unexpected url ' + url);
  };
  const localEmbedder = { query: async () => { throw new Error('no'); },
    documents: async texts => { calls.local.push(texts.length); if (local === 'down') throw new Error('bina-embed down'); return texts.map((_, i) => onehot(i)); } };
  const k = makeKnowledge({ prisma, apiKey: 'k', fetchImpl, root: ROOT, sleep: async ms => { calls.sleeps.push(ms); }, localEmbedder, localFallback, log: m => calls.log.push(m) });
  return { k, rows, calls };
}

test('change B: Gemini embedding loops in batches until nothing is left, paced between batches', async () => {
  const w = pendingWorld({ n: 5, local: 'down', localFallback: false });
  const r = await w.k.embedPendingGemini({ take: 2 });
  assert.deepEqual(w.calls.batches, [2, 2, 1]);
  assert.equal(r.embedded, 5); assert.equal(r.remaining, 0); assert.equal(r.stopped, null);
  assert.ok(w.rows.every(x => x.embedding && x.embedding.length === DIMS * 4));
  assert.deepEqual(w.calls.sleeps, [4000, 4000], 'the embedder pacing between batches');
});

test('change B: repeated Gemini failures stop the loop cleanly and report what remains', async () => {
  const w = pendingWorld({ n: 5, gemini: 'down', localFallback: false });
  const r = await w.k.embedPendingGemini({ take: 2 });
  assert.equal(w.calls.batches.length, 2, 'two failed batches, then stop');
  assert.equal(r.embedded, 0); assert.equal(r.remaining, 5); assert.equal(r.stopped, 'gemini_failures');
  assert.ok(w.calls.log.some(l => /5 chunks still have no Gemini embedding/.test(l)));
});

test('change B: one failed batch is retried and the run still finishes', async () => {
  const w = pendingWorld({ n: 5, gemini: 'flaky', localFallback: false });
  const r = await w.k.embedPendingGemini({ take: 2 });
  assert.equal(r.embedded, 5); assert.equal(r.remaining, 0);
  assert.deepEqual(w.calls.batches, [2, 2, 2, 1]);
});

test('change B: never loops for ever, even if the updates do not stick', async () => {
  const w = pendingWorld({ n: 4, persist: false, localFallback: false });
  const r = await w.k.embedPendingGemini({ take: 2 });
  assert.equal(r.stopped, 'max_rounds');
  assert.ok(w.calls.batches.length <= 4, 'bounded: ' + w.calls.batches.length);
  assert.equal(r.remaining, 4);
});

test('change B: one ingest embeds past the old 2,000-chunk cap', async () => {
  // an ingest restricted to a source with no documents: nothing is chunked, only the embedding step runs
  const w = pendingWorld({ n: 2001, localFallback: false });
  const res = await w.k.ingest({ only: ['no-such-source'] });
  assert.equal(res.embedded, 2001);
  assert.equal(res.embedRemaining, 0);
  assert.equal(w.rows.filter(x => !x.embedding).length, 0);
});

test('ingest embeds new chunks locally too: batches of at most 10, paced, capped per run, rest left pending', async () => {
  const w = pendingWorld({ n: 25 });
  const r = await w.k.embedPendingLocal({ max: 23 });
  assert.deepEqual(w.calls.local, [10, 10, 3]);
  assert.equal(r.embedded, 23); assert.equal(r.pending, 2);
  assert.deepEqual(w.calls.sleeps, [3000, 3000]);
  assert.ok(w.rows.filter(x => x.embeddingLocal).every(x => x.embeddingLocal.length === LOCAL_DIMS * 4));
  assert.ok(w.calls.log.some(l => /local embedding: 23 embedded, 2 pending/.test(l)), 'the leftovers are logged as pending');
  assert.equal(LOCAL_BATCH, 10); assert.equal(LOCAL_MAX_PER_RUN, 300);
  const big = pendingWorld({ n: 5 });
  await big.k.embedPendingLocal({ batch: 50 });
  assert.ok(big.calls.local.every(n => n <= 10), 'a caller cannot raise the batch above 10');
});

test('ingest: bina-embed down stops the local step after two failures; disabled means no calls at all', async () => {
  const w = pendingWorld({ n: 25, local: 'down' });
  const r = await w.k.embedPendingLocal();
  assert.equal(w.calls.local.length, 2); assert.equal(r.embedded, 0); assert.equal(r.pending, 25); assert.equal(r.stopped, 'local_failures');
  const off = pendingWorld({ n: 5, localFallback: false });
  const o = await off.k.embedPendingLocal();
  assert.equal(off.calls.local.length, 0); assert.equal(o.stopped, 'disabled');
});

test('ingest runs both steps and reports them', async () => {
  const w = pendingWorld({ n: 12 });
  const res = await w.k.ingest({ only: ['no-such-source'], embedTake: 5, localMax: 11 });
  assert.equal(res.embedded, 12); assert.equal(res.embedRemaining, 0);
  assert.equal(res.localEmbedded, 11); assert.equal(res.localPending, 1);
});
