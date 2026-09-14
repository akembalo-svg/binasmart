'use strict';
// The public voice route is assistant/voice.js with the production transcriber and limits. Pinned by reading
// server.js, like test/kit/wiring.test.js: a real request to it sends audio to be transcribed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('/api/assistant/voice is the tested handler, with its own body limit', () => {
  assert.ok(src.includes("fastify.post('/api/assistant/voice', { bodyLimit: VOICE_BODY_LIMIT }, voiceHandler);"));
  assert.ok(src.includes("const { makeVoiceHandler, BODY_LIMIT: VOICE_BODY_LIMIT } = require('./assistant/voice');"));
  assert.ok(src.includes('const voiceHandler = makeVoiceHandler({ transcribe: biniTranscribe, ipLimit: voiceIpRL, uidLimit: voiceUidRL });'));
  assert.ok(src.includes('const voiceIpRL = hotelLimiter(600000, 30), voiceUidRL = hotelLimiter(600000, 10);'));
  assert.ok(src.indexOf('const biniTranscribe = ') < src.indexOf('const voiceHandler = '), 'the transcriber exists before the handler is built');
  assert.ok(src.indexOf('function hotelLimiter(') < src.indexOf('const voiceIpRL = '));
  assert.equal(src.split("'/api/assistant/voice'").length - 1, 1, 'one voice route');
});

test('the Telegram transcribe route still requires the owner key', () => {
  const at = src.indexOf("fastify.post('/api/assistant/transcribe'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('\n});', at));
  assert.match(body, /!== OWNER_KEY\) return reply\.code\(401\)/);
});
