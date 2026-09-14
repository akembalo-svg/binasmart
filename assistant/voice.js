'use strict';
// POST /api/assistant/voice — the microphone on /afiya and /asmat.
//
// Audio in (base64 from the browser's MediaRecorder), transcript out, and nothing else. The transcript is
// not answered here: the page puts it in the input box, the person reads it and sends it, and it arrives at
// /api/afiya or /api/asmat as an ordinary question. So every gate — the emergency answer, the urgent legal
// answer, the scope — applies to a spoken question exactly as it does to a typed one.
//
// /api/assistant/transcribe (the Telegram bot's) stays behind the owner key. This one is public, so:
//   - limits per ip and per uid, checked before anything else, so refused requests cost nothing;
//   - audio is held in memory for this one request and never written anywhere;
//   - neither audio nor transcript is logged; a failure is logged by its kind only.
const ACCEPTED = ['audio/webm', 'audio/ogg', 'audio/mp4'];
const BODY_LIMIT = Math.floor(1.5 * 1024 * 1024); // the route's Fastify bodyLimit; larger bodies get 413 before this code runs
const MAX_AUDIO_CHARS = 1400000;                   // ~1 MB of audio once decoded
const MIN_AUDIO_CHARS = 200;                       // shorter than any real recording
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function baseMime(m) { return String(m || '').split(';')[0].trim().toLowerCase(); }

// The transcriber answers "[unclear]" for silence or noise. Whatever is left must hold at least two
// letters or digits to be worth putting in front of the person.
function cleanTranscript(t) {
  const s = String(t || '').replace(/\[unclear\]/gi, ' ').replace(/\s+/g, ' ').trim();
  return (s.match(/[\p{L}\p{N}]/gu) || []).length >= 2 ? s.slice(0, 1000) : '';
}

function makeVoiceHandler({ transcribe, ipLimit, uidLimit, warn = m => console.warn(m) }) {
  if (typeof transcribe !== 'function' || typeof ipLimit !== 'function' || typeof uidLimit !== 'function')
    throw new Error('makeVoiceHandler needs transcribe, ipLimit and uidLimit');
  return async function voice(req, reply) {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    const uid = typeof b.uid === 'string' ? b.uid.slice(0, 64) : '';
    if (!ipLimit(ip)) return reply.code(429).send({ ok: false, error: 'rate_limited' });
    if (uid && !uidLimit(uid)) return reply.code(429).send({ ok: false, error: 'rate_limited' });
    const audio = typeof b.audio === 'string' ? b.audio : '';
    if (audio.length < MIN_AUDIO_CHARS) return reply.code(400).send({ ok: false, error: 'audio_required' });
    if (audio.length > MAX_AUDIO_CHARS) return reply.code(413).send({ ok: false, error: 'too_large' });
    if (!B64.test(audio)) return reply.code(400).send({ ok: false, error: 'audio_not_base64' });
    const mime = baseMime(b.mime);
    if (!ACCEPTED.includes(mime)) return reply.code(415).send({ ok: false, error: 'unsupported_type' });
    let text;
    try { text = await transcribe(audio, mime); }
    catch (e) { warn('[voice] transcription failed'); return reply.code(502).send({ ok: false, error: 'transcribe_failed' }); }
    const clean = cleanTranscript(text);
    if (!clean) return reply.send({ ok: false, error: 'unclear' });
    return reply.send({ ok: true, text: clean });
  };
}

module.exports = { makeVoiceHandler, cleanTranscript, baseMime, ACCEPTED, BODY_LIMIT, MAX_AUDIO_CHARS, MIN_AUDIO_CHARS };
