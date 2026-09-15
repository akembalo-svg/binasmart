#!/usr/bin/env node
'use strict';
// Fill KnowledgeChunk.embeddingLocal (BGE-M3, 1024-d) from vectors computed elsewhere, and optionally embed the few
// chunks that have none through bina-embed on this server.
//
//   node --env-file=.env ops/knowledge/local-embed-import.js --npy <vectors.npy> --ids <ids.json> [--dry-run] [--overwrite]
//   nice -n 10 node --env-file=.env ops/knowledge/local-embed-import.js --embed-missing 300
//
// --npy/--ids: a float32 [N, 1024] .npy (row i = ids[i]) such as bge_v3.npy from the laptop (embed_v3.py). Read in
//   blocks, never whole; each block is matched against the table, vectors that are not finite or not unit length
//   are refused, rows that already have a local vector are left alone unless --overwrite, ids that no longer exist
//   are counted and skipped. No model call.
// --embed-missing N: at most N chunks without a local vector are embedded through bina-embed, 10 per call with a
//   pause (knowledge/index.js embedPendingLocal). The server's CPU is shared and the host throttles: keep N in the
//   hundreds. For thousands, use the laptop path: ops/knowledge/local-embed-export.js, embed_v3.py, then --npy/--ids.
const fs = require('fs');
const LOCAL_DIMS = 1024;

// A version-1/2/3 .npy header: magic, version, header length, then a Python dict literal.
function readNpyHeader(fd) {
  const pre = Buffer.alloc(12);
  fs.readSync(fd, pre, 0, 12, 0);
  if (pre.slice(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('not an .npy file');
  const major = pre[6];
  const hlen = major === 1 ? pre.readUInt16LE(8) : pre.readUInt32LE(8);
  const start = major === 1 ? 10 : 12;
  const hb = Buffer.alloc(hlen); fs.readSync(fd, hb, 0, hlen, start);
  const header = hb.toString('latin1');
  if (!/'descr':\s*'<f4'/.test(header)) throw new Error('expected little-endian float32, header: ' + header.trim());
  if (/'fortran_order':\s*True/.test(header)) throw new Error('fortran order not supported');
  const m = /'shape':\s*\((\d+),\s*(\d+)\)/.exec(header); if (!m) throw new Error('expected a 2-d shape, header: ' + header.trim());
  return { rows: +m[1], dim: +m[2], offset: start + hlen };
}

// Unit-length float32 vector of the expected size, or a reason it is not.
function checkVector(f32) {
  if (f32.length !== LOCAL_DIMS) return 'dims ' + f32.length;
  let n = 0; for (const v of f32) { if (!Number.isFinite(v)) return 'not finite'; n += v * v; }
  n = Math.sqrt(n);
  return Math.abs(n - 1) <= 0.01 ? null : 'norm ' + n.toFixed(4);
}

function arg(name) { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; }

async function importNpy(prisma, { npy, ids: idsPath, dryRun, overwrite, block = 500, log = console.log }) {
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
  const fd = fs.openSync(npy, 'r');
  const counts = { inFile: 0, updated: 0, alreadyHad: 0, gone: 0, invalid: 0 };
  try {
    const h = readNpyHeader(fd);
    if (h.dim !== LOCAL_DIMS) throw new Error('expected ' + LOCAL_DIMS + ' dims, file has ' + h.dim);
    if (h.rows !== ids.length) throw new Error('npy has ' + h.rows + ' rows but ids has ' + ids.length);
    counts.inFile = h.rows;
    const rowBytes = LOCAL_DIMS * 4;
    for (let s = 0; s < h.rows; s += block) {
      const n = Math.min(block, h.rows - s);
      const buf = Buffer.alloc(n * rowBytes);
      const got = fs.readSync(fd, buf, 0, buf.length, h.offset + s * rowBytes);
      if (got !== buf.length) throw new Error('short read at row ' + s);
      const blockIds = ids.slice(s, s + n);
      const existing = await prisma.knowledgeChunk.findMany({ where: { id: { in: blockIds } }, select: { id: true, embeddingLocal: true } });
      const have = new Map(existing.map(r => [r.id, r]));
      const ops = [];
      for (let i = 0; i < n; i++) {
        const row = have.get(blockIds[i]);
        if (!row) { counts.gone++; continue; }
        if (row.embeddingLocal && !overwrite) { counts.alreadyHad++; continue; }
        const bytes = Buffer.from(buf.subarray(i * rowBytes, (i + 1) * rowBytes));  // own copy, aligned
        const bad = checkVector(new Float32Array(bytes.buffer, bytes.byteOffset, LOCAL_DIMS));
        if (bad) { counts.invalid++; if (counts.invalid <= 5) log('  invalid vector for ' + blockIds[i] + ': ' + bad); continue; }
        ops.push(prisma.knowledgeChunk.update({ where: { id: blockIds[i] }, data: { embeddingLocal: bytes }, select: { id: true } }));
      }
      if (!dryRun && ops.length) await prisma.$transaction(ops);
      counts.updated += ops.length;
      log('  rows ' + (s + n) + '/' + h.rows + '  ' + JSON.stringify(counts) + (dryRun ? '  (dry run: nothing written)' : ''));
    }
  } finally { fs.closeSync(fd); }
  return counts;
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const npy = arg('--npy'), ids = arg('--ids'), missing = arg('--embed-missing');
    if (!npy && !missing) throw new Error('give --npy <file> --ids <file>, or --embed-missing <N>');
    if (npy) {
      if (!ids) throw new Error('--npy needs --ids');
      const t = Date.now();
      const c = await importNpy(prisma, { npy, ids, dryRun: process.argv.includes('--dry-run'), overwrite: process.argv.includes('--overwrite') });
      console.log('import: ' + JSON.stringify(c) + ' in ' + Math.round((Date.now() - t) / 1000) + 's');
    }
    if (missing) {
      const max = Number(missing);
      if (!(max > 0)) throw new Error('--embed-missing takes a positive number');
      const { makeKnowledge } = require('../../knowledge');
      const k = makeKnowledge({ prisma, apiKey: '', localFallback: true, log: m => console.log(m) });
      const t = Date.now();
      const r = await k.embedPendingLocal({ max, onProgress: p => console.log('  local ' + p.embedded + '/' + p.of + '  ' + Math.round((Date.now() - t) / 1000) + 's') });
      console.log('embed-missing: ' + JSON.stringify(r) + ' in ' + Math.round((Date.now() - t) / 1000) + 's');
    }
    const [total, withLocal] = await Promise.all([prisma.knowledgeChunk.count(), prisma.knowledgeChunk.count({ where: { NOT: { embeddingLocal: null } } })]);
    console.log('table: ' + total + ' chunks, ' + withLocal + ' with a local vector, ' + (total - withLocal) + ' without');
  } finally { await prisma.$disconnect(); }
}

module.exports = { readNpyHeader, checkVector, importNpy };
if (require.main === module) main().catch(e => { console.error('[local-embed-import] ' + e.message); process.exit(1); });
