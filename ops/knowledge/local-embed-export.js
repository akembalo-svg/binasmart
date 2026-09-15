#!/usr/bin/env node
'use strict';
// The laptop path for BGE-M3 vectors, step 1 of 3: export the chunks that have no local vector yet.
//
//   node --env-file=.env ops/knowledge/local-embed-export.js --out /root/storage/bina-embed/eval/pending.jsonl
//
// One JSON object per line, {"id", "text"} — the chunks-v3.jsonl format of embed_v3.py. Then:
//   2. on the laptop: copy the file next to embed_v3.py as chunks-v3.jsonl (move an old ckpt.npz away) and run it;
//      it writes bge_v3.npy + bge_v3.ids.json with the same settings as bina-embed (bge-m3, normalised, 512 tokens,
//      text[:4000]).
//   3. back on the server: node --env-file=.env ops/knowledge/local-embed-import.js --npy bge_v3.npy --ids bge_v3.ids.json
// Use this when an ingest leaves more chunks pending than the server should embed itself (it stops at 300 per run).
const fs = require('fs');

async function exportPending(prisma, out, { page = 500 } = {}) {
  const fd = fs.openSync(out, 'w');
  let n = 0, cursor = null;
  try {
    while (true) {
      const rows = await prisma.knowledgeChunk.findMany({ where: { embeddingLocal: null }, select: { id: true, text: true }, orderBy: { id: 'asc' }, take: page,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
      if (!rows.length) break;
      fs.writeSync(fd, rows.map(r => JSON.stringify({ id: r.id, text: r.text })).join('\n') + '\n');
      n += rows.length; cursor = rows[rows.length - 1].id;
    }
  } finally { fs.closeSync(fd); }
  return n;
}

async function main() {
  const i = process.argv.indexOf('--out');
  const out = i === -1 ? null : process.argv[i + 1];
  if (!out) throw new Error('give --out <file.jsonl>');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const n = await exportPending(prisma, out);
    console.log('exported ' + n + ' chunks without a local vector to ' + out);
  } finally { await prisma.$disconnect(); }
}

module.exports = { exportPending };
if (require.main === module) main().catch(e => { console.error('[local-embed-export] ' + e.message); process.exit(1); });
