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

test('a table with a header row becomes its lead-in, the header line and one self-contained line per row', () => {
  const out = P.tableRows(FLAT);
  assert.equal(out, [
    'Rent for the halls is as follows:\nTable: Hire Period by North & South Halls, All other Halls\n'
      + 'Hire Period | North & South Halls | All other Halls\n'
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

// ---------- the lead-in ----------
// The chunk that holds a table must say what the table is about. The lead-in is the nearest lines above the table,
// copied verbatim, and "Table: <header> by <headers>", the header cells copied exactly: nothing else.
const TABLE_ONLY = FLAT.split('\n\n').slice(1, 5);   // the four blocks of the hall table
const INTRO = 'There are 2 kinds of hall hire; seated halls and open halls.';
const START = '- Seated halls start at $6 per seat per day';
const LED = ['## Halls', 'An older line that is not the nearest.', INTRO, START, ...TABLE_ONLY, 'After the table.'].join('\n\n');
const HEAD_LINE = 'Table: Hire Period by North & South Halls, All other Halls';
const tableBlock = out => out.split('\n\n').find(b => b.includes('Hire Period | North & South Halls | All other Halls'));

test('lead-in: the two nearest lines above the table, copied verbatim, then the header template, in the table block', () => {
  const block = tableBlock(P.tableRows(LED)).split('\n');
  assert.deepEqual(block.slice(0, 4), [INTRO, START, HEAD_LINE, 'Hire Period | North & South Halls | All other Halls']);
  assert.equal(block.length, 4 + 3, 'lead-in, header and the three rows are one paragraph');
  assert.ok(P.tableRows(LED).startsWith('## Halls\n\nAn older line that is not the nearest.\n\n' + INTRO + '\n' + START + '\n' + HEAD_LINE + '\n'),
    'the page text above the lead-in is still there as it was');
});

// The lead-in lines are moved when they are whole blocks, so no sentence of the page is written twice: two copies
// of the introduction made the first one a chunk of its own, and that chunk took the table chunk's search place.
test('lead-in: lines that are whole blocks of their own are moved into the table block, and each page line is there once', () => {
  const out = P.tableRows(LED);
  for (const l of [INTRO, START, 'An older line that is not the nearest.'])
    assert.equal(out.split('\n').filter(x => x === l).length, 1, 'once: ' + l);
  assert.ok(!out.split('\n\n').includes(INTRO) && !out.split('\n\n').includes(START), 'no block of its own any more');
  assert.equal(P.tableRows(FLAT).split('\n').filter(x => x === 'Rent for the halls is as follows:').length, 1);
});

test('lead-in: lines copied from the tail of a longer paragraph are copied, and the paragraph is left whole', () => {
  const para = 'Halls are let by the day.\nThe office opens at eight.\n' + INTRO + '\n' + START;
  const out = P.tableRows([para, ...TABLE_ONLY].join('\n\n'));
  assert.ok(out.startsWith(para + '\n\n' + INTRO + '\n' + START + '\n' + HEAD_LINE + '\n'), 'the paragraph stays, its last two lines lead the table');
  assert.equal(P.tableRows(out), out, 'idempotent');
});

test('lead-in: a lead-in that walks across one whole block and the tail of another moves only the whole one', () => {
  const para = 'Halls are let by the day.\n' + INTRO;
  const out = P.tableRows([para, START, ...TABLE_ONLY].join('\n\n'));
  assert.equal(out.split('\n\n')[0], para, 'the partly copied paragraph is left whole');
  assert.equal(out.split('\n\n')[1].split('\n').slice(0, 3).join('\n'), INTRO + '\n' + START + '\n' + HEAD_LINE);
  assert.equal(out.split('\n').filter(x => x === START).length, 1);
  assert.equal(P.tableRows(out), out, 'idempotent');
});

test('lead-in: a document written with the copied lead-in (7cfb40b) is rewritten with it moved, and then stays', () => {
  const old = P.tableRows(LED).replace(INTRO + '\n' + START + '\n' + HEAD_LINE, INTRO + '\n\n' + START + '\n\n' + INTRO + '\n' + START + '\n' + HEAD_LINE);
  assert.equal(old.split('\n').filter(x => x === INTRO).length, 2, 'the old layout wrote it twice');
  assert.equal(P.tableRows(old), P.tableRows(LED));
  assert.equal(P.tableRows(P.tableRows(old)), P.tableRows(LED));
});

test('lead-in: built only from page lines and header cells; every digit in it is in the lines it was copied from', () => {
  const block = tableBlock(P.tableRows(LED)).split('\n');
  const lead = block.slice(0, block.indexOf('Hire Period | North & South Halls | All other Halls'));
  const sourceLines = LED.split('\n').map(l => l.trim());
  const head = ['Hire Period', 'North & South Halls', 'All other Halls'];
  for (const l of lead) {
    if (l.startsWith('Table: ')) assert.equal(l, 'Table: ' + head[0] + ' by ' + head.slice(1).join(', '));
    else assert.ok(sourceLines.includes(l), 'not a line of the page: ' + l);
  }
  const copied = lead.filter(l => !l.startsWith('Table: ')).join('\n');
  for (const d of lead.join('\n').match(/[0-9]+(?:[.,][0-9]+)*/g) || []) assert.ok(copied.includes(d), 'digit run not on the page: ' + d);
  assert.ok(!/[0-9]/.test(HEAD_LINE), 'the template line adds no figure');
});

test('lead-in: a heading ends the walk back, and a table with no text above it gets only the header template', () => {
  const afterHeading = ['## Halls', ...TABLE_ONLY].join('\n\n');
  assert.deepEqual(tableBlock(P.tableRows(afterHeading)).split('\n').slice(0, 2), [HEAD_LINE, 'Hire Period | North & South Halls | All other Halls']);
  const atStart = TABLE_ONLY.join('\n\n');
  assert.deepEqual(P.tableRows(atStart).split('\n').slice(0, 2), [HEAD_LINE, 'Hire Period | North & South Halls | All other Halls']);
  const long = ['x'.repeat(400), ...TABLE_ONLY].join('\n\n');
  assert.equal(tableBlock(P.tableRows(long)).split('\n')[0], HEAD_LINE, 'a line too long for the lead-in is not copied');
});

test('lead-in: it never reaches back into an earlier table', () => {
  const two = [...TABLE_ONLY, 'The second table:', ...TABLE_ONLY].join('\n\n');
  const blocks = P.tableRows(two).split('\n\n');
  assert.equal(blocks.length, 2, 'the line between the tables is moved into the second table block');
  assert.deepEqual(blocks[1].split('\n').slice(0, 3), ['The second table:', HEAD_LINE, 'Hire Period | North & South Halls | All other Halls'],
    'one line copied, then the walk stops at the earlier table');
});

test('lead-in: idempotent, and the one-row-per-line form without a lead-in gets it on the next run', () => {
  for (const t of [FLAT, LED, TABLE_ONLY.join('\n\n')]) {
    const once = P.tableRows(t);
    assert.equal(P.tableRows(once), once);
    assert.equal(P.tableRows(P.tableRows(once)), once);
  }
  const once = P.tableRows(LED);
  // The 842c190 layout: the page lines above the table as they were, and the rows with no lead-in.
  const withoutLead = once.split('\n\n').map(b => b.includes(HEAD_LINE) ? INTRO + '\n\n' + START + '\n\n' + b.split('\n').slice(3).join('\n') : b).join('\n\n');
  assert.ok(!withoutLead.includes(HEAD_LINE));
  assert.equal(P.tableRows(withoutLead), once, 'the earlier layout (842c190) is upgraded, not left or doubled');
});

test('lead-in: a block with other lines above its header is not taken for a table', () => {
  const once = tableBlock(P.tableRows(LED));
  const odd = 'Something else.\n\n' + 'A different line.\n' + once.split('\n').slice(3).join('\n');
  assert.equal(P.tableRows(odd), odd);
});

test('lead-in: tables tableRows leaves alone get none', () => {
  const noHeader = ['Intro line.', 'Week 1 – 2 |\n$7.25 per seat per day |\n$6.0 per seat per day |',
    'Week 3 – 5 |\n$6.75 per seat per day |\n$6.5 per seat per day |'].join('\n\n');
  const spanned = 'Intro line.\n\nKind of Fee |\nRate |\n\n1 |\nEntry fee |\n5% |\n\n2 |\nExit fee |\n2% |';
  for (const t of [noHeader, spanned, 'Intro.\n\nHome |\nAbout us |']) {
    assert.equal(P.tableRows(t), t);
    assert.ok(!P.tableRows(t).includes('Table: '));
  }
});

test('lead-in: a short section, introduction then table, is one chunk for the table and none for the introduction alone', () => {
  const { chunkDoc } = require(path.join(__dirname, '..', '..', 'knowledge', 'index.js'));
  const header = 'Source: an invented header paragraph about where this page came from. '.repeat(11).trim();
  const doc = header + '\n\n' + P.tableRows([INTRO, START, ...TABLE_ONLY].join('\n\n'));
  const chunks = chunkDoc(doc, 'Test Hall Office — Halls', { lineSafe: true });
  const holder = chunks.filter(c => c.text.includes('Hire Period | North & South Halls'));
  assert.equal(holder.length, 1);
  assert.ok(holder[0].text.includes(INTRO) && holder[0].text.includes(START));
  assert.equal(chunks.filter(c => c.text.includes(START) && !c.text.includes('Hire Period |')).length, 0,
    'no chunk holds the introduction without the table');
});

test('lead-in: the line-safe chunker keeps the lead-in and every row in one chunk', () => {
  const { chunkDoc } = require(path.join(__dirname, '..', '..', 'knowledge', 'index.js'));
  const filler = Array.from({ length: 6 }, (_, i) => 'Filler paragraph ' + 'about hall bookings and opening hours. '.repeat(5) + i);
  const doc = P.tableRows([...filler, INTRO, START, ...TABLE_ONLY, ...filler].join('\n\n'));
  const chunks = chunkDoc(doc, 'Test Hall Office — Halls', { lineSafe: true });
  const holder = chunks.filter(c => c.text.includes('Hire Period | North & South Halls'));
  assert.equal(holder.length, 1);
  for (const l of [INTRO, START, HEAD_LINE, 'Week 1 – 2: North & South Halls $7.25', 'Week 6 – 9: North & South Halls $8.0'])
    assert.ok(holder[0].text.includes(l), 'missing from the table chunk: ' + l);
});

// Two shapes the header guess reads wrongly, found by the 2026-09-23 survey of the banking and travel packs. Both
// pass isTableHead (every first-row cell filled, no digit), so tableRows takes a data row or a label for a header:
//   - a label/value list laid out as two columns (Ethiopian Airlines' worldwide contacts), and
//   - parallel columns with no row-label column (Dashen's Import | Export requirement lists), where the first
//     column's item becomes the "label" of the second column's item.
// The sites whose pages have these shapes keep tableRows off; these tests pin both why and that. Invented data.
test('a label/value list is taken for a table, which is why a site with such lists keeps tableRows off', () => {
  const KV = 'Company: |\nAcme Travel Ltd. |\n\nPhone: |\n+999 555 0100 |';
  assert.equal(P.tableRows(KV).split('\n').pop(), 'Phone:: Acme Travel Ltd. +999 555 0100');
});

test('parallel columns without a row-label column pair each item with the wrong label', () => {
  const PAR = 'Import |\nExport |\n\nSigned import form |\nSigned sales contract |';
  assert.equal(P.tableRows(PAR).split('\n').pop(), 'Signed import form: Export Signed sales contract');
});

test('tableRows stays off for the sites whose tables have those shapes', () => {
  const regOf = pk => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', pk, 'sources.json'), 'utf8'));
  const siteOf = (pk, id) => regOf(pk).sites.find(s => s.id === id);
  for (const [pk, id] of [['banking', 'dashen'], ['banking', 'ethiotelecom'], ['travel', 'ethiopian-airlines']]) {
    assert.ok(siteOf(pk, id), pk + '/' + id + ' exists');
    assert.ok(!siteOf(pk, id).tableRows, pk + '/' + id + ' must not set tableRows until the header guess handles its tables');
  }
});
