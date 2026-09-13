# Owner Telegram Linking Implementation Plan (Plan 3 of 4 — owner Bini)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A building owner opens `t.me/bina_smart_bot?start=owner`, taps "📱 Share my phone", and — if Telegram vouches that the number is theirs and it is approved for a building where Bini for owners is switched on — gets the same answer-only owner assistant as the dashboard, in Telegram, with access re-checked on every message.

**Architecture:** Three additive tables: `OwnerAccess` (approved numbers per business), `OwnerTgLink` (a Telegram account proven to hold a number) and `AgentSwitch` (the agent is on for this business). `agents/owner/access.js` holds all the rules over a small store interface (Prisma in production, memory in tests). `@bina_smart_bot` (`ride/binaBot.js`) gains an optional `owner` dependency: `/start owner`, the contact message, `/logout`, `/bini`, `/owner`, and routing of private text and voice to the owner agent while the account is linked and in owner mode. `server.js` builds that dependency from the engine (`runAgent(ownerAgent, …, { scope, channel: 'owner-telegram' })`), passes it into the ride module, and adds a "Bini on Telegram" card to the dashboard's Settings tab with a Remove button. Ops approve numbers and switch buildings on with `ops/owner/access.js`.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 (`prisma db push`, additive), `node:test`, Telegram Bot API (`request_contact` keyboard).

**Design:** `docs/superpowers/specs/2026-09-13-owner-bini-design.md` §3. Builds on Plan 2 (live at `67f6239`). **Not in this plan:** switching Darulle on, Ibrahim's own test, the 40-question evaluation (Plan 4).

---

## Conventions (unchanged)

- Work on the VPS: `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`, pm2 `binasmart-api`, port 4210, branch main. Back up an existing file before patching; edit existing files with a Python script that asserts each anchor matches once. New files may be written locally and copied up. Windows Git Bash: no heredocs, apostrophes or Ethiopic inside `ssh '...'`.
- `npm test` baseline **675 pass, 0 fail** (HEAD `67f6239`). Counts below are deltas.
- `git commit -F <file>`, stage by name, never `broadcast-am-fbcomment.js`, never `uploader.js`. Public repo: no phone numbers (tests use `0900000001`-style fakes), keys, chat ids or real names.
- **No test sends to live channels.** No step sends a Telegram message. The bot path is proved with a fake Telegram API in tests; the live checks in Task 4 run the access rules in-process and the dashboard routes over HTTP on a demo building, with temporary rows deleted in the same run. The first real Telegram link is Ibrahim's own, in Plan 4.
- **Data never leaves the server.** Scripts print counts, booleans and last-four digits only.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | modify | `OwnerAccess`, `OwnerTgLink`, `AgentSwitch` |
| `agents/owner/access.js` | create | `makeOwnerAccessStore(prisma)`; `makeOwnerAccess({store, audit, now, limit})` → `linkFromContact scopeFor unlink setMode linksForBuilding revokeForBuilding` |
| `test/owner/access.test.js` | create | every access rule over an in-memory store; the Prisma store's query shapes |
| `agents/owner/health-report.js` | create | `healthMessage(dataHealthResult)` — the bilingual first message |
| `test/owner/health-report.test.js` | create | the message from a `data_health` result |
| `ride/binaBot.js` | modify | optional `owner` dep: start, contact, logout, modes, private routing (text and voice) |
| `ride/index.js` | modify | pass `deps.ownerTelegram` to the bot |
| `test/owner/telegram.test.js` | create | the bot's owner paths with a fake Telegram API |
| `server.js` | modify | `ownerAccess`, `ownerTelegram`; dashboard `GET /api/owner/:slug/telegram-links`, `POST …/:id/remove`; ride deps |
| `public/owner.html` | modify | Settings: "Bini on Telegram" card (Connect link, linked accounts, Remove) |
| `test/kit/wiring.test.js` | modify | the new wiring stays as designed |
| `ops/owner/access.js` | create | `list add revoke enable disable` for a building |

## Facts this plan relies on (verified 13 Sep 2026)

- `ride/binaBot.js` `makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey })`; `handleUpdate(update)` reads `update.message` (`chat.id`, `text`, `voice`, `from`); `api.sendMessage(chatId, text, extra)`, `api.sendChatAction`, `api.getFile`, `api.downloadFile`; `forTelegram(text)`; voice → `/api/assistant/transcribe` then `askBini`. Existing tests (`test/binaBot.test.js`) send messages with no `chat.type`.
- `ride/index.js` builds `riderBot = makeBinaBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: …, linkShop: …, assistantUrl: …, internalKey: deps.OWNER_KEY })`. `ride/routes.js` `/api/tg/rider` requires `x-telegram-bot-api-secret-token` and calls `riderBot.handleUpdate`.
- `server.js`: `const rideMod = require('./ride')(fastify, { prisma, sendTg, OWNER_KEY, … askBini: callBini, …` (~line 3413, after `runAgent` ~1147 and the owner route ~2425); `audit(buildingId, action, detail, amount)` hoisted; `authBuildingFail`; `phoneKey` from `./ride/phone` (`phoneKey('0911244344') === 'ph:911244344'`; `+251…`, `251…`, spaced forms give the same key; junk → `null`).
- `agents/owner/tools/building.js` `makeExecutor({ prisma })(scope)('data_health', {})` → `{ buildings: [{ building, buildingAm, units, activeTenancies, invoices, invoicesPaid, rentMonthsWithoutInvoices, expensesRecorded, openRepairs, contractsExpiredStillActive, newestInvoice, newestPayment, … }] }` (verify the keys when writing Task 2).
- `public/owner.html`: `esc()`, `jsq()`, `kfetch()`, `slug`; Settings tab renders `app.innerHTML = \`…\`` inside `if (TAB === 'settings'){ … }`.
- Telegram: a contact shared with a `request_contact` button arrives as `message.contact = { phone_number, first_name, user_id }` with `user_id === message.from.id`; a forwarded message carries `forward_origin` (or legacy `forward_from`/`forward_date`).

---

### Task 1: Tables and access rules

**Files:**
- Modify: `prisma/schema.prisma` (append three models)
- Create: `agents/owner/access.js`
- Test: `test/owner/access.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// Who may use Bini for owners, and through which Telegram account. Over an in-memory store, so every rule is
// exercised without a database; the last test pins the Prisma store's queries.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { phoneKey } = require('../../ride/phone');
const { makeOwnerAccess, makeOwnerAccessStore } = require('../../agents/owner/access');

function memStore() {
  const s = { access: [], links: [], switches: [], seq: 0 };
  const id = p => p + (++s.seq);
  return {
    s,
    linkByTelegram: async t => s.links.find(l => l.telegramId === t) || null,
    linkById: async i => s.links.find(l => l.id === i) || null,
    activeAccessByPhone: async pk => s.access.filter(a => a.phoneKey === pk && !a.revokedAt),
    accessForEntity: async (kind, e) => s.access.filter(a => a.kind === kind && a.entityId === e && !a.revokedAt),
    enabledEntities: async (agent, kind, ids) => s.switches.filter(w => w.agent === agent && w.kind === kind && ids.includes(w.entityId) && !w.disabledAt).map(w => w.entityId),
    upsertLink: async ({ telegramId, chatId, phoneKey: pk, at }) => {
      let l = s.links.find(x => x.telegramId === telegramId);
      if (!l) { l = { id: id('L'), telegramId }; s.links.push(l); }
      return Object.assign(l, { chatId, phoneKey: pk, linkedAt: at, lastSeen: at, revokedAt: null, mode: 'owner' });
    },
    revokeLink: async (i, at) => { s.links.find(l => l.id === i).revokedAt = at; },
    touchLink: async (i, at) => { s.links.find(l => l.id === i).lastSeen = at; },
    setMode: async (i, mode) => { s.links.find(l => l.id === i).mode = mode; },
    linksForPhones: async pks => s.links.filter(l => pks.includes(l.phoneKey)),
    addAccess(entityId, phone, role = 'owner', label = null) {
      const a = { id: id('A'), kind: 'building', entityId, phoneKey: phoneKey(phone), role, label, revokedAt: null };
      s.access.push(a); return a;
    },
    enable(entityId) { s.switches.push({ agent: 'owner', kind: 'building', entityId, disabledAt: null }); },
  };
}

const T0 = new Date('2026-09-13T12:00:00Z');
function setup() {
  const store = memStore(), audits = [];
  const access = makeOwnerAccess({ store, audit: (b, action, detail) => audits.push({ b, action, detail }), now: () => T0 });
  return { store, audits, access };
}
const chat = { id: 7, type: 'private' }, from = { id: 42 };
const own = phone => ({ chat, from, contact: { phone_number: phone, user_id: 42 }, forwarded: false });

test('a number Telegram vouches for, approved and switched on, links the account', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  const r = await access.linkFromContact(own('+251 900 000 001'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.scope.buildingIds, ['b1']);
  assert.equal(store.s.links[0].telegramId, '42');
  assert.equal(store.s.links[0].phoneKey, 'ph:900000001');
  assert.deepEqual(audits.map(a => [a.b, a.action]), [['b1', 'OWNER_TG_LINKED']]);
  assert.doesNotMatch(audits[0].detail, /900000001|0900/, 'the audit keeps last four digits only');
  assert.match(audits[0].detail, /0001/);
});

test('only the sender’s own contact, in a private chat, counts', async () => {
  const { store, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), chat: { id: -5, type: 'group' } })).reason, 'not_private');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), contact: { phone_number: '0900000001', user_id: 99 } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), contact: { phone_number: '0900000001' } })).reason, 'not_own_contact');
  assert.equal((await access.linkFromContact({ ...own('0900000001'), forwarded: true })).reason, 'not_own_contact');
  assert.equal(store.s.links.length, 0);
});

test('an unapproved number, or a building that is not switched on, links nothing and says the same thing', async () => {
  const { store, access } = setup();
  assert.equal((await access.linkFromContact(own('0900000002'))).reason, 'not_registered');
  store.addAccess('b1', '0900000002');                       // approved but not switched on
  assert.equal((await access.linkFromContact(own('0900000002'))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('not a phone'))).reason, 'not_registered');
  assert.equal(store.s.links.length, 0);
});

test('too many attempts from one account are paused', async () => {
  const { access } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await access.linkFromContact(own('090000000' + i))).reason, 'not_registered');
  assert.equal((await access.linkFromContact(own('0900000009'))).reason, 'too_many');
});

test('the scope is read again on every message: removing the number or switching off ends it at once', async () => {
  const { store, access } = setup();
  const a = store.addAccess('b1', '0900000001'); store.addAccess('b2', '0900000001', 'staff', 'accountant');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('0900000001'));
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1', 'b2']);
  store.s.switches.find(w => w.entityId === 'b2').disabledAt = T0;
  assert.deepEqual((await access.scopeFor(42)).buildingIds, ['b1']);
  a.revokedAt = T0;
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.scopeFor(777), null, 'an account that never linked has no scope');
});

test('modes, logout, and a revoked link', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001'); store.enable('b1');
  await access.linkFromContact(own('0900000001'));
  assert.equal((await access.scopeFor(42)).mode, 'owner');
  assert.equal(await access.setMode(42, 'bini'), true);
  assert.equal((await access.scopeFor(42)).mode, 'bini');
  assert.equal(await access.unlink(42), true);
  assert.equal(await access.scopeFor(42), null);
  assert.equal(await access.unlink(42), false);
  assert.equal(await access.setMode(42, 'owner'), false);
  assert.ok(audits.some(a => a.action === 'OWNER_TG_UNLINKED' && a.b === 'b1'));
});

test('the dashboard lists and removes only its own building’s links', async () => {
  const { store, audits, access } = setup();
  store.addAccess('b1', '0900000001', 'owner'); store.addAccess('b2', '0900000003', 'owner');
  store.enable('b1'); store.enable('b2');
  await access.linkFromContact(own('0900000001'));
  await access.linkFromContact({ ...own('0900000003'), from: { id: 43 }, contact: { phone_number: '0900000003', user_id: 43 } });
  const list = await access.linksForBuilding('b1');
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'label', 'lastSeen', 'linkedAt', 'mode', 'phoneLast4', 'role']);
  assert.equal(list[0].phoneLast4, '0001');
  const other = store.s.links.find(l => l.telegramId === '43');
  assert.equal(await access.revokeForBuilding('b1', other.id), false, 'building 1 cannot sign out building 2’s owner');
  assert.equal(other.revokedAt, null);
  assert.equal(await access.revokeForBuilding('b1', list[0].id), true);
  assert.equal(await access.scopeFor(42), null);
  assert.equal((await access.linksForBuilding('b1')).length, 0);
  assert.ok(audits.some(a => a.b === 'b1' && a.action === 'OWNER_TG_UNLINKED' && /dashboard/.test(a.detail)));
});

test('the Prisma store asks exactly the right questions', async () => {
  const calls = [];
  const model = name => new Proxy({}, { get: (_, op) => async args => { calls.push({ name, op, args }); return op === 'findMany' ? [] : null; } });
  const store = makeOwnerAccessStore({ ownerAccess: model('ownerAccess'), ownerTgLink: model('ownerTgLink'), agentSwitch: model('agentSwitch') });
  await store.activeAccessByPhone('ph:900000001');
  await store.enabledEntities('owner', 'building', ['b1']);
  await store.upsertLink({ telegramId: '42', chatId: '7', phoneKey: 'ph:900000001', at: T0 });
  await store.accessForEntity('building', 'b1');
  const by = (name, op) => calls.find(c => c.name === name && c.op === op).args;
  assert.deepEqual(by('ownerAccess', 'findMany').where, { phoneKey: 'ph:900000001', revokedAt: null });
  assert.deepEqual(by('agentSwitch', 'findMany').where, { agent: 'owner', kind: 'building', entityId: { in: ['b1'] }, disabledAt: null });
  const up = by('ownerTgLink', 'upsert');
  assert.deepEqual(up.where, { telegramId: '42' });
  assert.equal(up.update.revokedAt, null, 'linking again reopens a revoked link');
  assert.equal(up.update.mode, 'owner');
  assert.deepEqual(calls.filter(c => c.name === 'ownerAccess')[1].args.where, { kind: 'building', entityId: 'b1', revokedAt: null });
});
```

- [ ] **Step 2: Run and confirm failure** — `node --test test/owner/access.test.js` → `Cannot find module '../../agents/owner/access'`.

- [ ] **Step 3: Append the models to `prisma/schema.prisma`**

```prisma
// ===== Bini for owners on Telegram (owner Bini design §3) =====
// Who may use an owner assistant for a business. Numbers are approved by ops (ops/owner/access.js).
model OwnerAccess {
  id        String    @id @default(cuid())
  kind      String    // building (v1) | shop | venue | hotel | clinic
  entityId  String
  phoneKey  String    // ride/phone.js phoneKey() of the approved number
  role      String    @default("owner") // owner | staff
  label     String?
  addedBy   String    // ops | owner:<id>
  createdAt DateTime  @default(now())
  revokedAt DateTime?

  @@index([phoneKey])
  @@index([kind, entityId])
}

// A Telegram account that proved, through Share-my-phone, that it holds an approved number.
model OwnerTgLink {
  id         String    @id @default(cuid())
  telegramId String    @unique
  chatId     String
  phoneKey   String
  mode       String    @default("owner") // owner | bini
  linkedAt   DateTime  @default(now())
  lastSeen   DateTime  @default(now())
  revokedAt  DateTime?

  @@index([phoneKey])
}

// An agent is on for a business only while this row exists and is not disabled.
model AgentSwitch {
  id         String    @id @default(cuid())
  agent      String    // owner
  kind       String    // building
  entityId   String
  enabledAt  DateTime  @default(now())
  disabledAt DateTime?

  @@unique([agent, kind, entityId])
}
```

- [ ] **Step 4: Write `agents/owner/access.js`**

```js
'use strict';
// Who may use Bini for owners, and through which Telegram account (owner Bini design §3).
//
// Three facts, three tables: a number is approved for a business (OwnerAccess), a Telegram account proved it
// holds that number (OwnerTgLink), and the agent is switched on for the business (AgentSwitch). Access is the
// intersection, computed afresh for every message — a removed number or a switched-off building ends access
// on the next message, not at the next sign-in.
//
// Proof is Telegram's, never the user's word: a contact counts only when it is the sender's own account
// (contact.user_id === from.id), shared in a private chat, not forwarded.
const { phoneKey } = require('../../ride/phone');

const KINDS = ['building'];        // v1 is the building pack; shops, venues and hotels use the same rows later
const TOUCH_MS = 3600000;          // lastSeen written at most hourly

function limiter(max, windowMs, clock) {
  const hits = new Map();
  return key => {
    const t = clock().getTime();
    const list = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

function makeOwnerAccessStore(prisma) {
  const accessSelect = { id: true, kind: true, entityId: true, phoneKey: true, role: true, label: true };
  return {
    linkByTelegram: telegramId => prisma.ownerTgLink.findUnique({ where: { telegramId } }),
    linkById: id => prisma.ownerTgLink.findUnique({ where: { id } }),
    activeAccessByPhone: pk => prisma.ownerAccess.findMany({ where: { phoneKey: pk, revokedAt: null }, select: accessSelect }),
    accessForEntity: (kind, entityId) => prisma.ownerAccess.findMany({ where: { kind, entityId, revokedAt: null }, select: accessSelect }),
    enabledEntities: async (agent, kind, ids) =>
      (await prisma.agentSwitch.findMany({ where: { agent, kind, entityId: { in: ids }, disabledAt: null }, select: { entityId: true } })).map(r => r.entityId),
    upsertLink: ({ telegramId, chatId, phoneKey: pk, at }) => prisma.ownerTgLink.upsert({ where: { telegramId },
      create: { telegramId, chatId, phoneKey: pk, linkedAt: at, lastSeen: at },
      update: { chatId, phoneKey: pk, linkedAt: at, lastSeen: at, revokedAt: null, mode: 'owner' } }),
    revokeLink: (id, at) => prisma.ownerTgLink.update({ where: { id }, data: { revokedAt: at } }),
    touchLink: (id, at) => prisma.ownerTgLink.update({ where: { id }, data: { lastSeen: at } }),
    setMode: (id, mode) => prisma.ownerTgLink.update({ where: { id }, data: { mode } }),
    linksForPhones: pks => prisma.ownerTgLink.findMany({ where: { phoneKey: { in: pks } }, orderBy: { linkedAt: 'desc' }, take: 50 }),
  };
}

function makeOwnerAccess({ store, audit = () => {}, now = () => new Date(), limit }) {
  const allow = limit || limiter(5, 15 * 60000, now);
  const note = (buildingId, action, detail) => Promise.resolve().then(() => audit(buildingId, action, detail)).catch(() => {});
  const last4 = s => String(s || '').replace(/\D/g, '').slice(-4);

  async function buildingsFor(pk) {
    const rows = (await store.activeAccessByPhone(pk)).filter(r => KINDS.includes(r.kind));
    if (!rows.length) return [];
    const on = new Set(await store.enabledEntities('owner', 'building', [...new Set(rows.map(r => r.entityId))]));
    return [...new Set(rows.filter(r => on.has(r.entityId)).map(r => r.entityId))];
  }

  async function linkFromContact({ chat, from, contact, forwarded }) {
    if (!chat || chat.type !== 'private') return { ok: false, reason: 'not_private' };
    if (!from || !contact || forwarded || contact.user_id == null || String(contact.user_id) !== String(from.id))
      return { ok: false, reason: 'not_own_contact' };
    const telegramId = String(from.id);
    if (!allow(telegramId)) return { ok: false, reason: 'too_many' };
    const pk = phoneKey(contact.phone_number);
    const ids = pk ? await buildingsFor(pk) : [];
    if (!ids.length) return { ok: false, reason: 'not_registered' };    // never says which businesses exist
    const link = await store.upsertLink({ telegramId, chatId: String(chat.id), phoneKey: pk, at: now() });
    for (const id of ids) await note(id, 'OWNER_TG_LINKED', 'telegram …' + last4(telegramId) + ' · phone …' + last4(pk));
    return { ok: true, scope: { buildingIds: ids, mode: 'owner', linkId: link.id } };
  }

  async function scopeFor(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return null;
    const ids = await buildingsFor(link.phoneKey);
    if (!ids.length) return null;
    if (!link.lastSeen || now() - new Date(link.lastSeen) > TOUCH_MS) Promise.resolve(store.touchLink(link.id, now())).catch(() => {});
    return { buildingIds: ids, mode: link.mode === 'bini' ? 'bini' : 'owner', linkId: link.id };
  }

  async function unlink(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.revokeLink(link.id, now());
    for (const r of await store.activeAccessByPhone(link.phoneKey))
      await note(r.entityId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · signed out in Telegram');
    return true;
  }

  async function setMode(telegramId, mode) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.setMode(link.id, mode === 'bini' ? 'bini' : 'owner');
    return true;
  }

  // For the dashboard: the Telegram accounts currently holding one of this building's approved numbers.
  async function linksForBuilding(buildingId) {
    const rows = await store.accessForEntity('building', buildingId);
    const byPhone = new Map(rows.map(r => [r.phoneKey, r]));
    if (!byPhone.size) return [];
    return (await store.linksForPhones([...byPhone.keys()])).filter(l => !l.revokedAt).map(l => ({
      id: l.id, role: byPhone.get(l.phoneKey).role, label: byPhone.get(l.phoneKey).label || null,
      phoneLast4: last4(l.phoneKey), linkedAt: l.linkedAt, lastSeen: l.lastSeen, mode: l.mode }));
  }

  // Remove signs that Telegram account out. Only a link holding one of THIS building's numbers can be removed from
  // this building's dashboard. The number stays approved until ops revoke it (ops/owner/access.js).
  async function revokeForBuilding(buildingId, linkId) {
    const phones = new Set((await store.accessForEntity('building', buildingId)).map(r => r.phoneKey));
    const link = await store.linkById(String(linkId));
    if (!link || link.revokedAt || !phones.has(link.phoneKey)) return false;
    await store.revokeLink(link.id, now());
    await note(buildingId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · removed from the dashboard');
    return true;
  }

  return { linkFromContact, scopeFor, unlink, setMode, linksForBuilding, revokeForBuilding };
}

module.exports = { makeOwnerAccess, makeOwnerAccessStore, KINDS };
```

- [ ] **Step 5: Run the tests** — `node --test test/owner/access.test.js` → 8 PASS.

- [ ] **Step 6: Push the schema (additive) and prove the store against the real database**

```bash
cp prisma/schema.prisma prisma/schema.prisma.bak-ownertg-$(date +%Y%m%d-%H%M%S)
npx prisma db push --skip-generate 2>&1 | tail -5
npx prisma generate 2>&1 | tail -2
```
Expected: `Your database is now in sync with your Prisma schema.` with no data-loss warning (if Prisma warns about data loss, STOP — the change must be purely additive). Then a script in the repo dir, deleted after:

```js
// /var/www/connectcare/binasmart/_ownertg_check.js
const { PrismaClient } = require('@prisma/client');
const { makeOwnerAccessStore } = require('./agents/owner/access');
const p = new PrismaClient(); const s = makeOwnerAccessStore(p);
(async () => {
  console.log('link', await s.linkByTelegram('__none__'));
  console.log('access', (await s.activeAccessByPhone('ph:__none__')).length, (await s.accessForEntity('building', '__none__')).length);
  console.log('switch', (await s.enabledEntities('owner', 'building', ['__none__'])).length);
  console.log('links', (await s.linksForPhones(['ph:__none__'])).length);
  console.log('tables', await p.ownerAccess.count(), await p.ownerTgLink.count(), await p.agentSwitch.count());
  await p.$disconnect();
})();
```
Expected: `link null`, `access 0 0`, `switch 0`, `links 0`, `tables 0 0 0`.

- [ ] **Step 7: Restart, suite, commit** — `pm2 restart binasmart-api && sleep 6 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4210/owner` (200; the Prisma client changed). `npm test` → +8, 0 fail. Commit `prisma/schema.prisma agents/owner/access.js test/owner/access.test.js` — `Owner Bini: approved numbers, proven Telegram links and a per-building switch`.

---

### Task 2: The first message after linking

**Files:**
- Create: `agents/owner/health-report.js`
- Test: `test/owner/health-report.test.js`

- [ ] **Step 1: Confirm the `data_health` keys** — `node -e` in the repo: build the executor over `test/owner/fixture.js`'s `fakePrisma()` and print `Object.keys(result.buildings[0])`. Use exactly those names below; if any differ from the plan, adjust the formatter and the test together and say so.

- [ ] **Step 2: Write the failing test**

```js
'use strict';
// The first thing a newly linked owner reads: what BinaSmart knows about their building and what is missing,
// in Amharic and English, with no tenant names and no model involved.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { healthMessage } = require('../../agents/owner/health-report');

const health = over => ({ buildings: [Object.assign({ building: 'Test Plaza', buildingAm: 'ቴስት ፕላዛ', units: 71, activeTenancies: 71,
  invoices: 71, invoicesPaid: 0, rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 1, openRepairs: 2,
  contractsExpiredStillActive: 0, newestInvoice: '2026-07-05', newestPayment: null }, over)] });

test('it says what is recorded and what is missing, in both languages', () => {
  const m = healthMessage(health());
  assert.match(m, /ቴስት ፕላዛ/);
  assert.match(m, /71/);
  assert.match(m, /⚠️.*(2026-09, 2026-08)/);
  assert.match(m, /invoices/); assert.match(m, /ኢንቮይስ/);
  assert.match(m, /2026-07-05/);
  assert.match(m, /የለም · none|none/);
  assert.match(m, /\/bini/); assert.match(m, /\/logout/);
});

test('nothing missing means no warning lines', () => {
  const m = healthMessage(health({ invoicesPaid: 60, rentMonthsWithoutInvoices: [], expensesRecorded: 12, contractsExpiredStillActive: 0, newestPayment: '2026-09-07' }));
  assert.doesNotMatch(m, /⚠️/);
});

test('expired contracts are called out', () => {
  assert.match(healthMessage(health({ contractsExpiredStillActive: 14 })), /⚠️.*14/);
});

test('two buildings get two blocks', () => {
  const two = { buildings: [...health().buildings, ...health({ building: 'Second', buildingAm: null }).buildings] };
  const m = healthMessage(two);
  assert.equal((m.match(/🏢/g) || []).length, 2);
  assert.match(m, /Second/);
});

test('no result, or an error from the tools, gets a short apology instead of a broken message', () => {
  assert.match(healthMessage(null), /Sorry/);
  assert.match(healthMessage({ error: 'records unavailable' }), /Sorry/);
});
```

- [ ] **Step 3: Run and confirm failure**, then write `agents/owner/health-report.js`:

```js
'use strict';
// The first message after an owner links Telegram: what BinaSmart's records hold for each building and what is
// missing. Built from the data_health tool without a model — fixed wording, figures straight from the records,
// no tenant names — so a thin record reads as a to-do list, not as a quiet wrong answer later.
const none = v => (v == null || v === '' ? 'የለም · none' : v);

function block(b) {
  const lines = [
    '🏢 ' + (b.buildingAm ? b.buildingAm + ' · ' + b.building : b.building) + ' — ቢናስማርት የሚያውቀው · what BinaSmart knows',
    '✅ ክፍሎች ' + b.units + ' · ተከራዮች ' + b.activeTenancies + ' — units · tenants',
    (b.invoices ? '✅' : '⚠️') + ' ኢንቮይሶች ' + b.invoices + ' (የተከፈሉ ' + b.invoicesPaid + ') — invoices (marked paid)',
  ];
  if (b.invoices && !b.invoicesPaid) lines.push('⚠️ ምንም ክፍያ አልተመዘገበም — no payment has been recorded');
  if (b.rentMonthsWithoutInvoices && b.rentMonthsWithoutInvoices.length)
    lines.push('⚠️ የኪራይ ኢንቮይስ ያልወጣባቸው ወራት — months with no rent invoices: ' + b.rentMonthsWithoutInvoices.join(', '));
  if (b.contractsExpiredStillActive)
    lines.push('⚠️ ጊዜያቸው ያለፈ ውሎች (ተከራዩ አሁንም አለ) — expired contracts, tenant still in: ' + b.contractsExpiredStillActive);
  lines.push((b.expensesRecorded ? '✅' : '⚠️') + ' የተመዘገቡ ወጪዎች ' + b.expensesRecorded + ' — expenses recorded');
  lines.push('🔧 ክፍት ጥገና ' + (b.openRepairs || 0) + ' — open repairs');
  lines.push('📅 የመጨረሻው ኢንቮይስ ' + none(b.newestInvoice) + ' · የመጨረሻው ክፍያ ' + none(b.newestPayment) + ' — newest invoice due · newest payment');
  return lines.join('\n');
}

function healthMessage(result) {
  const bs = result && Array.isArray(result.buildings) ? result.buildings : [];
  if (!bs.length) return 'ይቅርታ፣ መዝገቡን አሁን ማንበብ አልቻልኩም። ጥያቄዎን ይጻፉ። · Sorry, I could not read the records just now. Ask me anything.';
  return bs.map(block).join('\n\n')
    + '\n\nስለ መዝገብዎ ይጠይቁ — ለምሳሌ «በዚህ ወር ስንት ተከፈለ?» · Ask about your records, e.g. "How much was paid this month?"'
    + '\n/bini — ቢኒ ለደንበኞች · customer Bini   /logout — ውጣ · sign out';
}

module.exports = { healthMessage };
```

How the tests line up with the formatter: in the first test `newestPayment: null` prints `የለም · none`; the "nothing missing" test sets `invoicesPaid: 60` so the "no payment has been recorded" warning does not fire, and every other ⚠️ condition is false.

- [ ] **Step 4: Run** — 5 PASS; `npm test` +5. Commit `agents/owner/health-report.js test/owner/health-report.test.js` — `Owner Bini: the records report an owner reads first`.

---

### Task 3: The bot's owner paths

**Files:**
- Modify: `ride/binaBot.js`, `ride/index.js`
- Test: `test/owner/telegram.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// @bina_smart_bot's owner paths, with a fake Telegram API and a fake owner service: nothing is sent anywhere.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBinaBot } = require('../../ride/binaBot');

function harness({ scope = null, link = { ok: true, scope: { buildingIds: ['b1'], mode: 'owner' } }, scopeThrows = false, withOwner = true } = {}) {
  const sent = [], calls = { bini: [], answer: [], link: [], unlink: [], mode: [], health: [] };
  const api = {
    sendMessage: async (chat, text, extra) => { sent.push({ chat, text, extra }); return { message_id: sent.length }; },
    sendChatAction: async () => true, answerCallbackQuery: async () => true,
    getFile: async () => ({ file_path: 'voice/1.oga' }), downloadFile: async () => Buffer.from('audio'),
  };
  const fetchImpl = async (url, init) => {
    if (/transcribe/.test(url)) return { json: async () => ({ ok: true, text: 'ስንት ክፍል ባዶ ነው?' }) };
    calls.bini.push(JSON.parse(init.body)); return { json: async () => ({ reply: 'customer bini' }) };
  };
  const owner = {
    access: {
      scopeFor: async id => { if (scopeThrows) throw new Error('db down'); return typeof scope === 'function' ? scope(id) : scope; },
      linkFromContact: async a => { calls.link.push(a); return link; },
      unlink: async id => { calls.unlink.push(String(id)); return true; },
      setMode: async (id, m) => { calls.mode.push([String(id), m]); return true; },
    },
    answer: async a => { calls.answer.push(a); return 'owner answer'; },
    health: async s => { calls.health.push(s); return 'HEALTH ' + s.buildingIds.join(','); },
  };
  const b = makeBinaBot({ api, baseUrl: 'https://bina.et', assistantUrl: 'http://127.0.0.1:4210/api/assistant', fetchImpl,
    botUsername: 'bina_smart_bot', internalKey: 'k', owner: withOwner ? owner : undefined });
  return { sent, calls, b };
}
const pm = (text, extra = {}) => ({ message: Object.assign({ chat: { id: 7, type: 'private' }, from: { id: 42, first_name: 'T' }, text }, extra) });
const gm = text => ({ message: { chat: { id: -100, type: 'group' }, from: { id: 42 }, text } });
const OWNER = { buildingIds: ['b1'], mode: 'owner' };

test('/start owner in a private chat asks for the phone with Telegram’s contact button', async () => {
  const { sent, b } = harness();
  await b.handleUpdate(pm('/start owner'));
  const kb = sent[0].extra.reply_markup.keyboard;
  assert.equal(kb[0][0].request_contact, true);
});

test('/start owner in a group does not offer linking', async () => {
  const { sent, b } = harness();
  await b.handleUpdate(gm('/start owner'));
  assert.equal(sent[0].extra.reply_markup.keyboard, undefined);
});

test('a shared contact is checked by the access rules and, when approved, answered with the records report', async () => {
  const { sent, calls, b } = harness();
  await b.handleUpdate(pm('', { contact: { phone_number: '+251900000001', user_id: 42 } }));
  assert.equal(calls.link.length, 1);
  assert.equal(calls.link[0].forwarded, false);
  assert.equal(calls.link[0].from.id, 42);
  assert.match(sent[0].text, /✅/);
  assert.match(sent[0].text, /HEALTH b1/);
  assert.equal(sent[0].extra.reply_markup.remove_keyboard, true);
});

test('a forwarded contact is passed on as forwarded', async () => {
  const { calls, b } = harness({ link: { ok: false, reason: 'not_own_contact' } });
  await b.handleUpdate(pm('', { contact: { phone_number: '+251900000001', user_id: 42 }, forward_origin: { type: 'user' } }));
  assert.equal(calls.link[0].forwarded, true);
});

test('refusals say only what the person needs', async () => {
  for (const [reason, re] of [['not_registered', /not registered/], ['too_many', /15 minutes/], ['not_own_contact', /own number/]]) {
    const { sent, b } = harness({ link: { ok: false, reason } });
    await b.handleUpdate(pm('', { contact: { phone_number: '+251900000001', user_id: 42 } }));
    assert.match(sent[0].text, re, reason);
  }
});

test('a linked owner’s private question goes to the owner agent, not customer Bini', async () => {
  const { sent, calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('How much was paid in July?'));
  assert.equal(calls.answer.length, 1);
  assert.deepEqual(calls.answer[0].scope, OWNER);
  assert.equal(calls.answer[0].text, 'How much was paid in July?');
  assert.equal(calls.bini.length, 0);
  assert.equal(sent[0].text, 'owner answer');
});

test('the same account in a group gets customer Bini and no owner data', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(gm('How much was paid in July?'));
  assert.equal(calls.answer.length, 0);
  assert.equal(calls.bini.length, 1);
});

test('in bini mode, or with no link, questions go to customer Bini', async () => {
  let h = harness({ scope: { buildingIds: ['b1'], mode: 'bini' } });
  await h.b.handleUpdate(pm('hello'));
  assert.equal(h.calls.answer.length, 0); assert.equal(h.calls.bini.length, 1);
  h = harness({ scope: null });
  await h.b.handleUpdate(pm('hello'));
  assert.equal(h.calls.bini.length, 1);
});

test('a failing access check falls back to customer Bini instead of breaking the bot', async () => {
  const { calls, b } = harness({ scopeThrows: true });
  await b.handleUpdate(pm('hello'));
  assert.equal(calls.bini.length, 1);
});

test('a voice note from a linked owner is transcribed and answered by the owner agent', async () => {
  const { calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('', { voice: { file_id: 'v1', duration: 5, mime_type: 'audio/ogg' } }));
  assert.equal(calls.answer.length, 1);
  assert.equal(calls.answer[0].text, 'ስንት ክፍል ባዶ ነው?');
  assert.equal(calls.bini.length, 0);
});

test('/logout, /bini and /owner change the link through the access rules', async () => {
  const { sent, calls, b } = harness({ scope: OWNER });
  await b.handleUpdate(pm('/bini'));
  await b.handleUpdate(pm('/owner'));
  await b.handleUpdate(pm('/logout'));
  assert.deepEqual(calls.mode, [['42', 'bini'], ['42', 'owner']]);
  assert.deepEqual(calls.unlink, ['42']);
  assert.equal(sent.length, 3);
});

test('without an owner service the bot behaves exactly as before', async () => {
  const { calls, sent, b } = harness({ withOwner: false });
  await b.handleUpdate(pm('/start owner'));
  assert.equal(sent[0].extra.reply_markup.keyboard, undefined, 'no contact button without the owner service');
  await b.handleUpdate(pm('How much was paid?'));
  assert.equal(calls.bini.length, 1);
});
```

- [ ] **Step 2: Run and confirm failure** — `node --test test/owner/telegram.test.js`: the owner tests fail (no contact button, no routing). Also run `node --test test/binaBot.test.js` and note it passes; it must still pass unchanged after Step 3.

- [ ] **Step 3: Patch `ride/binaBot.js`**

```python
# /tmp/p3t3.py
import io, shutil, time
p = '/var/www/connectcare/binasmart/ride/binaBot.js'
shutil.copy(p, p + '.bak-ownertg-' + time.strftime('%Y%m%d-%H%M%S'))
s = io.open(p, encoding='utf-8').read()

def sub(old, new, why):
    global s
    assert s.count(old) == 1, why + ': %d matches' % s.count(old)
    s = s.replace(old, new, 1)
    print('  ok  ' + why)

sub("function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey }) {",
    "function makeBinaBot({ api, baseUrl, assistantUrl, fetchImpl, now, botUsername, linkShop, internalKey, owner }) {",
    'owner dependency accepted')

sub("  function turns(chatId) {",
    """  // ---- Bini for owners (owner Bini design §3). owner = { access, answer, health } from server.js; absent = off. ----
  // Only ever in a private chat: tenants' names and money never go where others can read them.
  const OWNER_START = '🏢 ቢኒ ለባለቤቶች · Bini for owners\\n\\nየተመዘገበውን ስልክ ቁጥርዎን ለማረጋገጥ ከታች «📱 ስልኬን አጋራ»ን ይጫኑ። ቴሌግራም ቁጥሩ የእርስዎ መሆኑን ያረጋግጣል።\\nTap "📱 Share my phone" below. Telegram confirms the number is yours.';
  const SHARE_KB = { keyboard: [[{ text: '📱 ስልኬን አጋራ · Share my phone', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };
  const NO_KB = { remove_keyboard: true };
  const NOT_LINKED = 'ከቢኒ ለባለቤቶች ጋር አልተገናኙም። ከባለቤት ዳሽቦርዱ «Connect Telegram»ን ይጫኑ። · You are not linked to Bini for owners. Use "Connect Telegram" in the owner dashboard.';
  const REFUSAL = {
    not_registered: 'ይህ ቁጥር ለማንኛውም ንግድ አልተመዘገበም። · This number is not registered for any business.',
    too_many: 'ብዙ ሙከራዎች ተደርገዋል፤ ከ15 ደቂቃ በኋላ እንደገና ይሞክሩ። · Too many attempts — try again in 15 minutes.',
    not_own_contact: 'እባክዎ የራስዎን ቁጥር በ«📱 ስልኬን አጋራ» ቁልፍ ያጋሩ። · Please share your own number with the button.',
    not_private: 'ይህን በግል ቻት ብቻ ያድርጉ። · Please do this in a private chat with the bot.',
  };
  const isPrivate = msg => !!(msg && msg.chat && msg.chat.type === 'private');

  async function ownerScopeFor(msg) {
    if (!owner || !isPrivate(msg) || !msg.from) return null;
    const s = await owner.access.scopeFor(msg.from.id).catch(e => { console.error('[binaBot] owner scope: ' + e.message); return null; });
    return s && s.mode === 'owner' ? s : null;
  }

  async function answerOwner(chatId, text, from, scope) {
    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});
    const reply = await owner.answer({ text: text.slice(0, 1200), from, chatId, scope })
      .catch(e => { console.error('[binaBot] owner answer: ' + e.message); return null; });
    if (!reply) return api.sendMessage(chatId, 'ቢኒ ትንሽ ተጠምዷል፣ እባክዎ በደቂቃ ውስጥ እንደገና ይሞክሩ። · Bini is busy — please try again in a minute.');
    return api.sendMessage(chatId, forTelegram(reply), { disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '🏢 ዳሽቦርድ · Dashboard', url: baseUrl + '/owner' }]] } });
  }

  async function linkOwner(chatId, msg) {
    let r;
    try {
      r = await owner.access.linkFromContact({ chat: msg.chat, from: msg.from, contact: msg.contact,
        forwarded: !!(msg.forward_origin || msg.forward_from || msg.forward_date) });
    } catch (e) {
      console.error('[binaBot] owner link: ' + e.message);
      return api.sendMessage(chatId, 'ይቅርታ፣ አሁን ማገናኘት አልተቻለም። · Sorry, linking failed just now.', { reply_markup: NO_KB });
    }
    if (!r || !r.ok) return api.sendMessage(chatId, REFUSAL[(r && r.reason) || 'not_registered'] || REFUSAL.not_registered, { reply_markup: NO_KB });
    const report = await owner.health(r.scope).catch(() => null);
    return api.sendMessage(chatId, '✅ ተገናኝቷል · Linked\\n\\n' + (report || ''), { reply_markup: NO_KB });
  }

  async function handleOwnerCommand(chatId, msg, text) {
    if (/^\\/start\\s+owner\\b/.test(text)) return api.sendMessage(chatId, OWNER_START, { reply_markup: SHARE_KB });
    if (msg.contact) return linkOwner(chatId, msg);
    if (/^\\/logout\\b/.test(text)) {
      const done = await owner.access.unlink(msg.from.id).catch(() => false);
      return api.sendMessage(chatId, done ? 'ከቢኒ ለባለቤቶች ወጥተዋል። · Signed out of Bini for owners.' : NOT_LINKED, { reply_markup: NO_KB });
    }
    const m = /^\\/(bini|owner)\\b/.exec(text);
    if (m) {
      const done = await owner.access.setMode(msg.from.id, m[1]).catch(() => false);
      if (!done) return api.sendMessage(chatId, NOT_LINKED);
      return api.sendMessage(chatId, m[1] === 'bini'
        ? 'ቢኒ ለደንበኞች ተመልሷል። ወደ ባለቤት ቢኒ ለመመለስ /owner ይጻፉ። · Customer Bini is back. Type /owner to return to Bini for owners.'
        : '🏢 ቢኒ ለባለቤቶች ተመልሷል። · Bini for owners is back.');
    }
    return undefined;
  }

  function turns(chatId) {""",
    'owner helpers')

# voice: an owner's transcript goes to the owner agent
sub("      const reply = await askBini(chatId, text.slice(0, 1200), msg.from);\n      // No transcript echo",
    "      const ownerScope = await ownerScopeFor(msg);\n      if (ownerScope) return answerOwner(chatId, text, msg.from, ownerScope);\n      const reply = await askBini(chatId, text.slice(0, 1200), msg.from);\n      // No transcript echo",
    'voice notes from a linked owner')

# commands and contact, before the shop/ticket deep links
sub("    const sl = /^\\/start\\s+shop_([A-Za-z0-9]+)\\b/.exec(text);",
    "    if (owner && isPrivate(msg) && msg.from) {\n      const handled = await handleOwnerCommand(chatId, msg, text);\n      if (handled !== undefined) return handled;\n    }\n    const sl = /^\\/start\\s+shop_([A-Za-z0-9]+)\\b/.exec(text);",
    'owner commands and contact')

# typed questions
sub("    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});\n    const reply = await askBini(chatId, text.slice(0, 1200), msg.from);",
    "    const ownerScope = await ownerScopeFor(msg);\n    if (ownerScope) return answerOwner(chatId, text, msg.from, ownerScope);\n    if (api.sendChatAction) api.sendChatAction(chatId, 'typing').catch(() => {});\n    const reply = await askBini(chatId, text.slice(0, 1200), msg.from);",
    'typed questions from a linked owner')

io.open(p, 'w', encoding='utf-8').write(s)
import subprocess
r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
print(r.stderr.strip()[:300] or 'node --check clean')
```

Note: `handleOwnerCommand` returns `undefined` for anything that is not an owner command, and a truthy promise result otherwise; `api.sendMessage` resolves to an object in production and in tests, so `handled !== undefined` is reliable. A contact message from a non-private chat falls through to the existing welcome path, as before.

Then in `ride/index.js`:

```python
# /tmp/p3t3b.py
import io, shutil, time
p = '/var/www/connectcare/binasmart/ride/index.js'
shutil.copy(p, p + '.bak-ownertg-' + time.strftime('%Y%m%d-%H%M%S'))
s = io.open(p, encoding='utf-8').read()
old = "    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant', internalKey: deps.OWNER_KEY });"
new = ("    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant', internalKey: deps.OWNER_KEY,\n"
       "    owner: deps.ownerTelegram || null });   // Bini for owners (agents/owner/access.js); absent = off")
assert s.count(old) == 1
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('ok')
```

- [ ] **Step 4: Run** — `node --test test/owner/telegram.test.js test/binaBot.test.js` → telegram 12 PASS; binaBot unchanged and passing. `npm test` → +12, 0 fail.

- [ ] **Step 5: Commit** `ride/binaBot.js ride/index.js test/owner/telegram.test.js` — `@bina_smart_bot: owners link by Share-my-phone and get Bini for owners in private`. No restart yet: `deps.ownerTelegram` is not passed until Task 4, so the live bot behaves as before (`owner` is `null`).

---

### Task 4: Server wiring, dashboard card and live checks

**Files:**
- Modify: `server.js`, `public/owner.html`, `test/kit/wiring.test.js`

- [ ] **Step 1: Add the failing wiring tests** (append to `test/kit/wiring.test.js`)

```js
test('Bini for owners on Telegram answers through the same agent, with the scope from the access rules', () => {
  const at = src.indexOf('const ownerTelegram = {');
  assert.ok(at > 0, 'ownerTelegram not built');
  const block = src.slice(at, src.indexOf('\n};', at));
  assert.match(block, /runAgent\(ownerAgent, req, res, \{ scope, channel: 'owner-telegram' \}\)/);
  assert.match(block, /healthMessage\(/);
  assert.ok(src.indexOf('const ownerTelegram = {') < src.indexOf("require('./ride')(fastify"), 'must exist before the ride module mounts');
  const ride = src.slice(src.indexOf("require('./ride')(fastify"), src.indexOf('});', src.indexOf("require('./ride')(fastify")));
  assert.match(ride, /ownerTelegram/);
});

test('the dashboard Telegram routes authenticate first and remove only through the building check', () => {
  for (const sig of ["fastify.get('/api/owner/:slug/telegram-links'", "fastify.post('/api/owner/:slug/telegram-links/:id/remove'"]) {
    const at = src.indexOf(sig);
    assert.ok(at > 0, sig + ' missing');
    const body = src.slice(at, src.indexOf('\n});', at));
    assert.ok(body.indexOf('authBuildingFail(req, reply, req.params.slug)') > 0, sig + ' must authenticate');
  }
  const rm = src.slice(src.indexOf("fastify.post('/api/owner/:slug/telegram-links/:id/remove'"));
  assert.match(rm.slice(0, 600), /ownerAccess\.revokeForBuilding\(b\.id, req\.params\.id\)/);
});
```

Run → both FAIL.

- [ ] **Step 2: Patch `server.js`**

```python
# /tmp/p3t4.py
import io, shutil, subprocess, time
p = '/var/www/connectcare/binasmart/server.js'
shutil.copy(p, p + '.bak-ownertg-' + time.strftime('%Y%m%d-%H%M%S'))
s = io.open(p, encoding='utf-8').read()

def sub(old, new, why):
    global s
    assert s.count(old) == 1, why + ': %d matches' % s.count(old)
    s = s.replace(old, new, 1)
    print('  ok  ' + why)

route_end = "  return runAgent(ownerAgent, req, reply, { scope: { buildingIds: [b.id] }, channel: 'owner-web' });\n});\n"
sub(route_end, route_end + """
// ===== Bini for owners on Telegram (owner Bini design §3) =====
// @bina_smart_bot links an owner by Share-my-phone (agents/owner/access.js) and answers through the same agent as
// the dashboard. The scope is re-read from OwnerAccess × AgentSwitch on every message.
const { makeOwnerAccess, makeOwnerAccessStore } = require('./agents/owner/access');
const { healthMessage } = require('./agents/owner/health-report');
const ownerAccess = makeOwnerAccess({ store: makeOwnerAccessStore(prisma), audit });
const ownerTelegram = {
  access: ownerAccess,
  async answer({ text, from, chatId, scope }) {
    const req = { body: { message: text, user: { telegramId: String(from && from.id) } }, headers: {}, ip: 'tg-' + chatId, log: fastify.log };
    const res = { code() { return this; }, send(o) { return o; } };
    const out = await runAgent(ownerAgent, req, res, { scope, channel: 'owner-telegram' });
    return out && out.reply ? String(out.reply) : null;
  },
  async health(scope) {
    return healthMessage(await require('./agents/owner/tools/building').makeExecutor({ prisma })(scope)('data_health', {}));
  },
};

// The dashboard's view of those links. Remove signs one Telegram account out; the number stays approved until
// ops revoke it (ops/owner/access.js revoke).
fastify.get('/api/owner/:slug/telegram-links', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  const on = await prisma.agentSwitch.findFirst({ where: { agent: 'owner', kind: 'building', entityId: b.id, disabledAt: null }, select: { id: true } });
  return { enabled: !!on, bot: 'https://t.me/' + (process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot') + '?start=owner',
    links: await ownerAccess.linksForBuilding(b.id) };
});
fastify.post('/api/owner/:slug/telegram-links/:id/remove', async (req, reply) => {
  if (await authBuildingFail(req, reply, req.params.slug)) return;
  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });
  if (!b) return reply.code(404).send({ error: 'not_found' });
  if (!(await ownerAccess.revokeForBuilding(b.id, req.params.id))) return reply.code(404).send({ error: 'not_found' });
  return { ok: true };
});
""", 'ownerTelegram and the dashboard Telegram routes')

sub("  askBini: callBini, // Bini's LLM adapter, for /api/ride/intent (Ask Bini)\n",
    "  askBini: callBini, // Bini's LLM adapter, for /api/ride/intent (Ask Bini)\n  ownerTelegram, // Bini for owners in @bina_smart_bot (agents/owner/access.js)\n",
    'ride module receives ownerTelegram')

io.open(p, 'w', encoding='utf-8').write(s)
r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
print(r.stderr.strip()[:300] or 'node --check clean')
```

Before running, confirm with `grep -n` that `route_end` matches the live owner route (Plan 2 Task 5) and the `askBini: callBini` line in the ride mount; after running, read the diff.

- [ ] **Step 3: Patch `public/owner.html`** (Settings card)

```python
# /tmp/p3t4b.py
import io, shutil, time
p = '/var/www/connectcare/binasmart/public/owner.html'
shutil.copy(p, p + '.bak-ownertg-' + time.strftime('%Y%m%d-%H%M%S'))
s = io.open(p, encoding='utf-8').read()

def sub(old, new, why):
    global s
    assert s.count(old) == 1, why + ': %d matches' % s.count(old)
    s = s.replace(old, new, 1)
    print('  ok  ' + why)

sub("""    <div class="card p-4 space-y-2">
      <div class="font-black text-sm mb-1">🔗 Links</div>""",
    """    <div id="tg-links" class="card p-4"><div class="text-[11px] text-slate-400">✈️ Bini on Telegram…</div></div>
    <div class="card p-4 space-y-2">
      <div class="font-black text-sm mb-1">🔗 Links</div>""",
    'Telegram card placeholder in Settings')

old_end = """    <div class="text-center text-[10px] text-slate-400">Support: <a class="font-bold text-violet" href="https://wa.me/251911244344">WhatsApp +251 911 244 344</a></div>`;
  }"""
sub(old_end, old_end.replace("`;\n  }", "`;\n    loadTgLinks();\n  }"), 'load the card when Settings opens')

sub("async function vatSettings(){", """// Bini for owners on Telegram: the building's linked accounts, with Remove (signs that account out).
async function loadTgLinks(){
  const box = document.getElementById('tg-links'); if (!box) return;
  try {
    const r = await kfetch('/api/owner/' + slug + '/telegram-links'); if (!r.ok) { box.innerHTML = ''; return; }
    const d = await r.json();
    const head = '<div class="font-black text-sm mb-2">✈️ Bini on Telegram · ቢኒ በቴሌግራም</div>';
    const connect = d.enabled
      ? '<a class="mbtn w-full block text-center" style="background:#e0f2fe;color:#0369a1;padding:10px" href="' + esc(d.bot) + '" target="_blank" rel="noopener">📱 Connect Telegram · ቴሌግራም ያገናኙ</a>'
      : '<div class="text-[11px] text-slate-500">Not switched on for this building yet — ask BinaSmart. · ለዚህ ህንፃ ገና አልተከፈተም።</div>';
    const rows = (d.links || []).map(function (l) {
      return '<div class="flex justify-between items-center text-[11px] py-1 border-b" style="border-color:#e9f0ee"><span>'
        + esc(l.role) + (l.label ? ' · ' + esc(l.label) : '') + ' · …' + esc(l.phoneLast4) + ' · ' + esc(new Date(l.lastSeen).toLocaleDateString('en-GB'))
        + '</span><button class="mbtn" style="background:#fee2e2;color:#dc2626" onclick="removeTgLink(\\'' + jsq(l.id) + '\\')">Remove</button></div>';
    }).join('');
    box.innerHTML = head + connect + (rows || '<div class="text-[11px] text-slate-500 mt-2">No Telegram account linked. · ምንም የተገናኘ የለም።</div>');
  } catch (e) { box.innerHTML = ''; }
}
async function removeTgLink(id){
  if (!confirm('Sign this Telegram account out of Bini for owners?')) return;
  await kfetch('/api/owner/' + slug + '/telegram-links/' + encodeURIComponent(id) + '/remove', { method: 'POST' });
  loadTgLinks();
}
async function vatSettings(){""", 'loadTgLinks and removeTgLink')

io.open(p, 'w', encoding='utf-8').write(s)
```

Confirm `test/owner-dashboard-escape.test.js` still passes (every interpolation in owner.html escaped): run it. If it flags the new lines, the fix is in the new code, not the test.

- [ ] **Step 4: Tests** — `node --test test/kit/wiring.test.js test/owner-dashboard-escape.test.js && npm test 2>&1 | grep -E '^# (pass|fail)'` → +2, 0 fail.

- [ ] **Step 5: Deploy and live checks (no Telegram message is sent)**

```bash
pm2 restart binasmart-api && sleep 6
curl -s -o /dev/null -w 'owner %{http_code}\n' http://127.0.0.1:4210/owner
pm2 logs binasmart-api --lines 40 --nostream | grep -iE 'error|TypeError|ride\] BinaSmart Ride module mounted' | tail -3
```

`/tmp/p3-check.js` (repo dir `node /tmp/p3-check.js`; not committed; removed after). It exercises the real access rules and the real dashboard routes on the demo building `century-mall`, with a fake phone and a fake Telegram id, and deletes everything it created:

```js
'use strict';
const R = '/var/www/connectcare/binasmart/';
const { PrismaClient } = require(R + 'node_modules/@prisma/client');
const { makeOwnerAccess, makeOwnerAccessStore } = require(R + 'agents/owner/access');
const { makeOwnerKeys, hashKey } = require(R + 'building/ownerKeys');
const { phoneKey } = require(R + 'ride/phone');
const p = new PrismaClient();
const SLUG = 'century-mall', OTHER = 'edna-mall', BASE = 'http://127.0.0.1:4210', PHONE = '0900000071', TG = '990000071';
const get = (slug, key, path = '') => fetch(BASE + '/api/owner/' + slug + '/telegram-links' + path, { headers: key ? { 'x-owner-key': key } : {} });
const post = (slug, key, path) => fetch(BASE + '/api/owner/' + slug + '/telegram-links' + path, { method: 'POST', headers: key ? { 'x-owner-key': key } : {} });

(async () => {
  const started = new Date();
  const b = await p.building.findUnique({ where: { qrSlug: SLUG }, select: { id: true } });
  const pk = phoneKey(PHONE);
  let key = null;
  try {
    const acc = await p.ownerAccess.create({ data: { kind: 'building', entityId: b.id, phoneKey: pk, role: 'staff', label: 'plan3-check', addedBy: 'ops' } });
    const access = makeOwnerAccess({ store: makeOwnerAccessStore(p), audit: async () => {} });
    const chat = { id: Number(TG), type: 'private' }, from = { id: Number(TG) };
    const contact = { phone_number: '+251' + PHONE.slice(1), user_id: Number(TG) };
    console.log('switch off  ', (await access.linkFromContact({ chat, from, contact, forwarded: false })).reason, '(want not_registered)');
    await p.agentSwitch.create({ data: { agent: 'owner', kind: 'building', entityId: b.id } });
    const linked = await access.linkFromContact({ chat, from, contact, forwarded: false });
    console.log('linked      ', linked.ok, JSON.stringify(linked.scope && linked.scope.buildingIds) === JSON.stringify([b.id]));
    console.log('scope       ', !!(await access.scopeFor(TG)));
    key = await makeOwnerKeys({ prisma: p }).issue(b.id, SLUG, 'plan3-check');
    console.log('no key      ', (await get(SLUG, null)).status, '(want 401)');
    console.log('other bldg  ', (await get(OTHER, key)).status, '(want 401)');
    const list = await (await get(SLUG, key)).json();
    const mine = (list.links || []).find(l => l.label === 'plan3-check');
    console.log('listed      ', list.enabled === true, !!mine, mine && mine.phoneLast4 === PHONE.slice(-4), JSON.stringify(list).includes(PHONE) === false);
    console.log('remove wrong', (await post(SLUG, key, '/nope/remove')).status, '(want 404)');
    console.log('remove other', (await post(OTHER, key, '/' + mine.id + '/remove')).status, '(want 401)');
    console.log('remove      ', (await post(SLUG, key, '/' + mine.id + '/remove')).status, '(want 200)');
    console.log('scope after ', await access.scopeFor(TG), '(want null)');
    await access.linkFromContact({ chat, from, contact, forwarded: false });
    await p.ownerAccess.update({ where: { id: acc.id }, data: { revokedAt: new Date() } });
    console.log('number revoked → scope', await access.scopeFor(TG), '(want null)');
  } finally {
    await p.ownerTgLink.deleteMany({ where: { telegramId: TG } });
    await p.ownerAccess.deleteMany({ where: { phoneKey: pk, label: 'plan3-check' } });
    await p.agentSwitch.deleteMany({ where: { agent: 'owner', kind: 'building', entityId: b.id, enabledAt: { gte: started } } });
    if (key) await p.ownerKey.deleteMany({ where: { keyHash: hashKey(key) } });
    await p.auditLog.deleteMany({ where: { buildingId: b.id, createdAt: { gte: started }, action: { in: ['OWNER_TG_LINKED', 'OWNER_TG_UNLINKED'] } } });
    console.log('cleaned     ', await p.ownerTgLink.count({ where: { telegramId: TG } }), await p.ownerAccess.count({ where: { phoneKey: pk } }),
      await p.agentSwitch.count({ where: { entityId: b.id, agent: 'owner' } }));
    await p.$disconnect();
  }
})();
```

Expected: `not_registered`; `true true`; `true`; `401`; `401`; `true true true true`; `404`; `401`; `200`; `null`; `null`; `cleaned 0 0 0`. (If `century-mall` already had an owner `AgentSwitch` from elsewhere, the cleanup's `enabledAt >= started` keeps it — there is none today.)

The card is not opened in a browser in this plan — that would need an owner key in a URL. The escape test covers the new markup, and Ibrahim sees the card in Plan 4.

If anything fails: restore the three `.bak-ownertg-*` files, restart, confirm 200, report.

- [ ] **Step 6: Commit** `server.js public/owner.html test/kit/wiring.test.js` — `Bini for owners on Telegram: server wiring and the dashboard card` + paragraph with the check results. Push.

---

### Task 5: Ops command for approved numbers and the switch

**Files:**
- Create: `ops/owner/access.js`

- [ ] **Step 1: Write `ops/owner/access.js`**

```js
'use strict';
// Approve who may use Bini for owners on a building, and switch it on or off. Run on the server only.
//
//   node ops/owner/access.js list    <slug>
//   node ops/owner/access.js add     <slug> <phone> <owner|staff> [label]
//   node ops/owner/access.js revoke  <slug> <accessId>
//   node ops/owner/access.js enable  <slug>
//   node ops/owner/access.js disable <slug>
//
// A phone is stored as its phoneKey; output shows the last four digits only. Every change is written to the
// building's audit log (actor ops). Revoking a number ends access on that number's next message; its Telegram
// links are revoked too, so linking again needs a fresh Share-my-phone.
const { PrismaClient } = require('@prisma/client');
const { phoneKey } = require('../../ride/phone');
const p = new PrismaClient();
const last4 = s => String(s || '').replace(/\D/g, '').slice(-4);
const log = (buildingId, action, detail) => p.auditLog.create({ data: { buildingId, actor: 'ops', action, detail: String(detail).slice(0, 200) } });

async function main([cmd, slug, a, b, ...rest]) {
  const bld = slug && await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true, name: true } });
  if (!bld) throw new Error('usage: list|add|revoke|enable|disable <slug> … (building not found)');
  if (cmd === 'list') {
    const on = await p.agentSwitch.findFirst({ where: { agent: 'owner', kind: 'building', entityId: bld.id, disabledAt: null } });
    console.log(bld.name + ' · Bini for owners ' + (on ? 'ON since ' + on.enabledAt.toISOString().slice(0, 10) : 'OFF'));
    const rows = await p.ownerAccess.findMany({ where: { kind: 'building', entityId: bld.id }, orderBy: { createdAt: 'asc' } });
    for (const r of rows) {
      const links = await p.ownerTgLink.count({ where: { phoneKey: r.phoneKey, revokedAt: null } });
      console.log('  ' + r.id + ' · ' + r.role + (r.label ? ' (' + r.label + ')' : '') + ' · …' + last4(r.phoneKey)
        + (r.revokedAt ? ' · REVOKED ' + r.revokedAt.toISOString().slice(0, 10) : '') + ' · telegram links ' + links);
    }
    return;
  }
  if (cmd === 'add') {
    const pk = phoneKey(a);
    if (!pk) throw new Error('not a phone number');
    if (!['owner', 'staff'].includes(b)) throw new Error('role must be owner or staff');
    const dup = await p.ownerAccess.findFirst({ where: { kind: 'building', entityId: bld.id, phoneKey: pk, revokedAt: null } });
    if (dup) { console.log('already approved: ' + dup.id); return; }
    const r = await p.ownerAccess.create({ data: { kind: 'building', entityId: bld.id, phoneKey: pk, role: b, label: rest.join(' ') || null, addedBy: 'ops' } });
    await log(bld.id, 'OWNER_ACCESS_ADDED', b + ' · phone …' + last4(pk));
    console.log('added ' + r.id + ' · ' + b + ' · …' + last4(pk));
    return;
  }
  if (cmd === 'revoke') {
    const r = await p.ownerAccess.findFirst({ where: { id: a, kind: 'building', entityId: bld.id, revokedAt: null } });
    if (!r) throw new Error('no active approval ' + a + ' on ' + slug);
    const at = new Date();
    await p.ownerAccess.update({ where: { id: r.id }, data: { revokedAt: at } });
    const still = await p.ownerAccess.count({ where: { phoneKey: r.phoneKey, revokedAt: null } });
    const cut = still ? 0 : (await p.ownerTgLink.updateMany({ where: { phoneKey: r.phoneKey, revokedAt: null }, data: { revokedAt: at } })).count;
    await log(bld.id, 'OWNER_ACCESS_REVOKED', r.role + ' · phone …' + last4(r.phoneKey) + ' · telegram links signed out ' + cut);
    console.log('revoked ' + r.id + ' · telegram links signed out ' + cut + (still ? ' (the number is still approved elsewhere)' : ''));
    return;
  }
  if (cmd === 'enable' || cmd === 'disable') {
    const on = cmd === 'enable';
    await p.agentSwitch.upsert({ where: { agent_kind_entityId: { agent: 'owner', kind: 'building', entityId: bld.id } },
      create: { agent: 'owner', kind: 'building', entityId: bld.id, disabledAt: on ? null : new Date() },
      update: on ? { enabledAt: new Date(), disabledAt: null } : { disabledAt: new Date() } });
    await log(bld.id, on ? 'OWNER_BINI_ENABLED' : 'OWNER_BINI_DISABLED', 'Bini for owners ' + (on ? 'on' : 'off'));
    console.log(bld.name + ' · Bini for owners ' + (on ? 'ON' : 'OFF'));
    return;
  }
  throw new Error('unknown command ' + cmd);
}

main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
```

Note: `agent_kind_entityId` is Prisma's generated name for `@@unique([agent, kind, entityId])` — confirm it in the generated client (`grep -o 'agent_kind_entityId' node_modules/.prisma/client/index.d.ts | head -1`); adjust if Prisma named it differently.

- [ ] **Step 2: Exercise it on the demo building, then clean up**

```bash
node ops/owner/access.js list century-mall
node ops/owner/access.js add century-mall 0900000072 staff plan3-ops-check
node ops/owner/access.js enable century-mall
node ops/owner/access.js list century-mall
node ops/owner/access.js revoke century-mall <the id printed by add>
node ops/owner/access.js disable century-mall
node ops/owner/access.js list century-mall
node ops/owner/access.js add century-mall "not a phone" staff ; echo "exit $?"
node ops/owner/access.js list no-such-building ; echo "exit $?"
```
Expected: OFF → added (…0072) → ON → listed with `telegram links 0` → revoked → OFF → the revoked row shown as REVOKED → `not a phone number` exit 1 → usage error exit 1. Then remove what the check created with `/tmp/p3-ops-clean.js` (run from the repo dir, deleted after):

```js
const { PrismaClient } = require('/var/www/connectcare/binasmart/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const b = await p.building.findUnique({ where: { qrSlug: 'century-mall' }, select: { id: true } });
  const since = new Date(Date.now() - 3600000);
  const a = await p.ownerAccess.deleteMany({ where: { kind: 'building', entityId: b.id, label: 'plan3-ops-check' } });
  const w = await p.agentSwitch.deleteMany({ where: { agent: 'owner', kind: 'building', entityId: b.id } });
  const l = await p.auditLog.deleteMany({ where: { buildingId: b.id, createdAt: { gte: since },
    action: { in: ['OWNER_ACCESS_ADDED', 'OWNER_ACCESS_REVOKED', 'OWNER_BINI_ENABLED', 'OWNER_BINI_DISABLED'] } } });
  console.log('deleted', a.count, w.count, l.count, '· left', await p.ownerAccess.count({ where: { entityId: b.id } }), await p.agentSwitch.count({ where: { entityId: b.id } }));
  await p.$disconnect();
})();
```
Expected `deleted 1 1 4 · left 0 0`.

- [ ] **Step 3: Commit** `ops/owner/access.js` — `Owner Bini: ops command for approved numbers and the per-building switch`. Push.

---

### Task 6: Close out

- [ ] `npm test` → 675 + 8 + 5 + 12 + 2 = **702 pass, 0 fail** (use the deltas if the baseline moved).
- [ ] `git status --short | grep -v '^??' | grep -v broadcast-am-fbcomment` → empty; `node ops/owner/access.js list darulle` is **not** run here (Plan 4 decides Darulle's rows with Ibrahim).
- [ ] Report to Ibrahim: how linking works now, what the dashboard shows, the check results, and what Plan 4 needs from him — his own Telegram number for the demo-building test, and a go for adding Darulle's two numbers and switching Darulle on.

---

## Self-review

- **Design §3 coverage:** Share-my-phone with `contact.user_id === from.id`, private chat, not forwarded (Tasks 1, 3); neutral refusal that never names a business (Tasks 1, 3); `OwnerAccess`/`OwnerTgLink`/`AgentSwitch` as designed (Task 1); scope re-read every message, revocation effective on the next message (Tasks 1, 4); private chats only; owner by default, `/bini` and `/owner` (Task 3); `/logout` and the dashboard list with Remove (Tasks 3, 4); audit of link and unlink with last-four digits (Tasks 1, 5); attempt limit (Task 1); webhook secret already enforced on `/api/tg/rider` (unchanged). The data health report as the first message (Task 2).
- **Deviation recorded:** design §3.3 said "each question writes to auditLog"; that is already done by the owner agent's `audit` with channel `owner-telegram` (Plan 2). Approved numbers are managed by ops only in v1 (design open point 4); the dashboard can sign a Telegram account out but not add or revoke numbers.
- **Known limit stated in code and report:** dashboard Remove signs an account out; the person can link again while their number stays approved — revoking the number is `ops/owner/access.js revoke`.
- **No placeholders; names consistent:** `makeOwnerAccess`, `makeOwnerAccessStore`, `linkFromContact`, `scopeFor`, `unlink`, `setMode`, `linksForBuilding`, `revokeForBuilding`, `healthMessage`, `ownerTelegram { access, answer, health }`, channel `owner-telegram`, audit actions `OWNER_TG_LINKED OWNER_TG_UNLINKED OWNER_ACCESS_ADDED OWNER_ACCESS_REVOKED OWNER_BINI_ENABLED OWNER_BINI_DISABLED`.
