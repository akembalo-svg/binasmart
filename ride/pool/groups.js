'use strict';
// Daily groups (ኮንትራት · contract commute). An organizer sets a start point, a destination, the days
// and the time; members join once through a share link. Fifteen minutes before departure, every day
// that matches, the system opens a pool with every member already seated; members who cannot come
// tap "skip today" (a normal leave). At departure time the pool leaves like any other car (auction),
// priced by the ladder for the seats actually taken. Cash to the driver per ride in this version.
const C = require('./corridors');

const OPEN_BEFORE_MIN = 15;
const DAY_BITS = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 };
const WEEKDAYS = 31;

function addisParts(ms) {
  const d = new Date(ms + 3 * 3600 * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), bit: 1 << dow, dow };
}
function daysLabel(mask) {
  if (mask === WEEKDAYS) return 'Mon–Fri';
  if (mask === 127) return 'every day';
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((n, i) => mask & (1 << i)).join(' ');
}
function hhmm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
// Next departure after `ms`, as an absolute time, or null when the mask is empty.
function nextDeparture(group, ms) {
  if (!group.days) return null;
  const p = addisParts(ms);
  for (let i = 0; i < 8; i++) {
    const bit = 1 << ((p.dow + i) % 7);
    if (!(group.days & bit)) continue;
    const minutesFromNow = i * 1440 + group.timeMin - p.minutes;
    if (minutesFromNow <= 0) continue;
    return new Date(ms + minutesFromNow * 60000 - (ms % 60000));
  }
  return null;
}

function makeGroups({ prisma, pool, settings, api, baseUrl, now }) {
  const clock = now || Date.now;

  function pubGroup(g, members, ms) {
    const active = members.filter(m => m.status === 'active');
    const next = nextDeparture(g, ms);
    return { id: g.id, name: g.name, kind: g.kind, from: g.pickup, to: g.dropoff, days: g.days, daysLabel: daysLabel(g.days), time: hhmm(g.timeMin), timeMin: g.timeMin,
      seats: g.seats, tier: g.tier, womenOnly: !!g.womenOnly, status: g.status, members: active.length, full: active.length >= g.seats,
      names: active.map(m => String(m.riderName || '').split(' ')[0]), nextAt: next, nextInMin: next ? Math.round((next - ms) / 60000) : null, organizer: String(g.organizerName || '').split(' ')[0] };
  }

  async function create({ name, pickup, dropoff, days, timeMin, womenOnly, organizer }) {
    if (!pickup || !dropoff) return { ok: false, error: 'pickup_and_dropoff_required' };
    if (!organizer || !organizer.name || !organizer.phone) return { ok: false, error: 'name_and_phone_required' };
    if (C.haversineM(pickup, dropoff) < 400) return { ok: false, error: 'too_close' };
    const mask = Number(days) | 0; if (mask < 1 || mask > 127) return { ok: false, error: 'pick_days' };
    const t = Number(timeMin); if (!Number.isInteger(t) || t < 0 || t >= 1440) return { ok: false, error: 'pick_time' };
    const s = await settings.get();
    const tier = C.TIER, seats = (s.tiers[tier] && s.tiers[tier].seats) || 4;
    const mine = await prisma.poolGroup.count({ where: { organizerPhone: organizer.phone, status: 'active' } });
    if (mine >= 3) return { ok: false, error: 'too_many_groups' };
    const g = await prisma.poolGroup.create({ data: { name: String(name || '').trim().slice(0, 60) || (pickup.label.split(' · ')[0] + ' → ' + dropoff.label.split(' · ')[0]),
      kind: 'daily', pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
      days: mask, timeMin: t, seats, tier, womenOnly: !!womenOnly, organizerPhone: organizer.phone, organizerName: organizer.name, status: 'active' } });
    await prisma.poolGroupMember.create({ data: { groupId: g.id, riderName: organizer.name, riderPhone: organizer.phone, telegramId: organizer.telegramId ? String(organizer.telegramId) : null, status: 'active' } });
    return { ok: true, group: await pub(g.id), share: (baseUrl || 'https://bina.et') + '/pool/g/' + g.id };
  }

  async function pub(groupId) {
    const g = await prisma.poolGroup.findUnique({ where: { id: groupId } });
    if (!g) return null;
    const members = await prisma.poolGroupMember.findMany({ where: { groupId } });
    return pubGroup(g, members, clock());
  }

  async function join(groupId, { name, phone, telegramId, female }) {
    if (!name || !phone) return { ok: false, error: 'name_and_phone_required' };
    const g = await prisma.poolGroup.findUnique({ where: { id: groupId } });
    if (!g || g.status !== 'active') return { ok: false, error: 'not_found' };
    if (g.womenOnly && female !== true) return { ok: false, error: 'women_only' };
    const members = await prisma.poolGroupMember.findMany({ where: { groupId } });
    const me = members.find(m => m.riderPhone === phone);
    if (me && me.status === 'active') return { ok: true, duplicate: true, group: pubGroup(g, members, clock()) };
    if (members.filter(m => m.status === 'active').length >= g.seats) return { ok: false, error: 'group_full' };
    if (me) await prisma.poolGroupMember.update({ where: { id: me.id }, data: { status: 'active', riderName: name, telegramId: telegramId ? String(telegramId) : me.telegramId } });
    else await prisma.poolGroupMember.create({ data: { groupId, riderName: name, riderPhone: phone, telegramId: telegramId ? String(telegramId) : null, status: 'active' } });
    return { ok: true, group: await pub(groupId) };
  }

  // Leaving as a member; the organizer leaving closes the group for everyone.
  async function leave(groupId, phone) {
    const g = await prisma.poolGroup.findUnique({ where: { id: groupId } });
    if (!g) return { ok: false, error: 'not_found' };
    const me = await prisma.poolGroupMember.findFirst({ where: { groupId, riderPhone: phone, status: 'active' } });
    if (!me) return { ok: false, error: 'not_found' };
    if (g.organizerPhone === phone) {
      await prisma.poolGroupMember.updateMany({ where: { groupId }, data: { status: 'left' } });
      await prisma.poolGroup.update({ where: { id: groupId }, data: { status: 'closed' } });
      return { ok: true, closed: true };
    }
    await prisma.poolGroupMember.update({ where: { id: me.id }, data: { status: 'left' } });
    return { ok: true, closed: false };
  }

  async function mine(phone) {
    const ms = clock();
    const ms_ = await prisma.poolGroupMember.findMany({ where: { riderPhone: phone, status: 'active', group: { status: 'active' } }, orderBy: { joinedAt: 'desc' }, take: 10 });
    const out = [];
    for (const m of ms_) {
      const g = await prisma.poolGroup.findUnique({ where: { id: m.groupId } }); if (!g) continue;
      const members = await prisma.poolGroupMember.findMany({ where: { groupId: g.id } });
      out.push({ ...pubGroup(g, members, ms), organizerIsMe: g.organizerPhone === phone, share: (baseUrl || 'https://bina.et') + '/pool/g/' + g.id });
    }
    return out;
  }

  async function mineByTelegram(telegramId) {
    const m = await prisma.poolGroupMember.findFirst({ where: { telegramId: String(telegramId), status: 'active' }, orderBy: { joinedAt: 'desc' } });
    return m ? mine(m.riderPhone) : [];
  }

  // Scheduled every minute by ride/index.js: open today's car 15 minutes before departure, members seated.
  async function tick() {
    const ms = clock(), p = addisParts(ms);
    const due = await prisma.poolGroup.findMany({ where: { status: 'active' }, take: 500 });
    let n = 0;
    for (const g of due) {
      if (!(g.days & p.bit)) continue;
      const lead = g.timeMin - p.minutes;
      if (lead > OPEN_BEFORE_MIN || lead < -2) continue;
      if (g.lastOpenedDay === p.day) continue;
      const claimed = await prisma.poolGroup.updateMany({ where: { id: g.id, lastOpenedDay: { not: p.day } }, data: { lastOpenedDay: p.day } });
      if (!claimed.count) { const again = await prisma.poolGroup.updateMany({ where: { id: g.id, lastOpenedDay: null }, data: { lastOpenedDay: p.day } }); if (!again.count) continue; }
      const members = await prisma.poolGroupMember.findMany({ where: { groupId: g.id, status: 'active' }, orderBy: { joinedAt: 'asc' } });
      if (!members.length) continue;
      const departAt = new Date(ms + Math.max(0, lead) * 60000 - (ms % 60000));
      const poolRow = await prisma.pool.create({ data: { kind: 'group', corridorKey: 'group:' + g.id, groupId: g.id, tier: g.tier, seats: g.seats, status: 'filling', womenOnly: !!g.womenOnly,
        pickup: g.pickup, dropoff: g.dropoff, createdBy: g.organizerPhone, openedAt: new Date(ms), dispatchAt: departAt } });
      for (const m of members) {
        // a member already holding a seat elsewhere keeps that one; everyone else is seated here
        const busy = await prisma.poolSeat.findFirst({ where: { riderPhone: m.riderPhone, status: { in: ['held', 'boarded'] }, pool: { status: { in: ['filling', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'] } } } });
        if (busy) continue;
        const rider = await prisma.rider.upsert({ where: { phone: m.riderPhone }, update: {}, create: { phone: m.riderPhone, name: m.riderName } });
        await prisma.poolSeat.create({ data: { poolId: poolRow.id, riderId: rider.id, riderName: m.riderName, riderPhone: m.riderPhone, telegramId: m.telegramId, stopId: 'origin', status: 'held', paymentMethod: 'cash', joinedAt: new Date(ms) } });
      }
      n++;
      if (api) {
        for (const m of members) {
          if (!m.telegramId) continue;
          const text = '🔁 ' + g.name + ' · ' + hhmm(g.timeMin) + '\nየዛሬው መኪና እየተዘጋጀ ነው። ካልመጡ "ዛሬ አልመጣም" ይንኩ።\nToday\'s car is being prepared — your seat is held. Not coming? Tap "skip today" before ' + hhmm(g.timeMin) + '.';
          try { await api.sendMessage(String(m.telegramId), text, { reply_markup: { inline_keyboard: [[{ text: '📍 Open · ክፈት', web_app: { url: (baseUrl || 'https://bina.et') + '/ride?pool=' + poolRow.id } }]] } }); }
          catch (e) { /* the app shows the same thing */ }
        }
      }
      console.log('[pool/groups] ' + g.id + ' opened today\'s car ' + poolRow.id + ' for ' + members.length + ' member(s), leaves ' + hhmm(g.timeMin));
    }
    return n;
  }

  return { create, pub, join, leave, mine, mineByTelegram, tick, nextDeparture, daysLabel, hhmm, addisParts, DAY_BITS, WEEKDAYS, OPEN_BEFORE_MIN };
}

module.exports = { makeGroups, nextDeparture, daysLabel, hhmm, addisParts, DAY_BITS, WEEKDAYS, OPEN_BEFORE_MIN };
