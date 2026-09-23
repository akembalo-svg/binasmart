'use strict';
// knowledge/telecom joins law, health, eservices, mor, travel, banking and business as a CURATED source: loaded whole
// from knowledge/<pack>/*.md, never from knowledge/web, which truncates every page at 20,000 characters (the
// Communications Service Proclamation is 70,000).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const K = require(path.join(ROOT, 'knowledge', 'index.js'));

test('telecom is a pack source, English by default, and a directory the Source line reads', () => {
  const row = K.PACK_SOURCES.find(([s]) => s === 'telecom');
  assert.ok(row, 'telecom is not in PACK_SOURCES');
  assert.equal(row[1], 'en');
  assert.equal(K.docMetaFile(ROOT, 'telecom', 'telecom-eca-about'), path.join(ROOT, 'knowledge', 'telecom', 'telecom-eca-about.md'));
});

test('readSources loads the telecom pack whole, with a url and a language on every document', () => {
  const docs = K.readSources(ROOT, ['telecom']);
  assert.ok(docs.length >= 200, 'expected at least 200 telecom documents, got ' + docs.length);
  for (const d of docs) {
    assert.equal(d.source, 'telecom');
    assert.match(d.slug, /^telecom-(ethiotelecom|safaricom|eca)-[a-z0-9-]+$/);
    assert.match(d.url || '', /^https:\/\//, d.slug);
    // om: Ethio telecom's own Afaan Oromoo versions of pages the pack holds in English (sources.json translationOf)
    assert.ok(['en', 'am', 'om'].includes(d.lang), d.slug + ' lang: ' + d.lang);
    if (d.lang === 'om') assert.match(d.slug, /^telecom-ethiotelecom-om-/);
  }
  const proc = docs.find(d => d.slug === 'telecom-eca-communications-service-proclamation-1148-2019');
  assert.ok(proc.text.length > 60000, 'the proclamation is not truncated: ' + proc.text.length);
});

test('the Source line of a telecom hit names the publisher, the url and the day the harvest captured the page', () => {
  const line = K.sourceLine({ source: 'telecom', slug: 'telecom-eca-directive-832-2021-consumer-rights-and-protection', title: 'x' }, { root: ROOT });
  assert.match(line, /Ethiopian Communications Authority/);
  assert.match(line, /https:\/\/www\.eca\.et\/wp-content\/uploads\/2022\/10\//);
  assert.match(line, /fetched 2026-09-\d\d/);
});

test('curatedHosts: the pack owns safaricom.et and eca.et, banking keeps ethiotelecom.et, and a crawled copy of either is refused', () => {
  const owned = K.curatedHosts(ROOT);
  assert.equal(owned.get('safaricom.et').pack, 'telecom');
  assert.equal(owned.get('eca.et').pack, 'telecom');
  assert.equal(owned.get('ethiotelecom.et').pack, 'banking', 'the first pack in name order keeps the host');
  assert.equal(K.curatedSkip(owned, 'https://www.eca.et/consumer-affairs/').pack, 'telecom');
  assert.equal(K.curatedSkip(owned, 'https://www.safaricom.et/en/personal/packages/data').pack, 'telecom');
});

test('a crawled directory for eca.et is not read once the pack owns the host', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-'));
  fs.mkdirSync(path.join(root, 'knowledge', 'telecom'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'telecom', 'sources.json'), JSON.stringify({ pack: { id: 'telecom' }, sites: [{ id: 'eca', fetch: 'dir', host: 'www.eca.et', dir: 'www.eca.et' }] }));
  fs.mkdirSync(path.join(root, 'knowledge', 'web', 'eca'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'web', 'eca', 'aaaa.md'),
    '---\nurl: "https://eca.et/consumer-affairs"\ntitle: "Consumer affairs"\nsource_name: "ECA"\nlang: en\n---\n' + 'The Authority publishes this notice about complaints and consumer rights. '.repeat(12) + '\n');
  const docs = K.readSources(root, ['web']);
  assert.equal(docs.filter(d => /^eca\//.test(d.slug)).length, 0);
});

test('the index masks a personal mobile in a telecom document on the way in, and the violation check finds none left', () => {
  const docs = K.readSources(ROOT, ['telecom']);
  const masked = K.maskedSites(ROOT);
  assert.ok(masked.has('telecom'), 'the pack registry sets maskPhones');
  assert.deepEqual(K.maskViolations(docs, masked), []);
  // an unmasked file is masked at ingest even if the file itself was not: run the same masker on a fixture
  const fixture = [{ source: 'telecom', slug: 'telecom-safaricom-x', text: 'Call 0900000012 or +251900000013.' }];
  assert.equal(K.maskViolations(fixture, masked).length, 1);
  K.maskDocs(fixture, ROOT);
  assert.deepEqual(K.maskViolations(fixture, masked), []);
  assert.match(fixture[0].text, /09•••••0012/);
  assert.match(fixture[0].text, /251•••••0013/);
});
