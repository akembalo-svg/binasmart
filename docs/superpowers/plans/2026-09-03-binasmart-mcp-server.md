# BinaSmart MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, no-auth MCP server at `https://bina.et/mcp` with 9 tools (4 ride via the live ride API, 4 directory via read-only SQL, 1 guides) so Claude, ChatGPT and Gemini Spark can quote and book BinaSmart rides and look up the directory.

**Architecture:** Separate Node ESM service `mcp-server/` in the BinaSmart repo, pm2 `bina-mcp` on 127.0.0.1:3021, nginx `location ^~ /mcp` on bina.et. Stateless Streamable HTTP (fresh `McpServer` per POST). Ride tools call `http://127.0.0.1:4210/api/ride/*` with a synthetic `X-Real-IP` derived from the rider phone so the ride API's 5-per-10-min-per-phone limit governs booking. Directory tools use `pg` with explicit column lists. Guides are extracted from the 22 guide HTML files at startup.

**Tech Stack:** Node 22, `@modelcontextprotocol/sdk` ^1.30, `express` 4, `zod` 3, `pg` 8, Node built-in test runner. Spec: `docs/superpowers/specs/2026-09-03-binasmart-mcp-server-design.md`.

**Conventions for every task**
- Work on the VPS: `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`, new code under `mcp-server/`. Run tests from `mcp-server/` with bare `node --test` (Node 22 treats a directory argument as a glob and matches nothing).
- Scripts on this box print a spurious `Aborted (core dumped)` after exiting; ignore it when the expected output appeared and the exit code is 0.
- Never call the live `POST /api/ride/request` from a test or a manual check. Never print `OWNER_KEY` or `.env` contents. Commit after each task; push at the end of Tasks 8, 10, 11.
- `pgrep -f` / `pkill -f` self-match inside SSH; use `ps -eo pid,args | grep "[b]ina-mcp"`.

**Spec amendments (recorded in the spec in Task 1):**
1. Directory tools use `pg` + explicit SQL, not a second Prisma client (a second `prisma generate` would regenerate into the main app's `node_modules`).
2. CORS headers are open on all `/mcp` methods (same as gccdomestic) so browser MCP clients can connect; no auth exists so nothing is exposed by this.

---

## File structure

| Path | Responsibility |
|---|---|
| `mcp-server/package.json` | own deps + `start`/`test` scripts |
| `mcp-server/lib/phone.mjs` | `normPhone`, `maskPhone` |
| `mcp-server/lib/limiter.mjs` | sliding-window limiter with injectable clock |
| `mcp-server/lib/idem.mjs` | deterministic idempotency key |
| `mcp-server/lib/rideApi.mjs` | HTTP client for the ride API (timeouts, error classes) |
| `mcp-server/lib/env.mjs` | reads `DATABASE_URL` from `../.env`, strips `?schema=` |
| `mcp-server/lib/html.mjs` | `htmlToText`, `titleOf`, `descriptionOf` |
| `mcp-server/tools/ride.mjs` | `registerRideTools(server, { api, wrap })` |
| `mcp-server/tools/directory.mjs` | `registerDirectoryTools(server, { db, wrap })` |
| `mcp-server/tools/guides.mjs` | `loadGuides(publicDir)`, `registerGuideTools(server, { guides, wrap })` |
| `mcp-server/server.mjs` | `buildServer(ctx)`, `createApp(deps)`, `main()` |
| `mcp-server/docs.md` | human page for `GET /mcp` |
| `mcp-server/test/*.test.mjs` | tests (fixtures in `test/fixtures/`) |
| `public/.well-known/mcp-registry-auth` | registry domain proof |
| `public/llms.txt` | + developer-resources line |
| `/etc/nginx/sites-enabled/bina.et.conf` | + two locations |
| `README.md` | + MCP section |

---

### Task 1: Scaffold the package and record the spec amendments

**Files:**
- Create: `mcp-server/package.json`, `mcp-server/.gitignore`
- Modify: `docs/superpowers/specs/2026-09-03-binasmart-mcp-server-design.md` (append)

- [ ] **Step 1: Create the package**

```bash
cd /var/www/connectcare/binasmart && mkdir -p mcp-server/lib mcp-server/tools mcp-server/test/fixtures public/.well-known
cat > mcp-server/package.json <<'EOF'
{
  "name": "binasmart-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Public MCP server for BinaSmart (bina.et): quote and book rides in Addis Ababa, search the building/shop directory, read the Digital Ethiopia guides.",
  "main": "server.mjs",
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "zod": "^3.24.0"
  }
}
EOF
printf 'node_modules\n' > mcp-server/.gitignore
cd mcp-server && npm install --no-audit --no-fund 2>&1 | tail -3
```
Expected: `added N packages` and no ERR lines. Confirm: `node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.log(typeof m.McpServer))"` prints `function`.

- [ ] **Step 2: Append the amendments to the spec**

```bash
cd /var/www/connectcare/binasmart && cat >> docs/superpowers/specs/2026-09-03-binasmart-mcp-server-design.md <<'EOF'

## 9. Amendments (2026-09-03, planning)
1. Directory tools use the `pg` driver with explicit SQL and column lists instead of a second Prisma client — a second `prisma generate` against `../prisma/schema.prisma` would write into the main app's `node_modules`. Same read-only guarantee, no shared build artefacts.
2. CORS headers are open on every `/mcp` method (as on gccdomestic's server) so browser-based MCP clients can connect. The server has no auth and no secrets in responses, so this exposes nothing extra.
EOF
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/package.json mcp-server/package-lock.json mcp-server/.gitignore docs/superpowers/specs/2026-09-03-binasmart-mcp-server-design.md && git commit -q -m "feat(mcp): scaffold BinaSmart MCP server package" && git log --oneline -1
```

---

### Task 2: Phone normalisation and masking

**Files:**
- Create: `mcp-server/lib/phone.mjs`, `mcp-server/test/phone.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// mcp-server/test/phone.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPhone, maskPhone } from '../lib/phone.mjs';

test('normPhone accepts the three Ethiopian forms', () => {
  assert.equal(normPhone('0911244344'), '+251911244344');
  assert.equal(normPhone('+251 911 244 344'), '+251911244344');
  assert.equal(normPhone('251911244344'), '+251911244344');
  assert.equal(normPhone('0711244344'), '+251711244344');
});

test('normPhone rejects short, foreign and empty', () => {
  assert.equal(normPhone('091124434'), null);
  assert.equal(normPhone('+254711244344'), null);
  assert.equal(normPhone(''), null);
  assert.equal(normPhone(undefined), null);
});

test('maskPhone keeps only the last 3 digits', () => {
  assert.equal(maskPhone('+251911244344'), '+251•••••••344');
  assert.equal(maskPhone(null), '-');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /var/www/connectcare/binasmart/mcp-server && node --test`
Expected: FAIL, `Cannot find module '../lib/phone.mjs'`.

- [ ] **Step 3: Implement**

```js
// mcp-server/lib/phone.mjs
// Same rules as ride/routes.js normPhone: 09XXXXXXXX | 251XXXXXXXXX | +251XXXXXXXXX → +251XXXXXXXXX
export function normPhone(s) {
  s = String(s || '').replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1);
  if (/^251\d{9}$/.test(s)) s = '+' + s;
  return /^\+251\d{9}$/.test(s) ? s : null;
}

export function maskPhone(s) {
  if (!s) return '-';
  s = String(s);
  return s.slice(0, 4) + '•'.repeat(Math.max(0, s.length - 7)) + s.slice(-3);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/lib/phone.mjs mcp-server/test/phone.test.mjs && git commit -q -m "feat(mcp): phone normalisation + masking" && git log --oneline -1
```

---

### Task 3: Per-caller limiter and idempotency key

**Files:**
- Create: `mcp-server/lib/limiter.mjs`, `mcp-server/lib/idem.mjs`, `mcp-server/test/limiter.test.mjs`, `mcp-server/test/idem.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// mcp-server/test/limiter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter } from '../lib/limiter.mjs';

test('allows max hits inside the window, then blocks, then resets', () => {
  let now = 1_000_000;
  const rl = makeLimiter(60_000, 3, () => now);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), true);
  assert.equal(rl('a'), false);
  assert.equal(rl('b'), true, 'other keys are independent');
  now += 60_001;
  assert.equal(rl('a'), true, 'window expired');
});
```

```js
// mcp-server/test/idem.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idemKey } from '../lib/idem.mjs';

const from = { lat: 9.01081, lng: 38.75782 }, to = { lat: 9.03451, lng: 38.75011 };

test('stable inside a 10-minute bucket, different across buckets', () => {
  const t0 = 1_700_000_000_000; // arbitrary epoch ms
  const a = idemKey('+251911244344', from, to, t0);
  const b = idemKey('+251911244344', from, to, t0 + 5 * 60_000);
  const c = idemKey('+251911244344', from, to, t0 + 11 * 60_000);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[a-f0-9]{40}$/);
});

test('tiny coordinate jitter (<0.00005°) does not change the key; a different phone does', () => {
  const t0 = 1_700_000_000_000;
  const a = idemKey('+251911244344', from, to, t0);
  const b = idemKey('+251911244344', { lat: 9.01083, lng: 38.75784 }, to, t0);
  const c = idemKey('+251911244345', from, to, t0);
  assert.equal(a, b);
  assert.notEqual(a, c);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test`
Expected: FAIL with `Cannot find module '../lib/limiter.mjs'` and `'../lib/idem.mjs'`.

- [ ] **Step 3: Implement**

```js
// mcp-server/lib/limiter.mjs
// Sliding window: allows `max` hits per `windowMs` per key. `now` is injectable for tests.
export function makeLimiter(windowMs, max, now = Date.now) {
  const m = new Map();
  return key => {
    const t = now();
    const hits = (m.get(key) || []).filter(x => t - x < windowMs);
    if (hits.length >= max) { m.set(key, hits); return false; }
    hits.push(t); m.set(key, hits);
    if (m.size > 5000) for (const [k, v] of m) { if (!v.length || t - v[v.length - 1] > windowMs) m.delete(k); }
    return true;
  };
}
```

```js
// mcp-server/lib/idem.mjs
import { createHash } from 'node:crypto';
// Same rider + same pickup/dropoff (to ~10 m) inside the same 10-minute bucket → same key,
// so an assistant retrying or looping "confirm? yes" cannot create two rides. The ride API
// stores idemKey UNIQUE and returns the existing ride with duplicate:true.
export function idemKey(phone, from, to, nowMs = Date.now()) {
  const r = n => Number(n).toFixed(4);
  const s = `${phone}|${r(from.lat)},${r(from.lng)}|${r(to.lat)},${r(to.lng)}|${Math.floor(nowMs / 600_000)}`;
  return createHash('sha1').update(s).digest('hex');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/lib/limiter.mjs mcp-server/lib/idem.mjs mcp-server/test/limiter.test.mjs mcp-server/test/idem.test.mjs && git commit -q -m "feat(mcp): per-caller limiter + deterministic idempotency key" && git log --oneline -1
```

---

### Task 4: Guide HTML → text

**Files:**
- Create: `mcp-server/lib/html.mjs`, `mcp-server/tools/guides.mjs`, `mcp-server/test/fixtures/guide.html`, `mcp-server/test/guides.test.mjs`

- [ ] **Step 1: Write the fixture and the failing test**

```html
<!-- mcp-server/test/fixtures/guide.html -->
<!doctype html><html><head>
<title>TIN — how to get one | BinaSmart</title>
<meta name="description" content="Ten-digit tax ID: documents, steps, fees.">
<style>.x{color:red}</style>
<script>console.log('nope')</script>
</head><body>
<nav><a href="/">Home</a> <a href="/guides">Guides</a></nav>
<h1>TIN registration</h1>
<section><h2>Documents</h2><p>Bring your <strong>Fayda</strong> &amp; a passport photo.</p>
<ul><li>Fayda ID</li><li>Photo</li></ul></section>
<section><h2>Fee</h2><p>Free of charge.<br>Takes 1&nbsp;day.</p></section>
<footer>© BinaSmart</footer>
</body></html>
```

```js
// mcp-server/test/guides.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToText, titleOf, descriptionOf } from '../lib/html.mjs';
import { loadGuides } from '../tools/guides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, 'fixtures');

test('htmlToText strips nav/script/style/footer and keeps headings, paragraphs, lists', async () => {
  const { readFile } = await import('node:fs/promises');
  const t = htmlToText(await readFile(path.join(fx, 'guide.html'), 'utf8'));
  assert.equal(t.includes('Home'), false);
  assert.equal(t.includes('console.log'), false);
  assert.equal(t.includes('color:red'), false);
  assert.equal(t.includes('© BinaSmart'), false);
  assert.match(t, /^# TIN registration/m);
  assert.match(t, /^## Documents/m);
  assert.match(t, /Bring your Fayda & a passport photo\./);
  assert.match(t, /^- Fayda ID\n- Photo/m);
  assert.match(t, /Free of charge\.\nTakes 1 day\./);
});

test('titleOf / descriptionOf', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(path.join(fx, 'guide.html'), 'utf8');
  assert.equal(titleOf(html), 'TIN — how to get one');
  assert.equal(descriptionOf(html), 'Ten-digit tax ID: documents, steps, fees.');
});

test('loadGuides reads slug.html files, skips missing ones, caps text', async () => {
  const guides = await loadGuides(fx, ['guide', 'does-not-exist'], 60);
  assert.equal(guides.size, 1);
  const g = guides.get('guide');
  assert.equal(g.title, 'TIN — how to get one');
  assert.equal(g.summary, 'Ten-digit tax ID: documents, steps, fees.');
  assert.equal(g.url, 'https://bina.et/guide');
  assert.ok(g.text.length <= 60 + 20, 'capped (plus the truncation marker)');
  assert.match(g.text, /…\[truncated\]$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module '../lib/html.mjs'`.

- [ ] **Step 3: Implement**

```js
// mcp-server/lib/html.mjs
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8217': '’', '#8220': '“', '#8221': '”', '#8211': '–', '#8212': '—' };
export function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENT[e] !== undefined) return ENT[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

// Guide pages are hand-written HTML: <nav>, <section>/<h2>/<p>/<ul>, <footer>, a few <script>s.
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<(script|style|nav|footer|header|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|li)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  s = s.split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function titleOf(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]).replace(/\s*\|\s*BinaSmart\s*$/i, '').trim() : '';
}

export function descriptionOf(html) {
  const m = /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i.exec(html);
  return m ? decode(m[1]).trim() : '';
}
```

```js
// mcp-server/tools/guides.mjs
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { htmlToText, titleOf, descriptionOf } from '../lib/html.mjs';

export const BASE = 'https://bina.et';

// One entry per guide route in server.js (static HTML in public/). Order = display order.
export const GUIDE_SLUGS = [
  'fayda', 'telebirr', 'cbe-birr-guide', 'passport', 'ethiopia-evisa', 'telesign', 'mesob',
  'tin-registration-ethiopia', 'business-registration-ethiopia', 'how-to-start-a-business-in-ethiopia',
  'vat-registration-ethiopia', 'customs-import-duty-ethiopia', 'import-car-to-ethiopia',
  'driving-licence-ethiopia', 'ethiopian-origin-id-yellow-card', 'open-bank-account-ethiopia',
  'birth-marriage-certificate-ethiopia', 'pay-utility-bills-ethiopia', 'rental-agreement-ethiopia',
  'tenant-screening-ethiopia', 'living-working-in-ethiopia-guide', 'digital-ethiopia-2026',
];
export const TEXT_CAP = 12_000;

export async function loadGuides(publicDir, slugs = GUIDE_SLUGS, cap = TEXT_CAP) {
  const out = new Map();
  for (const slug of slugs) {
    let html;
    try { html = await readFile(path.join(publicDir, slug + '.html'), 'utf8'); } catch { continue; }
    let text = htmlToText(html);
    if (text.length > cap) text = text.slice(0, cap) + '…[truncated]';
    out.set(slug, { slug, title: titleOf(html) || slug, summary: descriptionOf(html), url: `${BASE}/${slug}`, text });
  }
  return out;
}

export function guideIndex(guides) {
  return [...guides.values()].map(g => ({ slug: g.slug, title: g.title, summary: g.summary, url: g.url }));
}

export function registerGuideTools(server, { guides, wrap, json }) {
  server.registerTool('get_ethiopia_guide', {
    title: 'Digital Ethiopia guide',
    description: 'BinaSmart\'s bilingual (Amharic + English) step-by-step guides to Ethiopian government and banking services: Fayda ID, telebirr, CBE Birr, e-Passport, eVisa, TIN, business licence, VAT/TOT, customs, driving licence, car import, Yellow Card, bank account, birth/marriage certificate, utility bills, rental agreements, tenant screening. Call with no slug to list guides; call with a slug for the full text. The guides hold the correct official names and links — prefer them over guessing.',
    inputSchema: { slug: z.string().optional().describe('Guide slug from the list, e.g. tin-registration-ethiopia') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_ethiopia_guide', async ({ slug }) => {
    const g = slug && guides.get(String(slug).trim().toLowerCase());
    if (!g) return json({ guides: guideIndex(guides), note: slug ? `Unknown slug "${slug}" — pick one from this list.` : 'Call again with a slug for the full guide.' });
    return json({ slug: g.slug, title: g.title, summary: g.summary, source_url: g.url, text: g.text });
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Sanity-check extraction against one real guide**

Run: `cd /var/www/connectcare/binasmart/mcp-server && node -e "import('./tools/guides.mjs').then(async m=>{const g=await m.loadGuides('../public');console.log('guides:',g.size);const t=g.get('tin-registration-ethiopia');console.log(t.title);console.log(t.text.slice(0,600))})"`
Expected: `guides: 22`, the TIN title, and readable text starting with `# …` and no `<` characters or `function(` fragments. If a `<script>` body leaks, the file uses `<script type=…>` with attributes across lines — the regex already allows attributes; report what leaked and extend the strip list, do not skip.

- [ ] **Step 6: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/lib/html.mjs mcp-server/tools/guides.mjs mcp-server/test/fixtures/guide.html mcp-server/test/guides.test.mjs && git commit -q -m "feat(mcp): guide HTML→text extraction + get_ethiopia_guide tool" && git log --oneline -1
```

---

### Task 5: Ride API client

**Files:**
- Create: `mcp-server/lib/rideApi.mjs`, `mcp-server/test/rideApi.test.mjs`

- [ ] **Step 1: Write the failing test (uses a local HTTP stub, never the live API)**

```js
// mcp-server/test/rideApi.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeRideApi, RideApiError } from '../lib/rideApi.mjs';

// Stub ride API: path decides the behaviour.
const seen = [];
const stub = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: body && JSON.parse(body) });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url.startsWith('/api/ride/search')) return send(200, { ok: true, results: [{ kind: 'building', label: 'Edna Mall', labelAm: 'ኤድና ሞል', sub: 'Bole', lat: 9.0, lng: 38.78, slug: 'edna' }] });
    if (req.url === '/api/ride/quote') return send(200, { ok: true, distanceM: 5200, durationS: 900, estimate: false, geometry: [[1, 2]], quotes: [{ tier: 'economy', fareEtb: 250, driverTakeEtb: 212, km: 5.2, etaMin: 15, label: 'Economy', labelAm: 'ኢኮኖሚ', icon: '🚗', seats: 4 }] });
    if (req.url === '/api/ride/request') return send(200, { ok: true, ride: { id: 'r1', status: 'dispatching', fareEtb: 250 } });
    if (req.url === '/api/ride/r400/cancel') return send(400, { ok: false, error: 'bad thing' });
    if (req.url === '/api/ride/r429/cancel') return send(429, { ok: false, error: 'slow_down' });
    if (req.url === '/api/ride/r500/cancel') return send(500, { ok: false });
    if (req.url === '/api/ride/slow/cancel') return; // never answers → timeout
    if (req.url.startsWith('/api/ride/r1?phone=')) return send(200, { ok: true, ride: { id: 'r1', status: 'assigned' } });
    send(404, { ok: false, error: 'not_found' });
  });
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${stub.address().port}`;
after(() => stub.close());

test('search / quote / status / cancel round-trip', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 500 });
  const s = await api.search('edna');
  assert.equal(s.results[0].label, 'Edna Mall');
  const q = await api.quote({ lat: 9, lng: 38.7 }, { lat: 9.03, lng: 38.75 });
  assert.equal(q.quotes[0].fareEtb, 250);
  const st = await api.status('r1', '+251911244344');
  assert.equal(st.ride.status, 'assigned');
  assert.equal(seen.at(-1).url, '/api/ride/r1?phone=%2B251911244344');
});

test('request sends synthetic X-Real-IP derived from the phone', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 500 });
  await api.request({ tier: 'economy', pickup: { lat: 9, lng: 38.7 }, dropoff: { lat: 9.03, lng: 38.75 }, riderName: 'Test', riderPhone: '+251911244344', paymentMethod: 'cash', idemKey: 'k' });
  const h = seen.at(-1).headers;
  assert.match(h['x-real-ip'], /^mcp-[a-f0-9]{12}$/);
  const again = await api.request({ tier: 'economy', pickup: { lat: 9, lng: 38.7 }, dropoff: { lat: 9.03, lng: 38.75 }, riderName: 'Test', riderPhone: '+251911244344', paymentMethod: 'cash', idemKey: 'k' });
  assert.equal(seen.at(-1).headers['x-real-ip'], h['x-real-ip'], 'same phone → same synthetic IP');
  assert.equal(again.ride.id, 'r1');
});

test('non-2xx becomes RideApiError with status and API message; timeout/network too', async () => {
  const api = makeRideApi({ baseUrl: base, timeoutMs: 300 });
  await assert.rejects(api.cancel('r400', '+251911244344'), e => e instanceof RideApiError && e.status === 400 && e.message === 'bad thing');
  await assert.rejects(api.cancel('r429', '+251911244344'), e => e.status === 429);
  await assert.rejects(api.cancel('r500', '+251911244344'), e => e.status === 500);
  await assert.rejects(api.cancel('slow', '+251911244344'), e => e instanceof RideApiError && e.status === 0 && e.kind === 'timeout');
  const dead = makeRideApi({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 300 });
  await assert.rejects(dead.search('x'), e => e instanceof RideApiError && e.status === 0 && e.kind === 'network');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module '../lib/rideApi.mjs'`.

- [ ] **Step 3: Implement**

```js
// mcp-server/lib/rideApi.mjs
import { createHash } from 'node:crypto';

export class RideApiError extends Error {
  constructor(message, { status = 0, kind = 'http', body = null } = {}) { super(message); this.status = status; this.kind = kind; this.body = body; }
}

// The ride API keys its per-caller limits on X-Real-IP (set by nginx for internet traffic).
// We talk to it directly on localhost, so we set a synthetic, phone-derived value: the
// 5-requests-per-10-min-per-phone rule then governs bookings coming through assistants.
export function syntheticIp(phone) {
  return 'mcp-' + createHash('sha1').update(String(phone)).digest('hex').slice(0, 12);
}

export function makeRideApi({ baseUrl, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  async function call(method, path, { body, phone } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res, text;
    try {
      const headers = { accept: 'application/json' };
      if (body) headers['content-type'] = 'application/json';
      if (phone) headers['x-real-ip'] = syntheticIp(phone);
      res = await fetchImpl(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      text = await res.text();
    } catch (e) {
      throw new RideApiError(e.name === 'AbortError' ? 'timeout' : 'network', { kind: e.name === 'AbortError' ? 'timeout' : 'network' });
    } finally { clearTimeout(timer); }
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) throw new RideApiError((json && json.error) || `HTTP ${res.status}`, { status: res.status, body: json });
    return json;
  }
  const enc = encodeURIComponent;
  return {
    search: (q, bias) => call('GET', `/api/ride/search?q=${enc(q)}` + (bias ? `&lat=${bias.lat}&lng=${bias.lng}` : '')),
    quote: (pickup, dropoff) => call('POST', '/api/ride/quote', { body: { pickup, dropoff } }),
    request: b => call('POST', '/api/ride/request', { body: b, phone: b.riderPhone }),
    status: (id, phone) => call('GET', `/api/ride/${enc(id)}?phone=${enc(phone)}`),
    cancel: (id, phone) => call('POST', `/api/ride/${enc(id)}/cancel`, { body: { phone }, phone }),
    settings: () => call('GET', '/api/ride/settings'),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 12`, `# fail 0`, total under 3 s (the timeout test waits 300 ms).

- [ ] **Step 5: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/lib/rideApi.mjs mcp-server/test/rideApi.test.mjs && git commit -q -m "feat(mcp): ride API client with timeouts and phone-derived X-Real-IP" && git log --oneline -1
```

---

### Task 6: Ride tools

**Files:**
- Create: `mcp-server/tools/ride.mjs`, `mcp-server/test/ride-tools.test.mjs`

- [ ] **Step 1: Verify the tier names the ride API accepts**

Run: `cd /var/www/connectcare/binasmart && node -e "console.log(require('./ride/fare').TIERS)" 2>&1 | grep -v Aborted`
Expected: an array of 5 strings. If it is **not** `[ 'moto', 'bajaj', 'economy', 'comfort', 'xl' ]`, use the printed names in `TIERS` below.

- [ ] **Step 2: Write the failing test (fake api object, no HTTP)**

```js
// mcp-server/test/ride-tools.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RideApiError } from '../lib/rideApi.mjs';
import { parsePlace, resolvePlace, registerRideTools } from '../tools/ride.mjs';

const json = d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
const wrap = (_n, fn) => fn;
const out = r => JSON.parse(r.content[0].text);

function fakeApi(over = {}) {
  return {
    search: async q => ({ ok: true, results: q === 'edna' ? [{ kind: 'building', label: 'Edna Mall', labelAm: 'ኤድና ሞል', sub: 'Bole', lat: 9.0, lng: 38.78 }]
      : q === 'bole' ? [{ label: 'Bole Medhanealem', lat: 9.01, lng: 38.79 }, { label: 'Bole Airport', lat: 8.98, lng: 38.8 }] : [] }),
    quote: async () => ({ ok: true, distanceM: 5200, durationS: 900, estimate: false, geometry: [[0, 0]], quotes: [{ tier: 'economy', fareEtb: 250, driverTakeEtb: 212, km: 5.2, etaMin: 15, label: 'Economy', labelAm: 'ኢኮኖሚ', icon: '🚗', seats: 4 }] }),
    request: async b => ({ ok: true, ride: { id: 'r1', status: 'dispatching', fareEtb: 250, tier: b.tier, pickup: b.pickup, dropoff: b.dropoff, driver: null } }),
    status: async () => ({ ok: true, ride: { id: 'r1', status: 'assigned', fareEtb: 250, driver: { name: 'Abel', phone: '+251900000000', plate: 'A12345', vehicle: 'white Toyota Vitz', rating: 4.9 } } }),
    cancel: async () => ({ ok: true, ride: { id: 'r1', status: 'cancelled' } }),
    ...over,
  };
}
function tools(api) {
  const reg = {};
  registerRideTools({ registerTool: (name, _def, fn) => { reg[name] = fn; } }, { api, wrap, json });
  return reg;
}

test('parsePlace: "lat,lng" → point, else null', () => {
  assert.deepEqual(parsePlace('9.0108, 38.7578'), { lat: 9.0108, lng: 38.7578 });
  assert.equal(parsePlace('Edna Mall'), null);
  assert.equal(parsePlace('50,50'), null, 'outside Addis box');
});

test('resolvePlace: unique hit → point; several → candidates; none → not_found', async () => {
  const api = fakeApi();
  const a = await resolvePlace(api, 'edna');
  assert.deepEqual(a, { ok: true, point: { lat: 9.0, lng: 38.78, label: 'Edna Mall' } });
  const b = await resolvePlace(api, 'bole');
  assert.equal(b.ok, false); assert.equal(b.candidates.length, 2);
  const c = await resolvePlace(api, 'zzz');
  assert.equal(c.ok, false); assert.equal(c.error, 'not_found');
  const d = await resolvePlace(api, '9.01,38.75');
  assert.equal(d.ok, true); assert.equal(d.point.label, '9.01000, 38.75000');
});

test('quote_ride returns fares without geometry/driverTake, or candidates when ambiguous', async () => {
  const t = tools(fakeApi());
  const r = out(await t.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' }));
  assert.equal(r.quotes[0].fare_etb, 250);
  assert.equal(r.quotes[0].driverTakeEtb, undefined);
  assert.equal(r.geometry, undefined);
  assert.equal(r.distance_km, 5.2);
  assert.equal(r.source_url, 'https://bina.et/ride');
  const amb = await t.quote_ride({ pickup: 'bole', dropoff: 'edna' });
  assert.equal(amb.isError, true);
  assert.match(amb.content[0].text, /Bole Medhanealem/);
});

test('request_ride validates phone and tier, books, returns tracking url', async () => {
  const t = tools(fakeApi());
  const bad = await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Sara', rider_phone: '12345' });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /\+251/);
  const badTier = await t.request_ride({ tier: 'limo', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Sara', rider_phone: '0911244344' });
  assert.equal(badTier.isError, true);
  const ok = out(await t.request_ride({ tier: 'economy', pickup: 'edna', dropoff: '9.03,38.75', rider_name: 'Sara', rider_phone: '0911244344' }));
  assert.equal(ok.ride_id, 'r1');
  assert.equal(ok.tracking_url, 'https://bina.et/ride?id=r1');
  assert.equal(ok.fare_etb, 250);
  assert.match(ok.next_step, /read the fare/i);
});

test('get_ride_status / cancel_ride pass phone through and map errors', async () => {
  const t = tools(fakeApi());
  const s = out(await t.get_ride_status({ ride_id: 'r1', rider_phone: '0911244344' }));
  assert.equal(s.status, 'assigned'); assert.equal(s.driver.plate, 'A12345');
  const c = out(await t.cancel_ride({ ride_id: 'r1', rider_phone: '0911244344' }));
  assert.equal(c.status, 'cancelled');
  const t2 = tools(fakeApi({ status: async () => { throw new RideApiError('not_found', { status: 404 }); } }));
  const nf = await t2.get_ride_status({ ride_id: 'zz', rider_phone: '0911244344' });
  assert.equal(nf.isError, true); assert.match(nf.content[0].text, /not found|phone/i);
  const t3 = tools(fakeApi({ quote: async () => { throw new RideApiError('network', { kind: 'network' }); } }));
  const down = await t3.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' });
  assert.equal(down.isError, true); assert.match(down.content[0].text, /temporarily unavailable/);
  const t4 = tools(fakeApi({ quote: async () => { throw new RideApiError('slow_down', { status: 429 }); } }));
  const slow = await t4.quote_ride({ pickup: 'edna', dropoff: '9.03,38.75' });
  assert.match(slow.content[0].text, /slow down/i);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module '../tools/ride.mjs'`.

- [ ] **Step 4: Implement**

```js
// mcp-server/tools/ride.mjs
import { z } from 'zod';
import { normPhone } from '../lib/phone.mjs';
import { idemKey } from '../lib/idem.mjs';
import { RideApiError } from '../lib/rideApi.mjs';

export const BASE = 'https://bina.et';
export const WHATSAPP = 'https://wa.me/251911244344';
export const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl']; // verified against ride/fare.js TIERS (Step 1)
const BOX = { minLat: 8.5, maxLat: 9.5, minLng: 38.4, maxLng: 39.2 }; // same as ride/routes.js point()

export function toolError(text) { return { content: [{ type: 'text', text }], isError: true }; }

export function parsePlace(s) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  if (lat < BOX.minLat || lat > BOX.maxLat || lng < BOX.minLng || lng > BOX.maxLng) return null;
  return { lat, lng };
}

// A place is "lat,lng" or a name. Names go through the ride API's search (directory first, then OSM).
// Exactly one hit, or a first hit whose label equals the query → use it. Several → hand back candidates.
export async function resolvePlace(api, text) {
  const q = String(text || '').trim();
  const p = parsePlace(q);
  if (p) return { ok: true, point: { ...p, label: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` } };
  if (q.length < 2) return { ok: false, error: 'not_found' };
  const r = await api.search(q);
  const hits = (r && r.results) || [];
  if (!hits.length) return { ok: false, error: 'not_found' };
  const pick = h => ({ ok: true, point: { lat: h.lat, lng: h.lng, label: h.label } });
  if (hits.length === 1 || hits[0].label.toLowerCase() === q.toLowerCase()) return pick(hits[0]);
  return { ok: false, candidates: hits.slice(0, 5).map(h => ({ name: h.label, name_am: h.labelAm || undefined, area: h.sub || undefined, coords: `${h.lat},${h.lng}` })) };
}

function apiErrorToTool(e, ctx) {
  if (!(e instanceof RideApiError)) throw e;
  if (e.status === 429) return toolError('Slow down — too many ride requests for this phone or session. Try again in a few minutes.');
  if (e.status === 404) return toolError(`Ride not found, or the phone does not match the ride ${ctx || ''}. Check both.`.trim());
  if (e.status === 409) return toolError('This ride can no longer be cancelled (it has already started or finished).');
  if (e.status >= 400 && e.status < 500) return toolError(`BinaSmart Ride rejected the request: ${e.message}`);
  return toolError(`BinaSmart Ride is temporarily unavailable — book at ${BASE}/ride or WhatsApp ${WHATSAPP}.`);
}

async function resolveBoth(api, pickup, dropoff) {
  const [a, b] = await Promise.all([resolvePlace(api, pickup), resolvePlace(api, dropoff)]);
  for (const [which, r, raw] of [['pickup', a, pickup], ['dropoff', b, dropoff]]) {
    if (r.ok) continue;
    if (r.candidates) return { err: toolError(`"${raw}" is ambiguous for the ${which}. Ask the user which one, then call again with its coords:\n` + r.candidates.map(c => `- ${c.name}${c.name_am ? ' / ' + c.name_am : ''}${c.area ? ' (' + c.area + ')' : ''} → ${c.coords}`).join('\n')) };
    return { err: toolError(`Could not find "${raw}" in Addis Ababa for the ${which}. Ask for a landmark, building or "lat,lng".`) };
  }
  return { from: a.point, to: b.point };
}

function pubQuote(q) { return { tier: q.tier, label: q.label, label_am: q.labelAm, seats: q.seats, fare_etb: q.fareEtb, eta_min: q.etaMin }; }
function pubRide(r) {
  return { ride_id: r.id, status: r.status, tier: r.tier, fare_etb: r.fareEtb, payment_method: r.paymentMethod, payment_status: r.paymentStatus,
    pickup: r.pickup && r.pickup.label, dropoff: r.dropoff && r.dropoff.label, requested_at: r.requestedAt, concierge: r.concierge,
    driver: r.driver ? { name: r.driver.name, phone: r.driver.phone, vehicle: r.driver.vehicle, plate: r.driver.plate, rating: r.driver.rating } : null,
    tracking_url: `${BASE}/ride?id=${r.id}` };
}

const placeDesc = which => `${which}: a place name in Addis Ababa (e.g. "Edna Mall", "Bole Airport", "Piassa") or "lat,lng" like "9.0108,38.7578".`;

export function registerRideTools(server, { api, wrap, json }) {
  server.registerTool('quote_ride', {
    title: 'Quote a BinaSmart ride',
    description: 'Fixed upfront price for a ride inside Addis Ababa, Ethiopia — no surge, cash or telebirr/Chapa. Returns distance, ETA and the fare for every vehicle tier (moto, bajaj, economy, comfort, XL). Call this before request_ride and read the fare to the user.',
    inputSchema: { pickup: z.string().min(2).max(120).describe(placeDesc('Pickup')), dropoff: z.string().min(2).max(120).describe(placeDesc('Drop-off')) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('quote_ride', async ({ pickup, dropoff }) => {
    try {
      const r = await resolveBoth(api, pickup, dropoff); if (r.err) return r.err;
      const q = await api.quote(r.from, r.to);
      return json({ pickup: r.from.label, dropoff: r.to.label, distance_km: Math.round(q.distanceM / 100) / 10, eta_min: Math.round(q.durationS / 60), estimate: !!q.estimate,
        quotes: q.quotes.map(pubQuote), note: 'Fixed price, no surge. Pay cash or telebirr/Chapa. Addis Ababa only.', pickup_coords: `${r.from.lat},${r.from.lng}`, dropoff_coords: `${r.to.lat},${r.to.lng}`, source_url: `${BASE}/ride` });
    } catch (e) { return apiErrorToTool(e); }
  }));

  server.registerTool('request_ride', {
    title: 'Book a BinaSmart ride',
    description: 'Books a ride in Addis Ababa at the fixed fare from quote_ride. ALWAYS confirm pickup, drop-off, tier, fare and the rider\'s Ethiopian phone number with the user before calling. A dispatcher assigns a driver; the rider is contacted on the phone given. Returns the ride id and a live tracking link.',
    inputSchema: {
      tier: z.enum(TIERS).describe('Vehicle tier from quote_ride'),
      pickup: z.string().min(2).max(120).describe(placeDesc('Pickup') + ' Prefer the pickup_coords from quote_ride.'),
      dropoff: z.string().min(2).max(120).describe(placeDesc('Drop-off') + ' Prefer the dropoff_coords from quote_ride.'),
      rider_name: z.string().min(1).max(60).describe('Rider\'s name'),
      rider_phone: z.string().min(9).max(20).describe('Ethiopian mobile: 09XXXXXXXX or +2519XXXXXXXX'),
      payment_method: z.enum(['cash', 'chapa']).optional().describe('cash (default) or chapa (telebirr/card link)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, wrap('request_ride', async ({ tier, pickup, dropoff, rider_name, rider_phone, payment_method }) => {
    const phone = normPhone(rider_phone);
    if (!phone) return toolError('rider_phone must be an Ethiopian mobile number: 09XXXXXXXX or +2519XXXXXXXX (10 digits after +251). Ask the user for it.');
    try {
      const r = await resolveBoth(api, pickup, dropoff); if (r.err) return r.err;
      const res = await api.request({ tier, pickup: r.from, dropoff: r.to, riderName: String(rider_name).trim(), riderPhone: phone, paymentMethod: payment_method || 'cash', idemKey: idemKey(phone, r.from, r.to) });
      const ride = pubRide(res.ride);
      return json({ ...ride, duplicate: !!res.duplicate,
        next_step: `Read the fare (${ride.fare_etb} ETB) and ride id back to the user. A BinaSmart dispatcher will call ${phone} to confirm the driver. Track at ${ride.tracking_url}.`,
        source_url: `${BASE}/ride`, whatsapp: WHATSAPP });
    } catch (e) { return apiErrorToTool(e); }
  }));

  server.registerTool('get_ride_status', {
    title: 'Ride status',
    description: 'Current status of a BinaSmart ride (dispatching, assigned, arriving, arrived, ontrip, completed, cancelled) with driver name, vehicle and plate once assigned. Needs the ride id and the rider phone used to book.',
    inputSchema: { ride_id: z.string().min(5).max(40), rider_phone: z.string().min(9).max(20) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_ride_status', async ({ ride_id, rider_phone }) => {
    const phone = normPhone(rider_phone);
    if (!phone) return toolError('rider_phone must be the Ethiopian number used to book (09XXXXXXXX or +2519XXXXXXXX).');
    try { const res = await api.status(ride_id, phone); return json({ ...pubRide(res.ride), source_url: `${BASE}/ride?id=${ride_id}` }); }
    catch (e) { return apiErrorToTool(e, ride_id); }
  }));

  server.registerTool('cancel_ride', {
    title: 'Cancel a ride',
    description: 'Cancels a BinaSmart ride that has not started yet. Confirm with the user first. Needs the ride id and the rider phone used to book.',
    inputSchema: { ride_id: z.string().min(5).max(40), rider_phone: z.string().min(9).max(20) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, wrap('cancel_ride', async ({ ride_id, rider_phone }) => {
    const phone = normPhone(rider_phone);
    if (!phone) return toolError('rider_phone must be the Ethiopian number used to book (09XXXXXXXX or +2519XXXXXXXX).');
    try { const res = await api.cancel(ride_id, phone); return json({ ...pubRide(res.ride), source_url: `${BASE}/ride` }); }
    catch (e) { return apiErrorToTool(e, ride_id); }
  }));
}
```

`TIERS` above matches the Step 1 output on 2026-09-03; if Step 1 printed something else, use that.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 17`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/tools/ride.mjs mcp-server/test/ride-tools.test.mjs && git commit -q -m "feat(mcp): quote_ride, request_ride, get_ride_status, cancel_ride tools" && git log --oneline -1
```

---

### Task 7: Directory tools (read-only SQL)

**Files:**
- Create: `mcp-server/lib/env.mjs`, `mcp-server/tools/directory.mjs`, `mcp-server/test/directory.test.mjs`

- [ ] **Step 1: Confirm the join columns exist in Postgres**

Run (from `mcp-server/`, deps installed in Task 1):
```bash
cd /var/www/connectcare/binasmart/mcp-server && node -e "
import('pg').then(async ({default:pg})=>{
 const url=require('fs').readFileSync('../.env','utf8').match(/^DATABASE_URL=\"?([^\"\n]+)/m)[1].replace(/\?schema=[^&]*&?/,'');
 const c=new pg.Client({connectionString:url});await c.connect();
 for(const t of ['Tenancy','Unit','Building','Shop','Event','EventTicket','RoomType','Department','Appointment']){
  const r=await c.query('select column_name from information_schema.columns where table_name=\$1 order by ordinal_position',[t]);
  console.log(t+':',r.rows.map(x=>x.column_name).join(','));}
 await c.end();})" 2>&1 | grep -v Aborted
```
Expected: `Tenancy:` includes `unitId,active`; `Unit:` includes `buildingId,number`; `Shop:` includes `tenancyId,category,phone,isOpenNow,avgRating,reviewCount`; `Event:` includes `slug,tiers,startsAt,active`; `EventTicket:` includes `eventId,tier,qty,status`; `RoomType:` includes `buildingId,pricePerNight,totalRooms,active`; `Department:` includes `buildingId,slotsPerDay,active`; `Appointment:` includes `buildingId,departmentId,date,status`. If any name differs, use the printed name in the SQL below.

- [ ] **Step 2: Write the failing test (fake `db.query`, no Postgres)**

```js
// mcp-server/test/directory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDirectoryTools, restaurantSlug } from '../tools/directory.mjs';

const json = d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
const wrap = (_n, fn) => fn;
const out = r => JSON.parse(r.content[0].text);

function fakeDb(handler) { return { query: async (sql, params) => ({ rows: handler(sql, params) }) }; }
function tools(db) { const reg = {}; registerDirectoryTools({ registerTool: (n, _d, f) => { reg[n] = f; } }, { db, wrap, json }); return reg; }

test('restaurantSlug matches the /restaurant/:slug lookup (dashes for spaces)', () => {
  assert.equal(restaurantSlug('Yod Abyssinia'), 'yod-abyssinia');
});

test('search_places merges buildings and shops, flags hotel/hospital, links pages', async () => {
  const db = fakeDb((sql, params) => {
    if (/FROM "Building" b\s+WHERE/.test(sql)) return [{ name: 'Skylight Hotel', nameAm: 'ስካይላይት', qrSlug: 'skylight', city: 'Addis Ababa', subCity: 'Bole', lat: 9.0, lng: 38.79, buildingType: 'HOTEL' }];
    if (/FROM "Shop" s/.test(sql)) return [{ name: 'Kaldis Coffee', nameAm: null, category: 'CAFE', phone: '0911000000', isOpenNow: true, avgRating: 4.5, reviewCount: 12, unit: 'G-01', building: 'Edna Mall', buildingAm: 'ኤድና', qrSlug: 'edna', lat: null, lng: null, buildingType: 'COMMERCIAL' }];
    return [];
  });
  const r = out(await tools(db).search_places({ query: 'ka', limit: 10 }));
  assert.equal(r.count, 2);
  const hotel = r.results.find(x => x.kind === 'building');
  assert.equal(hotel.is_hotel, true); assert.equal(hotel.is_hospital, false);
  assert.equal(hotel.url, 'https://bina.et/hotel/skylight');
  assert.deepEqual(hotel.coords, { lat: 9.0, lng: 38.79 });
  const shop = r.results.find(x => x.kind === 'shop');
  assert.equal(shop.url, 'https://bina.et/b/edna'); assert.equal(shop.coords, undefined);
  assert.equal(shop.category, 'cafe'); assert.equal(shop.building, 'Edna Mall'); assert.equal(shop.unit, 'G-01');
});

test('search_places: restaurant links to its menu page; category filter is passed as a param', async () => {
  let seenParams;
  const db = fakeDb((sql, params) => {
    if (/FROM "Shop" s/.test(sql)) { seenParams = params; return [{ name: 'Yod Abyssinia', category: 'RESTAURANT', phone: '0911', unit: '1', building: 'Bole', qrSlug: 'bole', buildingType: 'COMMERCIAL' }]; }
    return [];
  });
  const r = out(await tools(db).search_places({ query: 'yod', category: 'restaurant' }));
  assert.equal(r.results[0].url, 'https://bina.et/restaurant/yod-abyssinia');
  assert.ok(seenParams.includes('RESTAURANT'));
});

test('search_places rejects an unknown category', async () => {
  const r = await tools(fakeDb(() => [])).search_places({ query: 'x', category: 'zoo' });
  assert.equal(r.isError, true);
});

test('list_events computes price_from and seats_left', async () => {
  const db = fakeDb(sql => /FROM "Event"/.test(sql)
    ? [{ slug: 'jazz', title: 'Jazz Night', titleAm: null, type: 'CONCERT', venue: 'Skylight', city: 'Addis Ababa', startsAt: '2026-10-01T18:00:00Z', durationMin: 120, tiers: [{ name: 'VIP', price: 1500, seats: 50 }, { name: 'Regular', price: 500, seats: 200 }], sold: [{ tier: 'VIP', qty: 10 }] }]
    : []);
  const r = out(await tools(db).list_events({}));
  assert.equal(r.events[0].price_from_etb, 500);
  assert.equal(r.events[0].seats_left, 240);
  assert.equal(r.events[0].url, 'https://bina.et/events');
});

test('get_hotel_rooms and get_hospital_departments', async () => {
  const db = fakeDb((sql, params) => {
    if (/FROM "Building"\s+WHERE "qrSlug"/.test(sql)) return [{ id: 'b1', name: 'Skylight', nameAm: null, city: 'Addis Ababa', subCity: 'Bole', buildingType: params[0] === 'skylight' ? 'HOTEL' : 'HOSPITAL' }];
    if (/FROM "RoomType"/.test(sql)) return [{ name: 'Deluxe', nameAm: null, description: 'City view', pricePerNight: 4500, capacity: 2, amenities: ['wifi'], totalRooms: 10 }];
    if (/FROM "Department"/.test(sql)) return [{ id: 'd1', name: 'Cardiology', nameAm: null, floor: 2, room: '204', fee: 500, doctors: ['Dr A'], openHours: '8-17', slotsPerDay: 20 }];
    if (/FROM "Appointment"/.test(sql)) return [{ departmentId: 'd1', n: '5' }];
    return [];
  });
  const t = tools(db);
  const h = out(await t.get_hotel_rooms({ slug: 'skylight' }));
  assert.equal(h.rooms[0].price_per_night_etb, 4500); assert.equal(h.book_url, 'https://bina.et/hotel/skylight');
  const d = out(await t.get_hospital_departments({ slug: 'hosp', date: '2026-09-10' }));
  assert.equal(d.departments[0].slots_left, 15); assert.equal(d.book_url, 'https://bina.et/hospital/hosp');
  const nf = await t.get_hotel_rooms({ slug: 'nope' });
  assert.equal(nf.isError, true);
});

test('database failure → "directory unavailable" tool error, never a throw', async () => {
  const db = { query: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await tools(db).list_events({});
  assert.equal(r.isError, true); assert.match(r.content[0].text, /directory .*unavailable/i);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module '../tools/directory.mjs'`.

- [ ] **Step 4: Implement**

```js
// mcp-server/lib/env.mjs
import { readFileSync } from 'node:fs';
// Single source of secrets: the main app's .env. Only DATABASE_URL is read.
export function databaseUrl(envPath = new URL('../../.env', import.meta.url)) {
  const env = readFileSync(envPath, 'utf8');
  const m = env.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1].trim().replace(/[?&]schema=[^&]*/, '').replace(/\?$/, ''); // pg does not understand Prisma's ?schema=
}
```

```js
// mcp-server/tools/directory.mjs
import { z } from 'zod';
import { toolError } from './ride.mjs';

export const BASE = 'https://bina.et';
export const CATEGORIES = ['cafe', 'restaurant', 'pharmacy', 'retail', 'service', 'gym', 'salon', 'clinic', 'bank', 'office', 'other'];

export function restaurantSlug(name) { return String(name).trim().toLowerCase().replace(/\s+/g, '-'); }
const like = s => '%' + String(s).replace(/[%_\\]/g, m => '\\' + m) + '%';
const coords = r => (r.lat != null && r.lng != null) ? { lat: Number(r.lat), lng: Number(r.lng) } : undefined;

function buildingUrl(b) {
  if (b.buildingType === 'HOTEL') return `${BASE}/hotel/${b.qrSlug}`;
  if (b.buildingType === 'HOSPITAL') return `${BASE}/hospital/${b.qrSlug}`;
  return `${BASE}/b/${b.qrSlug}`;
}

// Every SELECT names its columns. Owner fields (TIN, bank accounts, ownerKey, tenant data) are never selected.
const SQL = {
  buildings: `SELECT name, "nameAm", "qrSlug", city, "subCity", lat, lng, "buildingType"
              FROM "Building" b
              WHERE (name ILIKE $1 OR "nameAm" LIKE $1) ORDER BY name LIMIT $2`,
  shops: `SELECT s.name, s."nameAm", s.category, s.phone, s."isOpenNow", s."avgRating", s."reviewCount",
                 u.number AS unit, b.name AS building, b."nameAm" AS "buildingAm", b."qrSlug", b.lat, b.lng, b."buildingType"
          FROM "Shop" s
          JOIN "Tenancy" t ON t.id = s."tenancyId"
          JOIN "Unit" u ON u.id = t."unitId"
          JOIN "Building" b ON b.id = u."buildingId"
          WHERE t.active = true AND ($1::text IS NULL OR s.name ILIKE $1 OR s."nameAm" LIKE $1) AND ($2::text IS NULL OR s.category::text = $2)
          ORDER BY s."avgRating" DESC, s.name LIMIT $3`,
  events: `SELECT e.slug, e.title, e."titleAm", e.type, e.venue, e.city, e.descr, e."startsAt", e."durationMin", e.tiers,
                  COALESCE((SELECT json_agg(json_build_object('tier', x.tier, 'qty', x.q)) FROM
                    (SELECT tier, SUM(qty) AS q FROM "EventTicket" WHERE "eventId" = e.id AND status <> 'CANCELLED' GROUP BY tier) x), '[]'::json) AS sold
           FROM "Event" e WHERE e.active = true AND e."startsAt" > now() ORDER BY e."startsAt" LIMIT 30`,
  building: `SELECT id, name, "nameAm", city, "subCity", "buildingType" FROM "Building" WHERE "qrSlug" = $1`,
  rooms: `SELECT name, "nameAm", description, "pricePerNight", capacity, amenities, "totalRooms" FROM "RoomType" WHERE "buildingId" = $1 AND active = true ORDER BY "pricePerNight"`,
  departments: `SELECT id, name, "nameAm", floor, room, fee, doctors, "openHours", "slotsPerDay" FROM "Department" WHERE "buildingId" = $1 AND active = true ORDER BY floor, name`,
  booked: `SELECT "departmentId", COUNT(*)::int AS n FROM "Appointment" WHERE "buildingId" = $1 AND status <> 'CANCELLED' AND date >= $2 AND date < $3 GROUP BY "departmentId"`,
};

export function registerDirectoryTools(server, { db, wrap, json }) {
  const guard = fn => async args => { try { return await fn(args); } catch (e) { console.error('[mcp/directory]', e.message); return toolError('The BinaSmart directory is temporarily unavailable. Try again shortly or browse https://bina.et.'); } };

  server.registerTool('search_places', {
    title: 'Search the BinaSmart directory',
    description: 'Find buildings, hotels, hospitals and shops in Addis Ababa listed on BinaSmart (bina.et): cafés, restaurants, pharmacies, banks, gyms, salons, clinics, offices. Returns names (English + Amharic), building and unit, phone for shops, coordinates when known (usable as pickup/dropoff for quote_ride), and the bina.et page. Hotels and hospitals are flagged — use get_hotel_rooms / get_hospital_departments for details.',
    inputSchema: {
      query: z.string().min(1).max(80).describe('Name or part of a name, English or Amharic'),
      category: z.string().optional().describe('Shop category filter: ' + CATEGORIES.join(' | ')),
      limit: z.number().int().min(1).max(25).optional().describe('Max results per kind (default 8)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('search_places', guard(async ({ query, category, limit }) => {
    const cat = category ? String(category).trim().toLowerCase() : null;
    if (cat && !CATEGORIES.includes(cat)) return toolError('Unknown category. Use one of: ' + CATEGORIES.join(', '));
    const lim = Math.min(limit || 8, 25);
    const [b, s] = await Promise.all([
      cat ? { rows: [] } : db.query(SQL.buildings, [like(query), lim]),
      db.query(SQL.shops, [like(query), cat ? cat.toUpperCase() : null, lim]),
    ]);
    const results = [
      ...b.rows.map(r => ({ kind: 'building', name: r.name, name_am: r.nameAm || undefined, city: r.city, sub_city: r.subCity || undefined,
        is_hotel: r.buildingType === 'HOTEL', is_hospital: r.buildingType === 'HOSPITAL', slug: r.qrSlug, coords: coords(r), url: buildingUrl(r) })),
      ...s.rows.map(r => ({ kind: 'shop', name: r.name, name_am: r.nameAm || undefined, category: String(r.category).toLowerCase(), phone: r.phone || undefined,
        open_now: r.isOpenNow, rating: r.reviewCount ? { average: Number(r.avgRating), count: r.reviewCount } : undefined,
        building: r.building, building_am: r.buildingAm || undefined, unit: r.unit, coords: coords(r),
        url: r.category === 'RESTAURANT' ? `${BASE}/restaurant/${restaurantSlug(r.name)}` : buildingUrl(r) })),
    ];
    return json({ count: results.length, results, note: results.length ? 'coords can be passed to quote_ride as "lat,lng".' : 'Nothing matched. Try a shorter query or a category.', source_url: `${BASE}/` });
  })));

  server.registerTool('list_events', {
    title: 'Upcoming events',
    description: 'Upcoming events on BinaSmart (concerts, cinema, festivals) in Addis Ababa with venue, start time, ticket price from and seats left. Tickets are bought at the link returned.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_events', guard(async () => {
    const { rows } = await db.query(SQL.events, []);
    const events = rows.map(e => {
      const tiers = Array.isArray(e.tiers) ? e.tiers : [];
      const sold = Object.fromEntries((e.sold || []).map(x => [x.tier, Number(x.qty) || 0]));
      const left = tiers.reduce((n, t) => n + Math.max(0, (t.seats || 0) - (sold[t.name] || 0)), 0);
      return { slug: e.slug, title: e.title, title_am: e.titleAm || undefined, type: e.type, venue: e.venue, city: e.city, description: e.descr || undefined,
        starts_at: e.startsAt, duration_min: e.durationMin, price_from_etb: tiers.length ? Math.min(...tiers.map(t => t.price)) : undefined,
        seats_left: left, tiers: tiers.map(t => ({ name: t.name, price_etb: t.price, seats_left: Math.max(0, (t.seats || 0) - (sold[t.name] || 0)) })), url: `${BASE}/events` };
    });
    return json({ count: events.length, events, source_url: `${BASE}/events` });
  })));

  server.registerTool('get_hotel_rooms', {
    title: 'Hotel rooms and prices',
    description: 'Room types, nightly prices (ETB), capacity and amenities for a hotel listed on BinaSmart. Use the slug from search_places (is_hotel = true).',
    inputSchema: { slug: z.string().min(1).max(60).describe('Hotel slug from search_places') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_hotel_rooms', guard(async ({ slug }) => {
    const b = (await db.query(SQL.building, [slug])).rows[0];
    if (!b) return toolError(`No hotel with slug "${slug}". Find it with search_places first.`);
    const { rows } = await db.query(SQL.rooms, [b.id]);
    if (!rows.length) return toolError(`"${b.name}" has no bookable rooms on BinaSmart.`);
    return json({ hotel: { name: b.name, name_am: b.nameAm || undefined, city: b.city, sub_city: b.subCity || undefined },
      rooms: rows.map(r => ({ name: r.name, name_am: r.nameAm || undefined, description: r.description || undefined, price_per_night_etb: r.pricePerNight, capacity: r.capacity, amenities: r.amenities || [], total_rooms: r.totalRooms })),
      book_url: `${BASE}/hotel/${slug}`, source_url: `${BASE}/hotel/${slug}` });
  })));

  server.registerTool('get_hospital_departments', {
    title: 'Hospital departments and slots',
    description: 'Departments of a hospital listed on BinaSmart with consultation fee (ETB), doctors, hours, floor/room and appointment slots left for a date. Use the slug from search_places (is_hospital = true).',
    inputSchema: { slug: z.string().min(1).max(60).describe('Hospital slug from search_places'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD (default today)') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_hospital_departments', guard(async ({ slug, date }) => {
    const b = (await db.query(SQL.building, [slug])).rows[0];
    if (!b) return toolError(`No hospital with slug "${slug}". Find it with search_places first.`);
    const day = date || new Date().toISOString().slice(0, 10);
    const next = new Date(day + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    const [deps, booked] = await Promise.all([db.query(SQL.departments, [b.id]), db.query(SQL.booked, [b.id, day, next.toISOString().slice(0, 10)])]);
    if (!deps.rows.length) return toolError(`"${b.name}" has no departments listed on BinaSmart.`);
    const used = Object.fromEntries(booked.rows.map(r => [r.departmentId, Number(r.n)]));
    return json({ hospital: { name: b.name, name_am: b.nameAm || undefined, city: b.city, sub_city: b.subCity || undefined }, date: day,
      departments: deps.rows.map(d => ({ name: d.name, name_am: d.nameAm || undefined, floor: d.floor, room: d.room || undefined, fee_etb: d.fee ?? undefined, doctors: d.doctors || [], hours: d.openHours || undefined, slots_left: Math.max(0, d.slotsPerDay - (used[d.id] || 0)) })),
      book_url: `${BASE}/hospital/${slug}`, source_url: `${BASE}/hospital/${slug}` });
  })));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 24`, `# fail 0`.

- [ ] **Step 6: Run the real SQL once against the live DB (read-only)**

```bash
cd /var/www/connectcare/binasmart/mcp-server && node -e "
Promise.all([import('pg'),import('./lib/env.mjs'),import('./tools/directory.mjs')]).then(async([{default:pg},env,dir])=>{
 const pool=new pg.Pool({connectionString:env.databaseUrl(),max:2});
 const reg={};dir.registerDirectoryTools({registerTool:(n,_d,f)=>reg[n]=f},{db:pool,wrap:(_n,f)=>f,json:d=>({content:[{type:'text',text:JSON.stringify(d)}]})});
 for(const [n,a] of [['search_places',{query:'ed'}],['search_places',{query:'a',category:'restaurant',limit:3}],['list_events',{}]]){const r=await reg[n](a);console.log(n,r.isError?'ERROR '+r.content[0].text:r.content[0].text.slice(0,300));}
 const s=JSON.parse((await reg.search_places({query:'hotel'})).content[0].text).results.find(x=>x.is_hotel); if(s){console.log('hotel',(await reg.get_hotel_rooms({slug:s.slug})).content[0].text.slice(0,200));}
 const h=JSON.parse((await reg.search_places({query:'hospital'})).content[0].text).results.find(x=>x.is_hospital); if(h){console.log('hospital',(await reg.get_hospital_departments({slug:h.slug})).content[0].text.slice(0,200));}
 await pool.end();})" 2>&1 | grep -v Aborted
```
Expected: JSON for each call, no `ERROR`. If a column name error appears (`column "x" does not exist`), fix the SQL to the name printed in Step 1 and re-run the tests.

- [ ] **Step 7: Commit**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/lib/env.mjs mcp-server/tools/directory.mjs mcp-server/test/directory.test.mjs && git commit -q -m "feat(mcp): search_places, list_events, get_hotel_rooms, get_hospital_departments (read-only SQL)" && git log --oneline -1
```

---

### Task 8: Server, transport, docs, protocol smoke test

**Files:**
- Create: `mcp-server/server.mjs`, `mcp-server/docs.md`, `mcp-server/test/server.test.mjs`

- [ ] **Step 1: Write the failing protocol test**

```js
// mcp-server/test/server.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const guides = new Map([['fayda', { slug: 'fayda', title: 'Fayda', summary: 'ID', url: 'https://bina.et/fayda', text: '# Fayda\nHello' }]]);
const db = { query: async () => ({ rows: [] }) };
const api = { search: async () => ({ ok: true, results: [] }), quote: async () => ({}), request: async () => ({}), status: async () => ({}), cancel: async () => ({}), settings: async () => ({ ok: true }) };
const app = createApp({ rideApi: api, db, guides, callLimit: { windowMs: 60_000, max: 3 } });
const srv = app.listen(0, '127.0.0.1');
await new Promise(r => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/mcp`;
after(() => srv.close());

async function rpc(method, params, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const text = await res.text();
  const line = text.split('\n').find(l => l.startsWith('data:'));
  return JSON.parse(line ? line.slice(5) : text);
}

test('GET /mcp serves markdown docs; /mcp/health answers', async () => {
  const r = await fetch(url); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /markdown/);
  assert.match(await r.text(), /BinaSmart/);
  const h = await fetch(url + '/health'); assert.equal(h.status, 200); assert.deepEqual(await h.json(), { ok: true, db: true, ride_api: true });
});

test('initialize + tools/list exposes exactly the 9 tools with annotations', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'binasmart');
  assert.match(init.result.instructions, /Addis Ababa/);
  const list = await rpc('tools/list', {});
  const names = list.result.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['cancel_ride', 'get_ethiopia_guide', 'get_hospital_departments', 'get_hotel_rooms', 'get_ride_status', 'list_events', 'quote_ride', 'request_ride', 'search_places']);
  const req = list.result.tools.find(t => t.name === 'request_ride');
  assert.equal(req.annotations.readOnlyHint, false);
  assert.equal(list.result.tools.find(t => t.name === 'cancel_ride').annotations.destructiveHint, true);
});

test('tools/call runs a tool; per-caller limit returns a tool error after max calls', async () => {
  const h = { 'mcp-session-id': 'sess-A' };
  const r1 = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: { slug: 'fayda' } }, h);
  assert.match(r1.result.content[0].text, /"title":"Fayda"/);
  await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  const r4 = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, h);
  assert.equal(r4.result.isError, true); assert.match(r4.result.content[0].text, /slow down/i);
  const other = await rpc('tools/call', { name: 'get_ethiopia_guide', arguments: {} }, { 'mcp-session-id': 'sess-B' });
  assert.notEqual(other.result.isError, true, 'independent caller unaffected');
});

test('invalid arguments are rejected before the handler runs', async () => {
  const r = await rpc('tools/call', { name: 'quote_ride', arguments: { pickup: 'x' } }, { 'mcp-session-id': 'sess-C' });
  assert.ok(r.error || r.result.isError, 'zod rejects missing dropoff');
  assert.match(JSON.stringify(r), /dropoff/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test`
Expected: FAIL, `Cannot find module '../server.mjs'`.

- [ ] **Step 3: Write docs.md**

```markdown
<!-- mcp-server/docs.md -->
# BinaSmart MCP server

**Endpoint:** `https://bina.et/mcp` (Streamable HTTP, stateless, no auth) · **Health:** `https://bina.et/mcp/health`

BinaSmart (bina.et) is Ethiopia's all-in-one digital platform: fixed-price ride-hailing in Addis Ababa, a directory of buildings, hotels, hospitals and shops, events, and bilingual Digital Ethiopia guides. This server lets AI assistants (Claude, ChatGPT, Gemini) use it.

## Tools
| Tool | What it does | Writes? |
|---|---|---|
| `quote_ride` | fixed ETB fare for every tier between two Addis places | no |
| `request_ride` | books a ride (name + Ethiopian phone); dispatcher confirms by phone | **yes** |
| `get_ride_status` | status, driver, plate for a ride id + phone | no |
| `cancel_ride` | cancel before the trip starts | **yes** |
| `search_places` | buildings, hotels, hospitals, shops (cafés, restaurants, pharmacies, banks…) | no |
| `get_hotel_rooms` | room types and nightly prices | no |
| `get_hospital_departments` | departments, fees, slots left | no |
| `list_events` | upcoming events, prices, seats left | no |
| `get_ethiopia_guide` | 22 step-by-step guides: Fayda, telebirr, TIN, VAT, eVisa, driving licence… | no |

## Connect
- **Claude Code:** `claude mcp add --transport http binasmart https://bina.et/mcp`
- **Gemini (Spark):** gemini.google.com → Settings → Connected apps → Custom apps → `https://bina.et/mcp`
- **Any client:** `POST https://bina.et/mcp` with `Accept: application/json, text/event-stream`

## Limits
Rides: 5 requests per 10 minutes per phone; 30 tool calls/min and 10 bookings/hour per session. Addis Ababa only. Fares are fixed at quote time — no surge.

Questions: https://bina.et · WhatsApp https://wa.me/251911244344
```

- [ ] **Step 4: Implement server.mjs**

```js
// mcp-server/server.mjs
// BinaSmart public MCP server (streamable HTTP, stateless). pm2 "bina-mcp" on 127.0.0.1:3021;
// nginx proxies https://bina.et/mcp here. Docs: GET /mcp.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { makeLimiter } from './lib/limiter.mjs';
import { registerRideTools, toolError } from './tools/ride.mjs';
import { registerDirectoryTools } from './tools/directory.mjs';
import { registerGuideTools, loadGuides } from './tools/guides.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
const DOCS_MD = fs.existsSync(path.join(here, 'docs.md')) ? fs.readFileSync(path.join(here, 'docs.md'), 'utf8') : '# BinaSmart MCP server\n';

const INSTRUCTIONS =
  'BinaSmart (bina.et) is Ethiopia\'s all-in-one digital platform. Tools: fixed-price ride-hailing in Addis Ababa only ' +
  '(quote_ride → request_ride → get_ride_status / cancel_ride), a directory of buildings, hotels, hospitals and shops ' +
  '(search_places, get_hotel_rooms, get_hospital_departments), upcoming events (list_events) and 22 bilingual Digital ' +
  'Ethiopia guides (get_ethiopia_guide). Before request_ride ALWAYS confirm pickup, drop-off, tier, fare and the rider\'s ' +
  'Ethiopian phone with the user. Never invent fares or official portal names — quote_ride and the guides hold them. ' +
  'Cite source_url in answers. Site guide: https://bina.et/llms.txt';

export function json(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }

// One McpServer per request (stateless). `ctx.callerKey` feeds the per-caller limiter.
export function buildServer({ rideApi, db, guides, callerKey, callsRL, bookRL }) {
  const server = new McpServer({ name: 'binasmart', version: VERSION }, { instructions: INSTRUCTIONS });
  const wrap = (name, fn) => async (args) => {
    if (!callsRL(callerKey)) return toolError('Slow down — too many tool calls from this session. Wait a minute and try again.');
    if (name === 'request_ride' && !bookRL(callerKey)) return toolError('Slow down — this session has booked too many rides this hour.');
    const t0 = Date.now(); let ok = true;
    try { const r = await fn(args); ok = !r.isError; return r; }
    catch (e) { ok = false; console.error(`[mcp] ${name} threw:`, e && e.message); return toolError('Internal error in BinaSmart MCP. Try again or use https://bina.et.'); }
    finally { console.log(JSON.stringify({ t: 'tool', name, ms: Date.now() - t0, ok, caller: String(callerKey).slice(0, 24) })); }
  };
  registerRideTools(server, { api: rideApi, wrap, json });
  registerDirectoryTools(server, { db, wrap, json });
  registerGuideTools(server, { guides, wrap, json });
  return server;
}

export function createApp({ rideApi, db, guides, callLimit = { windowMs: 60_000, max: 30 }, bookLimit = { windowMs: 3_600_000, max: 10 } }) {
  const callsRL = makeLimiter(callLimit.windowMs, callLimit.max);
  const bookRL = makeLimiter(bookLimit.windowMs, bookLimit.max);
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.post('/mcp', async (req, res) => {
    const callerKey = req.headers['mcp-session-id'] || req.headers['x-real-ip'] || req.ip || 'anon';
    try {
      const server = buildServer({ rideApi, db, guides, callerKey, callsRL, bookRL });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp] transport error:', e && e.message);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  app.get('/mcp', (_req, res) => { res.setHeader('Content-Type', 'text/markdown; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.send(DOCS_MD); });
  app.delete('/mcp', (_req, res) => res.sendStatus(405));
  app.get('/mcp/health', async (_req, res) => {
    const out = { ok: true, db: true, ride_api: true };
    try { await db.query('SELECT 1', []); } catch { out.db = false; }
    try { const s = await rideApi.settings(); if (!s || s.ok === false) out.ride_api = false; } catch { out.ride_api = false; }
    out.ok = out.db && out.ride_api;
    res.status(out.ok ? 200 : 503).json(out);
  });
  return app;
}

async function main() {
  const [{ default: pg }, { databaseUrl }, { makeRideApi }] = await Promise.all([import('pg'), import('./lib/env.mjs'), import('./lib/rideApi.mjs')]);
  const PORT = Number(process.env.PORT || 3021);
  const db = new pg.Pool({ connectionString: databaseUrl(), max: 4, idleTimeoutMillis: 30_000 });
  db.on('error', e => console.error('[mcp] pg pool error:', e.message));
  const rideApi = makeRideApi({ baseUrl: process.env.RIDE_API || 'http://127.0.0.1:4210', timeoutMs: 8000 });
  const guides = await loadGuides(path.join(here, '..', 'public'));
  const app = createApp({ rideApi, db, guides });
  app.listen(PORT, '127.0.0.1', () => console.log(`binasmart MCP server on 127.0.0.1:${PORT}, guides loaded: ${guides.size}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: `# pass 28`, `# fail 0`. If `tools/list` shows `annotations` missing, the SDK version is older than 1.13 — run `npm install @modelcontextprotocol/sdk@latest` and re-run.

- [ ] **Step 6: Start it for real on :3021 and smoke-test with curl (no nginx yet)**

```bash
cd /var/www/connectcare/binasmart/mcp-server && pm2 start server.mjs --name bina-mcp --max-memory-restart 256M --exp-backoff-restart-delay=2000 && pm2 save && sleep 2 && pm2 logs bina-mcp --lines 3 --nostream
curl -s http://127.0.0.1:3021/mcp/health; echo
curl -s -X POST http://127.0.0.1:3021/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | grep -o '"name":"[a-z_]*"' | sort | tr '\n' ' '; echo
curl -s -X POST http://127.0.0.1:3021/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"quote_ride","arguments":{"pickup":"9.0108,38.7578","dropoff":"9.0348,38.7500"}}}' | head -c 700; echo
```
Expected: log line `guides loaded: 22`; health `{"ok":true,"db":true,"ride_api":true}`; 9 names; a quote with five `fare_etb` values (this only calls the public quote endpoint, which books nothing).

- [ ] **Step 7: Commit and push**

```bash
cd /var/www/connectcare/binasmart && git add mcp-server/server.mjs mcp-server/docs.md mcp-server/test/server.test.mjs && git commit -q -m "feat(mcp): Streamable HTTP server with 9 tools, per-caller limits, docs, health" && git push -q origin main && git log --oneline -1
```

---

### Task 9: nginx `bina.et/mcp`, registry proof route, llms.txt

**Files:**
- Modify: `/etc/nginx/sites-enabled/bina.et.conf` (insert before the `location / {` of the 443 block)
- Create: `public/.well-known/mcp-registry-auth` (content filled in Task 10)
- Modify: `public/llms.txt`

- [ ] **Step 1: Back up and patch nginx**

```bash
cp /etc/nginx/sites-enabled/bina.et.conf /root/storage/bina.et.conf.bak-$(date +%s)
python3 - <<'EOF'
p='/etc/nginx/sites-enabled/bina.et.conf'; s=open(p).read()
block='''    location = /.well-known/mcp-registry-auth {
        alias /var/www/connectcare/binasmart/public/.well-known/mcp-registry-auth;
        default_type text/plain;
    }

    location ^~ /mcp {
        proxy_pass         http://127.0.0.1:3021;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   Connection "";
        proxy_buffering    off;
        proxy_read_timeout 120s;
    }

'''
assert '/mcp' not in s, 'already patched'
i=s.index('    location / {'); s=s[:i]+block+s[i:]
open(p,'w').write(s); print('patched')
EOF
nginx -t && systemctl reload nginx && echo reloaded
```
Expected: `patched`, `syntax is ok`, `test is successful`, `reloaded`.

- [ ] **Step 2: Verify from the internet**

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://bina.et/mcp
curl -s https://bina.et/mcp/health; echo
curl -s -X POST https://bina.et/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | grep -o '"name":"[a-z_]*"' | wc -l
curl -s -o /dev/null -w '%{http_code}\n' https://bina.et/ride
```
Expected: `200 text/markdown; charset=utf-8`, `{"ok":true,...}`, `9`, `200` (site unaffected).

- [ ] **Step 3: llms.txt developer line**

```bash
cd /var/www/connectcare/binasmart && grep -n 'mcp' public/llms.txt || printf '\n## Developer resources\n- MCP server (Claude, ChatGPT, Gemini): https://bina.et/mcp — quote/book rides, search the directory, read the guides. Docs at that URL.\n' >> public/llms.txt
curl -s https://bina.et/llms.txt | tail -3
```
Expected: the new two lines appear at the end (the route serves the file directly, no restart needed).

- [ ] **Step 4: Commit**

```bash
cd /var/www/connectcare/binasmart && mkdir -p ops/mcp && cp /etc/nginx/sites-enabled/bina.et.conf ops/mcp/nginx-bina.et.conf.example && git add public/llms.txt ops/mcp/nginx-bina.et.conf.example && git commit -q -m "feat(mcp): expose /mcp on bina.et; llms.txt developer line; nginx example" && git log --oneline -1
```

---

### Task 10: MCP Registry publish (`et.bina/binasmart`)

**Files:**
- Create: `/root/storage/mcp-publisher/binasmart/server.json`, `/root/storage/mcp-publisher/bina-registry-key.pem`, `public/.well-known/mcp-registry-auth`

- [ ] **Step 1: Key pair and proof file**

```bash
cd /root/storage/mcp-publisher && [ -f bina-registry-key.pem ] || openssl genpkey -algorithm ed25519 -out bina-registry-key.pem
PUB=$(openssl pkey -in bina-registry-key.pem -pubout -outform DER | tail -c 32 | xxd -p -c 32)
printf 'v0:%s\n' "$PUB" > /var/www/connectcare/binasmart/public/.well-known/mcp-registry-auth
curl -s https://bina.et/.well-known/mcp-registry-auth
```
Expected: `v0:<64 hex chars>` served over HTTPS (the nginx alias from Task 9).

- [ ] **Step 2: server.json**

```bash
mkdir -p /root/storage/mcp-publisher/binasmart && cat > /root/storage/mcp-publisher/binasmart/server.json <<'EOF'
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "et.bina/binasmart",
  "title": "BinaSmart",
  "description": "Quote and book fixed-price rides in Addis Ababa, search Ethiopia's BinaSmart directory, read Digital Ethiopia guides.",
  "version": "1.0.0",
  "websiteUrl": "https://bina.et/mcp",
  "remotes": [ { "type": "streamable-http", "url": "https://bina.et/mcp" } ]
}
EOF
python3 -c "import json;d=json.load(open('/root/storage/mcp-publisher/binasmart/server.json'));assert len(d['description'])<=100,len(d['description']);print('ok',len(d['description']))"
```
Expected: `ok <n>` (registry caps description at 100 chars).

- [ ] **Step 3: Login (HTTP domain auth) and publish**

```bash
cd /root/storage/mcp-publisher && SEED=$(openssl pkey -in bina-registry-key.pem -noout -text | awk '/priv:/{f=1;next}/pub:/{f=0}f' | tr -d ' :\n') && ./mcp-publisher login http --domain bina.et --private-key "$SEED" && cd binasmart && ../mcp-publisher publish
sleep 5; curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=binasmart" | python3 -c "import sys,json;d=json.load(sys.stdin);print([ (s['server']['name'],s['server']['version']) for s in d.get('servers',[])])"
```
Expected: login `Successfully authenticated`, publish `Successfully published`, and the search prints `[('et.bina/binasmart', '1.0.0')]`. If login fails with a proof error, re-check Step 1 output equals `v0:` + the hex of the same key (`openssl pkey -in bina-registry-key.pem -pubout -outform DER | tail -c 32 | xxd -p -c 32`).

- [ ] **Step 4: Commit the proof file**

```bash
cd /var/www/connectcare/binasmart && git add public/.well-known/mcp-registry-auth && git commit -q -m "chore(mcp): MCP Registry domain proof for bina.et" && git push -q origin main && git log --oneline -1
```

---

### Task 11: README, Claude Code end-to-end, memory

**Files:**
- Modify: `README.md` (add a section after the Ride section)
- Memory: `C:\Users\akemb\.claude\projects\C--Users-akemb-Desktop\memory\reference_binasmart_mcp_server.md` (new) + `MEMORY.md` pointer

- [ ] **Step 1: README section**

```bash
cd /var/www/connectcare/binasmart && cat >> README.md <<'EOF'

## MCP server (AI assistants)

`https://bina.et/mcp` — public, no-auth Model Context Protocol server so Claude, ChatGPT and Gemini can use BinaSmart directly: `quote_ride`, `request_ride`, `get_ride_status`, `cancel_ride`, `search_places`, `get_hotel_rooms`, `get_hospital_departments`, `list_events`, `get_ethiopia_guide`. Code in [`mcp-server/`](mcp-server/), runs as pm2 `bina-mcp` on :3021 behind nginx. Listed in the [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=binasmart) as `et.bina/binasmart`.

```bash
claude mcp add --transport http binasmart https://bina.et/mcp
cd mcp-server && npm install && node --test
```
EOF
git add README.md && git commit -q -m "docs: MCP server section" && git push -q origin main && git log --oneline -1
```

- [ ] **Step 2: End-to-end from Claude Code on Windows (quote only — booking is real)**

From the Windows machine:
```bash
claude mcp add --transport http binasmart https://bina.et/mcp && claude mcp list
```
Then in a Claude Code session ask: *"Using the binasmart tools, quote a ride from Edna Mall to Piassa."* Expected: the assistant calls `search_places`/`quote_ride` and reports five fares in ETB with `source_url` bina.et/ride. Screenshot the reply for Ibrahim. Do **not** ask it to book.

- [ ] **Step 3: Memory file**

Write `reference_binasmart_mcp_server.md` (type `reference`) with: URL, pm2 name/port, the 9 tools, the synthetic `X-Real-IP` rule, the `pg`-not-Prisma decision, registry namespace `et.bina` + key path `/root/storage/mcp-publisher/bina-registry-key.pem`, the Gemini/ChatGPT manual steps, and the finding that Google has no open mini-app platform (Connected apps invite-only; Spark custom MCP = US Ultra only). Add a pointer line under "Other businesses" in `MEMORY.md`, and update `project_binasmart.md` with one line. Link `[[project_binasmart_ride]]`.

- [ ] **Step 4: Report to Ibrahim**

Include: the live URL, `tools/list` count, the health JSON, the registry search result, the Claude Code screenshot, and the three manual steps with exact click paths (Gemini: gemini.google.com → Settings → Connected apps → Custom apps for Spark → paste URL; ChatGPT: Apps submission portal, "With MCP", production URL `https://bina.et/mcp`, domain verification file wherever the portal specifies, 5 positive/3 negative test cases — draft them: quote Edna→Piassa, list events, guide TIN, search cafés, hotel rooms; negatives: foreign phone, place outside Addis, unknown guide slug).

---

## Self-review

**Spec coverage**
- §3 files: server/ride/directory/guides/docs/package → Tasks 1, 4–8 ✔. pm2 flags, nginx location, health, `/llms.txt`, well-known proof → Tasks 8–10 ✔. Synthetic `X-Real-IP` → Task 5 ✔.
- §4 nine tools with the specified inputs, outputs, annotations, `source_url`, Amharic names, candidates-not-guesses, idemKey, tracking_url → Tasks 4, 6, 7 ✔. Guide count: spec said 21, the repo has 22 static guide pages; `GUIDE_SLUGS` lists all 22 ✔.
- §5 per-phone limit (Task 5), per-caller 30/min + 10 bookings/hour (Task 8), zod validation, error mapping for network/5xx/429/4xx/404/409 (Task 6), directory-unavailable guard (Task 7), secrets only `DATABASE_URL` (Task 7 `env.mjs`), explicit selects, masked/short logging (Task 8 logs caller key only, never phone) ✔.
- §6 tests: phone, idemKey, limiter, HTML fixture, ride API stub with 200/400/429/500/timeout/network, protocol smoke with `initialize`/`tools/list`/`tools/call`; no live booking ✔.
- §7 rollout steps 1–7 → Tasks 8 (local), 7 step 6 (read-only live), 9 (nginx), 8 step 7 + 11 (push/README), 11 step 2 (Claude Code), 10 (registry), 9 step 3 (llms.txt) ✔. Manual steps → Task 11 step 4 ✔.
- §9 amendments recorded in Task 1 ✔.

**Placeholder scan:** the one open value is `TIERS` in Task 6, resolved by an exact command in Step 1 of that task. No TBD/TODO.

**Type consistency:** `wrap(name, fn)` signature identical in Tasks 4, 6, 7, 8; `json(d)` shape identical; `toolError` exported from `tools/ride.mjs` and imported by `directory.mjs`/`server.mjs`; `makeRideApi` methods `search/quote/request/status/cancel/settings` used consistently in Tasks 5, 6, 8; `loadGuides(publicDir, slugs, cap)` matches its test; `createApp({ rideApi, db, guides, callLimit, bookLimit })` matches the server test; `RideApiError` fields `status`, `kind` used consistently.
