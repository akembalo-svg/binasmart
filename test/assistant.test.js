'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lang = require('../assistant/lang');
const { makeExecutor, toOpenAI, DEFS } = require('../assistant/tools');
const { makeMemory, makeHandover, userKey } = require('../assistant/memory');

test('language detection: Ethiopic, Latin Amharic, Afaan Oromoo, English', () => {
  assert.equal(lang.detect('ጋራ ጉዞ ምንድን ነው'), 'am');
  assert.equal(lang.detect('selam bini, ride sint new?'), 'am-latin');
  assert.equal(lang.detect('Akkam jirtu, gatiin imalaa gara Boolee meeqa?'), 'om');
  assert.equal(lang.detect('Is the hotel booking real?'), 'en');
  assert.match(lang.directive('om'), /Afaan Oromoo/);
  assert.match(lang.directive('am-latin'), /Latin letters/);
});

test('tool definitions are valid OpenAI function schemas', () => {
  const t = toOpenAI();
  assert.equal(t.length, DEFS.length);
  for (const d of t) { assert.equal(d.type, 'function'); assert.ok(d.function.name && d.function.description && d.function.parameters.type === 'object'); }
  assert.ok(DEFS.find(d => d.name === 'request_ride').parameters.required.includes('confirmed'));
});

function fakeApi() {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const j = d => ({ ok: true, status: 200, json: async () => d });
    if (/\/api\/ride\/search/.test(url)) return j({ ok: true, results: [{ kind: 'landmark', label: 'Bole Medhanialem', labelAm: 'ቦሌ መድኃኒዓለም', sub: 'Bole', lat: 8.9975, lng: 38.7876 }] });
    if (/\/api\/ride\/quote/.test(url)) return j({ ok: true, distanceM: 7200, durationS: 1300, quotes: [{ tier: 'economy', label: 'Economy', labelAm: 'ኢኮኖሚ', seats: 4, fareEtb: 250 }, { tier: 'comfort', label: 'Comfort', seats: 4, fareEtb: 315 }] });
    if (/\/api\/ride\/request/.test(url)) return j({ ok: true, ride: { id: 'r1', status: 'searching', fareEtb: 315 } });
    if (/\/api\/ride\/r1\?phone=/.test(url)) return j({ ok: true, ride: { status: 'assigned', driver: { name: 'Abebe', plate: 'A12345', vehicle: 'white Toyota' }, fareEtb: 315 } });
    if (/\/api\/pool\/board/.test(url)) return j({ ok: true, direction: 'in', peak: true, corridors: [{ name: 'Megenagna → Bole', stops: [{ label: 'Megenagna' }, { label: 'Bole' }], ladder: [{ n: 1, seatEtb: 315 }, { n: 4, seatEtb: 105 }] }], groups: [{ id: 'p9', destLabel: 'Bole', seatsLeft: 2, seatEtb: 105, womenOnly: true }] });
    if (/\/api\/cinema\/programme/.test(url)) return j({ ok: true, today: '2026-09-09', venues: [{ venue: { name: 'Alem Cinema', area: 'Bole' }, films: [{ title: 'Film A', times: ['18:00'], dateFrom: '2026-09-09', dateTo: '2026-09-12' }] }] });
    return { ok: false, status: 404, json: async () => ({ error: 'not_found' }) };
  };
  return { calls, fetchImpl };
}

test('executor: places → quote → request needs confirmation and a valid phone; status, pool, cinema, tenders', async () => {
  const { calls, fetchImpl } = fakeApi();
  const touched = [];
  const prisma = { tender: { findMany: async ({ where }) => [{ slug: 'road-2026', title: 'Road works', titleAm: 'የመንገድ ሥራ', org: 'AACRA', category: 'Construction', region: 'Addis Ababa', deadline: new Date('2026-10-01') }] } };
  const run = makeExecutor({ base: 'http://x', fetchImpl, prisma, memory: { persistent: true, touch: async p => { touched.push(p); } }, handover: async () => {} });
  const p = await run('search_places', { q: 'Bole' });
  assert.equal(p.results[0].name, 'Bole Medhanialem'); assert.equal(p.results[0].nameAm, 'ቦሌ መድኃኒዓለም');
  const q = await run('quote_ride', { pickup: { lat: 9.02, lng: 38.80, label: 'Megenagna' }, dropoff: { lat: 8.9975, lng: 38.7876, label: 'Bole' } });
  assert.equal(q.fares[1].etb, 315); assert.equal(q.distanceKm, 7.2); assert.ok(touched[0].lastPickup);
  const bad = await run('quote_ride', { pickup: { lat: 25, lng: 55 }, dropoff: { lat: 9, lng: 38.8 } });
  assert.match(bad.error, /inside Addis/);
  const noconf = await run('request_ride', { pickup: { lat: 9.02, lng: 38.8 }, dropoff: { lat: 9, lng: 38.79 }, tier: 'comfort', riderPhone: '0911000001', confirmed: false });
  assert.match(noconf.error, /not_confirmed/);
  const badphone = await run('request_ride', { pickup: { lat: 9.02, lng: 38.8 }, dropoff: { lat: 9, lng: 38.79 }, tier: 'comfort', riderPhone: '12345', confirmed: true });
  assert.match(badphone.error, /Ethiopian mobile/);
  const ok = await run('request_ride', { pickup: { lat: 9.02, lng: 38.8, label: 'Megenagna' }, dropoff: { lat: 9, lng: 38.79, label: 'Bole' }, tier: 'comfort', riderPhone: '0911000001', riderName: 'Test', confirmed: true });
  assert.equal(ok.rideId, 'r1'); assert.match(ok.trackUrl, /\/ride\?id=r1/);
  const req = calls.find(c => /ride\/request/.test(c.url)); assert.equal(req.opts.headers['x-real-ip'], 'bini-911000001');
  const st = await run('ride_status', { rideId: 'r1', phone: '0911000001' });
  assert.equal(st.driver.plate, 'A12345');
  const pool = await run('pool_board', { lat: 9.02, lng: 38.8 });
  assert.equal(pool.corridors[0].seatPrices[1].seatEtb, 105); assert.equal(pool.nearby[0].womenOnly, true); assert.match(pool.nearby[0].joinUrl, /\/pool\/p9/);
  const cin = await run('cinema_programme', { venue: 'alem' });
  assert.equal(cin.venues[0].films[0].title, 'Film A');
  const tn = await run('search_tenders', { q: 'road' });
  assert.equal(tn.tenders[0].deadline, '2026-10-01'); assert.match(tn.tenders[0].url, /\/tenders\/road-2026/);
  const rm = await run('remember', { field: 'home', value: 'CMC', lat: 9.0186, lng: 38.8461 });
  assert.equal(rm.ok, true); assert.equal(touched.at(-1).home.label, 'CMC');
  assert.match((await run('nope', {})).error, /unknown_tool/);
});

test('memory: keys, profile text, miss and human detection, handover rate limit', async () => {
  assert.equal(userKey({ telegramId: 8096525984 }), 'tg:8096525984');
  assert.equal(userKey({ uid: 'w1abc_def' }), 'web:w1abc_def');
  assert.equal(userKey({ uid: 'bad uid!', ip: '1.2.3.4' }), 'ip:1.2.3.4');
  const rows = new Map();
  const prisma = { assistantUser: { findUnique: async ({ where }) => rows.get(where.key) || null, upsert: async ({ where, create, update }) => { const cur = rows.get(where.key); const next = cur ? { ...cur, ...update, visits: update.visits ? cur.visits + 1 : cur.visits } : create; rows.set(where.key, next); return next; } }, assistantLog: { create: async () => ({}) } };
  const mem = makeMemory({ prisma });
  const u = mem.forUser('tg:1', { telegramId: '1', name: 'Sara' });
  await u.touch({ visit: true, lang: 'am' }); await u.touch({ visit: true, home: { label: 'CMC', lat: 9, lng: 38.8 } });
  const p = await u.profile();
  assert.match(p, /name: Sara/); assert.match(p, /home: CMC/); assert.match(p, /visits: 2/);
  assert.equal(mem.forUser('ip:1.2.3.4').persistent, false); assert.equal(await mem.forUser('ip:1.2.3.4').profile(), '');
  assert.equal(mem.isMiss('ይህን መረጃ አሁን የለኝም፣ /passport ይመልከቱ።'), true);
  assert.equal(mem.isMiss('ዋጋው ቋሚ ነው።'), false);
  assert.equal(mem.wantsHuman('ከሰው ጋር መነጋገር እፈልጋለሁ'), true);
  assert.equal(mem.wantsHuman('I want to talk to a real person'), true);
  const sent = [];
  let t = 1000; const ho = makeHandover({ sendTg: async (c, x) => sent.push(x), chatId: '99', now: () => t });
  assert.equal(await ho({ userKey: 'tg:1', channel: 'telegram', lang: 'am', message: 'help', reply: 'x', history: [] }), true);
  assert.equal(await ho({ userKey: 'tg:1', channel: 'telegram', message: 'again' }), false, 'rate-limited within 30 min');
  assert.equal(await ho({ userKey: 'tg:1', channel: 'telegram', message: 'again', explicit: true, summary: 'refund' }), true, 'explicit always goes');
  assert.match(sent[0], /Reply: tg:\/\/user\?id=1/); assert.match(sent[1], /Summary: refund/);
});

test('extractMemory backstop parses English, Amharic and Oromo facts', () => {
  const { extractMemory } = require('../assistant/memory');
  assert.deepEqual(extractMemory('Please remember my name is Test Probe and my home is CMC.'), [{ field: 'name', value: 'Test Probe' }, { field: 'home', value: 'CMC' }]);
  assert.deepEqual(extractMemory('remember my home is CMC'), [{ field: 'home', value: 'CMC' }]);
  assert.deepEqual(extractMemory('ስሜ ሳራ ነው። ቤቴ ሲኤምሲ ነው።'), [{ field: 'name', value: 'ሳራ' }, { field: 'home', value: 'ሲኤምሲ' }]);
  assert.deepEqual(extractMemory('manni koo Boolee dha'), [{ field: 'home', value: 'Boolee dha' }]);
  assert.deepEqual(extractMemory('how much to Bole?'), []);
});
