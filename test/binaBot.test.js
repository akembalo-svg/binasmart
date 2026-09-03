'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../ride/binaBot');

function fakeApi() {
  const sent = [];
  return { sent, sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; }, answerCallbackQuery: async () => true };
}
function bot(biniReply, opts) {
  const api = fakeApi(); const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), ip: init.headers['x-real-ip'] }); return { json: async () => (biniReply === null ? {} : { reply: biniReply }) }; };
  const b = makeBinaBot(Object.assign({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl, botUsername: 'bina_smart_bot' }, opts || {}));
  return { api, calls, b };
}
const msg = text => ({ message: { chat: { id: 7 }, text } });

test('/start shows the service menu as web_app buttons plus share', async () => {
  const { api, b } = bot('x');
  await b.handleUpdate(msg('/start'));
  const kb = api.sent[0].extra.reply_markup.inline_keyboard;
  const urls = kb.flat().map(x => x.web_app && x.web_app.url).filter(Boolean);
  assert.ok(urls.includes('https://bina.et/ride')); assert.ok(urls.includes('https://bina.et/events')); assert.ok(urls.includes('https://bina.et/guides'));
  assert.ok(kb.at(-1)[0].url.includes('t.me/share'));
  assert.match(api.sent[0].text, /BinaSmart/);
});

test('a typed question goes to Bini with per-chat history and a synthetic X-Real-IP; reply gets a menu button', async () => {
  const { api, calls, b } = bot('TIN ማውጣት ነጻ ነው። ይመልከቱ [መመሪያ](/tin-registration-ethiopia)');
  await b.handleUpdate(msg('TIN እንዴት አወጣለሁ?'));
  assert.equal(calls[0].ip, 'tg-7');
  assert.deepEqual(calls[0].body.history, []);
  assert.equal(calls[0].body.message, 'TIN እንዴት አወጣለሁ?');
  assert.match(api.sent[0].text, /መመሪያ — https:\/\/bina\.et\/tin-registration-ethiopia/);
  assert.equal(api.sent[0].extra.reply_markup.inline_keyboard.at(-1)[0].callback_data, 'menu');
  await b.handleUpdate(msg('and VAT?'));
  assert.equal(calls[1].body.history.length, 2, 'previous user+assistant turns are sent');
});

test('ride-related answers get a Book a ride web_app button', async () => {
  const { api, b } = bot('To get the fixed price, open /ride and enter your destination.');
  await b.handleUpdate(msg('how much is a taxi to Bole?'));
  const first = api.sent[0].extra.reply_markup.inline_keyboard[0][0];
  assert.equal(first.web_app.url, 'https://bina.et/ride');
  assert.match(api.sent[0].text, /https:\/\/bina\.et\/ride/);
});

test('/ride /events commands open the page; unknown command explains; Bini failure gives a polite fallback', async () => {
  const { api, b } = bot(null);
  await b.handleUpdate(msg('/events'));
  assert.equal(api.sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/events');
  await b.handleUpdate(msg('/whatever'));
  assert.match(api.sent[1].text, /Unknown command/);
  await b.handleUpdate(msg('hello'));
  assert.match(api.sent[2].text, /busy/i);
});

test('menu callback re-sends the service menu', async () => {
  const { api, b } = bot('x');
  await b.handleUpdate({ callback_query: { id: 'c1', data: 'menu', message: { chat: { id: 7 } } } });
  assert.ok(api.sent[0].extra.reply_markup.inline_keyboard.flat().some(x => x.web_app && x.web_app.url === 'https://bina.et/ride'));
});

test('forTelegram expands relative links and strips bold', () => {
  const { b } = bot('x');
  assert.equal(b.forTelegram('See **/guides** and [Ride](/ride) or https://bina.et/ai.'), 'See https://bina.et/guides and Ride — https://bina.et/ride or https://bina.et/ai.');
});
