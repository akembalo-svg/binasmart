'use strict';
// The ONLY module that knows how a driver's position arrives. Today: HTTP POST from the driver app
// (ride/driverApi.js). Swapping to WebSockets later means changing this file and public/ride/track.js.
// Latest fix lives on the Driver row (cheap to read on the rider poll); a short trail lives in memory
// per active ride; every accepted fix is also appended to DriverLocation for history.
const { haversineM, ADDIS_BOX } = require('./geo');

const TRAIL_MAX = 25, TRAIL_TTL_MS = 5 * 60 * 1000, MAX_ACCURACY_M = 200, MAX_SPEED_MPS = 55; // ~200 km/h

function makeLocation({ prisma, api, now, staleMs }) {
  const clock = now || Date.now;
  const stale = staleMs || 45000;
  const last = new Map();   // driverId -> { lat, lng, bearing, speedKph, t }
  const trails = new Map(); // rideId   -> { pts: [{lat,lng,bearing,t}], t }

  function inAddis(lat, lng) {
    return lat > ADDIS_BOX.minLat && lat < ADDIS_BOX.maxLat && lng > ADDIS_BOX.minLng && lng < ADDIS_BOX.maxLng;
  }

  async function record(driverId, fix, rideId) {
    const lat = Number(fix && fix.lat), lng = Number(fix && fix.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, error: 'bad_coords' };
    if (!inAddis(lat, lng)) return { ok: false, error: 'outside_addis' };
    const acc = Number(fix.accuracy);
    if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) return { ok: false, error: 'inaccurate' };
    const t = clock();
    const prev = last.get(driverId);
    if (prev && prev.lat != null) {
      const dt = Math.max(1, (t - prev.t) / 1000);
      if (haversineM(prev, { lat, lng }) / dt > MAX_SPEED_MPS) return { ok: false, error: 'teleport' };
    }
    const bearing = Number.isFinite(Number(fix.bearing)) ? Number(fix.bearing) : (prev ? prev.bearing : null);
    const speedKph = Number.isFinite(Number(fix.speedKph)) ? Math.max(0, Number(fix.speedKph)) : null;
    last.set(driverId, { lat, lng, bearing, speedKph, t });
    if (rideId) {
      const tr = trails.get(rideId) || { pts: [], t };
      tr.pts.push({ lat, lng, bearing, t }); if (tr.pts.length > TRAIL_MAX) tr.pts.shift();
      tr.t = t; trails.set(rideId, tr);
      if (trails.size > 500) for (const [k, v] of trails) if (t - v.t > TRAIL_TTL_MS) trails.delete(k);
    }
    await prisma.driver.update({ where: { id: driverId }, data: { lat, lng, bearing, speedKph, lastSeenAt: new Date(t), away: false } });
    prisma.driverLocation.create({ data: { driverId, rideId: rideId || null, lat, lng, bearing, speedKph, at: new Date(t) } })
      .catch(e => console.error('[ride/location] breadcrumb failed: ' + e.message));
    return { ok: true };
  }

  function latest(driverId) {
    const l = last.get(driverId);
    if (!l || l.lat == null) return null;
    return { lat: l.lat, lng: l.lng, bearing: l.bearing, speedKph: l.speedKph, ageS: Math.round((clock() - l.t) / 1000) };
  }

  function trail(rideId) {
    const tr = trails.get(rideId);
    return tr ? tr.pts.map(p => ({ lat: p.lat, lng: p.lng, bearing: p.bearing })) : [];
  }

  // Online drivers that stopped sending fixes get no offers until they come back.
  async function staleSweep() {
    const t = clock();
    const online = await prisma.driver.findMany({ where: { online: true, away: false }, select: { id: true, telegramId: true } });
    let n = 0;
    for (const d of online) {
      const l = last.get(d.id);
      if (l && t - l.t <= stale) continue;
      if (!l) { last.set(d.id, { lat: null, lng: null, bearing: null, speedKph: null, t }); continue; } // first sight: grace period
      await prisma.driver.update({ where: { id: d.id }, data: { away: true } });
      n++;
      if (d.telegramId && api) {
        api.sendMessage(String(d.telegramId), '📴 You have gone quiet, so you are not receiving ride offers. Open the BinaSmart Driver app and keep it open to come back online.\nየBinaSmart ሹፌር መተግበሪያውን ከፍተው ይጠብቁ።')
          .catch(e => console.error('[ride/location] away ping failed: ' + e.message));
      }
    }
    if (n) console.log('[ride/location] marked ' + n + ' driver(s) away');
    return n;
  }

  function forget(driverId) { last.delete(driverId); }

  return { record, latest, trail, staleSweep, forget };
}

module.exports = { makeLocation, TRAIL_MAX };
