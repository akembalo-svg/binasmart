'use strict';
// Ranking (design §5.7): `watch` sits below the curated law and the packs unless the question asks for what is new.
//
// Two directions, and the second is the one that matters. "What is the work-permit fee" must reach Regulation
// 394/2016 and must NOT reach a ministry's Telegram post — a watch item that shouts over the law is the failure
// this rule exists to prevent. "What changed for work permits this week" may reach the post.
//
// The mechanism is one place: contextSearchOptions, which every caller of contextFor goes through — Bini's own
// route in server.js, the government agent through assistant/kit/engine.js, the evals. No agent definition has
// to remember to list `watch`, because a definition that forgot would be a silent regression.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeKnowledge, contextSearchOptions, DIMS, toBuf } = require('../knowledge/index');
const { hasRecencyMarker } = require('../ops/watch/channels/recency');

test('the marker is read in both languages, and an ordinary question carries none', () => {
  for (const q of ['what changed for work permits this week', 'What is the LATEST directive from customs',
    'any new notice from the national bank', 'what did the ministry announce today',
    'has the fee been updated', 'የስራ ፈቃድ ክፍያ በዚህ ሳምንት ተቀይሯል?', 'ከጉምሩክ አዲስ ማስታወቂያ አለ?', 'ዛሬ ምን ተባለ']) {
    assert.equal(hasRecencyMarker(q), true, q);
  }
  for (const q of ['what is the work permit fee', 'how much does a work permit cost in Ethiopia',
    'which office issues a work permit', 'renew my passport', 'read me the newspaper article',
    'የስራ ፈቃድ ክፍያ ስንት ነው?', 'የስራ ፈቃድ የት ይወሰዳል?', '', '   ']) {
    assert.equal(hasRecencyMarker(q), false, q);
  }
});

test('with no recency marker the watch is excluded, and nothing else about the options moves', () => {
  assert.deepEqual(contextSearchOptions({}), { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6 });
  assert.deepEqual(contextSearchOptions({ message: 'what is the work permit fee' }),
    { k: 18, exclude: ['style', 'style-om', 'watch'], rerankTo: 6 });
  // a caller's own exclusions are kept, and watch is added once, never twice
  const o = contextSearchOptions({ message: 'what is the work permit fee', exclude: ['page', 'watch'] });
  assert.deepEqual(o.exclude, ['style', 'style-om', 'page', 'watch']);
});

test('with a recency marker the exclusion is lifted and watch is preferred', () => {
  const o = contextSearchOptions({ message: 'what changed for work permits this week' });
  assert.deepEqual(o.exclude, ['style', 'style-om']);
  assert.deepEqual(o.prefer, ['watch']);
  // an agent that declares its own preference keeps it, with watch added
  const a = contextSearchOptions({ message: 'ከጉምሩክ አዲስ ማስታወቂያ አለ?', prefer: ['law', 'eservices'] });
  assert.deepEqual(a.prefer, ['law', 'eservices', 'watch']);
  // but an agent that explicitly excludes watch is obeyed: the rule lifts the DEFAULT exclusion, not a stated one
  const e = contextSearchOptions({ message: 'what changed this week', exclude: ['watch'] });
  assert.deepEqual(e.exclude, ['style', 'style-om', 'watch']);
  assert.equal(e.prefer, undefined);
});

// ---- the same thing on a real index, with fixture watch documents in a temp root ----
// Deliberately NOT written into knowledge/watch/ of the live repo: nothing goes in there before the dry run.
const fm = meta => ['---', ...Object.entries(meta).map(([k, v]) => k + ': "' + v + '"'), '---', ''].join('\n');

function fixtureRoot() {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'wrank-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'watch'), { recursive: true });
  fs.mkdirSync(path.join(r, 'knowledge', 'law'), { recursive: true });
  fs.writeFileSync(path.join(r, 'knowledge', 'watch', '2026-09-17-mols-aa11bb22.md'),
    fm({ url: 'https://t.me/FDRE_MoLSofficial/91', title: 'Work permit counter to serve until 19:00 this week',
      source_name: 'Ministry of Labour and Skills', office: 'mols', reported_by: 'Ministry of Labour and Skills',
      channel: '@FDRE_MoLSofficial', reported_at: '2026-09-17', lang: 'en', status: 'live',
      expires_at: '2126-10-10', fetchedAt: '2026-09-18', lastChecked: '2026-09-18' })
    + WATCH_TEXT);
  fs.writeFileSync(path.join(r, 'knowledge', 'law', 'work-permit-regulation-394-2016.md'),
    fm({ url: 'https://www.mols.gov.et/regulation-394-2016', title: 'Regulation 394/2016', lang: 'en' }) + LAW_TEXT);
  return r;
}
const WATCH_TEXT = 'On 17 September 2026, the Ministry of Labour and Skills announced that its work permit counter '
  + 'will serve until 19:00 this week, as reported by its official Telegram channel @FDRE_MoLSofficial. '
  + 'The change to the counter hours was announced today and updated the published timetable.';
const LAW_TEXT = 'Regulation 394/2016 on the work permit. The work permit fee is one thousand birr for a new '
  + 'permit and the renewal fee is the same. The fee is paid at the Ministry of Labour and Skills before the '
  + 'work permit is issued to a foreign national.';

function index(root) {
  const fakeVec = t => { const v = new Array(DIMS).fill(0); for (const w of String(t).toLowerCase().split(/[^\p{L}\p{N}]+/u)) { if (!w) continue; let h = 0; for (const c of w) h = (h * 31 + c.codePointAt(0)) >>> 0; v[h % DIMS] += 1; } return v; };
  void fakeVec; void toBuf;   // keyless on purpose: the reranker calls Gemini, and this test touches no network
  const rows = [
    { id: 'w1', source: 'watch', slug: '2026-09-17-mols-aa11bb22', url: 'https://t.me/FDRE_MoLSofficial/91',
      title: 'Work permit counter to serve until 19:00 this week', lang: 'en', ord: 0, text: WATCH_TEXT, embedding: null },
    { id: 'l1', source: 'law', slug: 'work-permit-regulation-394-2016', url: 'https://www.mols.gov.et/regulation-394-2016',
      title: 'Regulation 394/2016', lang: 'en', ord: 0, text: LAW_TEXT, embedding: null },
  ];
  return makeKnowledge({ prisma: { knowledgeChunk: { findMany: async () => rows.map(r => ({ ...r })) } },
    apiKey: '', root, localFallback: false, sleep: async () => {} });
}

test('on an index holding both, the fee question reaches the regulation and never the Telegram post', async () => {
  const root = fixtureRoot();
  try {
    const k = index(root);
    const ctx = await k.contextFor('what is the work permit fee', { lang: 'en' });
    assert.match(ctx, /Regulation 394\/2016/);
    assert.equal(/t\.me\/FDRE_MoLSofficial|Telegram channel/.test(ctx), false, 'the watch item must not be in the block at all');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('on the same index, the "what changed" question reaches the Telegram post, above the regulation', async () => {
  const root = fixtureRoot();
  try {
    const k = index(root);
    const hits = await k.search('what changed for work permits this week',
      contextSearchOptions({ message: 'what changed for work permits this week' }));
    assert.ok(hits.length, 'something came back');
    assert.equal(hits[0].source, 'watch', 'the announcement answers a question about what changed');
    const ctx = await k.contextFor('what changed for work permits this week', { lang: 'en' });
    assert.match(ctx, /Ministry of Labour and Skills/);
    assert.match(ctx, /reported 2026-09-17/, 'and it says when the office said it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
