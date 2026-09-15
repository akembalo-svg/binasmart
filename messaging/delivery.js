'use strict';
// One road for every message to a tenant (owner actions and messaging design §1).
//
// 1. Telegram, if the tenant linked @bina_smart_bot (free).  2. SMS to an Ethiopian mobile the provider can reach.
// 3. Not delivered, with the reason. Never two channels for one message: if Telegram refuses, the same row becomes the
// SMS attempt (errorKind tg_failed). WhatsApp is not on this road.
//
// Only a REAL building (in NOTIFY_WHITELIST and not a demo — server.js decides) can reach anyone; for any other
// building every row is `test` and nothing is called. SMS also needs SMS_MODE=live (messaging/sms.js) and room in the
// building's monthly limit: a batch that needs more parts than remain is refused whole, not half-sent.
//
//   plan({ building, recipients })                              preview, writes nothing (Plan B's confirm card)
//   sendToTenants({ building, kind, source, actor, text, recipients })
//   sendTransactionalSms({ to, text, label, kind, source, live })   Plan D sign-in codes: no building, text never stored
//   applyDeliveryReport(body) / reportShape(body) / readReport(body)
//
// Every SMS text starts with its label (messaging/sms.js labelled): no label, no SMS. The provider's default shortcode is
// used until a sender name is approved (building.smsSender, max 11 characters).
//
// building  { id, slug, real, smsLabel, smsMonthlyLimit, smsSender }
// recipient { tenancyId, userId, telegramChatId, phone, text, smsText, invoiceId }   (phone is used, never stored)
const { normalizeEtMobile, smsParts, SMS_MAX_CHARS, labelled, smsUnitPrice, DEFAULT_PRICE_TIERS } = require('./sms');

// What uses up a building's monthly SMS limit (and sets the price tier): SMS that went or may have gone. A `test` row
// never counts, in any mode, so test-mode runs cannot fill a real building's month before SMS goes live.
const COUNTED = ['queued', 'sent', 'delivered'];
// Whether a tenant already had an SMS (for the one-time Telegram link): in test mode a test row counts as had.
const HAD_SMS_TEST = ['queued', 'sent', 'delivered', 'test'];
const DELIVERED = ['sent', 'delivered'];
// Logs name an error by its kind (Prisma code or error name), never its message: messages can carry phone numbers.
const errKind = e => String((e && (e.code || e.name)) || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';

// The first instant of this calendar month in Addis Ababa (UTC+3, no daylight saving), as a Date.
function addisMonthStart(now = new Date()) {
  const d = new Date(now.getTime() + 3 * 3600000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 3 * 3600000);
}

// The owner's daily report says how many tenant messages were not delivered. Only a real failure counts: the building is
// real and SMS is live, and the send failed (no channel, Telegram refused with no SMS, the limit, the provider) or the
// layer threw. In test mode nothing counts, whatever the row says, so a test run adds no "not delivered" line.
function isRealMiss(ctx, result) {
  if (!ctx || ctx.real !== true || ctx.mode !== 'live') return false;
  if (!result) return true;
  return result.status === 'failed';
}

function makeDeliveryStore(prisma) {
  return {
    createBatch: data => prisma.outboundBatch.create({ data, select: { id: true } }),
    createMessage: data => prisma.outboundMessage.create({ data, select: { id: true } }),
    updateMessage: (id, data) => prisma.outboundMessage.update({ where: { id }, data, select: { id: true } }),
    smsPartsSinceAll: async (since, statuses) => (await prisma.outboundMessage.aggregate({
      where: { channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } }))._sum.smsParts || 0,
    smsPartsSince: async (buildingId, since, statuses) => (await prisma.outboundMessage.aggregate({
      where: { buildingId, channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } }))._sum.smsParts || 0,
    userHadSms: async (userId, statuses) => !!(await prisma.outboundMessage.findFirst({ where: { userId, channel: 'sms', status: { in: statuses } }, select: { id: true } })),
    markByProvider: async (ids, status) => (await prisma.outboundMessage.updateMany({
      where: { providerId: { in: ids }, channel: 'sms', status: { in: ['queued', 'sent'] } }, data: { status } })).count,
  };
}

function makeDelivery({ store, sendTg, sms, now = () => new Date(), botUsername = 'bina_smart_bot', priceTiers = DEFAULT_PRICE_TIERS, log = () => {} }) {
  const counted = () => COUNTED;
  const hadSmsStatuses = () => (sms.mode === 'live' ? DELIVERED : HAD_SMS_TEST);

  // The first SMS a tenant receives ends with the building's Telegram start link (design §2), if it still fits.
  // `seen` holds the users who already got the link in this batch: a tenant with two units gets it once.
  async function smsTextFor(building, r, seen) {
    const base = labelled(building.smsLabel, String(r.smsText || r.text || ''));
    if (!building.slug || !r.userId || (seen && seen.has(r.userId)) || await store.userHadSms(r.userId, hadSmsStatuses())) return base;
    const hinted = base + '\nTelegram: t.me/' + botUsername + '?start=tenant_' + building.slug;
    if (hinted.length > SMS_MAX_CHARS) return base;
    if (seen) seen.add(r.userId);
    return hinted;
  }

  function noneReason(r) {
    if (!r.phone) return 'no_contact';
    return normalizeEtMobile(r.phone) ? 'sms_unsupported_number' : 'no_mobile';
  }

  async function plan({ building, recipients }, seen = new Set()) {
    const rows = [];
    let parts = 0;
    for (const r of recipients || []) {
      const tenancyId = r.tenancyId || null;
      if (r.telegramChatId) rows.push({ tenancyId, channel: 'telegram', smsParts: 0 });
      else if (sms.supports(r.phone)) {
        const smsText = await smsTextFor(building, r, seen);
        const n = smsParts(smsText);
        parts += n;
        rows.push({ tenancyId, channel: 'sms', smsParts: n, smsText });
      } else rows.push({ tenancyId, channel: 'none', smsParts: 0, errorKind: noneReason(r) });
    }
    const limit = Math.max(0, Math.floor(Number(building.smsMonthlyLimit) || 0));
    const used = await store.smsPartsSince(building.id, addisMonthStart(now()), counted());
    const remaining = Math.max(0, limit - used);
    const count = ch => rows.filter(x => x.channel === ch).length;
    // Estimate only: the tier is chosen by this month's SMS parts across the whole account plus this send.
    const accountUsed = parts ? await store.smsPartsSinceAll(addisMonthStart(now()), counted()) : 0;
    const unitPriceEtb = smsUnitPrice(accountUsed + parts, priceTiers);
    return { rows, counts: { telegram: count('telegram'), sms: count('sms'), none: count('none') },
      smsParts: parts, used, limit, remaining, withinLimit: parts <= remaining, mode: building.real ? sms.mode : 'test',
      unitPriceEtb, costEtb: Math.round(parts * unitPriceEtb * 100) / 100 };
  }

  async function sendToTenants({ building, kind, source, actor = null, text = null, recipients }) {
    const list = Array.isArray(recipients) ? recipients : [];
    const seen = new Set();
    const p = await plan({ building, recipients: list }, seen);
    const batch = await store.createBatch({ buildingId: building.id, kind, source, actor, text: kind === 'notice' ? String(text || '') : null, total: list.length });
    const counts = { telegram: 0, sms: 0, none: 0, sent: 0, test: 0, failed: 0 };
    const results = [];
    const base = r => ({ batchId: batch.id, buildingId: building.id, tenancyId: r.tenancyId || null, userId: r.userId || null, invoiceId: r.invoiceId || null, kind });
    const result = (r, messageId, channel, status, errorKind) => ({ tenancyId: r.tenancyId || null, channel, status, errorKind: errorKind || null, messageId });
    const tally = res => {
      results.push(res);
      counts[res.channel]++;
      if (DELIVERED.includes(res.status)) counts.sent++; else if (res.status === 'test') counts.test++; else counts.failed++;
    };

    if (!p.withinLimit) {
      for (const r of list) {
        const m = await store.createMessage({ ...base(r), channel: 'none', status: 'failed', errorKind: 'sms_limit' });
        tally(result(r, m.id, 'none', 'failed', 'sms_limit'));
      }
      return { ok: false, error: 'sms_limit', batchId: batch.id, needed: p.smsParts, remaining: p.remaining, counts, results };
    }

    let remaining = p.remaining;
    const sendSms = async (r, messageId, smsText, n, carried) => {
      let s;
      try { s = await sms.send({ to: r.phone, text: smsText, sender: building.smsSender || '', live: building.real === true }); }
      catch (e) { s = { status: 'failed', errorKind: 'provider_error' }; }
      if (s.status === 'sent' || s.status === 'test') remaining -= n;
      const errorKind = carried || s.errorKind || null;
      await store.updateMessage(messageId, { channel: 'sms', status: s.status, smsParts: n, providerId: s.providerId || null, errorKind });
      return result(r, messageId, 'sms', s.status, errorKind);
    };
    // made.id is the record created for this recipient, so an error after it can still close it as failed.
    const create = async (made, data) => { const m = await store.createMessage(data); made.id = m.id; return m; };
    const deliverOne = async (r, row, made) => {
      if (row.channel === 'none') {
        const m = await create(made, { ...base(r), channel: 'none', status: 'failed', errorKind: row.errorKind });
        return result(r, m.id, 'none', 'failed', row.errorKind);
      }
      if (row.channel === 'sms') {
        const m = await create(made, { ...base(r), channel: 'sms', status: 'queued', smsParts: row.smsParts });
        return sendSms(r, m.id, row.smsText, row.smsParts, null);
      }
      if (building.real !== true) {
        const m = await create(made, { ...base(r), channel: 'telegram', status: 'test' });
        return result(r, m.id, 'telegram', 'test');
      }
      const m = await create(made, { ...base(r), channel: 'telegram', status: 'queued' });
      let ok = false;
      try { ok = (await sendTg(r.telegramChatId, String(r.text || ''))) === true; } catch (e) { ok = false; }
      if (ok) { await store.updateMessage(m.id, { status: 'sent' }); return result(r, m.id, 'telegram', 'sent'); }
      const smsText = sms.supports(r.phone) ? await smsTextFor(building, r, seen) : null;
      const n = smsText ? smsParts(smsText) : 0;
      if (!smsText || n > remaining) {
        await store.updateMessage(m.id, { status: 'failed', errorKind: 'tg_failed' });
        return result(r, m.id, 'telegram', 'failed', 'tg_failed');
      }
      return sendSms(r, m.id, smsText, n, 'tg_failed');
    };

    for (let i = 0; i < list.length; i++) {
      let res;
      const made = { id: null };
      try { res = await deliverOne(list[i], p.rows[i], made); }
      catch (e) {
        log('[delivery] error: ' + errKind(e));
        if (made.id) {
          try { await store.updateMessage(made.id, { status: 'failed', errorKind: 'error' }); }
          catch (e2) { log('[delivery] error: ' + errKind(e2)); }
        }
        res = result(list[i], made.id, p.rows[i].channel, 'failed', 'error');
      }
      tally(res);
    }
    return { ok: counts.failed === 0, batchId: batch.id, counts, results };
  }

  async function sendTransactionalSms({ to, text, label, kind = 'otp', source = 'transactional', live = true } = {}) {
    const body = labelled(label, text);   // throws before anything is written when the label is missing
    const batch = await store.createBatch({ buildingId: null, kind, source, actor: null, text: null, total: 1 });
    const base = { batchId: batch.id, buildingId: null, tenancyId: null, userId: null, invoiceId: null, kind };
    if (!sms.supports(to)) {
      const errorKind = noneReason({ phone: to });
      const m = await store.createMessage({ ...base, channel: 'none', status: 'failed', errorKind });
      return { status: 'failed', channel: 'none', errorKind, messageId: m.id };
    }
    const m = await store.createMessage({ ...base, channel: 'sms', status: 'queued', smsParts: smsParts(body) });
    let s;
    try { s = await sms.send({ to, text: body, live: live === true }); } catch (e) { s = { status: 'failed', errorKind: 'provider_error' }; }
    // The send has happened: a failed record write must not turn it into a throw (a sign-in caller would send a second
    // code). The row then stays queued, which counts as an SMS that may have gone.
    try { await store.updateMessage(m.id, { status: s.status, providerId: s.providerId || null, errorKind: s.errorKind || null }); }
    catch (e) { log('[delivery] error: ' + errKind(e)); }
    return { status: s.status, channel: 'sms', errorKind: s.errorKind || null, messageId: m.id };
  }

  // The report payload is not documented; these are the field names seen in SMS gateways and GeezSMS's send reply.
  // Checked in this order, "undelivered" is a failure, not a delivery.
  function readReport(body) {
    const b = body && typeof body === 'object' ? body : {};
    const ids = ['api_log_id', 'log', 'message_id', 'id'].map(k => b[k]).filter(v => v != null && v !== '').map(v => String(v).slice(0, 100));
    const raw = String(b.status || b.delivery_status || b.dlr_status || b.message_status || '').toLowerCase();
    const status = /undeliver|fail|reject|expire|error/.test(raw) ? 'failed' : /deliver/.test(raw) ? 'delivered' : null;
    return { ids, status };
  }
  async function applyDeliveryReport(body) {
    const { ids, status } = readReport(body);
    if (!ids.length || !status) return 0;
    return store.markByProvider(ids, status);
  }
  function reportShape(body) {
    const b = body && typeof body === 'object' ? body : {};
    return Object.keys(b).slice(0, 30).map(k => String(k).replace(/[^\w.-]/g, '').slice(0, 40) + ':'
      + (Array.isArray(b[k]) ? 'array' : b[k] === null ? 'null' : typeof b[k])).join(',');
  }

  return { plan, sendToTenants, sendTransactionalSms, applyDeliveryReport, readReport, reportShape };
}

module.exports = { makeDelivery, makeDeliveryStore, addisMonthStart, isRealMiss };
