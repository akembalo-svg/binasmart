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

test('a plain "Stop" turns the alerts off (28 Sep 2026: it was answered by Bini and the alerts kept coming)', async () => {
  const sent = [];
  const prisma = fakePrisma([]);
  const tenders = T.makeTenderAlerts({ prisma, api: null, openSince: open, isClosed: shut });
  const api = { sendMessage: async (chat, text, opts) => { sent.push({ text, opts }); return {}; } };
  const bot = makeBinaBot({ api, baseUrl: 'https://bina.et', botUsername: 'bina_smart_bot', tenders });
  const msg = t => ({ message: { chat: { id: 8, type: 'private' }, from: { id: 8 }, text: t } });
  await bot.handleUpdate(msg('/start tenders_disposal'));
  assert.equal(prisma.rows.filter(r => r.active).length, 1);
  await bot.handleUpdate(msg('Stop'));
  assert.match(sent.at(-1).text, /Alerts stopped \(ጨረታ · tenders\)/);
  assert.equal(prisma.rows.filter(r => r.active).length, 0);
  for (const w of ['stop', 'STOP.', 'unsubscribe', 'አቁም', 'ይቁም።']) assert.match(w, /^(\/?stop|stop (it|all|alerts?|messages?|sending)|unsubscribe|cancel alerts?|አቁም|ይቁም|አቁሙ|ማሳወቂያ(ውን)? አቁም)[\s.!።]*$/i, w);
});

test('"Stopjob" / "stop tenders" without the slash, and clear opt-outs like "Get off" (1 Oct 2026 real chat)', async () => {
  const sent = [], asked = [];
  const prisma = fakePrisma([]);
  const tenders = T.makeTenderAlerts({ prisma, api: null, openSince: open, isClosed: shut });
  let jobSubs = 0;
  const jobs = { subscribe: async () => { jobSubs++; return { ok: true, field: 'health' }; }, stop: async () => { const n = jobSubs; jobSubs = 0; return n; }, listFor: async () => [] };
  const api = { sendMessage: async (chat, text, opts) => { sent.push({ text, opts }); return {}; } };
  const fetchImpl = async (url, o) => { asked.push(JSON.parse(o.body).message); return { ok: true, json: async () => ({ reply: 'Bini here' }) }; };
  const bot = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://x/api/assistant', fetchImpl, botUsername: 'bina_smart_bot', tenders, jobs });
  const msg = t => ({ message: { chat: { id: 9, type: 'private' }, from: { id: 9 }, text: t } });
  await bot.handleUpdate(msg('/start jobs_health')); await bot.handleUpdate(msg('/start tenders_supply'));
  await bot.handleUpdate(msg('Stopjob'));
  assert.match(sent.at(-1).text, /Job alerts stopped/); assert.equal(jobSubs, 0);
  assert.equal(prisma.rows.filter(r => r.active).length, 1, '"Stopjob" leaves the tender alert on');
  await bot.handleUpdate(msg('stop tenders'));
  assert.match(sent.at(-1).text, /Tender alerts stopped/); assert.equal(prisma.rows.filter(r => r.active).length, 0);
  await bot.handleUpdate(msg('Get off'));
  assert.match(sent.at(-1).text, /No job or tender alerts are on/); assert.deepEqual(asked, [], 'never reached Bini');
  await bot.handleUpdate(msg('/start jobs_health'));
  await bot.handleUpdate(msg('please unsubscribe me.'.replace('please ', '')));
  assert.match(sent.at(-1).text, /Alerts stopped \(ሥራ · jobs\)/);
  await bot.handleUpdate(msg('Where do I get off for Bole?'));
  assert.deepEqual(asked, ['Where do I get off for Bole?'], 'a ride question with "get off" in it goes to Bini');
});
