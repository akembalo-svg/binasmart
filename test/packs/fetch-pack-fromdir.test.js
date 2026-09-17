'use strict';
// ops/packs/fetch-pack.js --from-dir: a site whose `fetch` is "dir" is built from bytes already on disk
// instead of from the network. Three hosts in the banking pack do not answer this server at all, so their
// pages were fetched from a machine in a place where they do answer and copied to /root/storage. The rule is
// that nothing else changes: the SAME extract, the SAME boilerplate stripping, the SAME renderDoc and the
// SAME writePack, with the url and the date taken from the harvest's manifest rather than from the clock.
//
// What is pinned here:
//   - a manifest entry becomes a document carrying the manifest's url and the manifest's fetchedAt;
//   - allow and deny decide, exactly as they do for a sitemap, and they see the query string too, because
//     ethiotelecom carries the page's language in ?lang=am and two languages of one page are two documents;
//   - a non-200 entry and a non-HTML entry are ignored rather than rendered;
//   - a PDF is read only when the site's allowPdf names it, and never otherwise.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

const page = (title, body) => '<html><head><title>' + title + '</title></head><body><div><p>'
  + body + ' ' + 'the institution publishes this figure and this condition. '.repeat(20) + '</p></div></body></html>';

// A harvest directory exactly as ops the harvester writes one: <sha1>.<ext> files plus manifest.json.
function harvest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fromdir-'));
  const dir = path.join(root, 'example.et');
  fs.mkdirSync(dir, { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  w('a.html', page('Pricing - Example', 'Sending 1,000 birr costs 8 birr.'));
  // Genuinely Amharic, and long enough to be: the importer measures the Ethiopic share of a page before it
  // agrees that a page on an Amharic url is an Amharic page, because six of the National Bank's /am/ index
  // screens are written entirely in English.
  w('b.html', page('Pricing in Amharic - Example', 'ገንዘብ ለመላክ የሚከፈል የአገልግሎት ክፍያ። '.repeat(20)));
  w('c2.html', page('Amharic in name only - Example', 'This index page sits on the Amharic tree and is written in English throughout. '.repeat(10)));
  w('c.html', page('Careers - Example', 'We are hiring.'));
  w('d.html', page('Broken - Example', 'This never came back.'));
  w('e.txt', 'not html at all');
  w('f.pdf', '%PDF-1.4 not a real pdf');
  w('g.pdf', '%PDF-1.4 not a real pdf either');
  const m = [
    { url: 'https://example.et/pricing', file: 'a.html', status: 200, contentType: 'text/html; charset=UTF-8', bytes: 10, sha256: 'aa', fetchedAt: '2026-09-16T18:24:53Z', title: 'Pricing', postType: 'p', lang: 'en' },
    { url: 'https://example.et/pricing?lang=am', file: 'b.html', status: 200, contentType: 'text/html', bytes: 10, sha256: 'bb', fetchedAt: '2026-09-16T18:25:53Z', title: 'Pricing am', postType: 'p', lang: 'am' },
    { url: 'https://example.et/careers', file: 'c.html', status: 200, contentType: 'text/html', bytes: 10, sha256: 'cc', fetchedAt: '2026-09-16T18:26:53Z', title: 'Careers', postType: 'p', lang: 'en' },
    { url: 'https://example.et/index?lang=am', file: 'c2.html', status: 200, contentType: 'text/html', bytes: 10, sha256: 'c2', fetchedAt: '2026-09-16T18:26:54Z', title: 'Index am', postType: 'p', lang: 'am' },
    { url: 'https://example.et/broken', file: 'd.html', status: 404, contentType: 'text/html', bytes: 10, sha256: 'dd', fetchedAt: '2026-09-16T18:27:53Z', title: '', postType: 'p', lang: 'en' },
    { url: 'https://example.et/notes.txt', file: 'e.txt', status: 200, contentType: 'text/plain', bytes: 10, sha256: 'ee', fetchedAt: '2026-09-16T18:28:53Z', title: '', postType: 'p', lang: 'en' },
    { url: 'https://example.et/uploads/rules/FXD-01-2024.pdf', file: 'f.pdf', status: 200, contentType: 'application/pdf', bytes: 10, sha256: 'ff', fetchedAt: '2026-09-16T18:29:53Z', title: 'FXD 01 2024', postType: 'media', lang: 'en' },
    { url: 'https://example.et/uploads/brand/Brand-Guidelines.pdf', file: 'g.pdf', status: 200, contentType: 'application/pdf', bytes: 10, sha256: 'gg', fetchedAt: '2026-09-16T18:30:53Z', title: 'Brand', postType: 'media', lang: 'en' },
    { url: 'https://other.example/pricing', file: 'a.html', status: 200, contentType: 'text/html', bytes: 10, sha256: 'hh', fetchedAt: '2026-09-16T18:31:53Z', title: 'Elsewhere', postType: 'p', lang: 'en' },
  ];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return root;
}

const SITE = {
  id: 'example', name: 'Example Telecom', nameAm: 'ኤግዛምፕል', host: 'example.et',
  fetch: 'dir', dir: 'example.et', lang: 'en', maxPages: 50, maxPdfs: 5,
  allow: ['^/pricing(\\?|$)', '^/index(\\?|$)'],
  deny: ['^/careers(\\?|$)', '\\?lang=(Tig|om|so)$'],
  allowPdf: ['/uploads/rules/'],
  langOverrides: [{ match: '\\?lang=am$', lang: 'am' }],
  pathSlugs: { '/pricing?lang=am': 'am-pricing', '/index?lang=am': 'am-index' },
  sections: [{ key: 'fees', titleAm: 'ክፍያ', match: '^/pricing' }, { key: 'rules', titleAm: 'ሕግ', match: '^/uploads/' }],
};

test('a manifest entry becomes a document with the manifest url and the manifest date', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root });
  const p = pages.find(x => x.path === '/pricing');
  assert.ok(p, 'the allowed page is there');
  assert.equal(p.url, 'https://example.et/pricing');
  assert.equal(p.fetchedAt, '2026-09-16', 'the date comes from the manifest, not from the clock');
  assert.equal(p.section, 'fees');
  assert.equal(p.lang, 'en');
  assert.match(p.text, /Sending 1,000 birr costs 8 birr/);
  assert.equal(p.title, 'Pricing - Example');
  fs.rmSync(root, { recursive: true, force: true });
});

test('allow and deny decide, and they see the query string', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root });
  const paths = pages.map(p => p.path).sort();
  assert.ok(paths.includes('/pricing'), 'allowed');
  assert.ok(paths.includes('/pricing?lang=am'), 'the Amharic variant of one path is its own document');
  assert.ok(!paths.includes('/careers'), 'denied');
  const am = pages.find(p => p.path === '/pricing?lang=am');
  assert.equal(am.lang, 'am', 'langOverrides may key on the query string');
  assert.equal(am.slug, 'example-am-pricing', 'and the Amharic variant is named by hand, not by rule');
  fs.rmSync(root, { recursive: true, force: true });
});

// Six of the National Bank's /am/ pages are index screens written entirely in English. Recording those as
// Amharic would tell an Amharic reader a page is in their language when it is not, and would put six English
// pages into the Amharic slice of every benchmark. So the registry's langOverrides is a claim about the url
// and the text is what settles it.
test('a page on the Amharic tree whose text is English is recorded as English', () => {
  const root = harvest();
  const { pages } = P.fetchDir(SITE, { root });
  const am = pages.find(p => p.path === '/pricing?lang=am');
  const inNameOnly = pages.find(p => p.path === '/index?lang=am');
  assert.equal(am.lang, 'am', 'this one really is Amharic');
  assert.ok(inNameOnly, 'the English index page on the Amharic tree is still a document');
  assert.equal(inNameOnly.lang, 'en', 'and it is recorded as the language it is actually written in');
  fs.rmSync(root, { recursive: true, force: true });
});

test('langOfText measures the text and leaves an English page alone', () => {
  assert.equal(P.langOfText('am', 'ሰላም '.repeat(200)), 'am');
  assert.equal(P.langOfText('am', 'hello world '.repeat(200)), 'en');
  assert.equal(P.langOfText('en', 'ሰላም '.repeat(200)), 'en', 'it never promotes, only demotes');
  assert.equal(P.AM_FLOOR, 300, 'the same floor knowledge/banking\'s document test uses');
});

test('a non-200 entry, a non-HTML entry and another host are ignored', () => {
  const root = harvest();
  const site = { ...SITE, allow: ['^/'], deny: [], allowPdf: [] };
  const { pages } = P.fetchDir(site, { root });
  const urls = pages.map(p => p.url);
  assert.ok(!urls.includes('https://example.et/broken'), 'a 404 in the harvest is not a document');
  assert.ok(!urls.includes('https://example.et/notes.txt'), 'text/plain is not a page');
  assert.ok(!urls.some(u => /other\.example/.test(u)), 'never another host');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a PDF is read only when allowPdf names it', () => {
  const root = harvest();
  const seen = [];
  const readPdf = f => { seen.push(path.basename(f)); return 'the directive says ' + 'x '.repeat(300); };
  const { pages } = P.fetchDir(SITE, { root, readPdf });
  assert.deepEqual(seen, ['f.pdf'], 'only the PDF under /uploads/rules/ was opened');
  const d = pages.find(p => /FXD-01-2024/.test(p.url));
  assert.ok(d, 'the allowed PDF became a document');
  assert.equal(d.section, 'rules');
  assert.equal(d.slug, 'example-fxd-01-2024');
  assert.equal(d.fetchedAt, '2026-09-16');
  fs.rmSync(root, { recursive: true, force: true });
});

test('with no allowPdf at all, no PDF is opened', () => {
  const root = harvest();
  const seen = [];
  const site = { ...SITE, allowPdf: undefined };
  P.fetchDir(site, { root, readPdf: f => { seen.push(f); return 'x'.repeat(600); } });
  assert.deepEqual(seen, [], 'a site that names no PDF rule reads no PDF');
  fs.rmSync(root, { recursive: true, force: true });
});

test('dirKeyOf normalises the percent-escapes and keeps the query', () => {
  assert.equal(P.dirKeyOf('https://x.et/%E1%89%B4%E1%88%8C/faq/?lang=am'), '/%e1%89%b4%e1%88%8c/faq?lang=am');
  assert.equal(P.dirKeyOf('https://x.et/a/b/'), '/a/b');
  assert.equal(P.dirKeyOf('nonsense'), null);
});

test('a page whose key needs a name and has none stops the run', () => {
  const root = harvest();
  const site = { ...SITE, pathSlugs: {} };
  assert.throws(() => P.fetchDir(site, { root }), /pathSlugs/, 'the ?lang=am page must be named by hand');
  fs.rmSync(root, { recursive: true, force: true });
});
