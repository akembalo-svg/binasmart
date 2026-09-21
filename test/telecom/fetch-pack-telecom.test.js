'use strict';
// The seven things ops/packs/fetch-pack.js learned for the telecom pack, each run on a fixture and none on a
// network: a column crop for a bilingual gazette, whole-PDF reading split at a page break, the numbers a page may
// keep, a language floor of its own, a per-site "thin", a card joined into a row, and the paragraph another pack
// already holds. Every phone number below is invented (09000000NN / 2519000000NN).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../../ops/packs/fetch-pack.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'telecom-fp-'));

test('stripMarginGarble takes the neighbouring column off the left margin and nothing else', () => {
  const raw = 'ም   Federal Negarit Gazette No. 82\n   1/ The Authority shall\nአን   2/ A Licensee shall\nስ\n';
  const out = P.stripMarginGarble(raw).split('\n');
  assert.equal(out[0], 'Federal Negarit Gazette No. 82');
  assert.equal(out[1], '1/ The Authority shall');
  assert.equal(out[2], '2/ A Licensee shall');
  assert.equal(out[3], '', 'a line that is only stray glyphs goes');
  // a page break survives, because the parts of a long document are cut on it
  assert.equal(P.stripMarginGarble('a\n\fb').split('\f').length, 2);
});

test('pdfCropFor picks the first entry whose match holds, case-insensitively, and returns null otherwise', () => {
  const site = { pdfCrop: [{ match: 'proclamation-1148-2019', x: 316, y: 30, W: 296, H: 740 }] };
  assert.deepEqual(P.pdfCropFor(site, '/wp-content/uploads/2022/10/X-Communications-Service-Proclamation-1148-2019.pdf'), { x: 316, y: 30, W: 296, H: 740 });
  assert.equal(P.pdfCropFor(site, '/wp-content/uploads/other.pdf'), null);
  assert.equal(P.pdfCropFor({}, '/a.pdf'), null);
});

test('maskPhones masks the local 09 and 07 forms as well as the international one, and leaves the rest alone', () => {
  const t = 'Service centre +251900000012/07, call 0900000013 or 0900 000 014, office 011 551 0500, short code 994, USSD *999#, example 30900000015, already 251•••••0016.';
  const m = P.maskPhones(t);
  assert.match(m, /251•••••0012\/07/);
  assert.match(m, /09•••••0013/);
  assert.match(m, /09•••••0014/);
  assert.match(m, /011 551 0500/, 'a landline is an office line and stays');
  assert.match(m, /994/);
  assert.match(m, /\*999#/);
  assert.match(m, /30900000015/, 'a digit before the number disqualifies it');
  assert.match(m, /251•••••0016/);
  assert.equal(P.maskPhones(m), m, 'masking is idempotent');
  assert.doesNotMatch(m, /2519000000|0900000013/);
});

test('a site may set its own language floor and its own thin floor', () => {
  const am = 'ሞባይል ዳታ ጥቅል'.repeat(10);                     // 100+ Ethiopic characters, well under the pack floor of 300
  assert.equal(P.langOfText('am', am), 'en');
  assert.equal(P.langOfText('am', am, 80), 'am');
  assert.equal(P.langOfText('en', am, 80), 'en');
  const html = '<html><head><title>t</title></head><body><main><h2>Price</h2><p>1 GB - 90 Birr</p><p>2 GB - 165 Birr</p><p>20 GB - 1,100 Birr</p></main></body></html>'.padEnd(260, ' ');
  assert.equal(P.extract(html, {}).ok, false, 'under the 400 floor it is thin');
  assert.equal(P.extract(html, { minChars: 40 }).ok, true);
  const docs = [{ text: 'x'.repeat(50) }, { text: 'y'.repeat(500) }];
  assert.equal(P.splitThin(docs).kept.length, 1);
  assert.equal(P.splitThin(docs, 20).kept.length, 2);
});

test('keepNumericParagraphs stops the template rule deleting a price that recurs across pages', () => {
  const nav = ['Personal', 'Business', 'Help', 'Roaming', 'About'].join('\n\n');
  const page = (slug, n) => ({ siteId: 's', slug, text: nav + '\n\n' + '1 GB\n\n45 ETB\n\nunique paragraph number ' + n + ' about this page and its own words' });
  const pages = [1, 2, 3, 4, 5, 6].map(n => page('p' + n, n));
  const plain = P.stripPackBoilerplate(pages.map(p => ({ ...p })));
  assert.doesNotMatch(plain[0].text, /45 ETB/, 'the frequency rule alone calls a repeated card template');
  assert.doesNotMatch(plain[0].text, /Personal/);
  const kept = P.stripPackBoilerplate(pages.map(p => ({ ...p })), { keepNumericParagraphs: true });
  assert.match(kept[0].text, /45 ETB/);
  assert.match(kept[0].text, /1 GB/);
  assert.doesNotMatch(kept[0].text, /Personal/, 'the menu has no digit and is still stripped');
});

// ---- fetchDir on a fake harvest
function harvest(rows, files) {
  const root = tmp();
  const dir = path.join(root, 'host.example');
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const r of rows) {
    fs.writeFileSync(path.join(dir, r.file), files[r.file]);
    entries.push({ url: r.url, file: r.file, status: 200, contentType: r.ct || 'text/html', sha256: r.file, fetchedAt: '2026-09-21T20:00:00Z', title: r.title || '' });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(entries));
  return root;
}
const card = (a, b) => '<div class="c"><div class="a"><div class="r"><p>' + a + '</p></div></div><div class="text-white text-xl font-light "><div class="r"><p>' + b + '</p></div></div></div>';
const page = (h, body) => '<html><head><title>Site | Mobile</title></head><body><main><h1>' + h + '</h1>' + body + '<p>' + 'Terms apply to every package on this page. '.repeat(3) + '</p></main></body></html>';

test('fetchDir joins a package card into one row, names the page from the registry, and honours the site floors', () => {
  const root = harvest([
    { url: 'https://host.example/en/data', file: 'a.html' },
    { url: 'https://host.example/en/empty', file: 'b.html' },
  ], {
    'a.html': page('ENJOY DATA', card('100 MB', '5 ETB') + card('300 MB', '15 ETB')),
    'b.html': '<html><head><title>x</title></head><body><main><h1>Nothing</h1></main></body></html>'.padEnd(400, ' '),
  });
  const site = { id: 's', host: 'host.example', dir: 'host.example', fetch: 'dir', lang: 'en', allow: ['^/en/'], deny: [],
    titleFrom: 'heading', pageTitles: { '/en/data': 'Data packages' }, minChars: 60,
    htmlPrep: [{ match: '</p></div></div><div class="text-white text-xl font-light "><div class="r"><p>', flags: 'g', replace: ' — ' }],
    sections: [{ key: 'packages', titleAm: 'x', match: '^/' }] };
  const { pages, failed } = P.fetchDir(site, { root });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, 'Data packages');
  assert.match(pages[0].text, /100 MB — 5 ETB/);
  assert.match(pages[0].text, /300 MB — 15 ETB/);
  assert.ok(failed.some(f => /empty/.test(f.url) && f.why === 'thin'), 'a page with no text is reported thin');
});

test('a text-layer PDF of a site with pdfSplit is read whole, cut at a page break, and its language is measured', () => {
  const pageText = n => 'Article ' + n + '. A Licensee shall keep a record of each complaint for twelve months. '.repeat(3);
  const text = [1, 2, 3, 4, 5, 6].map(pageText).join('\f');
  const root = harvest([{ url: 'https://host.example/law/d.pdf', file: 'd.pdf', ct: 'application/pdf' }], { 'd.pdf': 'not read: a stub does the reading' });
  const site = { id: 's', host: 'host.example', dir: 'host.example', fetch: 'dir', lang: 'en', allow: ['^/none$'], deny: [],
    allowPdf: ['^/law/d\\.pdf$'], maxPdfs: 5, pdfSplit: true, pdfLangFromText: true, sections: [{ key: 'law', titleAm: 'x', match: '^/' }] };
  const seen = [];
  const readPdf = (file, opts) => { seen.push(opts); return text; };
  const { pages } = P.fetchDir(site, { root, readPdf, ocrMaxChars: 500 });
  assert.ok(pages.length > 1, 'split into parts, got ' + pages.length);
  assert.ok(pages.every(p => p.parts === pages.length && p.lang === 'en'));
  assert.equal(pages.map(p => p.text).join('\n').replace(/\s+/g, ' ').includes('Article 6.'), true, 'nothing was cut off');
  assert.equal(seen[0].maxChars, Infinity, 'read whole, not at the 60,000 character cap');
  // without pdfSplit the old call is made, byte for byte: one argument
  const old = []; P.fetchDir({ ...site, pdfSplit: false, pdfLangFromText: false }, { root, readPdf: (...a) => { old.push(a.length); return text; } });
  assert.deepEqual(old, [1]);
});

test('dropPackDuplicates takes out a paragraph another pack already holds and keeps the rest', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'knowledge', 'otherpack'), { recursive: true });
  const shared = 'The telebirr FAQ paragraph that the banking pack already holds word for word and that must not be answered twice.';
  fs.writeFileSync(path.join(root, 'knowledge', 'otherpack', 'x.md'),
    '---\nurl: "https://x.example/a"\nstatus: "live"\n---\n\n# T\n\nSource: https://x.example/a (official X page, in English), fetched 2026-09-21.\n\n' + shared + '\n\nsomething else entirely\n');
  const docs = [{ slug: 's-a', text: 'Own paragraph about SIM cards and their opening hours, long enough to matter here.\n\n' + shared.toUpperCase() + '\n\nshort' }];
  const dropped = P.dropPackDuplicates(docs, { dedupAgainstPacks: ['otherpack'] }, { root });
  assert.deepEqual(dropped, { 's-a': 1 });
  assert.match(docs[0].text, /Own paragraph/);
  assert.doesNotMatch(docs[0].text, /telebirr/i);
  assert.match(docs[0].text, /short/, 'a short paragraph is never a duplicate');
  assert.deepEqual(P.dropPackDuplicates([{ slug: 'x', text: shared }], {}, { root }), {}, 'no dedupAgainstPacks, no change');
});
