'use strict';
// The owner dashboard's new cards, pinned by reading owner.html (the escape test covers template literals; these cards
// are built by string concatenation, so their escaping is pinned here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'owner.html'), 'utf8');
const fn = name => { const at = HTML.indexOf('async function ' + name + '('); assert.ok(at > 0, name + ' missing'); return HTML.slice(at, HTML.indexOf('\n}\n', at)); };

test('Settings shows the tenant Telegram card: count, poster, link and Remove, every value escaped', () => {
  assert.ok(HTML.includes('<div id="tenant-tg" class="card p-4">'));
  assert.match(HTML, /    loadTgLinks\(\);\n    loadTenantTg\(\);/);
  const load = fn('loadTenantTg');
  assert.match(load, /kfetch\('\/api\/owner\/' \+ slug \+ '\/tenant-telegram'\)/);
  for (const v of ['esc(d.linked)', 'esc(d.active)', 'jsq(d.poster)', 'esc(d.startLink)', 'esc(u.unit)', 'jsq(u.tenancyId)', 'jsq(u.unit)']) assert.ok(load.includes(v), v);
  assert.match(fn('removeTenantTg'), /'\/tenant-telegram\/' \+ encodeURIComponent\(id\) \+ '\/remove'/);
});

// The poster route needs the owner key. A plain link would need ?key= and put the key in the access log, so the page is
// fetched with the key in the header and written into a window opened on the click itself (popup blockers allow that).
test('the tenant poster opens with the owner key in a header, never in an address', () => {
  const load = fn('loadTenantTg');
  assert.ok(load.includes("onclick=\"openTenantPoster(\\'' + jsq(d.poster) + '\\')\""), 'poster button');
  assert.doesNotMatch(load, /href="' \+ esc\(d\.poster\)/);
  const open = fn('openTenantPoster');
  const w = open.indexOf('window.open('), a = open.indexOf('await ');
  assert.ok(w > 0 && a > w, 'the window is opened before the first await');
  assert.match(open, /\^\\\/tenant-poster\\\//);
  assert.match(open, /await kfetch\(posterPath\)/);
  assert.match(open, /\.document\.write\(html\)/);
  assert.doesNotMatch(open, /key=|KEY|location\.href|\.location =/);
});

test('Invoices lists what did not reach tenants with Send now, and Send tells sent, test mode and not delivered apart', () => {
  assert.ok(HTML.includes('<div id="pending-deliv"></div>'));
  assert.match(HTML, /: ''\}`;\n    loadPending\(\);\n  \}/);
  const load = fn('loadPending');
  assert.match(load, /\/pending-deliveries'/);
  for (const v of ['esc(i.unit)', 'esc(i.type)', 'esc(i.dueDate)', 'esc(i.lastTry)', 'esc(i.reason)', 'jsq(i.id)', 'jsq(i.unit)', 'sendInvoice(']) assert.ok(load.includes(v), v);
  const send = fn('sendInvoice');
  assert.match(send, /if \(!confirm\(/);
  assert.match(send, /r\.delivered/);
  assert.match(send, /r\.status === 'test'/);
  assert.match(send, /NOT delivered: the tenant did not receive it/);
  assert.match(send, /loadPending\(\);/);
  assert.doesNotMatch(send, /WhatsApp/);
});

test('mark-paid refused as already paid says so in English and Amharic and reloads the list', () => {
  const pay = fn('payWith');
  assert.match(pay, /r\.status === 409 && d\.error === 'already_paid'/);
  assert.match(pay, /already marked paid/);
  assert.match(pay, /ቀድሞ/);
  assert.match(pay, /DATA = null; load\(\);/);
  assert.match(pay, /if \(d\.ok\) \{ load\(\); return; \}/);
});

test('Send says Telegram failed when that is the reason, before the test-mode note', () => {
  const send = fn('sendInvoice');
  assert.match(send, /r\.reason === 'tg_failed'/);
  const tg = send.indexOf('Telegram failed'), testNote = send.indexOf('🧪 Test mode');
  assert.ok(tg > 0 && testNote > tg, 'the Telegram note comes first');
  assert.match(send, /alert\(tgNote \+ \(r\.delivered/);
  assert.match(send, /String\(r\.reason \|\| 'not reachable'\)\.replace\(/, 'the reason is reduced to plain characters');
  assert.doesNotMatch(send, /innerHTML/);
});
