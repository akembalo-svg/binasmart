'use strict';
// The sender is one call wide, and every one of these tests is about what it must NOT do: send by any
// other road, write the code anywhere, or claim to be configured when it is not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePhoneCodeSender } = require('../../auth/phone-code-sender');
const pc = require('../../auth/phone-code');

const LIVE_ENV = { SMS_MODE: 'live', SMS_API_TOKEN: 'fake-token-for-tests' };
// A delivery double that records the one call it is meant to receive.
function fakeDelivery(result) {
  const calls = [];
  return { calls, sendTransactionalSms: async (args) => { calls.push(args); return result; } };
}

test('the code goes out as a labelled transactional SMS, and by no other road', async () => {
  const d = fakeDelivery({ status: 'sent', channel: 'sms', errorKind: null, messageId: 'm1' });
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: d, sms: { mode: 'live', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: true, status: 'sent', errorKind: null });
  assert.equal(d.calls.length, 1, 'exactly one send');
  assert.deepEqual(d.calls[0], {
    to: '+251900000001',
    text: pc.codeText('483920'),
    label: 'BinaSmart',
    kind: 'signin',
    source: 'phone-code',
    live: true
  });
  // sendTransactionalSms stores no text and no building, so the code never lands in OutboundBatch.text.
  assert.equal('buildingId' in d.calls[0], false);
});

test('in test mode the row is written, nothing is sent, and the flow carries on exactly the same', async () => {
  const d = fakeDelivery({ status: 'test', channel: 'sms', errorKind: null, messageId: 'm2' });
  const sender = makePhoneCodeSender({ env: { SMS_MODE: 'test' }, delivery: d, sms: { mode: 'test', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.equal(r.ok, true, 'a test row is a successful send as far as the sign-in flow is concerned');
  assert.equal(r.status, 'test');
});

test('a refusal comes back as a kind, never as a message, and never with the code in it', async () => {
  const d = fakeDelivery({ status: 'failed', channel: 'sms', errorKind: 'sms_refused', messageId: 'm3' });
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: d, sms: { mode: 'live', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: false, status: 'failed', errorKind: 'sms_refused' });
  assert.equal(JSON.stringify(r).includes('483920'), false, 'the code is never in what we hand back');
});

test('an error inside the delivery layer is caught, named by kind, and never logged with a number in it', async () => {
  const lines = [];
  const boom = { sendTransactionalSms: async () => { const e = new Error('connect ECONNREFUSED for +251900000001'); e.code = 'ECONNREFUSED'; throw e; } };
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: boom, sms: { mode: 'live', supports: () => true }, log: m => lines.push(m) });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: false, status: 'failed', errorKind: 'sender_error' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '[phone-code] sender ECONNREFUSED');
  assert.equal(lines[0].includes('251900000001'), false);
  assert.equal(lines[0].includes('483920'), false);
});

test('configured needs BOTH a token and live mode, and the reachable prefixes come from the SMS layer', () => {
  const d = fakeDelivery({ status: 'test' });
  const of = env => makePhoneCodeSender({ env, delivery: d });
  assert.equal(of(LIVE_ENV).configured, true);
  assert.equal(of({ SMS_MODE: 'live' }).configured, false, 'live with no token is not a door');
  assert.equal(of({ SMS_API_TOKEN: 'fake-token-for-tests' }).configured, false, 'a token with SMS off is not a door');
  assert.equal(of({}).configured, false);
  // With no sms layer injected the real one is built from the environment: no provider, no network.
  const s = of({});
  assert.equal(s.mode, 'test');
  assert.equal(s.supports('0900000001'), true, 'Ethio Telecom, reachable');
  assert.equal(s.supports('0700000001'), false, 'Safaricom (+2517) — GeezSMS cannot reach it, so it is not a door');
  assert.equal(s.supports('+971500000000'), false, 'not an Ethiopian mobile');
});
