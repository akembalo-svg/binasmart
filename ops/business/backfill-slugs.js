'use strict';
// Give every live shop its public slug, so /shop/<slug> exists before the owner ever signs in.
// English name first (a slug must be ASCII); an Amharic-only tenant gets shop-<id tail>.
//   node ops/business/backfill-slugs.js [--dry]
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const slugify = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
(async () => {
  const dry = process.argv.includes('--dry');
  const shops = await prisma.shop.findMany({ where: { status: 'live', slug: null }, select: { id: true, name: true, nameAm: true } });
  const taken = new Set((await prisma.shop.findMany({ where: { NOT: { slug: null } }, select: { slug: true } })).map(s => s.slug));
  let n = 0, amharic = 0;
  for (const s of shops) {
    const stem = slugify(s.name) || slugify(s.nameAm) || 'shop-' + s.id.slice(-6);
    if (!slugify(s.name)) amharic++;
    let slug = stem, i = 2;
    while (taken.has(slug)) { slug = stem + '-' + i++; }
    taken.add(slug);
    if (!dry) await prisma.shop.update({ where: { id: s.id }, data: { slug } });
    n++;
    if (n <= 8) console.log('  ', (s.nameAm || s.name).slice(0, 30), '->', slug);
  }
  console.log((dry ? 'dry: ' : '') + 'slugged ' + n + ' live shops (' + amharic + ' had no Latin name)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
