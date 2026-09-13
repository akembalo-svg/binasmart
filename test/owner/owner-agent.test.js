'use strict';
// The owner agent through the engine. The model is scripted and calls tools through the same opts.execute
// callBini provides, so these tests cover the real path from question to figure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const agent = require('../../agents/owner/rules');
const { fakePrisma } = require('./fixture');

function run(message, { calls: toolCalls = [], reply = 'ok', scope = { buildingIds: ['b1'] }, throwModel = false } = {}) {
  const seen = { model: 0, logs: [], audits: [], handovers: [], toolOuts: [], buildingQueries: [] };
  const { prisma } = fakePrisma();
  const findBuildings = prisma.building.findMany;
  prisma.building.findMany = async q => { seen.buildingQueries.push(q); return findBuildings(q); };
  const handle = makeEngine({
    callModel: async (sys, messages, max, opts) => {
      seen.model++; seen.sys = sys;
      if (throwModel) throw new Error('down');
      for (const c of toolCalls) if (opts && opts.execute) seen.toolOuts.push(await opts.execute(c.name, c.args || {}));
      return reply;
    },
    contextFor: async () => { throw new Error('the owner agent must not search documents'); },
    lang, dropUngrounded, isEval: () => false, prisma,
    memory: { userKey: () => 'ip:t', log: r => seen.logs.push(r), isMiss: () => false },
    handover: r => { seen.handovers.push(r); return Promise.resolve(true); },
    audit: (buildingId, action, detail) => seen.audits.push({ buildingId, action, detail }),
    warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res, { scope, channel: 'owner-web' })
    .then(async out => { await new Promise(r => setImmediate(r)); return { out, seen }; });
}

test('a fire in the building still gets the emergency answer from code', async () => {
  const { out, seen } = await run('There is a fire in the building and someone is not breathing');
  assert.ok(afiya.isEmergency('There is a fire in the building and someone is not breathing'), 'precondition');
  assert.equal(out.emergency, true);
  assert.equal(seen.model, 0);
  assert.equal(seen.handovers[0].reason, 'Owner Bini: possible emergency');
});

test('a request to change something gets the read-only answer and no model call', async () => {
  for (const q of ['Mark unit 101 as paid', 'Please change the rent of 102 to 25000', 'send a reminder to unit 102', 'የ101 ክፍያ መዝግብልኝ', 'የ102 ኪራይ ቀይር']) {
    const { out, seen } = await run(q);
    assert.equal(out.readOnly, true, q);
    assert.equal(seen.model, 0, q);
  }
});

test('questions that only read are not mistaken for changes', async () => {
  for (const q of ['Send me the list of unpaid units', 'ያልከፈሉትን ዝርዝር ላክልኝ', 'How much rent was paid in July?', 'Did the rent change last year?']) {
    const { out } = await run(q);
    assert.equal(out.readOnly, undefined, q);
  }
});

test('without a scope nothing is read', async () => {
  const { out, seen } = await run('How is my building?', { scope: null });
  assert.equal(seen.model, 0);
  assert.match(out.reply, /building|ህንፃ/);
});

test('a figure from the tools is kept, an invented one is dropped, and the records date closes the answer', async () => {
  const { out, seen } = await run('How much was invoiced in July?', {
    calls: [{ name: 'rent_month', args: { month: '2026-07' } }],
    reply: 'In July 30,000 birr was invoiced. You also collected 99,999 birr from parking.' });
  assert.match(out.reply, /30,000 birr/);
  assert.doesNotMatch(out.reply, /99,999/);
  assert.ok(out.reply.endsWith('📅 Records: newest invoice 2026-07-01, newest recorded payment 2026-07-03.'));
  assert.match(seen.sys, /Today is \d{4}-\d{2}-\d{2}/);
});

test('an Amharic question gets the records line in Amharic', async () => {
  const { out } = await run('በሐምሌ ስንት ብር ተከፍሏል?', { calls: [{ name: 'rent_month', args: { month: '2026-07' } }], reply: 'በሐምሌ 10,000 ብር ተከፍሏል።' });
  assert.match(out.reply, /10,000 ብር/);
  assert.ok(out.reply.endsWith('📅 መዝገቡ፦ የመጨረሻው ደረሰኝ 2026-07-01፣ የመጨረሻው የተመዘገበ ክፍያ 2026-07-03።'));
});

test('an answer with no tool call cannot state a figure', async () => {
  const { out } = await run('How much did I collect?', { reply: 'You collected 45,000 birr.' });
  assert.doesNotMatch(out.reply, /45,000/);
  assert.doesNotMatch(out.reply, /📅/);
});

test('the answer is audited, never chat-logged', async () => {
  const { seen } = await run('How much was invoiced in July?', { calls: [{ name: 'rent_month', args: { month: '2026-07' } }], reply: 'ok' });
  assert.equal(seen.logs.length, 0);
  assert.equal(seen.audits.length, 1);
  assert.equal(seen.audits[0].buildingId, 'b1');
  assert.equal(seen.audits[0].action, 'OWNER_BINI_Q');
  assert.match(seen.audits[0].detail, /^owner-web · rent_month · How much was invoiced in July\?/);
});

test('the tools only ever see the scope the route gave', async () => {
  const { out, seen } = await run('Tell me about unit 101', { calls: [{ name: 'unit', args: { number: '101', building: 'somewhere else' } }], reply: 'ok' });
  assert.equal(typeof out.reply, 'string');
  // the model naming another building gets nothing, and the one load was scoped by the route's buildingIds
  assert.deepEqual(seen.toolOuts, [{ error: 'no such building for this owner' }]);
  assert.equal(seen.buildingQueries.length, 1);
  assert.deepEqual(seen.buildingQueries[0].where, { id: { in: ['b1'] } });
  // control: the same call without a building name finds the unit in the scoped building
  const ok = await run('Tell me about unit 101', { calls: [{ name: 'unit', args: { number: '101' } }], reply: 'ok' });
  assert.equal(ok.seen.toolOuts.length, 1);
  assert.equal(ok.seen.toolOuts[0].buildings.length, 1);
  assert.equal(ok.seen.toolOuts[0].buildings[0].building, 'Test Plaza');
  assert.equal(ok.seen.toolOuts[0].buildings[0].found, true);
  assert.equal(ok.seen.toolOuts[0].buildings[0].number, '101');
});

test('a model failure gets the dashboard fallback', async () => {
  const { out } = await run('ስንት ክፍል ባዶ ነው?', { throwModel: true });
  assert.equal(out.reply, 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ዳሽቦርዱን ይመልከቱ።');
});

test('the owner soul is public and says it reads and changes nothing', () => {
  assert.match(agent.soul, /change nothing|changes nothing/);
  assert.match(agent.soul, /tool result/);
});
