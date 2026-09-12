'use strict';
// What the ops driver list publishes about a person.
//
// /api/ride/ops/drivers used to return prisma.driver.findMany({}) — the whole row. It is behind the
// owner key, so nothing was public, but the ops page reads about a dozen fields and was being handed
// every driver's live position and daily earnings besides. That is the same `return { rows }` shape
// that leaked tenants' phone numbers on five public routes elsewhere, and the next column added to
// Driver would have joined it without anyone deciding.
//
// The line: identity, vehicle, and whether they can take a ride — which is what a dispatcher's list
// is for. Not a driver's precise position, and not their money. Someone who needs to see where
// drivers are looks at the queue and the map, not a list of names.
//
// Named rather than spread, on purpose. A field appears here because someone put it here.
const OPS_DRIVER_FIELDS = [
  'id', 'name', 'phone', 'telegramId',
  'tier', 'plate', 'vehicleMake', 'vehicleColour', 'photo',
  'licenceUrl', 'carPhotoUrl', 'registrationUrl',
  'status', 'online', 'away', 'onRideId', 'lastSeenAt',
  'rating', 'ridesCount', 'createdAt',
];

// Deliberately absent, and why — kept beside the list so the reason survives the next edit.
//   lat, lng, bearing, speedKph                     a driver's precise position
//   commissionPct, earningsTodayEtb, earningsDay    their money
//   authUserId                                      an internal join key
const OPS_DRIVER_WITHHELD = [
  'lat', 'lng', 'bearing', 'speedKph',
  'commissionPct', 'earningsTodayEtb', 'earningsDay',
  'authUserId',
];

function pubOpsDriver(d) {
  if (!d) return null;
  const out = {};
  for (const k of OPS_DRIVER_FIELDS) out[k] = d[k];
  return out;
}

module.exports = { pubOpsDriver, OPS_DRIVER_FIELDS, OPS_DRIVER_WITHHELD };
