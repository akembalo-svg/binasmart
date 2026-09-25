'use strict';
// tenders/alerts.js and the bot's /start tenders_<kind>. Every tender and chat below is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../tenders/alerts');
const { makeBinaBot } = require('../ride/binaBot');

test('every spelling of a kind maps to one slug', () => {
  assert.equal(T.catOf('አቅርቦት Supply'), 'supply');
  assert.equal(T.catOf('Supply'), 'supply');
  assert.equal(T.catOf('ግንባታ Construction'), 'construction');
  assert.equal(T.catOf('ማማከር Consultancy'), 'consultancy');
  assert.equal(T.catOf('ሽያጭ ጨረታ Disposal auction'), 'disposal');
  assert.equal(T.catOf('ትራንስፖርት Transport'), 'transport');
  assert.equal(T.catOf('something else'), null);
});

function fakePrisma(tenders) {
  const rows = [];
  return { rows, tender: { findMany: async ({ where }) => tenders.filter(t => t.publishedAt > where.publishedAt.gt) },
    tenderAlert: {
      upsert: async ({ where, create, update }) => { let r = rows.find(x => x.chatId === where.chatId_cat.chatId && x.cat === where.chatId_cat.cat);
        if (r) Object.assign(r, update); else { r = { id: 'a' + rows.length, ...create, active: true, lastSentAt: new Date() }; rows.push(r); } return r; },
      updateMany: async ({ where, data }) => { const hit = rows.filter(r => r.chatId === where.chatId && r.active); hit.forEach(r => Object.assign(r, data)); return { count: hit.length }; },
      findMany: async () => rows.filter(r => r.active), update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), { lastSentAt: data.lastSentAt || rows.find(r => r.id === where.id).lastSentAt }) } };
}
const open = () => new Date(0), shut = () => false;

test('a subscriber gets only new, open tenders of their kind, never the archive', async () => {
  const past = new Date(Date.now() - 864e5), future = new Date(Date.now() + 864e5);
  const tenders = [
    { slug: 'old-supply', title: 'Old supply', org: 'Sample Org', category: 'Supply', deadline: future, publishedAt: past },
    { slug: 'new-supply', title: 'Supply of sample chairs', org: 'Sample Org', category: 'አቅርቦት Supply', deadline: future, publishedAt: future },
    { slug: 'new-works', title: 'Sample road works', org: 'Sample City', category: 'ግንባታ Construction', deadline: future, publishedAt: future },
  ];
  const prisma = fakePrisma(tenders);
  const A = T.makeTenderAlerts({ prisma, api: null, openSince: open, isClosed: shut });
  assert.equal((await A.subscribe({ chatId: 1, cat: 'supply' })).ok, true);
  assert.equal((await A.subscribe({ chatId: 1, cat: 'nonsense' })).ok, false);
  const due = await A.dueFor(prisma.rows[0]);
  assert.deepEqual(due.map(t => t.slug), ['new-supply']);
  const text = A.compose(prisma.rows[0], due);
  assert.match(text, /1 አዲስ ጨረታ<\/b> — አቅርቦት/);
  assert.match(text, /bina\.et\/tenders\/new-supply/);
  assert.match(text, /\/stoptenders/);
});

test('the bot subscribes on /start tenders_<kind>, lists on /tenders, stops on /stoptenders', async () => {
  const sent = [];
  const prisma = fakePrisma([]);
  const tenders = T.makeTenderAlerts({ prisma, api: null, openSince: open, isClosed: shut });
  const api = { sendMessage: async (chat, text, opts) => { sent.push({ text, opts }); return {}; } };
  const bot = makeBinaBot({ api, baseUrl: 'https://bina.et', botUsername: 'bina_smart_bot', tenders });
  const msg = t => ({ message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: t } });
  await bot.handleUpdate(msg('/start tenders_construction'));
  assert.match(sent.at(-1).text, /ተመዝግበዋል — <b>ግንባታ<\/b>/);
  assert.equal(prisma.rows[0].cat, 'construction');
  await bot.handleUpdate(msg('/tenders'));
  assert.match(sent.at(-1).text, /አሁን የሚደርስዎት፦ ግንባታ/);
  assert.ok(sent.at(-1).opts.reply_markup.inline_keyboard.flat().some(b => /start=tenders_supply/.test(b.url || '')));
  await bot.handleUpdate(msg('/stoptenders'));
  assert.match(sent.at(-1).text, /Tender alerts stopped/);
});
