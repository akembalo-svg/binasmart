'use strict';
// A tariff page with several tables, some of them under a heading that only says "tariff": sectionDocs writes the
// transfer tariffs as documents of their own, and what the chunker then makes of them. The case behind it is
// telebirr's pricing page (2026-09-23): search keeps at most two chunks of one document, the page's header chunk and
// its bank-transfer table took both places, and the person-to-person table never reached Bini; on the Amharic page
// both transfer tables sat under a bare "ታሪፍ" heading, so no chunk said which transfer it priced.
// Every page, heading, table and figure in this file is invented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));
const { chunkDoc } = require(path.join(__dirname, '..', '..', 'knowledge', 'index.js'));

const CASH_IN = ['## Tariffs for top-up & P2P send money', '## Top-up tariff', 'No. |', 'Min. |', 'Max. |', 'Tariff |', '1 |', '1 |', '90 |', 'Free |'];
const TO_BANK = ['## wallet to bank transfer tariff', 'S.N | Band | tariff |\n1 | 1 to 90 | 2 |\n2 | 91 to 700 | 5 |\n3 | 701 to 9000 | 11 |'];
const P2P = ['## wallet to wallet (P2P) transfer tariff', 'S.N | Band | tariff |\n1 | 1 to 90 | 1 |\n2 | 91 to 700 | 3 |\n3 | 701 to 9000 | 7 |'];
const FOOTER = ['-\nKiswahili'];
const PAGE = [...CASH_IN, ...TO_BANK, ...P2P, ...FOOTER].join('\n\n');

// The Amharic shape: the transfer's name is a heading of its own, with only the column labels under it, and the table
// follows under a second heading that says nothing but "tariff".
const AM_BANK = ['## ከዋሌት ወደ ባንክ', 'ተ.ቁ\n| ባንድ\n|', '## ታሪፍ', '|\n1 | < 90 | 2 |\n2 | 91 to 700 | 5 |\n3 | 701 to 9000 | 11 |'];
const AM_P2P = ['## ከዋሌት ወደ ዋሌት', 'ተ.ቁ\n| ባንድ\n|', '## ታሪፍ', '|\n1 | < 90 | 1 |\n2 | 91 to 700 | 3 |\n3 | 701 to 9000 | 7 |'];
const AM_PAGE = ['## የገንዘብ ማስገቢያ ታሪፍ', 'ተ.ቁ. |', '1 |', 'ነጻ |', ...AM_BANK, ...AM_P2P, ...FOOTER].join('\n\n');

const FOOT = '/^-\\nKiswahili/';
const SPECS = [
  { doc: 'w-pricing', key: 'bank-transfer-tariff', start: '## wallet to bank transfer tariff', end: '## wallet to wallet (P2P) transfer tariff', title: 'Pricing: wallet to bank transfer tariff' },
  { doc: 'w-pricing', key: 'p2p-transfer-tariff', start: '## wallet to wallet (P2P) transfer tariff', end: FOOT, title: 'Pricing: wallet to wallet send money transfer tariff' },
  { doc: 'w-am-pricing', key: 'bank-transfer-tariff', start: '## ከዋሌት ወደ ባንክ', end: '## ከዋሌት ወደ ዋሌት', title: 'የዋሌት ዋጋ: ከዋሌት ወደ ባንክ ታሪፍ' },
  { doc: 'w-am-pricing', key: 'p2p-transfer-tariff', start: '## ከዋሌት ወደ ዋሌት', end: FOOT, title: 'የዋሌት ዋጋ: ከዋሌት ወደ ዋሌት ገንዘብ ለማስተላለፍ ታሪፍ' },
];
const site = (over = {}) => ({ id: 'w', name: 'Example Wallet', nameAm: 'ምሳሌ ዋሌት', host: 'wallet.example.et', tableRows: true,
  langOverrides: [{ match: '\\?lang=am$', lang: 'am' }], sectionDocs: SPECS, ...over });
const pack = { id: 'banking', logPrefix: 'banking',
  headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Copied, not restated.' };
const pages = () => [
  { url: 'https://wallet.example.et/pricing/', path: '/pricing/', slug: 'w-pricing', siteId: 'w', title: 'Pricing', section: 'fees', text: PAGE, lang: 'en' },
  { url: 'https://wallet.example.et/pricing/?lang=am', path: '/pricing/?lang=am', slug: 'w-am-pricing', siteId: 'w', title: 'የዋሌት ዋጋ', section: 'fees', text: AM_PAGE, lang: 'am' },
];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sectiondocs-tariff-'));
const read = (dir, slug) => fs.readFileSync(path.join(dir, slug + '.md'), 'utf8');
const paras = t => String(t).split('\n\n').map(p => p.trim()).filter(Boolean);
// What knowledge/index.js indexes: the document without its front matter, titled with its front-matter title.
const chunksOf = md => chunkDoc(String(md).replace(/^---[\s\S]*?\n---\s*/, ''), P.readMeta(md).title, { lineSafe: true });
const chunkWith = (md, s) => chunksOf(md).find(c => c.text.includes(s));

test('each transfer tariff becomes a document of its own; the page keeps its other table and its footer', () => {
  const dir = tmp();
  const r = P.writePack(dir, pages(), site(), { today: '2026-09-23', pack });
  assert.deepEqual(r.split.sort(), ['w-am-pricing-bank-transfer-tariff', 'w-am-pricing-p2p-transfer-tariff', 'w-pricing-bank-transfer-tariff', 'w-pricing-p2p-transfer-tariff']);
  assert.equal(P.bodyText(read(dir, 'w-pricing-p2p-transfer-tariff')), P2P.join('\n\n'));
  assert.equal(P.bodyText(read(dir, 'w-pricing-bank-transfer-tariff')), TO_BANK.join('\n\n'));
  assert.equal(P.bodyText(read(dir, 'w-am-pricing-p2p-transfer-tariff')), AM_P2P.join('\n\n'));
  assert.equal(P.bodyText(read(dir, 'w-pricing')), [...CASH_IN, ...FOOTER].join('\n\n'));
  // every paragraph of each page is in exactly one of its documents, and nothing was added
  for (const [slug, text] of [['w-pricing', PAGE], ['w-am-pricing', AM_PAGE]]) {
    const all = [slug, slug + '-bank-transfer-tariff', slug + '-p2p-transfer-tariff'].flatMap(s => paras(P.bodyText(read(dir, s))));
    assert.deepEqual([...all].sort(), paras(text).sort());
  }
  // the page's "On this page" names only what is still on it
  assert.ok(read(dir, 'w-pricing').includes('On this page: Top-up tariff.'));
  assert.equal(P.rerenderPack(dir, { pack, sites: [site()] }).rerendered.length, 0, 'a second render changes nothing');
});

test('the person-to-person table chunk now says which transfer it prices, in both languages', () => {
  const dir = tmp();
  P.writePack(dir, pages(), site(), { today: '2026-09-23', pack });
  const en = chunkWith(read(dir, 'w-pricing-p2p-transfer-tariff'), '701 to 9000 | 7');
  assert.ok(en, 'the table is one chunk');
  assert.match(en.text.split('\n')[0], /wallet to wallet send money transfer tariff/);
  const am = chunkWith(read(dir, 'w-am-pricing-p2p-transfer-tariff'), '701 to 9000 | 7');
  assert.match(am.text.split('\n')[0], /ከዋሌት ወደ ዋሌት/, 'the header line names the transfer, not only "ታሪፍ"');
  const bank = chunkWith(read(dir, 'w-am-pricing-bank-transfer-tariff'), '701 to 9000 | 11');
  assert.match(bank.text.split('\n')[0], /ከዋሌት ወደ ባንክ/);
  assert.doesNotMatch(bank.text, /701 to 9000 \| 7/, 'the bank table and the person-to-person table are not in one chunk');
});

test('without the split the Amharic tables are chunks headed only "ታሪፍ", which is what went wrong', () => {
  const dir = tmp();
  P.writePack(dir, pages(), site({ sectionDocs: [] }), { today: '2026-09-23', pack });
  const p2p = chunkWith(read(dir, 'w-am-pricing'), '701 to 9000 | 7');
  const bank = chunkWith(read(dir, 'w-am-pricing'), '701 to 9000 | 11');
  for (const c of [p2p, bank]) {
    assert.match(c.text.split('\n')[0], /› ታሪፍ$/);
    assert.doesNotMatch(c.text, /ከዋሌት ወደ/, 'nothing in the chunk says which transfer it is');
  }
});

test('a section title may not carry the figure in "P2P": the registry has to say it in words', () => {
  const bad = { ...SPECS[1], title: 'Pricing: wallet to wallet (P2P) transfer tariff' };
  assert.throws(() => P.writePack(tmp(), pages(), site({ sectionDocs: [bad] }), { today: '2026-09-23', pack }), /may not hold a figure/);
});
