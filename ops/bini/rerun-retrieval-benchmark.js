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
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js [--limit N] [--gold <path>]
//
// Output: $BINI_EVAL_DIR (default /root/bini-eval)/retrieval-YYYYMMDD-HHMMSS.json (UTC), never overwritten,
// plus retrieval-latest.json, a copy of the newest FULL run (a --limit run does not replace it).
// Until 2026-09-14 the name was retrieval-<UTC date>.json, so two runs on one UTC day kept only the last.
//
// Gold set: v1 (gold.json, 114 questions written by Gemini from chunks on 9 September) unless --gold or
// $BINI_GOLD names another file. Another gold set writes retrieval-<its name>-YYYYMMDD-HHMMSS.json and
// retrieval-<its name>-latest.json, so a v2 run never replaces the v1 numbers a page quotes.
// v2 (gold-v2.json, 14 September) keeps v1's 66 own-document questions and replaces the 48 crawled-web
// questions, which pointed mostly at news front and section pages whose headlines rotate weekly, with
// questions on single article pages whose answer passage is verified in the index (ops/bini/build-gold-v2.js).
// A gold question that carries a `passage` also gets a second score: "any page" — is ANY page among the
// top three one whose indexed text contains that passage (the same story often runs on two sites).

const fs = require('fs');
const path = require('path');

const GOLD = '/root/storage/bina-embed/eval/gold.json';
const OUT = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --gold <path> beats $BINI_GOLD beats v1.
function goldPath(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--gold');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return env.BINI_GOLD || GOLD;
}
// '' for the default (v1) gold set, so its file names stay exactly what they were; otherwise the file's name.
function goldTag(p) {
  if (!p || path.resolve(p) === path.resolve(GOLD)) return '';
  return path.basename(p).replace(/\.json$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
}
const latestName = (tag = '') => 'retrieval-' + (tag ? tag + '-' : '') + 'latest.json';

// retrieval-20260913-220955.json — UTC, to the second. With a tag: retrieval-gold-v2-20260914-101500.json.
function resultName(at = new Date(), tag = '') {
  const s = at.toISOString();
  return 'retrieval-' + (tag ? tag + '-' : '') + s.slice(0, 10).replace(/-/g, '') + '-' + s.slice(11, 19).replace(/:/g, '') + '.json';
}

// Write a run under a name no earlier run holds ('wx' fails instead of replacing; a same-second clash
// gets -2, -3 …), then refresh retrieval-latest.json as a plain copy. Returns the dated path.
function writeResult(dir, payload, at = new Date(), { latest = true, tag = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify(payload, null, 1);
  const base = resultName(at, tag).replace(/\.json$/, '');
  for (let n = 1; ; n++) {
    const f = path.join(dir, base + (n === 1 ? '' : '-' + n) + '.json');
    try { fs.writeFileSync(f, body, { flag: 'wx' }); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    if (latest) fs.writeFileSync(path.join(dir, latestName(tag)), body);
    return f;
  }
}

// Whitespace-insensitive, so a passage copied from a chunk still matches across a line break.
const normText = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
// The pages whose indexed text contains the passage. chunks: [{ slug, text }].
function pagesContaining(chunks, passage) {
  const p = normText(passage);
  const out = new Set();
  if (!p) return out;
  for (const c of chunks) if (!out.has(c.slug) && normText(c.text).includes(p)) out.add(c.slug);
  return out;
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

  const goldFile = goldPath();
  const tag = goldTag(goldFile);
  let gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
  if (limit) gold = gold.slice(0, limit);
  console.log('gold set: ' + goldFile + (tag ? '  (tag ' + tag + ')' : '  (v1)'));

  // Which gold pages still exist? A question whose page was deleted cannot be found, and counting it
  // as a miss would understate the system while dropping it silently would flatter it. Report both.
  const slugs = new Set((await prisma.knowledgeChunk.findMany({ select: { slug: true } })).map(r => r.slug));
  const alive = q => slugs.has(q.gold_slug);
  console.log('gold questions: ' + gold.length + ', whose gold page still exists: ' + gold.filter(alive).length);

  // "Any page containing the answer passage" — only for questions that carry one (v2's crawled-web slice).
  const withPassage = gold.filter(g => g.passage);
  const answerPages = new Map();
  if (withPassage.length) {
    const chunks = await prisma.knowledgeChunk.findMany({ where: { source: { notIn: ['style', 'style-om'] } }, select: { slug: true, text: true } });
    for (const g of withPassage) answerPages.set(g.qid, pagesContaining(chunks, g.passage));
    const missing = withPassage.filter(g => !answerPages.get(g.qid).has(g.gold_slug));
    console.log('questions with an answer passage: ' + withPassage.length + ', passage no longer on its gold page: ' + missing.length
      + (missing.length ? '  [' + missing.map(g => g.qid).join(', ') + ']' : ''));
  }

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
    const ans = answerPages.get(g.qid);
    const any3 = hits => ans ? pages(hits).slice(0, 3).some(s => ans.has(s)) : null;
    rows.push({ qid: g.qid, lang: g.lang, source: g.gold_source, slug: g.gold_slug, alive: alive(g),
      plain: p3(plain), shipped: p3(shipped), top: pages(shipped).slice(0, 3),
      ...(ans ? { answerPages: [...ans], plainAny: any3(plain), shippedAny: any3(shipped), topPlain: pages(plain).slice(0, 3) } : {}) });
    if ((i + 1) % 20 === 0) console.log('  ' + (i + 1) + '/' + gold.length);
    await sleep(300);
  }

  const pct = (list, f) => list.length ? (100 * list.filter(f).length / list.length).toFixed(1) + '%' : '—';
  const OWN = ['guide', 'page', 'addis', 'llms', 'docs', 'skill'];
  const slice = (name, list) => {
    const t = { name, n: list.length, plain: pct(list, r => r.plain), shipped: pct(list, r => r.shipped) };
    const scored = list.filter(r => r.plainAny !== undefined);
    if (withPassage.length) Object.assign(t, { nAny: scored.length, plainAny: pct(scored, r => r.plainAny), shippedAny: pct(scored, r => r.shippedAny) });
    return t;
  };

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
  if (withPassage.length) {
    console.log('\n  Any page@3 — is ANY page whose text holds the answer passage in the top three? (questions with a passage only)\n');
    console.log('  ' + 'slice'.padEnd(36) + 'n'.padStart(5) + 'retrieval'.padStart(12) + 'as shipped'.padStart(13));
    for (const t of table) if (t.nAny) console.log('  ' + t.name.padEnd(36) + String(t.nAny).padStart(5) + t.plainAny.padStart(12) + t.shippedAny.padStart(13));
  }

  const gone = rows.filter(r => !r.alive);
  if (gone.length) {
    console.log('\n  gold pages that no longer exist (' + gone.length + '): ' + [...new Set(gone.map(r => r.slug))].slice(0, 12).join(', '));
  }
  const regressed = rows.filter(r => r.plain && !r.shipped);
  console.log('\n  found by retrieval but dropped by the reranker: ' + regressed.length
    + (regressed.length ? '  [' + regressed.slice(0, 6).map(r => r.qid).join(', ') + ']' : ''));
  console.log('  found only after reranking: ' + rows.filter(r => !r.plain && r.shipped).length);

  const at = new Date();
  const LATEST = latestName(tag);
  const f = writeResult(OUT, { at: at.toISOString(), gold: goldFile, chunks: health.chunks, limit: limit || null, table, rows }, at, { latest: !limit, tag });
  console.log('\n  written: ' + f + (limit ? '  (--limit run: ' + LATEST + ' left alone)' : '  (and ' + LATEST + ')'));
  await prisma.$disconnect();
}

module.exports = { resultName, writeResult, goldPath, goldTag, latestName, normText, pagesContaining, GOLD };

// Only when run as a script: requiring it (the tests do) must not open the DB or spend Gemini calls.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
