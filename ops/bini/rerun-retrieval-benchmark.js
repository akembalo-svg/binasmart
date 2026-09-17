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
//
// v3 (gold-v3-agents.json, 14 September) is the 120 gap-audit questions asked of Dr Afiya and Asmat. It is an
// object { questions, coverage_gaps }: each scored question names its agent, its grade (GOOD/PARTIAL) and one or
// more gold pages (source + slug; an answer often sits in both the English and the Amharic text of a law), and
// the NONE questions are listed as coverage gaps and never scored. An agent question is searched with exactly the
// options contextFor builds from that agent's `knowledge` declaration (agents/<agent>/rules.js), with and without
// the reranker, and a gold page matches on source AND slug. v3 adds per-agent and cross-lingual slices
// (Amharic question, gold page in English) and the rank of the first gold page (for MRR) to the output.
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold /root/storage/bina-embed/eval/gold-v3-agents.json

const fs = require('fs');
const path = require('path');

const GOLD = '/root/storage/bina-embed/eval/gold.json';
const OUT = process.env.BINI_EVAL_DIR || '/root/bini-eval';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --gold <path> beats $BINI_GOLD beats v1. A bare name - no slash, no .json - is a gold set in the same
// directory as v1: --gold travel is gold-travel.json there, --gold v2 is gold-v2.json. A path still behaves
// exactly as it did, so the published v1 and v2 commands are unchanged.
const GOLD_DIR = path.dirname(GOLD);
function goldPath(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--gold');
  const v = (i !== -1 && argv[i + 1]) ? argv[i + 1] : (env.BINI_GOLD || '');
  if (!v) return GOLD;
  if (!/[\\/]/.test(v) && !/\.json$/i.test(v)) return path.join(GOLD_DIR, 'gold-' + v + '.json');
  return v;
}
// '' for the default (v1) gold set, so its file names stay exactly what they were; otherwise the file's name.
function goldTag(p) {
  if (!p || path.resolve(p) === path.resolve(GOLD)) return '';
  return path.basename(p).replace(/\.json$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-');
}
// A gold set that is not on disk is a typo (--gold travel before Task 9 builds gold-travel.json), not a
// crash: say which file was wanted, and what a bare name means, instead of an ENOENT from mid-run.
function readGold(file, io = fs) {
  if (!io.existsSync(file)) {
    throw new Error('gold set not found: ' + file + '  (a bare --gold <name> means '
      + path.join(GOLD_DIR, 'gold-<name>.json') + ')');
  }
  return JSON.parse(io.readFileSync(file, 'utf8'));
}
const latestName = (tag = '') => 'retrieval-' + (tag ? tag + '-' : '') + 'latest.json';

// TEST-ONLY outage simulation (2026-09-15), for measuring the fallbacks of knowledge/index.js search():
//   --force-embed-fail gemini   the Gemini QUERY embedding throws, so search falls back to BGE-M3 via bina-embed
//   --force-embed-fail all      bina-embed throws as well, so search is keyword-only
// Injected into this script's own makeKnowledge only — never a production setting. The reranker is not touched
// (it has its own fail-open path). A forced run writes under its own tag and never replaces a *-latest.json.
function forceFailMode(argv = process.argv) {
  const i = argv.indexOf('--force-embed-fail');
  if (i === -1) return '';
  const m = argv[i + 1];
  if (m !== 'gemini' && m !== 'all') throw new Error('--force-embed-fail takes gemini or all');
  return m;
}
function runTag(tag, mode) {
  if (!mode) return tag;
  return (tag ? tag + '-' : '') + (mode === 'all' ? 'forced-keyword-only' : 'forced-gemini-fail');
}
// The makeKnowledge options for a mode. fetchImpl only fails the single-query endpoint (:embedContent), so nothing
// else this script could reach changes.
function knowledgeOptions(mode, { prisma, apiKey, fetchImpl = (...a) => fetch(...a) }) {
  const o = { prisma, apiKey };
  if (!mode) return o;
  o.fetchImpl = async (url, init) => { if (/:embedContent\?/.test(String(url))) throw new Error('forced: gemini query embedding down'); return fetchImpl(url, init); };
  o.localFallback = true;
  if (mode === 'all') o.localEmbedder = { query: async () => { throw new Error('forced: bina-embed down'); }, documents: async () => { throw new Error('forced: bina-embed down'); } };
  return o;
}

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

// v1/v2 are a list of questions with one gold page; v3 is { questions, coverage_gaps } with gold_pages.
// Returns { questions: [...each with goldPages: [{source, slug}]], gaps: [...] }.
function normalizeGold(raw) {
  const list = Array.isArray(raw) ? raw : (raw && raw.questions) || [];
  const gaps = Array.isArray(raw) ? [] : (raw && raw.coverage_gaps) || [];
  const questions = list.map(q => ({ ...q,
    goldPages: Array.isArray(q.gold_pages) && q.gold_pages.length
      ? q.gold_pages.map(p => ({ source: p.source, slug: p.slug }))
      : [{ source: q.gold_source, slug: q.gold_slug }] }));
  return { questions, gaps };
}
// v1 and v2 match on slug alone and their published figures depend on it. A question that names gold_pages
// - v3's agent questions, and the travel set - matches source AND slug, so travel:x is not guide:x.
const strictGold = q => !!q.agent || (Array.isArray(q.gold_pages) && q.gold_pages.length > 0);
function goldKeys(q) { return q.goldPages.map(p => (strictGold(q) ? p.source + ':' + p.slug : p.slug)); }
// 1-based rank of the first gold page among the distinct pages of a hit list, or null.
function pageRank(hits, keys, strict) {
  const pages = [];
  for (const h of hits) { const key = strict ? h.source + ':' + h.slug : h.slug; if (!pages.includes(key)) pages.push(key); }
  const i = pages.findIndex(p => keys.includes(p));
  return i < 0 ? null : i + 1;
}
// The two searches run per question. No agent: the options this benchmark always used. An agent: exactly what
// contextFor passes for that agent (contextSearchOptions), as shipped, and the same without the reranker.
function searchOptionsFor(q, { contextSearchOptions, knowledgeOf }) {
  // A question may carry its own preference. Bini has no agents/<name>/rules.js to look up - his travel
  // preference is decided per message in assistant/travel.js - so the travel gold set names the same list
  // the route passes, and the benchmark measures exactly what a user gets.
  if (Array.isArray(q.prefer) || Array.isArray(q.exclude)) {
    const shipped = contextSearchOptions({ prefer: q.prefer, exclude: q.exclude });
    const plain = { ...shipped }; delete plain.rerankTo;
    return { plain, shipped };
  }
  if (!q.agent) return { plain: { k: 18, exclude: ['style', 'style-om'] }, shipped: { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 } };
  const shipped = contextSearchOptions(knowledgeOf(q.agent) || {});
  const plain = { ...shipped }; delete plain.rerankTo;
  return { plain, shipped };
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge, contextSearchOptions, bilingualEnabled, bilingualEn2AmEnabled } = require('/var/www/connectcare/binasmart/knowledge');
  // Bilingual query retrieval (KNOWLEDGE_BILINGUAL_QUERY) is a flag on the production index, and this script
  // runs the production index rather than a copy of it, so whatever the environment says here is what a user
  // gets. Recorded in the result file so a run can never be mistaken for one made with the other setting.
  const bilingual = { query: bilingualEnabled(), en2am: bilingualEn2AmEnabled(), fusion: String(process.env.KNOWLEDGE_BILINGUAL_FUSION || 'max').toLowerCase() };
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
  // Resolve and read the gold set before the corpus is loaded, so a name with no file behind it costs one
  // line and a second, not a minute and a stack trace.
  const goldFile = goldPath();
  const goldRaw = readGold(goldFile);
  const prisma = new PrismaClient();
  const mode = forceFailMode();
  const k = makeKnowledge(knowledgeOptions(mode, { prisma, apiKey: process.env.GEMINI_API_KEY }));
  if (mode) console.log('TEST-ONLY: --force-embed-fail ' + mode + (mode === 'all' ? ' (Gemini query embed and bina-embed both fail: keyword-only)' : ' (Gemini query embed fails: BGE-M3 fallback)'));
  await k.load();
  const health = k.health();
  console.log('corpus: ' + health.chunks + ' chunks, ' + health.embedded + ' embedded, gemini=' + health.gemini
    + ', local vectors ' + health.embeddedLocal + (health.localFallback ? '' : ' (fallback off)'));

  console.log('bilingual query retrieval: ' + (bilingual.query ? 'ON (fusion ' + bilingual.fusion + (bilingual.en2am ? ', en2am ON' : '') + ')' : 'off'));

  const tag = runTag(goldTag(goldFile), mode);
  const norm = normalizeGold(goldRaw);
  let gold = norm.questions;
  if (limit) gold = gold.slice(0, limit);
  console.log('gold set: ' + goldFile + (tag ? '  (tag ' + tag + ')' : '  (v1)'));
  if (norm.gaps.length) console.log('coverage gaps (no gold page, not scored): ' + norm.gaps.length);
  const knowledgeOf = agent => require(path.join(__dirname, '..', '..', 'agents', agent, 'rules')).knowledge || {};

  // Which gold pages still exist? A question whose page was deleted cannot be found, and counting it
  // as a miss would understate the system while dropping it silently would flatter it. Report both.
  const pageRows = await prisma.knowledgeChunk.findMany({ select: { source: true, slug: true } });
  const slugs = new Set(pageRows.map(r => r.slug)), pagesAlive = new Set(pageRows.map(r => r.source + ':' + r.slug));
  const alive = q => goldKeys(q).some(key => (strictGold(q) ? pagesAlive : slugs).has(key));
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
  const msCold = [], msWarm = [];
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i];
    let plain = [], shipped = [];
    const opts = searchOptionsFor(g, { contextSearchOptions, knowledgeOf });
    try {
      // The FIRST search of a question is the cold one: it pays for the query embedding and, with bilingual
      // retrieval on, for the rendering and the second embedding too. The second search of the SAME question
      // is served out of both caches and additionally runs the reranker, so the two are reported apart and
      // neither is called "the" latency. The user-facing number is contextFor, measured by
      // ops/bini/bilingual-latency.js.
      const t0 = Date.now();
      plain = await k.search(g.question, opts.plain);
      msCold.push(Date.now() - t0);
      const t1 = Date.now();
      shipped = await k.search(g.question, opts.shipped);
      msWarm.push(Date.now() - t1);
    } catch (e) { console.log('  ! ' + g.qid + ' ' + e.message); }
    const strict = strictGold(g), keys = goldKeys(g);
    const pages = hits => { const out = []; for (const h of hits) { const p = strict ? h.source + ':' + h.slug : h.slug; if (!out.includes(p)) out.push(p); } return out; };
    const p3 = hits => { const r = pageRank(hits, keys, strict); return r !== null && r <= 3; };
    const ans = answerPages.get(g.qid);
    const any3 = hits => ans ? pages(hits).slice(0, 3).some(s => ans.has(s)) : null;
    rows.push({ qid: g.qid, lang: g.lang, source: g.gold_source, slug: g.gold_slug, alive: alive(g),
      ...(g.batch === undefined ? {} : { batch: g.batch }),
      plain: p3(plain), shipped: p3(shipped), top: pages(shipped).slice(0, 3),
      ...(ans ? { answerPages: [...ans], plainAny: any3(plain), shippedAny: any3(shipped), topPlain: pages(plain).slice(0, 3) } : {}),
      ...(g.agent ? { agent: g.agent, grade: g.grade, gold: keys, crossLingual: !!g.crossLingual, strictCrossLingual: !!g.strictCrossLingual,
        plainRank: pageRank(plain, keys, true), shippedRank: pageRank(shipped, keys, true), topPlain: pages(plain).slice(0, 3) } : {}) });
    if ((i + 1) % 20 === 0) console.log('  ' + (i + 1) + '/' + gold.length);
    await sleep(300);
  }
  const quantile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
  const latency = { n: msCold.length, coldP50: quantile(msCold, 0.5), coldP95: quantile(msCold, 0.95), cachedP50: quantile(msWarm, 0.5), cachedP95: quantile(msWarm, 0.95) };

  const pct = (list, f) => list.length ? (100 * list.filter(f).length / list.length).toFixed(1) + '%' : '—';
  const OWN = ['guide', 'page', 'addis', 'llms', 'docs', 'skill'];
  const slice = (name, list) => {
    const t = { name, n: list.length, plain: pct(list, r => r.plain), shipped: pct(list, r => r.shipped) };
    const scored = list.filter(r => r.plainAny !== undefined);
    if (withPassage.length) Object.assign(t, { nAny: scored.length, plainAny: pct(scored, r => r.plainAny), shippedAny: pct(scored, r => r.shippedAny) });
    // v3 only: mean reciprocal rank of the first gold page (a miss counts 0)
    const mrr = f => list.length ? (list.reduce((s, r) => s + (r[f] ? 1 / r[f] : 0), 0) / list.length).toFixed(3) : '—';
    if (list.length && list.every(r => r.agent)) Object.assign(t, { mrrPlain: mrr('plainRank'), mrrShipped: mrr('shippedRank') });
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
  if (rows.some(r => r.agent)) {
    for (const agent of [...new Set(rows.filter(r => r.agent).map(r => r.agent))]) {
      table.push(slice(agent, rows.filter(r => r.agent === agent)));
      for (const lang of ['am', 'en']) table.push(slice('  ' + agent + ' ' + lang, rows.filter(r => r.agent === agent && r.lang === lang)));
    }
    table.push(slice('am question, gold only in English', rows.filter(r => r.lang === 'am' && r.strictCrossLingual)));
    table.push(slice('question + gold share a language', rows.filter(r => r.agent && !r.crossLingual)));
  }
  // A gold set built in more than one sitting can be read one batch at a time: the banking set's batch 1 was
  // written before the National Bank, telebirr and M-PESA were in the pack and batch 2 against them, and a
  // single number over both would hide which of them moved.
  const batches = [...new Set(rows.map(r => r.batch).filter(b => b !== undefined && b !== null))].sort();
  if (batches.length > 1) for (const b of batches) {
    table.push(slice('batch ' + b, rows.filter(r => r.batch === b)));
    for (const lang of ['am', 'en']) table.push(slice('  batch ' + b + ' ' + lang, rows.filter(r => r.batch === b && r.lang === lang)));
  }
  console.log('\n  Page@3 — is the right page in the top three?\n');
  console.log('  ' + 'slice'.padEnd(36) + 'n'.padStart(5) + 'retrieval'.padStart(12) + 'as shipped'.padStart(13));
  for (const t of table) console.log('  ' + t.name.padEnd(36) + String(t.n).padStart(5) + t.plain.padStart(12) + t.shipped.padStart(13)
    + (t.mrrPlain ? '   MRR ' + t.mrrPlain + ' / ' + t.mrrShipped : ''));
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
  // which query embedder each search actually used (embedOk = Gemini, localUsed = BGE-M3, keywordOnly = neither)
  const hs = k.health();
  const embedPaths = { embedOk: hs.embedOk, embedErr: hs.embedErr, localOk: hs.localOk, localErr: hs.localErr, localUsed: hs.localUsed, keywordOnly: hs.keywordOnly,
    rerankOk: hs.rerankOk, rerankErr: hs.rerankErr, rerankSkipped: hs.rerankSkipped,
    // bilingual query retrieval (KNOWLEDGE_BILINGUAL_QUERY): how many searches asked for an other-language
    // rendering, how many were served from the cache, and how many fell back to the single-query path.
    // bilingualRescued: chunks an augment run appended because the question's own ranking never held their page.
    bilingualOk: hs.bilingualOk, bilingualCached: hs.bilingualCached, bilingualSkipped: hs.bilingualSkipped, bilingualFused: hs.bilingualFused, bilingualRescued: hs.bilingualRescued };
  console.log('\n  query embed paths: ' + JSON.stringify(embedPaths));
  console.log('  search latency ms: ' + JSON.stringify(latency));
  const f = writeResult(OUT, { at: at.toISOString(), gold: goldFile, chunks: health.chunks, limit: limit || null, ...(mode ? { forceEmbedFail: mode } : {}), bilingual, embedPaths, latency, table, rows }, at, { latest: !limit && !mode, tag });
  console.log('\n  written: ' + f + (mode ? '  (forced-failure run: no latest file)' : limit ?'  (--limit run: ' + LATEST + ' left alone)' : '  (and ' + LATEST + ')'));
  await prisma.$disconnect();
}

module.exports = { resultName, writeResult, goldPath, goldTag, readGold, latestName, normText, pagesContaining, GOLD, forceFailMode, runTag, knowledgeOptions,
  normalizeGold, goldKeys, pageRank, searchOptionsFor };

// Only when run as a script: requiring it (the tests do) must not open the DB or spend Gemini calls.
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
