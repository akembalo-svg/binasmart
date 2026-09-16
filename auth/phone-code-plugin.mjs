// better-auth plugin: sign in with a code sent by SMS.
//
// Two endpoints, the same shape as the Telegram door beside it:
//   POST /api/auth/sign-in/phone-code/send     { phone }         -> { ok: true }
//   POST /api/auth/sign-in/phone-code/verify   { phone, code }   -> { ok: true, ... } and the session cookie
//
// Everything that decides anything lives in auth/phone-code-flow.js. This file is the glue and only
// the glue: better-auth's adapters become that flow's `store`, and its refusals become HTTP statuses.
// Keeping it this thin is what lets the whole door be tested without booting better-auth.
//
// better-auth 1.6.24 does ship a phoneNumber plugin. It is not used, for four reasons written down in
// the plan: it stores the code in clear in auth_verification, its schema wants a second pair of
// columns beside the phone / phoneVerifiedAt this site already has, its code flow reports OTP_EXPIRED
// and INVALID_OTP and TOO_MANY_ATTEMPTS separately, and its rate limit cannot be keyed on X-Real-IP.
import { createAuthEndpoint, APIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pc = require('./phone-code.js');
const { makePhoneCodeFlow } = require('./phone-code-flow.js');
const { normPhone } = require('../ride/phone.js');
const { makeIdentity } = require('./identity.js');

// Behind nginx every request arrives from 127.0.0.1, so the socket address is the same for everybody.
// x-real-ip is set by nginx and a client cannot append to it; server.js reads it the same way.
function clientIp(ctx) {
  try { return String((ctx && ctx.headers && ctx.headers.get && ctx.headers.get('x-real-ip')) || ''); } catch (e) { return ''; }
}

// One sentence for every way a code can fail. The login page turns it into Amharic and English.
const NO = 'That code is wrong or has expired';

// Guessing is counted twice. auth/phone-code.js counts the wrong answers against ONE number and
// locks it for fifteen minutes; that alone would let one address walk a thousand numbers, five
// guesses each. So the verify door is also limited per address, on the same header nginx sets.
const VERIFY_IP_WINDOW_MS = 10 * 60 * 1000;
const VERIFY_IP_MAX = 30;

export const phoneCode = (options = {}) => {
  let flow = null;
  // Built here and not per request, for the same reason the flow is: a limiter rebuilt on every
  // request limits nothing.
  const verifyIpLimit = pc.makeCodeLimiter({ windowMs: VERIFY_IP_WINDOW_MS, max: VERIFY_IP_MAX });
  // Built once, on the first request, and kept for the life of the process: the two limiters ARE the
  // rate limit, and a limiter rebuilt per request limits nothing. ctx.context is the auth context —
  // the same object on every request — so closing over its adapters is safe.
  const flowFor = (ctx) => {
    if (flow) return flow;
    const ia = ctx.context.internalAdapter;
    const identity = options.identity || makeIdentity({ prisma: options.prisma });
    flow = makePhoneCodeFlow({
      pepper: options.pepper || process.env.AUTH_PHONE_CODE_PEPPER || '',
      normalise: normPhone,
      sender: options.sender,
      linkPhone: (userId, phone) => identity.setVerifiedPhone(userId, phone, 'sms'),
      log: options.log || (m => console.log(m)),
      store: {
        find: id => ia.findVerificationValue(id),
        create: v => ia.createVerificationValue(v),
        remove: id => ia.deleteVerificationByIdentifier(id),
        findUserByPhone: phone => ctx.context.adapter.findOne({ model: 'user', where: [{ field: 'phone', value: phone }] }),
        createUser: u => ia.createUser({ ...u, emailVerified: false })
      }
    });
    return flow;
  };

  return {
    id: 'phone-code',
    endpoints: {
      sendPhoneCode: createAuthEndpoint('/sign-in/phone-code/send', {
        method: 'POST',
        body: z.object({ phone: z.string().max(24) })
      }, async (ctx) => {
        const r = await flowFor(ctx).send({ phone: ctx.body.phone, ip: clientIp(ctx) });
        if (r.ok) return ctx.json({ ok: true });
        if (r.error === 'not_configured') throw new APIError('SERVICE_UNAVAILABLE', { message: 'phone sign-in is not configured' });
        if (r.error === 'not_reachable') throw new APIError('BAD_REQUEST', { message: 'not_reachable' });
        throw new APIError('TOO_MANY_REQUESTS', { message: 'rate_limited' });
      }),
      verifyPhoneCode: createAuthEndpoint('/sign-in/phone-code/verify', {
        method: 'POST',
        body: z.object({ phone: z.string().max(24), code: z.string().max(12) })
      }, async (ctx) => {
        if (!verifyIpLimit(clientIp(ctx))) throw new APIError('TOO_MANY_REQUESTS', { message: 'rate_limited' });
        const r = await flowFor(ctx).verify({ phone: ctx.body.phone, code: ctx.body.code });
        if (!r.ok) throw new APIError('UNAUTHORIZED', { message: NO });
        const session = await ctx.context.internalAdapter.createSession(r.user.id);
        if (!session) throw new APIError('UNAUTHORIZED', { message: NO });
        // The same thirty-day cookie every other door sets — nothing special about this one.
        await setSessionCookie(ctx, { session, user: r.user });
        // Nothing here is anything the page did not already have: never the code, never the full
        // number, never the account's e-mail address.
        return ctx.json({ ok: true, isRegister: !!r.isRegister,
          user: { id: r.user.id, name: r.user.name, phone: pc.maskPhone(normPhone(ctx.body.phone)) } });
      })
    }
  };
};

export default phoneCode;
