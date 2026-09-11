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

test('list_events reads shows on sale: price_from, seats_left, url per show', async () => {
  const db = fakeDb(sql => /FROM "Show"/.test(sql)
    ? [{ id: 'sh1', slug: 'jazz', title: 'Jazz Night', titleAm: null, kind: 'CONCERT', venue: 'Skylight', venueAm: null, address: 'Bole', hall: 'Main', capacity: 250, layout: { kind: 'ga' }, startsAt: '2026-10-01T18:00:00Z', prices: { VIP: 1500, Regular: 500 }, sold: 10, descr: null, runtimeMin: null }]
    : []);
  const r = out(await tools(db).list_events({}));
  assert.equal(r.events[0].price_from_etb, 500);
  assert.equal(r.events[0].seats_left, 240);
  assert.equal(r.events[0].general_admission, true);
  assert.equal(r.events[0].url, 'https://bina.et/cinema/sh1');
});

test('list_films: free vs rental, urls, search, empty', async () => {
  const db = fakeDb((sql, params) => /FROM "Film"/.test(sql)
    ? (params[0] && !/ታሪ|tari/i.test(params[0]) ? [] : [{ slug: 'tarike-2024', title: 'Tarike', titleAm: 'ታሪኬ', year: 2024, runtimeMin: null, rating: null, language: 'Amharic', genre: 'Drama', descr: 'x', posterUrl: 'https://i.ytimg.com/vi/v/maxresdefault.jpg', sourceKind: 'youtube', priceEtb: 0, rentHours: 48, views: 3, createdAt: '2026-09-04' },
        { slug: 'paid', title: 'Paid', titleAm: null, year: 2025, runtimeMin: 100, rating: 'PG-13', language: 'Amharic', genre: null, descr: null, posterUrl: null, sourceKind: 'mp4', priceEtb: 80, rentHours: 48, views: 0, createdAt: '2026-09-03' }])
    : []);
  const r = out(await tools(db).list_films({}));
  assert.equal(r.count, 2); assert.equal(r.films[0].free, true); assert.equal(r.films[0].url, 'https://bina.et/watch/tarike-2024'); assert.equal(r.films[0].title_am, 'ታሪኬ');
  assert.deepEqual(r.films[1].rental, { price_etb: 80, hours: 48 }); assert.equal(r.films[1].source, 'stream');
  assert.equal(out(await tools(db).list_films({ query: 'ታሪኬ' })).count, 2);
  const none = await tools(db).list_films({ query: 'zzz' });
  assert.equal(none.isError, true); assert.match(none.content[0].text, /No film matching/);
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

// 2026-09-12. Bini is required to disclose demo data (server.js, ASSIST_FACTS) and bina.et/hotel now
// shows a banner. The MCP server — which is how OTHER assistants read BinaSmart — disclosed nothing.
// The only marker was subCity reading "Demo hotel — sample data", i.e. a location field.
test('the demo hotel is flagged for the assistant reading it, not just described', async () => {
  const db = fakeDb((sql) => {
    if (/FROM "Building"\s+WHERE "qrSlug"/.test(sql)) return [{ id: 'b1', name: 'Bina Grand Hotel', nameAm: null, city: 'Addis Ababa', subCity: 'Demo hotel — sample data', buildingType: 'HOTEL' }];
    if (/FROM "RoomType"/.test(sql)) return [{ name: 'Standard', nameAm: null, description: null, pricePerNight: 4500, capacity: 2, amenities: [], totalRooms: 8 }];
    return [];
  });
  const h = out(await tools(db).get_hotel_rooms({ slug: 'bina-grand-hotel' }));
  assert.equal(h.demo, true);
  assert.match(h.demo_notice, /NOT A REAL BUSINESS/);
});

// This is the one that can cost money. The tool's own description tells the caller that coords can be
// passed to quote_ride, so an assistant asked to "book a ride to my hotel" could put a real driver on
// the road to a building that is sample data.
test('a demo building is flagged in search_places, where its coords feed quote_ride', async () => {
  const db = fakeDb((sql) => {
    if (/FROM "Building" b\s+WHERE/.test(sql)) return [
      { name: 'Bina Grand Hotel', nameAm: null, qrSlug: 'bina-grand-hotel', city: 'Addis Ababa', subCity: 'Demo hotel — sample data', lat: 9.0054, lng: 38.7636, buildingType: 'HOTEL' },
      { name: 'Skylight Hotel', nameAm: null, qrSlug: 'skylight', city: 'Addis Ababa', subCity: 'Bole', lat: 9.0, lng: 38.79, buildingType: 'HOTEL' }];
    return [];
  });
  const r = out(await tools(db).search_places({ query: 'hotel' }));
  const [demo, real] = ['bina-grand-hotel', 'skylight'].map(sl => r.results.find(x => x.slug === sl));
  assert.equal(demo.demo, true, 'the seeded one is flagged');
  assert.ok(demo.coords, 'and still carries coords, which is exactly why the flag has to be there');
  assert.equal(real.demo, undefined, 'a real building carries no flag and no notice');
  assert.equal(real.demo_notice, undefined);
});

// The sharpest one. An assistant asked where to take a sick child at night could read nine
// departments, consultation fees and an "Emergency — Open 24/7" desk, and send someone to a hospital
// that does not exist. The notice names the real emergency numbers instead.
test('the demo hospital says it does not exist, and gives the real emergency numbers', async () => {
  const db = fakeDb((sql) => {
    if (/FROM "Building"\s+WHERE "qrSlug"/.test(sql)) return [{ id: 'b1', name: 'Bina General Hospital', nameAm: null, city: 'Addis Ababa', subCity: 'Demo hospital — sample data', buildingType: 'HOSPITAL' }];
    if (/FROM "Department"/.test(sql)) return [{ id: 'd1', name: 'Emergency', nameAm: null, floor: 0, room: 'E-01', fee: null, doctors: ['Open 24/7'], openHours: '24/7', slotsPerDay: 999 }];
    if (/FROM "Appointment"/.test(sql)) return [];
    return [];
  });
  const d = out(await tools(db).get_hospital_departments({ slug: 'bina-general-hospital', date: '2026-09-12' }));
  assert.equal(d.demo, true);
  assert.match(d.demo_notice, /NOT A REAL HOSPITAL/);
  assert.match(d.demo_notice, /907/, 'ambulance');
  assert.match(d.demo_notice, /991/, 'police');
  assert.match(d.demo_notice, /939/, 'fire');
});

// The hospital keeps its appointment book in Addis Ababa. toISOString() is UTC, so for three hours
// every night the default date was yesterday and slots_left counted the wrong day.
test('the hospital default date is the day in Addis Ababa, not the server day', async () => {
  let asked = null;
  const db = fakeDb((sql, params) => {
    if (/FROM "Building"\s+WHERE "qrSlug"/.test(sql)) return [{ id: 'b1', name: 'H', nameAm: null, city: 'Addis Ababa', subCity: 'Bole', buildingType: 'HOSPITAL' }];
    if (/FROM "Department"/.test(sql)) return [{ id: 'd1', name: 'OPD', nameAm: null, floor: 0, room: 'G', fee: 300, doctors: [], openHours: '8-17', slotsPerDay: 10 }];
    if (/FROM "Appointment"/.test(sql)) { asked = params[1]; return []; }
    return [];
  });
  const d = out(await tools(db).get_hospital_departments({ slug: 'h' }));
  const addis = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' });
  assert.equal(d.date, addis);
  assert.equal(asked, addis, 'and the booked-slots query is asked about the same day');
});
