'use strict';
// Alem Cinema (Bole) programme, from the cinema's own Facebook post (facebook.com/alemcinema), relayed
// by Ibrahim. Alem posts in the ETHIOPIAN clock; ROWS below are already converted to international
// time (7:00 -> 13:00, 12:00 -> 18:00, "ምሽት 2:30" -> 20:30, "1:10" evening -> 19:10).
// Edit DAY / POSTED / ROWS for each new post; old entries expire by date.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const VENUE = 'alem-cinema';
const DAY = { from: '2026-09-04', to: '2026-09-04' };   // Friday programme
const SRC = { sourceName: 'Alem Cinema Facebook page', sourceUrl: 'https://www.facebook.com/alemcinema/', postedAt: new Date('2026-09-04T09:00:00Z') };
// [titleAm, title, notes, times, trailerUrl]
const ROWS = [
  ['አቧረው ጨሰ', 'Abuarew Chese', 'ኮሜዲ ቴአትር · comedy play · ዘወትር አርብ (every Friday) · Abel Media & Communication', ['18:00'], null],
  ['ሐምራዊት', 'Hamrawit', 'ፊልም · a film by Fuad Mustefa · Natay Getachew, Ayu Germa, Kidest Mulualem, Solomon Tesfaye', ['13:00', '15:00'], null],
  ['ፈረንጁ ሀበሻ', 'Ferenju Habesha', 'ፊልም · a film by Ermias Tadesse', ['14:00'], null],
  ['ሳላያት', 'Salayat', 'ፊልም · Salayat', ['16:10', '20:30'], null],
  ['ቀን ዘራፊ', 'Ken Zerafi', 'ፊልም · አክሽን · a film by Mulualem Getachew', ['17:10'], 'https://www.youtube.com/watch?v=VnGiiB155LU'],
  ['መቀነት', 'Mekenet', 'ፊልም · ቀሃ ፊልምስ', ['19:10'], null],
];
(async () => {
  const venue = await prisma.venue.findUnique({ where: { slug: VENUE } });
  if (!venue) throw new Error('venue ' + VENUE + ' missing');
  const dateFrom = new Date(DAY.from + 'T00:00:00+03:00'), dateTo = new Date(new Date(DAY.to + 'T00:00:00+03:00').getTime() + 86400000 - 1);
  const gone = await prisma.programme.updateMany({ where: { venueId: venue.id, dateFrom, active: true }, data: { active: false } });
  let n = 0;
  for (const [titleAm, title, notes, times, trailerUrl] of ROWS) {
    const id = trailerUrl ? (trailerUrl.match(/v=([A-Za-z0-9_-]{11})/) || [])[1] : null;
    await prisma.programme.create({ data: { venueId: venue.id, title, titleAm, notes, times, dateFrom, dateTo, trailerUrl, posterUrl: id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : null, ...SRC } }); n++;
  }
  console.log('Alem ' + DAY.from + ': replaced ' + gone.count + ', added ' + n);
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
