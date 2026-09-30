// Room prices a hotel sends through Bini, and guest ratings from BinaSmart rides (28 Sep 2026).
const test = require('node:test');
const assert = require('node:assert');
const { cleanRooms, roomMin } = require('../hotels/directory');
const cards = require('../public/hotel-cards.js');

test('cleanRooms keeps real rooms and prices, drops the rest', () => {
  const r = cleanRooms([
    { name: 'Standard double', price: 3500 },
    { name: 'Suite <b>', price: '12,000 birr' },
    { name: 'Deluxe', price: 120, currency: 'USD' },
    { name: 'x', price: 3000 },               // name too short
    { name: 'Cheap', price: 50 },             // not a real birr price
    { name: 'Palace', price: 99999, currency: 'USD' },   // not a real dollar price
    'Standard 2000', null,
  ]);
  assert.deepStrictEqual(r.map(x => x.price), ['ETB 3,500', 'ETB 12,000', 'USD 120']);
  assert.strictEqual(r[1].name, 'Suite b');
  assert.deepStrictEqual(cleanRooms('Standard 2000'), []);
  assert.strictEqual(cleanRooms(Array.from({ length: 30 }, (_, i) => ({ name: 'Room ' + i, price: 1000 + i }))).length, 10);
});

test('roomMin gives the cheapest birr room, a dollar one only when there is no birr price', () => {
  assert.strictEqual(roomMin(cleanRooms([{ name: 'Suite', price: 9000 }, { name: 'Deluxe', price: 60, currency: 'USD' }, { name: 'Standard', price: 3500 }])).price, 'ETB 3,500');
  assert.strictEqual(roomMin(cleanRooms([{ name: 'Suite', price: 200, currency: 'USD' }, { name: 'Standard', price: 90, currency: 'USD' }])).price, 'USD 90');
  assert.strictEqual(roomMin([{ name: 'Standard Room', price: 'ETB 2,800' }, { name: 'King Room', price: 'ETB 4,100' }]).price, 'ETB 2,800');
  assert.strictEqual(roomMin([]), null);
});

test('hotel cards show a rider rating and sort by it', () => {
  const l = [{ slug: 'a', name: 'A', photos: 3 }, { slug: 'b', name: 'B', rating: { avg: 4.2, n: 5 } }, { slug: 'c', name: 'C', rating: { avg: 4.8, n: 2 } }];
  assert.deepStrictEqual(cards.sortHotels(l, 'rating').map(x => x.slug), ['c', 'b', 'a']);
  assert.match(cards.hotelCard(l[1]), /class="rt"[^>]*>★ 4\.2 <small>\(5\)<\/small>/);
  assert.doesNotMatch(cards.hotelCard(l[0]), /class="rt"/);
});
