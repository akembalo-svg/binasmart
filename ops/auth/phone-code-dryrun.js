'use strict';
// A live check of the whole sign-in road, on the real server, with nothing leaving it.
//
// It refuses to run while SMS_MODE is live, so it CANNOT send an SMS to anybody. Everything else is
// real: the real Prisma client, the real delivery layer, the real sender, the real flow, the real
// hashing. What it proves is the part a test with doubles cannot — that asking for a code ON THIS
// SERVER writes a hashed auth_verification row and an outbound_message row, and that the stored value
// is a hash rather than six digits.
//
//   node ops/auth/phone-code-dryrun.js
//
// The number is 0900000001, which belongs to nobody. Only `send` is ever run, never `verify`, so no
// account is created and no number is ever proven by this script. The verification row it writes is
// deleted again before it exits.
const crypto = require('crypto');
const pc = require('../../auth/phone-code');
const { makePhoneCodeSender } = require('../../auth/phone-code-sender');
const { makePhoneCodeFlow } = require('../../auth/phone-code-flow');
const { normPhone } = require('../../ride/phone');

const TEST_PHONE = '0900000001';

async function run({ prisma, env, out = console.log } = {}) {
  if (String(env.SMS_MODE) === 'live') {
    out('refusing: SMS_MODE is live, and this check must never be able to send');
    return { ok: false, error: 'sms_live' };
  }
  const sender = makePhoneCodeSender({ prisma, env, log: m => out(m) });
  // `configured` is false in test mode by design. The dry run forces it so the flow can be exercised;
  // nothing can leave anyway, because messaging/sms.js never calls the provider unless SMS_MODE is live.
  const forced = Object.assign({}, sender, { configured: true });
  const pepper = crypto.randomBytes(24).toString('hex');   // for this run only; never the real one
  const flow = makePhoneCodeFlow({
    pepper, normalise: normPhone, sender: forced, log: m => out(m),
    linkPhone: async () => { throw new Error('the dry run never verifies a code'); },
    store: {
      find: id => prisma.authVerification.findFirst({ where: { identifier: id }, orderBy: { createdAt: 'desc' } }),
      create: v => prisma.authVerification.create({ data: { id: crypto.randomUUID(), identifier: v.identifier, value: v.value, expiresAt: v.expiresAt } }),
      remove: id => prisma.authVerification.deleteMany({ where: { identifier: id } }),
      findUserByPhone: async () => null,
      createUser: async () => { throw new Error('the dry run never creates an account'); }
    }
  });

  const id = pc.identifierFor(normPhone(TEST_PHONE));
  await prisma.authVerification.deleteMany({ where: { identifier: id } });

  const r = await flow.send({ phone: TEST_PHONE, ip: '127.0.0.1' });
  out('send · ' + JSON.stringify(r));

  const row = await prisma.authVerification.findFirst({ where: { identifier: id }, orderBy: { createdAt: 'desc' } });
  const un = row ? pc.unpackValue(row.value) : null;
  out('verification row · ' + (row ? 'yes' : 'NO'));
  out('the stored value is a 64-character hash, not a code · ' + (un && /^[0-9a-f]{64}$/.test(un.hash) ? 'yes' : 'NO'));
  out('wrong attempts recorded · ' + (un ? un.attempts : '-'));
  out('expires in seconds · ' + (row ? Math.round((new Date(row.expiresAt).getTime() - Date.now()) / 1000) : '-'));

  const msg = await prisma.outboundMessage.findFirst({ where: { kind: 'signin' }, orderBy: { createdAt: 'desc' },
    select: { channel: true, status: true, errorKind: true, buildingId: true, smsParts: true } });
  out('outbound row · ' + JSON.stringify(msg));

  await prisma.authVerification.deleteMany({ where: { identifier: id } });
  const left = await prisma.authVerification.count({ where: { identifier: id } });
  out('cleaned up · ' + (left === 0 ? 'yes' : 'NO'));

  return { ok: !!row && !!msg && left === 0, send: r };
}

if (require.main === module) {
  require('dotenv/config');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run({ prisma, env: process.env })
    .then(r => prisma.$disconnect().then(() => process.exit(r.ok ? 0 : 1)))
    .catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, TEST_PHONE };
