'use strict';
// What a document of the telecom pack must be, checked on the bytes on disk and not on the fetcher's log: a 200
// is not a fetched page, and an exit code 0 is not a written file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'knowledge', 'telecom');
const reg = JSON.parse(fs.readFileSync(path.join(DIR, 'sources.json'), 'utf8'));
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.md'));
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
const meta = raw => { const m = /^---\n([\s\S]*?)\n---\n/.exec(raw); const o = {}; if (m) for (const l of m[1].split('\n')) { const k = /^(\w+):\s*"?(.*?)"?\s*$/.exec(l); if (k) o[k[1]] = k[2].replace(/\\"/g, '"'); } return o; };
const bodyOf = raw => raw.slice(raw.indexOf('\n---\n', 4) + 5);
// the page's own text: everything after the header paragraph that opens with "Source: http"
const pageText = raw => { const parts = bodyOf(raw).split('\n\n'); const i = parts.findIndex(p => /^Source: https?:\/\//.test(p.trim())); return parts.slice(i + 1).join('\n\n'); };
const ethiopic = s => (String(s || '').match(/[ሀ-፿]/g) || []).length;
const host = f => (/^telecom-(ethiotelecom|safaricom|eca)-/.exec(f) || [])[1];

test('the pack is a pack, not a handful of pages', () => {
  assert.ok(files.length >= 200, 'expected at least 200 documents, got ' + files.length);
  const by = {}; for (const f of files) by[host(f)] = (by[host(f)] || 0) + 1;
  assert.ok(by.ethiotelecom >= 150 && by.safaricom >= 20 && by.eca >= 25, JSON.stringify(by));
  assert.ok(files.every(f => host(f)), 'every file name is telecom-<host>-<slug>: ' + files.filter(f => !host(f)).join(' '));
});

test('every document has front matter with a url, a title, a language, a section, a source name and a fetched date', () => {
  for (const f of files) {
    const m = meta(read(f));
    assert.match(m.url || '', /^https:\/\//, f);
    assert.ok((m.title || '').length > 3, f + ' has no title');
    assert.ok(['en', 'am', 'om'].includes(m.lang), f + ' lang: ' + m.lang);
    assert.ok((m.section || '').length > 0, f + ' has no section');
    assert.ok((m.source_name || '').length > 3, f);
    assert.match(m.fetchedAt || '', /^2026-09-\d\d$/, f + ' fetched date');
    assert.equal(m.status, 'live');
    assert.equal(m.generated_by, 'ops/packs/fetch-pack.js --pack telecom');
    const site = reg.sites.find(s => s.id === host(f));
    assert.ok(site.sections.some(s => s.key === m.section), f + ' section ' + m.section + ' is not one of the site sections');
  }
});

test('every document opens with what it is, and its Source line carries the url and the date the harvest captured it', () => {
  for (const f of files) {
    const raw = read(f), m = meta(raw);
    const src = bodyOf(raw).split('\n\n').find(p => /^Source: https?:\/\//.test(p.trim()));
    assert.ok(src, f + ' has no Source paragraph');
    assert.ok(src.includes(m.url), f + ' Source line does not name its url');
    assert.ok(src.includes('fetched ' + m.fetchedAt), f + ' Source line does not carry the fetched date');
    assert.ok(/^#\s/m.test(bodyOf(raw)), f + ' has no title line');
    assert.ok(/[ሀ-፿]/.test(bodyOf(raw).split('\n\n').slice(0, 4).join(' ')), f + ' has no Amharic in its header');
  }
});

test('a document marked Amharic really is Amharic, and a regulator PDF is Amharic only if its text says so', () => {
  let am = 0;
  for (const f of files) {
    const raw = read(f), m = meta(raw);
    if (m.lang !== 'am') continue;
    am++;
    const floor = host(f) === 'ethiotelecom' ? 80 : 300;
    assert.ok(ethiopic(pageText(raw)) >= floor, f + ' is marked am and holds only ' + ethiopic(pageText(raw)) + ' Ethiopic characters');
  }
  assert.ok(am >= 60, 'Amharic documents: ' + am);
  assert.equal(meta(read('telecom-eca-am-directive-1024-2017-license-and-regulatory-fees.md')).lang, 'am');
  assert.equal(meta(read('telecom-eca-directive-1024-2024-license-and-regulatory-fees.md')).lang, 'en');
});

test('no document is a near-empty shell, and none still carries the site mega-menu', () => {
  for (const f of files) {
    const t = pageText(read(f)).trim();
    assert.ok(t.length >= 150, f + ' is ' + t.length + ' characters after the header');
    for (const junk of ['Close Menu', 'Our Brand Logos', 'Cookie Policy', 'Skip to content']) assert.ok(!t.includes(junk), f + ' still holds "' + junk + '"');
  }
});

test('no document holds a full mobile number, and a masked one is announced in the header', () => {
  const { PERSONAL_MOBILE } = require(path.join(ROOT, 'knowledge', 'index.js'));
  let masked = 0;
  for (const f of files) {
    const raw = read(f);
    assert.equal((raw.match(PERSONAL_MOBILE) || []).length, 0, f + ' holds a full mobile number');
    // and not one with a digit stuck to the front of it either: a dialling example such as 3 followed by a full local number
    assert.doesNotMatch(pageText(raw), /(?:251[79]|0[79])[0-9]{8}/, f + ' holds a ten-digit mobile-shaped string');
    if (/(?:251|0[79])•{5}\d{4}/.test(pageText(raw))) {
      masked++;
      assert.match(bodyOf(raw), /Phone numbers on this page are masked/, f + ' masks a number without saying so');
    }
  }
  assert.ok(masked >= 1, 'the Safaricom contact page masks its two chargeable lines');
  const contact = pageText(read('telecom-safaricom-support-contact-us.md'));
  assert.match(contact, /Short number\s*\n?\s*700 \(Free\)/, 'the 700 short code stays');
});

test('the regulator documents carry their instrument number, and the scanned regulation says it was read by a machine', () => {
  const eca = files.filter(f => host(f) === 'eca');
  const titles = eca.map(f => meta(read(f)).title).join('\n');
  for (const n of ['1148/2019', '1321/2024', '585/2026', '791/2021', '792/2021', '793/2021', '794/2021', '795/2021', '796/2021', '797/2021', '798/2021', '799/2021', '800/2021', '832/2021', '1024/2024', '1024/2017']) {
    assert.ok(titles.includes(n), n + ' has no document');
  }
  const ocr = read('telecom-eca-universal-access-fund-regulation-585-2026.md'), m = meta(ocr);
  assert.equal(m.text_source, 'ocr');
  assert.ok(['good', 'poor'].includes(m.ocr_quality));
  assert.equal(m.pages, '16');
  assert.match(bodyOf(ocr), /read by OCR on 2026-09-22 \(Tesseract 5, 300 dpi/);
  assert.match(bodyOf(ocr), /ይህ ሰነድ ከኢትዮጵያ ኮሙኒኬሽን ባለሥልጣን የተገኘው በስካን/);
  assert.match(pageText(ocr), /1\.5%/, 'the levy figure the OCR read clearly');
  assert.equal(files.filter(f => meta(read(f)).text_source === 'ocr').length, 1);
});

test('a page lives in one pack only: no telecom url is a banking url, and the Oromo, Somali and Tigrinya pages are not here', () => {
  const norm = u => String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/+(\?|$)/, '$1').toLowerCase();
  const banking = new Set(fs.readdirSync(path.join(ROOT, 'knowledge', 'banking')).filter(f => f.endsWith('.md'))
    .map(f => norm(meta(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', f), 'utf8')).url || '')));
  for (const f of files) {
    const u = meta(read(f)).url;
    assert.ok(!banking.has(norm(u)), f + ' is also a banking document: ' + u);
    // a Somali or Tigrinya page is never here; an Oromo page only when the registry names the English page it translates
    assert.doesNotMatch(u, /[?&]lang=(so|Tig)\b/i, f);
    if (/[?&]lang=om\b/.test(u)) assert.ok(Object.values(reg.sites[0].translationOf || {}).length && meta(read(f)).translationOf, f + ' is Oromo but names no English page');
    assert.doesNotMatch(u, /\/telebirr(\/|\?|$)/, f);
  }
});

test('an Oromo document says it is Oromo, names the English page it translates, and that page is in the pack', () => {
  const om = files.filter(f => meta(read(f)).lang === 'om');
  assert.ok(om.length >= 5, 'expected the Oromo pages, found ' + om.length);
  const byUrl = new Map(files.map(f => [meta(read(f)).url, f]));
  for (const f of om) {
    const raw = read(f), m = meta(raw);
    assert.match(f, /^telecom-ethiotelecom-om-/);
    assert.match(m.url, /\?lang=om$/, f);
    assert.match(m.translationOf || '', /^https:\/\/www\.ethiotelecom\.et\/[a-z0-9-]+\/$/, f);
    const en = byUrl.get(m.translationOf);
    assert.ok(en && meta(read(en)).lang === 'en', f + ': its English page ' + m.translationOf + ' is not an English document of the pack');
    assert.equal(f, en.replace(/^telecom-ethiotelecom-/, 'telecom-ethiotelecom-om-'), f + ' is named after its English page');
    const head = bodyOf(raw).split(/\n\nSource: /)[0];
    assert.ok(head.includes('This page is in Afaan Oromoo') && head.includes(m.translationOf), f + ' header: ' + head.slice(0, 300));
    assert.match(raw, /\(official Ethio telecom page, in Afaan Oromoo\)/, f);
    assert.ok(!/in English\)/.test(raw), f + ' must not say it is English');
    assert.equal(ethiopic(pageText(raw)), 0, f + ' is Oromo (qubee), not Ethiopic');
  }
});

test('the general FAQ no longer carries the telebirr FAQ the banking pack holds', () => {
  const t = pageText(read('telecom-ethiotelecom-am-faq.md'));
  assert.ok(t.length < 12000, 'the Amharic FAQ is ' + t.length + ' characters');
  assert.match(t, /11:00/, 'customer support hours stay');
});

test('an English document carries an Amharic title and summary in its header once am-headers has run', () => {
  const en = files.filter(f => meta(read(f)).lang === 'en');
  const withAm = en.filter(f => meta(read(f)).titleAm);
  assert.ok(withAm.length / en.length >= 0.9, withAm.length + ' of ' + en.length + ' English documents have a titleAm');
  assert.ok(fs.existsSync(path.join(DIR, 'am-headers.json')));
});

// tableRows on the Ethio telecom site (2026-09-23): a tariff table is its header line and one line per row that names
// the column of every value, and a re-render from the text on disk writes every document exactly as it is.
test('the Ethio telecom tariff tables are one line per row, naming their columns', () => {
  const has = (f, s) => assert.ok(read(f).includes(s), f + ' lacks: ' + s);
  has('telecom-ethiotelecom-fixed-line-services.md', 'Package Name | Price | Benefit\n'
    + 'Fixed to mobile voice Res 25 min: Price 10 birr; Benefit 25 minute call from residential fixed to mobile');
  has('telecom-ethiotelecom-international-services.md',
    'Limited Premium Plus Package: Packed Services Local Call; Volume 9000 Minutes; Monthly Rent 3500 Birr');
  has('telecom-ethiotelecom-am-student-package.md', 'ዋጋ 34 ብር');
  assert.match(read('telecom-ethiotelecom-am-student-package.md'), /^Table: \S+ by /m);
});

test('a re-render of the telecom pack from disk changes nothing', () => {
  const P = require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js'));
  const amHeaders = reg.pack && reg.pack.amHeaders ? P.readAmHeaders('telecom') : null;
  const r = P.rerenderPack(DIR, reg, { dryRun: true, amHeaders });
  assert.deepEqual(r.rerendered, []);
});
