'use strict';
// The rule that decides whose phone number the flights page publishes.
//
// It publishes a phone, a unit and a floor, so the only acceptable answer is "someone decided this".
const test = require('node:test');
const assert = require('node:assert');
const { isFlightPartner, partnerSlugs } = require('../../flights/partners');

const shop = (name, extra) => ({ name, nameAm: null, slug: null, ...extra });
const NONE = { FLIGHT_PARTNERS: '' };
const LIVE = { FLIGHT_PARTNERS: 'hanud-travel-agency-plc' };

// The measured leak: /api/flights/:slug matched with `contains` against every live shop and returned
// a phone, a unit and a floor. These are real tenants of JJ Darule.
test('a tenant nobody named is not a flight partner', () => {
  for (const [n, sl] of [['Selamawit Kebede Adnew', 'selamawit-kebede-adnew'],
    ['Samuel Nigussie Hailu', 'samuel-nigussie-hailu'],
    ['Cooperative Bank of Oromia', 'cooperative-bank-of-oromia'],
    ['MNNB Pharmacy — Cosmo Trading PLC', 'mnnb-pharmacy-cosmo-trading-plc']])
    assert.equal(isFlightPartner(shop(n, { slug: sl }), null, LIVE), false, n + ' must not qualify');
});

test('the partner named in the environment qualifies', () => {
  assert.equal(isFlightPartner(shop('Hanud Travel Agency PLC', { slug: 'hanud-travel-agency-plc' }), null, LIVE), true);
});

// The point of dropping the trade fallback. Before 2026-09-12 this returned true: any shop whose name
// said travel, tour or ጉዞ was enrolled and had its phone published, with nobody deciding.
test('⚠️ a shop that trades in travel but was NOT named does not qualify', () => {
  assert.equal(isFlightPartner(shop('Selam Tours', { slug: 'selam-tours' }), null, LIVE), false,
    'trading in travel is not consent to have your number published');
  assert.equal(isFlightPartner(shop('Global Visa & Travel Service', { slug: 'global-visa-travel-service' }), null, LIVE), false);
  assert.equal(isFlightPartner(shop('X', { slug: 'x', nameAm: 'የጉዞ ወኪል' }), null, LIVE), false);
});

test('naming a shop whose name says nothing about travel still works — the list is the authority', () => {
  const env = { FLIGHT_PARTNERS: 'quiet-name-plc' };
  assert.equal(isFlightPartner(shop('Quiet Name PLC', { slug: 'quiet-name-plc' }), null, env), true);
});

test('the list is parsed tolerantly: spaces and stray commas', () => {
  assert.deepEqual(partnerSlugs({ FLIGHT_PARTNERS: ' a , b ,, c ' }), ['a', 'b', 'c']);
});

// Fail-closed: a config mistake must take the page offline, not publish somebody by accident.
test('an empty or unset FLIGHT_PARTNERS means nobody is a partner', () => {
  assert.deepEqual(partnerSlugs({ FLIGHT_PARTNERS: '' }), []);
  assert.deepEqual(partnerSlugs({}), []);
  assert.equal(isFlightPartner(shop('Hanud Travel Agency PLC', { slug: 'hanud-travel-agency-plc' }), null, NONE), false);
});

test('a shop with no slug never matches, least of all an empty entry in the list', () => {
  assert.equal(isFlightPartner(shop('Nothing', { slug: null }), null, { FLIGHT_PARTNERS: ',,' }), false);
  assert.equal(isFlightPartner(shop('Nothing', { slug: '' }), null, { FLIGHT_PARTNERS: ',,' }), false);
});

test('no shop at all is not a partner', () => {
  assert.equal(isFlightPartner(null, null, LIVE), false);
  assert.equal(isFlightPartner(undefined, null, LIVE), false);
});
