'use strict';
// Stage 3: one gemini-2.5-flash call for the items neither rule settled, and nothing else.
//
// This is the only part of the watch that sends anything off the VPS, so what it may send is asserted here
// rather than described: the prompt carries the post text and nothing else — no question a user asked, no log
// line, no rider, no patient. And it fails CLOSED. A timeout, an HTTP error or an answer that does not parse
// leaves the item unsettled and queued for Ibrahim; it never admits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyWithModel } = require('../../ops/watch/channels/classify-model');

const item = (id, text) => ({ post: { id, text, links: [], date: '2026-09-18', channel: '@nbethiopia' }, source: { id: 'nbe', office: 'nbe', kind: 'office' } });
const answer = txt => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: txt }] } }] }) });

test('WATCH_NO_MODEL=1 short-circuits the whole stage: nothing is sent, nothing is guessed', async () => {
  let calls = 0;
  const out = await classifyWithModel([item(1, 'a post the rules could not settle')], {
    apiKey: 'k', env: { WATCH_NO_MODEL: '1' }, sleep: async () => {},
    fetchImpl: async () => { calls++; return answer('{"verdict":"pack-grade","office":"nbe"}'); },
  });
  assert.equal(calls, 0);
  assert.equal(out.calls, 0);
  assert.equal(out.results[0].label, 'unsettled');
  assert.equal(out.results[0].admit, false);
  assert.equal(out.results[0].queued, true);
  assert.match(out.results[0].reason, /WATCH_NO_MODEL/);
});

test('one call per unsettled item, 4 s apart, and the prompt is the post text alone', async () => {
  const waits = [];
  const bodies = [];
  const out = await classifyWithModel([item(1, 'first unsettled post'), item(2, 'second unsettled post')], {
    apiKey: 'secret-key', env: {}, sleep: async ms => waits.push(ms),
    fetchImpl: async (url, opt) => { bodies.push(JSON.parse(opt.body)); return answer('{"verdict":"excluded","office":null}'); },
  });
  assert.equal(out.calls, 2);
  assert.deepEqual(waits, [4000], 'paced between calls, not before the first');
  const prompt = bodies[0].contents[0].parts[0].text;
  assert.ok(prompt.includes('first unsettled post'));
  assert.ok(!prompt.includes('second unsettled post'), 'one post per call');
  assert.ok(!/secret-key/.test(prompt), 'no key in the prompt');
  assert.ok(!/rider|patient|user|question asked/i.test(prompt));
  for (const r of out.results) assert.equal(r.label, 'excluded');
});

test('a verdict the model returns is taken, and an office it invents is not', async () => {
  const out = await classifyWithModel([item(1, 'x'), item(2, 'y')], {
    apiKey: 'k', env: {}, sleep: async () => {},
    fetchImpl: async () => answer('here you go: {"verdict":"pack-grade","office":"ministry of everything"}'),
  });
  assert.equal(out.results[0].label, 'pack-grade');
  assert.equal(out.results[0].admit, true);
  assert.equal(out.results[0].office, 'nbe', 'the office falls back to the channel we read it from');
});

test('a stub that throws admits nothing', async () => {
  const out = await classifyWithModel([item(1, 'x'), item(2, 'y')], {
    apiKey: 'k', env: {}, sleep: async () => {},
    fetchImpl: async () => { throw new Error('ETIMEDOUT'); },
  });
  assert.equal(out.results.length, 2);
  for (const r of out.results) {
    assert.equal(r.admit, false);
    assert.equal(r.label, 'unsettled');
    assert.equal(r.queued, true);
  }
  assert.equal(out.failed, 2);
});

test('an HTTP error, an unparseable answer and an unknown verdict all fail closed', async () => {
  const cases = [
    { ok: false, status: 429, json: async () => ({}) },
    answer('I am afraid I cannot help with that'),
    answer('{"verdict":"definitely publish it","office":"nbe"}'),
  ];
  let i = 0;
  const out = await classifyWithModel([item(1, 'a'), item(2, 'b'), item(3, 'c')], {
    apiKey: 'k', env: {}, sleep: async () => {}, fetchImpl: async () => cases[i++],
  });
  for (const r of out.results) {
    assert.equal(r.label, 'unsettled', r.reason);
    assert.equal(r.admit, false);
    assert.equal(r.queued, true);
  }
});

test('with no key at all the stage is skipped, not failed', async () => {
  let calls = 0;
  const out = await classifyWithModel([item(1, 'x')], { apiKey: '', env: {}, sleep: async () => {}, fetchImpl: async () => { calls++; return answer('{}'); } });
  assert.equal(calls, 0);
  assert.equal(out.results[0].label, 'unsettled');
  assert.equal(out.results[0].queued, true);
});
