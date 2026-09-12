'use strict';
// The key that decides whether two bookings came from the same person.
//
// If it does not collapse format variants, the phone dimension of the rate limit is decorative:
// a caller re-types their number a different way and gets a fresh allowance.
const test = require('node:test');
const assert = require('node:assert');
const { phoneKey, normPhone } = require('../ride/phone');

test('the same Ethiopian number written any of the usual ways is one caller', () => {
  const forms = ['0911244344', '+251911244344', '251911244344', '251 911 244 344', '+251-911-244-344', '0911 244 344'];
  const keys = new Set(forms.map(phoneKey));
  assert.equal(keys.size, 1, 'these should all be one key, got: ' + [...keys].join(' | '));
  assert.equal(phoneKey('0911244344'), 'ph:911244344');
});

test('two different people are two keys', () => {
  assert.notEqual(phoneKey('0911244344'), phoneKey('0922873052'));
});

// The whole reason this is not normPhone. A booking from Dubai is a customer, and it must be limited
// rather than refused — normPhone would return null and the phone dimension would silently vanish.
test('a foreign number gets a key, where normPhone would give up', () => {
  assert.equal(normPhone('+971558785151'), null, 'normPhone rejects it, as it should for sending');
  assert.ok(phoneKey('+971558785151'), 'but it still has to be rate limited');
  assert.notEqual(phoneKey('+971558785151'), phoneKey('+971501234567'));
});

// Junk must not all collapse into one bucket, or one script kiddie exhausts the allowance for every
// caller whose number failed to parse.
test('input too short to identify anybody yields no key at all', () => {
  for (const junk of ['', null, undefined, 'not a phone', '12345', '+', '   '])
    assert.equal(phoneKey(junk), null, JSON.stringify(junk) + ' should not produce a key');
});

test('seven digits is enough to be somebody', () => {
  assert.equal(phoneKey('1234567'), 'ph:1234567');
});

// Two numbers sharing their last nine digits collide. Worth stating rather than discovering: the
// dimension is a rate limit, not an identity, and the IP dimension runs alongside it.
test('⚠️ numbers sharing the last nine digits deliberately collide', () => {
  assert.equal(phoneKey('+251911244344'), phoneKey('+1911244344'));
});
