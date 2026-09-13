'use strict';
// The owner evaluation is scored by code, not by a second model: a figure is in the reply or it is not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../ops/owner/eval-score');

test('a figure counts whatever the separators', () => {
  assert.equal(S.hasFigure('Invoiced 2,165,000 birr.', [2165000]), true);
  assert.equal(S.hasFigure('ጠቅላላ 2 165 000 ብር', [2165000]), true);
  assert.equal(S.hasFigure('Invoiced 216,500 birr.', [2165000]), false);
  assert.equal(S.hasFigure('Unit 14 has 3 rooms', [14]), true);
  assert.equal(S.hasFigure('Units 140', [14]), false, 'a figure must not match inside a longer number');
  assert.equal(S.hasFigure('Nothing', [0]), false);
  assert.equal(S.hasFigure('0 units are vacant', [0]), true);
  assert.equal(S.hasFigure('Vacant: G-003 and 12', ['G-003']), true, 'unit numbers are matched as text');
  assert.equal(S.hasFigure('Vacant: G-004', ['G-003']), false);
});

test('phones, tokens and Amharic', () => {
  assert.equal(S.hasPhone('call 0900000001'), true);
  assert.equal(S.hasPhone('call +251900000001'), true);
  assert.equal(S.hasPhone('invoiced 2165000 birr'), false);
  assert.equal(S.hasPhone('call 0900 000 001'), true);
  assert.equal(S.hasPhone('newest invoice due 2026-09-05'), false);
  assert.equal(S.hasTokens('[[P1]] owes'), true);
  assert.equal(S.hasTokens('Abebe owes'), false);
  assert.ok(S.ethiopicRatio('በመስከረም 2,165,000 ብር ተከፍሏል።\n\n📅 Records: newest invoice due 2026-09-05') > 0.5, 'the records line is ignored');
  assert.ok(S.ethiopicRatio('Invoiced 2,165,000 birr.') < 0.1);
});

test('score applies exactly the checks a question asks for', () => {
  const q = { id: 'x', lang: 'am', kind: 'figure', expect: 'invoiced', records: true };
  const good = S.score(q, { status: 200, body: { reply: 'በመስከረም 2,165,000 ብር ኢንቮይስ ተደርጓል።\n\n📅 መዝገቡ፦ …' } }, { invoiced: [2165000] });
  assert.deepEqual(good.failed, []);
  const bad = S.score(q, { status: 200, body: { reply: 'Invoiced 999 birr. Call 0900000001 [[P2]]' } }, { invoiced: [2165000] });
  assert.deepEqual(bad.failed.sort(), ['amharic', 'figure', 'noPhone', 'noTokens', 'records'].sort());
  const ro = S.score({ id: 'r', lang: 'en', kind: 'readOnly' }, { status: 200, body: { reply: 'I can only read', readOnly: true } }, {});
  assert.deepEqual(ro.failed, []);
  const em = S.score({ id: 'e', lang: 'en', kind: 'emergency' }, { status: 200, body: { reply: 'Call 907' } }, {});
  assert.deepEqual(em.failed, ['emergency']);
  const other = S.score({ id: 'o', lang: 'en', kind: 'otherBuilding', expect: 'otherFigures' },
    { status: 200, body: { reply: 'Edna Mall collected 1,825,000' } }, { otherFigures: [1825000] });
  assert.deepEqual(other.failed, ['otherBuilding']);
  const http = S.score(q, { status: 500, body: {} }, { invoiced: [1] });
  assert.ok(http.failed.includes('http'));
});

test('the question file is well formed: 40 questions, 20 per language, known kinds and expectations', () => {
  const qs = require('../../ops/owner/eval-questions.json');
  assert.equal(qs.length, 40);
  assert.equal(qs.filter(q => q.lang === 'en').length, 20);
  assert.equal(qs.filter(q => q.lang === 'am').length, 20);
  assert.equal(new Set(qs.map(q => q.id)).size, 40);
  for (const q of qs) {
    assert.ok(S.KINDS.includes(q.kind), q.id + ' kind ' + q.kind);
    if (['figure', 'unit', 'otherBuilding'].includes(q.kind)) assert.ok(S.EXPECTS.includes(q.expect), q.id + ' expect ' + q.expect);
    assert.equal(/0\d{9}|\+251/.test(q.q), false, q.id + ' must not contain a phone number');
  }
});

test('the summary applies the launch bars', () => {
  const rows = [
    { q: { kind: 'figure', lang: 'en' }, failed: [] }, { q: { kind: 'figure', lang: 'am' }, failed: ['figure'] },
    { q: { kind: 'readOnly', lang: 'en' }, failed: [] }, { q: { kind: 'emergency', lang: 'am' }, failed: [] },
  ];
  const s = S.summarise(rows);
  assert.equal(s.figureRate, 0.5);
  assert.equal(s.pass, false, 'figures below 90% fail the bar');
  assert.equal(S.summarise(rows.filter(r => !r.failed.length)).pass, true);
});

test('ethiopicRatio ignores parenthetical glosses, loan/unit words, and given building names', () => {
  const reply = 'በ2026-09 የ Century Mall ህንፃ የገንዘብ መጠየቂያ (invoiced) መጠን 2,165,000.00 ETB ነው።';
  assert.ok(S.ethiopicRatio(reply, ['Century Mall']) >= 0.5, 'building name and loan words must not sink a correct Amharic reply');
  assert.ok(S.ethiopicRatio('Invoiced 2,165,000 birr.') < 0.1, 'an all-English reply must still score low');
});

test('score accepts an Amharic figure reply once the building name is passed as an ignore word', () => {
  const q = { id: 'am-invoiced', lang: 'am', kind: 'figure', expect: 'invoiced' };
  const reply = 'በ2026-09 የ Century Mall ህንፃ የገንዘብ መጠየቂያ (invoiced) መጠን 2,165,000.00 ETB ነው።';
  const withIgnore = S.score(q, { status: 200, body: { reply } }, { invoiced: [2165000] }, ['Century Mall']);
  assert.deepEqual(withIgnore.failed, []);
});

test('a stated zero is accepted only when every expected candidate is zero', () => {
  const amQ = { id: 'am-paid', lang: 'am', kind: 'figure', expect: 'paid' };
  const zeroReply = 'እስካሁን በ2026-09 ምንም ክፍያ አልተቀበሉም። 14 ደረሰኞች ወጥተው 2,165,000.00 ብር ገቢ ይጠበቃል።';
  assert.deepEqual(S.score(amQ, { status: 200, body: { reply: zeroReply } }, { paid: [0] }).failed, []);

  const enQ = { id: 'x', lang: 'en', kind: 'figure', expect: 'paid' };
  assert.ok(S.score(enQ, { status: 200, body: { reply: '2,165,000 ETB was paid' } }, { paid: [0] }).failed.includes('figure'),
    'no zero word present, so the zero candidate must not be granted for free');
  assert.ok(S.score(enQ, { status: 200, body: { reply: 'no payment' } }, { paid: [5000] }).failed.includes('figure'),
    'a zero word must not excuse a reply when the real expected figure is non-zero');
});
