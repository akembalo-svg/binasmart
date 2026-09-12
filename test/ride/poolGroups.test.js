'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeGroups, nextDeparture, daysLabel, addisParts, WEEKDAYS } = require('../../ride/pool/groups');
const { makePool } = require('../../ride/pool/pool');
const { DEFAULTS } = require('../../ride/settings');

// Wednesday 9 Sep 2026 07:10 Addis = 04:10 UTC
const WED_0710 = Date.UTC(2026, 8, 9, 4, 10);

test('schedule helpers: Addis day parts, day labels, next departure honours the mask', () => {
  const p = addisParts(WED_0710);
  assert.equal(p.day, '2026-09-09'); assert.equal(p.minutes, 430); assert.equal(p.dow, 2); assert.equal(p.bit, 4);
  assert.equal(daysLabel(WEEKDAYS), 'Mon–Fri'); assert.equal(daysLabel(127), 'every day'); assert.equal(daysLabel(5), 'Mon Wed');
  const g = { days: WEEKDAYS, timeMin: 450 }; // 07:30 weekdays
  assert.equal(nextDeparture(g, WED_0710).getTime(), WED_0710 + 20 * 60000);
  const fri = { days: 16, timeMin: 420 }; // Friday 07:00
  assert.equal(new Date(nextDeparture(fri, WED_0710).getTime() + 3 * 3600000).getUTCDay(), 5);
  assert.equal(nextDeparture({ days: 0, timeMin: 420 }, WED_0710), null);
});

function world() {
  const clock = { t: WED_0710 };
  const db = { groups: [], members: [], pools: [], seats: [], riders: [], rides: [] };
  let seq = 0; const id = p => p + (++seq);
  const match = (row, where) => Object.keys(where).every(k => {
    const w = where[k];
    if (k === 'pool') return db.pools.some(p => p.id === row.poolId && match(p, w));
    if (k === 'group') return db.groups.some(g => g.id === row.groupId && match(g, w));
    if (w && typeof w === 'object' && !(w instanceof Date)) {
      if ('in' in w) return w.in.includes(row[k]);
      if ('not' in w) return row[k] !== w.not;
      if ('gt' in w) return new Date(row[k]).getTime() > new Date(w.gt).getTime();
      if ('lte' in w) return new Date(row[k]).getTime() <= new Date(w.lte).getTime();
    }
    return row[k] === w;
  });
  const sorted = (rows, orderBy) => { if (!orderBy) return rows; const k = Object.keys(orderBy)[0], dir = orderBy[k] === 'desc' ? -1 : 1; return rows.slice().sort((a, b) => (new Date(a[k]) - new Date(b[k])) * dir); };
  const table = (rows, mk) => ({
    findFirst: async ({ where, orderBy }) => { const r = sorted(rows.filter(x => match(x, where)), orderBy)[0]; return r ? { ...r } : null; },
    findMany: async ({ where, orderBy, take }) => sorted(rows.filter(x => match(x, where || {})), orderBy).slice(0, take || 1e9).map(x => ({ ...x })),
    findUnique: async ({ where }) => { const r = rows.find(x => Object.keys(where).every(k => x[k] === where[k])); return r ? { ...r } : null; },
    count: async ({ where }) => rows.filter(x => match(x, where || {})).length,
    create: async ({ data }) => { const r = mk(data); rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    updateMany: async ({ where, data }) => { const hit = rows.filter(x => match(x, where)); hit.forEach(x => Object.assign(x, data)); return { count: hit.length }; },
    upsert: async ({ where, update, create }) => { let r = rows.find(x => x.phone === where.phone); if (r) Object.assign(r, update); else { r = { id: id('rd'), telegramId: null, ...create }; rows.push(r); } return { ...r }; },
  });
  const prisma = {
    poolGroup: table(db.groups, d => ({ id: id('g'), lastOpenedDay: null, createdAt: new Date(clock.t), ...d })),
    poolGroupMember: table(db.members, d => ({ id: id('m'), telegramId: null, joinedAt: new Date(clock.t), ...d })),
    pool: table(db.pools, d => ({ id: id('p'), rideId: null, seatFareEtb: null, dispatchedAt: null, driverId: null, ...d })),
    poolSeat: table(db.seats, d => ({ id: id('s'), fareEtb: null, ...d })),
    rider: table(db.riders, d => ({ id: id('rd'), telegramId: null, ...d })),
    ride: table(db.rides, d => ({ id: id('r'), driverId: null, concierge: false, paymentStatus: 'unpaid', requestedAt: new Date(clock.t), ...d })),
    driver: { updateMany: async () => ({ count: 1 }) },
  };
  const sent = [], started = [];
  const settings = { get: async () => DEFAULTS };
  const pool = makePool({ prisma, geo: { route: async () => ({ distanceM: 7000, durationS: 1000, geometry: [], estimate: false }) }, settings, dispatch: { start: async id => { started.push(id); } }, api: null, now: () => clock.t });
  const groups = makeGroups({ prisma, pool, settings, api: { sendMessage: async (chat, text) => { sent.push({ chat, text }); } }, baseUrl: 'https://bina.et', now: () => clock.t });
  return { groups, pool, prisma, db, clock, sent, started };
}
const HOME = { lat: 9.0300, lng: 38.7600, label: 'Sheraton gate' }, WORK = { lat: 8.9975, lng: 38.7876, label: 'Bole Medhanialem' };

test('daily group: create, invite card, join, full, leave; the organizer leaving closes it', async () => {
  const w = world();
  const c = await w.groups.create({ name: 'Bole office run', pickup: HOME, dropoff: WORK, days: WEEKDAYS, timeMin: 450, organizer: { name: 'Sara Tesfaye', phone: '+25191100001', telegramId: 111 } });
  assert.equal(c.ok, true); assert.equal(c.group.members, 1); assert.equal(c.group.daysLabel, 'Mon–Fri'); assert.equal(c.group.time, '07:30');
  assert.match(c.share, /\/pool\/g\//);
  assert.equal(c.group.nextInMin, 20);
  assert.equal((await w.groups.create({ pickup: HOME, dropoff: WORK, days: 0, timeMin: 450, organizer: { name: 'X', phone: '+25191100009' } })).error, 'pick_days');
  assert.equal((await w.groups.create({ pickup: HOME, dropoff: WORK, days: 31, timeMin: 2000, organizer: { name: 'X', phone: '+25191100009' } })).error, 'pick_time');
  const pub = await w.groups.pub(c.group.id);
  assert.equal(JSON.stringify(pub).indexOf('+2519'), -1, 'no phones on the invite card');
  for (const [n, i] of [['Beti', 2], ['Chala', 3], ['Dawit', 4]]) assert.equal((await w.groups.join(c.group.id, { name: n, phone: '+2519110000' + i })).ok, true);
  assert.equal((await w.groups.join(c.group.id, { name: 'Eden', phone: '+25191100005' })).error, 'group_full');
  assert.equal((await w.groups.join(c.group.id, { name: 'Beti', phone: '+25191100002' })).duplicate, true);
  assert.equal((await w.groups.leave(c.group.id, '+25191100004')).closed, false);
  assert.equal((await w.groups.join(c.group.id, { name: 'Eden', phone: '+25191100005' })).ok, true, 'a freed seat can be taken');
  const mine = await w.groups.mine('+25191100002');
  assert.equal(mine.length, 1); assert.equal(mine[0].organizerIsMe, false);
  assert.equal((await w.groups.leave(c.group.id, '+25191100001')).closed, true, 'organizer leaving closes the group');
  assert.equal((await w.groups.pub(c.group.id)).status, 'closed');
  assert.equal((await w.groups.mine('+25191100002')).length, 0);
});

test('tick: opens today\'s car 15 min before departure with every member seated, once per day, then it leaves at the time', async () => {
  const w = world();
  const c = await w.groups.create({ name: 'Bole office run', pickup: HOME, dropoff: WORK, days: WEEKDAYS, timeMin: 450, organizer: { name: 'Sara', phone: '+25191100001', telegramId: 111 } });
  await w.groups.join(c.group.id, { name: 'Beti', phone: '+25191100002', telegramId: 222 });
  await w.groups.join(c.group.id, { name: 'Chala', phone: '+25191100003' });
  w.clock.t = WED_0710 - 10 * 60000; // 07:00: 30 min early, nothing yet
  assert.equal(await w.groups.tick(), 0);
  w.clock.t = WED_0710 + 6 * 60000; // 07:16: inside the 15-minute window
  assert.equal(await w.groups.tick(), 1);
  assert.equal(await w.groups.tick(), 0, 'not twice the same day');
  const p = w.db.pools[0];
  assert.equal(p.kind, 'group'); assert.equal(p.groupId, c.group.id); assert.equal(w.db.seats.filter(s => s.poolId === p.id).length, 3);
  assert.equal(new Date(p.dispatchAt).getTime(), WED_0710 + 20 * 60000, 'leaves at 07:30 sharp');
  assert.equal(w.sent.length, 2, 'the two Telegram members were told');
  assert.match(w.sent[0].text, /skip today/);
  // Beti skips today: a normal leave while filling
  const v = await w.pool.view(p.id, '+25191100002');
  assert.equal(v.pool.filled, 3); assert.equal(v.seat.status, 'held');
  assert.equal((await w.pool.leave(p.id, '+25191100002')).ok, true);
  // 07:30: the pool sweep sends the car with the two who are coming
  w.clock.t = WED_0710 + 20 * 60000;
  assert.equal(await w.pool.sweep(), 1);
  assert.equal(w.started.length, 1);
  assert.equal(w.db.rides[0].riderName.startsWith('Pool · 2 riders'), true);
  assert.equal(w.db.rides[0].dropoff.label, 'Bole Medhanialem');
  // Thursday: a new car
  w.clock.t = WED_0710 + 86400000 + 6 * 60000;
  assert.equal(await w.groups.tick(), 1);
  assert.equal(w.db.pools.length, 2);
  // Saturday: nothing
  w.clock.t = WED_0710 + 3 * 86400000 + 6 * 60000;
  assert.equal(await w.groups.tick(), 0);
});

// 2026-09-12. /api/pool/groups/mine?phone= answered with the group's pickup point, dropoff point,
// days, exact time and every member's first name. Ethiopian mobile numbers are enumerable and a phone
// number is not a credential, so anyone who knew somebody's number could ask where they live, where
// they work and when they leave. The answer is tiered now: proof of identity gets what it always got.
test('a phone number gets the schedule, not the addresses or the names', async () => {
  const w = world();
  const g = await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });
  assert.equal(g.ok, true, JSON.stringify(g));

  const limited = (await w.groups.mine('+251911000111', false))[0];
  assert.ok(limited, 'the card still finds the group');
  assert.equal(limited.name, 'Bole 7am', 'and still names it');
  assert.equal(typeof limited.time, 'string', 'and still says when it leaves');
  assert.equal(typeof limited.members, 'number', 'and how many are in it');

  assert.equal(limited.from, undefined, 'the pickup point is where somebody lives');
  assert.equal(limited.to, undefined, 'the dropoff point is where somebody works');
  assert.equal(limited.names, undefined, 'and these are the people they travel with');
  assert.equal(limited.organizer, undefined);
  assert.equal(limited.share, undefined, 'the share link is the invitation — it is not handed to a guess');
});

test('a proven identity gets what it always got', async () => {
  const w = world();
  await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });

  const full = (await w.groups.mine('+251911000111', true))[0];
  assert.deepEqual(full.from, { lat: 9.01, lng: 38.76, label: 'Home' });
  assert.deepEqual(full.to, { lat: 9.04, lng: 38.75, label: 'Office' });
  assert.deepEqual(full.names, ['Abebe']);
  assert.equal(full.organizer, 'Abebe');
  assert.match(full.share, /\/pool\/g\//);
});

// mineByTelegram is the signed path, so it must ask for the full answer without the caller saying so.
test('the Telegram path resolves to the full answer on its own', async () => {
  const w = world();
  await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111', telegramId: '900001' } });
  const viaTg = await w.groups.mineByTelegram('900001');
  if (viaTg.length) {
    assert.ok(viaTg[0].from, 'a signed Telegram identity is proof, so it sees the points');
    assert.ok(viaTg[0].names, 'and the members');
  }
});

// The invitation still works: whoever was sent the cuid sees the whole card, which is the point of it.
test('the share card stays complete — the unguessable id is the invitation', async () => {
  const w = world();
  const g = await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });
  const card = await w.groups.pub(g.group.id);
  assert.ok(card.from, 'a colleague who was sent the link needs to know where it leaves from');
  assert.ok(card.names);
});

// ---------------------------------------------------------------------------------------------
// 2026-09-13. Two things, both follow-ups to the tiering change of the 12th.
// ---------------------------------------------------------------------------------------------

// The residual that commit wrote down and left open: the limited answer still carried the group id,
// and /pool/g/<id> is the full share card — pickup point, dropoff point, member names, organiser. So
// a known phone number still reached everything the tiering had just withheld.
test('a typed phone number gets a handle that leaves, and not the id that invites', async () => {
  const w = world();
  const g = await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });
  const id = g.group.id;

  const limited = (await w.groups.mine('+251911000111', false))[0];
  assert.equal(limited.id, undefined, 'the id is the invitation, so it is not handed to a guess');
  assert.ok(limited.ref, 'but something has to work the leave button');
  assert.notEqual(limited.ref, id);
  assert.equal(String(limited.ref).includes(id), false, 'and the ref does not contain the id');

  const full = (await w.groups.mine('+251911000111', true))[0];
  assert.equal(full.id, id, 'a proven caller still gets the id');
});

test('the handle leaves only for the person it was given to', async () => {
  const w = world();
  const g = await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });
  const ref = (await w.groups.mine('+251911000111', false))[0].ref;

  assert.equal(await w.groups.resolveLeaveKey(ref, '+251911000111'), g.group.id);
  assert.equal(await w.groups.resolveLeaveKey(ref, '+251911000222'), null,
    'somebody else holding the same ref resolves nothing — it is matched against their own memberships');
  assert.equal(await w.groups.resolveLeaveKey('made-up', '+251911000111'), null);
  assert.equal(await w.groups.resolveLeaveKey(g.group.id, '+251911000111'), g.group.id, 'an id still works');
});

// And the regression this pair of commits actually caused. public/ride/app.js read g.names.join(),
// g.from.label and g.to.label with no guard; the 12th stopped sending all three on the phone path, so
// groupLine threw a TypeError and took the whole daily-groups panel down. Nobody saw it because the
// only group in the database is closed, so mine() returned an empty list and the line never ran.
//
// Tested by running the page's own function, lifted out of the shipped file, against the answer the
// module actually produces — not against a fixture written to match.
test('the page can render what the server actually sends it', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'ride', 'app.js'), 'utf8');
  const at = src.indexOf('function groupLine(g)');
  assert.ok(at > 0, 'groupLine not found in public/ride/app.js');
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  assert.ok(end > at, 'could not find the end of groupLine');
  const groupLine = eval('(' + src.slice(at, end).replace(/^function /, 'function ') + ')');   // eslint-disable-line no-eval

  const w = world();
  await w.groups.create({ name: 'Bole 7am', pickup: { lat: 9.01, lng: 38.76, label: 'Home' },
    dropoff: { lat: 9.04, lng: 38.75, label: 'Office' }, days: 62, timeMin: 420,
    organizer: { name: 'Abebe Kebede', phone: '+251911000111' } });

  global.esc = s2 => String(s2 == null ? '' : s2);
  for (const full of [false, true]) {
    const g = (await w.groups.mine('+251911000111', full))[0];
    const html = groupLine(g);           // this threw for full=false before today
    assert.match(html, /Bole 7am/);
    assert.match(html, /07:00/);
    if (full) assert.match(html, /Home/, 'a proven caller still sees where the car leaves from');
    else {
      assert.equal(/Home|Office|Abebe/.test(html), false, 'and a phone number still sees none of it');
      assert.match(html, /Telegram/, 'but is told how to');
    }
  }
  delete global.esc;
});
