'use strict';
// The telecom gold set is the only number the pack is judged by, so what may enter it is tested: every
// question names a document that is on disk, is live, and discusses its subject (ops/packs/build-gold.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const B = require(path.join(ROOT, 'ops', 'packs', 'build-gold.js'));
const T = require(path.join(ROOT, 'assistant', 'telecom.js'));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'telecom', 'gold-spec.json'), 'utf8'));
const DIR = path.join(ROOT, 'knowledge', 'telecom');
const pageLang = slug => { const m = /^lang: "(\w+)"/m.exec(fs.readFileSync(path.join(DIR, slug + '.md'), 'utf8')); return m && m[1]; };

test('sixty questions: forty Amharic and twenty English, with unique ids', () => {
  assert.equal(spec.questions.length, 60);
  assert.equal(spec.questions.filter(q => q.lang === 'am').length, 40);
  assert.equal(spec.questions.filter(q => q.lang === 'en').length, 20);
  assert.equal(new Set(spec.questions.map(q => q.qid)).size, 60);
});

test('twenty-five Amharic questions have an Amharic page, fifteen have only an English one', () => {
  const am = spec.questions.filter(q => q.lang === 'am');
  const same = am.filter(q => pageLang(q.slug) === 'am');
  assert.equal(same.length, 25, 'Amharic question on an Amharic page');
  assert.equal(am.length - same.length, 15, 'Amharic question on an English page (the ECA laws and Safaricom)');
  for (const q of spec.questions.filter(q => q.lang === 'en')) assert.equal(pageLang(q.slug), 'en', q.qid + ' is English and must have an English page');
});

test('every question is verified against the body of its page, and its second page too', () => {
  const { ok, bad } = B.verify(spec.questions, DIR);
  assert.deepEqual(bad, [], 'a question whose page does not discuss its subject was found');
  assert.equal(ok.length, 60);
});

test('every question names the page that answers it and the pack has that page live', () => {
  for (const q of spec.questions) {
    for (const slug of [q.slug].concat(q.alsoSlugs || [])) {
      assert.ok(slug.startsWith('telecom-'), q.qid + ' names ' + slug);
      const f = path.join(DIR, slug + '.md');
      assert.ok(fs.existsSync(f), q.qid + ' points at a page that is not in the pack: ' + slug);
      assert.ok(!/^status: "gone"/m.test(fs.readFileSync(f, 'utf8')), q.qid + ' points at a gone page');
    }
  }
});

test('the set covers the subjects the design asks for', () => {
  const sections = new Set(spec.questions.map(q => q.section));
  for (const s of ['student', 'disability', 'women', 'youth', 'sim', 'roaming', 'coverage', 'care', 'consumer', 'numbering', 'tariff', 'law', 'levy', 'fees', 'safaricom', 'postpaid', 'fraud'])
    assert.ok(sections.has(s), 'no question on ' + s);
  const slugs = spec.questions.map(q => q.slug).join(' ');
  for (const d of ['directive-832-2021', 'directive-799-2021', 'directive-795-2021', 'directive-797-2021', 'proclamation-1148-2019', 'proclamation-1321-2024', 'regulation-585-2026', 'directive-1024'])
    assert.ok(slugs.includes(d), 'no question on ' + d);
});

test('the gold file carries the prefer list Bini passes for a telecom message', () => {
  const out = path.join(require('os').tmpdir(), 'gold-telecom-test-' + process.pid + '.json');
  const g = B.buildGold(spec.questions, DIR, out, { source: 'telecom', prefer: T.PREFER, about: spec._about });
  fs.rmSync(out, { force: true });
  assert.equal(g.questions.length, 60);
  assert.deepEqual(g.questions[0].prefer, ['telecom', 'banking', 'law']);
  assert.ok(g.questions.every(q => q.gold_pages.length >= 1));
  assert.ok(g.questions.some(q => q.gold_pages.length === 2), 'a question with two acceptable pages (832 and the consumer-affairs page)');
  assert.equal(g.questions.filter(q => q.crossLingual).length, 15);
});

test('build-gold names the telecom prefer list', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'ops', 'packs', 'build-gold.js'), 'utf8'), /telecom: \(\) => require\(path\.join\(ROOT, 'assistant', 'telecom\.js'\)\)\.PREFER/);
});

test('no phone number, however written, is in the gold set', () => {
  const text = fs.readFileSync(path.join(DIR, 'gold-spec.json'), 'utf8');
  assert.equal(/251[79]\d{8}|\b0[79]\d{8}\b/.test(text), false);
});
