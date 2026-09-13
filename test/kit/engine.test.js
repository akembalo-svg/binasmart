'use strict';
// The engine is the order every agent answers in. These tests use a scripted model and fake
// dependencies, so nothing reaches Gemini, a database or a person.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');

function harness({ replies = ['ok'], context = 'fee 50 birr', throwModel = false } = {}) {
  const calls = { model: [], logs: [], handovers: [], warns: [], errors: [] };
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      calls.model.push({ sys, messages, maxTokens, opts });
      if (throwModel) throw new Error('model down');
      return replies[Math.min(calls.model.length - 1, replies.length - 1)];
    },
    contextFor: async () => context,
    lang: { detect: () => 'en', directive: () => 'DIRECTIVE' },
    memory: {
      userKey: ({ evaluation, ip }) => (evaluation ? 'eval:' : '') + 'ip:' + ip,
      log: row => calls.logs.push(row),
      isMiss: () => false,
    },
    handover: row => { calls.handovers.push(row); return Promise.resolve(true); },
    dropUngrounded,
    isEval: req => req.headers['x-binasmart-eval'] === '1',
    warn: m => calls.warns.push(m),
  };
  return { calls, handle: makeEngine(deps) };
}

const req = (message, headers = {}) => ({ body: { message }, headers, ip: '10.0.0.9', log: { error: () => {} } });
const res = () => ({ status: 200, body: null, code(n) { this.status = n; return this; }, send(o) { this.body = o; return o; } });

const base = overrides => Object.assign({
  name: 'demo', soul: 'SOUL', maxTokens: 700, gates: [],
  inScope: () => true, redirect: () => 'go elsewhere',
  finish: (c, text) => text + ' [END]', fallback: () => 'sorry',
}, overrides);

test('an empty message is refused before anything else runs', async () => {
  const h = harness(); const r = res();
  await h.handle(base(), req('   '), r);
  assert.equal(r.status, 400);
  assert.equal(h.calls.model.length, 0);
});

test('the first gate that matches answers; later gates, scope and the model never run', async () => {
  const h = harness();
  let secondGate = false, scopeAsked = false;
  const agent = base({
    gates: [
      { test: c => c.msg.includes('fire'), answer: c => ({ body: { reply: 'call 939', emergency: true }, log: ['emergency'], handover: 'fire' }) },
      { test: () => { secondGate = true; return true; }, answer: () => ({ body: { reply: 'second' } }) },
    ],
    inScope: () => { scopeAsked = true; return true; },
  });
  const out = await h.handle(agent, req('there is a fire'), res());
  assert.deepEqual(out, { reply: 'call 939', emergency: true });
  assert.equal(secondGate, false); assert.equal(scopeAsked, false);
  assert.equal(h.calls.model.length, 0);
  assert.deepEqual(h.calls.logs.map(l => l.tools), [['emergency']]);
  assert.equal(h.calls.logs[0].miss, false);
  assert.equal(h.calls.handovers.length, 1);
  assert.equal(h.calls.handovers[0].reason, 'fire');
  assert.equal(h.calls.handovers[0].explicit, true);
  assert.equal(h.calls.handovers[0].reply, 'call 939');
});

test('a gate with no log and no handover only answers', async () => {
  const h = harness();
  const agent = base({ gates: [{ test: () => true, answer: () => ({ body: { reply: 'urgent', urgent: true } }) }] });
  await h.handle(agent, req('x'), res());
  assert.equal(h.calls.logs.length, 0); assert.equal(h.calls.handovers.length, 0);
});

test('off-subject goes back with a redirect and no model call', async () => {
  const h = harness();
  const out = await h.handle(base({ inScope: () => false, redirect: c => 'ask Bini: ' + c.l }), req('ride price?'), res());
  assert.deepEqual(out, { reply: 'ask Bini: en', redirected: true });
  assert.equal(h.calls.model.length, 0);
});

test('the system prompt is soul, directive, knowledge, agent context, instruction, in that order', async () => {
  const h = harness({ context: 'KNOW' });
  const agent = base({
    context: async () => ({ prompt: '\n\nCTX', grounding: 'G' }),
    instruct: () => '\n\nINSTRUCT',
  });
  await h.handle(agent, req('hello'), res());
  const sys = h.calls.model[0].sys;
  assert.equal(sys, 'SOUL\n\nDIRECTIVE\n\n## Information you may use\nKNOW\n\nCTX\n\nINSTRUCT');
  assert.equal(h.calls.model[0].maxTokens, 700);
  assert.deepEqual(h.calls.model[0].messages, [{ role: 'user', content: 'hello' }]);
});

test('no knowledge means no knowledge heading', async () => {
  const h = harness({ context: '' });
  await h.handle(base(), req('hello'), res());
  assert.equal(h.calls.model[0].sys, 'SOUL\n\nDIRECTIVE');
});

test('filters run before grounding, and grounding before finish', async () => {
  const h = harness({ replies: ['Take 2 pills. It costs 999 birr. Go to room 5.'], context: 'room 5' });
  const agent = base({
    filters: [text => ({ text: text.replace('Take 2 pills. ', ''), removed: 1, what: 'dose sentence(s)' })],
    finish: (c, text) => '<' + text + '>',
  });
  const out = await h.handle(agent, req('hi'), res());
  assert.equal(out.reply, '<Go to room 5.>');
  assert.ok(h.calls.warns.some(w => w === '[demo] removed 1 dose sentence(s)'));
  assert.ok(h.calls.warns.some(w => /^\[demo\] dropped ungrounded 999 birr/.test(w)));
});

test('agent grounding is added to the knowledge for the figure check', async () => {
  const h = harness({ replies: ['The fee is 120 birr.'], context: 'nothing' });
  const agent = base({ context: async () => ({ prompt: '', grounding: 'fee 120' }), finish: (c, t) => t });
  const out = await h.handle(agent, req('fee?'), res());
  assert.equal(out.reply, 'The fee is 120 birr.');
});

test('a retry replaces the answer only when the second one passes', async () => {
  const retry = { needed: (c, t) => !t.includes('WEAK'), suffix: () => '\n\nADD WEAK', accepts: t => t.includes('WEAK'), warning: 'still no weak side' };
  let h = harness({ replies: ['strong only', 'strong and WEAK'] });
  let out = await h.handle(base({ retry, finish: (c, t) => t }), req('case'), res());
  assert.equal(out.reply, 'strong and WEAK');
  assert.equal(h.calls.model.length, 2);
  assert.ok(h.calls.model[1].sys.endsWith('\n\nADD WEAK'));

  h = harness({ replies: ['strong only', 'strong again'] });
  out = await h.handle(base({ retry, finish: (c, t) => t }), req('case'), res());
  assert.equal(out.reply, 'strong only');
  assert.ok(h.calls.warns.includes('[demo] still no weak side'));
});

test('a successful answer is logged under the agent name, with its flags', async () => {
  const h = harness({ replies: ['fine'] });
  const out = await h.handle(base({ okFlags: { emergency: false } }), req('hi', { 'x-binasmart-eval': '1' }), res());
  assert.deepEqual(out, { reply: 'fine [END]', emergency: false });
  assert.equal(h.calls.logs.length, 1);
  assert.deepEqual(h.calls.logs[0].tools, ['demo']);
  assert.equal(h.calls.logs[0].userKey, 'eval:ip:10.0.0.9');
  assert.equal(h.calls.logs[0].channel, 'api');
});

test('a model failure returns the fallback', async () => {
  const h = harness({ throwModel: true });
  const out = await h.handle(base({ fallback: c => 'sorry in ' + c.l }), req('hi'), res());
  assert.deepEqual(out, { reply: 'sorry in en' });
});

test('an incomplete agent is refused loudly', async () => {
  const h = harness();
  const { fallback, ...broken } = base();
  await assert.rejects(() => h.handle(broken, req('hi'), res()), /agent demo is missing fallback/);
});
