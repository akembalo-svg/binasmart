'use strict';
// What the banking registry would fetch, decided with no network at all. selectUrls is pure: give it a list
// of URLs and a site, and it returns exactly the pages that would be fetched, in the order they would be
// fetched. So the allow and deny lists can be tested against the URLs actually seen in the live sitemaps on
// 2026-09-16, which is what this file does.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js'));
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', 'sources.json'), 'utf8'));
const site = id => reg.sites.find(s => s.id === id);
const sel = (id, urls) => P.selectUrls(site(id), urls).map(p => p.path);

test('Zemen keeps the tariff, the rates and the products, and drops the news and the forms', () => {
  const urls = [
    'https://zemenbank.com/tariff/',
    'https://zemenbank.com/interest-rates/',
    'https://zemenbank.com/exchange-rates/',
    'https://zemenbank.com/faq/',
    'https://zemenbank.com/complaint/',
    'https://zemenbank.com/loan-calculators/',
    'https://zemenbank.com/banking-service/international-banking-2/forex-service/',
    'https://zemenbank.com/banking-service/personal-banking-2/consumer-deposit/',
    'https://zemenbank.com/digital-services/card-services/',
    'https://zemenbank.com/media-and-news/gallery/',
    'https://zemenbank.com/media-and-news/careers-at-zemen-bank/',
    'https://zemenbank.com/forms/transaction-dispute-form/',
    'https://zemenbank.com/branch-location/',
    'https://zemenbank.com/atm-registration/',
    'https://zemenbank.com/newsletter/',
    'https://evil.example.com/zemenbank.com/tariff/',
  ];
  const got = sel('zemen', urls);
  assert.ok(got.includes('/tariff'), 'the tariff is the most valuable page on the site');
  assert.ok(got.includes('/interest-rates'));
  assert.ok(got.includes('/banking-service/international-banking-2/forex-service'));
  assert.ok(got.includes('/digital-services/card-services'));
  for (const bad of ['/media-and-news/gallery', '/media-and-news/careers-at-zemen-bank',
    '/forms/transaction-dispute-form', '/branch-location', '/atm-registration', '/newsletter'])
    assert.equal(got.includes(bad), false, 'should not fetch ' + bad);
  assert.equal(got.some(p => /evil/.test(p)), false, 'never another host');
});

test('Dashen keeps the products and the FAQ, and never a news post', () => {
  const urls = [
    'https://dashenbanksc.com/frequently-asked-questions/',
    'https://dashenbanksc.com/consumer-loan/',
    'https://dashenbanksc.com/remittance/',
    'https://dashenbanksc.com/saving-deposit/',
    'https://dashenbanksc.com/diaspora-fixed-time-deposit/',
    'https://dashenbanksc.com/how-to-transfer-money-from-abroad/',
    'https://dashenbanksc.com/careers/',
    'https://dashenbanksc.com/bids/',
    'https://dashenbanksc.com/press-releases/',
    'https://dashenbanksc.com/photo-gallery/',
    'https://dashenbanksc.com/find-a-branch/',
    'https://dashenbanksc.com/dashen-bank-wins-best-bank-award-2026/',
  ];
  const got = sel('dashen', urls);
  assert.equal(got.length, 6, 'six product pages, nothing else: ' + got.join(' '));
  assert.ok(got.includes('/frequently-asked-questions'));
  assert.equal(got.includes('/dashen-bank-wins-best-bank-award-2026'), false, 'a news post must not slip in');
});

test('Coop Bank keeps the product tree and the FAQ answers, and drops the exchange-rate stream', () => {
  const urls = [
    'https://coopbankoromia.com.et/deposit-products/saving-account/ordinary-saving-account/',
    'https://coopbankoromia.com.et/loan-and-advances/overdraft-overdrawn-facility/',
    'https://coopbankoromia.com.et/interest-free-banking/wadiah-saving-account/salam/',
    'https://coopbankoromia.com.et/diaspora-banking/diaspora-consumer-loans/',
    'https://coopbankoromia.com.et/ufaqs/can-i-open-a-saving-account-with-zero-balance/',
    'https://coopbankoromia.com.et/ufaqs/is-there-active-job-vacancy-in-coopbank/',
    'https://coopbankoromia.com.et/exchange_rate/2026-09-15/',
    'https://coopbankoromia.com.et/careers/',
    'https://coopbankoromia.com.et/newsroom/',
    'https://coopbankoromia.com.et/obbo-abera-halilu-lucho/',
    'https://coopbankoromia.com.et/ifb-account-opening-form/',
  ];
  const got = sel('coopbank', urls);
  assert.equal(got.length, 5, 'five: ' + got.join(' '));
  assert.ok(got.includes('/ufaqs/can-i-open-a-saving-account-with-zero-balance'));
  assert.equal(got.includes('/ufaqs/is-there-active-job-vacancy-in-coopbank'), false, 'a vacancy FAQ is not banking');
  assert.equal(got.includes('/ifb-account-opening-form'), false, 'an application form is never fetched');
});

test('ECMA keeps the regulator and drops the events plugin', () => {
  const urls = [
    'https://ecma.gov.et/about/', 'https://ecma.gov.et/licensing/', 'https://ecma.gov.et/investor/',
    'https://ecma.gov.et/laws-regulation/', 'https://ecma.gov.et/regulatory-sandbox/frequently-asked-questions/',
    'https://ecma.gov.et/events-2/locations/', 'https://ecma.gov.et/my-bookings/', 'https://ecma.gov.et/login/',
    'https://ecma.gov.et/step-3/', 'https://ecma.gov.et/elementor-1138/', 'https://ecma.gov.et/performers/',
  ];
  const got = sel('ecma', urls);
  assert.equal(got.length, 5, 'five: ' + got.join(' '));
  assert.equal(got.some(p => /events-2|my-bookings|login|step-|elementor|performers/.test(p)), false);
});

test('CBE fetches only the URLs it names', () => {
  const s = site('cbe');
  const got = P.selectUrls(s, s.urls.concat(['https://combanketh.et/cbe-resources/news',
    'https://combanketh.et/misalliance/careers', 'https://combanketh.et/onlinebanking']));
  const paths = got.map(p => p.path);
  assert.ok(paths.includes('/misalliance/terms-and-tarrif'), 'the tariff is why this site is in the pack');
  assert.equal(paths.includes('/cbe-resources/news'), false);
  assert.equal(paths.includes('/misalliance/careers'), false);
  assert.equal(paths.includes('/onlinebanking'), false);
});

test('every selected page lands in a section, on every site', () => {
  const samples = {
    zemen: ['https://zemenbank.com/tariff/', 'https://zemenbank.com/digital-services/card-services/'],
    dashen: ['https://dashenbanksc.com/consumer-loan/', 'https://dashenbanksc.com/remittance/'],
    coopbank: ['https://coopbankoromia.com.et/deposit-products/saving-account/saving-account/'],
    ecma: ['https://ecma.gov.et/licensing/'],
    ethswitch: ['https://ethswitch.com/about-us/'],
  };
  for (const [id, urls] of Object.entries(samples)) {
    for (const p of P.selectUrls(site(id), urls)) {
      assert.ok(p.section, id + ': ' + p.path + ' has no section');
      assert.ok(p.sectionTitleAm, id + ': ' + p.path + ' has no Amharic section title');
    }
  }
});

test('every Amharic Zemen path in the sitemap has a readable name', () => {
  const z = site('zemen');
  const amPaths = Object.keys(z.pathSlugs);
  assert.ok(amPaths.length >= 10, 'the generated table should hold every allowed /am/ page, not just the two '
    + 'that were decoded by hand when the registry was first written; got ' + amPaths.length);
  const pages = amPaths.map(p => ({ path: p }));
  assert.doesNotThrow(() => P.assignSlugs(pages, z), 'an allowed Amharic path with no name stops the run');
  for (const p of P.assignSlugs(pages, z)) assert.match(p.slug, /^am-[a-z0-9-]{2,50}$/, 'bad Amharic slug: ' + p.slug);
});
