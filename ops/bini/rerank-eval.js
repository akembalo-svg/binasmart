#!/usr/bin/env node
'use strict';
// Is the reranker worth keeping?
//
// Page@3 cannot answer that. A reranker's job is to put the passage that ANSWERS the question at the
// top of the block the model reads, and to drop passages that only share its topic — it is not trying
// to change which pages appear at all. Judging it on "is the right page somewhere in the top three"
// measures the thing it is not doing and misses the thing it is.
//
// So: rank of the gold page, not its presence. Plus what it costs in latency and tokens, because it
// is an extra Gemini generation call on every single message Bini answers.
//
//   node --env-file=.env ops/bini/rerank-eval.js [--limit N]

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { makeKnowledge } = require('/var/www/connectcare/binasmart/knowledge');

const GOLD = '/root/storage/bina-embed/eval/gold.json';
const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
const KEY = process.env.GEMINI_API_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page's own measured ratios, so the token figures are in the same currency as /amharic-ai.
const estTokens = s => {
  const am = (s.match(/[ሀ-፿]/g) || []).length;
  return Math.round(am / 1.85 + (s.length - am) / 3.55);
};
// The prompt rerank() builds, reconstructed so it can be measured without touching the module.
const rerankPrompt = (q, cands, k) => 'Question:\n' + q + '\n\nPassages:\n'
  + cands.map((c, i) => '[' + i + '] ' + (c.title || '') + '\n' + String(c.text || '').slice(0, 420)).join('\n\n')
  + '\n\nReturn ONLY a JSON array of passage numbers, most useful first, keeping at most ' + k
  + '. Judge whether a passage ANSWERS the question, not whether it shares its topic. Omit passages that do not help. No prose.';

async function countTokens(text) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:countTokens?key=' + KEY, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
  });
  const j = await r.json();
  return j.error ? null : j.totalTokens;
}

const pages = hits => { const o = []; for (const h of hits) if (!o.includes(h.slug)) o.push(h.slug); return o; };
const rankOf = (hits, slug) => { const i = pages(hits).indexOf(slug); return i < 0 ? 0 : i + 1; };   // 0 = absent

(async () => {
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: KEY });
  await k.load();
  let gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  if (limit) gold = gold.slice(0, limit);
  console.log('corpus ' + k.health().chunks + ' chunks · ' + gold.length + ' questions\n');

  const rows = [];
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i];
    const t0 = Date.now();
    const plain = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'] });
    const tRetrieve = Date.now() - t0;          // includes the query embed on the first call only
    const t1 = Date.now();
    const shipped = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
    const tBoth = Date.now() - t1;              // query vector is cached by now, so the delta is the rerank
    rows.push({
      qid: g.qid, source: g.gold_source, lang: g.lang,
      plainRank: rankOf(plain, g.gold_slug),
      shipRank: rankOf(shipped.slice(0, 6), g.gold_slug),
      rerankMs: Math.max(0, tBoth - (i ? 0 : 0)),
      promptTokens: estTokens(rerankPrompt(g.question, plain, 6)),
      ctxTokens: estTokens(shipped.map(h => h.text).join('\n')),
    });
    if ((i + 1) % 25 === 0) console.log('  ' + (i + 1) + '/' + gold.length);
    await sleep(250);
  }

  // Exact token count on a sample, so the estimate above can be trusted or corrected.
  let exact = [];
  for (const g of gold.slice(0, 8)) {
    const cands = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'] });
    const n = await countTokens(rerankPrompt(g.question, cands, 6));
    if (n) exact.push({ est: estTokens(rerankPrompt(g.question, cands, 6)), exact: n });
    await sleep(4000);
  }

  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
  const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length * 0.9)] || 0; };
  const mrr = f => (rows.reduce((n, r) => n + (f(r) ? 1 / f(r) : 0), 0) / rows.length);
  const at = (f, n) => (100 * rows.filter(r => f(r) && f(r) <= n).length / rows.length);

  console.log('\n  WHAT THE RERANKER IS FOR — where the right page lands\n');
  console.log('  metric              retrieval    as shipped   change');
  const line = (name, a, b, fmt) => console.log('  ' + name.padEnd(20) + fmt(a).padStart(9) + fmt(b).padStart(13)
    + ((b - a >= 0 ? '   +' : '   ') + (b - a).toFixed(b > 1 ? 1 : 3)).padStart(10));
  line('page is 1st (P@1)', at(r => r.plainRank, 1), at(r => r.shipRank, 1), v => v.toFixed(1) + '%');
  line('page in top 3', at(r => r.plainRank, 3), at(r => r.shipRank, 3), v => v.toFixed(1) + '%');
  line('MRR', mrr(r => r.plainRank), mrr(r => r.shipRank), v => v.toFixed(3));

  const up = rows.filter(r => r.plainRank && r.shipRank && r.shipRank < r.plainRank).length;
  const down = rows.filter(r => r.plainRank && r.shipRank && r.shipRank > r.plainRank).length;
  const lost = rows.filter(r => r.plainRank && r.plainRank <= 6 && !r.shipRank).length;
  const same = rows.length - up - down - lost;
  console.log('\n  moved up ' + up + ' · moved down ' + down + ' · dropped entirely ' + lost + ' · unchanged ' + same);

  console.log('\n  WHAT IT COSTS\n');
  console.log('  rerank latency      median ' + med(rows.map(r => r.rerankMs)) + ' ms · p90 ' + p90(rows.map(r => r.rerankMs)) + ' ms');
  console.log('  rerank prompt       median ' + med(rows.map(r => r.promptTokens)).toLocaleString() + ' tokens (estimated)');
  if (exact.length) {
    const ratio = exact.reduce((n, e) => n + e.exact / e.est, 0) / exact.length;
    console.log('  estimate checked    ' + exact.length + ' prompts counted exactly: estimate runs ' + ratio.toFixed(2) + 'x true'
      + ' → median ' + Math.round(med(rows.map(r => r.promptTokens)) * ratio).toLocaleString() + ' real tokens');
  }
  console.log('  context it produces median ' + med(rows.map(r => r.ctxTokens)).toLocaleString() + ' tokens');
  console.log('\n  so each answer spends ~' + Math.round(med(rows.map(r => r.promptTokens)) / Math.max(1, med(rows.map(r => r.ctxTokens))))
    + 'x more tokens choosing passages than the passages themselves cost.');

  fs.mkdirSync('/root/bini-eval', { recursive: true });
  fs.writeFileSync('/root/bini-eval/rerank-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ rows, exact }, null, 1));
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
