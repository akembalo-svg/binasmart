// Bini's search_shops also finds what shop owners posted on bina.et/shop (30 Sep 2026).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const STORE = path.join(os.tmpdir(), 'shop-search-test-' + process.pid + '.json');
process.env.SHOP_POSTS_FILE = STORE;
const shop = (name, area, phone) => ({ name, area, phone, whatsapp: true });
fs.writeFileSync(STORE, JSON.stringify({ posts: [
  { id: 'a1', status: 'live', approvedAt: '2026-09-30T10:00:00Z', kind: 'product', category: 'fashion', title: 'Party dress', price: '1,800 birr', shop: shop('Sami Boutique', 'Merkato', '+251900000041'), photos: [] },
  { id: 'a2', status: 'live', approvedAt: '2026-09-30T11:00:00Z', kind: 'offer', category: 'phones', title: 'Samsung A15, 10% off', price: '14,500 birr', shop: shop('Abel Mobile', 'Bole', '+251900000042'), photos: [] },
  { id: 'a3', status: 'pending', createdAt: '2026-09-30T12:00:00Z', kind: 'product', category: 'fashion', title: 'Wedding dress', price: '9,000 birr', shop: shop('Hidden', 'Piassa', '+251900000043'), photos: [] },
  { id: 'a4', status: 'live', approvedAt: '2026-09-30T09:00:00Z', kind: 'product', category: 'home', title: 'ሶፋ 3 ሰው', price: '25,000 birr', shop: shop('ቤቴ ፈርኒቸር', 'ሲኤምሲ', '+251900000044'), photos: [] },
] }));
const { searchLive } = require('../shops/posts');
test.after(() => fs.rmSync(STORE, { force: true }));

test('an English word finds the post', () => {
  assert.deepStrictEqual(searchLive('where can I buy a dress').map(p => p.id), ['a1']);
});
test('an Amharic word finds an English post through its category', () => {
  assert.deepStrictEqual(searchLive('ለእህቴ ልደት ቀሚስ የት አገኛለሁ').map(p => p.id), ['a1']);
  assert.deepStrictEqual(searchLive('ሞባይል').map(p => p.id), ['a2']);
});
test('Amharic posts are found by Amharic and English words', () => {
  assert.deepStrictEqual(searchLive('ሶፋ').map(p => p.id), ['a4']);
  assert.deepStrictEqual(searchLive('sofa').map(p => p.id), ['a4']);
});
test('pending posts are never returned', () => {
  assert.ok(!searchLive('wedding dress').some(p => p.id === 'a3'));
  assert.ok(!searchLive('').some(p => p.id === 'a3'));
});
test('no match returns nothing, and the public shape carries the shop phone', () => {
  assert.deepStrictEqual(searchLive('tractor'), []);
  const [p] = searchLive('Samsung');
  assert.strictEqual(p.shop, 'Abel Mobile'); assert.strictEqual(p.phone, '+251900000042'); assert.ok(!('owner' in p) && !('token' in p));
});
