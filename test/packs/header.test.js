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

// An operator that publishes one page in several languages: the header names the page's language, and a translation
// names the English page it translates. The site, the page and every word below are invented.
const tsite = { id: 'demo', name: 'Demo Telecom', nameAm: 'ዴሞ ቴሌኮም', lang: 'en',
  langOverrides: [{ match: '\\?lang=am$', lang: 'am' }, { match: '\\?lang=om$', lang: 'om' }, { match: '\\?lang=so$', lang: 'so' }],
  translationOf: { '/tajaajila?lang=om': 'https://demo.example/service/', '/adeeg?lang=so': 'https://demo.example/service/' } };
const tpack = { headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}).', headerAmTemplate: 'ይህ ገጽ {fromAm} {langWordAm} የተወሰደ ነው።' };
const tpage = { url: 'https://demo.example/tajaajila/?lang=om', path: '/tajaajila?lang=om', slug: 'om-service', title: 'Tajaajila',
  text: '## Kuufama\n\nQarshii kuma tokko' };

test('an Oromo page says it is Oromo, in both header languages', () => {
  const h = P.header({ ...tpage, lang: 'om' }, tsite, '2026-09-23', tpack);
  assert.ok(h.includes('(official Demo Telecom page, in Afaan Oromoo)'), h);
  assert.ok(h.includes('በአፋን ኦሮሞ'), h);
  assert.ok(!h.includes('in English'), h);
});

test('a translation names the English page it translates; a page with no translationOf says nothing of the kind', () => {
  const tr = P.translationOfPage(tsite, '/tajaajila?lang=om', 'om');
  assert.equal(tr, 'https://demo.example/service/');
  const h = P.header({ ...tpage, lang: 'om', translationOf: tr }, tsite, '2026-09-23', tpack);
  assert.ok(h.includes('This page is in Afaan Oromoo: it is Demo Telecom\'s own Afaan Oromoo version of its English page https://demo.example/service/'), h);
  const plain = P.header({ ...tpage, lang: 'om' }, tsite, '2026-09-23', tpack);
  assert.ok(!plain.includes('version of its English page'), plain);
  // only a language the renderer names as a translation language is one: an English or Amharic page never is
  assert.equal(P.translationOfPage(tsite, '/tajaajila?lang=om', 'en'), undefined);
  assert.equal(P.translationOfPage(tsite, '/tajaajila?lang=om', 'am'), undefined);
  assert.equal(P.translationOfPage(tsite, '/elsewhere?lang=om', 'om'), undefined);
  assert.equal(P.translationOfPage({ id: 'x' }, '/tajaajila?lang=om', 'om'), undefined);
  const so = P.header({ ...tpage, lang: 'so', translationOf: P.translationOfPage(tsite, '/adeeg?lang=so', 'so') }, tsite, '2026-09-23', tpack);
  assert.ok(so.includes('in Somali') && so.includes('Somali version of its English page'), so);
});

test('a language the renderer does not know still reads "in English", as every page did before', () => {
  assert.deepEqual(P.langWords('xx'), P.LANG_WORDS.en);
  assert.deepEqual(P.langWords(undefined), P.LANG_WORDS.en);
  const h = P.header({ ...tpage, lang: 'xx' }, tsite, '2026-09-23', tpack);
  assert.ok(h.includes('in English'), h);
});

test('translationOf is written to the front matter and a re-render from disk keeps it', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-tr-'));
  const site = { ...tsite, name: 'Demo Telecom', sections: [] };
  const pg = { ...tpage, lang: 'om', translationOf: 'https://demo.example/service/' };
  const doc = P.renderDoc(pg, site, { today: '2026-09-23', pack: tpack });
  assert.match(doc, /^translationOf: "https:\/\/demo\.example\/service\/"$/m);
  assert.equal(P.readMeta(doc).translationOf, 'https://demo.example/service/');
  // an English page carries no translationOf line at all, so no existing document changes
  const en = P.renderDoc({ ...tpage, url: 'https://demo.example/service/', path: '/service', slug: 'service', lang: 'en' }, site, { today: '2026-09-23', pack: tpack });
  assert.doesNotMatch(en, /^translationOf:/m);
  const reg = { pack: { ...tpack, id: 'demo' }, sites: [{ ...site, name: site.name }] };
  const doc2 = doc.replace(/^source_name: .*$/m, 'source_name: "Demo Telecom"');
  fs.writeFileSync(path.join(dir, 'om-service.md'), doc2);
  const r = P.rerenderPack(dir, reg, { dryRun: false });
  assert.deepEqual(r.skipped, []);
  const after = fs.readFileSync(path.join(dir, 'om-service.md'), 'utf8');
  assert.equal(P.readMeta(after).translationOf, 'https://demo.example/service/');
  assert.ok(after.includes('version of its English page https://demo.example/service/'), after);
  fs.rmSync(dir, { recursive: true, force: true });
});
