'use strict';
// Two things the evaluation set needs the office to do (2026-09-18):
// 1. Long Amharic answers were cut off mid-word at 700 tokens. The office's limit comes from gov/tenants.json and is
//    set from the measurement; the engine never returns an office answer that the limit cut mid-word.
// 2. Afaan Oromoo is off (Y8): a question in Oromo is told, without a model, that the office answers in Amharic and English.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const { makeOfficeAgent, soulFor } = require('../../gov/agent');
const { excludeFor } = require('../../gov/registry');
const { isComplete } = require('../../ops/gov/score');

const tenant = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gov', 'tenants.json'), 'utf8')).tenants.find(t => t.id === 'mols');
const agentFor = t => makeOfficeAgent({ tenant: t, ops: null, exclude: excludeFor(t) });

// Measured 2026-09-18 on the office agent (probe-ca-1/2): three Amharic answers cut at 700 tokens held 1,032 to 1,161
// characters, i.e. about 1.5 characters a token. The longest complete Amharic answer to the 40 questions was 1,332
// characters (Q1). A model that honours max_tokens at that rate is simulated below.
// The dry run of 2026-09-18 (ops/gov/eval.js, office agent, concise prompt) confirmed it: Q1 took 1,099 completion
// tokens for 1,656 characters (1.51 a token), finish "stop" — already past the old limit of 700.
const AM_CHARS_PER_TOKEN = 1.5;
const LONGEST_AM_CHARS = 1332;
const MEASURED_MAX_TOKENS = 1099;

function engineWith(modelText) {
  const seen = { maxTokens: [], model: 0 };
  const handle = makeEngine({
    callModel: async (sys, msgs, maxTokens) => {
      seen.model++; seen.maxTokens.push(maxTokens);
      const cap = Math.floor(maxTokens * AM_CHARS_PER_TOKEN);
      return modelText.length > cap ? modelText.slice(0, cap) : modelText;   // what a token limit does: cut anywhere
    },
    contextFor: async () => '', lang,
    memory: { userKey: () => 'k', log: () => { throw new Error('no log'); }, isMiss: () => false },
    handover: () => { throw new Error('no page'); }, dropUngrounded, isEval: () => false, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return { seen, ask: (agent, message) => handle(agent, { body: { message, user: { uid: 'u' } }, headers: {}, ip: '10.0.0.1' }, res) };
}

// An Amharic answer half as long again as the longest measured, with no digits (grounding would drop them).
const SENTENCE = 'ሠራተኛው ወደ ውጭ አገር ከመሄዱ በፊት የሕክምና ምርመራ ማድረግ እና የቅድመ ጉዞ ሥልጠና መውሰድ አለበት። ';
const LONG_AM = SENTENCE.repeat(Math.ceil(LONGEST_AM_CHARS * 1.5 / SENTENCE.length)).trim();

test('the office limit is read from gov/tenants.json and reaches the model', async () => {
  assert.ok(Number.isInteger(tenant.maxTokens), 'maxTokens in tenants.json');
  assert.ok(tenant.maxTokens >= MEASURED_MAX_TOKENS * 1.8, 'at least 1.8 times the longest answer measured');
  const agent = agentFor(tenant);
  assert.equal(agent.maxTokens, tenant.maxTokens);
  const e = engineWith('Under Proclamation No. 1389/2025 a worker needs a medical examination.');
  await e.ask(agent, 'What does the medical examination for overseas work cover?');
  assert.deepEqual(e.seen.maxTokens, [tenant.maxTokens]);
  const noLimit = JSON.parse(JSON.stringify(tenant)); delete noLimit.maxTokens;
  assert.equal(agentFor(noLimit).maxTokens, 700, 'an office without a limit keeps the engine default');
});

test('the longest Amharic answer, and half again, is never returned cut mid-word', async () => {
  assert.ok(LONG_AM.length >= LONGEST_AM_CHARS * 1.5);
  const e = engineWith(LONG_AM);
  const out = await e.ask(agentFor(tenant), 'ለሥራ ወደ ሳውዲ አረቢያ ለመሄድ ምን ማሟላት አለብኝ?');
  assert.equal(out.answered, true);
  assert.ok(/።$/.test(out.reply), 'ends with a full stop: ' + out.reply.slice(-20));
  assert.equal(isComplete(out.reply), true);
  assert.equal(out.reply.length, LONG_AM.length);
});

test('at the old limit of 700 the same answer is cut mid-word, and the runner check sees it', async () => {
  const old = JSON.parse(JSON.stringify(tenant)); old.maxTokens = 700;
  const out = await engineWith(LONG_AM).ask(agentFor(old), 'ለሥራ ወደ ሳውዲ አረቢያ ለመሄድ ምን ማሟላት አለብኝ?');
  assert.equal(isComplete(out.reply), false, 'cut: ' + out.reply.slice(-20));
});

test('the prompt asks for a concise answer that finishes every sentence', () => {
  const s = soulFor(tenant);
  assert.match(s, /at most about 200 words/);
  assert.match(s, /Finish every sentence/);
});

test('a question in Afaan Oromoo is told, without a model, that the office answers in Amharic and English (Y8)', async () => {
  const e = engineWith('should not be called');
  const out = await e.ask(agentFor(tenant), 'Hojiif gara Saawudii Arabiyaa deemuuf maal gochuu qaba?');
  assert.equal(e.seen.model, 0);
  assert.equal(out.redirected, true);
  assert.equal(out.refused, 'language');
  assert.match(out.reply, /Amharic and English/);
  assert.match(out.reply, /በአማርኛ/);
  // an emergency in any language still gets the emergency answer first
  const em = await e.ask(agentFor(tenant), 'He collapsed, he is unconscious and not breathing');
  assert.equal(em.emergency, true);
  // Amharic and English questions are not touched by it
  for (const q of ['What is the retirement age for private sector employees in Ethiopia?', 'የወሊድ ፈቃድ ስንት ቀን ነው?'])
    assert.notEqual((await engineWith('Proclamation No. 1156/2019 applies.').ask(agentFor(tenant), q)).refused, 'language', q);
});

test('none of the 40 gold questions is mistaken for Afaan Oromoo', () => {
  const gold = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'gov', 'gold', 'mols.json'), 'utf8'));
  for (const g of gold) assert.notEqual(lang.detect(g.q), 'om', 'Q' + g.n);
});
