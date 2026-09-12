#!/usr/bin/env node
'use strict';
// Where should the rerank gate sit? Pick the threshold from the 114 gold questions rather than from
// intuition. For each question: how far ahead is the top hit, and did reranking change anything?
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { makeKnowledge } = require('/var/www/connectcare/binasmart/knowledge');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pages = h => { const o = []; for (const x of h) if (!o.find(y => y.slug === x.slug)) o.push(x); return o; };
const rank = (h, slug) => { const i = pages(h).findIndex(x => x.slug === slug); return i < 0 ? 0 : i + 1; };

(async () => {
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY });
  await k.load();
  const gold = JSON.parse(fs.readFileSync('/root/storage/bina-embed/eval/gold.json', 'utf8'));

  const rows = [];
  for (let i = 0; i < gold.length; i++) {
    const g = gold[i];
    const plain = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'] });
    const ship = await k.search(g.question, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
    const p = pages(plain);
    if (p.length < 2) continue;
    rows.push({
      qid: g.qid, source: g.gold_source,
      top1: p[0].score, top2: p[1].score,
      gap: +(p[0].score - p[1].score).toFixed(4),
      plainRank: rank(plain, g.gold_slug),
      shipRank: rank(ship.slice(0, 6), g.gold_slug),
      // did reranking change the top page, or the identity of the kept set?
      movedTop: p[0].slug !== (pages(ship)[0] || {}).slug,
      helped: rank(plain, g.gold_slug) !== 1 && rank(ship.slice(0, 6), g.gold_slug) === 1,
      hurt: rank(plain, g.gold_slug) === 1 && rank(ship.slice(0, 6), g.gold_slug) !== 1,
    });
    if ((i + 1) % 30 === 0) console.log('  ' + (i + 1) + '/' + gold.length);
    await sleep(250);
  }

  const gaps = rows.map(r => r.gap).sort((a, b) => a - b);
  const q = f => gaps[Math.floor(gaps.length * f)];
  console.log('\n  gap between the top page and the second, across ' + rows.length + ' questions');
  console.log('    p10 ' + q(0.1).toFixed(3) + '   median ' + q(0.5).toFixed(3) + '   p90 ' + q(0.9).toFixed(3));

  console.log('\n  where the reranker earned its call:');
  const show = (label, list) => {
    if (!list.length) { console.log('    ' + label.padEnd(26) + 'none'); return; }
    const g2 = list.map(r => r.gap).sort((a, b) => a - b);
    console.log('    ' + label.padEnd(26) + 'n=' + String(list.length).padStart(3)
      + '   gaps ' + g2[0].toFixed(3) + ' … ' + g2[g2.length - 1].toFixed(3)
      + '   median ' + g2[Math.floor(g2.length / 2)].toFixed(3));
  };
  show('helped (not 1st -> 1st)', rows.filter(r => r.helped));
  show('hurt (1st -> not 1st)', rows.filter(r => r.hurt));
  show('changed the top page', rows.filter(r => r.movedTop));
  show('changed nothing at all', rows.filter(r => !r.movedTop));

  console.log('\n  if the gate were: rerank only when gap < T');
  console.log('    T      reranks   % of calls saved   helped kept   hurt kept');
  for (const T of [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.15]) {
    const fires = rows.filter(r => r.gap < T);
    const keptHelp = rows.filter(r => r.helped && r.gap < T).length;
    const keptHurt = rows.filter(r => r.hurt && r.gap < T).length;
    console.log('    ' + T.toFixed(2).padEnd(7) + String(fires.length).padStart(5)
      + String((100 * (1 - fires.length / rows.length)).toFixed(0) + '%').padStart(18)
      + String(keptHelp + '/' + rows.filter(r => r.helped).length).padStart(14)
      + String(keptHurt + '/' + rows.filter(r => r.hurt).length).padStart
      (12));
  }
  fs.writeFileSync('/root/bini-eval/gate-threshold.json', JSON.stringify(rows, null, 1));
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
