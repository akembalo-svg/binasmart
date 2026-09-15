'use strict';
// Bini for owners when the building has owner actions on: which requests reach the model, what the model may call, and
// what the owner reads back. The model is scripted and the action service is a double, so nothing is prepared, sent or
// recorded outside this file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const agent = require('../../agents/owner/rules');
const actionTools = require('../../agents/owner/tools/actions');
const { fixture, fakePrisma } = require('./fixture');

const CARD = { text: '👀 ቅድመ እይታ — ገና ምንም አልተላከም · Preview\n📢 መልእክት ለተከራዮች · Message to tenants\n👥 Recipients: 3',
  buttons: [{ verb: 'confirm', label: '✅ ላክ · Confirm' }, { verb: 'cancel', label: '✖ ሰርዝ · Cancel' }] };

// options: calls (what the model does), prepare (what the service answers), actionsOn, channel
function run(message, { calls = [], reply = 'ok', actionsOn = ['b1'], prepare = null, channel = 'owner-web', ownerActions = true } = {}) {
  const seen = { model: 0, prepared: [], sys: '' };
  const { prisma } = fakePrisma(fixture());
  const service = {
    prepare: async a => { seen.prepared.push(a); return prepare ? prepare(a) : { ok: true, id: 'A'.repeat(22), kind: a.kind, staff: false, card: CARD,
      model: { prepared: true, kind: a.kind, recipients: 3, units: ['101', '102'], note: 'nothing sent' } }; },
  };
  const handle = makeEngine({
    callModel: async (sys, messages, max, opts) => {
      seen.model++; seen.sys = sys;
      for (const c of calls) if (opts && opts.execute) seen.out = await opts.execute(c.name, c.args || {});
      return reply;
    },
    contextFor: async () => '', lang, dropUngrounded, isEval: () => false, prisma,
    ownerActions: ownerActions ? service : null,
    memory: { userKey: () => 'ip:t', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true), audit: () => {}, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  const scope = { buildingIds: ['b1'], roles: { b1: 'owner' }, accessIds: { b1: 'A1' }, actionsOn, staffConfirm: [] };
  return handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res, { scope, channel })
    .then(out => ({ out, seen }));
}

const SEND_ALL = 'ለሁሉም ተከራዮች መልእክት ላክ፦ ነገ ውሃ ይቋረጣል';
const PREPARE_MESSAGE = { name: 'prepare_message', args: { target: 'all', text: 'ነገ ውሃ ይቋረጣል' } };

test('with actions on, a send request reaches the model, and the owner reads the card — not the model\'s words', async () => {
  const { out, seen } = await run(SEND_ALL, { calls: [PREPARE_MESSAGE], reply: 'I have sent your message to all tenants.' });
  assert.equal(seen.model, 1, 'the dashboard answer no longer swallows it');
  assert.equal(out.reply, CARD.text, 'the model cannot tell the owner anything about an action');
  assert.deepEqual(out.ownerAction, { id: 'A'.repeat(22), kind: 'message', status: 'pending', ownerConfirms: false, buttons: CARD.buttons });
  assert.equal(out.readOnly, undefined);
  assert.deepEqual(seen.prepared, [{ kind: 'message', args: { target: 'all', text: 'ነገ ውሃ ይቋረጣል' },
    scope: { buildingIds: ['b1'], roles: { b1: 'owner' }, accessIds: { b1: 'A1' }, actionsOn: ['b1'], staffConfirm: [] }, channel: 'owner-web' }]);
  assert.deepEqual(seen.out, { prepared: true, kind: 'message', recipients: 3, units: ['101', '102'], note: 'nothing sent' });
});

test('with actions off, a request the gate recognises gets the dashboard answer without the model', async () => {
  // "ለተከራዮች መልእክት ላክ" ends in the imperative, which agents/owner/rules.js actionFor matches; the same words followed
  // by the notice itself ("… ላክ፦ ነገ ውሃ ይቋረጣል") do not, and are answered by the model calling a prepare tool — which
  // is refused just as clearly while the switch is off (the next test).
  const { out, seen } = await run('ለተከራዮች መልእክት ላክ', { actionsOn: [], calls: [PREPARE_MESSAGE] });
  assert.equal(seen.model, 0);
  assert.equal(out.readOnly, true);
  assert.equal(out.action, 'message');
  assert.match(out.reply, /📤 Send/);
  assert.deepEqual(seen.prepared, []);
});

test('a prepare tool called while the building\'s actions are off gets the dashboard answer too', async () => {
  const { out } = await run(SEND_ALL, { calls: [PREPARE_MESSAGE], prepare: () => ({ ok: false, error: 'actions_off', kind: 'message' }) });
  assert.equal(out.readOnly, true);
  assert.equal(out.action, 'message');
  assert.match(out.reply, /📤 Send/);
  assert.equal(out.ownerAction, undefined);
});

test('a refusal is the code\'s own sentence, in the owner\'s language, and says nothing was prepared', async () => {
  const am = await run('ለ9ኛ ፎቅ መልእክት ላክ፦ ውሃ የለም', { calls: [{ name: 'prepare_message', args: { target: 'floor', floor: '9', text: 'ውሃ የለም' } }],
    prepare: () => ({ ok: false, error: 'floor_unknown', floors: [0, 1, 2] }) });
  assert.match(am.out.reply, /ያሉት ፎቆች፦ 0, 1, 2/);
  assert.equal(am.out.actionRefused, 'floor_unknown');
  assert.equal(am.out.ownerAction, undefined);
  const en = await run('send a message to floor 9: no water', { calls: [{ name: 'prepare_message', args: { target: 'floor', floor: '9', text: 'no water' } }],
    prepare: () => ({ ok: false, error: 'floor_unknown', floors: [0, 1, 2] }) });
  assert.match(en.out.reply, /Floors in the records: 0, 1, 2/);
});

test('an action request the model did not prepare is answered with how to ask for it, never with a guess', async () => {
  const am = await run('ለደንበኞች መልእክት ላክልኝ', { reply: 'እሺ ልኬላችኋለሁ።' });
  assert.equal(am.out.actionHelp, 'message');
  assert.match(am.out.reply, /ቅድመ እይታ/);
  assert.match(am.out.reply, /✅/);
  assert.equal(am.out.ownerAction, undefined);
  const en = await run('Send a message to all my tenants', { reply: 'Done, I have sent it.' });
  assert.equal(en.out.actionHelp, 'message');
  assert.match(en.out.reply, /nothing is sent until you press ✅/);
  const paid = await run('Mark unit 101 as paid', { reply: 'Marked.' });
  assert.equal(paid.out.actionHelp, 'paid');
  assert.match(paid.out.reply, /unit 211 paid 12,500 in cash/);
  const inv = await run('generate this month\'s invoices', { reply: 'Created.' });
  assert.equal(inv.out.actionHelp, 'invoice');
});

test('one action per message: the second prepare call is refused and the first card stands', async () => {
  const { out, seen } = await run(SEND_ALL, { calls: [PREPARE_MESSAGE, { name: 'prepare_invoices', args: { month: '2026-10' } }] });
  assert.equal(seen.prepared.length, 1);
  assert.deepEqual(seen.out, { error: 'one action per message: a preview is already shown to the owner' });
  assert.equal(out.reply, CARD.text);
});

test('a change Bini cannot prepare keeps its dashboard answer even with actions on', async () => {
  for (const q of ['Please change the rent of 102 to 25000', 'vacate unit 102', 'add an expense of 5000 for cleaning', 'call the tenant of 102']) {
    const { out, seen } = await run(q);
    assert.equal(seen.model, 0, q);
    assert.equal(out.readOnly, true, q);
    assert.equal(out.ownerAction, undefined, q);
  }
});

test('a question is still a question: actions change nothing about reading the records', async () => {
  const { out, seen } = await run('How many units are vacant?', { calls: [{ name: 'vacant', args: {} }], reply: '1 unit is vacant: 103.' });
  assert.equal(seen.model, 1);
  assert.equal(out.ownerAction, undefined);
  assert.equal(out.actionHelp, undefined);
  assert.match(out.reply, /1 unit is vacant: 103\./);
});

test('the model is told whether actions are on, and never sees a phone number or a name in a prepare result', async () => {
  const on = await run(SEND_ALL, { calls: [PREPARE_MESSAGE] });
  assert.match(on.seen.sys, /Owner actions are ON for this building/);
  assert.match(on.seen.sys, /prepare_ tool once/);
  assert.equal(JSON.stringify(on.seen.out).includes('PLANTED-PHONE'), false);
  const off = await run('How many units are vacant?', { actionsOn: [] });
  assert.match(off.seen.sys, /Owner actions are OFF for this building/);
});

test('the five prepare tools are declared to the model, beside the read tools', () => {
  const names = agent.tools.map(t => t.function.name);
  for (const n of [...actionTools.NAMES]) assert.ok(names.includes(n), n);
  for (const n of ['unpaid', 'floor', 'find_tenant']) assert.ok(names.includes(n), n);
  const message = agent.tools.find(t => t.function.name === 'prepare_message');
  assert.match(message.function.description, /does NOT send/);
  assert.deepEqual(message.function.parameters.required, ['target', 'text']);
  assert.deepEqual(agent.tools.find(t => t.function.name === 'prepare_payment').function.parameters.properties.method.enum,
    ['CASH', 'TELEBIRR', 'CBE_BIRR', 'BANK_TRANSFER']);
});

test('when server.js passes no action service, a prepare call is a refusal and the owner gets the dashboard answer', async () => {
  const { out, seen } = await run(SEND_ALL, { ownerActions: false, calls: [PREPARE_MESSAGE] });
  assert.equal(out.readOnly, true);
  assert.match(out.reply, /📤 Send/);
  assert.deepEqual(seen.out, { error: 'owner actions are off for this building' });
});

test('"what do you mean?" tells the owner what Bini can answer AND what it can prepare', async () => {
  const on = await run('እሺ አንተ ምንድነው የምትለው?');
  assert.equal(on.out.help, true);
  assert.match(on.out.reply, /✅/);
  const off = await run('ok what do you mean?', { actionsOn: [] });
  assert.equal(off.out.help, true);
  assert.doesNotMatch(off.out.reply, /✅/);
});
