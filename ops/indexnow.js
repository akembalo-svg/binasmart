#!/usr/bin/env node
'use strict';
// Telling Bing, Yandex and Seznam about new pages the moment they exist.
//
//   node ops/indexnow.js --dry-run [--limit 20]
//   node ops/indexnow.js [--limit 5000]
//
// A sitemap is a standing invitation; IndexNow is a knock on the door. We publish hundreds of vacancies
// a day and each one is only useful while it is open - a job that gets indexed three weeks after its
// deadline may as well not exist. This submits the pages published since the last run.
//
// Google does not take IndexNow (and dropped its own sitemap ping in 2023); for Google the sitemap plus
// the internal linking is the route, which is why the category pages exist. This covers everyone else.
const fs = require('fs');
const path = require('path');

const HOST = 'bina.et';
const STATE = '/root/storage/indexnow-last.txt';
const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 5000; })();

// The key is a file in public/: <key>.txt containing the key. Read it rather than storing it twice.
function findKey() {
  const dir = path.join(__dirname, '..', 'public');
  const f = fs.readdirSync(dir).find(n => /^[a-f0-9]{32}\.txt$/.test(n));
  if (!f) return null;
  const key = f.replace(/\.txt$/, '');
  const body = fs.readFileSync(path.join(dir, f), 'utf8').trim();
  return body === key ? key : null;      // a key file whose contents do not match is not a valid key
}

(async () => {
  const key = findKey();
  if (!key) { console.error('[indexnow] no key file in public/ — nothing submitted'); process.exit(1); }

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const since = fs.existsSync(STATE) ? new Date(fs.readFileSync(STATE, 'utf8').trim()) : new Date(Date.now() - 2 * 86400000);
    const now = new Date();
    // 2026-09-26: this submitted VACANCIES ONLY. Every news article and every tender we published was
    // written to the sitemap and then never announced to anybody - the Volkswagen piece and the LiGong
    // piece both went out with no IndexNow ping at all. A sitemap is waited for; IndexNow is told. News
    // is the most time-sensitive thing on the site, so it was the wrong half to leave out.
    const fresh = { published: true, publishedAt: { gt: since } };
    const jobs = await prisma.job.findMany({
      where: fresh, select: { slug: true }, orderBy: { publishedAt: 'desc' }, take: LIMIT,
    });
    const posts = await prisma.newsPost.findMany({
      where: fresh, select: { slug: true }, orderBy: { publishedAt: 'desc' }, take: LIMIT,
    }).catch(() => []);
    const tenders = await prisma.tender.findMany({
      where: fresh, select: { slug: true }, orderBy: { publishedAt: 'desc' }, take: LIMIT,
    }).catch(() => []);
    const urls = [
      ...posts.map(p => 'https://' + HOST + '/news/' + p.slug),
      ...tenders.map(t => 'https://' + HOST + '/tenders/' + t.slug),
      ...jobs.map(j => 'https://' + HOST + '/jobs/' + j.slug),
    ];
    if (!urls.length) { console.log('[indexnow] nothing new since ' + since.toISOString()); return; }

    console.log('[indexnow] ' + urls.length + ' pages (' + posts.length + ' news, ' + tenders.length + ' tenders, ' + jobs.length + ' jobs) published since ' + since.toISOString().slice(0, 16));
    if (DRY) { urls.slice(0, 5).forEach(u => console.log('  ' + u)); return; }

    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key, keyLocation: 'https://' + HOST + '/' + key + '.txt', urlList: urls }),
    });
    // 200 and 202 both mean accepted; 422 means the key or urls were rejected and is worth seeing.
    console.log('[indexnow] submitted ' + urls.length + ' urls — HTTP ' + r.status);
    if (r.status === 200 || r.status === 202) fs.writeFileSync(STATE, now.toISOString());
    else console.error('[indexnow] not accepted: ' + (await r.text()).slice(0, 200));
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[indexnow] failed: ' + e.message); process.exit(1); });
