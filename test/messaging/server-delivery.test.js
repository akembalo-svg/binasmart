'use strict';
// server.js starts a listener on require, so its wiring is pinned by reading it, as test/kit/wiring.test.js does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };

test('every tenant message goes through the delivery layer; WhatsApp is no longer tried for tenants', () => {
  const fn = block('async function notifyTenant(', '\n}\n');
  assert.match(fn, /delivery\.sendToTenants\(/);
  assert.doesNotMatch(fn, /sendWa|notifyQuiet|notifyParty/);
  assert.equal(src.includes('notifyQuiet'), false);
  assert.match(src, /const \{ notifyShop, notifyParty, notifyAdmins \} = makeNotify\(\{ sendTg, sendWa,/);
  const { makeNotify } = require('../../notify/notify');
  assert.equal(makeNotify({ sendTg: async () => true, sendWa: async () => true }).notifyQuiet, undefined);
  assert.match(src, /const delivery = makeDelivery\(\{ store: makeDeliveryStore\(prisma\), sendTg, sms: tenantSms,/);
});

test('the daily checks keep their switches and their budget of 8 tenant messages per building', () => {
  const fn = block('async function runDailyChecks(', '\n}\n');
  assert.ok(fn.includes('const canSend = NOTIFY_WHITELIST.includes(b.qrSlug);'));
  assert.ok(fn.includes('let tenantSendBudget = 8;'));
  assert.equal(fn.split('if (canSend && b.notifyTenants && tenantSendBudget-- > 0) await notifyTenant(b, ').length - 1, 3);
  for (const s of ["source: 'daily-renewal'", "source: 'daily-due'", "source: 'daily-penalty'"]) assert.ok(fn.includes(s), s);
  assert.doesNotMatch(fn, /bChan/);
});

test('the dashboard invoice send keeps the whitelist check before anything is sent, and says what happened', () => {
  const body = block("fastify.post('/api/owner/:slug/invoice/:id/send'");
  const gate = body.indexOf("if (!NOTIFY_WHITELIST.includes(b.qrSlug)) return reply.code(403)");
  assert.ok(gate > 0 && gate < body.indexOf('invoiceLinks.linkFor(') && gate < body.indexOf('notifyTenant('));
  assert.match(body, /invoiceLinks\.linkFor\(inv\.id, 'invoice'\)/);
  assert.match(body, /return \{ ok: true, delivered: r\.delivered, channel: r\.channel, status: r\.status, reason: r\.errorKind \|\| null \};/);
});

test('only a whitelisted building that is not a demo may reach people, and every SMS carries the building label', () => {
  const fn = block('function tenantBuilding(', '\n}\n');
  assert.match(fn, /real: NOTIFY_WHITELIST\.includes\(b\.qrSlug\) && !hotelIsDemo\(b\)/);
  assert.match(fn, /smsLabel: buildingSmsLabel\(b\.name\)/);
  assert.match(src, /priceTiers: parsePriceTiers\(process\.env\.SMS_PRICE_TIERS\)/);
});

test('mark-paid refuses an invoice that is already paid before it writes, and sends the receipt through the layer', () => {
  const body = block("fastify.post('/api/admin/invoices/:id/pay'");
  const guard = body.indexOf("if (inv0.status === 'PAID') return reply.code(409)");
  assert.ok(guard > 0 && guard < body.indexOf('prisma.invoice.update('));
  assert.match(body, /notifyTenant\(bb, inv\.tenancy, \{ kind: 'receipt'/);
  assert.match(body, /invoiceLinks\.linkFor\(inv\.id, 'receipt'\)/);
});

test('/i/:token is rate limited before the lookup and never indexed or cached', () => {
  const body = block("fastify.get('/i/:token'");
  assert.ok(body.indexOf('invoiceLinkRL(bookIp(req))') > 0 && body.indexOf('invoiceLinkRL(bookIp(req))') < body.indexOf('invoiceLinks.resolve('));
  assert.match(body, /'X-Robots-Tag', 'noindex, nofollow'/);
  assert.match(body, /'Cache-Control', 'no-store'/);
});

test('SMS delivery reports need the secret before they touch a row, and form parsing stays inside that plugin', () => {
  const fn = block('async function smsReport(', '\n}\n');
  assert.ok(fn.indexOf('timingSafeEqual') > 0 && fn.indexOf('timingSafeEqual') < fn.indexOf('applyDeliveryReport'));
  assert.match(block('fastify.register(async function smsReportRoutes('), /f\.addContentTypeParser\('application\/x-www-form-urlencoded'/);
  assert.equal(src.split("addContentTypeParser('application/x-www-form-urlencoded'").length - 1, 1);
  assert.match(src, /const smsCallbackUrl = SMS_CALLBACK_SECRET\.length >= 24 \?/);
});

test('the pending-delivery list authenticates and reads only the building behind the key', () => {
  const body = block("fastify.get('/api/owner/:slug/pending-deliveries'");
  assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0);
  assert.doesNotMatch(body, /req\.body/);
  assert.match(body, /where: \{ buildingId: b\.id, kind: 'invoice', invoiceId: \{ not: null \} \}/);
  assert.match(body, /status: \{ not: 'PAID' \}, tenancy: \{ unit: \{ buildingId: b\.id \} \}/);
});

// Carry-overs from the Task 4/5 reviews.
test('/i/:token answers with HTML pages only, never the resolved invoice as data', () => {
  const body = block("fastify.get('/i/:token'");
  assert.equal((body.match(/\.send\(/g) || []).length, 3);
  assert.equal((body.match(/\.send\(render(Invoice|Gone)Page\(/g) || []).length, 3);
  assert.equal((body.match(/type\('text\/html; charset=utf-8'\)/g) || []).length, 3);
  assert.doesNotMatch(body, /return found|send\(found|console\./);
});

test('tenant-message and delivery-report errors are logged by kind, never by message, and no request URL is logged', () => {
  for (const sig of ['async function notifyTenant(', 'async function smsReport(']) {
    const fn = block(sig, '\n}\n');
    assert.doesNotMatch(fn, /e\.message|req\.url|req\.params\.secret\)|JSON\.stringify\(body\)/, sig);
  }
  assert.doesNotMatch(block("fastify.post('/api/admin/invoices/:id/pay'"), /e\.message/);
  const report = block('async function smsReport(', '\n}\n');
  assert.match(report, /delivery\.reportShape\(body\)/);
  assert.equal((report.match(/console\./g) || []).length, 2);
});

test('the link lookup selects only what the invoice page shows', async () => {
  const { makeInvoiceLinks, INVOICE_PAGE_SELECT } = require('../../messaging/invoice-links');
  assert.deepEqual(Object.keys(INVOICE_PAGE_SELECT.tenancy.select), ['unit']);
  assert.deepEqual(Object.keys(INVOICE_PAGE_SELECT.tenancy.select.unit.select), ['number', 'building']);
  assert.deepEqual(Object.keys(INVOICE_PAGE_SELECT.tenancy.select.unit.select.building.select).sort(), ['bankAccounts', 'name', 'nameAm', 'tinNumber']);
  const calls = [];
  const T = new Date('2026-10-01T00:00:00Z');
  const prisma = {
    invoiceLink: { findUnique: async a => { calls.push(['link', a]); return { invoiceId: 'inv1', kind: 'invoice', expiresAt: new Date(T.getTime() + 86400000) }; } },
    invoice: { findUnique: async a => { calls.push(['invoice', a]); return { id: 'inv1', type: 'RENT', amount: 1, lateFee: 0, dueDate: T, status: 'PENDING',
      tenancy: { unit: { number: '1', building: { name: 'Demo Tower' } } } }; } },
  };
  const found = await makeInvoiceLinks({ prisma, now: () => T }).resolve('AAAAAAAAAAAA');
  assert.equal(found.building.name, 'Demo Tower');
  for (const [, a] of calls) { assert.ok(a.select, 'select used'); assert.equal(a.include, undefined); }
  assert.equal(calls[1][1].select, INVOICE_PAGE_SELECT);
});
