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

// Design section 4 asks a batch line for the channel split as well as the delivered / failed / not reachable counts.
// countsOf has carried telegram, sms and none since Task 1; this is the line that finally shows it.
test('a batch line says which door the messages went out of', () => {
  const ch = fn('msgChannels');
  assert.match(ch, /\['telegram', 'Telegram'\], \['sms', 'SMS'\]/);
  assert.match(ch, /esc\(p\[1\]\) \+ ' ' \+ esc\(c\[p\[0\]\]\)/);
  const load = fn('loadBatches');
  assert.ok(load.includes('var ch = msgChannels(b.counts);'), 'the batch row asks for the split');
  assert.match(load, /\(ch \? ' <span class="text-slate-400">. ' \+ ch \+ '<\/span>' : ''\)/,
    'and shows it only when there is one');
});

// ===== Task 7: the drill-down, the actions, the legend =====

test('the drill-down shows unit, state, channel and reason, each escaped, and pages on its own', () => {
  const open = fn('openBatch');
  assert.match(open, /'\/api\/owner\/' \+ slug \+ '\/messages\/' \+ encodeURIComponent\(id\) \+ '\?page=' \+ \(MSG\.rpage \|\| 0\)/);
  for (const v of ['esc(x.unit)', 'esc(x.channel)', 'esc(x.reason)', 'esc(msgLabel(MSG_STATE, x.present))', 'esc(d.text)'])
    assert.ok(open.includes(v), v);
  // A second tap on the same batch closes it; opening another one starts at its first page.
  assert.match(open, /if \(MSG\.open === id && !keepPage\) \{ MSG\.open = null; box\.innerHTML = ''; return; \}/);
  assert.match(open, /if \(!keepPage\) MSG\.rpage = 0;/);
  assert.match(open, /msgPager\(d\.page, d\.pages, 'batchPage'\)/);
  assert.match(fn('batchPage'), /MSG\.rpage = Math\.max\(0, \(MSG\.rpage \|\| 0\) \+ dir\); openBatch\(MSG\.open, true\);/);
});

test('nothing about a tenant but the unit number is ever written into the drill-down', () => {
  const open = fn('openBatch');
  for (const never of ['phone', 'tenancyId', 'userId', 'providerId', 'tenant', '.name'])
    assert.equal(open.includes(never), false, never);
  // A reason the server has not sent before is printed as text, not looked up and silently lost.
  assert.match(open, /x\.reason \? ' · ' \+ esc\(x\.reason\) : ''/);
});

test('the action history names a role and a channel, never an id, and escapes every figure', () => {
  const load = fn('loadActions');
  assert.match(load, /'\/api\/owner\/' \+ slug \+ '\/owner-actions\?page=' \+ \(MSG\.apage \|\| 0\)/);
  for (const v of ['esc(msgLabel(MSG_ACT, a.kind))', 'esc(msgLabel(MSG_ST, a.status))', 'esc(msgLabel(MSG_BY, a.preparedBy))',
    'esc(msgLabel(MSG_BY, a.confirmedBy))', 'esc(msgLabel(MSG_CH, a.channel))', 'esc(c.sent)', 'esc(c.test)',
    'esc(c.failed)', 'esc(c.notReachable)', 'esc(a.created)', 'esc(a.skipped)', 'esc(a.month)', 'esc(a.unit)',
    'esc(a.totalEtb)', 'esc(a.reason)']) assert.ok(load.includes(v), v);
  assert.match(load, /a\.notReached\.map\(function\(u\)\{ return esc\(u\); \}\)/);
  assert.match(load, /No actions yet · እስካሁን የለም/);
  assert.match(load, /msgPager\(d\.page, d\.pages, 'actPage'\)/);
  assert.match(fn('actPage'), /MSG\.apage = Math\.max\(0, \(MSG\.apage \|\| 0\) \+ dir\); loadActions\(\);/);
  // The page never asks for and never shows the things the route refuses to send.
  for (const never of ['cardText', 'fingerprint', 'a.args', 'a.payload', 'a.id'])
    assert.equal(load.includes(never), false, never);
});

test('the legend explains all six words, including the two an owner would otherwise misread', () => {
  const r = fn('renderMessages');
  assert.match(r, /ℹ️ What the words mean · ትርጉማቸው/);
  for (const w of ['delivered · ደርሷል', 'sent · ተልኳል', 'queued · በመጠባበቅ', 'failed · አልተሳካም',
    'not reachable · አልተደረሰም', 'test · ሙከራ']) assert.ok(r.includes(w), w);
  // Queued is the one that looks like a bug and is not, and a reported failure has no reason to show.
  assert.match(r, /it may have gone, so it is never sent again on its own/);
  assert.match(r, /the operator reported it undelivered and gave no reason/);
});
