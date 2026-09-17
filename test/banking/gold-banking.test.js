'use strict';
// The gold set is the only number this pack is judged by, so the rules about what may enter it are tested
// before it is built. The important one: a question whose page does not discuss its subject is refused BY
// NAME and nothing at all is written. A gold set that is 90% verified produces a percentage that reads
// exactly like a real one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'ops', 'packs', 'build-gold.js'));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', 'gold-spec.json'), 'utf8'));

test('ninety questions, sixty Amharic and thirty English', () => {
  assert.equal(spec.questions.length, 90);
  assert.equal(spec.questions.filter(q => q.lang === 'am').length, 60);
  assert.equal(spec.questions.filter(q => q.lang === 'en').length, 30);
});

// Batch 1 is the 60 questions written on 2026-09-16 against the six banks, the Capital Market Authority and
// EthSwitch; batch 2 the 30 written on 2026-09-17 against the National Bank, telebirr and M-PESA once Task
// 15a had added them. They are kept apart because a single number over both hides which of them moved.
test('every question says which batch it belongs to, and batch 2 is twenty Amharic and ten English', () => {
  for (const q of spec.questions) assert.ok(q.batch === 1 || q.batch === 2, q.qid + ' has no batch');
  const b2 = spec.questions.filter(q => q.batch === 2);
  assert.equal(b2.length, 30);
  assert.equal(b2.filter(q => q.lang === 'am').length, 20);
  assert.equal(b2.filter(q => q.lang === 'en').length, 10);
  // The point of batch 2: telebirr publishes 28 Amharic pages, so most of its Amharic questions can be
  // asked of a page in the language they are asked in. Not all - the National Bank publishes its complaint
  // procedure, its FX rules and its interest-rate directive in English only, and those stay cross-lingual
  // rather than being quietly dropped.
  const amOnAmharicPage = b2.filter(q => q.lang === 'am' && /-am-/.test(q.slug));
  assert.ok(amOnAmharicPage.length >= 15, 'only ' + amOnAmharicPage.length + ' Amharic questions have an Amharic page');
});

test('every question has an id, a section, a slug, a topic and a question', () => {
  const ids = new Set();
  for (const q of spec.questions) {
    assert.match(q.qid, /^bk-\d{3}$/, 'bad qid: ' + q.qid);
    assert.equal(ids.has(q.qid), false, 'duplicate qid: ' + q.qid);
    ids.add(q.qid);
    assert.ok(q.section && q.slug && q.topic && q.question, q.qid + ' is incomplete');
    assert.ok(q.question.length > 10, q.qid + ' question is too short to be a question');
    assert.equal(/[ሀ-፿]/.test(q.question), q.lang === 'am', q.qid + ' language does not match its script');
    assert.equal(/[ሀ-፿]/.test(q.topic), false, q.qid + ' topic must be English content words');
    assert.ok(B.contentWords(q.topic).length >= 3, q.qid + ' topic has fewer than three content words');
    // A gold page that is itself Amharic can never contain an English topic, so those questions carry an
    // Amharic one as well. Zemen is the only institution in the pack with an Amharic locale.
    if (/-am-/.test(q.slug)) {
      assert.ok(q.topicAm, q.qid + ' points at an Amharic page and has no topicAm');
      assert.ok(B.contentWordsAm(q.topicAm).length >= 3, q.qid + ' topicAm has fewer than three Amharic words');
    }
  }
});

test('every slug names a real institution, so a reader knows whose figure it is', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'banking', 'sources.json'), 'utf8'));
  // slugPrefixOf, not `id + '-'`: a site may name its own prefix, and one does. M-PESA's registry id is
  // `safaricom` (the company) while its documents are `mpesa-…` (the product), because that is what a
  // reader of a gold set, a benchmark row or a citation needs to see. This test asked the question twice
  // in two different ways until 2026-09-17, and the second way was wrong: bk-083 -> mpesa-tariff was
  // refused although the pack had written that document itself.
  const prefixes = reg.sites.filter(s => s.fetch !== 'manual').map(s => require(path.join(ROOT, 'ops', 'packs', 'fetch-pack.js')).slugPrefixOf(s));
  for (const q of spec.questions) assert.ok(prefixes.some(p => q.slug.startsWith(p)), q.qid + ' slug has no institution: ' + q.slug);
});

test('the questions spread across the sections rather than piling on one page', () => {
  const bySlug = {};
  for (const q of spec.questions) bySlug[q.slug] = (bySlug[q.slug] || 0) + 1;
  const worst = Math.max(...Object.values(bySlug));
  assert.ok(worst <= 8, 'one page carries ' + worst + ' questions; the set is measuring that page, not the pack');
  const sections = new Set(spec.questions.map(q => q.section));
  assert.ok(sections.size >= 7, 'only ' + sections.size + ' sections are covered');
  const banks = new Set(spec.questions.map(q => q.slug.split('-')[0]));
  assert.ok(banks.size >= 4, 'only ' + banks.size + ' institutions are asked about');
});

test('verify refuses a question whose page does not discuss its subject', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-'));
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\nThis page is about hats and nothing else at all.\n');
  const { ok, bad } = B.verify([
    { qid: 'bk-001', slug: 'x-page', topic: 'overdraft interest rate percent', question: 'q' },
    { qid: 'bk-002', slug: 'x-missing', topic: 'hats hats hats', question: 'q' },
  ], dir);
  assert.equal(ok.length, 0);
  assert.equal(bad.length, 2);
  assert.equal(bad[0].why, 'topic_not_on_page');
  assert.equal(bad[1].why, 'no_document');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verify refuses a question aimed at a page that is gone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-'));
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "gone"\n---\n\noverdraft interest rate percent published here\n');
  const { bad } = B.verify([{ qid: 'bk-001', slug: 'x-page', topic: 'overdraft interest rate', question: 'q' }], dir);
  assert.equal(bad[0].why, 'page_gone');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildGold writes nothing when one question cannot be verified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-'));
  const out = path.join(dir, 'out', 'gold.json');
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\nhats\n');
  assert.throws(() => B.buildGold([{ qid: 'bk-001', slug: 'x-page', topic: 'overdraft interest rate', question: 'q', lang: 'am', section: 'loans' }],
    dir, out, { source: 'banking', prefer: ['banking'] }), /could not be verified/);
  assert.equal(fs.existsSync(out), false, 'a refused build must leave no file behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a built question carries the prefer list Bini actually uses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-'));
  const out = path.join(dir, 'out', 'gold.json');
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\noverdraft interest rate is published on this page\n');
  const { PREFER } = require(path.join(ROOT, 'assistant', 'banking.js'));
  const g = B.buildGold([{ qid: 'bk-001', slug: 'x-page', topic: 'overdraft interest rate', question: 'q', lang: 'am', section: 'loans' }],
    dir, out, { source: 'banking', prefer: PREFER, about: 'test' });
  assert.deepEqual(g.questions[0].prefer, PREFER);
  assert.equal(g.questions[0].gold_source, 'banking');
  assert.equal(g.questions[0].agent, 'bini');
  assert.equal(g.questions[0].crossLingual, true, 'an Amharic question on an English page is cross-lingual');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the travel builder still exists and still points at the travel pack', () => {
  const T = require(path.join(ROOT, 'ops', 'travel', 'build-gold-travel.js'));
  assert.ok(T.PACK.endsWith(path.join('knowledge', 'travel')));
  assert.equal(T.OUT, '/root/storage/bina-embed/eval/gold-travel.json');
  assert.equal(T.MIN_MATCHES, 3);
  assert.equal(typeof T.verify, 'function');
  assert.equal(typeof T.buildGold, 'function');
});
