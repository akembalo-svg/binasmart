'use strict';
// workspaces/verify.js — what a document claims, and what the checker does with it. No database, no network:
// the knowledge library is a stub, so these tests pin the RULES, not today's corpus.
const test = require('node:test');
const assert = require('node:assert');
const { makeVerifier, claims } = require('../workspaces/verify');

const lib = hits => ({ search: async () => hits });
const at = (r, kind) => r.findings.filter(f => f.kind === kind);

test('claims: laws, fees, offices, dates, links', () => {
  const c = claims('በአዋጅ ቁጥር 980/2016 እና Regulation No. 392/2016 መሠረት። ክፍያ ብር 1,500። 13,000 birr. ንግድ ሚኒስቴር። 2027 ዓ.ም. https://etrade.gov.et 0900000042');
  assert.deepStrictEqual(c.laws.map(l => l.key), ['proclamation 980/2016', 'regulation 392/2016']);
  assert.deepStrictEqual(c.fees.map(f => f.value), [1500, 13000]);
  assert.ok(c.offices.includes('Ministry of Trade and Regional Integration'));
  assert.deepStrictEqual(c.ecYears, [2027]);
  assert.deepStrictEqual(c.phones, ['0900000042']);
  assert.deepStrictEqual(c.urls, ['https://etrade.gov.et']);
});

test('a law our library says was repealed is a warning, with the passage shown', async () => {
  const v = makeVerifier({ knowledge: lib([{ title: 'Building permit', url: 'https://justice.gov.et/x',
    text: 'Proclamation No. 624/2009 is repealed by the Ethiopian Building Proclamation No. 1356/2024.' }]) });
  const r = await v.check('Issued under Proclamation No. 624/2009 by the Addis Ababa City Administration. Fee 1,500 birr.');
  const law = at(r, 'law')[0];
  assert.strictEqual(law.status, 'warning');
  assert.match(law.source.passage, /1356\/2024/);
  assert.strictEqual(r.verdict, 'contradicts an official source');
});

test('a law that is cited in the library is ok; one that is absent is unknown, never a failure', async () => {
  const ok = makeVerifier({ knowledge: lib([{ title: 'Trade licensing', url: null, text: 'Proclamation No. 980/2016 governs commercial registration.' }]) });
  assert.strictEqual((await ok.check('Issued under Proclamation No. 980/2016 by the Ministry of Trade.')).findings[0].status, 'ok');
  const none = makeVerifier({ knowledge: lib([]) });
  const f = (await none.check('Issued under Proclamation No. 686/2010 by the Ministry of Trade.')).findings[0];
  assert.strictEqual(f.status, 'unknown');
  assert.match(f.note, /ask the issuing office/i);
});

test('dates: a future Gregorian year and an impossible Ethiopian year are warnings', async () => {
  const v = makeVerifier({ knowledge: lib([]), now: () => Date.parse('2026-09-17T00:00:00Z') });
  const r = await v.check('Certificate issued by the Ministry of Justice. Date 2031. እንዲሁም 2030 ዓ.ም.');
  const dates = at(r, 'date');
  assert.ok(dates.some(d => d.claim === '2031' && d.status === 'warning'));
  assert.ok(dates.some(d => /ዓ\.ም/.test(d.claim) && d.status === 'warning'));
});

test('links: a .gov.et address passes, a lookalike does not', async () => {
  const v = makeVerifier({ knowledge: lib([]) });
  const r = await v.check('Ministry of Revenue notice. See https://mor.gov.et/page and https://etrade-gov.et/login for details.');
  const links = at(r, 'link');
  assert.strictEqual(links.find(l => l.claim === 'mor.gov.et').status, 'ok');
  assert.strictEqual(links.find(l => l.claim === 'etrade-gov.et').status, 'unknown');
});

test('no recognised office is reported, and the disclaimer is always attached', async () => {
  const v = makeVerifier({ knowledge: lib([]) });
  const r = await v.check('This letter carries no office name at all, only some words and a figure of 250 birr.');
  assert.strictEqual(at(r, 'office')[0].status, 'unknown');
  assert.match(r.disclaimer, /not proof that a document is genuine/i);
  assert.strictEqual(r.verdict, 'nothing could be confirmed');
});

test('a document too short to check is refused', async () => {
  const v = makeVerifier({ knowledge: lib([]) });
  await assert.rejects(v.check('short'), /not enough text/);
});

test('sector coverage: offices across the library, document type and reference-number shapes', () => {
  const c = claims('የንግድ ሥራ ፈቃድ · TIN 0012345678 · ፋይዳ 123456789012 · ንግድ ሚኒስቴር · Ethiopian Food and Drug Authority · NEBE');
  assert.ok(c.types.includes('business licence'));
  assert.ok(c.offices.includes('Ministry of Trade and Regional Integration'));
  assert.ok(c.offices.includes('Ethiopian Food and Drug Authority'));
  assert.ok(c.offices.includes('National Election Board of Ethiopia'));
  assert.deepStrictEqual(c.ids.map(i => [i.name, i.ok]), [['TIN', true], ['Fayda number', true]]);
});

test('a reference number of the wrong length is a warning, not a verdict', async () => {
  const v = makeVerifier({ knowledge: { search: async () => [] } });
  const r = await v.check('Business licence issued by the Ministry of Trade and Regional Integration. TIN 12345 only.');
  const n = r.findings.find(f => f.kind === 'number');
  assert.strictEqual(n.status, 'warning');
  assert.match(n.note, /length/i);
});

test('photo support: only real image bytes are accepted', async () => {
  const { looksLikeImage, ocrImage } = require('../workspaces/verify');
  assert.ok(looksLikeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])));   // png
  assert.ok(looksLikeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])));   // jpeg
  assert.ok(!looksLikeImage(Buffer.from('%PDF-1.7 not an image')));
  await assert.rejects(ocrImage(Buffer.from('%PDF-1.7 not an image')), /not a PNG, JPEG or WebP/);
});
