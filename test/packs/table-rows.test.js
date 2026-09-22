'use strict';
// A table htmlToText wrote one cell per line loses which value belongs to which row and column: Bini paired the
// Investment Commission's shed lease prices with the wrong park and the wrong years. tableRows writes each row as
// one line naming its column headers. These tables are invented; every figure in them is made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

const FLAT = [
  'Rent for the halls is as follows:',
  'Hire Period |\nNorth & South Halls |\nAll other Halls |',
  'Week 1 – 2 |\n$7.25 per seat per day |\n$6.0 per seat per day |',
  'Week 3 – 5 |\n|\n$6.5 per seat per day |',
  'Week 6 – 9 |\n$8.0 per seat per day |\n$7 per seat per day |',
  '- Readymade halls come with chairs.',
].join('\n\n');

test('a table with a header row becomes the header line and one self-contained line per row', () => {
  const out = P.tableRows(FLAT);
  assert.equal(out, [
    'Rent for the halls is as follows:',
    'Hire Period | North & South Halls | All other Halls\n'
      + 'Week 1 – 2: North & South Halls $7.25 per seat per day; All other Halls $6.0 per seat per day\n'
      + 'Week 3 – 5: All other Halls $6.5 per seat per day\n'
      + 'Week 6 – 9: North & South Halls $8.0 per seat per day; All other Halls $7 per seat per day',
    '- Readymade halls come with chairs.',
  ].join('\n\n'));
});

test('an empty cell is left out, never filled from a neighbour', () => {
  const line = P.tableRows(FLAT).split('\n').find(l => l.startsWith('Week 3 – 5'));
  assert.equal(line, 'Week 3 – 5: All other Halls $6.5 per seat per day');
  assert.ok(!/North & South/.test(line));
});

test('every cell of the flat table is still in the output, copied exactly', () => {
  const out = P.tableRows(FLAT);
  for (const b of FLAT.split('\n\n')) for (const l of b.split('\n')) {
    const cell = l.replace(/\s*\|$/, '').trim();
    if (cell) assert.ok(out.includes(cell), 'missing: ' + cell);
  }
});

test('a table whose first row carries figures has no header row and is left exactly as it was', () => {
  const noHeader = [
    'Intro line.',
    'Week 1 – 2 |\n$7.25 per seat per day |\n$6.0 per seat per day |',
    'Week 3 – 5 |\n$6.75 per seat per day |\n$6.5 per seat per day |',
    'After.',
  ].join('\n\n');
  assert.equal(P.tableRows(noHeader), noHeader);
});

test('a header with an empty cell is not a header either', () => {
  const t = '|\nNorth Hall |\nSouth Hall |\n\nSeats |\n40 |\n60 |';
  assert.equal(P.tableRows(t), t);
});

test('rows with a different number of cells than the header (a spanning header cell) are left as they were', () => {
  const spanned = 'Kind of Fee |\nRate |\n\n1 |\nEntry fee |\n5% |\n\n2 |\nExit fee |\n2% |';
  assert.equal(P.tableRows(spanned), spanned);
});

test('a lone block of cell lines, and ordinary text, are untouched', () => {
  const t = 'Home |\nAbout us |\n\nA paragraph with a pipe | inside it.\n\n- a list item';
  assert.equal(P.tableRows(t), t);
  assert.equal(P.tableRows(''), '');
});

test('it is idempotent: its own output is never read as a table again', () => {
  const once = P.tableRows(FLAT);
  assert.equal(P.tableRows(once), once);
});

const site = (over = {}) => ({ id: 't', name: 'Test Hall Office', nameAm: 'የሙከራ አዳራሽ', host: 'example.gov.et', ...over });
const pack = { id: 'business', logPrefix: 'business',
  headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Copied, not restated.' };
const page = () => ({ url: 'https://example.gov.et/halls', path: '/halls', slug: 't-halls', siteId: 't',
  title: 'Halls', section: 'help', text: FLAT, lang: 'en' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tablerows-'));

test('writePack applies it only for a site that sets tableRows', () => {
  const on = tmp(), off = tmp();
  P.writePack(on, [page()], site({ tableRows: true }), { today: '2026-09-22', pack });
  P.writePack(off, [page()], site(), { today: '2026-09-22', pack });
  const a = fs.readFileSync(path.join(on, 't-halls.md'), 'utf8');
  const b = fs.readFileSync(path.join(off, 't-halls.md'), 'utf8');
  assert.ok(a.includes('Week 1 – 2: North & South Halls $7.25 per seat per day; All other Halls $6.0 per seat per day'));
  assert.ok(b.includes('Week 1 – 2 |\n$7.25 per seat per day |'), 'a site without the option is written as before');
});

test('the next fetch of the same page reads as unchanged, and --rerender of a flat document rewrites it once', () => {
  const dir = tmp();
  const s = site({ tableRows: true });
  P.writePack(dir, [page()], s, { today: '2026-09-22', pack });
  const first = fs.readFileSync(path.join(dir, 't-halls.md'), 'utf8');
  const r = P.writePack(dir, [page()], s, { today: '2026-09-29', pack });
  assert.deepEqual(r.unchanged, ['t-halls'], 'the table is hashed as written, so the same page is not a change');
  assert.deepEqual(r.changed, []);

  const old = tmp();
  P.writePack(old, [page()], site(), { today: '2026-09-22', pack });
  const rr = P.rerenderPack(old, { pack, sites: [s] });
  assert.deepEqual(rr.rerendered, ['t-halls']);
  const again = fs.readFileSync(path.join(old, 't-halls.md'), 'utf8');
  assert.equal(P.bodyText(again), P.bodyText(first), 'the rerender writes what a fetch would');
  assert.equal(P.readMeta(again).contentHash, P.contentHash(FLAT), 'the hash is still the hash of the page as published');
  assert.equal(P.readMeta(first).contentHash, P.contentHash(FLAT));
  assert.deepEqual(P.rerenderPack(old, { pack, sites: [s] }).rerendered, [], 'and a second rerender has nothing to do');
  assert.equal(P.readMeta(fs.readFileSync(path.join(old, 't-halls.md'), 'utf8')).contentHash, P.contentHash(FLAT));
});

test('the Amharic sidecar entry stamped with the page hash still applies after the rows are rewritten', () => {
  const amPack = { ...pack, amHeaders: true };
  const am = { 't-halls': { titleAm: 'የአዳራሽ ኪራይ', contentHash: P.contentHash(FLAT) } };
  const dir = tmp();
  P.writePack(dir, [page()], site(), { today: '2026-09-22', pack: amPack, amHeaders: am });
  assert.ok(fs.readFileSync(path.join(dir, 't-halls.md'), 'utf8').includes('የአዳራሽ ኪራይ'));
  const rr = P.rerenderPack(dir, { pack: amPack, sites: [site({ tableRows: true })] }, { amHeaders: am });
  assert.deepEqual(rr.rerendered, ['t-halls']);
  const md = fs.readFileSync(path.join(dir, 't-halls.md'), 'utf8');
  assert.ok(md.includes('Week 6 – 9: North & South Halls $8.0 per seat per day'));
  assert.ok(md.includes('የአዳራሽ ኪራይ'), 'the Amharic title is kept');
  assert.equal(P.renderDoc(page(), site({ tableRows: true }), { today: '2026-09-22', pack: amPack, amHeaders: am }).includes('የአዳራሽ ኪራይ'), true);
});
