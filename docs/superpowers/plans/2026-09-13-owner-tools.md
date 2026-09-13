# Owner Tools Implementation Plan (Plan 2 of 4 — owner Bini)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A building owner asks Bini a question in the web dashboard and gets an answer read from their own records, through read-only tools that can only see their buildings, with every figure traceable and the records' date stated.

**Architecture:** The agent engine from Plan 1 gains a tool round (the model calls read-only tools; their results feed the figure check), an optional scope passed in by the route, and an audit hook in place of the chat log. A new agent `agents/owner/` holds a public `SOUL.md`, `rules.js`, a scoped data loader whose `select` clauses are the privacy allowlist, and a building tool pack of ten pure functions. `/api/owner/:slug/ai` — today a one-paragraph summary — is rebuilt on the engine with the scope taken from the owner key.

**Tech Stack:** Node 22, Fastify 5, Prisma, `node:test`. Model adapter `callBini`, which already supports OpenAI-style tools: `opts = { tools, execute(name, args) }`, up to five rounds, and a no-tools fallback to GLM when the cloud model fails.

**Design:** `docs/superpowers/specs/2026-09-13-owner-bini-design.md` §2 and §3.4. **Not in this plan:** Telegram linking and the `OwnerAccess`/`OwnerTgLink`/`AgentSwitch` tables (Plan 3); the 40-question evaluation and the Darulle launch (Plan 4).

---

## Conventions (unchanged from Plan 1)

- Work on the VPS: `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`, pm2 `binasmart-api`, port 4210, branch main. Back up an existing file before patching (`<file>.bak-<what>-<stamp>`); edit existing files with a Python script that asserts each anchor matches once. New files may be written locally and copied up with `scp`. Windows Git Bash: no heredocs, apostrophes or Ethiopic JSON inside `ssh '...'` — use files.
- `npm test` baseline: **609 pass, 0 fail** (HEAD `bf33611`). Test counts below are deltas.
- `git commit -F <file>`, stage by name, never `broadcast-am-fbcomment.js`, never `uploader.js`. The repo is public: no phone numbers, keys, chat ids or real tenant names in code, tests or messages.
- **No test sends to live channels.** Never probe with an emergency. Probes against the live app use the `x-binasmart-eval: 1` header, a demo building, a throwaway owner key removed in the same run, and delete the audit rows they create.
- **Data never leaves the server.** Scripts that read real records print counts and booleans only.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `assistant/kit/engine.js` | modify | options `{scope, channel}`; `knowledge: false`; tool round; tool results in grounding and `finish`; `log: false` + `audit` |
| `test/kit/engine-tools.test.js` | create | the new engine behaviour; Afiya/Asmat still get `{}` |
| `agents/owner/building-data.js` | create | `loadBuildings(prisma, buildingIds, now)` — one scoped load; `select` = allowlist |
| `test/owner/building-data.test.js` | create | every query is scoped; nothing private is selected |
| `agents/owner/tools/building.js` | create | `DEFS` (OpenAI function schemas), ten pure tools, `makeExecutor({prisma, now})` |
| `test/owner/fixture.js` | create | a fake building's records (shared by the owner tests) |
| `test/owner/building-tools.test.js` | create | every total, every edge, the privacy scan |
| `agents/owner/SOUL.md` | create | the owner Bini's public soul |
| `agents/owner/rules.js` | create | gates (emergency, no scope, change request), tools, finish, audit |
| `test/owner/owner-agent.test.js` | create | the agent through the engine with a scripted, tool-calling model |
| `server.js` | modify | engine deps gain `audit`; `/api/owner/:slug/ai` delegates |
| `test/kit/wiring.test.js` | modify | the owner route stays delegated and scoped by the key |
| `ops/owner/check-tools.js` | create | tool totals vs direct database counts for one building; numbers only |

## Facts this plan relies on (verified 13 Sep 2026)

- `Unit.status` ∈ `OCCUPIED VACANT MAINTENANCE RESERVED`; `Invoice.status` ∈ `PENDING PAID OVERDUE PARTIAL CANCELLED`; `Invoice.type` ∈ `RENT ELECTRICITY WATER SERVICE PENALTY OTHER`; `MaintenanceRequest.status` ∈ `OPEN ASSIGNED IN_PROGRESS DONE VERIFIED CANCELLED`.
- `Tenancy { id unitId userId startDate endDate? active shop? user }`, `User.fullName`, `Shop.name/nameAm`, `Unit._count.leads`, `MaintenanceRequest { buildingId? tenancy? type status assignedTo? createdAt resolvedAt? }`, `Expense { buildingId date category amount vatAmount }`, `Building { vatRegistered vatInclusive }`, `AuditLog { buildingId actor? action detail? amount? createdAt }`.
- `server.js`: `const VAT_RATE = 0.15`; `async function audit(buildingId, action, detail, amount)` (hoisted); `keyOf(req)` reads `x-owner-key` or `?key=`; `authBuildingFail(req, reply, slug)`; `building/ownerKeys.js` exports `{ makeOwnerKeys, mintKey, hashKey, KEEP, MAX_LEN }`.
- `public/owner.html` posts `{message}` to `/api/owner/<slug>/ai` and reads only `d.reply`.
- `callBini(system, messages, maxTokens, opts)`: with `opts.tools` and `opts.execute` it runs tool calls (arguments JSON-parsed, results `JSON.stringify(out).slice(0, 6000)`) and asks again; if the cloud model fails it sets `opts.tools = null` and answers through GLM with no tools.

---

### Task 1: The engine's tool round, scope and audit

**Files:**
- Modify: `assistant/kit/engine.js`
- Test: `test/kit/engine-tools.test.js`

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
// The engine's second shape: an agent that reads through tools, sees only what the route scoped it to,
// and is audited rather than chat-logged. Afiya and Asmat must be untouched by any of it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');

function harness({ reply = 'ok', call = null, contextFor } = {}) {
  const calls = { model: [], logs: [], audits: [], contexts: 0, warns: [], executorScope: [] };
  const deps = {
    callModel: async (sys, messages, maxTokens, opts) => {
      calls.model.push({ sys, opts });
      if (call && opts && opts.execute) await opts.execute(call.name, call.args);
      return typeof reply === 'function' ? reply() : reply;
    },
    contextFor: contextFor || (async () => { calls.contexts++; return ''; }),
    lang: { detect: () => 'en', directive: () => 'D' },
    memory: { userKey: () => 'ip:x', log: r => calls.logs.push(r), isMiss: () => false },
    handover: () => Promise.resolve(true),
    dropUngrounded, isEval: () => false,
    warn: m => calls.warns.push(m),
  };
  return { calls, deps, handle: makeEngine(deps) };
}
const req = message => ({ body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } });
const res = { code() { return this; }, send(o) { return o; } };
const base = o => Object.assign({ name: 'demo', soul: 'S', gates: [], inScope: () => true, redirect: () => '',
  finish: (c, t) => t, fallback: () => 'sorry' }, o);

test('an agent without tools still gets an empty options object, exactly as before', async () => {
  const h = harness();
  await h.handle(base(), req('hi'), res);
  assert.deepEqual(h.calls.model[0].opts, {});
});

test('an agent with tools gets them, and its executor is bound to the scope the route passed', async () => {
  const h = harness({ call: { name: 'rent', args: { month: '2026-07' } }, reply: 'done' });
  const tools = [{ type: 'function', function: { name: 'rent', parameters: { type: 'object', properties: {} } } }];
  const agent = base({ tools, executor: (c, deps) => { h.calls.executorScope.push(c.scope); return async () => ({ invoicedEtb: 30000 }); } });
  await h.handle(agent, req('rent?'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(h.calls.model[0].opts.tools, tools);
  assert.equal(typeof h.calls.model[0].opts.execute, 'function');
  assert.deepEqual(h.calls.executorScope, [{ buildingIds: ['b1'] }]);
});

test('a figure from a tool result survives the figure check; an invented one does not', async () => {
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'Invoiced 30,000 birr. Collected 99,999 birr.' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({ invoicedEtb: 30000 }) });
  const out = await h.handle(agent, req('rent?'), res, { scope: { buildingIds: ['b1'] } });
  assert.match(out.reply, /30,000 birr/);
  assert.doesNotMatch(out.reply, /99,999/);
});

test('finish receives every tool call and its result', async () => {
  let seen = null;
  const h = harness({ call: { name: 'rent', args: { month: '2026-07' } }, reply: 'x' });
  const agent = base({ tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({ n: 1 }),
    finish: (c, t, state) => { seen = state.toolResults; return t; } });
  await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.deepEqual(seen, [{ name: 'rent', args: { month: '2026-07' }, out: { n: 1 } }]);
});

test('knowledge: false skips the document search', async () => {
  const h = harness();
  await h.handle(base({ knowledge: false }), req('q'), res);
  assert.equal(h.calls.contexts, 0);
  await h.handle(base(), req('q'), res);
  assert.equal(h.calls.contexts, 1);
});

test('log: false keeps the answer out of the chat log, and the audit hook gets the tools used', async () => {
  const h = harness({ call: { name: 'rent', args: {} }, reply: 'x' });
  const agent = base({ log: false, tools: [{ type: 'function', function: { name: 'rent' } }], executor: () => async () => ({}),
    audit: (c, info, deps) => { h.calls.audits.push({ scope: c.scope, channel: c.channel, tools: info.tools }); } });
  const out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] }, channel: 'owner-web' });
  await new Promise(r => setImmediate(r));
  assert.equal(out.reply, 'x');
  assert.equal(h.calls.logs.length, 0);
  assert.deepEqual(h.calls.audits, [{ scope: { buildingIds: ['b1'] }, channel: 'owner-web', tools: ['rent'] }]);
});

test('a failing audit is reported and does not cost the answer', async () => {
  const h = harness({ reply: 'x' });
  const out = await h.handle(base({ log: false, audit: () => { throw new Error('db down'); } }), req('q'), res);
  await new Promise(r => setImmediate(r));
  assert.equal(out.reply, 'x');
  assert.ok(h.calls.warns.some(w => w === '[demo] audit failed: db down'));
});

test('the route can name the channel, and a gate can see the scope', async () => {
  const h = harness();
  const agent = base({ gates: [{ test: c => !c.scope, answer: () => ({ body: { reply: 'no scope' }, log: ['noscope'] }) }] });
  let out = await h.handle(agent, req('q'), res, { channel: 'owner-web' });
  assert.equal(out.reply, 'no scope');
  assert.equal(h.calls.logs[0].channel, 'owner-web');
  out = await h.handle(agent, req('q'), res, { scope: { buildingIds: ['b1'] } });
  assert.equal(out.reply, 'ok');
  assert.equal(h.calls.model.length, 1);
});

test('an agent with tools but no executor is refused loudly', async () => {
  const h = harness();
  await assert.rejects(() => h.handle(base({ tools: [{}] }), req('q'), res), /agent demo has tools but no executor/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/kit/engine-tools.test.js`
Expected: several FAIL (options ignored, no tool round, no audit). The first test (`{}`) passes already.

- [ ] **Step 3: Replace `assistant/kit/engine.js` with this version**

```js
'use strict';
// One order for every agent. It is the order /api/afiya and /api/asmat followed by hand until 13 Sep 2026,
// and the order matters more than any single step: what must be answered without a model (an emergency,
// an arrest) is answered before a model is asked anything, and what a model must never say is removed
// before the reply leaves, whatever the prompt asked for.
//
//   gates → scope → prompt → model (+ tool rounds) → retry → filters → grounding → finish → log / audit
//
// An agent is a definition (agents/<name>/rules.js). The engine owns the order; the definition owns the
// content. Nothing here knows about health, law or buildings.
//
// Options a route may pass: scope (what the agent may read — decided by the route's own authentication,
// never by the model) and channel (how the request arrived, for the log and the audit).

const REQUIRED = ['name', 'soul', 'gates', 'inScope', 'redirect', 'finish', 'fallback'];

function makeEngine(deps) {
  const { callModel, contextFor, lang: L, memory, handover, dropUngrounded, isEval } = deps;
  const warn = deps.warn || (m => console.warn(m));

  return async function handle(agent, req, reply, options = {}) {
    for (const k of REQUIRED) if (agent[k] == null) throw new Error('agent ' + (agent.name || '?') + ' is missing ' + k);
    if (agent.tools && typeof agent.executor !== 'function') throw new Error('agent ' + agent.name + ' has tools but no executor');
    const t0 = Date.now();
    const b = req.body || {};
    const msg = String(b.message || '').trim().slice(0, 2000);
    if (!msg) return reply.code(400).send({ error: 'message required' });
    const ip = req.headers['x-real-ip'] || req.ip;
    const user = (b.user && typeof b.user === 'object') ? b.user : {};
    const channel = options.channel || (user.telegramId ? 'telegram' : (user.uid ? 'web' : 'api'));
    const userKey = memory.userKey({ telegramId: user.telegramId, uid: user.uid, ip, evaluation: isEval(req) });
    const lang = L.detect(msg);
    const l = (lang === 'am' || lang === 'am-latin') ? 'am' : (lang === 'om' ? 'om' : 'en');
    const c = { msg, lang, l, user, channel, userKey, scope: options.scope || null };

    // 1. Gates: answered without the model. The first that matches is the answer.
    for (const gate of agent.gates) {
      if (!gate.test(c)) continue;
      const g = gate.answer(c);
      const text = g.body.reply;
      if (g.log) memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: g.log, miss: false, ms: Date.now() - t0 });
      if (g.handover) Promise.resolve(handover({ userKey, channel, lang: l, user, message: msg, reply: text, history: [],
        explicit: true, reason: g.handover })).catch(() => {});
      return g.body;
    }

    // 2. Scope: anything off-subject goes back with a link, and costs nothing.
    if (!agent.inScope(c)) return { reply: agent.redirect(c), redirected: true };

    try {
      // 3. Prompt.
      const ctx = agent.knowledge === false ? ''
        : await Promise.resolve().then(() => contextFor(msg, { lang: l })).catch(() => '');
      const extra = agent.context ? (await agent.context(c, deps)) || {} : {};
      const sys = agent.soul + '\n\n' + L.directive(lang)
        + (ctx ? '\n\n## Information you may use\n' + ctx : '')
        + (extra.prompt || '')
        + (agent.instruct ? agent.instruct(c) : '');
      const maxTokens = agent.maxTokens || 700;

      // Tools: read-only functions bound to c.scope by the definition. Every call and result is kept, because
      // the results are the only place a figure in the answer may come from.
      const toolResults = [];
      const run = agent.tools && agent.tools.length ? agent.executor(c, deps) : null;
      const optsFor = () => run ? { tools: agent.tools, execute: async (name, args) => {
        const out = await run(name, args);
        toolResults.push({ name, args, out });
        return out;
      } } : {};
      const ask = async system => String(await callModel(system, [{ role: 'user', content: msg }], maxTokens, optsFor()) || '').trim();

      // 4. Model, and one retry when the definition says the answer is missing something it must carry.
      let text = await ask(sys);
      if (agent.retry && text && agent.retry.needed(c, text)) {
        const second = await ask(sys + agent.retry.suffix(c));
        if (second && agent.retry.accepts(second)) text = second;
        else warn('[' + agent.name + '] ' + agent.retry.warning);
      }

      // 5. Output filters: what this agent must never say.
      for (const filter of agent.filters || []) {
        const f = filter(text);
        if (f.removed) warn('[' + agent.name + '] removed ' + f.removed + ' ' + f.what);
        text = f.text;
      }

      // 6. Grounding: a figure nobody gave the model — not a document, not a tool — is dropped.
      const documents = extra.grounding != null ? String(ctx || '') + ' ' + extra.grounding : ctx;
      const grounding = toolResults.length ? String(documents || '') + ' ' + JSON.stringify(toolResults.map(r => r.out)) : documents;
      const g = dropUngrounded(text, grounding);
      if (g.dropped.length) warn('[' + agent.name + '] dropped ungrounded ' + g.dropped.map(x => x.text).join(', '));
      text = g.text;

      // 7. Finish: what the definition appends deterministically (nudges, notices, the disclosure).
      text = agent.finish(c, text, Object.assign({}, extra.state || {}, { toolResults }));

      // 8. Record. Agents that read private records (log: false) keep the answer out of the chat log and are
      // audited instead: who asked, when, which tools — never the answer.
      if (agent.log !== false) memory.log({ userKey, channel, lang: l, message: msg, reply: text, tools: [agent.name],
        miss: memory.isMiss(text, { tools: [agent.name], message: msg }), ms: Date.now() - t0 });
      if (agent.audit) {
        const tools = toolResults.map(r => r.name);
        Promise.resolve().then(() => agent.audit(c, { tools }, deps))
          .catch(e => warn('[' + agent.name + '] audit failed: ' + (e && e.message || e)));
      }
      return Object.assign({ reply: text }, agent.okFlags || {});
    } catch (e) {
      req.log && req.log.error({ err: e }, agent.name + ' failed');
      return { reply: agent.fallback(c) };
    }
  };
}

module.exports = { makeEngine, REQUIRED };
```

- [ ] **Step 4: Run the new tests and the Plan 1 tests unchanged**

Run: `node --test test/kit/engine-tools.test.js test/kit/engine.test.js test/kit/afiya-agent.test.js test/kit/asmat-agent.test.js test/kit/wiring.test.js`
Expected: engine-tools 9 PASS; every Plan 1 test PASS without edits.

- [ ] **Step 5: Confirm Afiya and Asmat are unaffected, then commit**

Run: `npm test 2>&1 | grep -E '^# (pass|fail)'` → baseline + 9, 0 fail.
Afiya and Asmat pass `{}` as options and have no tools, `knowledge`, `log` or `audit` keys, so `c.scope` is `null`, the channel and the grounding string are computed exactly as before, and `finish` receives `{ ...state, toolResults: [] }` (Afiya destructures `demoRows`; Asmat ignores it).

```bash
pm2 restart binasmart-api && sleep 6 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4210/afiya
git add assistant/kit/engine.js test/kit/engine-tools.test.js
git commit -F /tmp/msg-p2t1.txt && git push
```
Message: `Agent kit: tool rounds, route scope and audit in the engine` + paragraph + trailer. (The engine is live code for Afiya and Asmat, hence the restart; probe only `/afiya` page load and an off-topic redirect as in Plan 1 Task 7 — never an emergency.)

---

### Task 2: The scoped data loader

**Files:**
- Create: `agents/owner/building-data.js`
- Test: `test/owner/building-data.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// The loader is the only code in the owner agent that touches the database. Two things must hold for every
// query it makes: it is limited to the buildings in scope, and it selects nothing private.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadBuildings } = require('../../agents/owner/building-data');

function recordingPrisma() {
  const calls = {};
  const model = name => ({ findMany: async args => { calls[name] = args; return []; } });
  return { calls, prisma: { building: model('building'), unit: model('unit'), tenancy: model('tenancy'),
    invoice: model('invoice'), maintenanceRequest: model('maintenanceRequest'), expense: model('expense') } };
}

test('every query is limited to the buildings in scope', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1', 'b2'], new Date('2026-09-13T12:00:00Z'));
  const scope = { in: ['b1', 'b2'] };
  assert.deepEqual(calls.building.where.id, scope);
  assert.deepEqual(calls.unit.where.buildingId, scope);
  assert.deepEqual(calls.tenancy.where.unit.buildingId, scope);
  assert.equal(calls.tenancy.where.active, false);
  assert.deepEqual(calls.invoice.where.tenancy.unit.buildingId, scope);
  assert.ok(calls.invoice.where.dueDate.gte instanceof Date);
  assert.deepEqual(calls.maintenanceRequest.where.OR, [{ buildingId: scope }, { tenancy: { unit: { buildingId: scope } } }]);
  assert.deepEqual(calls.expense.where.buildingId, scope);
});

test('nothing private is ever selected', async () => {
  const { calls, prisma } = recordingPrisma();
  await loadBuildings(prisma, ['b1'], new Date('2026-09-13T12:00:00Z'));
  const all = JSON.stringify(calls);
  for (const field of ['phone', 'faydaId', 'binaScore', 'paymentCode', 'bankAccounts', 'passwordHash', 'telegramChatId',
                       'telegramId', 'tinNumber', 'vatNumber', 'reporterPhone', 'reporterName', 'description', 'serialNo'])
    assert.equal(all.includes('"' + field + '"'), false, field + ' is selected');
});

test('an empty scope is refused, not treated as everything', async () => {
  const { prisma } = recordingPrisma();
  await assert.rejects(() => loadBuildings(prisma, [], new Date()), /owner scope is empty/);
  await assert.rejects(() => loadBuildings(prisma, null, new Date()), /owner scope is empty/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/owner/building-data.test.js` → FAIL, `Cannot find module`.

- [ ] **Step 3: Write `agents/owner/building-data.js`**

```js
'use strict';
// Everything the owner agent may read about a building, in one scoped load per question.
//
// The select clauses below ARE the privacy allowlist. A field that is not selected here cannot reach a tool,
// and so cannot reach the model: no phone number, Fayda id, BinaScore, payment code, TIN, bank account or
// free-text description is ever selected. Add a field only together with a test that names it.
const DAY = 86400000;
const WINDOW_DAYS = 800; // a little over two years of invoices and expenses

async function loadBuildings(prisma, buildingIds, now = new Date()) {
  if (!Array.isArray(buildingIds) || !buildingIds.length) throw new Error('owner scope is empty');
  const ids = { in: buildingIds };
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const [buildings, units, ended, invoices, repairs, expenses] = await Promise.all([
    prisma.building.findMany({ where: { id: ids },
      select: { id: true, name: true, nameAm: true, qrSlug: true, vatRegistered: true, vatInclusive: true } }),
    prisma.unit.findMany({ where: { buildingId: ids },
      select: { id: true, buildingId: true, number: true, floor: true, areaSqm: true, monthlyRent: true, status: true, unitType: true,
        tenancies: { where: { active: true },
          select: { id: true, startDate: true, endDate: true, user: { select: { fullName: true } }, shop: { select: { name: true, nameAm: true } } } },
        _count: { select: { leads: true } } } }),
    prisma.tenancy.findMany({ where: { active: false, unit: { buildingId: ids } }, select: { unitId: true, endDate: true } }),
    prisma.invoice.findMany({ where: { tenancy: { unit: { buildingId: ids } }, dueDate: { gte: since } },
      select: { id: true, tenancyId: true, type: true, amount: true, lateFee: true, dueDate: true, paidDate: true, daysLate: true, status: true,
        tenancy: { select: { unitId: true } } } }),
    prisma.maintenanceRequest.findMany({ where: { OR: [{ buildingId: ids }, { tenancy: { unit: { buildingId: ids } } }] },
      select: { type: true, status: true, assignedTo: true, createdAt: true, resolvedAt: true, buildingId: true,
        tenancy: { select: { unit: { select: { number: true, buildingId: true } } } } } }),
    prisma.expense.findMany({ where: { buildingId: ids, date: { gte: since } },
      select: { buildingId: true, date: true, category: true, amount: true, vatAmount: true } }),
  ]);
  return { now, buildings, units, ended, invoices, repairs, expenses };
}

module.exports = { loadBuildings, WINDOW_DAYS };
```

Note: `assignedTo` is selected only so a tool can say *whether* a repair is assigned; no tool outputs its value (Task 3 tests this with a phone-shaped `assignedTo`).

- [ ] **Step 4: Run** `node --test test/owner/building-data.test.js` → 3 PASS; `npm test` → +3, 0 fail.

- [ ] **Step 5: Commit** `agents/owner/building-data.js test/owner/building-data.test.js` — `Owner Bini: one scoped, allowlisted load of a building's records`. No restart (nothing requires it yet).

---

### Task 3: The building tools

**Files:**
- Create: `test/owner/fixture.js`, `agents/owner/tools/building.js`
- Test: `test/owner/building-tools.test.js`

- [ ] **Step 1: Write the fixture**

`test/owner/fixture.js` — a fake building shaped exactly like `loadBuildings` returns, with private fields planted where a careless projection would leak them:

```js
'use strict';
// One fake building, shaped like loadBuildings() output. Private fields (phone, faydaId, a phone-shaped
// assignedTo) are planted on purpose: no tool output may contain them.
const D = s => new Date(s);
const NOW = D('2026-09-13T12:00:00Z');

function fixture() {
  const t1 = { id: 't1', startDate: D('2025-10-16T00:00:00Z'), endDate: D('2026-10-15T00:00:00Z'),
    user: { fullName: 'Abebe Test', phone: 'PLANTED-PHONE-1', faydaId: 'FAYDA-123' }, shop: null };
  const t2 = { id: 't2', startDate: D('2025-01-01T00:00:00Z'), endDate: null, user: { fullName: 'Owner Of Cafe', phone: 'PLANTED-PHONE-2' },
    shop: { name: 'Test Cafe', nameAm: null } };
  const inv = (id, tenancyId, unitId, due, amount, status, paid, daysLate, type = 'RENT') =>
    ({ id, tenancyId, type, amount, lateFee: 0, dueDate: D(due), paidDate: paid ? D(paid) : null, daysLate, status, tenancy: { unitId } });
  return {
    now: NOW,
    buildings: [{ id: 'b1', name: 'Test Plaza', nameAm: 'ቴስት ፕላዛ', qrSlug: 'test-plaza', vatRegistered: true, vatInclusive: false }],
    units: [
      { id: 'u1', buildingId: 'b1', number: '101', floor: 1, areaSqm: 40, monthlyRent: 10000, status: 'OCCUPIED', unitType: 'SHOP', tenancies: [t1], _count: { leads: 0 } },
      { id: 'u2', buildingId: 'b1', number: '102', floor: 1, areaSqm: 80, monthlyRent: 20000, status: 'OCCUPIED', unitType: 'SHOP', tenancies: [t2], _count: { leads: 1 } },
      { id: 'u3', buildingId: 'b1', number: '103', floor: 2, areaSqm: 60, monthlyRent: 15000, status: 'VACANT', unitType: 'OFFICE', tenancies: [], _count: { leads: 2 } },
    ],
    ended: [{ unitId: 'u3', endDate: D('2026-05-31T00:00:00Z') }],
    invoices: [
      inv('i1', 't1', 'u1', '2026-07-01T00:00:00Z', 10000, 'PAID', '2026-07-03T00:00:00Z', 2),
      inv('i2', 't2', 'u2', '2026-07-01T00:00:00Z', 20000, 'PENDING', null, 0),
      inv('i3', 't1', 'u1', '2026-06-01T00:00:00Z', 10000, 'PAID', '2026-06-10T00:00:00Z', 9),
      inv('i4', 't2', 'u2', '2026-06-01T00:00:00Z', 20000, 'OVERDUE', null, 0),
      inv('i5', 't2', 'u2', '2026-05-01T00:00:00Z', 20000, 'PAID', '2026-05-16T00:00:00Z', 15),
      inv('i6', 't1', 'u1', '2026-06-01T00:00:00Z', 10000, 'CANCELLED', null, 0),
    ],
    repairs: [
      { type: 'plumbing', status: 'OPEN', assignedTo: 'PLANTED-PHONE-3', createdAt: D('2026-09-01T00:00:00Z'), resolvedAt: null, buildingId: null,
        tenancy: { unit: { number: '101', buildingId: 'b1' } } },
      { type: 'lift', status: 'DONE', assignedTo: null, createdAt: D('2026-08-01T00:00:00Z'), resolvedAt: D('2026-08-03T00:00:00Z'), buildingId: 'b1', tenancy: null },
    ],
    expenses: [
      { buildingId: 'b1', date: D('2026-07-10T00:00:00Z'), category: 'generator', amount: 5000, vatAmount: 750 },
      { buildingId: 'b1', date: D('2026-07-20T00:00:00Z'), category: 'cleaning', amount: 2000, vatAmount: 0 },
    ],
  };
}

// A Prisma double that returns the fixture, for tests that go through loadBuildings.
function fakePrisma(data = fixture(), calls = { findMany: 0 }) {
  const m = key => ({ findMany: async () => { calls.findMany++; return data[key]; } });
  return { calls, prisma: { building: m('buildings'), unit: m('units'), tenancy: m('ended'), invoice: m('invoices'),
    maintenanceRequest: m('repairs'), expense: m('expenses') } };
}

module.exports = { fixture, fakePrisma, NOW };
```

- [ ] **Step 2: Write the failing test**

`test/owner/building-tools.test.js`:

```js
'use strict';
// Every total a building tool reports, checked by hand against a fixture. The tools are pure functions over
// loaded records; the only database access is the loader (tested separately).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const B = require('../../agents/owner/tools/building');
const { fixture, fakePrisma, NOW } = require('./fixture');

const one = (name, args = {}, data = fixture()) => B.TOOLS[name](B.view(data, data.buildings[0]), args, NOW);

test('data_health says what is recorded and what is missing', () => {
  assert.deepEqual(one('data_health'), { units: 3, activeTenancies: 2, invoices: 6, invoicesPaid: 3,
    rentMonthsWithoutInvoices: ['2026-09', '2026-08'], expensesRecorded: 2, openRepairs: 1,
    newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('overview', () => {
  assert.deepEqual(one('overview'), { units: 3, occupied: 2, vacant: 1, otherStatus: 0, expectedMonthlyRentEtb: 45000,
    openRepairs: 1, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('rent_month counts a month, and a cancelled invoice counts for nothing', () => {
  const july = one('rent_month', { month: '2026-07' });
  assert.equal(july.invoices, 2); assert.equal(july.invoicedEtb, 30000);
  assert.equal(july.paidCount, 1); assert.equal(july.paidEtb, 10000);
  assert.equal(july.unpaidCount, 1); assert.equal(july.unpaidEtb, 20000);
  assert.equal(july.overdueCount, 1); assert.equal(july.overdueEtb, 20000);
  const june = one('rent_month', { month: '2026-06' });
  assert.equal(june.invoicedEtb, 30000, 'the cancelled 10,000 is not invoiced');
  const september = one('rent_month', {});
  assert.equal(september.month, '2026-09'); assert.equal(september.invoices, 0);
});

test('unpaid lists the oldest first, with who owes it', () => {
  const u = one('unpaid');
  assert.equal(u.count, 2); assert.equal(u.totalEtb, 40000);
  assert.deepEqual(u.invoices.map(i => [i.unit, i.occupant, i.amountEtb, i.dueDate, i.daysLate]),
    [['102', 'Test Cafe', 20000, '2026-06-01', 104], ['102', 'Test Cafe', 20000, '2026-07-01', 74]]);
  assert.equal(one('unpaid', { month: '2026-07' }).count, 1);
});

test('an invoice from a former tenancy names nobody', () => {
  const data = fixture();
  data.invoices.push({ id: 'i7', tenancyId: 'old', type: 'RENT', amount: 5000, lateFee: 0, dueDate: new Date('2026-04-01T00:00:00Z'),
    paidDate: null, daysLate: 0, status: 'OVERDUE', tenancy: { unitId: 'u1' } });
  const row = one('unpaid', {}, data).invoices.find(i => i.dueDate === '2026-04-01');
  assert.equal(row.occupant, null);
});

test('unit gives one unit, and a unit that is not here is simply not found', () => {
  const u = one('unit', { number: '101' });
  assert.equal(u.found, true); assert.equal(u.occupant, 'Abebe Test');
  assert.equal(u.monthlyRentEtb, 10000); assert.equal(u.contractEnd, '2026-10-15');
  assert.deepEqual(u.invoices.map(i => i.dueDate), ['2026-07-01', '2026-06-01', '2026-06-01']);
  assert.equal(u.openRepairs, 1);
  assert.deepEqual(one('unit', { number: '999' }), { found: false });
});

test('late_payers needs two late invoices in the window', () => {
  assert.deepEqual(one('late_payers', { months: 3 }).units, []);
  const four = one('late_payers', { months: 4 });
  assert.equal(four.from, '2026-06-01');
  assert.deepEqual(four.units.map(u => [u.unit, u.lateInvoices, u.averageDaysLate]), [['102', 2, 89], ['101', 2, 6]]);
});

test('vacant, contracts_ending and repairs', () => {
  assert.deepEqual(one('vacant').units, [{ number: '103', floor: 2, areaSqm: 60, monthlyRentEtb: 15000, vacantSince: '2026-05-31', enquiries: 2 }]);
  const c = one('contracts_ending', { days: 60 });
  assert.deepEqual(c.contracts, [{ unit: '101', occupant: 'Abebe Test', endDate: '2026-10-15' }]);
  assert.equal(one('contracts_ending', { days: 10 }).count, 0);
  const r = one('repairs');
  assert.deepEqual(r.repairs, [{ unit: '101', type: 'plumbing', status: 'OPEN', reported: '2026-09-01', resolved: null, assigned: true }]);
  assert.equal(one('repairs', { status: 'all' }).count, 2);
});

test('money: collected, expenses and VAT for a month', () => {
  assert.deepEqual(one('money', { month: '2026-07' }), { month: '2026-07', invoicedEtb: 30000, collectedEtb: 10000, expensesEtb: 7000,
    expensesByCategory: { generator: 5000, cleaning: 2000 }, vatRegistered: true, outputVatEtb: 4500, inputVatEtb: 750, netVatEtb: 3750,
    collectedMinusExpensesEtb: 3000, newestInvoice: '2026-07-01', newestPayment: '2026-07-03' });
});

test('VAT uses the same rate as the rest of the app', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(src, new RegExp('const VAT_RATE = ' + String(B.VAT_RATE).replace('.', '\\.') + ';'));
});

test('no tool output carries a phone number, an id or a private field', () => {
  const all = JSON.stringify(Object.keys(B.TOOLS).map(n => one(n, n === 'unit' ? { number: '101' } : { months: 12, days: 365, status: 'all' })));
  assert.doesNotMatch(all, /PLANTED|FAYDA|faydaId|"phone"|assignedTo/);
});

test('every tool has a definition, and every definition a tool', () => {
  assert.deepEqual(B.DEFS.map(d => d.function.name).sort(), Object.keys(B.TOOLS).sort());
  for (const d of B.DEFS) assert.equal(d.type, 'function');
});

test('the executor loads once per question, checks arguments, and never leaves the scope', async () => {
  const { calls, prisma } = fakePrisma();
  const run = B.makeExecutor({ prisma, now: () => NOW })({ buildingIds: ['b1'] });
  const a = await run('rent_month', { month: '2026-07' });
  const b = await run('vacant', {});
  assert.equal(calls.findMany, 6, 'one load (six queries) for two tool calls');
  assert.equal(a.buildings[0].building, 'Test Plaza');
  assert.equal(a.buildings[0].invoicedEtb, 30000);
  assert.equal(b.buildings[0].count, 1);
  assert.deepEqual(await run('rent_month', { month: 'July' }), { error: 'month must look like 2026-09' });
  assert.deepEqual(await run('drop_tables', {}), { error: 'unknown tool drop_tables' });
  assert.deepEqual(await run('overview', { building: 'somewhere else' }), { error: 'no such building for this owner' });
});

test('when the records cannot be loaded, the tool says so instead of throwing', async () => {
  const prisma = { building: { findMany: async () => { throw new Error('db down'); } } };
  const run = B.makeExecutor({ prisma, now: () => NOW, warn: () => {} })({ buildingIds: ['b1'] });
  assert.deepEqual(await run('overview', {}), { error: 'records unavailable' });
});
```

- [ ] **Step 3: Run and confirm failure** — `node --test test/owner/building-tools.test.js` → FAIL, `Cannot find module`.

- [ ] **Step 4: Write `agents/owner/tools/building.js`**

```js
'use strict';
// The building tool pack for the owner agent: ten read-only questions an owner asks about their building.
// Each tool is a pure function over the records loadBuildings() returned for the owner's scope, so the only
// database access — and the only place scope and privacy are enforced — is ../building-data.js. Outputs
// project named fields explicitly: nothing is passed through whole.
const { loadBuildings } = require('../building-data');

const DAY = 86400000;
const VAT_RATE = 0.15;                     // the same rate as server.js (VAT Proclamation 1341/2024); a test pins it
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const OPEN = new Set(['OPEN', 'ASSIGNED', 'IN_PROGRESS']);

const iso = d => d ? new Date(d).toISOString().slice(0, 10) : null;
const monthOf = d => new Date(d).toISOString().slice(0, 7);
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
const daysSince = (d, now) => Math.max(0, Math.floor((now - d) / DAY));
const occupant = t => t ? (t.shop ? (t.shop.nameAm || t.shop.name) : (t.user && t.user.fullName) || null) : null;

// The records of one building out of a (possibly multi-building) load.
function view(data, b) {
  const units = data.units.filter(u => u.buildingId === b.id);
  const unitIds = new Set(units.map(u => u.id));
  return {
    b, units,
    byUnit: new Map(units.map(u => [u.id, u])),
    invoices: data.invoices.filter(i => i.tenancy && unitIds.has(i.tenancy.unitId)),
    repairs: data.repairs.filter(r => (r.buildingId || (r.tenancy && r.tenancy.unit && r.tenancy.unit.buildingId)) === b.id),
    expenses: data.expenses.filter(e => e.buildingId === b.id),
    ended: data.ended.filter(t => unitIds.has(t.unitId)),
  };
}

// How recent the records are. Carried by every money answer so an owner never reads July as today.
function asOf(v) {
  let inv = null, pay = null;
  for (const i of v.invoices) {
    if (!inv || i.dueDate > inv) inv = i.dueDate;
    if (i.paidDate && (!pay || i.paidDate > pay)) pay = i.paidDate;
  }
  return { newestInvoice: iso(inv), newestPayment: iso(pay) };
}

function currentOccupant(v, unitId, tenancyId) {
  const t = ((v.byUnit.get(unitId) || {}).tenancies || [])[0];
  return t && t.id === tenancyId ? occupant(t) : null;   // an old tenancy's invoice names nobody
}

const TOOLS = {
  data_health(v, a, now) {
    const rentMonths = new Set(v.invoices.filter(i => i.type === 'RENT').map(i => monthOf(i.dueDate)));
    const missing = [];
    for (let k = 0; k < 3; k++) {
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)).toISOString().slice(0, 7);
      if (!rentMonths.has(m)) missing.push(m);
    }
    return { units: v.units.length, activeTenancies: v.units.filter(u => u.tenancies.length).length,
      invoices: v.invoices.length, invoicesPaid: v.invoices.filter(i => i.status === 'PAID').length,
      rentMonthsWithoutInvoices: missing, expensesRecorded: v.expenses.length,
      openRepairs: v.repairs.filter(r => OPEN.has(r.status)).length, ...asOf(v) };
  },

  overview(v) {
    const occupied = v.units.filter(u => u.status === 'OCCUPIED').length;
    const vacant = v.units.filter(u => u.status === 'VACANT').length;
    return { units: v.units.length, occupied, vacant, otherStatus: v.units.length - occupied - vacant,
      expectedMonthlyRentEtb: sum(v.units, u => u.monthlyRent), openRepairs: v.repairs.filter(r => OPEN.has(r.status)).length, ...asOf(v) };
  },

  rent_month(v, a, now) {
    const month = a.month || monthOf(now);
    const live = v.invoices.filter(i => monthOf(i.dueDate) === month && i.status !== 'CANCELLED');
    const paid = live.filter(i => i.status === 'PAID');
    const unpaid = live.filter(i => i.status !== 'PAID');
    const overdue = unpaid.filter(i => i.dueDate < now);
    return { month, invoices: live.length, invoicedEtb: sum(live, i => i.amount),
      paidCount: paid.length, paidEtb: sum(paid, i => i.amount),
      unpaidCount: unpaid.length, unpaidEtb: sum(unpaid, i => i.amount),
      overdueCount: overdue.length, overdueEtb: sum(overdue, i => i.amount),
      partialCount: live.filter(i => i.status === 'PARTIAL').length, lateFeesEtb: sum(live, i => i.lateFee), ...asOf(v) };
  },

  unpaid(v, a, now) {
    const list = v.invoices
      .filter(i => i.status !== 'PAID' && i.status !== 'CANCELLED' && (!a.month || monthOf(i.dueDate) === a.month))
      .map(i => ({ unit: (v.byUnit.get(i.tenancy.unitId) || {}).number || null, occupant: currentOccupant(v, i.tenancy.unitId, i.tenancyId),
        type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), daysLate: i.dueDate < now ? daysSince(i.dueDate, now) : 0, status: i.status }))
      .sort((x, y) => y.daysLate - x.daysLate);
    return { count: list.length, totalEtb: sum(list, r => r.amountEtb), invoices: list.slice(0, 40), truncated: list.length > 40, ...asOf(v) };
  },

  unit(v, a) {
    const n = String(a.number || '').trim().toLowerCase();
    const u = v.units.find(x => String(x.number).toLowerCase() === n);
    if (!u) return { found: false };
    const t = u.tenancies[0];
    return { found: true, number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent, status: u.status, type: u.unitType,
      occupant: occupant(t), contractStart: t ? iso(t.startDate) : null, contractEnd: t ? iso(t.endDate) : null,
      invoices: v.invoices.filter(i => i.tenancy.unitId === u.id).sort((x, y) => y.dueDate - x.dueDate).slice(0, 12)
        .map(i => ({ type: i.type, amountEtb: i.amount, dueDate: iso(i.dueDate), paidDate: iso(i.paidDate), status: i.status })),
      openRepairs: v.repairs.filter(r => OPEN.has(r.status) && r.tenancy && r.tenancy.unit && r.tenancy.unit.number === u.number).length };
  },

  late_payers(v, a, now) {
    const months = Math.min(Math.max(parseInt(a.months, 10) || 3, 1), 12);
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
    const rows = new Map();
    for (const i of v.invoices) {
      if (i.type !== 'RENT' || i.status === 'CANCELLED' || i.dueDate < from || i.dueDate > now) continue;
      const days = i.status === 'PAID' ? (i.daysLate || 0) : daysSince(i.dueDate, now);
      const r = rows.get(i.tenancy.unitId) || { invoices: 0, late: 0, days: 0 };
      r.invoices++;
      if (days > 0) { r.late++; r.days += days; }
      rows.set(i.tenancy.unitId, r);
    }
    const units = [...rows].filter(([, r]) => r.late >= 2)
      .map(([id, r]) => { const u = v.byUnit.get(id) || {}; return { unit: u.number || null, occupant: occupant((u.tenancies || [])[0]),
        lateInvoices: r.late, ofInvoices: r.invoices, averageDaysLate: Math.round(r.days / r.late) }; })
      .sort((x, y) => y.lateInvoices - x.lateInvoices || y.averageDaysLate - x.averageDaysLate);
    return { months, from: iso(from), units: units.slice(0, 40), ...asOf(v) };
  },

  vacant(v) {
    const endedAt = new Map();
    for (const t of v.ended) if (t.endDate && (!endedAt.has(t.unitId) || t.endDate > endedAt.get(t.unitId))) endedAt.set(t.unitId, t.endDate);
    const units = v.units.filter(u => u.status === 'VACANT')
      .map(u => ({ number: u.number, floor: u.floor, areaSqm: u.areaSqm, monthlyRentEtb: u.monthlyRent,
        vacantSince: iso(endedAt.get(u.id)), enquiries: u._count ? u._count.leads : 0 }))
      .sort((x, y) => String(x.number).localeCompare(String(y.number), undefined, { numeric: true }));
    return { count: units.length, units: units.slice(0, 60) };
  },

  contracts_ending(v, a, now) {
    const days = Math.min(Math.max(parseInt(a.days, 10) || 60, 1), 365);
    const until = new Date(now.getTime() + days * DAY);
    const contracts = [];
    for (const u of v.units) for (const t of u.tenancies)
      if (t.endDate && t.endDate >= now && t.endDate <= until) contracts.push({ unit: u.number, occupant: occupant(t), endDate: iso(t.endDate) });
    contracts.sort((x, y) => x.endDate.localeCompare(y.endDate));
    return { days, count: contracts.length, contracts: contracts.slice(0, 40) };
  },

  repairs(v, a) {
    const all = String(a.status || 'open') === 'all';
    const list = v.repairs.filter(r => all || OPEN.has(r.status)).sort((x, y) => y.createdAt - x.createdAt)
      .map(r => ({ unit: r.tenancy && r.tenancy.unit ? r.tenancy.unit.number : null, type: r.type, status: r.status,
        reported: iso(r.createdAt), resolved: iso(r.resolvedAt), assigned: !!r.assignedTo }));
    return { count: list.length, repairs: list.slice(0, 40) };
  },

  money(v, a, now) {
    const month = a.month || monthOf(now);
    const inv = v.invoices.filter(i => monthOf(i.dueDate) === month && i.status !== 'CANCELLED');
    const invoiced = sum(inv, i => i.amount);
    const collected = sum(inv.filter(i => i.status === 'PAID'), i => i.amount);
    const exps = v.expenses.filter(e => monthOf(e.date) === month);
    const byCategory = {};
    for (const e of exps) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    const expenses = sum(exps, e => e.amount);
    const outputVat = v.b.vatRegistered ? Math.round(v.b.vatInclusive ? invoiced * VAT_RATE / (1 + VAT_RATE) : invoiced * VAT_RATE) : 0;
    const inputVat = v.b.vatRegistered ? sum(exps, e => e.vatAmount) : 0;
    return { month, invoicedEtb: invoiced, collectedEtb: collected, expensesEtb: expenses, expensesByCategory: byCategory,
      vatRegistered: !!v.b.vatRegistered, outputVatEtb: outputVat, inputVatEtb: inputVat, netVatEtb: outputVat - inputVat,
      collectedMinusExpensesEtb: collected - expenses, ...asOf(v) };
  },
};

const BUILDING = { type: 'string', description: 'Only when the owner has more than one building: its name. Omit otherwise.' };
const MONTH_ARG = { type: 'string', description: 'Calendar month as YYYY-MM, e.g. 2026-09. Omit for the current month.' };
const def = (name, description, properties = {}) =>
  ({ type: 'function', function: { name, description, parameters: { type: 'object', properties: Object.assign({ building: BUILDING }, properties) } } });

const DEFS = [
  def('data_health', 'What the records of the building contain and what is missing: units, tenancies, invoices, payments, months with no rent invoices, expenses, open repairs, and how recent the records are. Call it first for a general question, or when figures look incomplete.'),
  def('overview', 'Units occupied and vacant, expected monthly rent of all units, open repairs, and how recent the records are.'),
  def('rent_month', 'Rent and other invoices due in one month: how many, invoiced, paid, unpaid and overdue amounts in ETB, late fees.', { month: MONTH_ARG }),
  def('unpaid', 'Invoices not paid yet, oldest first: unit, tenant or shop, amount in ETB, due date, days late.', { month: { type: 'string', description: 'Optional YYYY-MM to limit to one month.' } }),
  def('unit', 'One unit by its number: rent, size, floor, status, tenant or shop, contract dates, last 12 invoices, open repairs.', { number: { type: 'string', description: 'The unit number as written on the contract, e.g. 707 or G-003.' } }),
  def('late_payers', 'Units that paid rent late (or have not paid) at least twice in the last N months, with average days late.', { months: { type: 'integer', description: 'How many recent months, 1-12. Default 3.' } }),
  def('vacant', 'Vacant units: number, floor, size, rent, vacant since, enquiries received.'),
  def('contracts_ending', 'Contracts that end within the next N days: unit, tenant or shop, end date.', { days: { type: 'integer', description: '1-365. Default 60.' } }),
  def('repairs', 'Repair requests: unit, type, status, reported and resolved dates, whether someone is assigned.', { status: { type: 'string', enum: ['open', 'all'], description: 'open (default) or all.' } }),
  def('money', 'One month of money: invoiced, collected, expenses by category, VAT collected, VAT paid on expenses, net VAT, collected minus expenses. Figures only, not tax advice.', { month: MONTH_ARG }),
];

function makeExecutor({ prisma, now = () => new Date(), warn = m => console.warn(m) }) {
  return function bind(scope) {
    let loading = null;   // one load per question, however many tools the model calls
    return async function execute(name, args) {
      const fn = TOOLS[name];
      if (!fn) return { error: 'unknown tool ' + name };
      args = args && typeof args === 'object' ? args : {};
      if (args.month != null && !MONTH.test(String(args.month))) return { error: 'month must look like 2026-09' };
      const t = now();
      let data;
      try {
        if (!loading) loading = loadBuildings(prisma, scope && scope.buildingIds, t);
        data = await loading;
      } catch (e) {
        loading = null;
        warn('[owner] records unavailable: ' + (e && e.message || e));
        return { error: 'records unavailable' };
      }
      const q = args.building ? String(args.building).toLowerCase() : null;
      const bs = q ? data.buildings.filter(b => [b.qrSlug, b.name, b.nameAm].filter(Boolean).some(n => n.toLowerCase().includes(q))) : data.buildings;
      if (!bs.length) return { error: 'no such building for this owner' };
      return { buildings: bs.map(b => Object.assign({ building: b.name, buildingAm: b.nameAm || null }, fn(view(data, b), args, t))) };
    };
  };
}

module.exports = { TOOLS, DEFS, VAT_RATE, view, makeExecutor };
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/owner/building-tools.test.js`
Expected: 14 PASS. If a figure differs, recompute it by hand from the fixture before touching either side, and state which was wrong.

- [ ] **Step 6: Suite and commit** — `npm test` → +14, 0 fail. Commit `test/owner/fixture.js agents/owner/tools/building.js test/owner/building-tools.test.js` — `Owner Bini: ten read-only building tools`.

---

### Task 4: The owner agent

**Files:**
- Create: `agents/owner/SOUL.md`, `agents/owner/rules.js`
- Test: `test/owner/owner-agent.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// The owner agent through the engine. The model is scripted and calls tools through the same opts.execute
// callBini provides, so these tests cover the real path from question to figure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEngine } = require('../../assistant/kit/engine');
const { dropUngrounded } = require('../../assistant/grounding');
const lang = require('../../assistant/lang');
const afiya = require('../../assistant/afiya');
const agent = require('../../agents/owner/rules');
const { fakePrisma } = require('./fixture');

function run(message, { calls: toolCalls = [], reply = 'ok', scope = { buildingIds: ['b1'] }, throwModel = false } = {}) {
  const seen = { model: 0, logs: [], audits: [], handovers: [] };
  const { prisma } = fakePrisma();
  const handle = makeEngine({
    callModel: async (sys, messages, max, opts) => {
      seen.model++; seen.sys = sys;
      if (throwModel) throw new Error('down');
      for (const c of toolCalls) if (opts && opts.execute) await opts.execute(c.name, c.args || {});
      return reply;
    },
    contextFor: async () => { throw new Error('the owner agent must not search documents'); },
    lang, dropUngrounded, isEval: () => false, prisma,
    memory: { userKey: () => 'ip:t', log: r => seen.logs.push(r), isMiss: () => false },
    handover: r => { seen.handovers.push(r); return Promise.resolve(true); },
    audit: (buildingId, action, detail) => seen.audits.push({ buildingId, action, detail }),
    warn: () => {},
  });
  const res = { code() { return this; }, send(o) { return o; } };
  return handle(agent, { body: { message }, headers: {}, ip: '10.0.0.1', log: { error() {} } }, res, { scope, channel: 'owner-web' })
    .then(async out => { await new Promise(r => setImmediate(r)); return { out, seen }; });
}

test('a fire in the building still gets the emergency answer from code', async () => {
  const { out, seen } = await run('There is a fire in the building and someone is not breathing');
  assert.ok(afiya.isEmergency('There is a fire in the building and someone is not breathing'), 'precondition');
  assert.equal(out.emergency, true);
  assert.equal(seen.model, 0);
  assert.equal(seen.handovers[0].reason, 'Owner Bini: possible emergency');
});

test('a request to change something gets the read-only answer and no model call', async () => {
  for (const q of ['Mark unit 101 as paid', 'Please change the rent of 102 to 25000', 'send a reminder to unit 102', 'የ101 ክፍያ መዝግብልኝ', 'የ102 ኪራይ ቀይር']) {
    const { out, seen } = await run(q);
    assert.equal(out.readOnly, true, q);
    assert.equal(seen.model, 0, q);
  }
});

test('questions that only read are not mistaken for changes', async () => {
  for (const q of ['Send me the list of unpaid units', 'ያልከፈሉትን ዝርዝር ላክልኝ', 'How much rent was paid in July?', 'Did the rent change last year?']) {
    const { out } = await run(q);
    assert.equal(out.readOnly, undefined, q);
  }
});

test('without a scope nothing is read', async () => {
  const { out, seen } = await run('How is my building?', { scope: null });
  assert.equal(seen.model, 0);
  assert.match(out.reply, /building|ህንፃ/);
});

test('a figure from the tools is kept, an invented one is dropped, and the records date closes the answer', async () => {
  const { out, seen } = await run('How much was invoiced in July?', {
    calls: [{ name: 'rent_month', args: { month: '2026-07' } }],
    reply: 'In July 30,000 birr was invoiced. You also collected 99,999 birr from parking.' });
  assert.match(out.reply, /30,000 birr/);
  assert.doesNotMatch(out.reply, /99,999/);
  assert.ok(out.reply.endsWith('📅 Records: newest invoice 2026-07-01, newest recorded payment 2026-07-03.'));
  assert.match(seen.sys, /Today is \d{4}-\d{2}-\d{2}/);
});

test('an Amharic question gets the records line in Amharic', async () => {
  const { out } = await run('በሐምሌ ስንት ብር ተከፍሏል?', { calls: [{ name: 'rent_month', args: { month: '2026-07' } }], reply: 'በሐምሌ 10,000 ብር ተከፍሏል።' });
  assert.match(out.reply, /10,000 ብር/);
  assert.ok(out.reply.endsWith('📅 መዝገቡ፦ የመጨረሻው ደረሰኝ 2026-07-01፣ የመጨረሻው የተመዘገበ ክፍያ 2026-07-03።'));
});

test('an answer with no tool call cannot state a figure', async () => {
  const { out } = await run('How much did I collect?', { reply: 'You collected 45,000 birr.' });
  assert.doesNotMatch(out.reply, /45,000/);
  assert.doesNotMatch(out.reply, /📅/);
});

test('the answer is audited, never chat-logged', async () => {
  const { seen } = await run('How much was invoiced in July?', { calls: [{ name: 'rent_month', args: { month: '2026-07' } }], reply: 'ok' });
  assert.equal(seen.logs.length, 0);
  assert.equal(seen.audits.length, 1);
  assert.equal(seen.audits[0].buildingId, 'b1');
  assert.equal(seen.audits[0].action, 'OWNER_BINI_Q');
  assert.match(seen.audits[0].detail, /^owner-web · rent_month · How much was invoiced in July\?/);
});

test('the tools only ever see the scope the route gave', async () => {
  const { out } = await run('Tell me about unit 101', { calls: [{ name: 'unit', args: { number: '101', building: 'somewhere else' } }], reply: 'ok' });
  assert.equal(typeof out.reply, 'string');
});

test('a model failure gets the dashboard fallback', async () => {
  const { out } = await run('ስንት ክፍል ባዶ ነው?', { throwModel: true });
  assert.equal(out.reply, 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ዳሽቦርዱን ይመልከቱ።');
});

test('the owner soul is public and says it reads and changes nothing', () => {
  assert.match(agent.soul, /change nothing|changes nothing/);
  assert.match(agent.soul, /tool result/);
});
```

- [ ] **Step 2: Run and confirm failure** — `node --test test/owner/owner-agent.test.js` → FAIL, `Cannot find module`.

- [ ] **Step 3: Write `agents/owner/SOUL.md`**

```
You are Bini for owners: BinaSmart's assistant for the OWNER of the buildings your tools can read. You read their records through the tools and you change nothing. Speak to the owner politely and briefly (in Amharic as እርስዎ), with exact figures. Every figure you give — an amount in birr (ETB), a count, a date — must come from a tool result in this conversation. Never estimate, never fill a gap from general knowledge, never describe a trend the figures do not show. For a general question ("how is my building?"), or when the figures look thin, call data_health first and say plainly which records are missing. When the answer is not in the tools, say so and name the dashboard tab to open: Overview, Rent Collection, Units, Accounting or Maintenance. In this version you cannot record payments, send reminders or edit units. Give figures, not tax or legal advice; for a legal question point to Asmat at bina.et/asmat. Mention a tenant's name only when the owner asked about that unit or tenant.
```

- [ ] **Step 4: Write `agents/owner/rules.js`**

```js
'use strict';
// Bini for building owners (Plan 2 of the owner Bini design). Answer only: it reads the owner's own buildings
// through ./tools/building.js and changes nothing. What the owner may see is decided before this file runs —
// by the owner key on the web today, by the Telegram link in Plan 3 — and arrives as c.scope.
const afiya = require('../../assistant/afiya');
const { loadSoul } = require('../../assistant/kit/soul');
const building = require('./tools/building');

// A request to change something. Anchored to how such requests are phrased, because a false positive
// refuses a question the owner is entitled to ask: "send me the list" reads, "send a reminder" writes.
const CHANGE_EN = /^\s*(please\s+)?(mark|set|change|update|delete|remove|vacate|record|cancel|edit|raise|lower|increase|decrease)\b|\bsend\s+(an?\s+)?(reminder|notice|warning|sms)\b/i;
const CHANGE_AM = /(ቀይር|ቀይሩ|አጥፋ|አጥፉ|ሰርዝ|ሰርዙ|መዝግብ|መዝግቡ|ጨምር|ጨምሩ|ቀንስ|ቀንሱ)(ልኝ|ሉኝ)?\s*[።.!?]*\s*$|ማሳሰቢያ\s*ላክ/;
const isChangeRequest = msg => CHANGE_EN.test(msg) || CHANGE_AM.test(String(msg).trim());

const am = (c, amharic, english) => (c.l === 'am' ? amharic : english);

function recordsLine(c, toolResults) {
  if (!toolResults.length) return '';
  let inv = null, pay = null;
  for (const r of toolResults) for (const b of (r.out && r.out.buildings) || []) {
    if (b.newestInvoice && (!inv || b.newestInvoice > inv)) inv = b.newestInvoice;
    if (b.newestPayment && (!pay || b.newestPayment > pay)) pay = b.newestPayment;
  }
  if (!inv && !pay) return '';
  return am(c,
    '\n\n📅 መዝገቡ፦ የመጨረሻው ደረሰኝ ' + (inv || 'የለም') + '፣ የመጨረሻው የተመዘገበ ክፍያ ' + (pay || 'የለም') + '።',
    '\n\n📅 Records: newest invoice ' + (inv || 'none') + ', newest recorded payment ' + (pay || 'none') + '.');
}

module.exports = {
  name: 'owner',
  soul: loadSoul('owner'),
  maxTokens: 700,
  knowledge: false,   // the owner's records are the only source; general documents would only add unrelated figures
  log: false,         // replies carry tenants' names and money: audited, never kept in the chat log

  gates: [
    { test: c => afiya.isEmergency(c.msg),
      answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true, ambulance: afiya.AMBULANCE },
        log: ['emergency'], handover: 'Owner Bini: possible emergency' }) },
    { test: c => !c.scope || !Array.isArray(c.scope.buildingIds) || !c.scope.buildingIds.length,
      answer: c => ({ body: { reply: am(c, 'ይቅርታ፣ የትኛው ህንፃ የእርስዎ እንደሆነ አልታወቀም። እባክዎ እንደገና ይግቡ።',
        'Sorry, I could not tell which building is yours. Please sign in again.') } }) },
    { test: c => isChangeRequest(c.msg),
      answer: c => ({ body: { readOnly: true, reply: am(c,
        'በዚህ ስሪት መዝገብዎን ማንበብ ብቻ ነው የምችለው፤ መለወጥ አልችልም። ክፍያ ለመመዝገብ፣ ማሳሰቢያ ለመላክ ወይም ክፍል ለማስተካከል የባለቤት ዳሽቦርዱን ይጠቀሙ (Rent Collection፣ Units፣ Accounting)።',
        'In this version I can only read your records, not change them. To record a payment, send a reminder or edit a unit, use the owner dashboard: Rent Collection, Units or Accounting.') } }) },
  ],

  inScope: () => true,
  redirect: () => '',

  tools: building.DEFS,
  executor: (c, deps) => building.makeExecutor({ prisma: deps.prisma })(c.scope),

  instruct: () => '\n\nToday is ' + new Date().toISOString().slice(0, 10) + '. Answer only from the tool results.',

  finish(c, text, { toolResults = [] }) {
    if (!text) text = am(c, 'ይቅርታ፣ ይህን በመዝገብዎ ውስጥ አላገኘሁትም። በሌላ መንገድ ይጠይቁ ወይም ዳሽቦርዱን ይክፈቱ።',
      'Sorry, I could not find that in your records. Ask another way, or open the dashboard.');
    return text + recordsLine(c, toolResults);
  },

  fallback: c => am(c, 'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ ዳሽቦርዱን ይመልከቱ።', 'Sorry, I could not answer just now. Please check the dashboard.'),

  // Who asked, through which door, with which tools — never the answer.
  audit(c, { tools }, deps) {
    if (typeof deps.audit !== 'function') return;
    for (const id of c.scope.buildingIds)
      deps.audit(id, 'OWNER_BINI_Q', c.channel + ' · ' + (tools.join(',') || 'no tools') + ' · ' + c.msg.slice(0, 120));
  },

  isChangeRequest,
};
```

Notes for the implementer:
- Afaan Oromoo questions are answered, but the fixed texts fall back to English (`am()` returns English for `om`); the Oromo owner texts need a native speaker and are out of scope here.
- The emergency gate runs before the scope gate on purpose: an emergency gets 907 even if the owner's session is broken.

- [ ] **Step 5: Run the tests**

Run: `node --test test/owner/owner-agent.test.js`
Expected: 11 PASS. The records line in the English test is produced from the fixture's `rent_month` output (`newestInvoice 2026-07-01`, `newestPayment 2026-07-03`). If the change-request test fails for one of the listed sentences, fix the regex, not the list; if a read-only sentence is caught, the regex is too broad — narrow it and add the sentence to the negative list.

- [ ] **Step 6: Suite and commit** — `npm test` → +11, 0 fail. Commit `agents/owner/SOUL.md agents/owner/rules.js test/owner/owner-agent.test.js` — `Owner Bini: the answer-only owner agent`.

---

### Task 5: The owner dashboard route on the engine

**Files:**
- Modify: `server.js` (engine deps; `/api/owner/:slug/ai`)
- Modify: `test/kit/wiring.test.js`
- Create: `ops/owner/check-tools.js`

- [ ] **Step 1: Add the failing wiring test** (append to `test/kit/wiring.test.js`)

```js
test('the owner route authenticates, then hands the engine a scope taken from the key, never from the body', () => {
  const at = src.indexOf("fastify.post('/api/owner/:slug/ai'");
  assert.ok(at > 0, 'owner route not found');
  const body = src.slice(at, src.indexOf('\n});', at));
  const auth = body.indexOf('authBuildingFail(req, reply, req.params.slug)');
  const run = body.indexOf("runAgent(ownerAgent, req, reply, { scope: { buildingIds: [b.id] }, channel: 'owner-web' })");
  assert.ok(auth > 0 && run > auth, 'must authenticate before running the agent, with the key-derived scope');
  assert.equal(/req\.body/.test(body), false, 'the scope must not come from the request body');
  assert.equal(/callBini\(/.test(body), false, 'the owner route must not call the model directly any more');
  const engine = src.slice(src.indexOf('const runAgent = makeEngine('), src.indexOf('});', src.indexOf('const runAgent = makeEngine(')));
  assert.ok(engine.includes('audit'), 'the engine needs audit for the owner agent');
  assert.ok(src.includes("const ownerAgent = require('./agents/owner/rules');"));
});
```

Run: `node --test test/kit/wiring.test.js` → the new test FAILS.

- [ ] **Step 2: Patch `server.js`**

```python
# /tmp/p2t5.py
import io, shutil, subprocess, time
p = '/var/www/connectcare/binasmart/server.js'
shutil.copy(p, p + '.bak-ownerbini-' + time.strftime('%Y%m%d-%H%M%S'))
s = io.open(p, encoding='utf-8').read()

def sub(old, new, why):
    global s
    assert s.count(old) == 1, why + ': anchor matched %d times' % s.count(old)
    s = s.replace(old, new, 1)
    print('  ok  ' + why)

sub("const asmatAgent = require('./agents/asmat/rules');\n",
    "const asmatAgent = require('./agents/asmat/rules');\nconst ownerAgent = require('./agents/owner/rules');\n",
    'owner agent required beside the others')
sub("  handover: biniHandover, dropUngrounded, isEval, prisma,\n",
    "  handover: biniHandover, dropUngrounded, isEval, prisma, audit,\n",
    'engine deps gain audit (a hoisted function declaration)')

a = s.index("fastify.post('/api/owner/:slug/ai', async (req, reply) => {")
b = s.index('\n});', a) + len('\n});')
old = s[a:b]
assert 'callBini(SYS' in old and 'FALLBACK' in old, 'unexpected owner ai route body'
new = ("// Bini for the owner of this building, answer only: agents/owner reads this building through scoped,\n"
       "// read-only tools. The scope comes from the owner key checked here, never from the request.\n"
       "fastify.post('/api/owner/:slug/ai', async (req, reply) => {\n"
       "  if (await authBuildingFail(req, reply, req.params.slug)) return;\n"
       "  const b = await prisma.building.findUnique({ where: { qrSlug: req.params.slug }, select: { id: true } });\n"
       "  if (!b) return reply.code(404).send({ error: 'not_found' });\n"
       "  return runAgent(ownerAgent, req, reply, { scope: { buildingIds: [b.id] }, channel: 'owner-web' });\n"
       "});")
s = s[:a] + new + s[b:]
print('  ok  /api/owner/:slug/ai on the engine (' + str(old.count('\n')) + ' lines replaced)')

io.open(p, 'w', encoding='utf-8').write(s)
r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
print(r.stderr.strip()[:300] or 'node --check clean')
```

Before running: read the current route (`grep -n "fastify.post('/api/owner/:slug/ai'" server.js` then `sed -n`) and confirm it ends at the first `\n});` after its start and contains `callBini(SYS` and `FALLBACK`. After running: `git diff --stat server.js` and read the diff; confirm `VAT_RATE`, `expense` and every other name the old body used are still used elsewhere or harmlessly unused (the old body declared only locals).

- [ ] **Step 3: Tests** — `node --test test/kit/wiring.test.js && npm test 2>&1 | grep -E '^# (pass|fail)'` → wiring 4 PASS; suite +1, 0 fail.

- [ ] **Step 4: Write `ops/owner/check-tools.js`**

```js
'use strict';
// Checks the owner tools against the database for one building: every total a tool reports must equal the
// same total counted directly with Prisma. Prints numbers only — never a name — and exits 1 on a mismatch.
//   node ops/owner/check-tools.js <qrSlug>      (a demo building; nothing leaves the server)
const { PrismaClient } = require('@prisma/client');
const { makeExecutor } = require('../../agents/owner/tools/building');
const p = new PrismaClient();

(async () => {
  const slug = process.argv[2];
  const b = slug && await p.building.findUnique({ where: { qrSlug: slug }, select: { id: true } });
  if (!b) { console.log('usage: node ops/owner/check-tools.js <qrSlug> (building not found)'); await p.$disconnect(); process.exit(1); }
  const run = makeExecutor({ prisma: p })({ buildingIds: [b.id] });
  const inBuilding = { tenancy: { unit: { buildingId: b.id } } };
  let bad = 0;
  const check = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + label + ': tool ' + got + ' · database ' + want); };

  const health = (await run('data_health', {})).buildings[0];
  check('units', health.units, await p.unit.count({ where: { buildingId: b.id } }));
  const overview = (await run('overview', {})).buildings[0];
  check('occupied', overview.occupied, await p.unit.count({ where: { buildingId: b.id, status: 'OCCUPIED' } }));
  check('vacant', (await run('vacant', {})).buildings[0].count, await p.unit.count({ where: { buildingId: b.id, status: 'VACANT' } }));

  const dues = await p.invoice.findMany({ where: inBuilding, select: { dueDate: true } });
  const months = [...new Set(dues.map(x => x.dueDate.toISOString().slice(0, 7)))].sort().slice(-6);
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    const dueDate = { gte: new Date(Date.UTC(y, mo - 1, 1)), lt: new Date(Date.UTC(y, mo, 1)) };
    const live = await p.invoice.aggregate({ _sum: { amount: true }, _count: true, where: { ...inBuilding, dueDate, status: { not: 'CANCELLED' } } });
    const paid = await p.invoice.aggregate({ _sum: { amount: true }, where: { ...inBuilding, dueDate, status: 'PAID' } });
    const r = (await run('rent_month', { month: m })).buildings[0];
    check(m + ' invoices', r.invoices, live._count);
    check(m + ' invoiced ETB', r.invoicedEtb, live._sum.amount || 0);
    check(m + ' paid ETB', r.paidEtb, paid._sum.amount || 0);
  }

  const outputs = [];
  for (const name of ['data_health', 'overview', 'rent_month', 'unpaid', 'late_payers', 'vacant', 'contracts_ending', 'repairs', 'money'])
    outputs.push(JSON.stringify(await run(name, { months: 12, days: 365, status: 'all' })));
  const leaks = outputs.join(' ').match(/(\+?251|\b0)9\d{8}\b/g);
  check('phone-shaped strings in tool output', leaks ? leaks.length : 0, 0);

  await p.$disconnect();
  process.exit(bad ? 1 : 0);
})();
```

Run: `node ops/owner/check-tools.js century-mall` (a demo building: 16 units, 42 invoices).
Expected: every line `ok`, exit 0. A `FAIL` means a tool or the script disagrees with the database — find which before continuing.

- [ ] **Step 5: Deploy and probe with a throwaway key on the demo building**

`/tmp/p2-probe.js` (not committed; removed after):

```js
'use strict';
// One live check of /api/owner/:slug/ai on a demo building, with a throwaway owner key removed in the same run.
// Prints booleans, status codes and the last 120 characters of the demo reply. Deletes the audit rows it made.
const { PrismaClient } = require('/var/www/connectcare/binasmart/node_modules/@prisma/client');
const { makeOwnerKeys, hashKey } = require('/var/www/connectcare/binasmart/building/ownerKeys');
const p = new PrismaClient();
const SLUG = 'century-mall', OTHER = 'edna-mall', BASE = 'http://127.0.0.1:4210';
const post = (slug, key, message) => fetch(BASE + '/api/owner/' + slug + '/ai', { method: 'POST',
  headers: Object.assign({ 'content-type': 'application/json', 'x-binasmart-eval': '1' }, key ? { 'x-owner-key': key } : {}),
  body: JSON.stringify({ message }) });

(async () => {
  const started = new Date();
  const b = await p.building.findUnique({ where: { qrSlug: SLUG }, select: { id: true } });
  const key = await makeOwnerKeys({ prisma: p }).issue(b.id, SLUG, 'plan2-probe');
  try {
    console.log('no key            ', (await post(SLUG, null, 'How is my building?')).status, '(want 401)');
    console.log('key, other building', (await post(OTHER, key, 'How is my building?')).status, '(want 401)');
    const ro = await (await post(SLUG, key, 'Mark unit 101 as paid')).json();
    console.log('change request     readOnly=' + (ro.readOnly === true));
    const dues = await p.invoice.findMany({ where: { tenancy: { unit: { buildingId: b.id } } }, select: { dueDate: true } });
    const month = dues.map(d => d.dueDate.toISOString().slice(0, 7)).sort().pop();
    const agg = await p.invoice.aggregate({ _sum: { amount: true }, where: { tenancy: { unit: { buildingId: b.id } }, status: { not: 'CANCELLED' },
      dueDate: { gte: new Date(month + '-01T00:00:00Z'), lt: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)) } } });
    const want = String(agg._sum.amount || 0);
    const r = await post(SLUG, key, 'How much was invoiced in ' + month + '?');
    const d = await r.json();
    const digits = String(d.reply || '').replace(/[,\s]/g, '');
    console.log('ordinary question  status=' + r.status + ' mentionsTotal=' + digits.includes(want) + ' recordsLine=' + /📅/.test(d.reply || ''));
    console.log('reply tail         ' + JSON.stringify(String(d.reply || '').slice(-120)));
    await new Promise(res => setTimeout(res, 500));
    const audits = await p.auditLog.findMany({ where: { buildingId: b.id, action: 'OWNER_BINI_Q', createdAt: { gte: started } }, select: { id: true, detail: true } });
    console.log('audit rows         ' + audits.length + ' · tools named=' + audits.some(a => /rent_month|money|data_health/.test(a.detail || '')));
    await p.auditLog.deleteMany({ where: { id: { in: audits.map(a => a.id) } } });
  } finally {
    await p.ownerKey.deleteMany({ where: { keyHash: hashKey(key) } });
    console.log('probe key removed  ' + ((await p.ownerKey.count({ where: { keyHash: hashKey(key) } })) === 0));
    await p.$disconnect();
  }
})();
```

```bash
pm2 restart binasmart-api && sleep 6
curl -s -o /dev/null -w 'owner page %{http_code}\n' http://127.0.0.1:4210/owner
node /tmp/p2-probe.js
pm2 logs binasmart-api --lines 80 --nostream | grep -iE 'error|TypeError|owner failed|records unavailable|audit failed' | tail -5
rm -f /tmp/p2-probe.js /tmp/p2t5.py
```

Expected: `401`, `401`, `readOnly=true`, `status=200`, `recordsLine=true`, `mentionsTotal=true` (if the model phrased the figure differently — e.g. "42 thousand" — read the tail and judge; the figure check guarantees no invented total survives), at least one audit row naming a tool, `probe key removed true`, no log errors. `issue` may prune older keys beyond `KEEP` on that demo building — acceptable on a demo building; never run this against Darulle.

If anything fails: `cp server.js.bak-ownerbini-<stamp> server.js && pm2 restart binasmart-api`, confirm 200, report.

- [ ] **Step 6: Commit** `server.js test/kit/wiring.test.js ops/owner/check-tools.js` — `Owner Bini: the dashboard assistant reads through scoped tools` + paragraph (what the old summary could not answer; scope from the owner key; audit instead of chat log; check-tools result on the demo building; probe results) + trailer. Push.

---

### Task 6: Close out

- [ ] `npm test` → 609 + 9 + 3 + 14 + 11 + 1 = **647 pass, 0 fail** (use the deltas if the baseline moved).
- [ ] `git status --short | grep -v '^??' | grep -v broadcast-am-fbcomment` → empty.
- [ ] Report to Ibrahim: what the owner can now ask in the dashboard, the check-tools and probe results, what is still missing (Telegram — Plan 3; the evaluation and Darulle — Plan 4), and the open points: Darulle's incomplete records; replies are written by Gemini from tool results (amounts, unit numbers, tenant names when asked; never phones or ids); Oromo fixed texts fall back to English.

---

## Self-review

- **Design coverage (§2, §3.4):** ten tools including `data_health` (Task 3); allowlist by `select` plus explicit projection (Tasks 2–3); figures only from tools, records date on every tool-backed answer, fixed read-only reply, other building not found, reply language (Tasks 1, 4); the dashboard route on the engine with key-derived scope (Task 5). `dataScope` from the design is realised as the route's `options.scope` plus the definition's `executor(c)` — the model never supplies it. Telegram, `OwnerAccess`, `AgentSwitch`, the 40-question evaluation and attack tests are Plans 3–4.
- **Deviation recorded:** the design said "names appear only in unit, unpaid, contracts_ending"; `late_payers` also names the occupant, because "who was late three months running" is unanswerable without it. The SOUL tells the model to mention names only when asked about that unit or tenant.
- **Placeholders:** none; every step has its code or command.
- **Names consistent:** `loadBuildings`, `view`, `TOOLS`, `DEFS`, `VAT_RATE`, `makeExecutor({prisma, now, warn})(scope)(name, args)`, engine `handle(agent, req, reply, {scope, channel})`, definition keys `tools executor knowledge log audit`, `toolResults [{name,args,out}]`, audit action `OWNER_BINI_Q`, channel `owner-web`.
- **Risk noted:** Afiya and Asmat run on the engine that Task 1 changes; their options are `{}` and their tests run unchanged in Task 1 Step 4, and pm2 is restarted with a page and redirect probe only.
