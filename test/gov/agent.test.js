'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const { makeOfficeAgent, soulFor } = require('../../gov/agent');
const { excludeFor } = require('../../gov/registry');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const office = { tenant, ops: null, exclude: excludeFor(tenant) };
const agent = makeOfficeAgent(office);

function run(message, { reply = 'Under Proclamation No. 1389/2025 a worker needs a medical examination.', ctx = '' } = {}) {
  const calls = { model: [], logs: [], handovers: [], ctxOpts: [] };
  const handle = makeEngine({
    callModel: async sys => { calls.model.push(sys); return reply; },
    contextFor: async (q, o) => { calls.ctxOpts.push(o); return ctx; },
    lang, memory: { userKey: () => 'k', log: r => calls.logs.push(r), isMiss: () => false },
    handover: r => { calls.handovers.push(r); return Promise.resolve(); },
    dropUngrounded, isEval: () => false, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return handle(agent, { body: { message, user: { uid: 'u1' } }, headers: {}, ip: '10.0.0.1' }, res).then(out => ({ out, calls }));
}

test('the definition has what the engine requires, and never logs', () => {
  for (const k of ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback']) assert.ok(agent[k] != null, k);
  assert.equal(agent.name, 'gov-mols');
  assert.equal(agent.log, false);
  assert.equal(agent.sourceDetail, true);
  assert.equal(agent.sourceMax, 3);
});

test('the prompt says it is not the ministry, carries the notes and the dating rule', () => {
  const s = soulFor(tenant);
  assert.match(s, /NOT the Ministry of Labour and Skills/);
  assert.match(s, /UNSIGNED DRAFT/);
  assert.match(s, /civil service commission/);
  assert.ok(s.includes(require('../../assistant/dating').SHARED.trim().slice(0, 60)), 'dating rule');
});

test('retrieval gets the allow-list exclusions and the preferred pages', async () => {
  const { calls } = await run('What does the medical examination for overseas work cover?');
  const o = calls.ctxOpts[0];
  assert.ok(o.exclude.includes('web') && o.exclude.includes('business:mols-agencies*'));
  assert.ok(o.prefer.includes('law:overseas-employment-proclamation-1389-2025*'));
});

test('an answer is marked answered and carries no log', async () => {
  const { out, calls } = await run('What does the medical examination for overseas work cover?');
  assert.equal(out.answered, true);
  assert.equal(calls.model.length, 1);
  assert.equal(calls.logs.length, 0);
});

test('a medical emergency gets the ambulance with no model, no log, no page', async () => {
  const { out, calls } = await run('He is unconscious and not breathing');
  assert.equal(out.emergency, true);
  assert.equal(out.ambulance, afiya.AMBULANCE);
  assert.equal(out.answered, undefined);
  assert.equal(calls.model.length + calls.logs.length + calls.handovers.length, 0);
});

test('danger abroad is urgent, names the police, and shows only approved contacts', async () => {
  const { out, calls } = await run('My sister in Saudi Arabia is locked in and her passport was taken');
  assert.equal(out.urgent, true);
  assert.match(out.reply, /991/);
  assert.match(out.reply, /embassy/i);
  assert.ok(!out.reply.includes('671792'), 'mols-main is not approved yet (Y5)');
  assert.equal(calls.model.length, 0);
  const approved = makeOfficeAgent({ ...office, tenant: { ...tenant, contacts: tenant.contacts.map(c => ({ ...c, approved: true })) } });
  assert.match(approved.gates.find(g => g.id === 'danger').answer({ l: 'en', msg: '' }).body.reply, /\+251116671792/);
});

test('agency look-ups, own records, legal advice and politics are refused without a model', async () => {
  const cases = [
    ['What is the phone number of Selam employment agency?', 'agency', /mols\.gov\.et\/agencies/],
    ['What is the status of my Labor ID application?', 'records', /bina\.et\/lmis-labor-id-ethiopia/],
    ['Is my contract legal? They pay 1000 riyal a month', 'advice', /legal advice/],
    ['Who should I vote for in the election?', 'politics', /./],
  ];
  for (const [q, kind, re] of cases) {
    const { out, calls } = await run(q);
    assert.equal(out.redirected, true, q);
    assert.equal(out.refused, kind, q);
    assert.match(out.reply, re, q);
    assert.equal(calls.model.length, 0, q);
  }
});

test('a mobile number the model writes is removed, the rest of the answer stays', async () => {
  const { out } = await run('agencies general question about overseas work rules', {
    reply: 'Overseas work needs a contract approved by the Ministry. Call 0900000016 for help.',
    ctx: 'Overseas work needs a contract approved by the Ministry.' });
  assert.ok(!/0900000016/.test(out.reply));
  assert.match(out.reply, /contract approved/);
});

test('an empty model reply becomes the fallback and is not billable', async () => {
  const { out } = await run('What does the medical examination for overseas work cover?', { reply: '' });
  assert.equal(out.answered, false);
  assert.match(out.reply, /mols\.gov\.et/);
});

test('Amharic questions get Amharic fixed answers', async () => {
  const { out } = await run('የሰላም ኤጀንሲ ስልክ ቁጥር ስጠኝ');
  assert.equal(out.refused, 'agency');
  assert.match(out.reply, /ኤጀንሲ/);
});
