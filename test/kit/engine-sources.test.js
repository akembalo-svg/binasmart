'use strict';
// The engine returns the documents an answer's knowledge came from, for the chat page's "From:" line.
// Additive only: an answer with no numbered documents, a gate, a redirect and a fallback look exactly as
// they did, so every response-shape assertion in engine.test.js and the agent tests keeps holding.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const asmat = require('../../assistant/asmat');

const DOCS = '## Relevant BinaSmart knowledge (facts here override anything you remember; cite the page link when useful)\n'
  + '[1] Health Centre Requirements — http://www.moh.gov.et/\nA health centre has an outpatient department.\n\n'
  + '[2] Addis Ababa — https://bina.et/living-working-in-ethiopia-guide\nAmbulance 907.\n\n'
  + '[3] Fayda — https://bina.et/fayda\nFayda text';

function harness({ context = DOCS, reply = 'Go to the outpatient department.', throwModel = false, l = null } = {}) {
  const calls = { contexts: 0, model: 0 };
  const handle = makeEngine({
    callModel: async () => { calls.model++; if (throwModel) throw new Error('down'); return reply; },
    contextFor: async () => { calls.contexts++; return context; },
    lang: l || { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:t', log: () => {}, isMiss: () => false },
    handover: () => Promise.resolve(false),
    dropUngrounded, isEval: () => false, prisma: { department: { findMany: async () => [] } }, warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return { calls, ask: (agent, message) => handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res) };
}
const base = o => Object.assign({ name: 'demo', soul: 'S', gates: [], inScope: () => true, redirect: () => 'elsewhere',
  finish: (c, t) => t, fallback: () => 'sorry' }, o);

test('an answer carries the first two documents its knowledge came from', async () => {
  const h = harness();
  const out = await h.ask(base({ okFlags: { emergency: false } }), 'which department?');
  assert.deepEqual(out, { reply: 'Go to the outpatient department.', emergency: false, sources: [
    { title: 'Health Centre Requirements', url: 'http://www.moh.gov.et/' },
    { title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide' },
  ] });
});

test('no numbered documents means no sources key at all: the old response shape', async () => {
  const out = await harness({ context: 'fee 50 birr' }).ask(base({ okFlags: { emergency: false } }), 'hi there');
  assert.deepEqual(out, { reply: 'Go to the outpatient department.', emergency: false });
});

test('an agent that reads no documents returns no sources, and the owner agent is one', async () => {
  const h = harness();
  const out = await h.ask(base({ knowledge: false }), 'rent?');
  assert.deepEqual(out, { reply: 'Go to the outpatient department.' });
  assert.equal(h.calls.contexts, 0);
  assert.equal(require('../../agents/owner/rules').knowledge, false);
});

test('gates, redirects and fallbacks never carry sources', async () => {
  const gate = { test: () => true, answer: () => ({ body: { reply: 'call 907', emergency: true } }) };
  assert.deepEqual(await harness().ask(base({ gates: [gate] }), 'x'), { reply: 'call 907', emergency: true });
  assert.deepEqual(await harness().ask(base({ inScope: () => false }), 'x'), { reply: 'elsewhere', redirected: true });
  assert.deepEqual(await harness({ throwModel: true }).ask(base(), 'x'), { reply: 'sorry' });
});

test('Dr Afiya: the reply text is the same with or without sources; an emergency still has none', async () => {
  const agent = require('../../agents/afiya/rules');
  const q = 'ልጄ ትኩሳት አለበት፣ የትኛው ክፍል ልሂድ?';
  const withDocs = await harness({ l: lang, reply: 'ወደ ተመላላሽ ክፍል ይሂዱ።' }).ask(agent, q);
  const without = await harness({ l: lang, reply: 'ወደ ተመላላሽ ክፍል ይሂዱ።', context: '' }).ask(agent, q);
  assert.equal(withDocs.reply, without.reply);
  assert.equal(withDocs.emergency, false);
  assert.equal(withDocs.sources.length, 2);
  assert.ok(withDocs.reply.endsWith(afiya.disclosure('am')));
  const sos = await harness({ l: lang }).ask(agent, 'አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም');
  assert.equal(sos.emergency, true);
  assert.equal('sources' in sos, false);
});

test('Asmat: an ordinary answer carries sources and still ends with the disclosure', async () => {
  const agent = require('../../agents/asmat/rules');
  const out = await harness({ l: lang, reply: 'በሰነዶች ማረጋገጫ ጽ/ቤት ይመዘገባል።' }).ask(agent, 'የቤት ኪራይ ውል የት ነው የሚመዘገበው?');
  assert.equal(out.urgent, false);
  assert.equal(out.sources.length, 2);
  assert.ok(out.reply.endsWith(asmat.disclosure('am')));
});
