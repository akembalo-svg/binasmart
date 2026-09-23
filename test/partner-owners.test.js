'use strict';
// Bina Partner owner card: owners are not only building owners. /api/me `owned` lists every business
// (hotel, building, shop, restaurant, clinic, cinema...) and /partner and /login route on it.
// Businesses and people here are invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pub = path.join(__dirname, '..', 'public');
const partner = fs.readFileSync(path.join(pub, 'partner.html'), 'utf8');
const login = fs.readFileSync(path.join(pub, 'login.html'), 'utf8');

function fromPartner() {
  const m = partner.match(/\/\* route:start[\s\S]*?\*\/([\s\S]*?)\/\* route:end \*\//);
  const ctx = {};
  vm.runInNewContext(m[1] + '\nthis.partnerRoute = partnerRoute;', ctx);
  return ctx.partnerRoute;
}
function fromLogin() {
  const m = login.match(/function destFor\(me, next, explicit\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'login.html has destFor');
  const ctx = {};
  vm.runInNewContext(m[0] + '\nthis.destFor = destFor;', ctx);
  return ctx.destFor;
}
const route = fromPartner();
const destFor = fromLogin();
const plain = x => JSON.parse(JSON.stringify(x));   // results come from another realm

const HOTEL = { id: 'building:sample-hotel', type: 'hotel', name: 'Sample Hotel', nameAm: 'ናሙና ሆቴል', url: '/owner/sample-hotel', access: 'account' };
const TOWER = { id: 'building:sample-tower', type: 'building', name: 'Sample Tower', url: '/owner/sample-tower', access: 'owner_key' };
const CAFE = { id: 'shop:s-1', type: 'cafe', name: 'Sample Cafe', url: '/business', access: 'business_sign_in' };
const CINEMA = { id: 'venue:v-1', type: 'venue', name: 'Sample Cinema', url: '/business', access: 'business_sign_in' };
const me = (roles, owned, extra) => Object.assign({ id: 'u-test', name: 'Test Owner', roles: ['user'].concat(roles), owned }, extra || {});

test('the owner of one hotel goes straight to its dashboard', () => {
  const r = plain(route(me(['building_owner'], [HOTEL], { buildingSlug: 'sample-hotel' }), null, null));
  assert.equal(r.view, 'go');
  assert.equal(r.to.kind, 'owner');
  assert.equal(r.to.href, '/owner/sample-hotel');
  assert.equal(r.to.biz.type, 'hotel');
});

test('several businesses (hotel + building) open the list; the last one is remembered only if still owned', () => {
  const two = me(['building_owner', 'business'], [HOTEL, TOWER], { buildingSlug: 'sample-hotel' });
  const r = plain(route(two, null, 'building:sample-tower'));
  assert.equal(r.view, 'owners');
  assert.equal(r.businesses.map(b => b.type).join(','), 'hotel,building');
  assert.equal(r.lastBiz, 'building:sample-tower');
  assert.equal(route(two, null, 'shop:someone-else').lastBiz, null);
});

test('one business that needs its own sign-in (a cafe, a cinema) shows the list with that step, not a guess', () => {
  const r = plain(route(me(['business'], [CAFE]), null, null));
  assert.equal(r.view, 'owners');
  assert.equal(r.businesses[0].access, 'business_sign_in');
  assert.ok(partner.includes("business_sign_in: { am:") && partner.includes("owner_key: { am:"), 'each sign-in step has words');
  assert.ok(partner.includes("return b.access === 'owner_key' ? '/owner' : b.url;"), 'an owner-key building goes to the password sign-in');
});

test('driver + shop owner get the two-card chooser (Driver / Owner)', () => {
  const r = plain(route(me(['driver', 'business'], [CAFE, CINEMA]), 'owner', null));
  assert.equal(r.view, 'choose');
  assert.equal(r.options.map(o => o.kind).join(','), 'driver,owner');
  assert.equal(r.options[1].list, true);
  assert.equal(r.last, 'owner');
  const one = plain(route(me(['driver', 'building_owner'], [HOTEL]), null, null));
  assert.equal(one.options[1].href, '/owner/sample-hotel', 'one account-opened business: the Owner card goes straight there');
});

test('an empty owned list is nobody\'s business, whatever the old fields say', () => {
  assert.equal(route(me(['business'], []), null, null).view, 'none');
  assert.equal(route(me([], [{ id: 'x', url: 'https://evil.example/' }, { id: 'y', url: '//evil.example' }]), null, null).view, 'none', 'off-site URLs are dropped');
});

test('the owner card is not called "my building" any more', () => {
  assert.ok(!partner.includes("title: 'ሕንጻዬ'"));
  assert.ok(partner.includes("title: 'ባለቤት'"));
  assert.ok(partner.includes('የንግድዎ ዳሽቦርድ'));
});

test('login destFor: single owner homes of any kind, ?next honoured except for a building dashboard', () => {
  assert.equal(destFor(me(['building_owner'], [HOTEL]), '/', false), '/owner/sample-hotel');
  assert.equal(destFor(me(['building_owner'], [HOTEL]), '/ride', true), '/owner/sample-hotel', 'a building dashboard wins as before');
  assert.equal(destFor(me(['business'], [CAFE]), '/', false), '/business', 'a cafe owner lands on their dashboard, not /account');
  assert.equal(destFor(me(['business'], [CAFE]), '/ride', true), '/ride', '...but a page they asked for comes first');
  assert.equal(destFor(me(['business'], [CAFE, CINEMA]), '/', false), '/business', 'two /business pages are one home (it has a switcher)');
  assert.equal(destFor(me(['building_owner', 'business'], [HOTEL, CAFE]), '/', false), '/account', 'two different dashboards: the account hub');
  assert.equal(destFor(me(['driver', 'business'], [CAFE]), '/', false), '/account');
  assert.equal(destFor(me(['driver'], []), '/', false), '/drive');
  assert.equal(destFor(me(['rider'], []), '/ride', true), '/ride');
});

test('login destFor still works with an /api/me that has no owned list', () => {
  const old = (roles, extra) => Object.assign({ roles: ['user'].concat(roles) }, extra || {});
  assert.equal(destFor(old(['building_owner'], { buildingSlug: 'sample-tower' }), '/', false), '/owner/sample-tower');
  assert.equal(destFor(old(['business']), '/', false), '/account');
  assert.equal(destFor(null, '/x', true), '/x');
});
