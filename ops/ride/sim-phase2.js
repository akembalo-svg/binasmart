#!/usr/bin/env node
'use strict';
/*
 * Phase 2 end-to-end proof, run against the LIVE database with every outbound channel stubbed.
 *
 *   node ops/ride/sim-phase2.js
 *
 * It creates three clearly-marked rows (rider, two drivers, one ride), drives the whole loop through
 * the real modules and the real router, prints what happened, and deletes everything it made — even
 * when it fails. Nothing is sent to Telegram: the api, telegram and riderNotify objects are stubs
 * that only count calls, so a real driver or rider is never messaged by a test.
 *
 * Guard rails:
 *   - every row it creates carries the SIM marker in its phone number
 *   - it refuses to touch any row it did not create
 *   - cleanup runs in a finally block and reports what it deleted
 */
const { PrismaClient } = require('@prisma/client');
const { makeSettings } = require('../../ride/settings');
const { makeGeo } = require('../../ride/geo');
const { makeOffers } = require('../../ride/offers');
const { makeLocation } = require('../../ride/location');
const { makeDriverApi } = require('../../ride/driverApi');
const { makeDispatch } = require('../../ride/dispatch');
const tgauth = require('../../ride/tgauth');

const SIM = '+2519000000';               // sim phones are +2519000000XX — no real Ethiopian number matches
const BOT = 'SIM-DRIVER-BOT-TOKEN-not-a-real-token';
const PICKUP = { lat: 9.0108, lng: 38.7578, label: 'SIM Pickup · Edna Mall' };
const DROP = { lat: 9.0356, lng: 38.7468, label: 'SIM Drop · Piassa' };

const prisma = new PrismaClient();
const sent = [], owner = [], riderPings = [];
const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; } };
const telegram = { conciergeAlert: async r => { owner.push('concierge:' + r.id); return true; }, ownerNote: async t => { owner.push(t); return true; } };
const riderNotify = { notify: async (id, ev) => { riderPings.push(ev); return true; } };

let ok = 0, bad = 0;
function check(label, cond, detail) {
  if (cond) { ok++; console.log('  ✓ ' + label); }
  else { bad++; console.log('  ✗ ' + label + (detail ? '  <- ' + detail : '')); }
}
function initData(tgId) {
  return tgauth.sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: tgId, first_name: 'Sim' } }, BOT);
}
const reply = () => { const r = { statusCode: 200, body: null }; r.code = c => { r.statusCode = c; return r; }; r.send = b => { r.body = b; return r; }; return r; };
const req = (tgId, body, params) => ({ body: Object.assign({ initData: initData(tgId) }, body || {}), query: {}, params: params || {} });

async function main() {
  const settings = makeSettings(prisma);
  const geo = makeGeo({ routerUrl: process.env.ROUTER_URL || 'http://127.0.0.1:8989', prisma });
  // The sim fires fixes back-to-back, which a real phone never does. Without an advancing clock the
  // teleport guard correctly rejects them as 65 m in one second, so the sim owns the clock.
  const simClock = { t: Date.now() };
  const location = makeLocation({ prisma, api, now: () => simClock.t });
  const dispatch = makeDispatch({ prisma, telegram, settings });
  const offers = makeOffers({ prisma, geo, settings, api, riderNotify,
    concierge: id => dispatch.toConcierge(id), cancelTimer: id => dispatch.cancel(id), baseUrl: 'https://bina.et' });
  dispatch.setOffers(offers);
  const drive = makeDriverApi({ prisma, driverBotToken: BOT, location, offers, telegram, riderNotify, geo });

  const s = await settings.get();
  console.log('settings: offerWindow ' + s.offerWindowS + 's · radii ' + s.radiiKm.join('/') + ' km · commission ' + s.commissionPct + '%\n');

  // ---------- fixtures ----------
  const rider = await prisma.rider.create({ data: { name: 'SIM Rider', phone: SIM + '01' } });
  const near = await prisma.driver.create({ data: { name: 'SIM Near', phone: SIM + '02', telegramId: '990001', tier: 'economy',
    plate: 'SIM 001', status: 'approved', online: true, lat: 9.0116, lng: 38.7601, carPhotoUrl: '/api/ride/car/sim.jpg', vehicleMake: 'Vitz', vehicleColour: 'Blue' } });
  const far = await prisma.driver.create({ data: { name: 'SIM Far', phone: SIM + '03', telegramId: '990002', tier: 'economy',
    plate: 'SIM 002', status: 'approved', online: true, lat: 9.0300, lng: 38.7700, carPhotoUrl: '/api/ride/car/sim2.jpg', vehicleMake: 'Corolla', vehicleColour: 'White' } });
  const made = { rider: rider.id, drivers: [near.id, far.id], ride: null };
  console.log('created rider ' + rider.id + ' and drivers ' + near.id + ', ' + far.id + '\n');

  try {
    // ---------- 1. request ----------
    const q = await geo.route(PICKUP, DROP);
    const tier = s.tiers.economy;
    const fare = Math.max(tier.min, Math.round(tier.base + (q.distanceM / 1000) * tier.perKm + (q.durationS / 60) * tier.perMin));
    const take = Math.round(fare * (1 - (s.commissionPct || 0) / 100));
    const ride = await prisma.ride.create({ data: { riderId: rider.id, tier: 'economy', pickup: PICKUP, dropoff: DROP,
      distanceM: q.distanceM, durationS: q.durationS, fareEtb: fare, driverTakeEtb: take, status: 'dispatching',
      riderName: rider.name, riderPhone: rider.phone, estimate: !!q.estimate } });
    made.ride = ride.id;
    console.log('1. RIDE REQUESTED  ' + ride.id + ' · ' + (q.distanceM / 1000).toFixed(1) + ' km · ' + fare + ' ETB (driver keeps ' + take + ')');
    check('the router answered with real geometry', !q.estimate && q.geometry && q.geometry.length > 2, q.estimate ? 'GraphHopper is down — fare used the straight-line estimate' : '');

    // ---------- 2. dispatch runs the auction ----------
    const res = await dispatch.start(ride.id);
    const opened = await prisma.rideOffer.findMany({ where: { rideId: ride.id }, orderBy: { etaS: 'asc' } });
    console.log('\n2. AUCTION  dispatch.start -> ' + res + ' · ' + opened.length + ' offer(s)');
    opened.forEach(o => console.log('     ' + (o.driverId === near.id ? 'SIM Near' : 'SIM Far ') + ' eta ' + o.etaS + 's  ' + o.distanceM + 'm  round ' + o.round));
    check('both drivers were offered the ride', opened.length === 2);
    check('the nearest driver ranks first', opened[0] && opened[0].driverId === near.id);
    check('offer cards were pushed to Telegram (stubbed)', sent.length === 2, 'sent ' + sent.length);
    check('the card shows the fare and the 0% promise', /ETB/.test(sent[0].text) && (s.commissionPct > 0 || /0% commission/.test(sent[0].text)));
    check('the card carries Accept and Skip buttons', !!(sent[0].extra.reply_markup.inline_keyboard[0].length === 2));
    check('no owner alert while drivers are deciding', owner.length === 0, owner.join('; '));

    // ---------- 3. the race ----------
    const [a, b] = await Promise.all([offers.accept(ride.id, near.id), offers.accept(ride.id, far.id)]);
    const winners = [a, b].filter(x => x.ok);
    const after = await prisma.ride.findUnique({ where: { id: ride.id } });
    const offersAfter = await prisma.rideOffer.findMany({ where: { rideId: ride.id } });
    console.log('\n3. RACE  both drivers accepted in the same tick');
    console.log('     near -> ' + JSON.stringify(a) + '\n     far  -> ' + JSON.stringify(b));
    check('exactly one driver won', winners.length === 1, JSON.stringify([a, b]));
    check('the loser was told the ride was taken', [a, b].some(x => !x.ok && x.error === 'taken'));
    check('the ride is assigned to the winner', after.status === 'assigned' && after.driverId === winners[0].driverId);
    check('driverAcceptedAt was stamped', !!after.driverAcceptedAt);
    check('the losing offer is closed', offersAfter.filter(o => o.status === 'lost').length === 1);
    check('the winner is marked busy', (await prisma.driver.findUnique({ where: { id: winners[0].driverId } })).onRideId === ride.id);
    check('the rider was notified once', riderPings.length === 1 && riderPings[0] === 'assigned', riderPings.join(','));

    // ---------- 4. the driver's own app ----------
    const winnerTg = winners[0].driverId === near.id ? 990001 : 990002;
    const ses = await drive.session(req(winnerTg), reply());
    console.log('\n4. DRIVER APP  session -> ' + (ses.job ? 'job ' + ses.job.id + ' · next ' + ses.job.next.join('/') : 'no job'));
    check('the app hands the driver the trip', !!ses.job && ses.job.id === ride.id);
    check('the passenger phone is on the job card', ses.job.riderPhone === rider.phone);

    // ---------- 5. live position ----------
    const legs = [[9.0112, 38.7590], [9.0110, 38.7584], [9.0109, 38.7580]];
    let fixes = 0;
    for (const [lat, lng] of legs) {
      simClock.t += 4000; // four seconds of driving between fixes, like the real app
      const p = await drive.ping(req(winnerTg, { lat, lng, bearing: 315, speedKph: 22, accuracy: 8 }), reply());
      if (p.fix === 'stored') fixes++;
    }
    simClock.t += 4000;
    const junk = await drive.ping(req(winnerTg, { lat: 48.8566, lng: 2.3522 }), reply());
    // A genuine impossible jump inside Addis must also be refused.
    simClock.t += 1000;
    const jump = await drive.ping(req(winnerTg, { lat: 9.2000, lng: 38.9000 }), reply());
    const rows = await prisma.driverLocation.count({ where: { rideId: ride.id } });
    const live = location.latest(winners[0].driverId);
    console.log('\n5. LIVE POSITION  ' + fixes + '/3 fixes stored · ' + rows + ' breadcrumbs · trail ' + location.trail(ride.id).length + ' pts');
    check('every valid fix was stored', fixes === 3);
    check('a fix from Paris was rejected', junk.fix === 'outside_addis', junk.fix);
    check('a 25 km jump in one second was rejected', jump.fix === 'teleport', jump.fix);
    check('breadcrumbs reached the database', rows === 3, 'rows ' + rows);
    check('the latest fix is readable with an age', !!live && live.ageS != null);

    // ---------- 6. what the rider sees ----------
    const t = await drive.track({ params: { id: ride.id }, query: {} }, reply(), r => r.riderPhone === rider.phone);
    console.log('\n6. RIDER MAP  eta ' + t.live.etaS + 's · ' + t.live.distanceM + 'm · trail ' + t.live.trail.length + ' · car photo ' + (t.live.driver.carPhoto || 'none'));
    check('the rider gets a position', !!t.live.position && !t.live.position.stale);
    check('the rider gets a live ETA', t.live.etaS > 0);
    check('the rider gets the trail to animate', t.live.trail.length >= 2);
    check('the plate is exposed so the rider can match the car', !!t.live.driver.plate);
    check("the marker uses the driver's own car photo", /^\/api\/ride\/car\//.test(t.live.driver.carPhoto || ''), t.live.driver.carPhoto || 'none');
    const denied = reply();
    await drive.track({ params: { id: ride.id }, query: {} }, denied, () => false);
    check('a wrong phone number reveals nothing', denied.statusCode === 404);

    // ---------- 7. the status ladder ----------
    const seen = [];
    for (const step of ['arriving', 'arrived', 'ontrip', 'completed']) {
      const r = await drive.status(req(winnerTg, { status: step }, { id: ride.id }), reply());
      seen.push(r.ok ? r.job.status : 'FAILED:' + step);
    }
    const back = reply();
    await drive.status(req(winnerTg, { status: 'ontrip' }, { id: ride.id }), back);
    const done = await prisma.ride.findUnique({ where: { id: ride.id } });
    const drv = await prisma.driver.findUnique({ where: { id: winners[0].driverId } });
    console.log('\n7. LADDER  ' + seen.join(' -> '));
    check('the ladder ran to completion', seen.join(',') === 'arriving,arrived,ontrip,completed', seen.join(','));
    check('a completed ride cannot go backwards', back.statusCode === 409);
    check('timestamps were stamped', !!done.arrivedAt && !!done.startedAt && !!done.completedAt);
    check('the driver is free again', drv.onRideId === null);
    check('the trip was counted', drv.ridesCount === 1);
    check("today's earnings were banked", drv.earningsTodayEtb === take, drv.earningsTodayEtb + ' vs ' + take);
    check('the rider was told at every step', riderPings.join(',') === 'assigned,arriving,arrived,ontrip,completed', riderPings.join(','));
    check('the owner got the completion note', owner.some(o => /completed by SIM/.test(o)));

    // ---------- 8. nobody online ----------
    await prisma.driver.updateMany({ where: { id: { in: made.drivers } }, data: { online: false, onRideId: null } });
    const lonely = await prisma.ride.create({ data: { riderId: rider.id, tier: 'economy', pickup: PICKUP, dropoff: DROP,
      distanceM: q.distanceM, durationS: q.durationS, fareEtb: fare, driverTakeEtb: take, status: 'dispatching',
      riderName: rider.name, riderPhone: rider.phone } });
    made.ride2 = lonely.id;
    const before = owner.length;
    await dispatch.start(lonely.id);
    const esc = await prisma.ride.findUnique({ where: { id: lonely.id } });
    console.log('\n8. FALLBACK  no driver online -> concierge ' + esc.concierge);
    check('the concierge fallback still fires', esc.concierge === true && owner.length > before);
    check('no offers were created for nobody', (await prisma.rideOffer.count({ where: { rideId: lonely.id } })) === 0);
  } finally {
    // ---------- cleanup: only rows this run created ----------
    console.log('\ncleaning up…');
    const rideIds = [made.ride, made.ride2].filter(Boolean);
    const delLoc = await prisma.driverLocation.deleteMany({ where: { driverId: { in: made.drivers } } });
    const delOff = await prisma.rideOffer.deleteMany({ where: { rideId: { in: rideIds } } });
    const delRide = await prisma.ride.deleteMany({ where: { id: { in: rideIds } } });
    const delDrv = await prisma.driver.deleteMany({ where: { id: { in: made.drivers } } });
    const delRdr = await prisma.rider.deleteMany({ where: { id: made.rider } });
    console.log('  deleted ' + delLoc.count + ' locations, ' + delOff.count + ' offers, ' + delRide.count + ' rides, ' + delDrv.count + ' drivers, ' + delRdr.count + ' rider');
    // Exact phones, not the prefix: a prefix net also catches unrelated test rows created by hand
    // and reports a leak that is not ours.
    const MINE = [SIM + '01', SIM + '02', SIM + '03'];
    const leftDrv = await prisma.driver.count({ where: { phone: { in: MINE } } });
    const leftRdr = await prisma.rider.count({ where: { phone: { in: MINE } } });
    console.log('  sim rows still in the database: ' + (leftDrv + leftRdr) + ' (must be 0)');
    if (leftDrv + leftRdr > 0) bad++;
    console.log('\nTelegram messages actually sent to the network: 0 (all stubbed; ' + sent.length + ' captured)');
    console.log(bad === 0 ? '\nALL ' + ok + ' CHECKS PASSED' : '\n' + ok + ' passed, ' + bad + ' FAILED');
    await prisma.$disconnect();
    process.exitCode = bad === 0 ? 0 : 1;
  }
}

main().catch(async e => {
  console.error('\nSIM CRASHED: ' + e.stack);
  try { await prisma.$disconnect(); } catch (x) {}
  process.exitCode = 1;
});
