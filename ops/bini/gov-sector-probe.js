#!/usr/bin/env node
'use strict';
// Government-sector coverage probe (2026-09-17). For each citizen question, the top pages Bini's
// shipped search returns (18 candidates, reranked to 6), so a reviewer can grade whether the corpus
// answers it. No gold pages: the point is to find sectors where nothing relevant exists.
//   node --env-file=.env ops/bini/gov-sector-probe.js <questions.json> <out.json>
const fs = require('fs');
async function main() {
  const [qfile, outfile] = process.argv.slice(2);
  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge } = require('/var/www/connectcare/binasmart/knowledge');
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY });
  await k.load();
  const qs = JSON.parse(fs.readFileSync(qfile, 'utf8'));
  const rows = [];
  for (const [sector, lang, question] of qs) {
    let hits = [];
    try { hits = await k.search(question, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 }); }
    catch (e) { console.log('! ' + question + ' ' + e.message); }
    rows.push({ sector, lang, question, hits: hits.slice(0, 4).map(h => ({ source: h.source, slug: h.slug, title: h.title, url: h.url, lang: h.lang, text: String(h.text || '').replace(/\s+/g, ' ').slice(0, 260) })) });
    process.stdout.write('.');
  }
  fs.writeFileSync(outfile, JSON.stringify(rows, null, 1));
  console.log('\nwrote ' + rows.length + ' to ' + outfile);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
