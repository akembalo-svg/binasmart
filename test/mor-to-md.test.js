'use strict';
// The Ministry of Revenue library generator (ops/mor/mor-to-md.js): its FAQ and forms documents, the /tax-forms page,
// and the `mor` knowledge source they feed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripStaff, faqsToMd, formSlug, formsToMd, formsPage, originalHref, writeMorDocs, FORMS_PATH } = require('../ops/mor/mor-to-md');
const { readSources, pageMatcher } = require('../knowledge/index');

const STAFF = { id: 7, first_name: 'Staffname', middle_name: 'Middlename', username: 'staffuser', role: 'admin', authority: 'SYSTEM_ADMIN' };

const FAQS = [
  { id: 11, question: ' የTIN ቅድመ ሁኔታዎች ምን ምን ናቸው? ', category: 'domestic law', deleted: false, User: STAFF,
    Answers: [{ id: 62, answer: 'የኪራይ ውል ይዞ ቅፅ መሙላት።', deleted: false, UserId: 7, User: STAFF }] },
  { id: 41, question: 'የንግድ ስራ ሀብት መዝገብ ምን መያዝ አለበት?', category: 'domestic law', deleted: false, User: STAFF,
    Answers: [{ id: 87, answer: 'ለ/ ሁለተኛ ነጥብ፣', deleted: false }, { id: 85, answer: 'መዝገቡ፡-', deleted: false },
      { id: 86, answer: 'ሀ/ የመጀመሪያ ነጥብ፣', deleted: false }, { id: 90, answer: 'የተሰረዘ መልስ', deleted: true }] },
  { id: 44, question: 'ለጉምሩክ የሚቀርቡ ሰነዶች?', category: 'custom law', deleted: false, User: STAFF, Answers: [{ id: 94, answer: 'የንግድ ፍቃድ።', deleted: false }] },
  { id: 99, question: 'የተሰረዘ ጥያቄ?', category: 'domestic law', deleted: true, User: STAFF, Answers: [{ id: 1, answer: 'x', deleted: false }] },
];

const FORMS = [
  { id: 6, title: 'የግብር ከፋይ መለያ ቁጥር ለመመለስ የሚቀርብ ማመልከቻ ቅጽ', pdfFile: 'https://www.mor.gov.et/Forms/1758095060522-246893703-form-TIN \u00e1\u0088\u0098.pdf',
    date: '2025-09-17T07:44:20.528Z', deleted: false, UserId: 2, User: STAFF, FormCategory: { name: 'የታክስ ከፋይ መለያ ቁጥር ቅፆች', engName: 'Tax Identification Number Forms', id: 5 } },
  { id: 2, title: 'የተጨማሪ እሴት ታክስ <መመዝገቢያ> ቅጽ', pdfFile: 'https://www.mor.gov.et/Forms/1758091959980-496727446-form-vat ragistration format.pdf',
    date: '2025-09-17T06:00:00.000Z', deleted: false, User: STAFF, FormCategory: { name: 'የተ.እ.ታ ቅጾች', engName: 'Value Addede Tax Forms', id: 1 } },
  { id: 5, title: 'Deleted form', pdfFile: 'https://www.mor.gov.et/Forms/x.pdf', deleted: true, FormCategory: { name: 'x', engName: 'X', id: 9 } },
];
const INFO = {
  6: { slug: 'tin-deregistration-request', en: 'TIN de-registration request', purpose_en: 'To ask the Ministry to cancel a TIN when a business stops.', purpose_am: 'ንግድ ሲቋረጥ የግብር ከፋይ መለያ ቁጥር ለመመለስ።' },
  2: { slug: 'vat-registration-form', en: 'VAT registration application', purpose_en: 'To register for VAT.', purpose_am: 'ለተጨማሪ እሴት ታክስ ለመመዝገብ።' },
};
const FILES = { 6: { bytes: 491942, pages: 2, sha256: 'a'.repeat(64) }, 2: { bytes: 120000, pages: 3, sha256: 'b'.repeat(64) } };

test('staff fields never survive: stripStaff removes User and UserId at every depth', () => {
  const s = stripStaff({ a: [{ User: STAFF, UserId: 7, b: { User: STAFF, keep: 1 } }] });
  assert.deepEqual(s, { a: [{ b: { keep: 1 } }] });
});

test('FAQ document: grouped by tax and customs, deleted items left out, multi-part answers in order, no staff names', () => {
  const md = faqsToMd(FAQS, { fetched: '2026-09-14' });
  assert.match(md, /^---\ntitle: "[^"]*Ministry of Revenue[^"]*"\n/);
  assert.match(md, /\nlang: "am"\n/);
  assert.match(md, /\nfetched: "2026-09-14"\n/);
  assert.match(md, /\nquestions: 3\n/);
  assert.equal(/Staffname|Middlename|staffuser/.test(md), false);
  assert.equal(/የተሰረዘ/.test(md), false, 'deleted question and deleted answer are not printed');
  const dom = md.indexOf('## ግብር'), cus = md.indexOf('## ጉምሩክ');
  assert.ok(dom > 0 && cus > dom, 'domestic tax section before customs');
  assert.match(md, /### የTIN ቅድመ ሁኔታዎች ምን ምን ናቸው\?\n/);
  const asset = md.split('### የንግድ ስራ ሀብት መዝገብ')[1].split('###')[0];
  assert.ok(asset.indexOf('መዝገቡ፡-') < asset.indexOf('ሀ/') && asset.indexOf('ሀ/') < asset.indexOf('ለ/'), 'answer parts in id order');
  assert.ok(md.indexOf('ለጉምሩክ የሚቀርቡ ሰነዶች') > cus);
});

test('form slugs are ASCII, come from the curated list, fall back to the id, and must be unique', () => {
  assert.equal(formSlug(FORMS[0], INFO), 'tin-deregistration-request');
  assert.equal(formSlug({ id: 42 }, {}), 'mor-form-42');
  assert.throws(() => formSlug({ id: 1 }, { 1: { slug: 'ቅጽ' } }), /ASCII/);
  assert.throws(() => formsToMd([FORMS[0], { ...FORMS[0], id: 60 }], { info: { ...INFO, 60: INFO[6] }, files: FILES, fetched: '2026-09-14' }), /slug/);
});

test('the original link is percent-encoded exactly as the Ministry spells the file, and never double-encoded', () => {
  const href = originalHref(FORMS[0].pdfFile);
  assert.equal(href, 'https://www.mor.gov.et/Forms/1758095060522-246893703-form-TIN%20%C3%A1%C2%88%C2%98.pdf');
  assert.equal(originalHref(href), href);
  assert.equal(/[^\x21-\x7e]/.test(href), false);
});

test('forms document: each live form with its Amharic title, English name, category, purpose and our download link', () => {
  const md = formsToMd(FORMS, { info: INFO, files: FILES, fetched: '2026-09-14' });
  assert.match(md, /\nurl: "https:\/\/bina\.et\/tax-forms"\n/);
  assert.equal(/Staffname|Deleted form/.test(md), false);
  const tin = md.split('### የግብር ከፋይ መለያ ቁጥር ለመመለስ')[1].split('###')[0];
  assert.match(tin, /TIN de-registration request/);
  assert.match(tin, /Tax Identification Number Forms/);
  assert.match(tin, /To ask the Ministry to cancel a TIN/);
  assert.match(tin, /ንግድ ሲቋረጥ/);
  assert.match(tin, new RegExp('https://bina\\.et' + FORMS_PATH.replace(/\//g, '\\/') + 'tin-deregistration-request\\.pdf'));
  assert.match(tin, /2 pages/);
  assert.match(md, /Value Added Tax Forms/, "the Ministry's misspelling of a category is corrected for display");
});

test('the /tax-forms page: download links to our copy, the original, the date, the authority note, escaped titles, no staff', () => {
  const html = formsPage(FORMS, { info: INFO, files: FILES, fetched: '2026-09-14' });
  assert.match(html, /<link rel="canonical" href="https:\/\/bina\.et\/tax-forms">/);
  assert.match(html, /href="\/static\/docs\/mor\/forms\/tin-deregistration-request\.pdf"/);
  assert.match(html, /href="https:\/\/www\.mor\.gov\.et\/Forms\/1758095060522-246893703-form-TIN%20%C3%A1%C2%88%C2%98\.pdf"/);
  assert.match(html, /Ministry of Revenue[^<]*mor\.gov\.et/);
  assert.match(html, /2026-09-14/);
  assert.match(html, /authoritative/i);
  assert.match(html, /&lt;መመዝገቢያ&gt;/);
  assert.equal(/<መመዝገቢያ>/.test(html), false);
  const noCopy = formsPage(FORMS, { info: INFO, files: { 6: FILES[6] }, fetched: '2026-09-14' });
  assert.equal(/vat-registration-form\.pdf/.test(noCopy), false, 'no download link to a copy we do not have');
  assert.match(noCopy, /No copy/);
  assert.match(formsToMd(FORMS, { info: INFO, files: { 6: FILES[6] }, fetched: '2026-09-14' }), /Download: not available from BinaSmart/);
  assert.equal(/Staffname|Deleted form/.test(html), false);
  assert.match(html, /site-v3\.css\?v=\d+/);
  assert.match(html, /bina-footer\.js\?v=\d+/);
  assert.ok(html.indexOf('Tax Identification Number Forms') > 0 && html.indexOf('Value Added Tax Forms') > 0);
});

test('writeMorDocs owns knowledge/mor and the mor source reads it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-mor-'));
  const out = path.join(root, 'knowledge', 'mor');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'stale.md'), '---\ntitle: "x"\n---\nold');
  const removed = writeMorDocs({ 'mor-faqs': faqsToMd(FAQS, { fetched: '2026-09-14' }), 'mor-forms': formsToMd(FORMS, { info: INFO, files: FILES, fetched: '2026-09-14' }) }, out);
  assert.deepEqual(removed, ['stale.md']);
  const read = readSources(root, ['mor']);
  assert.deepEqual(read.map(d => d.slug).sort(), ['mor-faqs', 'mor-forms']);
  assert.ok(read.every(d => d.source === 'mor' && !d.text.startsWith('---')));
  assert.equal(read.find(d => d.slug === 'mor-faqs').lang, 'am');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Asmat prefers the Ministry of Revenue documents; Dr Afiya never receives them', () => {
  const asmat = require('../agents/asmat/rules').knowledge, afiya = require('../agents/afiya/rules').knowledge;
  assert.equal(pageMatcher(asmat.prefer)('mor', 'mor-forms'), true);
  assert.equal(pageMatcher(afiya.exclude)('mor', 'mor-faqs'), true);
});
