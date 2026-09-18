'use strict';
// Personal mobile numbers are masked on the way INTO the index, not only in the files.
// Commit 4020770 masked the mols/eic documents on disk, but the live KnowledgeChunk rows were built from the
// unmasked files and nobody re-ingested: for half a day Bini, /api/knowledge/search and the MCP server served
// 1,208 real mobiles. These tests pin the two guards that make that impossible whatever order files are edited
// and ingested in: readSources masks every document of a `maskPhones` site before it is chunked, and every
// ingest ends with a count of full mobiles left in those sites' chunks.
// The numbers below are invented and assembled from parts so no full number sits in the repository as text.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeKnowledge, readSources, maskedSites, maskViolations } = require('../knowledge/index');

const MOB_A = '+251 9' + '11 000 001';        // international, spaced
const MOB_B = '2517' + '00000002';           // international, Safaricom
const MOB_C = '09' + '11000003';             // local form
const OFFICE = '+251 11 551 0033';          // a landline: never masked, never a violation
const MASKED_A = '251•••••0001';

function fakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-ingest-'));
  const dir = path.join(root, 'knowledge', 'business');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ pack: { id: 'business' }, sites: [
    { id: 'mols', maskPhones: true, fetch: 'dir', host: 'mols.example' },
    { id: 'molsx', fetch: 'dir', host: 'molsx.example' },            // longer prefix, not flagged: must win for its own slugs
    { id: 'motri', fetch: 'dir', host: 'motri.example' },
  ] }));
  const doc = (title, body) => '---\ntitle: "' + title + '"\nurl: "https://example.org/x"\nlang: "en"\n---\n' + body + '\n';
  fs.writeFileSync(path.join(dir, 'mols-agencies.md'), doc('Agencies', 'Manager mobile ' + MOB_A + ' and ' + MOB_B + '. Office ' + OFFICE + '.'));
  fs.writeFileSync(path.join(dir, 'mols-done.md'), doc('Already masked', 'Manager mobile ' + MASKED_A + '. Office ' + OFFICE + '.'));
  fs.writeFileSync(path.join(dir, 'molsx-page.md'), doc('Other site', 'Call ' + MOB_A + ' now.'));
  fs.writeFileSync(path.join(dir, 'motri-page.md'), doc('Trade', 'Hotline ' + MOB_B + '.'));
  return root;
}

function store() {
  const rows = []; let seq = 0;
  const match = (r, where) => !where || Object.keys(where).every(k => { const w = where[k];
    if (w && typeof w === 'object' && 'notIn' in w) return !w.notIn.includes(r[k]);
    if (w && typeof w === 'object' && 'in' in w) return w.in.includes(r[k]);
    return r[k] === w; });
  const prisma = { knowledgeChunk: {
    findMany: async ({ where } = {}) => rows.filter(r => match(r, where)).map(r => ({ ...r })),
    create: async ({ data }) => { const r = { id: 'c' + (++seq), embedding: null, ...data }; rows.push(r); return { ...r }; },
    deleteMany: async ({ where }) => { const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i];
        const byId = where.id && where.id.in ? where.id.in.includes(r.id) : false;
        const byHash = where.hash && where.hash.notIn ? (r.source === where.source && r.slug === where.slug && !where.hash.notIn.includes(r.hash)) : false;
        if (byId || byHash) rows.splice(i, 1); }
      return { count: before - rows.length }; },
  } };
  return { rows, prisma };
}
const quiet = () => {};

test('maskedSites maps a pack to its sites and which of them mask', () => {
  const m = maskedSites(fakeRoot());
  assert.deepEqual([...m.keys()], ['business']);
  const mols = m.get('business').find(s => s.site === 'mols');
  assert.equal(mols.prefix, 'mols-'); assert.equal(mols.mask, true);
  assert.equal(m.get('business').find(s => s.site === 'motri').mask, false);
});

test('a maskPhones site is masked before chunking; other sites and landlines are untouched', () => {
  const docs = readSources(fakeRoot(), ['business']);
  const by = s => docs.find(d => d.slug === s).text;
  assert.ok(!by('mols-agencies').includes(MOB_A) && !by('mols-agencies').includes(MOB_B));
  assert.ok(by('mols-agencies').includes(MASKED_A));
  assert.ok(by('mols-agencies').includes(OFFICE));
  assert.ok(by('molsx-page').includes(MOB_A), 'the longest site prefix owns the slug: molsx does not mask');
  assert.ok(by('motri-page').includes(MOB_B));
});

test('ingest writes only masked chunks for a flagged site, and an already-masked file is idempotent', async () => {
  const root = fakeRoot(); const s = store();
  const k = makeKnowledge({ prisma: s.prisma, apiKey: '', root, log: quiet, localFallback: false });
  const a = await k.ingest({ only: ['business'], embed: false });
  const mols = s.rows.filter(r => r.slug.startsWith('mols-'));
  assert.ok(mols.length >= 2);
  for (const r of mols) assert.ok(!/(?<![0-9])(?:\+?251[ -]?[79](?:[ -]?[0-9]){8})(?![0-9])/.test(r.text), 'no full mobile in a mols chunk');
  assert.deepEqual(a.maskViolations, []);
  // the masked file hashes exactly as its committed text does: a second run changes nothing
  const done = s.rows.filter(r => r.slug === 'mols-done').map(r => r.hash);
  const b = await k.ingest({ only: ['business'], embed: false });
  assert.equal(b.inserted, 0); assert.equal(b.deleted, 0);
  assert.deepEqual(s.rows.filter(r => r.slug === 'mols-done').map(r => r.hash), done);
  assert.ok(s.rows.find(r => r.slug === 'mols-done').text.includes(MASKED_A));
});

test('maskViolations counts full mobiles only in chunks of flagged sites', () => {
  const m = maskedSites(fakeRoot());
  const rows = [
    { source: 'business', slug: 'mols-agencies', text: 'a ' + MOB_A + ' b ' + MOB_C },
    { source: 'business', slug: 'mols-done', text: 'fine ' + MASKED_A + ' ' + OFFICE },
    { source: 'business', slug: 'molsx-page', text: 'not flagged ' + MOB_A },
    { source: 'business', slug: 'motri-page', text: 'not flagged ' + MOB_B },
    { source: 'law', slug: 'mols-agencies', text: 'another source ' + MOB_A },
  ];
  assert.deepEqual(maskViolations(rows, m), [{ source: 'business', slug: 'mols-agencies', n: 2 }]);
  assert.deepEqual(maskViolations(rows.slice(1), m), []);
});

test('ingest reports a violation loudly when a flagged chunk holds a full number, and is quiet otherwise', async () => {
  const root = fakeRoot(); const s = store(); const said = [];
  const k = makeKnowledge({ prisma: s.prisma, apiKey: '', root, log: m => said.push(m), localFallback: false });
  await k.ingest({ only: ['business'], embed: false });
  assert.ok(!said.some(l => /MASK VIOLATION/.test(l)));
  const clean = await k.checkMasks();
  assert.deepEqual(clean.violations, []); assert.ok(clean.checked >= 2);
  // a chunk that got in some other way (an old index, a hand insert)
  await s.prisma.knowledgeChunk.create({ data: { source: 'business', slug: 'mols-legacy', hash: 'x', ord: 0, text: 'old ' + MOB_A + ' ' + MOB_C } });
  const bad = await k.checkMasks();
  assert.deepEqual(bad.violations, [{ source: 'business', slug: 'mols-legacy', n: 2 }]);
  said.length = 0;
  const r = await k.ingest({ only: ['law'], embed: false });   // the check runs whatever the scope of the ingest
  assert.deepEqual(r.maskViolations, [{ source: 'business', slug: 'mols-legacy', n: 2 }]);
  assert.ok(said.includes('[knowledge] MASK VIOLATION business:mols-legacy n=2'));
  assert.ok(!said.some(l => l.includes(MOB_A) || l.includes(MOB_C)), 'the log never carries the number itself');
});
