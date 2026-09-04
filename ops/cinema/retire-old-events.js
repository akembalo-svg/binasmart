'use strict';
// Removes the pre-cinema demo Events (those with no Show) and their EventTickets. Prints what it removed.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const old = await prisma.event.findMany({ where: { shows: { none: {} } }, select: { id: true, title: true, slug: true } });
  const tickets = await prisma.eventTicket.deleteMany({ where: { eventId: { in: old.map(e => e.id) } } });
  const events = await prisma.event.deleteMany({ where: { id: { in: old.map(e => e.id) } } });
  console.log('removed', events.count, 'old events,', tickets.count, 'old tickets:', old.map(e => e.slug).join(', ') || '—');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
