'use strict';
// ops/packs/fetch-pack.js --from-dir, the five rules the BUSINESS harvest needed that the banking one did not.
// Every one of them is a measurement from /root/storage/packs/business-manual, taken on 2026-09-17:
//
//   - etrade.gov.et is an Angular application whose HOME PAGE is the whole public catalogue: 14,602 characters
//     and thirteen service dialogs, against 909 on /faq and nothing at all anywhere else. The importer refused
//     the root path outright (`if (!key || key === '/') continue`), so the one page worth having could never
//     become a document. A site may now say `dirAllowRoot: true` - and only then;
//   - a root path has no last segment, so the slug rule produces the empty string for it. That was silent
//     before; now the run stops and asks for a name in pathSlugs, the same way a percent-encoded path does;
//   - 71 of the 187 pages harvested from mols.gov.et answer 200 with 173 KB of Elementor chrome and no body
//     at all. The harvest measured that and wrote `empty: true` with a reason; the importer counts the reason
//     rather than reading 12 MB of shell to discover it again;
//   - the same harvest carries `bodyChars` for every page. A page the harvester measured under the floor is
//     skipped with that number in the reason, and its file is never opened;
//   - motri.gov.et presents a wildcard certificate for *.mint.gov.et that expired on 2026-08-23, so its bytes
//     could only be read with verification off. A harvest that says so must be DECLARED by the registry, or
//     the run stops: provenance that lives only in a manifest is provenance that gets lost;
//   - every page of etrade.gov.et carries one <title>, and the real heading is in the manifest;
//   - mols.gov.et/agencies is a 177,222-character table of 1,222 licensed overseas employment agencies. The
//     OCR path already split a long document into parts at a page break; HTML has no page breaks, so it is
//     split at a LINE break, which keeps every agency's row whole.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

const filler = 'the institution publishes this condition and this document requirement. ';
const page = (title, body, heading) => '<html><head><title>' + title + '</title></head><body><div>'
  + (heading ? '<h1>' + heading + '</h1>' : '') + '<p>' + body + ' ' + filler.repeat(20) + '</p></div></body></html>';

function harvest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bizdir-'));
  const dir = path.join(root, 'example.gov.et');
  fs.mkdirSync(dir, { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  w('home.html', page('One Title For Everything', 'New business registration needs a TIN certificate.'));
  w('faq.html', page('One Title For Everything', 'A valid commercial registration comes before a licence.'));
  w('shell.html', page('One Title For Everything', 'nothing here'));
  w('long.html', '<html><head><title>One Title For Everything</title></head><body><div>'
    + Array.from({ length: 4000 }, (_, i) => '<p>agency ' + i + ' | addis ababa arada woreda 1 | 251900000001 | saudi arabia, united arab emirates</p>').join('')
    + '</div></body></html>');
  const m = [
    { url: 'https://example.gov.et/', file: 'home.html', status: 200, contentType: 'text/html; charset=utf-8; rendered=chromium',
      sha256: 'a1', fetchedAt: '2026-09-17T17:07:11Z', title: 'One Title For Everything', heading: 'የንግድ ምዝገባና የንግድ ፈቃድ መገልገያ በይነ መረብ', lang: 'am' },
    { url: 'https://example.gov.et/faq', file: 'faq.html', status: 200, contentType: 'text/html',
      sha256: 'a2', fetchedAt: '2026-09-17T17:08:02Z', title: 'One Title For Everything', heading: 'ጥያቄዎች', lang: 'am' },
    // measured empty by the harvester, with the reason it measured
    { url: 'https://example.gov.et/download-forms', file: 'shell.html', status: 200, contentType: 'text/html',
      sha256: 'a3', fetchedAt: '2026-09-17T17:09:00Z', title: 'Download forms', lang: 'en', bodyChars: 44,
      empty: true, emptyReason: 'page renders header/footer chrome only - no body widgets server-side' },
    // measured thin by the harvester; the file does not exist, so reading it would throw
    { url: 'https://example.gov.et/e-library', file: 'gone.html', status: 200, contentType: 'text/html',
      sha256: 'a4', fetchedAt: '2026-09-17T17:09:30Z', title: 'E library', lang: 'en', bodyChars: 120 },
    { url: 'https://example.gov.et/agencies', file: 'long.html', status: 200, contentType: 'text/html',
      sha256: 'a5', fetchedAt: '2026-09-17T17:10:00Z', title: 'agencies', lang: 'en', bodyChars: 177222 },
  ];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return root;
}

const BASE = {
  id: 'example', name: 'Example Authority', nameAm: 'ኤግዛምፕል', host: 'example.gov.et',
  fetch: 'dir', dir: 'example.gov.et', lang: 'am', maxPages: 50,
  allow: ['^/$', '^/faq$', '^/download-forms$', '^/e-library$', '^/agencies$'],
  deny: ['^/user(/|$)'],
  sections: [{ key: 'registration', titleAm: 'የንግድ ምዝገባ', match: '^/$|agencies' },
    { key: 'help', titleAm: 'አገልግሎትና እገዛ', match: 'faq|library|forms' }],
  pathSlugs: { '/': 'services-catalogue' },
};
const site = over => ({ ...BASE, ...over });
const run = (s, root, log) => P.fetchDir(s, { root, log: log || (() => {}) });

test('the root path is a document only when the site says dirAllowRoot', () => {
  const root = harvest();
  const without = run(site({ dirAllowRoot: false }), root);
  assert.equal(without.pages.some(p => p.path === '/'), false, 'the root must stay out unless the site asks for it');
  const withRoot = run(site({ dirAllowRoot: true }), root);
  const home = withRoot.pages.find(p => p.path === '/');
  assert.ok(home, 'etrade home page: the catalogue IS the root path');
  assert.equal(home.url, 'https://example.gov.et/', 'and it keeps its own url, so the Source line stays true');
  assert.equal(home.slug, 'example-services-catalogue');
});

test('a root path with no name in pathSlugs stops the run rather than writing a nameless file', () => {
  const root = harvest();
  assert.throws(() => run(site({ dirAllowRoot: true, pathSlugs: {} }), root),
    /needs a name in the site pathSlugs table/, 'the slug rule has no last segment to work from');
});

test('a page the harvest measured as empty is skipped with the harvest own reason', () => {
  const root = harvest();
  const r = run(site({ dirAllowRoot: true }), root);
  assert.equal(r.pages.some(p => p.path === '/download-forms'), false);
  const why = (r.failed.find(f => /download-forms/.test(f.url)) || {}).why || '';
  assert.match(why, /empty/i, 'the reason is counted, not guessed: ' + why);
  assert.match(why, /chrome only/, 'and it is the reason the harvester measured, in its words');
});

test('a page the harvest measured under the floor is skipped by that number, without opening the file', () => {
  const root = harvest();
  const r = run(site({ dirAllowRoot: true }), root);
  assert.equal(r.pages.some(p => p.path === '/e-library'), false);
  const why = (r.failed.find(f => /e-library/.test(f.url)) || {}).why || '';
  assert.match(why, /120/, 'the measured number belongs in the reason: ' + why);
  assert.equal(/unreadable/.test(why), false, 'the file was never opened - it does not exist');
});

test('a harvest taken with certificate verification off must be declared by the registry', () => {
  const root = harvest();
  const dir = path.join(root, 'example.gov.et');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const e of m) e.tls = 'expired-cert-verification-disabled';
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  assert.throws(() => run(site({ dirAllowRoot: true }), root), /tls/i,
    'provenance that lives only in the manifest is provenance that gets lost');
  const lines = [];
  const ok = run(site({ dirAllowRoot: true, tls: 'expired-cert-verification-disabled' }), root, s => lines.push(String(s)));
  assert.ok(ok.pages.length, 'a declared harvest still builds');
  assert.ok(lines.some(l => /expired-cert-verification-disabled/.test(l)), 'and it says so in the log');
});

test('a site whose pages share one title takes its titles from the manifest heading', () => {
  const root = harvest();
  const plain = run(site({ dirAllowRoot: true }), root);
  assert.equal(plain.pages.find(p => p.path === '/').title, 'One Title For Everything');
  const r = run(site({ dirAllowRoot: true, titleFrom: 'manifest-heading' }), root);
  assert.equal(r.pages.find(p => p.path === '/').title, 'የንግድ ምዝገባና የንግድ ፈቃድ መገልገያ በይነ መረብ');
  assert.equal(r.pages.find(p => p.path === '/faq').title, 'ጥያቄዎች');
  // A page the manifest gives no heading keeps the <title> the page itself carries, rather than losing its
  // name: the manifest heading is a better name where there is one, never a replacement for having one.
  const noHeading = r.pages.find(p => p.path === '/agencies');
  assert.equal(noHeading.title, 'One Title For Everything');
});

test('a long HTML page is split into parts that share its url, and part one keeps its name', () => {
  const root = harvest();
  const r = run(site({ dirAllowRoot: true }), root);
  const parts = r.pages.filter(p => p.path === '/agencies').sort((a, b) => a.part - b.part);
  assert.ok(parts.length >= 2, 'a 177,000-character register is more than one document');
  for (const p of parts) {
    assert.equal(p.url, 'https://example.gov.et/agencies', 'both parts cite the one page they came from');
    assert.equal(p.parts, parts.length);
    assert.ok(p.text.length <= 120000, 'part ' + p.part + ' is ' + p.text.length + ' characters');
  }
  assert.equal(parts[0].slug, 'example-agencies');
  assert.equal(parts[1].slug, 'example-agencies-part-2');
  // Nothing is lost and nothing is duplicated between the parts.
  assert.ok(parts.every(p => p.text.includes('agency ') || p.text.includes('|')));
  assert.ok(parts[0].text.includes('agency 0 '), 'the first row is in part one');
  assert.ok(parts[parts.length - 1].text.includes('agency 3999 '), 'the last row is in the last part');
});

test('splitting a long text never cuts a line in half', () => {
  const lines = Array.from({ length: 500 }, (_, i) => 'row ' + i + ' | a value that must not be cut in half');
  const parts = P.splitLongParts(lines.join('\n'), 1000);
  assert.ok(parts.length > 5);
  for (const p of parts) for (const l of p.split('\n')) assert.ok(lines.includes(l), 'a line was cut: ' + JSON.stringify(l));
  assert.equal(parts.join('\n').split('\n').length, lines.length, 'no line was lost or doubled');
  // A single line longer than the cap is left whole rather than cut.
  const one = P.splitLongParts('x'.repeat(3000), 1000);
  assert.deepEqual(one, ['x'.repeat(3000)]);
  // And the OCR splitter is the same function working on page breaks, so nothing the banking pack did changes.
  assert.deepEqual(P.splitOcrParts('a\fb\fc', 2), ['a', 'b', 'c']);
});
