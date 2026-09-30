#!/usr/bin/env node
'use strict';
// Announce any newly published article, whatever created it.
//
//   node --env-file=.env ops/news/auto-announce.js --seed      mark everything existing as done (RUN THIS FIRST)
//   node --env-file=.env ops/news/auto-announce.js --dry-run   show what it would send
//   node --env-file=.env ops/news/auto-announce.js             send
//
// Why this rather than fixing the publishing scripts. Only POST /api/admin/news calls autopostAll();
// every ops/news/add-*.js writes with prisma.newsPost.upsert and so goes up silently. Patching fifteen
// scripts would fix the ones that exist and miss the next one somebody writes. This watches the table
// instead, so an article announces itself no matter which path put it there.
//
// THE SEED STEP IS NOT OPTIONAL. There are 130-odd published articles. Without seeding, the first run
// would fire every one of them at the channel and the channel would be dead by lunchtime. --seed writes
// them all into the ledger as already-announced without sending anything.
//
// MAX_PER_RUN is a blast radius, not a throughput setting: if something ever bulk-inserts articles, this
// is what stops the channel taking the full hit before a human notices.
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const LEDGER = '/root/storage/news-announced.json';
const MAX_PER_RUN = 3;
const KEY = process.env.OWNER_KEY || '';
const PORT = process.env.PORT || 3000;
const SEED = process.argv.includes('--seed');
const DRY = process.argv.includes('--dry-run');
const FIELDS = ['slug', 'title', 'titleAm', 'category', 'excerpt', 'bodyHtml', 'lang', 'author',
  'heroEmoji', 'readMinutes', 'evergreen', 'published', 'publishedAt', 'authorUrl'];

const load = () => { try { return new Set(JSON.parse(fs.readFileSync(LEDGER, 'utf8'))); } catch (e) { return null; } };
const save = s => fs.writeFileSync(LEDGER, JSON.stringify([...s], null, 1));

(async () => {
  const prisma = new PrismaClient();
  try {
    const posts = await prisma.newsPost.findMany({ where: { published: true }, orderBy: { publishedAt: 'asc' } });
    let done = load();

    if (SEED || done === null) {
      if (done !== null && !SEED) return;
      save(new Set(posts.map(p => p.slug)));
      console.log('[auto-announce] seeded ' + posts.length + ' existing articles as already announced. Nothing sent.');
      return;
    }

    const pending = posts.filter(p => !done.has(p.slug));
    if (!pending.length) { if (DRY) console.log('[auto-announce] nothing new'); return; }

    const batch = pending.slice(0, MAX_PER_RUN);
    if (pending.length > MAX_PER_RUN) {
      console.log('[auto-announce] ' + pending.length + ' waiting; sending ' + MAX_PER_RUN + ' this run');
    }
    for (const p of batch) {
      if (DRY) { console.log('  would announce: ' + p.slug + '  (' + (p.titleAm || p.title).slice(0, 60) + ')'); continue; }
      const body = {};
      for (const f of FIELDS) if (p[f] !== undefined && p[f] !== null) body[f] = p[f];
      const r = await fetch('http://127.0.0.1:' + PORT + '/api/admin/news', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-key': KEY },
        body: JSON.stringify(body),
      });
      if (!r.ok) { console.error('  FAILED ' + p.slug + ' HTTP ' + r.status); continue; }
      // Only record it once the route accepted it, so a failure is retried next run rather than lost.
      done.add(p.slug); save(done);
      console.log('  announced: https://bina.et/news/' + p.slug);
      await new Promise(res => setTimeout(res, 3000));
    }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
