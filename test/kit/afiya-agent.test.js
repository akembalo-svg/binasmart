'use strict';
// Dr Afiya through the engine, model scripted. Each test is one behaviour of the /api/afiya route as it
// stood before the kit; together they are the definition of "unchanged".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const agent = require('../../agents/afiya/rules');

function run(message, { replies = ['ok'], departments = [], throwModel = false } = {}) {
  const calls = { model: [], logs: [], handovers: [] };
  const handle = makeEngine({
    callModel: async sys => { calls.model.push(sys); if (throwModel) throw new Error('down'); return replies[Math.min(calls.model.length - 1, replies.length - 1)]; },
    contextFor: async () => '',
    lang,
    memory: { userKey: () => 'ip:t', log: r => calls.logs.push(r), isMiss: () => false },
    handover: r => { calls.handovers.push(r); return Promise.resolve(true); },
    dropUngrounded,
    isEval: () => false,
    prisma: { department: { findMany: async () => departments } },
    warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res).then(out => ({ out, calls }));
}

test('an emergency gets 907 from code, a human is paged, and the model is never asked', async () => {
  const { out, calls } = await run('አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም');
  assert.equal(out.emergency, true);
  assert.equal(out.ambulance, afiya.AMBULANCE);
  assert.equal(out.reply, afiya.emergencyReply('am'));
  assert.equal(calls.model.length, 0);
  assert.deepEqual(calls.logs.map(l => l.tools), [['emergency']]);
  assert.equal(calls.handovers[0].reason, 'Dr Afiya: possible emergency');
});

test('an urgent legal situation at the health desk gets the legal answer, unlogged and unpaged', async () => {
  const { out, calls } = await run('ወንድሜ ታሰረ ፖሊስ ወሰደው');
  assert.equal(out.urgent, true);
  assert.equal(calls.model.length, 0);
  assert.equal(calls.logs.length, 0);
  assert.equal(calls.handovers.length, 0);
});

test('a ride question is sent back to Bini', async () => {
  const { out, calls } = await run('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?');
  assert.equal(out.redirected, true);
  assert.equal(calls.model.length, 0);
});

test('a clinical question is answered, the dose is removed, and the disclosure closes it', async () => {
  const { out, calls } = await run('qoricha maal fudhadhu?', { replies: ['Fudhadhu 500 mg guyyaatti. Kutaa dhukkuba keessaa deemi.'] });
  assert.equal(calls.model.length, 1);
  assert.match(calls.model[0], /THIS MESSAGE ASKS YOU TO DIAGNOSE, PRESCRIBE OR REASSURE/);
  assert.match(calls.model[0], /ambulance 907, police 991, fire 939/);
  assert.doesNotMatch(out.reply, /500 mg/);
  assert.match(out.reply, /Kutaa dhukkuba/);
  assert.ok(out.reply.endsWith(afiya.disclosure('om')));
  assert.equal(out.emergency, false);
});

test('a clinical answer that names no department gets the nudge', async () => {
  const { out } = await run('qoricha maal fudhadhu?', { replies: ['Fudhadhu 500 mg guyyaatti.'] });
  assert.ok(out.reply.startsWith(afiya.clinicalNudge('om').trim()));
});

test('repeating the demo hospital without saying so appends the demo notice', async () => {
  const departments = [{ name: 'Pediatrics', nameAm: 'የሕፃናት ክፍል', nameOm: null, floor: 1, room: '101', fee: 150, openHours: null }];
  const { out, calls } = await run('ልጄ ትኩሳት አለበት', { departments, replies: ['ወደ Pediatrics ይሂዱ።'] });
  assert.match(calls.model[0], /DEMO DATA/);
  assert.ok(out.reply.includes(afiya.demoNotice('am').trim()));
  assert.ok(out.reply.endsWith(afiya.disclosure('am')));
});

test('a department fee from the demo data is grounded; an invented one is not', async () => {
  const departments = [{ name: 'Pediatrics', nameAm: null, nameOm: null, floor: 1, room: '101', fee: 150, openHours: null }];
  let r = await run('ልጄ ትኩሳት አለበት', { departments, replies: ['ክፍያው 150 ብር ነው። ወደ Pediatrics ይሂዱ።'] });
  assert.match(r.out.reply, /150 ብር/);
  r = await run('ልጄ ትኩሳት አለበት', { departments, replies: ['ክፍያው 990 ብር ነው። ወደ Pediatrics ይሂዱ።'] });
  assert.doesNotMatch(r.out.reply, /990/);
});

test('when the model fails, the reply still carries the ambulance number', async () => {
  const { out } = await run('ልጄ ትኩሳት አለበት', { throwModel: true });
  assert.match(out.reply, /907/);
  assert.ok(out.reply.startsWith(afiya.disclosure('am')));
});

test('a successful answer is logged under the tool name the stats already use', async () => {
  const { calls } = await run('qoricha maal fudhadhu?', { replies: ['Kutaa dhukkuba keessaa deemi.'] });
  assert.deepEqual(calls.logs.map(l => l.tools), [['afiya']]);
});

test('a failing department query still gets an answer, not the fallback', async () => {
  const calls = { model: [] };
  const handle = makeEngine({
    callModel: async sys => { calls.model.push(sys); return 'ወደ ጤና ጣቢያ ይሂዱ።'; },
    contextFor: async () => '', lang,
    memory: { userKey: () => 'ip:t', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(true), dropUngrounded, isEval: () => false, warn: () => {},
    prisma: { department: { findMany: async () => { throw new Error('db down'); } } },
  });
  const res = { code() { return this; }, send(o) { return o; } };
  const out = await handle(agent, { body: { message: 'ልጄ ትኩሳት አለበት' }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res);
  assert.equal(calls.model.length, 1);
  assert.doesNotMatch(calls.model[0], /DEMO DATA/);
  assert.match(out.reply, /ጤና ጣቢያ/);
  assert.equal(out.emergency, false);
});
