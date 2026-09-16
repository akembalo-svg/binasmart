'use strict';
// The provider balance the owner sees. A number and a timestamp, or the word unavailable. Never the body, the URL
// or the token, and never more than one call in ten minutes however often the tab is opened.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSmsBalance, numberIn, TTL_MS } = require('../../messaging/sms-balance');

test('with no provider there is nothing to show, and nothing is called', () => {
  return Promise.all([
    makeSmsBalance({}).read().then(r => assert.deepEqual(r, { state: 'off' })),
    makeSmsBalance({ provider: {} }).read().then(r => assert.deepEqual(r, { state: 'off' })),
    makeSmsBalance({ provider: null }).read().then(r => assert.deepEqual(r, { state: 'off' })),
  ]);
});

test('a number in the payload is the balance, whatever the provider decided to call the field', () => {
  assert.equal(numberIn({ balance: 1234.5 }), 1234.5);
  assert.equal(numberIn({ message_status: 'success', credit: '980' }), 980);
  assert.equal(numberIn({ sms_balance: '-3.25' }), -3.25);
  assert.equal(numberIn({ status: 'ok' }), null);
  assert.equal(numberIn({ id: 'a12' }), null);
  assert.equal(numberIn(null), null);
  assert.equal(numberIn('1234'), null);
});

test('the answer is cached for ten minutes and one in-flight call is shared', async () => {
  let calls = 0, t = 1000;
  const provider = { balance: async () => { calls++; return { ok: true, status: 200, body: { balance: 42 } }; } };
  const b = makeSmsBalance({ provider, now: () => t });
  const [a1, a2] = await Promise.all([b.read(), b.read()]);   // two tabs opened at once
  assert.deepEqual([a1.state, a1.value, a2.value], ['ok', 42, 42]);
  assert.equal(a1.at, new Date(1000).toISOString());
  assert.equal(calls, 1, 'one request, not two');
  t += TTL_MS - 1; await b.read();
  assert.equal(calls, 1, 'still cached just under ten minutes');
  t += 2; await b.read();
  assert.equal(calls, 2, 'a fresh call once the cache is old');
  assert.equal(TTL_MS, 600000);
});

test('a refusal, a broken payload and a throw all say unavailable, and a failure is cached too', async () => {
  let calls = 0, t = 0, mode = 'refuse';
  const provider = { balance: async () => {
    calls++;
    if (mode === 'throw') throw new Error('ECONNRESET https://api.geezsms.com/api/v1/balance?token=SECRET');
    if (mode === 'refuse') return { ok: false, status: 401, body: { error: 'bad token' } };
    return { ok: true, status: 200, body: { message_status: 'success' } };
  } };
  const b = makeSmsBalance({ provider, now: () => t });
  assert.equal((await b.read()).state, 'unavailable');
  await b.read();
  assert.equal(calls, 1, 'a failing provider is not asked again on every page load');
  t += TTL_MS + 1; mode = 'throw';
  assert.equal((await b.read()).state, 'unavailable');
  t += TTL_MS + 1; mode = 'nonumber';
  assert.equal((await b.read()).state, 'unavailable');
  assert.equal(calls, 3);
});

test('nothing it returns or logs carries the token, the URL or the payload', async () => {
  const logs = [];
  const provider = { balance: async () => ({ ok: false, status: 401, body: { token: 'SECRET-TOKEN', url: 'https://api.geezsms.com/api/v1/balance?token=SECRET-TOKEN' } }) };
  const r = await makeSmsBalance({ provider, now: () => 0, log: m => logs.push(m) }).read();
  const all = JSON.stringify(r) + '\n' + logs.join('\n');
  for (const leak of ['SECRET-TOKEN', 'geezsms', 'token=', 'bad token']) assert.equal(all.includes(leak), false, leak);
  assert.deepEqual(Object.keys(r).sort(), ['at', 'state']);
  assert.deepEqual(logs, ['[sms] balance unavailable · http 401']);
});
