'use strict';
// ops/packs/fetch-pack.js --from-dir, the OCR half: a great many of the National Bank of Ethiopia's rules are
// published as photographs of paper. pdftotext returns NOTHING for them - not a thin page, zero characters -
// so until this task the importer wrote no document at all and the pack could not cite the Financial Consumer
// Protection directive, the currency directives, the fraud directive or the 2025 banking proclamation.
//
// They were read by OCR on a workstation and the text left beside the PDFs in <host>/ocr/, one
// <sha1>.ocr.txt per PDF with an ocr-manifest.json giving each one its url, page count, measured quality and,
// for the sixteen files the National Bank uploaded twice, the copy to keep. This importer READS that sidecar.
// It never runs OCR, and a harvest that has no ocr/ folder behaves exactly as it did before.
//
// What is pinned here:
//   - where a sidecar exists the OCR text is used and pdftotext is NOT called, because pdftotext is what
//     returns nothing for these files;
//   - a file the sidecar marks `duplicate_of` becomes no document at all, and says so in `failed`;
//   - a document longer than the cap is split at a PAGE BREAK, never inside a page, and every part carries
//     the same url and a `part` line saying which part it is;
//   - the measured OCR quality and the page count travel into the document's front matter, so a transcript
//     the OCR run itself graded `poor` says so on the document rather than in a report nobody reads;
//   - a PDF the harvester never stored - the four proclamations past its 15 MB cap - still becomes a
//     document, because the sidecar's own row is enough and allowPdf still decides.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

const pad = n => 'the directive shall apply to every bank and every customer of a bank. '.repeat(n);

// A harvest directory with an ocr/ sidecar, exactly as the OCR run leaves one.
function harvest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fromdir-ocr-'));
  const dir = path.join(root, 'example.et');
  fs.mkdirSync(path.join(dir, 'ocr'), { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  w('a.pdf', '%PDF-1.4 a photograph of paper, no text layer');
  w('b.pdf', '%PDF-1.4 the same photograph, uploaded twice');
  w('c.pdf', '%PDF-1.4 a scanned currency directive in Amharic');
  w('d.pdf', '%PDF-1.4 a PDF that really does have a text layer');
  // One long document: three pages, each comfortably under the 400-character cap used below, the whole
  // thing over it. The page breaks are the \f the OCR run writes between pages.
  w(path.join('ocr', 'aaa.ocr.txt'), ['PAGE ONE ' + pad(9), 'PAGE TWO ' + pad(9), 'PAGE THREE ' + pad(9)].join('\f'));
  w(path.join('ocr', 'bbb.ocr.txt'), 'the duplicate upload, same bytes. ' + pad(10));
  w(path.join('ocr', 'ccc.ocr.txt'), 'መመሪያ ቁጥር ከማዳ/02/2021 ብሔራዊ ባንክ ገንዘብ ' + 'የተበላሹ የብር ኖቶች ስለሚቀየሩበት ሁኔታ የወጣ መመሪያ። '.repeat(30));
  w(path.join('ocr', 'eee.ocr.txt'), 'the proclamation the harvester never stored, past its size cap. ' + pad(10));
  const om = {
    source: 'example.et', documents: 4, files: [
      { file: 'aaa.ocr.txt', url: 'https://example.et/uploads/rules/FCP-01-2020.pdf', title: 'FCP-01-2020.pdf',
        sha256_pdf: 'aa', pages: 50, language_mode: 'eng+amh', psm: '6', ocr_quality: 'good',
        chars: 999, duplicate_of: null, generatedAt: '2026-09-17T06:46:20Z' },
      { file: 'bbb.ocr.txt', url: 'https://example.et/uploads/rules/FCP-01-2020-copy.pdf', title: 'FCP-01-2020-copy.pdf',
        sha256_pdf: 'aa', pages: 50, language_mode: 'eng+amh', psm: '6', ocr_quality: 'good',
        chars: 999, duplicate_of: 'aaa', generatedAt: '2026-09-17T06:46:21Z' },
      { file: 'ccc.ocr.txt', url: 'https://example.et/uploads/rules/cmd-02-2021.pdf', title: 'cmd-02-2021.pdf',
        sha256_pdf: 'cc', pages: 2, language_mode: 'amh+eng', psm: '6', ocr_quality: 'poor',
        chars: 999, duplicate_of: null, generatedAt: '2026-09-17T06:46:22Z' },
      { file: 'eee.ocr.txt', url: 'https://example.et/uploads/rules/Oversized-Proclamation.pdf', title: 'Oversized Proclamation 1359/2025',
        sha256_pdf: 'ee', pages: 84, language_mode: 'eng+amh', psm: '6', ocr_quality: 'good',
        chars: 999, duplicate_of: null, generatedAt: '2026-09-17T06:46:23Z' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'ocr', 'ocr-manifest.json'), JSON.stringify(om));
  const m = [
    { url: 'https://example.et/uploads/rules/FCP-01-2020.pdf', file: 'a.pdf', status: 200, contentType: 'application/pdf', sha256: 'a1', fetchedAt: '2026-09-16T18:29:53Z', title: null, postType: 'media' },
    { url: 'https://example.et/uploads/rules/FCP-01-2020-copy.pdf', file: 'b.pdf', status: 200, contentType: 'application/pdf', sha256: 'b1', fetchedAt: '2026-09-16T18:30:53Z', title: null, postType: 'media' },
    { url: 'https://example.et/uploads/rules/cmd-02-2021.pdf', file: 'c.pdf', status: 200, contentType: 'application/pdf', sha256: 'c1', fetchedAt: '2026-09-16T18:31:53Z', title: null, postType: 'media' },
    { url: 'https://example.et/uploads/rules/Has-Text-Layer.pdf', file: 'd.pdf', status: 200, contentType: 'application/pdf', sha256: 'd1', fetchedAt: '2026-09-16T18:32:53Z', title: 'Has Text Layer', postType: 'media' },
    // The harvester met this one and refused it: 47 MB, past its 15 MB cap. No status, no file, no bytes.
    { url: 'https://example.et/uploads/rules/Oversized-Proclamation.pdf', status: null, error: 'too large: 47354860 bytes (15 MB cap)', fetchedAt: '2026-09-16T20:10:28Z' },
  ];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return root;
}

const SITE = {
  id: 'example', name: 'Example Bank', nameAm: 'ኤግዛምፕል', host: 'example.et',
  fetch: 'dir', dir: 'example.et', lang: 'en', maxPages: 50, maxPdfs: 20,
  allow: [], deny: [], allowPdf: ['^/uploads/rules/'],
  sections: [{ key: 'rules', titleAm: 'ሕግ', match: '^/uploads/' }],
};

const PACK = { id: 'example', packFormat: '2', disclaimerEn: 'Confirm before you act.', disclaimerAm: 'ያረጋግጡ።',
  headerAmTemplate: 'ይህ ገጽ {fromAm} የተወሰደ ነው። {disclaimerAm}',
  headerEnTemplate: 'Source: {url}, fetched {today}. {disclaimerEn}',
  ocrNoteEn: 'Read by OCR from a scanned {ocrPages}-page PDF; the transcription was graded {ocrQuality}.' };

// ---------------------------------------------------------------------------

test('where an OCR sidecar exists the OCR text is used and pdftotext is never called', () => {
  const root = harvest();
  const opened = [];
  const readPdf = f => { opened.push(path.basename(f)); return 'pdftotext got ' + pad(10); };
  const { pages } = P.fetchDir(SITE, { root, readPdf });
  assert.deepEqual(opened, ['d.pdf'],
    'only the PDF with no sidecar was given to pdftotext; the scanned ones came from the OCR text');
  const fcp = pages.find(p => /FCP-01-2020\.pdf$/.test(p.url) && p.part === 1);
  assert.ok(fcp, 'the scanned directive became a document');
  assert.match(fcp.text, /PAGE ONE/, 'and its body is the OCR text, not pdftotext output');
  assert.equal(fcp.textSource, 'ocr');
  assert.equal(fcp.ocrPages, 50, 'the page count the OCR run measured');
  assert.equal(fcp.fetchedAt, '2026-09-16', 'the date is still the day the PDF bytes were captured');
  const plain = pages.find(p => /Has-Text-Layer/.test(p.url));
  assert.equal(plain.textSource, 'pdf', 'a PDF with a text layer is unchanged by any of this');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a file the sidecar marks duplicate_of becomes no document, and says so', () => {
  const root = harvest();
  const { pages, failed } = P.fetchDir(SITE, { root, readPdf: () => pad(10) });
  assert.ok(!pages.some(p => /FCP-01-2020-copy/.test(p.url)), 'the duplicate upload is not a second document');
  assert.ok(pages.some(p => /FCP-01-2020\.pdf$/.test(p.url)), 'the copy to keep is');
  const why = (failed.find(f => /FCP-01-2020-copy/.test(f.url)) || {}).why || '';
  assert.match(why, /duplicate/, 'and the run reports it rather than dropping it in silence: ' + why);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a document over the cap is split at a page break, and every part says which part it is', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root, readPdf: () => pad(10), ocrMaxChars: 900 });
  const parts = pages.filter(p => /FCP-01-2020\.pdf$/.test(p.url)).sort((a, b) => a.part - b.part);
  assert.ok(parts.length > 1, 'the long document was split, got ' + parts.length + ' part(s)');
  assert.equal(parts[0].slug, 'example-fcp-01-2020', 'part one keeps the document name');
  assert.equal(parts[1].slug, 'example-fcp-01-2020-part-2', 'and the rest are numbered after it');
  for (const p of parts) {
    assert.equal(p.url, 'https://example.et/uploads/rules/FCP-01-2020.pdf', 'every part carries the same url');
    assert.equal(p.parts, parts.length);
  }
  // Split at a page break means no part starts or ends inside a page: every page of the original appears
  // whole in exactly one part.
  const joined = parts.map(p => p.text).join('\n');
  for (const marker of ['PAGE ONE', 'PAGE TWO', 'PAGE THREE']) {
    assert.equal(joined.split(marker).length - 1, 1, marker + ' appears exactly once across the parts');
  }
  assert.match(parts[0].text, /PAGE ONE/);
  assert.ok(!/PAGE ONE/.test(parts[parts.length - 1].text), 'the last part does not repeat the first page');
  fs.rmSync(root, { recursive: true, force: true });
});

test('splitOcrParts never cuts inside a page', () => {
  const t = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].join('\f');
  assert.deepEqual(P.splitOcrParts(t, 1000), [t], 'under the cap it is one part');
  const parts = P.splitOcrParts(t, 60);
  assert.equal(parts.length, 3);
  assert.deepEqual(parts, ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)]);
  const one = P.splitOcrParts('x'.repeat(500), 60);
  assert.deepEqual(one, ['x'.repeat(500)], 'a single page longer than the cap is left whole rather than cut');
});

test('the measured OCR quality and the page count travel into the front matter', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root, readPdf: () => pad(10) });
  const cmd = pages.find(p => /cmd-02-2021/.test(p.url));
  assert.equal(cmd.ocrQuality, 'poor', 'the OCR run graded this transcript poor and the document says so');
  const md = P.renderDoc(cmd, SITE, { today: cmd.fetchedAt, pack: PACK });
  const meta = P.readMeta(md);
  assert.equal(meta.text_source, 'ocr');
  assert.equal(meta.ocr_quality, 'poor');
  assert.equal(meta.pages, '2');
  assert.match(md, /Read by OCR from a scanned 2-page PDF; the transcription was graded poor\./,
    'and a reader of the document is told, not only a reader of the front matter');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the part line is in the front matter of every part and absent from a document with one part', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root, readPdf: () => pad(10), ocrMaxChars: 900 });
  const parts = pages.filter(p => /FCP-01-2020\.pdf$/.test(p.url)).sort((a, b) => a.part - b.part);
  const m1 = P.readMeta(P.renderDoc(parts[0], SITE, { today: '2026-09-16', pack: PACK }));
  const m2 = P.readMeta(P.renderDoc(parts[1], SITE, { today: '2026-09-16', pack: PACK }));
  assert.equal(m1.part, '1 of ' + parts.length);
  assert.equal(m2.part, '2 of ' + parts.length);
  assert.equal(m1.url, m2.url, 'both parts point at the one PDF the National Bank published');
  const cmd = pages.find(p => /cmd-02-2021/.test(p.url));
  const m3 = P.readMeta(P.renderDoc(cmd, SITE, { today: '2026-09-16', pack: PACK }));
  assert.ok(!m3.part, 'a document that was not split carries no part line');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a scanned directive written in Amharic is recorded as Amharic', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root, readPdf: () => pad(10) });
  const cmd = pages.find(p => /cmd-02-2021/.test(p.url));
  assert.equal(cmd.lang, 'am', 'its text is Ethiopic; the /wp-content/uploads/ path it sits on says nothing');
  const fcp = pages.find(p => /FCP-01-2020\.pdf$/.test(p.url));
  assert.equal(fcp.lang, 'en');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a PDF the harvester never stored still becomes a document from its OCR text alone', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root, readPdf: () => pad(10) });
  const big = pages.find(p => /Oversized-Proclamation/.test(p.url));
  assert.ok(big, 'the 47 MB proclamation the 15 MB cap refused is in the pack');
  assert.equal(big.textSource, 'ocr');
  assert.equal(big.ocrPages, 84);
  assert.equal(big.title, 'Oversized Proclamation 1359/2025', 'titled from the sidecar, not from a file name');
  fs.rmSync(root, { recursive: true, force: true });
});

test('allowPdf still decides: a sidecar does not let a document in through the back door', () => {
  const root = harvest();
  const site = { ...SITE, allowPdf: ['^/uploads/rules/cmd-'] };
  const { pages } = P.fetchDir(site, { root, readPdf: () => pad(10) });
  assert.deepEqual(pages.map(p => p.slug), ['example-cmd-02-2021'],
    'only the one PDF the registry names, OCR text or not');
  const none = P.fetchDir({ ...SITE, allowPdf: [] }, { root, readPdf: () => pad(10) });
  assert.deepEqual(none.pages, [], 'and a site that names no PDF rule takes none of them');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a harvest with no ocr/ folder behaves exactly as it did before', () => {
  const root = harvest();
  fs.rmSync(path.join(root, 'example.et', 'ocr'), { recursive: true, force: true });
  const opened = [];
  const { pages } = P.fetchDir(SITE, { root, readPdf: f => { opened.push(path.basename(f)); return 'x ' + pad(10); } });
  assert.deepEqual(opened.sort(), ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf'], 'every allowed PDF goes to pdftotext');
  assert.ok(pages.every(p => p.textSource === 'pdf'));
  assert.ok(!pages.some(p => /Oversized/.test(p.url)), 'and the one with no bytes is not a document');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the registry may name a document the National Bank filed under the wrong number', () => {
  const root = harvest();
  // fxd-65-2020.pdf and fxd-80-2022.pdf are one file at two urls, and the directive inside is FXD/80/2022.
  // The file name is not evidence about what is in the file, so the registry names it by hand.
  const site = { ...SITE, pdfTitles: { '/uploads/rules/cmd-02-2021.pdf': 'Directive No. CMD/02/2021' } };
  const { pages } = P.fetchDir(site, { root, readPdf: () => pad(10) });
  const cmd = pages.find(p => /cmd-02-2021/.test(p.url));
  assert.equal(cmd.title, 'Directive No. CMD/02/2021');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ocrTitleOf takes the extension off and invents nothing', () => {
  assert.equal(P.ocrTitleOf('FCP-01-2020.pdf'), 'FCP-01-2020');
  assert.equal(P.ocrTitleOf('Banking-Business-Proclamation-No.-13602025.pdf'), 'Banking-Business-Proclamation-No.-13602025');
  assert.equal(P.ocrTitleOf('DIRECTVE_NO_MCR_02_2020.pdf'), 'DIRECTVE-NO-MCR-02-2020');
  assert.equal(P.ocrTitleOf('Money Laundering proclamation'), 'Money Laundering proclamation');
});
