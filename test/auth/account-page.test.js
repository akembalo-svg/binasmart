'use strict';
// The account page shows a person their own number back. That is the one place on the site where a
// full mobile number could end up on a screen in a shop, a taxi or a shared phone — so it does not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'account.html'), 'utf8');

test('the number is shown by its last four digits, and the full one is never written to the page', () => {
  assert.match(src, /function mask\(p\)\{/);
  assert.match(src, /'\+251 ••• ' \+ s\.slice\(-4\)/);
  assert.match(src, /esc\(mask\(me\.phone\)\)/);
  assert.equal(/esc\(me\.phone\)/.test(src), false, 'the unmasked number must not reach the page');
});

test('the phone door is listed among the doors once the number is proven', () => {
  assert.match(src, /if \(me\.phoneVerified\) doors\.push\('Phone · ስልክ'\);/);
  assert.match(src, /var doors = me\.signedInWith\.map\(/, 'the other doors are still read from the session');
});

test('changing a proven number is said, in both languages, to be out of scope here', () => {
  assert.match(src, /ቁጥር መቀየር/, 'Amharic: changing the number');
  assert.match(src, /contact support/, 'English');
  assert.match(src, /if \(me\.phone\) html \+=/);
});

test('an account with no number is told it can just sign in by phone next time', () => {
  assert.match(src, /if \(!me\.phone\) html \+=/);
  assert.match(src, /ኮድ በኤስኤምኤስ ይላካል/, 'Amharic: a code is sent by SMS');
  assert.match(src, /we send a code by SMS/, 'English');
  assert.match(src, /t\.me\/bina_smart_bot/, 'the Telegram contact route is still offered');
});

test('everything on the page still goes through esc(), and it still reads and ends a session the same way', () => {
  assert.match(src, /function esc\(s\)\{/);
  assert.match(src, /fetch\('\/api\/me'\)/);
  assert.match(src, /location\.href = '\/login\?next=\/account'/);
  assert.match(src, /fetch\('\/api\/auth\/sign-out', \{ method:'POST'/);
  // No value is ever concatenated into html without esc() around it.
  const bare = src.match(/' \+ me\.[a-zA-Z.]+ \+ '/g) || [];
  assert.deepEqual(bare, [], 'unescaped value(s) on the page: ' + bare.join(', '));
});
