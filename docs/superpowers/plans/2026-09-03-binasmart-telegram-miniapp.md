# BinaSmart Ride — Telegram Mini App + Driver Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riders book BinaSmart rides inside Telegram (@bina_smart_bot) with a one-tap verified phone and get status pushes; anyone (incl. diaspora) can book for someone else; drivers register through @binasmartdriverbot into the pending list with 0% launch commission.

**Architecture:** The existing `public/ride` app becomes Telegram-aware through a small `tg.js` shim (no-op outside Telegram). New server modules under `ride/`: `tgauth.js` (HMAC verification of Telegram's signed login + contact data), `tgApi.js` (Bot API client), `riderBot.js`, `driverBot.js` (six-step registration state machine), `riderNotify.js` (status pushes). Two secret-protected webhook routes. `Ride.bookedBy` JSON records the booker when it differs from the passenger.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 / PostgreSQL, Telegram Bot API + Mini App SDK (`telegram-web-app.js`), Node built-in test runner. Spec: `docs/superpowers/specs/2026-09-03-binasmart-telegram-miniapp-design.md`.

**Conventions for every task**
- Work on the VPS: `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`, branch `main`. Run tests from the repo root with bare `npm test` (`node --test`; a directory argument is a glob on Node 22 and matches nothing).
- Scripts on this box print a spurious `Aborted (core dumped)` after exit; ignore it when the expected output appeared and the exit code is 0.
- Never print `.env` contents, `OWNER_KEY`, or bot tokens. Never call the live `POST /api/ride/request` or send a real Telegram message from a test (`RIDE_TG_SILENT=1` + fake API objects).
- `pgrep -f`/`pkill -f` self-match inside SSH; use `ps -eo pid,args | grep "[b]inasmart-api"`.
- Commit after each task with the given message; push at the end of Tasks 6, 9, 11.
- Existing helpers in `ride/routes.js` you will reuse: `normPhone`, `limiter`, `clientIp`, `point`, `pubRide`, `ACTIVE`, `NEXT`, `TIERS` (`['moto','bajaj','economy','comfort','xl']`).

---

## File structure

| Path | Responsibility |
|---|---|
| `ride/tgauth.js` | `verifyInitData`, `verifyContact`, `sign` (test helper) — pure crypto, no I/O |
| `ride/tgApi.js` | `makeTgApi({ token, fetchImpl })` → `sendMessage`, `getFile`, `downloadFile`, `setWebhook`, `setChatMenuButton`, `setMyCommands`, `answerCallbackQuery` |
| `ride/riderBot.js` | `/start` welcome with "Book a ride" web_app button |
| `ride/driverBot.js` | six-step registration state machine → Driver `pending` + owner alert; `notifyStatus` |
| `ride/riderNotify.js` | `notify(rideId, event)` → push to booker/rider Telegram |
| `ride/routes.js` | `+ /api/tg/rider`, `/api/tg/driver`, `/api/ride/mine`, `/api/ride/ops/drivers/:id/status`, `/api/ride/ops/driver-doc/:id`; request route learns `tg` + `passenger`; notify hooks |
| `ride/index.js` | wires the new modules; reads `BINA_RIDER_BOT_TOKEN`, `BINA_DRIVER_BOT_TOKEN`, `TG_WEBHOOK_SECRET` |
| `prisma/schema.prisma` | `Ride.bookedBy Json?` |
| `public/ride/tg.js` | Telegram shim exposing `window.TG` |
| `public/ride/app.js`, `public/ride.html`, `public/ride/ui.css` | Telegram main button, contact share, "book for someone else", resume via `/api/ride/mine`; assets `?v=4` |
| `public/ride-ops.html` | Approve / Suspend buttons + licence link on driver rows |
| `mcp-server/tools/ride.mjs` + test | `passenger_name` / `passenger_phone` on `request_ride` |
| `uploads/drivers/` | licence photos (git-ignored, outside `public/`) |
| `ops/telegram/README.md` | runbook |
| `test/tgauth.test.js`, `test/tgApi.test.js`, `test/driverBot.test.js`, `test/riderNotify.test.js`, `test/tgRoutes.test.js` | tests |

---

### Task 1: Telegram signature verification (`ride/tgauth.js`)

**Files:**
- Create: `ride/tgauth.js`, `test/tgauth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/tgauth.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyInitData, verifyContact, sign } = require('../ride/tgauth');

const TOKEN = '123456:TESTTOKENabc';
const NOW = 1_800_000_000_000; // ms
const user = { id: 42, first_name: 'Abel', last_name: 'T', language_code: 'am' };

test('verifyInitData accepts a correctly signed payload and returns the user', () => {
  const initData = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 60), query_id: 'q1' }, TOKEN);
  const r = verifyInitData(initData, TOKEN, { now: NOW });
  assert.equal(r.user.id, 42);
  assert.equal(r.user.first_name, 'Abel');
});

test('verifyInitData rejects a tampered hash, wrong token, expired and future data', () => {
  const good = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 60) }, TOKEN);
  assert.equal(verifyInitData(good.replace(/hash=\w{4}/, 'hash=0000'), TOKEN, { now: NOW }), null);
  assert.equal(verifyInitData(good, 'other:token', { now: NOW }), null);
  const old = sign({ user, auth_date: String(Math.floor(NOW / 1000) - 90_000) }, TOKEN);
  assert.equal(verifyInitData(old, TOKEN, { now: NOW }), null, 'older than 24h');
  const future = sign({ user, auth_date: String(Math.floor(NOW / 1000) + 3600) }, TOKEN);
  assert.equal(verifyInitData(future, TOKEN, { now: NOW }), null, 'from the future');
  assert.equal(verifyInitData('', TOKEN), null);
  assert.equal(verifyInitData(undefined, TOKEN), null);
});

test('verifyContact returns the phone from a signed contact response; forged is rejected', () => {
  const contact = { phone_number: '251911244344', user_id: 42, first_name: 'Abel' };
  const resp = sign({ contact, auth_date: String(Math.floor(NOW / 1000) - 5) }, TOKEN);
  const r = verifyContact(resp, TOKEN, { now: NOW });
  assert.deepEqual(r, { phone: '251911244344', userId: 42, firstName: 'Abel' });
  const forged = sign({ contact: { ...contact, phone_number: '251900000000' }, auth_date: String(Math.floor(NOW / 1000) - 5) }, 'wrong:token');
  assert.equal(verifyContact(forged, TOKEN, { now: NOW }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /var/www/connectcare/binasmart && node --test test/tgauth.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"`
Expected: `Cannot find module '../ride/tgauth'`.

- [ ] **Step 3: Implement**

```js
// ride/tgauth.js
'use strict';
// Telegram Mini App data is a query string signed with HMAC-SHA256:
//   secret = HMAC_SHA256(key="WebAppData", msg=botToken)
//   hash   = HMAC_SHA256(key=secret, msg="k1=v1\nk2=v2..." sorted by key, hash excluded)
// initData carries `user`; the requestContact response carries `contact`. Same scheme for both.
const crypto = require('crypto');

function secretFor(botToken) { return crypto.createHmac('sha256', 'WebAppData').update(String(botToken)).digest(); }

function checkSigned(qs, botToken, maxAgeS, nowMs) {
  if (!qs || typeof qs !== 'string' || qs.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(qs);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const calc = crypto.createHmac('sha256', secretFor(botToken)).update(dcs).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date'));
  const nowS = nowMs / 1000;
  if (!Number.isFinite(authDate) || nowS - authDate > maxAgeS || authDate - nowS > 300) return null;
  return params;
}

function verifyInitData(initData, botToken, opts) {
  const o = opts || {};
  const p = checkSigned(initData, botToken, o.maxAgeS || 86400, o.now || Date.now());
  if (!p) return null;
  let user = null;
  try { user = JSON.parse(p.get('user') || 'null'); } catch (e) { return null; }
  if (!user || typeof user.id !== 'number') return null;
  return { user, authDate: Number(p.get('auth_date')) };
}

function verifyContact(response, botToken, opts) {
  const o = opts || {};
  const p = checkSigned(response, botToken, o.maxAgeS || 86400, o.now || Date.now());
  if (!p) return null;
  let c = null;
  try { c = JSON.parse(p.get('contact') || 'null'); } catch (e) { return null; }
  if (!c || !c.phone_number) return null;
  return { phone: String(c.phone_number), userId: c.user_id, firstName: c.first_name };
}

// Test/tooling helper: build a signed query string the way Telegram does.
function sign(fields, botToken) {
  const entries = Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  const dcs = entries.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + '=' + v).join('\n');
  const hash = crypto.createHmac('sha256', secretFor(botToken)).update(dcs).digest('hex');
  return new URLSearchParams([...entries, ['hash', hash]]).toString();
}

module.exports = { verifyInitData, verifyContact, sign };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/tgauth.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/tgauth.js test/tgauth.test.js && git commit -q -m "feat(ride): Telegram initData + contact signature verification" && git log --oneline -1
```

---

### Task 2: Bot API client (`ride/tgApi.js`)

**Files:**
- Create: `ride/tgApi.js`, `test/tgApi.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/tgApi.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTgApi } = require('../ride/tgApi');

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null }); return handler(url, init); };
  f.calls = calls; return f;
}
const okJson = result => ({ ok: true, json: async () => ({ ok: true, result }), arrayBuffer: async () => new ArrayBuffer(0) });

test('sendMessage posts JSON to the right URL and returns result', async () => {
  const fetchImpl = fakeFetch(() => okJson({ message_id: 7 }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  const r = await api.sendMessage('123', 'hi', { parse_mode: 'HTML' });
  assert.equal(r.message_id, 7);
  assert.equal(fetchImpl.calls[0].url, 'https://api.telegram.org/botT:1/sendMessage');
  assert.deepEqual(fetchImpl.calls[0].body, { chat_id: '123', text: 'hi', parse_mode: 'HTML' });
});

test('API error becomes a thrown Error with Telegram description', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: true, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  await assert.rejects(api.sendMessage('1', 'x'), /chat not found/);
});

test('getFile + downloadFile use the file endpoint', async () => {
  const fetchImpl = fakeFetch(url => url.includes('/getFile') ? okJson({ file_path: 'photos/a.jpg' })
    : ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  const f = await api.getFile('F1');
  const buf = await api.downloadFile(f.file_path);
  assert.equal(buf.length, 3);
  assert.equal(fetchImpl.calls[1].url, 'https://api.telegram.org/file/botT:1/photos/a.jpg');
});

test('setWebhook / setChatMenuButton / setMyCommands build the right bodies', async () => {
  const fetchImpl = fakeFetch(() => okJson(true));
  const api = makeTgApi({ token: 'T:1', fetchImpl });
  await api.setWebhook('https://bina.et/api/tg/rider', 'sekret');
  await api.setChatMenuButton('https://bina.et/ride', '🚕 Book a ride');
  await api.setMyCommands([{ command: 'start', description: 'Book a ride' }]);
  assert.deepEqual(fetchImpl.calls[0].body, { url: 'https://bina.et/api/tg/rider', secret_token: 'sekret', allowed_updates: ['message', 'callback_query'] });
  assert.deepEqual(fetchImpl.calls[1].body, { menu_button: { type: 'web_app', text: '🚕 Book a ride', web_app: { url: 'https://bina.et/ride' } } });
  assert.deepEqual(fetchImpl.calls[2].body, { commands: [{ command: 'start', description: 'Book a ride' }] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/tgApi.test.js 2>&1 | grep -E "^# (pass|fail)|Cannot find"` → `Cannot find module '../ride/tgApi'`.

- [ ] **Step 3: Implement**

```js
// ride/tgApi.js
'use strict';
// Minimal Telegram Bot API client. One instance per bot token. fetchImpl is injectable for tests.
function makeTgApi({ token, fetchImpl, apiBase, timeoutMs }) {
  const f = fetchImpl || fetch, base = apiBase || 'https://api.telegram.org', tmo = timeoutMs || 10000;
  async function call(method, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), tmo);
    try {
      const r = await f(base + '/bot' + token + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctl.signal });
      const j = await r.json().catch(() => ({ ok: false, description: 'HTTP ' + r.status }));
      if (!j.ok) throw new Error('tg ' + method + ': ' + (j.description || 'unknown error'));
      return j.result;
    } finally { clearTimeout(t); }
  }
  async function downloadFile(filePath) {
    const r = await f(base + '/file/bot' + token + '/' + filePath);
    if (!r.ok) throw new Error('tg download: HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
  return {
    call,
    sendMessage: (chat_id, text, extra) => call('sendMessage', Object.assign({ chat_id, text }, extra || {})),
    getFile: file_id => call('getFile', { file_id }),
    downloadFile,
    setWebhook: (url, secret_token) => call('setWebhook', { url, secret_token, allowed_updates: ['message', 'callback_query'] }),
    setChatMenuButton: (url, text) => call('setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } }),
    setMyCommands: commands => call('setMyCommands', { commands }),
    answerCallbackQuery: callback_query_id => call('answerCallbackQuery', { callback_query_id }),
  };
}
module.exports = { makeTgApi };
```

- [ ] **Step 4: Run tests** → `# pass 4`, `# fail 0` for this file.

- [ ] **Step 5: Commit**

```bash
git add ride/tgApi.js test/tgApi.test.js && git commit -q -m "feat(ride): Telegram Bot API client" && git log --oneline -1
```

---

### Task 3: `Ride.bookedBy` schema field

**Files:**
- Modify: `prisma/schema.prisma` (model `Ride`)

- [ ] **Step 1: Add the field** — in `model Ride`, after the line `estimate      Boolean   @default(false)`, add:

```prisma
  bookedBy      Json?     // { name, phone, telegramId, relation } when the booker is not the passenger (diaspora etc.)
```

- [ ] **Step 2: Push to the database and regenerate the client**

Run: `cd /var/www/connectcare/binasmart && npx prisma db push 2>&1 | tail -3 && npx prisma generate 2>&1 | tail -1`
Expected: `Your database is now in sync with your Prisma schema.` and `Generated Prisma Client`. (`db push` adds a nullable column; no data changes. The running app keeps working until Task 6's restart.)

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma && git commit -q -m "feat(ride): Ride.bookedBy for book-for-someone-else" && git log --oneline -1
```

---

### Task 4: Rider notifications (`ride/riderNotify.js`)

**Files:**
- Create: `ride/riderNotify.js`, `test/riderNotify.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/riderNotify.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRiderNotify } = require('../ride/riderNotify');

function fakes(ride) {
  const sent = [];
  const api = { sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: 1 }; } };
  const prisma = { ride: { findUnique: async () => ride } };
  return { sent, notify: makeRiderNotify({ prisma, api, baseUrl: 'https://bina.et' }).notify };
}
const base = { id: 'r1', status: 'assigned', fareEtb: 295, pickup: { label: 'Edna Mall' }, rider: { telegramId: '42' }, bookedBy: null,
  driver: { name: 'Abel', phone: '+251900000000', plate: 'A12345', vehicleMake: 'Toyota Vitz', vehicleColour: 'white' } };

test('assigned → one message to the rider Telegram with driver, plate and an Open tracking web_app button', async () => {
  const { sent, notify } = fakes(base);
  assert.equal(await notify('r1', 'assigned'), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, '42');
  assert.match(sent[0].text, /Abel/); assert.match(sent[0].text, /A12345/); assert.match(sent[0].text, /white Toyota Vitz/);
  assert.equal(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bina.et/ride?id=r1');
});

test('booker Telegram wins over rider Telegram (booked for someone else)', async () => {
  const { sent, notify } = fakes({ ...base, bookedBy: { name: 'Ibrahim', telegramId: '99' } });
  await notify('r1', 'arrived');
  assert.equal(sent[0].chat, '99'); assert.match(sent[0].text, /arrived/i);
});

test('no Telegram id → no message; unknown event → no message; API failure → false, no throw', async () => {
  const a = fakes({ ...base, rider: { telegramId: null } }); assert.equal(await a.notify('r1', 'assigned'), false); assert.equal(a.sent.length, 0);
  const b = fakes(base); assert.equal(await b.notify('r1', 'teleported'), false);
  const c = makeRiderNotify({ prisma: { ride: { findUnique: async () => base } }, api: { sendMessage: async () => { throw new Error('boom'); } }, baseUrl: 'https://bina.et' });
  assert.equal(await c.notify('r1', 'completed'), false);
});

test('completed and cancelled texts', async () => {
  const a = fakes({ ...base, status: 'completed' }); await a.notify('r1', 'completed'); assert.match(a.sent[0].text, /295 ETB/); assert.match(a.sent[0].text, /rate/i);
  const b = fakes({ ...base, status: 'cancelled' }); await b.notify('r1', 'cancelled'); assert.match(b.sent[0].text, /cancelled/i);
});
```

- [ ] **Step 2: Run** → `Cannot find module '../ride/riderNotify'`.

- [ ] **Step 3: Implement**

```js
// ride/riderNotify.js
'use strict';
// Status pushes to the person who booked (bookedBy.telegramId), else the rider's Telegram. Fire-and-forget:
// never throws, never blocks a ride. Only riders who came through Telegram have an id, so web riders are untouched.
function makeRiderNotify({ prisma, api, baseUrl }) {
  const vehicle = d => [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' ');
  const TEXT = {
    assigned: r => '🚗 Driver ' + r.driver.name + ' is on the way\n' + vehicle(r.driver) + ' · plate ' + r.driver.plate + ' · ' + r.driver.phone + '\nሹፌርዎ እየመጣ ነው። ' + (r.pickup && r.pickup.label ? 'Pickup: ' + r.pickup.label : ''),
    arrived: r => '📍 Your driver has arrived' + (r.pickup && r.pickup.label ? ' at ' + r.pickup.label : '') + '.\nሹፌርዎ ደርሷል።',
    completed: r => '✅ Trip complete · ' + r.fareEtb + ' ETB' + (r.paymentStatus === 'paid' ? ' (paid)' : ' — pay the driver') + '\nጉዞው ተጠናቅቋል። Please rate your driver in the app. አመሰግናለን!',
    cancelled: r => '❌ Ride cancelled.' + (r.cancelledBy === 'ops' ? ' Our dispatcher could not find a driver this time — sorry.' : '') + '\nጉዞው ተሰርዟል።',
  };
  async function notify(rideId, event) {
    try {
      const fn = TEXT[event]; if (!fn) return false;
      const ride = await prisma.ride.findUnique({ where: { id: rideId }, include: { driver: true, rider: true } });
      if (!ride) return false;
      const chat = (ride.bookedBy && ride.bookedBy.telegramId) || (ride.rider && ride.rider.telegramId);
      if (!chat) return false;
      if (event === 'assigned' && !ride.driver) return false;
      await api.sendMessage(String(chat), fn(ride), { reply_markup: { inline_keyboard: [[{ text: '📍 Open tracking · መከታተያ', web_app: { url: baseUrl + '/ride?id=' + ride.id } }]] } });
      return true;
    } catch (e) { console.error('[ride/riderNotify] ' + event + ' for ' + rideId + ' failed: ' + e.message); return false; }
  }
  return { notify };
}
module.exports = { makeRiderNotify };
```

- [ ] **Step 4: Run tests** → `# pass 4` for this file; full `npm test` still green (24 + new).

- [ ] **Step 5: Commit**

```bash
git add ride/riderNotify.js test/riderNotify.test.js && git commit -q -m "feat(ride): Telegram status pushes to the booker/rider" && git log --oneline -1
```

---

### Task 5: Rider bot `/start` and driver registration bot

**Files:**
- Create: `ride/riderBot.js`, `ride/driverBot.js`, `test/driverBot.test.js`

- [ ] **Step 1: Write the failing test (fake Bot API + fake Prisma, no network)**

```js
// test/driverBot.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { makeDriverBot } = require('../ride/driverBot');
const { makeRiderBot } = require('../ride/riderBot');

function fakeApi() {
  const sent = [];
  return { sent,
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    answerCallbackQuery: async () => true,
    getFile: async () => ({ file_path: 'photos/x.jpg' }),
    downloadFile: async () => Buffer.from([0xff, 0xd8, 0xff]) };
}
function fakePrisma() {
  const drivers = [];
  return { drivers, driver: {
    findUnique: async ({ where }) => drivers.find(d => d.phone === where.phone) || null,
    create: async ({ data }) => { const d = { id: 'd' + (drivers.length + 1), rating: 5, ridesCount: 0, ...data }; drivers.push(d); return d; },
    update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); return d; } } };
}
function bot() {
  const api = fakeApi(), prisma = fakePrisma(), notes = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const b = makeDriverBot({ prisma, api, telegram: { ownerNote: async t => { notes.push(t); return true; } }, uploadsDir: dir, baseUrl: 'https://bina.et' });
  return { api, prisma, notes, dir, b };
}
const msg = (text, extra) => ({ message: Object.assign({ chat: { id: 555 }, text }, extra || {}) });

test('happy path: /start → name → contact → tier button → vehicle → plate → photo → pending driver + owner alert', async () => {
  const { api, prisma, notes, dir, b } = bot();
  await b.handleUpdate(msg('/start'));
  assert.match(api.sent.at(-1).text, /0% commission/i);
  await b.handleUpdate(msg('Abel Tesfaye'));
  assert.equal(api.sent.at(-1).extra.reply_markup.keyboard[0][0].request_contact, true, 'asks to share phone');
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '251911244344', user_id: 555 } }));
  const tiers = api.sent.at(-1).extra.reply_markup.inline_keyboard.flat().map(x => x.callback_data);
  assert.deepEqual(tiers, ['tier:moto', 'tier:bajaj', 'tier:economy', 'tier:comfort', 'tier:xl']);
  await b.handleUpdate({ callback_query: { id: 'cq1', data: 'tier:economy', message: { chat: { id: 555 } } } });
  assert.match(api.sent.at(-1).text, /make and colour/i);
  await b.handleUpdate(msg('Toyota Vitz white'));
  assert.match(api.sent.at(-1).text, /plate/i);
  await b.handleUpdate(msg('A12345'));
  assert.match(api.sent.at(-1).text, /photo/i);
  await b.handleUpdate(msg(undefined, { photo: [{ file_id: 'small' }, { file_id: 'big' }] }));
  assert.equal(prisma.drivers.length, 1);
  const d = prisma.drivers[0];
  assert.equal(d.status, 'pending'); assert.equal(d.phone, '+251911244344'); assert.equal(d.tier, 'economy'); assert.equal(d.plate, 'A12345'); assert.equal(d.telegramId, '555');
  assert.equal(d.licenceUrl, '/api/ride/ops/driver-doc/d1');
  assert.ok(fs.existsSync(path.join(dir, 'd1.jpg')));
  assert.match(api.sent.at(-1).text, /24 hours/);
  assert.equal(notes.length, 1); assert.match(notes[0], /Abel Tesfaye/); assert.match(notes[0], /A12345/);
});

test('wrong input re-asks the current step; non-photo at licence step is refused; duplicate phone ends politely', async () => {
  const { api, prisma, b } = bot();
  prisma.drivers.push({ id: 'd0', phone: '+251911244344', status: 'approved' });
  await b.handleUpdate(msg('/start'));
  await b.handleUpdate(msg('A'));                       // too short → re-ask name
  assert.match(api.sent.at(-1).text, /name/i);
  await b.handleUpdate(msg('Abel'));
  await b.handleUpdate(msg('hello'));                   // text instead of contact/phone → re-ask
  assert.match(api.sent.at(-1).text, /Ethiopian number|phone/i);
  await b.handleUpdate(msg('0911244344'));              // duplicate → already registered, session cleared
  assert.match(api.sent.at(-1).text, /already registered/i);
  await b.handleUpdate(msg('anything'));                // new session starts at name
  assert.match(api.sent.at(-1).text, /name/i);
});

test('licence step: sending text instead of a photo is refused and no driver is created', async () => {
  const { api, prisma, b } = bot();
  await b.handleUpdate(msg('/start')); await b.handleUpdate(msg('Abel'));
  await b.handleUpdate(msg(undefined, { contact: { phone_number: '0911244344' } }));
  await b.handleUpdate({ callback_query: { id: 'c', data: 'tier:moto', message: { chat: { id: 555 } } } });
  await b.handleUpdate(msg('Bajaj blue')); await b.handleUpdate(msg('B1'));   // plate too short → re-ask
  assert.match(api.sent.at(-1).text, /plate/i);
  await b.handleUpdate(msg('B12345'));
  await b.handleUpdate(msg('here is my licence'));
  assert.match(api.sent.at(-1).text, /photo/i);
  assert.equal(prisma.drivers.length, 0);
});

test('notifyStatus messages the driver on approval, nothing without telegramId', async () => {
  const { api, b } = bot();
  assert.equal(await b.notifyStatus({ id: 'd1', telegramId: '555' }, 'approved'), true);
  assert.match(api.sent.at(-1).text, /Approved/);
  assert.equal(await b.notifyStatus({ id: 'd2', telegramId: null }, 'approved'), false);
});

test('rider bot /start replies with a Book a ride web_app button', async () => {
  const api = fakeApi();
  const rb = makeRiderBot({ api, baseUrl: 'https://bina.et', botUsername: 'bina_smart_bot' });
  await rb.handleUpdate({ message: { chat: { id: 7 }, text: '/start' } });
  const kb = api.sent[0].extra.reply_markup.inline_keyboard;
  assert.equal(kb[0][0].web_app.url, 'https://bina.et/ride');
  assert.match(api.sent[0].text, /BinaSmart/);
});
```

- [ ] **Step 2: Run** → `Cannot find module '../ride/driverBot'`.

- [ ] **Step 3: Implement `ride/riderBot.js`**

```js
// ride/riderBot.js
'use strict';
// @bina_smart_bot chat side. The app itself is the Mini App; the chat only needs to open it.
function makeRiderBot({ api, baseUrl, botUsername }) {
  const WELCOME = 'ሰላም! 🚕 BinaSmart — fixed-price rides in Addis Ababa. No surge, no app to download.\nቋሚ ዋጋ፣ ያለ ጭማሪ፣ መተግበሪያ ማውረድ አያስፈልግም።\n\nTap below to book · ለመያዝ ከታች ይጫኑ';
  const share = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/' + botUsername) + '&text=' + encodeURIComponent('Fixed-price rides in Addis Ababa — BinaSmart');
  async function handleUpdate(update) {
    const msg = update && update.message;
    if (!msg || !msg.chat) return;
    await api.sendMessage(String(msg.chat.id), WELCOME, { reply_markup: { inline_keyboard: [
      [{ text: '🚕 Book a ride · ጉዞ ይያዙ', web_app: { url: baseUrl + '/ride' } }],
      [{ text: '📣 Share BinaSmart · ያጋሩ', url: share }],
    ] } });
  }
  return { handleUpdate };
}
module.exports = { makeRiderBot };
```

- [ ] **Step 4: Implement `ride/driverBot.js`**

```js
// ride/driverBot.js
'use strict';
// @binasmartdriverbot: six-step registration → Driver(status:'pending'). Phase 1 only registers; Phase 2 adds online/offers.
const fs = require('fs'); const path = require('path');
const { normPhone } = require('./phone');

const TIERS = { moto: '🏍 Moto', bajaj: '🛺 Bajaj', economy: '🚗 Economy', comfort: '🚙 Comfort', xl: '🚐 XL / Van' };
const TTL_MS = 3600 * 1000;

function makeDriverBot({ prisma, api, telegram, uploadsDir, baseUrl, now }) {
  const clock = now || Date.now;
  const sessions = new Map(); // chatId -> { step, data, t }
  function sess(chatId) {
    const s = sessions.get(chatId);
    if (s && clock() - s.t < TTL_MS) { s.t = clock(); return s; }
    const n = { step: 'name', data: {}, t: clock() }; sessions.set(chatId, n); return n;
  }
  const WELCOME = '👋 BinaSmart Driver · የቢናስማርት ሹፌር\n\nRegister as a BinaSmart driver — FREE, and 0% commission during our launch. Takes 2 minutes.\nምዝገባው ነጻ ነው፤ በመክፈቻ ወቅት ኮሚሽን የለም። 2 ደቂቃ ብቻ።\n\nWhat is your full name? · ሙሉ ስምዎን ይላኩ';
  const ASK = {
    name: () => api_send('What is your full name? · ሙሉ ስምዎን ይላኩ'),
    phone: () => api_send('Share your phone number · ስልክ ቁጥርዎን ያጋሩ', { reply_markup: { keyboard: [[{ text: '📱 Share my phone · ስልኬን አጋራ', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }),
    tier: () => api_send('Which vehicle do you drive? · የሚያሽከረክሩት ተሽከርካሪ', { reply_markup: { inline_keyboard: Object.keys(TIERS).map(t => [{ text: TIERS[t], callback_data: 'tier:' + t }]) } }),
    vehicle: () => api_send('Car make and colour? e.g. "Toyota Vitz white" · የመኪና አይነት እና ቀለም'),
    plate: () => api_send('Plate number? · ታርጋ ቁጥር (ለምሳሌ A12345)'),
    licence: () => api_send('Send a PHOTO of your driving licence · የመንጃ ፈቃድዎን ፎቶ ይላኩ', { reply_markup: { remove_keyboard: true } }),
  };
  let currentChat = null;
  function api_send(text, extra) { return api.sendMessage(currentChat, text, extra); }
  const ask = (chatId, step) => { currentChat = chatId; return ASK[step](); };

  async function handleUpdate(update) {
    if (update.callback_query) {
      const cq = update.callback_query; const chatId = String(cq.message.chat.id); currentChat = chatId;
      try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
      const s = sess(chatId); const m = /^tier:(\w+)$/.exec(cq.data || '');
      if (s.step === 'tier' && m && TIERS[m[1]]) { s.data.tier = m[1]; s.step = 'vehicle'; return ask(chatId, 'vehicle'); }
      return ask(chatId, s.step);
    }
    const msg = update.message; if (!msg || !msg.chat) return;
    const chatId = String(msg.chat.id); currentChat = chatId;
    const text = String(msg.text || '').trim();
    if (text.startsWith('/start')) { sessions.delete(chatId); sess(chatId); return api.sendMessage(chatId, WELCOME); }
    const s = sess(chatId);
    switch (s.step) {
      case 'name':
        if (text.length < 2 || text.startsWith('/')) return ask(chatId, 'name');
        s.data.name = text.slice(0, 60); s.step = 'phone'; return ask(chatId, 'phone');
      case 'phone': {
        const phone = normPhone(msg.contact ? msg.contact.phone_number : text);
        if (!phone) { await api.sendMessage(chatId, 'Please share an Ethiopian number (09…) · የኢትዮጵያ ስልክ ቁጥር ያስፈልጋል'); return ask(chatId, 'phone'); }
        const existing = await prisma.driver.findUnique({ where: { phone } });
        if (existing) { sessions.delete(chatId); return api.sendMessage(chatId, 'You are already registered ✅ We will call you. · ቀድሞ ተመዝግበዋል፤ እንደውልልዎታለን።', { reply_markup: { remove_keyboard: true } }); }
        s.data.phone = phone; s.step = 'tier'; return ask(chatId, 'tier');
      }
      case 'tier': return ask(chatId, 'tier');
      case 'vehicle':
        if (text.length < 3) return ask(chatId, 'vehicle');
        s.data.vehicle = text.slice(0, 70); s.step = 'plate'; return ask(chatId, 'plate');
      case 'plate':
        if (text.length < 3) return ask(chatId, 'plate');
        s.data.plate = text.slice(0, 20).toUpperCase(); s.step = 'licence'; return ask(chatId, 'licence');
      case 'licence': {
        const photos = msg.photo;
        if (!photos || !photos.length) return api.sendMessage(chatId, 'Please send a photo (not a file or text) of your licence · እባክዎ የፈቃድዎን ፎቶ ይላኩ');
        const d = s.data;
        const drv = await prisma.driver.create({ data: { name: d.name, phone: d.phone, tier: d.tier, plate: d.plate, vehicleMake: d.vehicle, vehicleColour: null, status: 'pending', telegramId: chatId } });
        let licenceUrl = null;
        try {
          const f = await api.getFile(photos[photos.length - 1].file_id);
          const buf = await api.downloadFile(f.file_path);
          await fs.promises.mkdir(uploadsDir, { recursive: true });
          await fs.promises.writeFile(path.join(uploadsDir, drv.id + '.jpg'), buf);
          licenceUrl = '/api/ride/ops/driver-doc/' + drv.id;
          await prisma.driver.update({ where: { id: drv.id }, data: { licenceUrl } });
        } catch (e) { console.error('[ride/driverBot] licence save failed for ' + drv.id + ': ' + e.message); }
        sessions.delete(chatId);
        await api.sendMessage(chatId, '✅ ' + d.name + ' · ' + TIERS[d.tier] + ' · ' + d.vehicle + ' · ' + d.plate + '\n\nThank you! We will call you within 24 hours to activate your account. Registration is free and there is 0% commission during our launch.\nአመሰግናለን! በ24 ሰዓት ውስጥ እንደውልልዎታለን። ምዝገባው ነጻ ነው፤ ኮሚሽን የለም።', { reply_markup: { remove_keyboard: true } });
        telegram.ownerNote('🧑‍✈️ NEW DRIVER (pending): ' + d.name + ' · ' + TIERS[d.tier] + ' · ' + d.vehicle + ' · plate ' + d.plate + ' · ' + d.phone + (licenceUrl ? '\nLicence photo: in /ride-ops → Drivers' : '\n(licence photo failed to save)') + '\nApprove: ' + baseUrl + '/ride-ops').catch(() => {});
        return;
      }
      default: sessions.delete(chatId); return ask(chatId, 'name');
    }
  }

  async function notifyStatus(driver, status) {
    if (!driver || !driver.telegramId) return false;
    const text = status === 'approved' ? '✅ Approved! Welcome to BinaSmart. We will message you here when trips start. Registration is free, 0% commission during launch.\nጸድቋል! እንኳን ደህና መጡ። ጉዞዎች ሲጀምሩ እዚህ እናሳውቅዎታለን።'
      : status === 'suspended' ? 'Your BinaSmart driver account is paused. Contact support: https://bina.et/support' : null;
    if (!text) return false;
    try { await api.sendMessage(String(driver.telegramId), text); return true; }
    catch (e) { console.error('[ride/driverBot] notifyStatus failed: ' + e.message); return false; }
  }

  return { handleUpdate, notifyStatus, _sessions: sessions };
}
module.exports = { makeDriverBot, TIERS };
```

`normPhone` lives inside `ride/routes.js` today. Move it (unchanged) to a new `ride/phone.js` so both files share it:

```js
// ride/phone.js
'use strict';
function normPhone(s) { s = String(s || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); if (/^251\d{9}$/.test(s)) s = '+' + s; return /^\+251\d{9}$/.test(s) ? s : null; }
module.exports = { normPhone };
```
and in `ride/routes.js` replace the `function normPhone(...)` line with `const { normPhone } = require('./phone');`.

- [ ] **Step 5: Run tests** → `node --test test/driverBot.test.js` → `# pass 5`; `npm test` all green.

- [ ] **Step 6: Commit**

```bash
git add ride/phone.js ride/riderBot.js ride/driverBot.js ride/routes.js test/driverBot.test.js && git commit -q -m "feat(ride): rider bot /start and driver registration bot" && git log --oneline -1
```

---

### Task 6: Routes — webhooks, Telegram booking, book-for-someone-else, `/mine`, driver approval

**Files:**
- Modify: `ride/routes.js`, `ride/index.js`, `.gitignore`
- Create: `test/tgRoutes.test.js`

- [ ] **Step 1: Write the failing test (Fastify `inject`, fake Prisma, fake bots)**

```js
// test/tgRoutes.test.js
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const routes = require('../ride/routes');
const { sign } = require('../ride/tgauth');

const TOKEN = '111:RIDERTOKEN';
function fakePrisma() {
  const rides = [], riders = [], drivers = [{ id: 'd1', name: 'Abel', phone: '+251900000000', plate: 'A1', status: 'pending', telegramId: '555', tier: 'economy' }];
  const inc = { rides, riders, drivers };
  return { _: inc,
    rider: { upsert: async ({ where, update, create }) => { let r = riders.find(x => x.phone === where.phone); if (r) Object.assign(r, update); else { r = { id: 'u' + (riders.length + 1), telegramId: null, ...create }; riders.push(r); } return r; },
             update: async ({ where, data }) => { const r = riders.find(x => x.id === where.id); Object.assign(r, data); return r; } },
    ride: { findUnique: async ({ where }) => { const r = rides.find(x => x.id === where.id || (where.idemKey && x.idemKey === where.idemKey)) || null; return r && { ...r, driver: null, rider: riders.find(u => u.id === r.riderId) }; },
            create: async ({ data }) => { const r = { id: 'r' + (rides.length + 1), status: 'dispatching', requestedAt: new Date(), ...data }; rides.push(r); return r; },
            findFirst: async ({ where }) => { const tg = where.OR[0].rider.telegramId; const r = rides.find(x => ['requested', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'].includes(x.status) && ((riders.find(u => u.id === x.riderId) || {}).telegramId === tg || (x.bookedBy && x.bookedBy.telegramId === tg))); return r ? { ...r, driver: null } : null; },
            updateMany: async () => ({ count: 1 }), update: async ({ where, data }) => { const r = rides.find(x => x.id === where.id); Object.assign(r, data); return { ...r, driver: null }; } },
    driver: { findUnique: async ({ where }) => drivers.find(d => d.id === where.id || d.phone === where.phone) || null, update: async ({ where, data }) => { const d = drivers.find(x => x.id === where.id); Object.assign(d, data); return d; }, count: async () => 0, findMany: async () => drivers },
  };
}
const geo = { route: async () => ({ distanceM: 5000, durationS: 900, estimate: false, geometry: [] }), searchPlaces: async () => [] };
const settings = { get: async () => ({ tiers: { economy: { label: 'Economy', labelAm: 'ኢኮኖሚ', icon: '🚗', seats: 4, base: 100, perKm: 30, perMin: 2, min: 150 }, moto: { label: 'Moto', labelAm: 'ሞተር', icon: '🏍', seats: 1, base: 50, perKm: 15, perMin: 1, min: 80 }, bajaj: { label: 'Bajaj', labelAm: 'ባጃጅ', icon: '🛺', seats: 3, base: 70, perKm: 20, perMin: 1, min: 100 }, comfort: { label: 'Comfort', labelAm: 'ኮምፎርት', icon: '🚙', seats: 4, base: 150, perKm: 40, perMin: 3, min: 250 }, xl: { label: 'XL', labelAm: 'ቫን', icon: '🚐', seats: 7, base: 200, perKm: 50, perMin: 3, min: 350 } }, commissionPct: 0, conciergeAfterS: 0 }) };
const telegram = { conciergeAlert: async () => true, ownerNote: async () => true };
const dispatch = { start: async () => 'ok', cancel: () => {} };
const notified = []; const riderNotify = { notify: async (id, ev) => { notified.push(ev); return true; } };
const driverStatus = []; const driverBot = { handleUpdate: async u => { driverStatus.push('dupdate'); }, notifyStatus: async (d, s) => { driverStatus.push(s); return true; } };
const riderUpdates = []; const riderBot = { handleUpdate: async u => { riderUpdates.push(u); } };

const prisma = fakePrisma();
const app = Fastify();
routes(app, { prisma, settings, geo, telegram, dispatch, OWNER_KEY: 'OWNERKEY', riderBotToken: TOKEN, webhookSecret: 'SEKRET', riderBot, driverBot, riderNotify, uploadsDir: require('os').tmpdir() });
after(() => app.close());
const pt = { lat: 9.01, lng: 38.75, label: 'A' }, pt2 = { lat: 9.03, lng: 38.76, label: 'B' };
const NOWS = () => String(Math.floor(Date.now() / 1000) - 5);
const initData = sign({ user: { id: 42, first_name: 'Abel' }, auth_date: NOWS() }, TOKEN);
const contact = sign({ contact: { phone_number: '251911244344', user_id: 42 }, auth_date: NOWS() }, TOKEN);

test('webhooks: missing/wrong secret → 401; right secret → 200 and handler runs', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/tg/rider', payload: { message: {} } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/tg/rider', headers: { 'x-telegram-bot-api-secret-token': 'nope' }, payload: {} })).statusCode, 401);
  const r = await app.inject({ method: 'POST', url: '/api/tg/driver', headers: { 'x-telegram-bot-api-secret-token': 'SEKRET' }, payload: { message: { chat: { id: 1 }, text: '/start' } } });
  assert.equal(r.statusCode, 200);
  await new Promise(res => setImmediate(res));
  assert.deepEqual(driverStatus, ['dupdate']);
});

test('Telegram booking: signed contact phone wins, telegramId stored, response carries the phone for polling', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'economy', pickup: pt, dropoff: pt2, riderName: 'Abel', riderPhone: '0900000000', tg: { initData, contact } } });
  const d = r.json(); assert.equal(r.statusCode, 200, JSON.stringify(d));
  assert.equal(d.phone, '+251911244344');
  assert.equal(prisma._.riders[0].telegramId, '42');
  assert.equal(prisma._.rides[0].riderPhone, '+251911244344');
  assert.equal(prisma._.rides[0].bookedBy, null);
});

test('invalid Telegram signature → 401 with reopen message', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'economy', pickup: pt, dropoff: pt2, riderName: 'X', riderPhone: '0911111111', tg: { initData: 'user=%7B%7D&auth_date=1&hash=' + 'a'.repeat(64) } } });
  assert.equal(r.statusCode, 401); assert.match(r.json().error, /reopen/i);
});

test('book for someone else: passenger becomes the rider, booker stored in bookedBy, missing passenger phone → 400', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Ibrahim', riderPhone: '+447700900123', passenger: { name: 'Almaz', phone: '0922333444' }, tg: { initData } } });
  const d = r.json(); assert.equal(r.statusCode, 200, JSON.stringify(d));
  const ride = prisma._.rides.at(-1);
  assert.equal(ride.riderName, 'Almaz'); assert.equal(ride.riderPhone, '+251922333444');
  assert.deepEqual(ride.bookedBy, { name: 'Ibrahim', phone: '+447700900123', telegramId: '42' });
  const bad = await app.inject({ method: 'POST', url: '/api/ride/request', payload: { tier: 'moto', pickup: pt, dropoff: pt2, riderName: 'Ibrahim', riderPhone: '0911111111', passenger: { name: 'Almaz', phone: '+4477' } } });
  assert.equal(bad.statusCode, 400); assert.match(bad.json().error, /passenger/i);
});

test('/api/ride/mine returns the active ride for the Telegram user with its phone; 401 without valid initData', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/ride/mine?initData=' + encodeURIComponent(initData) });
  assert.equal(r.statusCode, 200); assert.equal(r.json().ride.id, 'r1'); assert.equal(r.json().phone, '+251911244344');
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/mine?initData=bad' })).statusCode, 401);
});

test('ops: driver status change notifies the driver; licence doc needs the owner key', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/ride/ops/drivers/d1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'approved' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().driver.status, 'approved'); assert.equal(driverStatus.at(-1), 'approved');
  assert.equal((await app.inject({ method: 'POST', url: '/api/ride/ops/drivers/d1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'flying' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/ops/driver-doc/d1' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ride/ops/driver-doc/d1?key=OWNERKEY' })).statusCode, 404, 'no file saved in this test');
});

test('ops assign / status / rider cancel call riderNotify with the right event', async () => {
  prisma._.drivers[0].status = 'approved';
  await app.inject({ method: 'POST', url: '/api/ride/ops/r1/assign', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { driverId: 'd1' } });
  prisma._.rides[0].status = 'assigned';
  await app.inject({ method: 'POST', url: '/api/ride/ops/r1/status', headers: { 'x-owner-key': 'OWNERKEY' }, payload: { status: 'arrived' } });
  await app.inject({ method: 'POST', url: '/api/ride/r2/cancel', payload: { phone: '0922333444' } });
  await new Promise(res => setImmediate(res));
  assert.deepEqual(notified, ['assigned', 'arrived', 'cancelled']);
});
```

- [ ] **Step 2: Run** → several failures (`404` for the new routes, `tg` ignored). Expected.

- [ ] **Step 3: Implement — `ride/routes.js` changes**

(a) At the top, after `const { quoteAll, quoteFare, TIERS } = require('./fare');` add:
```js
const fs = require('fs'); const path = require('path');
const tgauth = require('./tgauth');
```
(b) Change the export signature to destructure the new deps:
```js
module.exports = function routes(fastify, { prisma, settings, geo, telegram, dispatch, OWNER_KEY, riderBotToken, webhookSecret, riderBot, driverBot, riderNotify, uploadsDir }) {
```
and right after the existing limiter lines add:
```js
  const fireNotify = (id, ev) => { if (riderNotify) setImmediate(() => riderNotify.notify(id, ev).catch(() => {})); };
  const tgHook = handler => async (req, reply) => {
    if (!webhookSecret || req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) return reply.code(401).send({ ok: false });
    reply.send({ ok: true }); // answer Telegram fast; process after
    setImmediate(() => handler(req.body || {}).catch(e => console.error('[ride/tg] webhook handler error: ' + e.message)));
  };
```
(c) Replace the whole `fastify.post('/api/ride/request', …)` handler with:
```js
  fastify.post('/api/ride/request', async (req, reply) => {
    const b = req.body || {};
    const from = point(b.pickup), to = point(b.dropoff);
    const tier = TIERS.includes(b.tier) ? b.tier : null;
    const paymentMethod = ['cash', 'chapa'].includes(b.paymentMethod) ? b.paymentMethod : 'cash';
    const idemKey = String(b.idemKey || '').slice(0, 64) || null;
    // Telegram identity (optional): signed initData proves who is booking; signed contact proves the phone.
    let tg = null, contact = null;
    if (b.tg && b.tg.initData) {
      tg = tgauth.verifyInitData(b.tg.initData, riderBotToken);
      if (!tg) return reply.code(401).send({ ok: false, error: 'Telegram sign-in expired — please reopen BinaSmart from the bot' });
      if (b.tg.contact) contact = tgauth.verifyContact(b.tg.contact, riderBotToken);
    }
    const bookerName = String(b.riderName || (tg && [tg.user.first_name, tg.user.last_name].filter(Boolean).join(' ')) || '').trim().slice(0, 60);
    const bookerRaw = contact ? contact.phone : b.riderPhone;
    const bookerPhone = normPhone(bookerRaw) || (bookerRaw ? String(bookerRaw).replace(/[^\d+]/g, '').slice(0, 20) : null);
    // Book for someone else: the passenger is the ride's rider; the booker is recorded in bookedBy.
    let passenger = null;
    if (b.passenger && (b.passenger.name || b.passenger.phone)) {
      passenger = { name: String(b.passenger.name || '').trim().slice(0, 60), phone: normPhone(b.passenger.phone) };
      if (!passenger.name || !passenger.phone) return reply.code(400).send({ ok: false, error: 'passenger name and an Ethiopian passenger phone (09…) are required' });
    }
    const phone = passenger ? passenger.phone : normPhone(bookerRaw);
    const name = passenger ? passenger.name : bookerName;
    if (!from || !to || !tier) return reply.code(400).send({ ok: false, error: 'tier, pickup and dropoff inside Addis required' });
    if (!phone || !name) return reply.code(400).send({ ok: false, error: contact && !passenger ? 'Your Telegram number is not Ethiopian — use "Book for someone else" and enter the passenger\'s Ethiopian number' : 'riderName and riderPhone(+251…) required' });
    if (idemKey) { const dup = await prisma.ride.findUnique({ where: { idemKey }, include: { driver: true } }); if (dup) return { ok: true, ride: pubRide(dup), duplicate: true, phone: tg ? dup.riderPhone : undefined }; }
    const bookerKey = tg ? 'tg:' + tg.user.id : 'ph:' + (bookerPhone || phone);
    if (!requestRL(phone) || !requestRL(bookerKey) || !requestRL('ip:' + clientIp(req))) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const [r, s] = await Promise.all([geo.route(from, to), settings.get()]); // fare is computed server-side and locked
    const q = quoteFare(s, tier, r.distanceM, r.durationS);
    const rider = await prisma.rider.upsert({ where: { phone }, update: { name }, create: { phone, name } });
    if (tg && !passenger && rider.telegramId !== String(tg.user.id)) await prisma.rider.update({ where: { id: rider.id }, data: { telegramId: String(tg.user.id) } });
    const bookedBy = passenger ? { name: bookerName || null, phone: bookerPhone || null, telegramId: tg ? String(tg.user.id) : null } : null;
    let ride;
    try {
      ride = await prisma.ride.create({ data: {
        idemKey, riderId: rider.id, tier, pickup: from, dropoff: to, distanceM: r.distanceM, durationS: r.durationS, estimate: r.estimate,
        fareEtb: q.fareEtb, driverTakeEtb: q.driverTakeEtb, paymentMethod, status: 'dispatching', riderName: name, riderPhone: phone, bookedBy } });
    } catch (e) {
      if (e.code === 'P2002' && idemKey) {
        const dup = await prisma.ride.findUnique({ where: { idemKey }, include: { driver: true } });
        if (dup) return { ok: true, ride: pubRide(dup), duplicate: true, phone: tg ? dup.riderPhone : undefined };
      }
      throw e;
    }
    dispatch.start(ride.id).catch(err => console.error('[ride/routes] dispatch.start failed:', err.message));
    return { ok: true, ride: pubRide({ ...ride, driver: null }), phone: tg ? phone : undefined };
  });
```
(d) After the `/api/ride/:id/rate` route, add:
```js
  // Telegram: resume the active ride for this user (booker or rider). Auth = signed initData.
  fastify.get('/api/ride/mine', async (req, reply) => {
    const tg = tgauth.verifyInitData(String(req.query.initData || ''), riderBotToken);
    if (!tg) return reply.code(401).send({ ok: false, error: 'telegram_auth_invalid' });
    const id = String(tg.user.id);
    const ride = await prisma.ride.findFirst({ where: { status: { in: ACTIVE }, OR: [{ rider: { telegramId: id } }, { bookedBy: { path: ['telegramId'], equals: id } }] }, include: { driver: true }, orderBy: { requestedAt: 'desc' } });
    return { ok: true, ride: ride ? pubRide(ride) : null, phone: ride ? ride.riderPhone : null };
  });

  // Telegram webhooks (secret header set at setWebhook time).
  fastify.post('/api/tg/rider', tgHook(u => riderBot.handleUpdate(u)));
  fastify.post('/api/tg/driver', tgHook(u => driverBot.handleUpdate(u)));
```
(e) In `/api/ride/:id/cancel`, before `return { ok: true, ride: pubRide(upd) };` add `fireNotify(ride.id, 'cancelled');`.
(f) In `/api/ride/ops/:id/assign`, before the final `return`, add `fireNotify(req.params.id, 'assigned');`.
(g) In `/api/ride/ops/:id/status`, before the final `return`, add `if (['arrived', 'completed', 'cancelled'].includes(to)) fireNotify(ride.id, to);`.
(h) After the `/api/ride/ops/drivers` POST route add:
```js
  fastify.post('/api/ride/ops/drivers/:id/status', async (req, reply) => {
    if (!ops(req, reply)) return;
    const to = String((req.body || {}).status || '');
    if (!['pending', 'approved', 'suspended'].includes(to)) return reply.code(400).send({ ok: false, error: 'status must be pending|approved|suspended' });
    const drv = await prisma.driver.update({ where: { id: req.params.id }, data: { status: to } }).catch(() => null);
    if (!drv) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (driverBot) driverBot.notifyStatus(drv, to).catch(() => {});
    return { ok: true, driver: drv };
  });

  fastify.get('/api/ride/ops/driver-doc/:id', async (req, reply) => {
    if (!ops(req, reply)) return;
    const p = path.join(uploadsDir, String(req.params.id).replace(/[^a-z0-9]/gi, '') + '.jpg');
    if (!fs.existsSync(p)) return reply.code(404).send({ ok: false, error: 'no_document' });
    reply.type('image/jpeg'); return fs.createReadStream(p);
  });
```

- [ ] **Step 4: Wire in `ride/index.js`** — replace the file body with:

```js
'use strict';
const path = require('path');
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
const { makeTgApi } = require('./tgApi');
const { makeRiderBot } = require('./riderBot');
const { makeDriverBot } = require('./driverBot');
const { makeRiderNotify } = require('./riderNotify');
const routes = require('./routes');

// registerRide(fastify, { prisma, sendTg, OWNER_KEY, OWNER_CHAT, ROUTER_URL, BASE_URL })
module.exports = function registerRide(fastify, deps) {
  const settings = makeSettings(deps.prisma);
  const geo = makeGeo({ routerUrl: deps.ROUTER_URL, prisma: deps.prisma });
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });
  // Telegram bots (rider @bina_smart_bot, driver @binasmartdriverbot). Tokens only from .env.
  const riderBotToken = process.env.BINA_RIDER_BOT_TOKEN || '', driverBotToken = process.env.BINA_DRIVER_BOT_TOKEN || '';
  const riderApi = makeTgApi({ token: riderBotToken }), driverApi = makeTgApi({ token: driverBotToken });
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'drivers');
  const riderBot = makeRiderBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot' });
  const driverBot = makeDriverBot({ prisma: deps.prisma, api: driverApi, telegram, uploadsDir, baseUrl: deps.BASE_URL });
  const riderNotify = makeRiderNotify({ prisma: deps.prisma, api: riderApi, baseUrl: deps.BASE_URL });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY,
    riderBotToken, webhookSecret: process.env.TG_WEBHOOK_SECRET || '', riderBot, driverBot, riderNotify, uploadsDir });
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  sweep.unref();
  console.log('[ride] BinaSmart Ride module mounted' + (riderBotToken ? ' (Telegram bots on)' : ' (no Telegram bot tokens)'));
  return { settings, geo, telegram, dispatch, riderNotify };
};
```
And add `uploads/` to `.gitignore` (root): `printf 'uploads/\n' >> .gitignore`.

- [ ] **Step 5: Run the full suite** → `npm test 2>&1 | grep -E "^# (pass|fail)"` → all pass (24 old + 3 + 4 + 4 + 5 + 7 = 47), `# fail 0`. If the `findFirst` JSON `path` filter is rejected by the fake, the fake in the test already answers by inspecting `where.OR`; the real Prisma call uses `bookedBy: { path: ['telegramId'], equals: id }`, which is valid on PostgreSQL.

- [ ] **Step 6: Restart the API and smoke the webhook auth live**

```bash
cd /var/www/connectcare/binasmart && SEC=$(openssl rand -hex 24) && (grep -q "^TG_WEBHOOK_SECRET=" .env || printf "TG_WEBHOOK_SECRET=%s\n" "$SEC" >> .env) && pm2 restart binasmart-api --update-env >/dev/null 2>&1; sleep 4; pm2 logs binasmart-api --lines 5 --nostream 2>/dev/null | grep -i "ride\]"; curl -s -o /dev/null -w "no secret → %{http_code}\n" -X POST https://bina.et/api/tg/rider -H "Content-Type: application/json" -d '{}'; curl -s -o /dev/null -w "ride page → %{http_code}\n" https://bina.et/ride
```
Expected: `BinaSmart Ride module mounted (Telegram bots on)`, `no secret → 401`, `ride page → 200`.

- [ ] **Step 7: Commit and push**

```bash
git add ride/routes.js ride/index.js .gitignore test/tgRoutes.test.js && git commit -q -m "feat(ride): Telegram webhooks, signed booking, book-for-someone-else, /mine, driver approval" && git push -q origin main && git log --oneline -1
```

---

### Task 7: Rider app — Telegram shim, main button, contact share, book for someone else

**Files:**
- Create: `public/ride/tg.js`
- Modify: `public/ride.html`, `public/ride/app.js`, `public/ride/ui.css`

- [ ] **Step 1: `public/ride/tg.js`**

```js
/* Telegram Mini App shim. Exposes window.TG; every method is a safe no-op outside Telegram. */
(function () {
  var W = window.Telegram && window.Telegram.WebApp;
  var inTg = !!(W && W.initData);
  var contactResp = null, onMain = null;
  if (inTg) {
    try { W.ready(); W.expand(); W.setHeaderColor('#064e3b'); W.setBackgroundColor('#faf8f4'); } catch (e) {}
    W.onEvent('contactRequested', function (ev) { if (ev && ev.status === 'sent' && ev.response) contactResp = ev.response; });
    try { W.MainButton.setParams({ color: '#059669', text_color: '#ffffff' }); } catch (e) {}
    W.MainButton.onClick(function () { if (onMain) onMain(); });
  }
  window.TG = {
    isTelegram: function () { return inTg; },
    initData: function () { return inTg ? W.initData : null; },
    user: function () { return inTg && W.initDataUnsafe ? (W.initDataUnsafe.user || null) : null; },
    contact: function () { return contactResp; },
    requestContact: function (cb) {
      if (!inTg || typeof W.requestContact !== 'function') return cb(false);
      try { W.requestContact(function (ok) { setTimeout(function () { cb(!!ok && !!contactResp); }, 80); }); } catch (e) { cb(false); }
    },
    main: function (text, fn) { if (!inTg) return; onMain = fn; W.MainButton.setText(text); W.MainButton.show(); },
    mainHide: function () { if (inTg) W.MainButton.hide(); },
    back: function (fn) { if (!inTg) return; W.BackButton.offClick && W.BackButton.offClick(); W.BackButton.onClick(fn); W.BackButton.show(); },
    backHide: function () { if (inTg) W.BackButton.hide(); },
    haptic: function () { try { W.HapticFeedback.impactOccurred('light'); } catch (e) {} }
  };
})();
```

- [ ] **Step 2: `public/ride.html` changes**

(a) In `<head>`, before the first `<script src="/static/vendor/…">` at the bottom is fine but the SDK must load before `tg.js`; put these at the end, replacing the current four script tags:
```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="/static/vendor/maplibre-gl.js"></script>
<script src="/static/vendor/pmtiles.js"></script>
<script src="/static/ride/map.js?v=2"></script>
<script src="/static/ride/tg.js?v=4"></script>
<script src="/static/ride/app.js?v=4"></script>
```
(b) In `#s-quote`, insert **before** `<div class="payrow">`:
```html
    <label class="forother"><input type="checkbox" id="forOther"> ለሌላ ሰው ይያዙ · Book for someone else</label>
    <div id="passenger" class="passenger hidden">
      <input id="pName" aria-label="Passenger name" placeholder="የተሳፋሪ ስም · Passenger name" autocomplete="off">
      <input id="pPhone" aria-label="Passenger phone" placeholder="09… · Passenger phone (Ethiopia)" inputmode="tel">
      <div class="small">ሹፌሩ ለተሳፋሪው ይደውላል · The driver calls the passenger; you get the updates.</div>
    </div>
```
(c) In `#s-who`, change the `<h2>` small text to `Your name & phone — once` (unchanged) and add after the phone input: `<div class="small" id="whoTgHint" class="hidden"></div>` — not needed; skip. No other markup changes.

- [ ] **Step 3: `public/ride/ui.css`** — append:
```css
.forother{display:flex;align-items:center;gap:8px;font-size:14px;margin:6px 0 4px;font-weight:600}
.passenger{display:flex;flex-direction:column;gap:8px;margin:4px 0 8px}
.passenger input{width:100%;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;font:inherit}
body.tg .cta#request{display:none}
```

- [ ] **Step 4: `public/ride/app.js` changes** (exact edits)

(a) After `var ME = null; try { … } catch (e) { ME = null; }` add:
```js
  var TG = window.TG || null, IN_TG = !!(TG && TG.isTelegram());
  if (IN_TG) { document.body.classList.add('tg'); var tu = TG.user(); if (tu && !ME) ME = null; }
  $('forOther').addEventListener('change', function () { $('passenger').classList.toggle('hidden', !this.checked); });
  function passengerBody() {
    if (!$('forOther').checked) return null;
    var n = $('pName').value.trim(), p = $('pPhone').value.replace(/\s/g, '');
    if (n.length < 2 || !/^(\+?251|0)9\d{8}$/.test(p)) { toast('የተሳፋሪ ስም እና ስልክ ያስገቡ · Enter the passenger name and Ethiopian phone'); return false; }
    return { name: n, phone: p };
  }
```
(b) In `setCta()`, after setting `ctaFare`, add: `if (IN_TG) TG.main('ጉዞ ይጠይቁ · Confirm ride' + (q ? ' · ' + q.fareEtb + ' ETB' : ''), function () { $('request').click(); });`
(c) In `quote()`, right after `show('s-quote')` (or wherever the quote screen is shown; search for `show('s-quote')`), add: `if (IN_TG) { setCta(); TG.back(function () { $('cancelQuote').click(); }); }`. In the `cancelQuote` handler add `if (IN_TG) { TG.mainHide(); TG.backHide(); }` before `show('s-home')`.
(d) Replace the `$('request').addEventListener('click', …)` line with:
```js
  $('request').addEventListener('click', function () {
    var pb = passengerBody(); if (pb === false) return;
    if (ME) return request(pb);
    if (IN_TG) {
      TG.requestContact(function (ok) {
        var u = TG.user() || {};
        if (ok) { ME = { name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Telegram user', phone: null, tg: true }; lsSet('bina_ride_me', JSON.stringify(ME)); request(pb); }
        else { if (u.first_name) $('whoName').value = [u.first_name, u.last_name].filter(Boolean).join(' '); show('s-who'); }
      });
      return;
    }
    show('s-who');
  });
```
(e) Replace `function request() {` … through its closing `}` with:
```js
  function request(pb) {
    var q = selQuote(); if (!q) return;
    var pay = (document.querySelector('input[name=pay]:checked') || {}).value || 'cash';
    $('request').disabled = true; if (IN_TG) TG.main('…', function () {});
    var body = { idemKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), tier: S.tier, pickup: S.pickup, dropoff: S.dropoff, paymentMethod: pay, riderName: ME.name, riderPhone: ME.phone || undefined };
    if (pb) body.passenger = pb;
    if (IN_TG) body.tg = { initData: TG.initData(), contact: TG.contact() || undefined };
    api('/api/ride/request', body)
      .then(function (d) {
        $('request').disabled = false;
        if (!d.ok) { if (IN_TG) setCta(); return toast(d.error || 'Could not request'); }
        if (d.phone) { ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); }
        S.ride = d.ride; lsSet('bina_ride_active', d.ride.id); show('s-finding'); startPoll();
        if (IN_TG) { TG.backHide(); TG.main('ሰርዝ · Cancel ride', cancel); TG.haptic(); }
      }).catch(function () { $('request').disabled = false; if (IN_TG) setCta(); toast('Network error — try again'); });
  }
```
(f) In `render(r)`: wherever the status becomes `assigned`/`arriving`/`arrived` keep the main button as Cancel; when `ontrip` or later, hide it. Add at the top of `render(r)`: `if (IN_TG) { if (['requested', 'dispatching', 'assigned', 'arriving', 'arrived'].indexOf(r.status) >= 0) TG.main('ሰርዝ · Cancel ride', cancel); else TG.mainHide(); }`
(g) In `reset()`, add at the start: `if (IN_TG) { TG.mainHide(); TG.backHide(); } $('forOther').checked = false; $('passenger').classList.add('hidden');`
(h) Replace the resume block at the end:
```js
  // ---- resume an active ride after reload ----
  var active = lsGet('bina_ride_active');
  var urlId = new URLSearchParams(location.search).get('id');
  if (IN_TG) {
    api('/api/ride/mine?initData=' + encodeURIComponent(TG.initData())).then(function (d) {
      if (d.ok && d.ride) { ME = ME || { name: (TG.user() || {}).first_name || 'Telegram user', tg: true }; ME.phone = d.phone; lsSet('bina_ride_me', JSON.stringify(ME)); S.ride = { id: d.ride.id }; lsSet('bina_ride_active', d.ride.id); render(d.ride); startPoll(); }
    }).catch(function () {});
  } else if ((urlId || active) && ME) { S.ride = { id: urlId || active }; startPoll(); }
```
`render(r)` must show the right screen for a ride resumed from the server (it already switches screens by status when polling; verify by reading `render` — it calls `show('s-finding'|'s-assigned'|…)` per status).

- [ ] **Step 5: Verify in a browser (no booking)**

Deploy the static files (they are served directly; no restart needed) and check both modes:
```bash
curl -s https://bina.et/ride | grep -c "telegram-web-app.js\|tg.js?v=4\|app.js?v=4\|forOther"
```
Expected: `4`. Then open `https://bina.et/ride` in the Claude browser pane (`preview_start`), pick a destination, tick **Book for someone else**, confirm the passenger fields appear and that an empty passenger phone shows the toast. Do **not** press Request with real data. Outside Telegram, `window.TG.isTelegram()` must be `false` (check with `javascript_tool`).

- [ ] **Step 6: Commit**

```bash
git add public/ride/tg.js public/ride.html public/ride/app.js public/ride/ui.css && git commit -q -m "feat(ride): Telegram Mini App mode, one-tap phone, book for someone else" && git log --oneline -1
```

---

### Task 8: Ops console — approve / suspend drivers, licence link

**Files:**
- Modify: `public/ride-ops.html`

- [ ] **Step 1: Find the owner-key variable name**

Run: `grep -n "sessionStorage\|x-owner-key\|var KEY\|const KEY\|let KEY" public/ride-ops.html | head -5`
Expected: a line showing how the key is stored (e.g. `var KEY = sessionStorage.getItem('ownerKey')`). Use that variable name where `KEY` appears below.

- [ ] **Step 2: Replace the driver-row renderer** (the `document.getElementById('drivers').innerHTML=DRIVERS.map(…)` expression) with:

```js
document.getElementById('drivers').innerHTML=DRIVERS.map(function(x){
  var st = x.status==='approved'?'✅':x.status==='pending'?'🕒':'⛔';
  var lic = x.licenceUrl ? ' · <a href="'+esc(x.licenceUrl)+'?key='+encodeURIComponent(KEY)+'" target="_blank" rel="noopener">licence 📄</a>' : '';
  var btns = (x.status!=='approved'?'<button data-dstat="approved" data-did="'+esc(x.id)+'">Approve</button>':'')+(x.status!=='suspended'?'<button data-dstat="suspended" data-did="'+esc(x.id)+'" class="danger">Suspend</button>':'');
  return '<div><b>'+esc(x.name)+'</b> '+st+' '+esc(x.status)+'<div class="mut">'+esc(x.plate)+' · '+esc(x.tier)+' · '+esc(x.vehicleMake||'')+' · '+esc(x.phone)+' · ★'+esc(x.rating)+' · '+esc(x.ridesCount)+' rides'+lic+(x.telegramId?' · TG':'')+'</div><div class="row">'+btns+'</div></div>';
}).join('')||'<span class="mut">No drivers yet — add one above or let them register in @binasmartdriverbot.</span>';
document.querySelectorAll('[data-dstat]').forEach(function(b){ b.onclick=function(){ if(!confirm(b.dataset.dstat+' this driver?')) return; api('/api/ride/ops/drivers/'+b.dataset.did+'/status',{status:b.dataset.dstat}).then(function(d){ if(!d.ok) return alert(d.error||'failed'); load(); }); }; });
```
(`api(path, body)` in this page already sends the `x-owner-key` header; `esc`, `load`, `DRIVERS` already exist.)

- [ ] **Step 3: Verify** — open `https://bina.et/ride-ops?key=…` is Ibrahim's; instead verify the endpoint with curl using the key from `.env` without printing it:
```bash
cd /var/www/connectcare/binasmart && K=$(grep -o "^OWNER_KEY=.*" .env | cut -d= -f2 | tr -d '"') && curl -s -H "x-owner-key: $K" https://bina.et/api/ride/ops/drivers | python3 -c "import sys,json;d=json.load(sys.stdin);print('drivers:',len(d['drivers']))"
```
Expected: `drivers: N` (any number).

- [ ] **Step 4: Commit**

```bash
git add public/ride-ops.html && git commit -q -m "feat(ride-ops): approve/suspend drivers, licence photo link" && git log --oneline -1
```

---

### Task 9: MCP `request_ride` — passenger fields

**Files:**
- Modify: `mcp-server/tools/ride.mjs`, `mcp-server/test/ride-tools.test.mjs`

- [ ] **Step 1: Add a failing test** to `mcp-server/test/ride-tools.test.mjs`:

```js
test('request_ride can book for someone else: passenger becomes the rider, booker phone may be foreign', async () => {
  let sent = null;
  const t = tools(fakeApi({ request: async b => { sent = b; return { ok: true, ride: { id: 'r9', status: 'dispatching', fareEtb: 250, tier: b.tier, pickup: b.pickup, dropoff: b.dropoff, driver: null } }; } }));
  const ok = out(await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Ibrahim', rider_phone: '+447700900123', passenger_name: 'Almaz', passenger_phone: '0922333444' }));
  assert.equal(ok.ride_id, 'r9');
  assert.deepEqual(sent.passenger, { name: 'Almaz', phone: '+251922333444' });
  assert.equal(sent.riderPhone, '+447700900123');
  const bad = await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Ibrahim', rider_phone: '+447700900123' });
  assert.equal(bad.isError, true, 'foreign booker without a passenger is rejected');
});
```

- [ ] **Step 2: Run** `cd mcp-server && node --test` → this test fails (`passenger` undefined / foreign phone rejected).

- [ ] **Step 3: Implement in `mcp-server/tools/ride.mjs`** — in the `request_ride` registration:

`inputSchema` gains:
```js
      passenger_name: z.string().min(1).max(60).optional().describe('Book for someone else: the passenger\'s name (the driver calls the passenger)'),
      passenger_phone: z.string().min(9).max(20).optional().describe('Book for someone else: the passenger\'s Ethiopian mobile (09… or +2519…)'),
```
description gains the sentence: `To book for someone else (e.g. a relative in Addis while you are abroad), pass passenger_name and passenger_phone; rider_name/rider_phone are then the booker and may be a foreign number.`

Replace the handler's first lines:
```js
  }, wrap('request_ride', async ({ tier, pickup, dropoff, rider_name, rider_phone, payment_method, passenger_name, passenger_phone }) => {
    const passenger = (passenger_name || passenger_phone) ? { name: String(passenger_name || '').trim(), phone: normPhone(passenger_phone) } : null;
    if (passenger && (!passenger.name || !passenger.phone)) return toolError('To book for someone else, give both passenger_name and an Ethiopian passenger_phone (09XXXXXXXX or +2519XXXXXXXX).');
    const phone = passenger ? String(rider_phone || '').replace(/[^\d+]/g, '') : normPhone(rider_phone);
    if (!phone || (!passenger && !normPhone(rider_phone))) return toolError(PHONE_MSG + ' If the booker is abroad, use passenger_name and passenger_phone for the person riding.');
    try {
      const r = await resolveBoth(api, pickup, dropoff); if (r.err) return r.err;
      const res = await api.request({ tier, pickup: r.from, dropoff: r.to, riderName: String(rider_name).trim(), riderPhone: phone, paymentMethod: payment_method || 'cash', idemKey: idemKey(passenger ? passenger.phone : phone, r.from, r.to), ...(passenger ? { passenger } : {}) });
      const ride = pubRide(res.ride);
      return json({ ...ride, duplicate: !!res.duplicate, booked_for: passenger ? passenger.name : undefined,
        next_step: `Read the fare (${ride.fare_etb} ETB) and ride id back to the user. A BinaSmart dispatcher will call ${passenger ? passenger.phone + ' (the passenger)' : phone} to confirm the driver. Track at ${ride.tracking_url}.`,
        source_url: `${BASE}/ride`, whatsapp: WHATSAPP });
    } catch (e) { return apiErrorToTool(e); }
  }));
```
Note `api.request` sets the synthetic `X-Real-IP` from `riderPhone` — with a passenger, use the passenger phone for the limit instead: in `lib/rideApi.mjs` change `request: b => call('POST', '/api/ride/request', { body: b, phone: b.riderPhone })` to `request: b => call('POST', '/api/ride/request', { body: b, phone: (b.passenger && b.passenger.phone) || b.riderPhone })`.

- [ ] **Step 4: Run** `node --test` → `# pass 29`, `# fail 0`. Restart: `pm2 restart bina-mcp >/dev/null 2>&1; sleep 2; curl -s https://bina.et/mcp/health`.

- [ ] **Step 5: Commit and push**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/tools/ride.mjs mcp-server/lib/rideApi.mjs mcp-server/test/ride-tools.test.mjs && git commit -q -m "feat(mcp): request_ride passenger_name/passenger_phone (book for someone else)" && git push -q origin main && git log --oneline -1
```

---

### Task 10: Telegram configuration (webhooks, menu button, commands, commission 0)

**Files:**
- Create: `ops/telegram/README.md`

- [ ] **Step 1: Register both webhooks with the secret, set commands and the rider menu button**

```bash
cd /var/www/connectcare/binasmart && R=$(grep -o "^BINA_RIDER_BOT_TOKEN=.*" .env | cut -d= -f2) && D=$(grep -o "^BINA_DRIVER_BOT_TOKEN=.*" .env | cut -d= -f2) && S=$(grep -o "^TG_WEBHOOK_SECRET=.*" .env | cut -d= -f2)
curl -s -X POST "https://api.telegram.org/bot$R/setWebhook" -H "Content-Type: application/json" -d "{\"url\":\"https://bina.et/api/tg/rider\",\"secret_token\":\"$S\",\"allowed_updates\":[\"message\",\"callback_query\"]}" | python3 -c "import sys,json;print('rider webhook:',json.load(sys.stdin)['ok'])"
curl -s -X POST "https://api.telegram.org/bot$D/setWebhook" -H "Content-Type: application/json" -d "{\"url\":\"https://bina.et/api/tg/driver\",\"secret_token\":\"$S\",\"allowed_updates\":[\"message\",\"callback_query\"]}" | python3 -c "import sys,json;print('driver webhook:',json.load(sys.stdin)['ok'])"
curl -s -X POST "https://api.telegram.org/bot$R/setChatMenuButton" -H "Content-Type: application/json" -d '{"menu_button":{"type":"web_app","text":"🚕 Book a ride","web_app":{"url":"https://bina.et/ride"}}}' | python3 -c "import sys,json;print('menu button:',json.load(sys.stdin)['ok'])"
curl -s -X POST "https://api.telegram.org/bot$R/setMyCommands" -H "Content-Type: application/json" -d '{"commands":[{"command":"start","description":"Book a ride · ጉዞ ይያዙ"}]}' | python3 -c "import sys,json;print('rider cmds:',json.load(sys.stdin)['ok'])"
curl -s -X POST "https://api.telegram.org/bot$D/setMyCommands" -H "Content-Type: application/json" -d '{"commands":[{"command":"start","description":"Register as a driver · ይመዝገቡ"}]}' | python3 -c "import sys,json;print('driver cmds:',json.load(sys.stdin)['ok'])"
curl -s "https://api.telegram.org/bot$R/getWebhookInfo" | python3 -c "import sys,json;d=json.load(sys.stdin)['result'];print('rider hook:',d['url'],'pending',d['pending_update_count'],'lastErr',d.get('last_error_message'))"
curl -s "https://api.telegram.org/bot$D/getWebhookInfo" | python3 -c "import sys,json;d=json.load(sys.stdin)['result'];print('driver hook:',d['url'],'pending',d['pending_update_count'],'lastErr',d.get('last_error_message'))"
```
Expected: every line `True`; both hooks show the bina.et URLs with `lastErr None`.

- [ ] **Step 2: Commission 0 for the launch**

```bash
cd /var/www/connectcare/binasmart && K=$(grep -o "^OWNER_KEY=.*" .env | cut -d= -f2 | tr -d '"') && curl -s -X POST https://bina.et/api/ride/ops/settings -H "x-owner-key: $K" -H "Content-Type: application/json" -d '{"commissionPct":0}' | python3 -c "import sys,json;print('commissionPct:',json.load(sys.stdin)['settings']['commissionPct'])"
```
Expected: `commissionPct: 0`.

- [ ] **Step 3: Runbook `ops/telegram/README.md`**

```markdown
# BinaSmart Telegram bots — runbook

| Bot | Username | Env var | Webhook |
|---|---|---|---|
| Rider (Mini App) | @bina_smart_bot | `BINA_RIDER_BOT_TOKEN` | `https://bina.et/api/tg/rider` |
| Driver (registration) | @binasmartdriverbot | `BINA_DRIVER_BOT_TOKEN` | `https://bina.et/api/tg/driver` |

⚠️ `BINASMART_TG_TOKEN` is **@gccandconectbot**, shared with GCC Domestic's Mini App. Never set its webhook or menu button from BinaSmart. It only sends owner alerts.

Both webhooks require the `X-Telegram-Bot-Api-Secret-Token` header = `TG_WEBHOOK_SECRET` (in `.env`). The server answers 200 immediately and processes afterwards.

## Re-register a webhook (after a token or secret change)
`curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d url=https://bina.et/api/tg/rider -d secret_token=<TG_WEBHOOK_SECRET>`
Check: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

## Menu button / commands (rider bot)
`setChatMenuButton` → web_app `https://bina.et/ride`; `setMyCommands` → `start`.

## Direct link (BotFather, once, Ibrahim)
`/newapp` → @bina_smart_bot → title `BinaSmart Ride`, short name `ride`, web app URL `https://bina.et/ride`, photo optional → link `https://t.me/bina_smart_bot/ride`.

## Rotate a token
1. BotFather `/revoke` for the bot → new token.
2. Edit `.env`, `pm2 restart binasmart-api --update-env`.
3. Re-run setWebhook (above) with the new token.

## Data
- Licence photos: `uploads/drivers/<driverId>.jpg` (git-ignored, outside public/). Served only via `GET /api/ride/ops/driver-doc/:id?key=OWNER_KEY`.
- Rider notifications go to `Ride.bookedBy.telegramId` (booker) else `Rider.telegramId`.
- Driver registrations arrive as `status: pending`; approve in `/ride-ops` → Drivers.
```

- [ ] **Step 4: Commit**

```bash
git add ops/telegram/README.md && git commit -q -m "docs: Telegram bots runbook" && git log --oneline -1
```

---

### Task 11: Live verification, README, memory

- [ ] **Step 1: Rider bot `/start` round trip (safe: it only sends the welcome to whoever messages the bot)**

Ibrahim has pressed Start on @bina_smart_bot. Check the server saw the update and answered:
```bash
pm2 logs binasmart-api --lines 40 --nostream 2>/dev/null | grep -i "ride/tg\|tg\]" | tail -5; tail -50 /var/log/nginx/bina.access.log | grep "/api/tg/" | awk '{print $4,$7,$9}' | tail -5
```
Expected: `POST /api/tg/rider 200` lines from Telegram's IPs (149.154.x.x / 91.108.x.x) and no `[ride/tg] webhook handler error`. If Ibrahim reports the welcome message with the "Book a ride" button arrived, the rider bot is verified.

- [ ] **Step 2: Mini App quote inside Telegram (no booking)**

Ask Ibrahim to open @bina_smart_bot → menu button → pick a destination → confirm the Telegram bottom button shows `Confirm ride · N ETB`, then press the phone-share prompt **Cancel** (so nothing is booked) and screenshot. Server-side check that the Mini App identity path works without booking:
```bash
tail -100 /var/log/nginx/bina.access.log | grep "/api/ride/mine" | awk '{print $4,$7,$9}' | tail -3
```
Expected: `GET /api/ride/mine?initData=… 200` (the app calls it on open inside Telegram).

- [ ] **Step 3: Driver registration once, then delete the test driver**

Ibrahim (or the implementer with their own Telegram) runs the six steps in @binasmartdriverbot with name `TEST DELETE ME`. Then:
```bash
cd /var/www/connectcare/binasmart && cat > ./_deltest.tmp.js <<'EOF'
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); const fs = require('fs');
(async () => { const d = await p.driver.findFirst({ where: { name: 'TEST DELETE ME' } }); if (!d) return console.log('no test driver');
  console.log('found', d.id, d.status, d.tier, d.plate, d.licenceUrl); try { fs.unlinkSync('uploads/drivers/' + d.id + '.jpg'); } catch (e) {}
  await p.driver.delete({ where: { id: d.id } }); console.log('deleted'); await p.$disconnect(); })();
EOF
node ./_deltest.tmp.js 2>&1 | grep -v Aborted; rm -f ./_deltest.tmp.js
```
Expected: `found … pending … /api/ride/ops/driver-doc/…` then `deleted`. Also confirm the owner alert arrived on Ibrahim's Telegram ("🧑‍✈️ NEW DRIVER (pending)").

- [ ] **Step 4: README section** — append to `README.md`:

```markdown
## Telegram Mini App + bots

- **Riders:** [@bina_smart_bot](https://t.me/bina_smart_bot) opens `bina.et/ride` as a Telegram Mini App: one-tap verified phone, Telegram main button, status pushes (assigned / arrived / completed / cancelled). Anyone can **book for someone else** (passenger name + Ethiopian phone; the booker gets the updates) — including from abroad.
- **Drivers:** [@binasmartdriverbot](https://t.me/binasmartdriverbot) registers drivers in six steps (name, phone, vehicle, plate, licence photo) into the pending list; approve in `/ride-ops`. Registration is free, 0% commission during launch.
- Server modules: `ride/tgauth.js`, `ride/tgApi.js`, `ride/riderBot.js`, `ride/driverBot.js`, `ride/riderNotify.js`; webhooks `/api/tg/rider`, `/api/tg/driver` (secret header). Runbook: [`ops/telegram/README.md`](ops/telegram/README.md).
```

- [ ] **Step 5: Commit, push, memory**

```bash
git add README.md && git commit -q -m "docs: Telegram Mini App + bots" && git push -q origin main && git log --oneline -1
```
Memory (`project_binasmart_ride.md`): status "Telegram Mini App LIVE 2026-09-03", the two bots, webhook secret var, `bookedBy`, the `/newapp` step pending on Ibrahim, and the gotcha that `alias`-style tricks don't apply here (Fastify sendFile). Update `MEMORY.md` hook line for the ride project.

---

## Self-review

**Spec coverage:** §3 files → Tasks 1, 2, 4, 5, 6, 7, 8, 9, 10 ✔ (`tg.js`, `tgauth`, `riderNotify`, `driverBot`, `riderBot`, `tgApi`, routes, index, schema, MCP, runbook). Entry points (menu button, `/start` button, direct link via BotFather) → Task 10 + runbook ✔. Identity/trust (initData + contact HMAC, 24 h, foreign-number message) → Tasks 1, 6 ✔. §4 rider flow (theme, MainButton, BackButton, contact share, name pre-fill, book-for-someone-else, resume via `/mine`, pushes) → Tasks 4, 6, 7 ✔. §5 driver flow → Tasks 5, 6, 8 ✔ (approval message via `notifyStatus`). §6 safety (secret header, fast 200, limits on passenger + booker, 401 messages, notify failures logged, photo validation, duplicate phone, TTL, uploads outside public, tokens only in `.env`, old bot untouched) → Tasks 5, 6, 10 ✔. §7 tests → Tasks 1, 2, 4, 5, 6, 9 ✔. §8 rollout → Tasks 3, 6, 10, 11 ✔ (`?v=4` in Task 7). Commission 0 → Task 10 ✔.

**Placeholder scan:** none. Task 8 Step 1 resolves the owner-key variable name with an exact command.

**Type consistency:** `makeTgApi` methods used identically in Tasks 4, 5, 6, 10; `driverBot.handleUpdate/notifyStatus` in Tasks 5, 6, 8; `riderNotify.notify(id, event)` in Tasks 4, 6; `sign()` from Task 1 used in Task 6 tests; `routes(fastify, deps)` deps names identical in Task 6 impl, Task 6 test and `ride/index.js`; `normPhone` moved to `ride/phone.js` in Task 5 and required by `routes.js` and `driverBot.js`; `bookedBy` shape `{name, phone, telegramId}` identical in Tasks 4, 6, 9.
