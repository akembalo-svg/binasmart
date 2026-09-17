'use strict';
// The gold set is the only number this pack is judged by, so the rules about what may enter it are tested
// before it is built. A gold set that is 90 percent verified produces a percentage that reads exactly like
// a real one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'ops', 'packs', 'build-gold.js'));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'business', 'gold-spec.json'), 'utf8'));

test('sixty questions, forty Amharic and twenty English', () => {
  assert.equal(spec.questions.length, 60);
  assert.equal(spec.questions.filter(q => q.lang === 'am').length, 40);
  assert.equal(spec.questions.filter(q => q.lang === 'en').length, 20);
});

test('every question has an id, a section, a slug, a topic and a question', () => {
  const ids = new Set();
  for (const q of spec.questions) {
    assert.match(q.qid, /^bz-\d{3}$/, 'bad qid: ' + q.qid);
    assert.equal(ids.has(q.qid), false, 'duplicate qid: ' + q.qid);
    ids.add(q.qid);
    assert.ok(q.section && q.slug && q.topic && q.question, q.qid + ' is incomplete');
    assert.ok(q.question.length > 10, q.qid + ' question is too short to be a question');
    assert.equal(/[ሀ-፿]/.test(q.question), q.lang === 'am', q.qid + ' language does not match its script');
    assert.equal(/[ሀ-፿]/.test(q.topic), false, q.qid + ' topic must be English content words');
    assert.ok(B.contentWords(q.topic).length >= 3, q.qid + ' topic has fewer than three content words');
    // A gold page that is itself Amharic can never contain an English topic, so those questions carry an
    // Amharic one as well. motri and poessa are the institutions with Amharic pages.
    if (/-am-/.test(q.slug) || q.goldLang === 'am') {
      assert.ok(q.topicAm, q.qid + ' points at an Amharic page and has no topicAm');
      assert.ok(B.contentWordsAm(q.topicAm).length >= 3, q.qid + ' topicAm has fewer than three Amharic words');
    }
  }
});

test('every slug names a real institution, so a reader knows whose figure it is', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'business', 'sources.json'), 'utf8'));
  const prefixes = reg.sites.filter(s => s.fetch !== 'manual').map(s => s.id + '-');
  for (const q of spec.questions) assert.ok(prefixes.some(p => q.slug.startsWith(p)), q.qid + ' slug has no institution: ' + q.slug);
});

test('the questions spread across the sections rather than piling on one page', () => {
  const bySlug = {};
  for (const q of spec.questions) bySlug[q.slug] = (bySlug[q.slug] || 0) + 1;
  const worst = Math.max(...Object.values(bySlug));
  assert.ok(worst <= 8, 'one page carries ' + worst + ' questions; the set is measuring that page, not the pack');
  const sections = new Set(spec.questions.map(q => q.section));
  assert.ok(sections.size >= 7, 'only ' + sections.size + ' sections are covered');
  const inst = new Set(spec.questions.map(q => q.slug.split('-')[0]));
  assert.ok(inst.size >= 4, 'only ' + inst.size + ' institutions are asked about');
});

test('the questions cover all four of the design\'s four people', () => {
  // design 2026-09-17-business-pack-design.md section 1: shopkeeper, importer, founder, employer
  const need = { registration: 0, licensing: 0, trade: 0, investment: 0, employment: 0, pension: 0 };
  for (const q of spec.questions) if (q.section in need) need[q.section]++;
  for (const [k, n] of Object.entries(need)) assert.ok(n >= 2, 'section ' + k + ' has only ' + n + ' questions');
});

test('the spec records how many Amharic questions have an Amharic page, before the run', () => {
  // This is the number that predicts the score. The design's targets are per slice for this reason, and
  // writing the count down here means the benchmark can be read against a prediction rather than a hope.
  assert.equal(typeof spec.measured, 'object');
  assert.equal(typeof spec.measured.amQuestionsWithAmharicPage, 'number');
  assert.equal(typeof spec.measured.amQuestionsWithEnglishPageOnly, 'number');
  assert.equal(spec.measured.amQuestionsWithAmharicPage + spec.measured.amQuestionsWithEnglishPageOnly, 40);
  assert.ok(String(spec.measured.note || '').length > 80, 'say what the split means for the target');
});

test('verify refuses a question whose page does not discuss its subject', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldbz-'));
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\nThis page is about hats and nothing else at all.\n');
  const { ok, bad } = B.verify([
    { qid: 'bz-001', slug: 'x-page', topic: 'trade licence renewal fee', question: 'q' },
    { qid: 'bz-002', slug: 'x-missing', topic: 'hats hats hats', question: 'q' },
  ], dir);
  assert.equal(ok.length, 0);
  assert.equal(bad.length, 2);
  assert.equal(bad[0].why, 'topic_not_on_page');
  assert.equal(bad[1].why, 'no_document');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildGold writes nothing when one question cannot be verified', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldbz-'));
  const out = path.join(dir, 'out', 'gold.json');
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\nhats\n');
  assert.throws(() => B.buildGold([{ qid: 'bz-001', slug: 'x-page', topic: 'trade licence renewal', question: 'q', lang: 'am', section: 'licensing' }],
    dir, out, { source: 'business', prefer: ['business'] }), /could not be verified/);
  assert.equal(fs.existsSync(out), false, 'a refused build must leave no file behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a built question carries the prefer list Bini actually uses', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldbz-'));
  const out = path.join(dir, 'out', 'gold.json');
  fs.writeFileSync(path.join(dir, 'x-page.md'), '---\ntitle: "X"\nlang: "en"\nstatus: "live"\n---\n\nthe trade licence renewal fee is published on this page\n');
  const { PREFER } = require(path.join(ROOT, 'assistant', 'business.js'));
  const g = B.buildGold([{ qid: 'bz-001', slug: 'x-page', topic: 'trade licence renewal', question: 'q', lang: 'am', section: 'licensing' }],
    dir, out, { source: 'business', prefer: PREFER, about: 'test' });
  assert.deepEqual(g.questions[0].prefer, PREFER);
  assert.equal(g.questions[0].gold_source, 'business');
  assert.equal(g.questions[0].agent, 'bini');
  assert.equal(g.questions[0].crossLingual, true, 'an Amharic question on an English page is cross-lingual');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CLI binds the business pack to the prefer list Bini actually uses', () => {
  // buildGold is given a prefer list by its caller; --pack business is the caller that matters, because
  // the benchmark reads what it wrote. Without an entry here the CLI would quietly fall back to ['business']
  // and the run would measure a retrieval Bini never performs.
  const { PREFER } = require(path.join(ROOT, 'assistant', 'business.js'));
  const src = fs.readFileSync(path.join(ROOT, 'ops', 'packs', 'build-gold.js'), 'utf8');
  const m = /const PREFER_OF = \{([\s\S]*?)\};/.exec(src);
  assert.ok(m, 'build-gold.js must bind packs to prefer lists');
  assert.match(m[1], /business:/, 'the business pack has no prefer binding in build-gold.js');
  const gold = JSON.parse(fs.readFileSync('/root/storage/bina-embed/eval/gold-business.json', 'utf8'));
  assert.deepEqual(gold.questions[0].prefer, PREFER, 'the built gold file does not carry the business prefer list');
});