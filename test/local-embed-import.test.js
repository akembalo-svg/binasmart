'use strict';
// The laptop path for BGE-M3 vectors: an .npy of vectors computed elsewhere is matched to KnowledgeChunk rows by id.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readNpyHeader, checkVector, importNpy } = require('../ops/knowledge/local-embed-import');
const { exportPending } = require('../ops/knowledge/local-embed-export');

function writeNpy(file, vecs, dim = 1024) {
  let header = "{'descr': '<f4', 'fortran_order': False, 'shape': (" + vecs.length + ', ' + dim + '), }';
  const total = 10 + header.length + 1; header += ' '.repeat((64 - (total % 64)) % 64) + '\n';
  const pre = Buffer.alloc(10); Buffer.from('\x93NUMPY', 'latin1').copy(pre); pre[6] = 1; pre[7] = 0; pre.writeUInt16LE(header.length, 8);
  const body = Buffer.alloc(vecs.length * dim * 4);
  vecs.forEach((v, i) => { for (let j = 0; j < dim; j++) body.writeFloatLE(v[j] || 0, (i * dim + j) * 4); });
  fs.writeFileSync(file, Buffer.concat([pre, Buffer.from(header, 'latin1'), body]));
}
const unit = i => { const v = new Array(1024).fill(0); v[i] = 1; return v; };

function fakePrisma(ids) {
  const rows = ids.map(id => ({ id, text: 'text ' + id, embeddingLocal: null }));
  return { rows, knowledgeChunk: {
    findMany: async ({ where, take, cursor, skip }) => {
      let r = rows.filter(x => (where.id ? where.id.in.includes(x.id) : x.embeddingLocal == null));
      r = r.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (cursor) r = r.slice(r.findIndex(x => x.id === cursor.id) + (skip || 0));
      return r.slice(0, take || 1e9).map(x => ({ ...x }));
    },
    update: ({ where, data }) => ({ where, data }),
  }, $transaction: async ops => { for (const o of ops) Object.assign(rows.find(x => x.id === o.where.id), o.data); return ops; } };
}

test('import: streams the npy in blocks, writes existing rows, skips gone ids, bad vectors and rows that already have one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bge-imp-'));
  const npy = path.join(dir, 'v.npy'), idsFile = path.join(dir, 'ids.json');
  const vecs = [unit(0), unit(1), unit(2), new Array(1024).fill(0.5), unit(4)];   // row 3 is not unit length
  writeNpy(npy, vecs);
  fs.writeFileSync(idsFile, JSON.stringify(['a', 'gone', 'c', 'd', 'e']));
  assert.deepEqual(readNpyHeader(fs.openSync(npy, 'r')).rows, 5);
  const p = fakePrisma(['a', 'c', 'd', 'e']);
  p.rows.find(r => r.id === 'e').embeddingLocal = Buffer.from('keep');
  const c = await importNpy(p, { npy, ids: idsFile, block: 2, log: () => {} });
  assert.deepEqual(c, { inFile: 5, updated: 2, alreadyHad: 1, gone: 1, invalid: 1 });
  const a = p.rows.find(r => r.id === 'a').embeddingLocal;
  assert.equal(a.length, 4096); assert.equal(new Float32Array(a.buffer, a.byteOffset, 1024)[0], 1);
  assert.equal(p.rows.find(r => r.id === 'e').embeddingLocal.toString(), 'keep');
  assert.equal(p.rows.find(r => r.id === 'd').embeddingLocal, null);
  const dry = fakePrisma(['a']);
  const d = await importNpy(dry, { npy, ids: idsFile, dryRun: true, log: () => {} });
  assert.equal(d.updated, 1); assert.equal(dry.rows[0].embeddingLocal, null, 'dry run writes nothing');
  fs.writeFileSync(idsFile, JSON.stringify(['a']));
  await assert.rejects(importNpy(fakePrisma(['a']), { npy, ids: idsFile, log: () => {} }), /5 rows but ids has 1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('checkVector: unit length and finite, 1024 values', () => {
  assert.equal(checkVector(Float32Array.from(unit(3))), null);
  assert.match(checkVector(new Float32Array(1024)), /norm/);
  assert.match(checkVector(new Float32Array(768)), /dims/);
  const nan = Float32Array.from(unit(0)); nan[5] = NaN; assert.equal(checkVector(nan), 'not finite');
});

test('export: every chunk without a local vector, as {id, text} lines, paged by cursor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bge-exp-'));
  const p = fakePrisma(['a', 'b', 'c', 'd', 'e']);
  p.rows[1].embeddingLocal = Buffer.alloc(4);
  const out = path.join(dir, 'pending.jsonl');
  assert.equal(await exportPending(p, out, { page: 2 }), 4);
  assert.deepEqual(fs.readFileSync(out, 'utf8').trim().split('\n').map(l => JSON.parse(l)), ['a', 'c', 'd', 'e'].map(id => ({ id, text: 'text ' + id })));
  fs.rmSync(dir, { recursive: true, force: true });
});
