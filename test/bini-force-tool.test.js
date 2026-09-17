'use strict';
// A price word is not a ride. §15d, 2026-09-17: "ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?" forced quote_ride,
// the wallet-tariff answer lost its date, and the log said `forced intent called no tool`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shouldForceTool } = require('../assistant/force');
const { isBankingQuestion } = require('../assistant/banking');

test('a fee question at a wallet or a bank forces no tool', () => {
  assert.equal(shouldForceTool('ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?'), false, 'the telebirr fee question that started this');
  assert.equal(shouldForceTool('what does telebirr charge to send 1,000 birr'), false);
  assert.equal(shouldForceTool('የባንክ ሂሳብ ለመክፈት ስንት ያስከፍላል?'), false);
  assert.equal(shouldForceTool('CBE ATM withdrawal fee how much'), false);
  // and the pack preference has to see it too, or the answer is undated whether a tool ran or not
  assert.equal(isBankingQuestion('ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?'), true, 'ቴሌብር is a banking word');
});

test('a ride fare question still forces a tool', () => {
  assert.equal(shouldForceTool('ከቦሌ ወደ ፒያሳ ስንት ያስከፍላል?'), true);
  assert.equal(shouldForceTool('how much is a taxi to the airport'), true);
  assert.equal(shouldForceTool('ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?'), true);
  assert.equal(shouldForceTool('ከመገናኛ ወደ ሜክሲኮ ዋጋው ስንት ነው?'), true);
  assert.equal(shouldForceTool('fare from Megenagna to Bole'), true);
});

test('an airline fee question forces no tool either; the pack answers it', () => {
  assert.equal(shouldForceTool('ሻንጣ ለመጨመር ስንት ያስከፍላል?'), false);
  assert.equal(shouldForceTool('how much does Ethiopian Airlines charge for excess baggage'), false);
});

test('every other forced intent is untouched', () => {
  for (const m of ['remember my name is Ibrahim', 'ስሜን አስታውስ', 'ጋራ ጉዞ መቀመጫ ስንት ነው?', 'what pool corridors are open',
    'what is showing at the cinema', 'ጨረታ አለ?', 'የት ደረሰ ጉዞዬ', 'open the Sheger radio', 'ሸገር ሬድዮ ክፈት',
    'where can i eat in Bole']) {
    assert.equal(shouldForceTool(m), true, 'should still force: ' + m);
  }
});

test('a message with no forced intent at all forces nothing', () => {
  for (const m of ['', '   ', 'ሰላም', 'how do I renew my passport?', 'ፋይዳ መታወቂያ እንዴት አወጣለሁ?']) {
    assert.equal(shouldForceTool(m), false, 'should not force: ' + m);
  }
});

test('server.js asks assistant/force.js and keeps no rule of its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/biniForce\.shouldForceTool\(msg\)/.test(src), 'the route must use the shared predicate');
  assert.ok(!/FORCE_TOOL_RE/.test(src), 'a second copy of the rule is back in server.js');
});
