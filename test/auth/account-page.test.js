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
  assert.match(src, /ቁጥርዎ ተረጋግጧል፤ በዚህ ገጽ ቁጥር መቀየር አይቻልም።/, 'the corrected Amharic sentence, with no typo');
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

// ----- Plan D final review, fix 1: a closed door is not advertised -----
// The phone door is configured, not assumed: no pepper, no SMS provider, or the provider switched
// off and there is no door at all. /api/auth-methods is the one place that knows, the login page
// already reads it, and this page must not promise a door the server does not have.

test('the page asks the server which doors are open before it offers the phone one', () => {
  assert.match(src, /fetch\('\/api\/auth-methods'\)/, 'the same public, sixty-second-cached route the login page reads');
  assert.match(src, /m\.phone === true/, 'only a true answer opens the door — not a truthy one');
  assert.match(src, /\+ \(phoneDoor/, 'the sentence hangs off that answer instead of being printed unconditionally');
  assert.match(src, /function loadAccount\(\)/, 'the account itself is still loaded, after the answer');
});

test('the SMS promise is the open-door branch and the neutral line is the other one', () => {
  const tern = src.slice(src.indexOf('+ (phoneDoor'));
  const open = tern.slice(0, tern.indexOf(": '"));
  assert.ok(open.indexOf('we send a code by SMS') > 0, 'the SMS sentence is inside the open branch');
  assert.ok(open.indexOf('ኮድ በኤስኤምኤስ ይላካል') > 0, 'and so is its Amharic half');
  assert.equal(open.indexOf('not open yet'), -1, 'the closed-door line is not in the open branch');
});

test('with the phone door closed the page says nothing about a code', () => {
  assert.match(src, /በስልክ ቁጥር መግባት ገና አልተከፈተም።/, 'Amharic: signing in by phone number is not open yet');
  assert.match(src, /Signing in by phone number is not open yet/, 'English');
});

test('the inline script still parses, and still builds its html without a template literal', () => {
  const inline = src.split('<script>')[1].split('<' + '/script>')[0];
  new (require('vm').Script)(inline, { filename: 'account.html inline script' });
  assert.equal(inline.includes('`'), false, 'no template literal is concatenated into innerHTML');
});
