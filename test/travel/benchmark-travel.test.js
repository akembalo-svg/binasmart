'use strict';
// The three benchmark changes the travel gold set needs. The first rule of this file: v1 and v2 numbers are
// published and must not move, so every test here also checks the old behaviour still holds.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { goldPath, goldTag, readGold, searchOptionsFor, normalizeGold, goldKeys, GOLD } =
  require('../../ops/bini/rerun-retrieval-benchmark');
const { contextSearchOptions } = require('../../knowledge/index');

const knowledgeOf = agent => { throw new Error('knowledgeOf must not be called for ' + agent); };

test('--gold travel means gold-travel.json in the standard directory', () => {
  assert.equal(goldPath(['--gold', 'travel'], {}), '/root/storage/bina-embed/eval/gold-travel.json');
  assert.equal(goldTag('/root/storage/bina-embed/eval/gold-travel.json'), 'gold-travel');
});

test('a path is still a path, and the default is still v1', () => {
  assert.equal(goldPath(['--gold', '/root/storage/bina-embed/eval/gold-v2.json'], {}), '/root/storage/bina-embed/eval/gold-v2.json');
  assert.equal(goldPath(['--gold', './gold-v2.json'], {}), './gold-v2.json');
  assert.equal(goldPath([], {}), GOLD);
  assert.equal(goldPath([], { BINI_GOLD: '/tmp/x.json' }), '/tmp/x.json');
  assert.equal(goldPath(['--gold', 'v2'], { BINI_GOLD: '/tmp/x.json' }), '/root/storage/bina-embed/eval/gold-v2.json');
});

test('a question with no agent and no prefer gets the options the benchmark always used', () => {
  const o = searchOptionsFor({ qid: 'q1' }, { contextSearchOptions, knowledgeOf });
  assert.deepEqual(o.plain, { k: 18, exclude: ['style', 'style-om'] });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
});

test('a question that carries its own prefer is searched with it, and no agent file is read', () => {
  const prefer = ['travel', 'page:airport', 'page:flights', 'page:travel'];
  const o = searchOptionsFor({ qid: 'tv-001', agent: 'bini', prefer }, { contextSearchOptions, knowledgeOf });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6, prefer });
  assert.deepEqual(o.plain, { k: 18, exclude: ['style', 'style-om'], prefer });
});

test('an agent question with no prefer still reads that agent declaration', () => {
  const o = searchOptionsFor({ qid: 'q', agent: 'afiya' },
    { contextSearchOptions, knowledgeOf: () => ({ prefer: ['health'], exclude: ['page'] }) });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om', 'page'], rerankTo: 6, prefer: ['health'] });
});

test('gold_pages means the source has to match too, so travel:x is not guide:x', () => {
  const { questions } = normalizeGold([{ qid: 'tv-001', gold_pages: [{ source: 'travel', slug: 'baggage-information-free-baggage-allowance' }] }]);
  assert.deepEqual(goldKeys(questions[0]), ['travel:baggage-information-free-baggage-allowance']);
});

test('a v1 or v2 question still matches on slug alone', () => {
  const { questions } = normalizeGold([{ qid: 'q1', gold_source: 'guide', gold_slug: 'passport' }]);
  assert.deepEqual(goldKeys(questions[0]), ['passport']);
});

// gold-travel.json does not exist until the gold set is built. A name with no file behind it is a typo, and
// it has to say so in one line - not an ENOENT thrown after the corpus has been loaded.
test('a gold set that is not on disk names the file it wanted and what a bare name means', () => {
  const missing = { existsSync: () => false, readFileSync: () => { throw new Error('must not read'); } };
  assert.throws(() => readGold('/root/storage/bina-embed/eval/gold-travel.json', missing),
    /gold set not found: \/root\/storage\/bina-embed\/eval\/gold-travel\.json/);
  assert.throws(() => readGold('/root/storage/bina-embed/eval/gold-travel.json', missing), /gold-<name>\.json/);
});

test('a gold set that is on disk is read and parsed, exactly as before', () => {
  const io = { existsSync: () => true, readFileSync: () => JSON.stringify([{ qid: 'q1', gold_slug: 'passport' }]) };
  assert.deepEqual(readGold('/root/storage/bina-embed/eval/gold.json', io), [{ qid: 'q1', gold_slug: 'passport' }]);
});
