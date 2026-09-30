'use strict';
// The Amharic header of an English document. Three things have to hold, and none of them may be taken on
// trust from a model: the sidecar must reach the rendered page, a pack that did not ask for it must render
// exactly as before, and a figure that is not on the page must never survive into a summary.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const P = require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js'));
const banking = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', 'sources.json'), 'utf8'));
const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'travel', 'sources.json'), 'utf8'));

const zemen = banking.sites.find(s => s.id === 'zemen');
const page = { url: 'https://zemenbank.com/tariff/', title: 'Tariff', slug: 'zemen-tariff', path: '/tariff',
  section: 'fees', sectionTitleAm: 'ክፍያዎችና ታሪፍ', lang: 'en',
  text: '## Digital-Channels Transaction on Fees and Charges\n\nA card costs 100 birr and the daily ATM limit is 20,000 birr.\n\n## Account Services\n\nsomething' };

// A sidecar written by hand, so this test never calls Gemini and never depends on what a model said today.
// The hash is the page's own: an entry stamped with any other text's hash is ignored by the renderer, which is
// what keeps last week's summary off a page the bank edited this week.
const fake = { 'zemen-tariff': { titleAm: 'የዘመን ባንክ ታሪፍ', summaryAm: 'ገጹ የካርድ ክፍያና የኤቲኤም ገደብ ያሳያል። የካርድ ዋጋ 100 ብር ነው።',
  contentHash: null, generatedAt: '2026-09-17', model: 'gemini-2.5-flash' } };
fake['zemen-tariff'].contentHash = P.contentHash(page.text);
const opts = { today: '2026-09-17', pack: banking.pack, amHeaders: fake };

test('the banking registry asks for Amharic headers and the travel registry does not', () => {
  assert.equal(banking.pack.amHeaders, true);
  assert.equal(travel.pack.amHeaders, undefined, 'the airline pack must not gain an Amharic sidecar by accident');
});

test('the Amharic title reaches the H1 and the front matter', () => {
  const md = P.renderDoc(page, zemen, opts);
  assert.match(md, /^titleAm: "የዘመን ባንክ ታሪፍ"$/m);
  assert.match(md, /^# Zemen Bank — Tariff · የዘመን ባንክ ታሪፍ$/m);
});

test('the Amharic summary is the fourth header paragraph, after the Amharic sentence and before the Source line', () => {
  const md = P.renderDoc(page, zemen, opts);
  const paras = P.bodyOf(md).split('\n\n');
  assert.match(paras[1], /^Zemen Bank — fees — Tariff\./, 'the first paragraph is still what the page is');
  assert.match(paras[2], /^በአማርኛ፦/, 'the second is still the Amharic sentence');
  assert.equal(paras[3], fake['zemen-tariff'].summaryAm, 'the third must be the generated summary');
  assert.match(paras[4], /^Source: https:\/\/zemenbank\.com\/tariff\//, 'the Source line must still follow it');
});

test('an Amharic page of the same bank gets no generated Amharic header', () => {
  const am = { ...page, slug: 'zemen-tariff', lang: 'am' };
  const md = P.renderDoc(am, zemen, opts);
  assert.equal(/^titleAm:/m.test(md), false);
  assert.equal(md.includes(fake['zemen-tariff'].summaryAm), false);
});

test('without amHeaders in the pack block nothing changes at all', () => {
  const off = { ...banking.pack };
  delete off.amHeaders;
  const with_ = P.renderDoc(page, zemen, { today: '2026-09-17', pack: off, amHeaders: fake });
  const without = P.renderDoc(page, zemen, { today: '2026-09-17', pack: off });
  assert.equal(with_, without);
  assert.equal(with_.includes('የዘመን ባንክ ታሪፍ'), false);
  assert.equal(/^titleAm:/m.test(with_), false);
});

test('the grounding check rejects a figure the page does not print, and passes one it does', () => {
  assert.deepEqual(P.ungroundedFigures(page.text, 'የካርድ ዋጋ 100 ብር ነው።'), []);
  assert.deepEqual(P.ungroundedFigures(page.text, 'የኤቲኤም ገደብ 20000 ብር ነው።'), [], 'a thousands separator on the page is not a different number');
  assert.deepEqual(P.ungroundedFigures(page.text, 'የካርድ ዋጋ 250 ብር ነው።'), ['250']);
  assert.deepEqual(P.ungroundedFigures(page.text, 'ከ2019 ጀምሮ', '15%'), ['2019', '15']);
});

test('Ethiopic punctuation and spacing are not figures', () => {
  assert.deepEqual(P.ungroundedFigures('nothing numeric here', 'ይህ ገጽ ስለ ባንኩ ነው። ክፍያ የለውም፣ ገደብም የለውም።'), []);
});

test('bodyText recovers the page text whether the header has three paragraphs or four', () => {
  const four = P.renderDoc(page, zemen, opts);
  const three = P.renderDoc(page, zemen, { today: '2026-09-17', pack: banking.pack });
  assert.equal(P.bodyText(four), page.text.trim());
  assert.equal(P.bodyText(three), page.text.trim());
});

test('the content hash is still a hash of the page text, not of the header', () => {
  const four = P.renderDoc(page, zemen, opts);
  const three = P.renderDoc(page, zemen, { today: '2026-09-17', pack: banking.pack });
  assert.equal(P.readMeta(four).contentHash, P.readMeta(three).contentHash);
  assert.equal(P.readMeta(four).contentHash, P.contentHash(page.text));
});

test('a header-only difference is not the same document, so writePack re-renders it', () => {
  const four = P.renderDoc(page, zemen, opts);
  const three = P.renderDoc(page, zemen, { today: '2026-09-17', pack: banking.pack });
  assert.equal(P.sameDoc(four, three), false);
  assert.equal(P.sameDoc(three, three.replace(/^lastChecked: ".*"$/m, 'lastChecked: "2026-12-25"')), true);
});

test('an entry written from text the page no longer has is ignored, not published', () => {
  const edited = { ...page, text: page.text.replace('100 birr', '150 birr') };
  const md = P.renderDoc(edited, zemen, opts);
  assert.equal(md.includes(fake['zemen-tariff'].summaryAm), false,
    'last week\'s Amharic summary was published on a page the bank has since edited');
  assert.equal(/^titleAm:/m.test(md), false, 'the Amharic title was generated from the old text too');
  const fresh = { 'zemen-tariff': { ...fake['zemen-tariff'], contentHash: P.contentHash(edited.text) } };
  assert.match(P.renderDoc(edited, zemen, { ...opts, amHeaders: fresh }), /^titleAm: "የዘመን ባንክ ታሪፍ"$/m,
    'the entry generated from the new text must be used');
});

test('the sidecar on disk holds only entries for English documents of this pack', () => {
  const side = P.readAmHeaders('banking');
  assert.ok(side && Object.keys(side).length, 'knowledge/banking/am-headers.json should exist');
  for (const [slug, e] of Object.entries(side)) {
    assert.ok(/[ሀ-፿]/.test(e.titleAm), slug + ': titleAm must be Amharic');
    assert.ok(e.contentHash && e.generatedAt && e.model, slug + ': the sidecar must say what it was made from');
    const md = fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', slug + '.md'), 'utf8');
    assert.notEqual(P.readMeta(md).lang, 'am', slug + ': an Amharic page needs no generated Amharic header');
    // A page split by sectionDocs is still one page: its entry is stamped with the whole page's hash, which its
    // section documents carry too, so the figures it may state are the whole page's, wherever they now sit.
    // (Endekise's summary says "6 months"; the digit is in the Mela terms the page carries, now a section.)
    const dir = path.join(ROOT, 'knowledge', 'banking');
    const sections = fs.readdirSync(dir).filter(f => f.startsWith(slug + '-') && f.endsWith('.md'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).filter(x => P.readMeta(x).sectionOf === slug);
    const text = [md, ...sections].map(x => P.bodyText(x)).join('\n\n');
    if (e.summaryAm) assert.deepEqual(P.ungroundedFigures(text, e.titleAm, e.summaryAm), [],
      slug + ': every figure in the Amharic header must be on the page');
  }
});
