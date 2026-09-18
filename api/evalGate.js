'use strict';
// Who may say "this request is evaluation traffic".
//
// `x-binasmart-eval: 1` does two things: it keeps the harnesses out of the memory and handover paths,
// and - server.js:1045 - it changes the key the per-user memory and the limiter are counted under. Until
// 2026-09-18 anybody could send it, which meant anybody could step out of being counted by adding one
// header. It is now the owner key, or loopback.
//
// Loopback counts because every harness that sets the header (ops/bini/amharic-eval.js,
// ops/health/afiya-eval.js, ops/law/asmat-eval.js, ops/oromo-eval.js, ops/owner/eval.js) runs ON the
// server against http://127.0.0.1:PORT, so they keep working untouched and no key has to be written
// into a script. Requests that arrived through nginx always carry X-Forwarded-For (bina.et's
// `location /` adds it after any client copy), so an outside caller can never look like loopback.

const LOOPBACK = /^(::ffff:)?127\.\d+\.\d+\.\d+$|^::1$/;

function evalAllowed(req, ownerKey) {
  const h = (req && req.headers) || {};
  if (String(h['x-binasmart-eval'] || '') !== '1') return false;
  if (ownerKey && String(h['x-owner-key'] || '') === String(ownerKey)) return true;
  return !h['x-forwarded-for'] && LOOPBACK.test(String((req && req.ip) || ''));
}

module.exports = { evalAllowed };
