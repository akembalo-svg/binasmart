'use strict';
// The Messages tab, pinned by reading owner.html. These cards are built by string concatenation, so the template
// literal scanner in test/owner-dashboard-escape.test.js cannot see them: every value is pinned here by name.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'owner.html'), 'utf8');
const fn = name => {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' missing');
  return HTML.slice(at, HTML.indexOf('\n}\n', at));
};

test('there is a Messages tab and it renders before the overview has loaded', () => {
  assert.ok(HTML.includes('<button onclick="setTab(\'messages\')" data-t="messages" class="tabbtn">📨 Messages</button>'));
  // renderTab() returns early on !D; Messages must work like the AI tab, which does not wait for the overview.
  assert.match(HTML, /function renderTab\(\)\{\n  if \(TAB === 'ai'\) \{ return renderAI\(\); \}\n  if \(TAB === 'messages'\) \{ return renderMessages\(\); \}/);
  const r = fn('renderMessages');
  for (const id of ['sms-month', 'pending-deliv', 'msg-batches', 'msg-actions']) assert.ok(r.includes('id="' + id + '"'), id);
  assert.match(r, /loadSmsMonth\(\); loadPending\(\); loadBatches\(\); loadActions\(\);/);
});

test('the SMS card escapes every number it shows and says plainly when nothing was sent', () => {
  const load = fn('loadSmsMonth');
  assert.match(load, /kfetch\('\/api\/owner\/' \+ slug \+ '\/sms-month'\)/);
  for (const v of ['esc(d.parts)', 'esc(d.limit)', 'esc(d.remaining)', 'esc(d.costEtb)', 'esc(d.unitPriceEtb)', 'esc(d.testParts)'])
    assert.ok(load.includes(v), v);
  assert.match(load, /d\.balance\.state === 'ok'/);
  assert.match(load, /esc\(String\(d\.balance\.value\)\)/);
  assert.match(load, /unavailable · አልተገኘም/);
  assert.match(load, /d\.mode === 'test'/);
  assert.match(load, /🧪 Test mode — nothing was sent/);
  // The only thing placed in a style attribute is a number this page computed.
  assert.match(load, /var pct = d\.limit \? Math\.min\(100, Math\.round\(d\.parts \/ d\.limit \* 100\)\) : 0;/);
  assert.equal(/state === 'off'/.test(load), true, 'no token means no balance line at all');
});

test('the batch list escapes every value, names the sender as a role, and pages', () => {
  const load = fn('loadBatches');
  assert.match(load, /kfetch\(url\)/);
  assert.match(load, /'\/api\/owner\/' \+ slug \+ '\/messages\?page=' \+ MSG\.page/);
  for (const v of ['esc(d.total)', 'esc(b.total)', 'esc(b.source)', 'jsq(b.id)', 'esc(b.id)',
    'esc(msgLabel(MSG_KIND, b.kind))', 'esc(msgLabel(MSG_BY, b.by))', "esc(String(b.at).slice(0, 10))"])
    assert.ok(load.includes(v), v);
  assert.match(load, /No messages yet · እስካሁን መልእክት የለም/);
  assert.match(fn('msgCounts'), /esc\(msgLabel\(MSG_STATE, k\)\) \+ ' ' \+ esc\(c\[k\]\)/);
  assert.match(fn('msgPager'), /esc\(page \+ 1\) \+ ' \/ ' \+ esc\(pages\)/);
  assert.match(fn('msgPage'), /MSG\.page = Math\.max\(0, MSG\.page \+ d\);/);
  // A label the server has not seen before is printed as text, never dropped and never trusted.
  assert.match(fn('msgLabel'), /return map\[k\] \|\| String\(k \|\| ''\);/);
});

test('the filters send only a kind and a month, both url-encoded, and reset the page', () => {
  const load = fn('loadBatches');
  assert.match(load, /MSG\.kind \? '&kind=' \+ encodeURIComponent\(MSG\.kind\) : ''/);
  assert.match(load, /MSG\.month \? '&month=' \+ encodeURIComponent\(MSG\.month\) : ''/);
  const f = fn('msgFilter');
  assert.match(f, /MSG\.kind = document\.getElementById\('msg-kind'\)\.value;/);
  assert.match(f, /MSG\.month = document\.getElementById\('msg-month'\)\.value;/);
  assert.match(f, /MSG\.page = 0; MSG\.open = null; loadBatches\(\);/);
  assert.match(HTML, /var MSG = \{ page: 0, kind: '', month: '', open: null, rpage: 0, apage: 0 \};/);
});
