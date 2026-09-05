'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

function bot(linkShop) {
  const sent = [];
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return {}; }, answerCallbackQuery: async () => ({}) };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://x', fetchImpl: async () => ({ json: async () => ({}) }), botUsername: 'bina_smart_bot', linkShop });
  return { sent, b };
}
const msg = (text, id = 8825386029) => ({ message: { chat: { id }, text, from: { first_name: 'T' } } });

test('/start shop_<id> links the chat to the shop and confirms in Amharic + English', async () => {
  const calls = [];
  const { sent, b } = bot(async (shopId, chatId) => { calls.push({ shopId, chatId }); return { id: shopId, name: 'Kaldis Café', nameAm: 'ካልዲስ' }; });
  await b.handleUpdate(msg('/start shop_cmt123abc'));
  assert.deepEqual(calls, [{ shopId: 'cmt123abc', chatId: '8825386029' }]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ካልዲስ/);
  assert.match(sent[0].text, /Orders and requests/);
});

test('an unknown shop id gets a polite not-found, and nothing is linked', async () => {
  const { sent, b } = bot(async () => null);
  await b.handleUpdate(msg('/start shop_nope'));
  assert.match(sent[0].text, /not found/i);
});

test('plain /start still shows the menu when linkShop is wired', async () => {
  const { sent, b } = bot(async () => null);
  await b.handleUpdate(msg('/start'));
  assert.ok(sent[0].extra && sent[0].extra.reply_markup.inline_keyboard.length > 2);
});

test('without a linkShop dependency the command falls back to the ordinary welcome', async () => {
  const { sent, b } = bot(undefined);
  await b.handleUpdate(msg('/start shop_abc'));
  assert.match(sent[0].text, /BinaSmart/);
});
