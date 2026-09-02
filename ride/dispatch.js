'use strict';
// Phase 1 dispatch. There is no driver app yet, so:
//  - no approved driver online  -> concierge immediately (Telegram to owner)
//  - some drivers online        -> wait the concierge window (Phase 2 will offer rides in between), then concierge
// Timers are injectable so tests run instantly.
function makeDispatch({ prisma, telegram, settings, setTimeoutFn, clearTimeoutFn }) {
  const st = setTimeoutFn || setTimeout, ct = clearTimeoutFn || clearTimeout;
  const timers = new Map(); // rideId -> timer handle

  async function toConcierge(rideId) {
    timers.delete(rideId);
    const res = await prisma.ride.updateMany({ where: { id: rideId, status: 'dispatching' }, data: { concierge: true } });
    if (res.count === 0) return false; // already assigned or cancelled
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    const sent = await telegram.conciergeAlert(ride);
    if (!sent) console.error('[ride/dispatch] concierge alert FAILED for ride ' + rideId + ' — owner not notified');
    return true;
  }

  async function start(rideId) {
    const s = await settings.get();
    const online = await prisma.driver.count({ where: { status: 'approved', online: true } });
    if (online === 0) return toConcierge(rideId);
    const h = st(() => toConcierge(rideId).catch(e => console.error('[ride/dispatch] concierge escalation error:', e.message)), (s.conciergeAfterS || 60) * 1000);
    timers.set(rideId, h);
    return 'waiting';
  }

  function cancel(rideId) {
    const h = timers.get(rideId);
    if (h) { ct(h); timers.delete(rideId); }
  }

  return { start, cancel, toConcierge };
}

module.exports = { makeDispatch };
