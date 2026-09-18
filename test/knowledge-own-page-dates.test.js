'use strict';
// BinaSmart's own guide and service pages get a dated Source line: publisher BinaSmart, the page's bina.et url,
// and the day the page last changed — the date of the last commit that touched public/<slug>.html — labelled
// "updated", because we did not fetch our own page. Measured 2026-09-18 on the Ministry of Labour demo: 25 of
// the 32 undated Source lines in its forty questions were these pages (Labor ID / LMIS 17, COC 8).
// Also here: the url a page is credited with comes from one place, so a header line can never name one copy of
// a document while its Source line gives another copy's name and date.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeKnowledge, sourceLine, docMeta, pageUrl, ownPageDates } = require('../knowledge/index');
const { DATING } = require('../assistant/dating');

const page = (title, extraHead = '') => '<html><head><title>' + title + ' | BinaSmart</title>' + extraHead + '</head><body><h1>' + title + '</h1>'
  + '<p>' + 'The Labor ID is issued through the LMIS portal of the Ministry of Labour and Skills after registration. '.repeat(8) + '</p></body></html>';

function gitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-own-pages-'));
  fs.mkdirSync(path.join(root, 'public'));
  const git = (args, date) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: date || '', GIT_COMMITTER_DATE: date || '' } });
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'public', 'lmis-labor-id-ethiopia.html'), page('Labor ID and LMIS'));
  fs.writeFileSync(path.join(root, 'public', 'coc-certificate-ethiopia.html'), page('COC'));
  git(['add', '.']); git(['commit', '-q', '-m', 'one'], '2026-09-01T10:00:00+0300');
  fs.writeFileSync(path.join(root, 'public', 'lmis-labor-id-ethiopia.html'), page('Labor ID and LMIS, revised'));
  git(['add', '.']); git(['commit', '-q', '-m', 'two'], '2026-09-12T10:00:00+0300');
  // a page that states its own date, and a later uncommitted edit, which must not move the committed date
  fs.writeFileSync(path.join(root, 'public', 'fayda.html'), page('Fayda', '<meta name="bina:updated" content="2026-08-30">'));
  git(['add', '.']); git(['commit', '-q', '-m', 'three'], '2026-09-14T10:00:00+0300');
  fs.appendFileSync(path.join(root, 'public', 'coc-certificate-ethiopia.html'), '<!-- uncommitted -->');
  return root;
}

test('a guide page: BinaSmart, its bina.et url, and the date of the last commit that changed it', () => {
  const root = gitRepo();
  assert.deepEqual(docMeta(root, 'guide', 'lmis-labor-id-ethiopia'), { source_name: 'BinaSmart', url: 'https://bina.et/lmis-labor-id-ethiopia', updated: '2026-09-12' });
  assert.equal(sourceLine({ source: 'guide', slug: 'lmis-labor-id-ethiopia', title: 'Labor ID and LMIS', url: 'https://bina.et/lmis-labor-id-ethiopia' }, { root }),
    'Source: BinaSmart — https://bina.et/lmis-labor-id-ethiopia — updated 2026-09-12');
  // the last COMMIT, not the working tree: the uncommitted edit does not date the page
  assert.equal(docMeta(root, 'guide', 'coc-certificate-ethiopia').updated, '2026-09-01');
});

// The publisher's name is written in Amharic in an Amharic source line: SOURCE_WORDS carries us: 'ቢናስማርት'.
test('the Amharic context says "updated" in Amharic, never "fetched"', () => {
  const root = gitRepo();
  const line = sourceLine({ source: 'guide', slug: 'lmis-labor-id-ethiopia', title: 'x', url: null }, { root, am: true });
  assert.equal(line, 'ምንጭ፦ ቢናስማርት — https://bina.et/lmis-labor-id-ethiopia — የተሻሻለበት ቀን 2026-09-12');
  assert.equal(/የተወሰደበት|fetched/.test(line), false);
});

test('a page that states <meta name="bina:updated"> is dated by it', () => {
  const root = gitRepo();
  assert.equal(docMeta(root, 'guide', 'fayda').updated, '2026-08-30');
});

test('nothing invented: no file, no git, or a slug that is not one of ours', () => {
  const root = gitRepo();
  assert.equal(docMeta(root, 'guide', 'passport'), null, 'listed but not on disk');
  assert.equal(docMeta(root, 'guide', 'not-a-guide'), null, 'not in GUIDE_SLUGS');
  assert.equal(docMeta(root, 'guide', '../../etc/passwd'), null);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-own-nogit-'));
  fs.mkdirSync(path.join(bare, 'public'));
  fs.writeFileSync(path.join(bare, 'public', 'pool.html'), page('Pool'));
  assert.deepEqual(docMeta(bare, 'page', 'pool'), { source_name: 'BinaSmart', url: 'https://bina.et/pool', updated: '' });
  assert.equal(sourceLine({ source: 'page', slug: 'pool', title: 'Pool' }, { root: bare }), 'Source: BinaSmart — https://bina.et/pool');
});

test('git is asked once per root, whatever the number of pages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-own-once-'));
  let calls = 0;
  const git = () => { calls++; return '@2026-09-10\npublic/pool.html\npublic/ai.html\n@2026-09-02\npublic/pool.html\n'; };
  const d = ownPageDates(root, { git });
  assert.equal(d.get('public/pool.html'), '2026-09-10', 'the newest commit wins');
  assert.equal(d.get('public/ai.html'), '2026-09-10');
  ownPageDates(root, { git });
  assert.equal(calls, 1);
});

test('the url comes from the front matter for the header and the Source line alike', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bina-page-url-'));
  fs.mkdirSync(path.join(root, 'knowledge', 'law'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'law', 'labour.md'), ['---', 'url: "https://faolex.fao.org/docs/pdf/eth204430.pdf"', 'title: "Labour"',
    'source_name: "Labour Proclamation No. 1156/2019 (FAOLEX)"', 'fetched: "2026-09-18"', '---', '', '## Overtime', '',
    'Overtime work is paid at one and a quarter times the ordinary hourly rate for work done in the evening, under the labour proclamation. '.repeat(3), ''].join('\n'));
  const hit = { source: 'law', slug: 'labour', title: 'Labour', url: 'https://chilot.wordpress.com/labour/' };
  assert.equal(pageUrl(hit, { root }), 'https://faolex.fao.org/docs/pdf/eth204430.pdf');
  assert.equal(pageUrl({ source: 'news', slug: 'x', url: 'https://bina.et/news/x' }, { root }), 'https://bina.et/news/x', 'no front matter: the row');
  // an index whose chunk rows still carry the old copy's url (written at ingest, never rewritten)
  const rows = [{ id: 'a', source: 'law', slug: 'labour', url: 'https://chilot.wordpress.com/labour/', title: 'Labour', lang: 'en', ord: 0,
    text: 'Labour › Overtime\nOvertime work is paid at one and a quarter times the ordinary hourly rate.', embedding: null, embeddingLocal: null }];
  const k = makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } }, apiKey: '', root, localFallback: false,
    fetchImpl: async () => { throw new Error('no network'); } });
  const ctx = await k.contextFor('how is overtime paid');
  assert.match(ctx, /^\[1\] Labour — https:\/\/faolex\.fao\.org\/docs\/pdf\/eth204430\.pdf$/m);
  assert.match(ctx, /Source: Labour Proclamation No\. 1156\/2019 \(FAOLEX\) — https:\/\/faolex\.fao\.org\/docs\/pdf\/eth204430\.pdf — fetched 2026-09-18/);
  assert.equal(/chilot/.test(ctx), false, ctx);
});

test('contextFor tells the model what "updated" means, and the dating rule accepts it as the date', async () => {
  const root = gitRepo();
  const rows = [{ id: 'g', source: 'guide', slug: 'lmis-labor-id-ethiopia', url: 'https://bina.et/lmis-labor-id-ethiopia', title: 'Labor ID and LMIS', lang: 'en', ord: 0,
    text: 'Labor ID and LMIS › Register\nThe Labor ID is issued through the LMIS portal after registration.', embedding: null, embeddingLocal: null }];
  const k = makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } }, apiKey: '', root, localFallback: false,
    fetchImpl: async () => { throw new Error('no network'); } });
  const ctx = await k.contextFor('how do I get a labor id from LMIS');
  assert.match(ctx, /Source: BinaSmart — https:\/\/bina\.et\/lmis-labor-id-ethiopia — updated 2026-09-12/);
  assert.match(ctx, /BinaSmart's own pages it is the date the page was last updated/);
  // the shared rule: the fetched line is still the primary form, and an own page's "updated" line is a date too
  assert.match(DATING, /Source: \.\.\. fetched YYYY-MM-DD/);
  assert.match(DATING, /Source: BinaSmart — https:\/\/bina\.et\/\.\.\. — updated YYYY-MM-DD/);
  assert.match(DATING, /የተሻሻለበት ቀን YYYY-MM-DD/);
  assert.match(DATING, /last updated/);
});
