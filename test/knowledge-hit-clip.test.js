'use strict';
// What a search hit carries of its chunk. Until 2026-09-23 it was text.slice(0, 900), and chunkDoc stores chunks up to
// CHUNK * 1.6 plus a title line, so the EIC shed-rent table reached Bini ending "Year 8 – 10: Adama & Dire Da".
// Now: a chunk that fits is passed whole and unchanged; one that does not is cut at a line break, never mid-row.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, clipLines, HIT_CHARS, chunkDoc, DIMS, toBuf } = require('../knowledge/index');

function store(docs, { withKey = true } = {}) {
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  let id = 0;
  const rows = docs.map(d => ({ id: 'r' + (++id), source: d.source, slug: d.slug, url: 'https://example.et/' + d.slug, title: d.title || d.slug,
    lang: 'en', ord: 0, text: d.text, embedding: withKey ? toBuf(fakeVec(d.text)) : null }));
  const prisma = { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } };
  const fetchImpl = async (url, opts) => ({ status: 200, json: async () => ({ embedding: { values: fakeVec(JSON.parse(opts.body).content.parts[0].text) } }) });
  return makeKnowledge({ prisma, apiKey: withKey ? 'k' : '', fetchImpl, root: path.join(__dirname, '..'), sleep: async () => {} });
}

// Invented figures in the shape of the real table: one row per period, the last two past character 900.
const LEAD = 'Example Commission - FAQs: industry park leases and readymade shed prices › Leases\n'
  + 'There are 3 types of leases and prices for industry parks; readymade sheds, readymade land, and raw land.\n'
  + '- Readymade sheds are available start at a price of $9 per m2 per month\n'
  + 'Table: Lease Period by North & South Industry Parks, All other Industry Parks\n'
  + 'Lease Period | North & South Industry Parks | All other Industry Parks\n';
const ROWS = ['Year 1 – 4', 'Year 5 – 7', 'Year 8 – 10', 'Year 11 – 15'].map((y, i) =>
  y + ': North & South Industry Parks $' + (7 + i) + '.25 per m2 per month; All other Industry Parks $' + (5 + i) + '.5 per m2 per month'
  + '; conditions of the lease period as written in the commission schedule for readymade sheds in every park named here');
const TABLE = LEAD + ROWS.join('\n');

test('clipLines: a text within the cap is returned unchanged', () => {
  assert.equal(clipLines('short text\nsecond line'), 'short text\nsecond line');
  const exact = 'x'.repeat(HIT_CHARS);
  assert.equal(clipLines(exact), exact);
  assert.ok(TABLE.length > 900 && TABLE.length < HIT_CHARS, 'fixture is a long chunk that fits the cap: ' + TABLE.length);
  assert.equal(clipLines(TABLE), TABLE);
});

test('clipLines: an over-cap text ends at the last line break before the cap, never mid-line', () => {
  const lines = []; for (let i = 0; i < 40; i++) lines.push('Row ' + i + ': a fee of ' + (100 + i) + ' birr for the service named in this row');
  const long = lines.join('\n');
  assert.ok(long.length > HIT_CHARS);
  const cut = clipLines(long);
  assert.ok(cut.length <= HIT_CHARS);
  assert.ok(long.startsWith(cut));
  assert.equal(long[cut.length], '\n', 'the cut is at a line break');
  assert.ok(lines.includes(cut.split('\n').pop()), 'the last line is a whole row');
  // a smaller cap behaves the same way
  const c2 = clipLines(TABLE, 900);
  assert.ok(c2.length <= 900 && TABLE[c2.length] === '\n');
  assert.ok(!/Da$/.test(c2) && /per m2 per month$|Parks\n?$|park named here$/.test(c2), 'ends on a whole line: ' + JSON.stringify(c2.slice(-40)));
});

test('clipLines: one long line with no break is cut at a space, and a text with neither at the cap', () => {
  const words = Array.from({ length: 400 }, (_, i) => 'word' + i).join(' ');
  const cut = clipLines(words);
  assert.ok(cut.length <= HIT_CHARS && words.startsWith(cut) && words[cut.length] === ' ');
  assert.equal(clipLines('y'.repeat(HIT_CHARS + 50)).length, HIT_CHARS);
});

test('HIT_CHARS sits above the longest chunk chunkDoc makes from one long paragraph', () => {
  // CHUNK * 1.6 is the most a piece can hold before chunkDoc splits it; the title line comes on top.
  const para = Array.from({ length: 300 }, (_, i) => 'Line ' + i + ' of one long paragraph').join('\n');
  for (const lineSafe of [false, true])
    for (const c of chunkDoc(para, 'A title of ordinary length › and its heading', { lineSafe })) assert.ok(c.text.length < HIT_CHARS, c.text.length);
});

test('search: a stored chunk longer than 900 characters comes back whole — every row of the table', async () => {
  const k = store([
    { source: 'business', slug: 'example-industry-park-leases', text: TABLE },
    { source: 'business', slug: 'example-short', text: 'shed rent short page about industry park leases' },
  ]);
  const hits = await k.search('industry park shed rent lease period', { k: 5 });
  const h = hits.find(x => x.slug === 'example-industry-park-leases');
  assert.ok(h, 'the table page is found');
  assert.equal(h.text, TABLE);
  for (const y of ['Year 1 – 4', 'Year 5 – 7', 'Year 8 – 10', 'Year 11 – 15']) assert.ok(h.text.includes(y), y);
  assert.equal(hits.find(x => x.slug === 'example-short').text, 'shed rent short page about industry park leases', 'a short chunk is untouched');
});

test('search: a stored chunk over the cap is cut at a line break', async () => {
  const lines = []; for (let i = 0; i < 40; i++) lines.push('Year ' + i + ': industry park shed rent of ' + (i + 1) + '.5 per m2 per month for this period');
  const long = lines.join('\n');
  const k = store([{ source: 'business', slug: 'example-long', text: long }]);
  const [h] = await k.search('industry park shed rent', { k: 3 });
  assert.ok(h.text.length <= HIT_CHARS && long.startsWith(h.text) && long[h.text.length] === '\n');
});

test('contextFor: Bini is handed all four rows of the table', async () => {
  const k = store([{ source: 'business', slug: 'example-industry-park-leases', text: TABLE }], { withKey: false });
  const ctx = await k.contextFor('How much does it cost to rent a shed in an industry park?');
  for (const r of ROWS) assert.ok(ctx.includes(r), r.slice(0, 14));
});
