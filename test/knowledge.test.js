'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { makeKnowledge, chunkDoc, htmlToText, readSources, stripBoilerplate, isSpam, DIMS, toBuf } = require('../knowledge/index');

test('chunkDoc: heading-aware, bounded, carries the title into every chunk', () => {
  const md = '# Addis\n\nintro para that is long enough to count as a chunk of text for the index.\n\n## Bole\n\n' + 'Bole is the airport district. '.repeat(60) + '\n\n## Piassa\n\nOld town with St George Cathedral and the Taitu Hotel near Arada.';
  const cs = chunkDoc(md, 'Addis Ababa');
  assert.ok(cs.length >= 3);
  assert.ok(cs.every(c => c.text.startsWith('Addis Ababa')));
  assert.ok(cs.every(c => c.text.length <= 1500));
  assert.ok(cs.some(c => /› Bole/.test(c.text)) && cs.some(c => /› Piassa/.test(c.text)));
});

test('htmlToText strips chrome and keeps headings and list items', () => {
  const t = htmlToText('<html><head><title>X | BinaSmart</title></head><body><nav>menu</nav><h2>Steps</h2><ul><li>One &amp; two</li></ul><script>x()</script><p>Done.</p></body></html>');
  assert.equal(t.includes('menu'), false); assert.equal(t.includes('x()'), false);
  assert.ok(/## Steps/.test(t) && /- One & two/.test(t) && /Done\./.test(t));
});

test('readSources finds the skill, the Addis notes, llms.txt and guide pages in this repo', () => {
  const docs = readSources(path.join(__dirname, '..'));
  const by = Object.fromEntries(docs.map(d => [d.source + '/' + d.slug, d]));
  assert.ok(by['skill/binasmart-system'] && by['skill/binasmart-system'].internal === true);
  assert.equal(by['skill/binasmart-system'].text.startsWith('---'), false, 'frontmatter stripped');
  assert.ok(by['addis/addis-ababa'] && /Megenagna/.test(by['addis/addis-ababa'].text));
  assert.ok(by['llms/llms']);
  assert.ok(by['guide/fayda'] && by['guide/fayda'].url === 'https://bina.et/fayda');
  assert.ok(docs.filter(d => d.source === 'page').length >= 10);
});

// in-memory prisma for the store + a fake Gemini that embeds by hashing tokens into DIMS buckets
function world({ withKey = true, failEmbed = false, root = null } = {}) {
  const rows = []; let seq = 0;
  const prisma = { knowledgeChunk: {
    findMany: async ({ where, select, orderBy, take }) => rows.filter(r => !where || Object.keys(where).every(k => { const w = where[k]; if (w === null) return r[k] == null; if (w && typeof w === 'object' && 'notIn' in w) return !w.notIn.includes(r[k]); if (w && typeof w === 'object' && 'in' in w) return w.in.includes(r[k]); return r[k] === w; })).slice(0, take || 1e9).map(r => ({ ...r })),
    create: async ({ data }) => { const r = { id: 'c' + (++seq), embedding: null, ...data }; rows.push(r); return { ...r }; },
    update: async ({ where, data }) => { const r = rows.find(x => x.id === where.id); Object.assign(r, data); return { ...r }; },
    deleteMany: async ({ where }) => { const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i];
        const byId = where.id && where.id.in ? where.id.in.includes(r.id) : false;
        const byHash = where.hash && where.hash.notIn ? (r.source === where.source && r.slug === where.slug && !where.hash.notIn.includes(r.hash)) : false;
        if (byId || byHash) rows.splice(i, 1); }
      return { count: before - rows.length }; },
  } };
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/\W+/)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url.split('?')[0].split(':').pop());
    if (failEmbed) return { status: 503, text: async () => 'down', json: async () => ({}) };
    const body = JSON.parse(opts.body);
    if (/batchEmbedContents/.test(url)) return { status: 200, json: async () => ({ embeddings: body.requests.map(r => ({ values: fakeVec(r.content.parts[0].text) })) }) };
    return { status: 200, json: async () => ({ embedding: { values: fakeVec(body.content.parts[0].text) } }) };
  };
  const k = makeKnowledge({ prisma, apiKey: withKey ? 'k' : '', fetchImpl, root: root || path.join(__dirname, '..'), sleep: async () => {} });
  return { k, rows, calls, prisma };
}

test('ingest is idempotent, embeds only new chunks, and search finds the pool fare rule and Megenagna', async () => {
  const w = world();
  const a = await w.k.ingest({ only: ['skill', 'addis'] });
  assert.ok(a.inserted > 10); assert.equal(a.embedded, a.inserted);
  const b = await w.k.ingest({ only: ['skill', 'addis'] });
  assert.equal(b.inserted, 0); assert.equal(b.embedded, 0); assert.equal(b.deleted, 0);
  const r = await w.k.search('BinaPool fare ladder bonus driver earns more', { k: 3 });
  assert.ok(r.length); assert.equal(r[0].source, 'skill'); assert.match(r[0].text, /bonus/i);
  const m = await w.k.search('Megenagna transport hub light rail', { k: 3 });
  assert.equal(m[0].source, 'addis'); assert.match(m[0].text, /Megenagna/);
  const pub = await w.k.search('never invent a fare', { k: 5, isPublic: true });
  assert.ok(pub.every(x => x.source !== 'skill'), 'public search hides the skill');
  assert.ok(w.k.health().embedded === w.k.health().chunks);
});

test('without Gemini (no key, or the API down) search still works on keywords, and Bini context skips greetings', async () => {
  const w = world({ withKey: false });
  await w.k.ingest({ only: ['addis'] });
  const r = await w.k.search('emergency numbers police ambulance', { k: 2 });
  assert.ok(r.length && /991/.test(r[0].text));
  assert.equal(w.k.health().keywordOnly, 1);
  assert.equal(await w.k.contextFor('hello'), '');
  assert.equal(await w.k.contextFor('ሰላም'), '');
  const ctx = await w.k.contextFor('what time is 1 o clock Ethiopian time');
  assert.match(ctx, /Relevant BinaSmart knowledge/); assert.match(ctx, /Ethiopian time/);
  const down = world({ failEmbed: true });
  const res = await down.k.ingest({ only: ['addis'] });
  assert.equal(res.embedded, 0, 'embedding failure is logged, not fatal');
  assert.ok((await down.k.search('Merkato market', { k: 1 })).length, 'keyword search survives');
});

// Bini's Amharic style guide is private (.gitignore); this runs where it is deployed and skips elsewhere.
const HAS_STYLE = require('fs').existsSync(path.join(__dirname, '..', 'knowledge', 'amharic-style.md'));
test('Amharic voice: detection, glossary block, style examples only for Amharic and never public', { skip: !HAS_STYLE && 'knowledge/amharic-style.md is private (.gitignore) and not in this checkout' }, async () => {
  const { isAmharic, voiceBlock } = require('../knowledge/index');
  assert.equal(isAmharic('ጋራ ጉዞ ምንድን ነው'), true);
  assert.equal(isAmharic('selam, ride sint new ke piassa wede bole?'), true);
  assert.equal(isAmharic('How does BinaPool work?'), false);
  const v = voiceBlock(path.join(__dirname, '..'));
  assert.match(v, /Glossary/); assert.match(v, /Voice rules/); assert.equal(/## Examples/.test(v), false); assert.ok(v.length < 6000, 'voice block stays small: ' + v.length);
  const w = world();
  await w.k.ingest({ only: ['style', 'skill'] });
  assert.ok(w.rows.filter(r => r.source === 'style').length >= 20, 'one chunk per example');
  const am = await w.k.contextFor('ጋራ ጉዞ ላይ ስንት ደቂቃ እጠብቃለሁ?');
  assert.match(am, /Amharic voice examples/); assert.match(am, /Relevant BinaSmart knowledge/);
  assert.equal(/Bini Amharic voice/.test(am.split('## Amharic voice examples')[0]), false, 'facts block never contains style chunks');
  const en = await w.k.contextFor('how long do I wait in a pool car');
  assert.equal(/Amharic voice examples/.test(en), false);
  const greet = await w.k.contextFor('ሰላም');
  assert.match(greet, /Amharic voice examples/); assert.equal(/Relevant BinaSmart knowledge/.test(greet), false);
  const pub = await w.k.search('ሰላም ወንድሜ', { k: 5, isPublic: true });
  assert.ok(pub.every(x => x.source !== 'style'));
});


// ---- crawled-site hygiene: the site template must not become dozens of identical chunks ----
const webDoc = (site, n, body) => ({ source: 'web', slug: site + '/p' + n, text: body });
const FOOTER = 'About us. Camerun Street, Awlo Building 7th floor. Phone (+251) 11 12 34 56.';
const NAV = 'Home - News - Politics - Business - Editorial - Sport';

test('stripBoilerplate removes what repeats across one site and keeps what does not', () => {
  const docs = [];
  for (let i = 0; i < 10; i++) docs.push(webDoc('reporter', i, NAV + '\n\n' + 'Story number ' + i + ' about the coffee harvest in Jimma this season.\n\n' + FOOTER));
  stripBoilerplate(docs);
  assert.equal(docs.filter(d => d.text.includes(FOOTER)).length, 0, 'footer stripped from every page');
  assert.equal(docs.filter(d => d.text.includes(NAV)).length, 0, 'nav stripped from every page');
  assert.ok(docs.every((d, i) => d.text.includes('Story number ' + i)), 'the unique story survives');
});

test('stripBoilerplate leaves a small site alone and never touches another site', () => {
  const small = [webDoc('mols', 1, FOOTER + '\n\nOne.'), webDoc('mols', 2, FOOTER + '\n\nTwo.')];
  stripBoilerplate(small);
  assert.ok(small.every(d => d.text.includes(FOOTER)), 'under minPages: untouched, too little evidence');

  const mixed = [];
  for (let i = 0; i < 10; i++) mixed.push(webDoc('reporter', i, FOOTER + '\n\nStory ' + i + ' body text here.'));
  for (let i = 0; i < 6; i++) mixed.push(webDoc('nbe', i, FOOTER + '\n\nDirective ' + i + ' body text here.'));
  stripBoilerplate(mixed);
  assert.equal(mixed.filter(d => d.slug.startsWith('reporter') && d.text.includes(FOOTER)).length, 0);
  assert.equal(mixed.filter(d => d.slug.startsWith('nbe') && d.text.includes(FOOTER)).length, 0, 'counted per site, both qualify on their own');
});

test('stripBoilerplate keeps a paragraph that only a minority of pages share', () => {
  const docs = [];
  for (let i = 0; i < 20; i++) docs.push(webDoc('ena', i, (i < 2 ? 'A shared note on the census.\n\n' : '') + 'Report ' + i + ' with its own content and enough words to matter.'));
  stripBoilerplate(docs);
  assert.equal(docs.filter(d => d.text.includes('shared note on the census')).length, 2, '2 of 20 is content, not template');
});

test('isSpam needs two markers, so a passing mention is safe', () => {
  assert.equal(isSpam('JOKER77 situs slot gacor maxwin hari ini depo 5k'), true);
  assert.equal(isSpam('The ministry published the 2026 education slot allocation for regional colleges'), false, 'one stray word is not spam');
  assert.equal(isSpam('rtp live pragmatic play scatter hitam'), true);
  assert.equal(isSpam('Togel is banned under Ethiopian law and the ministry issued a notice.'), false);
  assert.equal(isSpam('የትምህርት ሚኒስቴር የ2026 የትምህርት ዕድል አዋጅ አወጣ።'), false);
});


// A document that disappears must take its chunks with it. Before this, deleting a source folder left its
// chunks searchable for ever: 133 Afaan Oromoo news chunks had to be removed by hand once they were found
// to be hurting retrieval, and nothing in the pipeline would ever have collected them.
const os = require('os');
const fsp = require('fs');

function webTree(pages) {
  const root = fsp.mkdtempSync(path.join(os.tmpdir(), 'bina-kn-'));
  const dir = path.join(root, 'knowledge', 'web', 'site');
  fsp.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(pages)) {
    fsp.writeFileSync(path.join(dir, name + '.md'),
      '---\nurl: "https://example.et/' + name + '"\ntitle: "' + name + '"\nlang: "en"\n---\n\n' + body);
  }
  return { root, dir };
}
const long = w => (w + ' ').repeat(140);

test('ingest collects the chunks of a document that has been removed', async () => {
  const { root, dir } = webTree({ alpha: long('alpha'), bravo: long('bravo') });
  const w = world({ root });

  const first = await w.k.ingest({ only: ['web'], embed: false });
  assert.ok(first.inserted >= 2, 'both pages indexed');
  assert.equal(first.orphaned, 0, 'nothing to collect on a first run');
  const afterFirst = w.rows.length;

  fsp.rmSync(path.join(dir, 'bravo.md'));
  const second = await w.k.ingest({ only: ['web'], embed: false });
  assert.ok(second.orphaned > 0, 'the removed page left orphans and they were collected');
  assert.equal(w.rows.some(r => r.slug.endsWith('bravo')), false, 'no chunk of the deleted page survives');
  assert.ok(w.rows.some(r => r.slug.endsWith('alpha')), 'the page that remains is untouched');
  assert.ok(w.rows.length < afterFirst, 'the index shrank');
  fsp.rmSync(root, { recursive: true, force: true });
});

test('a partial run never collects outside the sources it rebuilt', async () => {
  const { root } = webTree({ alpha: long('alpha') });
  const w = world({ root });
  await w.prisma.knowledgeChunk.create({ data: { source: 'guide', slug: 'fayda', url: null, title: 'Fayda',
    lang: 'am', ord: 0, hash: 'keepme', text: 'guide text', internal: false } });
  await w.k.ingest({ only: ['web'], embed: false });
  assert.ok(w.rows.some(r => r.source === 'guide' && r.slug === 'fayda'),
    'a web-only run must not touch another source');
  fsp.rmSync(root, { recursive: true, force: true });
});

test('orphan collection refuses to empty an index when a fetch has failed', async () => {
  // each page must chunk several times: the guard deliberately ignores sources under 20 chunks
  const big = w => Array.from({ length: 8 }, (_, i) => 'Section ' + i + '. ' + long(w)).join('\n\n');
  const { root, dir } = webTree({ a: big('alpha'), b: big('bravo'), c: big('charlie'), d: big('delta'), e: big('echo') });
  const w = world({ root });
  await w.k.ingest({ only: ['web'], embed: false });
  const before = w.rows.length;
  assert.ok(before > 20, 'need enough chunks for the guard to apply, got ' + before);
  // simulate the source going away entirely, as a failed crawl would look
  for (const f of fsp.readdirSync(dir)) fsp.rmSync(path.join(dir, f));
  fsp.writeFileSync(path.join(dir, 'a.md'),
    '---\nurl: "https://example.et/a"\ntitle: "a"\nlang: "en"\n---\n\n' + big('alpha'));
  const r = await w.k.ingest({ only: ['web'], embed: false });
  assert.equal(r.orphaned, 0, 'refused rather than dropping most of the index');
  assert.equal(w.rows.length, before, 'the index is untouched');
  fsp.rmSync(root, { recursive: true, force: true });
});


// ---- news: BinaSmart's own published articles, indexed whole from the NewsPost table ----
const { newsDocs, isOwnNewsUrl, hybridScore } = require('../knowledge/index');
const NOW = new Date('2026-09-14T09:00:00Z');
const post = (slug, extra = {}) => ({ slug, title: 'English title ' + slug, titleAm: 'የአማርኛ ርዕስ ' + slug, excerpt: 'አጭር መግቢያ ' + slug,
  bodyHtml: '<p>የመጀመሪያ አንቀጽ ስለ ' + slug + ' የተጻፈ ረጅም ዓረፍተ ነገር ለመከፋፈል በቂ እንዲሆን።</p><h2>ክፍል</h2><p>ሁለተኛ አንቀጽ ስለ ' + slug + ' ተጨማሪ ዝርዝር የያዘ ጽሑፍ ነው።</p>', lang: 'am', published: true,
  publishedAt: new Date('2026-09-13T12:17:07Z'), ...extra });

test('newsDocs: one document per published post, with bina.et url, the post language and a date line', () => {
  const docs = newsDocs([post('law-2-house-rent'), post('en-post', { lang: 'en', titleAm: null, title: 'Plain English' })], NOW);
  assert.equal(docs.length, 2);
  const d = docs[0];
  assert.equal(d.source, 'news'); assert.equal(d.slug, 'law-2-house-rent');
  assert.equal(d.url, 'https://bina.et/news/law-2-house-rent');
  assert.equal(d.lang, 'am');
  assert.ok(d.title.startsWith('የአማርኛ ርዕስ law-2-house-rent'), 'the Amharic title names the document');
  assert.match(d.title, /\(2026-09-13\)$/, 'date in the title, so every chunk carries it');
  assert.ok(d.text.startsWith('Published: 2026-09-13\n'), 'date line first');
  assert.match(d.text, /English title law-2-house-rent/, 'English title kept for English questions');
  assert.match(d.text, /አጭር መግቢያ/); assert.match(d.text, /## ክፍል/); assert.equal(/<p>/.test(d.text), false, 'html converted');
  assert.equal(docs[1].lang, 'en'); assert.ok(docs[1].title.startsWith('Plain English'));
  // the Addis calendar day: 22:30 UTC on the 13th is already the 14th in Addis Ababa
  assert.match(newsDocs([post('late', { publishedAt: new Date('2026-09-13T22:30:00Z') })], NOW)[0].text, /^Published: 2026-09-14/);
});

test('newsDocs: a long article is indexed whole, not truncated like crawled pages', () => {
  const para = '<p>' + 'የቤት ኪራይ ውል በ30 ቀን ውስጥ መመዝገብ አለበት። '.repeat(40) + '</p>';
  const d = newsDocs([post('long', { bodyHtml: para.repeat(60) + '<p>የመጨረሻው ዓረፍተ ነገር እዚህ አለ።</p>' })], NOW)[0];
  assert.ok(d.text.length > 40000, 'full length kept: ' + d.text.length);
  assert.match(d.text, /የመጨረሻው ዓረፍተ ነገር/, 'the end of the article survives');
  const chunks = chunkDoc(d.text, d.title);
  assert.ok(chunks.length > 40 && chunks.every(c => c.text.includes('(2026-09-')), 'every chunk carries the dated title');
});

test('newsDocs: unpublished, scheduled and malformed posts produce nothing', () => {
  const docs = newsDocs([
    post('draft', { published: false }),
    post('scheduled', { publishedAt: new Date('2026-09-20T00:00:00Z') }),
    post('no-date', { publishedAt: null }),
    { published: true, title: 'no slug', publishedAt: new Date('2026-01-01') },
    post('ok'),
  ], NOW);
  assert.deepEqual(docs.map(d => d.slug), ['ok']);
});

test('the web loader drops crawled bina.et/news pages and keeps everything else', () => {
  const root = fsp.mkdtempSync(path.join(os.tmpdir(), 'bina-kn-'));
  const dir = path.join(root, 'knowledge', 'web', 'bina');
  fsp.mkdirSync(dir, { recursive: true });
  const page = (name, url) => fsp.writeFileSync(path.join(dir, name + '.md'), '---\nurl: "' + url + '"\ntitle: "' + name + '"\nlang: "am"\n---\n\n' + long(name));
  page('article', 'https://bina.et/news/law-2-house-rent');
  page('www', 'https://www.bina.et/news/ai-pros-cons-ethiopia');
  page('guide', 'https://bina.et/fayda');
  page('govnews', 'https://justice.gov.et/en/news/some-announcement/');
  const docs = readSources(root, ['web']);
  assert.deepEqual(docs.map(d => d.url).sort(), ['https://bina.et/fayda', 'https://justice.gov.et/en/news/some-announcement/'],
    'own articles skipped; /news/ on another site is legitimate crawled content');
  assert.equal(readSources.lastHygiene.ownNews, 2);
  assert.equal(isOwnNewsUrl('https://bina.et/news/x'), true);
  assert.equal(isOwnNewsUrl('https://bina.et/newsroom'), false);
  assert.equal(isOwnNewsUrl('https://notbina.et/news/x'), false);
  fsp.rmSync(root, { recursive: true, force: true });
});

test('ranking: a guide still beats a news article on a close call, whatever source the article came from', () => {
  const guide = hybridScore({ cos: 0.60, kw: 0.5, source: 'guide' });
  const ownNews = hybridScore({ cos: 0.63, kw: 0.5, source: 'news' });
  const crawledNews = hybridScore({ cos: 0.63, kw: 0.5, source: 'web' });
  assert.ok(guide > ownNews, 'close call goes to the guide');
  assert.equal(ownNews, crawledNews, 'news gets exactly what a crawled news page got before');
  assert.ok(hybridScore({ cos: 0.72, kw: 0.5, source: 'news' }) > guide, 'a clearly better article still wins');
  assert.ok(hybridScore({ kw: 0.5, source: 'guide', hasVec: false }) > hybridScore({ kw: 0.5, source: 'news', hasVec: false }), 'keyword-only too');
});

function withNews(w, posts) {
  w.prisma.newsPost = { findMany: async () => posts.map(p => ({ ...p })) };
  return w;
}

test('ingest --source news indexes articles, and an unpublished article loses its chunks on the next run', async () => {
  const posts = [post('one'), post('two'), post('three')];
  const w = withNews(world({ withKey: false }), posts);
  const a = await w.k.ingest({ only: ['news'], embed: false });
  assert.equal(a.docs, 3); assert.ok(a.inserted >= 3);
  assert.deepEqual([...new Set(w.rows.filter(r => r.source === 'news').map(r => r.slug))].sort(), ['one', 'three', 'two']);
  assert.ok(w.rows.every(r => r.url === 'https://bina.et/news/' + r.slug));
  const again = await w.k.ingest({ only: ['news'], embed: false });
  assert.equal(again.inserted, 0); assert.equal(again.deleted, 0); assert.equal(again.orphaned, 0);

  posts[1].published = false;
  const b = await w.k.ingest({ only: ['news'], embed: false });
  assert.ok(b.orphaned > 0, 'unpublished article collected');
  assert.equal(w.rows.some(r => r.slug === 'two'), false);
  assert.ok(w.rows.some(r => r.slug === 'one') && w.rows.some(r => r.slug === 'three'));

  for (const p of posts) p.published = false;
  const c = await w.k.ingest({ only: ['news', 'addis'], embed: false });
  assert.equal(w.rows.some(r => r.source === 'news'), false, 'the last articles go too, even with no news docs left');
  assert.ok(c.total > 0 && w.rows.some(r => r.source === 'addis'), 'the file sources were rebuilt in the same run');
});

test('news is untouched by a web-only run, and a failed news read deletes nothing', async () => {
  const { root } = webTree({ alpha: long('alpha') });
  const w = withNews(world({ withKey: false, root }), [post('one'), post('two')]);
  await w.k.ingest({ only: ['news'], embed: false });
  const n = w.rows.filter(r => r.source === 'news').length;
  assert.ok(n >= 2);
  await w.k.ingest({ only: ['web'], embed: false });
  assert.equal(w.rows.filter(r => r.source === 'news').length, n, 'web-only run leaves news alone');
  w.prisma.newsPost = { findMany: async () => { throw new Error('db down'); } };
  const r = await w.k.ingest({ only: ['news', 'web'], embed: false });
  assert.equal(w.rows.filter(x => x.source === 'news').length, n, 'failed read is not a removal');
  assert.equal(r.orphaned, 0);
  fsp.rmSync(root, { recursive: true, force: true });
});
