'use strict';
// The document behind the post (design §5.6). NBE's channel is the case that makes this worth building: nine
// pack-grade notices in a month, every one a 41–79-character title whose substance is an image or a PDF on
// nbe.gov.et. The channel says a document exists; it does not say what is in it.
//
// Two promises are asserted here, and the second is the one that will actually fire every morning:
//   * a success lands in /root/storage/packs/watch-manual/<host>/ with a manifest in the --from-dir format,
//     and NEVER inside a pack directory — curation stays where it is;
//   * a failure is not a lost item. mols, ecc, mint, fsc, egov, esl, daro and eeu all time out from this VPS
//     today, so the watch document is written anyway with pending_document, and the note names it so the file
//     can be fetched by the laptop route.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { documentLinks, fetchDocuments, assertHarvestRoot, HARVEST_ROOT, fileNameFor } = require('../ops/watch/channels/document');
const { watchDoc } = require('../ops/watch/channels/write');

const post = (over = {}) => ({ id: 412, channel: '@nbethiopia', url: 'https://t.me/nbethiopia/412',
  at: '2026-09-11T08:00:00.000Z', date: '2026-09-11', lang: 'en',
  text: 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28', links: [], ...over });
const item = (over = {}, postOver = {}) => ({ post: post(postOver), office: 'nbe', label: 'pack-grade', admit: true,
  source: { id: 'nbe', office: 'nbe', kind: 'office', handle: '@nbethiopia', name: 'National Bank of Ethiopia', pack: 'banking' }, ...over });

test('a link is worth fetching when it is a PDF or the office own host, never the Telegram post itself', () => {
  assert.deepEqual(documentLinks(item({}, { links: ['https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf'] })),
    ['https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf']);
  assert.deepEqual(documentLinks(item({}, { links: ['https://ecc.gov.et/notice/working-hours'] })),
    ['https://ecc.gov.et/notice/working-hours'], 'any .gov.et page counts');
  assert.deepEqual(documentLinks(item({ office: 'ethiotelecom' }, { links: ['https://fixedservices.ethiotelecom.et/selfcare'] })),
    ['https://fixedservices.ethiotelecom.et/selfcare'], 'a subdomain of the office own host counts');
  assert.deepEqual(documentLinks(item({ office: 'nbe' }, { links: ['https://fixedservices.ethiotelecom.et/selfcare'] })), [],
    'but only for the office whose host it is');
  assert.deepEqual(documentLinks(item({}, { links: ['https://t.me/nbethiopia/412', 'https://telegram.org/x'] })), [],
    'the post is not the document behind the post');
  assert.deepEqual(documentLinks(item({}, { links: ['https://www.fanamc.com/archives/322502'] })), [],
    'a newspaper article is not an official document');
  assert.deepEqual(documentLinks(item({}, { links: ['https://nbe.gov.et/'] })), [],
    'a signature link to the front page says nothing about this post');
  // a PDF anywhere is still a PDF: a ministry that publishes through a file host is the common case
  assert.deepEqual(documentLinks(item({}, { links: ['https://files.example.et/circular.pdf'] })),
    ['https://files.example.et/circular.pdf']);
});

test('the harvest root is watch-manual, and anything else under packs/ is refused', () => {
  assert.equal(HARVEST_ROOT, '/root/storage/packs/watch-manual');
  assert.doesNotThrow(() => assertHarvestRoot('/root/storage/packs/watch-manual'));
  for (const bad of ['/root/storage/packs/banking-manual', '/root/storage/packs/banking', '/root/storage/packs/travel-manual'])
    assert.throws(() => assertHarvestRoot(bad), /watch/i, bad + ' must be refused');
  assert.doesNotThrow(() => assertHarvestRoot('/tmp/whatever'), 'a test root is not a pack');
});

test('a fetched document lands in the harvest with a --from-dir manifest, and in no pack directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdoc-'));
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpack-'));
  try {
    const seen = [];
    const fetchImpl = async (url, opts) => {
      seen.push({ url, ua: opts.headers['user-agent'] });
      return { status: 200, headers: { get: k => (k === 'content-type' ? 'application/pdf' : null) },
        arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 auction 28').buffer };
    };
    const it = item({}, { links: ['https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf'] });
    const slept = [];
    const r = await fetchDocuments([it], { fetchImpl, root, sleep: async ms => slept.push(ms), now: '2026-09-18T02:00:05Z' });
    assert.equal(r.fetched.length, 1);
    assert.equal(r.pending.length, 0);
    assert.match(seen[0].ua, /BinaSmart/, 'the pack fetcher user agent, not a new one');
    const dir = path.join(root, 'nbe.gov.et');
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 2, 'the bytes and the manifest: ' + files.join(', '));
    assert.ok(files.includes('manifest.json'));
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(m.length, 1);
    for (const k of ['url', 'file', 'status', 'contentType', 'bytes', 'sha256', 'fetchedAt'])
      assert.ok(m[0][k] !== undefined, 'the manifest needs ' + k + ' for --from-dir');
    assert.equal(m[0].url, 'https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf');
    assert.equal(m[0].status, 200);
    assert.equal(m[0].fetchedAt, '2026-09-18T02:00:05Z');
    assert.equal(fs.readFileSync(path.join(dir, m[0].file), 'utf8'), '%PDF-1.4 auction 28');
    assert.deepEqual(fs.readdirSync(packDir), [], 'nothing was written into a pack directory');
    // and the document that is written says nothing about a pending fetch
    assert.equal(watchDoc(it, { today: '2026-09-18' }).meta.pending_document, undefined);
    // a second run of the same url does not duplicate the manifest row
    const again = await fetchDocuments([item({}, { links: ['https://nbe.gov.et/wp-content/uploads/2026/09/auction-28.pdf'] })],
      { fetchImpl, root, sleep: async () => {}, now: '2026-09-19T02:00:05Z' });
    assert.equal(again.fetched.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).length, 1, 'one row per url');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(packDir, { recursive: true, force: true }); }
});

test('a timeout does not lose the item: pending_document is set and the document is still written', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdoc-'));
  try {
    const fetchImpl = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const it = item({ office: 'ecc', source: { id: 'ecc', office: 'ecc', kind: 'office', handle: '@EthiopianCustomsCommission', name: 'Ethiopian Customs Commission', pack: null } },
      { channel: '@EthiopianCustomsCommission', url: 'https://t.me/EthiopianCustomsCommission/205',
        links: ['https://ecc.gov.et/notice/working-hours'], lang: 'en', date: '2026-09-17',
        text: 'Branch offices will serve until 19:00 from Meskerem 7 to Meskerem 30' });
    const r = await fetchDocuments([it], { fetchImpl, root, sleep: async () => {}, now: '2026-09-18T02:00:05Z' });
    assert.equal(r.fetched.length, 0);
    assert.equal(r.pending.length, 1);
    assert.equal(r.pending[0].why, 'timeout');
    assert.equal(r.pending[0].url, 'https://ecc.gov.et/notice/working-hours');
    assert.equal(it.pendingDocument, true, 'the item carries the flag on to the writer and to the note');
    const d = watchDoc(it, { today: '2026-09-18', pendingDocument: it.pendingDocument });
    assert.equal(d.meta.pending_document, 'yes');
    assert.match(d.text, /pending_document: "yes"/);
    assert.match(d.text, /Branch offices will serve until 19:00/, 'the announcement is still a document');
    assert.equal(fs.existsSync(path.join(root, 'ecc.gov.et')), false, 'a failed fetch leaves no empty harvest folder');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an item with no document link is neither fetched nor pending', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdoc-'));
  try {
    let called = 0;
    const r = await fetchDocuments([item()], { fetchImpl: async () => { called++; throw new Error('no'); }, root, sleep: async () => {} });
    assert.deepEqual([r.fetched.length, r.pending.length, called], [0, 0, 0]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the hosts are paced 5 s apart, and the file name is the url hash so a re-fetch overwrites itself', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdoc-'));
  try {
    const slept = [];
    const fetchImpl = async () => ({ status: 200, headers: { get: () => 'application/pdf' },
      arrayBuffer: async () => new TextEncoder().encode('x').buffer });
    await fetchDocuments([
      item({}, { links: ['https://nbe.gov.et/a.pdf'] }),
      item({}, { links: ['https://nbe.gov.et/b.pdf'] }),
      item({}, { links: ['https://nbe.gov.et/c.pdf'] }),
    ], { fetchImpl, root, sleep: async ms => slept.push(ms), now: '2026-09-18T02:00:05Z' });
    assert.deepEqual(slept, [5000, 5000], 'no delay before the first, one between each pair');
    assert.equal(fileNameFor('https://nbe.gov.et/a.pdf', 'application/pdf'), fileNameFor('https://nbe.gov.et/a.pdf', 'application/pdf'));
    assert.match(fileNameFor('https://nbe.gov.et/a.pdf', 'application/pdf'), /^[0-9a-f]{40}\.pdf$/);
    assert.match(fileNameFor('https://ecc.gov.et/notice', 'text/html; charset=utf-8'), /^[0-9a-f]{40}\.html$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a non-200 is a failure with its status, not a document of an error page', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdoc-'));
  try {
    const fetchImpl = async () => ({ status: 403, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) });
    const it = item({}, { links: ['https://nbe.gov.et/a.pdf'] });
    const r = await fetchDocuments([it], { fetchImpl, root, sleep: async () => {} });
    assert.equal(r.pending[0].why, 'http_403');
    assert.equal(it.pendingDocument, true);
    assert.equal(fs.existsSync(path.join(root, 'nbe.gov.et')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
