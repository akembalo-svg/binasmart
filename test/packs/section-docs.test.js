'use strict';
// A registry may name a section of a long page to be written as a document of its own (sectionDocs), because
// search keeps at most two chunks of one document and a long page's best answer can lose to its own neighbours.
// Every page, table and figure in this file is invented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

const BEFORE = [
  '# Questions',
  '1. How do I book a hall?',
  'Write to the hall office.',
  '2. How much do the halls cost? Rent?',
  'Halls are let to clubs only.',
];
const SECTION = [
  'There are 2 kinds of hall hire; seated halls and open halls.',
  '- Seated halls start at $6 per seat per day',
  'Hire Period |\nNorth & South Halls |\nAll other Halls |',
  'Week 1 – 2 |\n$7.25 per seat per day |\n$6.0 per seat per day |',
  'Week 3 – 5 |\n$8.0 per seat per day |\n$6.5 per seat per day |',
  '- Open halls',
  'Clubs pay a single fee of $.05 per seat.',
];
const AFTER = [
  '3. Can I bring food?',
  'Only in the open halls. Overtime staff are paid 1.1x.',
];
const PAGE = [...BEFORE, ...SECTION, ...AFTER].join('\n\n');
const SPEC = { doc: 't-halls', key: 'hall-hire', start: 'There are 2 kinds of hall hire',
  end: '/^[0-9]+\\.\\s*\\S.*\\?$/', title: 'Questions: hall hire (seated halls, open halls)' };

const site = (over = {}) => ({ id: 't', name: 'Test Hall Office', nameAm: 'የሙከራ አዳራሽ', host: 'example.gov.et',
  sectionDocs: [SPEC], ...over });
const pack = { id: 'business', logPrefix: 'business',
  headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Copied, not restated.' };
const page = (text = PAGE) => ({ url: 'https://example.gov.et/halls', path: '/halls', slug: 't-halls', siteId: 't',
  title: 'Questions | Test Hall Office', section: 'help', text, lang: 'en' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sectiondocs-'));
const read = (dir, slug) => fs.readFileSync(path.join(dir, slug + '.md'), 'utf8');
const paras = t => String(t).split('\n\n').map(p => p.trim()).filter(Boolean);

test('the section is moved whole into its own document and is not left on the page', () => {
  const dir = tmp();
  const r = P.writePack(dir, [page()], site(), { today: '2026-09-23', pack });
  assert.deepEqual(r.added.sort(), ['t-halls', 't-halls-hall-hire']);
  assert.deepEqual(r.split, ['t-halls-hall-hire']);
  const sec = P.bodyText(read(dir, 't-halls-hall-hire'));
  const rest = P.bodyText(read(dir, 't-halls'));
  assert.equal(sec, SECTION.join('\n\n'), 'the section, every paragraph of it, word for word');
  assert.equal(rest, [...BEFORE, ...AFTER].join('\n\n'), 'the page keeps everything else, word for word');
  for (const p of SECTION) assert.ok(!rest.includes(p), 'not duplicated on the page: ' + p);
  for (const p of paras(rest)) assert.ok(!sec.includes(p), 'not duplicated in the section: ' + p);
});

test('the section document has the page url, dates, the whole-page hash, sectionOf and a header naming its page', () => {
  const dir = tmp();
  P.writePack(dir, [page()], site(), { today: '2026-09-23', pack });
  const md = read(dir, 't-halls-hall-hire'), m = P.readMeta(md), pm = P.readMeta(read(dir, 't-halls'));
  assert.equal(m.url, 'https://example.gov.et/halls');
  assert.equal(m.title, 'Test Hall Office — Questions: hall hire (seated halls, open halls)');
  assert.equal(m.sectionOf, 't-halls');
  assert.equal(m.section, 'help');
  assert.equal(m.source_name, 'Test Hall Office');
  assert.equal(m.fetchedAt, '2026-09-23');
  assert.equal(m.contentHash, P.contentHash(PAGE), 'the hash of the page as published, whole');
  assert.equal(pm.contentHash, P.contentHash(PAGE));
  assert.equal(pm.sectionOf, undefined, 'the page itself is not a section');
  assert.ok(md.includes('This is one section of the page "Questions | Test Hall Office", kept as a document of its own'));
  assert.ok(md.includes('Source: https://example.gov.et/halls '));
  const head = md.slice(0, md.indexOf('Source: '));
  assert.ok(!/[0-9]/.test(head.replace(/^---[\s\S]*?---\n/, '')), 'the header holds no figure');
});

test('a second fetch of the same page is unchanged, and re-rendering twice changes nothing', () => {
  const dir = tmp();
  P.writePack(dir, [page()], site(), { today: '2026-09-23', pack });
  const a = read(dir, 't-halls'), b = read(dir, 't-halls-hall-hire');
  const r = P.writePack(dir, [page()], site(), { today: '2026-09-30', pack });
  assert.deepEqual(r.unchanged.sort(), ['t-halls', 't-halls-hall-hire']);
  assert.deepEqual([...r.changed, ...r.added, ...r.reformatted, ...r.gone], []);
  const reg = { pack, sites: [site()] };
  const rr = P.rerenderPack(dir, reg);
  assert.deepEqual([rr.rerendered, rr.split, rr.unsplit], [[], [], []]);
  assert.equal(P.bodyText(read(dir, 't-halls')), P.bodyText(a));
  assert.equal(P.bodyText(read(dir, 't-halls-hall-hire')), P.bodyText(b));
});

test('--rerender splits a page written before the registry named the section, exactly as a fetch would', () => {
  const fetched = tmp(), old = tmp();
  P.writePack(fetched, [page()], site(), { today: '2026-09-23', pack });
  P.writePack(old, [page()], site({ sectionDocs: undefined }), { today: '2026-09-23', pack });
  assert.ok(P.bodyText(read(old, 't-halls')).includes(SECTION[0]));
  const rr = P.rerenderPack(old, { pack, sites: [site()] });
  assert.deepEqual(rr.split, ['t-halls-hall-hire']);
  assert.deepEqual(rr.rerendered, ['t-halls', 't-halls-hall-hire']);
  for (const slug of ['t-halls', 't-halls-hall-hire']) assert.equal(read(old, slug), read(fetched, slug), slug);
  const again = P.rerenderPack(old, { pack, sites: [site()] });
  assert.deepEqual([again.rerendered, again.split, again.unsplit], [[], [], []], 'idempotent');
});

test('with tableRows the table in the section still gets its lead-in, from the section text', () => {
  const dir = tmp();
  P.writePack(dir, [page()], site({ tableRows: true }), { today: '2026-09-23', pack });
  const sec = P.bodyText(read(dir, 't-halls-hall-hire'));
  assert.ok(sec.includes(SECTION[0] + '\n' + SECTION[1] + '\nTable: Hire Period by North & South Halls, All other Halls\n'));
  assert.ok(sec.includes('Week 3 – 5: North & South Halls $8.0 per seat per day; All other Halls $6.5 per seat per day'));
  assert.equal(P.rerenderPack(dir, { pack, sites: [site({ tableRows: true })] }).rerendered.length, 0);
});

test('a section that is not on the page leaves the page exactly as it was, and is reported', () => {
  for (const spec of [{ ...SPEC, start: 'There are 9 kinds of hall hire' }, { ...SPEC, end: 'A question the page never asks' }]) {
    const plain = tmp(), dir = tmp();
    P.writePack(plain, [page()], site({ sectionDocs: undefined }), { today: '2026-09-23', pack });
    const r = P.writePack(dir, [page()], site({ sectionDocs: [spec] }), { today: '2026-09-23', pack });
    assert.deepEqual(r.unsplit, ['t-halls-hall-hire']);
    assert.deepEqual(r.split, []);
    assert.deepEqual(fs.readdirSync(dir), ['t-halls.md']);
    assert.equal(read(dir, 't-halls'), read(plain, 't-halls'), 'byte for byte');
    const rr = P.rerenderPack(dir, { pack, sites: [site({ sectionDocs: [spec] })] });
    assert.deepEqual(rr.unsplit, ['t-halls-hall-hire'], 'a re-render reports it too');
    assert.deepEqual(rr.rerendered, []);
  }
});

test('when the section leaves the page, its document is gone at once and the page holds what is there', () => {
  const dir = tmp();
  P.writePack(dir, [page()], site(), { today: '2026-09-23', pack });
  const edited = [...BEFORE, 'Hall hire is suspended.', ...AFTER].join('\n\n');
  const r = P.writePack(dir, [page(edited)], site(), { today: '2026-09-30', pack });
  assert.deepEqual(r.unsplit, ['t-halls-hall-hire']);
  assert.deepEqual(r.gone, ['t-halls-hall-hire']);
  assert.equal(P.readMeta(read(dir, 't-halls-hall-hire')).status, 'gone');
  assert.equal(P.bodyText(read(dir, 't-halls')), edited);
});

test('the title must be the page words and hold no figure', () => {
  assert.throws(() => P.splitSections([page()], site({ sectionDocs: [{ ...SPEC, title: 'Questions: hall hire discounts' }] })), /discounts/);
  assert.throws(() => P.splitSections([page()], site({ sectionDocs: [{ ...SPEC, title: 'Questions: 2 kinds of hall hire' }] })), /figure/);
  assert.throws(() => P.splitSections([page()], site({ sectionDocs: [{ ...SPEC, key: 'Hall Hire' }] })), /key/);
});

test('a correction for the page follows its passage into the section, and one outside the section stays', () => {
  const corr = (match, noteEn) => ({ slug: 't-halls', match, noteEn, noteAm: 'እርማት', authority: 'Test Act',
    authorityText: 'The fee is $.07 per seat and overtime is 1.5x.', checked: '2026-09-23' });
  const corrections = [corr('Clubs pay a single fee of $.05 per seat.', 'The fee is $.07 per seat.'),
    corr('Overtime staff are paid 1.1x.', 'Overtime is 1.5x.')];
  const dir = tmp();
  const r = P.writePack(dir, [page()], site(), { today: '2026-09-23', pack, corrections });
  assert.deepEqual(r.uncorrected, []);
  const sec = read(dir, 't-halls-hall-hire'), rest = read(dir, 't-halls');
  assert.ok(sec.includes('Clubs pay a single fee of $.05 per seat.\n\n' + P.CORR_MARK), 'the note is in the section');
  assert.ok(!sec.includes('Overtime is 1.5x.'));
  assert.ok(rest.includes('Overtime staff are paid 1.1x.\n\n' + P.CORR_MARK), 'the other note stays on the page');
  assert.ok(!rest.includes('The fee is $.07 per seat.'));
  const rr = P.rerenderPack(dir, { pack, sites: [site()], corrections });
  assert.deepEqual([rr.rerendered, rr.uncorrected], [[], []], 'a re-render keeps both notes where they are');
});

test('two sections of one page, one after the other, become two documents and the page keeps the rest', () => {
  const specs = [{ ...SPEC, key: 'seated-halls', end: '- Open halls', title: 'Questions: hall hire, seated halls' },
    { ...SPEC, key: 'open-halls', start: '- Open halls', title: 'Questions: hall hire, open halls' }];
  const dir = tmp();
  const r = P.writePack(dir, [page()], site({ sectionDocs: specs, tableRows: true }), { today: '2026-09-23', pack });
  assert.deepEqual(r.split, ['t-halls-seated-halls', 't-halls-open-halls']);
  const a = P.bodyText(read(dir, 't-halls-seated-halls')), b = P.bodyText(read(dir, 't-halls-open-halls'));
  assert.equal(b, SECTION.slice(5).join('\n\n'));
  assert.ok(a.startsWith(SECTION[0] + '\n\n' + SECTION[1] + '\n\n' + SECTION[0] + '\n'), 'the table keeps its lead-in');
  assert.ok(!a.includes('Open halls') && !b.includes('Week'));
  assert.equal(P.bodyText(read(dir, 't-halls')), [...BEFORE, ...AFTER].join('\n\n'));
  const rr = P.rerenderPack(dir, { pack, sites: [site({ sectionDocs: specs, tableRows: true })] });
  assert.deepEqual([rr.rerendered, rr.split, rr.unsplit], [[], [], []]);
});

test('a site that names no sectionDocs is passed through untouched', () => {
  const docs = [page()];
  const sp = P.splitSections(docs, site({ sectionDocs: undefined }));
  assert.equal(sp.docs, docs);
  assert.deepEqual([sp.split, sp.unmatched], [[], []]);
});
