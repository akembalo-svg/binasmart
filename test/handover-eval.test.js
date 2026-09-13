'use strict';
// An evaluation takes the real production path on purpose, and afiya-eval.js alone sends nine
// emergencies. Every one of them used to page a human on Telegram. The route marks evaluation traffic
// through userKey(); the handover has to honour it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeHandover, userKey } = require('../assistant/memory');

function spy() {
  const sent = [];
  return { sent, sendTg: async (chat, text) => { sent.push({ chat, text }); } };
}

test('an evaluation request is never paged, even marked explicit', async () => {
  const s = spy();
  const handover = makeHandover({ sendTg: s.sendTg, chatId: 'ops' });
  const key = userKey({ ip: '10.0.0.1', evaluation: true });
  assert.ok(key.startsWith('eval:'), 'precondition: evaluation keys start with eval:');
  const r = await handover({ userKey: key, channel: 'api', lang: 'am', message: 'ልጄ ራሱን ስቶ አልነቃም',
    reply: '907', explicit: true, reason: 'Dr Afiya: possible emergency' });
  assert.equal(r, false);
  assert.equal(s.sent.length, 0, 'an evaluation paged a person');
});

test('a real emergency is still paged', async () => {
  const s = spy();
  const handover = makeHandover({ sendTg: s.sendTg, chatId: 'ops' });
  const r = await handover({ userKey: userKey({ ip: '10.0.0.2' }), channel: 'web', lang: 'am',
    message: 'ልጄ ራሱን ስቶ አልነቃም', reply: '907', explicit: true, reason: 'Dr Afiya: possible emergency' });
  assert.equal(r, true);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].chat, 'ops');
});
