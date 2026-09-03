'use strict';
// Whether a driver is busy, and what they have earned today, is decided in TWO places: the driver app
// (ride/driverApi.js) and the owner's ops panel (ride/routes.js). They drifted — ops could complete a
// ride without freeing the driver or paying them, and a rider cancelling left a driver marked busy
// forever, silently cut off from every future offer. One module now owns it, so they cannot diverge.
const ADDIS_TZ_OFFSET_MS = 3 * 3600 * 1000; // UTC+3, no DST: the earnings day rolls at Addis midnight

function addisDay(ms) {
  return new Date(Math.floor((ms + ADDIS_TZ_OFFSET_MS) / 86400000) * 86400000 - ADDIS_TZ_OFFSET_MS);
}
function sameAddisDay(driver, ms) {
  return !!(driver && driver.earningsDay && new Date(driver.earningsDay).getTime() === addisDay(ms).getTime());
}

// Marks a driver busy, but only if they are free. Returns false when somebody else already has them,
// which is what stops the ops panel from double-booking a driver the auction just assigned.
async function claim(prisma, driverId, rideId) {
  if (!driverId || !rideId) return false;
  const r = await prisma.driver.updateMany({ where: { id: driverId, onRideId: null }, data: { onRideId: rideId } });
  return r.count > 0;
}

// Frees a driver from ONE ride. Guarded by rideId so a late cancellation of an old ride can never
// free a driver who has since started a new one.
async function release(prisma, driverId, rideId) {
  if (!driverId) return false;
  const where = rideId ? { id: driverId, onRideId: rideId } : { id: driverId };
  const r = await prisma.driver.updateMany({ where, data: { onRideId: null } });
  return r.count > 0;
}

// Completion: free the driver, count the trip, bank the fare into today's earnings.
async function complete(prisma, driver, ride, nowMs) {
  const ms = nowMs || Date.now();
  const carry = sameAddisDay(driver, ms) ? (driver.earningsTodayEtb || 0) : 0;
  await prisma.driver.update({
    where: { id: driver.id },
    data: {
      onRideId: null,
      ridesCount: { increment: 1 },
      earningsTodayEtb: carry + (ride.driverTakeEtb || 0),
      earningsDay: addisDay(ms),
    },
  });
  return carry + (ride.driverTakeEtb || 0);
}

module.exports = { claim, release, complete, addisDay, sameAddisDay };
