'use strict';
// The login page is a static file with an inline script, so it is pinned by reading it — the same way
// test/messaging/dashboard.test.js pins the owner dashboard. These tests are about the four things a
// sign-in page can get wrong: writing HTML, putting a code in a URL, saying too much about a failure,
// and speaking only one language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'login.html'), 'utf8');
const ETHIOPIC = /[ሀ-፿]/;

test('nothing on this page is ever written as HTML', () => {
  assert.equal(src.includes('innerHTML'), false);
  assert.equal(src.includes('outerHTML'), false);
  assert.equal(src.includes('insertAdjacentHTML'), false);
  assert.equal(src.includes('document.write'), false);
  assert.equal(src.includes('eval('), false);
  // No template literal anywhere in the script, so there is no interpolation to get wrong.
  assert.equal(/`/.test(src), false, 'no backticks: every string is a plain one');
  // Everything the page says goes through textContent.
  assert.ok((src.match(/\.textContent = /g) || []).length >= 8);
});

test('the phone door is the first door, and it is not drawn until the server says it exists', () => {
  assert.match(src, /<div id="phoneBox" class="door" hidden>/);
  assert.match(src, /if \(m\.phone\) \{/);
  assert.match(src, /\$\('phoneBox'\)\.hidden = false;/);
  const at = s => { const i = src.indexOf(s); assert.ok(i > 0, s + ' not found'); return i; };
  assert.ok(at('id="phoneBox"') < at('id="tgBox"'), 'phone before Telegram');
  assert.ok(at('id="tgBox"') < at('id="googleBtn"'), 'Telegram before Google');
  assert.ok(at('id="googleBtn"') < at('id="staff"'), 'the staff email form is last');
  // Nothing promises an SMS while the door is shut: the brand-panel line and the subtitle are
  // gated on the same answer, so a visitor is never offered a door that is not there.
  assert.match(src, /<div class="f" id="featPhone" hidden>/);
  assert.match(src, /\$\('featPhone'\)\.hidden = false;/);
  assert.match(src, /\$\('sub'\)\.textContent = T\.subPhone;/);
  const subAt = src.indexOf('id="sub"');
  const subLine = src.slice(subAt, src.indexOf('</div>', subAt));
  assert.equal(/SMS|\u12a4\u1235\u12a4\u121d\u12a4\u1235|\u12ae\u12f5/.test(subLine), false, 'the subtitle in the markup promises nothing: ' + subLine);
  // A 503 from the server means the door was switched off while the page was open: take it away.
  assert.match(src, /if \(r\.status === 503\) \{ \$\('phoneBox'\)\.hidden = true;/);
});

test('a code travels in a POST body and never in a URL, and the phone is asked to fill it in', () => {
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/phone-code\/send', \{ method:'POST'/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/phone-code\/verify', \{ method:'POST'/);
  assert.equal(/phone-code[^'"]*\?/.test(src), false, 'no query string on either endpoint');
  assert.match(src, /autocomplete="one-time-code"/, 'the keyboard offers the code from the SMS');
  assert.match(src, /inputmode="numeric"/);
  assert.match(src, /autocomplete="tel"/);
  assert.match(src, /maxlength="6"/);
});

test('a second code cannot be asked for inside sixty seconds, and the wait is shown', () => {
  assert.match(src, /var left = 60, a = \$\('pResend'\);/);
  assert.match(src, /a\.setAttribute\('aria-disabled', 'true'\);/);
  assert.match(src, /if \(\$\('pResend'\)\.getAttribute\('aria-disabled'\) === 'true'\) return;/);
  assert.match(src, /clearInterval\(tick\)/);
});

test('one sentence for a code that did not work, whatever was wrong with it', () => {
  assert.match(src, /badCode: '/);
  const fn = src.slice(src.indexOf('function signInCode('), src.indexOf('\n}', src.indexOf('function signInCode(')));
  // Only two things can be said here: you are asking too often, or that code did not work.
  assert.match(fn, /showErr\(r\.status === 429 \? T\.tooMany : T\.badCode\)/);
  assert.equal(/expired.*wrong|attempts|locked|remaining|left/i.test(fn), false, 'the page never says how close a guess was');
  // The number is cleared and focused again, so the next attempt is one tap away.
  assert.match(fn, /\$\('code'\)\.value = '';/);
});

test('every sentence the page can say is in Amharic and in English', () => {
  const from = src.indexOf('var T = {');
  assert.ok(from > 0, 'the sentences live in one place');
  const block = src.slice(from, src.indexOf('};', from));
  // T holds plain sentences only — nothing with a `function` in it, so every quoted run is a sentence.
  assert.equal(block.includes('function'), false, 'T is sentences; the two that take a number live beside it');
  const said = block.match(/'[^']{12,}'/g) || [];
  assert.ok(said.length >= 12, 'found only ' + said.length + ' sentences');
  for (const s of said) {
    assert.match(s, ETHIOPIC, 'no Amharic in: ' + s);
    assert.match(s, /[A-Za-z]/, 'no English in: ' + s);
  }
  // The two sentences that take a number are built by hand; they carry both languages too.
  for (const name of ['waitText', 'sentToText']) {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at > 0, name + ' not found');
    const line = src.slice(at, src.indexOf('\n', at));
    assert.match(line, ETHIOPIC, 'no Amharic in ' + name + ': ' + line);
    assert.match(line, /[A-Za-z]/, 'no English in ' + name + ': ' + line);
  }
});

test('Telegram, Google and the staff email form still work exactly as they did', () => {
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/telegram', \{ method:'POST'/);
  assert.match(src, /body: JSON\.stringify\(\{ widget: user, callbackURL: NEXT \}\)/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/social', \{ method:'POST'/);
  assert.match(src, /provider:'google', callbackURL: location\.origin \+ NEXT/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/email', \{ method:'POST'/);
  assert.match(src, /s\.setAttribute\('data-telegram-login', m\.telegramBot\);/);
  assert.match(src, /telegram\.org\/js\/telegram-widget\.js\?22/);
  // The open-redirect guard on ?next is untouched.
  assert.match(src, /if \(!\/\^\\\/\(\?!\\\/\)\/\.test\(NEXT\)\) NEXT = '\/';/);
});

test('the page is built for a phone first', () => {
  assert.match(src, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(src, /@media\(max-width:760px\)/);
  assert.match(src, /<meta name="robots" content="noindex">/);
  // No third-party script but Telegram's own widget, and it is only added when Telegram is configured.
  const scripts = src.match(/src="https?:[^"]+"/g) || [];
  assert.deepEqual(scripts, [], 'no external script tag in the markup');
});
