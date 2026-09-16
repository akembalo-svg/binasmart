'use strict';
// The sign-in code's one road out: sendTransactionalSms in messaging/delivery.js — the transactional
// path Plan C opened. No building, no batch of tenants, no quiet hours, no monthly limit, and the text
// is never stored, so the code is not written into OutboundBatch.text either. An OutboundMessage row
// with buildingId null records that a code was asked for, on which channel, and what became of it —
// never the code and never the number beyond what the row already holds.
//
// Nothing leaves the server unless SMS_MODE is live AND a provider token is configured: in test mode
// messaging/sms.js returns { status: 'test' } and the provider is never called. That is how every live
// check in this plan is run without an SMS reaching anybody.
//
//   makePhoneCodeSender({ prisma, env, delivery, sms, log })
//     .send({ phone, code })  → { ok, status: 'sent' | 'test' | 'failed', errorKind }
//     .configured             // both switches on — this is what the login page's phone door is built from
//     .supports(raw)          // can the provider reach this number at all (+2519 yes, +2517 no)
//     .mode                   // 'live' | 'test'
const { makeSmsFromEnv } = require('../messaging/sms');
const { makeDelivery, makeDeliveryStore } = require('../messaging/delivery');
const { codeText, SMS_LABEL } = require('./phone-code');

// Prisma codes and error names only. A message can carry a phone number; a kind cannot.
const errKind = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';

function makePhoneCodeSender({ prisma = null, env = process.env, delivery = null, sms = null, log = () => {} } = {}) {
  const smsLayer = sms || makeSmsFromEnv(env, { log });
  // sendTg is required by makeDelivery but is never reached: sendTransactionalSms has no Telegram branch.
  const road = delivery || makeDelivery({ store: makeDeliveryStore(prisma), sendTg: async () => false, sms: smsLayer, log });
  const configured = !!env.SMS_API_TOKEN && String(env.SMS_MODE) === 'live';

  async function send({ phone, code } = {}) {
    let r;
    try {
      r = await road.sendTransactionalSms({ to: phone, text: codeText(code), label: SMS_LABEL, kind: 'signin', source: 'phone-code', live: true });
    } catch (e) {
      log('[phone-code] sender ' + errKind(e));
      return { ok: false, status: 'failed', errorKind: 'sender_error' };
    }
    const status = (r && r.status) || 'failed';
    // A test row is a success here on purpose: the sign-in flow must behave identically in test mode,
    // or the thing exercised before go-live is not the thing that goes live.
    return { ok: status === 'sent' || status === 'test', status, errorKind: (r && r.errorKind) || null };
  }

  return { send, configured, mode: smsLayer.mode, supports: raw => smsLayer.supports(raw) };
}

module.exports = { makePhoneCodeSender };
