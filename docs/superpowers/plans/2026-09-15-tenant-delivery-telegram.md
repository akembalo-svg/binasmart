# Tenant Delivery and Tenant Telegram Implementation Plan (Plan A — owner actions and messaging)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every message to a tenant goes one road — Telegram when the tenant linked `@bina_smart_bot`, otherwise SMS (built, locked in test mode), otherwise recorded as not delivered — tenants can link Telegram from a building poster, invoices get short `bina.et/i/<token>` links, the owner sees and re-sends invoices that never arrived, and the monthly invoice cron stops dying part-way.

**Architecture:** New `messaging/` modules, each pure over injected stores so they are tested without a network or database: `sms.js` (E.164 mobile, SMS parts, test/live gate, GeezSMS provider), `delivery.js` (channel choice, monthly limit, `OutboundBatch`/`OutboundMessage` records, delivery reports, a transactional SMS path for Plan D), `invoice-text.js` / `invoice-links.js` / `invoice-page.js` (the texts, the tokens, the page), `tenant-link.js` (the Share-my-phone proof for tenants) and `tenant-poster.js`. `building/invoices.js` takes the invoice generator out of `server.js`. `server.js` wires them in and moves `notifyTenant`, the daily checks, 📤 Send and the e-receipt onto the delivery layer without changing their switches. `ride/binaBot.js` gains `/start tenant_<slug>`, the tenant contact and `/stop`. `public/owner.html` gets the tenant Telegram card and the "Waiting to be delivered" list.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 (additive SQL under `prisma/sql/`, then `prisma generate`), `node:test`, Telegram Bot API, GeezSMS HTTP API (never called in this plan), `qrcode` (already a dependency).

**Design:** `docs/superpowers/specs/2026-09-15-owner-actions-messaging-design.md` (commit `500df05`) §1, §2, §4 (tenant Telegram card, pending list), §8. Owner's instruction: "till we have SMS do Telegram". Provider change from the coordinator (15 Sep): **GeezSMS**, not AfroMessage.
**Not in this plan:** owner actions in Bini (§3) → Plan B; the dashboard Messages tab (§4) → Plan C; SMS sign-in codes → Plan D. See the end.

---

## Conventions (every task)

- **Where the work happens.** Server `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart` (branch main), pm2 process `binasmart-api`, port 4210. The Telegram bot `@bina_smart_bot` runs inside that process (`server.js` mounts `require('./ride')(fastify, …)`, which builds the bot; its webhook is `POST /api/tg/rider`). After a restart the log shows `[ride] BinaSmart Ride module mounted (Telegram bots on)`.
- **Local mirror.** Windows Git Bash cannot pass heredocs, apostrophes or Ethiopic inside `ssh '…'`. Write every new file and every patch script locally under `L=$HOME/binasmart-planA` (same relative paths as the repo), then copy it up:
  `scp "$L/<path>" root@31.97.176.180:/var/www/connectcare/binasmart/<path>` (create remote dirs first with `ssh root@31.97.176.180 'mkdir -p /var/www/connectcare/binasmart/messaging /var/www/connectcare/binasmart/test/messaging /var/www/connectcare/binasmart/ops/messaging'`).
  An `ssh` command that contains `$` must use single quotes (double quotes expand locally).
- **Patching existing files.** Back up first: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && S=$(date +%Y%m%d-%H%M%S) && cp server.js server.js.bak-planA-tN-$S'` (same for every file the task patches; `*.bak-*` is git-ignored). Edit with the Python script given in the task: written locally, copied to `/tmp/`, run with `python3`; each anchor must match exactly once or the script exits without writing.
- **TDD.** `node:test`. Baseline `npm test` → **901 pass, 0 fail** at `500df05`. Each task states its delta. Single file: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/<path> 2>&1 | grep -E "^# (pass|fail)|^not ok"'`. Full suite (≈4 min, give the command a 300 s timeout): `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`. Every task ends with the full suite at 0 fail.
- **Commits.** Message written locally to `$L/.msg`, copied to `/tmp/planA-msg.txt`, `git add <files by name> && git commit -q -F /tmp/planA-msg.txt`. Never stage `broadcast-am-fbcomment.js` or `uploader.js`. Every message ends with a blank line and `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Do not push; the coordinator pushes.
- **Public repo.** Fake numbers only (`0900000001`, `+251900000001`), fake names ("Demo Tower", "Demo Tenant"), no keys, tokens, chat ids or real names anywhere in code, tests or messages.
- **No test sends to live channels.** No step sends a Telegram message or an SMS to anyone. Tests use fake APIs. Live checks run on the demo building `century-mall` (not in `NOTIFY_WHITELIST`, so the delivery layer treats it as test whatever the mode), with a provider and `sendTg` that throw if called, and read-only requests. Never trigger `runDailyChecks`, `/api/admin/darulle/run-daily`, the Darulle 📤 Send or mark-paid. Never message the Darulle owner or tenants. The first real tenant message is the owner's own action, later.
- **SMS credentials** come only from the server `.env`, entered by Ibrahim: `SMS_PROVIDER=geezsms`, `SMS_API_TOKEN`, `SMS_SHORTCODE_ID` (leave unset: GeezSMS's default shortcode is used until the "BinaSmart" sender name is approved), `SMS_MODE=test|live` (default `test`), `SMS_CALLBACK_SECRET` (optional, ≥ 24 random characters, enables the delivery-report route), `SMS_PRICE_TIERS` (optional JSON, default the account's prices below). Never print, log or commit them. This plan sets none of them.
- **SMS sender and label (decided 15 Sep).** No `shortcode_id` until a sender name is approved (GeezSMS: ≤ 11 characters; "BinaSmart" first, from the trade licence; BinaRide/BinaTrade only after EIPA/licence; a building's own name only with that building's licence). So every SMS text starts with its label, built in code and required: `BinaSmart · <building name>፦ …` for tenant messages, `BinaSmart፦ …` / `BinaRide፦ …` for services. `Building.smsSender` (null = provider default) holds a later approved name.
- **SMS price (GeezSMS account, incl. 15% VAT, 15 Sep):** ≤ 10,000 SMS/month 0.7475 ETB; 10,001–50,000 0.4025 ETB; > 50,000 0.2875 ETB — `DEFAULT_PRICE_TIERS` in `messaging/sms.js`, overridable by `SMS_PRICE_TIERS`; used only for estimates (preview, ops report). The account holds a 5-SMS test balance: the go-live step, outside this plan, is one real SMS to Ibrahim's own number, with his explicit permission, via `ops/messaging/sms-send-one.js`.
- **Restart** after any change to code the server loads: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health && echo && pm2 logs binasmart-api --lines 80 --nostream 2>&1 | grep -E "Ride module mounted|\[sms\] mode|TypeError|ReferenceError|SyntaxError|Cannot find" | tail -6'` → `{"ok":true,…}`, the Ride line, and no error lines. Then `tail -n 5 /root/.pm2/logs/binasmart-api-error.log` must show nothing timestamped after the restart.
- **Assets.** No `?v=` asset changes in this plan: `owner.html` carries its script inline and is served by `sendFile` (revalidated), the poster and the invoice page are rendered by the server. If a task adds a static file, reference it with `?v=1`.
- **Data never leaves the server.** Check scripts print counts, booleans and last-four digits only.

## Facts found while planning (15 Sep 2026, read-only, counts only)

**§8 — why Darulle has only July rent invoices.** The monthly cron (`server.js` `cron.schedule('0 6 1 * *', …)`, Addis time) did run on 1 August and 1 September, and stopped part-way both times:

| building (in the order `prisma.building.findMany` returns them) | RENT due Jul | Aug | Sep |
|---|---|---|---|
| bole-airport, edna-mall, century-mall, friendship-mall | all | all | all |
| zefmesh-mall (17 tenancies) | 17 | 17 | **8** |
| morning-star-mall, dembel-city-center, getu-commercial | all | all | 0 |
| abenezer-mall (15) | 15 | **3** | 0 |
| lafto-mall … skylight-hotel, darulle (last) | all | 0 | 0 |

(cbe-tower also has Aug/Sep; heap order moves with updates.) Every invoice created on those days was created before the stop, none after. The cause: `Invoice.paymentCode` is `@unique` and the generator builds it as `'BS-' + (1000..9999 random) + '-' + unit number`. Unit numbers repeat across the 29 buildings, so each suffix already has up to 40 codes; the next full run expects **1.17** collisions (measured). A collision throws Prisma `P2002`, and the one `try/catch` around the loop over **all** buildings ends the run. The first tenancy without an invoice in abenezer-mall (index 3) and zefmesh-mall (index 8) had 29 and 37 existing codes on its suffix. pm2 logs from 1 Aug/1 Sep are rotated away, so the error line itself is not available; the pattern above is the evidence. Darulle is last in the order, so it never got August or September. Also: 2 Darulle active tenancies have no contract and a unit rent of 0 (they get 0 ETB invoices; unchanged, reported). **Fix: Task 1.** Generating Darulle's missing August/September invoices is **not** done by this plan — it is the owner's decision (the dashboard's ⚡ Generate creates the current month only).

**§8 — the dashboard's mark-paid path.** `public/owner.html` `markPaid()` opens the pay modal, `payWith(method)` calls **`POST /api/admin/invoices/:id/pay`** `{ method }` (server.js ≈3050): authenticates against the invoice's building, sets `PAID`/`paidDate`/`method`, audits `INVOICE_PAID`, and sends the e-receipt with `notifyTenant` when the building is in `NOTIFY_WHITELIST` (it does not check `notifyTenants`, and it does not refuse an invoice that is already paid — a second tap re-sends the receipt). Undo is `POST /api/owner/:slug/invoice/:id/unpay`. Plan A moves the receipt onto the delivery layer and adds the already-paid refusal (Task 6); Plan B's `record_payment` must reuse this route's logic.

**Delivery today.** Darulle: 71 active tenancies, 0 tenants with `telegramChatId`, 67 with a valid Ethiopian mobile (user phone and shop phone are the same in all 67), `notifyTenants` on, penalties off. 3 `INVOICE_SENT` audit rows, all `(delivery pending — channel down)`; the audit names unit and total, not the invoice id (Task 11 matches them). `/api/tg-webhook` still contains the old unit-number linking (secret-gated, never used, 0 links) — retired in Task 9. `notifyQuiet` has exactly one caller, `notifyTenant`.

**Decision on WhatsApp.** The delivery layer never uses WhatsApp. `notifyTenant` stops calling `notifyQuiet`; `notifyQuiet` (and its test) is deleted because nothing else calls it. `sendWa`, `notifyParty`, `notifyShop` and `notifyAdmins` — owners, shops, admins, including the owner's daily report — are unchanged.

**GeezSMS (from its Postman collection, via the coordinator).** Send: `POST https://api.geezsms.com/api/v1/sms/send`, form fields `token`, `phone` (must start `2519`), `msg` (< 335 characters, Unicode), `shortcode_id` (optional), `callback` (optional URL). Success body `{"message_status":"success","log":"async <uuid>","phone":…,"message":…,"api_log_id":6569829}`. Balance: `GET https://api.geezsms.com/api/v1/balance` with `token` and header `X-GeezSMS-Key`. Bulk and OTP endpoints exist; Plan A uses neither. **Open facts** (not knowable before an account exists): whether `2517…` (Safaricom) numbers are accepted (treated as not reachable by SMS until confirmed); how GeezSMS counts parts (planned at 70 Unicode / 160 GSM characters per part); the delivery-report payload shape (the route logs field names and types of the first report); whether balance wants `token` as a query parameter.

## Key interfaces (Plans B, C and D build on these)

```js
// messaging/delivery.js
makeDelivery({ store, sendTg, sms, now, botUsername, log }) → {
  plan({ building, recipients })                     // no writes → { rows, counts:{telegram,sms,none}, smsParts, used, limit, remaining, withinLimit, mode, unitPriceEtb, costEtb }
  sendToTenants({ building, kind, source, actor, text, recipients })
                                                     // → { ok, batchId, error?, needed?, remaining?, counts:{telegram,sms,none,sent,test,failed}, results:[{tenancyId,channel,status,errorKind,messageId}] }
  sendTransactionalSms({ to, text, label, kind, source, live })   // Plan D sign-in codes: label required, no building, no limit, text never stored
  applyDeliveryReport(body) → rows updated;  reportShape(body) → 'field:type,…';  readReport(body)
}
// building   { id, slug, real, smsLabel, smsMonthlyLimit, smsSender }   real = in NOTIFY_WHITELIST and not hotelIsDemo()
// smsLabel   required whenever an SMS is planned: every SMS text starts '<label>፦ ' (e.g. 'BinaSmart · Darulle Building')
// smsSender  null/'' = GeezSMS default shortcode; a name only once approved (max 11 characters)
// recipient  { tenancyId, userId, telegramChatId, phone, text, smsText, invoiceId }
// kind       notice | reminder | invoice | receipt | otp
// source     daily-renewal | daily-due | daily-penalty | dashboard-send | receipt | backfill-audit | transactional   (Plan B adds owner-action)
// status     queued | sent | delivered | failed | test
// errorKind  no_contact | no_mobile | sms_unsupported_number | sms_limit | tg_failed | sms_refused | provider_error | too_long | empty | channel_down | error
```
A batch over the monthly SMS limit is refused whole (nothing sent, every recipient recorded `none/failed/sms_limit`), which is what Plan B's preview needs. `OutboundBatch.actor` is `dashboard`, `cron` or `ops` now; Plan B writes the owner access id there and the notice text into `OutboundBatch.text`.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `building/invoices.js` | create | `generateInvoicesForBuilding(prisma, buildingId, when, {rand})` with code-collision retry; `runMonthlyInvoices(prisma, {when, log, rand})` per-building isolation; `addisMonth`, `randomCode` |
| `test/building/invoices.test.js` | create | generator rules over a fake Prisma; server wiring pin |
| `prisma/schema.prisma` | modify | `OutboundBatch`, `OutboundMessage`, `InvoiceLink`; `Building.smsMonthlyLimit`, `Building.smsSender` |
| `prisma/sql/20260915_outbound_messages.up.sql` / `.down.sql` | create | the additive change and its reversal |
| `test/messaging/schema.test.js` | create | fields present, no phone column, SQL covers the models |
| `messaging/sms.js` | create | `normalizeEtMobile`, `smsParts`, `SMS_MAX_CHARS`, `labelled`, `buildingSmsLabel`, `validSender`, `DEFAULT_PRICE_TIERS`, `parsePriceTiers`, `smsUnitPrice`, `geezSupports`, `makeSms`, `makeGeezSms`, `makeSmsFromEnv` |
| `messaging/delivery.js` | create | `makeDelivery`, `makeDeliveryStore`, `addisMonthStart` |
| `messaging/invoice-text.js` | create | `invoiceMessage`, `receiptMessage` (today's texts + optional link), `invoiceSms`, `receiptSms`, `TYPE_AM` |
| `messaging/invoice-links.js` | create | `makeInvoiceLinks({prisma, now, randomBytes})` → `linkFor(invoiceId, kind)`, `resolve(token)` |
| `messaging/invoice-page.js` | create | `renderInvoicePage(resolved)`, `renderGonePage({slow})` |
| `messaging/tenant-link.js` | create | `makeTenantLink({store, audit, now, limit})` → `linkFromContact`, `unlink`, `statsForBuilding`, `removeForBuilding`; `makeTenantLinkStore(prisma)` |
| `messaging/tenant-poster.js` | create | `tenantPoster({building, startUrl, qrSvg})` A4 Amharic + English |
| `agents/owner/access.js` | modify | export `limiter` |
| `ride/binaBot.js` | modify | optional `tenant` dep: `/start tenant_<slug>`, contact within 10 min, `/stop` |
| `ride/index.js` | modify | pass `deps.tenantTelegram` as `tenant` |
| `notify/notify.js` | modify | remove `notifyQuiet` |
| `test/notify/quiet.test.js` | delete | its function is gone |
| `server.js` | modify | invoice module; delivery wiring; `notifyTenant`; daily checks; 📤 Send; receipt; pending list; `/i/:token`; SMS report route; tenant Telegram routes; poster; retire `/api/tg-webhook` linking; ride deps |
| `public/owner.html` | modify | Settings: tenant Telegram card; Invoices: "Waiting to be delivered" with Send now; clearer Send result |
| `ops/messaging/backfill-pending-invoices.js` | create | match the 3 audit-only stuck sends to invoices; record them (`--apply`) |
| `ops/messaging/sms-status.js` | create | read-only SMS setup report (mode, limits, parts used, cost estimate, optional balance) |
| `ops/messaging/sms-send-one.js` | create | go-live step for later (one SMS to Ibrahim, approval flag); **not run in this plan** |
| `test/messaging/*.test.js` | create | `sms`, `delivery`, `invoice-text`, `invoice-links`, `server-delivery`, `tenant-link`, `tenant-bot`, `tenant-poster`, `server-tenant`, `dashboard`, `ops` |

---

### Task 1: The monthly invoice run survives a payment-code collision (§8)

**Files:**
- Create: `building/invoices.js`
- Test: `test/building/invoices.test.js`
- Modify: `server.js` (≈3015–3039 generator, ≈3177–3186 cron)

- [ ] **Step 1: Write the failing test** — `$L/test/building/invoices.test.js`

```js
'use strict';
// Monthly rent invoices. On 1 Aug and 1 Sep 2026 the cron stopped part-way: a random payment code clashed with an
// existing one (Invoice.paymentCode is unique), Prisma threw P2002, and one try/catch around every building ended
// the run. Darulle, last in the order, got nothing after July. Over a fake Prisma: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { generateInvoicesForBuilding, runMonthlyInvoices, addisMonth, MAX_CODE_TRIES } = require('../../building/invoices');

function fakePrisma({ buildings = [], tenancies = [], invoices = [], failBuilding = null } = {}) {
  const db = { invoices: invoices.slice(), creates: 0 };
  return {
    db,
    building: { findMany: async () => buildings.map(b => ({ id: b.id, name: b.name })) },
    tenancy: {
      findMany: async ({ where }) => {
        if (where.unit.buildingId === failBuilding) throw new Error('db timeout');
        return tenancies.filter(t => t.active && t.unit.buildingId === where.unit.buildingId);
      },
    },
    invoice: {
      findFirst: async ({ where }) => db.invoices.find(i => i.tenancyId === where.tenancyId && i.type === where.type
        && i.dueDate >= where.dueDate.gte && i.dueDate < where.dueDate.lt) || null,
      create: async ({ data }) => {
        db.creates++;
        if (db.invoices.some(i => i.paymentCode === data.paymentCode)) {
          const e = new Error('Unique constraint failed on the fields: (`paymentCode`)'); e.code = 'P2002'; throw e;
        }
        db.invoices.push(data); return data;
      },
    },
  };
}
const seq = values => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const T = (id, buildingId, number, { contractRent = null, unitRent = 5000, active = true } = {}) =>
  ({ id, active, unit: { buildingId, number, monthlyRent: unitRent }, contract: contractRent == null ? null : { monthlyRent: contractRent } });
const OCT1 = new Date('2026-10-01T03:00:00Z');   // 06:00 Addis on 1 October, when the cron runs

test('one RENT invoice per active tenancy, due on the 5th, from the contract rent or else the unit rent', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101', { contractRent: 12000 }), T('t2', 'b1', 'G-02', { unitRent: 8000 }), T('t3', 'b1', '103', { active: false })] });
  const r = await generateInvoicesForBuilding(p, 'b1', OCT1);
  assert.deepEqual(r, { created: 2, skipped: 0, month: '10/2026' });
  assert.deepEqual(p.db.invoices.map(i => [i.tenancyId, i.amount, i.type, i.status, i.dueDate.toISOString()]),
    [['t1', 12000, 'RENT', 'PENDING', '2026-10-05T00:00:00.000Z'], ['t2', 8000, 'RENT', 'PENDING', '2026-10-05T00:00:00.000Z']]);
  assert.match(p.db.invoices[1].paymentCode, /^BS-\d{4}-G02$/);
});

test('a tenancy that already has this month’s rent invoice is skipped', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')], invoices: [{ tenancyId: 't1', type: 'RENT', dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-2222-101' }] });
  assert.deepEqual(await generateInvoicesForBuilding(p, 'b1', OCT1), { created: 0, skipped: 1, month: '10/2026' });
});

test('a payment code that clashes with an existing one draws a new code instead of failing', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')],
    invoices: [{ tenancyId: 'other-building', type: 'RENT', dueDate: new Date('2026-08-05T00:00:00Z'), paymentCode: 'BS-1000-101' }] });
  const r = await generateInvoicesForBuilding(p, 'b1', OCT1, { rand: seq([0, 0.5]) });
  assert.equal(r.created, 1);
  assert.equal(p.db.invoices[1].paymentCode, 'BS-5500-101');
  assert.equal(p.db.creates, 2);
});

test('it gives up after MAX_CODE_TRIES clashes and reports the database error', async () => {
  const p = fakePrisma({ tenancies: [T('t1', 'b1', '101')],
    invoices: [{ tenancyId: 'x', type: 'RENT', dueDate: new Date('2026-08-05T00:00:00Z'), paymentCode: 'BS-1000-101' }] });
  await assert.rejects(generateInvoicesForBuilding(p, 'b1', OCT1, { rand: () => 0 }), e => e.code === 'P2002');
  assert.equal(p.db.creates, MAX_CODE_TRIES);
});

test('the month is Addis Ababa’s: 22:30 UTC on 30 September is already October', () => {
  assert.deepEqual(addisMonth(new Date('2026-09-30T22:30:00Z')), { y: 2026, m: 9 });
  assert.deepEqual(addisMonth(new Date('2026-09-30T20:59:00Z')), { y: 2026, m: 8 });
});

test('one building failing does not stop the buildings after it', async () => {
  const logs = [];
  const p = fakePrisma({ buildings: [{ id: 'b1', name: 'Demo A' }, { id: 'b2', name: 'Demo B' }, { id: 'b3', name: 'Demo C' }],
    tenancies: [T('t1', 'b1', '1'), T('t2', 'b2', '1'), T('t3', 'b3', '1')], failBuilding: 'b2' });
  const r = await runMonthlyInvoices(p, { when: OCT1, log: m => logs.push(m) });
  assert.deepEqual(r.ok.map(x => [x.name, x.created]), [['Demo A', 1], ['Demo C', 1]]);
  assert.deepEqual(r.failed, [{ name: 'Demo B', error: 'db timeout' }]);
  assert.ok(logs.some(l => /invoice error Demo B: db timeout/.test(l)));
});

test('server.js uses the module: the route delegates and the cron runs each building on its own', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, /const invoiceGen = require\('\.\/building\/invoices'\);/);
  assert.match(src, /return invoiceGen\.generateInvoicesForBuilding\(prisma, buildingId, when\);/);
  const at = src.indexOf("cron.schedule('0 6 1 * *'");
  assert.ok(at > 0, 'monthly cron missing');
  const body = src.slice(at, src.indexOf('{ timezone', at));
  assert.match(body, /invoiceGen\.runMonthlyInvoices\(prisma, \{ log: m => console\.log\(m\) \}\)/);
  assert.doesNotMatch(body, /for \(const b of buildings\)/);
  assert.match(body, /notifyAdmins\(/);
});
```

- [ ] **Step 2: Copy up and run — expect failure**

`ssh root@31.97.176.180 'mkdir -p /var/www/connectcare/binasmart/test/building'` (exists), then `scp "$L/test/building/invoices.test.js" root@31.97.176.180:/var/www/connectcare/binasmart/test/building/invoices.test.js`, then run the single file.
Expected: `# fail 1` with `Cannot find module '../../building/invoices'`.

- [ ] **Step 3: Implement** — `$L/building/invoices.js`

```js
'use strict';
// Monthly rent invoices: one RENT invoice per active tenancy per calendar month (Addis Ababa), due on the 5th.
//
// On 1 August and 1 September 2026 the monthly cron stopped part-way. Invoice.paymentCode is unique and is
// 'BS-' + four random digits + '-' + the unit number; unit numbers repeat across buildings, so a run of ~400
// invoices expected about one clash (1.17 measured on 15 Sep). Prisma threw P2002 and the single try/catch around
// every building ended the run: every building after that point, Darulle last, got no invoices. Now a clash draws a
// new code, and a building that fails is reported without stopping the others.
const MAX_CODE_TRIES = 8;

function addisMonth(when = new Date()) {
  const d = new Date(when.getTime() + 3 * 3600000);   // Addis Ababa is UTC+3 all year
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function randomCode(unitNumber, rand = Math.random) {
  return 'BS-' + Math.floor(1000 + rand() * 9000) + '-' + String(unitNumber).replace(/[^A-Za-z0-9]/g, '');
}

async function generateInvoicesForBuilding(prisma, buildingId, when = new Date(), { rand = Math.random } = {}) {
  const { y, m } = addisMonth(when);
  const monthStart = new Date(Date.UTC(y, m, 1)), monthEnd = new Date(Date.UTC(y, m + 1, 1));
  const tenancies = await prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } }, include: { unit: true, contract: true } });
  let created = 0, skipped = 0;
  for (const t of tenancies) {
    const exists = await prisma.invoice.findFirst({ where: { tenancyId: t.id, type: 'RENT', dueDate: { gte: monthStart, lt: monthEnd } } });
    if (exists) { skipped++; continue; }
    const amount = (t.contract && t.contract.monthlyRent) || t.unit.monthlyRent;
    for (let tries = 1; ; tries++) {
      try {
        await prisma.invoice.create({ data: { tenancyId: t.id, type: 'RENT', amount,
          dueDate: new Date(Date.UTC(y, m, 5)), paymentCode: randomCode(t.unit.number, rand), status: 'PENDING' } });
        created++;
        break;
      } catch (e) {
        if (!(e && e.code === 'P2002') || tries >= MAX_CODE_TRIES) throw e;   // only a code clash is retried
      }
    }
  }
  return { created, skipped, month: (m + 1) + '/' + y };
}

async function runMonthlyInvoices(prisma, { when = new Date(), log = () => {}, rand } = {}) {
  const buildings = await prisma.building.findMany({ select: { id: true, name: true } });
  const out = { ok: [], failed: [] };
  for (const b of buildings) {
    try {
      const r = await generateInvoicesForBuilding(prisma, b.id, when, rand ? { rand } : {});
      out.ok.push({ name: b.name, ...r });
      log('[cron] invoices ' + b.name + ' ' + JSON.stringify(r));
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 200);
      out.failed.push({ name: b.name, error });
      log('[cron] invoice error ' + b.name + ': ' + error);
    }
  }
  return out;
}

module.exports = { generateInvoicesForBuilding, runMonthlyInvoices, addisMonth, randomCode, MAX_CODE_TRIES };
```

- [ ] **Step 4: Patch server.js** — back up `server.js` (Conventions), then `$L/tmp/t1_patch.py` → `/tmp/t1_patch.py`, `ssh root@31.97.176.180 'python3 /tmp/t1_patch.py'` → `ok`.

```python
import io, sys
p = '/var/www/connectcare/binasmart/server.js'
s = io.open(p, encoding='utf-8', newline='').read()
def sub(old, new, what):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('anchor for %s matched %d times' % (what, n))
    s = s.replace(old, new)

old_gen_start = r'''// ===== INVOICE GENERATOR (reusable) =====
async function generateInvoicesForBuilding(buildingId, when = new Date()) {'''
old_gen_end = r'''  return { created, skipped, month: (m + 1) + '/' + y };
}
'''
a = s.find(old_gen_start); b = s.find(old_gen_end, a)
if a < 0 or b < 0 or s.count(old_gen_start) != 1:
    sys.exit('generator block not found')
s = s[:a] + r'''// ===== INVOICE GENERATOR (reusable) — building/invoices.js explains the August/September gap =====
const invoiceGen = require('./building/invoices');
async function generateInvoicesForBuilding(buildingId, when = new Date()) {
  return invoiceGen.generateInvoicesForBuilding(prisma, buildingId, when);
}
''' + s[b + len(old_gen_end):]

sub(r'''cron.schedule('0 6 1 * *', async () => {
  try {
    const buildings = await prisma.building.findMany({ select: { id: true, name: true } });
    for (const b of buildings) {
      const r = await generateInvoicesForBuilding(b.id);
      console.log('[cron] invoices', b.name, JSON.stringify(r));
    }
  } catch (e) { console.error('[cron] invoice error', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });''', r'''cron.schedule('0 6 1 * *', async () => {
  try {
    // Each building on its own: one failure is reported and the rest still get their invoices.
    const r = await invoiceGen.runMonthlyInvoices(prisma, { log: m => console.log(m) });
    if (r.failed.length) notifyAdmins('⚠️ Monthly rent invoices failed for ' + r.failed.length + ' building(s): '
      + r.failed.map(f => f.name).join(', ') + '. The others were generated. Details: binasmart-api log, [cron] invoice error.').catch(() => {});
  } catch (e) { console.error('[cron] invoice error', e.message); }
}, { timezone: 'Africa/Addis_Ababa' });''', 'monthly cron')

if s.count('generateInvoicesForBuilding(') != 3:
    sys.exit('expected the wrapper, its delegation and the manual route, found %d' % s.count('generateInvoicesForBuilding('))
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

(`generateInvoicesForBuilding(` then appears three times: the wrapper, its call into the module, and the `/api/admin/:slug/generate-invoices` route, which is unchanged.)

- [ ] **Step 5: Run the file, then the suite** — single file → `# pass 7`, `# fail 0`; full suite → **908 pass, 0 fail**.

- [ ] **Step 6: Restart and prove it on real data without keeping anything.** Restart (Conventions). Then `$L/tmp/t1-check.js` → `/tmp/t1-check.js`, run `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node /tmp/t1-check.js; rm -f /tmp/t1-check.js'`:

```js
'use strict';
// Runs the new generator for September on the demo building lafto-mall (July invoices only) inside a transaction
// that is rolled back. Nothing is kept. Prints counts only.
const R = '/var/www/connectcare/binasmart/';
const { PrismaClient } = require(R + 'node_modules/@prisma/client');
const { generateInvoicesForBuilding } = require(R + 'building/invoices');
const p = new PrismaClient();
(async () => {
  const b = await p.building.findUnique({ where: { qrSlug: 'lafto-mall' }, select: { id: true } });
  const before = await p.invoice.count({ where: { tenancy: { unit: { buildingId: b.id } } } });
  let r = null;
  try {
    await p.$transaction(async tx => {
      r = await generateInvoicesForBuilding(tx, b.id, new Date('2026-09-15T09:00:00Z'));
      throw new Error('ROLLBACK');
    }, { timeout: 60000 });
  } catch (e) { if (e.message !== 'ROLLBACK') throw e; }
  const after = await p.invoice.count({ where: { tenancy: { unit: { buildingId: b.id } } } });
  console.log('inside tx', JSON.stringify(r), '| before', before, 'after', after, '(want created 15, skipped 0, month 9/2026; before = after)');
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
```

Expected: `inside tx {"created":15,"skipped":0,"month":"9/2026"} | before 15 after 15`. If `created` differs, the demo data moved; `before === after` is the part that must hold.

- [ ] **Step 7: Commit** `building/invoices.js test/building/invoices.test.js server.js`:

```
Monthly rent invoices: a clashing payment code no longer ends the run for every building

On 1 August and 1 September the cron stopped part-way (zefmesh-mall 8 of 17 in September, abenezer-mall 3 of 15 in
August, nothing after). Invoice.paymentCode is unique and built from four random digits plus the unit number, unit
numbers repeat across buildings, and a full run expected about one clash (1.17 measured). Prisma threw P2002 and the
single try/catch around all buildings ended the run, so Darulle, last in the order, has no invoices after July.

building/invoices.js now retries a clashing code (up to 8 draws), takes the month in Addis time, and runs each
building on its own; a failure is logged and sent to the admin chats, and the other buildings are still invoiced.
The missing August and September invoices are not created here: that is the owner's decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 2: Tables for messages and links, and the per-building SMS limit

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/sql/20260915_outbound_messages.up.sql`, `prisma/sql/20260915_outbound_messages.down.sql`
- Test: `test/messaging/schema.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/schema.test.js`

```js
'use strict';
// The records the delivery layer writes (design §1.5). No phone number is ever copied into them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const schema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const model = name => { const m = schema.match(new RegExp('model ' + name + ' \\{([\\s\\S]*?)\\n\\}')); assert.ok(m, name + ' missing'); return m[1]; };
const has = (body, f) => assert.match(body, new RegExp('\\n\\s+' + f + '\\s'), f);

test('OutboundBatch, OutboundMessage and InvoiceLink carry what the delivery layer writes, and no phone', () => {
  for (const f of ['id', 'buildingId', 'kind', 'source', 'actor', 'text', 'total', 'createdAt']) has(model('OutboundBatch'), f);
  for (const f of ['batchId', 'buildingId', 'tenancyId', 'userId', 'invoiceId', 'kind', 'channel', 'status', 'smsParts', 'providerId', 'errorKind', 'createdAt', 'updatedAt']) has(model('OutboundMessage'), f);
  for (const f of ['token', 'invoiceId', 'kind', 'expiresAt']) has(model('InvoiceLink'), f);
  assert.match(model('InvoiceLink'), /token\s+String\s+@unique/);
  for (const m of ['OutboundBatch', 'OutboundMessage', 'InvoiceLink']) assert.doesNotMatch(model(m), /phone/i, m);
});

test('Building gets a monthly SMS limit of 500 by default and an optional sender, and the SQL files cover every change', () => {
  assert.match(model('Building'), /smsMonthlyLimit\s+Int\s+@default\(500\)/);
  assert.match(model('Building'), /smsSender\s+String\?/);
  const up = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260915_outbound_messages.up.sql'), 'utf8');
  for (const t of ['"OutboundBatch"', '"OutboundMessage"', '"InvoiceLink"', '"smsMonthlyLimit"', '"smsSender"', '"InvoiceLink_token_key"', '"OutboundMessage_batchId_fkey"'])
    assert.ok(up.includes(t), t);
  const down = fs.readFileSync(path.join(ROOT, 'prisma', 'sql', '20260915_outbound_messages.down.sql'), 'utf8');
  for (const t of ['DROP TABLE IF EXISTS "OutboundMessage"', 'DROP TABLE IF EXISTS "OutboundBatch"', 'DROP TABLE IF EXISTS "InvoiceLink"', 'DROP COLUMN IF EXISTS "smsMonthlyLimit"'])
    assert.ok(down.includes(t), t);
});
```

- [ ] **Step 2: Copy up, run** → `# fail 2` (`OutboundBatch missing`, no SQL file).

- [ ] **Step 3: Schema.** Back up `prisma/schema.prisma`. `$L/tmp/t2_schema.py`:

```python
import io, sys
p = '/var/www/connectcare/binasmart/prisma/schema.prisma'
s = io.open(p, encoding='utf-8', newline='').read()
old = '  notifyTenants    Boolean @default(false)\n'
if s.count(old) != 1: sys.exit('notifyTenants anchor')
s = s.replace(old, old + '  smsMonthlyLimit  Int     @default(500) // SMS parts per Addis calendar month; 0 = no SMS to tenants\n  smsSender        String?               // approved sender name (max 11 characters); null = provider default shortcode\n')
if 'model OutboundBatch' in s: sys.exit('already patched')
s = s.rstrip('\n') + '\n' + r'''
// Tenant messages (owner actions and messaging design §1.5): one batch per send, one row per recipient.
// A notice's text is kept once on the batch; invoices and receipts point at the invoice. No phone numbers here.
model OutboundBatch {
  id         String            @id @default(cuid())
  buildingId String?           // null for transactional SMS (sign-in codes, Plan D)
  kind       String            // notice | reminder | invoice | receipt | otp
  source     String            // daily-renewal | daily-due | daily-penalty | dashboard-send | receipt | backfill-audit | transactional
  actor      String?           // dashboard | cron | ops (Plan B: the owner access id)
  text       String?           // notices only
  total      Int               @default(0)
  createdAt  DateTime          @default(now())
  messages   OutboundMessage[]

  @@index([buildingId, createdAt])
}

model OutboundMessage {
  id         String        @id @default(cuid())
  batchId    String
  batch      OutboundBatch @relation(fields: [batchId], references: [id])
  buildingId String?
  tenancyId  String?
  userId     String?
  invoiceId  String?
  kind       String
  channel    String        // telegram | sms | none
  status     String        // queued | sent | delivered | failed | test
  smsParts   Int           @default(0)
  providerId String?
  errorKind  String?
  createdAt  DateTime      @default(now())
  updatedAt  DateTime      @updatedAt

  @@index([buildingId, createdAt])
  @@index([invoiceId])
  @@index([batchId])
  @@index([providerId])
}

// bina.et/i/<token>: one invoice or receipt, 60 days (design §1.3).
model InvoiceLink {
  id        String   @id @default(cuid())
  token     String   @unique
  invoiceId String
  kind      String   // invoice | receipt
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([invoiceId])
}
'''
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: SQL files.** `$L/prisma/sql/20260915_outbound_messages.up.sql`:

```sql
-- 2026-09-15  Tenant messages: OutboundBatch, OutboundMessage, InvoiceLink; Building.smsMonthlyLimit, Building.smsSender
--
-- messaging/delivery.js records every tenant message here (design docs/superpowers/specs/2026-09-15-owner-actions-
-- messaging-design.md §1.5); messaging/invoice-links.js keeps the bina.et/i/<token> links. Additive only: three new
-- tables and two Building columns (a constant default, so Postgres rewrites no rows). Every building starts with a
-- monthly limit of 500 SMS parts (decided 15 Sep); SMS still goes nowhere while SMS_MODE is not live. No phone numbers are stored.
-- This project applies schema changes with `prisma db push`; the SQL is kept so the change can be reviewed, applied on
-- its own and reversed (.down.sql). After applying: `npx prisma generate`, and
-- `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
-- must print an empty migration.
--
-- Back up Building first:
--   pg_dump -Fc -t '"Building"' -f /root/storage/backups/db/binasmart-Building-<stamp>.dump <database url without ?schema>
SET lock_timeout = '5s';
BEGIN;
ALTER TABLE "Building" ADD COLUMN IF NOT EXISTS "smsMonthlyLimit" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Building" ADD COLUMN IF NOT EXISTS "smsSender" TEXT;
CREATE TABLE IF NOT EXISTS "OutboundBatch" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "text" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboundBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "OutboundMessage" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "buildingId" TEXT,
    "tenancyId" TEXT,
    "userId" TEXT,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "smsParts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "errorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "InvoiceLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OutboundBatch_buildingId_createdAt_idx" ON "OutboundBatch"("buildingId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_buildingId_createdAt_idx" ON "OutboundMessage"("buildingId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_invoiceId_idx" ON "OutboundMessage"("invoiceId");
CREATE INDEX IF NOT EXISTS "OutboundMessage_batchId_idx" ON "OutboundMessage"("batchId");
CREATE INDEX IF NOT EXISTS "OutboundMessage_providerId_idx" ON "OutboundMessage"("providerId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceLink_token_key" ON "InvoiceLink"("token");
CREATE INDEX IF NOT EXISTS "InvoiceLink_invoiceId_idx" ON "InvoiceLink"("invoiceId");
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OutboundBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
```

`$L/prisma/sql/20260915_outbound_messages.down.sql`:

```sql
-- Reverses 20260915_outbound_messages.up.sql.
--
-- Order matters: first revert the server.js wiring of messaging/ (or restore server.js from its .bak-planA-t6 and
-- .bak-planA-t9 copies) and `pm2 restart binasmart-api --update-env`, since that code writes these tables. Then run
-- this file, remove the three models and the two Building lines from prisma/schema.prisma, and `npx prisma generate`.
-- Dropping discards the message records and the short links (links then show the "not valid" page).
SET lock_timeout = '5s';
BEGIN;
DROP TABLE IF EXISTS "OutboundMessage";
DROP TABLE IF EXISTS "OutboundBatch";
DROP TABLE IF EXISTS "InvoiceLink";
ALTER TABLE "Building" DROP COLUMN IF EXISTS "smsSender", DROP COLUMN IF EXISTS "smsMonthlyLimit";
COMMIT;
```

- [ ] **Step 5: Copy everything up and run the test** → `# pass 2`.

- [ ] **Step 6: Compare with what Prisma would do (changes nothing).**
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script'`
The output must contain the same statements as the `.up.sql` (order and whitespace may differ). If Prisma names an index or constraint differently, or writes a type or FK clause differently, change the `.up.sql` to Prisma's text (keep `IF NOT EXISTS`), copy it up and re-run the schema test before Step 7.

- [ ] **Step 7: Back up and apply.** `$L/tmp/t2-apply.sh` → `/tmp/t2-apply.sh`; run `ssh root@31.97.176.180 'bash /tmp/t2-apply.sh'`:

```bash
#!/bin/bash
set -euo pipefail
cd /var/www/connectcare/binasmart
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed 's/?schema=public$//')
STAMP=$(date +%Y%m%d-%H%M%S)
pg_dump "$DBURL" -Fc -t '"Building"' -f /root/storage/backups/db/binasmart-Building-$STAMP.dump
ls -la /root/storage/backups/db/binasmart-Building-$STAMP.dump | awk '{print "backup bytes", $5}'
psql "$DBURL" -v ON_ERROR_STOP=1 -q -f prisma/sql/20260915_outbound_messages.up.sql
npx prisma generate >/dev/null
echo '--- after apply (want: -- This is an empty migration.):'
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

Expected: `backup bytes <n>` (n > 0) and final line `-- This is an empty migration.` If psql fails, the transaction rolls back and nothing changed; fix and re-run.

- [ ] **Step 8: Restart** (Conventions) — the client changed. `/health` ok, no errors. Full suite → **910 pass, 0 fail**.

- [ ] **Step 9: Commit** `prisma/schema.prisma prisma/sql/20260915_outbound_messages.up.sql prisma/sql/20260915_outbound_messages.down.sql test/messaging/schema.test.js`:

```
Tenant messages: tables for every message and short invoice link, and a monthly SMS limit per building

OutboundBatch (one send), OutboundMessage (one recipient: channel, status, SMS parts, provider id, error kind) and
InvoiceLink (bina.et/i/<token>, 60 days). Building.smsMonthlyLimit defaults to 500 SMS parts a month (SMS still goes
nowhere while SMS_MODE is test); Building.smsSender stays null, the provider's default shortcode, until a sender
name of at most 11 characters is approved. No phone number is stored in the new tables.
Applied with the SQL in prisma/sql (Building backed up first); prisma migrate diff is empty afterwards.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 3: SMS — mobile numbers, parts, the test/live gate and the GeezSMS provider

**Files:**
- Create: `messaging/sms.js`
- Test: `test/messaging/sms.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/sms.test.js`

```js
'use strict';
// SMS without a network: a fake fetch stands in for GeezSMS, and a provider that records calls proves when nothing
// may leave the server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEtMobile, smsParts, SMS_MAX_CHARS, labelled, buildingSmsLabel, validSender, DEFAULT_PRICE_TIERS, parsePriceTiers, smsUnitPrice,
  geezSupports, makeSms, makeGeezSms, makeSmsFromEnv } = require('../../messaging/sms');

function recorder({ ok = true, throws = false, error = 'refused' } = {}) {
  const calls = [];
  return { calls, name: 'fake', supports: geezSupports,
    send: async a => { calls.push(a); if (throws) throw new Error('down for 251900000001'); return ok ? { ok: true, providerId: 'P' + calls.length } : { ok: false, error }; } };
}

test('Ethiopian mobiles in every usual spelling become +2519… or +2517…', () => {
  for (const s of ['0900000001', '+251900000001', '251900000001', '00251900000001', '+251 900 000 001', '0900-000-001'])
    assert.equal(normalizeEtMobile(s), '+251900000001', s);
  assert.equal(normalizeEtMobile('0700000001'), '+251700000001');
});

test('landlines, foreign numbers and junk are not mobiles', () => {
  for (const s of ['0111234567', '+251111234567', '+971500000000', '900000001', '09000000011', 'abc', '', null, undefined])
    assert.equal(normalizeEtMobile(s), null, String(s));
});

test('GSM text: 160 characters in one part, 153 per part after that; {[]} count double', () => {
  assert.equal(smsParts(''), 0);
  assert.equal(smsParts('a'.repeat(160)), 1);
  assert.equal(smsParts('a'.repeat(161)), 2);
  assert.equal(smsParts('a'.repeat(306)), 2);
  assert.equal(smsParts('a'.repeat(307)), 3);
  assert.equal(smsParts('{'.repeat(80)), 1);
  assert.equal(smsParts('{'.repeat(81)), 2);
});

test('Amharic (Unicode) text: 70 characters in one part, 67 per part after that', () => {
  assert.equal(smsParts('ሰ'.repeat(70)), 1);
  assert.equal(smsParts('ሰ'.repeat(71)), 2);
  assert.equal(smsParts('ሰ'.repeat(134)), 2);
  assert.equal(smsParts('ሰ'.repeat(135)), 3);
  assert.equal(smsParts('a'.repeat(69) + 'ሰ'), 1);
});

test('test mode never calls the provider, even for a live building', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'test', provider: pr });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: true }), { status: 'test' });
  assert.equal(pr.calls.length, 0);
  assert.equal(sms.mode, 'test');
});

test('live mode still records test when the caller does not allow a live send (demo building)', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr });
  assert.equal(sms.mode, 'live');
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi' }), { status: 'test' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: false }), { status: 'test' });
  assert.equal(pr.calls.length, 0);
});

test('live mode and a live send: the provider gets the +251 number, the sender and the report URL', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr, sender: 'DEFAULT', callbackUrl: 'https://bina.et/api/sms/report/x' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'hi', live: true }), { status: 'sent', providerId: 'P1' });
  assert.deepEqual(await sms.send({ to: '0900000002', text: 'hi', sender: 'Demo', live: true }), { status: 'sent', providerId: 'P2' });
  assert.deepEqual(pr.calls.map(c => [c.to, c.sender, c.callbackUrl]), [['+251900000001', 'DEFAULT', 'https://bina.et/api/sms/report/x'], ['+251900000002', 'Demo', 'https://bina.et/api/sms/report/x']]);
});

test('numbers the provider cannot reach, empty and over-long texts are refused before any call', async () => {
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr });
  assert.deepEqual(await sms.send({ to: '0700000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'sms_unsupported_number' });
  assert.deepEqual(await sms.send({ to: '0111234567', text: 'hi', live: true }), { status: 'failed', errorKind: 'no_mobile' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: '', live: true }), { status: 'failed', errorKind: 'empty' });
  assert.deepEqual(await sms.send({ to: '0900000001', text: 'a'.repeat(SMS_MAX_CHARS + 1), live: true }), { status: 'failed', errorKind: 'too_long' });
  assert.equal(pr.calls.length, 0);
  assert.equal(sms.supports('0900000001'), true);
  assert.equal(sms.supports('0700000001'), false);
  assert.equal(sms.supports(null), false);
});

test('a refusal or a provider error is a failure, and the log never carries the phone number', async () => {
  const logs = [];
  const refused = makeSms({ mode: 'live', provider: recorder({ ok: false, error: 'bad number 251900000001' }), log: m => logs.push(m) });
  assert.deepEqual(await refused.send({ to: '0900000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'sms_refused' });
  const broken = makeSms({ mode: 'live', provider: recorder({ throws: true }), log: m => logs.push(m) });
  assert.deepEqual(await broken.send({ to: '0900000001', text: 'hi', live: true }), { status: 'failed', errorKind: 'provider_error' });
  assert.equal(logs.length, 2);
  for (const l of logs) assert.doesNotMatch(l, /900000001/);
});

test('GeezSMS send: POST form to /api/v1/sms/send, and api_log_id becomes the provider id', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init });
    return { status: 200, json: async () => ({ message_status: 'success', log: 'async 00000000-0000-0000-0000-000000000000', phone: '251900000001', message: 'x', api_log_id: 6569829 }) }; };
  const g = makeGeezSms({ token: 'TOKEN-FAKE', shortcodeId: 'SC1', fetchImpl });
  assert.equal(g.name, 'geezsms');
  assert.deepEqual(await g.send({ to: '+251900000001', text: 'ሰላም', sender: '', callbackUrl: 'https://bina.et/api/sms/report/x' }), { ok: true, providerId: '6569829' });
  assert.equal(calls[0].url, 'https://api.geezsms.com/api/v1/sms/send');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(calls[0].init.body);
  assert.deepEqual([form.get('token'), form.get('phone'), form.get('msg'), form.get('shortcode_id'), form.get('callback')],
    ['TOKEN-FAKE', '251900000001', 'ሰላም', 'SC1', 'https://bina.et/api/sms/report/x']);
  await g.send({ to: '+251900000001', text: 'x', sender: 'Demo' });
  const f2 = new URLSearchParams(calls[1].init.body);
  assert.equal(f2.get('shortcode_id'), 'Demo');
  assert.equal(f2.has('callback'), false);
});

test('GeezSMS: anything but message_status success is a failure', async () => {
  const reply = (status, body) => makeGeezSms({ token: 't', fetchImpl: async () => ({ status, json: async () => { if (body === 'bad') throw new Error('not json'); return body; } }) });
  assert.equal((await reply(200, { message_status: 'failed', msg: 'invalid phone' }).send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.equal((await reply(500, 'bad').send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.equal((await reply(401, { message_status: 'success' }).send({ to: '+251900000001', text: 'x' })).ok, false);
  assert.throws(() => makeGeezSms({ token: '' }), /token/);
  assert.equal(geezSupports('+251900000001'), true);
  assert.equal(geezSupports('+251700000001'), false);
});

test('GeezSMS balance: GET /api/v1/balance with the key header', async () => {
  const calls = [];
  const g = makeGeezSms({ token: 'TOKEN-FAKE', fetchImpl: async (url, init) => { calls.push({ url, init }); return { status: 200, json: async () => ({ balance: 120 }) }; } });
  const r = await g.balance();
  assert.equal(r.ok, true);
  assert.deepEqual(r.body, { balance: 120 });
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].url, /^https:\/\/api\.geezsms\.com\/api\/v1\/balance\?token=TOKEN-FAKE$/);
  assert.equal(calls[0].init.headers['X-GeezSMS-Key'], 'TOKEN-FAKE');
});

test('every SMS starts with a label; a sender over 11 characters falls back to the default; prices come from config', async () => {
  assert.equal(labelled('BinaSmart · Demo Tower', 'ክፍል 211'), 'BinaSmart · Demo Tower፦ ክፍል 211');
  assert.throws(() => labelled('', 'x'), /label/);
  assert.throws(() => labelled('   ', 'x'), /label/);
  assert.equal(buildingSmsLabel('Demo Tower'), 'BinaSmart · Demo Tower');
  assert.equal(buildingSmsLabel('x'.repeat(60)), 'BinaSmart · ' + 'x'.repeat(40));
  assert.equal(buildingSmsLabel(''), 'BinaSmart');
  assert.deepEqual(['BinaSmart', 'BinaSmartETH', '', null, 'Bad<Name>'].map(validSender), ['BinaSmart', '', '', '', '']);
  const pr = recorder();
  const sms = makeSms({ mode: 'live', provider: pr, sender: 'TooLongSenderName' });
  await sms.send({ to: '0900000001', text: 'x', live: true });
  await sms.send({ to: '0900000001', text: 'x', sender: 'BinaSmart', live: true });
  assert.deepEqual(pr.calls.map(c => c.sender), ['', 'BinaSmart']);
  assert.deepEqual(DEFAULT_PRICE_TIERS, [[10000, 0.7475], [50000, 0.4025], [null, 0.2875]]);
  assert.deepEqual([smsUnitPrice(1), smsUnitPrice(10000), smsUnitPrice(10001), smsUnitPrice(50001)], [0.7475, 0.7475, 0.4025, 0.2875]);
  assert.deepEqual(parsePriceTiers('[[100,1],[null,0.5]]'), [[100, 1], [null, 0.5]]);
  for (const bad of [undefined, '', 'nope', '[]', '[[1]]', '[["a",1]]']) assert.deepEqual(parsePriceTiers(bad), DEFAULT_PRICE_TIERS, String(bad));
});

test('from the environment: live only with SMS_MODE=live and a GeezSMS token', () => {
  assert.deepEqual([makeSmsFromEnv({}).mode, makeSmsFromEnv({}).provider], ['test', null]);
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'live' }).mode, 'test');
  const live = makeSmsFromEnv({ SMS_MODE: 'live', SMS_API_TOKEN: 't' });
  assert.deepEqual([live.mode, live.provider], ['live', 'geezsms']);
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'live', SMS_API_TOKEN: 't', SMS_PROVIDER: 'other' }).mode, 'test');
  assert.equal(makeSmsFromEnv({ SMS_MODE: 'test', SMS_API_TOKEN: 't' }).mode, 'test');
});
```

- [ ] **Step 2: Copy up, run** → fails: `Cannot find module '../../messaging/sms'`.

- [ ] **Step 3: Implement** — `$L/messaging/sms.js`

```js
'use strict';
// SMS for tenant messages (and, in Plan D, sign-in codes). One provider interface; GeezSMS is the first provider.
//
//   provider = { name, send({ to, text, sender, callbackUrl }) → { ok, providerId, error }, balance(), supports(e164) }
//   makeSms({ mode, provider, supports, sender, callbackUrl, log }).send({ to, text, sender, live })
//     → { status: 'test' } | { status: 'sent', providerId } | { status: 'failed', errorKind }
//
// Nothing leaves the server unless SMS_MODE is 'live', a provider token is configured, AND the caller passes
// live: true (a real building, or a transactional message). Credentials come only from the environment:
//   SMS_PROVIDER=geezsms  SMS_API_TOKEN  SMS_SHORTCODE_ID (optional)  SMS_MODE=test|live (default test)
// Logs never carry a phone number, a token or the text.

// GeezSMS: msg must be shorter than 335 characters.
const SMS_MAX_CHARS = 334;
const GEEZ_BASE = 'https://api.geezsms.com';

// +2519XXXXXXXX (Ethio Telecom) and +2517XXXXXXXX (Safaricom Ethiopia); anything else is not a mobile.
function normalizeEtMobile(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[\s\-.()]/g, '');
  if (/^0[79]\d{8}$/.test(s)) s = '+251' + s.slice(1);
  else if (/^00251[79]\d{8}$/.test(s)) s = '+' + s.slice(2);
  else if (/^251[79]\d{8}$/.test(s)) s = '+' + s;
  return /^\+251[79]\d{8}$/.test(s) ? s : null;
}

// GeezSMS documents phone numbers starting 2519. Whether it reaches 2517 (Safaricom) is an open fact: until it is
// confirmed, those tenants count as not reachable by SMS.
const geezSupports = e164 => /^\+2519\d{8}$/.test(String(e164 || ''));

// Until a sender name is approved every SMS goes out under GeezSMS's default shortcode, so the text itself must say who
// is writing. labelled() is the only way the delivery layer builds an SMS: no label, no SMS.
function labelled(label, body) {
  const l = String(label == null ? '' : label).trim();
  if (!l) throw new Error('sms: a label (the service or building) is required at the start of every SMS');
  return l + '፦ ' + String(body == null ? '' : body);
}
const buildingSmsLabel = name => { const n = String(name == null ? '' : name).trim().slice(0, 40); return n ? 'BinaSmart · ' + n : 'BinaSmart'; };
// GeezSMS: a sender name is at most 11 characters. Anything else means the provider's default shortcode.
const validSender = v => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .-]{0,10}$/.test(v) ? v : '');

// ETB per SMS including 15% VAT, by SMS count in the month (GeezSMS account, 15 Sep 2026): [up to, price], null = above.
// For estimates only (previews, ops report); SMS_PRICE_TIERS in the environment replaces it.
const DEFAULT_PRICE_TIERS = [[10000, 0.7475], [50000, 0.4025], [null, 0.2875]];
function parsePriceTiers(raw) {
  try {
    const t = JSON.parse(raw);
    if (Array.isArray(t) && t.length && t.every(x => Array.isArray(x) && x.length === 2 && (x[0] === null || Number.isFinite(x[0])) && Number.isFinite(x[1]) && x[1] >= 0)) return t;
  } catch (e) { /* fall through */ }
  return DEFAULT_PRICE_TIERS;
}
function smsUnitPrice(monthlyCount, tiers = DEFAULT_PRICE_TIERS) {
  for (const [upTo, price] of tiers) if (upTo === null || monthlyCount <= upTo) return price;
  return tiers[tiers.length - 1][1];
}

// Parts, as operators count them: GSM-7 160 / 153, otherwise UCS-2 70 / 67. GeezSMS's own counting is an open fact;
// this is the planning estimate used for the monthly limit.
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXT = '^{}\\[~]|€';
function smsParts(text) {
  const s = String(text == null ? '' : text);
  if (!s) return 0;
  let septets = 0;
  for (const ch of s) {
    if (GSM.includes(ch)) septets += 1;
    else if (GSM_EXT.includes(ch)) septets += 2;
    else { septets = -1; break; }
  }
  if (septets >= 0) return septets <= 160 ? 1 : Math.ceil(septets / 153);
  return s.length <= 70 ? 1 : Math.ceil(s.length / 67);   // UTF-16 code units = UCS-2 units
}

// digit runs of 6+ (phone numbers) are cut out of anything logged
const clean = v => String(v == null ? '' : v).replace(/\+?\d[\d\s-]{4,}\d/g, '…').slice(0, 80);

function makeSms({ mode = 'test', provider = null, supports = geezSupports, sender = '', callbackUrl = '', log = () => {} } = {}) {
  const live = mode === 'live' && !!provider;
  async function send({ to, text, sender: s = '', live: mayGoLive = false } = {}) {
    const e164 = normalizeEtMobile(to);
    if (!e164) return { status: 'failed', errorKind: 'no_mobile' };
    if (!supports(e164)) return { status: 'failed', errorKind: 'sms_unsupported_number' };
    const body = String(text == null ? '' : text);
    if (!body) return { status: 'failed', errorKind: 'empty' };
    if (body.length > SMS_MAX_CHARS) return { status: 'failed', errorKind: 'too_long' };
    if (!live || mayGoLive !== true) return { status: 'test' };
    try {
      const r = await provider.send({ to: e164, text: body, sender: validSender(s) || validSender(sender), callbackUrl });
      if (r && r.ok) return { status: 'sent', providerId: r.providerId || null };
      log('[sms] refused by ' + (provider.name || 'provider') + ': ' + clean(r && r.error));
      return { status: 'failed', errorKind: 'sms_refused' };
    } catch (e) {
      log('[sms] ' + (provider.name || 'provider') + ' error: ' + clean(e && e.message));
      return { status: 'failed', errorKind: 'provider_error' };
    }
  }
  const canReach = raw => { const e = normalizeEtMobile(raw); return !!e && !!supports(e); };
  return { send, supports: canReach, mode: live ? 'live' : 'test', provider: provider ? provider.name : null };
}

function makeGeezSms({ token, shortcodeId = '', fetchImpl = fetch, baseUrl = GEEZ_BASE, timeoutMs = 15000 } = {}) {
  if (!token) throw new Error('makeGeezSms: token required');
  async function call(url, init) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(url, { ...init, signal: ctl.signal });
      let body = null;
      try { body = await r.json(); } catch (e) { body = null; }
      return { status: r.status, body };
    } finally { clearTimeout(timer); }
  }
  async function send({ to, text, sender, callbackUrl }) {
    const form = new URLSearchParams();
    form.set('token', token);
    form.set('phone', String(to).replace(/^\+/, ''));
    form.set('msg', String(text));
    const sc = sender || shortcodeId;
    if (sc) form.set('shortcode_id', sc);
    if (callbackUrl) form.set('callback', callbackUrl);
    const { status, body } = await call(baseUrl + '/api/v1/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (status >= 200 && status < 300 && body && body.message_status === 'success')
      return { ok: true, providerId: body.api_log_id != null ? String(body.api_log_id) : (body.log ? String(body.log) : null) };
    return { ok: false, error: 'http ' + status + ' ' + String((body && (body.message_status || body.msg || body.error)) || '') };
  }
  async function balance() {
    const { status, body } = await call(baseUrl + '/api/v1/balance?token=' + encodeURIComponent(token), { method: 'GET', headers: { 'X-GeezSMS-Key': token } });
    return { ok: status >= 200 && status < 300 && !!body, status, body };
  }
  return { name: 'geezsms', send, balance, supports: geezSupports };
}

function makeSmsFromEnv(env = process.env, { fetchImpl, log, callbackUrl } = {}) {
  const name = String(env.SMS_PROVIDER || 'geezsms').toLowerCase();
  const provider = name === 'geezsms' && env.SMS_API_TOKEN
    ? makeGeezSms({ token: env.SMS_API_TOKEN, shortcodeId: env.SMS_SHORTCODE_ID || '', ...(fetchImpl ? { fetchImpl } : {}) })
    : null;
  return makeSms({ mode: env.SMS_MODE === 'live' ? 'live' : 'test', provider, supports: geezSupports,
    sender: env.SMS_SHORTCODE_ID || '', callbackUrl: callbackUrl || '', log: log || (() => {}) });
}

module.exports = { normalizeEtMobile, smsParts, SMS_MAX_CHARS, GEEZ_BASE, labelled, buildingSmsLabel, validSender, DEFAULT_PRICE_TIERS, parsePriceTiers, smsUnitPrice,
  geezSupports, makeSms, makeGeezSms, makeSmsFromEnv };
```

- [ ] **Step 4: Copy up, run the file** → `# pass 14`, `# fail 0`. Full suite → **924 pass, 0 fail**. (No restart: nothing loads this module yet.)

- [ ] **Step 5: Commit** `messaging/sms.js test/messaging/sms.test.js`:

```
SMS: Ethiopian mobile numbers, SMS parts, a test/live gate and the GeezSMS provider

messaging/sms.js sends nothing unless SMS_MODE=live, a GeezSMS token is set and the caller allows a live send; every
other path answers "test" without a network call. GeezSMS is behind a small provider interface (send, balance,
supports), posting form data to /api/v1/sms/send; api_log_id becomes the provider id. Numbers are normalised to
+2519/+2517; 2517 counts as not reachable by SMS until GeezSMS confirms it. Parts are estimated at 160/153 GSM and
70/67 Unicode; texts over 334 characters are refused. Every SMS starts with a required label ("BinaSmart · <building>")
because it goes out under the provider's default shortcode until a sender name (max 11 characters) is approved. Price
tiers from the account (0.7475 / 0.4025 / 0.2875 ETB incl. VAT) are config, used for estimates only. Logs never carry
a phone number or the token.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 4: The delivery layer

**Files:**
- Create: `messaging/delivery.js`
- Test: `test/messaging/delivery.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/delivery.test.js`

```js
'use strict';
// One road for every tenant message, over an in-memory store, a fake Telegram and a recording SMS provider.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDelivery, addisMonthStart } = require('../../messaging/delivery');
const { makeSms, geezSupports, smsParts } = require('../../messaging/sms');

const NOW = new Date('2026-10-10T09:00:00Z');
function memStore() {
  const s = { batches: [], messages: [], seq: 0 };
  return {
    s,
    createBatch: async d => { const b = { id: 'B' + (++s.seq), ...d }; s.batches.push(b); return { id: b.id }; },
    createMessage: async d => { const m = { id: 'M' + (++s.seq), createdAt: NOW, smsParts: 0, providerId: null, errorKind: null, ...d }; s.messages.push(m); return { id: m.id }; },
    updateMessage: async (id, d) => { Object.assign(s.messages.find(m => m.id === id), d); return { id }; },
    smsPartsSinceAll: async (since, statuses) => s.messages.filter(m => m.channel === 'sms' && statuses.includes(m.status) && m.createdAt >= since).reduce((a, m) => a + (m.smsParts || 0), 0),
    smsPartsSince: async (b, since, statuses) => s.messages.filter(m => m.buildingId === b && m.channel === 'sms' && statuses.includes(m.status) && m.createdAt >= since).reduce((a, m) => a + (m.smsParts || 0), 0),
    userHadSms: async (u, statuses) => s.messages.some(m => m.userId === u && m.channel === 'sms' && statuses.includes(m.status)),
    markByProvider: async (ids, status) => { let n = 0; for (const m of s.messages) if (ids.includes(m.providerId) && m.channel === 'sms' && ['queued', 'sent'].includes(m.status)) { m.status = status; n++; } return n; },
  };
}
function recorder({ ok = true } = {}) {
  const calls = [];
  return { calls, name: 'fake', supports: geezSupports, send: async a => { calls.push(a); return ok ? { ok: true, providerId: 'P' + calls.length } : { ok: false, error: 'no' }; } };
}
function setup({ mode = 'test', tgOk = true } = {}) {
  const store = memStore(), tg = [], provider = recorder();
  const d = makeDelivery({ store, now: () => NOW, sms: makeSms({ mode, provider, supports: geezSupports }),
    sendTg: async (chat, text) => { tg.push({ chat, text }); return tgOk; } });
  return { store, tg, provider, d };
}
const REAL = { id: 'b1', slug: 'darulle', real: true, smsLabel: 'BinaSmart · Darulle', smsMonthlyLimit: 100, smsSender: '' };
const DEMO = { id: 'b2', slug: 'century-mall', real: false, smsLabel: 'BinaSmart · Demo', smsMonthlyLimit: 100, smsSender: '' };
const FIRST = 'BinaSmart · Darulle፦ short text\nTelegram: t.me/bina_smart_bot?start=tenant_darulle';   // a tenant's first SMS
const rcpt = (o = {}) => ({ tenancyId: 't1', userId: 'u1', telegramChatId: null, phone: '0900000001', text: 'full text', smsText: 'short text', ...o });
const send = (d, building, recipients, extra = {}) => d.sendToTenants({ building, kind: 'invoice', source: 'dashboard-send', actor: 'dashboard', recipients, ...extra });

test('a tenant who linked Telegram gets the full text by Telegram, and nothing by SMS', async () => {
  const { store, tg, provider, d } = setup();
  const r = await send(d, REAL, [rcpt({ telegramChatId: '4242' })]);
  assert.equal(r.ok, true);
  assert.deepEqual(tg, [{ chat: '4242', text: 'full text' }]);
  assert.equal(provider.calls.length, 0);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['telegram', 'sent']]);
  assert.deepEqual(store.s.messages.map(m => [m.channel, m.status, m.kind, m.invoiceId]), [['telegram', 'sent', 'invoice', null]]);
  assert.deepEqual(r.counts, { telegram: 1, sms: 0, none: 0, sent: 1, test: 0, failed: 0 });
});

test('without Telegram, a mobile gets SMS — recorded as test while SMS is in test mode', async () => {
  const { store, tg, provider, d } = setup();
  const r = await send(d, REAL, [rcpt()]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['sms', 'test']]);
  assert.equal(tg.length, 0);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.s.messages[0].smsParts, smsParts(FIRST));
  assert.equal(smsParts(FIRST), 2, 'label and Telegram link make the first SMS two Unicode parts');
});

test('no Telegram and no reachable mobile: recorded as not delivered, with the reason', async () => {
  const { d } = setup();
  const r = await send(d, REAL, [rcpt({ tenancyId: 'a', phone: '0700000001' }), rcpt({ tenancyId: 'b', phone: '0111234567' }), rcpt({ tenancyId: 'c', phone: null })]);
  assert.deepEqual(r.results.map(x => [x.tenancyId, x.channel, x.status, x.errorKind]),
    [['a', 'none', 'failed', 'sms_unsupported_number'], ['b', 'none', 'failed', 'no_mobile'], ['c', 'none', 'failed', 'no_contact']]);
  assert.equal(r.ok, false);
});

test('a demo building reaches nobody: Telegram and SMS are both recorded as test, even with SMS live', async () => {
  const { tg, provider, d } = setup({ mode: 'live' });
  const r = await send(d, DEMO, [rcpt({ tenancyId: 'a', telegramChatId: '1' }), rcpt({ tenancyId: 'b', userId: 'u2' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['telegram', 'test'], ['sms', 'test']]);
  assert.equal(tg.length, 0);
  assert.equal(provider.calls.length, 0);
});

test('a batch that needs more SMS parts than the month has left is refused whole: nothing is sent', async () => {
  const { store, tg, provider, d } = setup({ mode: 'live' });
  const r = await send(d, { ...REAL, smsMonthlyLimit: 1 }, [rcpt({ tenancyId: 'a', telegramChatId: '1' }), rcpt({ tenancyId: 'b', userId: 'u2' }), rcpt({ tenancyId: 'c', userId: 'u3', phone: '0900000003' })]);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'sms_limit');
  assert.deepEqual([r.needed, r.remaining], [4, 1]);
  assert.equal(tg.length + provider.calls.length, 0);
  assert.deepEqual(store.s.messages.map(m => [m.channel, m.status, m.errorKind]), [['none', 'failed', 'sms_limit'], ['none', 'failed', 'sms_limit'], ['none', 'failed', 'sms_limit']]);
  const zero = await send(d, { ...REAL, smsMonthlyLimit: 0 }, [rcpt({ userId: 'u9' })]);
  assert.equal(zero.error, 'sms_limit', 'a building without a limit sends no SMS');
});

test('this month’s usage counts from midnight Addis time; test rows count only while SMS is in test mode', async () => {
  assert.equal(addisMonthStart(NOW).toISOString(), '2026-09-30T21:00:00.000Z');
  const t = setup();
  t.store.s.messages.push({ id: 'old', buildingId: 'b1', channel: 'sms', status: 'test', smsParts: 5, createdAt: new Date('2026-09-30T20:59:00Z') });
  t.store.s.messages.push({ id: 'new', buildingId: 'b1', channel: 'sms', status: 'test', smsParts: 5, createdAt: new Date('2026-09-30T21:00:00Z') });
  assert.equal((await send(t.d, { ...REAL, smsMonthlyLimit: 7 }, [rcpt()])).ok, true, '5 used of 7, a two-part first SMS fits');
  assert.equal((await send(t.d, { ...REAL, smsMonthlyLimit: 7 }, [rcpt({ userId: 'u2' })])).error, 'sms_limit', '7 used of 7');
  const live = setup({ mode: 'live' });
  live.store.s.messages.push({ id: 'x', buildingId: 'b1', channel: 'sms', status: 'test', smsParts: 50, createdAt: NOW });
  assert.equal((await send(live.d, { ...REAL, smsMonthlyLimit: 2 }, [rcpt()])).ok, true, 'test rows do not use up the live limit');
});

test('when Telegram refuses, the same message goes by SMS on the same row, and says Telegram failed', async () => {
  const { store, tg, provider, d } = setup({ mode: 'live', tgOk: false });
  const r = await send(d, REAL, [rcpt({ telegramChatId: '1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status, x.errorKind]), [['sms', 'sent', 'tg_failed']]);
  assert.equal(tg.length, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(store.s.messages.length, 1);
  const noPhone = await send(d, REAL, [rcpt({ telegramChatId: '1', phone: null })]);
  assert.deepEqual(noPhone.results.map(x => [x.channel, x.status, x.errorKind]), [['telegram', 'failed', 'tg_failed']]);
});

test('the first SMS a tenant receives ends with the Telegram start link; later ones do not', async () => {
  const { provider, d } = setup({ mode: 'live' });
  await send(d, REAL, [rcpt()]);
  await send(d, REAL, [rcpt()]);
  assert.equal(provider.calls[0].text, FIRST);
  assert.equal(provider.calls[1].text, 'BinaSmart · Darulle፦ short text');
});

test('an SMS cannot be planned without a label; a Telegram-only send does not need one', async () => {
  const { d } = setup();
  await assert.rejects(send(d, { ...REAL, smsLabel: '' }, [rcpt()]), /label/);
  assert.equal((await send(d, { ...REAL, smsLabel: '' }, [rcpt({ telegramChatId: '1' })])).ok, true);
});

test('SMS live on a real building: the provider is called with the building’s sender, and its id is kept', async () => {
  const { store, provider, d } = setup({ mode: 'live' });
  const r = await send(d, { ...REAL, smsSender: 'DemoSender' }, [rcpt({ invoiceId: 'inv1' })]);
  assert.deepEqual(r.results.map(x => [x.channel, x.status]), [['sms', 'sent']]);
  assert.deepEqual([provider.calls[0].to, provider.calls[0].sender], ['+251900000001', 'DemoSender']);
  assert.deepEqual([store.s.messages[0].providerId, store.s.messages[0].invoiceId, store.s.messages[0].status], ['P1', 'inv1', 'sent']);
});

test('a notice keeps its text once on the batch; nothing stored carries a phone number', async () => {
  const { store, d } = setup();
  await d.sendToTenants({ building: REAL, kind: 'notice', source: 'owner-action', actor: 'access-1', text: 'ነገ ውሃ ይቋረጣል', recipients: [rcpt(), rcpt({ tenancyId: 't2', userId: 'u2', telegramChatId: '9' })] });
  await send(d, REAL, [rcpt()]);
  assert.deepEqual(store.s.batches.map(b => [b.kind, b.text, b.total, b.actor]), [['notice', 'ነገ ውሃ ይቋረጣል', 2, 'access-1'], ['invoice', null, 1, 'dashboard']]);
  assert.doesNotMatch(JSON.stringify(store.s), /900000001/);
});

test('plan() previews channels, parts and the limit without writing anything', async () => {
  const { store, d } = setup();
  const p = await d.plan({ building: { ...REAL, smsMonthlyLimit: 3 }, recipients: [rcpt({ telegramChatId: '1' }), rcpt({ userId: 'u2' }), rcpt({ phone: null })] });
  assert.deepEqual(p.counts, { telegram: 1, sms: 1, none: 1 });
  assert.deepEqual([p.smsParts, p.used, p.limit, p.remaining, p.withinLimit, p.mode], [2, 0, 3, 3, true, 'test']);
  assert.deepEqual([p.unitPriceEtb, p.costEtb], [0.7475, Math.round(2 * 0.7475 * 100) / 100]);
  assert.equal(store.s.batches.length + store.s.messages.length, 0);
});

test('transactional SMS (sign-in codes): no building, the code is never stored, test until live', async () => {
  const t = setup();
  await assert.rejects(t.d.sendTransactionalSms({ to: '0900000001', text: 'code 123456' }), /label/);
  const r = await t.d.sendTransactionalSms({ to: '0900000001', text: 'code 123456', label: 'BinaSmart', kind: 'otp' });
  assert.deepEqual([r.status, r.channel], ['test', 'sms']);
  assert.deepEqual(t.store.s.batches.map(b => [b.buildingId, b.kind, b.source, b.text]), [[null, 'otp', 'transactional', null]]);
  assert.doesNotMatch(JSON.stringify(t.store.s), /123456|900000001/);
  const live = setup({ mode: 'live' });
  assert.equal((await live.d.sendTransactionalSms({ to: '0900000001', text: 'code 1', label: 'BinaSmart' })).status, 'sent');
  assert.deepEqual([live.provider.calls.length, live.provider.calls[0].text], [1, 'BinaSmart፦ code 1']);
  assert.deepEqual(await live.d.sendTransactionalSms({ to: '0700000001', text: 'code 2', label: 'BinaSmart' }), { status: 'failed', channel: 'none', errorKind: 'sms_unsupported_number', messageId: live.store.s.messages[1].id });
});

test('delivery reports move a sent SMS to delivered or failed by provider id; the logged shape has no values', async () => {
  const { store, d } = setup({ mode: 'live' });
  await send(d, REAL, [rcpt(), rcpt({ tenancyId: 't2', userId: 'u2' })]);
  assert.equal(await d.applyDeliveryReport({ api_log_id: 'P1', status: 'DELIVERED' }), 1);
  assert.equal(await d.applyDeliveryReport({ log: 'P1', status: 'undelivered' }), 0, 'a delivered row is not moved back');
  assert.equal(await d.applyDeliveryReport({ log: 'P2', delivery_status: 'Undelivered' }), 1);
  assert.equal(await d.applyDeliveryReport({ foo: 1 }), 0);
  assert.equal(await d.applyDeliveryReport({ api_log_id: 'P1', message_status: 'success' }), 0);
  assert.deepEqual(store.s.messages.map(m => m.status), ['delivered', 'failed']);
  assert.equal(d.reportShape({ api_log_id: 6569829, phone: '251900000001', status: 'x', list: [] }), 'api_log_id:number,phone:string,status:string,list:array');
});
```

- [ ] **Step 2: Copy up, run** → fails: `Cannot find module '../../messaging/delivery'`.

- [ ] **Step 3: Implement** — `$L/messaging/delivery.js`

```js
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

const COUNTED_LIVE = ['queued', 'sent', 'delivered'];
const COUNTED_TEST = ['queued', 'sent', 'delivered', 'test'];
const DELIVERED = ['sent', 'delivered'];

// The first instant of this calendar month in Addis Ababa (UTC+3, no daylight saving), as a Date.
function addisMonthStart(now = new Date()) {
  const d = new Date(now.getTime() + 3 * 3600000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 3 * 3600000);
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
  const counted = () => (sms.mode === 'live' ? COUNTED_LIVE : COUNTED_TEST);
  const hadSmsStatuses = () => (sms.mode === 'live' ? DELIVERED : COUNTED_TEST);

  // The first SMS a tenant receives ends with the building's Telegram start link (design §2), if it still fits.
  async function smsTextFor(building, r) {
    const base = labelled(building.smsLabel, String(r.smsText || r.text || ''));
    if (!building.slug || !r.userId || await store.userHadSms(r.userId, hadSmsStatuses())) return base;
    const hinted = base + '\nTelegram: t.me/' + botUsername + '?start=tenant_' + building.slug;
    return hinted.length <= SMS_MAX_CHARS ? hinted : base;
  }

  function noneReason(r) {
    if (!r.phone) return 'no_contact';
    return normalizeEtMobile(r.phone) ? 'sms_unsupported_number' : 'no_mobile';
  }

  async function plan({ building, recipients }) {
    const rows = [];
    let parts = 0;
    for (const r of recipients || []) {
      const tenancyId = r.tenancyId || null;
      if (r.telegramChatId) rows.push({ tenancyId, channel: 'telegram', smsParts: 0 });
      else if (sms.supports(r.phone)) {
        const smsText = await smsTextFor(building, r);
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
    const p = await plan({ building, recipients: list });
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
    const deliverOne = async (r, row) => {
      if (row.channel === 'none') {
        const m = await store.createMessage({ ...base(r), channel: 'none', status: 'failed', errorKind: row.errorKind });
        return result(r, m.id, 'none', 'failed', row.errorKind);
      }
      if (row.channel === 'sms') {
        const m = await store.createMessage({ ...base(r), channel: 'sms', status: 'queued', smsParts: row.smsParts });
        return sendSms(r, m.id, row.smsText, row.smsParts, null);
      }
      if (building.real !== true) {
        const m = await store.createMessage({ ...base(r), channel: 'telegram', status: 'test' });
        return result(r, m.id, 'telegram', 'test');
      }
      const m = await store.createMessage({ ...base(r), channel: 'telegram', status: 'queued' });
      let ok = false;
      try { ok = (await sendTg(r.telegramChatId, String(r.text || ''))) === true; } catch (e) { ok = false; }
      if (ok) { await store.updateMessage(m.id, { status: 'sent' }); return result(r, m.id, 'telegram', 'sent'); }
      const smsText = sms.supports(r.phone) ? await smsTextFor(building, r) : null;
      const n = smsText ? smsParts(smsText) : 0;
      if (!smsText || n > remaining) {
        await store.updateMessage(m.id, { status: 'failed', errorKind: 'tg_failed' });
        return result(r, m.id, 'telegram', 'failed', 'tg_failed');
      }
      return sendSms(r, m.id, smsText, n, 'tg_failed');
    };

    for (let i = 0; i < list.length; i++) {
      let res;
      try { res = await deliverOne(list[i], p.rows[i]); }
      catch (e) { log('[delivery] ' + String(e && e.message).slice(0, 120)); res = result(list[i], null, p.rows[i].channel, 'failed', 'error'); }
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
    await store.updateMessage(m.id, { status: s.status, providerId: s.providerId || null, errorKind: s.errorKind || null });
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

module.exports = { makeDelivery, makeDeliveryStore, addisMonthStart };
```

- [ ] **Step 4: Copy up, run the file** → `# pass 14`, `# fail 0`. Full suite → **938 pass, 0 fail**.

- [ ] **Step 5: Commit** `messaging/delivery.js test/messaging/delivery.test.js`:

```
Delivery layer: Telegram if linked, else SMS, else recorded as not delivered — one channel per message

messaging/delivery.js records every attempt (OutboundBatch/OutboundMessage), refuses a batch whose SMS parts exceed
the building's remaining monthly limit instead of half-sending it, falls back from a refused Telegram message to SMS
on the same row, starts every SMS with its required label and adds the Telegram start link to a tenant's first SMS,
and treats every building that is not real as test. plan() also estimates the cost from the configured price tiers. plan() previews without writing (for owner actions), sendTransactionalSms() serves sign-in codes later, and
delivery reports can only move an SMS row to delivered or failed. No phone number or code is stored.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 5: Invoice and receipt texts, short links, and the link page

**Files:**
- Create: `messaging/invoice-text.js`, `messaging/invoice-links.js`, `messaging/invoice-page.js`
- Test: `test/messaging/invoice-text.test.js`, `test/messaging/invoice-links.test.js`

- [ ] **Step 1: Write the failing tests**

`$L/test/messaging/invoice-text.test.js`

```js
'use strict';
// The Telegram invoice and receipt must read exactly as they do today (server.js at 500df05), with one optional line
// for the short link; the SMS versions must fit GeezSMS's 334 characters even with the Telegram start link added.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invoiceMessage, receiptMessage, invoiceSms, receiptSms } = require('../../messaging/invoice-text');
const { SMS_MAX_CHARS, labelled, buildingSmsLabel } = require('../../messaging/sms');

// Copied from server.js POST /api/owner/:slug/invoice/:id/send at 500df05 (b = building, inv = invoice with tenancy).
function oldInvoice(b, inv) {
  const total = inv.amount + (inv.lateFee || 0);
  const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
  const banks = (b.bankAccounts || []).map(a => '• ' + a.bank + ': ' + a.account).join('\n');
  return '🧾 የክፍያ መጠየቂያ / INVOICE\n' +
    '━━━━━━━━━━━━━━━\n' +
    '🏢 ' + (b.nameAm || b.name) + '\n' + b.name + (b.tinNumber ? ' · TIN ' + b.tinNumber : '') + '\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : inv.tenancy.user.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
    '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
    (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
    '\n📌 ጠቅላላ / TOTAL: ' + total.toLocaleString() + ' ETB\n' +
    '📅 መክፈያ ቀን / Due: ' + inv.dueDate.toISOString().slice(0, 10) + '\n' +
    (banks ? '━━━━━━━━━━━━━━━\n🏦 የሚከፈልበት / Pay to:\n' + banks + '\n' : '') +
    (inv.paymentCode ? '#️⃣ ማጣቀሻ / Reference: ' + inv.paymentCode + '\n' : '') +
    '━━━━━━━━━━━━━━━\n' +
    'ክፍያ ሲፈጽሙ ኮዱን እንደ ማጣቀሻ ይጠቀሙ። / Use the reference code with your transfer.\n— ' + b.name + ' · BinaSmart';
}
// Copied from server.js POST /api/admin/invoices/:id/pay at 500df05; `new Date()` there is `paidAt` here.
function oldReceipt(bb, inv, tu, method, paidAt) {
  const total = inv.amount + (inv.lateFee || 0);
  const typeAm = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' }[inv.type] || 'ክፍያ';
  const vatLine = bb.vatRegistered ? '\nVAT (15%): ' + Math.round(total * 0.15 / 1.15).toLocaleString() + ' ETB (ተካቷል/incl.)' : '';
  return '🧾 ደረሰኝ / E-RECEIPT\n' +
    '━━━━━━━━━━━━━━━\n' +
    '🏢 ' + (bb.nameAm || bb.name) + '\n' + bb.name + (bb.tinNumber ? ' · TIN ' + bb.tinNumber : '') + '\n' +
    '━━━━━━━━━━━━━━━\n' +
    '👤 ' + (inv.tenancy.shop ? (inv.tenancy.shop.nameAm || inv.tenancy.shop.name) : tu.fullName) + ' — ክፍል ' + inv.tenancy.unit.number + '\n' +
    '💰 ' + typeAm + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB' +
    (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '') +
    '\n✅ ጠቅላላ የተከፈለ / TOTAL PAID: ' + total.toLocaleString() + ' ETB' + vatLine + '\n' +
    '💳 በ: ' + (method || 'CASH') + ' · ' + paidAt.toISOString().slice(0, 10) + '\n' +
    (inv.paymentCode ? '#️⃣ ' + inv.paymentCode + '\n' : '') +
    '━━━━━━━━━━━━━━━\n' +
    'እናመሰግናለን! / Thank you!\n📊 BinaSmart · bina.et/b/' + bb.qrSlug;
}

const B = { name: 'Demo Tower', nameAm: 'ዴሞ ታወር', tinNumber: '0000000000', qrSlug: 'demo-tower', vatRegistered: true, bankAccounts: [{ bank: 'CBE', account: '1000000000000' }] };
const B2 = { name: 'Demo Plaza', nameAm: '', tinNumber: null, qrSlug: 'demo-plaza', vatRegistered: false, bankAccounts: null };
const shopInv = { type: 'RENT', amount: 12500, lateFee: 1250, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-1234-211',
  tenancy: { unit: { number: '211' }, shop: { name: 'Demo Shop', nameAm: 'ዴሞ ሱቅ' }, user: { fullName: 'Demo Tenant' } } };
const userInv = { type: 'WATER', amount: 800, lateFee: 0, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: null,
  tenancy: { unit: { number: 'G-03' }, shop: null, user: { fullName: 'Demo Tenant' } } };
const PAID = new Date('2026-10-07T10:00:00Z');

test('the Telegram invoice text is today’s text, for a shop and for a person', () => {
  for (const [b, inv] of [[B, shopInv], [B2, userInv]])
    assert.equal(invoiceMessage({ building: b, invoice: inv, tenancy: inv.tenancy }), oldInvoice(b, inv));
});

test('the Telegram receipt text is today’s text', () => {
  for (const [b, inv, m] of [[B, shopInv, 'CBE'], [B2, userInv, undefined]])
    assert.equal(receiptMessage({ building: b, invoice: inv, tenancy: inv.tenancy, method: m, paidAt: PAID }), oldReceipt(b, inv, inv.tenancy.user, m, PAID));
});

test('with a short link, one line is added after the reference and nothing else changes', () => {
  const link = 'bina.et/i/AAAAAAAAAAAA';
  const withLink = invoiceMessage({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  assert.equal(withLink, oldInvoice(B, shopInv).replace('#️⃣ ማጣቀሻ / Reference: BS-1234-211\n', '#️⃣ ማጣቀሻ / Reference: BS-1234-211\n🔗 ' + link + '\n'));
  const r = receiptMessage({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, method: 'CBE', paidAt: PAID, link });
  assert.equal(r, oldReceipt(B, shopInv, shopInv.tenancy.user, 'CBE', PAID).replace('#️⃣ BS-1234-211\n', '#️⃣ BS-1234-211\n🔗 ' + link + '\n'));
});

test('the SMS bodies give unit, total, due date and link, carry no tenant name, and fit with label and Telegram link', () => {
  const link = 'bina.et/i/AAAAAAAAAAAA';
  const s = invoiceSms({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  const total = (13750).toLocaleString('en-US');
  assert.equal(s, 'የክፍያ መጠየቂያ፣ ክፍል 211፣ ' + total + ' ብር፣ እስከ 2026-10-05። ዝርዝር፦ ' + link);
  const rc = receiptSms({ building: B, invoice: shopInv, tenancy: shopInv.tenancy, link });
  assert.equal(rc, 'ደረሰኝ፣ ክፍል 211፣ ' + total + ' ብር ተከፍሏል። ዝርዝር፦ ' + link);
  assert.equal(labelled(buildingSmsLabel(B.name), s), 'BinaSmart · Demo Tower፦ የክፍያ መጠየቂያ፣ ክፍል 211፣ ' + total + ' ብር፣ እስከ 2026-10-05። ዝርዝር፦ ' + link);
  assert.doesNotMatch(s + rc, /Demo Shop|ዴሞ ሱቅ|Demo Tenant/);
  const inv = { ...shopInv, amount: 999999999, lateFee: 0, tenancy: { unit: { number: 'G-' + '0'.repeat(40) } } };
  const hint = '\nTelegram: t.me/bina_smart_bot?start=tenant_' + 'x'.repeat(40);
  for (const t of [invoiceSms({ building: B, invoice: inv, tenancy: inv.tenancy, link }), receiptSms({ building: B, invoice: inv, tenancy: inv.tenancy, link })]) {
    const full = labelled(buildingSmsLabel('x'.repeat(80)), t) + hint;
    assert.ok(full.length <= SMS_MAX_CHARS, 'length ' + full.length);
  }
});
```

`$L/test/messaging/invoice-links.test.js`

```js
'use strict';
// bina.et/i/<token>: unguessable, 60 days, one invoice. Over a fake Prisma.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeInvoiceLinks, LINK_DAYS } = require('../../messaging/invoice-links');
const { renderInvoicePage, renderGonePage } = require('../../messaging/invoice-page');

const DAY = 86400000;
function fakePrisma(clock) {
  const db = { links: [], reads: 0, invoices: [{ id: 'inv1', type: 'RENT', amount: 12500, lateFee: 1250, dueDate: new Date('2026-10-05T00:00:00Z'),
    paymentCode: 'BS-1234-211', status: 'PENDING', paidDate: null, method: null,
    tenancy: { shop: { name: 'Demo Shop' }, user: { fullName: 'Demo Tenant', phone: '0900000001' },
      unit: { number: '211', building: { name: 'Demo Tower', nameAm: 'ዴሞ ታወር', tinNumber: '0000000000', bankAccounts: [{ bank: 'CBE', account: '1000000000000' }] } } } }] };
  return { db,
    invoiceLink: {
      findFirst: async ({ where }) => db.links.filter(l => l.invoiceId === where.invoiceId && l.kind === where.kind && l.expiresAt > where.expiresAt.gt)
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
      create: async ({ data }) => { if (db.links.some(l => l.token === data.token)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
        const l = { ...data, createdAt: clock() }; db.links.push(l); return l; },
      findUnique: async ({ where }) => { db.reads++; return db.links.find(l => l.token === where.token) || null; },
    },
    invoice: { findUnique: async ({ where }) => db.invoices.find(i => i.id === where.id) || null },
  };
}
const T0 = new Date('2026-10-01T09:00:00Z');

test('a link token is 12 random URL-safe characters, never the invoice id or payment code', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t });
  const a = await links.linkFor('inv1', 'invoice'), b = await links.linkFor('inv1', 'receipt');
  for (const l of [a, b]) {
    assert.match(l, /^bina\.et\/i\/[A-Za-z0-9_-]{12}$/);
    assert.doesNotMatch(l, /inv1|BS-1234/);
  }
  assert.notEqual(a, b);
  assert.equal(p.db.links[0].expiresAt.getTime(), T0.getTime() + LINK_DAYS * DAY);
  assert.equal(LINK_DAYS, 60);
});

test('a fresh link is reused; one with under a week left is replaced; a token clash draws again', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const bytes = [Buffer.alloc(9, 1), Buffer.alloc(9, 1), Buffer.alloc(9, 2), Buffer.alloc(9, 3)];
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t, randomBytes: () => bytes.shift() });
  const first = await links.linkFor('inv1', 'invoice');
  assert.equal(await links.linkFor('inv1', 'invoice'), first);
  clock.t = new Date(T0.getTime() + 54 * DAY);
  const second = await links.linkFor('inv1', 'invoice');
  assert.notEqual(second, first, 'six days left: a new link');
  assert.equal(second, 'bina.et/i/' + Buffer.alloc(9, 2).toString('base64url'), 'the clashing draw was skipped');
});

test('malformed, unknown and expired tokens resolve to nothing; malformed ones never reach the database', async () => {
  const clock = { t: T0 };
  const p = fakePrisma(() => clock.t);
  const links = makeInvoiceLinks({ prisma: p, now: () => clock.t });
  for (const bad of ['', 'short', 'has space in it', '../../etc/passwd', 'x'.repeat(40), null]) assert.equal(await links.resolve(bad), null);
  assert.equal(p.db.reads, 0);
  assert.equal(await links.resolve('AAAAAAAAAAAA'), null);
  const token = (await links.linkFor('inv1', 'invoice')).split('/').pop();
  assert.ok(await links.resolve(token));
  clock.t = new Date(T0.getTime() + 61 * DAY);
  assert.equal(await links.resolve(token), null);
});

test('a valid token gives that one invoice with its unit and building, and the page shows only that', async () => {
  const p = fakePrisma(() => T0);
  const links = makeInvoiceLinks({ prisma: p, now: () => T0 });
  const found = await links.resolve((await links.linkFor('inv1', 'invoice')).split('/').pop());
  assert.deepEqual([found.kind, found.invoice.id, found.unit.number, found.building.name], ['invoice', 'inv1', '211', 'Demo Tower']);
  const html = renderInvoicePage(found);
  for (const s of ['211', '12,500 ETB', '1,250 ETB', '13,750 ETB', '2026-10-05', 'BS-1234-211', 'CBE', '1000000000000', 'ዴሞ ታወር', 'noindex']) assert.ok(html.includes(s), s);
  for (const s of ['Demo Shop', 'Demo Tenant', '0900000001']) assert.equal(html.includes(s), false, s);
});

test('the page escapes building text, shows a paid receipt without bank accounts, and the gone page says nothing', () => {
  const inv = { type: 'RENT', amount: 100, lateFee: 0, dueDate: new Date('2026-10-05T00:00:00Z'), paymentCode: 'BS-1-1', status: 'PAID', paidDate: new Date('2026-10-06T00:00:00Z'), method: 'CASH' };
  const html = renderInvoicePage({ kind: 'receipt', invoice: inv, unit: { number: '<b>1</b>' }, building: { name: '<img src=x onerror=alert(1)>', nameAm: '', bankAccounts: [{ bank: 'CBE', account: '1' }] } });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<b>1</b>'), false);
  assert.match(html, /Receipt/);
  assert.match(html, /2026-10-06 · CASH/);
  assert.equal(html.includes('Pay to'), false);
  const gone = renderGonePage();
  assert.match(gone, /noindex/);
  assert.match(gone, /not valid or has expired/);
  assert.match(renderGonePage({ slow: true }), /try again in a few minutes/);
});
```

- [ ] **Step 2: Copy both up, run them** → both fail with `Cannot find module`.

- [ ] **Step 3: Implement** — `$L/messaging/invoice-text.js`

```js
'use strict';
// What a tenant reads: the Telegram invoice and receipt (unchanged from server.js at 500df05, plus an optional short-link
// line) and the short SMS versions (design §1.3). Figures come from the invoice row, never from anyone's typing.
const TYPE_AM = { RENT: 'ኪራይ', ELECTRICITY: 'መብራት', WATER: 'ውሃ', PENALTY: 'ቅጣት', SERVICE: 'አገልግሎት', OTHER: 'ክፍያ' };
const LINE = '━━━━━━━━━━━━━━━\n';

const tenantLabel = tenancy => (tenancy.shop ? (tenancy.shop.nameAm || tenancy.shop.name) : ((tenancy.user && tenancy.user.fullName) || ''));
const header = b => '🏢 ' + (b.nameAm || b.name) + '\n' + b.name + (b.tinNumber ? ' · TIN ' + b.tinNumber : '') + '\n';
const charge = inv => '💰 ' + (TYPE_AM[inv.type] || 'ክፍያ') + ' / ' + inv.type + ': ' + inv.amount.toLocaleString() + ' ETB'
  + (inv.lateFee ? '\n➕ ቅጣት / Late fee: ' + inv.lateFee.toLocaleString() + ' ETB' : '');

function invoiceMessage({ building: b, invoice: inv, tenancy, link }) {
  const total = inv.amount + (inv.lateFee || 0);
  const banks = (b.bankAccounts || []).map(a => '• ' + a.bank + ': ' + a.account).join('\n');
  return '🧾 የክፍያ መጠየቂያ / INVOICE\n' + LINE + header(b) + LINE
    + '👤 ' + tenantLabel(tenancy) + ' — ክፍል ' + tenancy.unit.number + '\n'
    + charge(inv)
    + '\n📌 ጠቅላላ / TOTAL: ' + total.toLocaleString() + ' ETB\n'
    + '📅 መክፈያ ቀን / Due: ' + inv.dueDate.toISOString().slice(0, 10) + '\n'
    + (banks ? LINE + '🏦 የሚከፈልበት / Pay to:\n' + banks + '\n' : '')
    + (inv.paymentCode ? '#️⃣ ማጣቀሻ / Reference: ' + inv.paymentCode + '\n' : '')
    + (link ? '🔗 ' + link + '\n' : '')
    + LINE
    + 'ክፍያ ሲፈጽሙ ኮዱን እንደ ማጣቀሻ ይጠቀሙ። / Use the reference code with your transfer.\n— ' + b.name + ' · BinaSmart';
}

function receiptMessage({ building: b, invoice: inv, tenancy, method, paidAt, link }) {
  const total = inv.amount + (inv.lateFee || 0);
  const vatLine = b.vatRegistered ? '\nVAT (15%): ' + Math.round(total * 0.15 / 1.15).toLocaleString() + ' ETB (ተካቷል/incl.)' : '';
  return '🧾 ደረሰኝ / E-RECEIPT\n' + LINE + header(b) + LINE
    + '👤 ' + tenantLabel(tenancy) + ' — ክፍል ' + tenancy.unit.number + '\n'
    + charge(inv)
    + '\n✅ ጠቅላላ የተከፈለ / TOTAL PAID: ' + total.toLocaleString() + ' ETB' + vatLine + '\n'
    + '💳 በ: ' + (method || 'CASH') + ' · ' + paidAt.toISOString().slice(0, 10) + '\n'
    + (inv.paymentCode ? '#️⃣ ' + inv.paymentCode + '\n' : '')
    + (link ? '🔗 ' + link + '\n' : '')
    + LINE
    + 'እናመሰግናለን! / Thank you!\n📊 BinaSmart · bina.et/b/' + b.qrSlug;
}

// SMS bodies: unit, total, date, link. The delivery layer puts the label in front ("BinaSmart · <building>፦ "), so the
// building is named there. No tenant name: a phone number can change hands. The unit is cut to 20 characters so label,
// body and the Telegram start link stay inside GeezSMS's 334 characters. `building` is accepted for later senders.
const smsTotal = inv => (inv.amount + (inv.lateFee || 0)).toLocaleString('en-US');
const smsUnit = tenancy => String(tenancy.unit.number).slice(0, 20);

function invoiceSms({ invoice, tenancy, link }) {
  return 'የክፍያ መጠየቂያ፣ ክፍል ' + smsUnit(tenancy) + '፣ ' + smsTotal(invoice) + ' ብር፣ እስከ ' + invoice.dueDate.toISOString().slice(0, 10) + '። ዝርዝር፦ ' + link;
}
function receiptSms({ invoice, tenancy, link }) {
  return 'ደረሰኝ፣ ክፍል ' + smsUnit(tenancy) + '፣ ' + smsTotal(invoice) + ' ብር ተከፍሏል። ዝርዝር፦ ' + link;
}

module.exports = { TYPE_AM, invoiceMessage, receiptMessage, invoiceSms, receiptSms };
```

`$L/messaging/invoice-links.js`

```js
'use strict';
// bina.et/i/<token> (design §1.3): a random token (9 bytes = 72 bits, 12 URL-safe characters) that is not the invoice
// id or the payment code, valid 60 days, pointing at one invoice. A link with a week or more left is reused, so
// sending the same invoice twice does not mint a second address.
const crypto = require('crypto');

const LINK_DAYS = 60;
const REUSE_MIN_MS = 7 * 86400000;
const TOKEN_RE = /^[A-Za-z0-9_-]{12,32}$/;

function makeInvoiceLinks({ prisma, now = () => new Date(), randomBytes = crypto.randomBytes }) {
  async function linkFor(invoiceId, kind) {
    const at = now();
    const fresh = await prisma.invoiceLink.findFirst({ where: { invoiceId, kind, expiresAt: { gt: new Date(at.getTime() + REUSE_MIN_MS) } },
      orderBy: { createdAt: 'desc' }, select: { token: true } });
    if (fresh) return 'bina.et/i/' + fresh.token;
    for (let i = 0; i < 3; i++) {
      const token = randomBytes(9).toString('base64url');
      try {
        await prisma.invoiceLink.create({ data: { token, invoiceId, kind, expiresAt: new Date(at.getTime() + LINK_DAYS * 86400000) } });
        return 'bina.et/i/' + token;
      } catch (e) {
        if (!(e && e.code === 'P2002')) throw e;
      }
    }
    throw new Error('invoice link: no free token after 3 draws');
  }

  async function resolve(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const l = await prisma.invoiceLink.findUnique({ where: { token } });
    if (!l || new Date(l.expiresAt) <= now()) return null;
    const invoice = await prisma.invoice.findUnique({ where: { id: l.invoiceId },
      include: { tenancy: { include: { unit: { include: { building: true } } } } } });
    if (!invoice || !invoice.tenancy || !invoice.tenancy.unit) return null;
    return { kind: l.kind, invoice, unit: invoice.tenancy.unit, building: invoice.tenancy.unit.building };
  }

  return { linkFor, resolve };
}

module.exports = { makeInvoiceLinks, LINK_DAYS };
```

`$L/messaging/invoice-page.js`

```js
'use strict';
// The page behind bina.et/i/<token>: one invoice or receipt. Building, unit, type, amount, late fee, total, due date,
// reference, bank accounts (while unpaid), paid date and method (once paid). No tenant name, no phone, no other
// invoice, not indexed. Unknown, malformed and expired links all get the same neutral page.
const { TYPE_AM } = require('./invoice-text');

const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US') + ' ETB';
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

function shell(title, body) {
  return '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title>'
    + '<style>body{margin:0;font-family:system-ui,"Noto Sans Ethiopic",sans-serif;background:#f1f5f4;color:#0f2027}'
    + '.card{max-width:440px;margin:24px auto;background:#fff;border-radius:18px;padding:22px;box-shadow:0 2px 12px rgba(0,0,0,.06)}'
    + 'h1{font-size:19px;margin:0 0 4px}.sub{color:#64748b;font-size:13px;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:14px}'
    + 'td{padding:7px 0;border-bottom:1px solid #e9f0ee}td.r{text-align:right;font-weight:700}.tot td{font-size:16px}.paid{color:#059669}.due{color:#b45309}'
    + '.foot{font-size:12px;color:#64748b;margin-top:14px;text-align:center}</style></head><body>' + body + '</body></html>';
}

function renderInvoicePage({ kind, invoice: inv, unit, building: b }) {
  const paid = inv.status === 'PAID';
  const total = inv.amount + (inv.lateFee || 0);
  const rows = [['ክፍል / Unit', unit.number], ['ዓይነት / Type', (TYPE_AM[inv.type] || 'ክፍያ') + ' / ' + inv.type], ['መጠን / Amount', money(inv.amount)]];
  if (inv.lateFee) rows.push(['ቅጣት / Late fee', money(inv.lateFee)]);
  rows.push(['መክፈያ ቀን / Due', day(inv.dueDate)]);
  if (inv.paymentCode) rows.push(['ማጣቀሻ / Reference', inv.paymentCode]);
  if (paid) rows.push(['የተከፈለበት / Paid', day(inv.paidDate) + (inv.method ? ' · ' + inv.method : '')]);
  const banks = !paid && Array.isArray(b.bankAccounts) ? b.bankAccounts.filter(a => a && a.bank && a.account) : [];
  const title = kind === 'receipt' && paid ? '🧾 ደረሰኝ / Receipt' : '🧾 የክፍያ መጠየቂያ / Invoice';
  const body = '<div class="card"><h1>' + title + '</h1>'
    + '<div class="sub">🏢 ' + esc(b.nameAm || b.name) + (b.nameAm && b.nameAm !== b.name ? ' · ' + esc(b.name) : '') + (b.tinNumber ? ' · TIN ' + esc(b.tinNumber) : '') + '</div>'
    + '<table>' + rows.map(r => '<tr><td>' + r[0] + '</td><td class="r">' + esc(r[1]) + '</td></tr>').join('')
    + '<tr class="tot"><td>' + (paid ? 'ጠቅላላ የተከፈለ / Total paid' : 'ጠቅላላ / Total') + '</td><td class="r ' + (paid ? 'paid' : 'due') + '">' + esc(money(total)) + '</td></tr></table>'
    + (banks.length ? '<h1 style="font-size:15px;margin-top:16px">🏦 የሚከፈልበት / Pay to</h1><table>'
      + banks.map(a => '<tr><td>' + esc(a.bank) + '</td><td class="r">' + esc(a.account) + '</td></tr>').join('') + '</table>' : '')
    + (paid ? '<div class="foot paid">✅ ተከፍሏል / Paid</div>' : '<div class="foot">ክፍያ ሲፈጽሙ ማጣቀሻውን ይጠቀሙ። / Use the reference with your transfer.</div>')
    + '<div class="foot">BinaSmart · bina.et</div></div>';
  return shell((kind === 'receipt' && paid ? 'Receipt' : 'Invoice') + ' · ' + (b.name || 'BinaSmart'), body);
}

function renderGonePage({ slow = false } = {}) {
  return shell('BinaSmart', '<div class="card"><h1>' + (slow
    ? '⏳ እባክዎ ትንሽ ቆይተው ይሞክሩ · Please try again in a few minutes'
    : '🔗 ሊንኩ አይሰራም ወይም ጊዜው አልፎበታል · This link is not valid or has expired') + '</h1><div class="foot">BinaSmart · bina.et</div></div>');
}

module.exports = { renderInvoicePage, renderGonePage };
```

- [ ] **Step 4: Copy up, run both files** → `invoice-text` `# pass 4`, `invoice-links` `# pass 5`, `# fail 0`. Full suite → **947 pass, 0 fail**.

- [ ] **Step 5: Commit** `messaging/invoice-text.js messaging/invoice-links.js messaging/invoice-page.js test/messaging/invoice-text.test.js test/messaging/invoice-links.test.js`:

```
Invoices: today's Telegram texts in one module, short SMS texts, and bina.et/i/<token> links

messaging/invoice-text.js holds the invoice and receipt texts exactly as server.js wrote them (pinned against a copy),
plus an optional short-link line, and SMS bodies with unit, total, date and link but no tenant name, which fit 334
characters behind the "BinaSmart · <building>" label and with the Telegram start link. messaging/invoice-links.js mints 72-bit tokens valid 60 days (reused
while a week is left); invoice-page.js shows that one invoice, escaped and not indexed, and a neutral page otherwise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 6: Server — every tenant sender on the delivery layer, the link page, the pending list, delivery reports

**Files:**
- Modify: `server.js` (notify block ≈2509–2535, `runDailyChecks` ≈2540–2600, 📤 Send ≈2892–2919, mark-paid ≈3049–3086; new routes before `// ===== OWNER: add another building`)
- Modify: `notify/notify.js` (remove `notifyQuiet`)
- Delete: `test/notify/quiet.test.js`
- Test: `test/messaging/server-delivery.test.js`

Switches stay exactly as they are: the daily checks send only when the building is in `NOTIFY_WHITELIST`, `notifyTenants` is on and the per-run budget of 8 is not spent; 📤 Send answers 403 outside the whitelist; the receipt goes out for whitelisted buildings. What changes is the road (delivery layer, no WhatsApp for tenants), the records, and one guard: marking an already-paid invoice paid again is refused (409) instead of re-sending the receipt.

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/server-delivery.test.js`

```js
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
```

- [ ] **Step 2: Copy up, run** → `# fail 8` (e.g. `delivery.sendToTenants` not found, `/i/:token not found`).

- [ ] **Step 3: Back up** `server.js` and `notify/notify.js` (Conventions, tag `t6`).

- [ ] **Step 4: Patch** — `$L/tmp/t6_patch.py` → `/tmp/t6_patch.py`, `ssh root@31.97.176.180 'python3 /tmp/t6_patch.py'` → `ok`.

```python
import io, sys
R = '/var/www/connectcare/binasmart/'
def load(f): return io.open(R + f, encoding='utf-8', newline='').read()
s = load('server.js')
def sub(old, new, what):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('server.js anchor for %s matched %d times' % (what, n))
    s = s.replace(old, new)

# 1. owners, shops and admins keep makeNotify; tenants stop using notifyQuiet
sub(r'''const { notifyShop, notifyParty, notifyQuiet, notifyAdmins } = makeNotify({ sendTg, sendWa, adminChatIds: [ADMIN_TG_CHAT, OPS_TG_CHAT], log: console.log });''',
    r'''const { notifyShop, notifyParty, notifyAdmins } = makeNotify({ sendTg, sendWa, adminChatIds: [ADMIN_TG_CHAT, OPS_TG_CHAT], log: console.log });''', 'makeNotify destructure')

# 2. notifyTenant on the delivery layer
sub(r'''let tenantMisses = 0;   // per building per daily run — see runDailyChecks
async function notifyTenant(user, text, channel){
  // Telegram first, WhatsApp as backup, one message not two. No admin copy — see notifyQuiet.
  if (!user) return false;
  const r = await notifyQuiet({ id: user.id, name: user.name || user.phone, phone: user.phone, tgChatId: user.telegramChatId || null }, text, channel);
  if (!r.ok) tenantMisses++;
  return r.ok;
}''', r'''// ===== Tenant messages (owner actions and messaging design, 15 Sep 2026, §1) =====
// Every message to a tenant goes through messaging/delivery.js: Telegram if the tenant linked @bina_smart_bot, otherwise
// SMS, otherwise recorded as not delivered. One channel per message, every attempt in OutboundMessage. WhatsApp is no
// longer tried for tenants: the bridge on 127.0.0.1:8081 does not answer (15 Sep 2026) and each failed try slept 3-5 s
// inside the daily run. Owners, shops and admins keep notifyParty / notifyShop / notifyAdmins exactly as before.
// SMS leaves the server only when SMS_MODE=live, SMS_API_TOKEN is set, the building is real (NOTIFY_WHITELIST and not a
// demo) and its smsMonthlyLimit allows it; otherwise the row says `test`, or why it was not sent.
const { makeSmsFromEnv, buildingSmsLabel, parsePriceTiers } = require('./messaging/sms');
const { makeDelivery, makeDeliveryStore } = require('./messaging/delivery');
const { makeInvoiceLinks } = require('./messaging/invoice-links');
const { renderInvoicePage, renderGonePage } = require('./messaging/invoice-page');
const invoiceText = require('./messaging/invoice-text');
// Delivery reports come to a path only the SMS provider is given; without a long secret there is no report route.
const SMS_CALLBACK_SECRET = process.env.SMS_CALLBACK_SECRET || '';
const smsCallbackUrl = SMS_CALLBACK_SECRET.length >= 24 ? 'https://bina.et/api/sms/report/' + SMS_CALLBACK_SECRET : '';
const tenantSms = makeSmsFromEnv(process.env, { log: m => console.log(m), callbackUrl: smsCallbackUrl });
const delivery = makeDelivery({ store: makeDeliveryStore(prisma), sendTg, sms: tenantSms, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
  priceTiers: parsePriceTiers(process.env.SMS_PRICE_TIERS), log: m => console.error(m) });
const invoiceLinks = makeInvoiceLinks({ prisma });
console.log('[sms] mode ' + tenantSms.mode + ' · ' + (tenantSms.provider || 'no provider'));
// Every SMS starts "BinaSmart · <building name>፦ " until approved sender names exist; smsSender null = provider default.
function tenantBuilding(b){
  return { id: b.id, slug: b.qrSlug, real: NOTIFY_WHITELIST.includes(b.qrSlug) && !hotelIsDemo(b), smsLabel: buildingSmsLabel(b.name),
    smsMonthlyLimit: b.smsMonthlyLimit == null ? 0 : b.smsMonthlyLimit, smsSender: b.smsSender || '' };
}
let tenantMisses = 0;   // per building per daily run — see runDailyChecks
// One message to the tenant of one tenancy ({ id, userId, user: { phone, telegramChatId } }). Never throws.
async function notifyTenant(b, tenancy, { kind, source, actor, text, smsText, invoiceId }){
  let r = null;
  if (tenancy && tenancy.user) {
    r = await delivery.sendToTenants({ building: tenantBuilding(b), kind, source, actor: actor || null,
      recipients: [{ tenancyId: tenancy.id, userId: tenancy.userId, telegramChatId: tenancy.user.telegramChatId || null,
        phone: tenancy.user.phone, text, smsText: smsText || text, invoiceId: invoiceId || null }] })
      .catch(e => { console.error('[delivery] ' + e.message); return null; });
  }
  const one = r && r.results[0];
  const delivered = !!one && (one.status === 'sent' || one.status === 'delivered');
  if (!delivered) tenantMisses++;
  return { delivered, status: one ? one.status : 'failed', channel: one ? one.channel : 'none', errorKind: one ? one.errorKind : (r ? r.error : 'error') };
}''', 'notifyTenant')

# 3. daily checks: same switches, same budget, new road
sub('''    const bChan = WA_CHANNEL[b.qrSlug];\n''', '', 'bChan')
sub(r'''await notifyTenant(t.user, 'ሰላም! የ' + b.nameAm + ' ክፍል ' + t.unit.number + ' ውልዎ በ' + days + ' ቀናት ውስጥ ያበቃል። ለማደስ ያነጋግሩን። — BinaSmart', bChan);''',
    r'''await notifyTenant(b, t, { kind: 'reminder', source: 'daily-renewal', actor: 'cron', text: 'ሰላም! የ' + b.nameAm + ' ክፍል ' + t.unit.number + ' ውልዎ በ' + days + ' ቀናት ውስጥ ያበቃል። ለማደስ ያነጋግሩን። — BinaSmart' });''', 'renewal send')
sub(r'''await notifyTenant(i.tenancy.user, 'ሰላም! የ' + b.nameAm + ' ኪራይ ' + i.amount.toLocaleString() + ' ብር በ' + i.dueDate.toISOString().slice(0, 10) + ' ይከፈላል። ኮድ: ' + (i.paymentCode || '') + ' — BinaSmart');''',
    r'''await notifyTenant(b, i.tenancy, { kind: 'reminder', source: 'daily-due', actor: 'cron', invoiceId: i.id, text: 'ሰላም! የ' + b.nameAm + ' ኪራይ ' + i.amount.toLocaleString() + ' ብር በ' + i.dueDate.toISOString().slice(0, 10) + ' ይከፈላል። ኮድ: ' + (i.paymentCode || '') + ' — BinaSmart' });''', 'due send')
sub(r'''await notifyTenant(i.tenancy.user, 'ማሳሰቢያ: የ' + b.nameAm + ' ኪራይ ክፍያዎ አልፏል። ቅጣት ' + fee.toLocaleString() + ' ብር ታክሏል። — BinaSmart');''',
    r'''await notifyTenant(b, i.tenancy, { kind: 'reminder', source: 'daily-penalty', actor: 'cron', invoiceId: i.id, text: 'ማሳሰቢያ: የ' + b.nameAm + ' ኪራይ ክፍያዎ አልፏል። ቅጣት ' + fee.toLocaleString() + ' ብር ታክሏል። — BinaSmart' });''', 'penalty send')
sub(r'''tenant(s) could not be reached — no Telegram link and WhatsApp failed');''',
    r'''tenant message(s) not delivered — no Telegram link, and SMS not available for them');''', 'misses line')

# 4. 📤 Send
old_send_start = "// ===== OWNER: send invoice to tenant (WhatsApp + Telegram) =====\nfastify.post('/api/owner/:slug/invoice/:id/send', async (req, reply) => {"
a = s.find(old_send_start); e = s.find('\n});\n', a)
if s.count(old_send_start) != 1 or e < 0: sys.exit('send route not found')
old_send = s[a:e + 5]
if 'const sent = await notifyTenant(inv.tenancy.user, msg, WA_CHANNEL[b.qrSlug]);' not in old_send: sys.exit('send route body changed')
s = s[:a] + r'''// ===== OWNER: send invoice to tenant (Telegram, else SMS — messaging/delivery.js) =====
fastify.post('/api/owner/:slug/invoice/:id/send', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: true, shop: true, user: true } } } });
  if (!inv || inv.tenancy.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!NOTIFY_WHITELIST.includes(b.qrSlug)) return reply.code(403).send({ error: 'messaging_not_enabled_for_this_building' });
  const total = inv.amount + (inv.lateFee || 0);
  const link = await invoiceLinks.linkFor(inv.id, 'invoice');
  const r = await notifyTenant(b, inv.tenancy, { kind: 'invoice', source: 'dashboard-send', actor: 'dashboard', invoiceId: inv.id,
    text: invoiceText.invoiceMessage({ building: b, invoice: inv, tenancy: inv.tenancy, link }),
    smsText: invoiceText.invoiceSms({ building: b, invoice: inv, tenancy: inv.tenancy, link }) });
  await audit(b.id, 'INVOICE_SENT', (inv.tenancy.shop ? inv.tenancy.shop.name : '') + ' ' + inv.tenancy.unit.number
    + (r.delivered ? ' (' + r.channel + ')' : r.status === 'test' ? ' (test mode — not sent)' : ' (delivery pending — ' + (r.errorKind || 'not delivered') + ')'), total);
  return { ok: true, delivered: r.delivered, channel: r.channel, status: r.status, reason: r.errorKind || null };
});
''' + s[e + 5:]

# 5. mark-paid: refuse a second payment, receipt through the layer
old_pay_start = "// mark invoice paid (owner)\nfastify.post('/api/admin/invoices/:id/pay', async (req, reply) => {"
a = s.find(old_pay_start); e = s.find('\n});\n', a)
if s.count(old_pay_start) != 1 or e < 0: sys.exit('pay route not found')
if "if (tu) notifyTenant(tu, receipt, WA_CHANNEL[bb.qrSlug]);" not in s[a:e]: sys.exit('pay route body changed')
s = s[:a] + r'''// mark invoice paid (owner)
fastify.post('/api/admin/invoices/:id/pay', async (req, reply) => {
  const inv0 = await prisma.invoice.findUnique({ where: { id: req.params.id },
    include: { tenancy: { include: { unit: { include: { building: { select: { qrSlug: true } } } } } } } });
  if (!inv0) return reply.code(404).send({ error: 'not found' });
  if (await authBuildingFail(req, reply, inv0.tenancy.unit.building.qrSlug)) return;
  // A second tap re-stamped the payment and sent the tenant a second receipt; now it changes nothing.
  if (inv0.status === 'PAID') return reply.code(409).send({ error: 'already_paid' });
  const { method } = req.body || {};
  const inv = await prisma.invoice.update({
    where: { id: req.params.id },
    data: { status: 'PAID', paidDate: new Date(), method: method || 'CASH' },
    include: { tenancy: { include: { unit: true, shop: true, user: true } } }
  });
  await audit(inv.tenancy.unit.buildingId, 'INVOICE_PAID', (inv.tenancy.shop ? inv.tenancy.shop.name : 'Unit') + ' ' + inv.tenancy.unit.number + ' via ' + (method || 'CASH'), inv.amount);
  // e-receipt to the tenant, under the building's name — not awaited by the dashboard
  try{
    const bb = await prisma.building.findUnique({ where: { id: inv.tenancy.unit.buildingId } });
    if (NOTIFY_WHITELIST.includes(bb.qrSlug) && inv.tenancy.user) {
      const link = await invoiceLinks.linkFor(inv.id, 'receipt');
      notifyTenant(bb, inv.tenancy, { kind: 'receipt', source: 'receipt', actor: 'dashboard', invoiceId: inv.id,
        text: invoiceText.receiptMessage({ building: bb, invoice: inv, tenancy: inv.tenancy, method: method || 'CASH', paidAt: inv.paidDate, link }),
        smsText: invoiceText.receiptSms({ building: bb, invoice: inv, tenancy: inv.tenancy, link }) })
        .catch(e => console.error('[receipt]', e.message));
    }
  }catch(e){ console.error('[receipt]', e.message); }
  return { ok: true, invoice: inv.id };
});
''' + s[e + 5:]

# 6. pending list, short links, delivery reports
sub('''// ===== OWNER: add another building (same owner login) =====''', r'''// ===== Invoices that did not reach the tenant (design §1.6) =====
// The newest invoice message of each invoice, listed while it is not sent and the invoice is not paid. The dashboard's
// "Send now" calls POST /api/owner/:slug/invoice/:id/send above, which uses the invoice as it is today.
fastify.get('/api/owner/:slug/pending-deliveries', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const rows = await prisma.outboundMessage.findMany({ where: { buildingId: b.id, kind: 'invoice', invoiceId: { not: null } },
    orderBy: { createdAt: 'desc' }, take: 500, select: { invoiceId: true, status: true, errorKind: true, createdAt: true } });
  const latest = new Map();
  for (const m of rows) if (!latest.has(m.invoiceId)) latest.set(m.invoiceId, m);
  const stuck = [...latest.values()].filter(m => m.status !== 'sent' && m.status !== 'delivered');
  if (!stuck.length) return { invoices: [] };
  const invs = await prisma.invoice.findMany({ where: { id: { in: stuck.map(m => m.invoiceId) }, status: { not: 'PAID' }, tenancy: { unit: { buildingId: b.id } } },
    include: { tenancy: { include: { unit: { select: { number: true } } } } }, orderBy: { dueDate: 'asc' } });
  return { invoices: invs.map(i => { const m = latest.get(i.id); return { id: i.id, unit: i.tenancy.unit.number, type: i.type,
    amount: i.amount + (i.lateFee || 0), dueDate: i.dueDate.toISOString().slice(0, 10), lastTry: m.createdAt.toISOString().slice(0, 10),
    reason: m.errorKind || m.status }; }) };
});

// ===== Short invoice and receipt links: bina.et/i/<token> (design §1.3) =====
// One invoice or receipt, no login, no tenant name or phone, 60 days. Unknown, malformed and expired tokens get the same
// page. Limited per client address (nginx sets X-Real-IP).
const invoiceLinkRL = hotelLimiter(600000, 30);
fastify.get('/i/:token', async (req, reply) => {
  reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
  if (!invoiceLinkRL(bookIp(req))) return reply.code(429).type('text/html; charset=utf-8').send(renderGonePage({ slow: true }));
  const found = await invoiceLinks.resolve(req.params.token).catch(() => null);
  if (!found) return reply.code(404).type('text/html; charset=utf-8').send(renderGonePage());
  return reply.type('text/html; charset=utf-8').send(renderInvoicePage(found));
});

// ===== SMS delivery reports (the provider's `callback`, design §1.2) =====
// https://bina.et/api/sms/report/<SMS_CALLBACK_SECRET>; anything without the secret gets 404. A report can only move an
// SMS row we sent from queued/sent to delivered or failed; it is trusted for nothing else. The first report after a
// restart logs its field names and types (never values), because GeezSMS does not document the payload.
let smsReportShapeLogged = false;
async function smsReport(req, reply){
  const given = Buffer.from(String(req.params.secret || '')), want = Buffer.from(SMS_CALLBACK_SECRET);
  if (!smsCallbackUrl || given.length !== want.length || !cryptoMod.timingSafeEqual(given, want)) return reply.code(404).send({ error: 'not_found' });
  const body = Object.assign({}, req.query || {}, req.body && typeof req.body === 'object' ? req.body : {});
  if (!smsReportShapeLogged) { smsReportShapeLogged = true; console.log('[sms] delivery report fields: ' + delivery.reportShape(body)); }
  const updated = await delivery.applyDeliveryReport(body).catch(e => { console.error('[sms] report: ' + e.message); return 0; });
  return { ok: true, updated };
}
fastify.register(async function smsReportRoutes(f){
  // Form posts are parsed inside this plugin only; the rest of the API still refuses them.
  f.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16384 },
    (req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (e) { done(e); } });
  f.post('/api/sms/report/:secret', smsReport);
  f.get('/api/sms/report/:secret', smsReport);
});

// ===== OWNER: add another building (same owner login) =====''', 'insert before add-building')

for gone in ['notifyQuiet', 'bChan']:
    if gone in s: sys.exit(gone + ' still in server.js')
io.open(R + 'server.js', 'w', encoding='utf-8', newline='').write(s)

# 7. notify.js: notifyQuiet has no caller left
n = load('notify/notify.js')
old_q_start = '  // Same ladder, no admin copy: for the many small messages to tenants'
a = n.find(old_q_start); e = n.find('  // Something only the admins need to know', a)
if n.count(old_q_start) != 1 or e < 0: sys.exit('notifyQuiet block not found')
n = n[:a] + '''  // Tenants are not on this ladder any more: messaging/delivery.js (Telegram, then SMS, recorded) replaced notifyQuiet.

''' + n[e:]
old_ret = '  return { notifyParty, notifyShop, notifyQuiet, notifyAdmins, admins };'
if n.count(old_ret) != 1: sys.exit('notify return')
n = n.replace(old_ret, '  return { notifyParty, notifyShop, notifyAdmins, admins };')
io.open(R + 'notify/notify.js', 'w', encoding='utf-8', newline='').write(n)
print('ok')
```

- [ ] **Step 5: Remove the dead test and check the syntax**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && git rm -q test/notify/quiet.test.js && node --check server.js && node --check notify/notify.js && echo syntax-ok'` → `syntax-ok`.

- [ ] **Step 6: Run the new file, the owner-route and wiring tests, then the suite**

`node --test test/messaging/server-delivery.test.js test/owner-routes.test.js test/kit/wiring.test.js test/notify/` → all pass (`server-delivery` 8). Full suite: 947 + 8 − 2 (quiet.test.js) → **953 pass, 0 fail**.

- [ ] **Step 7: Restart** (Conventions). The grep must show `[sms] mode test · no provider`.

- [ ] **Step 8: Live checks (nothing is sent to anyone).** `$L/tmp/t6-check.js` → `/tmp/t6-check.js`; `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node /tmp/t6-check.js; rm -f /tmp/t6-check.js'`:

```js
'use strict';
// Plan A Task 6 live check. The delivery layer runs in-process against the real database on the demo building
// century-mall, with a Telegram sender and an SMS provider that throw if anything tries to send. The link page and the
// routes are called over HTTP on 127.0.0.1. Everything created is deleted. Prints counts and booleans only.
const R = '/var/www/connectcare/binasmart/';
require(R + 'node_modules/dotenv').config({ path: R + '.env' });
const { PrismaClient } = require(R + 'node_modules/@prisma/client');
const { makeDelivery, makeDeliveryStore } = require(R + 'messaging/delivery');
const { makeSms, geezSupports } = require(R + 'messaging/sms');
const { makeInvoiceLinks } = require(R + 'messaging/invoice-links');
const p = new PrismaClient();
const BASE = 'http://127.0.0.1:4210';
const trap = () => { throw new Error('A SEND WAS ATTEMPTED'); };

(async () => {
  const started = new Date();
  const b = await p.building.findUnique({ where: { qrSlug: 'century-mall' }, select: { id: true, qrSlug: true } });
  try {
    const d = makeDelivery({ store: makeDeliveryStore(p), sendTg: trap,
      sms: makeSms({ mode: 'live', provider: { name: 'trap', supports: geezSupports, send: trap }, supports: geezSupports }) });
    const r = await d.sendToTenants({ building: { id: b.id, slug: b.qrSlug, real: false, smsLabel: 'BinaSmart · Demo', smsMonthlyLimit: 10 }, kind: 'notice', source: 'planA-check', actor: 'ops', text: 'plan A check',
      recipients: [{ tenancyId: 'planA-1', telegramChatId: '1', phone: '0900000001', text: 'x' }, { tenancyId: 'planA-2', phone: '0900000002', text: 'x' },
        { tenancyId: 'planA-3', phone: '0700000003', text: 'x' }, { tenancyId: 'planA-4', text: 'x' }] });
    console.log('demo batch  ', JSON.stringify(r.counts), '(want telegram 1, sms 1, none 2, sent 0, test 2, failed 2)');
    const rows = await p.outboundMessage.findMany({ where: { batchId: r.batchId }, select: { channel: true, status: true, errorKind: true } });
    console.log('rows        ', rows.map(x => x.channel + '/' + x.status + (x.errorKind ? '/' + x.errorKind : '')).sort().join(' '));
    const limited = await d.sendToTenants({ building: { id: b.id, slug: b.qrSlug, real: false, smsLabel: 'BinaSmart · Demo', smsMonthlyLimit: 0 }, kind: 'notice', source: 'planA-check', text: 'x',
      recipients: [{ tenancyId: 'planA-5', phone: '0900000005', text: 'x' }] });
    console.log('limit 0     ', limited.ok, limited.error, '(want false sms_limit)');

    const inv = await p.invoice.findFirst({ where: { tenancy: { unit: { buildingId: b.id } } },
      select: { id: true, tenancy: { select: { unit: { select: { number: true } }, user: { select: { fullName: true, phone: true } } } } } });
    const token = (await makeInvoiceLinks({ prisma: p }).linkFor(inv.id, 'invoice')).split('/').pop();
    const page = await fetch(BASE + '/i/' + token, { headers: { 'x-real-ip': '10.99.0.1' } });
    const html = await page.text();
    console.log('link page   ', page.status, page.headers.get('x-robots-tag'), html.includes(inv.tenancy.unit.number),
      !html.includes(inv.tenancy.user.fullName), !html.includes(inv.tenancy.user.phone), '(want 200 noindex, nofollow true true true)');
    console.log('bad token   ', (await fetch(BASE + '/i/nope', { headers: { 'x-real-ip': '10.99.0.2' } })).status, '(want 404)');
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await fetch(BASE + '/i/' + token, { headers: { 'x-real-ip': '10.99.0.3' } })).status;
    console.log('rate limit  ', last, '(want 429)');
    console.log('report      ', (await fetch(BASE + '/api/sms/report/not-the-secret-000000000000', { method: 'POST' })).status, '(want 404)');
    console.log('pending 401 ', (await fetch(BASE + '/api/owner/darulle/pending-deliveries')).status, '(want 401)');
    const pend = await fetch(BASE + '/api/owner/darulle/pending-deliveries', { headers: { 'x-owner-key': process.env.OWNER_KEY || '' } });
    const pj = await pend.json();
    console.log('pending     ', pend.status, Array.isArray(pj.invoices), pj.invoices && pj.invoices.length, '(want 200 true 0 — the backfill comes in Task 11)');
    const demoSend = await fetch(BASE + '/api/owner/century-mall/invoice/' + inv.id + '/send', { method: 'POST', headers: { 'x-owner-key': process.env.OWNER_KEY || '' } });
    console.log('demo send   ', demoSend.status, '(want 403: the whitelist switch is unchanged)');
  } finally {
    const batches = await p.outboundBatch.findMany({ where: { source: 'planA-check', createdAt: { gte: started } }, select: { id: true } });
    await p.outboundMessage.deleteMany({ where: { batchId: { in: batches.map(x => x.id) } } });
    await p.outboundBatch.deleteMany({ where: { id: { in: batches.map(x => x.id) } } });
    await p.invoiceLink.deleteMany({ where: { createdAt: { gte: started } } });
    console.log('cleaned     ', await p.outboundBatch.count({ where: { source: 'planA-check' } }), await p.invoiceLink.count({ where: { createdAt: { gte: started } } }), '(want 0 0)');
    await p.$disconnect();
  }
})().catch(e => { console.error('CHECK FAILED', e.message); process.exit(1); });
```

Expected, line by line: `{"telegram":1,"sms":1,"none":2,"sent":0,"test":2,"failed":2}`; `none/failed/no_contact none/failed/sms_unsupported_number sms/test telegram/test`; `false sms_limit`; `200 noindex, nofollow true true true`; `404`; `429`; `404`; `401`; `200 true 0`; `403`; `cleaned 0 0`. `A SEND WAS ATTEMPTED` anywhere means stop: restore the `.bak-planA-t6-*` files, restart, report.

- [ ] **Step 9: Commit** `server.js notify/notify.js test/messaging/server-delivery.test.js` (the deletion of `test/notify/quiet.test.js` is already staged):

```
Tenant messages go through the delivery layer: daily checks, Send, receipts, with short invoice links

notifyTenant now calls messaging/delivery.js (Telegram if linked, else SMS, else recorded), so the renewal, due and
penalty reminders, the dashboard's Send and the e-receipt share one road and one record. Their switches are unchanged:
NOTIFY_WHITELIST, notifyTenants and 8 tenant messages per building per run. WhatsApp is no longer tried for tenants
(the bridge does not answer and each try slept 3-5 s); notifyQuiet had no other caller and is removed. Owner, shop and
admin notifications are untouched. SMS stays in test mode: SMS_MODE is unset and no building has a limit.

Also: bina.et/i/<token> (rate limited, not indexed), GET /api/owner/:slug/pending-deliveries for invoices that did not
arrive, an SMS delivery-report route that exists only with a long secret, and mark-paid refuses an invoice that is
already paid instead of sending a second receipt. Live check on century-mall with senders that throw: nothing sent,
test rows as expected, link page 200 without tenant name or phone, 404/429/401/403 where expected, rows cleaned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 7: Tenant link rules — Telegram's proof of the phone, matched in full within one building

**Files:**
- Create: `messaging/tenant-link.js`
- Modify: `agents/owner/access.js` (export `limiter`)
- Test: `test/messaging/tenant-link.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/tenant-link.test.js`

```js
'use strict';
// Who may receive a building's tenant messages on a Telegram account. Over an in-memory store; the last test pins the
// Prisma store's queries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTenantLink, makeTenantLinkStore } = require('../../messaging/tenant-link');

function memStore() {
  const s = { buildings: [{ id: 'b1', qrSlug: 'darulle' }, { id: 'b2', qrSlug: 'other' }], users: [], tenancies: [] };
  const view = t => { const u = s.users.find(x => x.id === t.userId); return { id: t.id, userId: t.userId, unit: { number: t.unit }, user: { phone: u.phone, telegramChatId: u.telegramChatId } }; };
  return {
    s,
    buildingBySlug: async slug => s.buildings.find(b => b.qrSlug === slug) || null,
    activeTenancies: async buildingId => s.tenancies.filter(t => t.active && t.buildingId === buildingId).map(view),
    setChat: async (userId, chatId) => { s.users.find(u => u.id === userId).telegramChatId = chatId; return { id: userId }; },
    usersWithChat: async chatId => s.users.filter(u => u.telegramChatId === chatId).map(u => ({ id: u.id,
      tenancies: s.tenancies.filter(t => t.active && t.userId === u.id).map(t => ({ unit: { buildingId: t.buildingId, number: t.unit } })) })),
    clearChat: async userId => { s.users.find(u => u.id === userId).telegramChatId = null; return { id: userId }; },
    add(buildingId, unit, phone, active = true) {
      let u = s.users.find(x => x.phone === phone);
      if (!u) { u = { id: 'u' + (s.users.length + 1), phone, telegramChatId: null }; s.users.push(u); }
      const t = { id: 't' + (s.tenancies.length + 1), buildingId, unit, userId: u.id, active };
      s.tenancies.push(t); return t;
    },
  };
}
function setup() {
  const store = memStore(), audits = [];
  const link = makeTenantLink({ store, audit: (b, action, detail) => audits.push({ b, action, detail }), now: () => new Date('2026-09-20T09:00:00Z') });
  return { store, audits, link };
}
const own = (slug, phone, extra = {}) => ({ slug, chat: { id: 42, type: 'private' }, from: { id: 42 }, contact: { phone_number: phone, user_id: 42 }, forwarded: false, ...extra });

test('the full number of an active tenancy in that building links the tenant, and the audit keeps no phone digits', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001');
  store.add('b1', '212', '0900000001');
  const r = await link.linkFromContact(own('darulle', '251900000001'));
  assert.deepEqual(r, { ok: true, buildingId: 'b1', units: ['211', '212'] });
  assert.equal(store.s.users[0].telegramChatId, '42');
  assert.deepEqual(audits.map(a => [a.b, a.action]), [['b1', 'TENANT_TG_LINKED']]);
  assert.match(audits[0].detail, /211, 212/);
  assert.doesNotMatch(audits[0].detail, /900000001|0900/);
});

test('only the sender’s own contact, unforwarded, in their private chat with the bot, counts', async () => {
  const { store, link } = setup();
  store.add('b1', '211', '0900000001');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { chat: { id: -5, type: 'group' } }))).reason, 'not_private');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { chat: { id: 7, type: 'private' } }))).reason, 'not_private');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { contact: { phone_number: '251900000001', user_id: 99 } }))).reason, 'not_own_contact');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { contact: { phone_number: '251900000001' } }))).reason, 'not_own_contact');
  assert.equal((await link.linkFromContact(own('darulle', '251900000001', { forwarded: true }))).reason, 'not_own_contact');
  assert.equal(store.s.users[0].telegramChatId, null);
});

test('the same last nine digits from another country do not match', async () => {
  const { store, link } = setup();
  store.add('b1', '211', '0900000001');
  assert.deepEqual(await link.linkFromContact(own('darulle', '+1900000001')), { ok: false, reason: 'no_match' });
  assert.equal(store.s.users[0].telegramChatId, null);
});

test('a tenant of another building, an ended tenancy, an unknown or malformed building: the same neutral no_match', async () => {
  const { store, link } = setup();
  store.add('b2', '5', '0900000001');
  store.add('b1', '9', '0900000002', false);
  for (const [slug, phone] of [['darulle', '251900000001'], ['darulle', '251900000002'], ['nope', '251900000001'], ['bad slug!', '251900000001'], ['darulle', 'not a phone']]) {
    const { link: fresh } = { link: makeTenantLink({ store, audit: () => {} }) };
    assert.deepEqual(await fresh.linkFromContact(own(slug, phone)), { ok: false, reason: 'no_match' }, slug + ' ' + phone);
  }
  assert.ok(store.s.users.every(u => u.telegramChatId === null));
});

test('five attempts in fifteen minutes, then a pause', async () => {
  const { link } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await link.linkFromContact(own('darulle', '25190000000' + i))).reason, 'no_match');
  assert.equal((await link.linkFromContact(own('darulle', '251900000009'))).reason, 'too_many');
});

test('/stop clears the link for every tenancy of that account and audits each building', async () => {
  const { store, audits, link } = setup();
  store.add('b1', '211', '0900000001'); store.add('b2', '5', '0900000001');
  store.s.users[0].telegramChatId = '42';
  assert.equal(await link.unlink(42), 1);
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.deepEqual(audits.map(a => [a.b, a.action]).sort(), [['b1', 'TENANT_TG_UNLINKED'], ['b2', 'TENANT_TG_UNLINKED']]);
  assert.equal(await link.unlink(42), 0);
});

test('the dashboard sees linked units and can remove one — only in its own building', async () => {
  const { store, audits, link } = setup();
  const t1 = store.add('b1', '211', '0900000001'); store.add('b1', '212', '0900000002'); const t3 = store.add('b2', '5', '0900000003');
  store.s.users[0].telegramChatId = '42'; store.s.users[2].telegramChatId = '43';
  assert.deepEqual(await link.statsForBuilding('b1'), { active: 2, linked: 1, units: [{ tenancyId: t1.id, unit: '211' }] });
  assert.equal(await link.removeForBuilding('b1', t3.id), false);
  assert.equal(store.s.users[2].telegramChatId, '43');
  assert.equal(await link.removeForBuilding('b1', t1.id), true);
  assert.equal(await link.removeForBuilding('b1', t1.id), false);
  assert.equal(store.s.users[0].telegramChatId, null);
  assert.deepEqual(audits.map(a => [a.b, a.action, a.detail]), [['b1', 'TENANT_TG_UNLINKED', 'unit 211 · removed from the dashboard']]);
});

test('the Prisma store reads active tenancies of one building and writes only telegramChatId', async () => {
  const seen = [];
  const prisma = {
    building: { findUnique: async a => { seen.push(['building', a]); return null; } },
    tenancy: { findMany: async a => { seen.push(['tenancies', a]); return []; } },
    user: { update: async a => { seen.push(['update', a]); return {}; }, findMany: async a => { seen.push(['users', a]); return []; } },
  };
  const st = makeTenantLinkStore(prisma);
  await st.buildingBySlug('darulle'); await st.activeTenancies('b1'); await st.setChat('u1', '42'); await st.clearChat('u1'); await st.usersWithChat('42');
  assert.deepEqual(seen.find(x => x[0] === 'building')[1].where, { qrSlug: 'darulle' });
  assert.deepEqual(seen.find(x => x[0] === 'tenancies')[1].where, { active: true, unit: { buildingId: 'b1' } });
  const ups = seen.filter(x => x[0] === 'update').map(x => x[1]);
  assert.deepEqual(ups.map(u => [u.where.id, Object.keys(u.data), u.data.telegramChatId]), [['u1', ['telegramChatId'], '42'], ['u1', ['telegramChatId'], null]]);
  assert.deepEqual(seen.find(x => x[0] === 'users')[1].where, { telegramChatId: '42' });
});
```

- [ ] **Step 2: Copy up, run** → fails: `Cannot find module '../../messaging/tenant-link'`.

- [ ] **Step 3: Export the limiter.** Back up `agents/owner/access.js`; `$L/tmp/t7_patch.py`:

```python
import io, sys
p = '/var/www/connectcare/binasmart/agents/owner/access.js'
s = io.open(p, encoding='utf-8', newline='').read()
old = 'module.exports = { makeOwnerAccess, makeOwnerAccessStore, toE164, KINDS };'
if s.count(old) != 1: sys.exit('exports anchor')
s = s.replace(old, '// limiter is shared with messaging/tenant-link.js: one attempt limit for every Share-my-phone link.\nmodule.exports = { makeOwnerAccess, makeOwnerAccessStore, toE164, KINDS, limiter };')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: Implement** — `$L/messaging/tenant-link.js`

```js
'use strict';
// Tenants link @bina_smart_bot to receive their building's messages (owner actions and messaging design §2).
//
// Proof is Telegram's, exactly as for owners (agents/owner/access.js): the sender's own contact (contact.user_id ===
// from.id), in their private chat with the bot (chat.id === from.id), not forwarded or composed via a bot. The number
// must equal, as a full international number, the phone of an ACTIVE tenancy in the building the start link names —
// never the last nine digits, never another building. The bot calls this only within ten minutes of
// /start tenant_<slug> (ride/binaBot.js), because Mini Apps drop contacts into the same chat.
//
// A match writes the tenant's User.telegramChatId, and messaging/delivery.js then prefers Telegram. Nothing else is
// granted: no chat with Bini about the account in v1. Every failure to match gets one neutral reason, whatever the cause.
const { toE164, limiter } = require('../agents/owner/access');

const SLUG = /^[A-Za-z0-9-]{1,60}$/;
const last4 = s => String(s == null ? '' : s).replace(/\D/g, '').slice(-4);

function makeTenantLinkStore(prisma) {
  return {
    buildingBySlug: slug => prisma.building.findUnique({ where: { qrSlug: slug }, select: { id: true, qrSlug: true } }),
    activeTenancies: buildingId => prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } },
      select: { id: true, userId: true, unit: { select: { number: true } }, user: { select: { phone: true, telegramChatId: true } } } }),
    setChat: (userId, chatId) => prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId }, select: { id: true } }),
    clearChat: userId => prisma.user.update({ where: { id: userId }, data: { telegramChatId: null }, select: { id: true } }),
    usersWithChat: chatId => prisma.user.findMany({ where: { telegramChatId: chatId },
      select: { id: true, tenancies: { where: { active: true }, select: { unit: { select: { buildingId: true, number: true } } } } } }),
  };
}

function makeTenantLink({ store, audit = () => {}, now = () => new Date(), limit }) {
  const allow = limit || limiter(5, 15 * 60000, now);
  const note = (buildingId, action, detail) => Promise.resolve().then(() => audit(buildingId, action, detail)).catch(() => {});

  async function linkFromContact({ slug, chat, from, contact, forwarded }) {
    if (!chat || chat.type !== 'private') return { ok: false, reason: 'not_private' };
    if (!from || !contact || forwarded || contact.user_id == null || String(contact.user_id) !== String(from.id))
      return { ok: false, reason: 'not_own_contact' };
    if (String(chat.id) !== String(from.id)) return { ok: false, reason: 'not_private' };
    const telegramId = String(from.id);
    if (!allow(telegramId)) return { ok: false, reason: 'too_many' };
    const e164 = toE164(contact.phone_number, { from: 'telegram' });
    if (!e164 || !SLUG.test(String(slug || ''))) return { ok: false, reason: 'no_match' };
    const b = await store.buildingBySlug(String(slug));
    if (!b) return { ok: false, reason: 'no_match' };
    const mine = (await store.activeTenancies(b.id)).filter(t => t.user && toE164(t.user.phone, { from: 'ops' }) === e164);
    if (!mine.length) return { ok: false, reason: 'no_match' };
    for (const userId of new Set(mine.map(t => t.userId))) await store.setChat(userId, String(chat.id));
    const units = mine.map(t => t.unit.number);
    await note(b.id, 'TENANT_TG_LINKED', ('units ' + units.join(', ')).slice(0, 120) + ' · telegram …' + last4(telegramId));
    return { ok: true, buildingId: b.id, units };
  }

  // /stop in the bot. In a private chat the chat id is the account id, which is what setChat stored.
  async function unlink(telegramId) {
    const users = await store.usersWithChat(String(telegramId));
    for (const u of users) {
      await store.clearChat(u.id);
      const byBuilding = new Map();
      for (const t of u.tenancies) (byBuilding.get(t.unit.buildingId) || byBuilding.set(t.unit.buildingId, []).get(t.unit.buildingId)).push(t.unit.number);
      for (const [buildingId, units] of byBuilding) await note(buildingId, 'TENANT_TG_UNLINKED', ('units ' + units.join(', ')).slice(0, 120) + ' · /stop in Telegram');
    }
    return users.length;
  }

  async function statsForBuilding(buildingId) {
    const ts = await store.activeTenancies(buildingId);
    const linked = ts.filter(t => t.user && t.user.telegramChatId);
    return { active: ts.length, linked: linked.length, units: linked.map(t => ({ tenancyId: t.id, unit: t.unit.number })) };
  }

  // The owner removes a unit's link. It clears the tenant's Telegram chat for every building (one chat per person);
  // the tenant can link again from the poster, since their number still matches.
  async function removeForBuilding(buildingId, tenancyId) {
    const t = (await store.activeTenancies(buildingId)).find(x => x.id === String(tenancyId));
    if (!t || !t.user || !t.user.telegramChatId) return false;
    await store.clearChat(t.userId);
    await note(buildingId, 'TENANT_TG_UNLINKED', 'unit ' + t.unit.number + ' · removed from the dashboard');
    return true;
  }

  return { linkFromContact, unlink, statsForBuilding, removeForBuilding };
}

module.exports = { makeTenantLink, makeTenantLinkStore };
```

- [ ] **Step 5: Copy up, run** `test/messaging/tenant-link.test.js test/owner/access.test.js` → tenant-link `# pass 8`, access tests unchanged, `# fail 0`. Full suite → **961 pass, 0 fail**. (No restart: nothing loads the module yet; the access.js change is an extra export.)

- [ ] **Step 6: Commit** `messaging/tenant-link.js agents/owner/access.js test/messaging/tenant-link.test.js`:

```
Tenant Telegram: link rules with Telegram's proof of the phone, matched in full within one building

messaging/tenant-link.js links a tenant only from their own, unforwarded contact in their private chat, and only when
the full international number equals the phone of an active tenancy in the building named by the start link. Another
country's number with the same last nine digits, another building, an ended tenancy or an unknown building all get
the same neutral no_match. Five attempts per 15 minutes (the owner-link limiter, now exported). /stop and the
dashboard's Remove clear the link; audits carry unit numbers and last four digits of the Telegram id only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 8: The bot — /start tenant_<slug>, the tenant's contact, /stop

**Files:**
- Modify: `ride/binaBot.js`, `ride/index.js`
- Test: `test/messaging/tenant-bot.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/tenant-bot.test.js`

```js
'use strict';
// @bina_smart_bot's tenant paths with a fake Telegram API and a fake link service: nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

function harness({ link = { ok: true, buildingId: 'b1', units: ['211'] }, linkThrows = false, unlinkResult = 1, unlinkThrows = false,
  withTenant = true, withOwner = false, clock = null } = {}) {
  const sent = [], calls = { link: [], unlink: [], ownerLink: [], bini: [] };
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    sendChatAction: async () => true, answerCallbackQuery: async () => true };
  const fetchImpl = async (url, init) => { calls.bini.push(JSON.parse(init.body)); return { json: async () => ({ reply: 'customer bini' }) }; };
  const tenant = {
    linkFromContact: async a => { calls.link.push(a); if (linkThrows) throw new Error('db down'); return link; },
    unlink: async id => { calls.unlink.push(String(id)); if (unlinkThrows) throw new Error('db down'); return unlinkResult; },
  };
  const owner = { access: { scopeFor: async () => null, linkFromContact: async a => { calls.ownerLink.push(a); return { ok: false, reason: 'not_registered' }; },
    unlink: async () => false, setMode: async () => false }, answer: async () => 'x', health: async () => 'h' };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl, botUsername: 'bina_smart_bot', internalKey: 'k',
    tenant: withTenant ? tenant : undefined, owner: withOwner ? owner : undefined, now: clock ? () => clock.t : undefined });
  return { sent, calls, b };
}
const pm = (text, extra = {}, chatId = 42) => ({ message: Object.assign({ chat: { id: chatId, type: 'private' }, from: { id: 42, first_name: 'T' }, text }, extra) });
const contact = (extra = {}) => pm('', Object.assign({ contact: { phone_number: '251900000001', user_id: 42 } }, extra));
const MIN = 60000;

test('/start tenant_<slug> in a private chat asks for the phone and links nothing yet', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('/start tenant_darulle'));
  assert.equal(sent[0].extra.reply_markup.keyboard[0][0].request_contact, true);
  assert.match(sent[0].text, /Rent notices on Telegram/);
  assert.equal(calls.link.length, 0);
});

test('a contact shared right after it is checked against that building, and a match says which units', async () => {
  const { sent, calls, b } = harness({ link: { ok: true, buildingId: 'b1', units: ['211', '212'] } });
  await b.handleUpdate(pm('/start tenant_darulle'));
  await b.handleUpdate(contact());
  assert.equal(calls.link.length, 1);
  assert.deepEqual([calls.link[0].slug, calls.link[0].forwarded, calls.link[0].from.id, calls.link[0].contact.phone_number], ['darulle', false, 42, '251900000001']);
  assert.match(sent[1].text, /✅/);
  assert.match(sent[1].text, /211, 212/);
  assert.match(sent[1].text, /\/stop/);
  assert.equal(sent[1].extra.reply_markup.remove_keyboard, true);
});

test('a contact 11 minutes later is not a link attempt; 9 minutes is; the start is used once', async () => {
  let clock = { t: 1e12 };
  let h = harness({ clock });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  clock.t += 11 * MIN;
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  assert.match(h.sent[1].text, /Ethiopia's all-in-one platform/);
  clock = { t: 1e12 };
  h = harness({ clock });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  clock.t += 9 * MIN;
  await h.b.handleUpdate(contact());
  await h.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 1);
});

test('a contact from a Mini App, with no /start tenant_, gets exactly the reply it got before', async () => {
  const h = harness();
  await h.b.handleUpdate(contact());
  const before = harness({ withTenant: false });
  await before.b.handleUpdate(contact());
  assert.equal(h.calls.link.length, 0);
  assert.deepEqual(h.sent, before.sent);
});

test('forwarded contacts and contacts sent via a bot are passed on as forwarded', async () => {
  for (const extra of [{ forward_origin: { type: 'user', date: 1 } }, { forward_from: { id: 43 } }, { forward_date: 1 }, { via_bot: { id: 9, is_bot: true } }]) {
    const { calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
    await b.handleUpdate(pm('/start tenant_darulle'));
    await b.handleUpdate(contact(extra));
    assert.equal(calls.link[0].forwarded, true, Object.keys(extra)[0]);
  }
});

test('no match gets one neutral reply that names nothing; refusals say what to do; a failure says so', async () => {
  const replies = {};
  for (const reason of ['no_match', 'something_else', 'too_many', 'not_own_contact', 'not_private']) {
    const { sent, b } = harness({ link: { ok: false, reason } });
    await b.handleUpdate(pm('/start tenant_darulle'));
    await b.handleUpdate(contact());
    replies[reason] = sent[1].text;
  }
  assert.equal(replies.no_match, replies.something_else);
  assert.match(replies.no_match, /could not connect this number/);
  assert.doesNotMatch(replies.no_match, /darulle|211/);
  assert.match(replies.too_many, /15 minutes/);
  assert.match(replies.not_own_contact, /own number/);
  assert.match(replies.not_private, /private chat/);
  const { sent, b } = harness({ linkThrows: true });
  await b.handleUpdate(pm('/start tenant_darulle'));
  await b.handleUpdate(contact());
  assert.match(sent[1].text, /linking failed/);
});

test('the newest start command decides what a contact means: owner or tenant', async () => {
  let h = harness({ withOwner: true });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  await h.b.handleUpdate(pm('/start owner'));
  await h.b.handleUpdate(contact());
  assert.deepEqual([h.calls.ownerLink.length, h.calls.link.length], [1, 0]);
  h = harness({ withOwner: true });
  await h.b.handleUpdate(pm('/start owner'));
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  await h.b.handleUpdate(contact());
  assert.deepEqual([h.calls.ownerLink.length, h.calls.link.length], [0, 1]);
});

test('/stop unlinks through the link service and answers either way; a failure asks to retry', async () => {
  let h = harness();
  await h.b.handleUpdate(pm('/stop'));
  assert.deepEqual(h.calls.unlink, ['42']);
  assert.match(h.sent[0].text, /notices stopped/);
  h = harness({ unlinkResult: 0 });
  await h.b.handleUpdate(pm('/stop'));
  assert.match(h.sent[0].text, /were not receiving/);
  h = harness({ unlinkThrows: true });
  await h.b.handleUpdate(pm('/stop'));
  assert.match(h.sent[0].text, /Sorry, please try again/);
});

test('in a group, or without the tenant service, /start tenant_ is just the welcome', async () => {
  let h = harness();
  await h.b.handleUpdate({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text: '/start tenant_darulle' } });
  assert.equal(h.sent[0].extra.reply_markup.keyboard, undefined);
  h = harness({ withTenant: false });
  await h.b.handleUpdate(pm('/start tenant_darulle'));
  assert.equal(h.sent[0].extra.reply_markup.keyboard, undefined);
  assert.match(h.sent[0].text, /Ethiopia's all-in-one platform/);
});
```

- [ ] **Step 2: Copy up, run** → several fail (the bot ignores `tenant`: no contact keyboard, no link call).

- [ ] **Step 3: Back up** `ride/binaBot.js` and `ride/index.js` (tag `t8`). **Patch** — `$L/tmp/t8_patch.py`:

```python
import io, sys
R = '/var/www/connectcare/binasmart/'
def edit(f, pairs):
    s = io.open(R + f, encoding='utf-8', newline='').read()
    for old, new, what in pairs:
        if s.count(old) != 1: sys.exit('%s: anchor for %s matched %d times' % (f, what, s.count(old)))
        s = s.replace(old, new)
    io.open(R + f, 'w', encoding='utf-8', newline='').write(s)

edit('ride/binaBot.js', [
  ('function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey, owner }) {',
   'function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey, owner, tenant }) {', 'signature'),
  ('''    return clock() - t <= PENDING_MS;
  }
''', r'''    return clock() - t <= PENDING_MS;
  }

  // ---- Tenant notices (messaging design §2). tenant = messaging/tenant-link.js from server.js; absent = off. ----
  // The building poster opens t.me/bina_smart_bot?start=tenant_<slug>. A shared contact is a tenant link attempt only
  // within ten minutes of that command, and whichever start command came last (owner or tenant) decides.
  const TENANT_START = '🏢 የኪራይ መልእክቶች በቴሌግራም · Rent notices on Telegram\n\nበህንፃው የተመዘገበውን ስልክ ቁጥርዎን ለማረጋገጥ ከታች «📱 ስልኬን አጋራ»ን ይጫኑ።\nTap "📱 Share my phone" below. Telegram confirms the number is yours, and we match it to your tenancy.';
  const TENANT_NO_MATCH = 'ይህን ቁጥር ከህንፃው የተከራይ መዝገብ ጋር ማገናኘት አልተቻለም። ቁጥርዎ ከተቀየረ የህንፃውን አስተዳደር ያነጋግሩ። · We could not connect this number to the building\'s tenant records. If your number has changed, please ask the building management.';
  const TENANT_REFUSAL = { too_many: REFUSAL.too_many, not_own_contact: REFUSAL.not_own_contact, not_private: REFUSAL.not_private };
  const pendingTenant = new Map();   // String(from.id) -> { t: clock() when /start tenant_ was sent, slug }

  async function linkTenant(chatId, msg, slug) {
    let r;
    try {
      r = await tenant.linkFromContact({ slug, chat: msg.chat, from: msg.from, contact: msg.contact,
        forwarded: !!(msg.forward_origin || msg.forward_from || msg.forward_date || msg.via_bot) });
    } catch (e) {
      console.error('[binaBot] tenant link: ' + e.message);
      return api.sendMessage(chatId, 'ይቅርታ፣ አሁን ማገናኘት አልተቻለም። · Sorry, linking failed just now.', { reply_markup: NO_KB });
    }
    if (r && r.ok) return api.sendMessage(chatId, '✅ ተገናኝቷል · Linked — ክፍል · unit ' + r.units.join(', ')
      + '\n\nየህንፃዎ የክፍያ መጠየቂያዎች፣ ደረሰኞችና ማሳሰቢያዎች ከአሁን በኋላ እዚህ ይደርሱዎታል። ለማቆም /stop ይጻፉ።\nInvoices, receipts and notices from your building will arrive here. Send /stop to stop.', { reply_markup: NO_KB });
    return api.sendMessage(chatId, TENANT_REFUSAL[r && r.reason] || TENANT_NO_MATCH, { reply_markup: NO_KB });
  }

  async function handleTenantCommand(chatId, msg, text) {
    const start = /^\/start\s+tenant_([A-Za-z0-9-]{1,60})(?:\s|$)/.exec(text);
    if (start) {
      const k = String(msg.from.id), t = clock();
      pendingLink.delete(k);
      pendingTenant.set(k, { t, slug: start[1] });
      if (pendingTenant.size > 5000) for (const [key, v] of pendingTenant) if (t - v.t > PENDING_MS) pendingTenant.delete(key);
      return api.sendMessage(chatId, TENANT_START, { reply_markup: SHARE_KB });
    }
    if (msg.contact) {
      const k = String(msg.from.id), p = pendingTenant.get(k);
      if (!p) return PASS;
      pendingTenant.delete(k);
      return clock() - p.t <= PENDING_MS ? linkTenant(chatId, msg, p.slug) : PASS;
    }
    if (/^\/stop\b/.test(text)) {
      pendingTenant.delete(String(msg.from.id));
      const n = await tenant.unlink(msg.from.id).catch(e => { console.error('[binaBot] tenant unlink: ' + e.message); return FAILED; });
      if (n === FAILED) return api.sendMessage(chatId, SORRY, { reply_markup: NO_KB });
      return api.sendMessage(chatId, n
        ? 'የህንፃ መልእክቶች ቆመዋል። እንደገና ለመጀመር የህንፃውን QR ይቃኙ። · Building notices stopped. Scan your building\'s QR code to start again.'
        : 'እዚህ የህንፃ መልእክቶችን አይቀበሉም ነበር። · You were not receiving building notices here.', { reply_markup: NO_KB });
    }
    return PASS;
  }
''', 'tenant block after takePending'),
  ('''      markPending(msg.from.id);
      return api.sendMessage(chatId, OWNER_START, { reply_markup: SHARE_KB });''',
   '''      pendingTenant.delete(String(msg.from.id));   // the newest start command decides what a contact means
      markPending(msg.from.id);
      return api.sendMessage(chatId, OWNER_START, { reply_markup: SHARE_KB });''', 'owner start clears tenant pending'),
  ('''    // Bini for owners: /start owner, the shared contact, /logout, /bini, /owner — private chats only, and only''',
   '''    // Tenant notices: /start tenant_<slug>, the shared contact, /stop — private chats only, and only when server.js
    // passes the tenant link service.
    if (tenant && isPrivate(msg) && msg.from) {
      const handled = await handleTenantCommand(chatId, msg, text);
      if (handled !== PASS) return handled;
    }
    // Bini for owners: /start owner, the shared contact, /logout, /bini, /owner — private chats only, and only''', 'dispatch'),
])

edit('ride/index.js', [
  ('    owner: deps.ownerTelegram || null });   // Bini for owners (agents/owner/access.js); absent = off',
   '    owner: deps.ownerTelegram || null,    // Bini for owners (agents/owner/access.js); absent = off\n    tenant: deps.tenantTelegram || null });   // tenant notices (messaging/tenant-link.js); absent = off', 'ride deps'),
])
print('ok')
```

Note: `REFUSAL`, `SHARE_KB`, `NO_KB`, `PASS`, `FAILED` and `SORRY` are declared above `PENDING_MS` in `binaBot.js`, so the tenant block can use them.

- [ ] **Step 4: Syntax, then tests** — `node --check ride/binaBot.js && node --check ride/index.js`; run `test/messaging/tenant-bot.test.js test/owner/telegram.test.js test/binaBot.test.js` → tenant-bot `# pass 9`, the owner and bot suites unchanged, `# fail 0`. Full suite → **970 pass, 0 fail**.

- [ ] **Step 5: Restart** (Conventions). `tenantTelegram` is not passed by `server.js` until Task 9, so the bot behaves exactly as before; the Ride line must be present.

- [ ] **Step 6: Commit** `ride/binaBot.js ride/index.js test/messaging/tenant-bot.test.js`:

```
Tenant Telegram in @bina_smart_bot: /start tenant_<slug>, Share my phone, /stop

With a tenant link service, the bot answers /start tenant_<slug> with the Share-my-phone keyboard, treats a contact as
a tenant link attempt only within ten minutes of that command (a Mini App contact keeps its old reply), passes
forwarded and via-bot contacts on as forwarded, and replies to any non-match with one neutral text. The newest start
command, owner or tenant, decides what a contact means. /stop unlinks. Without the service nothing changes; server.js
passes it in the next commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 9: Server — tenant Telegram routes, the printable poster, the old unit-number webhook retired

**Files:**
- Create: `messaging/tenant-poster.js`
- Modify: `server.js` (tenant block before `// ===== SMART NOTIFICATIONS + PENALTIES`; `/api/tg-webhook` ≈2610–2644; ride deps ≈3478)
- Test: `test/messaging/tenant-poster.test.js`, `test/messaging/server-tenant.test.js`

- [ ] **Step 1: Write the failing tests**

`$L/test/messaging/tenant-poster.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tenantPoster } = require('../../messaging/tenant-poster');

test('the A4 poster carries the QR, the start link, Amharic and English, /stop, and is not indexed', () => {
  const html = tenantPoster({ building: { name: 'Demo Tower', nameAm: 'ዴሞ ታወር' }, startUrl: 'https://t.me/bina_smart_bot?start=tenant_demo-tower', qrSvg: '<svg id="qr"></svg>' });
  for (const s of ['<svg id="qr"></svg>', 'https://t.me/bina_smart_bot?start=tenant_demo-tower', 'Get your rent notices on Telegram', 'የኪራይ መልእክቶችዎን በቴሌግራም ያግኙ', '/stop', 'ዴሞ ታወር · Demo Tower', '@page{size:A4'])
    assert.ok(html.includes(s), s);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});

test('a building name cannot inject markup', () => {
  const html = tenantPoster({ building: { name: '<img src=x onerror=alert(1)>', nameAm: '"><script>x</script>' }, startUrl: 'https://t.me/x', qrSvg: '' });
  assert.equal(html.includes('<img src=x'), false);
  assert.equal(html.includes('<script>x'), false);
});
```

`$L/test/messaging/server-tenant.test.js`

```js
'use strict';
// server.js wiring for tenant Telegram, pinned by reading the file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const block = (sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };

test('the tenant Telegram routes authenticate, never read the body, and remove only a tenancy of that building', () => {
  for (const sig of ["fastify.get('/api/owner/:slug/tenant-telegram'", "fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove'"]) {
    const body = block(sig);
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0, sig);
    assert.doesNotMatch(body, /req\.body/, sig);
  }
  const rm = block("fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove'");
  assert.match(rm, /t\.unit\.buildingId !== b\.id/);
  assert.match(rm, /tenantLink\.removeForBuilding\(b\.id, t\.id\)/);
  assert.match(src, /const tenantLink = makeTenantLink\(\{ store: makeTenantLinkStore\(prisma\), audit \}\);/);
});

test('the poster route checks the slug before the database, is not indexed, and encodes only the start link', () => {
  const body = block("fastify.get('/tenant-poster/:slug'");
  assert.ok(body.indexOf('/^[A-Za-z0-9-]{1,60}$/.test(') > 0 && body.indexOf('/^[A-Za-z0-9-]{1,60}$/.test(') < body.indexOf('prisma.building.findUnique('));
  assert.match(body, /'X-Robots-Tag', 'noindex, nofollow'/);
  assert.match(body, /QRCode\.toString\(tenantStartUrl\(b\.qrSlug\)/);
});

test('the old unit-number webhook links nobody any more', () => {
  const body = block("fastify.post('/api/tg-webhook'");
  assert.doesNotMatch(body, /telegramChatId|prisma\.|sendTg\(/);
  assert.match(body, /x-telegram-bot-api-secret-token/);
});

test('the bot gets the tenant link service', () => {
  const ride = block("const rideMod = require('./ride')(fastify, {", '\n});');
  assert.match(ride, /tenantTelegram: tenantLink,/);
  assert.ok(src.indexOf('const tenantLink = ') < src.indexOf("const rideMod = require('./ride')(fastify, {"));
  assert.match(fs.readFileSync(path.join(ROOT, 'ride', 'index.js'), 'utf8'), /tenant: deps\.tenantTelegram \|\| null/);
});
```

- [ ] **Step 2: Copy up, run both** → fail (`Cannot find module '../../messaging/tenant-poster'`; routes not found).

- [ ] **Step 3: Implement the poster** — `$L/messaging/tenant-poster.js`

```js
'use strict';
// The printable A4 poster that invites a building's tenants to link @bina_smart_bot (messaging design §2).
// Public: it shows only the building's name and the bot link, both already public on /b/<slug>.
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tenantPoster({ building, startUrl, qrSvg }) {
  const name = building.name || '', nameAm = building.nameAm || name;
  return '<!doctype html><html lang="am"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>' + esc(name) + ' · Telegram notices</title>'
    + '<link rel="stylesheet" href="/static/fonts/fonts.css?v=2">'
    + '<style>@page{size:A4;margin:0}body{margin:0;font-family:Inter,"Noto Sans Ethiopic",sans-serif;background:#e5e7eb;color:#0f2027}'
    + '.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;box-sizing:border-box;padding:16mm 16mm;text-align:center}'
    + '.bld{font-size:22px;font-weight:800;margin-bottom:8mm}h1{font-size:30px;margin:0 0 3mm}h2{font-size:20px;margin:0 0 10mm;color:#068f79}'
    + '.qr{width:105mm;margin:0 auto 8mm}.qr svg{width:100%;height:auto;display:block}'
    + '.steps{text-align:left;max-width:150mm;margin:0 auto;font-size:17px;line-height:1.5;padding-left:7mm}.steps li{margin-bottom:4mm}.steps small{color:#475569;font-size:14px}'
    + '.link{font-size:14px;color:#0369a1;word-break:break-all;margin:6mm 0}.foot{font-size:13px;color:#64748b;margin-top:8mm;line-height:1.6}'
    + '.bar{text-align:center;padding:12px}.btn{display:inline-block;padding:10px 18px;background:#068f79;color:#fff;border:0;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer}'
    + '@media print{body{background:#fff}.bar{display:none}}</style></head><body>'
    + '<div class="bar"><button class="btn" onclick="window.print()">🖨️ Print · አትም</button></div>'
    + '<div class="page"><div class="bld">🏢 ' + esc(nameAm) + (nameAm !== name ? ' · ' + esc(name) : '') + '</div>'
    + '<h1>የኪራይ መልእክቶችዎን በቴሌግራም ያግኙ</h1><h2>Get your rent notices on Telegram</h2>'
    + '<div class="qr">' + qrSvg + '</div>'
    + '<ol class="steps">'
    + '<li>QR ኮዱን በስልክዎ ካሜራ ይቃኙ ወይም ከታች ያለውን ሊንክ ይክፈቱ።<br><small>Scan the QR code with your phone camera, or open the link below.</small></li>'
    + '<li>በቴሌግራም «Start»ን፣ ከዚያ «📱 ስልኬን አጋራ»ን ይጫኑ።<br><small>In Telegram tap Start, then "📱 Share my phone".</small></li>'
    + '<li>በኪራይ ውልዎ ላይ የተመዘገበው ስልክ ቁጥር መሆን አለበት።<br><small>It must be the phone number registered for your tenancy.</small></li>'
    + '</ol>'
    + '<div class="link">' + esc(startUrl) + '</div>'
    + '<div class="foot">የክፍያ መጠየቂያዎች፣ ደረሰኞችና የህንፃ ማሳሰቢያዎች ብቻ ይላካሉ። ለማቆም /stop ይጻፉ።<br>'
    + 'Only invoices, receipts and building notices are sent. Send /stop to stop.<br><b>BinaSmart · bina.et</b></div>'
    + '</div></body></html>';
}

module.exports = { tenantPoster };
```

- [ ] **Step 4: Back up** `server.js` (tag `t9`). **Patch** — `$L/tmp/t9_patch.py`:

```python
import io, sys
p = '/var/www/connectcare/binasmart/server.js'
s = io.open(p, encoding='utf-8', newline='').read()
def sub(old, new, what):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor for %s matched %d times' % (what, n))
    s = s.replace(old, new)
if 'QRCode' in s or 'tenantLink' in s: sys.exit('names already in use')

sub('''// ===== SMART NOTIFICATIONS + PENALTIES (daily engine) =====''', r'''// ===== Tenant notices on Telegram (owner actions and messaging design §2) =====
// Tenants link @bina_smart_bot from the building's poster: /start tenant_<slug>, then Share my phone. The proof and the
// match live in messaging/tenant-link.js; the bot (ride/binaBot.js) calls it only within ten minutes of that command.
// The owner sees how many tenants linked, prints the poster, and can remove a unit's link.
const QRCode = require('qrcode');
const { makeTenantLink, makeTenantLinkStore } = require('./messaging/tenant-link');
const { tenantPoster } = require('./messaging/tenant-poster');
const tenantLink = makeTenantLink({ store: makeTenantLinkStore(prisma), audit });
const tenantStartUrl = slug => 'https://t.me/' + (process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot') + '?start=tenant_' + slug;
fastify.get('/api/owner/:slug/tenant-telegram', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true, qrSlug: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const st = await tenantLink.statsForBuilding(b.id);
  return { active: st.active, linked: st.linked, units: st.units, startLink: tenantStartUrl(b.qrSlug), poster: '/tenant-poster/' + b.qrSlug };
});
fastify.post('/api/owner/:slug/tenant-telegram/:tenancyId/remove', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  const t = await prisma.tenancy.findUnique({ where: { id: String(req.params.tenancyId) }, select: { id: true, unit: { select: { buildingId: true } } } });
  // Ownership, as every sibling route checks it; 404 rather than 403, so a wrong id is not confirmed.
  if (!b || !t || t.unit.buildingId !== b.id) return reply.code(404).send({ error: 'not_found' });
  if (!(await tenantLink.removeForBuilding(b.id, t.id))) return reply.code(404).send({ error: 'not_linked' });
  return { ok: true };
});
// Public and printable; shows only the building name and the bot link.
fastify.get('/tenant-poster/:slug', async (req, reply) => {
  const slug = String(req.params.slug || '');
  if (!/^[A-Za-z0-9-]{1,60}$/.test(slug)) return reply.code(404).type('text/html; charset=utf-8').send(slugMiss('ህንፃ · Building', '/'));
  const b = await prisma.building.findUnique({ where: { qrSlug: slug }, select: { name: true, nameAm: true, qrSlug: true } });
  if (!b) return reply.code(404).type('text/html; charset=utf-8').send(slugMiss('ህንፃ · Building', '/'));
  const qrSvg = await QRCode.toString(tenantStartUrl(b.qrSlug), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return reply.header('X-Robots-Tag', 'noindex, nofollow').type('text/html; charset=utf-8')
    .send(tenantPoster({ building: b, startUrl: tenantStartUrl(b.qrSlug), qrSvg }));
});

// ===== SMART NOTIFICATIONS + PENALTIES (daily engine) =====''', 'tenant block')

a = s.find("// ===== TELEGRAM LINKING (tenant opt-in bot) =====")
e = s.find('\n});\n', s.find("fastify.post('/api/tg-webhook'", a))
if a < 0 or e < 0 or s.count("fastify.post('/api/tg-webhook'") != 1: sys.exit('tg-webhook block not found')
if "data: { telegramChatId: chatId }" not in s[a:e]: sys.exit('tg-webhook body changed')
s = s[:a] + r'''// ===== Legacy tenant webhook (retired 15 Sep 2026) =====
// This route linked a Telegram chat to a Darulle tenant from nothing but a unit number, which is written on doors. It
// answered only Telegram's secret and no bot delivered here (0 links were ever made). Tenants now link in
// @bina_smart_bot with Telegram's proof of their phone number (messaging/tenant-link.js). The route stays so an old
// webhook registration gets a quiet 200 instead of retries; it changes nothing.
fastify.post('/api/tg-webhook', async (req, reply) => {
  const tgSecret = process.env.TG_WEBHOOK_SECRET || '';
  if (!tgSecret || req.headers['x-telegram-bot-api-secret-token'] !== tgSecret) return reply.code(401).send({ ok: false });
  return { ok: true };
});
''' + s[e + 5:]

sub('''  ownerTelegram, // Bini for owners in @bina_smart_bot (agents/owner/access.js)\n''',
    '''  ownerTelegram, // Bini for owners in @bina_smart_bot (agents/owner/access.js)\n  tenantTelegram: tenantLink, // tenant notices: /start tenant_<slug> and /stop (messaging/tenant-link.js)\n''', 'ride deps')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 5: Syntax and tests** — `node --check server.js`; run `test/messaging/tenant-poster.test.js test/messaging/server-tenant.test.js test/owner-routes.test.js test/kit/wiring.test.js` → poster `# pass 2`, server-tenant `# pass 4`, the others unchanged (owner-routes now also scans the new remove route), `# fail 0`. Full suite → **976 pass, 0 fail**.

- [ ] **Step 6: Restart** (Conventions).

- [ ] **Step 7: Live checks (no Telegram message).** `$L/tmp/t9-check.js` → `/tmp/t9-check.js`; `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node /tmp/t9-check.js; rm -f /tmp/t9-check.js'`:

```js
'use strict';
// Plan A Task 9 live check on the demo building century-mall. A temporary user + tenancy with a fake number is linked
// in-process through the real Prisma store (no message is sent: linking sends nothing), the dashboard routes are
// called over HTTP with a temporary owner key, and everything is deleted. Prints counts and booleans only.
const R = '/var/www/connectcare/binasmart/';
const { PrismaClient } = require(R + 'node_modules/@prisma/client');
const { makeTenantLink, makeTenantLinkStore } = require(R + 'messaging/tenant-link');
const { makeOwnerKeys, hashKey } = require(R + 'building/ownerKeys');
const p = new PrismaClient();
const BASE = 'http://127.0.0.1:4210', PHONE = '0900000093', TG = 990000093;
const get = (path, key) => fetch(BASE + path, { headers: key ? { 'x-owner-key': key } : {} });
const post = (path, key) => fetch(BASE + path, { method: 'POST', headers: key ? { 'x-owner-key': key } : {} });

(async () => {
  const started = new Date();
  const b = await p.building.findUnique({ where: { qrSlug: 'century-mall' }, select: { id: true, orgId: true } });
  const unit = await p.unit.findFirst({ where: { buildingId: b.id, status: 'VACANT' }, select: { id: true, number: true } })
    || await p.unit.findFirst({ where: { buildingId: b.id }, select: { id: true, number: true } });
  let user = null, tenancy = null, key = null;
  try {
    user = await p.user.create({ data: { orgId: b.orgId, phone: PHONE, fullName: 'planA check', role: 'TENANT' } });
    tenancy = await p.tenancy.create({ data: { unitId: unit.id, userId: user.id, startDate: new Date(), active: true } });
    const link = makeTenantLink({ store: makeTenantLinkStore(p), audit: async () => {} });
    const chat = { id: TG, type: 'private' }, from = { id: TG };
    const other = await link.linkFromContact({ slug: 'edna-mall', chat, from, contact: { phone_number: '251900000093', user_id: TG }, forwarded: false });
    console.log('other bldg  ', other.reason, '(want no_match)');
    const ok = await link.linkFromContact({ slug: 'century-mall', chat, from, contact: { phone_number: '251900000093', user_id: TG }, forwarded: false });
    console.log('linked      ', ok.ok, (await p.user.findUnique({ where: { id: user.id } })).telegramChatId === String(TG), '(want true true)');
    key = await makeOwnerKeys({ prisma: p }).issue(b.id, 'century-mall', 'planA-check');
    console.log('no key      ', (await get('/api/owner/century-mall/tenant-telegram')).status, '(want 401)');
    const card = await (await get('/api/owner/century-mall/tenant-telegram', key)).json();
    const mine = (card.units || []).find(u => u.tenancyId === tenancy.id);
    console.log('card        ', card.linked >= 1, !!mine, /start=tenant_century-mall$/.test(card.startLink), card.poster === '/tenant-poster/century-mall', !JSON.stringify(card).includes(PHONE.slice(1)), '(want true x5)');
    console.log('other key   ', (await post('/api/owner/edna-mall/tenant-telegram/' + tenancy.id + '/remove', key)).status, '(want 401)');
    console.log('wrong id    ', (await post('/api/owner/century-mall/tenant-telegram/nope/remove', key)).status, '(want 404)');
    console.log('remove      ', (await post('/api/owner/century-mall/tenant-telegram/' + tenancy.id + '/remove', key)).status, (await p.user.findUnique({ where: { id: user.id } })).telegramChatId, '(want 200 null)');
    const poster = await get('/tenant-poster/century-mall');
    const html = await poster.text();
    console.log('poster      ', poster.status, poster.headers.get('x-robots-tag'), html.includes('<svg'), html.includes('start=tenant_century-mall'), '(want 200 noindex, nofollow true true)');
    console.log('poster 404  ', (await get('/tenant-poster/no-such-building')).status, (await get('/tenant-poster/bad%20slug')).status, '(want 404 404)');
    console.log('old webhook ', (await fetch(BASE + '/api/tg-webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { chat: { id: 1 }, text: '707' } }) })).status, '(want 401)');
  } finally {
    if (tenancy) await p.tenancy.delete({ where: { id: tenancy.id } });
    if (user) await p.user.delete({ where: { id: user.id } });
    if (key) await p.ownerKey.deleteMany({ where: { keyHash: hashKey(key) } });
    await p.auditLog.deleteMany({ where: { buildingId: b.id, createdAt: { gte: started }, action: { in: ['TENANT_TG_LINKED', 'TENANT_TG_UNLINKED'] } } });
    console.log('cleaned     ', await p.user.count({ where: { phone: PHONE } }), await p.auditLog.count({ where: { buildingId: b.id, createdAt: { gte: started }, action: { startsWith: 'TENANT_TG' } } }), '(want 0 0)');
    await p.$disconnect();
  }
})().catch(e => { console.error('CHECK FAILED', e.message); process.exit(1); });
```

Expected: `no_match`; `true true`; `401`; `true true true true true`; `401`; `404`; `200 null`; `200 noindex, nofollow true true`; `404 404`; `401`; `cleaned 0 0`. (Unit status is never changed by the check.) If anything fails: restore `server.js.bak-planA-t9-*`, restart, report.

- [ ] **Step 8: Commit** `messaging/tenant-poster.js server.js test/messaging/tenant-poster.test.js test/messaging/server-tenant.test.js`:

```
Tenant Telegram on the server: linked count, poster, Remove, and the old unit-number webhook retired

server.js builds the tenant link service and passes it to @bina_smart_bot. The dashboard gets
GET /api/owner/:slug/tenant-telegram (active and linked counts, linked units, start link, poster) and
POST …/tenant-telegram/:tenancyId/remove, both authenticated and scoped to the building. /tenant-poster/<slug> is a
printable A4 page in Amharic and English with the QR of t.me/bina_smart_bot?start=tenant_<slug>, not indexed.
/api/tg-webhook no longer links a chat to a tenant from a unit number; it only answers.
Live check on century-mall with a temporary fake tenancy: linked only in its own building, counted, removed, poster
served, everything deleted. No Telegram message was sent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
### Task 10: Dashboard — the tenant Telegram card, "Waiting to be delivered", and a Send result that says what happened

**Files:**
- Modify: `public/owner.html`
- Test: `test/messaging/dashboard.test.js` (and the existing `test/owner-dashboard-escape.test.js` must stay green)

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/dashboard.test.js`

```js
'use strict';
// The owner dashboard's new cards, pinned by reading owner.html (the escape test covers template literals; these cards
// are built by string concatenation, so their escaping is pinned here).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'owner.html'), 'utf8');
const fn = name => { const at = HTML.indexOf('async function ' + name + '('); assert.ok(at > 0, name + ' missing'); return HTML.slice(at, HTML.indexOf('\n}\n', at)); };

test('Settings shows the tenant Telegram card: count, poster, link and Remove, every value escaped', () => {
  assert.ok(HTML.includes('<div id="tenant-tg" class="card p-4">'));
  assert.match(HTML, /    loadTgLinks\(\);\n    loadTenantTg\(\);/);
  const load = fn('loadTenantTg');
  assert.match(load, /kfetch\('\/api\/owner\/' \+ slug \+ '\/tenant-telegram'\)/);
  for (const v of ['esc(d.linked)', 'esc(d.active)', 'esc(d.poster)', 'esc(d.startLink)', 'esc(u.unit)', 'jsq(u.tenancyId)', 'jsq(u.unit)']) assert.ok(load.includes(v), v);
  assert.match(fn('removeTenantTg'), /'\/tenant-telegram\/' \+ encodeURIComponent\(id\) \+ '\/remove'/);
});

test('Invoices lists what did not reach tenants with Send now, and Send tells sent, test mode and not delivered apart', () => {
  assert.ok(HTML.includes('<div id="pending-deliv"></div>'));
  assert.match(HTML, /: ''\}`;\n    loadPending\(\);\n  \}/);
  const load = fn('loadPending');
  assert.match(load, /\/pending-deliveries'/);
  for (const v of ['esc(i.unit)', 'esc(i.type)', 'esc(i.dueDate)', 'esc(i.lastTry)', 'esc(i.reason)', 'jsq(i.id)', 'jsq(i.unit)', 'sendInvoice(']) assert.ok(load.includes(v), v);
  const send = fn('sendInvoice');
  assert.match(send, /r\.delivered/);
  assert.match(send, /r\.status === 'test'/);
  assert.match(send, /loadPending\(\);/);
  assert.doesNotMatch(send, /WhatsApp/);
});
```

- [ ] **Step 2: Copy up, run** → `# fail 2` (`<div id="tenant-tg"` missing).

- [ ] **Step 3: Back up** `public/owner.html` (tag `t10`). **Patch** — `$L/tmp/t10_patch.py`:

```python
import io, sys
p = '/var/www/connectcare/binasmart/public/owner.html'
s = io.open(p, encoding='utf-8', newline='').read()
def sub(old, new, what):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor for %s matched %d times' % (what, n))
    s = s.replace(old, new)

sub('''    <div id="tg-links" class="card p-4"><div class="text-[11px] text-slate-400">✈️ Bini on Telegram…</div></div>\n''',
    '''    <div id="tg-links" class="card p-4"><div class="text-[11px] text-slate-400">✈️ Bini on Telegram…</div></div>\n    <div id="tenant-tg" class="card p-4"><div class="text-[11px] text-slate-400">📨 Tenant notices on Telegram…</div></div>\n''', 'tenant card placeholder')
sub('''    loadTgLinks();\n''', '''    loadTgLinks();\n    loadTenantTg();\n''', 'load tenant card with Settings')

sub('''onclick="genInvoices()">⚡ Generate month invoices</button></div></div>\n''',
    '''onclick="genInvoices()">⚡ Generate month invoices</button></div></div>\n    <div id="pending-deliv"></div>\n''', 'pending placeholder')
sub(r'''class="tag bg-slate-200 text-slate-500">↩️</button></div>`).join('')}</div></div>` : ''}`;
  }
''', r'''class="tag bg-slate-200 text-slate-500">↩️</button></div>`).join('')}</div></div>` : ''}`;
    loadPending();
  }
''', 'load pending with Invoices')

sub("async function vatSettings(){", r'''// Tenant notices on Telegram (messaging design §2): how many tenants linked, the printable poster and link, and Remove.
async function loadTenantTg(){
  const box = document.getElementById('tenant-tg'); if (!box) return;
  try {
    const r = await kfetch('/api/owner/' + slug + '/tenant-telegram'); if (!r.ok) { box.innerHTML = ''; return; }
    const d = await r.json();
    const rows = (d.units || []).map(function (u) {
      return '<div class="flex justify-between items-center text-[11px] py-1 border-b" style="border-color:#e9f0ee"><span>ክፍል · Unit ' + esc(u.unit)
        + '</span><button class="mbtn" style="background:#fee2e2;color:#dc2626" onclick="removeTenantTg(\'' + jsq(u.tenancyId) + '\',\'' + jsq(u.unit) + '\')">Remove</button></div>';
    }).join('');
    box.innerHTML = '<div class="font-black text-sm mb-1">📨 Tenant notices on Telegram · የተከራይ መልእክቶች በቴሌግራም</div>'
      + '<div class="text-[11px] mb-2" style="color:#475569"><b>' + esc(d.linked) + ' / ' + esc(d.active) + '</b> tenants linked · ተከራዮች ተገናኝተዋል</div>'
      + '<a class="mbtn w-full block text-center" style="background:#e0f2fe;color:#0369a1;padding:10px" href="' + esc(d.poster) + '" target="_blank" rel="noopener">🖨️ Print the tenant poster (A4) · ፖስተር አትም</a>'
      + '<div class="text-[10px] text-slate-400 mt-1" style="word-break:break-all">' + esc(d.startLink) + '</div>'
      + (rows ? '<div class="mt-2">' + rows + '</div>' : '');
  } catch (e) { box.innerHTML = ''; }
}
async function removeTenantTg(id, unit){
  if (!confirm('Stop Telegram notices for unit ' + unit + '? The tenant can link again from the poster.')) return;
  await kfetch('/api/owner/' + slug + '/tenant-telegram/' + encodeURIComponent(id) + '/remove', { method: 'POST' });
  loadTenantTg();
}
// Invoices whose send did not reach the tenant (messaging design §1.6). Send now uses the invoice as it is today.
async function loadPending(){
  const box = document.getElementById('pending-deliv'); if (!box) return;
  try {
    const r = await kfetch('/api/owner/' + slug + '/pending-deliveries'); if (!r.ok) { box.innerHTML = ''; return; }
    const d = await r.json();
    if (!d.invoices || !d.invoices.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card p-4"><div class="font-black text-sm mb-1 text-amber-700">📭 Waiting to be delivered · ያልደረሱ (' + d.invoices.length + ')</div>'
      + '<div class="text-[10px] text-slate-500 mb-2">Sent before, but they did not reach the tenant. Send now uses the invoice as it is today. · አሁን ያለውን መረጃ ይልካል።</div>'
      + d.invoices.map(function (i) {
        return '<div class="flex items-center gap-2 text-[11px] py-1.5 border-b" style="border-color:#e9f0ee"><span class="flex-1"><b>' + esc(i.unit) + '</b> · ' + esc(i.type)
          + ' · ' + fmtETB(i.amount) + ' · due ' + esc(i.dueDate) + '<br><span class="text-[9px] text-slate-400">last try ' + esc(i.lastTry) + ' · ' + esc(i.reason) + '</span></span>'
          + '<button class="tag" style="background:#0088cc;color:#fff" onclick="sendInvoice(\'' + jsq(i.id) + '\',\'' + jsq(i.unit) + '\')">📤 Send now</button></div>';
      }).join('') + '</div>';
  } catch (e) { box.innerHTML = ''; }
}
async function vatSettings(){''', 'new functions')

sub(r'''async function sendInvoice(id, unit){
  if (!confirm('📤 Send this invoice to the tenant of ' + unit + ' by WhatsApp/Telegram? / ደረሰኙን ለተከራዩ ይላክ?')) return;
  const r = await (await kfetch('/api/owner/' + slug + '/invoice/' + id + '/send', { method: 'POST' })).json();
  alert(r.ok ? (r.delivered ? '✅ Sent to tenant / ተልኳል' : '⚠️ Message channel is offline right now — NOT delivered. Press Send again later. / ቻናሉ ጠፍቷል — አልደረሰም፣ በኋላ እንደገና ይላኩ') : '❌ ' + r.error);
}''', r'''async function sendInvoice(id, unit){
  if (!confirm('📤 Send this invoice to the tenant of ' + unit + ' by Telegram (or SMS once it is switched on)? / ደረሰኙን ለተከራዩ ይላክ?')) return;
  const r = await (await kfetch('/api/owner/' + slug + '/invoice/' + id + '/send', { method: 'POST' })).json();
  if (!r.ok) { alert('❌ ' + r.error); return; }
  alert(r.delivered ? '✅ Sent by ' + (r.channel === 'sms' ? 'SMS' : 'Telegram') + ' / ተልኳል'
    : r.status === 'test' ? '🧪 Test mode — recorded, nothing was sent (SMS is not switched on yet). / የሙከራ ሁኔታ — አልተላከም'
    : '⚠️ NOT delivered (' + (r.reason || 'not reachable') + '): the tenant has not linked Telegram and SMS is not available yet. It stays under "Waiting to be delivered". / አልደረሰም');
  loadPending();
}''', 'sendInvoice')
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: Tests** — run `test/messaging/dashboard.test.js test/owner-dashboard-escape.test.js` → dashboard `# pass 2`, escape unchanged, `# fail 0`. If the escape test flags a line, fix the new markup, not the test. Full suite → **978 pass, 0 fail**.

- [ ] **Step 5: Serve check (no browser, no key in a URL).** No restart is needed for a static file, but confirm it is served fresh:
`ssh root@31.97.176.180 'curl -s http://127.0.0.1:4210/owner/century-mall | grep -c -E "loadTenantTg|loadPending|pending-deliv"'` → a number ≥ 4. The cards themselves are exercised through their API routes in Tasks 6 and 9; Ibrahim sees them when he next opens the dashboard.

- [ ] **Step 6: Commit** `public/owner.html test/messaging/dashboard.test.js`:

```
Owner dashboard: tenant Telegram card, invoices waiting to be delivered, and a Send result that is true

Settings gets "Tenant notices on Telegram": linked tenants out of active tenancies, the A4 poster, the start link,
and Remove per unit. Invoices gets "Waiting to be delivered" for invoices whose send did not reach the tenant, with
Send now (the same send route, using today's invoice). Send no longer mentions WhatsApp and tells sent (by which
channel), test mode and not delivered apart. Every value in the new cards is escaped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 11: Ops — record the three stuck invoices, the SMS status report, and the go-live script (not run)

**Files:**
- Create: `ops/messaging/backfill-pending-invoices.js`, `ops/messaging/sms-status.js`, `ops/messaging/sms-send-one.js`
- Test: `test/messaging/ops.test.js`

- [ ] **Step 1: Write the failing test** — `$L/test/messaging/ops.test.js`

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchPending } = require('../../ops/messaging/backfill-pending-invoices');
const { parseArgs } = require('../../ops/messaging/sms-send-one');

const D = s => new Date(s);
const inv = (id, unit, total, created) => ({ id, unit, total, createdAt: D(created), tenancyId: 't-' + id, userId: 'u-' + id });

test('an audit-only stuck send matches the one invoice with that unit and total, created before the send', () => {
  const invoices = [inv('i1', '211', 12500, '2026-07-15T20:00:00Z'), inv('i2', '11', 12500, '2026-07-15T20:00:00Z'), inv('i3', '211', 9000, '2026-07-15T20:00:00Z')];
  const r = matchPending([{ id: 'a1', detail: 'Demo Shop 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-09-10T08:00:00Z') }], invoices);
  assert.deepEqual(r.map(x => [x.auditId, x.reason, x.invoice && x.invoice.id]), [['a1', 'matched', 'i1']]);
});

test('two candidates are ambiguous; a different total or an invoice created after the send is no match', () => {
  const two = [inv('i1', '211', 12500, '2026-07-15T20:00:00Z'), inv('i2', '211', 12500, '2026-08-15T20:00:00Z')];
  assert.equal(matchPending([{ id: 'a', detail: ' 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-09-10T08:00:00Z') }], two)[0].reason, 'ambiguous');
  assert.equal(matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 13750, createdAt: D('2026-09-10T08:00:00Z') }], two)[0].reason, 'none');
  assert.equal(matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 12500, createdAt: D('2026-07-01T08:00:00Z') }], two)[0].reason, 'none');
});

test('unit 11 is not unit 211', () => {
  const r = matchPending([{ id: 'a', detail: 'Shop 211 (delivery pending — channel down)', amount: 100, createdAt: D('2026-09-10T08:00:00Z') }], [inv('i', '11', 100, '2026-07-15T20:00:00Z')]);
  assert.equal(r[0].reason, 'none');
});

test('the go-live script refuses to run without a number and the explicit approval flag', () => {
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(['--to', '0900000001']), null);
  assert.equal(parseArgs(['--approved-by-ibrahim']), null);
  assert.equal(parseArgs(['--to', '--approved-by-ibrahim']), null);
  assert.deepEqual(parseArgs(['--to', '0900000001', '--approved-by-ibrahim']), { to: '0900000001' });
});
```

- [ ] **Step 2: Copy up, run** → fails: `Cannot find module`.

- [ ] **Step 3: Implement** — `$L/ops/messaging/backfill-pending-invoices.js`

```js
'use strict';
// The invoices a dashboard 📤 Send could not deliver before messaging/delivery.js existed are only in the audit log
// ("INVOICE_SENT <shop> <unit> (delivery pending — channel down)"), which names the unit and the total, not the invoice.
// This matches each such row to exactly one invoice of that building (same unit number, same amount + late fee, created
// before the send) and records it as an undelivered OutboundMessage (source backfill-audit), so the dashboard's
// "Waiting to be delivered" list shows it with Send now. Nothing is sent. Dry run unless --apply. Prints counts only.
//
//   node ops/messaging/backfill-pending-invoices.js <slug> [--apply]
//   undo: delete OutboundMessage and OutboundBatch rows with source 'backfill-audit' for that building
function matchPending(auditRows, invoices) {
  return auditRows.map(a => {
    const head = String(a.detail || '').split(' (delivery pending')[0].trim();
    const hits = invoices.filter(i => (head === i.unit || head.endsWith(' ' + i.unit)) && i.total === a.amount && i.createdAt <= a.createdAt);
    return { auditId: a.id, at: a.createdAt, invoice: hits.length === 1 ? hits[0] : null, reason: hits.length === 1 ? 'matched' : hits.length ? 'ambiguous' : 'none' };
  });
}

async function main([slug, flag]) {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const apply = flag === '--apply';
    const b = slug && await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
    if (!b) throw new Error('usage: node ops/messaging/backfill-pending-invoices.js <slug> [--apply]');
    const audits = await p.auditLog.findMany({ where: { buildingId: b.id, action: 'INVOICE_SENT', detail: { contains: 'delivery pending' } }, orderBy: { createdAt: 'asc' } });
    const invoices = (await p.invoice.findMany({ where: { tenancy: { unit: { buildingId: b.id } } },
      select: { id: true, amount: true, lateFee: true, createdAt: true, tenancyId: true, tenancy: { select: { userId: true, unit: { select: { number: true } } } } } }))
      .map(i => ({ id: i.id, unit: i.tenancy.unit.number, total: i.amount + (i.lateFee || 0), createdAt: i.createdAt, tenancyId: i.tenancyId, userId: i.tenancy.userId }));
    const out = { auditRows: audits.length, matched: 0, ambiguous: 0, none: 0, alreadyRecorded: 0, written: 0, apply };
    for (const m of matchPending(audits, invoices)) {
      out[m.reason]++;
      if (!m.invoice) continue;
      if (await p.outboundMessage.findFirst({ where: { invoiceId: m.invoice.id, kind: 'invoice' }, select: { id: true } })) { out.alreadyRecorded++; continue; }
      if (!apply) continue;
      const batch = await p.outboundBatch.create({ data: { buildingId: b.id, kind: 'invoice', source: 'backfill-audit', actor: 'ops', total: 1, createdAt: m.at } });
      await p.outboundMessage.create({ data: { batchId: batch.id, buildingId: b.id, tenancyId: m.invoice.tenancyId, userId: m.invoice.userId, invoiceId: m.invoice.id,
        kind: 'invoice', channel: 'none', status: 'failed', errorKind: 'channel_down', createdAt: m.at } });
      out.written++;
    }
    console.log(JSON.stringify(out));
  } finally { await p.$disconnect(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { matchPending };
```

`$L/ops/messaging/sms-status.js`

```js
'use strict';
// Read-only: how SMS is set up. Mode, whether a provider token / shortcode / report secret exist (yes or no, never the
// values), each building's monthly limit and SMS parts this month with a cost estimate from the configured price tiers,
// this month's messages by channel and status, and with --balance the GeezSMS balance (numbers only). Sends nothing.
//   node ops/messaging/sms-status.js [--balance]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { makeSmsFromEnv, makeGeezSms, parsePriceTiers, smsUnitPrice } = require('../../messaging/sms');
const { addisMonthStart } = require('../../messaging/delivery');

(async () => {
  const p = new PrismaClient();
  try {
    const sms = makeSmsFromEnv(process.env);
    const tiers = parsePriceTiers(process.env.SMS_PRICE_TIERS);
    console.log('mode ' + sms.mode + ' · provider ' + (sms.provider || 'none') + ' · token ' + (process.env.SMS_API_TOKEN ? 'yes' : 'no')
      + ' · shortcode ' + (process.env.SMS_SHORTCODE_ID ? 'yes' : 'no (provider default)') + ' · report secret ' + ((process.env.SMS_CALLBACK_SECRET || '').length >= 24 ? 'yes' : 'no'));
    const since = addisMonthStart(new Date());
    const statuses = sms.mode === 'live' ? ['queued', 'sent', 'delivered'] : ['queued', 'sent', 'delivered', 'test'];
    const byBuilding = await p.outboundMessage.groupBy({ by: ['buildingId'], where: { channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } });
    const total = byBuilding.reduce((a, r) => a + (r._sum.smsParts || 0), 0);
    const price = smsUnitPrice(total, tiers);
    const used = new Map(byBuilding.map(r => [r.buildingId, r._sum.smsParts || 0]));
    // real buildings: NOTIFY_WHITELIST in server.js (today darulle only)
    for (const b of await p.building.findMany({ where: { qrSlug: { in: ['darulle'] } }, select: { id: true, qrSlug: true, smsMonthlyLimit: true, smsSender: true } }))
      console.log(b.qrSlug + ' · limit ' + b.smsMonthlyLimit + ' · parts this month ' + (used.get(b.id) || 0) + ' · sender ' + (b.smsSender ? 'set' : 'provider default'));
    console.log('all buildings · parts this month ' + total + ' · ' + price + ' ETB/SMS · estimate ' + (Math.round(total * price * 100) / 100) + ' ETB' + (sms.mode === 'test' ? ' (test rows, nothing was sent)' : ''));
    const month = await p.outboundMessage.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: true });
    console.log('this month · ' + (month.map(r => r.channel + '/' + r.status + ' ' + r._count).join(' · ') || 'no messages'));
    if (process.argv.includes('--balance')) {
      if (!process.env.SMS_API_TOKEN) console.log('balance · no token');
      else {
        const r = await makeGeezSms({ token: process.env.SMS_API_TOKEN }).balance();
        const nums = r.body && typeof r.body === 'object' ? Object.entries(r.body).filter(([, v]) => typeof v === 'number').map(([k, v]) => k + '=' + v) : [];
        console.log('balance · http ' + r.status + ' · ' + (nums.join(' ') || 'no numeric fields; field names: ' + Object.keys(r.body || {}).join(',')));
      }
    }
  } finally { await p.$disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
```

`$L/ops/messaging/sms-send-one.js`

```js
'use strict';
// GO-LIVE ONLY. NOT RUN IN PLAN A. One real SMS to one number, with Ibrahim's explicit permission for that number —
// the design's go-live step 2 (the account holds a 5-SMS test balance). Before running: Ibrahim has put SMS_API_TOKEN
// and SMS_MODE=live into .env; to keep the 04:00 UTC daily checks from texting Darulle tenants during the test, set
// Darulle's smsMonthlyLimit to 0 first and back afterwards.
//   node ops/messaging/sms-send-one.js --to <his number> --approved-by-ibrahim
// Goes through the delivery layer's transactional path (label "BinaSmart", recorded, text not stored). Prints the
// status and error kind only.
function parseArgs(argv) {
  const i = argv.indexOf('--to');
  const to = i >= 0 ? argv[i + 1] : null;
  if (!to || to.startsWith('--') || !argv.includes('--approved-by-ibrahim')) return null;
  return { to };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) { console.error('usage: node ops/messaging/sms-send-one.js --to <number> --approved-by-ibrahim'); process.exitCode = 2; return; }
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const { makeSmsFromEnv } = require('../../messaging/sms');
  const { makeDelivery, makeDeliveryStore } = require('../../messaging/delivery');
  const sms = makeSmsFromEnv(process.env, { log: m => console.log(m) });
  if (sms.mode !== 'live') { console.error('SMS is not live (SMS_MODE and SMS_API_TOKEN): nothing sent'); process.exitCode = 2; return; }
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  try {
    const d = makeDelivery({ store: makeDeliveryStore(p), sendTg: async () => false, sms });
    const r = await d.sendTransactionalSms({ to: args.to, text: 'SMS test from bina.et · የሙከራ መልእክት', label: 'BinaSmart', kind: 'test', source: 'go-live-test', live: true });
    console.log('status ' + r.status + (r.errorKind ? ' · ' + r.errorKind : ''));
  } finally { await p.$disconnect(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { parseArgs };
```

- [ ] **Step 4: Tests** — run `test/messaging/ops.test.js` → `# pass 4`. Full suite → **982 pass, 0 fail**.

- [ ] **Step 5: Run the backfill dry, then apply it** (writes only our own records; sends nothing):

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node ops/messaging/backfill-pending-invoices.js darulle'`
Expected: `{"auditRows":3,…,"written":0,"apply":false}` with `matched + ambiguous + none = 3`. If `matched` is 0, stop here and report the counts (nothing to record). Otherwise:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node ops/messaging/backfill-pending-invoices.js darulle --apply && node ops/messaging/backfill-pending-invoices.js darulle --apply'`
Expected: first run `written` = matched; second run `written 0`, `alreadyRecorded` = matched (idempotent).
Then read the list the dashboard will show (OWNER_KEY is read from `.env` inside the shell and never printed):
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && K=$(grep "^OWNER_KEY=" .env | cut -d= -f2- | tr -d "\"") && curl -s -H "x-owner-key: $K" http://127.0.0.1:4210/api/owner/darulle/pending-deliveries | node -e "let s=\"\";process.stdin.on(\"data\",c=>s+=c).on(\"end\",()=>{const j=JSON.parse(s);console.log(\"pending\",j.invoices.length,j.invoices.map(i=>i.reason).join(\",\"))})"'`
Expected: `pending <n> channel_down,…` where n ≤ matched (an invoice paid since then is left out). No unit numbers or names are printed.

- [ ] **Step 6: Status report** — `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node ops/messaging/sms-status.js'` (no `--balance`: there is no token). Expected first line `mode test · provider none · token no · shortcode no (provider default) · report secret no`; `darulle · limit 500 · parts this month <n> · sender provider default`; an estimate line; the channel/status line. Do **not** run `sms-send-one.js`.

- [ ] **Step 7: Commit** `ops/messaging/backfill-pending-invoices.js ops/messaging/sms-status.js ops/messaging/sms-send-one.js test/messaging/ops.test.js`:

```
Ops for tenant messages: the three stuck invoices recorded, an SMS status report, and the go-live script

backfill-pending-invoices.js matched the audit-only "delivery pending" sends of Darulle to their invoices (unit and
total, created before the send) and recorded them as undelivered, so "Waiting to be delivered" lists them with Send
now; it sends nothing and is idempotent. sms-status.js reports mode, whether a token exists, limits, parts used and a
cost estimate from the price tiers, read-only. sms-send-one.js is the go-live step for later — one SMS to Ibrahim's
own number with his explicit approval flag — and was not run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 12: Close out

- [ ] Full suite → **982 pass, 0 fail** (901 + 7 + 2 + 14 + 14 + 9 + 8 − 2 + 8 + 9 + 6 + 2 + 4; use the deltas if the baseline moved).
- [ ] `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && git status --short | grep -v "^??" | grep -v broadcast-am-fbcomment; git log --oneline -12'` → no unexpected modified files; eleven Plan A commits.
- [ ] `curl -s http://127.0.0.1:4210/health` ok; `pm2 logs binasmart-api --lines 200 --nostream | grep -E "\[sms\] mode|\[delivery\]|\[receipt\]|TypeError"` → only `[sms] mode test · no provider`.
- [ ] Report to the coordinator: commits; the §8 finding and fix (and that Darulle's August/September invoices were **not** created — the owner decides); the mark-paid path and the new already-paid refusal; tenant Telegram live (poster link per building), SMS in test mode with the label, the 500 default limit and price tiers; what Ibrahim needs to do for SMS (GeezSMS token into `.env`, keep `SMS_SHORTCODE_ID` unset until "BinaSmart" is approved, optional `SMS_CALLBACK_SECRET`, then the one-SMS go-live test with his permission); the open facts (2517 numbers, GeezSMS part counting, report payload, balance parameters).

---

## Risks and things the owner or Ibrahim should decide

- **Automatic messages once a tenant links.** Darulle has `notifyTenants` on. As soon as a tenant links Telegram, the 04:00 UTC daily checks may message them (contract renewal within 90 days, rent due within 5 days) — up to 8 per run. That is the existing switch; this plan does not change it. All 70 renewal notices for September are already audited, so the next renewal messages are due in October; due-date reminders follow the first October invoices. If the owner's own tap should be the first message, switch `notifyTenants` off for Darulle until then.
- **SMS go-live exposure.** With the 500-part default, switching `SMS_MODE=live` makes the same daily checks send SMS to Darulle tenants without Telegram. Follow the go-live order: Darulle limit 0 → one test SMS to Ibrahim → set the limit Ibrahim chooses.
- **Darulle's missing August and September invoices** are not generated by this plan. The dashboard's ⚡ Generate creates September only; August needs an explicit decision (Plan B's `create_invoices` takes a month). Two Darulle tenancies without a contract and with unit rent 0 get 0 ETB invoices (existing behaviour).
- **The pending list after a paid invoice** hides it, and the backfill matches by unit and total; an invoice whose late fee changed after the send is reported as `none` and not listed.
- **Removing a tenant link** clears that person's Telegram chat for every building (one chat per user); they can relink from the poster while their number matches.
- **Open GeezSMS facts:** Safaricom `2517…` numbers (treated as not reachable), part counting (estimated 70/160), delivery-report payload (the first one's field names are logged), balance request shape. None blocks Telegram delivery.

---

## Later plans (interfaces above are ready for them)

- **Plan B — owner actions in Bini (§3).** `prepare_*` tools store pending actions; the confirm card uses `delivery.plan()` (channel split, SMS parts, `remaining`, `costEtb`); confirm re-resolves recipients and calls `delivery.sendToTenants({ kind: 'notice' | 'reminder' | 'invoice' | 'receipt', source: 'owner-action', actor: <owner access id>, text })`, whose `batchId` goes into the audit row. `record_payment` reuses the logic of `POST /api/admin/invoices/:id/pay` (already refuses a second payment); `create_invoices` reuses `building/invoices.js` with a month. Quiet hours, the 2-bulk-sends-per-day limit and the `ownerActions` switch belong here.
- **Plan C — dashboard Messages tab (§4).** Reads `OutboundBatch`/`OutboundMessage` (by batch, drill-down by unit), the month's SMS parts against `smsMonthlyLimit` with the cost estimate, delivery-report statuses, the GeezSMS balance (as `ops/messaging/sms-status.js` does), and moves "Waiting to be delivered" into the tab; the Bini chat in the dashboard shows Plan B's cards.
- **Plan D — SMS one-time-code sign-in on bina.et** (for people without Telegram, and a better sign-in overall). better-auth (`auth.mjs`, `auth/telegram-plugin.mjs`, `auth/telegram-verify.js`, `auth/identity.js`) gains a phone OTP method: codes generated and hashed by our own code (never stored in clear, never in `OutboundBatch`), expiry, attempt limits, rate limits per phone and per IP, the same response whether or not the number has an account (no enumeration), sent with `delivery.sendTransactionalSms({ to, text, label: 'BinaSmart', kind: 'otp', source: 'sign-in' })` — which bypasses tenant batches, building limits and quiet hours but still records the attempt and respects `SMS_MODE`.

---

## Self-review (against the design and the brief)

- **§1.1 channel order** Telegram → SMS → none, never two channels (Task 4; fallback on the same row); WhatsApp not used (Task 6 removes it for tenants; owners/admins untouched, stated in Facts).
- **§1.2 SMS adapter** generic provider interface, GeezSMS implementation, `SMS_MODE=test` default, demo buildings always test, credentials only from env (Tasks 3, 4, 6); delivery-status route with a secret (Task 6); sender = provider default until approved, label required (Tasks 3, 4, 6).
- **§1.3 short links** random 72-bit token, 60 days, one invoice, noindex, rate-limited, neutral page; used in Telegram texts too; receipts (Tasks 5, 6).
- **§1.4 cost control** per-building monthly limit (default 500), counting per part, whole batch refused, price tiers as config with estimates (Tasks 2, 3, 4, 11).
- **§1.5 records** `OutboundBatch`/`OutboundMessage`, no phone numbers, notice text once per batch; all existing senders moved with switches unchanged (Tasks 2, 4, 6).
- **§1.6 stuck invoices** pending list + Send now, the three backfilled (Tasks 6, 10, 11).
- **§2 tenant Telegram** `/start tenant_<slug>`, identical proof, full E.164 in that building, 10-minute window, neutral reply, `/stop`, owner Remove, QR poster A4 Amharic + English, linked count, first SMS carries the link; the legacy unit-number route retired (Tasks 4, 7, 8, 9, 10).
- **§4 (part)** tenant Telegram card and pending list only; the Messages tab is Plan C.
- **§8** invoice gap found and fixed (Task 1); mark-paid path found, reused, guarded (Facts, Task 6); provider questions recorded as open facts.
- **Placeholders:** none — every code step has the full code; numbers the executor cannot know in advance (backfill counts) are given as relations to check.
- **Consistency:** `sendToTenants`, `plan`, `sendTransactionalSms({ label })`, `smsLabel`, `smsMonthlyLimit`, `smsSender`, `tenantTelegram`→`tenant`, `linkFromContact({ slug, … })`, `statsForBuilding`/`removeForBuilding` and the route paths are spelled the same in every task. All module and test code in this plan, and the patch scripts applied in order to copies of `server.js`, `schema.prisma`, `notify.js`, `binaBot.js`, `ride/index.js`, `access.js` and `owner.html` at `500df05`, were run with `node --test` before the plan was written: all new tests and the existing wiring, owner-routes, escape, owner Telegram, access, binaBot and notify tests passed.
