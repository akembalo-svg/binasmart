'use strict';
// The header is the only part of a pack document that we write rather than copy, so it is the only part that
// can be wrong about the page. Three rules, and they are the same for every pack:
//   1. it never contains a figure — a kilo, a rate or a fee in a sentence we wrote is a fact from memory;
//   2. everything in it is copied from the page (its title, its own H1-H3 headings) or from the registry
//      (the site name, the section's Amharic title, the templates);
//   3. its wording belongs to the pack, not to the code. The airline's "the airline publishes no Amharic
//      page" and the bank's "rates and fees change, confirm before you act" are both registry text.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js'));
const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'travel', 'sources.json'), 'utf8'));
const banking = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', 'sources.json'), 'utf8'));

const page = { url: 'https://zemenbank.com/tariff/', title: 'Tariff', slug: 'tariff', path: '/tariff',
  section: 'fees', sectionTitleAm: 'ክፍያዎችና ታሪፍ',
  text: '## Digital-Channels Transaction on Fees and Charges\n\nPayment card issuance related services\n\n## Account Services\n\nsomething' };

test('both registries carry both header templates', () => {
  for (const reg of [travel, banking]) {
    assert.equal(typeof reg.pack.headerEnTemplate, 'string');
    assert.equal(typeof reg.pack.headerAmTemplate, 'string');
    assert.ok(/[ሀ-፿]/.test(reg.pack.headerAmTemplate), reg.pack.id + ' Amharic template must be Amharic');
  }
});

test('the banking header carries the dated honesty line in both languages', () => {
  const site = banking.sites.find(s => s.id === 'zemen');
  const h = P.header(page, site, '2026-09-17', banking.pack);
  assert.ok(h.includes(banking.pack.disclaimerEn), 'the English disclaimer is missing from the header');
  assert.ok(h.includes(banking.pack.disclaimerAm), 'the Amharic disclaimer is missing from the header');
  assert.ok(h.includes('https://zemenbank.com/tariff/'), 'the source url is missing');
  assert.ok(h.includes('2026-09-17'), 'the fetch date is missing');
  assert.ok(h.includes('Zemen Bank'), 'the institution name is missing');
  assert.ok(h.includes('ክፍያዎችና ታሪፍ'), 'the section Amharic title is missing');
});

test('the header never states a figure', () => {
  const site = banking.sites.find(s => s.id === 'zemen');
  const h = P.header(page, site, '2026-09-17', banking.pack);
  const written = h.split('\n').filter(l => !l.includes('https://') && !l.includes('2026-09-17')).join(' ');
  assert.equal(/\b\d+(\.\d+)?\s*(%|birr|etb|kg|usd)/i.test(written), false, 'a figure appeared in text we wrote: ' + written);
});

test('a heading holding a digit is still left out of "On this page"', () => {
  const site = banking.sites.find(s => s.id === 'zemen');
  const withFigure = { ...page, text: '## Interest 16% on overdraft\n\ntext\n\n## Account Services\n\ntext' };
  const h = P.header(withFigure, site, '2026-09-17', banking.pack);
  assert.equal(h.includes('16%'), false);
  assert.ok(h.includes('Account Services'));
});

test('an Amharic page says it is Amharic, an English one says it is English', () => {
  const site = banking.sites.find(s => s.id === 'zemen');
  const am = { ...page, url: 'https://zemenbank.com/am/x', path: '/am/x', slug: 'am-banking-service', lang: 'am' };
  const hAm = P.header(am, site, '2026-09-17', banking.pack);
  const hEn = P.header(page, site, '2026-09-17', banking.pack);
  assert.ok(hAm.includes('in Amharic'), 'an Amharic page must say so: ' + hAm.slice(0, 400));
  assert.ok(hEn.includes('in English'), 'an English page must say so');
});

test('langFor reads the site langOverrides', () => {
  const zemen = banking.sites.find(s => s.id === 'zemen');
  assert.equal(P.langFor(zemen, '/am/%e1%8b%a8%e1%89%a3'), 'am');
  assert.equal(P.langFor(zemen, '/tariff'), 'en');
  const dashen = banking.sites.find(s => s.id === 'dashen');
  assert.equal(P.langFor(dashen, '/anything'), 'en');
});
