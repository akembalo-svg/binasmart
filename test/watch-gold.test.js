'use strict';
// The gold set and its eval (design §5.11). Twenty questions: ten subjects, each asked with a recency marker
// and again with the marker removed. The second half sets the exit code, because a build that prefers a
// two-day-old Telegram post to Regulation 394/2016 is the failure this whole file exists to catch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readGold, checkGold, score, verdict } = require('../ops/watch/channels/eval');
const { hasRecencyMarker } = require('../ops/watch/channels/recency');
const { contextSearchOptions } = require('../knowledge/index');

test('ten subjects, twenty questions, half of them Amharic', () => {
  const g = readGold();
  assert.equal(g.questions.length, 10);
  assert.equal(g.questions.filter(q => q.lang === 'am').length, 5);
  assert.equal(g.questions.filter(q => q.lang === 'en').length, 5);
  assert.equal(new Set(g.questions.map(q => q.qid)).size, 10, 'no repeated qid');
  for (const q of g.questions) {
    assert.ok(q.recent && q.plain && q.curated, q.qid);
    assert.match(q.curated, /^[a-z-]+\/[a-z0-9-]+$/, q.qid + ': curated names a source and a slug');
  }
});

test('every recent form carries a marker and every plain form carries none', () => {
  for (const q of readGold().questions) {
    assert.equal(hasRecencyMarker(q.recent), true, q.qid + ' recent: ' + q.recent);
    assert.equal(hasRecencyMarker(q.plain), false, q.qid + ' plain: ' + q.plain);
  }
});

test('every curated page is on disk, live, and actually discusses its subject', () => {
  const { ok, bad } = checkGold(readGold());
  assert.deepEqual(bad, [], 'a question aimed at a page that never mentions its subject is not a measurement');
  assert.equal(ok.length, 10);
});

test('checkGold refuses a set that would silently score the same half twice', () => {
  const g = { questions: [
    { qid: 'x1', recent: 'what is the work permit fee', plain: 'what is the work permit fee', curated: 'law/foreign-work-permit-mols-directive-44-2013-fee-regulation-394-2016', topic: 'work permit fee' },
    { qid: 'x2', recent: 'what changed this week', plain: 'what is the latest fee', curated: 'law/foreign-work-permit-mols-directive-44-2013-fee-regulation-394-2016', topic: 'work permit fee' },
    { qid: 'x3', recent: 'what changed this week', plain: 'what is the fee', curated: 'law/there-is-no-such-page', topic: 'work permit fee' },
  ] };
  const { bad } = checkGold(g);
  assert.deepEqual(bad.map(b => b.qid), ['x1', 'x2', 'x3']);
  assert.match(bad[0].why.join(' '), /recent form carries no recency marker/);
  assert.match(bad[1].why.join(' '), /plain form carries a recency marker/);
  assert.match(bad[2].why.join(' '), /no curated document/);
});

// ---- the scoring, against a stub index that behaves exactly as the real ranking does ----
// A watch page ranks first when the question carries a marker, and is not retrieved at all when it does not,
// because contextSearchOptions excludes it. Both halves are scored through the production options builder.
// The stub answers each question with ITS OWN curated page and one watch page, then applies the exclusion and
// the preference exactly as knowledge/index.js does. The point under test is the options builder and the
// scoring, not a similarity function.
function stubSearch(gold, { watch = true } = {}) {
  const by = new Map();
  for (const q of gold.questions) {
    const page = { source: q.curated.split('/')[0], slug: q.curated.split('/')[1] };
    const w = { source: 'watch', slug: '2026-09-17-' + q.office + '-aa11bb22' };
    by.set(q.plain, watch ? [page, w] : [page]);
    by.set(q.recent, watch ? [page, w] : [page]);
  }
  return async (q, o) => {
    const ex = new Set(o.exclude || []);
    const prefer = new Set(o.prefer || []);
    return (by.get(q) || []).filter(p => !ex.has(p.source))
      .sort((a, b) => (prefer.has(b.source) ? 1 : 0) - (prefer.has(a.source) ? 1 : 0))
      .slice(0, o.rerankTo || 6);
  };
}

test('the plain half finds the law and no watch page; the recent half finds the announcement', async () => {
  const gold = readGold();
  const r = await score(gold, { search: stubSearch(gold), contextSearchOptions });
  assert.equal(r.questions, 10);
  assert.equal(r.plainPageAtK, 1, 'the curated page is found for every plain question');
  assert.deepEqual(r.plainLeaks, [], 'and no watch page leaks into a "what is the rule" answer');
  assert.equal(r.recentWatchAtK, 1, 'the announcement is reachable when the question asks what changed');
  assert.equal(r.recentForOffice, 1, 'and it is the announcement of the office the question named');
  assert.equal(verdict(r, gold).ok, true);
});

test('a watch page in a plain answer fails the build, whatever the other half did', async () => {
  const gold = readGold();
  // an index that ignores the exclusion — the regression this eval exists to catch
  const leaky = async () => [{ source: 'watch', slug: '2026-09-17-ecc-aa11bb22' }];
  const r = await score(gold, { search: leaky, contextSearchOptions });
  assert.equal(r.recentWatchAtK, 1, 'the recent half looks perfect');
  assert.equal(r.plainLeaks.length, 10);
  const v = verdict(r, gold);
  assert.equal(v.ok, false);
  assert.match(v.fails.join('\n'), /returned a watch page/);
  assert.match(v.fails.join('\n'), /under the 60% floor/);
});

test('an empty watch directory is not a failure: the recent half is reported, never enforced', async () => {
  const gold = readGold();
  const r = await score(gold, { search: stubSearch(gold, { watch: false }), contextSearchOptions });
  assert.equal(r.recentWatchAtK, 0, 'nothing has been written yet, which is how it ships');
  assert.equal(verdict(r, gold).ok, true, 'and a floor on an empty directory would only teach us to ignore a red build');
});
