'use strict';
// First real Amharic film on Watch: ታሪኬ (Tarike, 2024), a public YouTube upload by Haya Hulet Cinema,
// embedded with YouTube's own player. BinaSmart holds no licence, so it is FREE only; the rights
// note says exactly that and it comes down the moment the owner asks.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const data = {
    title: 'Tarike', titleAm: 'ታሪኬ', year: 2024, language: 'Amharic', genre: 'Drama',
    descr: 'ታሪኬ — የመዳኒት ዘለቀ ፊልም። በHaya Hulet Cinema የዩቲዩብ ቻናል ላይ በይፋ የቀረበ ሙሉ ፊልም፤ እዚህ በዩቲዩብ ማጫወቻ ይታያል።\n\nTarike — a film by Medanit Zeleke, published on the Haya Hulet Cinema YouTube channel and shown here through the YouTube player.',
    posterUrl: 'https://i.ytimg.com/vi/vo9O7_V6-64/maxresdefault.jpg', sourceKind: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=vo9O7_V6-64',
    priceEtb: 0, rentHours: 48,
    rights: 'Public YouTube upload by Haya Hulet Cinema (youtube.com/@HayaHuletCinema), video vo9O7_V6-64, embedded with the YouTube player as YouTube\'s terms allow. BinaSmart holds NO licence: free viewing only, never rented, removed on the channel owner\'s request. Added 2026-09-04.',
    status: 'public',
  };
  const f = await prisma.film.upsert({ where: { slug: 'tarike-2024' }, update: data, create: { slug: 'tarike-2024', ...data } });
  console.log('film:', f.slug, f.status, '| https://bina.et/watch/' + f.slug);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
