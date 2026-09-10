#!/usr/bin/env node
'use strict';
// What Amharic actually costs US, measured with the tokenizer we actually run on.
//
// The news piece measured a sentence with tiktoken/o200k_base and found Amharic at 6.1x English.
// That is the right finding and the wrong tokenizer for this purpose: BinaSmart runs on Gemini, so
// the number that governs our bill and our context window is Gemini's. This measures that, on our
// own corpus, and then answers the question the article raises but cannot answer for us — if an
// Amharic library cannot fit in a context window, how much does retrieval actually send?
//
//   node --env-file=.env ops/token-cost.js

const { PrismaClient } = require('@prisma/client');
const KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function countTokens(text) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':countTokens?key=' + KEY;
  const r = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message.slice(0, 120));
  return j.totalTokens;
}

// The article's own sentence, so our number is comparable to the one already published.
const SENTENCE = {
  en: 'Hello, how are you? I am learning artificial intelligence.',
  am: 'ሰላም፣ እንዴት ነህ? እኔ ሰው ሰራሽ አስተውሎት እየተማርኩ ነው።',
  om: 'Akkam jirtu? Ani beekumsa namtolchee baradhaa jira.',
};

(async () => {
  if (!KEY) throw new Error('no GEMINI_API_KEY');
  const prisma = new PrismaClient();

  console.log('=== the same sentence, three languages, Gemini tokenizer ===');
  const sent = {};
  for (const [lg, t] of Object.entries(SENTENCE)) {
    sent[lg] = await countTokens(t);
    console.log('  ' + lg.padEnd(3) + String(sent[lg]).padStart(4) + ' tokens   ' + t.slice(0, 52));
    await sleep(4000);
  }
  console.log('  Amharic / English  = ' + (sent.am / sent.en).toFixed(1) + 'x');
  console.log('  Oromo   / English  = ' + (sent.om / sent.en).toFixed(1) + 'x');

  // ---- characters per token, per language, from our own corpus
  console.log('\n=== chars per token, measured on our own chunks ===');
  const ratio = {};
  for (const lg of ['am', 'om', 'en']) {
    const rows = await prisma.knowledgeChunk.findMany({
      where: { lang: lg }, select: { text: true }, take: 8, orderBy: { id: 'asc' } });
    if (!rows.length) { console.log('  ' + lg + ': no chunks'); continue; }
    let chars = 0, toks = 0;
    for (const r of rows) {
      const t = r.text.slice(0, 1500);
      chars += t.length;
      toks += await countTokens(t);
      await sleep(4000);
    }
    ratio[lg] = chars / toks;
    console.log('  ' + lg.padEnd(3) + ' ' + (chars / toks).toFixed(2) + ' chars/token   (' + rows.length
      + ' chunks, ' + chars + ' chars, ' + toks + ' tokens)');
  }

  // ---- the whole library, extrapolated from those ratios
  console.log('\n=== the whole BinaSmart library ===');
  const byLang = await prisma.$queryRawUnsafe(
    'SELECT lang, COUNT(*)::int AS n, SUM(LENGTH(text))::bigint AS chars FROM "KnowledgeChunk" GROUP BY lang ORDER BY 3 DESC');
  let totalTokens = 0, totalChunks = 0;
  for (const r of byLang) {
    const chars = Number(r.chars);
    const cpt = ratio[r.lang] || ratio.en || 4;
    const tok = Math.round(chars / cpt);
    totalTokens += tok; totalChunks += r.n;
    console.log('  ' + String(r.lang || '?').padEnd(4) + String(r.n).padStart(5) + ' chunks  '
      + String(chars).padStart(9) + ' chars  ~' + String(tok).padStart(8) + ' tokens');
  }
  console.log('  TOTAL ' + totalChunks + ' chunks, ~' + totalTokens.toLocaleString() + ' tokens');

  // ---- what one question actually sends
  console.log('\n=== what one question actually costs ===');
  const knowledge = require('/var/www/connectcare/binasmart/knowledge');
  const QS = [
    'ፓስፖርት ለማውጣት ስንት ብር ነው?',
    'የቤት ኪራይ ውል የት ይመዘገባል?',
    'Mucaan koo ho\'a qaba, kutaa kamitti deemuu qaba?',
  ];
  let ctxTokens = 0, n = 0;
  for (const q of QS) {
    const ctx = await knowledge.contextFor(q, {}).catch(() => '');
    if (!ctx) continue;
    const t = await countTokens(ctx);
    ctxTokens += t; n++;
    console.log('  ' + String(t).padStart(5) + ' tokens retrieved for: ' + q.slice(0, 44));
    await sleep(4000);
  }
  const avg = n ? Math.round(ctxTokens / n) : 0;
  console.log('  average retrieved context: ' + avg + ' tokens');

  console.log('\n=== the point ===');
  const WINDOW = 1000000; // gemini-2.5-flash context window
  console.log('  library                 ~' + totalTokens.toLocaleString() + ' tokens');
  console.log('  a 1M-token context window holds ' + (100 * WINDOW / totalTokens).toFixed(0) + '% of it');
  console.log('  we send                  ' + avg + ' tokens per question');
  console.log('  = ' + (totalTokens / Math.max(1, avg)).toFixed(0) + 'x less than the whole library');

  await prisma.$disconnect();
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
