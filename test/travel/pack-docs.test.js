'use strict';
// What ends up on disk under knowledge/travel/. The front matter is not decoration: knowledge/index.js reads
// title, url and lang out of it with a line-by-line regex, and Task 6 adds `status` to that. The hash is what
// the weekly freshness check compares, so it must ignore whitespace and nothing else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripPackBoilerplate, contentHash, frontMatter, renderDoc, readMeta, touchLastChecked, writePack } =
  require('../../ops/travel/fetch-airline');

const SITE = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', lang: 'en' };
const MENU = 'Book a Flight Rail and Fly Flight Status Flight Schedules Charter Services';
const NOTICE = 'Please note that payment by bank cards issued in Russia is not available on the website.';
const pageOf = (slug, body) => ({ siteId: 'ethiopian-airlines', slug, path: '/et/x/' + slug,
  url: 'https://www.ethiopianairlines.com/et/x/' + slug, title: slug, section: 'baggage',
  sectionTitleAm: 'ሻንጣ', text: MENU + '\n\n' + body + '\n\n' + NOTICE });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'travelpack-'));

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
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23' });
  assert.deepEqual(r.gone, ['b']);
  const meta = readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'));
  assert.equal(meta.status, 'gone');
  assert.equal(meta.goneAt, '2026-09-23');
  assert.ok(fs.readFileSync(path.join(dir, 'b.md'), 'utf8').includes('about to disappear'), 'the last known text stays on disk');
});

test('writePack marks a page live again when it comes back', () => {
  const dir = tmp();
  writePack(dir, [pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-16' });
  writePack(dir, [], SITE, { today: '2026-09-23' });
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
