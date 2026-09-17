'use strict';
// The Source line, and the only thing that makes the "date every figure" guardrail obeyable.
//
// A KnowledgeChunk row carries source, slug, url, title and lang. It does NOT carry the date the page was
// fetched: a chunk's own header is "<title> › <heading>" and nothing more. Task 15a measured what that costs —
// 26 of the 27 chunks of knowledge/banking/nbe-foreign-exchange.md contain no date at all, so an answer built
// from them either had no date or had one Bini read out of the page's prose (the wrong one).
//
// contextFor now prints one line at the top of each page's block, built at context-build time from the
// document's front matter on disk. Nothing is re-chunked, re-hashed or re-embedded, and the line is never
// invented: a page whose front matter holds no url and no date gets its title and stops there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeKnowledge, sourceLine, docMeta, DIMS } = require('../knowledge/index');

const FX = ['---',
  'url: "https://nbe.gov.et/fx"',
  'title: "National Bank of Ethiopia — FX"',
  'source_name: "National Bank of Ethiopia"',
  'lang: "en"',
  'status: "live"',
  'fetchedAt: "2026-09-16"',
  'lastChecked: "2026-09-17"',
  '---',
  '',
  '## Travel allowance',
  '',
  'Banks can provide up to USD 5,000 in cash for personal travellers who travel outside Ethiopia, once per travel, against a valid passport and a ticket. The allowance is granted per traveller and per trip and is recorded on the traveller declaration.',
  '',
  '## Business travel allowance',
  '',
  'For business travel outside Ethiopia a bank may provide up to USD 10,000 against a letter from the employer, once per travel, and the same declaration rules apply to the traveller carrying it.',
  ''].join('\n');

const BARE = ['---',
  'title: "A page that records nothing about itself"',
  '---',
  '',
  'The travel allowance is also discussed here, at length, so that this page can compete for the same words as the page above and take a numbered block of its own in the context.',
  ''].join('\n');

const AM = ['---',
  'url: "https://www.ethiotelecom.et/telebirr?lang=am"',
  'title: "telebirr"',
  'source_name: "Ethio telecom — telebirr"',
  'lang: "am"',
  'fetchedAt: "2026-09-16"',
  'lastChecked: "2026-09-16"',
  '---',
  '',
  '## ገንዘብ መላክ',
  '',
  'በቴሌብር በየትኛውም የአገሪቱ ክፍል ለሚኖሩ ቤተሰቦችዎ ገንዘብ በፍጥነት ለመላክ ያስችልዎታል። የክፍያ መጠኑ በባንድ ይሰላል።',
  ''].join('\n');

const WEB = ['---',
  'url: "https://www.ebc.et/Home/NewsDetails?NewsId=7935"',
  'title: "A crawled page"',
  'source_name: "ኢቢሲ (EBC)"',
  'lang: am',
  'fetched: 2026-09-08',
  '---',
  '',
  'body',
  ''].join('\n');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-source-line-'));
  fs.mkdirSync(path.join(root, 'knowledge', 'banking'), { recursive: true });
  fs.mkdirSync(path.join(root, 'knowledge', 'web', 'ebc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'banking', 'nbe-foreign-exchange.md'), FX);
  fs.writeFileSync(path.join(root, 'knowledge', 'banking', 'bare.md'), BARE);
  fs.writeFileSync(path.join(root, 'knowledge', 'banking', 'telebirr-am.md'), AM);
  fs.writeFileSync(path.join(root, 'knowledge', 'web', 'ebc', 'abc123.md'), WEB);
  return root;
}

// the in-memory store of test/knowledge.test.js, cut down to what an ingest and a keyword search need
function store(root) {
  const rows = []; let seq = 0;
  const prisma = { knowledgeChunk: {
    findMany: async ({ where, take } = {}) => rows.filter(r => !where || Object.keys(where).every(k => {
      const w = where[k]; if (w === null) return r[k] == null;
      if (w && typeof w === 'object' && 'notIn' in w) return !w.notIn.includes(r[k]);
      if (w && typeof w === 'object' && 'in' in w) return w.in.includes(r[k]);
      return r[k] === w; })).slice(0, take || 1e9).map(r => ({ ...r })),
    create: async ({ data }) => { const r = { id: 'c' + (++seq), embedding: null, embeddingLocal: null, ...data }; rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    deleteMany: async () => ({ count: 0 }),
  } };
  // no api key: no Gemini call, no reranker, keyword-only ranking — the context is built by the same code path
  return makeKnowledge({ prisma, apiKey: '', fetchImpl: async () => { throw new Error('no network in tests'); },
    root, sleep: async () => {}, localFallback: false });
}

const count = (s, needle) => s.split(needle).length - 1;

test('a curated page carries its publisher, its url and its real fetch date', () => {
  const root = fixture();
  assert.equal(sourceLine({ source: 'banking', slug: 'nbe-foreign-exchange', title: 'x', url: 'https://nbe.gov.et/fx' }, { root }),
    'Source: National Bank of Ethiopia — https://nbe.gov.et/fx — fetched 2026-09-16 (checked 2026-09-17)');
});

test('a page checked on the day it was fetched does not say so twice', () => {
  const root = fixture();
  assert.equal(sourceLine({ source: 'banking', slug: 'telebirr-am', title: 'x', url: null }, { root }),
    'Source: Ethio telecom — telebirr — https://www.ethiotelecom.et/telebirr?lang=am — fetched 2026-09-16');
});

test('an Amharic context says the same thing in Amharic', () => {
  const root = fixture();
  const line = sourceLine({ source: 'banking', slug: 'nbe-foreign-exchange', title: 'x', url: null }, { root, am: true });
  assert.ok(line.startsWith('ምንጭ፦ National Bank of Ethiopia — https://nbe.gov.et/fx — '), line);
  assert.ok(/የተወሰደበት ቀን 2026-09-16/.test(line), line);
  assert.ok(/የተረጋገጠበት 2026-09-17/.test(line), line);
});

test('a crawled page uses the crawler front matter: source_name and fetched', () => {
  const root = fixture();
  assert.equal(sourceLine({ source: 'web', slug: 'ebc/abc123', title: 'ኢቢሲ (EBC) · A crawled page', url: 'https://www.ebc.et/Home/NewsDetails?NewsId=7935' }, { root }),
    'Source: ኢቢሲ (EBC) — https://www.ebc.et/Home/NewsDetails?NewsId=7935 — fetched 2026-09-08');
});

test('nothing is invented: a page with no metadata gets its title and stops', () => {
  const root = fixture();
  assert.equal(sourceLine({ source: 'banking', slug: 'bare', title: 'A page that records nothing about itself', url: null }, { root }),
    'Source: A page that records nothing about itself');
  // a source that is not a file on disk at all (a guide, a news article) keeps whatever the row carries
  assert.equal(sourceLine({ source: 'guide', slug: 'fayda', title: 'Fayda', url: 'https://bina.et/fayda' }, { root }),
    'Source: Fayda — https://bina.et/fayda');
  assert.equal(docMeta(root, 'guide', 'fayda'), null);
});

test('a slug can never read a file outside the knowledge tree', () => {
  const root = fixture();
  assert.equal(docMeta(root, 'banking', '../../../etc/passwd'), null);
  assert.equal(docMeta(root, 'web', '../../banking/nbe-foreign-exchange'), null);
  assert.equal(sourceLine({ source: 'banking', slug: '../../../etc/passwd', title: 'T', url: null }, { root }), 'Source: T');
});

test('contextFor prints the Source line once per page, however many chunks of it are retrieved', async () => {
  const root = fixture();
  const k = store(root);
  await k.ingest({ only: ['banking'], embed: false });
  const ctx = await k.contextFor('how much foreign currency can a traveller take abroad for travel');
  assert.match(ctx, /Relevant BinaSmart knowledge/);
  assert.equal(count(ctx, 'Source: National Bank of Ethiopia — https://nbe.gov.et/fx — fetched 2026-09-16 (checked 2026-09-17)'), 1,
    'the FX page is named exactly once:\n' + ctx);
  // the numbered header line is unchanged, so assistant/kit/sources.js still parses it
  assert.match(ctx, /^\[1\] .+$/m);
  assert.equal(/Source:.*undefined|Source:.*null/.test(ctx), false, ctx);
});

test('an Amharic question gets Amharic Source lines', async () => {
  const root = fixture();
  const k = store(root);
  await k.ingest({ only: ['banking'], embed: false });
  const ctx = await k.contextFor('ገንዘብ በቴሌብር መላክ', { lang: 'am', styleK: 0 });
  assert.match(ctx, /ምንጭ፦ Ethio telecom — telebirr — https:\/\/www\.ethiotelecom\.et\/telebirr\?lang=am — የተወሰደበት ቀን 2026-09-16/);
  assert.equal(count(ctx, 'Source: '), 0, ctx);
});
