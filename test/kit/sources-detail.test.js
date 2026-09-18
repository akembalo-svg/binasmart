'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourcesFrom } = require('../../assistant/kit/sources');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');

const CTX = [
  '## Relevant BinaSmart knowledge (…)',
  '[1] Overseas Employment Proclamation No. 1389/2025 — https://example.gov.et/1389.pdf',
  'Source: Federal Negarit Gazette — https://example.gov.et/1389.pdf — fetched 2026-09-17 (checked 2026-09-18)',
  'Article 17 text …',
  '',
  '[2] Overseas Employment Proclamation No. 1389/2025 — https://example.gov.et/1389.pdf',
  'Article 19 text …',
  '',
  '[3] Work permits — https://example.gov.et/permit',
  'ምንጭ፦ የሥራና ክህሎት ሚኒስቴር — https://example.gov.et/permit — የተወሰደበት ቀን 2026-09-14',
  'text',
  '',
  '[4] A page with no source line — https://example.org/x',
  'text',
].join('\n');

test('without detail, the shape is exactly what it always was', () => {
  assert.deepEqual(sourcesFrom(CTX), [
    { title: 'Overseas Employment Proclamation No. 1389/2025', url: 'https://example.gov.et/1389.pdf' },
    { title: 'Work permits', url: 'https://example.gov.et/permit' },
  ]);
});

test('with detail, each source carries its publisher and fetched date when the context has them', () => {
  assert.deepEqual(sourcesFrom(CTX, 3, { detail: true }), [
    { title: 'Overseas Employment Proclamation No. 1389/2025', url: 'https://example.gov.et/1389.pdf', publisher: 'Federal Negarit Gazette', fetched: '2026-09-17' },
    { title: 'Work permits', url: 'https://example.gov.et/permit', publisher: 'የሥራና ክህሎት ሚኒስቴር', fetched: '2026-09-14' },
    { title: 'A page with no source line', url: 'https://example.org/x' },
  ]);
});

test('the engine asks for detail only when the agent says so', async () => {
  const run = async agentExtra => {
    const handle = makeEngine({
      callModel: async () => 'An answer.', contextFor: async () => CTX, lang,
      memory: { userKey: () => 'k', log: () => {}, isMiss: () => false }, handover: () => Promise.resolve(),
      dropUngrounded, isEval: () => false, warn: () => {},
    });
    const agent = Object.assign({ name: 't', soul: 's', gates: [], inScope: () => true, redirect: () => 'r',
      finish: (c, t) => t, fallback: () => 'f', log: false }, agentExtra);
    const res = { code() { return this; }, send(o) { return o; } };
    return handle(agent, { body: { message: 'overseas employment medical examination' }, headers: {}, ip: '10.0.0.1' }, res);
  };
  const plain = await run({});
  assert.equal(plain.sources.length, 2);
  assert.equal(plain.sources[0].fetched, undefined);
  const detailed = await run({ sourceDetail: true, sourceMax: 3 });
  assert.equal(detailed.sources.length, 3);
  assert.equal(detailed.sources[0].fetched, '2026-09-17');
});
