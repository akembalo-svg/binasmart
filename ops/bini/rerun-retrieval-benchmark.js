#!/usr/bin/env node
'use strict';
// Re-run the 114-question Amharic retrieval benchmark against the corpus as it stands today.
//
// The published 91.7% was measured on 2026-09-09 against 4,789 chunks, by a separate numpy
// reimplementation of the ranking (bina-embed/evaluate.py). Since then the corpus was purged of the
// hacked moe.gov.et pages down to ~3,292 and rebuilt to 6,502 with the law and health libraries, and
// the ranking itself gained two things the old run never saw: a +0.06 boost for BinaSmart's own
// sources, and a Gemini reranker that takes 18 candidates down to 6.
//
// So this runs the PRODUCTION code — knowledge/index.js search() — rather than a copy of it, and
// reports two numbers:
//
//   retrieval only   top-3 pages straight out of the hybrid score. Directly comparable to 9 September.
//   as shipped       the same 18 candidates reranked down to 6, then the top 3. What a user gets.
//
// Page@3 needs only gold_slug, which survived the purge; gold_id did not, so chunk-level R@k is not
// re-measurable without re-pointing the gold set and is not reported here.
//
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js [--limit N]
//
// Output: $BINI_EVAL_DIR (default /root/bini-eval)/retrieval-YYYYMMDD-HHMMSS.json (UTC), never overwritten,
// plus retrieval-latest.json, a copy of the newest FULL run (a --limit run does not replace it).
// Until 2026-09-14 the name was retrieval-<UTC date>.json, so two runs on one UTC day kept only the last.

const fs = require('fs');
const path = require('path');

const GOLD = '/root/storage/bina-embed/eval/gold.json';
const OUT = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const LATEST = 'retrieval-latest.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// retrieval-20260913-220955.json — UTC, to the second.
function resultName(at = new Date()) {
  const s = at.toISOString();
  return 'retrieval-' + s.slice(0, 10).replace(/-/g, '') + '-' + s.slice(11, 19).replace(/:/g, '') + '.json';
}

// Write a run under a name no earlier run holds ('wx' fails instead of replacing; a same-second clash
// gets -2, -3 …), then refresh retrieval-latest.json as a plain copy. Returns the dated path.
function writeResult(dir, payload, at = new Date(), { latest = true } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(payload, null, 1);
  const base = resultName(at).replace(/\.json$/, '');
  for (let n = 1; ; n++) {
    const f = path.join(dir, base + (n === 1 ? '' : '-' + n) + '.json');
    try { fs.writeFileSync(f, body, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    if (latest) fs.writeFileSync(path.join(dir, LATEST), body);
    return f;
  }
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge } = require('/var/www/connectcare/binasmart/knowledge');
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY });
  await k.load();
  const health = k.health();
  console.log('corpus: ' + health.chunks + ' chunks, ' + health.embedded + ' embedded, gemini=' + health.gemini);

  let gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  if (limit) gold = gold.slice(0, limit);

  // Which gold pages still exist? A question whose page was deleted cannot be found, and counting it
  // as a miss would understate the system while dropping it silently would flatter it. Report both.
  const slugs = new Set((await prisma.knowledgeChunk.findMany({ select: { slug: true } })).map(r => r.slug));
  const alive = q => slugs.has(q.gold_slug);
  console.log('gold questions: ' + gold.length + ', whose gold page still exists: ' + gold.filter(alive).length);

  const rows = [];
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i];
    let plain = [], shipped = [];
    try {
      plain = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'] });
      shipped = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
    } catch (e) { console.log('  ! ' + g.qid + ' ' + e.message); }
    const pages = hits => { const out = []; for (const h of hits) if (!out.includes(h.slug)) out.push(h.slug); return out; };
    const p3 = hits => pages(hits).slice(0, 3).includes(g.gold_slug);
    rows.push({ qid: g.qid, lang: g.lang, source: g.gold_source, slug: g.gold_slug, alive: alive(g),
      plain: p3(plain), shipped: p3(shipped), top: pages(shipped).slice(0, 3) });
    if ((i + 1) % 20 === 0) console.log('  ' + (i + 1) + '/' + gold.length);
    await sleep(300);
  }

  const pct = (list, f) => list.length ? (100 * list.filter(f).length / list.length).toFixed(1) + '%' : '—';
  const OWN = ['guide', 'page', 'addis', 'llms', 'docs', 'skill'];
  const slice = (name, list) => ({ name, n: list.length, plain: pct(list, r => r.plain), shipped: pct(list, r => r.shipped) });

  const live = rows.filter(r => r.alive);
  const table = [
    slice('all questions', rows),
    slice('  of those, gold page still exists', live),
    slice('own documents (guide/page/…)', rows.filter(r => OWN.includes(r.source))),
    slice('crawled web', rows.filter(r => r.source === 'web')),
    slice('Amharic', rows.filter(r => r.lang === 'am')),
    slice('English', rows.filter(r => r.lang === 'en')),
  ];
  console.log('\n  Page@3 — is the right page in the top three?\n');
  console.log('  ' + 'slice'.padEnd(36) + 'n'.padStart(5) + 'retrieval'.padStart(12) + 'as shipped'.padStart(13));
  for (const t of table) console.log('  ' + t.name.padEnd(36) + String(t.n).padStart(5) + t.plain.padStart(12) + t.shipped.padStart(13));

  const gone = rows.filter(r => !r.alive);
  if (gone.length) {
    console.log('\n  gold pages that no longer exist (' + gone.length + '): ' + [...new Set(gone.map(r => r.slug))].slice(0, 12).join(', '));
  }
  const regressed = rows.filter(r => r.plain && !r.shipped);
  console.log('\n  found by retrieval but dropped by the reranker: ' + regressed.length
    + (regressed.length ? '  [' + regressed.slice(0, 6).map(r => r.qid).join(', ') + ']' : ''));
  console.log('  found only after reranking: ' + rows.filter(r => !r.plain && r.shipped).length);

  const at = new Date();
  const f = writeResult(OUT, { at: at.toISOString(), chunks: health.chunks, limit: limit || null, table, rows }, at, { latest: !limit });
  console.log('\n  written: ' + f + (limit ? '  (--limit run: ' + LATEST + ' left alone)' : '  (and ' + LATEST + ')'));
  await prisma.$disconnect();
}

module.exports = { resultName, writeResult };

// Only when run as a script: requiring it (the tests do) must not open the DB or spend Gemini calls.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
