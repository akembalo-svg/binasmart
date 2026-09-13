'use strict';
// The engine's second shape: an agent that reads through tools, sees only what the route scoped it to,
// and is audited rather than chat-logged. Afiya and Asmat must be untouched by any of it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');

function harness({ reply = 'ok', call = null, contextFor } = {}) {
  const calls = { model: [], logs: [], audits: [], contexts: 0, warns: [], executorScope: [] };
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      calls.model.push({ sys, opts });
      if (call && opts && opts.execute) await opts.execute(call.name, call.args);
      return typeof reply === 'function' ? reply() : reply;
    },
    contextFor: contextFor || (async () => { calls.contexts++; return ''; }),
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:x', log: r => calls.logs.push(r), isMiss: () => false },
    handover: () => Promise.resolve(true),
    dropUngrounded, isEval: () => false,
    warn: m => calls.warns.push(m),
  };
  return { calls, deps, handle: makeEngine(deps) };
}
const req = message => ({ body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } });
const res = { code() { return this; }, send(o) { return o; } };
const base = o => Object.assign({ name: 'demo', soul: 'S', gates: [], inScope: () => true, redirect: () => '',
  finish: (c, t) => t, fallback: () => 'sorry' }, o);

test('an agent without tools still gets an empty options object, exactly as before', async () => {
  const h = harness();
  await h.handle(base(), req('hi'), res);
  assert.deepEqual(h.calls.model[0].opts, {});
});

test('an agent with tools gets them, and its executor is bound to the scope the route passed', async () => {
  const h = harness({ call: { name: 'rent', args: { month: '2026-07' } }, reply: 'done' });
  const tools = [{ type: 'function', function: { name: 'rent', parameters: { type: 'object', properties: {} } } }];
  const agent = base({ tools, executor: (c, deps) => { h.calls.executorScope.push(c.scope); return async () => ({ invoicedEtb: 30000 }); } });
  await h.handle(agent, req('rent?'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(h.calls.model[0].opts.tools, tools);
  assert.equal(typeof h.calls.model[0].opts.execute, 'function');
  assert.deepEqual(h.calls.executorScope, [{ buildingIds: ['b1'] }]);
});

test('a figure from a tool result survives the figure check; an invented one does not', async () => {
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'Invoiced 30,000 birr. Collected 99,999 birr.' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({ invoicedEtb: 30000 }) });
  const out = await h.handle(agent, req('rent?'), res, { scope: { buildingIds: ['b1'] } });
  assert.match(out.reply, /30,000 birr/);
  assert.doesNotMatch(out.reply, /99,999/);
});

test('finish receives every tool call and its result', async () => {
  let seen = null;
  const h = harness({ call: { name: 'rent', args: { month: '2026-07' } }, reply: 'x' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({ n: 1 }),
    finish: (c, t, state) => { seen = state.toolResults; return t; } });
  await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.deepEqual(seen, [{ name: 'rent', args: { month: '2026-07' }, out: { n: 1 } }]);
});

test('knowledge: false skips the document search', async () => {
  const h = harness();
  await h.handle(base({ knowledge: false }), req('q'), res);
  assert.equal(h.calls.contexts, 0);
  await h.handle(base(), req('q'), res);
  assert.equal(h.calls.contexts, 1);
});

test('log: false keeps the answer out of the chat log, and the audit hook gets the tools used', async () => {
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'x' });
  const agent = base({ log: false, tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({}),
    audit: (c, info, deps) => { h.calls.audits.push({ scope: c.scope, channel: c.channel, tools: info.tools }); } });
  const out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] }, channel: 'owner-web' });
  await new Promise(r => setImmediate(r));
  assert.equal(out.reply, 'x');
  assert.equal(h.calls.logs.length, 0);
  assert.deepEqual(h.calls.audits, [{ scope: { buildingIds: ['b1'] }, channel: 'owner-web', tools: ['rent'] }]);
});

test('a failing audit is reported and does not cost the answer', async () => {
  const h = harness({ reply: 'x' });
  const out = await h.handle(base({ log: false, audit: () => { throw new Error('db down'); } }), req('q'), res);
  await new Promise(r => setImmediate(r));
  assert.equal(out.reply, 'x');
  assert.ok(h.calls.warns.some(w => w === '[demo] audit failed: db down'));
});

test('the route can name the channel, and a gate can see the scope', async () => {
  const h = harness();
  const agent = base({ gates: [{ test: c => !c.scope, answer: () => ({ body: { reply: 'no scope' }, log: ['noscope'] }) }] });
  let out = await h.handle(agent, req('q'), res, { channel: 'owner-web' });
  assert.equal(out.reply, 'no scope');
  assert.equal(h.calls.logs[0].channel, 'owner-web');
  out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(out.reply, 'ok');
  assert.equal(h.calls.model.length, 1);
});

test('an agent with tools but no executor is refused loudly', async () => {
  const h = harness();
  await assert.rejects(() => h.handle(base({ tools: [{}] }), req('q'), res), /agent demo has tools but no executor/);
});

test('body.scope can never smuggle a scope in; only options.scope reaches c.scope', async () => {
  const h = harness();
  let seenScope = 'unset';
  const agent = base({ gates: [{ test: c => { seenScope = c.scope; return true; }, answer: () => ({ body: { reply: 'gated' } }) }] });
  const out = await h.handle(agent, { body: { message: 'hi', scope: { buildingIds: ['evil'] } }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res);
  assert.equal(out.reply, 'gated');
  assert.equal(seenScope, null);
});

test('each ask gets its own opts: a first-call fallback does not poison the retry call\'s tools', async () => {
  const modelCalls = [];
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      modelCalls.push(opts);
      if (modelCalls.length === 1) { opts.tools = null; opts.execute = null; return 'first'; }
      return 'second, done';
    },
    contextFor: async () => '',
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:x', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true),
    dropUngrounded, isEval: () => false,
    warn: () => {},
  };
  const handle = makeEngine(deps);
  const tools = [{ type: 'function', function: { name: 'rent' } }];
  const agent = base({
    tools, executor: () => async () => ({ ok: true }),
    retry: { needed: () => true, suffix: () => ' retry', accepts: () => true, warning: 'retry rejected' },
  });
  await handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(modelCalls.length, 2);
  assert.equal(modelCalls[0].tools, null);
  assert.deepEqual(modelCalls[1].tools, tools);
  assert.equal(typeof modelCalls[1].execute, 'function');
});

test('a figure only in a tool call\'s args (not its result) is dropped', async () => {
  const h = harness({ call: { name: 'rent', args: { amount: 777 } }, reply: 'It is 777 birr.' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({ ok: true }) });
  const out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.doesNotMatch(out.reply, /777/);
});

test('the GLM fallback discards the tool results gathered before it', async () => {
  let seenState = null;
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      await opts.execute('rent', {});
      opts.tools = null; opts.execute = null;
      return 'Invoiced 30,000 birr.';
    },
    contextFor: async () => '',
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:x', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true),
    dropUngrounded, isEval: () => false,
    warn: () => {},
  };
  const handle = makeEngine(deps);
  const agent = base({
    tools: [{ type: 'function', function: { name: 'rent' } }],
    executor: () => async () => ({ invoicedEtb: 30000 }),
    finish: (c, t, state) => { seenState = state.toolResults; return t; },
  });
  const out = await handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.doesNotMatch(out.reply, /30,000/);
  assert.deepEqual(seenState, []);
});

test('a tool result past the 6000-char cut cannot ground a figure', async () => {
  const filler = 'x'.repeat(6100);
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'Total 424242 birr.' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }],
    executor: () => async () => ({ filler, total: 424242 }) });
  const out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.doesNotMatch(out.reply, /424242/);
});

test('a throwing executor does not reject the handle; the model sees a tool-failed result', async () => {
  let seenToolResults = null;
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'ok' });
  const agent = base({
    tools: [{ type: 'function', function: { name: 'rent' } }],
    executor: () => async () => { throw new Error('boom'); },
    finish: (c, t, state) => { seenToolResults = state.toolResults; return t; },
  });
  const out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(out.reply, 'ok');
  assert.deepEqual(seenToolResults[0].out, { error: 'tool failed' });
  assert.ok(h.calls.warns.some(w => w.includes('rent') && w.includes('failed')));
});

test('a failure after a tool ran is still audited, with the tools that ran', async () => {
  const audits = [];
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      await opts.execute('rent', {});
      throw new Error('model exploded');
    },
    contextFor: async () => '',
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:x', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true),
    dropUngrounded, isEval: () => false,
    warn: () => {},
  };
  const handle = makeEngine(deps);
  const agent = base({
    tools: [{ type: 'function', function: { name: 'rent' } }],
    executor: () => async () => ({ n: 1 }),
    audit: (c, info) => { audits.push(info.tools); },
    fallback: () => 'sorry-fallback',
  });
  const out = await handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  await new Promise(r => setImmediate(r));
  assert.equal(out.reply, 'sorry-fallback');
  assert.deepEqual(audits, [['rent']]);
});

test('a tool agent labels its model calls with its name; an agent without tools still sends {}', async () => {
  const h = harness({ reply: 'x' });
  const tools = [{ type: 'function', function: { name: 'rent' } }];
  await h.handle(base({ tools, executor: () => async () => ({}) }), req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(h.calls.model[0].opts.label, 'demo');
  await h.handle(base(), req('q'), res);
  assert.deepEqual(h.calls.model[1].opts, {});
});
