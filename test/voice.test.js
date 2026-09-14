'use strict';
// The public voice route. The transcriber is faked: nothing here reaches Gemini, and no audio is real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeVoiceHandler, cleanTranscript, baseMime, MAX_AUDIO_CHARS } = require('../assistant/voice');
const { makeEngine } = require('../assistant/kit/engine');
const { dropUngrounded } = require('../assistant/grounding');
const lang = require('../assistant/lang');
const afiya = require('../assistant/afiya');

// The same shape as hotelLimiter in server.js: a sliding window per key, refusals not counted.
function limiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now); m.set(key, hits); return true;
  };
}
const AUDIO = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFh1f1'.repeat(3);

function harness({ transcript = 'ልጄ ትኩሳት አለበት', fail = false, ipMax = 30, uidMax = 10 } = {}) {
  const calls = { transcribe: [], warns: [] };
  const handler = makeVoiceHandler({
    transcribe: async (b64, mime) => { calls.transcribe.push({ len: b64.length, mime }); if (fail) throw new Error('gemini 400 secret detail'); return transcript; },
    ipLimit: limiter(600000, ipMax), uidLimit: limiter(600000, uidMax),
    warn: m => calls.warns.push(m),
  });
  const post = (body, ip = '10.0.0.1') => {
    const res = { status: 200, body: null, code(n) { this.status = n; return this; }, send(o) { this.body = o; return this; } };
    return handler({ body, headers: { 'x-real-ip': ip }, ip: '127.0.0.1' }, res).then(() => res);
  };
  return { calls, post };
}

test('a recording comes back as text, with the mime reduced to its type', async () => {
  const h = harness();
  const r = await h.post({ audio: AUDIO, mime: 'audio/webm;codecs=opus', uid: 'w1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, text: 'ልጄ ትኩሳት አለበት' });
  assert.deepEqual(h.calls.transcribe, [{ len: AUDIO.length, mime: 'audio/webm' }]);
});

test('Safari (audio/mp4) and Firefox (audio/ogg) recordings are accepted; anything else is 415', async () => {
  const h = harness();
  assert.equal((await h.post({ audio: AUDIO, mime: 'audio/mp4' })).status, 200);
  assert.equal((await h.post({ audio: AUDIO, mime: 'audio/ogg; codecs=opus' })).status, 200);
  const bad = await h.post({ audio: AUDIO, mime: 'video/mp4' });
  assert.equal(bad.status, 415);
  assert.deepEqual(bad.body, { ok: false, error: 'unsupported_type' });
  assert.equal((await h.post({ audio: AUDIO })).status, 415, 'no mime is not a guess');
  assert.equal(h.calls.transcribe.length, 2);
});

test('missing, tiny, oversized or non-base64 audio is refused before transcription', async () => {
  const h = harness();
  assert.equal((await h.post({})).status, 400);
  assert.equal((await h.post({ audio: 'abc', mime: 'audio/webm' })).status, 400);
  assert.equal((await h.post({ audio: 12345, mime: 'audio/webm' })).status, 400);
  const big = await h.post({ audio: 'A'.repeat(MAX_AUDIO_CHARS + 4), mime: 'audio/webm' });
  assert.equal(big.status, 413);
  assert.deepEqual(big.body, { ok: false, error: 'too_large' });
  assert.equal((await h.post({ audio: '<script>'.repeat(40), mime: 'audio/webm' })).status, 400);
  assert.equal(h.calls.transcribe.length, 0);
});

test('silence or noise is "unclear", never an empty question', async () => {
  for (const t of ['[unclear]', '  [UNCLEAR]. ', '', '…', 'a']) {
    const r = await harness({ transcript: t }).post({ audio: AUDIO, mime: 'audio/webm' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: false, error: 'unclear' }, JSON.stringify(t));
  }
  const partial = await harness({ transcript: 'የቤት ኪራይ ውል [unclear] የት ይመዘገባል' }).post({ audio: AUDIO, mime: 'audio/webm' });
  assert.deepEqual(partial.body, { ok: true, text: 'የቤት ኪራይ ውል የት ይመዘገባል' });
});

test('a transcription failure is a clean 502, logged by kind only', async () => {
  const h = harness({ fail: true });
  const r = await h.post({ audio: AUDIO, mime: 'audio/webm' });
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: 'transcribe_failed' });
  assert.deepEqual(h.calls.warns, ['[voice] transcription failed']);
});

test('per-ip limit: the 31st request in ten minutes is 429 and never transcribed', async () => {
  const h = harness();
  for (let i = 0; i < 30; i++) assert.notEqual((await h.post({}, '10.9.9.9')).status, 429, 'call ' + (i + 1));
  const r = await h.post({ audio: AUDIO, mime: 'audio/webm' }, '10.9.9.9');
  assert.equal(r.status, 429);
  assert.deepEqual(r.body, { ok: false, error: 'rate_limited' });
  assert.equal((await h.post({ audio: AUDIO, mime: 'audio/webm' }, '10.9.9.10')).status, 200, 'another ip is unaffected');
  assert.equal(h.calls.transcribe.length, 1);
});

test('per-uid limit: the 11th request from one phone is 429 even from different ips', async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) assert.equal((await h.post({ audio: AUDIO, mime: 'audio/webm', uid: 'phone-1' }, '10.1.0.' + i)).status, 200);
  assert.equal((await h.post({ audio: AUDIO, mime: 'audio/webm', uid: 'phone-1' }, '10.1.1.1')).status, 429);
  assert.equal((await h.post({ audio: AUDIO, mime: 'audio/webm', uid: 'phone-2' }, '10.1.1.1')).status, 200);
});

test('neither the audio nor the transcript is ever written to a log', async () => {
  const seen = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.map(String).join(' '));
  try {
    const secret = 'የግል ጉዳዬ ሚስጥር ነው';
    const h = makeVoiceHandler({ transcribe: async () => secret, ipLimit: () => true, uidLimit: () => true });
    const fails = makeVoiceHandler({ transcribe: async () => { throw new Error('gemini 400 ' + secret); }, ipLimit: () => true, uidLimit: () => true });
    const res = () => ({ code() { return this; }, send(o) { return o; } });
    const req = { body: { audio: AUDIO, mime: 'audio/webm', uid: 'u' }, headers: {}, ip: '1.2.3.4', log: { info: m => seen.push(String(m)), warn: m => seen.push(String(m)), error: m => seen.push(String(m)) } };
    await h(req, res());
    await fails(req, res());
  } finally { Object.assign(console, orig); }
  assert.ok(seen.every(line => !line.includes('ሚስጥር') && !line.includes(AUDIO.slice(0, 40))), seen.join('\n'));
});

test('a spoken emergency still gets 907 from code: the transcript goes through the same gate as typing', async () => {
  const spoken = 'አባቴ ደረቱን ያመዋል እና እየተነፈሰ አይደለም';
  const r = await harness({ transcript: spoken }).post({ audio: AUDIO, mime: 'audio/webm' });
  assert.equal(r.body.ok, true);
  let modelCalls = 0;
  const handle = makeEngine({
    callModel: async () => { modelCalls++; return 'model text'; }, contextFor: async () => '', lang,
    memory: { userKey: () => 'ip:t', log: () => {}, isMiss: () => false }, handover: () => Promise.resolve(false),
    dropUngrounded, isEval: () => false, prisma: { department: { findMany: async () => [] } }, warn: () => {},
  });
  const out = await handle(require('../agents/afiya/rules'), { body: { message: r.body.text }, headers: {}, ip: '10.0.0.1', log: { error() {} } },
    { code() { return this; }, send(o) { return o; } });
  assert.equal(out.emergency, true);
  assert.equal(out.reply, afiya.emergencyReply('am'));
  assert.equal(modelCalls, 0);
});

test('helpers', () => {
  assert.equal(baseMime('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(baseMime(' Audio/MP4 '), 'audio/mp4');
  assert.equal(cleanTranscript('  two   words '), 'two words');
  assert.equal(cleanTranscript('x'.repeat(1500)).length, 1000);
});
