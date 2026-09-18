'use strict';
// The daily note (design §5.9). The promise that matters most is the silence: a morning on which the offices
// published nothing sends nothing at all — no heartbeat, no "0 items" line. The survey says that will be most
// mornings, and an alert that arrives every day is an alert nobody reads.
//
// And there is no test send anywhere in this file's production path. The first real morning is the proof.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildNote, sendNote, MAX_ITEMS } = require('../ops/watch/channels/note');

const it = (name, text, url, over = {}) => ({ office: 'nbe', source: { name, office: 'nbe' },
  post: { url, text, date: '2026-09-17' }, ...over });

test('an empty day builds no note and sends no message', async () => {
  const n = buildNote({ written: [], pending: [], unsettled: [], today: '2026-09-18' });
  assert.equal(n.text, '');
  assert.equal(n.count, 0);
  let calls = 0;
  const r = await sendNote(n, { sendTg: async () => { calls++; return true; }, log: () => {} });
  assert.equal(calls, 0, 'nothing is sent on a quiet morning');
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'empty');
});

test('a day with two items and one failure sends exactly one message, numbered end to end', async () => {
  const a = it('National Bank of Ethiopia', 'NOTICE OF FOREIGN EXCHANGE AUCTION NO. 28', 'https://t.me/nbethiopia/412');
  const b = it('Ethiopian Customs Commission', 'Branch offices will serve until 19:00 from Meskerem 7 to Meskerem 30',
    'https://t.me/EthiopianCustomsCommission/205', { office: 'ecc', source: { name: 'Ethiopian Customs Commission', office: 'ecc' }, pendingDocument: true });
  const n = buildNote({ written: [{ item: a }, { item: b }],
    pending: [{ item: b, url: 'https://ecc.gov.et/notice/working-hours', why: 'timeout' }],
    today: '2026-09-18' });
  assert.equal(n.count, 3, 'two written and one pending, numbered 1 2 3 in one sequence');
  assert.deepEqual(n.items.map(x => x.n), [1, 2, 3]);
  assert.deepEqual(n.items.map(x => x.kind), ['written', 'written', 'pending']);
  assert.match(n.text, /^📣 Channel watch — 18 September 2026/);
  assert.match(n.text, /1\. National Bank of Ethiopia — NOTICE OF FOREIGN EXCHANGE AUCTION NO\. 28/);
  assert.match(n.text, /https:\/\/t\.me\/nbethiopia\/412/, 'every item carries the link to the post');
  assert.match(n.text, /3\. Ethiopian Customs Commission — https:\/\/ecc\.gov\.et\/notice\/working-hours {2}\(timeout\)/);
  assert.match(n.text, /The announcement is already written; only the file is missing/);
  assert.match(n.text, /pull N/);
  assert.match(n.text, /drop N/);

  const sent = [];
  const r = await sendNote(n, { sendTg: async t => { sent.push(t); return true; } });
  assert.equal(sent.length, 1, 'one message a day, whatever is in it');
  assert.equal(sent[0], n.text);
  assert.equal(r.sent, true);
});

test('a failure with nothing written is still news, and still one message', async () => {
  const b = it('Ministry of Labour and Skills', 'የሥራ ፈቃድ መመሪያ', 'https://t.me/FDRE_MoLSofficial/91', { office: 'mols' });
  const n = buildNote({ written: [], pending: [{ item: b, url: 'https://mols.gov.et/directive-44', why: 'timeout' }], today: '2026-09-18' });
  assert.equal(n.count, 1);
  assert.deepEqual(n.items.map(x => x.n), [1]);
  const sent = [];
  await sendNote(n, { sendTg: async t => { sent.push(t); return true; } });
  assert.equal(sent.length, 1);
});

test('an unsettled item is asked about, never claimed: it is in the note and not in the index', () => {
  const u = it('ethio telecom', 'የተለያዩ አገልግሎቶች ላይ ማሻሻያ ተደርጓል', 'https://t.me/ethio_telecom/7', { office: 'ethiotelecom' });
  const n = buildNote({ written: [], pending: [], unsettled: [u], today: '2026-09-18' });
  assert.match(n.text, /❓ 1 item\(s\) the rules could not settle/);
  assert.match(n.text, /Nothing was guessed: none of these is in the index\./);
  assert.equal(n.items[0].kind, 'unsettled');
});

test('a long post is cut to one line, and a flood is capped rather than sent whole', () => {
  const long = it('ethio telecom', 'x'.repeat(400), 'https://t.me/ethio_telecom/9', { office: 'ethiotelecom' });
  const n = buildNote({ written: [{ item: long }], today: '2026-09-18' });
  for (const line of n.text.split('\n')) assert.ok(line.length <= 200, 'a note line stays readable: ' + line.length);
  const many = buildNote({ written: Array.from({ length: 30 }, (_, i) => ({ item: it('NBE', 'notice ' + i, 'https://t.me/nbethiopia/' + i) })), today: '2026-09-18' });
  assert.equal(many.items.length, MAX_ITEMS);
  assert.match(many.text, /… and 18 more, all on disk/);
  assert.match(many.text, /^30 item\(s\) written to the watch:$/m, 'the count is honest even when the list is cut');
});

test('a dry run prints the note it would send and sends nothing', async () => {
  const n = buildNote({ written: [{ item: it('NBE', 'NOTICE OF AUCTION NO. 28', 'https://t.me/nbethiopia/412') }],
    today: '2026-09-18', dryRun: true });
  assert.match(n.text, /\[DRY RUN — not sent\]/);
  const said = [];
  let calls = 0;
  const r = await sendNote(n, { sendTg: async () => { calls++; return true; }, dryRun: true, log: m => said.push(m) });
  assert.equal(calls, 0);
  assert.equal(r.reason, 'dry-run');
  assert.match(said.join('\n'), /would have sent/);
});

test('the note path is the pack freshness one: same bot, same chats, no new token', () => {
  const f = require('../ops/packs/freshness');
  assert.equal(typeof f.sendTgReal, 'function', 'sendNote falls back to exactly this sender');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'ops', 'watch', 'channels', 'note.js'), 'utf8');
  assert.equal(/BOT_TOKEN|api\.telegram\.org/.test(src), false, 'no bot token and no Telegram URL of its own');
});
