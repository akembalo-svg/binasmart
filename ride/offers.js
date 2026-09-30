'use strict';
// The auction. A ride is broadcast to the nearest three eligible drivers at once and the first to
// accept wins through a DB-level compare-and-swap: the ride row is only updated while it is still
// unassigned, so two simultaneous taps can never both win — even across processes.
// No acceptance inside the window -> widen the radius -> the concierge fallback (dispatch.toConcierge),
// which is never removed. This module never escalates on its own except when every radius is
// exhausted; dispatch.start() owns the first escalation.
const { haversineM } = require('./geo');
const { offerSmsText } = require('./offerLink');

const MAX_PER_ROUND = 3;
// A driver whose app went quiet (weak signal: the server calls them away after 45 s) but whose last
// good fix is this recent can still be offered a ride through Telegram, which often gets through when
// the app cannot — or, for a driver with no Telegram, by SMS with a bina.et/o/ link (ride/offerLink.js),
// which arrives with no mobile data at all. They only fill places no fully connected driver takes.
const WEAK_SIGNAL_S = 300;
// An SMS can take a while to arrive, so an offer sent by SMS stays open this long. The ride does not
// wait for it: at the normal window it is offered further out as usual, and whoever accepts first wins.
// Which offers went by SMS is kept in memory; after a restart they simply close at the normal window.
const SMS_WINDOW_S = 90;
const WEAK_NOTE = '📶 Your app has lost signal — tap Accept here. · መተግበሪያው ምልክት አጥቷል፤ እዚህ ይቀበሉ።';

// sms: { send(phone, text) -> 'sent' | 'test' | 'failed' } and links: makeOfferLink(); both optional.
function makeOffers({ prisma, geo, settings, api, concierge, cancelTimer, riderNotify, baseUrl, now, sms, links }) {
  const bySms = !!(sms && links);
  const smsOffers = new Set();   // offer ids sent by SMS and still open
  const widened = new Set();     // SMS offers past the normal window whose ride was already offered further out
  function windowFor(offerId, baseS) {
    const b = baseS || 25;
    return smsOffers.has(offerId) ? Math.max(SMS_WINDOW_S, b) : b;
  }
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

  // Approved, online, not already on a ride, right tier, inside the radius, not already asked.
  // Connected drivers first; weak-signal drivers (see WEAK_SIGNAL_S) are returned marked `weak`.
  async function eligible(ride, radiusKm) {
    const base = { status: 'approved', online: true, onRideId: null, tier: ride.tier };
    const drivers = await prisma.driver.findMany({ where: { ...base, away: false } });
    const weakWhere = { ...base, away: true, lastSeenAt: { gte: new Date(clock() - WEAK_SIGNAL_S * 1000) } };
    if (!bySms) weakWhere.telegramId = { not: null };
    const weak = (api || bySms) ? await prisma.driver.findMany({ where: weakWhere }) : [];
    const asked = await prisma.rideOffer.findMany({ where: { rideId: ride.id }, select: { driverId: true } });
    const seen = new Set(asked.map(o => o.driverId));
    const near = d => d.lat != null && d.lng != null && !seen.has(d.id) &&
      haversineM({ lat: d.lat, lng: d.lng }, ride.pickup) <= radiusKm * 1000;
    const live = drivers.filter(near);
    const liveIds = new Set(live.map(d => d.id));
    const reachable = d => (d.telegramId && api) || (!d.telegramId && bySms && d.phone);
    return live.concat(weak.filter(d => near(d) && reachable(d) && !liveIds.has(d.id)).map(d => ({ ...d, weak: true })));
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

    // Every connected driver outranks every weak-signal one, whatever the distance.
    const ranked = (await rank(ride, cands.filter(d => !d.weak)))
      .concat(await rank(ride, cands.filter(d => d.weak))).slice(0, MAX_PER_ROUND);
    await prisma.rideOffer.createMany({
      data: ranked.map(x => ({ rideId: ride.id, driverId: x.d.id, etaS: x.etaS, distanceM: x.distanceM, round: r })),
    });
    // Weak-signal drivers without Telegram get an SMS carrying their own offer's link.
    const bySmsNow = bySms ? ranked.filter(x => x.d.weak && !x.d.telegramId && x.d.phone) : [];
    if (bySmsNow.length) {
      const made = await prisma.rideOffer.findMany({ where: { rideId: ride.id, status: 'open' } });
      for (const x of bySmsNow) {
        const o = made.find(m => m.driverId === x.d.id);
        if (!o) continue;
        try {
          const st = await sms.send(x.d.phone, offerSmsText(ride, x.etaS, links.url(o.id)));
          if (st === 'sent' || st === 'test') smsOffers.add(o.id);
          else console.error('[ride/offers] offer SMS ' + st + ' for driver ' + x.d.id);
        } catch (e) { console.error('[ride/offers] offer SMS failed for driver ' + x.d.id + ': ' + e.message); }
      }
    }
    for (const x of ranked) {
      if (!x.d.telegramId || !api) continue;
      try {
        await api.sendMessage(String(x.d.telegramId), card(ride, x.etaS, x.distanceM) + (x.d.weak ? '\n\n' + WEAK_NOTE : ''), {
          reply_markup: { inline_keyboard: [
            [{ text: '✅ Accept · ተቀበል', callback_data: 'acc:' + ride.id },
             { text: '❌ Skip · አትቀበል', callback_data: 'dec:' + ride.id }],
            [{ text: '🚗 Open the driver app', web_app: { url: (baseUrl || 'https://bina.et') + '/drive' } }],
          ] },
        });
      } catch (e) { console.error('[ride/offers] offer push failed for driver ' + x.d.id + ': ' + e.message); }
    }
    const weakN = ranked.filter(x => x.d.weak).length;
    console.log('[ride/offers] ride ' + ride.id + ' offered to ' + ranked.length + ' driver(s)' + (weakN ? ' (' + weakN + ' weak signal: Telegram or SMS only)' : '') + ', round ' + r + ' (' + radii[r - 1] + ' km)');
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
    const baseS = s.offerWindowS || 25, t = clock();
    const cut = new Date(t - baseS * 1000), smsCut = t - Math.max(SMS_WINDOW_S, baseS) * 1000;
    const stale = await prisma.rideOffer.findMany({ where: { status: 'open', createdAt: { lt: cut } } });
    if (!stale.length) return 0;
    const lastRound = new Map(), close = [];
    for (const o of stale) {
      const bySmsOffer = smsOffers.has(o.id);
      const due = !bySmsOffer || new Date(o.createdAt).getTime() < smsCut;
      // Widen once when an offer passes the normal window, and once more when an SMS offer finally closes.
      const trigger = due || !widened.has(o.id);
      if (due) { close.push(o.id); smsOffers.delete(o.id); widened.delete(o.id); } else widened.add(o.id);
      if (trigger) lastRound.set(o.rideId, Math.max(lastRound.get(o.rideId) || 1, o.round || 1));
    }
    if (close.length) await prisma.rideOffer.updateMany({ where: { id: { in: close }, status: 'open' }, data: { status: 'expired', decidedAt: new Date(t) } });
    let again = 0;
    for (const [rideId, round] of lastRound) {
      try {
        const n = await open(rideId, round + 1);
        if (n) { again++; continue; }
        if (!concierge) continue;
        // Every radius exhausted — hand it to a human, unless an SMS driver can still answer.
        const waiting = await prisma.rideOffer.findMany({ where: { rideId, status: 'open' } });
        if (!waiting.length) await concierge(rideId);
      } catch (e) { console.error('[ride/offers] re-dispatch failed for ride ' + rideId + ': ' + e.message); }
    }
    if (again) console.log('[ride/offers] re-dispatched ' + again + ' ride(s) after expiry');
    return again;
  }

  return { open, accept, decline, expire, windowFor, MAX_PER_ROUND, WEAK_SIGNAL_S, SMS_WINDOW_S };
}

module.exports = { makeOffers, MAX_PER_ROUND };
