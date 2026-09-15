'use strict';
// The ✅ / ✖ buttons in @bina_smart_bot: how a prepared action is shown, what a press carries, and what the bot does
// with the answer. A fake Telegram API and a fake action service: nothing is sent and nothing runs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

const ID = 'A'.repeat(22);
const CARD = { text: 'ቅድመ እይታ · Preview', buttons: [{ verb: 'confirm', label: '✅ ላክ · Confirm' }, { verb: 'cancel', label: '✖ ሰርዝ · Cancel' }] };
const SCOPE = { buildingIds: ['b1'], roles: { b1: 'owner' }, mode: 'owner' };

function harness({ answer = async () => ({ reply: CARD.text, ownerAction: { id: ID, kind: 'message', status: 'pending', ownerConfirms: false, buttons: CARD.buttons } }),
  press = async () => ({ ok: true, status: 'done', id: ID, toast: '✅', card: { text: 'ተልኳል · Sent', buttons: [] },
    edits: [{ chatId: '42', messageId: 7, id: ID, text: 'ተልኳል · Sent', buttons: [] }] }),
  ownerCards = async () => [], pressThrows = false } = {}) {
  const sent = [], edited = [], answered = [], attached = [];
  const api = {
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: 100 + sent.length }; },
    editMessageText: async (chat, id, text, extra) => { edited.push({ chat, id, text, extra }); return { message_id: id }; },
    answerCallbackQuery: async (id, text) => { answered.push({ id, text }); return true; },
    sendChatAction: async () => true,
  };
  const owner = {
    access: { scopeFor: async () => SCOPE, linkFromContact: async () => ({ ok: false }), unlink: async () => true, setMode: async () => true },
    answer, health: async () => 'HEALTH',
    actions: {
      press: async a => { if (pressThrows) throw new Error('db down'); return press(a); },
      attachCard: async (id, chatId, messageId) => { attached.push([id, String(chatId), messageId]); return true; },
      ownerCards,
    },
  };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant',
    fetchImpl: async () => ({ json: async () => ({ reply: 'customer bini' }) }), botUsername: 'bina_smart_bot', internalKey: 'k', owner });
  return { sent, edited, answered, attached, b };
}
const pm = (text, chatId = 42) => ({ message: { chat: { id: chatId, type: 'private' }, from: { id: 42, first_name: 'T' }, text } });
const press = (data, { chatId = 42, fromId = 42, type = 'private' } = {}) =>
  ({ callback_query: { id: 'cb1', data, from: { id: fromId }, message: { chat: { id: chatId, type }, message_id: 7 } } });

test('a prepared action is sent with its two buttons, and the card is remembered for the edit', async () => {
  const h = harness();
  await h.b.handleUpdate(pm('ለሁሉም ተከራዮች መልእክት ላክ፦ ነገ ውሃ ይቋረጣል'));
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].text, CARD.text);
  assert.deepEqual(h.sent[0].extra.reply_markup.inline_keyboard, [[
    { text: '✅ ላክ · Confirm', callback_data: 'oa:c:' + ID },
    { text: '✖ ሰርዝ · Cancel', callback_data: 'oa:x:' + ID }]]);
  assert.deepEqual(h.attached, [[ID, '42', 101]]);
});

test('an ordinary answer keeps the dashboard button it always had', async () => {
  const h = harness({ answer: async () => 'ስንት ክፍል ባዶ ነው?' });
  await h.b.handleUpdate(pm('ስንት ክፍል ባዶ ነው?'));
  assert.equal(h.sent[0].extra.reply_markup.inline_keyboard[0][0].text, '🏢 ዳሽቦርድ · Dashboard');
  assert.deepEqual(h.attached, []);
});

test('an action prepared by staff is answered to them, and the card with the buttons goes to the owner\'s chat', async () => {
  const h = harness({
    answer: async () => ({ reply: 'ለባለቤቱ ተልኳል', ownerAction: { id: ID, kind: 'message', status: 'pending', ownerConfirms: true, buttons: [] } }),
    ownerCards: async () => [{ chatId: '77', text: CARD.text, buttons: CARD.buttons }],
  });
  await h.b.handleUpdate(pm('ለሁሉም ተከራዮች መልእክት ላክ፦ ውሃ የለም'));
  assert.deepEqual(h.sent.map(x => [String(x.chat), x.text]), [['42', 'ለባለቤቱ ተልኳል'], ['77', CARD.text]]);
  assert.deepEqual(h.sent[0].extra.reply_markup.inline_keyboard[0][0].text, '🏢 ዳሽቦርድ · Dashboard', 'the staff member gets no buttons');
  assert.deepEqual(h.sent[1].extra.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['oa:c:' + ID, 'oa:x:' + ID]);
  assert.deepEqual(h.attached, [[ID, '77', 102]]);
});

test('✅ answers the button at once, presses on the server, and edits every card with the result', async () => {
  const calls = [];
  const h = harness({ press: async a => { calls.push(a); return { ok: true, status: 'done', id: ID, toast: '✅ ተልኳል',
    card: { text: 'ተልኳል · Sent', buttons: [] },
    edits: [{ chatId: '42', messageId: 7, id: ID, text: 'ተልኳል · Sent', buttons: [] }, { chatId: '77', messageId: 9, id: ID, text: 'ተልኳል · Sent', buttons: [] }] }; } });
  await h.b.handleUpdate(press('oa:c:' + ID));
  assert.deepEqual(calls, [{ id: ID, verb: 'confirm', actor: { channel: 'owner-telegram', telegramId: '42', chatId: '42', messageId: 7 } }]);
  assert.deepEqual(h.answered, [{ id: 'cb1', text: '⏳' }]);
  assert.deepEqual(h.edited.map(e => [String(e.chat), e.id, e.text]), [['42', 7, 'ተልኳል · Sent'], ['77', 9, 'ተልኳል · Sent']]);
  assert.deepEqual(h.edited[0].extra.reply_markup, { inline_keyboard: [] }, 'the buttons are gone once it ran');
  assert.deepEqual(h.sent, []);
});

test('✖ and ⚠️ are the same road, with their own verb', async () => {
  const calls = [];
  const h = harness({ press: async a => { calls.push(a.verb); return { ok: true, status: 'cancelled', id: ID, toast: '✖', card: { text: 'ተሰርዟል', buttons: [] }, edits: [] }; } });
  await h.b.handleUpdate(press('oa:x:' + ID));
  await h.b.handleUpdate(press('oa:u:' + ID));
  assert.deepEqual(calls, ['cancel', 'urgent']);
});

test('a card that comes back with new buttons (the records changed) shows the new action\'s id', async () => {
  const NEW = 'B'.repeat(22);
  const h = harness({ press: async () => ({ ok: false, status: 'replaced', id: NEW, toast: '🔄',
    card: { text: 'አዲስ ቅድመ እይታ', buttons: CARD.buttons },
    edits: [{ chatId: '42', messageId: 7, id: NEW, text: 'አዲስ ቅድመ እይታ', buttons: CARD.buttons }] }) });
  await h.b.handleUpdate(press('oa:c:' + ID));
  assert.deepEqual(h.edited[0].extra.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['oa:c:' + NEW, 'oa:x:' + NEW]);
});

test('a press outside a private chat does nothing, and a press the service refuses only says so', async () => {
  const group = harness();
  await group.b.handleUpdate(press('oa:c:' + ID, { type: 'group', chatId: -100 }));
  assert.deepEqual(group.edited, []);
  assert.deepEqual(group.sent, []);
  assert.deepEqual(group.answered, [{ id: 'cb1', text: '⏳' }]);

  const refused = harness({ press: async () => ({ ok: false, status: 'not_allowed', toast: '⛔ ባለቤቱ ብቻ', edits: [] }) });
  await refused.b.handleUpdate(press('oa:c:' + ID));
  assert.deepEqual(refused.edited, []);
  assert.deepEqual(refused.sent.map(x => x.text), ['⛔ ባለቤቱ ብቻ']);
});

test('a callback that is not an action, and a service that is down, leave the bot as it was', async () => {
  const h = harness();
  await h.b.handleUpdate({ callback_query: { id: 'cb2', data: 'menu', from: { id: 42 }, message: { chat: { id: 42, type: 'private' }, message_id: 3 } } });
  assert.match(h.sent[0].text, /Pick a service/);
  for (const bad of ['oa:c:' + 'A'.repeat(21), 'oa:z:' + ID, 'oa:' + ID]) {
    const x = harness();
    await x.b.handleUpdate({ callback_query: { id: 'cb3', data: bad, from: { id: 42 }, message: { chat: { id: 42, type: 'private' }, message_id: 3 } } });
    assert.deepEqual(x.edited, [], bad);
  }
  const down = harness({ pressThrows: true });
  await down.b.handleUpdate(press('oa:c:' + ID));
  assert.match(down.sent[0].text, /ይቅርታ/);
});
