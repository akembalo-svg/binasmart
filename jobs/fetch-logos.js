#!/usr/bin/env node
'use strict';
// Real company logos for the jobs board, taken from each company's own website.
//
//   node --env-file=.env jobs/fetch-logos.js --dry-run [--limit 10]
//   node --env-file=.env jobs/fetch-logos.js [--limit 50] [--refresh]
//
// Where the logo comes from, in order of how well it prints at 46px:
//   1. apple-touch-icon — made to be a square tile, almost always a clean PNG;
//   2. <link rel="icon"> that is a png/svg, largest declared size first;
//   3. og:image — a banner, not a mark, so it is the last resort and only when nothing else exists;
//   4. /favicon.ico at the root, which every site has even when it declares nothing.
//
// The file is copied to our own /public/logos and served from bina.et. We do not hotlink: a hotlinked
// logo breaks when they redesign, leaks our readers' IPs to their server, and puts their bandwidth
// behind our page. A company that asks us to remove its mark is one file and one column away.
//
// Only companies that published a website get one. The rest keep the monogram, which is honest: we do
// not have their logo, and a wrong logo on a vacancy is worse than initials.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'logos');
const PACE_MS = 1500;
const MAX_BYTES = 600 * 1024;
const MIN_BYTES = 300;                 // a 1x1 tracking gif is not a logo
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; logo for the employer listing; contact https://t.me/Bina_smart)';

const DRY = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) || 0 : 0; })();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/gif': 'gif' };

async function get(url, binary) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: binary ? 'image/*' : 'text/html' } });
    if (!r.ok) return null;
    if (!binary) return { text: await r.text(), url: r.url };
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    return { buf, type, url: r.url };
  } catch (e) { return null; } finally { clearTimeout(t); }
}

const attr = (tag, name) => {
  const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i').exec(tag);
  return m ? (m[2] !== undefined ? m[2] : m[3]) : null;
};
const biggest = tag => {
  const s = attr(tag, 'sizes');
  const n = s ? Math.max(...String(s).split(/\s+/).map(x => parseInt(x, 10) || 0)) : 0;
  return n;
};

// Every candidate the page offers, best first.
function candidates(html, base) {
  const out = [];
  const links = [...String(html).matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const push = (href, rank) => {
    if (!href) return;
    try { out.push({ url: new URL(href, base).toString(), rank }); } catch (e) {}
  };
  for (const tag of links) {
    const rel = String(attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (/apple-touch-icon/.test(rel)) push(href, 10 + biggest(tag) / 1000);
    else if (/\bicon\b/.test(rel)) push(href, (/\.(png|svg)(\?|$)/i.test(String(href)) ? 6 : 3) + biggest(tag) / 1000);
  }
  const og = /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*>/i.exec(html);
  if (og) push(attr(og[0], 'content'), 2);
  push('/favicon.ico', 1);
  return out.sort((a, b) => b.rank - a.rank).slice(0, 6);
}

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  fs.mkdirSync(DIR, { recursive: true });

  const where = { website: { not: null } };
  if (!REFRESH) where.logoUrl = null;
  let emps = await prisma.employer.findMany({ where, select: { id: true, slug: true, name: true, website: true }, orderBy: { name: 'asc' } });
  if (LIMIT) emps = emps.slice(0, LIMIT);
  console.log('[logos] ' + emps.length + ' companies to try');

  let got = 0, none = 0;
  for (const e of emps) {
    const site = /^https?:\/\//i.test(e.website) ? e.website : 'https://' + e.website;
    const page = await get(site, false);
    await sleep(PACE_MS);
    if (!page) { none++; console.log('  -- ' + e.name + ': site did not answer'); continue; }

    let saved = null;
    for (const c of candidates(page.text, page.url)) {
      const img = await get(c.url, true);
      await sleep(400);
      if (!img || !img.buf) continue;
      const ext = EXT[img.type];
      if (!ext || img.buf.length < MIN_BYTES || img.buf.length > MAX_BYTES) continue;
      saved = { ext, buf: img.buf, from: c.url };
      break;
    }
    if (!saved) { none++; console.log('  -- ' + e.name + ': no usable image'); continue; }

    const rel = '/static/logos/' + e.slug + '.' + saved.ext;
    if (DRY) { got++; console.log('  ok ' + e.name + ' → ' + saved.from + ' (' + Math.round(saved.buf.length / 1024) + 'kB ' + saved.ext + ')'); continue; }
    fs.writeFileSync(path.join(DIR, e.slug + '.' + saved.ext), saved.buf);
    await prisma.employer.update({ where: { id: e.id }, data: { logoUrl: rel } });
    got++;
    console.log('  ok ' + e.name + ' → ' + rel + ' (' + Math.round(saved.buf.length / 1024) + 'kB)');
  }
  console.log('\n[logos] ' + (DRY ? 'would save ' : 'saved ') + got + ', nothing usable for ' + none);
  await prisma.$disconnect();
})().catch(e => { console.error('[logos] failed: ' + e.message); process.exit(1); });
