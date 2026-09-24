'use strict';
// The telebirr sections of the banking pack, on disk, as the index will chunk them (sources.json, ethiotelecom
// sectionDocs, 2026-09-23). Two answers regressed after line-safe chunking and both were retrieval, not the model:
//   - "what does telebirr charge to send 1,000 birr": the person-to-person tariff lost its page's two search places
//     to the page's header and its bank-transfer table, and the Amharic page's transfer tables were headed only
//     "ታሪፍ", so Bini quoted the bank tariff or said the fee was not given;
//   - "what are the terms of Mela micro-credit": the Endekise page carries Mela's full terms and conditions, which
//     were indexed as "Endekise › Pay Back" and reached Mela answers as the Endekise page.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'knowledge', 'banking');
const P = require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js'));
const { chunkDoc, lineSafeFor } = require(path.join(ROOT, 'knowledge', 'index.js'));

const reg = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const site = reg.sites.find(s => s.id === 'ethiotelecom');
const md = slug => fs.readFileSync(path.join(DIR, slug + '.md'), 'utf8');
// What knowledge/index.js indexes: the document without its front matter, titled with its front-matter title.
const chunks = slug => chunkDoc(md(slug).replace(/^---[\s\S]*?\n---\s*/, ''), P.readMeta(md(slug)).title, { lineSafe: lineSafeFor('banking') });
const head = c => c.text.split('\n')[0];

test('every telebirr section the registry names is on disk as a document of its page, and gone from the page', () => {
  assert.ok(Array.isArray(site.sectionDocs) && site.sectionDocs.length === 6, 'six sections: two tariffs x two languages, Mela terms x two languages');
  for (const s of site.sectionDocs) {
    const slug = s.doc + '-' + s.key;
    const m = P.readMeta(md(slug)), pm = P.readMeta(md(s.doc));
    assert.equal(m.sectionOf, s.doc, slug);
    for (const k of ['url', 'contentHash', 'fetchedAt', 'lang', 'section']) assert.equal(m[k], pm[k], slug + ' ' + k);
    assert.equal(m.status, 'live');
    assert.equal(/[0-9]/.test(s.title), false, 'no figure in a title we wrote: ' + s.title);
    assert.ok(P.bodyText(md(slug)).includes(s.start.replace(/^## /, '')), slug + ' opens with its own heading');
    assert.equal(P.bodyText(md(s.doc)).includes(s.start), false, s.doc + ' still holds ' + s.start);
  }
});

test('the person-to-person tariff is a chunk whose header names the transfer, in English and in Amharic', () => {
  const en = chunks('ethiotelecom-telebirr-telebirr-pricing-p2p-transfer-tariff').find(c => c.text.includes('501 to 1500 | 4 |'));
  assert.ok(en, 'the English person-to-person table is one chunk');
  assert.match(head(en), /telebirr to telebirr send money transfer tariff › telebirr to telebirr \(P2P\) transfer tariff$/);
  const am = chunks('ethiotelecom-am-telebirr-pricing-p2p-transfer-tariff').find(c => c.text.includes('501 to 1500 | 4 |'));
  assert.ok(am, 'the Amharic person-to-person table is one chunk');
  assert.match(head(am), /ከቴሌብር ወደ ቴሌብር/);
  for (const slug of ['ethiotelecom-telebirr-telebirr-pricing-bank-transfer-tariff', 'ethiotelecom-am-telebirr-pricing-bank-transfer-tariff']) {
    const c = chunks(slug).find(x => x.text.includes('501 to 1500 | 6 |'));
    assert.ok(c, slug + ': the bank-transfer table is one chunk');
    assert.match(head(c), /to bank transfer tariff|ከቴሌብር ወደ ባንክ/);
    assert.equal(c.text.includes('501 to 1500 | 4 |'), false, 'bank and person-to-person rows never share a chunk');
  }
  // and the pricing pages themselves keep cash-in and cash-out and no transfer table
  for (const slug of ['ethiotelecom-telebirr-telebirr-pricing', 'ethiotelecom-am-telebirr-pricing']) {
    const t = P.bodyText(md(slug));
    assert.equal(/501 to 1500 \| [46] \|/.test(t), false, slug + ' still holds a transfer table');
    assert.ok(t.includes('30,001 |') && t.includes('20,001 |'), slug + ' keeps its cash-in and cash-out tables');
  }
});

test('Mela\'s terms on the Endekise page are a Mela document; the Endekise page keeps only Endekise', () => {
  for (const [page, sec] of [['ethiotelecom-endekise-overdraft-service-credit-pay', 'ethiotelecom-endekise-overdraft-service-credit-pay-mela-terms-and-conditions'],
    ['ethiotelecom-am-endekise-overdraft', 'ethiotelecom-am-endekise-overdraft-mela-terms-and-conditions']]) {
    const pc = chunks(page), sc = chunks(sec);
    assert.equal(pc.some(c => /MELA \(MICRO-CREDIT\) SERVICES|መላ \( አነስተኛ ብድር\) አገልግሎትን ለማስጀመር/.test(c.text)), false, page + ' still carries the Mela terms');
    assert.ok(pc.some(c => /Credit amount \| Tariff|የክሬዲት መጠን \| ታሪፍ/.test(c.text)), page + ' keeps its own Endekise tariff');
    assert.ok(sc.length >= 8, sec + ' holds the whole terms');
    for (const c of sc) assert.doesNotMatch(head(c), /Endekise|እንደኪሴ/, sec + ' chunk ' + c.ord + ' is headed as Endekise');
    assert.ok(sc.every(c => /Mela|መላ/.test(head(c))), sec + ': every chunk header names Mela');
  }
});
