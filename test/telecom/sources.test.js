'use strict';
// knowledge/telecom/sources.json drives ops/packs/fetch-pack.js --pack telecom. An entry wrong here is a page
// that should not be in the pack, or a regulator's directive silently missing from it. The shape is pinned,
// and so are the rules this sector adds:
//   - this pack INFORMS. Nothing that logs in, pays, registers or files is ever taken;
//   - the telebirr, mobile-money, credit and saving pages of ethiotelecom.et belong to the banking pack, and a
//     page lives in one pack only: none of their paths may be allowed here;
//   - every regulator PDF is named, not matched by a pattern;
//   - the Oromo, Somali and Tigrinya pages stay on disk and out of the index until they are wanted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'knowledge', 'telecom', 'sources.json');
const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const site = id => reg.sites.find(s => s.id === id);
const et = site('ethiotelecom'), saf = site('safaricom'), eca = site('eca');
const allowed = (s, key) => (s.allow || []).some(p => new RegExp(p).test(key));
const denied = (s, key) => (s.deny || []).some(p => new RegExp(p).test(key));

test('the registry has a version, a note, a pack block and three harvested sites', () => {
  assert.equal(typeof reg.version, 'number');
  assert.ok(reg._about.length > 200);
  assert.equal(reg.pack.id, 'telecom');
  assert.equal(reg.pack.generatedBy, 'ops/packs/fetch-pack.js --pack telecom');
  assert.equal(reg.pack.logPrefix, 'telecom');
  assert.equal(reg.pack.amHeaders, true);
  for (const k of ['disclaimerEn', 'disclaimerAm', 'headerEnTemplate', 'headerAmTemplate', 'ocrNoteEn', 'ocrNoteAm', 'maskNoteEn', 'maskNoteAm']) {
    assert.ok(String(reg.pack[k] || '').length > 40, 'pack.' + k);
  }
  assert.match(reg.pack.disclaimerAm, /[ሀ-፿]/);
  assert.match(reg.pack.headerEnTemplate, /\{url\}.*\{today\}/, 'the Source line carries the url and the fetched date');
  assert.deepEqual(reg.sites.map(s => s.id), ['ethiotelecom', 'safaricom', 'eca']);
});

test('every site is a harvested folder with a name, an Amharic name, a slug prefix and phone masking', () => {
  for (const s of reg.sites) {
    assert.equal(s.fetch, 'dir', s.id);
    assert.equal(s.dir, s.host, s.id + ' folder is the host');
    assert.match(s.host, /^www\.[a-z.]+$/);
    assert.ok(s.name && /[ሀ-፿]/.test(s.nameAm), s.id + ' needs name and nameAm');
    assert.equal(s.slugPrefix, 'telecom-' + s.id, 'documents are telecom-<host-short>-<slug>');
    assert.equal(s.maskPhones, true, s.id + ' publishes mobile numbers; the repository is public');
    assert.ok(Number(s.crawlDelaySeconds) >= 5);
    assert.equal(s.checked, '2026-09-22');
    for (const p of [...s.allow, ...s.deny, ...(s.allowPdf || [])]) assert.doesNotThrow(() => new RegExp(p), s.id + ' bad regex ' + p);
    for (const sec of s.sections) { assert.ok(sec.key && /[ሀ-፿]/.test(sec.titleAm) && sec.match, s.id + ' section'); assert.doesNotThrow(() => new RegExp(sec.match)); }
  }
});

test('the telebirr and mobile-money pages of ethiotelecom.et are not allowed here', () => {
  const banking = ['/telebirr', '/telebirr?lang=am', '/telebirr/faq', '/telebirr/faq?lang=am', '/telebirr/telebirr-pricing', '/telebirr/deposit',
    '/adrash', '/enderas', '/sinq', '/sanduq-saving', '/mela-micro-credit', '/wabi-micro-credit', '/wabi-micro-saving',
    '/endekise-overdraft-service-credit-pay', '/virtual-visa-card', '/remittance-telebirr', '/airtime-top-up',
    '/international-airtime-top-up', '/monthly-telecom-bill-payment-options', '/getting-started', '/telebirr/how-to-register-telebirr',
    '/awash-micro-credit', '/awash-saving', '/list-of-hospitals-integrated-with-telebirr', '/terms-and-conditions-for-the-opening-and-use-of-sinq-service'];
  for (const k of banking) assert.equal(allowed(et, k), false, k + ' is a banking page');
  assert.match(et.denyNote, /banking pack/);
});

test('the consumer pages the pack exists for are allowed, in both languages where the site has both', () => {
  for (const k of ['/esim', '/esim?lang=am', '/national-id', '/mobile-data-package-new', '/mobile-data-package-new?lang=am', '/international-roaming',
    '/faq', '/faq?lang=am', '/contact-us', '/fixed-bb-internet', '/fixed-bb-enterprise', '/privacy-policy', '/fraud-awareness']) {
    assert.equal(allowed(et, k), true, k);
  }
  // Amharic pages whose English slug has no ?lang=am view are allowed by their own Ethiopic address
  assert.ok(et.allow.some(p => /%e1%8b%ab%e1%8c%8d%e1%8a%99%e1%8a%95/.test(p)), 'the Amharic contact page');
  for (const k of ['/en/personal/packages/data', '/en/personal/packages/voice', '/en/personal/packages/sms', '/en/personal/getting-started/get-sim-card',
    '/en/personal/getting-started/roaming-and-internationals', '/en/help-and-support/support/contact-us', '/en/business/fixed-service/fiber']) {
    assert.equal(allowed(saf, k), true, k);
  }
  for (const k of ['/en/whats-new', '/en/help-and-support', '/en/about/our-leadership']) assert.equal(allowed(saf, k), false, k);
  for (const k of ['/consumer-affairs', '/about']) assert.equal(allowed(eca, k), true, k);
  for (const k of ['/statistics', '/registration-eca-et', '/search', '/public-notice']) assert.equal(allowed(eca, k), false, k + ' has no content or is a login');
});

test('the Oromo, Somali and Tigrinya pages are denied by pattern and named in the note', () => {
  for (const q of ['om', 'so', 'Tig']) assert.equal(denied(et, '/esim?lang=' + q), true, q);
  assert.match(et.denyNote, /Oromo, Somali and Tigrinya/);
});

test('a Safaricom page is named by the registry, its cards are joined and its numbers are kept', () => {
  assert.equal(saf.pageTitles['/en/personal/packages/data'], 'Data packages (prepaid)');
  assert.equal(saf.keepNumericParagraphs, true);
  assert.ok(saf.htmlPrep.length >= 1 && saf.htmlPrep.every(p => p.match && p.replace));
  assert.deepEqual(saf.dedupAgainstPacks, ['banking']);
});

test('every regulator PDF is named, titled and slugged, and the instruments the pack exists for are all there', () => {
  assert.ok(eca.allowPdf.length >= 23 && eca.allowPdf.every(p => /^\^.*\$$/.test(p)), 'anchored, named entries');
  const titles = Object.values(eca.pdfTitles).join('\n');
  for (const n of ['1148/2019', '1321/2024', '585/2026', '791/2021', '792/2021', '793/2021', '794/2021', '795/2021', '796/2021', '797/2021', '798/2021',
    '799/2021', '800/2021', '832/2021', '1024/2024', '1024/2017']) assert.ok(titles.includes(n), n + ' is missing');
  const slugs = Object.values(eca.pathSlugs);
  assert.equal(new Set(slugs).size, slugs.length, 'no two documents share a slug');
  for (const [k, v] of Object.entries(eca.pathSlugs)) { assert.ok(eca.pdfTitles[k], k + ' has no title'); assert.match(v, /^[a-z0-9-]+$/); }
  assert.equal(eca.pdfSplit, true);
  assert.ok(!(eca.deny || []).some(p => /pdf/.test(p)), 'a pdf pattern in deny would refuse every allowed PDF');
  assert.equal(eca.pdfLangFromText, true, 'the Amharic PDFs are Amharic by measurement, not by folder');
  const crops = eca.pdfCrop.map(c => c.match).join(' ');
  assert.match(crops, /1148/); assert.match(crops, /1321/);
  for (const c of eca.pdfCrop) assert.ok([c.x, c.y, c.W, c.H].every(Number.isFinite));
});

test('what the pack leaves to other packs is written down', () => {
  const ids = reg.references.map(r => r.id);
  for (const id of ['banking-telebirr', 'banking-mpesa', 'law-eca-consumer-complaint', 'law-stolen-phone', 'law-pdp']) assert.ok(ids.includes(id), id);
  for (const r of reg.references) { assert.equal(r.fetch, 'none'); assert.ok(r.note.length > 40); }
});

// 2026-09-23: Ethio telecom's tariff pages put every <td> on a line of its own, so a table reached the pack one cell
// per line and nothing on a price line said which package or column it belonged to. tableRows writes each row as one
// line naming its columns. It was turned on after a dry run of every document it rewrites on this site (six), with
// every digit run of each document kept; Safaricom and the ECA were not surveyed and stay as they are.
test('Ethio telecom tables are written one row per line (tableRows), and its numbers are still masked first', () => {
  assert.equal(et.tableRows, true);
  assert.equal(et.maskPhones, true, 'rerenderPack masks the text before renderDoc rewrites its tables');
  assert.ok(String(et.tableRowsNote || '').length > 80, 'the reason is written down');
  assert.ok(!saf.tableRows && !eca.tableRows, 'on only where a dry run of every rewritten document was read');
});
