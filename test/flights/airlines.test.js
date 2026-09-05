'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../../flights/airlines');

const FAKE = [
  { id: 'ET', name: 'Ethiopian', site: 'https://www.ethiopianairlines.com/', paysBirr: true },
  { id: 'EK', name: 'Emirates', site: 'https://www.emirates.com/', paysBirr: false },
];

test('with no affiliate id, the button still points at the airline', () => {
  const { url, sponsored, rel } = A.linkFor(FAKE[0], {});
  assert.strictEqual(url, 'https://www.ethiopianairlines.com/');
  assert.strictEqual(sponsored, false);
  // an ordinary outbound link must not be marked as paid
  assert.ok(!rel.includes('sponsored'), 'unpaid link wrongly marked sponsored');
});

test('an affiliate id replaces the link and marks it as paid', () => {
  const { url, sponsored, rel } = A.linkFor(FAKE[0], { AFF_ET: 'https://www.anrdoezrs.net/click-123-456' });
  assert.strictEqual(url, 'https://www.anrdoezrs.net/click-123-456');
  assert.strictEqual(sponsored, true);
  assert.ok(rel.includes('sponsored'), 'paid link must carry rel=sponsored');
  assert.ok(rel.includes('nofollow'));
});

test('a broken or unencrypted affiliate value is ignored, never shown to a customer', () => {
  for (const bad of ['', '   ', 'not a url', 'http://insecure.example/x', 'javascript:alert(1)', null, undefined]) {
    const { url, sponsored } = A.linkFor(FAKE[0], { AFF_ET: bad });
    assert.strictEqual(url, 'https://www.ethiopianairlines.com/', 'fell through to a bad link for ' + JSON.stringify(bad));
    assert.strictEqual(sponsored, false);
  }
});

test('only Ethiopian is offered to someone paying in birr', () => {
  const rows = A.resolve({}, FAKE);
  assert.deepStrictEqual(A.payableInBirr(rows).map(a => a.id), ['ET']);
  assert.deepStrictEqual(A.cardOnly(rows).map(a => a.id), ['EK']);
});

test('the shipped list keeps Ethiopian as the only birr airline', () => {
  const rows = A.resolve({});
  const birr = A.payableInBirr(rows).map(a => a.id);
  assert.deepStrictEqual(birr, ['ET'],
    'only Ethiopian Airlines takes telebirr/CBE — adding another here would send local customers to a checkout they cannot pay');
  assert.ok(rows.length >= 4);
  rows.forEach(a => assert.ok(a.site.startsWith('https://'), a.id + ' has a non-https site'));
});

test('liveAffiliates reports exactly which programmes are switched on', () => {
  assert.deepStrictEqual(A.liveAffiliates(A.resolve({}, FAKE)), []);
  const one = A.resolve({ AFF_EK: 'https://prf.hn/click/abc' }, FAKE);
  assert.deepStrictEqual(A.liveAffiliates(one), ['EK']);
});

test('envKey is the documented name', () => {
  assert.strictEqual(A.envKey('et'), 'AFF_ET');
  assert.strictEqual(A.envKey('QR'), 'AFF_QR');
});
