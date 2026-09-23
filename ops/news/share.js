#!/usr/bin/env node
'use strict';
// Share an already-published article to the channels (Telegram + Facebook page).
//
//   node --env-file=.env ops/news/share.js <slug> [<slug> ...]
//   node --env-file=.env ops/news/share.js <slug> --dry     print what would be sent, send nothing
//
// Why a script: /api/admin/news is an UPSERT, so a share is a re-POST of the whole record — posting
// the slug alone would blank every other column on create. This reads the row we already have and
// sends it back complete, which is the safe way round.
//
// It refuses an unpublished post: a share whose link 404s is worse than no share.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIELDS = ['slug', 'title', 'titleAm', 'category', 'excerpt', 'bodyHtml', 'lang', 'author',
  'authorUrl', 'heroEmoji', 'readMinutes', 'evergreen', 'published', 'publishedAt'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const slugs = args.filter(a => !a.startsWith('--'));
const KEY = process.env.OWNER_KEY || '';
const BASE = process.env.SELF_URL || 'http://127.0.0.1:4210';

(async () => {
  if (!slugs.length) { console.error('usage: share.js <slug> [<slug> ...] [--dry]'); process.exit(1); }
  if (!KEY) { console.error('OWNER_KEY is not in the environment'); process.exit(1); }

  for (const slug of slugs) {
    const post = await prisma.newsPost.findUnique({ where: { slug } });
    if (!post) { console.error('· ' + slug + ' — no such article, skipped'); continue; }
    if (!post.published) { console.error('· ' + slug + ' — not published, skipped'); continue; }

    const body = {};
    for (const f of FIELDS) if (post[f] !== undefined) body[f] = post[f];
    // The channel reads Amharic; the English title is for search engines. server.js picks titleAm.
    console.log('· ' + slug + ' → ' + (post.titleAm || post.title));
    if (DRY) continue;

    const r = await fetch(BASE + '/api/admin/news', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-key': KEY },
      body: JSON.stringify(body),
    });
    const out = await r.text();
    console.log('  ' + r.status + ' ' + out.slice(0, 200));
    // One at a time, with a breath between: three articles arriving in the same second reads as spam.
    if (slugs.length > 1) await new Promise(res => setTimeout(res, 6000));
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
