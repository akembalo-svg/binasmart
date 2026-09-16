'use strict';
// SMS without a network: a fake fetch stands in for GeezSMS, and a provider that records calls proves when nothing
// may leave the server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEtMobile, smsParts, SMS_MAX_CHARS, labelled, buildingSmsLabel, validSender, DEFAULT_PRICE_TIERS, parsePriceTiers, smsUnitPrice,
  geezSupports, makeSms, makeGeezSms, makeSmsFromEnv } = require('../../messaging/sms');

function recorder({ ok = true, throws = false, error = 'refused' } = {}) {
  const calls = [];
  return { calls, name: 'fake', supports: geezSupports,
    send: async a => { calls.push(a); if (throws) throw new Error('down for 251900000001'); return ok ? { ok: true, providerId: 'P' + calls.length } : { ok: false, error }; } };
}

test('Ethiopian mobiles in every usual spelling become +2519… or +2517…', () => {
  for (const s of ['0900000001', '+251900000001', '251900000001', '00251900000001', '+251 900 000 001', '0900-000-001'])
    assert.equal(normalizeEtMobile(s), '+251900000001', s);
  assert.equal(normalizeEtMobile('0700000001'), '+251700000001');
});

test('landlines, foreign numbers and junk are not mobiles', () => {
  for (const s of ['0111234567', '+251111234567', '+971500000000', '900000001', '09000000011', 'abc', '', null, undefined])
    assert.equal(normalizeEtMobile(s), null, String(s));
});

test('GSM text: 160 characters in one part, 153 per part after that; {[]} count double', () => {
  assert.equal(smsParts(''), 0);
  assert.equal(smsParts('a'.repeat(160)), 1);
  assert.equal(smsParts('a'.repeat(161)), 2);
  assert.equal(smsParts('a'.repeat(306)), 2);
  assert.equal(smsParts('a'.repeat(307)), 3);
  assert.equal(smsParts('{'.repeat(80)), 1);
  assert.equal(smsParts('{'.repeat(81)), 2);
});

test('Amharic (Unicode) text: 70 characters in one part, 67 per part after that', () => {
  assert.equal(smsParts('ሰ'.repeat(70)), 1);
  assert.equal(smsParts('ሰ'.repeat(71)), 2);
  assert.equal(smsParts('ሰ'.repeat(134)), 2);
  assert.equal(smsParts('ሰ'.repeat(135)), 3);
  assert.equal(smsParts('a'.repeat(69) + 'ሰ'), 1);
});

test('test mode never calls the provider, even for a live building', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'test', provider: pr });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: true }), { status: 'test' });
  assert.equal(pr.calls.length, 0);
  assert.equal(sms.mode, 'test');
});

test('live mode still records test when the caller does not allow a live send (demo building)', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr });
  assert.equal(sms.mode, 'live');
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi' }), { status: 'test' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: false }), { status: 'test' });
  assert.equal(pr.calls.length, 0);
});

test('live mode and a live send: the provider gets the +251 number, the sender and the report URL', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr, sender: 'DEFAULT', callbackUrl: 'https://bina.et/api/sms/report/x' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: true }), { status: 'sent', providerId: 'P1' });
  assert.deepEqual(await sms.send({ to: '0900000002', text: 'hi', sender: 'Demo', live: true }), { status: 'sent', providerId: 'P2' });
  assert.deepEqual(pr.calls.map(c => [c.to, c.sender, c.callbackUrl]), [['+251900000001', 'DEFAULT', 'https://bina.et/api/sms/report/x'], ['+251900000002', 'Demo', 'https://bina.et/api/sms/report/x']]);
});

test('numbers the provider cannot reach, empty and over-long texts are refused before any call', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr });
  assert.deepEqual(await sms.send({ to: '0700000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'sms_unsupported_number' });
  assert.deepEqual(await sms.send({ to: '0111234567', text: 'hi', live: true }), { status: 'failed', errorKind: 'no_mobile' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: '', live: true }), { status: 'failed', errorKind: 'empty' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'a'.repeat(SMS_MAX_CHARS + 1), live: true }), { status: 'failed', errorKind: 'too_long' });
  assert.equal(pr.calls.length, 0);
  assert.equal(sms.supports('0900000001'), true);
  assert.equal(sms.supports('0700000001'), false);
  assert.equal(sms.supports(null), false);
});

test('a refusal or a provider error is a failure, and the log never carries the phone number', async () => {
  const logs = [];
  const refused = makeSms({ mode: 'live', provider: recorder({ ok: false, error: 'bad number 251900000001' }), log: m => logs.push(m) });
  assert.deepEqual(await refused.send({ to: '0900000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'sms_refused' });
  const broken = makeSms({ mode: 'live', provider: recorder({ throws: true }), log: m => logs.push(m) });
  assert.deepEqual(await broken.send({ to: '0900000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'provider_error' });
  assert.equal(logs.length, 2);
  for (const l of logs) assert.doesNotMatch(l, /900000001/);
});

test('GeezSMS send: POST form to /api/v1/sms/send, and api_log_id becomes the provider id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init });
    return { status: 200, json: async () => ({ message_status: 'success', log: 'async 00000000-0000-0000-0000-000000000000', phone: '251900000001', message: 'x', api_log_id: 6569829 }) }; };
  const g = makeGeezSms({ token: 'TOKEN-FAKE', shortcodeId: 'SC1', fetchImpl });
  assert.equal(g.name, 'geezsms');
  assert.deepEqual(await g.send({ to: '+251900000001', text: 'ሰላም', sender: '', callbackUrl: 'https://bina.et/api/sms/report/x' }), { ok: true, providerId: '6569829' });
  assert.equal(calls[0].url, 'https://api.geezsms.com/api/v1/sms/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(calls[0].init.body);
  assert.deepEqual([form.get('token'), form.get('phone'), form.get('msg'), form.get('shortcode_id'), form.get('callback')],
    ['TOKEN-FAKE', '251900000001', 'ሰላም', 'SC1', 'https://bina.et/api/sms/report/x']);
  await g.send({ to: '+251900000001', text: 'x', sender: 'Demo' });
  const f2 = new URLSearchParams(calls[1].init.body);
  assert.equal(f2.get('shortcode_id'), 'Demo');
  assert.equal(f2.has('callback'), false);
});

test('GeezSMS: anything but message_status success is a failure', async () => {
  const reply = (status, body) => makeGeezSms({ token: 't', fetchImpl: async () => ({ status, json: async () => { if (body === 'bad') throw new Error('not json'); return body; } }) });
  assert.equal((await reply(200, { message_status: 'failed', msg: 'invalid phone' }).send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.equal((await reply(500, 'bad').send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.equal((await reply(401, { message_status: 'success' }).send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.throws(() => makeGeezSms({ token: '' }), /token/);
  assert.equal(geezSupports('+251900000001'), true);
  assert.equal(geezSupports('+251700000001'), false);
});

test('GeezSMS balance: GET /api/v1/balance with the key header', async () => {
  const calls = [];
  const g = makeGeezSms({ token: 'TOKEN-FAKE', fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ balance: 120 }) }; } });
  const r = await g.balance();
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, { balance: 120 });
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].url, /^https:\/\/api\.geezsms\.com\/api\/v1\/balance\?token=TOKEN-FAKE$/);
  assert.equal(calls[0].init.headers['X-GeezSMS-Key'], 'TOKEN-FAKE');
});

test('every SMS starts with a label; a sender over 11 characters falls back to the default; prices come from config', async () => {
  assert.equal(labelled('BinaSmart · Demo Tower', 'ክፍል 211'), 'BinaSmart · Demo Tower፦ ክፍል 211');
  assert.throws(() => labelled('', 'x'), /label/);
  assert.throws(() => labelled('   ', 'x'), /label/);
  assert.equal(buildingSmsLabel('Demo Tower'), 'BinaSmart · Demo Tower');
  assert.equal(buildingSmsLabel('x'.repeat(60)), 'BinaSmart · ' + 'x'.repeat(40));
  assert.equal(buildingSmsLabel(''), 'BinaSmart');
  assert.deepEqual(['BinaSmart', 'BinaSmartETH', '', null, 'Bad<Name>'].map(validSender), ['BinaSmart', '', '', '', '']);
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr, sender: 'TooLongSenderName' });
  await sms.send({ to: '0900000001', text: 'x', live: true });
  await sms.send({ to: '0900000001', text: 'x', sender: 'BinaSmart', live: true });
  assert.deepEqual(pr.calls.map(c => c.sender), ['', 'BinaSmart']);
  assert.deepEqual(DEFAULT_PRICE_TIERS, [[10000, 0.7475], [50000, 0.4025], [null, 0.2875]]);
  assert.deepEqual([smsUnitPrice(1), smsUnitPrice(10000), smsUnitPrice(10001), smsUnitPrice(50001)], [0.7475, 0.7475, 0.4025, 0.2875]);
  assert.deepEqual(parsePriceTiers('[[100,1],[null,0.5]]'), [[100, 1], [null, 0.5]]);
  for (const bad of [undefined, '', 'nope', '[]', '[[1]]', '[["a",1]]']) assert.deepEqual(parsePriceTiers(bad), DEFAULT_PRICE_TIERS, String(bad));
});

test('from the environment: live only with SMS_MODE=live and a GeezSMS token', () => {
  assert.deepEqual([makeSmsFromEnv({}).mode, makeSmsFromEnv({}).provider], ['test', null]);
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'live' }).mode, 'test');
  const live = makeSmsFromEnv({ SMS_MODE: 'live', SMS_API_TOKEN: 't' });
  assert.deepEqual([live.mode, live.provider], ['live', 'geezsms']);
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'live', SMS_API_TOKEN: 't', SMS_PROVIDER: 'other' }).mode, 'test');
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'test', SMS_API_TOKEN: 't' }).mode, 'test');
});

// The owner dashboard reads the provider balance on the server (design §4). makeSms is the only thing the server
// holds, so it has to offer it — and offer nothing when no token is configured, which is what "off" means there.
test('the balance is reachable only when a provider is configured, and never the token or the URL', () => {
  const { makeSms, makeSmsFromEnv } = require('../../messaging/sms');
  assert.equal(makeSms({ mode: 'live', provider: null }).balance, null);
  assert.equal(makeSmsFromEnv({ SMS_PROVIDER: 'geezsms', SMS_MODE: 'live' }).balance, null, 'no token, no balance');
  let asked = 0;
  const provider = { name: 'fake', send: async () => ({ ok: true }), balance: async () => { asked++; return { ok: true, status: 200, body: { balance: 12 } }; } };
  // Test mode still has a balance: the account exists, it is the sending that is switched off.
  for (const mode of ['test', 'live']) {
    const sms = makeSms({ mode, provider });
    assert.equal(typeof sms.balance, 'function', mode);
  }
  const withToken = makeSmsFromEnv({ SMS_PROVIDER: 'geezsms', SMS_API_TOKEN: 'not-a-real-token', SMS_MODE: 'test' });
  assert.equal(typeof withToken.balance, 'function');
  assert.equal(JSON.stringify(Object.keys(withToken)).includes('token'), false);
  assert.equal(String(makeSms({ mode: 'live', provider }).balance).includes('geezsms.com'), false);
  assert.equal(asked, 0, 'building the adapter calls nothing');
});
