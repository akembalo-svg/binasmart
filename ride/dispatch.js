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

  return { start, cancel, toConcierge, sweepStale, setOffers };
}

module.exports = { makeDispatch };
