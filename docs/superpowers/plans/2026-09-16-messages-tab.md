# The Messages Tab in the Owner Dashboard Implementation Plan (Plan C — owner actions and messaging)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner opens a **Messages** tab and sees every message the building sent — by batch, and per unit inside a batch — what it cost in SMS against the month's limit, what is still waiting to be delivered, and what came of every action they confirmed in the Bini chat, long after that chat is closed.

**Architecture:** Four new read-only owner routes over the tables Plans A and B already fill. One new module, `messaging/messages-view.js`, holds both the Prisma queries (`makeMessagesStore`) and the shaping (`makeMessagesView`), exactly as `messaging/delivery.js` holds `makeDeliveryStore` beside `makeDelivery`; a second small module, `messaging/sms-balance.js`, reads the provider's balance behind a ten-minute cache so the token and the provider URL never leave the server; a third, `agents/owner/actions/history.js`, turns `OwnerAction` rows into a list that carries a role and a channel and never an id. `public/owner.html` gains one tab, built with string concatenation and `esc()`/`jsq()` like the Plan A cards beside it, and "📭 Waiting to be delivered" moves into it, leaving a one-line count behind on Invoices.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 (**no schema change** — one comment correction only), `node:test`, the tw-lite stylesheet already in `public/owner.html`.

**Design:** `docs/superpowers/specs/2026-09-15-owner-actions-messaging-design.md` — **§4 in full**, plus the part of **§3.3** that says every prepare, confirm, cancel, expiry and execution is "shown in the dashboard activity log".
**Builds on Plan A:** `docs/superpowers/plans/2026-09-15-tenant-delivery-telegram.md` — `OutboundBatch` / `OutboundMessage` / `InvoiceLink`, `messaging/delivery.js` (`plan()`, `sendToTenants`, `isRealMiss`, `addisMonthStart`, the monthly SMS parts count in which a `test` row never counts), `messaging/sms.js` (the GeezSMS adapter, the price tiers as configuration, `balance()`), the delivery-report route, `GET /api/owner/:slug/pending-deliveries` and the dashboard's "📭 Waiting to be delivered" list.
**Builds on Plan B:** `docs/superpowers/plans/2026-09-15-owner-actions-confirm.md` — the `OwnerAction` table and `result` JSON, `POST /api/owner/:slug/actions/:id/confirm|cancel`, `ops/owner/actions.js`.
**Not in this plan:** SMS one-time-code sign-in (Plan D); WhatsApp; tenants chatting with Bini about their own account; exporting a batch as CSV. See "Later plans" at the end.

---

## Conventions (every task)

- **Where the work happens.** Server `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart` (branch main), pm2 process `binasmart-api`, port 4210. Everything in this plan is read-only at runtime: no route added here writes a row, sends a message or calls a provider except the balance read, which is a GET to GeezSMS behind a cache.
- **The coordinator's machine runs Windows.** Use the **PowerShell** tool for `ssh`/`scp` (the Bash tool is broken there). PowerShell 5.1 **strips double quotes from ssh arguments**, so: single-quote the whole remote command, never put a `"` or a `|` inside it, and never put a heredoc, an apostrophe or Ethiopic text inside an `ssh` string. Anything with more than one command, a pipe or a quote goes into a tiny wrapper script:
  `scp $L/tmp/run.sh root@31.97.176.180:/tmp/run.sh` then `ssh root@31.97.176.180 'sh /tmp/run.sh'` then `ssh root@31.97.176.180 'rm -f /tmp/run.sh'`.
- **Code never travels through an ssh string.** Every file and every patch script in this plan is a fenced block inside **this document**. The plan is committed to the server first (Task 0), and each task slices its own blocks out of it with the slicer that already exists there, byte-exact, Ethiopic included — the same one that built Plans A and B:
  `python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md '### Task 3: …' 0 /tmp/t3_sms_balance.py`
  The slicer prints `blocks in section: [...]` first, so run it once with `-` as the output to see the block list and indexes, then again with a path. It refuses to overwrite an existing file. If `/tmp/extract_plan.py` is gone, Task 0 writes it back.
- **Patching existing files.** Back up first, with a name that says which task did it:
  `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && S=$(date +%Y%m%d-%H%M%S) && cp server.js server.js.bak-planC-t5-$S'` (`*.bak-*` is git-ignored). Then run the task's Python script with the repo root as its first argument: `python3 /tmp/t5_routes.py /var/www/connectcare/binasmart`. Every script refuses to run twice (it checks for its own marker) and exits without writing unless each anchor matches **exactly once**, so a moved line stops it rather than half-applying it.
- **TDD, `node:test`.** Baseline at `9bb1581`: **1110 tests, 1110 pass, 0 fail** (measured, ≈7 s). Each task states its delta. One file:
  `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/<path> 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
  Full suite: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`. Every task ends green.
- **Commits.** Message sliced out of the task into `/tmp/planC-msg.txt`, then `git add <files by name> && git commit -q -F /tmp/planC-msg.txt`. Never stage `broadcast-am-fbcomment.js` or `uploader.js`. Every message ends with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push; the coordinator pushes.
- **Public repo.** Fake numbers only (`0900000001`), fake names ("Demo Tower", "Demo Shop One"), no keys, tokens, chat ids, phone numbers or real names anywhere in code, tests or commit messages.
- **No test sends to live channels.** No step in this plan sends a Telegram message, an SMS, an owner card or an email. Every test uses doubles. The live checks in Tasks 5 and 10 are GETs against a **demo** building with a throwaway owner key that is deleted and verified gone in the same task. **Never** touch Darulle's data or switches: owner actions are ON for `darulle` as of 16 September 2026 and its rows are a real owner's. Nothing in this plan is switched on or off.
- **Restart** after any change to code the server loads (`server.js`, `messaging/*`, `agents/*`):
  `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health'` → `{"ok":true,…}`, then
  `ssh root@31.97.176.180 'tail -n 5 /root/.pm2/logs/binasmart-api-error.log'` → nothing timestamped after the restart.
  `public/owner.html` is a **static file served with max-age=0** — a change to it needs no restart and no `?v=` bump.
- **Everything that reaches the page is escaped.** New dashboard code is built by string concatenation (like `loadPending` and `loadTenantTg` beside it), every value passes `esc()`, every value inside an `onclick` passes `jsq()`, and no template literal is written into `innerHTML`. After every `public/owner.html` patch, extract the inline script and check it parses:
  `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && sh /tmp/check-owner-js.sh'` (Task 0 writes that script).
- **Data never leaves the server.** No route added here returns a phone number, a user id, a tenancy id, a provider id, an `OwnerAccess` id, a Telegram id, a pending action's id, `OwnerAction.args`, `.payload`, `.fingerprint` or `.cardText`. The only names on the page are unit numbers, which the Tenants tab already shows.

## Facts found while planning (16 September 2026, read-only)

- **The tables are almost empty, so the empty state is the state that ships.** Live counts: `OutboundBatch` **2**, `OutboundMessage` **2**, `OwnerAction` **0**, `InvoiceLink` (not read here). Both messages belong to Darulle, both are `kind: invoice`, `source: backfill-audit`, `actor: ops`, `channel: none`, `status: failed`, `errorKind: channel_down` — the two stuck invoices Plan A recorded. Every list in this tab must read well with nothing in it, and the live check in Task 10 is a check of the empty state.
- **`delivered` has never been stored, and may carry no reason when it fails.** `providerId` is null on every row: GeezSMS has never sent a delivery report. The report route (`server.js smsReport` → `delivery.applyDeliveryReport` → `store.markByProvider`) only ever does `updateMany({ where: { providerId: { in: ids }, channel: 'sms', status: { in: ['queued','sent'] } }, data: { status } })` with `status` `delivered` or `failed`. So: a report can only move a row we sent, it can never revive a row already `failed`, and **a report-driven failure writes no `errorKind`** — the drill-down shows a blank reason and the legend has to explain it. `delivered` will stay at zero until the provider is configured to call back.
- **`errorKind` has no fixed vocabulary.** `delivery.js` writes `no_contact`, `no_mobile`, `sms_unsupported_number`, `sms_limit`, `tg_failed`, `sms_refused`, `provider_error`, `too_long`, `empty`, `error`; the backfill wrote `channel_down`, which no running code produces. The page therefore renders the reason as escaped text, not as a lookup that could silently print nothing.
- **A not-reachable row is counted twice in the delivery counts.** `delivery.sendToTenants` tallies `counts[channel]++` and then, separately, `counts.failed++` for anything not delivered — so a `channel: 'none'` row lands in **both** `counts.none` and `counts.failed`. The action history has to subtract (`failed − none`) or the owner sees the same tenant twice. The per-batch counts in this plan avoid the problem differently: each row is put in exactly one presentation bucket.
- **`OutboundBatch.actor` can be an `OwnerAccess` id.** Plan B passes `who.actor` — the confirming approval's id, or the string `dashboard` — into `delivery.sendToTenants`. So `actor` is one of `dashboard`, `cron`, `ops` or a cuid that must never be returned. The routes map it to a role by reading `OwnerAccess` **scoped to this building** (`kind: 'building', entityId: buildingId`); anything that does not resolve becomes `unknown`, never the raw value.
- **`makeSms()` does not expose the provider's balance.** `messaging/sms.js` returns `{ send, supports, mode, provider }`; only the raw `makeGeezSms` object has `balance()`, and the only caller is `ops/messaging/sms-status.js --balance`, which builds a second provider from the token. A server route cannot reach it. Task 3 adds `balance` to what `makeSms` returns (a function when a provider is configured, `null` when there is none), which is also the honest signal for "only when a token is configured".
- **The GeezSMS balance payload is undocumented.** `makeGeezSms.balance()` returns `{ ok, status, body }`; `ops/messaging/sms-status.js` already copes by printing whichever fields are numbers. The reader in Task 3 does the same — first numeric field, or a string that is a plain number — and says `unavailable` when there is none, which is also what a refusal and a timeout produce.
- **The monthly limit counts `queued`, `sent`, `delivered` and never `test`.** `delivery.js COUNTED` is fixed at those three in every mode, so the dashboard must count the same three against `smsMonthlyLimit` and show test parts as a separate, clearly-labelled number. Counting test rows into the limit (as `ops/messaging/sms-status.js` does for its own display when the mode is test) would tell the owner a month is full when nothing was sent.
- **Every building's `smsMonthlyLimit` is 500** (all 29 buildings) and `smsSender` is unset everywhere, so every SMS goes out under the provider's default shortcode with the label `BinaSmart · <building>`.
- **The tier price is an account-wide estimate.** `smsUnitPrice(monthlyCount, tiers)` steps at 10,000 and 50,000 SMS **for the whole GeezSMS account**, not per building — `delivery.plan()` already chooses the tier from `smsPartsSinceAll`. The tab says "estimate · ግምት" for that reason.
- **Plan A pinned the call site of `loadPending()`.** `test/messaging/dashboard.test.js` asserts `/: ''\}`;\n    loadPending\(\);\n  \}/` — the Invoices tab ending with that call. Task 8 moves the list and **must update that test in the same commit**, keeping its intent: the pending list is loaded where it is rendered.
- **`test/owner-dashboard-escape.test.js` only scans template literals.** Its `leaves()` walks `${…}` interpolations, so code built by concatenation is invisible to it — which is why `test/messaging/dashboard.test.js` pins the Plan A cards value by value, and why this plan pins every new card the same way.
- **`parsePriceTiers(process.env.SMS_PRICE_TIERS)` is pinned as a literal** by `test/messaging/server-delivery.test.js`. The new wiring therefore adds its own `const smsTiers = …` rather than replacing that call.
- **The plan slicer survives from Plan B** at `/tmp/extract_plan.py` and is reproduced in Task 0 in case `/tmp` is cleared.

## Key interfaces this plan adds

```js
// messaging/messages-view.js
makeMessagesStore(prisma) → { countBatches, batches, counts, batch, countRows, rows, units, roles, oldestBatchAt, smsParts }
makeMessagesView({ store, now }) → {
  list({ buildingId, page, kind, month })   → { page, pages, total, kinds, months, kind, month, batches: [
                                                 { id, at, kind, source, by, total, counts } ] }
  one({ buildingId, batchId, page })        → { id, at, kind, source, by, text, total, counts, page, pages, rows: [
                                                 { unit, channel, status, present, reason, at } ] } | null
  smsMonth({ buildingId, limit, real, mode, tiers })
                                            → { mode, parts, testParts, limit, remaining, unitPriceEtb, costEtb }
}
// counts   { delivered, reached, queued, failed, notReachable, test, telegram, sms, none, total }  — buckets are exclusive
// present  'delivered' | 'reached' | 'queued' | 'failed' | 'notReachable' | 'test'
// by       'owner' | 'staff' | 'dashboard' | 'cron' | 'ops' | 'unknown'   — never an id

// messaging/sms-balance.js
makeSmsBalance({ provider, ttlMs, now, log }).read()
  → { state: 'off' } | { state: 'ok', value, at } | { state: 'unavailable', at }

// messaging/sms.js  (added)
makeSms(…)        → { send, supports, mode, provider, balance }      // balance is null when no provider is configured

// agents/owner/actions/history.js
makeActionHistory({ prisma, page }).list({ buildingId, page })
  → { page, pages, total, actions: [ { at, kind, status, channel, preparedBy, confirmedBy, confirmedAt, bulk, urgent,
        counts: { sent, test, failed, notReachable } | null, notReached, created, skipped, month, unit, totalEtb,
        reason, batchIds } ] }
```

## File structure

| File | Status | Responsibility |
|---|---|---|
| `messaging/messages-view.js` | create | the Messages tab's reads: the Prisma queries and the shaping of batches, a batch's rows and the SMS month |
| `test/messaging/messages-view.test.js` | create | the buckets, the counts, the labels, the month maths, paging, and what the store selects |
| `messaging/sms-balance.js` | create | the provider balance behind a ten-minute cache; never the token, the URL or the body |
| `test/messaging/sms-balance.test.js` | create | off / ok / unavailable, the cache, one in-flight call, nothing leaked |
| `messaging/sms.js` | modify | `balance` on what `makeSms` returns |
| `test/messaging/sms.test.js` | modify | `balance` exists only with a provider |
| `agents/owner/actions/history.js` | create | `OwnerAction` rows as a list with roles and counts and no ids |
| `test/owner/actions-history.test.js` | create | the shape, the double-counted not-reachable, the refusals, the `select` |
| `server.js` | modify | the four owner routes and their wiring |
| `test/messaging/server-messages.test.js` | create | the routes pinned by reading `server.js` |
| `public/owner.html` | modify | the Messages tab: the SMS card, the batch list and filters, the drill-down, the action history, the legend; "Waiting to be delivered" moved in; the Invoices count line; the Settings link |
| `test/messaging/messages-dashboard.test.js` | create | every new card, value by value |
| `test/messaging/dashboard.test.js` | modify | the moved pending list and the refreshed count line |
| `prisma/schema.prisma` | modify | the `OwnerAction` comment: `cardText` may hold an occupant name |
| `test/owner/actions-schema.test.js` | modify | that comment is pinned |
| `ops/messaging/sms-status.js` | modify | importable, plus one line of batch counts for this month |
| `test/messaging/ops.test.js` | modify | that line, and that requiring the script connects to nothing |

---

### Task 0: The plan is on the server, and the two helpers every task uses

Nothing in this plan travels through an `ssh` string. This task puts the plan where the slicer can read it and writes the two helper scripts the later tasks call by name.

**Files:**
- Create: `docs/superpowers/plans/2026-09-16-messages-tab.md` (this document — the coordinator has already copied and committed it; verify)
- Create: `/tmp/extract_plan.py`, `/tmp/check-owner-js.sh` (not in the repo)

- [ ] **Step 1: The plan is there and committed**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && git log --oneline -1 -- docs/superpowers/plans/2026-09-16-messages-tab.md'`
Expected: one commit line naming the plan. If it prints nothing, stop and ask the coordinator to copy it up.

- [ ] **Step 2: The slicer**

Run: `ssh root@31.97.176.180 'test -f /tmp/extract_plan.py && echo present || echo missing'`
Expected: `present`. If it says `missing`, write the file below to `$L/tmp/extract_plan.py` locally and `scp $L/tmp/extract_plan.py root@31.97.176.180:/tmp/extract_plan.py`:

```python
import io, re, sys, os
# usage: extract_plan.py PLAN "### Task N:" INDEX OUT  -> writes the INDEX-th fenced block of that task section
plan, head, idx, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
s = io.open(plan, encoding='utf-8').read()
start = s.index('\n' + head) + 1
nxt = s.find('\n### Task ', start + 1)
sec = s[start: nxt if nxt != -1 else len(s)]
blocks = []
lines = sec.split('\n')
i = 0
while i < len(lines):
    m = re.match(r'^(\s*)```(\w*)\s*$', lines[i])
    if m:
        ind = m.group(1); lang = m.group(2); body = []
        i += 1
        while not re.match(r'^' + ind + r'```\s*$', lines[i]):
            body.append(lines[i][len(ind):] if lines[i].startswith(ind) else lines[i])
            i += 1
        blocks.append((lang, '\n'.join(body) + '\n'))
    i += 1
print('blocks in section:', [(b[0], len(b[1])) for b in blocks])
if out != '-':
    d = os.path.dirname(out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    if os.path.exists(out):
        raise SystemExit('refusing to overwrite ' + out)
    io.open(out, 'w', encoding='utf-8', newline='\n').write(blocks[idx][1])
    print('wrote', out, len(blocks[idx][1]), 'chars, lang', blocks[idx][0])
```

- [ ] **Step 3: See the block list for this task** (the pattern every later task uses)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 0:" 0 -'`
Expected: `blocks in section: [('python', 1206), ('sh', 715), ('', 59), ('', 34)]`
**The index counts every fenced block in the section, expected-output blocks included** — that is why block 1 here is the shell script and not the first `Expected:` block. Always run the slicer with `-` first and read the list before slicing to a path; the lengths make each block easy to recognise.
(The double quotes here are inside a single-quoted ssh string and are consumed by the remote shell, not by PowerShell. If PowerShell eats them anyway, put the whole command in a wrapper script as the Conventions describe.)

- [ ] **Step 4: The inline-script checker**

Slice it out and put it in `/tmp`:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 0:" 1 /tmp/check-owner-js.sh'`

```sh
#!/bin/sh
# Pull the ONE inline <script> out of public/owner.html and let node parse it. A dashboard patch that leaves the
# script unparseable makes every tab blank with nothing in any log, so this runs after every owner.html change.
set -e
cd /var/www/connectcare/binasmart
python3 - <<'PY'
import io, re
s = io.open('public/owner.html', encoding='utf-8').read()
m = re.findall(r'<script>(.*?)</script>', s, re.S)
if len(m) != 1:
    raise SystemExit('expected exactly one inline script, found %d' % len(m))
io.open('/tmp/owner-inline.js', 'w', encoding='utf-8', newline='\n').write(m[0])
print('inline script %d chars' % len(m[0]))
PY
node --check /tmp/owner-inline.js && echo "owner.html inline script: parses"
```

- [ ] **Step 5: Run it now, on the unchanged page, so the baseline is known good**

Run: `ssh root@31.97.176.180 'sh /tmp/check-owner-js.sh'`
Expected:
```
inline script 51000 chars
owner.html inline script: parses
```
(the character count will differ; the last line is what matters)

- [ ] **Step 6: Baseline the suite**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1110
# pass 1110
# fail 0
```

- [ ] **Step 7: Nothing to commit.** This task writes no repo file. `git status --short` must show no change beyond untracked `*.bak-*` and the usual two ignored files.

---

### Task 1: One row, one bucket — the pure half of the Messages view

The tab's numbers have to add up: a tenant with no Telegram and no reachable mobile must appear once, not once as "not reachable" and again as "failed" (which is how `delivery.js` tallies internally). So every `OutboundMessage` row is put into exactly one presentation bucket, and everything that decides a bucket, a label, a month or a page is a pure function with no database and no clock of its own.

**Files:**
- Create: `messaging/messages-view.js`
- Create: `test/messaging/messages-view.test.js`

- [ ] **Step 1: Write the failing tests**

Slice block 0 of this task to `$L/test/messaging/messages-view.test.js` — on the server:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 1:" 0 test/messaging/messages-view.test.js'`

```js
'use strict';
// The Messages tab's arithmetic: one row in one bucket, a label that is never an id, and months in Addis time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf, monthList, pageOf, KINDS, PAGE, ROWS_PAGE } =
  require('../../messaging/messages-view');

test('every channel and status pair lands in exactly one bucket', () => {
  // channel none is always "not reachable", whatever the row's status says (delivery.js writes it as failed).
  assert.equal(presentOf('none', 'failed'), 'notReachable');
  assert.equal(presentOf('none', 'test'), 'notReachable');
  assert.equal(presentOf('sms', 'delivered'), 'delivered');
  assert.equal(presentOf('sms', 'sent'), 'reached');
  assert.equal(presentOf('telegram', 'sent'), 'reached');
  assert.equal(presentOf('sms', 'queued'), 'queued');
  assert.equal(presentOf('sms', 'test'), 'test');
  assert.equal(presentOf('telegram', 'failed'), 'failed');
  // A status nobody has written yet is a failure, not a silent gap.
  assert.equal(presentOf('sms', 'something-new'), 'failed');
});

test('the buckets add up to the total, and not reachable is not also counted as failed', () => {
  const c = countsOf([
    { channel: 'telegram', status: 'sent', count: 2 },
    { channel: 'sms', status: 'delivered', count: 40 },
    { channel: 'sms', status: 'sent', count: 20 },
    { channel: 'sms', status: 'queued', count: 1 },
    { channel: 'sms', status: 'failed', count: 1 },
    { channel: 'none', status: 'failed', count: 7 },
  ]);
  assert.equal(c.total, 71);
  assert.equal(c.delivered + c.reached + c.queued + c.failed + c.notReachable + c.test, c.total);
  assert.deepEqual([c.delivered, c.reached, c.queued, c.failed, c.notReachable, c.test], [40, 22, 1, 1, 7, 0]);
  assert.deepEqual([c.telegram, c.sms, c.none], [2, 62, 7]);
  assert.equal(countsOf([]).total, 0);
  assert.equal(countsOf(null).failed, 0);
});

test('who sent it is a role or a name, never an OwnerAccess id', () => {
  const roles = { ck_owner_1: 'owner', ck_staff_1: 'staff' };
  assert.equal(whoLabel('dashboard', roles), 'dashboard');
  assert.equal(whoLabel('cron', roles), 'cron');
  assert.equal(whoLabel('ops', roles), 'ops');
  assert.equal(whoLabel('ck_owner_1', roles), 'owner');
  assert.equal(whoLabel('ck_staff_1', roles), 'staff');
  // Unknown ids, a revoked approval, another building's approval, null: all the same neutral word.
  assert.equal(whoLabel('ck_someone_else', roles), 'unknown');
  assert.equal(whoLabel('ck_someone_else', {}), 'unknown');
  assert.equal(whoLabel(null, roles), 'unknown');
  assert.equal(whoLabel('', roles), 'unknown');
  for (const v of ['ck_someone_else', 'ck_owner_1']) assert.equal(whoLabel(v, roles).includes(v), false);
});

test('a month is the Addis month, and junk is refused rather than guessed', () => {
  const r = addisMonthRange('2026-09');
  // Addis is UTC+3 with no daylight saving: the month starts at 21:00 the previous day, UTC.
  assert.equal(r.from.toISOString(), '2026-08-31T21:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(addisMonthRange('2026-12').to.toISOString(), '2026-12-31T21:00:00.000Z');
  for (const bad of ['', null, '2026-13', '2026-00', '2026-9', 'all', '2026-09-01']) assert.equal(addisMonthRange(bad), null, String(bad));
  // A batch written at 22:00 UTC on 31 August belongs to September in Addis.
  assert.equal(addisMonthOf(new Date('2026-08-31T22:00:00Z')), '2026-09');
  assert.equal(addisMonthOf(new Date('2026-08-31T20:00:00Z')), '2026-08');
});

test('the month list runs back to the oldest batch, newest first and capped, and paging never falls off the end', () => {
  const now = new Date('2026-09-16T09:00:00Z');
  assert.deepEqual(monthList(new Date('2026-07-04T09:00:00Z'), now), ['2026-09', '2026-08', '2026-07']);
  assert.deepEqual(monthList(null, now), ['2026-09']);
  assert.deepEqual(monthList(new Date('2025-11-04T09:00:00Z'), now).slice(0, 3), ['2026-09', '2026-08', '2026-07']);
  assert.equal(monthList(new Date('2010-01-01T00:00:00Z'), now).length, 24);
  // The year rolls over correctly.
  assert.deepEqual(monthList(new Date('2025-12-04T09:00:00Z'), new Date('2026-01-16T09:00:00Z')), ['2026-01', '2025-12']);
  assert.equal(pageOf(0, 0, PAGE), 0);
  assert.equal(pageOf(5, 41, PAGE), 2);
  assert.equal(pageOf(-3, 41, PAGE), 0);
  assert.equal(pageOf('1', 41, PAGE), 1);
  assert.equal(pageOf('nonsense', 41, PAGE), 0);
  assert.deepEqual(KINDS, ['notice', 'reminder', 'invoice', 'receipt']);
  assert.equal(PAGE, 20);
  assert.equal(ROWS_PAGE, 100);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-view.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"'`
Expected: `Cannot find module '../../messaging/messages-view'` and `# fail 1`.

- [ ] **Step 3: Write the module**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 1:" 1 messaging/messages-view.js'`

```js
'use strict';
// What the owner's Messages tab reads (owner actions and messaging design §4). Read only: nothing here writes, sends,
// or calls a provider. Task 2 adds the store and the view on top of these; this half has no database and no clock.
//
// ONE ROW, ONE BUCKET. delivery.js tallies a not-reachable recipient in BOTH counts.none and counts.failed, which is
// right for its own "did everything go?" question and wrong for a list the owner reads: the same tenant would be
// counted twice. Here every OutboundMessage row is put in exactly one bucket, so a batch's numbers add up to its total.
//
//   delivered     the SMS operator's delivery report said so           (status delivered)
//   reached       Telegram accepted it, or the SMS provider did        (status sent)
//   queued        the provider took it but the record write after it failed — it may have gone, so it is never
//                 offered for sending again                            (status queued)
//   failed        it did not go                                        (status failed, on a telegram or sms row)
//   notReachable  no Telegram link and no mobile the provider can reach (channel none)
//   test          recorded only; nothing left the server               (status test)
//
// No phone number, no user id, no provider id and no tenancy id passes through this module. The only tenant-identifying
// thing it yields is a unit number, which the Tenants tab already shows.

const KINDS = ['notice', 'reminder', 'invoice', 'receipt'];   // OutboundBatch.kind for a tenant message; otp is not a building's
const PAGE = 20;            // batches per page (design §4: newest first, 20 per page)
const ROWS_PAGE = 100;      // recipients per page inside one batch
const MAX_MONTHS = 24;      // how far the month filter goes back
// What uses up a building's monthly SMS limit. Fixed at these three in every mode — messaging/delivery.js COUNTED.
const COUNTED = ['queued', 'sent', 'delivered'];
// Batch actors that are not an OwnerAccess id (server.js, building/invoice-ops.js, the daily checks, the ops scripts).
const FIXED_ACTORS = ['dashboard', 'cron', 'ops'];
const ADDIS_MS = 3 * 3600000;   // UTC+3, no daylight saving

function presentOf(channel, status) {
  if (channel === 'none') return 'notReachable';
  if (status === 'delivered') return 'delivered';
  if (status === 'sent') return 'reached';
  if (status === 'queued') return 'queued';
  if (status === 'test') return 'test';
  return 'failed';
}

const zeroCounts = () => ({ delivered: 0, reached: 0, queued: 0, failed: 0, notReachable: 0, test: 0,
  telegram: 0, sms: 0, none: 0, total: 0 });

// rows: [{ channel, status, count }] — a groupBy result, already flattened.
function countsOf(rows) {
  const c = zeroCounts();
  for (const r of rows || []) {
    const n = Number(r && r.count) || 0;
    c[presentOf(r.channel, r.status)] += n;
    if (r.channel === 'telegram' || r.channel === 'sms' || r.channel === 'none') c[r.channel] += n;
    c.total += n;
  }
  return c;
}

// An OutboundBatch.actor or an OwnerAction.confirmedBy as a word the owner can read. An OwnerAccess id that does not
// resolve — revoked, another building's, or simply unknown — becomes 'unknown'. The id itself is never returned.
function whoLabel(actor, roleById) {
  const a = String(actor == null ? '' : actor);
  if (!a) return 'unknown';
  if (FIXED_ACTORS.includes(a)) return a;
  const role = (roleById || {})[a];
  return role === 'owner' || role === 'staff' ? role : 'unknown';
}

// 'YYYY-MM' → the half-open range of that calendar month in Addis Ababa, or null. Nothing is guessed: a malformed
// month means no filter at all, not "this month".
function addisMonthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym == null ? '' : ym));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { from: new Date(Date.UTC(y, mo - 1, 1) - ADDIS_MS), to: new Date(Date.UTC(y, mo, 1) - ADDIS_MS) };
}
const addisMonthOf = d => new Date(new Date(d).getTime() + ADDIS_MS).toISOString().slice(0, 7);

// The months the filter offers: this Addis month back to the oldest batch, newest first, capped.
function monthList(oldest, now, max = MAX_MONTHS) {
  const first = oldest ? addisMonthOf(oldest) : addisMonthOf(now);
  const out = [];
  let cur = addisMonthOf(now);
  while (out.length < max) {
    out.push(cur);
    if (cur <= first) break;
    const [y, m] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  }
  return out;
}

// A page number that always exists: never negative, never past the last page, never NaN.
function pageOf(n, total, size) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size));
  return Math.min(Math.max(0, Math.floor(Number(n) || 0)), pages - 1);
}

module.exports = { presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf, monthList, pageOf, zeroCounts,
  KINDS, PAGE, ROWS_PAGE, MAX_MONTHS, COUNTED, FIXED_ACTORS };
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-view.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 5
# fail 0
```

- [ ] **Step 5: Full suite** (+5)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1115
# pass 1115
# fail 0
```

- [ ] **Step 6: Commit**

Slice block 2 to `/tmp/planC-msg.txt`, then commit:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 1:" 4 /tmp/planC-msg.txt && git add messaging/messages-view.js test/messaging/messages-view.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Messages view: one row, one bucket, and a sender that is a role and not an id

The owner's Messages tab has to show numbers that add up. The delivery layer counts a tenant it could not reach both as
"none" and as "failed", which is right for its own question and wrong for a list: the same unit would appear twice. So
every message row is put in exactly one bucket — delivered, sent, queued, failed, not reachable, test — and a batch's
buckets sum to its total.

The batch actor can be an owner approval id, so it is turned into a role: owner, staff, dashboard, automatic, ops, or
unknown. An id never comes out. Months are Addis months, a malformed one filters nothing rather than quietly meaning
this month, and a page number can never fall off either end.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 2: The queries and the view over them

The store holds every Prisma call the tab makes; the view turns them into the three answers the routes return. Both are tested with doubles, so what the store asks the database for is pinned as data — including that it never selects a phone, a user id or a provider id.

**Files:**
- Modify: `messaging/messages-view.js` (the whole file is rewritten; the pure half from Task 1 is unchanged inside it)
- Modify: `test/messaging/messages-view.test.js` (the five Task 1 tests stay; six are added)

- [ ] **Step 1: Write the failing tests**

Append block 0 to the test file:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 2:" 0 /tmp/t2_tests.js && cat /tmp/t2_tests.js >> test/messaging/messages-view.test.js && rm -f /tmp/t2_tests.js'`

```js

// ===== Task 2: the store and the view =====
const { makeMessagesStore, makeMessagesView } = require('../../messaging/messages-view');

const D = s => new Date(s);
// A store double that records every call and answers from fixed rows.
function fakeStore(over = {}) {
  const calls = [];
  const base = {
    countBatches: async w => { calls.push(['countBatches', w]); return 3; },
    batches: async (w, skip, take) => { calls.push(['batches', w, skip, take]); return [
      { id: 'b1', createdAt: D('2026-09-16T06:00:00Z'), kind: 'notice', source: 'owner-action', actor: 'ck_owner_1', total: 3 },
      { id: 'b2', createdAt: D('2026-09-15T06:00:00Z'), kind: 'invoice', source: 'dashboard-send', actor: 'dashboard', total: 1 },
    ]; },
    counts: async ids => { calls.push(['counts', ids]); return [
      { batchId: 'b1', channel: 'sms', status: 'sent', _count: 2 },
      { batchId: 'b1', channel: 'none', status: 'failed', _count: 1 },
      { batchId: 'b2', channel: 'telegram', status: 'sent', _count: 1 },
    ]; },
    batch: async (buildingId, id) => { calls.push(['batch', buildingId, id]); return id === 'b1'
      ? { id: 'b1', createdAt: D('2026-09-16T06:00:00Z'), kind: 'notice', source: 'owner-action', actor: 'ck_owner_1', total: 3, text: 'ነገ ውሃ ይቋረጣል' }
      : null; },
    countRows: async id => { calls.push(['countRows', id]); return 3; },
    rows: async (id, skip, take) => { calls.push(['rows', id, skip, take]); return [
      { tenancyId: 't1', channel: 'sms', status: 'sent', errorKind: null, createdAt: D('2026-09-16T06:00:01Z') },
      { tenancyId: 't2', channel: 'none', status: 'failed', errorKind: 'no_mobile', createdAt: D('2026-09-16T06:00:02Z') },
      { tenancyId: null, channel: 'sms', status: 'failed', errorKind: null, createdAt: D('2026-09-16T06:00:03Z') },
    ]; },
    units: async (ids, buildingId) => { calls.push(['units', ids, buildingId]); return [
      { id: 't1', unit: { number: '211' } }, { id: 't2', unit: { number: 'G-3' } }]; },
    roles: async (ids, buildingId) => { calls.push(['roles', ids, buildingId]); return [{ id: 'ck_owner_1', role: 'owner' }]; },
    oldestBatchAt: async b => { calls.push(['oldestBatchAt', b]); return D('2026-08-02T06:00:00Z'); },
    smsParts: async w => { calls.push(['smsParts', w]); return w.buildingId ? (w.status === 'test' ? 4 : 120) : 9000; },
  };
  return { store: Object.assign(base, over), calls };
}

test('the batch list is this building only, newest first, twenty to a page, with the filters it was given', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') })
    .list({ buildingId: 'bld1', page: 0, kind: 'notice', month: '2026-09' });
  const where = calls.find(c => c[0] === 'countBatches')[1];
  assert.deepEqual(where, { buildingId: 'bld1', kind: 'notice', createdAt: { gte: D('2026-08-31T21:00:00Z'), lt: D('2026-09-30T21:00:00Z') } });
  assert.deepEqual(calls.find(c => c[0] === 'batches').slice(2), [0, 20]);
  assert.deepEqual(d.months, ['2026-09', '2026-08']);
  assert.deepEqual(d.kinds, ['notice', 'reminder', 'invoice', 'receipt']);
  assert.deepEqual([d.page, d.pages, d.total, d.kind, d.month], [0, 1, 3, 'notice', '2026-09']);
  assert.deepEqual(d.batches.map(b => [b.id, b.kind, b.by, b.total]), [['b1', 'notice', 'owner', 3], ['b2', 'invoice', 'dashboard', 1]]);
  assert.deepEqual([d.batches[0].counts.reached, d.batches[0].counts.notReachable, d.batches[0].counts.total], [2, 1, 3]);
  assert.equal(d.batches[0].at, '2026-09-16T06:00:00.000Z');
});

test('a kind or a month that is not one of ours filters nothing, and only real access ids are looked up', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') })
    .list({ buildingId: 'bld1', page: 99, kind: 'otp', month: 'all' });
  assert.deepEqual(calls.find(c => c[0] === 'countBatches')[1], { buildingId: 'bld1' });
  assert.deepEqual([d.kind, d.month, d.page], ['', '', 0]);
  // 'dashboard' is not an id and is never asked about; the cuid is, scoped to the building.
  assert.deepEqual(calls.find(c => c[0] === 'roles').slice(1), [['ck_owner_1'], 'bld1']);
});

test('a batch of another building is not found, not refused', async () => {
  const { store } = fakeStore();
  const v = makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') });
  assert.equal(await v.one({ buildingId: 'bld1', batchId: 'b2' }), null);
  assert.equal(await v.one({ buildingId: 'bld1', batchId: '' }), null);
});

test('a batch drill-down names units and nothing else about a tenant', async () => {
  const { store, calls } = fakeStore();
  const d = await makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') }).one({ buildingId: 'bld1', batchId: 'b1' });
  assert.deepEqual(d.rows.map(r => [r.unit, r.channel, r.present, r.reason]), [
    ['211', 'sms', 'reached', null],
    ['G-3', 'none', 'notReachable', 'no_mobile'],
    ['—', 'sms', 'failed', null],           // a report-driven failure carries no reason
  ]);
  assert.equal(d.text, 'ነገ ውሃ ይቋረጣል');
  assert.equal(d.by, 'owner');
  assert.deepEqual([d.page, d.pages, d.total], [0, 1, 3]);
  // The unit lookup is scoped to the building, so a tenancy id from elsewhere resolves to nothing.
  assert.deepEqual(calls.find(c => c[0] === 'units').slice(1), [['t1', 't2'], 'bld1']);
  const json = JSON.stringify(d);
  for (const leak of ['tenancyId', 't1', 'userId', 'providerId', 'phone']) assert.equal(json.includes(leak), false, leak);
});

test('only an invoice or receipt batch hides its text; the month is this month in Addis and test parts are separate', async () => {
  const { store } = fakeStore({ batch: async () => ({ id: 'b2', createdAt: D('2026-09-15T06:00:00Z'), kind: 'invoice',
    source: 'dashboard-send', actor: 'dashboard', total: 1, text: null }) });
  const v = makeMessagesView({ store, now: () => D('2026-09-16T09:00:00Z') });
  assert.equal((await v.one({ buildingId: 'bld1', batchId: 'b2' })).text, '');
  const m = await v.smsMonth({ buildingId: 'bld1', limit: 500, real: true, mode: 'live', tiers: [[10000, 0.7475], [null, 0.2875]] });
  assert.deepEqual([m.mode, m.parts, m.testParts, m.limit, m.remaining], ['live', 120, 4, 500, 380]);
  assert.equal(m.unitPriceEtb, 0.7475);           // the tier comes from the whole account's 9,000 parts this month
  assert.equal(m.costEtb, Math.round(120 * 0.7475 * 100) / 100);
  // A building that is not real is in test mode whatever the provider says, exactly as delivery.plan() decides it.
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: 500, real: false, mode: 'live', tiers: [[null, 1]] })).mode, 'test');
  assert.equal((await v.smsMonth({ buildingId: 'bld1', limit: null, real: true, mode: 'test', tiers: [[null, 1]] })).limit, 0);
});

test('the store selects counts, units and dates — never a phone, a user id or a provider id', async () => {
  const seen = [];
  const rec = name => async a => { seen.push([name, a]); return name === 'aggregate' ? { _sum: { smsParts: 7 } } : []; };
  const prisma = {
    outboundBatch: { count: rec('batch.count'), findMany: rec('batch.findMany'), findFirst: rec('batch.findFirst') },
    outboundMessage: { groupBy: rec('message.groupBy'), count: rec('message.count'), findMany: rec('message.findMany'), aggregate: rec('aggregate') },
    tenancy: { findMany: rec('tenancy.findMany') },
    ownerAccess: { findMany: rec('access.findMany') },
  };
  const s = makeMessagesStore(prisma);
  await s.countBatches({ buildingId: 'b' }); await s.batches({ buildingId: 'b' }, 0, 20);
  await s.counts(['x']); await s.batch('b', 'x'); await s.countRows('x'); await s.rows('x', 0, 100);
  await s.units(['t'], 'b'); await s.roles(['a'], 'b'); await s.oldestBatchAt('b');
  assert.equal(await s.smsParts({ buildingId: 'b' }), 7);
  const json = JSON.stringify(seen);
  for (const leak of ['phone', 'userId', 'providerId', 'telegramChatId', 'smsText', 'phoneE164', 'phoneKey'])
    assert.equal(json.includes(leak), false, leak);
  // The drill-down row selection, and the two ownership scopes.
  assert.deepEqual(Object.keys(seen.find(x => x[0] === 'message.findMany')[1].select).sort(),
    ['channel', 'createdAt', 'errorKind', 'status', 'tenancyId']);
  assert.deepEqual(seen.find(x => x[0] === 'tenancy.findMany')[1].where, { id: { in: ['t'] }, unit: { buildingId: 'b' } });
  assert.deepEqual(seen.find(x => x[0] === 'access.findMany')[1].where, { id: { in: ['a'] }, kind: 'building', entityId: 'b' });
  assert.deepEqual(seen.find(x => x[0] === 'batch.findFirst')[1].where, { id: 'x', buildingId: 'b' });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-view.test.js 2>&1 | grep -E "^# (pass|fail)|makeMessagesView is not"'`
Expected: `# pass 5`, `# fail 6`, with `makeMessagesView is not a function`.

- [ ] **Step 3: Rewrite the module**

The slicer refuses to overwrite, so remove the file first (git has it):
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f messaging/messages-view.js && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 2:" 1 messaging/messages-view.js'`

```js
'use strict';
// What the owner's Messages tab reads (owner actions and messaging design §4). Read only: nothing here writes, sends,
// or calls a provider.
//
// ONE ROW, ONE BUCKET. delivery.js tallies a not-reachable recipient in BOTH counts.none and counts.failed, which is
// right for its own "did everything go?" question and wrong for a list the owner reads: the same tenant would be
// counted twice. Here every OutboundMessage row is put in exactly one bucket, so a batch's numbers add up to its total.
//
//   delivered     the SMS operator's delivery report said so           (status delivered)
//   reached       Telegram accepted it, or the SMS provider did        (status sent)
//   queued        the provider took it but the record write after it failed — it may have gone, so it is never
//                 offered for sending again                            (status queued)
//   failed        it did not go                                        (status failed, on a telegram or sms row)
//   notReachable  no Telegram link and no mobile the provider can reach (channel none)
//   test          recorded only; nothing left the server               (status test)
//
// No phone number, no user id, no provider id and no tenancy id passes through this module. The only tenant-identifying
// thing it yields is a unit number, which the Tenants tab already shows.
//
//   makeMessagesStore(prisma)                                 every query the tab makes, and nothing else
//   makeMessagesView({ store, now }).list({ buildingId, page, kind, month })   batches, newest first
//                                   .one({ buildingId, batchId, page })        one batch, by unit
//                                   .smsMonth({ buildingId, limit, real, mode, tiers })
const { addisMonthStart } = require('./delivery');
const { smsUnitPrice } = require('./sms');

const KINDS = ['notice', 'reminder', 'invoice', 'receipt'];   // OutboundBatch.kind for a tenant message; otp is not a building's
const PAGE = 20;            // batches per page (design §4: newest first, 20 per page)
const ROWS_PAGE = 100;      // recipients per page inside one batch
const MAX_MONTHS = 24;      // how far the month filter goes back
// What uses up a building's monthly SMS limit. Fixed at these three in every mode — messaging/delivery.js COUNTED.
const COUNTED = ['queued', 'sent', 'delivered'];
// Batch actors that are not an OwnerAccess id (server.js, building/invoice-ops.js, the daily checks, the ops scripts).
const FIXED_ACTORS = ['dashboard', 'cron', 'ops'];
const ADDIS_MS = 3 * 3600000;   // UTC+3, no daylight saving

function presentOf(channel, status) {
  if (channel === 'none') return 'notReachable';
  if (status === 'delivered') return 'delivered';
  if (status === 'sent') return 'reached';
  if (status === 'queued') return 'queued';
  if (status === 'test') return 'test';
  return 'failed';
}

const zeroCounts = () => ({ delivered: 0, reached: 0, queued: 0, failed: 0, notReachable: 0, test: 0,
  telegram: 0, sms: 0, none: 0, total: 0 });

// rows: [{ channel, status, count }] — a groupBy result, already flattened.
function countsOf(rows) {
  const c = zeroCounts();
  for (const r of rows || []) {
    const n = Number(r && r.count) || 0;
    c[presentOf(r.channel, r.status)] += n;
    if (r.channel === 'telegram' || r.channel === 'sms' || r.channel === 'none') c[r.channel] += n;
    c.total += n;
  }
  return c;
}

// An OutboundBatch.actor or an OwnerAction.confirmedBy as a word the owner can read. An OwnerAccess id that does not
// resolve — revoked, another building's, or simply unknown — becomes 'unknown'. The id itself is never returned.
function whoLabel(actor, roleById) {
  const a = String(actor == null ? '' : actor);
  if (!a) return 'unknown';
  if (FIXED_ACTORS.includes(a)) return a;
  const role = (roleById || {})[a];
  return role === 'owner' || role === 'staff' ? role : 'unknown';
}

// 'YYYY-MM' → the half-open range of that calendar month in Addis Ababa, or null. Nothing is guessed: a malformed
// month means no filter at all, not "this month".
function addisMonthRange(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym == null ? '' : ym));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { from: new Date(Date.UTC(y, mo - 1, 1) - ADDIS_MS), to: new Date(Date.UTC(y, mo, 1) - ADDIS_MS) };
}
const addisMonthOf = d => new Date(new Date(d).getTime() + ADDIS_MS).toISOString().slice(0, 7);

// The months the filter offers: this Addis month back to the oldest batch, newest first, capped.
function monthList(oldest, now, max = MAX_MONTHS) {
  const first = oldest ? addisMonthOf(oldest) : addisMonthOf(now);
  const out = [];
  let cur = addisMonthOf(now);
  while (out.length < max) {
    out.push(cur);
    if (cur <= first) break;
    const [y, m] = cur.split('-').map(Number);
    cur = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  }
  return out;
}

// A page number that always exists: never negative, never past the last page, never NaN.
function pageOf(n, total, size) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / size));
  return Math.min(Math.max(0, Math.floor(Number(n) || 0)), pages - 1);
}

// Every database call the tab makes. Each one names its columns: there is no `include`, so a column added to
// OutboundMessage or Tenancy later cannot appear in an owner's browser by accident.
function makeMessagesStore(prisma) {
  return {
    countBatches: where => prisma.outboundBatch.count({ where }),
    batches: (where, skip, take) => prisma.outboundBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take,
      select: { id: true, createdAt: true, kind: true, source: true, actor: true, total: true } }),
    counts: batchIds => prisma.outboundMessage.groupBy({ by: ['batchId', 'channel', 'status'],
      where: { batchId: { in: batchIds } }, _count: true }),
    // findFirst with the building in the where: a batch id from another building is simply not found.
    batch: (buildingId, id) => prisma.outboundBatch.findFirst({ where: { id, buildingId },
      select: { id: true, createdAt: true, kind: true, source: true, actor: true, total: true, text: true } }),
    countRows: batchId => prisma.outboundMessage.count({ where: { batchId } }),
    rows: (batchId, skip, take) => prisma.outboundMessage.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' },
      skip, take, select: { tenancyId: true, channel: true, status: true, errorKind: true, createdAt: true } }),
    units: (tenancyIds, buildingId) => prisma.tenancy.findMany({ where: { id: { in: tenancyIds }, unit: { buildingId } },
      select: { id: true, unit: { select: { number: true } } } }),
    roles: (ids, buildingId) => prisma.ownerAccess.findMany({ where: { id: { in: ids }, kind: 'building', entityId: buildingId },
      select: { id: true, role: true } }),
    oldestBatchAt: async buildingId => {
      const r = await prisma.outboundBatch.findFirst({ where: { buildingId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      return r ? r.createdAt : null;
    },
    smsParts: async where => (await prisma.outboundMessage.aggregate({ where, _sum: { smsParts: true } }))._sum.smsParts || 0,
  };
}

function makeMessagesView({ store, now = () => new Date() }) {
  const idsToAsk = actors => [...new Set(actors.filter(a => a && !FIXED_ACTORS.includes(a)))];
  const byId = rows => Object.fromEntries((rows || []).map(r => [r.id, r.role]));

  async function list({ buildingId, page = 0, kind = '', month = '' } = {}) {
    const where = { buildingId };
    if (KINDS.includes(kind)) where.kind = kind;
    const range = addisMonthRange(month);
    if (range) where.createdAt = { gte: range.from, lt: range.to };

    const total = await store.countBatches(where);
    const p = pageOf(page, total, PAGE);
    const rows = total ? await store.batches(where, p * PAGE, PAGE) : [];
    const ask = idsToAsk(rows.map(b => b.actor));
    const [grouped, roleRows, oldest] = await Promise.all([
      rows.length ? store.counts(rows.map(b => b.id)) : [],
      ask.length ? store.roles(ask, buildingId) : [],
      store.oldestBatchAt(buildingId),
    ]);
    const roleById = byId(roleRows);
    const per = new Map(rows.map(b => [b.id, []]));
    for (const g of grouped || []) if (per.has(g.batchId)) per.get(g.batchId).push({ channel: g.channel, status: g.status, count: g._count });

    return { page: p, pages: Math.max(1, Math.ceil(total / PAGE)), total, kinds: KINDS, months: monthList(oldest, now()),
      kind: KINDS.includes(kind) ? kind : '', month: range ? String(month) : '',
      batches: rows.map(b => ({ id: b.id, at: b.createdAt.toISOString(), kind: b.kind, source: b.source,
        by: whoLabel(b.actor, roleById), total: b.total, counts: countsOf(per.get(b.id) || []) })) };
  }

  async function one({ buildingId, batchId, page = 0 } = {}) {
    const id = String(batchId == null ? '' : batchId);
    if (!id) return null;
    const b = await store.batch(buildingId, id);
    if (!b) return null;
    const total = await store.countRows(b.id);
    const p = pageOf(page, total, ROWS_PAGE);
    const rows = total ? await store.rows(b.id, p * ROWS_PAGE, ROWS_PAGE) : [];
    const tenancyIds = [...new Set(rows.map(r => r.tenancyId).filter(Boolean))];
    const ask = idsToAsk([b.actor]);
    const [unitRows, grouped, roleRows] = await Promise.all([
      tenancyIds.length ? store.units(tenancyIds, buildingId) : [],
      store.counts([b.id]),
      ask.length ? store.roles(ask, buildingId) : [],
    ]);
    const unitOf = Object.fromEntries((unitRows || []).map(u => [u.id, u.unit.number]));
    return { id: b.id, at: b.createdAt.toISOString(), kind: b.kind, source: b.source, by: whoLabel(b.actor, byId(roleRows)),
      // A notice's text is the owner's own words and is kept once on the batch; an invoice or receipt has none.
      text: b.kind === 'notice' ? String(b.text || '') : '',
      total: b.total, counts: countsOf((grouped || []).map(g => ({ channel: g.channel, status: g.status, count: g._count }))),
      page: p, pages: Math.max(1, Math.ceil(total / ROWS_PAGE)),
      rows: rows.map(r => ({ unit: unitOf[r.tenancyId] || '—', channel: r.channel, status: r.status,
        present: presentOf(r.channel, r.status), reason: r.errorKind || null, at: r.createdAt.toISOString() })) };
  }

  // The SMS month as the limit itself counts it: queued, sent and delivered, never test. Test parts are returned
  // separately and labelled on the page, because counting them would tell an owner the month is full when the
  // server sent nothing at all. The tier is an estimate: GeezSMS prices by the whole account's monthly count.
  async function smsMonth({ buildingId, limit, real, mode, tiers } = {}) {
    const from = addisMonthStart(now());
    const [parts, testParts, accountParts] = await Promise.all([
      store.smsParts({ buildingId, channel: 'sms', status: { in: COUNTED }, createdAt: { gte: from } }),
      store.smsParts({ buildingId, channel: 'sms', status: 'test', createdAt: { gte: from } }),
      store.smsParts({ channel: 'sms', status: { in: COUNTED }, createdAt: { gte: from } }),
    ]);
    const lim = Math.max(0, Math.floor(Number(limit) || 0));
    const unitPriceEtb = smsUnitPrice(accountParts, tiers);
    return { mode: real === true ? (mode === 'live' ? 'live' : 'test') : 'test', parts, testParts, limit: lim,
      remaining: Math.max(0, lim - parts), unitPriceEtb, costEtb: Math.round(parts * unitPriceEtb * 100) / 100 };
  }

  return { list, one, smsMonth };
}

module.exports = { makeMessagesStore, makeMessagesView, presentOf, countsOf, whoLabel, addisMonthRange, addisMonthOf,
  monthList, pageOf, zeroCounts, KINDS, PAGE, ROWS_PAGE, MAX_MONTHS, COUNTED, FIXED_ACTORS };
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-view.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 11
# fail 0
```

- [ ] **Step 5: Full suite** (+6)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1121
# pass 1121
# fail 0
```

- [ ] **Step 6: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 2:" 4 /tmp/planC-msg.txt && git add messaging/messages-view.js test/messaging/messages-view.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Messages view: the queries the tab makes, and nothing beside them

Every read the Messages tab needs is in one store, and every one of them names its columns: there is no include
anywhere, so a column added to a message or a tenancy later cannot arrive in an owner browser by accident. A batch id
from another building is not found rather than refused, the unit lookup is scoped to the building, and the only
tenant-identifying value that comes out is a unit number.

The SMS month counts what the limit counts — queued, sent, delivered — and returns test parts separately, because
counting them would tell an owner the month is full when nothing was sent. The price is marked an estimate: the
provider prices by the whole account's month, not by one building.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: The provider's balance, on the server, behind a cache

The design says the balance is shown "only when a token is configured", read server-side, cached at least ten minutes, and that a failure shows "unavailable". Today no route can reach it at all: `makeSms()` returns `{ send, supports, mode, provider }` and only the raw GeezSMS object has `balance()`. So `makeSms` gains `balance` — a function when a provider is configured, `null` when there is none, which is exactly the "is a token configured" signal the dashboard needs — and a small reader puts a cache in front of it.

**Files:**
- Modify: `messaging/sms.js`
- Modify: `test/messaging/sms.test.js`
- Create: `messaging/sms-balance.js`
- Create: `test/messaging/sms-balance.test.js`

- [ ] **Step 1: Write the failing test for `messaging/sms.js`**

Append block 0 to the existing SMS test:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp test/messaging/sms.test.js test/messaging/sms.test.js.bak-planC-t3-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 3:" 0 /tmp/t3_sms.js && cat /tmp/t3_sms.js >> test/messaging/sms.test.js && rm -f /tmp/t3_sms.js'`

```js

// The owner dashboard reads the provider balance on the server (design §4). makeSms is the only thing the server
// holds, so it has to offer it — and offer nothing when no token is configured, which is what "off" means there.
test('the balance is reachable only when a provider is configured, and never the token or the URL', () => {
  const { makeSms, makeSmsFromEnv } = require('../../messaging/sms');
  assert.equal(makeSms({ mode: 'live', provider: null }).balance, null);
  assert.equal(makeSmsFromEnv({ SMS_PROVIDER: 'geezsms', SMS_MODE: 'live' }).balance, null, 'no token, no balance');
  let asked = 0;
  const provider = { name: 'fake', send: async () => ({ ok: true }), balance: async () => { asked++; return { ok: true, status: 200, body: { balance: 12 } }; } };
  // Test mode still has a balance: the account exists, it is the sending that is switched off.
  for (const mode of ['test', 'live']) {
    const sms = makeSms({ mode, provider });
    assert.equal(typeof sms.balance, 'function', mode);
  }
  const withToken = makeSmsFromEnv({ SMS_PROVIDER: 'geezsms', SMS_API_TOKEN: 'not-a-real-token', SMS_MODE: 'test' });
  assert.equal(typeof withToken.balance, 'function');
  assert.equal(JSON.stringify(Object.keys(withToken)).includes('token'), false);
  assert.equal(String(makeSms({ mode: 'live', provider }).balance).includes('geezsms.com'), false);
  assert.equal(asked, 0, 'building the adapter calls nothing');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/sms.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `not ok` on the new test, `# fail 1` (`undefined !== null` — `balance` is not on the object at all).

- [ ] **Step 3: Add `balance` to `makeSms`**

Back up and patch:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp messaging/sms.js messaging/sms.js.bak-planC-t3-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 3:" 1 /tmp/t3_sms.py && python3 /tmp/t3_sms.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/messaging/sms.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'balance: provider' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

rep("""  return { send, supports: canReach, mode: live ? 'live' : 'test', provider: provider ? provider.name : null };""",
"""  // The owner dashboard shows the account balance when a token is configured (design §4). null means no provider
  // and therefore no balance to show — never a guess, never the token, never the provider's URL. Reading it is a GET
  // and is independent of SMS_MODE: the account exists even while sending is switched off.
  return { send, supports: canReach, mode: live ? 'live' : 'test', provider: provider ? provider.name : null,
    balance: provider && typeof provider.balance === 'function' ? () => provider.balance() : null };""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: Run it to see it pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/sms.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 0`.

- [ ] **Step 5: Write the failing tests for the reader**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 3:" 2 test/messaging/sms-balance.test.js'`

```js
'use strict';
// The provider balance the owner sees. A number and a timestamp, or the word unavailable. Never the body, the URL
// or the token, and never more than one call in ten minutes however often the tab is opened.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSmsBalance, numberIn, TTL_MS } = require('../../messaging/sms-balance');

test('with no provider there is nothing to show, and nothing is called', () => {
  return Promise.all([
    makeSmsBalance({}).read().then(r => assert.deepEqual(r, { state: 'off' })),
    makeSmsBalance({ provider: {} }).read().then(r => assert.deepEqual(r, { state: 'off' })),
    makeSmsBalance({ provider: null }).read().then(r => assert.deepEqual(r, { state: 'off' })),
  ]);
});

test('a number in the payload is the balance, whatever the provider decided to call the field', () => {
  assert.equal(numberIn({ balance: 1234.5 }), 1234.5);
  assert.equal(numberIn({ message_status: 'success', credit: '980' }), 980);
  assert.equal(numberIn({ sms_balance: '-3.25' }), -3.25);
  assert.equal(numberIn({ status: 'ok' }), null);
  assert.equal(numberIn({ id: 'a12' }), null);
  assert.equal(numberIn(null), null);
  assert.equal(numberIn('1234'), null);
});

test('the answer is cached for ten minutes and one in-flight call is shared', async () => {
  let calls = 0, t = 1000;
  const provider = { balance: async () => { calls++; return { ok: true, status: 200, body: { balance: 42 } }; } };
  const b = makeSmsBalance({ provider, now: () => t });
  const [a1, a2] = await Promise.all([b.read(), b.read()]);   // two tabs opened at once
  assert.deepEqual([a1.state, a1.value, a2.value], ['ok', 42, 42]);
  assert.equal(a1.at, new Date(1000).toISOString());
  assert.equal(calls, 1, 'one request, not two');
  t += TTL_MS - 1; await b.read();
  assert.equal(calls, 1, 'still cached just under ten minutes');
  t += 2; await b.read();
  assert.equal(calls, 2, 'a fresh call once the cache is old');
  assert.equal(TTL_MS, 600000);
});

test('a refusal, a broken payload and a throw all say unavailable, and a failure is cached too', async () => {
  let calls = 0, t = 0, mode = 'refuse';
  const provider = { balance: async () => {
    calls++;
    if (mode === 'throw') throw new Error('ECONNRESET https://api.geezsms.com/api/v1/balance?token=SECRET');
    if (mode === 'refuse') return { ok: false, status: 401, body: { error: 'bad token' } };
    return { ok: true, status: 200, body: { message_status: 'success' } };
  } };
  const b = makeSmsBalance({ provider, now: () => t });
  assert.equal((await b.read()).state, 'unavailable');
  await b.read();
  assert.equal(calls, 1, 'a failing provider is not asked again on every page load');
  t += TTL_MS + 1; mode = 'throw';
  assert.equal((await b.read()).state, 'unavailable');
  t += TTL_MS + 1; mode = 'nonumber';
  assert.equal((await b.read()).state, 'unavailable');
  assert.equal(calls, 3);
});

test('nothing it returns or logs carries the token, the URL or the payload', async () => {
  const logs = [];
  const provider = { balance: async () => ({ ok: false, status: 401, body: { token: 'SECRET-TOKEN', url: 'https://api.geezsms.com/api/v1/balance?token=SECRET-TOKEN' } }) };
  const r = await makeSmsBalance({ provider, now: () => 0, log: m => logs.push(m) }).read();
  const all = JSON.stringify(r) + '\n' + logs.join('\n');
  for (const leak of ['SECRET-TOKEN', 'geezsms', 'token=', 'bad token']) assert.equal(all.includes(leak), false, leak);
  assert.deepEqual(Object.keys(r).sort(), ['at', 'state']);
  assert.deepEqual(logs, ['[sms] balance unavailable · http 401']);
});
```

- [ ] **Step 6: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/sms-balance.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"'`
Expected: `Cannot find module '../../messaging/sms-balance'`, `# fail 1`.

- [ ] **Step 7: Write the reader**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 3:" 3 messaging/sms-balance.js'`

```js
'use strict';
// The SMS provider's own balance, for the owner's Messages tab (design §4).
//
// The token and the provider's URL never leave the server: this calls the adapter built in messaging/sms.js and
// returns a number and a timestamp, nothing else. A refusal, a timeout, a thrown error or a payload with no number in
// it are all the same answer — "unavailable" — because the difference between them is the provider's business and
// telling an owner more would mean putting the provider's reply on a web page.
//
// The answer is cached for ten minutes: a dashboard is opened many times a day and a prepaid balance moves slowly.
// A FAILURE is cached for the same ten minutes, so a provider that is down is asked once, not once per page load.
// One in-flight call is shared, so two tabs opened together make one request.
//
//   makeSmsBalance({ provider, ttlMs, now, log }).read()
//     → { state: 'off' }                      no provider is configured — there is no token, so there is nothing to show
//     → { state: 'ok', value, at }            a number, and when it was read
//     → { state: 'unavailable', at }          the provider did not give one

const TTL_MS = 10 * 60 * 1000;

// GeezSMS does not document the balance payload (ops/messaging/sms-status.js copes the same way). The first field
// that is a number, or a string that is plainly a number, is the balance; anything else means there is none.
function numberIn(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const v of Object.values(body)) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  }
  return null;
}

function makeSmsBalance({ provider = null, ttlMs = TTL_MS, now = Date.now, log = () => {} } = {}) {
  let cached = null, at = 0, inflight = null;

  async function fetchOnce() {
    let r = null;
    try { r = await provider.balance(); } catch (e) { r = null; }
    const value = r && r.ok === true ? numberIn(r.body) : null;
    // The status code is the only thing from the provider that is ever logged: no body, no URL, no token.
    if (value == null) log('[sms] balance unavailable · http ' + String((r && r.status) || 0));
    return value == null ? { state: 'unavailable' } : { state: 'ok', value };
  }

  async function read() {
    if (!provider || typeof provider.balance !== 'function') return { state: 'off' };
    const t = now();
    if (cached && t - at < ttlMs) return Object.assign({}, cached, { at: new Date(at).toISOString() });
    if (!inflight) inflight = fetchOnce().finally(() => { inflight = null; });
    const r = await inflight;
    cached = r; at = now();
    return Object.assign({}, r, { at: new Date(at).toISOString() });
  }

  return { read };
}

module.exports = { makeSmsBalance, numberIn, TTL_MS };
```

- [ ] **Step 8: Run them to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/sms-balance.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 5
# fail 0
```

- [ ] **Step 9: Restart and check the log** (`messaging/sms.js` is loaded by the server)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health'`
Expected: `{"ok":true,…}`
Run: `ssh root@31.97.176.180 'tail -n 5 /root/.pm2/logs/binasmart-api-error.log'`
Expected: nothing timestamped after the restart.

- [ ] **Step 10: Full suite** (+6: one added to `sms.test.js`, five in the new file)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1127
# pass 1127
# fail 0
```
(Task 1 and 2 left the suite at 1121; this task adds one test to `sms.test.js` and five to the new file — six in all. If the number is 1126, one of the five new tests did not run: check the file was sliced whole.)

- [ ] **Step 11: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 3:" 6 /tmp/planC-msg.txt && git add messaging/sms.js messaging/sms-balance.js test/messaging/sms.test.js test/messaging/sms-balance.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
SMS balance: a number on the server, cached, or the word unavailable

The owner is shown the provider balance only when a token is configured. Nothing could reach it: the SMS adapter kept
the provider object to itself and only an ops script, building a second adapter from the token, could ask. It now
offers balance — a function when a provider exists, null when none does, which is the same thing as "no token".

In front of it sits a reader that answers with a number and a time, or with unavailable, and never with the provider's
reply. A refusal, a timeout, a throw and a payload with no number in it are one answer, cached for ten minutes like a
success, so a provider that is down is asked once rather than once per page load, and two tabs opened together make
one request. The only thing from the provider that is ever logged is the status code.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: What came of the actions the owner confirmed

A preview card lives for ten minutes and the chat scrolls away. `OwnerAction` already holds what happened; this turns those rows into something an owner can read afterwards — and leaves behind everything they must never see: the action id (which is a Telegram button secret), the arguments, the fingerprint, the payload, the preview text, and the approval ids of whoever prepared or confirmed it.

**Files:**
- Create: `agents/owner/actions/history.js`
- Create: `test/owner/actions-history.test.js`

- [ ] **Step 1: Write the failing tests**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 4:" 0 test/owner/actions-history.test.js'`

```js
'use strict';
// The owner's record of what they confirmed, after the chat is closed. Roles and counts; no ids, no arguments,
// no preview card.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeActionHistory, shapeAction, SELECT, PAGE } = require('../../agents/owner/actions/history');

const D = s => new Date(s);
const row = over => Object.assign({
  createdAt: D('2026-09-16T06:00:00Z'), kind: 'message', status: 'done', channel: 'owner-telegram',
  preparedRole: 'owner', confirmedBy: 'ck_owner_1', confirmedAt: D('2026-09-16T06:02:00Z'),
  bulk: true, urgent: false, result: null,
}, over);

test('a confirmed send is a role, a channel, a time and counts — never an id or the words that were sent', () => {
  const a = shapeAction(row({ result: { counts: { telegram: 2, sms: 62, none: 7, sent: 64, test: 0, failed: 7 },
    batchIds: ['bt1'], notReached: ['104', 'G-3'], error: null } }), { ck_owner_1: 'owner' });
  assert.deepEqual(a.counts, { sent: 64, test: 0, failed: 0, notReachable: 7 });
  assert.deepEqual([a.kind, a.status, a.channel, a.preparedBy, a.confirmedBy, a.bulk, a.urgent],
    ['message', 'done', 'owner-telegram', 'owner', 'owner', true, false]);
  assert.equal(a.at, '2026-09-16T06:00:00.000Z');
  assert.equal(a.confirmedAt, '2026-09-16T06:02:00.000Z');
  assert.deepEqual(a.notReached, ['104', 'G-3']);
  assert.deepEqual(a.batchIds, ['bt1']);
  const json = JSON.stringify(a);
  for (const leak of ['ck_owner_1', '"id"', 'args', 'fingerprint', 'payload', 'cardText', 'preparedTg', 'expiresAt'])
    assert.equal(json.includes(leak), false, leak);
});

test('a recipient the building could not reach is counted once, not as a failure as well', () => {
  // delivery.js tallies a channel-none row in BOTH counts.none and counts.failed; subtracting is the whole point.
  const a = shapeAction(row({ result: { counts: { telegram: 0, sms: 0, none: 3, sent: 0, test: 0, failed: 5 } } }), {});
  assert.deepEqual(a.counts, { sent: 0, test: 0, failed: 2, notReachable: 3 });
  // Never a negative count, whatever a future result shape does.
  assert.deepEqual(shapeAction(row({ result: { counts: { none: 9, failed: 1 } } }), {}).counts,
    { sent: 0, test: 0, failed: 0, notReachable: 9 });
  assert.equal(shapeAction(row({ result: {} }), {}).counts, null);
  assert.equal(shapeAction(row({ result: null }), {}).counts, null);
});

test('invoice creation and a recorded payment carry their own figures', () => {
  const inv = shapeAction(row({ kind: 'create_invoices', bulk: false,
    result: { created: 12, skipped: 3, month: '2026-09', error: null } }), {});
  assert.deepEqual([inv.created, inv.skipped, inv.month, inv.counts, inv.reason], [12, 3, '2026-09', null, null]);
  const pay = shapeAction(row({ kind: 'record_payment', bulk: false,
    result: { invoiceId: 'inv1', unit: '211', totalEtb: 12500, error: null, batchIds: ['bt2'] } }), {});
  assert.deepEqual([pay.unit, pay.totalEtb, pay.batchIds], ['211', 12500, ['bt2']]);
  assert.equal(JSON.stringify(pay).includes('inv1'), false, 'an invoice id is not needed to read the history');
});

test('a refusal keeps its reason, and an unknown approval is a neutral word', () => {
  const a = shapeAction(row({ status: 'refused', confirmedBy: 'ck_gone', result: { error: 'sms_limit', needed: 130, remaining: 44 } }), {});
  assert.equal(a.reason, 'sms_limit');
  assert.equal(a.confirmedBy, 'unknown');
  assert.equal(shapeAction(row({ status: 'expired', confirmedBy: null, confirmedAt: null, result: null }), {}).confirmedBy, null);
  assert.equal(shapeAction(row({ confirmedBy: 'dashboard', preparedRole: 'dashboard', channel: 'owner-web' }), {}).confirmedBy, 'dashboard');
  assert.equal(shapeAction(row({ status: 'refused', result: { error: 'already_paid' } }), {}).reason, 'already_paid');
});

test('the list reads only those columns, this building only, newest first, twenty to a page', async () => {
  const seen = [];
  const prisma = {
    ownerAction: {
      count: async a => { seen.push(['count', a]); return 41; },
      findMany: async a => { seen.push(['findMany', a]); return [row({ confirmedBy: 'ck_owner_1' }), row({ confirmedBy: 'dashboard' })]; },
    },
    ownerAccess: { findMany: async a => { seen.push(['access', a]); return [{ id: 'ck_owner_1', role: 'owner' }]; } },
  };
  const d = await makeActionHistory({ prisma }).list({ buildingId: 'bld1', page: 99 });
  assert.deepEqual([d.page, d.pages, d.total], [2, 3, 41]);
  assert.deepEqual(d.actions.map(a => a.confirmedBy), ['owner', 'dashboard']);
  const many = seen.find(x => x[0] === 'findMany')[1];
  assert.deepEqual(many.where, { buildingId: 'bld1' });
  assert.deepEqual(many.orderBy, { createdAt: 'desc' });
  assert.deepEqual([many.skip, many.take], [40, PAGE]);
  assert.equal(many.include, undefined);
  assert.deepEqual(many.select, SELECT);
  assert.deepEqual(Object.keys(SELECT).sort(),
    ['bulk', 'channel', 'confirmedAt', 'confirmedBy', 'createdAt', 'kind', 'preparedRole', 'result', 'status', 'urgent']);
  // 'dashboard' is not an approval id and is never asked about; the real id is, scoped to this building.
  assert.deepEqual(seen.find(x => x[0] === 'access')[1].where, { id: { in: ['ck_owner_1'] }, kind: 'building', entityId: 'bld1' });
  assert.deepEqual(seen.find(x => x[0] === 'access')[1].select, { id: true, role: true });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/owner/actions-history.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"'`
Expected: `Cannot find module '../../agents/owner/actions/history'`, `# fail 1`.

- [ ] **Step 3: Write the module**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 4:" 1 agents/owner/actions/history.js'`

```js
'use strict';
// The owner's own record of what they confirmed (owner actions design §3.3: every prepare, confirm, cancel, expiry and
// execution is "shown in the dashboard activity log").
//
// A preview card lives ten minutes and the chat scrolls away; this is where the owner finds out, afterwards, what an
// action actually did — how many were reached, which units were not, what a refusal was about.
//
// WHAT IT NEVER CARRIES, and why:
//   id           22 random characters that are the whole content of a Telegram confirm button — a secret, not a label
//   args         what the owner asked for, unvalidated, as the model handed it over
//   payload      resolved recipients: tenancy ids and invoice ids
//   fingerprint  the hash the confirm is checked against
//   text         the notice itself — it is kept once on the batch, and the Messages drill-down shows it there
//   cardText     the preview the owner read; it may hold an occupant's name, and no name leaves this table
//   preparedBy   an OwnerAccess id; the role beside it (preparedRole) is what a person needs
//   preparedTg   a Telegram account id
// confirmedBy IS read, because there is no confirmedRole column — and it is turned into a role before it leaves,
// against the approvals of THIS building only.
const { whoLabel } = require('../../../messaging/messages-view');

const PAGE = 20;
// Exactly the columns the dashboard shows. There is no `include` anywhere: a column added to OwnerAction later cannot
// reach an owner's browser by accident.
const SELECT = { createdAt: true, kind: true, status: true, channel: true, preparedRole: true,
  confirmedBy: true, confirmedAt: true, bulk: true, urgent: true, result: true };

const num = v => (Number.isFinite(v) ? v : null);

function shapeAction(a, roleById) {
  const r = a && a.result && typeof a.result === 'object' && !Array.isArray(a.result) ? a.result : {};
  const c = r.counts && typeof r.counts === 'object' ? r.counts : null;
  const none = Number(c && c.none) || 0;
  return {
    at: new Date(a.createdAt).toISOString(),
    kind: a.kind,
    status: a.status,
    channel: a.channel,
    preparedBy: a.preparedRole || 'unknown',
    confirmedBy: a.confirmedBy ? whoLabel(a.confirmedBy, roleById) : null,
    confirmedAt: a.confirmedAt ? new Date(a.confirmedAt).toISOString() : null,
    bulk: a.bulk === true,
    urgent: a.urgent === true,
    // messaging/delivery.js counts a not-reachable recipient in BOTH none and failed, so the two are separated here;
    // otherwise the owner would see the same tenant twice and the numbers would not add up to the recipients.
    counts: c ? { sent: Number(c.sent) || 0, test: Number(c.test) || 0,
      failed: Math.max(0, (Number(c.failed) || 0) - none), notReachable: none } : null,
    notReached: Array.isArray(r.notReached) ? r.notReached.map(String) : null,
    created: num(r.created),
    skipped: num(r.skipped),
    month: typeof r.month === 'string' ? r.month : null,
    unit: typeof r.unit === 'string' ? r.unit : null,
    totalEtb: num(r.totalEtb),
    reason: typeof r.error === 'string' ? r.error : null,
    batchIds: Array.isArray(r.batchIds) ? r.batchIds.map(String).slice(0, 5) : [],
  };
}

function makeActionHistory({ prisma, page = PAGE }) {
  async function list({ buildingId, page: n = 0 } = {}) {
    const where = { buildingId };
    const total = await prisma.ownerAction.count({ where });
    const pages = Math.max(1, Math.ceil(total / page));
    const p = Math.min(Math.max(0, Math.floor(Number(n) || 0)), pages - 1);
    const rows = total ? await prisma.ownerAction.findMany({ where, orderBy: { createdAt: 'desc' },
      skip: p * page, take: page, select: SELECT }) : [];
    const ids = [...new Set(rows.map(a => a.confirmedBy).filter(x => x && x !== 'dashboard'))];
    const roleRows = ids.length ? await prisma.ownerAccess.findMany({
      where: { id: { in: ids }, kind: 'building', entityId: buildingId }, select: { id: true, role: true } }) : [];
    const roleById = Object.fromEntries(roleRows.map(x => [x.id, x.role]));
    return { page: p, pages, total, actions: rows.map(a => shapeAction(a, roleById)) };
  }
  return { list };
}

module.exports = { makeActionHistory, shapeAction, SELECT, PAGE };
```

- [ ] **Step 4: Run them to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/owner/actions-history.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 5
# fail 0
```

- [ ] **Step 5: Full suite** (+5)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1132
# pass 1132
# fail 0
```

- [ ] **Step 6: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 4:" 4 /tmp/planC-msg.txt && git add agents/owner/actions/history.js test/owner/actions-history.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Owner actions: what came of them, readable after the chat is closed

A preview card lives ten minutes and then the chat scrolls away; the record of what the owner confirmed stays in the
table and nothing showed it to them. This reads those rows as a list: the kind, what became of it, the role and the
channel it was prepared from, who confirmed it and when, the counts, the units that were not reached, and the reason a
refusal was refused.

It leaves behind everything an owner must not be handed: the action id, which is the entire content of a Telegram
confirm button; the arguments, the payload and the fingerprint; the notice text, which lives once on the batch; and
the preview card, which may hold an occupant name. The one id it does read, the confirming approval, is turned into
owner or staff against this building's approvals before it leaves — and into "unknown" if it is not one of them.

A recipient the building could not reach is counted once. The delivery layer counts such a row as not reachable AND as
a failure, which is right for its own question and would show the owner the same tenant twice here.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: Four read-only routes behind the building's owner key

**Files:**
- Modify: `server.js`
- Create: `test/messaging/server-messages.test.js`

- [ ] **Step 1: Write the failing tests**

`server.js` starts a listener when it is required, so its wiring is pinned by reading it — the same way `test/messaging/server-delivery.test.js` and `test/kit/wiring.test.js` do.

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 5:" 0 test/messaging/server-messages.test.js'`

```js
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/server-messages.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 5` — every route is missing.

- [ ] **Step 3: Patch `server.js`**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp server.js server.js.bak-planC-t5-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 5:" 1 /tmp/t5_routes.py && python3 /tmp/t5_routes.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/server.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'makeMessagesView' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

rep("""// ===== Short invoice and receipt links: bina.et/i/<token> (design §1.3) =====""",
"""// ===== The owner's Messages tab (owner actions and messaging design §4) =====
// Four read-only routes behind the building's owner key. They answer with counts, dates and unit numbers — never a
// phone number, a user id, a tenancy id, a provider id, an OwnerAccess id, a Telegram id or the id of a pending
// action. The GeezSMS balance is read on the server behind a ten-minute cache (messaging/sms-balance.js): the token
// and the provider's URL never reach the page, and a provider that is down shows "unavailable", not an error.
// None of these routes writes, sends or confirms anything; the only button in the tab is the Invoices tab's own
// Send now, which is POST /api/owner/:slug/invoice/:id/send and is unchanged.
const { makeMessagesStore, makeMessagesView } = require('./messaging/messages-view');
const { makeSmsBalance } = require('./messaging/sms-balance');
const { makeActionHistory } = require('./agents/owner/actions/history');
// Its own parse: the delivery layer's call above is pinned as a literal by test/messaging/server-delivery.test.js.
const smsTiers = parsePriceTiers(process.env.SMS_PRICE_TIERS);
const messagesView = makeMessagesView({ store: makeMessagesStore(prisma) });
const smsBalance = makeSmsBalance({ provider: tenantSms.balance ? { balance: tenantSms.balance } : null, log: m => console.log(m) });
const actionHistory = makeActionHistory({ prisma });

fastify.get('/api/owner/:slug/messages', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const q = req.query || {};
  return messagesView.list({ buildingId: b.id, page: q.page, kind: String(q.kind || ''), month: String(q.month || '') });
});

// One batch by unit. The view looks it up with the building in the where, so a batch id from somewhere else is not
// found — 404 rather than 403, so nothing here tells a caller whether an id exists.
fastify.get('/api/owner/:slug/messages/:batchId', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const one = await messagesView.one({ buildingId: b.id, batchId: req.params.batchId, page: (req.query || {}).page });
  if (!one) return reply.code(404).send({ error: 'not_found' });
  return one;
});

// This month's SMS against the building's limit, with the cost estimate and — only when a token is configured — the
// provider's balance. tenantBuilding() decides real/test exactly as the delivery layer does, so the tab can never say
// live for a building that reaches nobody.
fastify.get('/api/owner/:slug/sms-month', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const tb = tenantBuilding(b);
  const [month, balance] = await Promise.all([
    messagesView.smsMonth({ buildingId: b.id, limit: tb.smsMonthlyLimit, real: tb.real, mode: tenantSms.mode, tiers: smsTiers }),
    smsBalance.read().catch(() => ({ state: 'unavailable' })),
  ]);
  return Object.assign({}, month, { balance });
});

// What became of the actions the owner confirmed in Bini (design §3.3). Roles and counts only — see the list of
// columns this must never read in agents/owner/actions/history.js.
fastify.get('/api/owner/:slug/owner-actions', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  return actionHistory.list({ buildingId: b.id, page: (req.query || {}).page });
});

// ===== Short invoice and receipt links: bina.et/i/<token> (design §1.3) =====""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/server-messages.test.js test/messaging/server-delivery.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 17
# fail 0
```
(5 new + the 12 in `server-delivery.test.js`.)

- [ ] **Step 5: Restart and check the log**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health'`
Expected: `{"ok":true,…}`
Run: `ssh root@31.97.176.180 'tail -n 5 /root/.pm2/logs/binasmart-api-error.log'`
Expected: nothing timestamped after the restart.

- [ ] **Step 6: Call the four routes for real, on a DEMO building, with a key that is destroyed afterwards**

`century-mall` is not in `NOTIFY_WHITELIST`, so nothing about it can reach anybody. Slice the check script and run it:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 5:" 3 /tmp/t5_live.js && node /tmp/t5_live.js && rm -f /tmp/t5_live.js'`

```js
'use strict';
// Read-only live check of the four Messages routes, on a DEMO building, with a key minted for this run and deleted
// before it ends. Prints shapes and counts; no phone number, no name, no key, no token.
const ROOT = '/var/www/connectcare/binasmart';
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { PrismaClient } = require(ROOT + '/node_modules/@prisma/client');
const { makeOwnerKeys } = require(ROOT + '/building/ownerKeys');
const SLUG = 'century-mall';

(async () => {
  const prisma = new PrismaClient();
  const keys = makeOwnerKeys({ prisma });
  const b = await prisma.building.findUnique({ where: { qrSlug: SLUG }, select: { id: true, qrSlug: true } });
  if (!b) throw new Error('demo building not found: ' + SLUG);
  const key = await keys.issue(b.id, b.qrSlug, 'planC-check');
  const get = async path => {
    const r = await fetch('http://127.0.0.1:4210/api/owner/' + SLUG + path, { headers: { 'x-owner-key': key } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    const m = await get('/messages');
    console.log('messages      · http ' + m.status + ' · keys ' + Object.keys(m.body || {}).sort().join(',')
      + ' · total ' + (m.body || {}).total + ' · months ' + JSON.stringify((m.body || {}).months));
    const one = await get('/messages/does-not-exist');
    console.log('drill-down    · http ' + one.status + ' (a batch id that is not this building must be 404)');
    const s = await get('/sms-month');
    console.log('sms-month     · http ' + s.status + ' · ' + JSON.stringify(s.body));
    const a = await get('/owner-actions');
    console.log('owner-actions · http ' + a.status + ' · total ' + (a.body || {}).total + ' · rows ' + ((a.body || {}).actions || []).length);
    const noKey = await fetch('http://127.0.0.1:4210/api/owner/' + SLUG + '/messages');
    console.log('without a key · http ' + noKey.status + ' (must be 401)');
    const all = JSON.stringify([m.body, s.body, a.body]);
    console.log('leak check    · ' + ['phone', 'userId', 'providerId', 'tenancyId', 'token', 'geezsms']
      .map(w => w + ':' + (all.includes(w) ? 'FOUND' : 'no')).join(' '));
  } finally {
    const { hashKey } = require(ROOT + '/building/ownerKeys');
    const gone = await prisma.ownerKey.deleteMany({ where: { keyHash: hashKey(key) } });
    const left = await prisma.ownerKey.count({ where: { buildingId: b.id, label: 'planC-check' } });
    console.log('throwaway key · deleted ' + gone.count + ' · labelled keys left ' + left + ' (must be 0)');
    await prisma.$disconnect();
  }
})().catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
```

Expected (the building is empty, which is the point):
```
messages      · http 200 · keys batches,kind,kinds,month,months,page,pages,total · total 0 · months ["2026-09"]
drill-down    · http 404 (a batch id that is not this building must be 404)
sms-month     · http 200 · {"mode":"test","parts":0,"testParts":0,"limit":500,"remaining":500,"unitPriceEtb":0.7475,"costEtb":0,"balance":{"state":"off"}}
owner-actions · http 200 · total 0 · rows 0
without a key · http 401 (must be 401)
leak check    · phone:no userId:no providerId:no tenancyId:no token:no geezsms:no
throwaway key · deleted 1 · labelled keys left 0 (must be 0)
```
`balance` will be `{"state":"off"}` while `SMS_API_TOKEN` is unset. If it is set, expect `{"state":"ok","value":…}` or `{"state":"unavailable",…}` — both are correct; anything containing a URL or a token is a stop.
Any `FOUND` in the leak check is a stop: report it before going further.

- [ ] **Step 7: Confirm no key survived**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node -e "const{PrismaClient}=require(\"@prisma/client\");new PrismaClient().ownerKey.count({where:{label:\"planC-check\"}}).then(n=>{console.log(\"planC-check keys: \"+n);process.exit(0)})"'`
Expected: `planC-check keys: 0`
(If PowerShell mangles the quotes, put the same one-liner in `/tmp/keycount.sh` and run `sh /tmp/keycount.sh`, then delete it.)

- [ ] **Step 8: Full suite** (+5)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1137
# pass 1137
# fail 0
```

- [ ] **Step 9: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 5:" 6 /tmp/planC-msg.txt && git add server.js test/messaging/server-messages.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Messages: four read-only routes behind the building's own key

The batches this building sent, one batch by unit, this month's SMS against its limit, and what came of the actions
the owner confirmed. Every one checks the key before it reads anything, answers for one building, takes no body and
writes nothing.

A batch id that belongs elsewhere is not found rather than refused, so nothing tells a caller whether an id exists.
The SMS month decides live or test the way the delivery layer does, so the tab cannot claim a building reaches people
when it reaches nobody. The provider balance comes through the server-side cache and shows as "off" until a token is
configured; the token and the provider URL stay on the server either way.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: The Messages tab — the SMS month and the list of batches

The tab is built by string concatenation, like the Plan A cards beside it, and every value goes through `esc()` (or `jsq()` inside an `onclick`). `test/owner-dashboard-escape.test.js` only scans template literals, so concatenated cards are invisible to it — which is why each one is pinned value by value here, exactly as `test/messaging/dashboard.test.js` pins the Plan A cards.

**Files:**
- Modify: `public/owner.html`
- Create: `test/messaging/messages-dashboard.test.js`

- [ ] **Step 1: Write the failing tests**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 6:" 0 test/messaging/messages-dashboard.test.js'`

```js
'use strict';
// The Messages tab, pinned by reading owner.html. These cards are built by string concatenation, so the template
// literal scanner in test/owner-dashboard-escape.test.js cannot see them: every value is pinned here by name.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'owner.html'), 'utf8');
const fn = name => {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' missing');
  return HTML.slice(at, HTML.indexOf('\n}\n', at));
};

test('there is a Messages tab and it renders before the overview has loaded', () => {
  assert.ok(HTML.includes('<button onclick="setTab(\'messages\')" data-t="messages" class="tabbtn">📨 Messages</button>'));
  // renderTab() returns early on !D; Messages must work like the AI tab, which does not wait for the overview.
  assert.match(HTML, /function renderTab\(\)\{\n  if \(TAB === 'ai'\) \{ return renderAI\(\); \}\n  if \(TAB === 'messages'\) \{ return renderMessages\(\); \}/);
  const r = fn('renderMessages');
  for (const id of ['sms-month', 'pending-deliv', 'msg-batches', 'msg-actions']) assert.ok(r.includes('id="' + id + '"'), id);
  assert.match(r, /loadSmsMonth\(\); loadPending\(\); loadBatches\(\); loadActions\(\);/);
});

test('the SMS card escapes every number it shows and says plainly when nothing was sent', () => {
  const load = fn('loadSmsMonth');
  assert.match(load, /kfetch\('\/api\/owner\/' \+ slug \+ '\/sms-month'\)/);
  for (const v of ['esc(d.parts)', 'esc(d.limit)', 'esc(d.remaining)', 'esc(d.costEtb)', 'esc(d.unitPriceEtb)', 'esc(d.testParts)'])
    assert.ok(load.includes(v), v);
  assert.match(load, /d\.balance\.state === 'ok'/);
  assert.match(load, /esc\(String\(d\.balance\.value\)\)/);
  assert.match(load, /unavailable · አልተገኘም/);
  assert.match(load, /d\.mode === 'test'/);
  assert.match(load, /🧪 Test mode — nothing was sent/);
  // The only thing placed in a style attribute is a number this page computed.
  assert.match(load, /var pct = d\.limit \? Math\.min\(100, Math\.round\(d\.parts \/ d\.limit \* 100\)\) : 0;/);
  assert.equal(/state === 'off'/.test(load), true, 'no token means no balance line at all');
});

test('the batch list escapes every value, names the sender as a role, and pages', () => {
  const load = fn('loadBatches');
  assert.match(load, /kfetch\(url\)/);
  assert.match(load, /'\/api\/owner\/' \+ slug \+ '\/messages\?page=' \+ MSG\.page/);
  for (const v of ['esc(d.total)', 'esc(b.total)', 'esc(b.source)', 'jsq(b.id)', 'esc(b.id)',
    'esc(msgLabel(MSG_KIND, b.kind))', 'esc(msgLabel(MSG_BY, b.by))', "esc(String(b.at).slice(0, 10))"])
    assert.ok(load.includes(v), v);
  assert.match(load, /No messages yet · እስካሁን መልእክት የለም/);
  assert.match(fn('msgCounts'), /esc\(msgLabel\(MSG_STATE, k\)\) \+ ' ' \+ esc\(c\[k\]\)/);
  assert.match(fn('msgPager'), /esc\(page \+ 1\) \+ ' \/ ' \+ esc\(pages\)/);
  assert.match(fn('msgPage'), /MSG\.page = Math\.max\(0, MSG\.page \+ d\);/);
  // A label the server has not seen before is printed as text, never dropped and never trusted.
  assert.match(fn('msgLabel'), /return map\[k\] \|\| String\(k \|\| ''\);/);
});

test('the filters send only a kind and a month, both url-encoded, and reset the page', () => {
  const load = fn('loadBatches');
  assert.match(load, /MSG\.kind \? '&kind=' \+ encodeURIComponent\(MSG\.kind\) : ''/);
  assert.match(load, /MSG\.month \? '&month=' \+ encodeURIComponent\(MSG\.month\) : ''/);
  const f = fn('msgFilter');
  assert.match(f, /MSG\.kind = document\.getElementById\('msg-kind'\)\.value;/);
  assert.match(f, /MSG\.month = document\.getElementById\('msg-month'\)\.value;/);
  assert.match(f, /MSG\.page = 0; MSG\.open = null; loadBatches\(\);/);
  assert.match(HTML, /var MSG = \{ page: 0, kind: '', month: '', open: null, rpage: 0, apage: 0 \};/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-dashboard.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 4`.

- [ ] **Step 3: Patch the page**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp public/owner.html public/owner.html.bak-planC-t6-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 6:" 1 /tmp/t6_tab.py && python3 /tmp/t6_tab.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/public/owner.html'
s = io.open(p, encoding='utf-8', newline='').read()
if 'renderMessages' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

# 1. The tab button, next to Invoices.
rep("""  <button onclick="setTab('invoices')" data-t="invoices" class="tabbtn">🧾 Invoices</button>""",
"""  <button onclick="setTab('invoices')" data-t="invoices" class="tabbtn">🧾 Invoices</button>
  <button onclick="setTab('messages')" data-t="messages" class="tabbtn">📨 Messages</button>""")

# 2. Messages renders without waiting for the overview, exactly as the Bini chat does.
rep("""function renderTab(){
  if (TAB === 'ai') { return renderAI(); }""",
"""function renderTab(){
  if (TAB === 'ai') { return renderAI(); }
  if (TAB === 'messages') { return renderMessages(); }""")

# 3. The tab itself, in front of the pending-delivery card it will hold from Task 8 onwards.
rep("""// Invoices whose send did not reach the tenant (messaging design §1.6). Send now uses the invoice as it is today.
async function loadPending(){""",
"""// ===== Messages (owner actions and messaging design §4) =====
// Everything this building sent, what it cost in SMS against the month's limit, and what came of the actions the owner
// confirmed in the Bini chat. Read only: the one button in this tab that does anything is Send now, which is the
// Invoices tab's own send, unchanged. Every card here is built by string concatenation and every value goes through
// esc() — or jsq() inside an onclick — because the template-literal scanner in owner-dashboard-escape.test.js cannot
// see concatenated markup. test/messaging/messages-dashboard.test.js pins each one by name.
var MSG = { page: 0, kind: '', month: '', open: null, rpage: 0, apage: 0 };
var MSG_KIND = { notice: 'ማስታወቂያ · notice', reminder: 'ማስታወሻ · reminder', invoice: 'ክፍያ መጠየቂያ · invoice', receipt: 'ደረሰኝ · receipt' };
var MSG_STATE = { delivered: '✅ ደርሷል', reached: '📤 ተልኳል', queued: '⏳ በመጠባበቅ', failed: '⚠️ አልተሳካም', notReachable: '📭 አልተደረሰም', test: '🧪 ሙከራ' };
var MSG_BY = { owner: 'ባለቤት · owner', staff: 'ሰራተኛ · staff', dashboard: 'ዳሽቦርድ · dashboard', cron: 'በራሱ · automatic', ops: 'BinaSmart', unknown: '—' };
// A word the server has not sent before is shown as it came, escaped — never dropped, never guessed at.
function msgLabel(map, k){ return map[k] || String(k || ''); }
function renderMessages(){
  var app = document.getElementById('app');
  app.innerHTML = '<div class="card p-4" id="sms-month"><div class="text-[11px] text-slate-400">📱 SMS…</div></div>'
    + '<div id="pending-deliv"></div>'
    + '<div class="card p-4" id="msg-batches"><div class="text-[11px] text-slate-400">📨 …</div></div>'
    + '<div class="card p-4" id="msg-actions"><div class="text-[11px] text-slate-400">✅ …</div></div>';
  loadSmsMonth(); loadPending(); loadBatches(); loadActions();
}
// This month against the building's limit. The parts counted are the ones the limit counts — queued, sent, delivered —
// so test rows are shown separately and never make a month look full.
async function loadSmsMonth(){
  var box = document.getElementById('sms-month'); if (!box) return;
  try{
    var r = await kfetch('/api/owner/' + slug + '/sms-month'); if (!r.ok) { box.innerHTML = ''; return; }
    var d = await r.json();
    var pct = d.limit ? Math.min(100, Math.round(d.parts / d.limit * 100)) : 0;
    var bal = d.balance && d.balance.state === 'ok' ? esc(String(d.balance.value)) + ' ETB'
      : d.balance && d.balance.state === 'unavailable' ? 'unavailable · አልተገኘም' : '';
    box.innerHTML = '<div class="font-black text-sm mb-1">📱 SMS this month · የዚህ ወር ኤስኤምኤስ</div>'
      + '<div class="text-[11px] mb-2" style="color:#475569"><b>' + esc(d.parts) + '</b> / ' + esc(d.limit)
      + ' parts used · ' + esc(d.remaining) + ' left · ቀሪ</div>'
      + '<div class="bar mb-2"><div style="width:' + pct + '%"></div></div>'
      + '<div class="text-[10px] text-slate-500">≈ ' + esc(d.costEtb) + ' ETB at ' + esc(d.unitPriceEtb) + ' ETB/SMS — estimate · ግምት</div>'
      + (bal ? '<div class="text-[10px] text-slate-500">Provider balance · የአቅራቢ ቀሪ ሂሳብ: ' + bal + '</div>' : '')
      + (d.mode === 'test' ? '<div class="text-[10px] text-amber-700 mt-1">🧪 Test mode — nothing was sent · የሙከራ ሁኔታ፤ ምንም አልተላከም'
        + (d.testParts ? ' (' + esc(d.testParts) + ' test parts)' : '') + '</div>' : '');
  } catch (e) { box.innerHTML = ''; }
}
function msgCounts(c){
  var out = [];
  ['delivered', 'reached', 'queued', 'failed', 'notReachable', 'test'].forEach(function(k){
    if (c && c[k]) out.push(esc(msgLabel(MSG_STATE, k)) + ' ' + esc(c[k]));
  });
  return out.join(' · ') || '<span class="text-slate-400">—</span>';
}
function msgPager(page, pages, handler){
  if (!(pages > 1)) return '';
  return '<div class="flex items-center gap-2 mt-2 justify-center text-[11px]">'
    + '<button class="mbtn bg-slate-200 text-slate-600" ' + (page <= 0 ? 'disabled' : '') + ' onclick="' + handler + '(-1)">‹</button>'
    + '<span>' + esc(page + 1) + ' / ' + esc(pages) + '</span>'
    + '<button class="mbtn bg-slate-200 text-slate-600" ' + (page >= pages - 1 ? 'disabled' : '') + ' onclick="' + handler + '(1)">›</button></div>';
}
async function loadBatches(){
  var box = document.getElementById('msg-batches'); if (!box) return;
  try{
    var url = '/api/owner/' + slug + '/messages?page=' + MSG.page
      + (MSG.kind ? '&kind=' + encodeURIComponent(MSG.kind) : '')
      + (MSG.month ? '&month=' + encodeURIComponent(MSG.month) : '');
    var r = await kfetch(url); if (!r.ok) { box.innerHTML = ''; return; }
    var d = await r.json();
    var kindOpts = '<option value="">all kinds · ሁሉም</option>' + (d.kinds || []).map(function(k){
      return '<option value="' + esc(k) + '"' + (k === d.kind ? ' selected' : '') + '>' + esc(msgLabel(MSG_KIND, k)) + '</option>'; }).join('');
    var monthOpts = '<option value="">all months · ሁሉም</option>' + (d.months || []).map(function(m){
      return '<option value="' + esc(m) + '"' + (m === d.month ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    var rows = (d.batches || []).map(function(b){
      return '<div class="rounded-xl p-2.5 mb-1.5" style="background:#f8fafc;border:1px solid #e9f0ee">'
        + '<div class="flex items-center gap-2"><span class="flex-1 text-[11px]"><b>' + esc(String(b.at).slice(0, 10)) + '</b> · '
        + esc(msgLabel(MSG_KIND, b.kind)) + '<br><span class="text-[9px] text-slate-400">' + esc(b.total)
        + ' recipients · ' + esc(msgLabel(MSG_BY, b.by)) + ' · ' + esc(b.source) + '</span></span>'
        + '<button class="tag" style="background:#e0f2fe;color:#0369a1" onclick="openBatch(\\'' + jsq(b.id) + '\\')">🔍 Details</button></div>'
        + '<div class="text-[10px] mt-1" style="color:#475569">' + msgCounts(b.counts) + '</div>'
        + '<div id="batch-' + esc(b.id) + '"></div></div>';
    }).join('');
    box.innerHTML = '<div class="font-black text-sm mb-2">📨 Sent messages · የተላኩ መልእክቶች (' + esc(d.total) + ')</div>'
      + '<div class="flex gap-2 mb-2">'
      + '<select id="msg-kind" onchange="msgFilter()" class="text-[11px]" style="background:#f5f9f8;border:1.5px solid #e3ecea;border-radius:10px;padding:6px 8px">' + kindOpts + '</select>'
      + '<select id="msg-month" onchange="msgFilter()" class="text-[11px]" style="background:#f5f9f8;border:1.5px solid #e3ecea;border-radius:10px;padding:6px 8px">' + monthOpts + '</select></div>'
      + (rows || '<div class="text-xs text-slate-400">No messages yet · እስካሁን መልእክት የለም</div>')
      + msgPager(d.page, d.pages, 'msgPage');
  } catch (e) { box.innerHTML = ''; }
}
function msgFilter(){
  MSG.kind = document.getElementById('msg-kind').value;
  MSG.month = document.getElementById('msg-month').value;
  MSG.page = 0; MSG.open = null; loadBatches();
}
function msgPage(d){ MSG.page = Math.max(0, MSG.page + d); MSG.open = null; loadBatches(); }
// Invoices whose send did not reach the tenant (messaging design §1.6). Send now uses the invoice as it is today.
async function loadPending(){""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: The script must parse, and the tests must pass**

Run: `ssh root@31.97.176.180 'sh /tmp/check-owner-js.sh'`
Expected: `owner.html inline script: parses`
Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-dashboard.test.js test/messaging/dashboard.test.js test/owner-dashboard-escape.test.js test/owner/actions-dashboard.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 0` (the Task 8 move has not happened yet, so the Plan A tests still pass unchanged).

- [ ] **Step 5: See it in the served page** (a static file with max-age=0 — no restart)

Run: `ssh root@31.97.176.180 'curl -s http://127.0.0.1:4210/owner/century-mall | grep -c renderMessages'`
Expected: `3` (the tab hook, the function, and the call inside it).

- [ ] **Step 6: Full suite** (+4)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1141
# pass 1141
# fail 0
```

- [ ] **Step 7: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 6:" 3 /tmp/planC-msg.txt && git add public/owner.html test/messaging/messages-dashboard.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Owner dashboard: a Messages tab, with this month's SMS and every batch sent

The owner could see that a send had happened only in the moment it happened. The new tab lists the batches, newest
first, twenty to a page, with a filter by kind and by month, and says for each one how many were delivered, sent,
queued, failed, not reachable or only recorded — buckets that do not overlap, so the numbers add up to the recipients.

Above them, the month's SMS parts against the building's limit, the cost estimate at the current tier, and the
provider balance when a token is configured. Test rows are counted separately and labelled, because they never use up
the limit and a month that looks full when nothing was sent is worse than no number at all.

The tab renders before the overview has loaded, like the Bini chat. Every value is escaped, every value in a handler
is escaped for the handler, and a word the server has not sent before is printed as it came rather than dropped.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: The drill-down, the action history and the legend

Task 6 left `loadBatches` calling `openBatch`, which does not exist yet: the Details button throws until this task lands, so the two tasks go in together on the same day. This task adds the per-unit drill-down, the record of the actions the owner confirmed, and the legend that explains the six words the lists use.

**Files:**
- Modify: `public/owner.html`
- Modify: `test/messaging/messages-dashboard.test.js`

- [ ] **Step 1: Write the failing tests**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp test/messaging/messages-dashboard.test.js test/messaging/messages-dashboard.test.js.bak-planC-t7-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 7:" 0 /tmp/t7_tests.js && cat /tmp/t7_tests.js >> test/messaging/messages-dashboard.test.js && rm -f /tmp/t7_tests.js'`

```js

// ===== Task 7: the drill-down, the actions, the legend =====

test('the drill-down shows unit, state, channel and reason, each escaped, and pages on its own', () => {
  const open = fn('openBatch');
  assert.match(open, /'\/api\/owner\/' \+ slug \+ '\/messages\/' \+ encodeURIComponent\(id\) \+ '\?page=' \+ \(MSG\.rpage \|\| 0\)/);
  for (const v of ['esc(x.unit)', 'esc(x.channel)', 'esc(x.reason)', 'esc(msgLabel(MSG_STATE, x.present))', 'esc(d.text)'])
    assert.ok(open.includes(v), v);
  // A second tap on the same batch closes it; opening another one starts at its first page.
  assert.match(open, /if \(MSG\.open === id && !keepPage\) \{ MSG\.open = null; box\.innerHTML = ''; return; \}/);
  assert.match(open, /if \(!keepPage\) MSG\.rpage = 0;/);
  assert.match(open, /msgPager\(d\.page, d\.pages, 'batchPage'\)/);
  assert.match(fn('batchPage'), /MSG\.rpage = Math\.max\(0, \(MSG\.rpage \|\| 0\) \+ dir\); openBatch\(MSG\.open, true\);/);
});

test('nothing about a tenant but the unit number is ever written into the drill-down', () => {
  const open = fn('openBatch');
  for (const never of ['phone', 'tenancyId', 'userId', 'providerId', 'tenant', '.name'])
    assert.equal(open.includes(never), false, never);
  // A reason the server has not sent before is printed as text, not looked up and silently lost.
  assert.match(open, /x\.reason \? ' · ' \+ esc\(x\.reason\) : ''/);
});

test('the action history names a role and a channel, never an id, and escapes every figure', () => {
  const load = fn('loadActions');
  assert.match(load, /'\/api\/owner\/' \+ slug \+ '\/owner-actions\?page=' \+ \(MSG\.apage \|\| 0\)/);
  for (const v of ['esc(msgLabel(MSG_ACT, a.kind))', 'esc(msgLabel(MSG_ST, a.status))', 'esc(msgLabel(MSG_BY, a.preparedBy))',
    'esc(msgLabel(MSG_BY, a.confirmedBy))', 'esc(msgLabel(MSG_CH, a.channel))', 'esc(c.sent)', 'esc(c.test)',
    'esc(c.failed)', 'esc(c.notReachable)', 'esc(a.created)', 'esc(a.skipped)', 'esc(a.month)', 'esc(a.unit)',
    'esc(a.totalEtb)', 'esc(a.reason)']) assert.ok(load.includes(v), v);
  assert.match(load, /a\.notReached\.map\(function\(u\)\{ return esc\(u\); \}\)/);
  assert.match(load, /No actions yet · እስካሁን የለም/);
  assert.match(load, /msgPager\(d\.page, d\.pages, 'actPage'\)/);
  assert.match(fn('actPage'), /MSG\.apage = Math\.max\(0, \(MSG\.apage \|\| 0\) \+ dir\); loadActions\(\);/);
  // The page never asks for and never shows the things the route refuses to send.
  for (const never of ['cardText', 'fingerprint', 'a.args', 'a.payload', 'a.id'])
    assert.equal(load.includes(never), false, never);
});

test('the legend explains all six words, including the two an owner would otherwise misread', () => {
  const r = fn('renderMessages');
  assert.match(r, /ℹ️ What the words mean · ትርጉማቸው/);
  for (const w of ['delivered · ደርሷል', 'sent · ተልኳል', 'queued · በመጠባበቅ', 'failed · አልተሳካም',
    'not reachable · አልተደረሰም', 'test · ሙከራ']) assert.ok(r.includes(w), w);
  // Queued is the one that looks like a bug and is not, and a reported failure has no reason to show.
  assert.match(r, /it may have gone, so it is never sent again on its own/);
  assert.match(r, /the operator reported it undelivered and gave no reason/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-dashboard.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# pass 4`, `# fail 4` (`openBatch missing`).

- [ ] **Step 3: Patch the page**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp public/owner.html public/owner.html.bak-planC-t7-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 7:" 1 /tmp/t7_detail.py && python3 /tmp/t7_detail.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/public/owner.html'
s = io.open(p, encoding='utf-8', newline='').read()
if 'function openBatch' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

# 1. The legend goes at the foot of the tab.
rep("""    + '<div class="card p-4" id="msg-actions"><div class="text-[11px] text-slate-400">✅ …</div></div>';
  loadSmsMonth(); loadPending(); loadBatches(); loadActions();""",
"""    + '<div class="card p-4" id="msg-actions"><div class="text-[11px] text-slate-400">✅ …</div></div>'
    + '<div class="card p-4"><div class="font-black text-sm mb-1">ℹ️ What the words mean · ትርጉማቸው</div>'
    + '<div class="text-[10px] text-slate-500 space-y-1">'
    + '<div>✅ <b>delivered · ደርሷል</b> — the mobile operator reported it delivered to the handset.</div>'
    + '<div>📤 <b>sent · ተልኳል</b> — Telegram or the SMS provider accepted it. Most SMS stay here: a delivery report only arrives if the provider sends one.</div>'
    + '<div>⏳ <b>queued · በመጠባበቅ</b> — the provider took it but the record was not written afterwards; it may have gone, so it is never sent again on its own.</div>'
    + '<div>⚠️ <b>failed · አልተሳካም</b> — it did not go. With no reason beside it, the operator reported it undelivered and gave no reason.</div>'
    + '<div>📭 <b>not reachable · አልተደረሰም</b> — no Telegram link and no mobile number the provider can reach.</div>'
    + '<div>🧪 <b>test · ሙከራ</b> — recorded only. Nothing left the server.</div>'
    + '</div></div>';
  loadSmsMonth(); loadPending(); loadBatches(); loadActions();""")

# 2. The drill-down and the action history, after the batch list.
rep("""function msgPage(d){ MSG.page = Math.max(0, MSG.page + d); MSG.open = null; loadBatches(); }""",
"""function msgPage(d){ MSG.page = Math.max(0, MSG.page + d); MSG.open = null; loadBatches(); }
// One batch by unit. The server sends a unit number and nothing else about the tenant; the reason is whatever the
// delivery layer or the operator recorded, shown as text because it has no fixed vocabulary.
async function openBatch(id, keepPage){
  var box = document.getElementById('batch-' + id); if (!box) return;
  if (MSG.open === id && !keepPage) { MSG.open = null; box.innerHTML = ''; return; }
  if (!keepPage) MSG.rpage = 0;
  MSG.open = id;
  box.innerHTML = '<div class="text-[10px] text-slate-400 mt-1">…</div>';
  try{
    var r = await kfetch('/api/owner/' + slug + '/messages/' + encodeURIComponent(id) + '?page=' + (MSG.rpage || 0));
    if (!r.ok) { box.innerHTML = ''; return; }
    var d = await r.json();
    var rows = (d.rows || []).map(function(x){
      return '<div class="flex items-center gap-2 text-[10px] py-1 border-b" style="border-color:#e9f0ee">'
        + '<span class="font-black" style="width:64px">' + esc(x.unit) + '</span>'
        + '<span class="flex-1">' + esc(msgLabel(MSG_STATE, x.present)) + ' · ' + esc(x.channel)
        + (x.reason ? ' · ' + esc(x.reason) : '') + '</span></div>';
    }).join('');
    box.innerHTML = '<div class="mt-2 rounded-xl p-2" style="background:#fff;border:1px solid #e9f0ee">'
      + (d.text ? '<div class="text-[10px] text-slate-600 mb-1" style="white-space:pre-wrap">' + esc(d.text) + '</div>' : '')
      + (rows || '<div class="text-[10px] text-slate-400">No recipients recorded · የለም</div>')
      + msgPager(d.page, d.pages, 'batchPage') + '</div>';
  } catch (e) { box.innerHTML = ''; }
}
function batchPage(dir){ MSG.rpage = Math.max(0, (MSG.rpage || 0) + dir); openBatch(MSG.open, true); }
var MSG_ACT = { message: 'መልእክት · message', remind_unpaid: 'ማስታወሻ · reminders', send_invoice: 'ደረሰኝ ላክ · send invoice',
  create_invoices: 'ደረሰኞች አዘጋጅ · create invoices', record_payment: 'ክፍያ መዝግብ · record payment' };
var MSG_ST = { done: '✅ ተከናውኗል · done', failed: '⚠️ አልተሳካም · failed', refused: '⛔ አልተፈቀደም · refused',
  cancelled: '✖ ተሰርዟል · cancelled', expired: '⏱ ጊዜው አልፎበታል · expired', replaced: '🔄 ተቀይሯል · replaced',
  pending: '⏳ በመጠባበቅ · waiting', running: '⏳ በሂደት · running' };
var MSG_CH = { 'owner-telegram': 'Telegram', 'owner-web': 'dashboard' };
// What came of the actions the owner confirmed in the Bini chat, after that chat is closed (design §3.3). The server
// sends a role and a channel; there is no id here to press, and nothing that was in the preview card.
async function loadActions(){
  var box = document.getElementById('msg-actions'); if (!box) return;
  try{
    var r = await kfetch('/api/owner/' + slug + '/owner-actions?page=' + (MSG.apage || 0));
    if (!r.ok) { box.innerHTML = ''; return; }
    var d = await r.json();
    var rows = (d.actions || []).map(function(a){
      var c = a.counts, bits = [];
      if (c) bits.push('📤 ' + esc(c.sent) + ' · 🧪 ' + esc(c.test) + ' · ⚠️ ' + esc(c.failed) + ' · 📭 ' + esc(c.notReachable));
      if (a.created != null) bits.push('created ' + esc(a.created) + (a.skipped ? ', skipped ' + esc(a.skipped) : '')
        + (a.month ? ' · ' + esc(a.month) : ''));
      if (a.unit) bits.push('unit ' + esc(a.unit) + (a.totalEtb ? ' · ' + esc(a.totalEtb) + ' ETB' : ''));
      if (a.notReached && a.notReached.length) bits.push('not reached: ' + a.notReached.map(function(u){ return esc(u); }).join(', '));
      if (a.reason) bits.push('reason: ' + esc(a.reason));
      return '<div class="flex items-start gap-2 text-[11px] py-1.5 border-b" style="border-color:#e9f0ee"><span class="flex-1">'
        + '<b>' + esc(msgLabel(MSG_ACT, a.kind)) + '</b> · ' + esc(msgLabel(MSG_ST, a.status))
        + '<br><span class="text-[9px] text-slate-400">' + esc(String(a.confirmedAt || a.at).slice(0, 10))
        + ' · prepared by ' + esc(msgLabel(MSG_BY, a.preparedBy)) + ' · ' + esc(msgLabel(MSG_CH, a.channel))
        + (a.confirmedBy ? ' · confirmed by ' + esc(msgLabel(MSG_BY, a.confirmedBy)) : '')
        + (a.urgent ? ' · ⚠️ urgent' : '') + '</span>'
        + (bits.length ? '<br><span class="text-[10px]" style="color:#475569">' + bits.join(' · ') + '</span>' : '')
        + '</span></div>';
    }).join('');
    box.innerHTML = '<div class="font-black text-sm mb-1">✅ Actions you confirmed · ያረጋገጧቸው ትዕዛዞች (' + esc(d.total) + ')</div>'
      + '<div class="text-[10px] text-slate-500 mb-2">What Bini prepared and what came of it. · ቢኒ ያዘጋጀው እና ውጤቱ።</div>'
      + (rows || '<div class="text-xs text-slate-400">No actions yet · እስካሁን የለም</div>')
      + msgPager(d.page, d.pages, 'actPage');
  } catch (e) { box.innerHTML = ''; }
}
function actPage(dir){ MSG.apage = Math.max(0, (MSG.apage || 0) + dir); loadActions(); }""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: The script must parse, and the tests must pass**

Run: `ssh root@31.97.176.180 'sh /tmp/check-owner-js.sh'`
Expected: `owner.html inline script: parses`
Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/messages-dashboard.test.js test/owner-dashboard-escape.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 12
# fail 0
```
(8 in the Messages test, 4 in the escape test.)

- [ ] **Step 5: Full suite** (+4)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1145
# pass 1145
# fail 0
```

- [ ] **Step 6: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 7:" 4 /tmp/planC-msg.txt && git add public/owner.html test/messaging/messages-dashboard.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Messages: a batch opened unit by unit, the actions confirmed, and what the words mean

Details on a batch opens it under itself: the notice as it was sent, then one line per recipient with the unit, what
became of it, which channel carried it and the reason if there was one. The unit number is the only thing about a
tenant that reaches the page — the server sends nothing else.

Under it, the record of the actions the owner confirmed in the Bini chat: the kind, the outcome, the role and channel
it was prepared from, who confirmed it, the counts, the units not reached and the reason a refusal was refused. There
is no id in that list; there is nothing to press, and nothing from the preview card, which may hold a name.

And a legend, because two of the six words mislead on their own: queued is not a failure — the provider took the
message and the record write after it did not land, so it may have gone and is never re-sent by itself — and a failure
with no reason beside it is the operator reporting it undelivered without saying why.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 8: "Waiting to be delivered" moves in, and the two doors that lead to it

The list of invoices that did not reach the tenant belongs with the messages. Invoices keeps a one-line count that opens the tab; the tenant Telegram card in Settings gets a link to it too. **`loadPending` itself is not touched** — the same function, the same `#pending-deliv` box, the same Send now with the same test-mode wording — it simply now renders inside the Messages tab. Plan A pinned its Invoices call site in `test/messaging/dashboard.test.js`, so that test moves with it, in this commit.

**Files:**
- Modify: `public/owner.html`
- Modify: `test/messaging/dashboard.test.js`

- [ ] **Step 1: Write the failing tests** — two new ones, and the Plan A anchor moved

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp test/messaging/dashboard.test.js test/messaging/dashboard.test.js.bak-planC-t8-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 8:" 0 /tmp/t8_tests.py && python3 /tmp/t8_tests.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/test/messaging/dashboard.test.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'pending-line' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

# Plan A pinned the pending list to the Invoices tab. It lives in Messages now; Invoices keeps a one-line count.
# The intent is unchanged: the list is loaded where it is rendered, and Send now still refreshes what is on screen.
rep("""test('Invoices lists what did not reach tenants with Send now, and Send tells sent, test mode and not delivered apart', () => {
  assert.ok(HTML.includes('<div id="pending-deliv"></div>'));
  assert.match(HTML, /: ''\\}`;\\n    loadPending\\(\\);\\n  \\}/);""",
"""test('Messages lists what did not reach tenants with Send now, and Send tells sent, test mode and not delivered apart', () => {
  assert.ok(HTML.includes("+ '<div id=\\"pending-deliv\\"></div>'"), 'the list is rendered inside the Messages tab');
  assert.match(HTML, /loadSmsMonth\\(\\); loadPending\\(\\); loadBatches\\(\\); loadActions\\(\\);/);
  assert.match(HTML, /: ''\\}`;\\n    loadPendingCount\\(\\);\\n  \\}/, 'Invoices loads only the count line');""")

rep("""  assert.match(send, /loadPending\\(\\);/);
  assert.doesNotMatch(send, /WhatsApp/);""",
"""  assert.match(send, /loadPending\\(\\); loadPendingCount\\(\\);/, 'both the list and the count line are refreshed');
  assert.doesNotMatch(send, /WhatsApp/);""")

s += """
// ===== Plan C: the two doors to the Messages tab =====

test('Invoices keeps one line with the count, and it opens the Messages tab', () => {
  assert.ok(HTML.includes('<div id="pending-line"></div>'));
  const load = fn('loadPendingCount');
  assert.match(load, /kfetch\\('\\/api\\/owner\\/' \\+ slug \\+ '\\/pending-deliveries'\\)/);
  assert.match(load, /var n = \\(d\\.invoices \\|\\| \\[\\]\\)\\.length;/);
  assert.ok(load.includes('esc(n)'), 'the count is escaped');
  assert.match(load, /onclick="setTab\\(\\\\'messages\\\\'\\)"/);
  assert.match(load, /ያልደረሱ/);
  // Nothing to say when nothing is waiting.
  assert.match(load, /: '';/);
});

test('the tenant Telegram card in Settings points at the Messages tab', () => {
  const load = fn('loadTenantTg');
  assert.match(load, /onclick="setTab\\(\\\\'messages\\\\'\\)"/);
  assert.match(load, /📨 See all messages · ሁሉንም መልእክቶች ይመልከቱ/);
  // The card still does everything Plan A gave it.
  for (const v of ['esc(d.linked)', 'esc(d.active)', 'jsq(d.poster)', 'esc(d.startLink)', 'esc(u.unit)', 'jsq(u.tenancyId)'])
    assert.ok(load.includes(v), v);
});
"""

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/dashboard.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 3` (the moved test and the two new ones).

- [ ] **Step 3: Patch the page**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp public/owner.html public/owner.html.bak-planC-t8-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 8:" 1 /tmp/t8_move.py && python3 /tmp/t8_move.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'
p = root + '/public/owner.html'
s = io.open(p, encoding='utf-8', newline='').read()
if 'loadPendingCount' in s: sys.exit('already patched')
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    s = s.replace(old, new)

# 1. Invoices keeps a one-line count where the list used to be.
rep("""    <div id="pending-deliv"></div>""", """    <div id="pending-line"></div>""")
rep("""    loadPending();
  }

  if (TAB === 'acct'){""", """    loadPendingCount();
  }

  if (TAB === 'acct'){""")

# 2. Send now refreshes whichever of the two is on screen; each is a no-op when its box is not there.
rep("""  loadPending();
}
async function genInvoices(){""", """  loadPending(); loadPendingCount();
}
async function genInvoices(){""")

# 3. The count line itself, beside the list it summarises.
rep("""async function vatSettings(){""",
"""// The same list, counted, for the Invoices tab. One line, or nothing at all when nothing is waiting.
async function loadPendingCount(){
  var box = document.getElementById('pending-line'); if (!box) return;
  try{
    var r = await kfetch('/api/owner/' + slug + '/pending-deliveries'); if (!r.ok) { box.innerHTML = ''; return; }
    var d = await r.json();
    var n = (d.invoices || []).length;
    box.innerHTML = n ? '<div class="card p-3 flex items-center gap-2"><span class="flex-1 text-[11px] text-amber-700">📭 <b>'
      + esc(n) + '</b> waiting to be delivered · ያልደረሱ</span>'
      + '<button class="tag" style="background:#0088cc;color:#fff" onclick="setTab(\\'messages\\')">📨 Messages</button></div>' : '';
  } catch (e) { box.innerHTML = ''; }
}
async function vatSettings(){""")

# 4. The tenant Telegram card leads to the same place.
rep("""      + (rows ? '<div class="mt-2">' + rows + '</div>' : '');""",
"""      + '<button class="mbtn w-full mt-1" style="background:#f1f5f9;color:#334155;padding:10px" onclick="setTab(\\'messages\\')">📨 See all messages · ሁሉንም መልእክቶች ይመልከቱ</button>'
      + (rows ? '<div class="mt-2">' + rows + '</div>' : '');""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 4: The script must parse, and every dashboard test must pass**

Run: `ssh root@31.97.176.180 'sh /tmp/check-owner-js.sh'`
Expected: `owner.html inline script: parses`
Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/messaging/dashboard.test.js test/messaging/messages-dashboard.test.js test/owner-dashboard-escape.test.js test/owner/actions-dashboard.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected:
```
# pass 20
# fail 0
```
(7 in `dashboard.test.js`, 8 in `messages-dashboard.test.js`, 4 in the escape test, 1 in `actions-dashboard.test.js`.)

- [ ] **Step 5: See both doors in the served page**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && sh /tmp/t8-check.sh'` after slicing block 2 to `/tmp/t8-check.sh`:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 8:" 3 /tmp/t8-check.sh'`

```sh
#!/bin/sh
p=$(curl -s http://127.0.0.1:4210/owner/century-mall)
echo "pending-line   : $(printf '%s' "$p" | grep -c 'id="pending-line"')  (1)"
echo "pending-deliv  : $(printf '%s' "$p" | grep -c 'id=\\"pending-deliv\\"')  (1 — inside renderMessages now)"
echo "loadPendingCount: $(printf '%s' "$p" | grep -c 'loadPendingCount')  (4)"
echo "setTab messages: $(printf '%s' "$p" | grep -c "setTab..messages")  (4)"
```

Expected:
```
pending-line   : 1  (1)
pending-deliv  : 1  (1 — inside renderMessages now)
loadPendingCount: 4  (4)
setTab messages: 4  (4)
```
(`setTab('messages')` appears in the tab button, the count line, the Telegram card and — as `setTab('messages')` inside `renderTab` — the render hook. If a count is one off, read the page before changing anything: the numbers are a sanity check, not the test.)
Then: `ssh root@31.97.176.180 'rm -f /tmp/t8-check.sh'`

- [ ] **Step 6: Full suite** (+2)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1147
# pass 1147
# fail 0
```

- [ ] **Step 7: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 8:" 6 /tmp/planC-msg.txt && git add public/owner.html test/messaging/dashboard.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
Waiting to be delivered moves to Messages, with a line left behind on Invoices

The list of invoices that did not reach the tenant belongs beside the other messages, so it renders there now. The
function, the box and the Send now button are untouched — the same send, the same wording for sent, test mode and not
delivered — it is only where it appears that changed.

Invoices keeps a single line with the count, which opens the tab, and shows nothing at all when nothing is waiting.
The tenant Telegram card in Settings gets the same link. A send refreshes whichever of the two is on screen.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 9: Two corrections carried over from the Plan B review

Two small things belong with this work rather than in a plan of their own. The `OwnerAction` comment claims no tenant name is stored in that table, and `cardText` is a preview that can hold an occupant's name — the comment has to say so, and say where that name may and may not go. And the ops side needs one read-only line about the Messages data; `ops/messaging/sms-status.js` already reports the SMS month, so it gains the line rather than growing a second script beside it — which also means making it importable, so the line can be tested without a database.

**Files:**
- Modify: `prisma/schema.prisma` (a comment; **no column, no index, no migration**)
- Modify: `test/owner/actions-schema.test.js`
- Modify: `ops/messaging/sms-status.js`
- Modify: `test/messaging/ops.test.js`

- [ ] **Step 1: Write the failing tests**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp test/owner/actions-schema.test.js test/owner/actions-schema.test.js.bak-planC-t9-$(date +%Y%m%d-%H%M%S) && cp test/messaging/ops.test.js test/messaging/ops.test.js.bak-planC-t9-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 9:" 0 /tmp/t9_tests.py && python3 /tmp/t9_tests.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'

p = root + '/test/owner/actions-schema.test.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'occupant' in s: sys.exit('already patched: schema test')
s += """
// Plan C review: the comment above the table said no tenant name is stored in it, and cardText is a preview that can
// hold one. Somebody reading the table has to be told, and told where that name may go.
test('the comment says cardText may hold an occupant name, and where that name may not travel', () => {
  const at = schema.indexOf('// An owner action waiting for');
  assert.ok(at > 0, 'the comment above model OwnerAction is missing');
  const note = schema.slice(at, schema.indexOf('model OwnerAction {', at));
  assert.match(note, /cardText/);
  assert.match(note, /occupant name/);
  assert.match(note, /never reaches the model/);
  assert.match(note, /never leaves in a response/);
  // The claim that has to go, because it was not true of cardText.
  assert.equal(/no tenant name is stored here/.test(note), false);
});
"""
io.open(p, 'w', encoding='utf-8', newline='').write(s)

p = root + '/test/messaging/ops.test.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'batchLine' in s: sys.exit('already patched: ops test')
s += """
// Plan C: the SMS status report gains one line about the batches behind those parts. It is the same script, not a
// second one — and requiring it must not open a database connection, or this test file could not exist.
const { batchLine } = require('../../ops/messaging/sms-status');

test('the batch line counts this month by kind, in a fixed order, and says so when there are none', () => {
  assert.equal(batchLine([{ kind: 'invoice', _count: 3 }, { kind: 'notice', _count: 1 }]),
    'batches this month · notice 1 · invoice 3 · 4 in all');
  assert.equal(batchLine([{ kind: 'receipt', _count: 2 }, { kind: 'otp', _count: 5 }]),
    'batches this month · receipt 2 · otp 5 · 7 in all');
  assert.equal(batchLine([]), 'batches this month · none');
  assert.equal(batchLine(null), 'batches this month · none');
});

test('requiring the SMS status script connects to nothing and prints nothing', () => {
  const mod = require('../../ops/messaging/sms-status');
  assert.equal(typeof mod.batchLine, 'function');
  assert.equal(typeof mod.run, 'function');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'ops', 'messaging', 'sms-status.js'), 'utf8');
  assert.match(src, /if \\(require\\.main === module\\)/);
  // new PrismaClient() and dotenv belong inside that guard: this test file requires the module.
  const guard = src.indexOf('if (require.main === module)');
  assert.ok(src.indexOf('new PrismaClient()') > guard, 'a client is built only when the script is run');
  assert.ok(src.indexOf("require('dotenv')") > guard, 'the environment is read only when the script is run');
});
"""
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
```

- [ ] **Step 2: Run them to see them fail**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/owner/actions-schema.test.js test/messaging/ops.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 3`.

- [ ] **Step 3: Correct the comment and restructure the ops script**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && cp prisma/schema.prisma prisma/schema.prisma.bak-planC-t9-$(date +%Y%m%d-%H%M%S) && cp ops/messaging/sms-status.js ops/messaging/sms-status.js.bak-planC-t9-$(date +%Y%m%d-%H%M%S) && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 9:" 1 /tmp/t9_fix.py && python3 /tmp/t9_fix.py /var/www/connectcare/binasmart'`

```python
import io, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/var/www/connectcare/binasmart'

p = root + '/prisma/schema.prisma'
s = io.open(p, encoding='utf-8', newline='').read()
if 'occupant name' in s: sys.exit('already patched: schema')
def rep(text, old, new):
    n = text.count(old)
    if n != 1: sys.exit('anchor %d: %s' % (n, old[:70]))
    return text.replace(old, new)

# The comment above the table. It is outside model OwnerAction { … }, which is why it may use the word the field
# comments inside the model must not (test/owner/actions-schema.test.js checks the model itself for it).
s = rep(s, """// server can never run it twice. No phone number and no tenant name is stored here: payload holds ids, unit numbers and
// amounts, text holds the notice the owner confirmed, cardText the preview they read.""",
"""// server can never run it twice. No phone number is stored here: payload holds ids, unit numbers and amounts, text
// holds the notice the owner confirmed, cardText the preview they read.
//
// cardText MAY HOLD AN OCCUPANT NAME. A preview for one unit reads back who it is about, and the owner is entitled to
// see that — they typed it in. It is stored so the result can be shown under the card the owner already read. It
// never reaches the model (the [[P1]] token rule in agents/owner replaces names before a turn) and it never leaves in
// a response: agents/owner/actions/history.js, which is the only thing that reads this table for the dashboard, does
// not select it. Anything new that reads OwnerAction must leave it, and args and payload, where they are.""")
io.open(p, 'w', encoding='utf-8', newline='').write(s)

p = root + '/ops/messaging/sms-status.js'
s = io.open(p, encoding='utf-8', newline='').read()
if 'batchLine' in s: sys.exit('already patched: ops')
io.open(p, 'w', encoding='utf-8', newline='').write("""'use strict';
// Read-only: how SMS is set up. Mode, whether a provider token / shortcode / report secret exist (yes or no, never the
// values), each building's monthly limit and SMS parts this month with a cost estimate from the configured price tiers,
// this month's messages by channel and status, the batches behind them by kind, and with --balance the GeezSMS balance
// (numbers only). Sends nothing, writes nothing.
//   node ops/messaging/sms-status.js [--balance]
//
// The batch line is the ops view of what the owner's Messages tab shows (design §4). It is here rather than in a second
// script because everything else about the month is already here; per-building and per-action detail belongs to
// ops/owner/actions.js list, which is not duplicated.
const KIND_ORDER = ['notice', 'reminder', 'invoice', 'receipt'];

// rows: an OutboundBatch groupBy on kind. Known kinds first in a fixed order, then anything else as it came.
function batchLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'batches this month · none';
  const rank = k => { const i = KIND_ORDER.indexOf(k); return i === -1 ? KIND_ORDER.length : i; };
  const sorted = list.slice().sort((a, b) => rank(a.kind) - rank(b.kind));
  const total = sorted.reduce((n, r) => n + (Number(r._count) || 0), 0);
  return 'batches this month · ' + sorted.map(r => r.kind + ' ' + (Number(r._count) || 0)).join(' · ') + ' · ' + total + ' in all';
}

async function run({ prisma: p, env, out = console.log, balance = false }) {
  const { makeSmsFromEnv, makeGeezSms, parsePriceTiers, smsUnitPrice } = require('../../messaging/sms');
  const { addisMonthStart } = require('../../messaging/delivery');
  const sms = makeSmsFromEnv(env);
  const tiers = parsePriceTiers(env.SMS_PRICE_TIERS);
  out('mode ' + sms.mode + ' · provider ' + (sms.provider || 'none') + ' · token ' + (env.SMS_API_TOKEN ? 'yes' : 'no')
    + ' · shortcode ' + (env.SMS_SHORTCODE_ID ? 'yes' : 'no (provider default)')
    + ' · report secret ' + ((env.SMS_CALLBACK_SECRET || '').length >= 24 ? 'yes' : 'no'));
  const since = addisMonthStart(new Date());
  const statuses = sms.mode === 'live' ? ['queued', 'sent', 'delivered'] : ['queued', 'sent', 'delivered', 'test'];
  const byBuilding = await p.outboundMessage.groupBy({ by: ['buildingId'], where: { channel: 'sms', status: { in: statuses }, createdAt: { gte: since } }, _sum: { smsParts: true } });
  const total = byBuilding.reduce((a, r) => a + (r._sum.smsParts || 0), 0);
  const price = smsUnitPrice(total, tiers);
  const used = new Map(byBuilding.map(r => [r.buildingId, r._sum.smsParts || 0]));
  // real buildings: NOTIFY_WHITELIST in server.js (today darulle only)
  for (const b of await p.building.findMany({ where: { qrSlug: { in: ['darulle'] } }, select: { id: true, qrSlug: true, smsMonthlyLimit: true, smsSender: true } }))
    out(b.qrSlug + ' · limit ' + b.smsMonthlyLimit + ' · parts this month ' + (used.get(b.id) || 0) + ' · sender ' + (b.smsSender ? 'set' : 'provider default'));
  out('all buildings · parts this month ' + total + ' · ' + price + ' ETB/SMS · estimate ' + (Math.round(total * price * 100) / 100) + ' ETB' + (sms.mode === 'test' ? ' (test rows, nothing was sent)' : ''));
  const month = await p.outboundMessage.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: true });
  out('this month · ' + (month.map(r => r.channel + '/' + r.status + ' ' + r._count).join(' · ') || 'no messages'));
  out(batchLine(await p.outboundBatch.groupBy({ by: ['kind'], where: { createdAt: { gte: since } }, _count: true })));
  if (balance) {
    if (!env.SMS_API_TOKEN) out('balance · no token');
    else {
      const r = await makeGeezSms({ token: env.SMS_API_TOKEN }).balance();
      const nums = r.body && typeof r.body === 'object' ? Object.entries(r.body).filter(([, v]) => typeof v === 'number').map(([k, v]) => k + '=' + v) : [];
      out('balance · http ' + r.status + ' · ' + (nums.join(' ') || 'no numeric fields; field names: ' + Object.keys(r.body || {}).join(',')));
    }
  }
  return { ok: true };
}

module.exports = { batchLine, run, KIND_ORDER };

// Nothing above this line reads the environment or opens a connection, so the tests can require this file.
if (require.main === module) {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run({ prisma, env: process.env, balance: process.argv.includes('--balance') })
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
""")
print('ok')
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node --test test/owner/actions-schema.test.js test/messaging/ops.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"'`
Expected: `# fail 0`.

- [ ] **Step 5: The schema still validates, and the change really is a comment**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npx prisma validate 2>&1 | tail -2'`
Expected: `The schema at prisma/schema.prisma is valid 🚀`
Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && git diff --stat prisma/schema.prisma && git diff prisma/schema.prisma | grep -c "^[+-][^+-]"'`
Expected: a handful of changed lines, **every one of them beginning with `//`** — check the diff by eye. If a line that is not a comment appears, stop: this task changes no column.

- [ ] **Step 6: The ops script still runs**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node ops/messaging/sms-status.js'`
Expected (today's data):
```
mode test · provider none · token no · shortcode no (provider default) · report secret no
darulle · limit 500 · parts this month 0 · sender provider default
all buildings · parts this month 0 · 0.7475 ETB/SMS · estimate 0 ETB (test rows, nothing was sent)
this month · no messages
batches this month · none
```
(The two backfilled rows are from an earlier month, so this month is empty. If the month has rows, the counts will differ — the last line is the new one.)

- [ ] **Step 7: Full suite** (+3)

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1150
# pass 1150
# fail 0
```

- [ ] **Step 8: Commit**

`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && rm -f /tmp/planC-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 9:" 4 /tmp/planC-msg.txt && git add prisma/schema.prisma ops/messaging/sms-status.js test/owner/actions-schema.test.js test/messaging/ops.test.js && git commit -q -F /tmp/planC-msg.txt && git log --oneline -1'`

```
OwnerAction: say that cardText may hold a name, and report the batches with the parts

The comment above the table said no tenant name is stored in it. cardText is the preview the owner read, and a preview
for one unit names the occupant, so that was not true and someone reading the table would have believed it. It now
says what cardText can hold, why it is kept, and the two places it must never go: the model never sees it, and the
history the dashboard reads does not select it. No column changed — this is a comment.

The SMS status report gains one line: the batches behind this month's parts, by kind. It goes in the script that
already reports the month rather than a second one beside it, and the script became importable so the line could be
tested — the client and the environment are now built only when it is actually run.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 10: Close out

**Files:** none — this task changes nothing. It checks what nine commits left behind and reports it.

- [ ] **Step 1: The suite, whole**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E "^# (tests|pass|fail)"'`
Expected:
```
# tests 1150
# pass 1150
# fail 0
```

- [ ] **Step 2: The repo is clean and the commits are there**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && git status --short | grep -v "^??" ; git log --oneline -10'`
Expected: no modified file listed, and nine Plan C commits above `9bb1581` (plus the commit that added this plan).

- [ ] **Step 3: The server is healthy and the page is whole**

Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && curl -s http://127.0.0.1:4210/health'` → `{"ok":true,…}`
Run: `ssh root@31.97.176.180 'sh /tmp/check-owner-js.sh'` → `owner.html inline script: parses`
Run: `ssh root@31.97.176.180 'tail -n 5 /root/.pm2/logs/binasmart-api-error.log'` → nothing timestamped after the last restart.

- [ ] **Step 4: Walk the tab as an owner would, on the DEMO building**

Slice the script and run it; it mints a key, reads every route the tab reads, prints shapes, and destroys the key:
`ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-messages-tab.md "### Task 10:" 1 /tmp/t10_walk.js && node /tmp/t10_walk.js && rm -f /tmp/t10_walk.js'`

```js
'use strict';
// The whole Messages tab as one pass, on a DEMO building, read-only, with a key destroyed at the end. It prints
// shapes and counts only: no phone number, no name, no key, no token, no message text.
const ROOT = '/var/www/connectcare/binasmart';
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { PrismaClient } = require(ROOT + '/node_modules/@prisma/client');
const { makeOwnerKeys, hashKey } = require(ROOT + '/building/ownerKeys');
const SLUG = 'century-mall';
// preparedBy is NOT here: it is a field name the history returns on purpose, and its value is a role, never an id.
const BANNED = ['phone', 'userId', 'providerId', 'tenancyId', 'preparedTg', 'cardText', 'fingerprint', 'args', 'payload', 'token', 'geezsms'];

(async () => {
  const prisma = new PrismaClient();
  const keys = makeOwnerKeys({ prisma });
  const b = await prisma.building.findUnique({ where: { qrSlug: SLUG }, select: { id: true, qrSlug: true } });
  if (!b) throw new Error('demo building not found: ' + SLUG);
  const key = await keys.issue(b.id, b.qrSlug, 'planC-walk');
  const seen = [];
  const get = async path => {
    const r = await fetch('http://127.0.0.1:4210/api/owner/' + SLUG + path, { headers: { 'x-owner-key': key } });
    const body = await r.json().catch(() => null);
    seen.push(body);
    return { status: r.status, body };
  };
  try {
    const m = await get('/messages');
    console.log('messages        · http ' + m.status + ' · total ' + (m.body || {}).total + ' · page ' + (m.body || {}).page + '/' + (m.body || {}).pages);
    console.log('filters         · kinds ' + JSON.stringify((m.body || {}).kinds) + ' · months ' + JSON.stringify((m.body || {}).months));
    const filtered = await get('/messages?kind=notice&month=2026-09&page=0');
    console.log('filtered        · http ' + filtered.status + ' · kind ' + JSON.stringify((filtered.body || {}).kind) + ' · month ' + JSON.stringify((filtered.body || {}).month));
    const junk = await get('/messages?kind=../../etc&month=whenever&page=-5');
    console.log('junk filters    · http ' + junk.status + ' · kind ' + JSON.stringify((junk.body || {}).kind) + ' · month ' + JSON.stringify((junk.body || {}).month) + ' · page ' + (junk.body || {}).page);
    const first = ((m.body || {}).batches || [])[0];
    if (first) {
      const one = await get('/messages/' + encodeURIComponent(first.id));
      console.log('drill-down      · http ' + one.status + ' · rows ' + ((one.body || {}).rows || []).length
        + ' · units ' + JSON.stringify(((one.body || {}).rows || []).map(r => r.unit).slice(0, 5)));
    } else {
      console.log('drill-down      · no batch on this demo building; the empty list is what the owner sees');
    }
    console.log('foreign batch   · http ' + (await get('/messages/ckdoesnotexist000000000')).status + ' (must be 404)');
    const s = await get('/sms-month');
    console.log('sms-month       · http ' + s.status + ' · ' + JSON.stringify(s.body));
    const a = await get('/owner-actions');
    console.log('owner-actions   · http ' + a.status + ' · total ' + (a.body || {}).total);
    const all = JSON.stringify(seen);
    console.log('leak check      · ' + BANNED.map(w => w + ':' + (all.includes(w) ? 'FOUND' : 'no')).join(' '));
  } finally {
    const gone = await prisma.ownerKey.deleteMany({ where: { keyHash: hashKey(key) } });
    const left = await prisma.ownerKey.count({ where: { buildingId: b.id, label: { in: ['planC-walk', 'planC-check'] } } });
    console.log('throwaway key   · deleted ' + gone.count + ' · labelled keys left ' + left + ' (must be 0)');
    await prisma.$disconnect();
  }
})().catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
```

Expected:
```
messages        · http 200 · total 0 · page 0/1
filters         · kinds ["notice","reminder","invoice","receipt"] · months ["2026-09"]
filtered        · http 200 · kind "notice" · month "2026-09"
junk filters    · http 200 · kind "" · month "" · page 0
drill-down      · no batch on this demo building; the empty list is what the owner sees
foreign batch   · http 404 (must be 404)
sms-month       · http 200 · {"mode":"test","parts":0,"testParts":0,"limit":500,"remaining":500,"unitPriceEtb":0.7475,"costEtb":0,"balance":{"state":"off"}}
owner-actions   · http 200 · total 0
leak check      · phone:no userId:no providerId:no tenancyId:no preparedTg:no cardText:no fingerprint:no args:no payload:no token:no geezsms:no
throwaway key   · deleted 1 · labelled keys left 0 (must be 0)
```
Any `FOUND`, any status other than the ones named, or a key left behind is a stop: report it before doing anything else.

- [ ] **Step 5: Darulle is untouched**

Read-only, and it must print exactly what it printed before Plan C began:
Run: `ssh root@31.97.176.180 'cd /var/www/connectcare/binasmart && node ops/owner/actions.js list darulle'`
Expected: `Owner actions ON since …`, `Staff may confirm OFF`, `pending previews: 0 · confirmed in the last 24 h: 0` (or whatever the real owner has genuinely done since — the point is that nothing in this plan changed it).
**Do not** run anything that sends, confirms, or switches. The Darulle owner's dashboard now has the tab; nobody needs to be told to try it.

- [ ] **Step 6: Report to the coordinator**

- the nine commits, one line each;
- the four routes and the shape each answers with;
- that the tab is live for every building and shows an empty state today, because `OutboundBatch` holds two rows and `OwnerAction` none;
- that `delivered` cannot appear until GeezSMS is configured to call the report route — no row has ever carried a `providerId`;
- that the balance shows "off" until `SMS_API_TOKEN` is set, and what it showed if it is;
- the two corrections from the Plan B review (the `OwnerAction` comment; the batch line in `ops/messaging/sms-status.js`);
- and what is left for Plan D.

---

## Risks, and what Ibrahim or the owner decides

- **The tab ships empty, and that is what most owners will see for a while.** Two message rows exist in the whole database and no owner action has ever been prepared. Every list therefore has to read well with nothing in it, and the live checks in Tasks 5 and 10 are checks of the empty state. The first real content will arrive the first time the Darulle owner confirms something.
- **`delivered` will stay at zero until the provider is told where to report.** No row has ever carried a `providerId`, which means GeezSMS has never called the report route. The `callback` parameter is sent on every send when `SMS_CALLBACK_SECRET` is at least 24 characters — so if the secret is unset, no report can ever arrive and every SMS will sit at "sent" forever. Worth checking with Ibrahim before the tab makes that visible to an owner.
- **A failure reported by the operator has no reason to show.** `markByProvider` writes only the status, so the drill-down shows "failed" with nothing beside it. The legend says what that means. Giving it a reason would mean writing an `errorKind` from the report, which changes the delivery layer and belongs in its own change.
- **The cost is an estimate and will not match an invoice.** GeezSMS prices by the whole account's monthly count, so a building's share depends on what every other building sent; the part counting is our own (UCS-2 70/67, GSM-7 160/153) and the provider's may differ. The card says "estimate · ግምት" for exactly this reason. If Ibrahim wants a figure that matches the bill, that is a reconciliation against the provider's own report, not this tab.
- **The balance is the whole account's, not the building's.** An owner of one building sees the BinaSmart account balance. That is fine while Ibrahim pays for the SMS; it stops being fine the day a building is billed separately, and then the line should be hidden per building rather than reworded.
- **Ten minutes of cache means an owner can watch a send and not see the balance move.** That is the trade for not calling the provider on every page load. If it confuses someone, the fix is a "read again" button that clears the cache, not a shorter cache.
- **A batch id is now visible to the owner's browser.** It is a cuid in a `<button onclick>` and in one `<div id>`, both escaped; it identifies a batch of their own building and the route refuses any other. It is not a secret the way a pending action's id is — which is why that one is not returned at all.
- **`test` rows are counted separately from the limit, which differs from the ops script.** `ops/messaging/sms-status.js` folds test rows into its own per-month display when the mode is test; the dashboard does not, because the limit does not. The two numbers will disagree while SMS is in test mode, and the dashboard's is the one that answers "can I send".
- **The month filter trusts the batch date, not the message date.** A batch sent at 23:55 whose last recipient is written after midnight is one batch, on the day it started. This is the only sensible reading and is worth knowing when a count is compared with a provider's daily report.
- **Every building now has the tab, including the twenty-eight that can reach nobody.** For them the card says test mode and the lists are empty, which is honest. Nothing about the tab depends on `NOTIFY_WHITELIST`, on `notifyTenants`, or on the owner-actions switch.

## Later plans

- **Plan D — SMS one-time-code sign-in.** `delivery.sendTransactionalSms({ label })` has been ready since Plan A; `makeSms().balance` and the cached reader from Task 3 are useful there too. Nothing in Plan C blocks it, and nothing in Plan D changes what Plan C shows: a transactional batch has `buildingId: null` and therefore never appears in a building's Messages tab.
- **Exporting a batch as CSV.** Asked about, deliberately left out: it would be the first route in this tab that hands a file to a browser, and the columns it would carry are exactly the ones this plan keeps off the page. If it is wanted, it should be a separate, deliberate decision about what a downloaded file may contain.
- **A reason on a reported failure**, which means the delivery layer writing an `errorKind` from the report payload — and the payload is still undocumented.
- **Not in any of these** (design §6): tenants chatting with Bini about their own account, WhatsApp, changing rent, contracts or tenants from Telegram, paying from the invoice link, scheduled messages, a template library, recalling a sent message.

## Self-review (against the design and the brief)

- **§4 Messages tab — batches.** Date, kind, who prepared or confirmed it *as a role and a channel* (`whoLabel`, Tasks 1, 4), the channel split and the delivered / failed / not reachable / test counts (`countsOf`, Task 1; rendered Task 6). Newest first, twenty to a page, filters by kind and month (Tasks 2, 6).
- **§4 — drill-down by unit.** Unit number, channel, status and reason per recipient, paged (Tasks 2, 7). No phone number; no name beyond the unit numbers the Tenants tab already shows — pinned in Tasks 2, 5, 7 and checked live in Task 10.
- **§4 — SMS this month.** Parts against `smsMonthlyLimit`, the cost estimate at the current tier from configuration, and the GeezSMS balance read on the server only when a token is configured, cached ten minutes, "unavailable" on failure, never the token or its URL (Tasks 2, 3, 5, 6).
- **§4 — delivery-report statuses.** Whatever the report route stores — `delivered` and `failed` — appears in both lists, with a legend for all six words (Tasks 1, 7). What the route actually stores today, and what it cannot store, is written down in the facts and in the risks.
- **§4 — "Waiting to be delivered" moves in.** Same `loadPending`, same box, same Send now and the same test-mode wording, rendered in the Messages tab; Invoices keeps a one-line count that opens it (Task 8).
- **§3.3 — the actions in the dashboard.** Kind, status, prepared and confirmed as role and channel, when, the counts, the units not reached, the batch ids and the refusal reason; never `cardText`, `args`, `fingerprint`, `payload`, the notice text or any id (Tasks 4, 5, 7).
- **Tenant Telegram card** stays in Settings and gains a link to the tab (Task 8).
- **Routes** — four, `authBuildingFail` first, building-scoped, paged, no id that is not needed, no phone, no `accessIds`, with source-pinning tests like `test/messaging/server-delivery.test.js` (Task 5).
- **The two Plan B carry-overs** — the `OwnerAction` comment, and the ops line added to the script that already reports the month rather than a new one (Task 9).
- **Out of scope, said so:** SMS sign-in is Plan D, WhatsApp and tenant-side chat are design §6, CSV export is named as a later option with the reason it was left out.
- **Placeholders:** none. Every code step carries the whole file or the whole patch script; every script refuses to run twice and refuses to write unless each anchor matches exactly once; every command has its expected output, and the counts in them were measured against the live repo at `9bb1581` (`npm test` → 1110, `OutboundBatch` → 2, `OwnerAction` → 0).
- **Consistency:** `makeMessagesStore` / `makeMessagesView` / `list` / `one` / `smsMonth`, `makeSmsBalance().read()`, `makeActionHistory().list()`, `presentOf` / `countsOf` / `whoLabel` / `addisMonthRange` / `monthList` / `pageOf`, the bucket names `delivered` `reached` `queued` `failed` `notReachable` `test`, the labels `by` / `preparedBy` / `confirmedBy`, the page globals `MSG.page` / `MSG.kind` / `MSG.month` / `MSG.open` / `MSG.rpage` / `MSG.apage`, and the function names `renderMessages` / `loadSmsMonth` / `loadBatches` / `msgFilter` / `msgPage` / `openBatch` / `batchPage` / `loadActions` / `actPage` / `loadPendingCount` are spelled the same in every task that mentions them.
- **Test count:** 1110 → 1115 → 1121 → 1127 → 1132 → 1137 → 1141 → 1145 → 1147 → 1150, nine commits, every one green.
