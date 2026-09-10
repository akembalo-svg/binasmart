'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { check, pathsIn } = require('../ops/bini/checks');

const known = new Set(['/ride', '/ride?pool=1', '/hotels', '/fayda', '/passport']);

test('rubric passes a good Amharic answer and flags the classic failures', () => {
  assert.deepEqual(check({ q: 'x', tags: ['price'] }, 'ዋጋው ቋሚ ነው፣ በ /ride ላይ ያስገቡ።', { known }).fails, []);
  assert.ok(check({ q: 'x', tags: ['price'] }, 'ወደ ቦሌ 350 ብር ነው።', { known }).fails.includes('birr_number_stated'));
  assert.deepEqual(check({ q: 'x', tags: ['price'] }, 'ኮምፎርት 315 ብር፣ ኢኮኖሚ 250 ብር።', { known, tools: ['search_places', 'quote_ride'] }).fails, [], 'a fare from the tool is allowed');
  assert.ok(check({ q: 'x', tags: ['om', 'price'] }, 'Gatiin dhaabbataa dha, /ride irratti ilaalaa.', { known }).fails.length === 0);
  assert.ok(check({ q: 'x', tags: ['om'] }, 'ዋጋው ቋሚ ነው።', { known }).fails.includes('oromo_drift_to_amharic'));
  assert.ok(check({ q: 'x', tags: ['complaint'] }, 'ይቅርታ 😢 ይሰርዙ።', { known }).fails.includes('emoji_on_complaint'));
  assert.ok(check({ q: 'x', tags: ['pool'] }, 'ቢኒ ነኝ። አዎ አለ።', { known }).fails.includes('self_intro'));
  assert.deepEqual(check({ q: 'x', tags: ['greeting'] }, 'ሰላም! ቢኒ ነኝ።', { known }).fails, []);
  assert.ok(check({ q: 'x', tags: ['english', 'demo'] }, 'ቢኒ here! የሆቴል ማስያዣ እውነት ነው።', { known }).fails.includes('english_drift_to_amharic'));
  assert.deepEqual(check({ q: 'x', tags: ['english', 'demo'] }, 'The hotel listed is a demo. See /hotels.', { known }).fails, []);
  assert.ok(check({ q: 'x', tags: ['demo'] }, 'አዎ በ /hotels ላይ ይያዙ።', { known }).fails.includes('demo_not_disclosed'));
  assert.ok(check({ q: 'x', tags: ['pool'] }, 'ጉዞውን በ /ride?id=abc ይመልከቱ።', { known }).fails.some(f => f.startsWith('unknown_link')));
  assert.ok(check({ q: 'x', tags: ['neutral'] }, 'ስትጀምሪ ለሴቶች ብቻ ምረጪ።', { known }).fails.includes('gender_assumed'));
});

test('latin-typed questions need a Latin gloss line at the end', () => {
  assert.ok(check({ q: 'x', tags: ['latin'] }, 'ዋጋው ቋሚ ነው። በ /ride ያስገቡ።', { known }).fails.includes('latin_gloss_missing'));
  assert.deepEqual(check({ q: 'x', tags: ['latin'] }, 'ዋጋው ቋሚ ነው። በ /ride ያስገቡ። (Wagaw kwami new, /ride lay yasgebu.)', { known }).fails, []);
  assert.deepEqual(pathsIn('see /ride?pool=1 and https://bina.et/fayda።'), ['/ride?pool=1', '/fayda']);
});


test('vendor_named: Bini may not say who built it, but may point at ChatGPT/Gemini as places BinaSmart works', () => {
  const kn = new Set(['/ai', '/ride']);
  const en = tags => ({ q: 'x', tags: ['english'].concat(tags || []) });
  // self-attribution, every shape it actually produced
  for (const bad of ["I'm Bini, and I'm a large language model built by Google.",
                     'Hi! I was built by the awesome team at Google.',
                     'Yes, I am a large language model, trained by Google.',
                     'I am Gemini, a large language model, developed by Google.',
                     "and I'm powered by a large language model from Google."]) {
    assert.ok(check(en(), bad, { known: kn }).fails.includes('vendor_named'), 'should flag: ' + bad);
  }
  assert.ok(check({ q: 'x', tags: [] }, '\u130e\u130d\u120d \u12e8\u1230\u122b\u129d \u1275\u120d\u1245 \u1245\u1295\u1243 \u121e\u12f4\u120d \u1290\u129d\u1362', { known: kn }).fails.includes('vendor_named'), 'Amharic "Google made me"');
  // the legitimate case: BinaSmart works inside those assistants
  assert.equal(check(en(), 'You can use BinaSmart inside ChatGPT, Claude and Gemini. See /ai', { known: kn }).fails.includes('vendor_named'), false);
  // the wanted answer
  assert.equal(check(en(), "I'm BinaSmart's assistant, built in Addis Ababa. How can I help?", { known: kn }).fails.includes('vendor_named'), false);
});
