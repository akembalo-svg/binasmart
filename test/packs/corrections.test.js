'use strict';
// A pack document restates what an institution published, and sometimes what it published is out of date:
// the Investment Commission's FAQ still gives overtime "from 1.25x", and Bini believed it over the law. The
// page must stay as published and the weekly refetch would overwrite a hand edit, so the fix is a registry
// entry that renderDoc applies on every render: a labelled note directly after the outdated passage, a flag in
// the header, and every figure in the note checked against the law it cites.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));
const { noteFor } = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'freshness.js'));

const AUTH = 'Proclamation 1156/2019. Article 68(1): overtime at 1.5 between 6:00 a.m. and 10:00 p.m.; '
  + 'at 1.75 at night; at 2 on the weekly rest day; at 2.5 on public holidays. 68(2) paid with the wage.';
const PASSAGE = '- Overtime pay ranges from 1.25x hourly wage (on work days) to 2.5x hourly wage (on public holidays).';
const BEFORE = '# Frequently Asked Questions\n\n- Wage:\n\nNo minimum wage requirements.';
const AFTER = '- Working hours: The working hours is set at 48 hours per week;\n\n- Expatriates: may be employed.';
const TEXT = BEFORE + '\n\n' + PASSAGE + '\n\n' + AFTER;

const site = { id: 't', name: 'Test Commission', nameAm: 'የሙከራ ኮሚሽን', host: 'example.gov.et' };
const pack = { id: 'business', logPrefix: 'business',
  headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Copied, not restated.' };
const page = () => ({ url: 'https://example.gov.et/faqs', path: '/faqs', slug: 't-faqs', siteId: 't',
  title: 'FAQs', section: 'help', text: TEXT, lang: 'en' });
const corr = (over = {}) => ({ slug: 't-faqs', match: 'Overtime pay ranges from 1.25x hourly wage',
  noteEn: 'Overtime is at least 1.5 times the hourly wage from 6:00 a.m. to 10:00 p.m., 1.75 times at night, 2 times on the weekly rest day and 2.5 times on a public holiday (Art. 68(1)).',
  noteAm: 'የትርፍ ሰዓት ክፍያ ቢያንስ በቀን × 1.5፣ በሌሊት × 1.75፣ በሳምንት የዕረፍት ቀን × 2፣ በሕዝብ በዓል × 2.5 ነው።',
  authority: 'Labour Proclamation 1156/2019 Art. 68', authorityText: AUTH, checked: '2026-09-18', ...over });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'corr-'));

test('the note lands directly after the outdated passage, and the page text around it is untouched', () => {
  const md = P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [corr()] });
  const i = md.indexOf(PASSAGE);
  assert.ok(i > 0, 'the passage is still there, word for word');
  const after = md.slice(i + PASSAGE.length);
  assert.ok(after.startsWith('\n\n' + P.CORR_MARK + ' (checked 2026-09-18): Overtime is at least 1.5'), 'the note is the very next paragraph');
  assert.ok(/በአማርኛ፦ የትርፍ ሰዓት/.test(after.split('\n')[2]), 'the Amharic twin is in the same paragraph');
  assert.ok(after.split('\n')[2].endsWith('(Labour Proclamation 1156/2019 Art. 68)'), 'the note names its authority');
  assert.ok(md.includes(BEFORE) && md.includes(AFTER), 'what comes before and after is byte-identical');
  const head = md.slice(0, md.indexOf('Source: '));
  assert.ok(head.includes('BinaSmart has added a correction to this page'), 'the header carries a one-line flag');
  assert.ok(!/[0-9]/.test(head.split('\n\n').find(p => p.includes('BinaSmart has added a correction'))), 'the flag carries no figure');
  assert.equal(P.bodyText(md), TEXT, 'bodyText gives back the page as the institution published it');
  assert.equal(P.readMeta(md).contentHash, P.contentHash(TEXT), 'contentHash is the hash of the published page, not of our note');
});

test('a page with no correction renders exactly as before', () => {
  const a = P.renderDoc(page(), site, { today: '2026-09-17', pack });
  const b = P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [corr({ slug: 'another-page' })] });
  assert.equal(a, b);
  assert.ok(!a.includes('Correction by BinaSmart') && !a.includes('BinaSmart has added a correction'));
});

test('a refetch and a --rerender keep the note, once', () => {
  const dir = tmp();
  const c = [corr()];
  P.writePack(dir, [page()], site, { today: '2026-09-17', pack, corrections: c });
  const first = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  // The weekly refetch: the institution's page comes back unchanged.
  const r = P.writePack(dir, [page()], site, { today: '2026-09-24', pack, corrections: c });
  assert.deepEqual(r.unchanged, ['t-faqs']);
  const second = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  assert.equal(second.split(P.CORR_MARK).length - 1, 1, 'exactly one note after a refetch');
  assert.equal(second.replace(/^lastChecked: ".*"$/m, ''), first.replace(/^lastChecked: ".*"$/m, ''));
  // A re-render from the text already on disk.
  const rr = P.rerenderPack(dir, { pack, sites: [site], corrections: c });
  assert.deepEqual(rr.rerendered, [], 'nothing to re-render: the document is already what renderDoc writes');
  const third = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  assert.equal(third, second);
  assert.equal(third.split(P.CORR_MARK).length - 1, 1);
});

test('a document written before the correction existed gains it on --rerender, and only it', () => {
  const dir = tmp();
  P.writePack(dir, [page()], site, { today: '2026-09-17', pack });
  const plain = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  const rr = P.rerenderPack(dir, { pack, sites: [site], corrections: [corr()] });
  assert.deepEqual(rr.rerendered, ['t-faqs']);
  const fixed = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  assert.equal(P.bodyText(fixed), P.bodyText(plain));
  assert.equal(P.readMeta(fixed).contentHash, P.readMeta(plain).contentHash);
});

test('a note with a figure the authority does not print is refused', () => {
  const bad = corr({ noteEn: 'Overtime is at least 1.25 times the hourly wage on work days (Art. 68).' });
  assert.throws(() => P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [bad] }),
    /refused: 1\.25 not found in the authority/);
  const badAm = corr({ noteAm: 'የትርፍ ሰዓት ክፍያ × 3 ነው።' });
  assert.throws(() => P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [badAm] }), /refused: 3 not found/);
});

test('the authority is read from knowledge/law, and a missing or oddly named one is refused', () => {
  const noText = corr({ authorityText: undefined, authorityDoc: 'no-such-law-document' });
  assert.throws(() => P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [noText] }), /authority document not found/);
  const traversal = corr({ authorityText: undefined, authorityDoc: '../business/eic-faqs' });
  assert.throws(() => P.renderDoc(page(), site, { today: '2026-09-17', pack, corrections: [traversal] }), /authorityDoc must name/);
});

test('a passage that has left the page is logged, reported, and the document is still written without a note', () => {
  const dir = tmp();
  const changed = { ...page(), text: TEXT.replace(PASSAGE, '- Overtime is paid as the law requires.') };
  const logged = [];
  const orig = console.log;
  console.log = m => logged.push(String(m));
  let r;
  try { r = P.writePack(dir, [changed], site, { today: '2026-09-24', pack, corrections: [corr()] }); }
  finally { console.log = orig; }
  assert.deepEqual(r.added, ['t-faqs']);
  assert.deepEqual(r.uncorrected, ['t-faqs']);
  assert.ok(logged.includes('[business] correction no longer matches t-faqs'), logged.join(' | '));
  const md = fs.readFileSync(path.join(dir, 't-faqs.md'), 'utf8');
  assert.ok(!md.includes('Correction by BinaSmart') && !md.includes('BinaSmart has added a correction'));
  assert.equal(P.bodyText(md), changed.text);
});

test('the weekly note names a correction that no longer matches', () => {
  const rep = { name: 'Ethiopian Investment Commission', changed: ['eic-faqs'], added: [], gone: [], missed: [],
    revived: [], uncorrected: ['eic-faqs'], total: 60, titles: {} };
  const note = noteFor([rep], { today: '2026-09-27', pack: { id: 'business' } });
  assert.ok(note.includes('correction no longer matches eic-faqs'), note);
  const quiet = noteFor([{ ...rep, uncorrected: [] }], { today: '2026-09-27', pack: { id: 'business' } });
  assert.ok(!quiet.includes('correction no longer matches'));
});

test('every correction in a live registry grounds against its law and is rendered into its document', () => {
  for (const pk of ['business', 'banking', 'travel']) {
    const list = P.packCorrections(path.join(P.packDir(pk), 'sources.json'));
    for (const c of list) {
      const file = path.join(P.packDir(pk), c.slug + '.md');
      const md = fs.readFileSync(file, 'utf8');
      const r = P.applyCorrections(P.bodyText(md), c.slug, [c]);   // throws if a figure is not in the law
      assert.equal(r.applied.length, 1, pk + '/' + c.slug + ': the passage is no longer on the page');
      assert.ok(md.includes(P.correctionNote(c)), pk + '/' + c.slug + ': the document on disk does not carry the note - run --rerender');
    }
  }
});

test('match may be a regular expression written /like this/', () => {
  const md = P.renderDoc(page(), site, { today: '2026-09-17', pack,
    corrections: [corr({ match: '/Overtime pay ranges from [0-9.]+x/i' })] });
  assert.ok(md.includes(PASSAGE + '\n\n' + P.CORR_MARK));
});
