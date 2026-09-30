'use strict';
// chunkDoc's lineSafe option (on for every knowledge-index source, lineSafeFor): the carried-over context and the cut of an oversized paragraph
// never leave a chunk opening mid-line. All text below is invented.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chunkDoc, LINE_SAFE_OPT_OUT, lineSafeFor, readSources, PACK_SOURCES } = require('../knowledge/index');

// chunkDoc exactly as it was before the option existed (HEAD 842c190), to prove the default path did not move.
function oldChunkDoc(text, title) {
  const CHUNK = 900, OVERLAP = 120;
  const lines = String(text).replace(/\r/g, '').split('\n');
  const sections = []; let cur = { heading: '', body: [] };
  for (const l of lines) {
    const h = /^(#{1,3})\s+(.+)/.exec(l);
    if (h) { if (cur.body.join('\n').trim()) sections.push(cur); cur = { heading: h[2].trim(), body: [] }; }
    else cur.body.push(l);
  }
  if (cur.body.join('\n').trim()) sections.push(cur);
  const out = [];
  for (const sec of sections) {
    const paras = sec.body.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => { if (buf.trim().length > 40) out.push({ heading: sec.heading, text: buf.trim() }); };
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > CHUNK && buf) {
        flush();
        buf = buf.slice(-OVERLAP).replace(/^\S*\s/, '') + '\n\n' + p;
      } else buf = buf ? buf + '\n\n' + p : p;
      while (buf.length > CHUNK * 1.6) { out.push({ heading: sec.heading, text: buf.slice(0, CHUNK).trim() }); buf = buf.slice(CHUNK - OVERLAP); }
    }
    flush();
  }
  return out.map((c, i) => ({ ord: i, heading: c.heading, text: (title ? title + (c.heading ? ' › ' + c.heading : '') + '\n' : '') + c.text }));
}

const TITLE = 'Sample Parks FAQ';
// A lease table, one self-contained line per period, right at the end of a paragraph: the shape that broke.
const rows = [
  'Term 1 – 3: Northgate & Riverside Estates $1.25 per m2 per month; All other Estates $0.90 per m2 per month',
  'Term 4 – 6: Northgate & Riverside Estates $1.50 per m2 per month; All other Estates $1.10 per m2 per month',
  'Term 7 – 9: Northgate & Riverside Estates $1.75 per m2 per month; All other Estates $1.30 per m2 per month',
  'Term 10 – 12: Northgate & Riverside Estates $2.05 per m2 per month; All other Estates $1.45 per m2 per month',
];
const intro = 'What does a finished unit cost to lease in one of the sample estates, and how does the price change over a long lease? '.repeat(4).trim();
const tableDoc = '# Leasing\n\n' + intro + '\n\n' + rows.join('\n') + '\n\n- Serviced plots\n\n'
  + 'Plot holders pay a one-off fee per square metre and build their own units; roads and utilities are already in place on every plot. '.repeat(3).trim();
// One long paragraph of many short lines, long enough to force the oversized-paragraph cut.
const longLines = Array.from({ length: 60 }, (_, i) => 'Line ' + (i + 1) + ': sample estate ' + String.fromCharCode(65 + (i % 26)) + ' charges ' + (i + 10) + ' units per plot');
const longDoc = '# Register\n\n' + longLines.join('\n');
// One single line far longer than a chunk.
const oneLine = '# Notes\n\n' + 'word '.repeat(700).trim();

const body = c => c.text.split('\n').slice(1).join('\n');          // drop the "Title › Heading" line
const firstLine = c => body(c).split('\n')[0];
const srcLines = doc => new Set(doc.split('\n').map(l => l.trim()).filter(Boolean));

test('every knowledge-index source is line-safe except travel, which fell below its retrieval floor on the switch', () => {
  assert.deepEqual([...LINE_SAFE_OPT_OUT], ['travel']);
  assert.equal(lineSafeFor('travel'), false);
  const sources = [...PACK_SOURCES.map(([s]) => s), 'news', 'web', 'page', 'guide', 'addis', 'llms', 'skill', 'docs', 'style'].filter(s => s !== 'travel');
  for (const s of sources) assert.equal(lineSafeFor(s), true, s);
});

test('the ingest chunks with lineSafeFor(source); workspaces keep the old chunker', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'index.js'), 'latin1');
  assert.match(idx, /chunkDoc\(d\.text, d\.title, \{ lineSafe: lineSafeFor\(d\.source\) \}\)/);
  // private client documents: no lineSafe option, so the default path below (byte-identical to the old chunker)
  const ws = fs.readFileSync(path.join(__dirname, '..', 'workspaces', 'index.js'), 'utf8');
  const calls = ws.match(/chunkDoc\([^)]*\)/g) || [];
  assert.ok(calls.length >= 1, 'workspaces chunks documents');
  for (const c of calls) assert.doesNotMatch(c, /lineSafe/, c);
});

test('the old carry-over starts a chunk with a fragment of the last table row (the bug this fixes)', () => {
  const cs = oldChunkDoc(tableDoc, TITLE);
  assert.ok(cs.some(c => !srcLines(tableDoc).has(firstLine(c).trim())), 'old chunker opens a chunk mid-line');
});

test('lineSafe: no chunk opens mid-line and every table row survives whole', () => {
  for (const doc of [tableDoc, longDoc]) {
    const cs = chunkDoc(doc, TITLE, { lineSafe: true });
    assert.ok(cs.length >= 2, 'the sample spans chunks');
    const lines = srcLines(doc);
    for (const c of cs) {
      assert.ok(lines.has(firstLine(c).trim()), 'chunk opens on a whole line: ' + JSON.stringify(firstLine(c).slice(0, 60)));
      for (const l of body(c).split('\n').map(x => x.trim()).filter(Boolean)) assert.ok(lines.has(l), 'no partial line inside: ' + l.slice(0, 60));
      assert.ok(body(c).length <= 900 * 1.6, 'bounded');
    }
  }
  const cs = chunkDoc(tableDoc, TITLE, { lineSafe: true });
  for (const r of rows) assert.ok(cs.some(c => body(c).split('\n').includes(r)), 'row kept whole: ' + r.slice(0, 20));
  // no chunk mentions a price without the period it belongs to
  for (const c of cs) for (const l of body(c).split('\n')) if (/Northgate/.test(l)) assert.match(l, /^Term \d+ – \d+:/);
});

test('lineSafe: an oversized paragraph is cut at line breaks, pieces within CHUNK, all lines covered', () => {
  const cs = chunkDoc(longDoc, TITLE, { lineSafe: true });
  assert.ok(cs.length >= 3);
  for (const c of cs.slice(0, -1)) assert.ok(body(c).length <= 900);
  const seen = new Set(cs.flatMap(c => body(c).split('\n')));
  for (const l of longLines) assert.ok(seen.has(l), 'covered: ' + l);
});

test('lineSafe: one very long line is cut at spaces, never mid-word, and carries nothing', () => {
  const cs = chunkDoc(oneLine, TITLE, { lineSafe: true });
  assert.ok(cs.length >= 2);
  for (const c of cs) { assert.ok(body(c).length <= 900 * 1.6); assert.match(body(c), /^word( word)*$/); }
  for (const c of cs.slice(0, -1)) assert.ok(body(c).length <= 900);
  assert.equal(cs.reduce((n, c) => n + body(c).split(' ').length, 0), 700, 'every word exactly once: no carry-over');
});

// The default path is what workspaces/index.js uses for private client documents.
test('default path and lineSafe:false are byte-identical to the old chunker', () => {
  const samples = [tableDoc, longDoc, oneLine,
    '# Addis\n\nintro para that is long enough to count as a chunk of text for the index.\n\n## Bole\n\n' + 'Bole is the airport district. '.repeat(60) + '\n\n## Piassa\n\nOld town.',
    'no heading at all, one short paragraph that is still longer than forty characters',
    'ሰላም። '.repeat(500)];
  // real documents too: every business and law document in this repo
  const docs = readSources(path.join(__dirname, '..'), ['business', 'law']);
  for (const d of docs) samples.push([d.text, d.title]);
  let n = 0;
  for (const s of samples) {
    const [t, title] = Array.isArray(s) ? s : [s, TITLE];
    const want = JSON.stringify(oldChunkDoc(t, title));
    assert.equal(JSON.stringify(chunkDoc(t, title)), want);
    assert.equal(JSON.stringify(chunkDoc(t, title, { lineSafe: false })), want);
    assert.equal(JSON.stringify(chunkDoc(t, title, {})), want);
    n++;
  }
  assert.ok(n > 100, 'compared ' + n + ' documents');
});
