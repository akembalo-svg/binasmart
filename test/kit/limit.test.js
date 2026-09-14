'use strict';
// The question limit for /afiya and /asmat: who is counted, and that an emergency is never refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeAgentLimit } = require('../../assistant/kit/limit');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const afiyaAgent = require('../../agents/afiya/rules');
const asmatAgent = require('../../agents/asmat/rules');

const counter = max => { const n = new Map(); const f = k => { n.set(k, (n.get(k) || 0) + 1); f.seen.push(k); return n.get(k) <= max; }; f.seen = []; return f; };
const c = uid => ({ user: uid ? { uid } : {} });

test('our own evaluation scripts on the server (loopback, no X-Real-IP) are not counted', () => {
  const ip = counter(0), uid = counter(0);
  const limit = makeAgentLimit({ ipLimit: ip, uidLimit: uid });
  assert.equal(limit({ headers: {}, ip: '127.0.0.1' })(c('u1')), true);
  assert.equal(ip.seen.length + uid.seen.length, 0);
});

test('public traffic is counted by X-Real-IP even though req.ip is loopback behind nginx', () => {
  const ip = counter(1), uid = counter(9);
  const limit = makeAgentLimit({ ipLimit: ip, uidLimit: uid });
  const r = { headers: { 'x-real-ip': '196.188.1.2' }, ip: '127.0.0.1' };
  assert.equal(limit(r)(c()), true);
  assert.equal(limit(r)(c()), false);
  assert.deepEqual(ip.seen, ['196.188.1.2', '196.188.1.2']);
});

test('a phone over its own limit is refused even when its address still has room', () => {
  const ip = counter(99), uid = counter(1);
  const limit = makeAgentLimit({ ipLimit: ip, uidLimit: uid });
  const r = { headers: { 'x-real-ip': '196.188.1.2' }, ip: '127.0.0.1' };
  assert.equal(limit(r)(c('phone-a')), true);
  assert.equal(limit(r)(c('phone-a')), false);
  assert.equal(limit(r)(c('phone-b')), true, 'another phone on the same address is not refused');
});

function engine(calls) {
  return makeEngine({
    callModel: async () => { calls.model++; return 'The clinic opens at 8.'; },
    contextFor: async () => 'The clinic opens at 8.',
    lang: { detect: m => /[ሀ-፿]/.test(m) ? 'am' : 'en', directive: () => '' },
    memory: { userKey: () => 'ip:x', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true), dropUngrounded, isEval: () => false, warn: () => {},
  });
}
const req = message => ({ body: { message, user: { uid: 'phone-a' } }, headers: { 'x-real-ip': '196.188.1.2' }, ip: '127.0.0.1', log: { error() {} } });
const res = () => ({ code() { return this; }, send(o) { return o; } });
const refuseAll = () => { const f = () => { f.asked++; return false; }; f.asked = 0; return f; };

test('Afiya: an emergency is answered with 907 by a person who is over the limit, and the limit is never asked', async () => {
  const calls = { model: 0 }; const limit = refuseAll();
  const out = await engine(calls)(afiyaAgent, req('My father collapsed and is not breathing'), res(), { limit });
  assert.equal(out.emergency, true);
  assert.match(out.reply, /907/);
  assert.equal(limit.asked, 0); assert.equal(calls.model, 0);
});

test('Asmat: an arrest is answered as urgent by a person who is over the limit', async () => {
  const calls = { model: 0 }; const limit = refuseAll();
  const out = await engine(calls)(asmatAgent, req('The police arrested my brother last night, what do we do?'), res(), { limit });
  assert.equal(out.urgent, true);
  assert.equal(limit.asked, 0);
});

test('a question for another service (a ride) is redirected without being counted', async () => {
  const calls = { model: 0 }; const limit = refuseAll();
  const out = await engine(calls)(afiyaAgent, req('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?'), res(), { limit });
  assert.equal(out.redirected, true);
  assert.equal(limit.asked, 0);
});

test('over the limit, an ordinary question gets the wait message, never the model; Afiya names 907 and Asmat 991', async () => {
  for (const [agent, number, q, qAm] of [
    [afiyaAgent, '907', 'Which documents do I need to register at a health centre?', 'በጤና ጣቢያ ለመመዝገብ ምን ሰነድ ያስፈልጋል?'],
    [asmatAgent, '991', 'Which office registers a rental agreement?', 'የቤት ኪራይ ውል የት ነው የሚመዘገበው?'],
  ]) {
    for (const message of [q, qAm]) {
      const calls = { model: 0 }; const limit = refuseAll();
      const out = await engine(calls)(agent, req(message), res(), { limit });
      assert.equal(out.limited, true, agent.name + ' ' + message);
      assert.equal(calls.model, 0);
      assert.match(out.reply, new RegExp(number));
      assert.equal(limit.asked, 1);
    }
  }
});

test('under the limit nothing changes', async () => {
  const calls = { model: 0 };
  const out = await engine(calls)(afiyaAgent, req('Which documents do I need to register at a health centre?'), res(), { limit: () => true });
  assert.equal(out.limited, undefined);
  assert.equal(calls.model, 1);
});
