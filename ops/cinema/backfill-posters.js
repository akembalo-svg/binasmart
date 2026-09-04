'use strict';
// Fill missing posters from TMDB for programme entries and Watch films. Needs TMDB_API_KEY in .env.
// Only rows with NO poster are touched; the cinema's or channel's own poster is never replaced.
//   node ops/cinema/backfill-posters.js [--dry]
const fs = require('fs'); const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { makePosters } = require('../../cinema/posters');
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const prisma = new PrismaClient(); const dry = process.argv.includes('--dry');
(async () => {
  const posters = makePosters({ apiKey: env.TMDB_API_KEY });
  if (!posters.enabled) { console.log('TMDB_API_KEY not set — nothing to do'); await prisma.$disconnect(); return; }
  let hit = 0, miss = 0;
  const yearOf = s => { const m = String(s || '').match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : undefined; };
  for (const p of await prisma.programme.findMany({ where: { active: true, posterUrl: null } })) {
    const r = await posters.search(p.title, yearOf(p.notes)); if (r) { hit++; if (!dry) await prisma.programme.update({ where: { id: p.id }, data: { posterUrl: r.posterUrl } }); console.log('programme ' + p.title + ' -> ' + r.posterUrl); } else { miss++; console.log('programme ' + p.title + ' -> no match'); }
  }
  for (const f of await prisma.film.findMany({ where: { posterUrl: null } })) {
    const r = await posters.search(f.title, f.year || undefined); if (r) { hit++; if (!dry) await prisma.film.update({ where: { id: f.id }, data: { posterUrl: r.posterUrl } }); console.log('film ' + f.title + ' -> ' + r.posterUrl); } else { miss++; console.log('film ' + f.title + ' -> no match'); }
  }
  console.log((dry ? 'dry: ' : '') + 'posters found ' + hit + ', no match ' + miss);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
