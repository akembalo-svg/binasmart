'use strict';
// Creates (or removes) a throwaway demo venue/hall/event/show so the pages can be looked at before
// the first real venue exists. Everything it makes carries the slug prefix "demo-cinema" and is
// removed by `node ops/cinema/demo.js --clean` (tickets and holds included).
//   node ops/cinema/demo.js            -> prints the show URL
//   node ops/cinema/demo.js --clean    -> deletes every demo row, prints counts
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SLUG = 'demo-cinema';
const LAYOUT = { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], seatsPerRow: 14, aisles: [4, 10], blocked: ['A1', 'A14'], wheelchair: ['H1', 'H14'],
  sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', rows: ['A', 'B'] }, { name: 'Regular', nameAm: 'መደበኛ', rows: ['C', 'D', 'E', 'F', 'G', 'H'] }] };

async function clean() {
  const venues = await prisma.venue.findMany({ where: { slug: { startsWith: SLUG } }, include: { halls: true } });
  const hallIds = venues.flatMap(v => v.halls.map(h => h.id));
  const shows = await prisma.show.findMany({ where: { hallId: { in: hallIds } } });
  const showIds = shows.map(s => s.id);
  const out = {};
  out.holds = (await prisma.seatHold.deleteMany({ where: { showId: { in: showIds } } })).count;
  out.tickets = (await prisma.ticket.deleteMany({ where: { showId: { in: showIds } } })).count;
  out.shows = (await prisma.show.deleteMany({ where: { id: { in: showIds } } })).count;
  out.halls = (await prisma.hall.deleteMany({ where: { id: { in: hallIds } } })).count;
  out.events = (await prisma.event.deleteMany({ where: { slug: { startsWith: SLUG } } })).count;
  out.venues = (await prisma.venue.deleteMany({ where: { id: { in: venues.map(v => v.id) } } })).count;
  return out;
}

async function create() {
  const venue = await prisma.venue.create({ data: { slug: SLUG + '-' + Date.now().toString(36), name: 'Demo Cinema (test)', nameAm: 'ማሳያ ሲኒማ (ሙከራ)', address: 'Bole, Addis Ababa', phone: '+251911000000', lat: 8.99, lng: 38.79 } });
  const cap = LAYOUT.rows.length * LAYOUT.seatsPerRow - LAYOUT.blocked.length;
  const hall = await prisma.hall.create({ data: { venueId: venue.id, name: 'Hall 1', layout: LAYOUT, capacity: cap } });
  const event = await prisma.event.create({ data: { slug: SLUG + '-film-' + Date.now().toString(36), title: 'Demo Film (test)', titleAm: 'ማሳያ ፊልም (ሙከራ)', type: 'CINEMA', kind: 'FILM', venue: venue.name, descr: 'Test screening for the seat-booking demo.', emoji: '🎬',
    runtimeMin: 110, rating: 'PG-13', language: 'Amharic', startsAt: new Date(Date.now() + 3 * 3600000), durationMin: 110, tiers: {} } });
  const show = await prisma.show.create({ data: { eventId: event.id, hallId: hall.id, startsAt: new Date(Date.now() + 3 * 3600000), prices: { VIP: 500, Regular: 300 }, counterCutoffMin: 30, status: 'onsale' } });
  const show2 = await prisma.show.create({ data: { eventId: event.id, hallId: hall.id, startsAt: new Date(Date.now() + 27 * 3600000), prices: { VIP: 500, Regular: 300 }, counterCutoffMin: 30, status: 'onsale' } });
  // A general-admission concert so the Events group and the tier picker can be seen.
  const gaHall = await prisma.hall.create({ data: { venueId: venue.id, name: 'Main Hall', layout: { kind: 'ga', sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', capacity: 20 }, { name: 'Regular', nameAm: 'መደበኛ', capacity: 100 }] }, capacity: 120 } });
  const concert = await prisma.event.create({ data: { slug: SLUG + '-concert-' + Date.now().toString(36), title: 'Demo Concert (test)', titleAm: 'ማሳያ ኮንሰርት (ሙከራ)', type: 'CINEMA', kind: 'CONCERT', venue: venue.name, descr: 'Test concert for the general-admission demo.', emoji: '🎤',
    startsAt: new Date(Date.now() + 30 * 3600000), durationMin: 180, tiers: {} } });
  const show3 = await prisma.show.create({ data: { eventId: concert.id, hallId: gaHall.id, startsAt: new Date(Date.now() + 30 * 3600000), prices: { VIP: 800, Regular: 300 }, counterCutoffMin: 60, status: 'onsale' } });
  return { show, show2, show3 };
}

(async () => {
  try {
    if (process.argv.includes('--clean')) { console.log('cleaned', JSON.stringify(await clean())); }
    else { const { show, show2, show3 } = await create(); console.log('demo show: https://bina.et/cinema/' + show.id); console.log('second:    https://bina.et/cinema/' + show2.id); console.log('concert:   https://bina.et/cinema/' + show3.id); }
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error(e.message); process.exit(1); });
