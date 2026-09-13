'use strict';
// @bina_smart_bot's owner paths, with a fake Telegram API and a fake owner service: nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

function harness({ scope = null, link = { ok: true, scope: { buildingIds: ['b1'], roles: { b1: 'owner' }, mode: 'owner', linkId: 'l1' } }, scopeThrows = false, withOwner = true, quietApi = false } = {}) {
  const sent = [], calls = { bini: [], answer: [], link: [], unlink: [], mode: [], health: [] };
  const api = {
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return quietApi ? undefined : { message_id: sent.length }; },
    sendChatAction: async () => true, answerCallbackQuery: async () => true,
    getFile: async () => ({ file_path: 'voice/1.oga' }), downloadFile: async () => Buffer.from('audio'),
  };
  const fetchImpl = async (url, init) => {
    if (/transcribe/.test(url)) return { json: async () => ({ ok: true, text: 'ስንት ክፍል ባዶ ነው?' }) };
    calls.bini.push(JSON.parse(init.body)); return { json: async () => ({ reply: 'customer bini' }) };
  };
  const owner = {
    access: {
      scopeFor: async id => { if (scopeThrows) throw new Error('db down'); return typeof scope === 'function' ? scope(id) : scope; },
      linkFromContact: async a => { calls.link.push(a); return link; },
      unlink: async id => { calls.unlink.push(String(id)); return true; },
      setMode: async (id, m) => { calls.mode.push([String(id), m]); return true; },
    },
    answer: async a => { calls.answer.push(a); return 'owner answer'; },
    health: async s => { calls.health.push(s); return 'HEALTH ' + s.buildingIds.join(','); },
  };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl,
    botUsername: 'bina_smart_bot', internalKey: 'k', owner: withOwner ? owner : undefined });
  return { sent, calls, b };
}
const pm = (text, extra = {}) => ({ message: Object.assign({ chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'T' }, text }, extra) });
const gm = text => ({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text } });
const OWNER = { buildingIds: ['b1'], mode: 'owner' };

test('/start owner in a private chat asks for the phone with Telegram’s contact button', async () => {
  const { sent, b } = harness();
  await b.handleUpdate(pm('/start owner'));
  const kb = sent[0].extra.reply_markup.keyboard;
  assert.equal(kb[0][0].request_contact, true);
});

test('/start owner in a group does not offer linking', async () => {
  const { sent, b } = harness();
  await b.handleUpdate(gm('/start owner'));
  assert.equal(sent[0].extra.reply_markup.keyboard, undefined);
});

test('a shared contact is checked by the access rules and, when approved, answered with the records report', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('', { contact: { phone_number: '251900000001', user_id: 42 } }));
  assert.equal(calls.link.length, 1);
  assert.equal(calls.link[0].forwarded, false);
  assert.equal(calls.link[0].from.id, 42);
  assert.match(sent[0].text, /✅/);
  assert.match(sent[0].text, /HEALTH b1/);
  assert.equal(sent[0].extra.reply_markup.remove_keyboard, true);
});

test('a forwarded contact is passed on as forwarded (forward_origin and the legacy fields)', async () => {
  for (const extra of [{ forward_origin: { type: 'user', date: 1 } }, { forward_from: { id: 43 } }, { forward_date: 1 }]) {
    const { calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
    await b.handleUpdate(pm('', Object.assign({ contact: { phone_number: '251900000001', user_id: 42 } }, extra)));
    assert.equal(calls.link[0].forwarded, true, Object.keys(extra)[0]);
  }
});

test('a contact sent through an inline bot is not treated as the sender’s own', async () => {
  const { sent, calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
  await b.handleUpdate(pm('', { contact: { phone_number: '251900000001', user_id: 42 }, via_bot: { id: 99, is_bot: true, username: 'some_bot' } }));
  assert.equal(calls.link[0].forwarded, true);
  assert.match(sent[0].text, /own number/);
});

test('refusals say only what the person needs', async () => {
  for (const [reason, re] of [['not_registered', /not registered/], ['too_many', /15 minutes/], ['not_own_contact', /own number/],
    ['not_private', /private chat/], ['blocked', /removed from Bini for owners/]]) {
    const { sent, b } = harness({ link: { ok: false, reason } });
    await b.handleUpdate(pm('', { contact: { phone_number: '251900000001', user_id: 42 } }));
    assert.match(sent[0].text, re, reason);
  }
});

test('a linked owner’s private question goes to the owner agent, not customer Bini', async () => {
  const { sent, calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('How much was paid in July?'));
  assert.equal(calls.answer.length, 1);
  assert.deepEqual(calls.answer[0].scope, OWNER);
  assert.equal(calls.answer[0].text, 'How much was paid in July?');
  assert.equal(calls.bini.length, 0);
  assert.equal(sent[0].text, 'owner answer');
});

test('the same account in a group gets customer Bini and no owner data', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(gm('How much was paid in July?'));
  assert.equal(calls.answer.length, 0);
  assert.equal(calls.bini.length, 1);
});

test('in bini mode, or with no link, questions go to customer Bini', async () => {
  let h = harness({ scope: { buildingIds: ['b1'], mode: 'bini' } });
  await h.b.handleUpdate(pm('hello'));
  assert.equal(h.calls.answer.length, 0); assert.equal(h.calls.bini.length, 1);
  h = harness({ scope: null });
  await h.b.handleUpdate(pm('hello'));
  assert.equal(h.calls.bini.length, 1);
});

test('a failing access check falls back to customer Bini instead of breaking the bot', async () => {
  const { calls, b } = harness({ scopeThrows: true });
  await b.handleUpdate(pm('hello'));
  assert.equal(calls.bini.length, 1);
});

test('a voice note from a linked owner is transcribed and answered by the owner agent', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('', { voice: { file_id: 'v1', duration: 5, mime_type: 'audio/ogg' } }));
  assert.equal(calls.answer.length, 1);
  assert.equal(calls.answer[0].text, 'ስንት ክፍል ባዶ ነው?');
  assert.equal(calls.bini.length, 0);
});

test('/logout, /bini and /owner change the link through the access rules', async () => {
  const { sent, calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('/bini'));
  await b.handleUpdate(pm('/owner'));
  await b.handleUpdate(pm('/logout'));
  assert.deepEqual(calls.mode, [['42', 'bini'], ['42', 'owner']]);
  assert.deepEqual(calls.unlink, ['42']);
  assert.equal(sent.length, 3);
});

test('without an owner service the bot behaves exactly as before', async () => {
  const { calls, sent, b } = harness({ withOwner: false });
  await b.handleUpdate(pm('/start owner'));
  assert.equal(sent[0].extra.reply_markup.keyboard, undefined, 'no contact button without the owner service');
  await b.handleUpdate(pm('How much was paid?'));
  assert.equal(calls.bini.length, 1);
});

test('an owner command is answered exactly once even when sendMessage resolves to nothing', async () => {
  const { sent, b } = harness({ quietApi: true });
  await b.handleUpdate(pm('/start owner'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].extra.reply_markup.keyboard[0][0].request_contact, true);
});
