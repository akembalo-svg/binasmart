'use strict';
// The benchmark's TEST-ONLY partial-coverage switch (--hide-local-fraction / --seed / --hide-local-source).
// It exists to reproduce, without writing to the database, the state a pack ingest leaves behind: part of a
// source with BGE-M3 vectors and part without. These tests pin that it only ever edits the script's own copy,
// that it is deterministic, and that a hidden-coverage run can never replace a *-latest.json.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hideLocalOptions, hiddenLocal, hideLocalPrisma, hideTag } = require('../ops/bini/rerun-retrieval-benchmark');

test('the options: absent means off; fraction, seed and source are parsed and checked', () => {
  assert.equal(hideLocalOptions(['node', 'x']), null);
  assert.deepEqual(hideLocalOptions(['node', 'x', '--hide-local-fraction', '0.5', '--seed', '7']), { fraction: 0.5, seed: 7, source: '' });
  assert.deepEqual(hideLocalOptions(['node', 'x', '--hide-local-fraction', '0.5', '--seed', '7', '--hide-local-source', 'business']), { fraction: 0.5, seed: 7, source: 'business' });
  assert.throws(() => hideLocalOptions(['node', 'x', '--hide-local-fraction', '2']), /\(0, 1\]/);
  assert.throws(() => hideLocalOptions(['node', 'x', '--hide-local-fraction', '0.5', '--seed', 'x']), /--seed/);
});

test('which chunk is hidden depends on the seed and the id alone, and the fraction is honoured', () => {
  const ids = Array.from({ length: 4000 }, (_, i) => 'c' + i);
  const a = ids.filter(id => hiddenLocal(id, 7, 0.5));
  const b = ids.filter(id => hiddenLocal(id, 7, 0.5));
  assert.deepEqual(a, b);
  assert.ok(Math.abs(a.length / ids.length - 0.5) < 0.04, 'about half: ' + a.length);
  assert.notDeepEqual(ids.filter(id => hiddenLocal(id, 8, 0.5)), a, 'another seed hides other chunks');
  assert.equal(ids.filter(id => hiddenLocal(id, 7, 1)).length, ids.length);
});

test('only the script copy changes: the DB rows are untouched and only the named source loses vectors', async () => {
  const vec = Buffer.alloc(8, 1);
  const db = Array.from({ length: 200 }, (_, i) => ({ id: 'r' + i, source: i % 2 ? 'business' : 'law', embeddingLocal: vec }));
  let writes = 0;
  const prisma = { knowledgeChunk: { findMany: async () => db.map(r => ({ ...r })), update: async () => { writes++; } }, $disconnect: async function () { return this === prisma; } };
  const counts = { seen: 0, hidden: 0 };
  const p = hideLocalPrisma(prisma, { fraction: 0.5, seed: 7, source: 'business' }, counts);
  const rows = await p.knowledgeChunk.findMany({});
  assert.ok(rows.filter(r => r.source === 'law').every(r => r.embeddingLocal === vec), 'law keeps every vector');
  const biz = rows.filter(r => r.source === 'business');
  assert.equal(counts.seen, biz.length);
  assert.equal(biz.filter(r => r.embeddingLocal === null).length, counts.hidden);
  assert.ok(counts.hidden > 20 && counts.hidden < 80, 'about half of 100: ' + counts.hidden);
  assert.ok(db.every(r => r.embeddingLocal === vec), 'the rows the DB returned were not modified');
  assert.equal(writes, 0);
  assert.equal(await p.$disconnect(), true, 'the rest of the client is the real one');
  assert.equal(hideLocalPrisma(prisma, null), prisma, 'off means the client itself');
});

test('--hide-local-unit page hides whole documents, the shape an ingest leaves behind', async () => {
  assert.deepEqual(hideLocalOptions(['n', 'x', '--hide-local-fraction', '0.5', '--hide-local-unit', 'page']), { fraction: 0.5, seed: 7, source: '', unit: 'page' });
  assert.throws(() => hideLocalOptions(['n', 'x', '--hide-local-fraction', '0.5', '--hide-local-unit', 'row']), /chunk or page/);
  const vec = Buffer.alloc(8, 1);
  const db = [];
  for (let p = 0; p < 60; p++) for (let c = 0; c < 5; c++) db.push({ id: 'r' + p + '-' + c, source: 'business', slug: 'doc-' + p, embeddingLocal: vec });
  const p = hideLocalPrisma({ knowledgeChunk: { findMany: async () => db.map(r => ({ ...r })) } }, { fraction: 0.5, seed: 7, source: 'business', unit: 'page' });
  const rows = await p.knowledgeChunk.findMany({});
  const bySlug = new Map();
  for (const r of rows) { const s = bySlug.get(r.slug) || new Set(); s.add(r.embeddingLocal === null); bySlug.set(r.slug, s); }
  assert.ok([...bySlug.values()].every(s => s.size === 1), 'a page is hidden whole or not at all');
  const hiddenPages = [...bySlug.values()].filter(s => s.has(true)).length;
  assert.ok(hiddenPages > 15 && hiddenPages < 45, 'about half the pages: ' + hiddenPages);
});

test('a hidden-coverage run is tagged apart', () => {
  assert.equal(hideTag('gold-business-forced-gemini-fail', null), 'gold-business-forced-gemini-fail');
  assert.equal(hideTag('gold-business-forced-gemini-fail', { fraction: 0.5, seed: 7, source: 'business' }), 'gold-business-forced-gemini-fail-hide50-business-seed7');
  assert.equal(hideTag('gold-business-forced-gemini-fail', { fraction: 0.5, seed: 7, source: 'business', unit: 'page' }), 'gold-business-forced-gemini-fail-hide50pages-business-seed7');
});
