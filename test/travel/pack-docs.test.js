'use strict';
// What ends up on disk under knowledge/travel/. The front matter is not decoration: knowledge/index.js reads
// title, url and lang out of it with a line-by-line regex, and Task 6 adds `status` to that. The hash is what
// the weekly freshness check compares, so it must ignore whitespace and nothing else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripPackBoilerplate, splitThin, MIN_CHARS, contentHash, frontMatter, renderDoc, readMeta, touchLastChecked, writePack, pageHeadings, PACK_FORMAT } =
  require('../../ops/travel/fetch-airline');

const SITE = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', lang: 'en' };
const MENU = 'Book a Flight Rail and Fly Flight Status Flight Schedules Charter Services';
const NOTICE = 'Please note that payment by bank cards issued in Russia is not available on the website.';
const pageOf = (slug, body) => ({ siteId: 'ethiopian-airlines', slug, path: '/et/x/' + slug,
  url: 'https://www.ethiopianairlines.com/et/x/' + slug, title: slug, section: 'baggage',
  sectionTitleAm: 'ሻንጣ', text: MENU + '\n\n' + body + '\n\n' + NOTICE });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'travelpack-'));
// What fetchSite reports for a page that did not become a document, and why. http_404 is the site saying
// the page is gone; a timeout is the site saying nothing at all, which is not the same thing.
const dead = (slug, why = 'http_404') => ({ url: 'https://www.ethiopianairlines.com/et/x/' + slug, why });

test('stripPackBoilerplate removes what every page repeats and keeps what only one page says', () => {
  const pages = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => pageOf(s, 'Only page ' + i + ' says this, at length, so it is content.'));
  const out = stripPackBoilerplate(pages);
  for (let i = 0; i < out.length; i++) {
    assert.ok(!out[i].text.includes(MENU), out[i].slug + ' kept the menu');
    assert.ok(!out[i].text.includes(NOTICE), out[i].slug + ' kept the site notice');
    assert.ok(out[i].text.includes('Only page ' + i), out[i].slug + ' lost its own content');
  }
});

test('stripPackBoilerplate never mixes two sites', () => {
  const et = ['a', 'b', 'c', 'd'].map(s => pageOf(s, 'shared sentence that both sites happen to print on every page.'));
  const cargo = ['p', 'q', 'r', 'sX'].map(s => ({ ...pageOf(s, 'cargo only text ' + s + ' long enough to count as content.'), siteId: 'ethiopian-cargo' }));
  const out = stripPackBoilerplate([...et, ...cargo]);
  assert.ok(out.filter(p => p.siteId === 'ethiopian-cargo').every(p => p.text.includes('cargo only text')));
});

test('contentHash ignores whitespace and nothing else', () => {
  assert.equal(contentHash('Maximum weight: 23 kg'), contentHash('Maximum   weight:\n23 kg'));
  assert.notEqual(contentHash('Maximum weight: 23 kg'), contentHash('Maximum weight: 32 kg'));
  assert.match(contentHash('x'), /^[0-9a-f]{40}$/);
});

test('frontMatter escapes a quote so knowledge/index.js can still read the line', () => {
  const fm = frontMatter({ title: 'The "Cloud Nine" cabin', url: 'https://x/y', lang: 'en' });
  assert.ok(fm.includes('title: "The \\"Cloud Nine\\" cabin"'));
  const meta = readMeta(fm + '\nbody\n');
  assert.equal(meta.title, 'The "Cloud Nine" cabin');
});

test('renderDoc writes the fields the freshness check and the index both need', () => {
  const md = renderDoc(pageOf('free-baggage-allowance', 'Maximum weight: 50 lbs (23 kg).'), SITE, { today: '2026-09-16' });
  const meta = readMeta(md);
  assert.equal(meta.url, 'https://www.ethiopianairlines.com/et/x/free-baggage-allowance');
  assert.equal(meta.lang, 'en');
  assert.equal(meta.section, 'baggage');
  assert.equal(meta.fetchedAt, '2026-09-16');
  assert.equal(meta.lastChecked, '2026-09-16');
  assert.equal(meta.status, 'live');
  assert.equal(meta.source_name, 'Ethiopian Airlines');
  assert.equal(meta.generated_by, 'ops/travel/fetch-airline.js');
  assert.match(meta.contentHash, /^[0-9a-f]{40}$/);
});

test('renderDoc names the airline in the title, so every retrieved chunk says whose rule it is', () => {
  const meta = readMeta(renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' }));
  assert.equal(meta.title, 'Ethiopian Airlines — carry-on-baggage');
});

test('renderDoc heads the document in English and Amharic, and says the airline publishes no Amharic page', () => {
  const md = renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' });
  assert.ok(md.includes('Source: https://www.ethiopianairlines.com/et/x/carry-on-baggage'), 'English provenance line');
  assert.ok(md.includes('በአማርኛ፦'), 'Amharic provenance line');
  assert.ok(md.includes('ሻንጣ'), 'the section name in Amharic, so an Amharic question has something to match');
  assert.ok(md.includes('Economy: 1 piece, 7kg.'), 'the page text itself');
});

test('renderDoc states no fact of its own: every figure in it comes from the page text', () => {
  const md = renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' });
  const head = md.split('Economy: 1 piece')[0];
  const numbers = (head.match(/\b\d+\s?(kg|kilo|cm|lbs?|birr|usd|hours?|days?)\b/gi) || []);
  assert.deepEqual(numbers, [], 'the header invented a figure: ' + numbers.join(', '));
});

test('pageHeadings copies the page own headings and never one carrying a figure', () => {
  const text = '## Checked baggage\n\nsome words\n\n##\n\nBaggage calculator\n\nmore words\n\n## Maximum weight: 23 kg\n\nfigures live in the page, not in the header';
  const heads = pageHeadings(text, 'Free Baggage Allowance');
  assert.deepEqual(heads, ['Checked baggage', 'Baggage calculator']);
});

test('the header opens with what THIS page is, so two documents of the pack do not share their first 420 characters', () => {
  // 420 is not arbitrary: knowledge/index.js shows the reranker a title and exactly 420 characters of a
  // candidate. When every document opened with the same provenance paragraphs the reranker was choosing
  // between passages it could not tell apart, and dropped the right page nine times in the Task 10 run.
  const bags = { ...pageOf('free-baggage-allowance', '## Checked baggage\n\nHow much you may check in.'), title: 'Free Baggage Allowance' };
  const sheba = { ...pageOf('shebamiles-faqs', '## How do I join ShebaMiles\n\nEnrolment is on the website.'),
    title: 'ShebaMiles FAQ', section: 'shebamiles', sectionTitleAm: 'ሽበማይልስ' };
  const a = renderDoc(bags, SITE, { today: '2026-09-16' });
  const b = renderDoc(sheba, SITE, { today: '2026-09-16' });
  const headOf = md => md.slice(md.indexOf('# Ethiopian')).slice(0, 420);
  assert.notEqual(headOf(a), headOf(b), 'two pages opened with the same 420 characters');
  assert.ok(headOf(a).includes('Free Baggage Allowance'), 'the first 420 characters do not name the page');
  assert.ok(headOf(b).includes('ShebaMiles'), 'the first 420 characters do not name the page');
  assert.ok(headOf(b).includes('ሽበማይልስ'), 'the first 420 characters carry no Amharic an Amharic question can match');
  assert.ok(headOf(a).includes('Checked baggage'), 'the page own headings are not in the opening');
});

test('writePack re-renders a document written in an older pack format, and does not call it a change', () => {
  const dir = tmp();
  const page = pageOf('a', 'first page content, long enough to be real.');
  writePack(dir, [page], SITE, { today: '2026-09-16' });
  const file = path.join(dir, 'a.md');
  // age the file back to the format that has no packFormat line at all
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^packFormat: .*\n/m, ''));
  const r = writePack(dir, [page], SITE, { today: '2026-09-23' });
  assert.deepEqual(r.changed, [], 'a re-render is not a change the airline made');
  assert.deepEqual(r.reformatted, ['a']);
  const after = readMeta(fs.readFileSync(file, 'utf8'));
  assert.equal(after.packFormat, PACK_FORMAT);
  assert.equal(after.fetchedAt, '2026-09-16', 'the day the content was fetched must survive a re-render');
  assert.equal(after.lastChecked, '2026-09-23');
});

test('writePack adds a file that is not there', () => {
  const dir = tmp();
  const r = writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16' });
  assert.deepEqual(r.added, ['a']);
  assert.ok(fs.existsSync(path.join(dir, 'a.md')));
});

test('writePack refuses to rewrite a file whose content has not changed, and only moves lastChecked', () => {
  const dir = tmp();
  const page = pageOf('a', 'first page content, long enough to be real.');
  writePack(dir, [page], SITE, { today: '2026-09-16' });
  const before = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  const r = writePack(dir, [page], SITE, { today: '2026-09-23' });
  const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  assert.deepEqual(r.unchanged, ['a']);
  assert.deepEqual(r.changed, []);
  assert.equal(readMeta(after).fetchedAt, '2026-09-16', 'fetchedAt must not move when nothing changed');
  assert.equal(readMeta(after).lastChecked, '2026-09-23', 'lastChecked must move');
  assert.equal(after.split('---\n')[2], before.split('---\n')[2], 'the body is byte-identical');
});

test('writePack rewrites a changed page and keeps the date it was first seen', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'Maximum weight 23 kg.')], SITE, { today: '2026-09-16' });
  const r = writePack(dir, [pageOf('a', 'Maximum weight 32 kg.')], SITE, { today: '2026-09-23' });
  assert.deepEqual(r.changed, ['a']);
  const meta = readMeta(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'));
  assert.equal(meta.fetchedAt, '2026-09-23');
  assert.equal(meta.firstFetched, '2026-09-16');
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('32 kg'));
});

test('writePack marks a vanished page gone instead of deleting what we last knew', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'still here and readable.'), pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-16' });
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23', failed: [dead('b')] });
  assert.deepEqual(r.gone, ['b']);
  const meta = readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'));
  assert.equal(meta.status, 'gone');
  assert.equal(meta.goneAt, '2026-09-23');
  assert.ok(fs.readFileSync(path.join(dir, 'b.md'), 'utf8').includes('about to disappear'), 'the last known text stays on disk');
});

test('writePack marks a page live again when it comes back', () => {
  const dir = tmp();
  writePack(dir, [pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-16' });
  writePack(dir, [], SITE, { today: '2026-09-23', failed: [dead('b')] });
  const r = writePack(dir, [pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-30' });
  assert.deepEqual(r.changed, ['b']);
  assert.equal(readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8')).status, 'live');
});

test('writePack in dry-run writes nothing at all but still reports what it would do', () => {
  const dir = tmp();
  const r = writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16', dryRun: true });
  assert.deepEqual(r.added, ['a']);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('writePack never touches sources.json', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'sources.json'), '{"keep":true}');
  writePack(dir, [], SITE, { today: '2026-09-16' });
  assert.equal(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'), '{"keep":true}');
});

test('touchLastChecked changes exactly one line', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16' });
  const f = path.join(dir, 'a.md');
  const before = fs.readFileSync(f, 'utf8').split('\n');
  touchLastChecked(f, '2026-10-01');
  const after = fs.readFileSync(f, 'utf8').split('\n');
  const diff = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
  assert.equal(diff.length, 1);
  assert.match(diff[0][1], /^lastChecked: "2026-10-01"$/);
});

test('the Amharic header says ከኢትዮጵያ, never ከየኢትዮጵያ', () => {
  const md = renderDoc(pageOf('a', 'a page with enough words on it to be a real page.'), SITE, { today: '2026-09-16' });
  assert.ok(md.includes('ከኢትዮጵያ አየር መንገድ'), 'the from-prefix was not applied');
  assert.ok(!md.includes('ከየኢትዮጵያ'), 'two prefixes in a row is not Amharic');
});

test('splitThin keeps a page that survived stripping and reports one that did not', () => {
  const fat = { slug: 'fat', text: 'x'.repeat(MIN_CHARS) };
  const bare = { slug: 'bare', text: 'nothing left but a heading' };
  const { kept, thin } = splitThin([fat, bare]);
  assert.deepEqual(kept.map(d => d.slug), ['fat']);
  assert.deepEqual(thin.map(d => d.slug), ['bare']);
});

test('a page that is all mega-menu is thin after stripping, not a near-empty document', () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map((s, i) =>
    pageOf(s, i === 0 ? 'Short.' : 'Only page ' + i + ' says this, at length, so it is content. '.repeat(20)));
  const { kept, thin } = splitThin(stripPackBoilerplate(pages));
  assert.deepEqual(thin.map(d => d.slug), ['a']);
  assert.equal(kept.length, 4);
});

test('writePack does not mark a page gone on one failed fetch: it records the miss and leaves it live', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'still here and readable.'), pageOf('b', 'timed out this week.')], SITE, { today: '2026-09-16' });
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23', failed: [dead('b', 'timeout')] });
  assert.deepEqual(r.gone, []);
  assert.deepEqual(r.missed, ['b']);
  const md = fs.readFileSync(path.join(dir, 'b.md'), 'utf8');
  const meta = readMeta(md);
  assert.equal(meta.status, 'live', 'one timeout orphaned the chunks of a page that is still published');
  assert.equal(meta.missedAt, '2026-09-23');
  assert.equal(meta.lastChecked, '2026-09-23');
  assert.ok(md.includes('timed out this week.'), 'the body must not move');
});

test('writePack marks a page gone when it is missing a second run running', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'still here and readable.'), pageOf('b', 'about to disappear.')], SITE, { today: '2026-09-16' });
  writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23', failed: [dead('b', 'timeout')] });
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-30', failed: [dead('b', 'timeout')] });
  assert.deepEqual(r.gone, ['b']);
  assert.equal(r.goneWhy.b, 'missing two runs running');
  const meta = readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'));
  assert.equal(meta.status, 'gone');
  assert.equal(meta.goneAt, '2026-09-30');
  assert.equal(meta.missedAt, undefined, 'the miss is spent once the page is gone');
});

test('a page that answers again clears its miss, so two bad weeks a month apart are not two in a row', () => {
  const dir = tmp();
  const b = pageOf('b', 'here, then not answering, then here again.');
  writePack(dir, [b], SITE, { today: '2026-09-16' });
  writePack(dir, [], SITE, { today: '2026-09-23', failed: [dead('b', 'timeout')] });
  const r = writePack(dir, [b], SITE, { today: '2026-09-30' });
  assert.deepEqual(r.unchanged, ['b'], 'the page never changed, so coming back is not a change');
  const meta = readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'));
  assert.equal(meta.missedAt, undefined, 'the miss was not cleared');
  assert.equal(meta.status, 'live');
  assert.equal(meta.lastChecked, '2026-09-30');
  const r2 = writePack(dir, [], SITE, { today: '2026-10-07', failed: [dead('b', 'timeout')] });
  assert.deepEqual(r2.gone, [], 'the count did not start again from zero');
  assert.deepEqual(r2.missed, ['b']);
});

test('writePack in dry-run records neither a miss nor a gone mark on disk', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'still here and readable.'), pageOf('b', 'did not answer.')], SITE, { today: '2026-09-16' });
  const before = fs.readFileSync(path.join(dir, 'b.md'), 'utf8');
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23', dryRun: true, failed: [dead('b', 'timeout')] });
  assert.deepEqual(r.missed, ['b']);
  assert.equal(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'), before, 'a dry run recorded a miss on disk');
  const r2 = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23', dryRun: true, failed: [dead('b')] });
  assert.deepEqual(r2.gone, ['b']);
  assert.equal(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'), before, 'a dry run marked a page gone on disk');
});
