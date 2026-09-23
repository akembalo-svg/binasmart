'use strict';
// A site may print one block of text on several of its pages (sharedText in a registry): the block stays on the
// page named its home and is taken out of the others, so search does not find the same answer on five pages at
// once. Every page, question and figure in this file is invented.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require(path.join(__dirname, '..', '..', 'ops', 'packs', 'fetch-pack.js'));

// The shared block: a questions-and-answers accordion the invented ferry office prints on every luggage page.
const FAQ = [
  'Luggage questions',
  '1. How many cases may I bring on the ferry?',
  'Deck class 1 case of 11 kg, cabin class 2 cases of 11 kg each.',
  '2. May I bring a bicycle?',
  'Folded bicycles travel free on the lower deck; other bicycles pay the cycle fare at the quay.',
];
const own = name => ['# ' + name, 'This page is about ' + name.toLowerCase() + ' on the invented ferry line, and says so at length so that it is well over the floor of four hundred characters that a page must keep: '
  + 'the ferry office publishes one page per subject and the subject of this one is ' + name.toLowerCase() + ', with its own rules, its own counters and its own opening hours that no other page repeats.',
  'The ' + name.toLowerCase() + ' counter is at the far end of the invented quay, past the ticket hall and the waiting room.'];
const PAGES = {
  'luggage-allowance': [...own('Allowance'), ...FAQ],
  'luggage-bicycles': [...own('Bicycles'), ...FAQ, 'Book now'],
  'luggage-lost': [...own('Lost luggage'), 'Book now', ...FAQ],
  'timetable': [...own('Timetable'), ...FAQ],
};
const doc = slug => ({ url: 'https://example.org/' + slug, path: '/' + slug, slug, siteId: 'f', title: slug, section: 'luggage', lang: 'en',
  text: PAGES[slug].join('\n\n') });
const RULE = { home: 'luggage-allowance', pages: '^luggage-', note: 'invented' };
const site = (over = {}) => ({ id: 'f', name: 'Invented Ferry Office', nameAm: 'የሙከራ ጀልባ', host: 'example.org', sharedText: [RULE], ...over });
const pack = { id: 'travel', logPrefix: 'travel',
  headerEnTemplate: 'Source: {url} (official {siteName} page, {langWord}), fetched {today}. Copied, not restated.' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sharedtext-'));
const read = (dir, slug) => fs.readFileSync(path.join(dir, slug + '.md'), 'utf8');

test('the block stays on its home page and is taken out of the other pages the rule names', () => {
  const docs = Object.keys(PAGES).map(doc);
  const r = P.dropSharedText(docs, site());
  const by = Object.fromEntries(docs.map(d => [d.slug, d.text]));
  assert.equal(by['luggage-allowance'], PAGES['luggage-allowance'].join('\n\n'), 'home keeps every paragraph, word for word');
  assert.equal(by['luggage-bicycles'], [...own('Bicycles'), 'Book now'].join('\n\n'));
  assert.equal(by['luggage-lost'], [...own('Lost luggage'), 'Book now'].join('\n\n'));
  assert.equal(by['timetable'], PAGES['timetable'].join('\n\n'), 'a page the rule does not name is left alone');
  assert.deepEqual(Object.keys(r.dropped).sort(), ['luggage-bicycles', 'luggage-lost']);
  assert.ok(r.dropped['luggage-bicycles'] > P.SHARED_MIN);
});

test('every paragraph taken out of a page is still on its home page, and none is written twice', () => {
  const docs = Object.keys(PAGES).map(doc);
  const before = docs.map(d => d.text.split('\n\n')).flat();
  P.dropSharedText(docs, site());
  const home = docs.find(d => d.slug === 'luggage-allowance').text;
  for (const p of before) {
    assert.ok(docs.some(d => d.text.split('\n\n').includes(p)), 'not lost: ' + p);
    if (FAQ.includes(p)) {
      assert.ok(home.split('\n\n').includes(p), 'on the home page: ' + p);
      const luggage = docs.filter(d => /^luggage-/.test(d.slug) && d.text.split('\n\n').includes(p));
      assert.equal(luggage.length, 1, 'on one luggage page only: ' + p);
    }
  }
});

test('a lone short paragraph that equals one on the home page is not a block and stays', () => {
  const docs = [
    { slug: 'luggage-allowance', text: [...own('Allowance'), 'Book now', 'Yes.'].join('\n\n') },
    { slug: 'luggage-lost', text: [...own('Lost luggage'), 'Book now', 'Can I claim by post?', 'Yes.'].join('\n\n') },
  ];
  const r = P.dropSharedText(docs, site());
  assert.deepEqual(r.dropped, {});
  assert.ok(docs[1].text.includes('Can I claim by post?\n\nYes.'));
});

test('whitespace and case do not hide a copy; a changed figure does', () => {
  const same = FAQ.map(p => p.replace(/ /g, '  ').toUpperCase());
  const changed = FAQ.map(p => p.replace('11 kg', '12 kg'));
  const docs = [doc('luggage-allowance'),
    { slug: 'luggage-bicycles', text: [...own('Bicycles'), ...same].join('\n\n') },
    { slug: 'luggage-lost', text: [...own('Lost luggage'), ...changed].join('\n\n') }];
  const r = P.dropSharedText(docs, site());
  assert.ok(r.dropped['luggage-bicycles'], 'the reflowed copy goes');
  assert.ok(docs[2].text.includes('12 kg'), 'a page that says something different keeps it');
  assert.ok(docs[2].text.includes('2. May I bring a bicycle?'), 'and the paragraphs around it that are too short to be a block on their own stay too');
});

test('no home among the documents: nothing is taken out anywhere, and the run says so', () => {
  const docs = ['luggage-bicycles', 'luggage-lost'].map(doc);
  const r = P.dropSharedText(docs, site());
  assert.deepEqual(r.dropped, {});
  assert.deepEqual(r.noHome, ['luggage-allowance']);
  assert.equal(docs[0].text, PAGES['luggage-bicycles'].join('\n\n'));
});

test('a page the rule would leave under the floor is left whole and reported', () => {
  const docs = [doc('luggage-allowance'), { slug: 'luggage-copy', text: ['Copy page', ...FAQ].join('\n\n') }];
  const r = P.dropSharedText(docs, site());
  assert.deepEqual(r.kept, ['luggage-copy']);
  assert.equal(docs[1].text, ['Copy page', ...FAQ].join('\n\n'));
});

test('rules apply in order, so a block two homes both hold ends on the first home only', () => {
  const docs = [doc('luggage-allowance'), doc('luggage-bicycles'), doc('luggage-lost')];
  P.dropSharedText(docs, site({ sharedText: [RULE, { home: 'luggage-bicycles', pages: '^luggage-' }] }));
  assert.ok(docs[0].text.includes(FAQ[2]));
  assert.ok(!docs[1].text.includes(FAQ[2]) && !docs[2].text.includes(FAQ[2]));
});

test('a rule without home or pages is refused by name', () => {
  assert.throws(() => P.dropSharedText([doc('luggage-allowance')], site({ sharedText: [{ home: 'luggage-allowance' }] })), /sharedText f refused/);
});

test('a site without sharedText is untouched', () => {
  const docs = Object.keys(PAGES).map(doc);
  const r = P.dropSharedText(docs, site({ sharedText: undefined }));
  assert.deepEqual(r, { dropped: {}, noHome: [], kept: [] });
  for (const d of docs) assert.equal(d.text, PAGES[d.slug].join('\n\n'));
});

test('writePack: the copies are gone from the written pages, and each page records the hash of the page as published', () => {
  const dir = tmp();
  const pages = Object.keys(PAGES).map(doc);
  const published = Object.fromEntries(pages.map(p => [p.slug, P.contentHash(p.text)]));
  const r = P.writePack(dir, pages, site(), { today: '2026-09-23', pack });
  assert.deepEqual(Object.keys(r.shared).sort(), ['luggage-bicycles', 'luggage-lost']);
  assert.equal(P.bodyText(read(dir, 'luggage-bicycles')), [...own('Bicycles'), 'Book now'].join('\n\n'));
  assert.equal(P.bodyText(read(dir, 'luggage-allowance')), PAGES['luggage-allowance'].join('\n\n'));
  for (const slug of Object.keys(PAGES)) assert.equal(P.readMeta(read(dir, slug)).contentHash, published[slug], slug);
  // The same pages fetched again next week: unchanged, nothing rewritten.
  const again = P.writePack(dir, Object.keys(PAGES).map(doc), site(), { today: '2026-09-30', pack });
  assert.deepEqual(again.changed, []);
  assert.deepEqual(again.reformatted, []);
  assert.equal(again.unchanged.length, 4);
});

test('rerender: an old pack written with the copies loses them once, keeps its hashes and dates, and a second run changes nothing', () => {
  const dir = tmp();
  P.writePack(dir, Object.keys(PAGES).map(doc), site({ sharedText: undefined }), { today: '2026-09-16', pack });
  const before = Object.fromEntries(Object.keys(PAGES).map(s => [s, P.readMeta(read(dir, s))]));
  const reg = { pack, sites: [site()] };
  const rr = P.rerenderPack(dir, reg);
  assert.deepEqual(rr.rerendered.sort(), ['luggage-bicycles', 'luggage-lost']);
  assert.deepEqual(Object.keys(rr.shared).sort(), ['luggage-bicycles', 'luggage-lost']);
  assert.equal(P.bodyText(read(dir, 'luggage-lost')), [...own('Lost luggage'), 'Book now'].join('\n\n'));
  for (const s of Object.keys(PAGES)) {
    const m = P.readMeta(read(dir, s));
    assert.equal(m.contentHash, before[s].contentHash, s + ' hash of the page as published');
    assert.equal(m.fetchedAt, before[s].fetchedAt, s + ' fetchedAt');
  }
  const again = P.rerenderPack(dir, reg);
  assert.equal(again.rerendered.length, 0);
  assert.deepEqual(again.shared, {});
});

test('the travel registry: every sharedText rule has a home, a valid pattern and a note, and never names its home as a copy', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'knowledge', 'travel', 'sources.json'), 'utf8'));
  const et = reg.sites.find(s => s.id === 'ethiopian-airlines');
  assert.ok(Array.isArray(et.sharedText) && et.sharedText.length);
  for (const r of et.sharedText) {
    assert.match(r.home, /^[a-z0-9-]+$/);
    assert.doesNotThrow(() => new RegExp(r.pages));
    assert.ok(r.note && r.note.length > 20, r.home + ' says why');
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'knowledge', 'travel', r.home + '.md')), r.home + ' is a document of the pack');
  }
});
