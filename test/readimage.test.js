'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeImageReader, PROMPT, OK_MIME, redactSecrets } = require('../assistant/readimage');

const B64 = 'iVBORw0KGgoAAAANSUhEUg'.repeat(8);   // long enough to pass the route's length floor

function fake(reply) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { status: reply.status || 200, json: async () => reply.body };
  };
  return { f, calls };
}
const ok = text => ({ body: { candidates: [{ content: { parts: [{ text }] } }] } });

test('the photograph and the prompt are sent together, image first', async () => {
  const { f, calls } = fake(ok('ይህ ሰነድ የንግድ ፈቃድ ይመስላል።'));
  const read = makeImageReader({ apiKey: 'k', fetchImpl: f });
  const out = await read(B64, 'image/jpeg');
  assert.equal(out, 'ይህ ሰነድ የንግድ ፈቃድ ይመስላል።');
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType, 'image/jpeg');
  assert.equal(parts[0].inlineData.data, B64);
  assert.equal(parts[1].text, PROMPT);
});

test("the person's own question is passed through, trimmed", async () => {
  const { f, calls } = fake(ok('...'));
  const read = makeImageReader({ apiKey: 'k', fetchImpl: f });
  await read(B64, 'image/png', '  ይህ ደብዳቤ ምን ይላል?  ');
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.match(parts[2].text, /ይህ ደብዳቤ ምን ይላል\?/);
});

test('an empty question adds no part at all', async () => {
  const { f, calls } = fake(ok('...'));
  await makeImageReader({ apiKey: 'k', fetchImpl: f })(B64, 'image/jpeg', '   ');
  assert.equal(calls[0].body.contents[0].parts.length, 2);
});

// The instruction that keeps a photograph from becoming a verdict.
test('the prompt forbids saying a document is genuine, and forbids guessing characters', () => {
  assert.match(PROMPT, /Never say whether the document is genuine/);
  assert.match(PROMPT, /only the issuing office can confirm it/);
  assert.match(PROMPT, /never guess a digit, a name or a date/);
  assert.match(PROMPT, /Never give legal, medical or financial advice/);
});

// Learned the hard way on 2026-09-20: a screenshot handed to this reader contained live R2 credentials
// and the reading printed the secret key in full. People photograph screens, and screens hold secrets.
test('the prompt forbids reading out passwords, keys and card numbers', () => {
  assert.match(PROMPT, /NEVER read out a secret/);
  assert.match(PROMPT, /API key/);
  assert.match(PROMPT, /should be changed/);
});

test('a PDF or a video is refused before any request is made', async () => {
  const { f, calls } = fake(ok('...'));
  const read = makeImageReader({ apiKey: 'k', fetchImpl: f });
  await assert.rejects(() => read(B64, 'application/pdf'), /unsupported_type/);
  assert.equal(calls.length, 0, 'nothing is sent for a type we cannot read');
  assert.ok(OK_MIME.has('image/heic'), 'iPhone photos are HEIC and must be accepted');
});

test('a model error becomes a thrown error, never an empty answer presented as a reading', async () => {
  const bad = fake({ status: 503, body: { error: { message: 'overloaded' } } });
  await assert.rejects(() => makeImageReader({ apiKey: 'k', fetchImpl: bad.f })(B64, 'image/jpeg'), /gemini 503/);
  const empty = fake(ok('   '));
  await assert.rejects(() => makeImageReader({ apiKey: 'k', fetchImpl: empty.f })(B64, 'image/jpeg'), /empty_reading/);
});

test('no key configured fails loudly rather than silently returning nothing', async () => {
  await assert.rejects(() => makeImageReader({ apiKey: '' })(B64, 'image/jpeg'), /no_gemini_key/);
});

// The model printed a live secret key and then claimed it had not (2026-09-20). Code has the last word.
test('secrets are masked on the way out, whatever the model said', () => {
  const t = redactSecrets('Access Key ID: 7984e6aba32dc51ed66e40742451fdcd\n'
    + 'Secret Access Key: f73193efc07b196c1478a3ac0363b98894e1cb260ff3dac3676f2593ce76b662');
  assert.doesNotMatch(t, /7984e6aba32dc51ed66e40742451fdcd/);
  assert.doesNotMatch(t, /f73193efc07b196c/);
  assert.match(t, /not repeated/);
});

test('ordinary document numbers survive redaction', () => {
  const t = redactSecrets('TIN: 0012345678 · ስልክ: +251900000024 · ደረሰኝ ቁጥር 4471 · ታርጋ B48778');
  assert.match(t, /0012345678/);
  assert.match(t, /\+251900000024/);
  assert.match(t, /4471/);
  assert.match(t, /B48778/);
});

test('a reading passes through the mask before it is returned', async () => {
  const { f } = fake(ok('Secret Access Key: f73193efc07b196c1478a3ac0363b98894e1cb260ff3dac3676f2593ce76b662'));
  const out = await makeImageReader({ apiKey: 'k', fetchImpl: f })(B64, 'image/jpeg');
  assert.doesNotMatch(out, /f73193efc07b196c/);
});
