'use strict';
// The rule that decides whose phone number the flights page publishes.
const test = require('node:test');
const assert = require('node:assert');
const { isFlightPartner, partnerSlugs } = require('../../flights/partners');

const shop = (name, extra) => ({ name, nameAm: null, slug: null, ...extra });
const NO_ENV = { FLIGHT_PARTNERS: '' };

// The measured leak: /api/flights/:slug matched with `contains` against every live shop and returned
// a phone, a unit and a floor. These are real tenants of JJ Darule.
test('a tenant who is not a travel agency is not a flight partner', () => {
  for (const n of ['Selamawit Kebede Adnew', 'Samuel Nigussie Hailu', 'Cooperative Bank of Oromia',
    'MNNB Pharmacy — Cosmo Trading PLC', 'Axis Finishing Works PLC'])
    assert.equal(isFlightPartner(shop(n), null, NO_ENV), false, n + ' must not qualify');
});

test('the agency that does trade in travel qualifies', () => {
  assert.equal(isFlightPartner(shop('Hanud Travel Agency PLC'), null, NO_ENV), true);
  assert.equal(isFlightPartner(shop('Selam Tours'), null, NO_ENV), true);
});

test('Amharic counts too — ጉዞ is how an agency names itself locally', () => {
  assert.equal(isFlightPartner(shop('X', { nameAm: 'ሀኑድ የጉዞ ወኪል' }), null, NO_ENV), true);
});

// The comment in the original code records what went wrong when the test was looser: "air" on its own
// matched a spa, "ticket" a park ticket office. Pin both so nobody widens it back.
test('the trade test does not widen to "air" or "ticket"', () => {
  assert.equal(isFlightPartner(shop('Airport Spa & Wellness'), null, NO_ENV), false);
  assert.equal(isFlightPartner(shop('Unity Park Ticket Office'), null, NO_ENV), false);
});

test('FLIGHT_PARTNERS names a partner whose name does not say travel', () => {
  const env = { FLIGHT_PARTNERS: 'hanud-travel-agency-plc, some-agency' };
  assert.deepEqual(partnerSlugs(env), ['hanud-travel-agency-plc', 'some-agency']);
  assert.equal(isFlightPartner(shop('Quiet Name PLC', { slug: 'some-agency' }), null, env), true);
  assert.equal(isFlightPartner(shop('Quiet Name PLC', { slug: 'another' }), null, env), false);
});

test('an empty or unset FLIGHT_PARTNERS yields no slugs rather than one blank one', () => {
  assert.deepEqual(partnerSlugs({ FLIGHT_PARTNERS: '' }), []);
  assert.deepEqual(partnerSlugs({}), []);
  // a shop with a null slug must never match the empty string
  assert.equal(isFlightPartner(shop('Nothing', { slug: null }), null, NO_ENV), false);
});

test('no shop at all is not a partner', () => {
  assert.equal(isFlightPartner(null, null, NO_ENV), false);
  assert.equal(isFlightPartner(undefined, null, NO_ENV), false);
});
