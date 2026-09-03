import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDirectoryTools, restaurantSlug } from '../tools/directory.mjs';

const json = d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
const wrap = (_n, fn) => fn;
const out = r => JSON.parse(r.content[0].text);

function fakeDb(handler) { return { query: async (sql, params) => ({ rows: handler(sql, params) }) }; }
function tools(db) { const reg = {}; registerDirectoryTools({ registerTool: (n, _d, f) => { reg[n] = f; } }, { db, wrap, json }); return reg; }

test('restaurantSlug matches the /restaurant/:slug lookup (dashes for spaces)', () => {
  assert.equal(restaurantSlug('Yod Abyssinia'), 'yod-abyssinia');
});

test('search_places merges buildings and shops, flags hotel/hospital, links pages', async () => {
  const db = fakeDb((sql) => {
    if (/FROM "Building" b\s+WHERE/.test(sql)) return [{ name: 'Skylight Hotel', nameAm: 'ስካይላይት', qrSlug: 'skylight', city: 'Addis Ababa', subCity: 'Bole', lat: 9.0, lng: 38.79, buildingType: 'HOTEL' }];
    if (/FROM "Shop" s/.test(sql)) return [{ name: 'Kaldis Coffee', nameAm: null, category: 'CAFE', phone: '0911000000', isOpenNow: true, avgRating: 4.5, reviewCount: 12, unit: 'G-01', building: 'Edna Mall', buildingAm: 'ኤድና', qrSlug: 'edna', lat: null, lng: null, buildingType: 'COMMERCIAL' }];
    return [];
  });
  const r = out(await tools(db).search_places({ query: 'ka', limit: 10 }));
  assert.equal(r.count, 2);
  const hotel = r.results.find(x => x.kind === 'building');
  assert.equal(hotel.is_hotel, true); assert.equal(hotel.is_hospital, false);
  assert.equal(hotel.url, 'https://bina.et/hotel/skylight');
  assert.deepEqual(hotel.coords, { lat: 9.0, lng: 38.79 });
  const shop = r.results.find(x => x.kind === 'shop');
  assert.equal(shop.url, 'https://bina.et/b/edna'); assert.equal(shop.coords, undefined);
  assert.equal(shop.category, 'cafe'); assert.equal(shop.building, 'Edna Mall'); assert.equal(shop.unit, 'G-01');
});

test('search_places: restaurant links to its menu page; category filter is passed as a param', async () => {
  let seenParams;
  const db = fakeDb((sql, params) => {
    if (/FROM "Shop" s/.test(sql)) { seenParams = params; return [{ name: 'Yod Abyssinia', category: 'RESTAURANT', phone: '0911', unit: '1', building: 'Bole', qrSlug: 'bole', buildingType: 'COMMERCIAL' }]; }
    return [];
  });
  const r = out(await tools(db).search_places({ query: 'yod', category: 'restaurant' }));
  assert.equal(r.results[0].url, 'https://bina.et/restaurant/yod-abyssinia');
  assert.ok(seenParams.includes('RESTAURANT'));
});

test('search_places rejects an unknown category', async () => {
  const r = await tools(fakeDb(() => [])).search_places({ query: 'x', category: 'zoo' });
  assert.equal(r.isError, true);
});

test('list_events computes price_from and seats_left', async () => {
  const db = fakeDb(sql => /FROM "Event"/.test(sql)
    ? [{ slug: 'jazz', title: 'Jazz Night', titleAm: null, type: 'CONCERT', venue: 'Skylight', city: 'Addis Ababa', startsAt: '2026-10-01T18:00:00Z', durationMin: 120, tiers: [{ name: 'VIP', price: 1500, seats: 50 }, { name: 'Regular', price: 500, seats: 200 }], sold: [{ tier: 'VIP', qty: 10 }] }]
    : []);
  const r = out(await tools(db).list_events({}));
  assert.equal(r.events[0].price_from_etb, 500);
  assert.equal(r.events[0].seats_left, 240);
  assert.equal(r.events[0].url, 'https://bina.et/events');
});

test('get_hotel_rooms and get_hospital_departments', async () => {
  const db = fakeDb((sql, params) => {
    if (/FROM "Building"\s+WHERE "qrSlug"/.test(sql)) return params[0] === 'nope' ? [] : [{ id: 'b1', name: 'Skylight', nameAm: null, city: 'Addis Ababa', subCity: 'Bole', buildingType: params[0] === 'skylight' ? 'HOTEL' : 'HOSPITAL' }];
    if (/FROM "RoomType"/.test(sql)) return [{ name: 'Deluxe', nameAm: null, description: 'City view', pricePerNight: 4500, capacity: 2, amenities: ['wifi'], totalRooms: 10 }];
    if (/FROM "Department"/.test(sql)) return [{ id: 'd1', name: 'Cardiology', nameAm: null, floor: 2, room: '204', fee: 500, doctors: ['Dr A'], openHours: '8-17', slotsPerDay: 20 }];
    if (/FROM "Appointment"/.test(sql)) return [{ departmentId: 'd1', n: '5' }];
    return [];
  });
  const t = tools(db);
  const h = out(await t.get_hotel_rooms({ slug: 'skylight' }));
  assert.equal(h.rooms[0].price_per_night_etb, 4500); assert.equal(h.book_url, 'https://bina.et/hotel/skylight');
  const d = out(await t.get_hospital_departments({ slug: 'hosp', date: '2026-09-10' }));
  assert.equal(d.departments[0].slots_left, 15); assert.equal(d.book_url, 'https://bina.et/hospital/hosp');
  const nf = await t.get_hotel_rooms({ slug: 'nope' });
  assert.equal(nf.isError, true);
});

test('database failure → "directory unavailable" tool error, never a throw', async () => {
  const db = { query: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await tools(db).list_events({});
  assert.equal(r.isError, true); assert.match(r.content[0].text, /directory .*unavailable/i);
});
