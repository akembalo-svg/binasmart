'use strict';
// Gast Cinema programme, read from the schedule photo the cinema posted on its own Telegram channel
// (t.me/gastcinema, "Gast Cinema Sep 03 - SEP 04 2026 Schedule", posted 2026-09-02). Re-run with a
// new WEEK block when they post the next one; old entries expire by date on their own.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SRC = { sourceName: 'Gast Cinema Telegram channel', sourceUrl: 'https://t.me/gastcinema', postedAt: new Date('2026-09-02T19:06:00Z') };
const WEEK = { from: '2026-09-03', to: '2026-09-04' };
// [title, notes, hall, times]
const ROWS = [
  ['Spider-Man: Brand New Day', 'Action, Adventure, Sci-Fi · 2h25m · PG', 'Cinema 2 2D', ['13:00', '16:00', '19:00']],
  ['Spider-Man: Brand New Day', 'Action, Adventure, Sci-Fi · 2h25m · PG', 'Gold 3 2D', ['12:00', '15:00', '18:00', '21:00']],
  ['The Dog Stars', 'Action, Adventure, Thriller · 1h58m · R', 'Gold 2 2D', ['16:00', '18:30', '21:00']],
  ['Mutiny', 'Action, Crime, Thriller · 1h33m · R', 'Gold 2 2D', ['12:00', '14:00']],
  ['Mutiny', 'Action, Crime, Thriller · 1h33m · R', 'Gold 4 2D', ['19:00']],
  ['Mutiny', 'Action, Crime, Thriller · 1h33m · R', 'Gold 1 2D', ['21:00']],
  ['Insidious: Out of Further', 'Horror, Thriller, Mystery · 1h44m · PG-13', 'Gold 4 2D', ['12:00', '14:15', '16:30', '18:00']],
  ['Minions & Monster', 'Adventure, Animation, Comedy · 1h38m · PG', 'Gold 1 2D', ['12:00', '14:00', '16:00', '18:00']],
];
(async () => {
  const venue = await prisma.venue.findUnique({ where: { slug: 'gast-cinema' } });
  if (!venue) throw new Error('venue gast-cinema missing (run seed-addis-cinemas.js)');
  // Phone and address exactly as printed on the cinema's own schedule.
  await prisma.venue.update({ where: { id: venue.id }, data: { phone: '+251930113377', address: 'Gast Entertainment Mall, CMC, near St. Michael Church, Bole' } });
  const dateFrom = new Date(WEEK.from + 'T00:00:00+03:00'), dateTo = new Date(new Date(WEEK.to + 'T00:00:00+03:00').getTime() + 86400000 - 1);
  const gone = await prisma.programme.updateMany({ where: { venueId: venue.id, dateFrom, active: true }, data: { active: false } });
  let n = 0;
  for (const [title, notes, hallName, times] of ROWS) { await prisma.programme.create({ data: { venueId: venue.id, title, notes, hallName, times, dateFrom, dateTo, ...SRC } }); n++; }
  console.log('Gast ' + WEEK.from + '..' + WEEK.to + ': replaced ' + gone.count + ', added ' + n + ' entries');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
