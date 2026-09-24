'use strict';
// Dispatch decides who is asked and who escalates.
//  - nobody offerable (no approved driver online, or none reachable in any radius) -> concierge now
//  - somebody offerable -> ride/offers.js runs the auction, and the concierge window becomes a
//    safety net: if no driver has accepted by then, a human takes over.
// Timers are injectable so tests run instantly. Timers live in memory, so sweepStale() (scheduled by
// index.js) escalates any ride a restart would otherwise strand in 'dispatching'.
// offers is injected late (setOffers) because ride/offers.js needs toConcierge and cancel from here.
function makeDispatch({ prisma, telegram, settings, offers, setTimeoutFn, clearTimeoutFn }) {
  const st = setTimeoutFn || setTimeout, ct = clearTimeoutFn || clearTimeout;
  const timers = new Map(); // rideId -> timer handle
  let auction = offers || null;
  function setOffers(o) { auction = o; }

  async function windowS() { const s = await settings.get(); return typeof s.conciergeAfterS === 'number' ? s.conciergeAfterS : 60; }

  async function toConcierge(rideId) {
    timers.delete(rideId);
    // concierge:false in the guard makes this a DB-level mutex: timer, sweep and retries can never double-alert.
    const res = await prisma.ride.updateMany({ where: { id: rideId, status: 'dispatching', concierge: false }, data: { concierge: true } });
    if (res.count === 0) return false; // already escalated, assigned or cancelled
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    const sent = await telegram.conciergeAlert(ride);
    if (!sent) console.error('[ride/dispatch] concierge alert FAILED for ride ' + rideId + ' — owner not notified');
    return true;
  }

  async function start(rideId) {
    cancel(rideId); // a repeated start must not orphan an earlier timer
    const after = await windowS();
    const online = await prisma.driver.count({ where: { status: 'approved', online: true } });
    if (online === 0 || after === 0) return toConcierge(rideId);
    // Broadcast to the nearest drivers. Nobody reachable in any radius -> escalate straight away
    // rather than making the rider wait out a window that cannot produce a driver.
    if (auction) {
      let asked = 0;
      try { asked = await auction.open(rideId, 1); }
      catch (e) { console.error('[ride/dispatch] auction failed for ride ' + rideId + ': ' + e.message); }
      if (asked === 0) return toConcierge(rideId);
    }
    const h = st(() => toConcierge(rideId).catch(e => console.error('[ride/dispatch] concierge escalation error:', e.message)), after * 1000);
    timers.set(rideId, h);
    return 'waiting';
  }

  function cancel(rideId) {
    const h = timers.get(rideId);
    if (h) { ct(h); timers.delete(rideId); }
  }

  async function sweepStale(now = Date.now()) {
    const after = await windowS();
    const stale = await prisma.ride.findMany({
      where: { status: 'dispatching', concierge: false, requestedAt: { lt: new Date(now - after * 1000) } },
      select: { id: true }, take: 50 });
    let n = 0;
    for (const r of stale) {
      try { if (await toConcierge(r.id)) n++; }
      catch (e) { console.error('[ride/dispatch] sweep failed for ride ' + r.id + ':', e.message); }
    }
    if (n) console.log('[ride/dispatch] sweep escalated ' + n + ' stale ride(s)');
    return n;
  }

  // A trip the driver walked away from. Found on 2026-09-19 with a real driver: he accepted a ride,
  // tapped "start trip", then closed the Mini App — which stops running the moment it leaves the screen.
  // Three and a half hours later the ride was still 'ontrip', the rider could not cancel it (the cancel
  // route refuses once a trip has started, which is right while somebody is actually in the car), and
  // the driver was still flagged busy, so he was excluded from every future offer. Nothing recovered it:
  // sweepStale only looks at rides stuck in 'dispatching'.
  //
  // The test is silence, not elapsed time: a live trip sends a fix every 4 seconds, so a ride whose
  // driver has reported within QUIET_MS is left alone however long it has been running — a crossing of
  // Addis in traffic is allowed to be slow. Freeing the driver is the urgent half; while onRideId is set
  // he receives nothing at all. The ride itself is left for a person to close, because only a person can
  // find out whether the passenger was actually carried and owes a fare.
  //
  // Idempotent without a new column: the alert fires only when this sweep is the one that freed the
  // driver (updateMany count > 0), so a ride already freed is passed over in silence.
  const QUIET_MS = 30 * 60 * 1000;
  const LIVE = ['assigned', 'arriving', 'arrived', 'ontrip'];

  async function sweepAbandoned(now = Date.now()) {
    const cutoff = new Date(now - QUIET_MS);
    const rides = await prisma.ride.findMany({
      where: { status: { in: LIVE }, driverId: { not: null },
        OR: [{ driver: { lastSeenAt: { lt: cutoff } } }, { driver: { lastSeenAt: null } }] },
      include: { driver: true }, take: 20 });
    let n = 0;
    for (const ride of rides) {
      try {
        const freed = await prisma.driver.updateMany({ where: { id: ride.driverId, onRideId: ride.id }, data: { onRideId: null } });
        if (freed.count === 0) continue;
        const seen = ride.driver && ride.driver.lastSeenAt;
        const quiet = seen ? Math.round((now - new Date(seen)) / 60000) + ' minutes' : 'the whole trip';
        const since = new Date(ride.startedAt || ride.assignedAt || ride.requestedAt).toISOString().slice(11, 16);
        await telegram.ownerNote('🟠 ABANDONED TRIP — still "' + ride.status + '" since ' + since + ' UTC'
          + '\nDriver ' + ((ride.driver && ride.driver.name) || '?') + ' has sent no location for ' + quiet + '.'
          + '\nRider: ' + ride.riderName + ' · ' + ride.riderPhone
          + '\nThe driver is free again and the rider can cancel. Close the ride in /ride-ops.').catch(() => {});
        n++;
      } catch (e) { console.error('[ride/dispatch] abandoned sweep failed for ride ' + ride.id + ':', e.message); }
    }
    if (n) console.log('[ride/dispatch] ' + n + ' abandoned trip(s): driver freed, owner told');
    return n;
  }

  // A request nobody could serve. With no driver online the rider saw "a dispatcher is assigning your
  // driver" with no end: 13 requests in three weeks to 2026-09-24, one completed, nine riders gave up
  // within five minutes and three requests sat in 'dispatching' for days. Now a request still unserved
  // after UNSERVED_MIN is closed as 'nodriver', the rider is told (riderNotify) and the owner gets one
  // line. Pool rides have their own sweep and are left alone. Nothing is charged: no driver ever had it.
  const UNSERVED_MIN = 10;
  const WAITING = ['requested', 'dispatching'];
  async function sweepUnserved(now = Date.now(), notify) {
    const rides = await prisma.ride.findMany({
      where: { status: { in: WAITING }, concierge: true, driverId: null, pool: { is: null },
        requestedAt: { lt: new Date(now - UNSERVED_MIN * 60000) } },
      select: { id: true, tier: true, fareEtb: true }, take: 50 });
    let n = 0;
    for (const r of rides) {
      try {
        const u = await prisma.ride.updateMany({ where: { id: r.id, status: { in: WAITING }, driverId: null },
          data: { status: 'cancelled', cancelledBy: 'nodriver', cancelledAt: new Date(now) } });
        if (!u.count) continue;                       // a driver or the rider got there first
        cancel(r.id);
        if (prisma.rideOffer) await prisma.rideOffer.updateMany({ where: { rideId: r.id, status: 'open' }, data: { status: 'expired', decidedAt: new Date(now) } });
        n++;
        if (notify) await Promise.resolve().then(() => notify(r.id)).catch(() => {});
        if (telegram.ownerNote) await telegram.ownerNote('⚪ No driver within ' + UNSERVED_MIN + ' min — request closed and the rider told ('
          + String(r.tier).toUpperCase() + ', ' + r.fareEtb + ' ETB).').catch(() => {});
      } catch (e) { console.error('[ride/dispatch] unserved sweep failed for ride ' + r.id + ':', e.message); }
    }
    if (n) console.log('[ride/dispatch] ' + n + ' unserved request(s) closed after ' + UNSERVED_MIN + ' min');
    return n;
  }

  return { start, cancel, toConcierge, sweepStale, sweepAbandoned, sweepUnserved, setOffers, QUIET_MS, UNSERVED_MIN };
}

module.exports = { makeDispatch };
