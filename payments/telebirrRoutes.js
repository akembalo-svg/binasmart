'use strict';
// HTTP surface for telebirr payments. One Payment row per order (txRef = telebirr merch_order_id, kind 'telebirr',
// purpose 'cinema' | 'ride' | 'hotel' | 'event' | 'travel', meta = {code}). Settlement always goes through queryOrder,
// never on the notification alone, so a forged notify cannot mark anything paid.
//   POST /api/telebirr/init    { type, code, inApp? }  → { ok, orderId, checkoutUrl | rawRequest }
//   POST /api/telebirr/notify  (telebirr → us)         → confirms via queryOrder, settles
//   GET  /api/telebirr/status/:orderId                  → { ok, status, paid }  (also settles if paid — for the return page)
//   GET  /api/telebirr/health
module.exports = function telebirrRoutes(fastify, { telebirr, prisma, BASE_URL, resolve, settle, OWNER_KEY, log }) {
  const say = log || (m => console.log(m));
  const hits = new Map();
  const rl = (ip, max = 20) => { const now = Date.now(); const a = (hits.get(ip) || []).filter(t => now - t < 600000); if (a.length >= max) return false; a.push(now); hits.set(ip, a); if (hits.size > 5000) hits.clear(); return true; };
  const ip = req => String(req.headers['x-real-ip'] || req.ip);

  async function settlePayment(pay, q) {
    const upd = await prisma.payment.updateMany({ where: { txRef: pay.txRef, status: { not: 'success' } }, data: { status: 'success', meta: JSON.stringify({ ...(safeMeta(pay.meta)), paymentOrderId: q.paymentOrderId, transId: q.transId, transTime: q.transTime }) } });
    if (upd.count === 0) return { ok: true, already: true };
    const meta = safeMeta(pay.meta);
    try { await settle(pay.purpose, meta.code, { orderId: pay.txRef, amount: q.amount, transId: q.transId }); }
    catch (e) { say('[telebirr] settle ' + pay.purpose + ' ' + meta.code + ' failed: ' + e.message); }
    say('[telebirr] paid ' + pay.purpose + ' ' + meta.code + ' order=' + pay.txRef + ' amount=' + q.amount);
    return { ok: true, settled: true };
  }
  const safeMeta = m => { try { return JSON.parse(m || '{}'); } catch (e) { return {}; } };

  fastify.get('/api/telebirr/health', async () => ({ ok: true, enabled: telebirr.enabled, mode: telebirr.mode }));

  // Shared by the HTTP route and by modules (cinema checkout calls it directly). Throws { code, error } on failure.
  async function initFor(type, code, { inApp = false, body = {} } = {}) {
    if (!telebirr.enabled) throw Object.assign(new Error('telebirr_off'), { code: 503, error: 'telebirr_off' });
    type = String(type || '').toLowerCase(); code = String(code || '').trim();
    if (!type || !code) throw Object.assign(new Error('type and code required'), { code: 400, error: 'type and code required' });
    // resolve() knows the business object: returns { amountEtb, title, payable: bool, reason?, redirectPath, phone, name } or null
    const item = await resolve(type, code, body).catch(() => null);
    if (!item) throw Object.assign(new Error('not_found'), { code: 404, error: 'not_found' });
    if (!item.payable) throw Object.assign(new Error(item.reason || 'not_payable'), { code: 409, error: item.reason || 'not_payable' });
    // reuse an open order for the same item (idempotent double taps)
    const open = await prisma.payment.findFirst({ where: { kind: 'telebirr', purpose: type, status: 'pending', meta: { contains: '"code":"' + code + '"' }, createdAt: { gte: new Date(Date.now() - 25 * 60000) } }, orderBy: { createdAt: 'desc' } });
    if (open && !inApp) { const m = safeMeta(open.meta); if (m.checkoutUrl) return { ok: true, orderId: open.txRef, checkoutUrl: m.checkoutUrl, reused: true }; }
    try {
      const o = await telebirr.createOrder({ orderId: require('./telebirr').orderId(type[0].toUpperCase(), code), title: item.title, amountEtb: item.amountEtb, notifyUrl: BASE_URL + '/api/telebirr/notify', redirectUrl: BASE_URL + (item.redirectPath || '/'), tradeType: inApp ? 'InApp' : 'Checkout', callbackInfo: type + ':' + code });
      await prisma.payment.create({ data: { txRef: o.orderId, amount: Number(item.amountEtb), currency: 'ETB', purpose: type, phone: item.phone || null, name: item.name || null, status: 'pending', kind: 'telebirr', meta: JSON.stringify({ code, prepayId: o.prepayId, checkoutUrl: o.checkoutUrl, inApp }) } });
      return inApp ? { ok: true, orderId: o.orderId, rawRequest: o.rawRequest } : { ok: true, orderId: o.orderId, checkoutUrl: o.checkoutUrl };
    } catch (e) {
      say('[telebirr] init ' + type + ' ' + code + ' failed: ' + e.message);
      throw Object.assign(new Error('telebirr_unavailable'), { code: 502, error: 'telebirr_unavailable' });
    }
  }

  fastify.post('/api/telebirr/init', async (req, reply) => {
    if (!rl(ip(req))) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    try { return await initFor(b.type, b.code, { inApp: b.inApp === true || b.inApp === 'true', body: b }); }
    catch (e) { return reply.code(e.code || 500).send({ ok: false, error: e.error || 'failed' }); }
  });

  // telebirr posts here after the customer pays. We answer 200 quickly and confirm through queryOrder.
  fastify.post('/api/telebirr/notify', async (req, reply) => {
    const b = req.body || {};
    const oid = String(b.merch_order_id || '').replace(/[^A-Za-z0-9]/g, '');
    const v = telebirr.verifyNotify(b);
    if (!oid || !v.ok) { say('[telebirr] notify rejected: ' + v.reason); return reply.code(400).send({ code: 1, msg: v.reason }); }
    const pay = await prisma.payment.findUnique({ where: { txRef: oid } });
    if (!pay) return reply.code(404).send({ code: 1, msg: 'unknown order' });
    try {
      const q = await telebirr.queryOrder(oid);
      if (q.paid) await settlePayment(pay, q); else say('[telebirr] notify for ' + oid + ' but status ' + q.orderStatus);
    } catch (e) { say('[telebirr] notify query failed for ' + oid + ': ' + e.message); }
    return { code: 0, msg: 'success' };
  });

  // The return page polls this; it also settles when telebirr says paid but the notification did not arrive.
  fastify.get('/api/telebirr/status/:orderId', async (req, reply) => {
    if (!rl(ip(req), 60)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const oid = String(req.params.orderId || '').replace(/[^A-Za-z0-9]/g, '');
    const pay = await prisma.payment.findUnique({ where: { txRef: oid } });
    if (!pay) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (pay.status === 'success') return { ok: true, status: 'PAY_SUCCESS', paid: true };
    try {
      const q = await telebirr.queryOrder(oid);
      if (q.paid) await settlePayment(pay, q);
      return { ok: true, status: q.orderStatus, paid: q.paid };
    } catch (e) { return reply.code(502).send({ ok: false, error: 'telebirr_unavailable' }); }
  });

  // Return pages: "did my payment for this item go through?" — confirms with telebirr and settles.
  fastify.post('/api/telebirr/confirm', async (req, reply) => {
    if (!rl(ip(req), 30)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {};
    const r = await confirmFor(String(b.type || ''), String(b.code || ''));
    return r.ok ? r : reply.code(404).send(r);
  });

  // Ops: recent online payments (telebirr + Chapa) for the ride-ops page (owner key).
  fastify.get('/api/telebirr/ops/list', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
    const rows = await prisma.payment.findMany({ where: { createdAt: { gte: new Date(Date.now() - days * 86400000) } }, orderBy: { createdAt: 'desc' }, take: 150 });
    const list = rows.map(p => { const m = safeMeta(p.meta); return { orderId: p.txRef, kind: p.kind === 'telebirr' ? 'telebirr' : (p.kind || 'chapa'), purpose: p.purpose, code: m.code || null, amount: p.amount, currency: p.currency, status: p.status, phone: p.phone, name: p.name, createdAt: p.createdAt, paymentOrderId: m.paymentOrderId || null, transId: m.transId || null, refund: m.refund || null }; });
    const sum = (f) => list.filter(f).reduce((a, x) => a + (x.amount || 0), 0);
    return { ok: true, days, count: list.length, paidEtb: sum(x => x.status === 'success'), pending: list.filter(x => x.status === 'pending').length, payments: list };
  });

  // Ops: refund a paid order (owner key).
  fastify.post('/api/telebirr/refund', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) return reply.code(401).send({ ok: false, error: 'unauthorized' });
    const b = req.body || {}; const oid = String(b.orderId || '').replace(/[^A-Za-z0-9]/g, '');
    const pay = await prisma.payment.findUnique({ where: { txRef: oid } });
    if (!pay || pay.status !== 'success') return reply.code(404).send({ ok: false, error: 'no_paid_order' });
    try {
      const r = await telebirr.refund({ merchOrderId: oid, amountEtb: b.amountEtb || pay.amount, reason: b.reason });
      await prisma.payment.update({ where: { txRef: oid }, data: { status: r.status === 'REFUND_SUCCESS' ? 'refunded' : 'refunding', meta: JSON.stringify({ ...safeMeta(pay.meta), refund: r }) } });
      return { ok: true, ...r };
    } catch (e) { return reply.code(502).send({ ok: false, error: e.message.slice(0, 160) }); }
  });

  // For return pages: find the pending order of an item, ask telebirr, settle if paid. { ok, paid, status }
  async function confirmFor(type, code) {
    const pays = await prisma.payment.findMany({ where: { kind: 'telebirr', purpose: String(type), meta: { contains: '"code":"' + String(code) + '"' } }, orderBy: { createdAt: 'desc' }, take: 3 });
    if (!pays.length) return { ok: false, error: 'no_payment' };
    if (pays.some(p => p.status === 'success')) return { ok: true, paid: true, status: 'PAY_SUCCESS', already: true };
    for (const pay of pays) {
      try { const q = await telebirr.queryOrder(pay.txRef); if (q.paid) { await settlePayment(pay, q); return { ok: true, paid: true, status: 'PAY_SUCCESS' }; } }
      catch (e) { say('[telebirr] confirm ' + pay.txRef + ': ' + e.message); }
    }
    return { ok: true, paid: false, status: 'WAIT_PAY' };
  }
  return { initFor, settlePayment, confirmFor };
};
