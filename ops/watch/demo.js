'use strict';
// Seeds one honest demo film (Creative Commons, hosted by Blender — not on our server) so /watch can be
// seen working, plus one paid DRAFT example (hidden) so the ops page shows both shapes.
//   node ops/watch/demo.js          node ops/watch/demo.js --clean
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SLUGS = ['demo-big-buck-bunny', 'demo-paid-example'];
(async () => {
  if (process.argv.includes('--clean')) {
    const films = await prisma.film.findMany({ where: { slug: { in: SLUGS } } });
    const r = await prisma.rental.deleteMany({ where: { filmId: { in: films.map(f => f.id) } } });
    const f = await prisma.film.deleteMany({ where: { slug: { in: SLUGS } } });
    console.log('cleaned', { films: f.count, rentals: r.count });
  } else {
    await prisma.film.upsert({ where: { slug: SLUGS[0] }, update: {}, create: { slug: SLUGS[0], title: 'Big Buck Bunny (demo)', titleAm: 'ቢግ ባክ ባኒ (ማሳያ)', year: 2008, runtimeMin: 10, rating: 'G', language: 'No dialogue', genre: 'Animation',
      descr: 'ማሳያ ፊልም። ይህ የBlender Foundation ነፃ ፊልም ነው (Creative Commons BY 3.0)፤ ማጫወቻው እንዴት እንደሚሠራ ለማየት ብቻ። · Demo only: a Creative Commons short by the Blender Foundation, here to show the player works. Real Amharic films appear once licensed.',
      posterUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/480px-Big_buck_bunny_poster_big.jpg', sourceKind: 'mp4', sourceUrl: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
      priceEtb: 0, rentHours: 48, rights: 'Creative Commons Attribution 3.0 — (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org', status: 'public' } });
    await prisma.film.upsert({ where: { slug: SLUGS[1] }, update: {}, create: { slug: SLUGS[1], title: 'Paid example (draft)', titleAm: 'የኪራይ ምሳሌ (ረቂቅ)', sourceKind: 'youtube', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ', priceEtb: 80, rentHours: 48, rights: null, status: 'draft',
      descr: 'Example of a paid film row. No rights note, so it can never become public until one is added.' } });
    console.log('demo films: https://bina.et/watch/' + SLUGS[0] + '  (+ hidden draft ' + SLUGS[1] + ')');
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
