'use strict';
// server.js starts a listener on require, so the Messages routes are pinned by reading it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };
const ROUTES = ["fastify.get('/api/owner/:slug/messages'", "fastify.get('/api/owner/:slug/messages/:batchId'",
  "fastify.get('/api/owner/:slug/sms-month'", "fastify.get('/api/owner/:slug/owner-actions'"];

test('all four routes authenticate before anything is read, and answer for one building only', () => {
  for (const r of ROUTES) {
    const body = block(r);
    const auth = body.indexOf('authBuildingFail(req, reply, req.params.slug)');
    assert.ok(auth > 0, r + ' does not authenticate');
    assert.ok(auth < body.indexOf('prisma.building.findUnique'), r + ': the building is read before the key is checked');
    assert.match(body, /where: \{ qrSlug: req\.params\.slug \}/, r);
    assert.match(body, /if \(!b\) return reply\.code\(404\)\.send\(\{ error: 'not_found' \}\);/, r);
    assert.ok(body.includes('buildingId: b.id'), r + ' is not scoped to the building');
    // Read-only: a GET, no body, and no call that could write or send.
    assert.equal(/req\.body|\.create\(|\.update\(|\.delete\(|sendToTenants|notifyTenant|invoiceOps/.test(body), false, r);
  }
  // One occurrence of each: no route is declared twice.
  for (const r of ROUTES) assert.equal(src.split(r).length - 1, 1, r);
});

test('the batch drill-down is found through the view, so another building gets a 404 and not a 403', () => {
  const body = block("fastify.get('/api/owner/:slug/messages/:batchId'");
  assert.match(body, /messagesView\.one\(\{ buildingId: b\.id, batchId: req\.params\.batchId/);
  assert.match(body, /if \(!one\) return reply\.code\(404\)\.send\(\{ error: 'not_found' \}\);/);
  assert.match(block("fastify.get('/api/owner/:slug/messages'"), /messagesView\.list\(\{ buildingId: b\.id, page: q\.page/);
});

test('the balance is read through the cache, never from the provider, and never with the token in sight', () => {
  const body = block("fastify.get('/api/owner/:slug/sms-month'");
  assert.match(body, /smsBalance\.read\(\)\.catch\(\(\) => \(\{ state: 'unavailable' \}\)\)/);
  assert.equal(/SMS_API_TOKEN|makeGeezSms|geezsms\.com|tenantSms\.balance\(\)/.test(body), false);
  // The month follows the same real/mode rule the delivery layer uses, so the tab cannot claim live when it is not.
  assert.match(body, /const tb = tenantBuilding\(b\);/);
  assert.match(body, /real: tb\.real, mode: tenantSms\.mode, tiers: smsTiers/);
  assert.match(src, /const smsBalance = makeSmsBalance\(\{ provider: tenantSms\.balance \? \{ balance: tenantSms\.balance \} : null/);
  assert.match(src, /const smsTiers = parsePriceTiers\(process\.env\.SMS_PRICE_TIERS\);/);
  // Plan A's own wiring line is untouched (test/messaging/server-delivery.test.js pins it).
  assert.match(src, /priceTiers: parsePriceTiers\(process\.env\.SMS_PRICE_TIERS\)/);
});

test('the action history goes through the history module, which is the only thing that reads that table here', () => {
  const body = block("fastify.get('/api/owner/:slug/owner-actions'");
  assert.match(body, /actionHistory\.list\(\{ buildingId: b\.id, page: \(req\.query \|\| \{\}\)\.page \}\)/);
  assert.equal(/prisma\.ownerAction|args|fingerprint|cardText|preparedBy|accessIds/.test(body), false);
  assert.match(src, /const \{ makeActionHistory \} = require\('\.\/agents\/owner\/actions\/history'\);/);
  assert.match(src, /const actionHistory = makeActionHistory\(\{ prisma \}\);/);
});

test('the four routes are wired once, from the modules, and are GETs', () => {
  assert.match(src, /const \{ makeMessagesStore, makeMessagesView \} = require\('\.\/messaging\/messages-view'\);/);
  assert.match(src, /const \{ makeSmsBalance \} = require\('\.\/messaging\/sms-balance'\);/);
  assert.match(src, /const messagesView = makeMessagesView\(\{ store: makeMessagesStore\(prisma\) \}\);/);
  for (const r of ROUTES) assert.equal(src.includes(r.replace('fastify.get', 'fastify.post')), false, r);
  // The wiring sits after the SMS adapter it uses, and before the routes that use it.
  assert.ok(src.indexOf('const tenantSms = makeSmsFromEnv(') < src.indexOf('const smsBalance = makeSmsBalance('));
  assert.ok(src.indexOf('const messagesView = makeMessagesView(') < src.indexOf(ROUTES[0]));
});

// ---- Carry-overs from the tasks before this one. The plan's five tests stop short of these four, and each one is a
// way the tab could leak or lie: a read before the key is checked, a balance cache rebuilt per request, a batch id
// that answers differently depending on whose it is, and paging arithmetic done twice.
test('the key is the first statement, the balance reader is built once, and paging stays in the view', () => {
  for (const r of ROUTES) {
    const body = block(r);
    // Nothing is read, parsed or decided before the building's own key is checked.
    assert.match(body, /^fastify\.get\('[^']+', async \(req, reply\) => \{\s*if \(await authBuildingFail\(req, reply, req\.params\.slug\)\) return;/, r);
    // No route names a column that would put a person, a device or a secret on the page.
    assert.equal(/phone|chatId|tgChatId|accessIds|cardText|fingerprint|\bargs\b|payload|actor:/.test(body), false, r);
    // Paging is clamped where it is used (messages-view pageOf, history list); no route does the arithmetic again.
    assert.equal(/skip:|take:|parseInt\(/.test(body), false, r);
  }
  // One reader, built at wiring time, so the ten-minute cache is shared by every request rather than thrown away.
  assert.equal(src.split('makeSmsBalance(').length - 1, 1);
  assert.equal(block("fastify.get('/api/owner/:slug/sms-month'").includes('makeSmsBalance('), false);
  // An unknown batch and another building's batch are the same 404, and nothing here answers 403.
  const one = block("fastify.get('/api/owner/:slug/messages/:batchId'");
  assert.equal(one.split("reply.code(404).send({ error: 'not_found' })").length - 1, 2);
  assert.equal(/code\(403\)/.test(one), false);
});
