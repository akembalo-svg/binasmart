'use strict';
// knowledge/travel/sources.json drives ops/travel/fetch-airline.js: an entry that is wrong here becomes a
// page fetched that should not have been, or a section of the airline's site silently missing from the pack.
// So the shape is pinned, and so are the two rules the design sets: booking, account and promotional pages
// are never fetched, and a source we cannot reach from this server is listed as manual rather than dropped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'knowledge', 'travel', 'sources.json');
const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('the registry has a version, a note and a list of sites', () => {
  assert.equal(typeof reg.version, 'number');
  assert.ok(reg._about.length > 40, 'the file says what it is for');
  assert.ok(Array.isArray(reg.sites) && reg.sites.length >= 2);
});

test('every site has the fields the fetcher reads', () => {
  for (const s of reg.sites) {
    assert.match(s.id, /^[a-z0-9-]+$/, 'id is a slug: ' + s.id);
    assert.match(s.host, /^[a-z0-9.-]+$/, s.id + ' host');
    assert.equal(typeof s.name, 'string');
    assert.ok(['sitemap', 'list', 'manual'].includes(s.fetch), s.id + ' fetch mode: ' + s.fetch);
    assert.ok(Number.isInteger(s.crawlDelaySeconds) && s.crawlDelaySeconds >= 5, s.id + ' pacing >= 5s');
    assert.equal(typeof s.reach, 'string');
    assert.ok(s.checked, s.id + ' says when reachability was checked');
    if (s.fetch === 'sitemap') assert.match(s.sitemap, /^https:\/\//, s.id + ' sitemap url');
    if (s.fetch === 'list') assert.ok(Array.isArray(s.urls) && s.urls.length, s.id + ' needs urls');
    if (s.fetch === 'manual') assert.ok(s.why && s.why.length > 20, s.id + ' must say why it is manual');
  }
});

test('an id is used once', () => {
  const ids = reg.sites.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every fetched site has an allowlist and a denylist, and every pattern is a valid regular expression', () => {
  for (const s of reg.sites.filter(x => x.fetch !== 'manual')) {
    assert.ok(Array.isArray(s.allow) && s.allow.length, s.id + ' allow');
    assert.ok(Array.isArray(s.deny), s.id + ' deny');
    for (const p of [...s.allow, ...s.deny]) assert.doesNotThrow(() => new RegExp(p), s.id + ' bad pattern ' + p);
  }
});

test('booking, account and promotional paths are denied on the airline site', () => {
  const et = reg.sites.find(s => s.id === 'ethiopian-airlines');
  const deny = et.deny.map(p => new RegExp(p));
  const allow = et.allow.map(p => new RegExp(p));
  const blocked = p => deny.some(r => r.test(p)) || !allow.some(r => r.test(p));
  for (const p of ['/et/book/booking/flight', '/et/home-page/save-10', '/et/home-page/flash-sales',
    '/et/customer-surveys/module-1/cc', '/et/blog/travel-tips', '/et/explore/deals-offers/top-flights',
    '/et/ethiopian-offers', '/et/sitemap', '/et/supporttest', '/et/customer-survey-landing',
    '/et/explore/et-specials/ado-partner-portal--authorized-users-only'])
    assert.ok(blocked(p), 'must not be fetched: ' + p);
});

test('the information sections the design names are allowed', () => {
  const et = reg.sites.find(s => s.id === 'ethiopian-airlines');
  const deny = et.deny.map(p => new RegExp(p));
  const allow = et.allow.map(p => new RegExp(p));
  const ok = p => allow.some(r => r.test(p)) && !deny.some(r => r.test(p));
  for (const p of ['/et/information/baggage-information/free-baggage-allowance',
    '/et/information/rules-and-regulations/conditions-of-carriage',
    '/et/information/essential-information/optional-service-charges',
    '/et/information/special-needs/travelling-with-pets',
    '/et/book/manage/refund-request', '/et/book/check-in/online-check-in',
    '/et/book/special-deals/medical-travel',
    '/et/services/services-at-the-airport/minimum-connecting-time',
    '/et/services/add-on-services/premium-lounge-access',
    '/et/services/on-board-services/cloud-nine-services',
    '/et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs',
    '/et/explore/et-specials/et-holidays',
    '/et/explore/et-specials/ethiopian-skylight-hotel-packages',
    '/et/meet-and-greet-services-at-addis-ababa-airport'])
    assert.ok(ok(p), 'must be fetched: ' + p);
});

test('the cargo site is manual, because what it publishes as a sitemap is an HTML page', () => {
  // cargo.ethiopianairlines.com/sitemap.xml answers 200 as text/html, 61 KB, with no <loc> at all and the
  // words Page Not Found in the body. There is no list of URLs to fetch politely, so the site is named and
  // left manual rather than crawled blind or quietly dropped.
  const cargo = reg.sites.find(s => s.id === 'ethiopian-cargo');
  assert.equal(cargo.host, 'cargo.ethiopianairlines.com');
  assert.equal(cargo.fetch, 'manual');
  assert.ok(!cargo.sitemap, 'no sitemap url is claimed for it');
  assert.match(cargo.why, /sitemap/i);
  assert.match(cargo.why, /page not found/i);
});

test('the passenger-rights regulator is listed even though the server cannot reach it', () => {
  const ecaa = reg.sites.find(s => s.id === 'ecaa');
  assert.equal(ecaa.fetch, 'manual');
  assert.match(ecaa.reach, /unreachable/i);
  assert.match(ecaa.why, /Ethiopia/);
});

test('the bina.et airport guide is a reference, never re-crawled', () => {
  const ref = reg.references.find(r => /bina\.et\/airport/.test(r.url));
  assert.ok(ref, 'the Bole guide is named');
  assert.equal(ref.fetch, 'none');
  assert.match(ref.note, /already indexed/i);
});
