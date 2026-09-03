'use strict';
// The auction. A ride is broadcast to the nearest three eligible drivers at once and the first to
// accept wins through a DB-level compare-and-swap: the ride row is only updated while it is still
// unassigned, so two simultaneous taps can never both win — even across processes.
// No acceptance inside the window -> widen the radius -> the concierge fallback (dispatch.toConcierge),
// which is never removed. This module never escalates on its own except when every radius is
// exhausted; dispatch.start() owns the first escalation.
const { haversineM } = require('./geo');

const MAX_PER_ROUND = 3;

function makeOffers({ prisma, geo, settings, api, concierge, cancelTimer, riderNotify, baseUrl, now }) {
  const clock = now || Date.now;

  function card(ride, etaS, distanceM) {
    const mins = Math.max(1, Math.round((etaS || 0) / 60));
    const km = m => Math.round((m || 0) / 100) / 10;
    return [
      '🚕 NEW RIDE · ' + String(ride.tier).toUpperCase(),
      '',
      '📍 Pickup: ' + ((ride.pickup && ride.pickup.label) || '—'),
      '   ' + km(distanceM) + ' km away · ~' + mins + ' min to reach',
      '🏁 Drop-off: ' + ((ride.dropoff && ride.dropoff.label) || '—'),
      '🛣 Trip: ' + km(ride.distanceM) + ' km · ~' + Math.round(ride.durationS / 60) + ' min',
      '💰 You earn ' + ride.driverTakeEtb + ' ETB' + (ride.driverTakeEtb === ride.fareEtb ? ' (0% commission)' : ' of ' + ride.fareEtb + ' ETB'),
      '',
      'First to accept gets it · ቀድሞ የተቀበለ ያገኛል',
    ].join('\n');
  }

  // Approved, online, not away, not already on a ride, right tier, inside the radius, not already asked.
  async function eligible(ride, radiusKm) {
    const drivers = await prisma.driver.findMany({
      where: { status: 'approved', online: true, away: false, onRideId: null, tier: ride.tier },
    });
    const asked = await prisma.rideOffer.findMany({ where: { rideId: ride.id }, select: { driverId: true } });
    const seen = new Set(asked.map(o => o.driverId));
    return drivers.filter(d =>
      d.lat != null && d.lng != null && !seen.has(d.id) &&
      haversineM({ lat: d.lat, lng: d.lng }, ride.pickup) <= radiusKm * 1000);
  }

  // Rank by real driving ETA to the pickup, not straight-line distance. A routing failure falls back
  // to crow-flies x1.3 at 20 km/h so one bad GraphHopper call cannot stall the whole auction.
  async function rank(ride, drivers) {
    const withEta = await Promise.all(drivers.map(async d => {
      const from = { lat: d.lat, lng: d.lng };
      try {
        const r = await geo.route(from, ride.pickup);
        return { d, etaS: r.durationS, distanceM: r.distanceM };
      } catch (e) {
        const m = haversineM(from, ride.pickup) * 1.3;
        return { d, etaS: Math.round(m / 5.5), distanceM: Math.round(m) };
      }
    }));
    return withEta.sort((a, b) => a.etaS - b.etaS);
  }

  // round 1 -> radiiKm[0], 2 -> radiiKm[1], ... Returns how many drivers were asked (0 = nobody left).
  // A round with no candidates widens immediately: there is nothing to wait for.
  async function open(rideId, round) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.driverId || !['requested', 'dispatching'].includes(ride.status)) return 0;
    const s = await settings.get();
    const radii = (Array.isArray(s.radiiKm) && s.radiiKm.length) ? s.radiiKm : [3, 6, 10];
    let r = Math.max(1, Math.round(round || 1));
    if (r > radii.length) return 0;

    let cands = await eligible(ride, radii[r - 1]);
    while (!cands.length && r < radii.length) { r++; cands = await eligible(ride, radii[r - 1]); }
    if (!cands.length) return 0;

    const ranked = (await rank(ride, cands)).slice(0, MAX_PER_ROUND);
    await prisma.rideOffer.createMany({
      data: ranked.map(x => ({ rideId: ride.id, driverId: x.d.id, etaS: x.etaS, distanceM: x.distanceM, round: r })),
    });
    for (const x of ranked) {
      if (!x.d.telegramId || !api) continue;
      try {
        await api.sendMessage(String(x.d.telegramId), card(ride, x.etaS, x.distanceM), {
          reply_markup: { inline_keyboard: [
            [{ text: '✅ Accept · ተቀበል', callback_data: 'acc:' + ride.id },
             { text: '❌ Skip · አትቀበል', callback_data: 'dec:' + ride.id }],
            [{ text: '🚗 Open the driver app', web_app: { url: (baseUrl || 'https://bina.et') + '/drive' } }],
          ] },
        });
      } catch (e) { console.error('[ride/offers] offer push failed for driver ' + x.d.id + ': ' + e.message); }
    }
    console.log('[ride/offers] ride ' + ride.id + ' offered to ' + ranked.length + ' driver(s), round ' + r + ' (' + radii[r - 1] + ' km)');
    return ranked.length;
  }

  async function accept(rideId, driverId) {
    const offer = await prisma.rideOffer.findFirst({ where: { rideId, driverId, status: 'open' } });
    if (!offer) {
      // Losing the race closes this driver's offer, so a tap a moment too late finds nothing open.
      // "no_offer" would read like a fault; the driver deserves to know somebody simply beat them.
      const prior = await prisma.rideOffer.findFirst({ where: { rideId, driverId } });
      if (!prior || prior.status === 'declined') return { ok: false, error: 'no_offer' };
      if (prior.status === 'expired') return { ok: false, error: 'expired' };
      if (prior.status === 'accepted') return { ok: false, error: 'already_yours' };
      return { ok: false, error: 'taken' };
    }
    const drv = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!drv || drv.status !== 'approved') return { ok: false, error: 'not_approved' };
    if (drv.onRideId) return { ok: false, error: 'busy' };
    const at = new Date(clock());
    // THE MUTEX: matches zero rows the moment anybody else has taken the ride.
    const won = await prisma.ride.updateMany({
      where: { id: rideId, status: { in: ['requested', 'dispatching'] }, driverId: null },
      data: { driverId, status: 'assigned', assignedAt: at, driverAcceptedAt: at },
    });
    if (won.count === 0) {
      await prisma.rideOffer.updateMany({ where: { id: offer.id, status: 'open' }, data: { status: 'lost', decidedAt: at } });
      return { ok: false, error: 'taken' };
    }
    await prisma.driver.updateMany({ where: { id: driverId, onRideId: null }, data: { onRideId: rideId } });
    await prisma.rideOffer.updateMany({ where: { id: offer.id }, data: { status: 'accepted', decidedAt: at } });
    await prisma.rideOffer.updateMany({ where: { rideId, status: 'open', NOT: { driverId } }, data: { status: 'lost', decidedAt: at } });
    if (cancelTimer) { try { cancelTimer(rideId); } catch (e) { /* timer already gone */ } }
    if (riderNotify) riderNotify.notify(rideId, 'assigned').catch(e => console.error('[ride/offers] rider notify failed: ' + e.message));
    console.log('[ride/offers] ride ' + rideId + ' accepted by driver ' + driverId);
    return { ok: true, rideId, driverId };
  }

  async function decline(rideId, driverId) {
    const n = await prisma.rideOffer.updateMany({
      where: { rideId, driverId, status: 'open' }, data: { status: 'declined', decidedAt: new Date(clock()) },
    });
    return n.count ? { ok: true } : { ok: false, error: 'no_offer' };
  }

  // Scheduled by index.js. Expiry is measured from createdAt, so a restart can never strand an offer.
  async function expire() {
    const s = await settings.get();
    const cut = new Date(clock() - (s.offerWindowS || 25) * 1000);
    const stale = await prisma.rideOffer.findMany({ where: { status: 'open', createdAt: { lt: cut } } });
    if (!stale.length) return 0;
    const lastRound = new Map();
    for (const o of stale) lastRound.set(o.rideId, Math.max(lastRound.get(o.rideId) || 1, o.round || 1));
    await prisma.rideOffer.updateMany({ where: { status: 'open', createdAt: { lt: cut } }, data: { status: 'expired', decidedAt: new Date(clock()) } });
    let again = 0;
    for (const [rideId, round] of lastRound) {
      try {
        const n = await open(rideId, round + 1);
        if (n) again++;
        else if (concierge) await concierge(rideId); // every radius exhausted — hand it to a human
      } catch (e) { console.error('[ride/offers] re-dispatch failed for ride ' + rideId + ': ' + e.message); }
    }
    if (again) console.log('[ride/offers] re-dispatched ' + again + ' ride(s) after expiry');
    return again;
  }

  return { open, accept, decline, expire, MAX_PER_ROUND };
}

module.exports = { makeOffers, MAX_PER_ROUND };
