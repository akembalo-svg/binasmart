'use strict';
// @bina_smart_bot's owner paths, with a fake Telegram API and a fake owner service: nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

const LINKED = { ok: true, scope: { buildingIds: ['b1'], roles: { b1: 'owner' }, mode: 'owner', linkId: 'l1' } };

function harness({ scope = null, link = LINKED, scopeThrows = false, withOwner = true, quietApi = false, clock = null,
  answer = async () => 'owner answer', health = async s => 'HEALTH ' + s.buildingIds.join(','),
  linkThrows = false, accessThrows = false } = {}) {
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
      linkFromContact: async a => { calls.link.push(a); if (linkThrows) throw new Error('db down'); return link; },
      unlink: async id => { calls.unlink.push(String(id)); if (accessThrows) throw new Error('db down'); return true; },
      setMode: async (id, m) => { calls.mode.push([String(id), m]); if (accessThrows) throw new Error('db down'); return true; },
    },
    answer: async a => { calls.answer.push(a); return answer(a); },
    health: async s => { calls.health.push(s); return health(s); },
  };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl,
    botUsername: 'bina_smart_bot', internalKey: 'k', owner: withOwner ? owner : undefined,
    now: clock ? () => clock.t : undefined });
  return { sent, calls, b };
}
const pm = (text, extra = {}, chatId = 42) => ({ message: Object.assign({ chat: { id: chatId, type: 'private' }, from: { id: 42, first_name: 'T' }, text }, extra) });
const gm = text => ({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text } });
// Telegram sends contact.phone_number as digits, usually without '+'.
const contact = (extra = {}) => pm('', Object.assign({ contact: { phone_number: '251900000001', user_id: 42 } }, extra));
const OWNER = { buildingIds: ['b1'], mode: 'owner' };
const MIN = 60000;

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

test('a contact shared right after /start owner is checked by the access rules and answered with the records report', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.equal(calls.link[0].forwarded, false);
  assert.equal(calls.link[0].from.id, 42);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /HEALTH b1/);
  assert.equal(sent[1].extra.reply_markup.remove_keyboard, true);
});

test('a contact from a Mini App (no /start owner) is not a link attempt and gets the reply it got before owners existed', async () => {
  const h = harness({ scope: OWNER });
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  const before = harness({ withOwner: false });
  await before.b.handleUpdate(contact());
  assert.deepEqual(h.sent, before.sent);
  assert.match(h.sent[0].text, /Ethiopia's all-in-one platform/);
  assert.ok(h.sent[0].extra.reply_markup.inline_keyboard, 'the service menu');
});

test('a contact 11 minutes after /start owner is not treated as a link; 9 minutes is', async () => {
  let clock = { t: 1e12 };
  let h = harness({ clock });
  await h.b.handleUpdate(pm('/start owner'));
  clock.t += 11 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  assert.match(h.sent[1].text, /Ethiopia's all-in-one platform/);

  clock = { t: 1e12 };
  h = harness({ clock });
  await h.b.handleUpdate(pm('/start owner'));
  clock.t += 9 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 1);
});

test('the pending /start owner is used up by the first contact', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.match(sent[2].text, /Ethiopia's all-in-one platform/);
});

test('after /logout a shared contact does not link again without a new /start owner', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  await b.handleUpdate(pm('/logout'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.deepEqual(calls.unlink, ['42']);
  // /logout also drops a pending /start owner
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(pm('/logout'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
});

test('a forwarded contact is passed on as forwarded (forward_origin and the legacy fields)', async () => {
  for (const extra of [{ forward_origin: { type: 'user', date: 1 } }, { forward_from: { id: 43 } }, { forward_date: 1 }]) {
    const { calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
    await b.handleUpdate(pm('/start owner'));
    await b.handleUpdate(contact(extra));
    assert.equal(calls.link[0].forwarded, true, Object.keys(extra)[0]);
  }
});

test('a contact sent through an inline bot is not treated as the sender’s own', async () => {
  const { sent, calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact({ via_bot: { id: 99, is_bot: true, username: 'some_bot' } }));
  assert.equal(calls.link[0].forwarded, true);
  assert.match(sent[1].text, /own number/);
});

test('refusals say only what the person needs', async () => {
  for (const [reason, re] of [['not_registered', /not registered/], ['too_many', /15 minutes/], ['not_own_contact', /own number/],
    ['not_private', /private chat/], ['blocked', /removed from Bini for owners/]]) {
    const { sent, b } = harness({ link: { ok: false, reason } });
    await b.handleUpdate(pm('/start owner'));
    await b.handleUpdate(contact());
    assert.match(sent[1].text, re, reason);
  }
});

test('a records report longer than one Telegram message is split on paragraph breaks and sent in order', async () => {
  // ~12 buildings of ~1000 characters each: well over three Telegram messages' worth
  const blocks = Array.from({ length: 12 }, (_, i) => '🏢 Building ' + i + '\n' + ('✅ line ' + i + '\n').repeat(110).trim());
  const report = blocks.join('\n\n');
  const { sent, b } = harness({ health: async () => report });
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  const parts = sent.slice(1);
  assert.ok(report.length > 4096 && parts.length >= 3, 'parts: ' + parts.length);
  for (const p of parts) assert.ok(p.text.length <= 3900, 'part length ' + p.text.length);
  assert.equal(parts.map(p => p.text).join('\n\n'), '✅ ተገናኝቷል · Linked\n\n' + report);
  assert.equal(parts[0].extra.reply_markup.remove_keyboard, true);
  for (const p of parts.slice(1)) assert.equal(p.extra.reply_markup, undefined);
});

test('when the records report fails, the linked message still says what to do next', async () => {
  const { sent, calls, b } = harness({ health: async () => { throw new Error('db down'); } });
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /\/bini/);
  assert.match(sent[1].text, /\/logout/);
});

test('a failing link lookup says linking failed', async () => {
  const { sent, b } = harness({ linkThrows: true });
  await b.handleUpdate(pm('/start owner'));
  await b.handleUpdate(contact());
  assert.match(sent[1].text, /linking failed/);
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

test('when the owner agent throws or returns nothing, the owner gets the busy message', async () => {
  for (const answer of [async () => { throw new Error('model down'); }, async () => null]) {
    const { sent, calls, b } = harness({ scope: OWNER, answer });
    await b.handleUpdate(pm('How much was paid in July?'));
    assert.equal(calls.bini.length, 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Bini is busy/);
  }
});

test('owner replies keep their slashes: only bold markers and full markdown links are rewritten', async () => {
  const reply = '**Paid:** ETB 12,000 /month for Units 101 /102. Type /bini or /logout. [Dashboard](https://bina.et/owner)';
  const { sent, b } = harness({ scope: OWNER, answer: async () => reply });
  await b.handleUpdate(pm('How much?'));
  assert.equal(sent[0].text, 'Paid: ETB 12,000 /month for Units 101 /102. Type /bini or /logout. Dashboard — https://bina.et/owner');
  for (const s of ['/bini', '/logout', 'ETB 12,000 /month', 'Units 101 /102']) assert.equal(b.forOwnerTelegram(s), s);
});

test('the same account in a group gets customer Bini and no owner data', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(gm('How much was paid in July?'));
  assert.equal(calls.answer.length, 0);
  assert.equal(calls.bini.length, 1);
});

test('a private-typed chat whose id is not the sender’s gets customer Bini', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('How much was paid in July?', {}, 7));
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

test('when the access lookup for /logout, /bini or /owner fails, the reply is a retry, not "not linked"', async () => {
  const { sent, calls, b } = harness({ scope: OWNER, accessThrows: true });
  for (const cmd of ['/logout', '/bini', '/owner']) await b.handleUpdate(pm(cmd));
  assert.equal(calls.unlink.length + calls.mode.length, 3);
  assert.equal(sent.length, 3);
  for (const s of sent) { assert.match(s.text, /Sorry, please try again/); assert.doesNotMatch(s.text, /not linked/); }
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
