'use strict';
// The travel gold set. The check that matters is the last one: a question may not enter the gold file unless
// the page it names actually discusses its subject. A benchmark whose gold pages do not answer their
// questions measures nothing, and measures it very convincingly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verify, buildGold, contentWords } = require('../../ops/travel/build-gold-travel');
const { PREFER } = require('../../assistant/travel');
const spec = require('../../ops/travel/gold-travel-spec.json');

function pack(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'goldpack-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name + '.md'), body);
  return d;
}
const doc = (status, body) => '---\nurl: "https://x/y"\ntitle: "t"\nlang: "en"\nstatus: "' + status + '"\n---\n' + body + '\n';

test('the spec holds exactly 60 questions, 40 Amharic and 20 English', () => {
  assert.equal(spec.questions.length, 60);
  assert.equal(spec.questions.filter(q => q.lang === 'am').length, 40);
  assert.equal(spec.questions.filter(q => q.lang === 'en').length, 20);
});

test('every question has a unique id, a question, a slug and a topic', () => {
  const ids = spec.questions.map(q => q.qid);
  assert.equal(new Set(ids).size, 60);
  for (const q of spec.questions) {
    assert.match(q.qid, /^tv-\d{3}$/);
    assert.ok(q.question.trim().length > 8, q.qid);
    assert.match(q.slug, /^[a-z0-9-]+$/, q.qid);
    assert.ok(contentWords(q.topic).length >= 3, q.qid + ' topic is too thin: ' + q.topic);
    assert.ok(q.section, q.qid + ' names no section');
  }
});

test('an Amharic question is written in Ethiopic and an English one is not', () => {
  for (const q of spec.questions)
    assert.equal(/[ሀ-፿]/.test(q.question), q.lang === 'am', q.qid + ': ' + q.question);
});

test('the sections add up the way the design set them', () => {
  const by = {};
  for (const q of spec.questions) { by[q.section] = by[q.section] || { am: 0, en: 0 }; by[q.section][q.lang]++; }
  assert.deepEqual(by, {
    baggage: { am: 8, en: 4 }, 'check-in': { am: 4, en: 2 }, 'changes-refunds': { am: 5, en: 2 },
    'special-assistance': { am: 6, en: 3 }, 'transit-hub': { am: 6, en: 2 }, shebamiles: { am: 3, en: 1 },
    documents: { am: 2, en: 1 }, rules: { am: 4, en: 2 }, 'on-board': { am: 2, en: 3 },
  });
});

test('contentWords drops the small words that match everything', () => {
  assert.deepEqual(contentWords('what is the free baggage allowance for economy'), ['free', 'baggage', 'allowance', 'economy']);
});

test('verify accepts a question whose page discusses its subject', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const r = verify([{ qid: 'tv-001', slug: 'bags', topic: 'free baggage allowance economy' }], dir);
  assert.deepEqual(r.bad, []);
  assert.equal(r.ok[0].matched.length >= 3, true);
});

test('verify refuses a question whose page never mentions its subject', () => {
  const dir = pack({ bags: doc('live', 'Lounges at Addis Ababa are open to Cloud Nine passengers.') });
  const r = verify([{ qid: 'tv-001', slug: 'bags', topic: 'free baggage allowance economy' }], dir);
  assert.equal(r.ok.length, 0);
  assert.equal(r.bad[0].why, 'topic_not_on_page');
});

test('verify refuses a question whose page is missing or gone', () => {
  const dir = pack({ gone: doc('gone', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const r = verify([{ qid: 'a', slug: 'gone', topic: 'free baggage allowance economy' },
    { qid: 'b', slug: 'nothere', topic: 'free baggage allowance economy' }], dir);
  assert.deepEqual(r.bad.map(x => x.why).sort(), ['no_document', 'page_gone']);
});

test('buildGold refuses to write anything at all when one question fails', () => {
  const dir = pack({ bags: doc('live', 'Lounges at Addis Ababa are open to Cloud Nine passengers.') });
  const out = path.join(dir, 'gold.json');
  assert.throws(() => buildGold([{ qid: 'tv-001', lang: 'en', question: 'how much baggage?', slug: 'bags', topic: 'free baggage allowance economy', section: 'baggage' }], dir, out),
    /1 question\(s\) could not be verified/);
  assert.equal(fs.existsSync(out), false, 'a rejected build must not leave a half-written gold file');
});

test('buildGold writes a question the benchmark can run', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const out = path.join(dir, 'gold.json');
  buildGold([{ qid: 'tv-001', lang: 'en', question: 'how much checked baggage in economy?', slug: 'bags',
    topic: 'free baggage allowance economy', section: 'baggage' }], dir, out);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(g.questions.length, 1);
  const q = g.questions[0];
  assert.equal(q.agent, 'bini');
  assert.deepEqual(q.prefer, PREFER);
  assert.deepEqual(q.gold_pages, [{ source: 'travel', slug: 'bags' }]);
  assert.equal(q.gold_source, 'travel');
  assert.equal(q.gold_slug, 'bags');
  assert.equal(q.crossLingual, false);
  assert.equal(q.strictCrossLingual, false);
});

test('an Amharic question against an English page is marked cross-lingual, because that is the hard case', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const out = path.join(dir, 'gold.json');
  buildGold([{ qid: 'tv-001', lang: 'am', question: 'ስንት ኪሎ ሻንጣ ነፃ ነው?', slug: 'bags',
    topic: 'free baggage allowance economy', section: 'baggage' }], dir, out);
  const q = JSON.parse(fs.readFileSync(out, 'utf8')).questions[0];
  assert.equal(q.crossLingual, true);
  assert.equal(q.strictCrossLingual, true);
});
