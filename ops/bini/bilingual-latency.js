#!/usr/bin/env node
'use strict';
// What bilingual query retrieval costs the person waiting for the answer.
//
// The gold benchmark measures search(); this measures contextFor() — the whole block Bini is handed, which
// is the query embedding, the reranker and, with KNOWLEDGE_BILINGUAL_QUERY on, one gemini-2.5-flash
// translation and a second embedding. One pass per setting, one setting per run, because two loaded copies
// of an 18,611-chunk index in one process is 250 MB on a server that is already sharing its CPU:
//
//   node --env-file=.env ops/bini/bilingual-latency.js                              (flag off)
//   KNOWLEDGE_BILINGUAL_QUERY=1 node --env-file=.env ops/bini/bilingual-latency.js  (flag on)
//
// Writes $BINI_EVAL_DIR (default /root/bini-eval)/bilingual-latency-<on|off>-YYYYMMDD-HHMMSS.json.
// The questions are the banking gold set's, asked with the same `prefer` list Bini's route passes, so the
// latency measured is the latency of the questions the benchmark scores.
const fs = require('fs');
const path = require('path');

const GOLD = process.env.BINI_GOLD || '/root/storage/bina-embed/eval/gold-banking.json';
const OUT = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const PAUSE_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// p50 / p95 the way the rest of this repo reads them: the smallest sample at or above the fraction.
function quantile(a, p) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; }

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge, bilingualEnabled, bilingualEn2AmEnabled } = require('/var/www/connectcare/binasmart/knowledge');
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
  const raw = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  let questions = (Array.isArray(raw) ? raw : raw.questions) || [];
  if (limit) questions = questions.slice(0, limit);

  const on = bilingualEnabled(), en2am = bilingualEn2AmEnabled();
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY });
  await k.load();
  const h = k.health();
  console.log('corpus: ' + h.chunks + ' chunks; bilingual query retrieval: ' + (on ? 'ON' + (en2am ? ' + en2am' : '') : 'off'));
  console.log('questions: ' + questions.length + ' from ' + GOLD);

  const rows = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const t0 = Date.now();
    let chars = 0;
    try { chars = (await k.contextFor(q.question, { prefer: q.prefer, exclude: q.exclude, lang: q.lang })).length; }
    catch (e) { console.log('  ! ' + q.qid + ' ' + e.message); }
    rows.push({ qid: q.qid, lang: q.lang, ms: Date.now() - t0, chars });
    if ((i + 1) % 20 === 0) console.log('  ' + (i + 1) + '/' + questions.length);
    await sleep(PAUSE_MS);
  }

  const ms = rows.map(r => r.ms);
  const amMs = rows.filter(r => r.lang === 'am').map(r => r.ms);
  const enMs = rows.filter(r => r.lang === 'en').map(r => r.ms);
  const summary = { n: ms.length, p50: quantile(ms, 0.5), p95: quantile(ms, 0.95), mean: Math.round(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)),
    am: { n: amMs.length, p50: quantile(amMs, 0.5), p95: quantile(amMs, 0.95) },
    en: { n: enMs.length, p50: quantile(enMs, 0.5), p95: quantile(enMs, 0.95) } };
  console.log('\n  contextFor latency (ms): ' + JSON.stringify(summary));
  const hs = k.health();
  const paths = { embedOk: hs.embedOk, embedErr: hs.embedErr, localUsed: hs.localUsed, keywordOnly: hs.keywordOnly,
    rerankOk: hs.rerankOk, rerankErr: hs.rerankErr, rerankSkipped: hs.rerankSkipped,
    bilingualOk: hs.bilingualOk, bilingualCached: hs.bilingualCached, bilingualSkipped: hs.bilingualSkipped, bilingualFused: hs.bilingualFused };
  console.log('  paths: ' + JSON.stringify(paths));

  const at = new Date().toISOString();
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, 'bilingual-latency-' + (on ? 'on' : 'off') + (en2am ? '-en2am' : '') + '-'
    + at.slice(0, 10).replace(/-/g, '') + '-' + at.slice(11, 19).replace(/:/g, '') + '.json');
  fs.writeFileSync(f, JSON.stringify({ at, gold: GOLD, chunks: h.chunks, bilingual: { query: on, en2am }, summary, paths, rows }, null, 1));
  console.log('\n  written: ' + f);
  await prisma.$disconnect();
}

module.exports = { quantile };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
