'use strict';
// /mypages (1 Oct 2026): every page tied to one proven phone, and the bot's way of getting that phone. Invented people,
// places and numbers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mypages-'));
Object.assign(process.env, { RESTAURANTS_FILE: DIR + '/r.json', HEALTH_FILE: DIR + '/h.json', SHOP_POSTS_FILE: DIR + '/s.json' });
fs.writeFileSync(DIR + '/r.json', JSON.stringify({ entries: [{ restaurant: 'Sample Trattoria', phone: '+251900000071', status: 'live' }, { restaurant: 'Other Cafe', phone: '+251900000079', status: 'live' }] }));
fs.writeFileSync(DIR + '/h.json', JSON.stringify({ entries: [{ type: 'doctor', name: 'Dr Sample', phone: '+251900000071', status: 'pending' }] }));
fs.writeFileSync(DIR + '/s.json', JSON.stringify({ posts: [{ status: 'live', shop: { phone: '+251900000071' } }, { status: 'sold', shop: { phone: '+251900000071' } }, { status: 'removed', shop: { phone: '+251900000071' } }] }));
const MP = require('../owners/mypages');
const { makeBinaBot } = require('../ride/binaBot');
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const ends = (v, w) => !w || !w.endsWith || String(v).endsWith(w.endsWith);
const prisma = {
  propertyListing: { findMany: async ({ where }) => [{ agencyPhone: '+251900000071', active: true, details: { submittedVia: 'bini', review: { status: 'approved' } } },
    { agencyPhone: '+251900000071', active: false, details: { submittedVia: 'bini', review: { status: 'approved' }, closed: { as: 'rented' } } }].filter(r => ends(r.agencyPhone, where.agencyPhone)) },
  hotelClaim: { findMany: async ({ where }) => [{ placeRef: 'node/1', placeName: 'Sample Grand Hotel', slug: 'sample-grand-hotel-n1', phone: '0900000071', status: 'approved' }].filter(c => ends(c.phone, where.phone)) },
  driver: { findFirst: async ({ where }) => (ends('+251900000071', where.phone) ? { name: 'Sample Driver', status: 'pending' } : null) } };

test('every page tied to the number, whatever form it was typed in', async () => {
  const pages = await MP.findMyPages({ prisma, phone: '0900 000 071' });
  assert.deepEqual(pages.map(p => p.icon + ' ' + p.name + ' — ' + p.status), [
    '🍽 Sample Trattoria — live', '👩🏾‍⚕️ Dr Sample — pending', '🛍 2 shop posts — 1 live, 1 sold', '🏠 2 home listings — 1 live, 1 rented / sold',
    '🏨 Sample Grand Hotel — confirmed', '🚗 Driver: Sample Driver — pending']);
  assert.equal(pages[0].url, 'https://bina.et/restaurants/dashboard'); assert.equal(pages[1].url, null, 'pending: nothing to manage yet');
  assert.equal(pages[4].url, 'https://bina.et/hotels/dashboard');
  const text = MP.myPagesText('+251900000071', pages);
  assert.match(text, /Your pages \(…0071\)/); assert.match(text, /bina\.et\/shop\/dashboard/); assert.match(text, /waiting for our team/);
  assert.doesNotMatch(text, /Other Cafe/);
  assert.match(MP.myPagesText('+251900000099', []), /No page or listing is linked to …0099/);
  assert.deepEqual(await MP.findMyPages({ prisma, phone: '123' }), [], 'not a phone: nothing');
});

test('the bot: /mypages answers from the proven number, or asks for the user\'s OWN contact', async () => {
  const sent = [], calls = [], asked = [];
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ text, extra }); return {}; }, answerCallbackQuery: async () => ({}) };
  let proven = null;
  const mypages = async (tgId, shared) => { calls.push([String(tgId), shared || null]); const ph = shared || proven; return ph ? { phone: ph, text: 'PAGES for ' + ph } : null; };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://x', fetchImpl: async (u, o) => { asked.push(o && o.body); return { json: async () => ({ reply: 'bini' }) }; }, botUsername: 'bina_smart_bot', mypages });
  const from = { id: 501, first_name: 'S' }, msg = m => ({ message: Object.assign({ chat: { id: 501, type: 'private' }, from }, m) });
  await b.handleUpdate(msg({ text: '/mypages' }));
  assert.match(sent.at(-1).text, /share your phone number/); assert.equal(sent.at(-1).extra.reply_markup.keyboard[0][0].request_contact, true);
  await b.handleUpdate(msg({ contact: { phone_number: '251900000079', user_id: 999 } }));
  assert.match(sent.at(-1).text, /your OWN number/, 'someone else\'s contact is refused');
  await b.handleUpdate(msg({ text: '/mypages' }));
  await b.handleUpdate(msg({ contact: { phone_number: '251900000071', user_id: 501 } }));
  assert.equal(sent.at(-1).text, 'PAGES for 251900000071'); assert.deepEqual(calls.at(-1), ['501', '251900000071']);
  proven = '+251900000071';
  await b.handleUpdate(msg({ text: 'My pages' }));
  assert.equal(sent.at(-1).text, 'PAGES for +251900000071', 'a proven number answers at once');
  assert.deepEqual(asked, [], 'none of this went to Bini');
});
