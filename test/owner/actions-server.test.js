'use strict';
// server.js starts a listener on require, so the wiring of owner actions is pinned by reading it, as the other server
// tests do — together with the table they write and the dashboard buttons that press them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };

test('the action service is built from the delivery layer, the invoice module and the access rules — and nothing else', () => {
  const b = block('const ownerActions = makeOwnerActions({', '\n});');
  assert.match(b, /store: makeOwnerActionStore\(prisma\), resolver: makeActionResolver\(\{ prisma \}\), delivery, access: ownerAccess, switches: actionSwitches, audit/);
  assert.match(b, /sendBatch: \(\{ building, kind, text, recipients, actor \}\) => delivery\.sendToTenants\(\{ building: tenantBuilding\(building\), kind, source: 'owner-action', actor, text, recipients \}\)/);
  assert.match(b, /invoiceOps\.sendInvoice\(\{ building: await prisma\.building\.findUnique\(\{ where: \{ id: buildingId \} \}\), invoiceId, source: 'owner-action', actor \}\)/);
  assert.match(b, /markPaid: \(\{ invoiceId, method, actor \}\) => invoiceOps\.markPaid\(\{ invoiceId, method, actor, source: 'owner-action', receipt: 'always' \}\)/);
  assert.match(b, /generateInvoices: \(buildingId, month\) => invoiceGen\.generateInvoicesForBuilding\(prisma, buildingId, invoiceGen\.monthWhen\(month\)\)/);
  assert.equal(/prisma\.invoice\.update|prisma\.outboundMessage/.test(b), false, 'the service must not write records of its own');
  assert.match(src, /ownerTelegram\.actions = ownerActions;/);
  assert.ok(src.indexOf('ownerTelegram.actions = ownerActions;') < src.indexOf("require('./ride')(fastify"), 'the bot must have it when the ride module mounts');
});

test('owner actions are switched per building and never depend on notifyTenants, which is the daily checks\' switch', () => {
  const b = block('const ownerActions = makeOwnerActions({', '\n});');
  assert.equal(/notifyTenants/.test(b), false);
  const around = src.slice(src.indexOf('// ===== Owner actions in Bini'), src.indexOf('const ownerActions = makeOwnerActions({'));
  assert.match(around, /NEVER on\s*\n\/\/ Building\.notifyTenants/);
  assert.match(src, /const actionSwitches = makeActionSwitches\(prisma\);/);
  assert.match(src, /const \{ makeOwnerActionStore, makeActionSwitches \} = require\('\.\/agents\/owner\/actions\/store'\);/);
});

test('the engine hands the owner agent the service, read when a request runs', () => {
  const engine = block('const runAgent = makeEngine({', '\n});');
  assert.match(engine, /get ownerActions\(\) \{ return ownerActions; \}/);
});

test('a pending preview expires on its own, every five minutes', () => {
  assert.match(src, /cron\.schedule\('\*\/5 \* \* \* \*', \(\) => \{ ownerActions\.expireOld\(\)\.catch\(e => console\.error\('\[owner-actions\] expiry error: ' \+ errorKindOf\(e\)\)\); \}\);/);
});

test('the dashboard\'s confirm and cancel authenticate, check the action belongs to that building, and decide nothing themselves', () => {
  for (const [sig, verb] of [["fastify.post('/api/owner/:slug/actions/:id/confirm'", "(req.body || {}).urgent === true ? 'urgent' : 'confirm'"],
    ["fastify.post('/api/owner/:slug/actions/:id/cancel'", "verb: 'cancel'"]]) {
    const body = block(sig);
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0, sig + ' must authenticate');
    assert.ok(body.indexOf('a.buildingId !== b.id') > 0, sig + ' must check the action belongs to this building');
    assert.ok(body.includes(verb), sig + ' verb');
    assert.ok(body.includes("actor: { channel: 'owner-web', buildingId: b.id }"), sig + ' actor');
  }
  const reply = block('function ownerActionReply(', '\n}');
  assert.match(reply, /reply: r\.card\.text, ownerAction: \{ id: r\.id, status: r\.status, buttons: r\.card\.buttons \}/);
});

test('the owner agent is the only door: no route may run an action without the service', () => {
  assert.equal(src.split('ownerActions.press(').length - 1, 2, 'only the dashboard confirm and cancel routes press an action');
  assert.equal(/ownerActions\.prepare\(/.test(src), false, 'preparing happens through the agent\'s tools, not from a route');
});

// ===== The carry-overs the plan does not pin itself =====

test('a reminder that is confirmed carries the real short link, so the placeholder is never sent', () => {
  const b = block('const ownerActions = makeOwnerActions({', '\n});');
  assert.match(b, /invoiceLink: \(invoiceId, kind\) => invoiceLinks\.linkFor\(invoiceId, kind\)/,
    'ops.invoiceLink must mint the real bina.et/i/<token> link (messaging/invoice-links.js)');
  assert.equal(/LINK_SAMPLE|bina\.et\/i\/X/.test(src), false, 'the placeholder link has no place in server.js');
});

test('the confirm and cancel routes authenticate before they read anything, and a wrong id is a plain 404', () => {
  for (const sig of ["fastify.post('/api/owner/:slug/actions/:id/confirm'", "fastify.post('/api/owner/:slug/actions/:id/cancel'"]) {
    const body = block(sig);
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') < body.indexOf('prisma.'),
      sig + ' must authenticate before it reads the database');
    assert.match(body, /prisma\.ownerAction\.findUnique\(\{ where: \{ id: String\(req\.params\.id\) \}, select: \{ buildingId: true \} \}\)/);
    // One answer for "no such action", "another building's action" and "no such building": nothing says which.
    assert.match(body, /if \(!b \|\| !a \|\| a\.buildingId !== b\.id\) return reply\.code\(404\)\.send\(\{ error: 'not_found' \}\);/);
  }
});

test('a press that did nothing — used up, expired — answers 409, and nothing about the stored row is sent back', () => {
  const reply = block('function ownerActionReply(', '\n}');
  assert.match(src, /const ACTION_SETTLED = \['done', 'failed', 'refused', 'cancelled', 'expired'\];/);
  // Only a press that CHANGED nothing is a conflict: a confirm that just ran comes back ok with the ordinary 200.
  assert.match(reply, /if \(!r\.ok && ACTION_SETTLED\.includes\(r\.status\)\) reply\.code\(409\);/);
  assert.match(reply, /reply\.code\(r\.status === 'gone' \? 404 : 403\)/);
  // The card, its buttons and the id are the whole answer: no args, no fingerprint, no recipients, no access id.
  const keys = reply.match(/return \{[^}]*ok: r\.ok[^;]*;/)[0];
  for (const leak of ['args', 'fingerprint', 'preparedBy', 'preparedTg', 'cards', 'recipients', 'accessIds', 'phone', 'chatId'])
    assert.equal(keys.includes(leak), false, leak + ' must not be serialised into the reply');
  assert.equal(/accessIds/.test(src), false, 'the scope\'s access ids never leave the server');
  assert.equal(/ownerAction\.findMany|send\(a\)|Object\.assign\(\{\}, a\)/.test(src), false, 'no route hands an OwnerAction row to a client');
});

test('the five-minute sweep only expires forgotten previews — it presses nothing and writes nothing else', () => {
  const at = src.indexOf("cron.schedule('*/5 * * * *'");
  assert.ok(at > 0, 'the expiry cron is not scheduled');
  const line = src.slice(at, src.indexOf('\n', at));
  assert.equal(/press\(|prepare\(|sendToTenants|invoiceOps|prisma\.|markPaid|generateInvoices/.test(line), false,
    'the sweep calls expireOld and nothing else');
});

test('with the switch off the two owner doors are what they were: the switches are all they add', () => {
  const web = block("fastify.post('/api/owner/:slug/ai'");
  assert.match(web, /const sw = await actionSwitches\(\[b\.id\]\);/);
  assert.match(web, /scope: \{ buildingIds: \[b\.id\], actionsOn: sw\.on, staffConfirm: sw\.staff \}, channel: 'owner-web'/);
  assert.equal(/req\.body/.test(web), false, 'the scope must not come from the request body');
  const tg = block('const ownerTelegram = {', '\n};');
  assert.match(tg, /const sw = await actionSwitches\(scope\.buildingIds\);/);
  // A building with no switch row gets sw.on = [] and the same String(out.reply) the bot has always had.
  assert.match(tg, /return out\.ownerAction \? \{ reply: String\(out\.reply\), ownerAction: out\.ownerAction \} : String\(out\.reply\);/);
});

test('no file on the action path reads notifyTenants, which is the daily checks\' switch', () => {
  const dir = path.join(ROOT, 'agents', 'owner');
  const files = [path.join(dir, 'rules.js'), path.join(dir, 'access.js'), path.join(dir, 'tools', 'actions.js'),
    ...fs.readdirSync(path.join(dir, 'actions')).map(f => path.join(dir, 'actions', f))];
  for (const f of files)
    assert.equal(/notifyTenants/.test(fs.readFileSync(f, 'utf8')), false, f + ' must not read notifyTenants');
});
