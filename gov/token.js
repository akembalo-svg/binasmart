'use strict';
// The frame token: a question to /api/w/<office>/ask must come from a frame we served for that office in the
// last two hours. HMAC-SHA256 with GOV_FRAME_SECRET (32+ characters, in .env). It proves "a frame of ours
// was loaded", not "a person is here": the frame can be fetched by any script. The limits in gov/meter.js
// are what cap a script. Nothing here logs a token.
const crypto = require('crypto');

const MIN_SECRET = 32;
const TTL_MS = 2 * 3600 * 1000;
const sign = (body, secret) => crypto.createHmac('sha256', String(secret)).update(body).digest('base64url');

function mintFrameToken(office, { secret = process.env.GOV_FRAME_SECRET || '', now = Date.now, ttlMs = TTL_MS } = {}) {
  if (String(secret).length < MIN_SECRET) return null;
  const body = Buffer.from(JSON.stringify({ o: String(office), e: now() + ttlMs, n: crypto.randomBytes(6).toString('base64url') })).toString('base64url');
  return body + '.' + sign(body, secret);
}

function verifyFrameToken(token, office, { secret = process.env.GOV_FRAME_SECRET || '', now = Date.now } = {}) {
  if (String(secret).length < MIN_SECRET) return false;
  if (typeof token !== 'string' || token.length > 400) return false;
  const m = /^([A-Za-z0-9_-]{8,300})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const want = Buffer.from(sign(m[1], secret)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
  let p;
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return false; }
  return !!p && p.o === String(office) && Number(p.e) > now();
}

module.exports = { mintFrameToken, verifyFrameToken, TTL_MS, MIN_SECRET };
