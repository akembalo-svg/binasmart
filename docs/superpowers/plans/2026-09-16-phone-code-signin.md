# Sign in with a Phone Code Implementation Plan (Plan D — SMS sign-in and a better login page)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person types their Ethiopian mobile number on bina.et/login, receives a six-digit code by SMS, types it, and is signed in — into the account that number already belongs to if it was ever proven, into a new one otherwise.

**Architecture:** Three small CommonJS modules hold everything that decides anything — `auth/phone-code.js` (code generation, hashing, expiry/attempt/lock arithmetic, the one-part SMS text, the in-memory limiters), `auth/phone-code-flow.js` (the send and verify flows with every outside thing injected), `auth/phone-code-sender.js` (the transactional SMS sender built from `messaging/delivery.js`). A thin better-auth plugin, `auth/phone-code-plugin.mjs`, is the only file that knows about better-auth: it turns better-auth's adapters into the flow's `store` and its refusals into HTTP statuses, exactly as `auth/telegram-plugin.mjs` does for the Telegram door. The code is never stored: `auth_verification.value` holds `SHA-256(pepper, phone, code)`. No schema change.

**Tech Stack:** Node 22, Fastify 5, better-auth 1.6.24 (`prismaAdapter`), Prisma 6 (**no migration**), `node:test`, GeezSMS through the existing `sendTransactionalSms` path.

**Design:** Ibrahim's approved design of 16 September 2026, as amended the same day: **SMS only**. There is no WhatsApp in this plan — no Meta Cloud API adapter, no `WA_*` environment variable, no "send by SMS instead" fallback and no delivery webhook from Meta. The phone door is one channel: GeezSMS.
**Builds on Plan A:** `docs/superpowers/plans/2026-09-15-tenant-delivery-telegram.md` — `OutboundBatch` / `OutboundMessage`, `messaging/delivery.js`, `messaging/sms.js` (the GeezSMS adapter, `normalizeEtMobile`, `labelled`, `smsParts`, `SMS_MAX_CHARS`).
**Builds on Plan C:** `docs/superpowers/plans/2026-09-16-messages-tab.md` — `sendTransactionalSms({ to, text, label, kind, source, live })`, which is the road this plan's codes travel: no building, no batching, no quiet hours, `buildingId: null`, and the text is never stored.
**Not in this plan:** WhatsApp in any form; voice-call codes; two-factor; changing a phone number that is already proven (the account page says so in words); WhatsApp or SMS for tenant notices (Plan A's rule stands); an SMS code for the owner dashboard's separate owner-key login.

---

## Conventions (every task)

- **Where the work happens.** Server `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart` (branch `main`), pm2 process `binasmart-api`, port 4210.
- **The coordinator's machine runs Windows, and this is the exact shape every command in this plan uses.** Use the **PowerShell** tool for `ssh`/`scp` (the Bash tool is broken there). Wrap the whole remote command in **double** quotes — PowerShell strips them and hands the words to `ssh`, which joins them back into one remote command — and inside it use **single** quotes only where one argument contains a space (the slicer's task heading):
  `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 3: ' 0 /tmp/x.js"`
  Three things must **never** appear inside an ssh string: a `$` (PowerShell evaluates `$(...)` and `$VAR` itself — so **no `$(date)`, no shell variables**), a `"` (PowerShell eats it), and Ethiopic text, an apostrophe, a heredoc or a `|` (they do not survive the round trip). Anything that needs one of those goes into a wrapper script that is copied up:
  `scp run.sh root@31.97.176.180:/tmp/run.sh` then `ssh root@31.97.176.180 "sh /tmp/run.sh"` then `ssh root@31.97.176.180 "rm -f /tmp/run.sh"`.
  `grep -E "..."` needs double quotes, so the two greps used everywhere below are written with a single-quoted pattern instead: `grep -E '^# (pass|fail)'` — and `|` inside single quotes still reaches the remote shell intact because ssh joins the argv it was given.
- **Code never travels through an ssh string.** Every file and every patch script in this plan is a fenced block inside **this document**. The plan is committed to the server first (Task 0), and each task slices its own blocks out of it with the slicer that already exists there, byte-exact, Ethiopic included. The slicer prints `blocks in section: [...]` first, so run it once with `-` as the output to see the block list and their indexes, then again with a path. It refuses to overwrite an existing file. If `/tmp/extract_plan.py` is gone, Task 0 writes it back.
- **Ethiopic never goes through an ssh string.** `auth/phone-code.js`, `public/login.html` and `public/account.html` all contain Amharic. They are only ever written by the slicer from this document, never by `echo`, `sed -i` or a here-string.
- **Patching existing files.** Every patch in this plan is a Python script sliced out of its task and run with the repo root as its only argument: `python3 /tmp/t9_authmethods.py /var/www/connectcare/binasmart`. **Each script takes its own `.bak-planD-t<N>-<stamp>` copy before writing** (`*.bak-*` is git-ignored) — that is why no command here needs `$(date)`. Every script refuses to run twice (it checks for its own marker) and exits without writing unless each anchor matches **exactly once**, so a moved line stops it rather than half-applying it.
- **TDD, `node:test`.** Baseline at `436d0e5`: **1153 tests, 1153 pass, 0 fail** (measured 16 September 2026, ~9 s). Each task states its delta. One file:
  `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
  Full suite: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`. Every task ends green.
- **Commits.** Message sliced out of the task into `/tmp/planD-msg.txt`, then `git add <files by name> && git commit -q -F /tmp/planD-msg.txt`. **Never `git add -A`** — the repo has ~130 untracked files. Never stage `broadcast-am-fbcomment.js` or `uploader.js`. Every message ends with a blank line and `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push; the coordinator pushes.
- **Public repo.** Fake numbers only (`0900000001` / `+251900000001`), fake peppers that are obviously fake, no keys, tokens, real phone numbers, chat ids or real names anywhere in code, tests or commit messages.
- **Secrets are Ibrahim's to set.** No task in this plan writes, reads aloud, prints or commits `AUTH_PHONE_CODE_PEPPER`, `SMS_API_TOKEN` or any other value in `/var/www/connectcare/binasmart/.env`. A task may check that a variable is **present** (`grep -c '^AUTH_PHONE_CODE_PEPPER=' .env` → a count, never the line). Ibrahim sets every value himself; the go-live checklist in Task 12 lists them by name.
- **No test sends to live channels.** No step in this plan sends an SMS to anybody. Every test uses doubles. The live checks in Tasks 11 and 12 run with `SMS_MODE=test`, where `messaging/sms.js` returns `{ status: 'test' }` and nothing leaves the server — the `OutboundMessage` row is the proof that the road works. The **first real code goes to Ibrahim's own phone, by his hand, in the go-live step of Task 12** and nowhere else. **Never** touch Darulle's data or switches.
- **Restart** after any change to code the server loads (`server.js`, `auth.mjs`, `auth/*`):
  `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health"` → a JSON body whose first field is `ok` and `true`, then
  `ssh root@31.97.176.180 "tail -n 5 /root/.pm2/logs/binasmart-api-error.log"` → nothing timestamped after the restart, and
  `ssh root@31.97.176.180 "tail -n 40 /root/.pm2/logs/binasmart-api-out.log | grep -c 'better-auth ready'"` → `1` (if it is `0`, `auth.mjs` failed to load and the error log says why).
  `public/login.html` and `public/account.html` are static files sent by `reply.sendFile` from routes with no extension, so they get **no long cache header** (see the `onSend` hook, `server.js:6-20`): changing them needs no restart and no `?v=` bump. A `?v=` bump is needed only if a task adds a file under `/static/` — **no task in this plan does**, and the pages keep their inline scripts.
- **Everything that reaches the page is escaped.** The new login page writes **no** `innerHTML` at all: every message and every value goes through `textContent`, and the only attribute built from server data is the Telegram widget's `data-telegram-login`, which is already pinned by a test. A test in Task 9 fails the build if `innerHTML` reappears in `public/login.html`.
- **The code is never in a URL, never in a log and never at rest.** Both endpoints are POST. `auth/phone-code.js` hashes before anything is written. No `console.log` in this plan ever receives a code, a phone number or the pepper — the only thing logged on a failed send is an `errorKind` from the delivery layer (`sms_refused`, `provider_error`, `no_mobile`, ...).

## Facts found while planning (16 September 2026, read-only)

- **better-auth 1.6.24 ships a `phoneNumber` plugin, and it is the wrong tool here.** `node_modules/better-auth/dist/plugins/phone-number/`. Its options are `otpLength` (default 6), `expiresIn` (default 300 s), `allowedAttempts` (default 3), `sendOTP({ phoneNumber, code })`, `verifyOTP` (replaces the internal check), `phoneNumberValidator`, `requireVerification`, `signUpOnVerification.getTempEmail` / `.getTempName`, `callbackOnVerification`, `sendPasswordResetOTP` and `schema`. Four things rule it out:
  1. **It stores the code in clear.** `routes.mjs` `sendPhoneNumberOTP` writes `createVerificationValue({ value: `${code}:0`, identifier: phoneNumber, ... })`, so `auth_verification.value` would hold `483920:0` — a dump or a backup of that table is a list of working sign-in codes. Verification is a plain `otpValue !== providedCode` string compare, not a constant-time one. The custom `verifyOTP` option does **not** help: the send route writes the clear value unconditionally before `sendOTP` is ever called, and there is no hook that changes what it stores.
  2. **Its schema collides with the columns BinaSmart already has.** The plugin's schema adds `phoneNumber` (String, unique) **and** `phoneNumberVerified` (Boolean) to the user model. `AuthUser` already has `phone` (String, unique) and `phoneVerifiedAt` (DateTime). `phoneNumber` could be remapped onto `phone`, but `phoneNumberVerified` is a Boolean and `phoneVerifiedAt` a DateTime, so a Prisma migration and a second, parallel answer to "is this number proven?" would be unavoidable — against the whole point of `auth/identity.js`.
  3. **`/sign-in/phone-number` is phone + password, not phone + code.** The code flow it offers is `/phone-number/send-otp` + `/phone-number/verify`, whose errors are distinguishable (`OTP_NOT_FOUND`, `OTP_EXPIRED`, `INVALID_OTP`, `TOO_MANY_ATTEMPTS`) — each one tells an attacker something the design says must not be visible.
  4. **Its rate limit is one rule, `path.startsWith('/phone-number')`, 60 s / 10**, keyed by better-auth's own IP resolution — not `X-Real-IP`, which is the only trustworthy client address behind this nginx (`server.js:174-175`). It cannot express "3 per phone per 15 min, 20 per IP per hour".
  **Decision:** do not use it. Write the door the way the Telegram door is written — a thin plugin over modules that can be tested on their own. The one idea worth borrowing is its atomic consume-then-recreate attempt counter, and this plan borrows it with a hash in place of the code.
- **`auth_verification` needs no migration.** `model AuthVerification { id, identifier, value, expiresAt, createdAt, updatedAt }` (`prisma/schema.prisma:674`). A 64-character hex hash plus `:` plus an attempt count fits `value` with room to spare, and `identifier` carries the `phonecode:+2519...` namespace.
- **`sendTransactionalSms` already exists and already says it is for this.** `messaging/delivery.js` — "`sendTransactionalSms({ to, text, label, kind, source, live })`   Plan D sign-in codes: no building, text never stored". It writes an `OutboundBatch` with `buildingId: null` and one `OutboundMessage`, honours `SMS_MODE`, and never touches a building's monthly limit. Nothing about it needs changing.
- **GeezSMS cannot reach Safaricom (+2517…) today.** `messaging/sms.js`: `normalizeEtMobile` accepts both `+2519…` and `+2517…`, but `geezSupports` is `/^\+2519\d{8}$/` — a `+2517` number is `sms_unsupported_number`. With WhatsApp out of scope there is no second channel, so a Safaricom number cannot sign in by code and the page must say so rather than pretend a code is on its way. Saying so leaks nothing: the prefix is in the number the visitor typed, not in any account.
- **`ride/phone.js normPhone` is the normaliser the rest of the site uses** (`09XXXXXXXX | 251... | +251...` → `+251XXXXXXXXX`, else `null`) and `auth/identity.js` already imports it. This plan uses the same one, then asks the SMS layer whether it can reach the result — one normaliser, two questions.
- **`auth/identity.js` already has the exact join this door needs.** `setVerifiedPhone(userId, rawPhone, proof)` with `'sms'` already in its `PROOF` list, and `attachProfiles` links a `Rider` and a `Driver` that carry the same number. It refuses to move a number another account holds (`phone_taken`). The plan calls it and adds nothing.
- **`identity.me()` hides the Telegram placeholder address but would show a phone one.** `email: /@telegram\.bina\.et$/.test(u.email) ? null : u.email`. A phone-only account gets `p251900000001@phone.bina.et`, which is not an address anybody can be written to, so Task 7 widens that test.
- **`/api/auth-methods` already exists and the login page already asks it.** `server.js:115-124` returns `{ google, telegram, telegramBot, email, sms: false }` with `Cache-Control: public, max-age=60`, and `public/login.html` shows the Google button and loads the Telegram widget from it. `sms: false` is a placeholder with the comment "the third door, once there is a provider" — that is the field this plan fills in, renamed `phone`. **A second route (`/api/auth-options`) is not added**: it would be the same answer at a second address, and the login page already reads this one.
- **Telegram is detected by `BINA_RIDER_BOT_TOKEN` being set**, and the widget's bot username comes from `BINA_RIDER_BOT_USERNAME` (default `bina_smart_bot`). Google is detected by `GOOGLE_CLIENT_ID` **and** `GOOGLE_CLIENT_SECRET`. Both stay exactly as they are.
- **One SMS part is achievable and worth the trouble.** The label makes every BinaSmart SMS Ethiopic, so the operator counts it as UCS-2: **70 characters is one part, 67 per part after that** (`messaging/sms.js smsParts`). `BinaSmart፦ ` is 11 characters, leaving 59. The text in Task 3 is 47, for 58 in all — one part, pinned by a test. A bilingual sentence with "never share" spelled out would be 72 and cost two parts on every code, forever.
- **`hotelLimiter` is not exported.** `server.js:163` defines it as a local function. `auth/phone-code.js` gets its own `makeCodeLimiter` with the same shape and an injectable clock, because the plugin runs inside `auth.mjs`, a different module.
- **`auth.mjs` is ESM and loaded dynamically** (`server.js:38`, `import('./auth.mjs')`), and `auth/telegram-plugin.mjs` already reaches CommonJS through `createRequire(import.meta.url)`. This plan uses the same bridge and no other.
- **The plan slicer survives from Plans A–C** at `/tmp/extract_plan.py`; Task 0 writes it back if it is gone.

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `auth/phone-code.js` | Everything decidable without a database, a network or better-auth: code generation, the hash, the packed `hash:attempts` value, expiry / attempt / lock / resend arithmetic, the one-part SMS text, the masked phone, the placeholder e-mail, the limiter. No imports but `crypto`. |
| `auth/phone-code-flow.js` | The two flows — `send` and `verify` — with `store`, `sender`, `linkPhone`, `normalise`, `pepper`, the limiters and the clock all injected. Knows nothing about better-auth, Prisma or Fastify. |
| `auth/phone-code-sender.js` | The transactional SMS sender: `messaging/sms.js` + `messaging/delivery.js` → `send({ phone, code })`, plus the honest `configured` flag the login page's answer is built from. |
| `auth/phone-code-plugin.mjs` | The better-auth plugin. Two endpoints, the adapters-to-`store` glue, one refusal per HTTP status. The only file in the plan that imports better-auth. |
| `ops/auth/phone-code-status.js` | Read-only: is the door configured, how many codes were asked for and what became of them. Sends nothing, writes nothing, prints no secret. |
| `test/auth/phone-code.test.js` | Tasks 1–3. |
| `test/auth/phone-code-sender.test.js` | Task 4. |
| `test/auth/phone-code-flow.test.js` | Tasks 5–6. |
| `test/auth/phone-code-wiring.test.js` | Tasks 7–8: `auth.mjs`, `auth/identity.js`, `/api/auth-methods`, read as text. |
| `test/auth/login-page.test.js` | Task 9. |
| `test/auth/account-page.test.js` | Task 10. |
| `test/auth/phone-code-ops.test.js` | Task 11. |

**Modified**

| File | Change |
| --- | --- |
| `auth.mjs` | `createRequire` bridge, the sender, the `phoneCode` plugin in `plugins: [...]`. |
| `auth/identity.js:~110` | `me()` hides the `@phone.bina.et` placeholder address as well as the Telegram one. |
| `server.js:115-124` | `/api/auth-methods`: `sms: false` becomes `phone: <configured>`. |
| `public/login.html` | Rewritten: phone first, then Telegram, Google, staff e-mail. No `innerHTML`. |
| `public/account.html` | The proven phone is masked to its last four digits, the phone door is listed among the doors, and changing a number is explained as out of scope. |

## Key interfaces this plan adds

```js
// auth/phone-code.js   (pure; only `crypto`)
CODE_LEN 6 · TTL_MS 300000 · MAX_ATTEMPTS 5 · LOCK_MS 900000 · RESEND_MS 60000
PHONE_WINDOW_MS 900000 / PHONE_MAX 3 · IP_WINDOW_MS 3600000 / IP_MAX 20 · MIN_PEPPER 32
SMS_LABEL 'BinaSmart' · PLACEHOLDER_DOMAIN 'phone.bina.et'
newCode(randomInt?) → '483920'
hashCode(code, phone, pepper) → 64 hex          // throws if the pepper is shorter than 32
sameHash(a, b) → bool                            // constant time
packValue(hash, attempts) → 'hash:0'   unpackValue(value) → { hash, attempts }
identifierFor(phone) → 'phonecode:+251900000001'
isLocked(row, nowMs) → bool     tooSoon(row, nowMs) → bool
checkCode({ row, code, phone, pepper, now }) → { ok, reason, clear, next }
  reason 'no_code' | 'expired' | 'locked' | 'wrong' | 'ok'
  clear  true  → the caller deletes the row      next { value, expiresAt } → the caller replaces it
codeText(code) → 'የመግቢያ ኮድ · code 483920 · 5 ደቂቃ/min · ለማንም አይንገሩ'
maskPhone('+251900000001') → '+251 ••• 0001'
phonePlaceholderEmail(e164) → 'p251900000001@phone.bina.et'   isPhonePlaceholderEmail(email) → bool
makeCodeLimiter({ windowMs, max, now, maxKeys }) → key => bool

// auth/phone-code-flow.js
makePhoneCodeFlow({ store, sender, linkPhone, normalise, pepper, now, log, perPhone, perIp, newCode }) → {
  send({ phone, ip })     → { ok: true } | { ok: false, error: 'not_configured' | 'not_reachable' | 'rate_limited' }
  verify({ phone, code })  → { ok: true, isRegister, user } | { ok: false, error: 'not_configured' | 'bad_code' }
  ready()                  → bool
}
// store { find(id), create({identifier,value,expiresAt}), remove(id), findUserByPhone(e164), createUser({email,name}) }

// auth/phone-code-sender.js
makePhoneCodeSender({ prisma, env, delivery, sms, log }) → {
  send({ phone, code }) → { ok, status: 'sent'|'test'|'failed', errorKind }
  configured  // SMS_API_TOKEN set AND SMS_MODE=live
  supports(raw) → bool      mode 'live' | 'test'
}

// auth/phone-code-plugin.mjs
phoneCode({ prisma, sender, pepper, identity, log }) → better-auth plugin, id 'phone-code'
  POST /api/auth/sign-in/phone-code/send    { phone }               → 200 { ok: true } | 400 | 429 | 503
  POST /api/auth/sign-in/phone-code/verify  { phone, code }         → 200 { ok, isRegister, user } + cookie | 401

// server.js  GET /api/auth-methods   (existing route, one field changed)
{ google: bool, telegram: bool, telegramBot: string, email: true, phone: bool }
```

## Task list

| # | Task |
| --- | --- |
| 0 | The plan on the server, and the slicer |
| 1 | `auth/phone-code.js` — the code, the hash and the stored value |
| 2 | `auth/phone-code.js` — expiry, wrong attempts and the fifteen-minute lock |
| 3 | `auth/phone-code.js` — the one-part SMS text, the mask, the placeholder address and the limiter |
| 4 | `auth/phone-code-sender.js` — one code down the transactional road |
| 5 | `auth/phone-code-flow.js` — asking for a code |
| 6 | `auth/phone-code-flow.js` — spending a code, and the account behind it |
| 7 | `auth/phone-code-plugin.mjs` and the wiring in `auth.mjs` |
| 8 | `/api/auth-methods` tells the page whether the phone door exists |
| 9 | The new login page |
| 10 | The account page: a masked number and what it is joined to |
| 11 | `ops/auth/phone-code-status.js`, and the live check in test mode |
| 12 | Go-live: Ibrahim's checklist, and the first real code |

---

### Task 0: The plan on the server, and the slicer

**Files:**
- Create on the server: `docs/superpowers/plans/2026-09-16-phone-code-signin.md` (this document)
- Create if missing: `/tmp/extract_plan.py`

- [ ] **Step 1: Put this plan on the server and commit it**

The coordinator writes this document locally and copies it up, because it contains Ethiopic and must not pass through an ssh string:

Run: `scp 2026-09-16-phone-code-signin.md root@31.97.176.180:/var/www/connectcare/binasmart/docs/superpowers/plans/2026-09-16-phone-code-signin.md`  
Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && git add docs/superpowers/plans/2026-09-16-phone-code-signin.md && git commit -q -m planD-plan && git log --oneline -1"`  

Expected: one new commit line, for example `a1b2c3d planD-plan`.

- [ ] **Step 2: Make sure the slicer is there**

Run: `ssh root@31.97.176.180 "ls -l /tmp/extract_plan.py"`
Expected: a file of about 1.1 kB. If it says `No such file or directory`, write the block below to a local file `extract_plan.py` and `scp extract_plan.py root@31.97.176.180:/tmp/extract_plan.py`. This is its exact source:

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

- [ ] **Step 3: Check the slicer can read this plan**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 1: ' 0 -"`
Expected: a line beginning `blocks in section: [('js', ` listing three blocks, and **no** file written.

- [ ] **Step 4: Record the baseline**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected:
> `# tests 1153`  
> `# pass 1153`  
> `# fail 0`  

- [ ] **Step 5: Make the two new folders**

Run: `ssh root@31.97.176.180 "mkdir -p /var/www/connectcare/binasmart/test/auth /var/www/connectcare/binasmart/ops/auth && ls -d /var/www/connectcare/binasmart/test/auth /var/www/connectcare/binasmart/ops/auth"`
Expected: both paths printed.

---

### Task 1: `auth/phone-code.js` — the code, the hash and the stored value

**Files:**
- Create: `auth/phone-code.js`
- Test: `test/auth/phone-code.test.js`

Test delta: +8 tests (1153 → 1161).

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task straight into the test file:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 1: ' 0 test/auth/phone-code.test.js"`  

```js
'use strict';
// A sign-in code is a password that lives five minutes. These tests pin the two things that decide
// whether it is a real one: it is unguessable, and what we keep is not it.
const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../../auth/phone-code');

const PEPPER = 'test-pepper-0000000000000000000000000000';   // 40 characters, obviously fake
const PHONE = '+251900000001';

test('a code is six digits and comes from the randomness we are given', () => {
  const seq = [4, 8, 3, 9, 2, 0];
  let i = 0;
  const code = pc.newCode((lo, hi) => { assert.equal(lo, 0); assert.equal(hi, 10); return seq[i++]; });
  assert.equal(code, '483920');
  assert.equal(code.length, pc.CODE_LEN);
  assert.match(pc.newCode(), /^\d{6}$/);
});

test('the same code, phone and pepper always hash to the same 64 hex characters', () => {
  const a = pc.hashCode('483920', PHONE, PEPPER);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, pc.hashCode('483920', PHONE, PEPPER));
});

test('a different code, a different phone or a different pepper is a different hash', () => {
  const a = pc.hashCode('483920', PHONE, PEPPER);
  assert.notEqual(a, pc.hashCode('483921', PHONE, PEPPER));
  assert.notEqual(a, pc.hashCode('483920', '+251900000002', PEPPER));
  assert.notEqual(a, pc.hashCode('483920', PHONE, PEPPER + 'x'));
});

test('the phone and the code cannot be run together into the same hash', () => {
  // Without a separator, ('+25190000000', '1483920') and ('+251900000001', '483920') would collide,
  // and a code issued for one number would open another.
  assert.notEqual(pc.hashCode('1483920', '+25190000000', PEPPER), pc.hashCode('483920', PHONE, PEPPER));
});

test('a pepper shorter than 32 characters is refused, loudly, before anything is written', () => {
  assert.throws(() => pc.hashCode('483920', PHONE, 'short'), /AUTH_PHONE_CODE_PEPPER/);
  assert.throws(() => pc.hashCode('483920', PHONE, ''), /AUTH_PHONE_CODE_PEPPER/);
  assert.throws(() => pc.hashCode('483920', PHONE, null), /AUTH_PHONE_CODE_PEPPER/);
  assert.equal(pc.MIN_PEPPER, 32);
});

test('two equal hashes match and two different ones do not, whatever their length', () => {
  const h = pc.hashCode('483920', PHONE, PEPPER);
  assert.equal(pc.sameHash(h, h), true);
  assert.equal(pc.sameHash(h, pc.hashCode('483921', PHONE, PEPPER)), false);
  assert.equal(pc.sameHash(h, h.slice(0, 10)), false);
  assert.equal(pc.sameHash('', ''), true);
});

test('the stored value is a hash and an attempt count, and reads back the same', () => {
  const h = pc.hashCode('483920', PHONE, PEPPER);
  assert.equal(pc.packValue(h, 0), h + ':0');
  assert.deepEqual(pc.unpackValue(h + ':3'), { hash: h, attempts: 3 });
  assert.deepEqual(pc.unpackValue(h), { hash: h, attempts: 0 });
  assert.deepEqual(pc.unpackValue(h + ':nonsense'), { hash: h, attempts: 0 });
  assert.deepEqual(pc.unpackValue(null), { hash: '', attempts: 0 });
  assert.equal(pc.packValue(h, -2), h + ':0');
});

test('the identifier is namespaced, so a code row can never be mistaken for another verification', () => {
  assert.equal(pc.identifierFor(PHONE), 'phonecode:+251900000001');
  assert.equal(pc.identifierFor(null), 'phonecode:');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | tail -n 20"`
Expected: it fails to load — `Cannot find module '../../auth/phone-code'`.

- [ ] **Step 3: Write the module**

Slice block 1 of this task into the module:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 1: ' 1 auth/phone-code.js"`  

```js
'use strict';
// Sign-in codes: everything that can be decided without a database, a network or better-auth.
//
// A code is a password that lives five minutes, so it is kept the way a password is kept. What goes
// into auth_verification.value is SHA-256(pepper, phone, code) — a dump of that table, or a backup of
// it, is not a list of working codes. There is no way back from the stored value to the code, which is
// also why sending one again always means a NEW code and never a repeat of the old one.
//
//   identifier  phonecode:+251900000001
//   value       <64 hex>:<wrong attempts so far>
//
// The pepper (AUTH_PHONE_CODE_PEPPER) is what makes the stored hash useless to anyone holding only the
// database: six digits are a million guesses, which a laptop walks through instantly without it. It is
// set by hand, it is never logged, and hashCode refuses to work if it is short.
const crypto = require('crypto');

const CODE_LEN = 6;
const TTL_MS = 5 * 60 * 1000;                                 // a code lives five minutes
const MAX_ATTEMPTS = 5;                                       // five wrong codes ...
const LOCK_MS = 15 * 60 * 1000;                               // ... then fifteen minutes of nothing
const RESEND_MS = 60 * 1000;                                  // no second code inside a minute
const PHONE_WINDOW_MS = 15 * 60 * 1000, PHONE_MAX = 3;        // codes per number
const IP_WINDOW_MS = 60 * 60 * 1000, IP_MAX = 20;             // codes per X-Real-IP
const MIN_PEPPER = 32;
const SMS_LABEL = 'BinaSmart';
const PLACEHOLDER_DOMAIN = 'phone.bina.et';

function newCode(randomInt) {
  const r = randomInt || ((lo, hi) => crypto.randomInt(lo, hi));
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += String(r(0, 10));
  return s;
}

// The newlines are the point: without a separator, ('+25190000000', '1483920') and
// ('+251900000001', '483920') would hash to the same thing, and a code would work on a second number.
function hashCode(code, phone, pepper) {
  const p = String(pepper == null ? '' : pepper);
  if (p.length < MIN_PEPPER) throw new Error('phone-code: AUTH_PHONE_CODE_PEPPER must be at least ' + MIN_PEPPER + ' characters');
  return crypto.createHash('sha256').update(p + '\n' + String(phone) + '\n' + String(code)).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(String(a == null ? '' : a), 'utf8'), y = Buffer.from(String(b == null ? '' : b), 'utf8');
  return x.length === y.length && (x.length === 0 || crypto.timingSafeEqual(x, y));
}

function packValue(hash, attempts) {
  const n = Math.floor(Number(attempts));
  return String(hash) + ':' + String(Number.isFinite(n) && n > 0 ? n : 0);
}
function unpackValue(value) {
  const s = String(value == null ? '' : value), i = s.indexOf(':');
  if (i === -1) return { hash: s, attempts: 0 };
  const n = Math.floor(Number(s.slice(i + 1)));
  return { hash: s.slice(0, i), attempts: Number.isFinite(n) && n > 0 ? n : 0 };
}

// auth_verification is shared with e-mail verification and password resets; the prefix keeps a code row
// from ever being found — or consumed — by something that was looking for one of those.
function identifierFor(phone) { return 'phonecode:' + String(phone == null ? '' : phone); }

module.exports = { CODE_LEN, TTL_MS, MAX_ATTEMPTS, LOCK_MS, RESEND_MS, PHONE_WINDOW_MS, PHONE_MAX, IP_WINDOW_MS, IP_MAX,
  MIN_PEPPER, SMS_LABEL, PLACEHOLDER_DOMAIN,
  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 8`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1161`, `# pass 1161`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 1: ' 2 /tmp/planD-msg.txt && git add auth/phone-code.js test/auth/phone-code.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
A sign-in code is hashed before it is written down

The code goes to the phone once and is never stored: auth_verification
holds SHA-256(pepper, phone, code) and an attempt count, so a dump of
that table is not a list of working codes. hashCode refuses a pepper
shorter than 32 characters rather than quietly hashing six digits into
something a laptop walks through, and the phone and the code are
separated so a code cannot be made to work on a second number.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 2: `auth/phone-code.js` — expiry, wrong attempts and the fifteen-minute lock

**Files:**
- Modify: `auth/phone-code.js` (a block inserted before `module.exports`, and the exports list)
- Test: `test/auth/phone-code.test.js` (appended)

Test delta: +7 tests (1161 → 1168).

- [ ] **Step 1: Write the failing tests**

Slice block 0 of this task and append it to the test file:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t2_tests.js && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 2: ' 0 /tmp/t2_tests.js && cat /tmp/t2_tests.js >> test/auth/phone-code.test.js && tail -n 3 test/auth/phone-code.test.js"`  

```js

// ----- Task 2: expiry, wrong attempts and the lock -----
const NOW = 1789000000000;                     // a fixed clock; nothing here reads the real one
const row = (hash, attempts, expiresAt) => ({ value: pc.packValue(hash, attempts), expiresAt: new Date(expiresAt) });
const good = () => pc.hashCode('483920', PHONE, PEPPER);

test('the right code is accepted once and the row is thrown away', () => {
  const r = pc.checkCode({ row: row(good(), 0, NOW + 60000), code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok');
  assert.equal(r.clear, true, 'a spent code is deleted, so it cannot be spent twice');
  assert.equal(r.next, null);
});

test('no code was ever asked for', () => {
  const r = pc.checkCode({ row: null, code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_code');
  assert.equal(r.clear, false);
  assert.equal(r.next, null);
});

test('a code past its five minutes is gone, even if it is the right one', () => {
  const r = pc.checkCode({ row: row(good(), 0, NOW - 1), code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'expired');
  assert.equal(r.clear, true);
  assert.equal(pc.TTL_MS, 300000);
});

test('a wrong code counts up and keeps the same expiry, so guessing does not buy time', () => {
  const h = good();
  const r = pc.checkCode({ row: row(h, 1, NOW + 60000), code: '000000', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wrong');
  assert.equal(r.clear, false);
  assert.deepEqual(pc.unpackValue(r.next.value), { hash: h, attempts: 2 });
  assert.equal(r.next.expiresAt.getTime(), NOW + 60000);
});

test('the fifth wrong code locks the number for fifteen minutes', () => {
  const h = good();
  const r = pc.checkCode({ row: row(h, 4, NOW + 60000), code: '000000', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
  assert.deepEqual(pc.unpackValue(r.next.value), { hash: h, attempts: 5 });
  assert.equal(r.next.expiresAt.getTime(), NOW + pc.LOCK_MS);
  assert.equal(pc.MAX_ATTEMPTS, 5);
  assert.equal(pc.LOCK_MS, 900000);
});

test('while it is locked even the right code is refused, and the lock is not extended', () => {
  const locked = row(good(), 5, NOW + pc.LOCK_MS);
  const r = pc.checkCode({ row: locked, code: '483920', phone: PHONE, pepper: PEPPER, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'locked');
  assert.equal(r.clear, false);
  assert.equal(r.next, null, 'a locked row is left exactly as it is');
  assert.equal(pc.isLocked(locked, NOW), true);
  assert.equal(pc.isLocked(locked, NOW + pc.LOCK_MS + 1), false, 'the lock ends when the row expires');
  assert.equal(pc.isLocked(null, NOW), false);
});

test('a second code is refused inside a minute, and refused for the whole lock', () => {
  const fresh = row(good(), 0, NOW + pc.TTL_MS);                 // issued this instant
  assert.equal(pc.tooSoon(fresh, NOW), true);
  assert.equal(pc.tooSoon(fresh, NOW + pc.RESEND_MS), false, 'after sixty seconds a new code may be sent');
  assert.equal(pc.tooSoon(row(good(), 0, NOW - 1), NOW), false, 'an expired code is not a recent one');
  assert.equal(pc.tooSoon(row(good(), 5, NOW + pc.LOCK_MS), NOW), true, 'a lock cannot be escaped by asking again');
  assert.equal(pc.tooSoon(null, NOW), false);
  assert.equal(pc.RESEND_MS, 60000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected: `# pass 8`, `# fail 7`, and seven `not ok` lines — `pc.checkCode is not a function`, `pc.isLocked is not a function`, `pc.tooSoon is not a function`.

- [ ] **Step 3: Write the implementation**

Slice block 1 of this task to `/tmp/t2_patch.py` and run it against the repo root:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t2_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 2: ' 1 /tmp/t2_patch.py && python3 /tmp/t2_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]
p = os.path.join(root, 'auth', 'phone-code.js')
s = io.open(p, encoding='utf-8').read()
if 'function checkCode' in s:
    raise SystemExit('already applied')

ADD = u'''// A Date, a number of milliseconds or an ISO string, as milliseconds.
const ms = d => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// Locked means: five wrong codes were tried, and the row that recorded them has not run out yet. The
// row IS the lock. There is no second place where a lock is kept, and no way to clear it by asking for
// another code, because tooSoon() refuses a new code while it exists.
function isLocked(row, nowMs) { return !!row && unpackValue(row.value).attempts >= MAX_ATTEMPTS && ms(row.expiresAt) > nowMs; }

// Whether a NEW code must be refused. A live code was issued at (expiresAt - TTL_MS); if that was less
// than RESEND_MS ago, the person already has one and a second SMS would only cost money. An expired
// code is not a recent one. A lock always is.
function tooSoon(row, nowMs) {
  if (!row) return false;
  if (isLocked(row, nowMs)) return true;
  if (ms(row.expiresAt) <= nowMs) return false;
  return ms(row.expiresAt) - TTL_MS > nowMs - RESEND_MS;
}

// Every way a code can be wrong, decided in one place. The caller turns all of them into the same
// answer for the visitor: how far a guess got is exactly what an attacker wants to know.
//
//   clear: true            the caller deletes the row (spent, or expired)
//   next:  { value, ... }  the caller replaces the row with this one (a wrong guess, counted)
//   neither                the caller leaves the row alone (never asked for, or locked)
function checkCode({ row, code, phone, pepper, now }) {
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!row) return { ok: false, reason: 'no_code', clear: false, next: null };
  const { hash, attempts } = unpackValue(row.value);
  if (ms(row.expiresAt) <= at) return { ok: false, reason: 'expired', clear: true, next: null };
  if (attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked', clear: false, next: null };
  if (sameHash(hash, hashCode(code, phone, pepper))) return { ok: true, reason: 'ok', clear: true, next: null };
  const n = attempts + 1;
  // The expiry is carried over unchanged on a wrong guess: guessing must not buy a longer window. On
  // the fifth it becomes the lock instead.
  return n >= MAX_ATTEMPTS
    ? { ok: false, reason: 'locked', clear: false, next: { value: packValue(hash, MAX_ATTEMPTS), expiresAt: new Date(at + LOCK_MS) } }
    : { ok: false, reason: 'wrong', clear: false, next: { value: packValue(hash, n), expiresAt: new Date(ms(row.expiresAt)) } };
}

'''
anchor = u'module.exports = { CODE_LEN,'
if s.count(anchor) != 1:
    raise SystemExit('anchor not found exactly once: module.exports')
old = u'  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor };'
if s.count(old) != 1:
    raise SystemExit('anchor not found exactly once: exports list')

shutil.copy2(p, p + '.bak-planD-t2-' + time.strftime('%Y%m%d-%H%M%S'))
s = s.replace(anchor, ADD + anchor)
s = s.replace(old, u'  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor, isLocked, tooSoon, checkCode };')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')
```

Expected: `patched /var/www/connectcare/binasmart/auth/phone-code.js <n> chars`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 15`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1168`, `# pass 1168`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 2: ' 2 /tmp/planD-msg.txt && git add auth/phone-code.js test/auth/phone-code.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
Five wrong codes lock a number for fifteen minutes

One row decides everything about a code: whether it is still alive, how
many guesses it has taken, and whether the number is locked. A wrong
guess keeps the original expiry, so guessing cannot buy a longer window,
and the fifth rewrites the row as a fifteen-minute lock that asking for
a new code cannot clear. checkCode names each outcome for the caller,
and the caller tells the visitor the same sentence for all of them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: `auth/phone-code.js` — the one-part SMS text, the mask, the placeholder address and the limiter

**Files:**
- Modify: `auth/phone-code.js` (a block inserted before `module.exports`, and the exports list)
- Test: `test/auth/phone-code.test.js` (appended)

Test delta: +6 tests (1168 → 1174).

- [ ] **Step 1: Write the failing tests**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t3_tests.js && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 3: ' 0 /tmp/t3_tests.js && cat /tmp/t3_tests.js >> test/auth/phone-code.test.js && tail -n 3 test/auth/phone-code.test.js"`  

```js

// ----- Task 3: the SMS text, the mask, the placeholder address and the limiter -----
const { labelled, smsParts, SMS_MAX_CHARS } = require('../../messaging/sms');

test('the whole SMS, label and all, is ONE part — a second part would be paid for on every sign-in', () => {
  const body = labelled(pc.SMS_LABEL, pc.codeText('483920'));
  assert.equal(pc.SMS_LABEL, 'BinaSmart');
  assert.ok(body.startsWith('BinaSmart፦ '), 'every SMS starts with its label: ' + body);
  // The label carries Ethiopic, so the operator counts the whole message as UCS-2: 70 characters is
  // one part. Anything longer is two SMS for every code, on every retry, forever.
  assert.ok(body.length <= 70, 'the message is ' + body.length + ' characters, which is more than one UCS-2 part');
  assert.equal(smsParts(body), 1);
  assert.ok(body.length < SMS_MAX_CHARS);
});

test('the text says the code, how long it lasts and not to share it, in both languages', () => {
  const t = pc.codeText('483920');
  assert.ok(t.includes('483920'), 'the code is in the text');
  assert.ok(t.includes('code'), 'English: ' + t);
  assert.ok(t.includes('min'), 'English: ' + t);
  assert.ok(t.includes('የመግቢያ ኮድ'), 'Amharic: sign-in code');
  assert.ok(t.includes('ደቂቃ'), 'Amharic: minutes');
  assert.ok(t.includes('ለማንም አይንገሩ'), 'Amharic: tell no one');
  assert.ok(!/http|bina\.et|\?|=/.test(t), 'a code never travels in a link: ' + t);
});

test('a phone is shown by its last four digits and nothing else', () => {
  assert.equal(pc.maskPhone('+251900000001'), '+251 ••• 0001');
  assert.equal(pc.maskPhone('+251911111234'), '+251 ••• 1234');
  assert.equal(pc.maskPhone(''), '');
  assert.equal(pc.maskPhone(null), '');
  assert.ok(!pc.maskPhone('+251900000001').includes('90000000'), 'the middle of the number never appears');
});

test('a phone-only account gets a placeholder address on a domain we own, and it is recognisable', () => {
  assert.equal(pc.phonePlaceholderEmail('+251900000001'), 'p251900000001@phone.bina.et');
  assert.equal(pc.isPhonePlaceholderEmail('p251900000001@phone.bina.et'), true);
  assert.equal(pc.isPhonePlaceholderEmail('ibrahim@example.com'), false);
  assert.equal(pc.isPhonePlaceholderEmail('tg123@telegram.bina.et'), false);
  assert.equal(pc.isPhonePlaceholderEmail(''), false);
  assert.equal(pc.isPhonePlaceholderEmail(null), false);
});

test('the limiter lets max through in a window and refuses the rest, on its own clock', () => {
  let at = NOW;
  const limit = pc.makeCodeLimiter({ windowMs: 1000, max: 2, now: () => at });
  assert.equal(limit('a'), true);
  assert.equal(limit('a'), true);
  assert.equal(limit('a'), false, 'the third inside the window is refused');
  assert.equal(limit('b'), true, 'another key has its own budget');
  at += 1001;
  assert.equal(limit('a'), true, 'the window has moved on');
});

test('the two windows are the ones the design asked for, and an empty key is never one bucket for everyone', () => {
  assert.equal(pc.PHONE_MAX, 3);
  assert.equal(pc.PHONE_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(pc.IP_MAX, 20);
  assert.equal(pc.IP_WINDOW_MS, 60 * 60 * 1000);
  const limit = pc.makeCodeLimiter({ windowMs: 1000, max: 1, now: () => NOW });
  assert.equal(limit(''), true);
  assert.equal(limit(''), true, 'an unknown caller is not limited together with every other unknown caller');
  assert.equal(limit(null), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected: `# pass 15`, `# fail 6` — `pc.codeText is not a function`, `pc.maskPhone is not a function`, `pc.phonePlaceholderEmail is not a function`, `pc.makeCodeLimiter is not a function`.

- [ ] **Step 3: Write the implementation**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t3_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 3: ' 1 /tmp/t3_patch.py && python3 /tmp/t3_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]
p = os.path.join(root, 'auth', 'phone-code.js')
s = io.open(p, encoding='utf-8').read()
if 'function codeText' in s:
    raise SystemExit('already applied')

ADD = u'''// One SMS part, and it has to stay that way. messaging/sms.js labelled() puts BinaSmart and an
// Ethiopic colon in front of this, which makes the whole message UCS-2 to the operator: 70 characters
// is one part, 67 per part after that. Label (11) + this text (47) = 58. Spelling out "never share"
// in English would make it 72 and buy a second SMS on every code, on every retry, for ever.
function codeText(code) { return 'የመግቢያ ኮድ · code ' + String(code) + ' · 5 ደቂቃ/min · ለማንም አይንገሩ'; }

// A number is shown back to its owner, never in full: enough to recognise, not enough to read out.
function maskPhone(e164) {
  const s = String(e164 == null ? '' : e164);
  return s.length < 4 ? '' : '+251 ••• ' + s.slice(-4);
}

// better-auth requires an e-mail on every account and it must be unique. A phone-only account gets a
// deterministic address on a domain we own, exactly as a Telegram account gets one on telegram.bina.et,
// so it can never collide with a real mailbox — and identity.me() hides it, because it is not an
// address anybody can be written to.
function phonePlaceholderEmail(e164) { return 'p' + String(e164 == null ? '' : e164).replace(/^\\+/, '') + '@' + PLACEHOLDER_DOMAIN; }
const PLACEHOLDER_RE = new RegExp('^p251\\\\d{9}@' + PLACEHOLDER_DOMAIN.replace(/\\./g, '\\\\.') + '$');
function isPhonePlaceholderEmail(email) { return PLACEHOLDER_RE.test(String(email == null ? '' : email)); }

// The same shape as hotelLimiter in server.js, with an injectable clock so the windows can be tested
// without waiting a quarter of an hour. It is not exported from server.js, and this code runs inside
// auth.mjs, which is a different module — so it lives here rather than being reached across.
//
// An empty key is let through rather than counted: otherwise every caller we could not identify would
// share one bucket, and the first twenty of them would lock out the twenty-first.
function makeCodeLimiter({ windowMs, max, now = () => Date.now(), maxKeys = 5000 } = {}) {
  const m = new Map();
  return key => {
    if (key == null || key === '') return true;
    const at = now();
    const hits = (m.get(key) || []).filter(t => at - t < windowMs);
    if (hits.length >= max) { m.set(key, hits); return false; }
    hits.push(at);
    m.set(key, hits);
    if (m.size > maxKeys) for (const [k, v] of m) { if (!v.length || at - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}

'''
anchor = u'module.exports = { CODE_LEN,'
if s.count(anchor) != 1:
    raise SystemExit('anchor not found exactly once: module.exports')
old = u'  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor, isLocked, tooSoon, checkCode };'
if s.count(old) != 1:
    raise SystemExit('anchor not found exactly once: exports list')

shutil.copy2(p, p + '.bak-planD-t3-' + time.strftime('%Y%m%d-%H%M%S'))
s = s.replace(anchor, ADD + anchor)
s = s.replace(old, u'  newCode, hashCode, sameHash, packValue, unpackValue, identifierFor, isLocked, tooSoon, checkCode,\n'
                   u'  codeText, maskPhone, phonePlaceholderEmail, isPhonePlaceholderEmail, makeCodeLimiter };')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')
```

Expected: `patched /var/www/connectcare/binasmart/auth/phone-code.js <n> chars`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 21`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1174`, `# pass 1174`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 3: ' 2 /tmp/planD-msg.txt && git add auth/phone-code.js test/auth/phone-code.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
The sign-in SMS fits in one part, in both languages

The label makes every BinaSmart SMS Ethiopic, so the operator counts it
as UCS-2 and 70 characters is one part. The code text is written to 47
so that label and message together come to 58, and a test fails the
build if it ever grows: a 71-character sentence would buy a second SMS
on every code, on every retry, for ever. The mask, the placeholder
address for a phone-only account and the two rate-limit windows land in
the same module, with an injectable clock so a quarter of an hour can be
tested in a millisecond.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: `auth/phone-code-sender.js` — one code down the transactional road

**Files:**
- Create: `auth/phone-code-sender.js`
- Test: `test/auth/phone-code-sender.test.js`

Test delta: +5 tests (1174 → 1179).

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 4: ' 0 test/auth/phone-code-sender.test.js"`  

```js
'use strict';
// The sender is one call wide, and every one of these tests is about what it must NOT do: send by any
// other road, write the code anywhere, or claim to be configured when it is not.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePhoneCodeSender } = require('../../auth/phone-code-sender');
const pc = require('../../auth/phone-code');

const LIVE_ENV = { SMS_MODE: 'live', SMS_API_TOKEN: 'fake-token-for-tests' };
// A delivery double that records the one call it is meant to receive.
function fakeDelivery(result) {
  const calls = [];
  return { calls, sendTransactionalSms: async (args) => { calls.push(args); return result; } };
}

test('the code goes out as a labelled transactional SMS, and by no other road', async () => {
  const d = fakeDelivery({ status: 'sent', channel: 'sms', errorKind: null, messageId: 'm1' });
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: d, sms: { mode: 'live', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: true, status: 'sent', errorKind: null });
  assert.equal(d.calls.length, 1, 'exactly one send');
  assert.deepEqual(d.calls[0], {
    to: '+251900000001',
    text: pc.codeText('483920'),
    label: 'BinaSmart',
    kind: 'signin',
    source: 'phone-code',
    live: true
  });
  // sendTransactionalSms stores no text and no building, so the code never lands in OutboundBatch.text.
  assert.equal('buildingId' in d.calls[0], false);
});

test('in test mode the row is written, nothing is sent, and the flow carries on exactly the same', async () => {
  const d = fakeDelivery({ status: 'test', channel: 'sms', errorKind: null, messageId: 'm2' });
  const sender = makePhoneCodeSender({ env: { SMS_MODE: 'test' }, delivery: d, sms: { mode: 'test', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.equal(r.ok, true, 'a test row is a successful send as far as the sign-in flow is concerned');
  assert.equal(r.status, 'test');
});

test('a refusal comes back as a kind, never as a message, and never with the code in it', async () => {
  const d = fakeDelivery({ status: 'failed', channel: 'sms', errorKind: 'sms_refused', messageId: 'm3' });
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: d, sms: { mode: 'live', supports: () => true } });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: false, status: 'failed', errorKind: 'sms_refused' });
  assert.equal(JSON.stringify(r).includes('483920'), false, 'the code is never in what we hand back');
});

test('an error inside the delivery layer is caught, named by kind, and never logged with a number in it', async () => {
  const lines = [];
  const boom = { sendTransactionalSms: async () => { const e = new Error('connect ECONNREFUSED for +251900000001'); e.code = 'ECONNREFUSED'; throw e; } };
  const sender = makePhoneCodeSender({ env: LIVE_ENV, delivery: boom, sms: { mode: 'live', supports: () => true }, log: m => lines.push(m) });
  const r = await sender.send({ phone: '+251900000001', code: '483920' });
  assert.deepEqual(r, { ok: false, status: 'failed', errorKind: 'sender_error' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0], '[phone-code] sender ECONNREFUSED');
  assert.equal(lines[0].includes('251900000001'), false);
  assert.equal(lines[0].includes('483920'), false);
});

test('configured needs BOTH a token and live mode, and the reachable prefixes come from the SMS layer', () => {
  const d = fakeDelivery({ status: 'test' });
  const of = env => makePhoneCodeSender({ env, delivery: d });
  assert.equal(of(LIVE_ENV).configured, true);
  assert.equal(of({ SMS_MODE: 'live' }).configured, false, 'live with no token is not a door');
  assert.equal(of({ SMS_API_TOKEN: 'fake-token-for-tests' }).configured, false, 'a token with SMS off is not a door');
  assert.equal(of({}).configured, false);
  // With no sms layer injected the real one is built from the environment: no provider, no network.
  const s = of({});
  assert.equal(s.mode, 'test');
  assert.equal(s.supports('0900000001'), true, 'Ethio Telecom, reachable');
  assert.equal(s.supports('0700000001'), false, 'Safaricom (+2517) — GeezSMS cannot reach it, so it is not a door');
  assert.equal(s.supports('+971500000000'), false, 'not an Ethiopian mobile');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-sender.test.js 2>&1 | tail -n 20"`
Expected: `Cannot find module '../../auth/phone-code-sender'`.

- [ ] **Step 3: Write the module**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 4: ' 1 auth/phone-code-sender.js"`  

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-sender.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 5`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1179`, `# pass 1179`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 4: ' 2 /tmp/planD-msg.txt && git add auth/phone-code-sender.js test/auth/phone-code-sender.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
A sign-in code has exactly one road out

sendTransactionalSms, the transactional path, and nothing else: no
building, no batch, no quiet hours, no monthly limit, and no stored
text, so the code never lands in a table. A test-mode row counts as a
successful send on purpose, so the flow exercised before go-live is the
same flow that goes live. configured is true only when a provider token
and SMS_MODE=live are both there, and whether a number can be reached
at all is the SMS layer's answer, not a second copy of the rule.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: `auth/phone-code-flow.js` — asking for a code

**Files:**
- Create: `auth/phone-code-flow.js`
- Test: `test/auth/phone-code-flow.test.js`

Test delta: +9 tests (1179 → 1188).

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 5: ' 0 test/auth/phone-code-flow.test.js"`  

```js
'use strict';
// Asking for a code. Every outside thing is a double here — no database, no network, no better-auth —
// so what is being tested is the decisions, which is where a sign-in door goes wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePhoneCodeFlow } = require('../../auth/phone-code-flow');
const pc = require('../../auth/phone-code');
const { normPhone } = require('../../ride/phone');

const PEPPER = 'test-pepper-0000000000000000000000000000';
const PHONE = '+251900000001';
const NOW = 1789000000000;

function fakeStore(rows) {
  const s = { rows: Object.assign({}, rows), created: [], removed: [], users: [], next: 1 };
  s.find = async id => s.rows[id] || null;
  s.create = async v => { s.rows[v.identifier] = { value: v.value, expiresAt: v.expiresAt }; s.created.push(v); return v; };
  s.remove = async id => { delete s.rows[id]; s.removed.push(id); };
  s.findUserByPhone = async phone => s.users.find(u => u.phone === phone) || null;
  s.createUser = async u => { const row = Object.assign({ id: 'u' + s.next++, phone: null }, u); s.users.push(row); return row; };
  return s;
}
function fakeSender(result) {
  const sent = [];
  return { sent, configured: true, mode: 'live', supports: e => /^\+2519\d{8}$/.test(String(e)),
    send: async a => { sent.push(a); return result || { ok: true, status: 'sent', errorKind: null }; } };
}
// A flow with a fixed clock, a fixed code and a linkPhone that always agrees.
function build(over) {
  const o = over || {};
  const store = o.store || fakeStore();
  const sender = o.sender || fakeSender();
  const logs = [];
  const flow = makePhoneCodeFlow({
    store, sender, normalise: normPhone, pepper: o.pepper === undefined ? PEPPER : o.pepper,
    now: () => new Date(o.now || NOW), newCode: () => o.code || '483920',
    linkPhone: async (id, phone) => { store.users.forEach(u => { if (u.id === id) u.phone = phone; }); return { ok: true, phone, linked: {} }; },
    log: m => logs.push(m)
  });
  return { flow, store, sender, logs };
}

test('with no pepper, or no sender, or SMS switched off, there is no door at all', async () => {
  assert.equal((await build({ pepper: '' }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  assert.equal((await build({ pepper: 'short' }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  const off = fakeSender(); off.configured = false;
  assert.equal((await build({ sender: off }).flow.send({ phone: '0900000001' })).error, 'not_configured');
  assert.equal(build().flow.ready(), true);
  assert.equal(build({ pepper: '' }).flow.ready(), false);
});

test('a number the provider cannot reach is refused, and nothing is written for it', async () => {
  const b = build();
  assert.deepEqual(await b.flow.send({ phone: '0700000001' }), { ok: false, error: 'not_reachable' });   // Safaricom
  assert.deepEqual(await b.flow.send({ phone: '+971500000000' }), { ok: false, error: 'not_reachable' }); // not Ethiopian
  assert.deepEqual(await b.flow.send({ phone: 'nonsense' }), { ok: false, error: 'not_reachable' });
  assert.deepEqual(await b.flow.send({ phone: '' }), { ok: false, error: 'not_reachable' });
  assert.equal(b.store.created.length, 0);
  assert.equal(b.sender.sent.length, 0);
});

test('the code is hashed on the way in — the store never sees it, the phone does', async () => {
  const b = build();
  assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.1' }), { ok: true });
  assert.equal(b.sender.sent.length, 1);
  assert.deepEqual(b.sender.sent[0], { phone: PHONE, code: '483920' });
  assert.equal(b.store.created.length, 1);
  const wrote = b.store.created[0];
  assert.equal(wrote.identifier, 'phonecode:+251900000001');
  assert.equal(wrote.value, pc.packValue(pc.hashCode('483920', PHONE, PEPPER), 0));
  assert.equal(wrote.value.includes('483920'), false, 'the code itself is never written down');
  assert.equal(wrote.expiresAt.getTime(), NOW + pc.TTL_MS, 'five minutes');
});

test('a second code inside a minute sends nothing, and the visitor is told exactly what a first code is told', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 0), expiresAt: new Date(NOW + pc.TTL_MS) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true }, 'the same answer as a real send');
  assert.equal(b.sender.sent.length, 0, 'no SMS, no money spent');
  assert.equal(b.store.created.length, 0, 'the code they already have is left alone');
});

test('a locked number is told the same thing as everyone else, and gets no new code', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 5), expiresAt: new Date(NOW + pc.LOCK_MS) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true });
  assert.equal(b.sender.sent.length, 0);
  assert.equal(b.store.created.length, 0, 'asking again cannot clear a lock');
});

test('an old code is thrown away before a new one is written, so one number has one live code', async () => {
  const store = fakeStore({ 'phonecode:+251900000001': { value: pc.packValue(pc.hashCode('111111', PHONE, PEPPER), 2), expiresAt: new Date(NOW - 1) } });
  const b = build({ store });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true });
  assert.deepEqual(b.store.removed, ['phonecode:+251900000001']);
  assert.equal(b.store.created.length, 1);
  assert.deepEqual(pc.unpackValue(b.store.created[0].value).attempts, 0, 'a new code starts with no wrong guesses against it');
});

test('three codes to one number in fifteen minutes, and the fourth is refused', async () => {
  const b = build();
  for (let i = 0; i < 3; i++) {
    b.store.rows = {};                                       // the code was used or expired in between
    assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.' + i }), { ok: true }, 'code ' + (i + 1));
  }
  b.store.rows = {};
  assert.deepEqual(await b.flow.send({ phone: '0900000001', ip: '10.0.0.9' }), { ok: false, error: 'rate_limited' });
  assert.equal(b.sender.sent.length, 3);
  // A different number is not caught by another number's limit.
  assert.deepEqual(await b.flow.send({ phone: '0900000002', ip: '10.0.0.9' }), { ok: true });
});

test('twenty codes an hour from one address, and the address is checked before anything is read', async () => {
  const b = build();
  for (let i = 0; i < 20; i++) {
    b.store.rows = {};
    assert.deepEqual(await b.flow.send({ phone: '09000000' + String(10 + i), ip: '10.0.0.7' }), { ok: true }, 'code ' + (i + 1));
  }
  b.store.rows = {};
  const before = b.store.created.length;
  assert.deepEqual(await b.flow.send({ phone: '0900000099', ip: '10.0.0.7' }), { ok: false, error: 'rate_limited' });
  assert.equal(b.store.created.length, before, 'a refused caller never reaches the database');
  assert.deepEqual(await b.flow.send({ phone: '0900000099', ip: '10.0.0.8' }), { ok: true }, 'another address is not punished');
});

test('an SMS that did not go is logged by its kind alone, and the visitor is still told the same thing', async () => {
  const b = build({ sender: fakeSender({ ok: false, status: 'failed', errorKind: 'sms_refused' }) });
  assert.deepEqual(await b.flow.send({ phone: '0900000001' }), { ok: true }, 'whether a number exists, or an SMS went, is never visible from outside');
  assert.deepEqual(b.logs, ['[phone-code] send sms_refused']);
  assert.equal(b.logs[0].includes('251900000001'), false);
  assert.equal(b.logs[0].includes('483920'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-flow.test.js 2>&1 | tail -n 20"`
Expected: `Cannot find module '../../auth/phone-code-flow'`.

- [ ] **Step 3: Write the module**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 5: ' 1 auth/phone-code-flow.js"`  

```js
'use strict';
// Signing in with a code, with every outside thing injected: the verification rows, the account rows,
// the SMS sender, the phone normaliser, the two limiters and the clock. better-auth is not imported
// here — auth/phone-code-plugin.mjs is the only file that knows about it — which is what lets the
// whole door be tested without a database, a network or a session cookie.
//
//   send({ phone, ip })     → { ok: true } | { ok: false, error: 'not_configured' | 'not_reachable' | 'rate_limited' }
//   verify({ phone, code })  → { ok: true, isRegister, user } | { ok: false, error: 'not_configured' | 'bad_code' }
//
// Two rules run through all of it:
//
// 1. Whether a number belongs to an account is never visible from outside. A working number, a number
//    nobody has ever used, a number whose SMS the provider refused and a number that already has a
//    live code all get { ok: true }. Only two things are said out loud, and neither is about an
//    account: the number cannot be reached by SMS at all (a property of the digits that were typed),
//    and you are asking too often.
// 2. Every way a code can fail is one answer, 'bad_code'. Never asked for, expired, wrong, locked out,
//    the wrong number — telling them apart is telling an attacker how far a guess got.
//
// store { find(id), create({identifier,value,expiresAt}), remove(id), findUserByPhone(e164), createUser({email,name,role}) }
const pc = require('./phone-code');

function makePhoneCodeFlow({ store, sender, linkPhone, normalise, pepper, now = () => new Date(), log = () => {},
  perPhone = null, perIp = null, newCode = pc.newCode } = {}) {
  // Built once and kept: a limiter that is rebuilt per request limits nothing. The plugin keeps one
  // flow for the life of the process for exactly this reason.
  const phoneLimit = perPhone || pc.makeCodeLimiter({ windowMs: pc.PHONE_WINDOW_MS, max: pc.PHONE_MAX, now: () => now().getTime() });
  const ipLimit = perIp || pc.makeCodeLimiter({ windowMs: pc.IP_WINDOW_MS, max: pc.IP_MAX, now: () => now().getTime() });

  const ready = () => !!sender && sender.configured === true && String(pepper == null ? '' : pepper).length >= pc.MIN_PEPPER;

  async function send({ phone, ip } = {}) {
    if (!ready()) return { ok: false, error: 'not_configured' };
    const e164 = normalise(phone);
    // Not an Ethiopian mobile, or a prefix the provider cannot reach (+2517 — GeezSMS only carries
    // +2519). This is a property of the number that was typed, not of any account, so saying so leaks
    // nothing — and saying nothing would leave the person waiting for an SMS that can never arrive.
    if (!e164 || !sender.supports(e164)) return { ok: false, error: 'not_reachable' };
    // The address first, so a flood is cut off before it costs a query.
    if (!ipLimit(String(ip == null ? '' : ip))) return { ok: false, error: 'rate_limited' };
    const id = pc.identifierFor(e164);
    const at = now();
    const row = await store.find(id);
    // A code from less than a minute ago, or a lock. No new code, no SMS, and the same answer as a
    // real send — and no budget spent, because the budget is three CODES, not three requests.
    if (pc.tooSoon(row, at.getTime())) return { ok: true };
    if (!phoneLimit(e164)) return { ok: false, error: 'rate_limited' };
    if (row) await store.remove(id);                       // one number, one live code
    const code = newCode();
    await store.create({ identifier: id, value: pc.packValue(pc.hashCode(code, e164, pepper), 0), expiresAt: new Date(at.getTime() + pc.TTL_MS) });
    const r = await sender.send({ phone: e164, code });
    // The kind of failure, and nothing else: not the number, not the code, not the provider's words.
    if (!r || !r.ok) log('[phone-code] send ' + String((r && r.errorKind) || 'failed'));
    return { ok: true };
  }

  return { send, ready };
}

module.exports = { makePhoneCodeFlow };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-flow.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 9`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1188`, `# pass 1188`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 5: ' 2 /tmp/planD-msg.txt && git add auth/phone-code-flow.js test/auth/phone-code-flow.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
Asking for a code says nothing about whose number it is

A number that has an account, a number that has none, a number whose SMS
the provider refused and a number that already has a live code all get
the same answer. Only two things are said out loud and neither is about
an account: an SMS cannot reach this number at all, and you are asking
too often. Three codes per number in fifteen minutes and twenty per
address in an hour, counted as codes rather than requests, so a resend
inside the sixty-second window costs nobody a slot.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: `auth/phone-code-flow.js` — spending a code, and the account behind it

**Files:**
- Modify: `auth/phone-code-flow.js` (`verify` inserted, and added to what the factory returns)
- Test: `test/auth/phone-code-flow.test.js` (appended)

Test delta: +8 tests (1188 → 1196).

- [ ] **Step 1: Write the failing tests**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t6_tests.js && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 6: ' 0 /tmp/t6_tests.js && cat /tmp/t6_tests.js >> test/auth/phone-code-flow.test.js && tail -n 3 test/auth/phone-code-flow.test.js"`  

```js

// ----- Task 6: spending a code -----
const liveRow = (code, attempts, expiresAt) => ({
  'phonecode:+251900000001': { value: pc.packValue(pc.hashCode(code, PHONE, PEPPER), attempts || 0), expiresAt: new Date(expiresAt === undefined ? NOW + pc.TTL_MS : expiresAt) }
});

test('the right code signs in the account that already holds the number, and the row is spent', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const b = build({ store });
  const r = await b.flow.verify({ phone: '0900000001', code: '483920' });
  assert.equal(r.ok, true);
  assert.equal(r.isRegister, false, 'one account, many doors — no second account for a proven number');
  assert.equal(r.user.id, 'u9');
  assert.deepEqual(b.store.removed, ['phonecode:+251900000001']);
  assert.equal(b.store.rows['phonecode:+251900000001'], undefined);
});

test('the same code cannot be spent twice', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const b = build({ store });
  assert.equal((await b.flow.verify({ phone: '0900000001', code: '483920' })).ok, true);
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
});

test('a number nobody has yet becomes a new account: role user, a placeholder address, a masked name', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  const r = await b.flow.verify({ phone: '0900000001', code: '483920' });
  assert.equal(r.ok, true);
  assert.equal(r.isRegister, true);
  assert.equal(r.user.email, 'p251900000001@phone.bina.et');
  assert.equal(r.user.name, '+251 ••• 0001');
  assert.equal(r.user.role, 'user', 'never owner, never admin — those are granted by hand');
  assert.equal(r.user.phone, PHONE, 'the number is proven on the account before the session exists');
});

test('every way a code can fail is the same six words to the visitor', async () => {
  const cases = [
    ['no code was ever asked for', fakeStore(), '483920'],
    ['the code ran out', fakeStore(liveRow('483920', 0, NOW - 1)), '483920'],
    ['the wrong code', fakeStore(liveRow('483920', 0)), '000000'],
    ['locked out', fakeStore(liveRow('483920', 5, NOW + pc.LOCK_MS)), '483920'],
    ['not six digits', fakeStore(liveRow('483920', 0)), '48392'],
    ['not digits at all', fakeStore(liveRow('483920', 0)), 'abcdef'],
    ['nothing at all', fakeStore(liveRow('483920', 0)), '']
  ];
  for (const [what, store, code] of cases) {
    const b = build({ store });
    assert.deepEqual(await b.flow.verify({ phone: '0900000001', code }), { ok: false, error: 'bad_code' }, what);
  }
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  assert.deepEqual(await b.flow.verify({ phone: '0700000001', code: '483920' }), { ok: false, error: 'bad_code' }, 'a number we cannot even normalise');
});

test('a code shaped wrongly never reaches the database', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  let reads = 0;
  const realFind = b.store.find;
  b.store.find = async id => { reads++; return realFind(id); };
  await b.flow.verify({ phone: '0900000001', code: 'abcdef' });
  await b.flow.verify({ phone: '0900000001', code: '1234567' });
  await b.flow.verify({ phone: 'nonsense', code: '483920' });
  assert.equal(reads, 0);
});

test('a wrong code is counted against the same row, and the fifth locks the number', async () => {
  const b = build({ store: fakeStore(liveRow('483920', 0)) });
  for (let i = 1; i <= 4; i++) {
    assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '000000' }), { ok: false, error: 'bad_code' }, 'guess ' + i);
    assert.equal(pc.unpackValue(b.store.rows['phonecode:+251900000001'].value).attempts, i);
  }
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '000000' }), { ok: false, error: 'bad_code' }, 'the fifth');
  const locked = b.store.rows['phonecode:+251900000001'];
  assert.equal(pc.unpackValue(locked.value).attempts, 5);
  assert.equal(locked.expiresAt.getTime(), NOW + pc.LOCK_MS);
  assert.deepEqual(await b.flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' }, 'the right code, too late');
});

test('a code issued for one number does not open another', async () => {
  const rows = liveRow('483920', 0);
  rows['phonecode:+251900000002'] = { value: pc.packValue(pc.hashCode('483920', '+251900000002', PEPPER), 0), expiresAt: new Date(NOW + pc.TTL_MS) };
  const b = build({ store: fakeStore(rows) });
  // The hash is over (pepper, phone, code), so the same six digits are a different secret per number.
  assert.notEqual(pc.hashCode('483920', PHONE, PEPPER), pc.hashCode('483920', '+251900000002', PEPPER));
  assert.equal((await b.flow.verify({ phone: '0900000001', code: '483920' })).ok, true);
  assert.equal(b.store.rows['phonecode:+251900000002'] !== undefined, true, 'the other number is untouched');
});

test('if the number cannot be proven on the account, nobody is signed in', async () => {
  const store = fakeStore(liveRow('483920', 0));
  store.users.push({ id: 'u9', name: 'Demo Rider', email: 'demo@example.com', phone: PHONE });
  const logs = [];
  const flow = makePhoneCodeFlow({
    store, sender: fakeSender(), normalise: normPhone, pepper: PEPPER, now: () => new Date(NOW), newCode: () => '483920',
    linkPhone: async () => ({ ok: false, error: 'phone_taken' }), log: m => logs.push(m)
  });
  assert.deepEqual(await flow.verify({ phone: '0900000001', code: '483920' }), { ok: false, error: 'bad_code' });
  assert.deepEqual(logs, ['[phone-code] link phone_taken']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-flow.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected: `# pass 9`, `# fail 8` — every one of them `b.flow.verify is not a function` or `flow.verify is not a function`.

- [ ] **Step 3: Write the implementation**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t6_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 6: ' 1 /tmp/t6_patch.py && python3 /tmp/t6_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]
p = os.path.join(root, 'auth', 'phone-code-flow.js')
s = io.open(p, encoding='utf-8').read()
if 'async function verify' in s:
    raise SystemExit('already applied')

ADD = u'''  // Spending a code. Everything that can go wrong is one answer; see the note at the top of the file.
  async function verify({ phone, code } = {}) {
    if (!ready()) return { ok: false, error: 'not_configured' };
    const e164 = normalise(phone);
    // Shape first: a request that cannot possibly be right costs one regular expression, not a query.
    if (!e164 || !/^\\d{6}$/.test(String(code == null ? '' : code))) return { ok: false, error: 'bad_code' };
    const id = pc.identifierFor(e164);
    const at = now();
    const row = await store.find(id);
    const r = pc.checkCode({ row, code: String(code), phone: e164, pepper, now: at });
    // Spent or expired: the row goes. A counted wrong guess: the row is replaced, which is also what
    // makes a code single-use — the old row is gone before the new one is written.
    if (r.clear) await store.remove(id);
    if (r.next) { await store.remove(id); await store.create({ identifier: id, value: r.next.value, expiresAt: r.next.expiresAt }); }
    if (!r.ok) return { ok: false, error: 'bad_code' };

    // The number is now PROVEN — an SMS to it was answered. One account, many doors: if some other
    // door already proved this number, that is the account. Otherwise a new one, with the role every
    // new account gets. 'admin', and 'owner' with a building, are granted by hand and never here.
    let user = await store.findUserByPhone(e164);
    let isRegister = false;
    if (!user) {
      user = await store.createUser({ email: pc.phonePlaceholderEmail(e164), name: pc.maskPhone(e164), role: 'user' });
      isRegister = true;
    }
    // auth/identity.js writes phone + phoneVerifiedAt and attaches the Rider and Driver rows that
    // carry the same number. It refuses to move a number another account holds; if it refuses, nobody
    // is signed in — a half-linked account is worse than a failed sign-in.
    const linked = await linkPhone(user.id, e164);
    if (!linked || linked.ok !== true) {
      log('[phone-code] link ' + String((linked && linked.error) || 'failed'));
      return { ok: false, error: 'bad_code' };
    }
    return { ok: true, isRegister, user };
  }

'''
anchor = u'  return { send, ready };'
if s.count(anchor) != 1:
    raise SystemExit('anchor not found exactly once: return')

shutil.copy2(p, p + '.bak-planD-t6-' + time.strftime('%Y%m%d-%H%M%S'))
s = s.replace(anchor, ADD + u'  return { send, verify, ready };')
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')
```

Expected: `patched /var/www/connectcare/binasmart/auth/phone-code-flow.js <n> chars`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-flow.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 17`  
> `# fail 0`  

- [ ] **Step 5: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1196`, `# pass 1196`, `# fail 0`.

- [ ] **Step 6: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 6: ' 2 /tmp/planD-msg.txt && git add auth/phone-code-flow.js test/auth/phone-code-flow.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
A spent code signs in the account the number already belongs to

An answered SMS is proof of a number, which is the only thing this site
ever links accounts on. If another door proved the number first, that is
the account — a rider keeps their rides and a driver their earnings. If
nobody has it, a new account with role user and a placeholder address on
a domain we own. The code is single use, a wrong one is counted against
the same row, and every failure is the same answer, because telling them
apart tells an attacker how far a guess got.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: `auth/phone-code-plugin.mjs` and the wiring in `auth.mjs`

**Files:**
- Create: `auth/phone-code-plugin.mjs`
- Modify: `auth.mjs`
- Modify: `auth/identity.js` (one regular expression in `me()`)
- Test: `test/auth/phone-code-wiring.test.js`

Test delta: +6 tests (1196 → 1202).

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 7: ' 0 test/auth/phone-code-wiring.test.js"`  

```js
'use strict';
// The glue. auth.mjs cannot be imported in a test — it opens a Prisma client and reads the
// environment — so its wiring is pinned by reading it, the way test/messaging/server-delivery.test.js
// pins server.js. The plugin itself IS imported: it is pure glue and importing it proves the two
// endpoints exist at the addresses the login page posts to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the plugin offers exactly two POST endpoints, at the addresses the login page posts to', async () => {
  const { phoneCode } = await import('../../auth/phone-code-plugin.mjs');
  const p = phoneCode({ pepper: 'test-pepper-0000000000000000000000000000', sender: { configured: false, supports: () => true, send: async () => ({ ok: true }) } });
  assert.equal(p.id, 'phone-code');
  const names = Object.keys(p.endpoints).sort();
  assert.deepEqual(names, ['sendPhoneCode', 'verifyPhoneCode']);
  assert.equal(p.endpoints.sendPhoneCode.path, '/sign-in/phone-code/send');
  assert.equal(p.endpoints.verifyPhoneCode.path, '/sign-in/phone-code/verify');
  assert.equal(p.endpoints.sendPhoneCode.options.method, 'POST');
  assert.equal(p.endpoints.verifyPhoneCode.options.method, 'POST', 'a code must never be able to travel in a URL');
});

test('the plugin keeps one flow, so the limiters are a rate limit and not a decoration', () => {
  const src = read('auth/phone-code-plugin.mjs');
  assert.match(src, /let flow = null;/);
  assert.match(src, /if \(flow\) return flow;/);
  assert.match(src, /makePhoneCodeFlow\(\{/);
  // The address comes from the header nginx sets, not from the socket, which is 127.0.0.1 for everyone.
  assert.match(src, /x-real-ip/);
  assert.match(src, /identity\.setVerifiedPhone\(userId, phone, 'sms'\)/);
});

test('every refusal from the flow has one status, and the wrong-code sentence is one sentence', () => {
  const src = read('auth/phone-code-plugin.mjs');
  assert.match(src, /'not_configured'.*SERVICE_UNAVAILABLE|SERVICE_UNAVAILABLE[\s\S]{0,120}not configured/);
  assert.match(src, /new APIError\('BAD_REQUEST', \{ message: 'not_reachable' \}\)/);
  assert.match(src, /new APIError\('TOO_MANY_REQUESTS', \{ message: 'rate_limited' \}\)/);
  // One message object for both ways verify can fail, so the two are not distinguishable.
  assert.equal((src.match(/message: NO/g) || []).length, 2);
  assert.match(src, /const NO = /);
  // What comes back is masked; the full number is never echoed by the server.
  assert.match(src, /phone: pc\.maskPhone\(normPhone\(ctx\.body\.phone\)\)/);
});

test('auth.mjs adds the phone door beside Telegram, with the sender and the pepper from the environment', () => {
  const src = read('auth.mjs');
  assert.match(src, /import \{ phoneCode \} from '\.\/auth\/phone-code-plugin\.mjs';/);
  assert.match(src, /const \{ makePhoneCodeSender \} = require\('\.\/auth\/phone-code-sender\.js'\);/);
  assert.match(src, /phoneCode\(\{/);
  assert.match(src, /sender: makePhoneCodeSender\(\{ prisma, env: process\.env/);
  assert.match(src, /pepper: process\.env\.AUTH_PHONE_CODE_PEPPER/);
  assert.match(src, /telegram\(\{ botToken: process\.env\.BINA_RIDER_BOT_TOKEN \}\)/, 'the Telegram door is untouched');
  // The pepper is read, never printed.
  assert.equal(/console\.log\([^)]*PEPPER/.test(src), false);
});

test('a phone-only account has no e-mail address as far as the site is concerned', async () => {
  const { makeIdentity } = require('../../auth/identity');
  const row = {
    id: 'u1', name: '+251 ••• 0001', email: 'p251900000001@phone.bina.et', image: null, role: 'user',
    phone: '+251900000001', phoneVerifiedAt: new Date(), telegramId: null, buildingSlug: null,
    rider: null, driver: null, memberships: [], accounts: []
  };
  const identity = makeIdentity({ prisma: { authUser: { findUnique: async () => row } } });
  const me = await identity.me('u1');
  assert.equal(me.email, null, 'a placeholder is not an address');
  assert.equal(me.phone, '+251900000001');
  assert.equal(me.phoneVerified, true);
  assert.deepEqual(me.roles, ['user']);
});

test('a real address is still shown, and the Telegram placeholder is still hidden', async () => {
  const { makeIdentity } = require('../../auth/identity');
  const base = { id: 'u1', name: 'Demo', image: null, role: 'user', phone: null, phoneVerifiedAt: null,
    telegramId: null, buildingSlug: null, rider: null, driver: null, memberships: [], accounts: [] };
  const of = async email => (await makeIdentity({ prisma: { authUser: { findUnique: async () => Object.assign({}, base, { email }) } } }).me('u1')).email;
  assert.equal(await of('owner@example.com'), 'owner@example.com');
  assert.equal(await of('tg123@telegram.bina.et'), null);
  assert.equal(await of('p251900000001@phone.bina.et'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-wiring.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 0`  
> `# fail 6`  
The first three cannot find `auth/phone-code-plugin.mjs`, the fourth finds no `phoneCode` in `auth.mjs`, and the last two fail on `me.email` still being the placeholder address.

- [ ] **Step 3: Write the plugin**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 7: ' 1 auth/phone-code-plugin.mjs"`  

```js
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

export const phoneCode = (options = {}) => {
  let flow = null;
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
```

- [ ] **Step 4: Wire it into `auth.mjs` and widen the placeholder test in `auth/identity.js`**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t7_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 7: ' 2 /tmp/t7_patch.py && python3 /tmp/t7_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]

# ---- auth.mjs ----
p = os.path.join(root, 'auth.mjs')
s = io.open(p, encoding='utf-8').read()
if 'phoneCode' in s:
    raise SystemExit('already applied: auth.mjs')

a1 = u"import { telegram } from './auth/telegram-plugin.mjs';\n"
if s.count(a1) != 1:
    raise SystemExit('anchor not found exactly once: telegram import')
add1 = (u"import { telegram } from './auth/telegram-plugin.mjs';\n"
        u"import { phoneCode } from './auth/phone-code-plugin.mjs';\n"
        u"import { createRequire } from 'node:module';\n"
        u"\n"
        u"// The SMS sender is CommonJS (messaging/*), as auth/telegram-verify.js is; this is the same bridge.\n"
        u"const require = createRequire(import.meta.url);\n"
        u"const { makePhoneCodeSender } = require('./auth/phone-code-sender.js');\n")

a2 = u"  plugins: [telegram({ botToken: process.env.BINA_RIDER_BOT_TOKEN })],\n"
if s.count(a2) != 1:
    raise SystemExit('anchor not found exactly once: plugins')
add2 = (u"  // Sign in with a code sent by SMS. Like Google above, it is a door only when it is fully\n"
        u"  // configured: no provider token, SMS switched off, or a pepper shorter than 32 characters and\n"
        u"  // the flow answers 'not configured' to everything. The login page asks /api/auth-methods and\n"
        u"  // does not draw a button it cannot use.\n"
        u"  plugins: [\n"
        u"    telegram({ botToken: process.env.BINA_RIDER_BOT_TOKEN }),\n"
        u"    phoneCode({\n"
        u"      prisma,\n"
        u"      sender: makePhoneCodeSender({ prisma, env: process.env, log: m => console.log(m) }),\n"
        u"      pepper: process.env.AUTH_PHONE_CODE_PEPPER || ''\n"
        u"    })\n"
        u"  ],\n")

shutil.copy2(p, p + '.bak-planD-t7-' + time.strftime('%Y%m%d-%H%M%S'))
s = s.replace(a1, add1).replace(a2, add2)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')

# ---- auth/identity.js ----
q = os.path.join(root, 'auth', 'identity.js')
t = io.open(q, encoding='utf-8').read()
if 'phone\\.bina\\.et' in t:
    raise SystemExit('already applied: identity.js')
a3 = u"      email: /@telegram\\.bina\\.et$/.test(u.email) ? null : u.email,   // a placeholder is not an address"
if t.count(a3) != 1:
    raise SystemExit('anchor not found exactly once: identity email')
add3 = u"      email: /@telegram\\.bina\\.et$|@phone\\.bina\\.et$/.test(u.email) ? null : u.email,   // a placeholder is not an address"
shutil.copy2(q, q + '.bak-planD-t7-' + time.strftime('%Y%m%d-%H%M%S'))
t = t.replace(a3, add3)
io.open(q, 'w', encoding='utf-8', newline='\n').write(t)
print('patched', q, len(t), 'chars')
```

Expected: two `patched ...` lines.

- [ ] **Step 5: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-wiring.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 6`  
> `# fail 0`  

- [ ] **Step 6: Run the whole suite, restart, and check the door loaded**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`  
Expected: `# tests 1202`, `# pass 1202`, `# fail 0`.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health"`  
Expected: a JSON body whose first field is `ok` and `true`.

Run: `ssh root@31.97.176.180 "tail -n 40 /root/.pm2/logs/binasmart-api-out.log | grep -c 'better-auth ready'"`  
Expected: `1` — `auth.mjs` still loads. If it is `0`, run `ssh root@31.97.176.180 "tail -n 20 /root/.pm2/logs/binasmart-api-error.log"` and fix before going on.

Run: `ssh root@31.97.176.180 "curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{\"phone\":\"0900000001\"}' http://127.0.0.1:4210/api/auth/sign-in/phone-code/send"`  
Expected: `503` — the endpoint exists and, with no pepper set yet, refuses everything. **Nothing is sent**: the flow stops before the sender. (If the shell fights the inner quotes, put the same `curl` line in `/tmp/probe.sh` and `scp` it up instead.)

- [ ] **Step 7: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 7: ' 3 /tmp/planD-msg.txt && git add auth/phone-code-plugin.mjs auth.mjs auth/identity.js test/auth/phone-code-wiring.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
The phone door, mounted beside Telegram and Google

The plugin is glue and nothing else: better-auth's adapters become the
flow's store, and the flow's three refusals become 503, 400 and 429. It
keeps one flow for the life of the process, because a limiter rebuilt on
every request is not a rate limit. better-auth ships a phoneNumber
plugin and it is not used: it writes the code into auth_verification in
clear, wants a second pair of phone columns beside the ones this site
already has, tells expired and wrong and locked apart in its replies,
and cannot key its limit on X-Real-IP. A phone-only account carries a
placeholder address, so identity.me now hides that one too.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 8: `/api/auth-methods` tells the page whether the phone door exists

**Files:**
- Modify: `server.js:115-124`
- Test: `test/auth/phone-code-wiring.test.js` (appended)

Test delta: +3 tests (1202 → 1205).

The route this plan needs already exists and the login page already asks it, so the field is added there rather than at a second address: `/api/auth-options` would be the same answer twice, and two answers drift.

- [ ] **Step 1: Check nothing else reads the field being replaced**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && grep -rn 'auth-methods' --include=*.js --include=*.html --include=*.mjs . | grep -v node_modules | grep -v /.bak-"`
Expected: exactly two lines — `server.js:115` (the route) and `public/login.html` (the fetch). Then:
Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && grep -rn 'm.sms' public/ agents/ miniapp/ 2>/dev/null | grep -v node_modules"`
Expected: no output — nothing reads the `sms` field, so replacing it breaks nothing.

- [ ] **Step 2: Write the failing tests**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t8_tests.js && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 8: ' 0 /tmp/t8_tests.js && cat /tmp/t8_tests.js >> test/auth/phone-code-wiring.test.js && tail -n 3 test/auth/phone-code-wiring.test.js"`  

```js

// ----- Task 8: what the login page is allowed to draw -----
// server.js starts a listener on require, so the route is pinned by reading it, exactly as
// test/messaging/server-delivery.test.js does. The one expression that decides is then run on its own
// against made-up environments, which is the part that could be wrong in an interesting way.
const block = (src, sig, end = '\n});') => { const at = src.indexOf(sig); assert.ok(at > 0, sig + ' not found'); return src.slice(at, src.indexOf(end, at)); };

test('auth-methods answers with the three doors and the bot username, cached for a minute', () => {
  const body = block(read('server.js'), "fastify.get('/api/auth-methods'");
  assert.match(body, /Cache-Control', 'public, max-age=60'/);
  assert.match(body, /google: !!\(process\.env\.GOOGLE_CLIENT_ID && process\.env\.GOOGLE_CLIENT_SECRET\)/);
  assert.match(body, /telegram: !!process\.env\.BINA_RIDER_BOT_TOKEN/);
  assert.match(body, /telegramBot: process\.env\.BINA_RIDER_BOT_USERNAME/);
  assert.match(body, /email: true/);
  assert.match(body, /phone: authPhoneReady\(process\.env\)/);
  assert.equal(/sms:/.test(body), false, 'the placeholder field is gone, not left beside its replacement');
  // The two secrets this plan touches are read inside authPhoneReady and never named in the answer.
  assert.equal(/SMS_API_TOKEN|AUTH_PHONE_CODE_PEPPER/.test(body), false, 'neither secret is named in a cached public route');
});

test('the phone door needs all three switches, and says so from one place', () => {
  const src = read('server.js');
  const fn = block(src, 'function authPhoneReady(', '\n}\n');
  assert.equal((src.match(/function authPhoneReady\(/g) || []).length, 1, 'one rule, in one place');
  // Run it: the source is a function declaration, so it can be evaluated on its own.
  // eslint-disable-next-line no-new-func
  const authPhoneReady = new Function('return (' + fn + '\n}\n)')();
  const token = 'fake-token-for-tests';
  const pepper = 'test-pepper-0000000000000000000000000000';
  assert.equal(authPhoneReady({ SMS_API_TOKEN: token, SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: pepper }), true);
  assert.equal(authPhoneReady({ SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: pepper }), false, 'no provider token');
  assert.equal(authPhoneReady({ SMS_API_TOKEN: token, SMS_MODE: 'test', AUTH_PHONE_CODE_PEPPER: pepper }), false, 'SMS switched off');
  assert.equal(authPhoneReady({ SMS_API_TOKEN: token, SMS_MODE: 'live' }), false, 'no pepper');
  assert.equal(authPhoneReady({ SMS_API_TOKEN: token, SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: 'short' }), false, 'a pepper too short to be one');
  assert.equal(authPhoneReady({}), false);
});

test('the answer is a plain boolean — never the token, never the pepper, never their lengths', () => {
  const src = read('server.js');
  const fn = block(src, 'function authPhoneReady(', '\n}\n');
  // eslint-disable-next-line no-new-func
  const authPhoneReady = new Function('return (' + fn + '\n}\n)')();
  const out = authPhoneReady({ SMS_API_TOKEN: 'fake-token-for-tests', SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: 'test-pepper-0000000000000000000000000000' });
  assert.equal(typeof out, 'boolean');
  assert.equal(out, true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-wiring.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected: `# pass 6`, `# fail 3` — `function authPhoneReady( not found`.

- [ ] **Step 4: Write the implementation**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t8_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 8: ' 1 /tmp/t8_patch.py && python3 /tmp/t8_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]
p = os.path.join(root, 'server.js')
s = io.open(p, encoding='utf-8').read()
if 'authPhoneReady' in s:
    raise SystemExit('already applied')

a1 = u"fastify.get('/api/auth-methods', async (req, reply) => {"
if s.count(a1) != 1:
    raise SystemExit('anchor not found exactly once: route')
add1 = (u"// Whether the phone door exists at all. Three switches, all of them needed, in one place: a\n"
        u"// provider token (messaging/sms.js), SMS actually switched on, and a pepper long enough to hash a\n"
        u"// code with (auth/phone-code.js MIN_PEPPER). Half a door is worse than none — a button that sends\n"
        u"// nothing looks like a site that is broken. The answer is a boolean and only a boolean: no value,\n"
        u"// no length, nothing that narrows a guess at either secret.\n"
        u"function authPhoneReady(env) {\n"
        u"  return !!(env.SMS_API_TOKEN && env.SMS_MODE === 'live' && String(env.AUTH_PHONE_CODE_PEPPER || '').length >= 32);\n"
        u"}\n"
        u"\n"
        u"fastify.get('/api/auth-methods', async (req, reply) => {")

a2 = u"    email: true,\n    sms: false   // the third door, once there is a provider\n"
if s.count(a2) != 1:
    raise SystemExit('anchor not found exactly once: sms field')
add2 = u"    email: true,\n    phone: authPhoneReady(process.env)   // sign in with a code sent by SMS\n"

shutil.copy2(p, p + '.bak-planD-t8-' + time.strftime('%Y%m%d-%H%M%S'))
s = s.replace(a1, add1).replace(a2, add2)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')
```

Expected: `patched /var/www/connectcare/binasmart/server.js <n> chars`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-wiring.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 9`  
> `# fail 0`  

- [ ] **Step 6: Run the whole suite, restart, and read the route**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`  
Expected: `# tests 1205`, `# pass 1205`, `# fail 0`.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/api/auth-methods"`  
Expected: `{"google":...,"telegram":true,"telegramBot":"bina_smart_bot","email":true,"phone":false}` — `phone` is **false** today, because `AUTH_PHONE_CODE_PEPPER` is not set and `SMS_MODE` is not live. That is the point: the page will draw no phone form until Task 12.

Run: `ssh root@31.97.176.180 "tail -n 5 /root/.pm2/logs/binasmart-api-error.log"`  
Expected: nothing timestamped after the restart.

- [ ] **Step 7: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 8: ' 2 /tmp/planD-msg.txt && git add server.js test/auth/phone-code-wiring.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
The login page is told which doors actually exist

auth-methods had a placeholder that said sms: false and a comment about
the day there would be a provider. That day is here, so the placeholder
becomes phone, computed by one function that wants all three switches:
a provider token, SMS live, and a pepper long enough to hash a code
with. The answer is a boolean and only a boolean, so nothing about
either secret leaks through a cached public route, and the page draws
no button it cannot use.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 9: The new login page

**Files:**
- Replace: `public/login.html`
- Test: `test/auth/login-page.test.js`

Test delta: +8 tests (1205 → 1213).

`public/login.html` is served by `fastify.get('/login', ... sendFile('login.html'))`, a path with no extension, so the `onSend` hook gives it no long cache header: the change is live as soon as the file is written, with no restart and no `?v=` bump. Nothing under `/static/` changes in this task.

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 9: ' 0 test/auth/login-page.test.js"`  

```js
'use strict';
// The login page is a static file with an inline script, so it is pinned by reading it — the same way
// test/messaging/dashboard.test.js pins the owner dashboard. These tests are about the four things a
// sign-in page can get wrong: writing HTML, putting a code in a URL, saying too much about a failure,
// and speaking only one language.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'login.html'), 'utf8');
const ETHIOPIC = /[ሀ-፿]/;

test('nothing on this page is ever written as HTML', () => {
  assert.equal(src.includes('innerHTML'), false);
  assert.equal(src.includes('outerHTML'), false);
  assert.equal(src.includes('insertAdjacentHTML'), false);
  assert.equal(src.includes('document.write'), false);
  assert.equal(src.includes('eval('), false);
  // No template literal anywhere in the script, so there is no interpolation to get wrong.
  assert.equal(/`/.test(src), false, 'no backticks: every string is a plain one');
  // Everything the page says goes through textContent.
  assert.ok((src.match(/\.textContent = /g) || []).length >= 8);
});

test('the phone door is the first door, and it is not drawn until the server says it exists', () => {
  assert.match(src, /<div id="phoneBox" class="door" hidden>/);
  assert.match(src, /if \(m\.phone\) \{/);
  assert.match(src, /\$\('phoneBox'\)\.hidden = false;/);
  const at = s => { const i = src.indexOf(s); assert.ok(i > 0, s + ' not found'); return i; };
  assert.ok(at('id="phoneBox"') < at('id="tgBox"'), 'phone before Telegram');
  assert.ok(at('id="tgBox"') < at('id="googleBtn"'), 'Telegram before Google');
  assert.ok(at('id="googleBtn"') < at('id="staff"'), 'the staff email form is last');
  // A 503 from the server means the door was switched off while the page was open: take it away.
  assert.match(src, /if \(r\.status === 503\) \{ \$\('phoneBox'\)\.hidden = true;/);
});

test('a code travels in a POST body and never in a URL, and the phone is asked to fill it in', () => {
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/phone-code\/send', \{ method:'POST'/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/phone-code\/verify', \{ method:'POST'/);
  assert.equal(/phone-code[^'"]*\?/.test(src), false, 'no query string on either endpoint');
  assert.match(src, /autocomplete="one-time-code"/, 'the keyboard offers the code from the SMS');
  assert.match(src, /inputmode="numeric"/);
  assert.match(src, /autocomplete="tel"/);
  assert.match(src, /maxlength="6"/);
});

test('a second code cannot be asked for inside sixty seconds, and the wait is shown', () => {
  assert.match(src, /var left = 60, a = \$\('pResend'\);/);
  assert.match(src, /a\.setAttribute\('aria-disabled', 'true'\);/);
  assert.match(src, /if \(\$\('pResend'\)\.getAttribute\('aria-disabled'\) === 'true'\) return;/);
  assert.match(src, /clearInterval\(tick\)/);
});

test('one sentence for a code that did not work, whatever was wrong with it', () => {
  assert.match(src, /badCode: '/);
  const fn = src.slice(src.indexOf('function signInCode('), src.indexOf('\n}', src.indexOf('function signInCode(')));
  // Only two things can be said here: you are asking too often, or that code did not work.
  assert.match(fn, /showErr\(r\.status === 429 \? T\.tooMany : T\.badCode\)/);
  assert.equal(/expired.*wrong|attempts|locked|remaining|left/i.test(fn), false, 'the page never says how close a guess was');
  // The number is cleared and focused again, so the next attempt is one tap away.
  assert.match(fn, /\$\('code'\)\.value = '';/);
});

test('every sentence the page can say is in Amharic and in English', () => {
  const from = src.indexOf('var T = {');
  assert.ok(from > 0, 'the sentences live in one place');
  const block = src.slice(from, src.indexOf('};', from));
  // T holds plain sentences only — nothing with a `function` in it, so every quoted run is a sentence.
  assert.equal(block.includes('function'), false, 'T is sentences; the two that take a number live beside it');
  const said = block.match(/'[^']{12,}'/g) || [];
  assert.ok(said.length >= 12, 'found only ' + said.length + ' sentences');
  for (const s of said) {
    assert.match(s, ETHIOPIC, 'no Amharic in: ' + s);
    assert.match(s, /[A-Za-z]/, 'no English in: ' + s);
  }
  // The two sentences that take a number are built by hand; they carry both languages too.
  for (const name of ['waitText', 'sentToText']) {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at > 0, name + ' not found');
    const line = src.slice(at, src.indexOf('\n', at));
    assert.match(line, ETHIOPIC, 'no Amharic in ' + name + ': ' + line);
    assert.match(line, /[A-Za-z]/, 'no English in ' + name + ': ' + line);
  }
});

test('Telegram, Google and the staff email form still work exactly as they did', () => {
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/telegram', \{ method:'POST'/);
  assert.match(src, /body: JSON\.stringify\(\{ widget: user, callbackURL: NEXT \}\)/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/social', \{ method:'POST'/);
  assert.match(src, /provider:'google', callbackURL: location\.origin \+ NEXT/);
  assert.match(src, /fetch\('\/api\/auth\/sign-in\/email', \{ method:'POST'/);
  assert.match(src, /s\.setAttribute\('data-telegram-login', m\.telegramBot\);/);
  assert.match(src, /telegram\.org\/js\/telegram-widget\.js\?22/);
  // The open-redirect guard on ?next is untouched.
  assert.match(src, /if \(!\/\^\\\/\(\?!\\\/\)\/\.test\(NEXT\)\) NEXT = '\/';/);
});

test('the page is built for a phone first', () => {
  assert.match(src, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.match(src, /@media\(max-width:760px\)/);
  assert.match(src, /<meta name="robots" content="noindex">/);
  // No third-party script but Telegram's own widget, and it is only added when Telegram is configured.
  const scripts = src.match(/src="https?:[^"]+"/g) || [];
  assert.deepEqual(scripts, [], 'no external script tag in the markup');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/login-page.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 2`  
> `# fail 6`  
Two tests describe what the old page already did (the other three doors, and mobile-first) and pass. Six fail: there is no phone door, no `T` object of sentences, no `signInCode`, and the old page sets `textContent` exactly once.

- [ ] **Step 3: Write the page**

The slicer refuses to overwrite, so move the old file aside first (it stays as a `.bak-` for comparison and is git-ignored):

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && cp public/login.html public/login.html.bak-planD-t9 && rm public/login.html && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 9: ' 1 public/login.html && wc -c public/login.html"`  

```html
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Sign in · መግቢያ — BinaSmart</title>
<link rel="icon" href="/icon-32.png">
<link rel="stylesheet" href="/static/fonts/fonts.css?v=2">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--em:#0aa88f;--em2:#068f79;--ink:#0f2027;--mut:#5c7080;--line:#e3ecea;--err:#e5484d}
body{font-family:'Plus Jakarta Sans','Noto Sans Ethiopic',system-ui,sans-serif;color:var(--ink);background:#eef4f3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:18px}
.am{font-family:'Noto Sans Ethiopic',sans-serif}
.shell{display:grid;grid-template-columns:1fr 1fr;max-width:900px;width:100%;background:#fff;border-radius:26px;overflow:hidden;box-shadow:0 30px 70px -30px rgba(15,32,39,.35)}
.brandp{background:radial-gradient(600px 300px at 20% 10%,rgba(118,185,0,.18),transparent 60%),linear-gradient(150deg,#0f2027,#0a3a34);color:#fff;padding:44px 38px;display:flex;flex-direction:column}
.brandp .logo{font-size:26px;font-weight:800;letter-spacing:-.5px}.brandp .logo .g{color:#5fe3cf}
.brandp .tag{color:#a9c4bf;font-size:14px;margin-top:6px}
.brandp h2{font-size:26px;font-weight:800;line-height:1.2;margin:auto 0 18px}
.feat{display:flex;flex-direction:column;gap:12px}.feat .f{display:flex;gap:11px;align-items:flex-start;font-size:14px;color:#dceeeb}.feat .f .i{font-size:18px}
.formp{padding:44px 40px;display:flex;flex-direction:column;justify-content:center}
.formp h1{font-size:24px;font-weight:800}.formp .sub{color:var(--mut);font-size:14px;margin:4px 0 24px}
label{display:block;font-size:12.5px;font-weight:700;color:var(--mut);margin:12px 0 6px}
input{width:100%;padding:14px 15px;border:1.5px solid var(--line);border-radius:12px;font-size:15px;font-family:inherit;font-weight:600;color:var(--ink);background:#fff}
input:focus{outline:0;border-color:var(--em);box-shadow:0 0 0 3px rgba(10,168,143,.12)}
button{width:100%;margin-top:16px;padding:15px;border:0;border-radius:12px;font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;background:var(--em);color:#fff;transition:.15s}
button:hover{background:var(--em2)}button:disabled{opacity:.6;cursor:wait}
.err{display:none;background:#fef2f2;border:1.5px solid #fecaca;color:var(--err);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700;margin-top:14px;line-height:1.5}
.foot{color:var(--mut);font-size:12.5px;margin-top:22px;line-height:1.7;border-top:1px solid var(--line);padding-top:16px}
.foot a{color:var(--em);font-weight:700;text-decoration:none}
.back{display:inline-block;margin-top:14px;color:var(--mut);font-size:13px;text-decoration:none}
@media(max-width:760px){.shell{grid-template-columns:1fr;max-width:440px}.brandp{padding:26px 24px}.brandp h2{font-size:20px;margin:16px 0 14px}.formp{padding:28px 22px}}
[hidden]{display:none!important}
.door{margin-bottom:14px}.doorHint{font-size:13px;color:var(--mut);margin-bottom:8px;font-weight:700}
#tgWidget{min-height:44px;display:flex;justify-content:center}
.gbtn{width:100%;margin:0 0 10px;padding:13px;border:1.5px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer}
.gbtn:hover{background:#f7faf9}
.or{display:flex;align-items:center;gap:10px;margin:16px 0;color:var(--mut);font-size:13px}
.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.staffLink{display:block;text-align:center;color:var(--mut);font-size:14px;font-weight:600;text-decoration:none}
.staffLink:hover{color:var(--em)}
.doorNote{font-size:13px;color:var(--mut);text-align:center;padding:10px 0}
.sent{font-size:13.5px;color:var(--mut);background:#f3f8f7;border:1px solid var(--line);border-radius:10px;padding:10px 12px;line-height:1.5;word-break:break-word}
.resend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:13px}
.resend a{color:var(--em);font-weight:700;text-decoration:none}
.resend a[aria-disabled="true"]{color:var(--mut);cursor:default}
#code{letter-spacing:.34em;font-size:19px;text-align:center}
</style></head><body>
<div class="shell">
  <div class="brandp">
    <div class="logo">Bina<span class="g">ዜና</span></div>
    <div class="tag am">ሁሉንም በአንድ መድረክ · All-in-one platform</div>
    <h2>Welcome back.</h2>
    <div class="feat">
      <div class="f"><span class="i">📱</span><span>Sign in with your phone — <span class="am">በስልክ ቁጥርዎ ይግቡ።</span></span></div>
      <div class="f"><span class="i">🔒</span><span>Secure sign-in · your data stays private.</span></div>
      <div class="f am"><span class="i">🗣️</span><span>በአማርኛ ድጋፍ ይገኛል።</span></div>
    </div>
  </div>
  <div class="formp">
    <h1>Sign in · <span class="am">ይግቡ</span></h1>
    <div class="sub am">የይለፍ ቃል አያስፈልግም — ኮድ በኤስኤምኤስ ይላካል</div>

    <div id="doors">
      <div id="phoneBox" class="door" hidden>
        <div class="doorHint am">በስልክ ይግቡ · Continue with your phone</div>
        <div id="pStep1">
          <label for="phone">Phone · <span class="am">ስልክ</span></label>
          <input id="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="17" placeholder="09XX XXX XXX">
          <button id="pSend" onclick="sendCode()"><span id="pSendT" class="am">ኮድ ላክ · Send code</span></button>
        </div>
        <div id="pStep2" hidden>
          <div class="sent am" id="pSent"></div>
          <label for="code">6-digit code · <span class="am">ባለ6 አኃዝ ኮድ</span></label>
          <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
          <button id="pGo" onclick="signInCode()"><span id="pGoT" class="am">ግባ · Sign in</span></button>
          <div class="resend">
            <a href="#" id="pResend" onclick="resend();return false;"></a>
            <a href="#" onclick="backToPhone();return false;" class="am">ቁጥር ይቀይሩ · change number</a>
          </div>
        </div>
      </div>

      <div id="tgBox" class="door"><div class="doorHint am">በቴሌግራም ይግቡ · Continue with Telegram</div><div id="tgWidget"></div></div>
      <button id="googleBtn" class="gbtn" hidden onclick="signInGoogle()">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.6 5-4.5 7l6.9 5.3C42.5 36.2 45 30.6 45 24z"/><path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-6.9-5.3C29.8 36.5 27.2 37.4 24 37.4c-5.8 0-10.7-3.9-12.5-9.1l-7.1 5.5C8 40.9 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.5 28.3c-.5-1.4-.7-2.8-.7-4.3s.3-3 .7-4.3l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.8l7.1-5.5z"/><path fill="#EA4335" d="M24 10.6c3.3 0 6.2 1.1 8.5 3.3l6.1-6.1C34.9 4.3 30 2 24 2 15.4 2 8 7.1 4.4 14.2l7.1 5.5C13.3 14.5 18.2 10.6 24 10.6z"/></svg>
        <span>Continue with Google</span>
      </button>
      <div class="err" id="err"></div>
      <div class="doorNote am" id="tgNote" hidden>ቴሌግራም መግቢያ ገና አልተዘጋጀም · Telegram sign-in is not configured yet.</div>
    </div>

    <div class="or"><span>or · <span class="am">ወይም</span></span></div>
    <a class="staffLink" href="#" onclick="showStaff();return false;">Staff sign in with email · <span class="am">በኢሜይል</span></a>

    <div id="staff" hidden>
      <label for="email">Email · <span class="am">ኢሜይል</span></label>
      <input id="email" type="email" autocomplete="email" inputmode="email" placeholder="owner@example.com">
      <label for="password">Password · <span class="am">የይለፍ ቃል</span></label>
      <input id="password" type="password" autocomplete="current-password" placeholder="••••••••">
      <button id="go" onclick="signIn()">Sign in &rarr;</button>
    </div>

    <div class="foot am">አዲስ ተጠቃሚ ከሆኑ በስልክዎ ሲገቡ መለያዎ ራሱ ይፈጠራል።<br>
      <span style="font-family:'Plus Jakarta Sans',sans-serif">Drivers and businesses still need to register and be approved.</span>
      <a href="/drive-with-us">drive with us &rarr;</a></div>
    <a class="back" href="/">&larr; BinaSmart</a>
  </div>
</div>
<script>
// One account, several doors. A code by SMS, Telegram and Google all land on the same session cookie;
// the email form stays only for staff and building owners created by hand.
//
// Nothing on this page is ever written as HTML. Every message goes through textContent, so a sentence
// is a sentence and never markup — and there is no ?next, no code and no number in any URL.
var NEXT = new URLSearchParams(location.search).get('next') || '/';
if (!/^\/(?!\/)/.test(NEXT)) NEXT = '/';          // never bounce to another site
function $(id){ return document.getElementById(id); }
var err = $('err');
function showErr(m){ err.textContent = m; err.style.display = 'block'; }
function clearErr(){ err.textContent = ''; err.style.display = 'none'; }
function showStaff(){ var s = $('staff'); s.hidden = false; $('email').focus(); }

// Every sentence this page can say, in Amharic and English, in one place.
var T = {
  badPhone: 'ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ · Enter an Ethiopian mobile number, for example 0911 234 567',
  notReach: 'ወደዚህ ቁጥር ኤስኤምኤስ መላክ አይቻልም · We cannot send an SMS to that number. Please use an Ethio Telecom number starting 09.',
  tooMany: 'በጣም ብዙ ሙከራ · Too many requests. Please wait a few minutes and try again.',
  offline: 'ግንኙነት አልተሳካም · Connection failed. Please try again.',
  noDoor: 'በስልክ መግባት ገና አልተዘጋጀም · Signing in by phone is not available yet.',
  badCode: 'ኮዱ ትክክል አይደለም ወይም ጊዜው አልፎበታል · That code is wrong or has expired. Ask for a new one.',
  need6: 'ባለ6 አኃዝ ኮድ ያስገቡ · Enter the six digits from the SMS.',
  sending: 'በመላክ ላይ… · Sending…',
  send: 'ኮድ ላክ · Send code',
  checking: 'በማረጋገጥ ላይ… · Checking…',
  go: 'ግባ · Sign in',
  again: 'እንደገና ላክ · Send the code again',
  wrongPass: 'ኢሜይል ወይም የይለፍ ቃል ትክክል አይደለም · Wrong email or password',
  needBoth: 'ኢሜይል እና የይለፍ ቃል ያስገቡ · Enter email and password'
};
// Two sentences take a number, so they are built rather than looked up. Both languages, same rule.
function waitText(s){ return 'እንደገና ላክ · Send again in ' + s + 's'; }
function sentToText(p){ return 'ኮድ ተልኳል ወደ · Code sent to ' + p + ' — 5 ደቂቃ/min'; }

// Only for showing a number back to the person who typed it. The server decides what a number is.
function e164(v){
  var s = String(v || '').replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1);
  if (/^251\d{9}$/.test(s)) s = '+' + s;
  return /^\+251\d{9}$/.test(s) ? s : null;
}
function mask(p){ return '+251 ••• ' + String(p).slice(-4); }

// after any successful sign-in, owners go to their building, everyone else to the "next" they came with
async function land(){
  try{
    var s = await (await fetch('/api/auth/get-session')).json();
    var slug = s && s.user && s.user.buildingSlug;
    location.href = slug ? '/owner/' + slug : NEXT;
  }catch(e){ location.href = NEXT; }
}

// ---- the phone door ----
var PHONE = '';        // the number this tab asked for a code for; never stored anywhere else
var tick = null;

function stopTick(){ if (tick) { clearInterval(tick); tick = null; } }
function startTick(){
  var left = 60, a = $('pResend');
  stopTick();
  a.textContent = waitText(left);
  a.setAttribute('aria-disabled', 'true');
  tick = setInterval(function(){
    left--;
    if (left > 0) { a.textContent = waitText(left); return; }
    stopTick();
    a.textContent = T.again;
    a.removeAttribute('aria-disabled');
  }, 1000);
}
function backToPhone(){
  stopTick(); clearErr();
  $('pStep2').hidden = true; $('pStep1').hidden = false;
  $('code').value = ''; $('phone').focus();
}
function resend(){
  if ($('pResend').getAttribute('aria-disabled') === 'true') return;
  ask(PHONE);
}
function sendCode(){
  var p = e164($('phone').value);
  clearErr();
  if (!p) return showErr(T.badPhone);
  ask(p);
}

// One request whether it is the first code or another one; the server counts them the same way, and
// answers a number it has never seen exactly as it answers one it knows.
function ask(p){
  clearErr();
  var btn = $('pSend'), lbl = $('pSendT');
  btn.disabled = true; lbl.textContent = T.sending;
  fetch('/api/auth/sign-in/phone-code/send', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ phone: p }) })
    .then(function(r){
      btn.disabled = false; lbl.textContent = T.send;
      if (r.ok) {
        PHONE = p;
        $('pSent').textContent = sentToText(mask(p));
        $('pStep1').hidden = true; $('pStep2').hidden = false;
        $('code').value = ''; $('code').focus();
        startTick();
        return;
      }
      if (r.status === 400) return showErr(T.notReach);
      if (r.status === 429) return showErr(T.tooMany);
      if (r.status === 503) { $('phoneBox').hidden = true; return showErr(T.noDoor); }
      showErr(T.offline);
    })
    .catch(function(){ btn.disabled = false; lbl.textContent = T.send; showErr(T.offline); });
}

function signInCode(){
  var c = String($('code').value || '').replace(/\D/g, '');
  clearErr();
  if (c.length !== 6) return showErr(T.need6);
  var btn = $('pGo'), lbl = $('pGoT');
  btn.disabled = true; lbl.textContent = T.checking;
  fetch('/api/auth/sign-in/phone-code/verify', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ phone: PHONE, code: c }) })
    .then(function(r){
      if (r.ok) { stopTick(); return land(); }
      btn.disabled = false; lbl.textContent = T.go;
      $('code').value = ''; $('code').focus();
      // Wrong, expired, never asked for, or five guesses gone: one sentence for all of them.
      showErr(r.status === 429 ? T.tooMany : T.badCode);
    })
    .catch(function(){ btn.disabled = false; lbl.textContent = T.go; showErr(T.offline); });
}

$('phone').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); sendCode(); } });
$('code').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); signInCode(); } });

// ---- the other doors ----
window.onTelegramAuth = function (user) {
  fetch('/api/auth/sign-in/telegram', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ widget: user, callbackURL: NEXT }) })
    .then(function(r){ return r.ok ? land() : showErr('Telegram sign-in failed. Please try again · አልተሳካም'); })
    .catch(function(){ showErr(T.offline); });
};

function signInGoogle(){
  fetch('/api/auth/sign-in/social', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ provider:'google', callbackURL: location.origin + NEXT }) })
    .then(function(r){ return r.json(); })
    .then(function(d){ if (d && d.url) location.href = d.url; else showErr('Google sign-in is unavailable'); })
    .catch(function(){ showErr(T.offline); });
}

async function signIn(){
  var email = $('email').value.trim(), password = $('password').value;
  clearErr();
  if(!email || !password) return showErr(T.needBoth);
  var btn = $('go'); btn.disabled = true; btn.textContent = 'Signing in…';
  try{
    var r = await fetch('/api/auth/sign-in/email', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
    if(!r.ok){ showErr(T.wrongPass); btn.disabled = false; btn.textContent = 'Sign in →'; return; }
    land();
  }catch(e){ showErr(T.offline); btn.disabled = false; btn.textContent = 'Sign in →'; }
}

// Only offer a door that is actually configured on the server. A half-working button is worse than no
// button: it looks like a broken site rather than a door that is not open yet.
fetch('/api/auth-methods').then(function(r){ return r.json(); }).then(function(m){
  if (m.phone) {
    $('phoneBox').hidden = false;
    $('phone').focus();
  }
  if (m.google) $('googleBtn').hidden = false;
  if (m.telegram && m.telegramBot) {
    var s = document.createElement('script');
    s.async = true; s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', m.telegramBot);
    s.setAttribute('data-size','large');
    s.setAttribute('data-radius','12');
    s.setAttribute('data-onauth','onTelegramAuth(user)');
    s.setAttribute('data-request-access','write');
    $('tgWidget').appendChild(s);
  } else {
    $('tgBox').hidden = true;
    if (!m.phone) $('tgNote').hidden = false;
  }
  if (!m.phone && !m.google && !m.telegram) showStaff();
}).catch(function(){ showStaff(); });
</script></body></html>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/login-page.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 8`  
> `# fail 0`  

- [ ] **Step 5: Check the page still parses, and still looks the same with the phone door off**

The inline script must parse as JavaScript. Pull it out and ask node:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node -e \"const fs=require('fs');const s=fs.readFileSync('public/login.html','utf8');const j=s.slice(s.indexOf('<script>')+8,s.lastIndexOf('</'+'script>'));new (require('vm').Script)(j);console.log('parses',j.length)\""`  
Expected: `parses <n>` with no SyntaxError. (If PowerShell fights the inner quotes, put the same one-liner in a local `check-login.js`, `scp` it to `/tmp/check-login.js`, and run `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node /tmp/check-login.js"`.)

Then look at it as a visitor does, with the phone door still switched off:

Run: `ssh root@31.97.176.180 "curl -s http://127.0.0.1:4210/login | grep -c 'phoneBox'"`  
Expected: `2` — the markup is there (`<div id="phoneBox" ... hidden>` and the line that unhides it), and because `/api/auth-methods` still answers `phone:false`, no visitor sees it.

- [ ] **Step 6: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1213`, `# pass 1213`, `# fail 0`.

- [ ] **Step 7: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 9: ' 2 /tmp/planD-msg.txt && git add public/login.html test/auth/login-page.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
A login page that starts with a phone number

Phone first, then Telegram, Google, and the staff email form last, and
each one drawn only when the server says it exists. Every sentence the
page can say lives in one object, in Amharic and English, and a test
fails the build if one of them loses a language. The page writes no
HTML at all — no innerHTML, no template literals, every message through
textContent — the code is typed into a field the phone can fill from the
SMS, and a wrong code, an expired code and five spent guesses are one
sentence, because the page must not say how close a guess was.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 10: The account page — a masked number and what it is joined to

**Files:**
- Modify: `public/account.html`
- Test: `test/auth/account-page.test.js`

Test delta: +5 tests (1213 → 1218).

`public/account.html` is sent with `Cache-Control: no-store` (`server.js:211`), so the change is live the moment the file is written: no restart, no `?v=` bump.

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 10: ' 0 test/auth/account-page.test.js"`  

```js
'use strict';
// The account page shows a person their own number back. That is the one place on the site where a
// full mobile number could end up on a screen in a shop, a taxi or a shared phone — so it does not.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'account.html'), 'utf8');

test('the number is shown by its last four digits, and the full one is never written to the page', () => {
  assert.match(src, /function mask\(p\)\{/);
  assert.match(src, /'\+251 ••• ' \+ s\.slice\(-4\)/);
  assert.match(src, /esc\(mask\(me\.phone\)\)/);
  assert.equal(/esc\(me\.phone\)/.test(src), false, 'the unmasked number must not reach the page');
});

test('the phone door is listed among the doors once the number is proven', () => {
  assert.match(src, /if \(me\.phoneVerified\) doors\.push\('Phone · ስልክ'\);/);
  assert.match(src, /var doors = me\.signedInWith\.map\(/, 'the other doors are still read from the session');
});

test('changing a proven number is said, in both languages, to be out of scope here', () => {
  assert.match(src, /ቁጥር መቀየር/, 'Amharic: changing the number');
  assert.match(src, /contact support/, 'English');
  assert.match(src, /if \(me\.phone\) html \+=/);
});

test('an account with no number is told it can just sign in by phone next time', () => {
  assert.match(src, /if \(!me\.phone\) html \+=/);
  assert.match(src, /ኮድ በኤስኤምኤስ ይላካል/, 'Amharic: a code is sent by SMS');
  assert.match(src, /we send a code by SMS/, 'English');
  assert.match(src, /t\.me\/bina_smart_bot/, 'the Telegram contact route is still offered');
});

test('everything on the page still goes through esc(), and it still reads and ends a session the same way', () => {
  assert.match(src, /function esc\(s\)\{/);
  assert.match(src, /fetch\('\/api\/me'\)/);
  assert.match(src, /location\.href = '\/login\?next=\/account'/);
  assert.match(src, /fetch\('\/api\/auth\/sign-out', \{ method:'POST'/);
  // No value is ever concatenated into html without esc() around it.
  const bare = src.match(/' \+ me\.[a-zA-Z.]+ \+ '/g) || [];
  assert.deepEqual(bare, [], 'unescaped value(s) on the page: ' + bare.join(', '));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/account-page.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected: `# pass 0`, `# fail 5` — there is no `mask`, no phone door in the list, no note about changing a number, and `esc(me.phone)` is still there.

- [ ] **Step 3: Write the implementation**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/t10_patch.py && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 10: ' 1 /tmp/t10_patch.py && python3 /tmp/t10_patch.py /var/www/connectcare/binasmart"`  

```python
import io, os, sys, time, shutil
root = sys.argv[1]
p = os.path.join(root, 'public', 'account.html')
s = io.open(p, encoding='utf-8').read()
if 'function mask(p)' in s:
    raise SystemExit('already applied')

pairs = []

# 1. a masking helper, next to esc()
pairs.append((
  u"var LABEL = {",
  u"// A proven number is shown back to its owner by its last four digits and no more. This screen is\n"
  u"// read over a shoulder far more often than the database behind it is read at all.\n"
  u"function mask(p){ var s = String(p == null ? '' : p); return s.length < 4 ? '' : '+251 ••• ' + s.slice(-4); }\n"
  u"\n"
  u"var LABEL = {"))

# 2. the phone door joins the list of doors
pairs.append((
  u"  var pending = me.roles.indexOf('driver_pending') >= 0;",
  u"  if (me.phoneVerified) doors.push('Phone · ስልክ');\n"
  u"  var pending = me.roles.indexOf('driver_pending') >= 0;"))

# 3. the row itself shows the mask, never the number
pairs.append((
  u"(me.phone ? esc(me.phone) + (me.phoneVerified ?",
  u"(me.phone ? esc(mask(me.phone)) + (me.phoneVerified ?"))

# 4. a proven number cannot be changed here, and that is said rather than left to be discovered
pairs.append((
  u"  if (me.driver) html +=",
  u"  if (me.phone) html += '<div class=\"card muted am\">'\n"
  u"    + 'ቀጥርዎ ተረጋግጧ፤ በዚህ ገጽ ቁጥር መቀየር አይቻል። · '\n"
  u"    + 'Your number is proven. Changing it is not possible here — please contact support.'\n"
  u"    + '</div>';\n"
  u"\n"
  u"  if (me.driver) html +="))

# 5. no number yet: the phone door is a way in, not only a way to link
pairs.append((
  u"      '</div><a class=\"btn\" href=\"https://t.me/bina_smart_bot\"",
  u"      '</div><div class=\"muted am\" style=\"margin-top:10px\">'\n"
  u"      + 'ወይም በሚቀጥለው ጊዜ በስልክ ቁጥርዎ ይግቡ። · Or sign in with your phone next time: we send a code by SMS. '\n"
  u"      + 'ኮድ በኤስኤምኤስ ይላካል።'\n"
  u"      + '</div><a class=\"btn\" href=\"https://t.me/bina_smart_bot\""))

for a, b in pairs:
    if s.count(a) != 1:
        raise SystemExit('anchor not found exactly once: ' + a[:48])

shutil.copy2(p, p + '.bak-planD-t10-' + time.strftime('%Y%m%d-%H%M%S'))
for a, b in pairs:
    s = s.replace(a, b)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('patched', p, len(s), 'chars')
```

Expected: `patched /var/www/connectcare/binasmart/public/account.html <n> chars`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/account-page.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 5`  
> `# fail 0`  

- [ ] **Step 5: Check the page still parses**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node -e \"const fs=require('fs');const s=fs.readFileSync('public/account.html','utf8');const a=s.indexOf('<script>')+8;const j=s.slice(a,s.indexOf('</'+'script>',a));new (require('vm').Script)(j);console.log('parses',j.length)\""`  
Expected: `parses <n>` with no SyntaxError. (If PowerShell fights the inner quotes, `scp` the same one-liner up as `/tmp/check-account.js` and run it from there.)

- [ ] **Step 6: Run the whole suite**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# tests 1218`, `# pass 1218`, `# fail 0`.

- [ ] **Step 7: Commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 10: ' 2 /tmp/planD-msg.txt && git add public/account.html test/auth/account-page.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
Your account shows the last four digits of your number

The account page was the one screen on the site where a full mobile
number could sit in a shop, a taxi or a shared phone, so it now shows
four digits and a tick. The phone joins Telegram and Google in the list
of doors the account can be opened with, an account with no number is
told it can simply sign in by phone next time, and a proven number says
plainly that it cannot be changed here rather than leaving someone to
find that out by trying.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 11: `ops/auth/phone-code-status.js`, and the live check in test mode

**Files:**
- Create: `ops/auth/phone-code-status.js`
- Create: `ops/auth/phone-code-dryrun.js`
- Test: `test/auth/phone-code-ops.test.js`

Test delta: +5 tests (1218 → 1223).

- [ ] **Step 1: Write the failing test**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 11: ' 0 test/auth/phone-code-ops.test.js"`  

```js
'use strict';
// An ops reader that prints a secret is a leak with a cron job attached. These tests run it against a
// made-up database and read every line it prints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const status = require('../../ops/auth/phone-code-status');

const TOKEN = 'fake-token-for-tests';
const PEPPER = 'test-pepper-0000000000000000000000000000';
const LIVE = { SMS_MODE: 'live', SMS_API_TOKEN: TOKEN, AUTH_PHONE_CODE_PEPPER: PEPPER };
function fakePrisma(over) {
  const o = over || {};
  return {
    seen: [],
    outboundMessage: { groupBy: async a => { o.seenGroupBy && o.seenGroupBy.push(a); return o.byStatus || []; } },
    authVerification: { count: async a => { o.seenCount && o.seenCount.push(a); return o.live == null ? 0 : o.live; } },
    authUser: { count: async a => { o.seenUsers && o.seenUsers.push(a); return o.accounts == null ? 0 : o.accounts; } }
  };
}
async function lines(env, over) {
  const out = [];
  const r = await status.run({ prisma: fakePrisma(over), env, out: m => out.push(m), now: () => new Date('2026-09-16T09:00:00Z') });
  return { out, r };
}

test('the door line says whether it is open and which switch is missing, and never a value', async () => {
  const { out } = await lines(LIVE);
  assert.match(out[0], /^phone sign-in · OPEN/);
  assert.match(out[0], /sms mode live/);
  assert.match(out[0], /provider token yes/);
  assert.match(out[0], /pepper yes/);
  assert.equal(out.join(' ').includes(TOKEN), false, 'the token is never printed');
  assert.equal(out.join(' ').includes(PEPPER), false, 'the pepper is never printed');
});

test('each missing switch is named, and a short pepper counts as missing', async () => {
  assert.match((await lines({ SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: PEPPER })).out[0], /^phone sign-in · closed[\s\S]*provider token no/);
  assert.match((await lines({ SMS_API_TOKEN: TOKEN, SMS_MODE: 'test', AUTH_PHONE_CODE_PEPPER: PEPPER })).out[0], /^phone sign-in · closed[\s\S]*sms mode test/);
  assert.match((await lines({ SMS_API_TOKEN: TOKEN, SMS_MODE: 'live', AUTH_PHONE_CODE_PEPPER: 'short' })).out[0], /^phone sign-in · closed[\s\S]*pepper no/);
  assert.match((await lines({})).out[0], /^phone sign-in · closed/);
});

test('a month with no codes in it reads as a sentence, not as an empty list', async () => {
  const { out } = await lines(LIVE);
  assert.equal(out[1], 'codes this month · none');
  assert.equal(out[2], 'codes or locks in play right now · 0');
  assert.equal(out[3], 'accounts created by a phone code · 0');
});

test('it counts sign-in messages, live code rows and placeholder accounts, and nothing else', async () => {
  const seenGroupBy = [], seenCount = [], seenUsers = [];
  const { out, r } = await lines(LIVE, {
    seenGroupBy, seenCount, seenUsers,
    byStatus: [{ status: 'test', _count: 4 }, { status: 'sent', _count: 2 }, { status: 'failed', _count: 1 }],
    live: 3, accounts: 9
  });
  assert.equal(out[1], 'codes this month · test 4 · sent 2 · failed 1 · 7 in all');
  assert.equal(out[2], 'codes or locks in play right now · 3');
  assert.equal(out[3], 'accounts created by a phone code · 9');
  assert.equal(seenGroupBy[0].where.kind, 'signin');
  assert.deepEqual(seenGroupBy[0].by, ['status']);
  assert.equal(seenCount[0].where.identifier.startsWith, 'phonecode:');
  assert.equal(seenUsers[0].where.email.endsWith, '@phone.bina.et');
  assert.deepEqual(r, { ready: true, codes: 7, live: 3, accounts: 9 });
});

test('the dry run cannot send: it refuses outright when SMS is live, and never verifies or creates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'auth', 'phone-code-dryrun.js'), 'utf8');
  assert.match(src, /if \(String\(env\.SMS_MODE\) === 'live'\)/);
  assert.match(src, /return \{ ok: false, error: 'sms_live' \}/);
  assert.match(src, /const TEST_PHONE = '0900000001';/, 'a number that belongs to nobody');
  assert.match(src, /the dry run never verifies a code/);
  assert.match(src, /the dry run never creates an account/);
  assert.equal(/flow\.verify\(/.test(src), false, 'only send is ever run');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-ops.test.js 2>&1 | tail -n 20"`
Expected: `Cannot find module '../../ops/auth/phone-code-status'`.

- [ ] **Step 3: Write the status reader**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 11: ' 1 ops/auth/phone-code-status.js"`  

```js
'use strict';
// Read-only: whether the phone sign-in door is open, and what it has done this month. Sends nothing,
// writes nothing, and prints no secret — a token, a pepper, a code and a phone number never appear,
// only whether each switch is there and how many rows there are.
//
//   node ops/auth/phone-code-status.js
//
// The month is the Addis Ababa calendar month, the same one the SMS limit and ops/messaging/
// sms-status.js use, so two reports about the same SMS never disagree about which month it was in.
const { addisMonthStart } = require('../../messaging/delivery');
const pc = require('../../auth/phone-code');

function doorLine(env) {
  const token = !!env.SMS_API_TOKEN;
  const live = env.SMS_MODE === 'live';
  const pepper = String(env.AUTH_PHONE_CODE_PEPPER || '').length >= pc.MIN_PEPPER;
  const ready = token && live && pepper;
  return { ready, line: 'phone sign-in · ' + (ready ? 'OPEN' : 'closed')
    + ' · sms mode ' + (live ? 'live' : 'test')
    + ' · provider token ' + (token ? 'yes' : 'no')
    + ' · pepper ' + (pepper ? 'yes' : 'no') };
}

// rows: an OutboundMessage groupBy on status, for kind 'signin'.
function codesLine(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { total: 0, line: 'codes this month · none' };
  const total = list.reduce((n, r) => n + (Number(r._count) || 0), 0);
  return { total, line: 'codes this month · ' + list.map(r => r.status + ' ' + (Number(r._count) || 0)).join(' · ') + ' · ' + total + ' in all' };
}

async function run({ prisma, env, out = console.log, now = () => new Date() } = {}) {
  const door = doorLine(env || {});
  out(door.line);

  const rows = await prisma.outboundMessage.groupBy({
    by: ['status'], where: { kind: 'signin', createdAt: { gte: addisMonthStart(now()) } }, _count: true });
  const codes = codesLine(rows);
  out(codes.line);

  // A row is either a code somebody can still type or a number still locked out; both are "in play".
  const live = await prisma.authVerification.count({ where: { identifier: { startsWith: 'phonecode:' }, expiresAt: { gt: now() } } });
  out('codes or locks in play right now · ' + live);

  const accounts = await prisma.authUser.count({ where: { email: { endsWith: '@' + pc.PLACEHOLDER_DOMAIN } } });
  out('accounts created by a phone code · ' + accounts);

  return { ready: door.ready, codes: codes.total, live, accounts };
}

if (require.main === module) {
  require('dotenv/config');
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  run({ prisma, env: process.env })
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, doorLine, codesLine };
```

- [ ] **Step 4: Write the dry run**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 11: ' 2 ops/auth/phone-code-dryrun.js"`  

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node --test test/auth/phone-code-ops.test.js 2>&1 | grep -E '^# (pass|fail)|^not ok'"`
Expected:
> `# pass 5`  
> `# fail 0`  

- [ ] **Step 6: Run both scripts on the server, for real, in test mode**

First check the mode, so the dry run cannot possibly send:

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && grep -c '^SMS_MODE=live' .env"`  
Expected: `0` — SMS is still in test mode. **If this prints `1`, stop**: do not run the dry run, and do Task 12 instead, where the first real code is Ibrahim's to send.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/auth/phone-code-status.js"`  
Expected, today:
> `phone sign-in · closed · sms mode test · provider token yes · pepper no`  
> `codes this month · none`  
> `codes or locks in play right now · 0`  
> `accounts created by a phone code · 0`  
(`provider token yes` may be `no`; both are fine before go-live.)

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/auth/phone-code-dryrun.js"`  
Expected:
> `send · {"ok":true}`  
> `verification row · yes`  
> `the stored value is a 64-character hash, not a code · yes`  
> `wrong attempts recorded · 0`  
> `expires in seconds · 300`  
> `outbound row · {"channel":"sms","status":"test","errorKind":null,"buildingId":null,"smsParts":1}`  
> `cleaned up · yes`  
Read it line by line. `status: "test"` is the proof that **nothing was sent**; `smsParts: 1` is the proof that a real code costs one SMS; `buildingId: null` is the proof it did not touch a building's month; the hash line is the proof the code is not in the database.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/auth/phone-code-status.js"`  
Expected: the same four lines, with `codes this month · test 1 · 1 in all` — the dry run's own row, which is evidence and is left in place.

- [ ] **Step 7: Run the whole suite and commit**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`  
Expected: `# tests 1223`, `# pass 1223`, `# fail 0`.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && rm -f /tmp/planD-msg.txt && python3 /tmp/extract_plan.py docs/superpowers/plans/2026-09-16-phone-code-signin.md '### Task 11: ' 3 /tmp/planD-msg.txt && git add ops/auth/phone-code-status.js ops/auth/phone-code-dryrun.js test/auth/phone-code-ops.test.js && git commit -q -F /tmp/planD-msg.txt && git log --oneline -1"`  

```text
Proving the sign-in road works without sending anything

Tests with doubles say the decisions are right; they cannot say the road
exists on this server. The dry run walks the real one — real Prisma,
real delivery layer, real hashing — and refuses to start while SMS_MODE
is live, so it can never send. What it leaves behind is the evidence: a
verification row whose value is a 64-character hash and not six digits,
and an outbound row that says test, one part, no building. The status
reader answers the other question, which switch is still off, and
answers it without ever printing a token, a pepper or a number.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 12: Go-live — Ibrahim's checklist, and the first real code

**Files:** none. Nothing in this task changes code; it turns the door on.

Test delta: 0 (1223 → 1223).

Everything up to here is dark: `/api/auth-methods` answers `phone: false`, the login page draws nothing, and the flow refuses every request with 503. This task is the only place a real SMS is ever sent, and it is sent by Ibrahim, to Ibrahim.

- [ ] **Step 1: Ibrahim sets two environment values, himself**

He adds these to `/var/www/connectcare/binasmart/.env`. **Nobody else reads, writes, prints or commits them.**

| Name | What it is |
| --- | --- |
| `AUTH_PHONE_CODE_PEPPER` | A new random secret, **at least 32 characters**, used only for hashing sign-in codes. Generate with `openssl rand -hex 32`. Changing it later invalidates every code in flight — that is all it does; it is not tied to any session or account. |
| `SMS_MODE` | `live` (it is `test` today). This also switches on live SMS for tenant notices, which is a separate decision Plan A owns — if tenant SMS is not meant to go live on the same day, **stop here and say so**: the phone door and tenant SMS share one switch today. |

Already set, nothing to do: `SMS_API_TOKEN`, `SMS_SHORTCODE_ID`, `SMS_PROVIDER`.
Not used by this plan and not to be added: anything beginning `WA_` — there is no WhatsApp in this door.

- [ ] **Step 2: Check the values are present without reading them**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && grep -c '^AUTH_PHONE_CODE_PEPPER=' .env; grep -c '^SMS_API_TOKEN=' .env; grep -c '^SMS_MODE=live' .env"`  
Expected: `1`, `1`, `1` — three counts, no values.

- [ ] **Step 3: Restart and read the door**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && pm2 restart binasmart-api --update-env >/dev/null && sleep 8 && curl -s http://127.0.0.1:4210/health"`  
Expected: a JSON body whose first field is `ok` and `true`.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/auth/phone-code-status.js"`  
Expected first line: `phone sign-in · OPEN · sms mode live · provider token yes · pepper yes`.

Run: `ssh root@31.97.176.180 "curl -s http://127.0.0.1:4210/api/auth-methods"`  
Expected: `"phone":true` in the answer. The login page now draws the phone field for everybody.

Run: `ssh root@31.97.176.180 "tail -n 5 /root/.pm2/logs/binasmart-api-error.log"`  
Expected: nothing timestamped after the restart.

- [ ] **Step 4: The first real code — Ibrahim's own phone, Ibrahim's own hands**

Ibrahim opens **https://bina.et/login** in his own browser, types **his own number**, and taps **ኮድ ላክ · Send code**. Nobody else's number is typed into that field, by anybody, ever, as part of this plan.

What he should see, in order:
1. An SMS within a few seconds, exactly one message long, starting `BinaSmart፦ የመግቢያ ኮድ · code …`.
2. The page showing `ኮድ ተልኳል ወደ · Code sent to +251 ••• <his last four> — 5 ደቂቃ/min`, and `እንደገና ላክ · Send again in 60s` counting down.
3. Typing the six digits and tapping **ግባ · Sign in** lands him on his account (or on his building dashboard if he owns one).
4. **https://bina.et/account** shows `ስልክ · Phone` as `+251 ••• <his last four> ✅`, with `Phone · ስልክ` among the doors — and, because his number was already proven elsewhere, **no second account**: the same rides, the same businesses, the same everything.

- [ ] **Step 5: Read what the server recorded**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/auth/phone-code-status.js"`  
Expected: `codes this month · sent 1 · 1 in all` (plus the `test 1` from Task 11's dry run), `codes or locks in play right now · 0` (the code was spent), and `accounts created by a phone code · 0` if the number was already on an account — or `1` if it was a brand-new one.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && node ops/messaging/sms-status.js"`  
Expected: the month's SMS line now includes the one sign-in message. One part, at the top price tier: **about 0.75 ETB**.

- [ ] **Step 6: If anything went wrong, close the door before debugging**

Set `SMS_MODE=test` in `.env`, restart, and confirm `node ops/auth/phone-code-status.js` says `closed`. The door is then dark again for everyone and nothing further can be sent while the cause is found. Ibrahim does this; nobody else edits `.env`.

- [ ] **Step 7: Final state**

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && npm test 2>&1 | grep -E '^# (tests|pass|fail)'"`  
Expected: `# tests 1223`, `# pass 1223`, `# fail 0`.

Run: `ssh root@31.97.176.180 "cd /var/www/connectcare/binasmart && git log --oneline -11 && git status --short | grep -v '.bak-' | head"`  
Expected: the eleven Plan D commits, and no unexpected modified file. The coordinator pushes.

---

## Self-review

**Spec coverage.** Every point of the approved design, as amended to SMS-only, has a task:

| Design | Task |
| --- | --- |
| 1 · phone-code sign-in, same account if the number is proven, new `authUser` with role `user` otherwise | 5, 6, 7 |
| 1 · better-auth `phoneNumber` plugin checked, storage inspected, decision recorded | "Facts found while planning"; the decision is restated in the header comment of `auth/phone-code-plugin.mjs` (Task 7) |
| 1 · the stored value is a hash, not a code | 1, 2, 11 (the dry run reads the real row back) |
| 2 · WhatsApp | **removed from scope on 16 September 2026.** No `messaging/whatsapp.js`, no `WA_*`, no fallback link, no Meta webhook. Stated in the header and in Task 12's env table. |
| 3 · 6 digits, 5 minutes, 5 wrong then 15 minutes, 3 per phone / 15 min, 20 per IP / hour, identical answers, hashed, never logged, never in a URL, label first, resend after 60 s, single use, same cookie | 1, 2, 3, 5, 6, 7, 9 |
| 4 · the phone option is hidden until it is live, from one cached public route; Telegram only with a bot token; Google only with keys | 8, 9 |
| 5 · a better bilingual login page, phone first, everything escaped, no inline secret, existing flows pinned | 9 |
| 6 · the account page shows the masked number and the doors; changing a number is out of scope and says so | 10 |
| 7 · no voice codes, no two-factor, no phone change, no WhatsApp for tenant notices | stated in the header; nothing in any task adds them |
| 8 · unit tests with fakes, a flow test through the real modules, live checks in test mode only, the first real code to Ibrahim's own phone | 1–6 (fakes), 7 (the real plugin imported), 11 (the real road, test mode), 12 (the first real code) |
| 9 · conventions | the Conventions section, applied in every task |

**Placeholders.** There are none: every step that changes code carries the code, every command is written out, and every expected output is stated. The two values this plan does not contain are `AUTH_PHONE_CODE_PEPPER` and `SMS_API_TOKEN`, and not containing them is the point — Task 12 names them and Ibrahim sets them.

**Names, checked across tasks.** `pc.CODE_LEN / TTL_MS / MAX_ATTEMPTS / LOCK_MS / RESEND_MS / PHONE_WINDOW_MS / PHONE_MAX / IP_WINDOW_MS / IP_MAX / MIN_PEPPER / SMS_LABEL / PLACEHOLDER_DOMAIN`; `newCode · hashCode · sameHash · packValue · unpackValue · identifierFor · isLocked · tooSoon · checkCode · codeText · maskPhone · phonePlaceholderEmail · isPhonePlaceholderEmail · makeCodeLimiter` (Tasks 1–3) are used under exactly those names in Tasks 5, 6, 7 and 11. `makePhoneCodeSender` returns `{ send, configured, mode, supports }` in Task 4 and the flow reads `sender.configured`, `sender.supports` and `sender.send` in Task 5. `makePhoneCodeFlow` returns `{ send, ready }` in Task 5 and `{ send, verify, ready }` after Task 6, which is what Task 7's plugin calls. The flow's `store` has `find / create / remove / findUserByPhone / createUser` in Tasks 5, 6, 7 and 11. `authPhoneReady(env)` is defined and used in Task 8 and its three switches are the same three the flow's `ready()` and `ops/auth/phone-code-status.js doorLine()` check. `identity.setVerifiedPhone(userId, phone, 'sms')` is the existing signature, with `'sms'` already in `PROOF`.

**Three things worth saying out loud.**
1. **`SMS_MODE` is one switch for two things.** Turning it to `live` for sign-in codes also turns on live SMS to tenants. Task 12 stops rather than assuming. Splitting it (`SMS_MODE_AUTH`) is a change to Plan A's contract and belongs in its own plan.
2. **Safaricom numbers cannot sign in.** GeezSMS reaches `+2519` only, so a `+2517` number is told plainly that an SMS cannot reach it. With WhatsApp out of scope there is no second channel for them; Telegram and Google remain. Whether GeezSMS can be made to carry `+2517` is a question for the provider, not for this code.
3. **The dry run leaves one row behind.** `ops/auth/phone-code-dryrun.js` writes an `OutboundMessage` with `kind: 'signin'`, `status: 'test'`, `buildingId: null`. It is kept on purpose — it is the evidence — and it costs nothing and counts against no building's limit.

## Later plans

- **A door for Safaricom numbers**, if GeezSMS or another provider will carry `+2517`.
- **Splitting `SMS_MODE`** so sign-in codes and tenant notices can be switched on separately.
- **Changing a proven number**, which needs a code to the old number and a code to the new one, and is a plan of its own.
- **A code for the owner dashboard's separate owner-key login**, which today is a key in a link and not an account at all.
