'use strict';
// How many questions one person may ask /afiya and /asmat. This is abuse protection during launch, not the
// free plan's daily limit (that comes with accounts). It is checked by the engine AFTER the gates and the
// scope check, so an emergency or urgent answer and a redirect are never counted and never refused.
//
// Keys: the phone's uid when the page sends one, and the address nginx saw (X-Real-IP). The address limit is
// high because Ethio Telecom puts many phones behind one address. Port 4210 listens on 127.0.0.1 only, so a
// request without X-Real-IP from loopback is our own evaluation script on the server; it is not counted.
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

function makeAgentLimit({ ipLimit, uidLimit }) {
  if (typeof ipLimit !== 'function' || typeof uidLimit !== 'function')
    throw new Error('makeAgentLimit needs ipLimit and uidLimit');
  return req => c => {
    const real = req.headers && req.headers['x-real-ip'];
    if (!real && LOOPBACK.includes(String(req.ip))) return true;
    const uid = c && c.user && typeof c.user.uid === 'string' ? c.user.uid.slice(0, 64) : '';
    if (uid && !uidLimit(uid)) return false;
    return ipLimit(String(real || req.ip || ''));
  };
}

module.exports = { makeAgentLimit, LOOPBACK };
