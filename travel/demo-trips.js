'use strict';
// Keep the demonstration bus timetable in the future.
//
// /travel had been serving "No trips found" since 21 August. The 18 sample trips are six routes on
// three consecutive days, and once those three days passed the page had nothing on it — a demo that
// stops demonstrating, unlike the demo hotel and hospital whose data is not time-bound.
//
// Rolling them forward by hand would buy three days, so this runs daily instead. It shifts every
// demo trip by a WHOLE number of days, which preserves the departure time of day and the spacing
// between routes exactly: the 05:00 Addis bus to Gondar stays the 05:00 bus to Gondar.
//
// Scoped to buildings that announce themselves as demonstrations. A real operator's timetable is
// never touched, and the day a real one loads trips this quietly does nothing to them.
const DAY = 86400000;

// `now` is injectable so the behaviour can be tested without waiting for tomorrow.
async function rollDemoTrips(prisma, isDemo, now = () => Date.now()) {
  const t0 = now();
  const buildings = await prisma.building.findMany({ select: { id: true, qrSlug: true, name: true, subCity: true } });
  const demoIds = buildings.filter(isDemo).map(b => b.id);
  if (!demoIds.length) return { moved: 0, days: 0, reason: 'no demo buildings' };

  const trips = await prisma.travelTrip.findMany({ where: { buildingId: { in: demoIds } },
    select: { id: true, departure: true } });
  if (!trips.length) return { moved: 0, days: 0, reason: 'no demo trips' };

  const earliest = Math.min(...trips.map(t => t.departure.getTime()));
  // Already ahead of us: leave it alone. Running twice in a day must not push the timetable away.
  if (earliest > t0) return { moved: 0, days: 0, reason: 'earliest trip is still in the future' };

  // Whole days. floor + 1 rather than ceil: when the gap is an exact multiple of a day, ceil would
  // land the earliest departure exactly on now, and the listing filters on departure > now, so the
  // trip would vanish the moment it was rescued. Everywhere else the two agree.
  const days = Math.floor((t0 - earliest) / DAY) + 1;
  for (const t of trips)
    await prisma.travelTrip.update({ where: { id: t.id },
      data: { departure: new Date(t.departure.getTime() + days * DAY) } });

  return { moved: trips.length, days, reason: null };
}

module.exports = { rollDemoTrips, DAY };
