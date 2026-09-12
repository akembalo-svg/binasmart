'use strict';
// The control that decides whether 71 tenants' phone numbers are public.
//
// Its failure mode is silent: if check() ever returned true for everything, the page would still
// work, the other tests would still pass, and the numbers would quietly be public again. So the
// negatives matter more than the positives here.
const test = require('node:test');
const assert = require('node:assert');
const { makeVisit, HOUR } = require('../../building/visit');

const T = Date.UTC(2026, 8, 12, 9, 30);
const v = (now = () => T) => makeVisit('a-test-secret', now);

test('a token minted for a building is accepted for that building', () => {
  const a = v();
  assert.equal(a.check('darulle', a.mint('darulle')), true);
});

// The reason the token is bound to a slug: one visit to one building must not unlock the other 28.
test('a token for one building does not work on another', () => {
  const a = v();
  assert.equal(a.check('cbe-tower', a.mint('darulle')), false);
  assert.equal(a.check('darulle', a.mint('cbe-tower')), false);
});

test('nothing at all is not a token', () => {
  const a = v();
  for (const junk of ['', null, undefined, 0, false, {}, [], 'notarealtoken1234567'])
    assert.equal(a.check('darulle', junk), false, JSON.stringify(junk) + ' must not pass');
});

test('a different secret produces a different token', () => {
  const mine = makeVisit('a-test-secret', () => T);
  const theirs = makeVisit('some-other-secret', () => T);
  assert.notEqual(mine.mint('darulle'), theirs.mint('darulle'));
  assert.equal(mine.check('darulle', theirs.mint('darulle')), false);
});

// A page opened at 09:59 must still work at 10:01, or the Call buttons die mid-visit.
test('the previous hour is still accepted', () => {
  const minted = v(() => T).mint('darulle');
  const later = v(() => T + HOUR);
  assert.equal(later.check('darulle', minted), true, 'a page open across the hour boundary lost its phones');
});

test('but two hours later it is spent', () => {
  const minted = v(() => T).mint('darulle');
  const later = v(() => T + 2 * HOUR + 60000);
  assert.equal(later.check('darulle', minted), false);
});

test('the token is short enough for a query string and long enough not to be guessed', () => {
  const t = v().mint('darulle');
  assert.equal(t.length, 22);
  assert.match(t, /^[A-Za-z0-9_-]+$/, 'base64url, so it survives a URL without escaping');
});

test('it refuses to be built without a secret', () => {
  assert.throws(() => makeVisit(''), /secret/);
  assert.throws(() => makeVisit(null), /secret/);
});
