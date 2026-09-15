'use strict';
// The same preview card and the same ✅ / ✖ in the dashboard's Bini chat as in Telegram.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'owner.html'), 'utf8');
// The two new functions, cut out of the page the way the escape tests cut theirs out.
const buttons = () => html.slice(html.indexOf('function aiActionButtons'), html.indexOf('async function ownerActionPress'));
const press = () => html.slice(html.indexOf('async function ownerActionPress'), html.indexOf('async function ownerAiSend'));
const send = () => html.slice(html.indexOf('async function ownerAiSend'), html.indexOf('function copyVatReturn'));

test('the chat shows the buttons the server sent, and writes the card with textContent, never innerHTML', () => {
  assert.match(html, /function aiActionButtons\(action, box, msg\)\{/);
  assert.match(html, /btn\.textContent = b\.label;/);
  assert.match(html, /'\/api\/owner\/' \+ slug \+ '\/actions\/' \+ encodeURIComponent\(id\) \+ '\/' \+ \(verb === 'cancel' \? 'cancel' : 'confirm'\)/);
  assert.match(html, /body: JSON\.stringify\(\{ urgent: verb === 'urgent' \}\)/);
  assert.match(html, /if \(d && d\.status === 'done'\) load\(\);/, 'the invoices, money and activity log have changed');
  const fn = html.slice(html.indexOf('function aiActionButtons'), html.indexOf('async function ownerAiSend'));
  assert.equal(/innerHTML/.test(fn), false, 'a card is text, never markup');
  assert.match(fn, /b\.disabled = true;/, 'a second tap while the first is running is not possible');
  // The buttons survive a re-render of the chat tab, and disappear once the action has run.
  assert.match(html, /AI_MSGS\.forEach\(function\(m\)\{ aiBubble\(m\.r, m\.t, box\); if \(m\.a\) aiActionButtons\(m\.a, box, m\); \}\);/);
});

// (a) Every value the server sent — the card text and the button labels — reaches the page as text.
test('nothing from the server is built into markup: no template literal, no innerHTML, only textContent', () => {
  const fn = buttons() + press();
  assert.equal(/innerHTML/.test(fn), false);
  assert.equal(/`/.test(fn), false, 'no template literal in the card code');
  assert.equal(/insertAdjacentHTML|outerHTML|document\.write/.test(fn), false);
  // The label and the card text are the only two values that come from the server.
  assert.match(buttons(), /btn\.textContent = b\.label;/);
  assert.match(press(), /aiBubble\('a', text, box\);/);   // aiBubble escapes with aiEsc()
  assert.match(html, /function aiEsc\(s\)\{ return s\.replace\(\/\[&<>\]\/g/);
  // The class comes from the page, never from the server's verb string.
  assert.match(buttons(), /b\.verb === 'cancel' \? 'bg-slate-200 text-slate-700' : b\.verb === 'urgent' \? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'/);
});

// (b) An answer with no action is the page exactly as it was.
test('a plain answer with no action renders exactly as it did before', () => {
  assert.match(send(), /var rep = \(d && d\.reply\) \|\| 'ይቅርታ።';/);
  assert.match(send(), /AI_MSGS\.push\(m\); aiBubble\('a',rep,box\);/);
  assert.match(send(), /var m = \{ r:'a', t:rep, a:\(d && d\.ownerAction && \(d\.ownerAction\.buttons \|\| \[\]\)\.length\) \? d\.ownerAction : null \};/);
  assert.match(send(), /if \(m\.a\) aiActionButtons\(m\.a, box, m\);/);
  // With no ownerAction, m.a is null and aiActionButtons is never called; called anyway, it touches nothing.
  assert.match(buttons(), /if \(!action \|\| !action\.id \|\| !\(action\.buttons \|\| \[\]\)\.length\) return;/);
  const at = buttons().indexOf('return;'), first = buttons().indexOf('document.createElement');
  assert.ok(at > 0 && first > at, 'the guard comes before anything is created');
});

// (c) The key is a header, the press is disabled while it runs, and a 409 / 404 / 403 is the server's own sentence.
test('the press uses the owner key header, disables the buttons, and shows what came back whatever the status', () => {
  assert.match(html, /o\.headers = Object\.assign\(\{\}, o\.headers \|\| \{\}, \{ 'x-owner-key': KEY \}\);/);
  assert.match(press(), /await kfetch\('\/api\/owner\/' \+ slug \+ '\/actions\/'/);
  assert.equal(/key=|KEY|localStorage/.test(press()), false, 'the key is never written into the address');
  assert.match(press(), /Array\.prototype\.forEach\.call\(row\.querySelectorAll\('button'\), function\(b\)\{ b\.disabled = true; \}\);/);
  const disabled = press().indexOf('b.disabled = true;'), fetched = press().indexOf('await kfetch(');
  assert.ok(disabled > 0 && fetched > disabled, 'the buttons are disabled before the request goes out');
  // Read the JSON whatever the code is: 409 (spent), 404 (unknown) and 403 (not allowed) all carry a reply.
  assert.equal(/r\.ok|r\.status/.test(press()), false, 'no status check short-circuits the reply');
  assert.match(press(), /var d = await r\.json\(\);/);
  assert.match(press(), /var text = \(d && d\.reply\) \|\| 'ይቅርታ።';/);
  assert.equal(/d\.error|e\.message|String\(e\)|catch\(e\)\{ aiBubble\('a', ?e/.test(press()), false, 'a raw error is never shown');
  assert.match(press(), /\}catch\(e\)\{ aiBubble\('a','ይቅርታ፣ የግንኙነት ችግር።', box\); \}/);
  // A card that came back (a re-issued or refused card) is rendered the same way.
  assert.match(press(), /var m = \{ r:'a', t:text, a:\(d && d\.ownerAction && \(d\.ownerAction\.buttons \|\| \[\]\)\.length\) \? d\.ownerAction : null \};/);
  assert.match(press(), /row\.remove\(\);/);
  assert.match(press(), /if \(msg\) msg\.a = null;/, 'the pressed card cannot come back on a re-render');
});

// (d) The id is the whole request. Nothing about the action — no text, no recipients, no amount — is in the body.
test('only the id travels, in the path, and the body says nothing but whether ⚠️ was pressed', () => {
  const bodies = press().match(/body: JSON\.stringify\(\{[^}]*\}\)/g) || [];
  assert.deepEqual(bodies, ["body: JSON.stringify({ urgent: verb === 'urgent' })"]);
  assert.match(press(), /encodeURIComponent\(id\)/);
  assert.equal(/JSON\.stringify\(\{[^}]*(text|message|recipients|amount|phone|month|invoice)/.test(press()), false);
  assert.match(press(), /async function ownerActionPress\(id, verb, row, msg\)\{/);
});

// (e) Nothing but the inline script changed, so there is no ?v= to bump.
test('the page loads one versioned stylesheet and no external script', () => {
  assert.match(html, /<link rel="stylesheet" href="\/static\/fonts\/fonts\.css\?v=2">/);
  assert.equal((html.match(/<script/g) || []).length, 1, 'one inline script block');
  assert.equal(/<script[^>]+src=/.test(html), false, 'no external script to version');
});

// The classes the buttons use exist in the page's own tw-lite stylesheet (there is no Tailwind CDN here).
test('every class the buttons use is defined in the page', () => {
  for (const c of ['flex', 'gap-2', 'mt-1', 'rounded-xl', 'px-3', 'py-2', 'text-sm', 'font-bold',
    'bg-slate-200', 'text-slate-700', 'bg-amber-500', 'text-white', 'bg-emerald-600']) {
    assert.ok(new RegExp('\\.' + c + '[{,]').test(html), c + ' is not styled in owner.html');
  }
});
