#!/usr/bin/env node
'use strict';
// Push an ALREADY-PUBLISHED article back through the admin route so it reaches the channels.
//
//   node --env-file=.env ops/news/share.js <slug> [--dry-run]
//
// Why this exists. There are two ways a post gets into the database and only one of them tells anybody:
//
//   POST /api/admin/news   -> upserts the row AND calls autopostAll() -> Telegram, Facebook, LinkedIn
//   prisma.newsPost.upsert -> writes the row and nothing else happens
//
// Every ops/news/add-*.js script takes the second path, so every article written that way has gone up
// silently. The Volkswagen piece only reached the channel because it was posted by hand afterwards;
// the LiGong and Council of Ministers pieces were never announced at all. Ibrahim noticed before I did.
//
// This reads the row that is already live and re-sends it through the route unchanged. The upsert is a
// no-op on content — same slug, same fields — but it makes the announcement fire. Nothing is rewritten.
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2];
const DRY = process.argv.includes('--dry-run');
const KEY = process.env.OWNER_KEY || '';
const PORT = process.env.PORT || 3000;
const FIELDS = ['slug', 'title', 'titleAm', 'category', 'excerpt', 'bodyHtml', 'lang', 'author',
  'heroEmoji', 'readMinutes', 'evergreen', 'published', 'publishedAt', 'authorUrl'];

if (!slug || slug.startsWith('--')) { console.error('usage: share.js <slug> [--dry-run]'); process.exit(2); }

(async () => {
  if (!KEY) { console.error('OWNER_KEY is not set'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const post = await prisma.newsPost.findUnique({ where: { slug } });
    if (!post) { console.error('no such article: ' + slug); process.exit(1); }
    if (!post.published) { console.error('that article is not published; refusing to announce it'); process.exit(1); }
    const body = {};
    for (const f of FIELDS) if (post[f] !== undefined && post[f] !== null) body[f] = post[f];
    console.log('article : ' + (post.titleAm || post.title));
    console.log('url     : https://bina.et/news/' + slug);
    console.log('channels: Telegram + Facebook + LinkedIn (autopostAll)');
    if (DRY) { console.log('\n[dry run] nothing sent.'); return; }
    const r = await fetch('http://127.0.0.1:' + PORT + '/api/admin/news', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-key': KEY },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) { console.error('HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); process.exit(1); }
    console.log('\nsent. ' + JSON.stringify(j));
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
