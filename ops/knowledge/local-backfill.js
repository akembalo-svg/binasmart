#!/usr/bin/env node
'use strict';
// Finish the BGE-M3 (embeddingLocal) vectors of one source on the server itself, paced, without the laptop route.
//
//   node --env-file=.env ops/knowledge/local-backfill.js --source telecom            # until nothing is pending
//   node --env-file=.env ops/knowledge/local-backfill.js --source telecom --rounds 2 # at most two rounds (a smoke test)
//
// Why it exists: an ingest embeds at most 300 chunks locally per run (LOCAL_MAX_PER_RUN in knowledge/index.js), so
// a pack that lands in one go - the telecom pack was 3,414 chunks - leaves thousands behind, and a partly
// embedded source is worse than none when Gemini is down (docs/superpowers/notes/2026-09-18-local-fallback-backfill.md).
// The note's answer for thousands of chunks was the laptop route; this is the same embedPendingLocal that the ingest
// calls, in a loop with a pause between rounds and a load guard, for a pack of a few thousand.
//
// It talks only to bina-embed on 127.0.0.1 and to the database. It never calls Gemini, never re-chunks, never
// deletes and never touches a chunk that already has a vector. Safe to stop at any time and to run again; each
// round writes its chunks before the next starts. Prints one progress line per round.
//
// The pending count is global (every source), so it stops when nothing is pending anywhere; --source only names
// which source's coverage the progress lines report.
const os = require('os');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i === -1 ? dflt : process.argv[i + 1]; };

async function main() {
  const source = arg('--source', '');
  const rounds = Number(arg('--rounds', 0)) || Infinity;
  const perRound = Number(arg('--per-round', 200));
  const pauseMs = Number(arg('--pause-ms', 20000));
  const maxLoad = Number(arg('--max-load', 3));
  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge } = require('../../knowledge/index');
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: '', log: m => console.log(m) });
  const cover = async () => {
    const where = source ? { source } : {};
    const total = await prisma.knowledgeChunk.count({ where });
    const missing = await prisma.knowledgeChunk.count({ where: { ...where, embeddingLocal: null } });
    return { total, local: total - missing, missing };
  };
  try {
    let c = await cover();
    console.log('[backfill] ' + (source || 'all sources') + ': ' + c.local + ' of ' + c.total + ' chunks have a local vector, ' + c.missing + ' pending');
    for (let round = 1; round <= rounds && c.missing > 0; round++) {
      // Do not add to a busy server: wait (up to ten minutes) for the one-minute load to fall.
      for (let w = 0; w < 30 && os.loadavg()[0] > maxLoad; w++) { console.log('[backfill] load ' + os.loadavg()[0].toFixed(2) + ' > ' + maxLoad + ', waiting'); await sleep(20000); }
      const r = await k.embedPendingLocal({ max: perRound });
      c = await cover();
      console.log('[backfill] round ' + round + ': +' + r.embedded + ' (' + c.local + ' of ' + c.total + ', ' + c.missing + ' pending' + (r.stopped ? ', stopped: ' + r.stopped : '') + ')');
      if (r.stopped) { console.log('[backfill] stopping: ' + r.stopped); process.exitCode = 1; break; }
      if (!r.embedded) break;
      if (c.missing > 0) await sleep(pauseMs);
    }
    console.log('[backfill] done: ' + c.local + ' of ' + c.total + ' with a local vector, ' + c.missing + ' pending');
  } finally { await prisma.$disconnect(); }
}
main().catch(e => { console.error('[backfill] failed: ' + e.message); process.exit(1); });
