'use strict';
// What the engine passes to contextFor. An agent that declares no knowledge preference must produce exactly the call
// every agent made before (lang only); a declaration passes its prefer/exclude lists, copied, and nothing else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine, knowledgeOptions } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');

function harness() {
  const seen = [];
  const handle = makeEngine({
    callModel: async () => 'ok',
    contextFor: async (q, o) => { seen.push(o); return ''; },
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:t', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(false),
    dropUngrounded, isEval: () => false, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return { seen, ask: (agent, message) => handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res) };
}
const base = o => Object.assign({ name: 'demo', soul: 'S', gates: [], inScope: () => true, redirect: () => 'elsewhere',
  finish: (c, t) => t, fallback: () => 'sorry' }, o);

test('an agent with no knowledge declaration calls contextFor with the language only, as before', async () => {
  const h = harness();
  await h.ask(base(), 'where do I register a rental contract?');
  assert.deepEqual(h.seen, [{ lang: 'en' }]);
  assert.deepEqual(knowledgeOptions({}, 'am'), { lang: 'am' });
  assert.deepEqual(knowledgeOptions({ knowledge: true }, 'om'), { lang: 'om' });
  assert.deepEqual(knowledgeOptions({ knowledge: { k: 50, styleK: 9 } }, 'en'), { lang: 'en' }, 'only the two lists pass');
});

test('a declaration passes prefer and exclude as copies', async () => {
  const kn = { prefer: ['health'], exclude: ['page', 'guide:mesob'] };
  const h = harness();
  await h.ask(base({ knowledge: kn }), 'which hospital?');
  assert.deepEqual(h.seen, [{ lang: 'en', prefer: ['health'], exclude: ['page', 'guide:mesob'] }]);
  h.seen[0].exclude.push('law');
  assert.deepEqual(kn.exclude, ['page', 'guide:mesob'], 'the definition is not mutated through the call');
});

test('knowledge: false still reads nothing', async () => {
  const h = harness();
  await h.ask(base({ knowledge: false }), 'rent?');
  assert.equal(h.seen.length, 0);
});

test('the real agents: Afiya and Asmat declare lists, the owner agent reads nothing', () => {
  for (const name of ['afiya', 'asmat']) {
    const o = knowledgeOptions(require('../../agents/' + name + '/rules'), 'am');
    assert.equal(o.lang, 'am');
    assert.ok(o.prefer.length && o.exclude.length, name);
  }
  assert.equal(require('../../agents/owner/rules').knowledge, false);
});
