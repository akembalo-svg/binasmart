'use strict';
// Asmat through the engine, model scripted: the /api/asmat route's behaviour, one test per rule.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');
const agent = require('../../agents/asmat/rules');

function run(message, { replies = ['ok'] } = {}) {
  const calls = { model: [], logs: [], handovers: [] };
  const handle = makeEngine({
    callModel: async sys => { calls.model.push(sys); return replies[Math.min(calls.model.length - 1, replies.length - 1)]; },
    contextFor: async () => '',
    lang,
    memory: { userKey: () => 'ip:t', log: r => calls.logs.push(r), isMiss: () => false },
    handover: r => { calls.handovers.push(r); return Promise.resolve(true); },
    dropUngrounded, isEval: () => false, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res).then(out => ({ out, calls }));
}

test('a medical emergency on the legal page reaches the ambulance, paged but not logged', async () => {
  const { out, calls } = await run('ልጄ ራሱን ስቶ አልነቃም');
  assert.equal(out.emergency, true);
  assert.equal(out.reply, afiya.emergencyReply('am'));
  assert.equal(calls.model.length, 0);
  assert.equal(calls.logs.length, 0);
  assert.equal(calls.handovers[0].reason, 'Asmat page: possible medical emergency');
});

test('an arrest is answered from code, logged and paged', async () => {
  const { out, calls } = await run('ወንድሜ ታሰረ ፖሊስ ወሰደው');
  assert.equal(out.urgent, true);
  assert.equal(out.reply, asmat.urgentReply('am'));
  assert.equal(calls.model.length, 0);
  assert.deepEqual(calls.logs.map(l => l.tools), [['urgent']]);
  assert.equal(calls.handovers[0].reason, 'Asmat: urgent legal situation');
});

test('a ride question is sent back', async () => {
  const { out, calls } = await run('ከመገናኛ ወደ ቦሌ ራይድ ስንት ነው?');
  assert.equal(out.redirected, true);
  assert.equal(calls.model.length, 0);
});

test('an assessment without the weak side is asked again, and the second answer is used', async () => {
  const first = 'Himanni kun gaarii dha. Waajjira mana murtii deemi.';
  const second = "Wanti si mormuu danda'u: ragaan hin jiru. Waajjira mana murtii deemi.";
  const { out, calls } = await run('himata banuu qabaa?', { replies: [first, second] });
  assert.equal(calls.model.length, 2);
  assert.match(calls.model[0], /THIS MESSAGE ASKS ABOUT THE PERSON OWN CASE/);
  assert.ok(calls.model[1].includes('Your previous answer left out the weak side'));
  assert.ok(calls.model[1].includes(asmat.weaknessLabel('om')));
  assert.ok(out.reply.startsWith(second));
  assert.ok(out.reply.includes(asmat.assessmentCaution('om').trim()));
  assert.ok(!out.reply.includes(asmat.caseNudge('om').trim()), 'it named an office, so no nudge');
  assert.ok(out.reply.endsWith(asmat.disclosure('om')));
  assert.equal(out.urgent, false);
});

test('a draft request gets the template instruction, no retry, no caution, and loses a verdict', async () => {
  const { out, calls } = await run('አቤቱታ ጻፍልኝ', { replies: ['ናሙና ይኸው። You will definitely win this case. ፍርድ ቤት ያቅርቡ።'] });
  assert.equal(calls.model.length, 1);
  assert.match(calls.model[0], /THIS MESSAGE ASKS YOU TO WRITE A DOCUMENT \(kind: /);
  assert.doesNotMatch(out.reply, /definitely win/);
  assert.ok(!out.reply.includes(asmat.assessmentCaution('am').trim()));
  assert.ok(out.reply.endsWith(asmat.disclosure('am')));
});

test('a draft that names no office gets the nudge', async () => {
  const { out } = await run('አቤቱታ ጻፍልኝ', { replies: ['ናሙና ይኸው። ስም፦ ______'] });
  assert.ok(out.reply.includes(asmat.caseNudge('am').trim()));
  assert.ok(out.reply.endsWith(asmat.disclosure('am')));
});

test('an assessment is not nudged, because its caution already names a lawyer (as the route did)', async () => {
  const reply = "Wanti si mormuu danda'u: ragaan hin jiru.";
  const { out } = await run('himata banuu qabaa?', { replies: [reply] });
  assert.ok(out.reply.includes(asmat.assessmentCaution('om').trim()));
  assert.ok(!out.reply.includes(asmat.caseNudge('om').trim()));
  assert.ok(out.reply.endsWith(asmat.disclosure('om')));
});

test('a successful answer is logged under the tool name the stats already use', async () => {
  const { calls } = await run('የቤት ኪራይ ውል የት ይመዘገባል?', { replies: ['በሰነዶች ማረጋገጫ ጽ/ቤት ይመዘገባል።'] });
  assert.deepEqual(calls.logs.map(l => l.tools), [['asmat']]);
});
