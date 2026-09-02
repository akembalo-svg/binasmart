# BinaSmart Ride — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the rider app + concierge fallback so real fixed-price rides in Addis Ababa work from day one, fulfilled by the owner until drivers exist.

**Architecture:** An isolated `ride/` module mounted into the existing Fastify + Prisma app (`server.js`), a self-hosted GraphHopper routing server on the VPS, self-hosted Protomaps vector tiles rendered by MapLibre GL in a BinaSmart-styled 3D map, and a rider single-page app that polls ride status. Concierge = Telegram alert to the owner + an ops console to assign a driver and advance the ride.

**Tech Stack:** Node 22, Fastify 5, Prisma 6 + PostgreSQL, GraphHopper 10 (Java 21), Protomaps PMTiles + MapLibre GL JS, Node built-in test runner, pm2.

**Spec:** `docs/superpowers/specs/2026-09-02-binasmart-ride-design.md`
**Spec amendment (recorded in Task 1):** the VPS has no Docker, so the routing engine is **GraphHopper** (Java already installed) rather than OSRM. Same role: self-hosted, free, fast routing/ETA.

**Environment facts (verified):** VPS `/var/www/connectcare/binasmart`, app on `127.0.0.1:4210` under pm2 `binasmart-api`; 16 GB RAM (≈4.6 GB free + 8 GB swap), 4 CPUs, 100 GB disk; Java 21; ports **8989/8990 free**; `curl`, `wget`, `unzip` present; no Docker. `node --check` prints a spurious "Aborted (core dumped)" in this environment — a script that printed its success line before that noise DID succeed.

**Working conventions:**
- All shell commands run on the VPS in `/var/www/connectcare/binasmart` unless stated.
- Commit after every task: `git add -A && git commit -m "..."` then `git push origin main`.
- Restart the app after server-side changes: `pm2 restart binasmart-api`.
- Never commit `.env`. Never send test Telegram messages to the live owner chat — verification uses `RIDE_TG_SILENT=1` (Task 15).

---

## File structure

**Create**
- `ride/index.js` — `module.exports = function registerRide(fastify, deps)`: wires settings/geo/telegram/dispatch and mounts routes.
- `ride/fare.js` — pure fare math.
- `ride/settings.js` — fare/knob settings singleton (DB-backed, defaults, deep-merge).
- `ride/geo.js` — routing (GraphHopper + straight-line fallback), haversine, place search (directory first, then Photon/OSM).
- `ride/telegram.js` — concierge alert + owner notes (silent mode for tests).
- `ride/dispatch.js` — Phase-1 dispatch: concierge immediately when no driver online, else after the concierge window.
- `ride/routes.js` — REST endpoints (public + ops) and page routes.
- `test/ride/fare.test.js`, `test/ride/settings.test.js`, `test/ride/geo.test.js`, `test/ride/dispatch.test.js`
- `public/ride.html` — rider app shell (replaces the placeholder page).
- `public/ride/style.json` — BinaSmart map style.
- `public/ride/map.js` — MapLibre wrapper (init, 3D + auto-degrade, markers, route line).
- `public/ride/app.js` — rider state machine, API calls, polling.
- `public/ride/ui.css` — rider UI styles.
- `public/ride-ops.html` — owner ops console.
- `public/vendor/maplibre-gl.js`, `public/vendor/maplibre-gl.css`, `public/vendor/pmtiles.js` — vendored libraries.
- `public/map/addis.pmtiles`, `public/map/fonts/**` — tiles + glyphs.
- `/root/routing/` — GraphHopper jar, Ethiopia OSM extract, config, graph cache (outside the repo).

**Modify**
- `server.js:11-12` — add `pmtiles|pbf` to the 1-day cache regex.
- `server.js` `markBookingPaid` — add a `ride` branch.
- `server.js:231` — `/ride` route stays (file replaced); add `/ride-ops` route inside `ride/routes.js` instead.
- `server.js:2600` — mount the ride module immediately before `fastify.listen`.
- `prisma/schema.prisma` — add `Rider`, `Driver`, `Ride`, `RideSetting`.
- `package.json` — `"test": "node --test test/"`.
- `public/gemini-home.html` — ride card no longer says "coming soon".
- `docs/superpowers/specs/2026-09-02-binasmart-ride-design.md` — routing-engine amendment.

---

### Task 1: Routing engine — GraphHopper on the VPS

**Files:**
- Create: `/root/routing/config.yml`
- Modify: `docs/superpowers/specs/2026-09-02-binasmart-ride-design.md` (amendment line)

- [ ] **Step 1: Record the spec amendment**

Append to the end of the spec's §3 "Maps stack" bullet list:

```markdown
- **Routing engine amendment (2026-09-02):** the VPS has no Docker, so routing runs on **GraphHopper 10** (Java 21 is installed) instead of OSRM. Same role and guarantees: self-hosted, free, ~10–50 ms responses, distance + time + geometry.
```

- [ ] **Step 2: Download GraphHopper and the Ethiopia OSM extract**

```bash
mkdir -p /root/routing && cd /root/routing
wget -q https://github.com/graphhopper/graphhopper/releases/download/10.0/graphhopper-web-10.0.jar
wget -q https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf
ls -la
```
Expected: `graphhopper-web-10.0.jar` (~60–80 MB) and `ethiopia-latest.osm.pbf` (~90–140 MB) both present.

- [ ] **Step 3: Write the GraphHopper config**

`/root/routing/config.yml`:
```yaml
graphhopper:
  datareader.file: /root/routing/ethiopia-latest.osm.pbf
  graph.location: /root/routing/graph-cache
  profiles:
    - name: car
      custom_model_files: [car.json]
  profiles_ch:
    - profile: car
  import.osm.ignored_highways: footway,cycleway,path,pedestrian,steps
server:
  application_connectors:
    - type: http
      port: 8989
      bind_host: 127.0.0.1
  admin_connectors:
    - type: http
      port: 8990
      bind_host: 127.0.0.1
logging:
  level: INFO
```

- [ ] **Step 4: Import the graph once (foreground, so you see it finish)**

```bash
cd /root/routing && java -Xmx3g -jar graphhopper-web-10.0.jar import config.yml 2>&1 | tail -5
ls graph-cache | head
```
Expected: log ends with something like `flushed graph ...` / `Import time: ...` and `graph-cache/` contains files (`nodes`, `edges`, `properties`, …). Takes a few minutes.

- [ ] **Step 5: Run it under pm2 and verify a real route**

```bash
cd /root/routing && pm2 start java --name gh-routing -- -Xmx2g -jar /root/routing/graphhopper-web-10.0.jar server /root/routing/config.yml
sleep 25
curl -s "http://127.0.0.1:8989/route?point=9.0108,38.7578&point=8.9806,38.7900&profile=car&points_encoded=false&instructions=false" \
 | python3 -c "import sys,json;d=json.load(sys.stdin);p=d['paths'][0];print('distance m',round(p['distance']),'| time s',round(p['time']/1000),'| pts',len(p['points']['coordinates']))"
pm2 save
```
Expected: a line like `distance m 5xxx | time s 6xx | pts 1xx` (Bole ↔ Meskel-square-ish trip, a few km, a few hundred seconds). If `paths` is missing, `pm2 logs gh-routing --lines 30` and fix the config.

- [ ] **Step 6: Commit the spec amendment**

```bash
cd /var/www/connectcare/binasmart && git add docs/superpowers/specs/2026-09-02-binasmart-ride-design.md && git commit -m "docs(ride spec): routing engine = GraphHopper (no Docker on VPS)" && git push origin main
```

---

### Task 2: Map tiles, glyphs, and vendored map libraries

**Files:**
- Create: `public/map/addis.pmtiles`, `public/map/fonts/**`, `public/vendor/maplibre-gl.js`, `public/vendor/maplibre-gl.css`, `public/vendor/pmtiles.js`
- Modify: `server.js:11-12`

- [ ] **Step 1: Install the `pmtiles` CLI (latest Linux x86_64 release)**

```bash
cd /root && URL=$(curl -s https://api.github.com/repos/protomaps/go-pmtiles/releases/latest | grep -oE 'https://[^"]*Linux_x86_64\.tar\.gz' | head -1) && echo "$URL" && wget -qO pmtiles.tgz "$URL" && tar xzf pmtiles.tgz pmtiles && chmod +x pmtiles && mv pmtiles /usr/local/bin/ && pmtiles version
```
Expected: a URL is printed, then a version line like `pmtiles 1.x.y`.

- [ ] **Step 2: Extract Addis Ababa tiles from the latest Protomaps build**

```bash
mkdir -p /var/www/connectcare/binasmart/public/map && cd /var/www/connectcare/binasmart/public/map
BUILD=$(curl -s https://build.protomaps.com/builds.json | python3 -c "import sys,json;b=json.load(sys.stdin);print(sorted(x['key'] for x in b if x['key'].endswith('.pmtiles'))[-1])")
echo "build: $BUILD"
pmtiles extract "https://build.protomaps.com/$BUILD" addis.pmtiles --bbox=38.55,8.75,39.10,9.25
ls -la addis.pmtiles && pmtiles show addis.pmtiles | head -15
```
Expected: `build: 2026MMDD.pmtiles`; `addis.pmtiles` of roughly 40–150 MB; `pmtiles show` lists `tile type: mvt`, `min zoom`, `max zoom` (15 or 16), and the vector layers (`earth, landuse, water, roads, buildings, places, pois, …`).

- [ ] **Step 3: Self-host the glyphs and verify Ethiopic coverage**

```bash
cd /tmp && wget -qO ba.zip https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.zip && unzip -q -o ba.zip
mkdir -p /var/www/connectcare/binasmart/public/map/fonts
cp -r "basemaps-assets-main/fonts/Noto Sans Regular" /var/www/connectcare/binasmart/public/map/fonts/
ls "/var/www/connectcare/binasmart/public/map/fonts/Noto Sans Regular" | wc -l
stat -c '%s bytes' "/var/www/connectcare/binasmart/public/map/fonts/Noto Sans Regular/4864-5119.pbf"
```
Expected: ~256 range files; the Ethiopic range `4864-5119.pbf` is **larger than 1000 bytes** (it contains glyphs). **Checkpoint:** if it is under 1 KB, STOP and report — the font lacks Ethiopic and Amharic labels would render as boxes; do not continue with this font.

- [ ] **Step 4: Vendor MapLibre GL and the pmtiles client**

```bash
mkdir -p /var/www/connectcare/binasmart/public/vendor && cd /var/www/connectcare/binasmart/public/vendor
wget -qO maplibre-gl.js  https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js
wget -qO maplibre-gl.css https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css
wget -qO pmtiles.js      https://unpkg.com/pmtiles@3.2.1/dist/pmtiles.js
ls -la && head -c 120 maplibre-gl.js; echo; grep -c "pmtiles" pmtiles.js
```
Expected: three files (`maplibre-gl.js` ~800 KB, css ~60 KB, `pmtiles.js` ~100 KB); the js head shows a minified banner mentioning MapLibre; grep count > 0.

- [ ] **Step 5: Cache `.pmtiles` and `.pbf` for a day**

In `server.js` line 12, change:
```js
  else if (/\.(js|css|webmanifest)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=86400');
```
to:
```js
  else if (/\.(js|css|webmanifest|pmtiles|pbf)$/i.test(u)) reply.header('Cache-Control', 'public, max-age=86400');
```

- [ ] **Step 6: Verify range requests work for the tile file (MapLibre needs them)**

```bash
cd /var/www/connectcare/binasmart && pm2 restart binasmart-api && sleep 2
curl -s -o /dev/null -w "range: HTTP %{http_code} len=%{size_download}\n" -H "Range: bytes=0-16383" http://127.0.0.1:4210/static/map/addis.pmtiles
curl -s -o /dev/null -w "glyph: HTTP %{http_code} %{content_type}\n" "http://127.0.0.1:4210/static/map/fonts/Noto%20Sans%20Regular/4864-5119.pbf"
```
Expected: `range: HTTP 206 len=16384` and `glyph: HTTP 200 application/x-protobuf` (or octet-stream).

- [ ] **Step 7: Commit (tiles + fonts + vendor are part of the app)**

```bash
cd /var/www/connectcare/binasmart && git add public/map public/vendor server.js && git commit -m "feat(ride): self-hosted Addis vector tiles, glyphs, MapLibre + pmtiles vendored; cache headers" && git push origin main
```

---

### Task 3: Prisma models

**Files:**
- Modify: `prisma/schema.prisma` (append)

- [ ] **Step 1: Append the models**

```prisma
// ===== BinaSmart Ride =====
model Rider {
  id         String   @id @default(cuid())
  phone      String   @unique
  name       String
  telegramId String?
  rating     Float    @default(5)
  rides      Ride[]
  createdAt  DateTime @default(now())
}

model Driver {
  id              String    @id @default(cuid())
  name            String
  phone           String    @unique
  photo           String?
  telegramId      String?
  tier            String
  vehicleMake     String?
  vehicleColour   String?
  plate           String
  licenceUrl      String?
  registrationUrl String?
  status          String    @default("pending") // pending | approved | suspended
  online          Boolean   @default(false)
  lat             Float?
  lng             Float?
  lastSeenAt      DateTime?
  rating          Float     @default(5)
  ridesCount      Int       @default(0)
  commissionPct   Float?
  rides           Ride[]
  createdAt       DateTime  @default(now())
}

model Ride {
  id            String    @id @default(cuid())
  idemKey       String?   @unique
  riderId       String
  rider         Rider     @relation(fields: [riderId], references: [id])
  driverId      String?
  driver        Driver?   @relation(fields: [driverId], references: [id])
  tier          String
  pickup        Json
  dropoff       Json
  distanceM     Int
  durationS     Int
  fareEtb       Int
  driverTakeEtb Int
  paymentMethod String    @default("cash")    // cash | chapa | telebirr | wallet
  paymentStatus String    @default("unpaid")  // unpaid | paid
  status        String    @default("requested") // requested|dispatching|assigned|arriving|arrived|ontrip|completed|cancelled
  cancelledBy   String?
  concierge     Boolean   @default(false)
  estimate      Boolean   @default(false)
  riderName     String
  riderPhone    String
  riderRating   Int?
  driverRating  Int?
  requestedAt   DateTime  @default(now())
  assignedAt    DateTime?
  arrivedAt     DateTime?
  startedAt     DateTime?
  completedAt   DateTime?
  cancelledAt   DateTime?

  @@index([status])
  @@index([riderId])
}

model RideSetting {
  id        String   @id
  json      String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Push the schema and regenerate the client**

```bash
cd /var/www/connectcare/binasmart && cp prisma/schema.prisma prisma/schema.prisma.bak-ride-$(date +%s)
npx prisma db push 2>&1 | tail -4 && npx prisma generate 2>&1 | tail -2
```
Expected: `Your database is now in sync with your Prisma schema.` and `Generated Prisma Client`.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma && git commit -m "feat(ride): Rider, Driver, Ride, RideSetting models" && git push origin main
```

---

### Task 4: Fare math (TDD)

**Files:**
- Create: `ride/fare.js`, `test/ride/fare.test.js`
- Modify: `package.json` scripts

- [ ] **Step 1: Set the test script**

In `package.json` replace the scripts block with:
```json
  "scripts": {
    "test": "node --test test/"
  },
```

- [ ] **Step 2: Write the failing tests**

`test/ride/fare.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteFare, quoteAll, roundTo5, TIERS } = require('../../ride/fare');

const S = { commissionPct: 15, tiers: {
  moto:    { base: 40,  perKm: 12, perMin: 1.5, min: 60 },
  bajaj:   { base: 50,  perKm: 15, perMin: 2,   min: 80 },
  economy: { base: 80,  perKm: 28, perMin: 3,   min: 150 },
  comfort: { base: 120, perKm: 40, perMin: 4,   min: 230 },
  xl:      { base: 180, perKm: 55, perMin: 5,   min: 350 } } };

test('rounds to nearest 5', () => {
  assert.equal(roundTo5(152), 150); assert.equal(roundTo5(153), 155); assert.equal(roundTo5(0), 0);
});

test('economy 5 km / 12 min = 80 + 140 + 36 = 256 -> 255', () => {
  const q = quoteFare(S, 'economy', 5000, 720);
  assert.equal(q.fareEtb, 255);
  assert.equal(q.driverTakeEtb, Math.round(255 * 0.85));
  assert.equal(q.km, 5); assert.equal(q.min, 12);
});

test('short trip floors at tier minimum', () => {
  assert.equal(quoteFare(S, 'moto', 300, 60).fareEtb, 60);
  assert.equal(quoteFare(S, 'xl', 300, 60).fareEtb, 350);
});

test('unknown tier throws', () => {
  assert.throws(() => quoteFare(S, 'rocket', 1000, 60), /unknown_tier/);
});

test('quoteAll returns all five tiers in order', () => {
  const all = quoteAll(S, 3000, 400);
  assert.deepEqual(all.map(q => q.tier), TIERS);
  assert.ok(all.every(q => q.fareEtb >= S.tiers[q.tier].min));
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```
Expected: FAIL with `Cannot find module '../../ride/fare'`.

- [ ] **Step 4: Implement**

`ride/fare.js`:
```js
'use strict';
// Fixed upfront fare: base + perKm*km + perMin*min, rounded to the nearest 5 ETB,
// floored at the tier minimum. Quoted once and locked at request time (no surge).
const TIERS = ['moto', 'bajaj', 'economy', 'comfort', 'xl'];

function roundTo5(n) { return Math.round(n / 5) * 5; }

function quoteFare(settings, tier, distanceM, durationS) {
  const t = settings && settings.tiers && settings.tiers[tier];
  if (!t) throw new Error('unknown_tier');
  const km = Math.max(0, Number(distanceM) || 0) / 1000;
  const min = Math.max(0, Number(durationS) || 0) / 60;
  const raw = t.base + t.perKm * km + t.perMin * min;
  const fareEtb = Math.max(t.min, roundTo5(raw));
  const commissionPct = Number(settings.commissionPct) || 0;
  const driverTakeEtb = Math.round(fareEtb * (1 - commissionPct / 100));
  return { tier, fareEtb, driverTakeEtb, km: Number(km.toFixed(2)), min: Math.round(min) };
}

function quoteAll(settings, distanceM, durationS) {
  return TIERS.map(t => quoteFare(settings, t, distanceM, durationS));
}

module.exports = { TIERS, roundTo5, quoteFare, quoteAll };
```

- [ ] **Step 5: Run to verify pass**

```bash
npm test 2>&1 | tail -6
```
Expected: `# pass 5` / `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json ride/fare.js test/ride/fare.test.js && git commit -m "feat(ride): fare math with tests" && git push origin main
```

---

### Task 5: Settings singleton (TDD)

**Files:**
- Create: `ride/settings.js`, `test/ride/settings.test.js`

- [ ] **Step 1: Write the failing tests**

`test/ride/settings.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSettings, DEFAULTS, deepMerge } = require('../../ride/settings');

function fakePrisma(row) {
  const store = { row };
  return {
    rideSetting: {
      findUnique: async () => store.row,
      upsert: async ({ update, create }) => { store.row = store.row ? { ...store.row, ...update } : create; return store.row; }
    },
    _store: store
  };
}

test('deepMerge merges nested objects and overrides scalars', () => {
  const out = deepMerge({ a: 1, t: { x: { base: 1, min: 2 } } }, { a: 2, t: { x: { base: 9 } } });
  assert.deepEqual(out, { a: 2, t: { x: { base: 9, min: 2 } } });
});

test('get() returns defaults when no row exists', async () => {
  const s = makeSettings(fakePrisma(null));
  const v = await s.get();
  assert.equal(v.commissionPct, DEFAULTS.commissionPct);
  assert.equal(v.tiers.economy.min, 150);
});

test('update() persists and merges', async () => {
  const p = fakePrisma(null);
  const s = makeSettings(p);
  const v = await s.update({ commissionPct: 10, tiers: { moto: { min: 70 } } });
  assert.equal(v.commissionPct, 10);
  assert.equal(v.tiers.moto.min, 70);
  assert.equal(v.tiers.moto.base, DEFAULTS.tiers.moto.base);
  assert.equal(JSON.parse(p._store.row.json).commissionPct, 10);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test 2>&1 | grep -E "settings|Cannot find" | head -3
```
Expected: `Cannot find module '../../ride/settings'`.

- [ ] **Step 3: Implement**

`ride/settings.js`:
```js
'use strict';
// Fare table + dispatch knobs. Single DB row (id 'default') holding JSON, deep-merged over DEFAULTS.
const DEFAULTS = {
  commissionPct: 15,
  offerWindowS: 20,
  conciergeAfterS: 60,
  freeCancelMin: 2,
  cancelFeeEtb: 30,
  radiiKm: [3, 6, 10],
  tiers: {
    moto:    { label: 'Moto',     labelAm: 'ሞተር',   icon: '🛵', base: 40,  perKm: 12, perMin: 1.5, min: 60,  seats: 1 },
    bajaj:   { label: 'Bajaj',    labelAm: 'ባጃጅ',   icon: '🛺', base: 50,  perKm: 15, perMin: 2,   min: 80,  seats: 3 },
    economy: { label: 'Economy',  labelAm: 'ኢኮኖሚ',  icon: '🚗', base: 80,  perKm: 28, perMin: 3,   min: 150, seats: 4 },
    comfort: { label: 'Comfort',  labelAm: 'ኮምፎርት', icon: '🚙', base: 120, perKm: 40, perMin: 4,   min: 230, seats: 4 },
    xl:      { label: 'XL / Van', labelAm: 'ቫን',     icon: '🚐', base: 180, perKm: 55, perMin: 5,   min: 350, seats: 7 }
  }
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b || {})) out[k] = (isObj(b[k]) && isObj(a[k])) ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
function safeJson(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }

function makeSettings(prisma) {
  let cache = null, cachedAt = 0;
  async function get() {
    if (cache && Date.now() - cachedAt < 30000) return cache;
    const row = await prisma.rideSetting.findUnique({ where: { id: 'default' } });
    cache = row ? deepMerge(DEFAULTS, safeJson(row.json)) : DEFAULTS;
    cachedAt = Date.now();
    return cache;
  }
  async function update(patch) {
    const next = deepMerge(await get(), patch || {});
    const json = JSON.stringify(next);
    await prisma.rideSetting.upsert({ where: { id: 'default' }, update: { json }, create: { id: 'default', json } });
    cache = next; cachedAt = Date.now();
    return next;
  }
  return { get, update, DEFAULTS };
}

module.exports = { makeSettings, DEFAULTS, deepMerge };
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test 2>&1 | tail -4
```
Expected: `# pass 8` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/settings.js test/ride/settings.test.js && git commit -m "feat(ride): settings singleton with defaults" && git push origin main
```

---

### Task 6: Geo — routing with fallback, haversine, place search (TDD)

**Files:**
- Create: `ride/geo.js`, `test/ride/geo.test.js`

- [ ] **Step 1: Write the failing tests**

`test/ride/geo.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeGeo, haversineM } = require('../../ride/geo');

const A = { lat: 9.0108, lng: 38.7578 }, B = { lat: 8.9806, lng: 38.7900 };

test('haversine Bole -> Meskel-ish is roughly 4.9 km', () => {
  const d = haversineM(A, B);
  assert.ok(d > 4500 && d < 5300, 'got ' + d);
});

test('route() parses GraphHopper response', async () => {
  const fetchFn = async () => ({ json: async () => ({ paths: [{ distance: 5432.1, time: 612345, points: { coordinates: [[38.7578, 9.0108], [38.79, 8.9806]] } }] }) });
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn, prisma: {} });
  const r = await geo.route(A, B);
  assert.equal(r.distanceM, 5432); assert.equal(r.durationS, 612);
  assert.equal(r.estimate, false); assert.equal(r.geometry.length, 2);
});

test('route() falls back to straight-line x1.3 when the router fails', async () => {
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn: async () => { throw new Error('down'); }, prisma: {} });
  const r = await geo.route(A, B);
  assert.equal(r.estimate, true);
  assert.equal(r.distanceM, Math.round(haversineM(A, B) * 1.3));
  assert.ok(r.durationS > 0);
  assert.deepEqual(r.geometry, [[A.lng, A.lat], [B.lng, B.lat]]);
});

test('searchPlaces() puts directory results first and filters OSM to Addis', async () => {
  const prisma = {
    building: { findMany: async () => [{ name: 'JJ Darule', nameAm: 'ጄጄ ዳሩሌ', qrSlug: 'darulle', lat: 9.01, lng: 38.76, city: 'Addis Ababa' }] },
    shop: { findMany: async () => [] }
  };
  const fetchFn = async () => ({ json: async () => ({ features: [
    { properties: { name: 'Edna Mall', city: 'Addis Ababa' }, geometry: { coordinates: [38.79, 9.0] } },
    { properties: { name: 'Far away' }, geometry: { coordinates: [40.0, 12.0] } } ] }) });
  const geo = makeGeo({ routerUrl: 'http://x', fetchFn, prisma });
  const res = await geo.searchPlaces('Darule');
  assert.equal(res[0].kind, 'building'); assert.equal(res[0].labelAm, 'ጄጄ ዳሩሌ');
  assert.equal(res.length, 2); assert.equal(res[1].label, 'Edna Mall');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test 2>&1 | grep -E "geo|Cannot find" | head -3
```
Expected: `Cannot find module '../../ride/geo'`.

- [ ] **Step 3: Implement**

`ride/geo.js`:
```js
'use strict';
// Routing (GraphHopper) with a straight-line fallback, haversine, and place search:
// BinaSmart directory (buildings + shops) first, then OSM via Photon, biased to Addis.
const ADDIS = { lat: 9.02, lng: 38.75 };
const ADDIS_BOX = { minLat: 8.5, maxLat: 9.5, minLng: 38.4, maxLng: 39.2 };
const CITY_MPS = 25000 / 3600; // 25 km/h average city speed for the fallback ETA

function haversineM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function makeGeo({ routerUrl, fetchFn, prisma }) {
  const f = fetchFn || fetch;

  async function route(from, to) {
    try {
      const u = routerUrl + '/route?point=' + from.lat + ',' + from.lng + '&point=' + to.lat + ',' + to.lng +
        '&profile=car&points_encoded=false&instructions=false';
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await f(u, { signal: ctrl.signal }); clearTimeout(t);
      const d = await r.json(); const p = d && d.paths && d.paths[0];
      if (!p) throw new Error('no_path');
      return { distanceM: Math.round(p.distance), durationS: Math.round(p.time / 1000),
        geometry: (p.points && p.points.coordinates) || [], estimate: false };
    } catch (e) {
      const distanceM = Math.round(haversineM(from, to) * 1.3);
      return { distanceM, durationS: Math.round(distanceM / CITY_MPS),
        geometry: [[from.lng, from.lat], [to.lng, to.lat]], estimate: true };
    }
  }

  const photonCache = new Map(); // q -> { t, v }
  async function searchPlaces(q, bias) {
    q = (q || '').trim();
    if (q.length < 2) return [];
    const [bs, shops] = await Promise.all([
      prisma.building.findMany({
        where: { lat: { not: null }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
        select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true, city: true }, take: 5 }),
      prisma.shop.findMany({
        where: { tenancy: { active: true }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { nameAm: { contains: q } }] },
        include: { tenancy: { include: { unit: { include: { building: { select: { name: true, nameAm: true, qrSlug: true, lat: true, lng: true } } } } } } }, take: 5 })
    ]);
    const dir = [
      ...bs.map(b => ({ kind: 'building', label: b.name, labelAm: b.nameAm, sub: b.city || 'Addis Ababa', lat: b.lat, lng: b.lng, slug: b.qrSlug })),
      ...shops.filter(s => s.tenancy.unit.building.lat != null).map(s => {
        const b = s.tenancy.unit.building;
        return { kind: 'shop', label: s.name, labelAm: s.nameAm, sub: b.name + ' · ' + s.tenancy.unit.number, lat: b.lat, lng: b.lng, slug: b.qrSlug };
      })
    ];
    let osm = [];
    try {
      const key = q.toLowerCase(); const c = photonCache.get(key);
      if (c && Date.now() - c.t < 600000) osm = c.v;
      else {
        const lat = (bias && bias.lat) || ADDIS.lat, lng = (bias && bias.lng) || ADDIS.lng;
        const u = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=5&lat=' + lat + '&lon=' + lng + '&lang=en';
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 3500);
        const r = await f(u, { signal: ctrl.signal, headers: { 'User-Agent': 'BinaSmart-Ride/1.0 (https://bina.et)' } }); clearTimeout(t);
        const d = await r.json();
        osm = (d.features || []).map(ft => {
          const p = ft.properties || {}, c2 = ft.geometry.coordinates;
          return { kind: 'osm', label: p.name || p.street || q, labelAm: '', sub: [p.street, p.district, p.city].filter(Boolean).join(', '), lat: c2[1], lng: c2[0] };
        }).filter(x => x.lat > ADDIS_BOX.minLat && x.lat < ADDIS_BOX.maxLat && x.lng > ADDIS_BOX.minLng && x.lng < ADDIS_BOX.maxLng);
        photonCache.set(key, { t: Date.now(), v: osm });
      }
    } catch (e) { osm = []; }
    return [...dir, ...osm].slice(0, 10);
  }

  return { route, searchPlaces, haversineM };
}

module.exports = { makeGeo, haversineM, ADDIS, ADDIS_BOX };
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test 2>&1 | tail -4
```
Expected: `# pass 12` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/geo.js test/ride/geo.test.js && git commit -m "feat(ride): routing with fallback, haversine, place search" && git push origin main
```

---

### Task 7: Telegram alerts

**Files:**
- Create: `ride/telegram.js`

- [ ] **Step 1: Implement**

`ride/telegram.js`:
```js
'use strict';
// Owner-facing Telegram messages. RIDE_TG_SILENT=1 logs instead of sending (used for verification).
function makeTelegram({ sendTg, ownerChat, baseUrl, ownerKey }) {
  function silent() { return process.env.RIDE_TG_SILENT === '1'; }

  async function conciergeAlert(ride) {
    const p = ride.pickup, d = ride.dropoff;
    const text = [
      '🚕 RIDE REQUEST — needs a driver',
      'Tier: ' + String(ride.tier).toUpperCase() + ' · Fare: ' + ride.fareEtb + ' ETB · Pay: ' + ride.paymentMethod,
      'From: ' + p.label,
      '  https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=17/' + p.lat + '/' + p.lng,
      'To:   ' + d.label,
      'Trip: ' + (ride.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(ride.durationS / 60) + ' min' + (ride.estimate ? ' (estimate)' : ''),
      'Rider: ' + ride.riderName + ' · ' + ride.riderPhone,
      'Assign: ' + baseUrl + '/ride-ops?key=' + ownerKey + '&ride=' + ride.id
    ].join('\n');
    if (silent()) { console.log('[ride] TG SILENT:\n' + text); return true; }
    return sendTg(ownerChat, text);
  }

  async function ownerNote(text) {
    if (silent()) { console.log('[ride] TG SILENT: ' + text); return true; }
    return sendTg(ownerChat, text);
  }

  return { conciergeAlert, ownerNote };
}

module.exports = { makeTelegram };
```

- [ ] **Step 2: Smoke-check it loads and formats (no send)**

```bash
cd /var/www/connectcare/binasmart && RIDE_TG_SILENT=1 node -e "
const { makeTelegram } = require('./ride/telegram');
const t = makeTelegram({ sendTg: async()=>{throw new Error('must not send')}, ownerChat:'1', baseUrl:'https://bina.et', ownerKey:'k' });
t.conciergeAlert({ id:'r1', tier:'economy', fareEtb:255, paymentMethod:'cash', pickup:{lat:9.01,lng:38.75,label:'Bole'}, dropoff:{lat:8.98,lng:38.79,label:'Meskel'}, distanceM:5400, durationS:612, riderName:'Test', riderPhone:'+2519', estimate:false }).then(ok=>console.log('ok', ok));
" 2>&1 | grep -v "Aborted"
```
Expected: the formatted message printed under `[ride] TG SILENT:` and `ok true`.

- [ ] **Step 3: Commit**

```bash
git add ride/telegram.js && git commit -m "feat(ride): telegram concierge alert with silent mode" && git push origin main
```

---

### Task 8: Dispatch — Phase 1 (TDD)

**Files:**
- Create: `ride/dispatch.js`, `test/ride/dispatch.test.js`

- [ ] **Step 1: Write the failing tests**

`test/ride/dispatch.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDispatch } = require('../../ride/dispatch');

function harness({ online }) {
  const rides = { r1: { id: 'r1', status: 'dispatching', concierge: false } };
  const alerts = [];
  const prisma = {
    driver: { count: async () => online },
    ride: {
      updateMany: async ({ where, data }) => { const r = rides[where.id]; if (!r || r.status !== where.status) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
      findUnique: async ({ where }) => rides[where.id]
    }
  };
  const telegram = { conciergeAlert: async r => { alerts.push(r.id); return true; } };
  const settings = { get: async () => ({ conciergeAfterS: 60 }) };
  const timers = [];
  const setTimeoutFn = (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; };
  const clearTimeoutFn = h => { h.cleared = true; };
  const d = makeDispatch({ prisma, telegram, settings, setTimeoutFn, clearTimeoutFn });
  return { d, rides, alerts, timers };
}

test('no drivers online -> concierge immediately', async () => {
  const h = harness({ online: 0 });
  const r = await h.d.start('r1');
  assert.equal(r, true);
  assert.equal(h.rides.r1.concierge, true);
  assert.deepEqual(h.alerts, ['r1']);
});

test('drivers online -> waits the concierge window, then concierge', async () => {
  const h = harness({ online: 2 });
  const r = await h.d.start('r1');
  assert.equal(r, 'waiting');
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 60000);
  assert.deepEqual(h.alerts, []);
  await h.timers[0].fn();
  assert.equal(h.rides.r1.concierge, true); assert.deepEqual(h.alerts, ['r1']);
});

test('cancel() clears a pending timer; a ride already assigned is not escalated', async () => {
  const h = harness({ online: 1 });
  await h.d.start('r1');
  h.d.cancel('r1');
  assert.equal(h.timers[0].cleared, true);
  h.rides.r1.status = 'assigned';
  const ok = await h.d.toConcierge('r1');
  assert.equal(ok, false); assert.deepEqual(h.alerts, []);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test 2>&1 | grep -E "dispatch|Cannot find" | head -3
```
Expected: `Cannot find module '../../ride/dispatch'`.

- [ ] **Step 3: Implement**

`ride/dispatch.js`:
```js
'use strict';
// Phase 1 dispatch. There is no driver app yet, so:
//  - no approved driver online  -> concierge immediately (Telegram to owner)
//  - some drivers online        -> wait the concierge window (Phase 2 will offer rides in between), then concierge
// Timers are injectable so tests run instantly.
function makeDispatch({ prisma, telegram, settings, setTimeoutFn, clearTimeoutFn }) {
  const st = setTimeoutFn || setTimeout, ct = clearTimeoutFn || clearTimeout;
  const timers = new Map(); // rideId -> timer handle

  async function toConcierge(rideId) {
    timers.delete(rideId);
    const res = await prisma.ride.updateMany({ where: { id: rideId, status: 'dispatching' }, data: { concierge: true } });
    if (res.count === 0) return false; // already assigned or cancelled
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    await telegram.conciergeAlert(ride);
    return true;
  }

  async function start(rideId) {
    const s = await settings.get();
    const online = await prisma.driver.count({ where: { status: 'approved', online: true } });
    if (online === 0) return toConcierge(rideId);
    const h = st(() => toConcierge(rideId).catch(() => {}), (s.conciergeAfterS || 60) * 1000);
    timers.set(rideId, h);
    return 'waiting';
  }

  function cancel(rideId) {
    const h = timers.get(rideId);
    if (h) { ct(h); timers.delete(rideId); }
  }

  return { start, cancel, toConcierge };
}

module.exports = { makeDispatch };
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test 2>&1 | tail -4
```
Expected: `# pass 15` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add ride/dispatch.js test/ride/dispatch.test.js && git commit -m "feat(ride): phase-1 dispatch with concierge fallback" && git push origin main
```

---

### Task 9: REST routes + module mount + Chapa hook

**Files:**
- Create: `ride/routes.js`, `ride/index.js`
- Modify: `server.js` (`markBookingPaid`; mount before `fastify.listen`)

- [ ] **Step 1: Write the routes**

`ride/routes.js`:
```js
'use strict';
const path = require('path');
const { quoteAll, quoteFare, TIERS } = require('./fare');

const ACTIVE = ['requested', 'dispatching', 'assigned', 'arriving', 'arrived', 'ontrip'];
const NEXT = { assigned: ['arriving', 'arrived', 'cancelled'], arriving: ['arrived', 'cancelled'], arrived: ['ontrip', 'cancelled'], ontrip: ['completed'], dispatching: ['cancelled'], requested: ['cancelled'] };

function limiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); const hits = (m.get(key) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return false;
    hits.push(now); m.set(key, hits); return true;
  };
}
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
function point(p) {
  if (!p) return null;
  const lat = num(p.lat, 8.5, 9.5), lng = num(p.lng, 38.4, 39.2);
  if (lat == null || lng == null) return null;
  return { lat, lng, label: String(p.label || '').slice(0, 120) || (lat.toFixed(5) + ', ' + lng.toFixed(5)) };
}
function normPhone(s) { s = String(s || '').replace(/[^\d+]/g, ''); if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); if (/^251\d{9}$/.test(s)) s = '+' + s; return /^\+251\d{9}$/.test(s) ? s : null; }
function pub(ride) {
  const d = ride.driver;
  return { id: ride.id, status: ride.status, concierge: ride.concierge, tier: ride.tier, pickup: ride.pickup, dropoff: ride.dropoff,
    distanceM: ride.distanceM, durationS: ride.durationS, fareEtb: ride.fareEtb, estimate: ride.estimate,
    paymentMethod: ride.paymentMethod, paymentStatus: ride.paymentStatus, requestedAt: ride.requestedAt, assignedAt: ride.assignedAt,
    completedAt: ride.completedAt, cancelledAt: ride.cancelledAt, driverRating: ride.driverRating,
    driver: d ? { name: d.name, phone: d.phone, photo: d.photo, plate: d.plate, vehicle: [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' '), rating: d.rating, tier: d.tier } : null };
}

module.exports = function routes(fastify, { prisma, settings, geo, telegram, dispatch, OWNER_KEY }) {
  const pub = path.join(__dirname, '..', 'public');
  const quoteRL = limiter(600000, 60), requestRL = limiter(600000, 5), searchRL = limiter(60000, 40);
  const ops = (req, reply) => { if ((req.query.key || req.headers['x-owner-key']) !== OWNER_KEY) { reply.code(401).send({ ok: false, error: 'unauthorized' }); return false; } return true; };

  // ---- pages ----
  fastify.get('/ride', async (req, reply) => reply.sendFile('ride.html'));
  fastify.get('/ride-ops', async (req, reply) => reply.sendFile('ride-ops.html'));

  // ---- public ----
  fastify.get('/api/ride/settings', async () => {
    const s = await settings.get();
    return { ok: true, tiers: TIERS.map(t => ({ id: t, ...s.tiers[t] })), freeCancelMin: s.freeCancelMin };
  });

  fastify.get('/api/ride/search', async (req, reply) => {
    if (!searchRL(req.ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const bias = (num(req.query.lat, 8.5, 9.5) != null && num(req.query.lng, 38.4, 39.2) != null) ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null;
    return { ok: true, results: await geo.searchPlaces(req.query.q, bias) };
  });

  fastify.post('/api/ride/quote', async (req, reply) => {
    if (!quoteRL(req.ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const b = req.body || {}; const from = point(b.pickup), to = point(b.dropoff);
    if (!from || !to) return reply.code(400).send({ ok: false, error: 'pickup and dropoff inside Addis required' });
    const [r, s] = await Promise.all([geo.route(from, to), settings.get()]);
    return { ok: true, distanceM: r.distanceM, durationS: r.durationS, estimate: r.estimate, geometry: r.geometry,
      quotes: quoteAll(s, r.distanceM, r.durationS).map(q => ({ ...q, ...{ label: s.tiers[q.tier].label, labelAm: s.tiers[q.tier].labelAm, icon: s.tiers[q.tier].icon, seats: s.tiers[q.tier].seats } })) };
  });

  fastify.post('/api/ride/request', async (req, reply) => {
    const b = req.body || {};
    const from = point(b.pickup), to = point(b.dropoff);
    const phone = normPhone(b.riderPhone); const name = String(b.riderName || '').trim().slice(0, 60);
    const tier = TIERS.includes(b.tier) ? b.tier : null;
    const paymentMethod = ['cash', 'chapa'].includes(b.paymentMethod) ? b.paymentMethod : 'cash';
    const idemKey = String(b.idemKey || '').slice(0, 64) || null;
    if (!from || !to || !phone || !name || !tier) return reply.code(400).send({ ok: false, error: 'tier, pickup, dropoff, riderName, riderPhone(+251…) required' });
    if (idemKey) { const dup = await prisma.ride.findUnique({ where: { idemKey }, include: { driver: true } }); if (dup) return { ok: true, ride: pub(dup), duplicate: true }; }
    if (!requestRL(phone) || !requestRL('ip:' + req.ip)) return reply.code(429).send({ ok: false, error: 'too_many_requests' });
    const [r, s] = await Promise.all([geo.route(from, to), settings.get()]); // fare is computed server-side and locked
    const q = quoteFare(s, tier, r.distanceM, r.durationS);
    const rider = await prisma.rider.upsert({ where: { phone }, update: { name }, create: { phone, name } });
    const ride = await prisma.ride.create({ data: {
      idemKey, riderId: rider.id, tier, pickup: from, dropoff: to, distanceM: r.distanceM, durationS: r.durationS, estimate: r.estimate,
      fareEtb: q.fareEtb, driverTakeEtb: q.driverTakeEtb, paymentMethod, status: 'dispatching', riderName: name, riderPhone: phone } });
    dispatch.start(ride.id).catch(err => fastify.log.error(err));
    return { ok: true, ride: pub({ ...ride, driver: null }) };
  });

  fastify.get('/api/ride/:id', async (req, reply) => {
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    if (!ride || normPhone(req.query.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, ride: pub(ride) };
  });

  fastify.post('/api/ride/:id/cancel', async (req, reply) => {
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride || normPhone((req.body || {}).phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!['requested', 'dispatching', 'assigned', 'arriving', 'arrived'].includes(ride.status)) return reply.code(409).send({ ok: false, error: 'cannot_cancel_now' });
    dispatch.cancel(ride.id);
    const upd = await prisma.ride.update({ where: { id: ride.id }, data: { status: 'cancelled', cancelledBy: 'rider', cancelledAt: new Date() }, include: { driver: true } });
    telegram.ownerNote('❌ Rider cancelled ride ' + ride.id + ' (' + ride.riderName + ')').catch(() => {});
    return { ok: true, ride: pub(upd) };
  });

  fastify.post('/api/ride/:id/rate', async (req, reply) => {
    const b = req.body || {}; const stars = num(b.stars, 1, 5);
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride || normPhone(b.phone) !== ride.riderPhone) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (ride.status !== 'completed' || stars == null) return reply.code(400).send({ ok: false, error: 'stars 1-5 on a completed ride' });
    await prisma.ride.update({ where: { id: ride.id }, data: { driverRating: Math.round(stars) } });
    if (ride.driverId) {
      const agg = await prisma.ride.aggregate({ where: { driverId: ride.driverId, driverRating: { not: null } }, _avg: { driverRating: true } });
      await prisma.driver.update({ where: { id: ride.driverId }, data: { rating: Number((agg._avg.driverRating || 5).toFixed(2)) } });
    }
    return { ok: true };
  });

  // ---- ops (owner) ----
  fastify.get('/api/ride/ops/queue', async (req, reply) => {
    if (!ops(req, reply)) return;
    const rides = await prisma.ride.findMany({ where: { status: { in: ACTIVE } }, include: { driver: true }, orderBy: [{ concierge: 'desc' }, { requestedAt: 'asc' }], take: 100 });
    const recent = await prisma.ride.findMany({ where: { status: { in: ['completed', 'cancelled'] } }, include: { driver: true }, orderBy: { requestedAt: 'desc' }, take: 30 });
    return { ok: true, active: rides.map(r => ({ ...pub(r), riderName: r.riderName, riderPhone: r.riderPhone, driverTakeEtb: r.driverTakeEtb })), recent: recent.map(r => ({ ...pub(r), riderName: r.riderName, riderPhone: r.riderPhone })) };
  });

  fastify.get('/api/ride/ops/drivers', async (req, reply) => {
    if (!ops(req, reply)) return;
    return { ok: true, drivers: await prisma.driver.findMany({ orderBy: { createdAt: 'desc' } }) };
  });

  fastify.post('/api/ride/ops/drivers', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {}; const phone = normPhone(b.phone); const tier = TIERS.includes(b.tier) ? b.tier : 'economy';
    const name = String(b.name || '').trim().slice(0, 60), plate = String(b.plate || '').trim().slice(0, 20);
    if (!phone || !name || !plate) return reply.code(400).send({ ok: false, error: 'name, phone(+251…), plate required' });
    const data = { name, tier, plate, vehicleMake: String(b.vehicleMake || '').slice(0, 40) || null, vehicleColour: String(b.vehicleColour || '').slice(0, 30) || null,
      status: ['pending', 'approved', 'suspended'].includes(b.status) ? b.status : 'approved' };
    const drv = await prisma.driver.upsert({ where: { phone }, update: data, create: { phone, ...data } });
    return { ok: true, driver: drv };
  });

  fastify.post('/api/ride/ops/:id/assign', async (req, reply) => {
    if (!ops(req, reply)) return;
    const drv = await prisma.driver.findUnique({ where: { id: String((req.body || {}).driverId || '') } });
    if (!drv || drv.status !== 'approved') return reply.code(400).send({ ok: false, error: 'approved driver required' });
    const res = await prisma.ride.updateMany({ where: { id: req.params.id, status: { in: ['requested', 'dispatching'] } }, data: { driverId: drv.id, status: 'assigned', assignedAt: new Date() } });
    if (res.count === 0) return reply.code(409).send({ ok: false, error: 'ride not assignable' });
    dispatch.cancel(req.params.id);
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id }, include: { driver: true } });
    return { ok: true, ride: pub(ride) };
  });

  fastify.post('/api/ride/ops/:id/status', async (req, reply) => {
    if (!ops(req, reply)) return;
    const b = req.body || {}; const to = String(b.status || '');
    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!(NEXT[ride.status] || []).includes(to)) return reply.code(409).send({ ok: false, error: 'cannot go ' + ride.status + ' -> ' + to });
    const data = { status: to };
    if (to === 'arrived') data.arrivedAt = new Date();
    if (to === 'ontrip') data.startedAt = new Date();
    if (to === 'completed') { data.completedAt = new Date(); if (b.cashPaid === true) data.paymentStatus = 'paid'; }
    if (to === 'cancelled') { data.cancelledAt = new Date(); data.cancelledBy = 'ops'; dispatch.cancel(ride.id); }
    const upd = await prisma.ride.update({ where: { id: ride.id }, data, include: { driver: true } });
    if (to === 'completed' && ride.driverId) await prisma.driver.update({ where: { id: ride.driverId }, data: { ridesCount: { increment: 1 } } });
    return { ok: true, ride: pub(upd) };
  });

  fastify.post('/api/ride/ops/:id/paid', async (req, reply) => {
    if (!ops(req, reply)) return;
    const upd = await prisma.ride.update({ where: { id: req.params.id }, data: { paymentStatus: 'paid' }, include: { driver: true } });
    return { ok: true, ride: pub(upd) };
  });

  fastify.get('/api/ride/ops/settings', async (req, reply) => { if (!ops(req, reply)) return; return { ok: true, settings: await settings.get() }; });
  fastify.post('/api/ride/ops/settings', async (req, reply) => { if (!ops(req, reply)) return; return { ok: true, settings: await settings.update(req.body || {}) }; });
};
```

- [ ] **Step 2: Write the module entry**

`ride/index.js`:
```js
'use strict';
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
const routes = require('./routes');

// registerRide(fastify, { prisma, sendTg, OWNER_KEY, OWNER_CHAT, ROUTER_URL, BASE_URL })
module.exports = function registerRide(fastify, deps) {
  const settings = makeSettings(deps.prisma);
  const geo = makeGeo({ routerUrl: deps.ROUTER_URL, prisma: deps.prisma });
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY });
  fastify.log.info('BinaSmart Ride module mounted');
};
```

- [ ] **Step 3: Remove the old `/ride` route and mount the module**

In `server.js`, delete line 231:
```js
fastify.get('/ride', async (req, reply) => reply.sendFile('ride.html'));
```
Then, immediately **before** the line `fastify.listen({ port: PORT, host: '127.0.0.1' })` (line ~2600), insert:
```js
// ===== BinaSmart Ride (Phase 1: rider app + concierge) =====
require('./ride')(fastify, {
  prisma, sendTg, OWNER_KEY,
  OWNER_CHAT: '8096525984',
  ROUTER_URL: process.env.ROUTER_URL || 'http://127.0.0.1:8989',
  BASE_URL: 'https://bina.et'
});
```

- [ ] **Step 4: Mark rides paid from the Chapa webhook**

In `server.js`, inside `async function markBookingPaid(type, code){ try{`, add as the **first** line of the `try`:
```js
    if(type==='ride'){ await prisma.ride.updateMany({ where:{ id: code }, data:{ paymentStatus:'paid' } }); return; }
```

- [ ] **Step 5: Restart and verify every endpoint with curl**

```bash
cd /var/www/connectcare/binasmart && cp server.js server.js.bak-ride-$(date +%s) && pm2 restart binasmart-api && sleep 2
K=$(grep -E '^OWNER_KEY=' .env | cut -d= -f2-)
echo "--- settings"; curl -s http://127.0.0.1:4210/api/ride/settings | python3 -c "import sys,json;d=json.load(sys.stdin);print([t['id']+':'+str(t['min']) for t in d['tiers']])"
echo "--- search"; curl -s "http://127.0.0.1:4210/api/ride/search?q=darul" | python3 -c "import sys,json;print([ (r['kind'],r['label']) for r in json.load(sys.stdin)['results']][:3])"
echo "--- quote"; curl -s -X POST http://127.0.0.1:4210/api/ride/quote -H 'content-type: application/json' -d '{"pickup":{"lat":9.0108,"lng":38.7578,"label":"Bole"},"dropoff":{"lat":8.9806,"lng":38.79,"label":"Meskel"}}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('estimate',d['estimate'],'| km',d['distanceM']/1000,'|',[(q['tier'],q['fareEtb']) for q in d['quotes']])"
echo "--- request (silent TG)"; RID=$(curl -s -X POST http://127.0.0.1:4210/api/ride/request -H 'content-type: application/json' -d '{"idemKey":"plan-test-1","tier":"economy","pickup":{"lat":9.0108,"lng":38.7578,"label":"Bole"},"dropoff":{"lat":8.9806,"lng":38.79,"label":"Meskel"},"riderName":"Plan Test","riderPhone":"0911000000","paymentMethod":"cash"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['ride']['id'])"); echo "ride=$RID"
sleep 1; curl -s "http://127.0.0.1:4210/api/ride/$RID?phone=0911000000" | python3 -c "import sys,json;r=json.load(sys.stdin)['ride'];print('status',r['status'],'| concierge',r['concierge'],'| fare',r['fareEtb'])"
echo "--- idempotent replay"; curl -s -X POST http://127.0.0.1:4210/api/ride/request -H 'content-type: application/json' -d '{"idemKey":"plan-test-1","tier":"economy","pickup":{"lat":9.0108,"lng":38.7578,"label":"Bole"},"dropoff":{"lat":8.9806,"lng":38.79,"label":"Meskel"},"riderName":"Plan Test","riderPhone":"0911000000"}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('duplicate',d.get('duplicate'),'same id',d['ride']['id']=='$RID')"
echo "--- ops: add driver + assign + advance"; DID=$(curl -s -X POST "http://127.0.0.1:4210/api/ride/ops/drivers?key=$K" -H 'content-type: application/json' -d '{"name":"Test Driver","phone":"0911000001","plate":"AA-12345","tier":"economy","vehicleMake":"Toyota Vitz","vehicleColour":"Silver"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['driver']['id'])")
curl -s -X POST "http://127.0.0.1:4210/api/ride/ops/$RID/assign?key=$K" -H 'content-type: application/json' -d "{\"driverId\":\"$DID\"}" | python3 -c "import sys,json;r=json.load(sys.stdin)['ride'];print('assigned ->',r['status'],'| driver',r['driver']['name'],r['driver']['plate'])"
for s in arriving arrived ontrip; do curl -s -X POST "http://127.0.0.1:4210/api/ride/ops/$RID/status?key=$K" -H 'content-type: application/json' -d "{\"status\":\"$s\"}" | python3 -c "import sys,json;print(' ->',json.load(sys.stdin)['ride']['status'])"; done
curl -s -X POST "http://127.0.0.1:4210/api/ride/ops/$RID/status?key=$K" -H 'content-type: application/json' -d '{"status":"completed","cashPaid":true}' | python3 -c "import sys,json;r=json.load(sys.stdin)['ride'];print(' ->',r['status'],'| paid',r['paymentStatus'])"
echo "--- rate"; curl -s -X POST "http://127.0.0.1:4210/api/ride/$RID/rate" -H 'content-type: application/json' -d '{"phone":"0911000000","stars":5}'
echo; echo "--- unauthorized ops"; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4210/api/ride/ops/queue?key=wrong"
```
**Before running:** the `request` step WILL trigger a concierge Telegram to the owner unless silent mode is on — so first add `RIDE_TG_SILENT=1` to `.env` (`echo 'RIDE_TG_SILENT=1' >> .env && pm2 restart binasmart-api`). Task 15 removes it.

Expected: tier list with mins `60/80/150/230/350`; a search hit with kind `building`; quote with `estimate False` and five fares; a ride id; `status dispatching | concierge True`; `duplicate True same id True`; `assigned -> assigned | driver Test Driver AA-12345`; `-> arriving`, `-> arrived`, `-> ontrip`, `-> completed | paid paid`; `{"ok":true}`; `401`. In `pm2 logs binasmart-api --lines 20` the `[ride] TG SILENT:` alert text appears.

- [ ] **Step 6: Clean the test rows and commit**

```bash
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{await p.ride.deleteMany({where:{riderPhone:'+251911000000'}});await p.rider.deleteMany({where:{phone:'+251911000000'}});await p.driver.deleteMany({where:{phone:'+251911000001'}});console.log('cleaned');await p.\$disconnect();})()" 2>&1 | grep -v Aborted
git add ride/ server.js && git commit -m "feat(ride): REST API, ops endpoints, module mount, Chapa paid hook" && git push origin main
```

---

### Task 10: Map style (BinaSmart palette, 3D buildings)

**Files:**
- Create: `public/ride/style.json`

- [ ] **Step 1: Write the style**

`public/ride/style.json`:
```json
{
  "version": 8,
  "name": "BinaSmart",
  "glyphs": "/static/map/fonts/{fontstack}/{range}.pbf",
  "sources": {
    "protomaps": { "type": "vector", "url": "pmtiles:///static/map/addis.pmtiles", "attribution": "© OpenStreetMap contributors · Protomaps" }
  },
  "layers": [
    { "id": "background", "type": "background", "paint": { "background-color": "#f3f7f4" } },
    { "id": "earth", "type": "fill", "source": "protomaps", "source-layer": "earth", "paint": { "fill-color": "#f3f7f4" } },
    { "id": "landuse-green", "type": "fill", "source": "protomaps", "source-layer": "landuse",
      "filter": ["in", "kind", "park", "garden", "grass", "forest", "wood", "cemetery", "golf_course", "nature_reserve", "recreation_ground", "pitch", "farmland"],
      "paint": { "fill-color": "#d6efdf" } },
    { "id": "landuse-built", "type": "fill", "source": "protomaps", "source-layer": "landuse",
      "filter": ["in", "kind", "commercial", "industrial", "retail", "residential", "hospital", "school", "university", "college", "aerodrome"],
      "paint": { "fill-color": "#eceff0" } },
    { "id": "water", "type": "fill", "source": "protomaps", "source-layer": "water", "paint": { "fill-color": "#bfe0ea" } },
    { "id": "roads-minor", "type": "line", "source": "protomaps", "source-layer": "roads",
      "filter": ["in", "kind", "minor_road", "other", "path"],
      "paint": { "line-color": "#ffffff", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 12, 0.5, 18, 8] } },
    { "id": "roads-medium", "type": "line", "source": "protomaps", "source-layer": "roads",
      "filter": ["==", "kind", "medium_road"],
      "paint": { "line-color": "#ffffff", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 11, 0.8, 18, 12] } },
    { "id": "roads-major", "type": "line", "source": "protomaps", "source-layer": "roads",
      "filter": ["==", "kind", "major_road"],
      "paint": { "line-color": "#fbe7b5", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 1, 18, 16] } },
    { "id": "roads-highway", "type": "line", "source": "protomaps", "source-layer": "roads",
      "filter": ["==", "kind", "highway"],
      "paint": { "line-color": "#f5d78a", "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 9, 1.5, 18, 20] } },
    { "id": "buildings-3d", "type": "fill-extrusion", "source": "protomaps", "source-layer": "buildings", "minzoom": 14,
      "paint": {
        "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 10], 0, "#e3ece7", 30, "#cfe1d7", 80, "#a9cfbc"],
        "fill-extrusion-height": ["coalesce", ["get", "height"], 10],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": 0.92 } },
    { "id": "roads-labels", "type": "symbol", "source": "protomaps", "source-layer": "roads", "minzoom": 14,
      "filter": ["in", "kind", "highway", "major_road", "medium_road", "minor_road"],
      "layout": { "symbol-placement": "line", "text-field": ["coalesce", ["get", "name"], ""], "text-font": ["Noto Sans Regular"], "text-size": 11 },
      "paint": { "text-color": "#5b6b62", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } },
    { "id": "pois", "type": "symbol", "source": "protomaps", "source-layer": "pois", "minzoom": 15,
      "layout": { "text-field": ["coalesce", ["get", "name"], ""], "text-font": ["Noto Sans Regular"], "text-size": 10.5, "text-offset": [0, 0.8], "text-anchor": "top" },
      "paint": { "text-color": "#047857", "text-halo-color": "#ffffff", "text-halo-width": 1.2 } },
    { "id": "places", "type": "symbol", "source": "protomaps", "source-layer": "places",
      "layout": { "text-field": ["coalesce", ["get", "name"], ""], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 16] },
      "paint": { "text-color": "#0f3d2e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } }
  ]
}
```

- [ ] **Step 2: Verify it's valid JSON and served**

```bash
cd /var/www/connectcare/binasmart && python3 -c "import json;json.load(open('public/ride/style.json'));print('style: valid json')"
curl -s -o /dev/null -w "style: HTTP %{http_code} %{content_type}\n" http://127.0.0.1:4210/static/ride/style.json
```
Expected: `style: valid json` and `HTTP 200 application/json`.

- [ ] **Step 3: Commit**

```bash
git add public/ride/style.json && git commit -m "feat(ride): BinaSmart 3D map style" && git push origin main
```

---

### Task 11: Map wrapper (`map.js`)

**Files:**
- Create: `public/ride/map.js`

- [ ] **Step 1: Write it**

`public/ride/map.js`:
```js
/* BinaSmart Ride — MapLibre wrapper: init, 3D with auto-degrade, markers, route line. */
window.BinaMap = (function () {
  var map = null, pickupMk = null, dropMk = null;

  function weakDevice() {
    try { return (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2); }
    catch (e) { return false; }
  }
  function wants3D() { var s = localStorage.getItem('bina_map_3d'); return s == null ? !weakDevice() : s === '1'; }

  function init(container, onLoad) {
    var protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    var three = wants3D();
    map = new maplibregl.Map({
      container: container, style: '/static/ride/style.json',
      center: [38.7578, 9.0108], zoom: 14.5, pitch: three ? 55 : 0, bearing: three ? -17 : 0, maxPitch: 70,
      attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
    map.on('load', function () {
      if (!three) map.setLayoutProperty('buildings-3d', 'visibility', 'none');
      if (onLoad) onLoad();
    });
    return map;
  }

  function set3D(on) {
    if (!map) return;
    localStorage.setItem('bina_map_3d', on ? '1' : '0');
    map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none');
    map.easeTo({ pitch: on ? 55 : 0, bearing: on ? -17 : 0, duration: 600 });
  }
  function is3D() { return wants3D(); }

  function mk(kind, lngLat) {
    var el = document.createElement('div');
    el.className = 'bm-mk bm-' + kind;
    el.innerHTML = kind === 'pickup' ? '<span class="bm-pulse"></span><span class="bm-dot"></span>' : '<span class="bm-pin">📍</span>';
    return new maplibregl.Marker({ element: el, anchor: kind === 'pickup' ? 'center' : 'bottom' }).setLngLat(lngLat).addTo(map);
  }
  function setPickup(p) { if (pickupMk) pickupMk.setLngLat([p.lng, p.lat]); else pickupMk = mk('pickup', [p.lng, p.lat]); }
  function setDrop(p) {
    if (!p) { if (dropMk) { dropMk.remove(); dropMk = null; } return; }
    if (dropMk) dropMk.setLngLat([p.lng, p.lat]); else dropMk = mk('drop', [p.lng, p.lat]);
  }

  function drawRoute(coords, bottomPad) {
    var gj = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
    if (map.getSource('route')) map.getSource('route').setData(gj);
    else {
      map.addSource('route', { type: 'geojson', data: gj });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#064e3b', 'line-width': 9, 'line-opacity': 0.35 } });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#059669', 'line-width': 5 } });
    }
    var b = coords.reduce(function (bb, c) { return bb.extend(c); }, new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(b, { padding: { top: 90, bottom: bottomPad || 340, left: 40, right: 40 }, pitch: map.getPitch(), duration: 900 });
  }
  function clearRoute() {
    if (map.getLayer('route-line')) { map.removeLayer('route-line'); map.removeLayer('route-casing'); map.removeSource('route'); }
  }
  function flyTo(p, zoom) { map.flyTo({ center: [p.lng, p.lat], zoom: zoom || 15.5, duration: 900 }); }
  function onClick(fn) { map.on('click', function (e) { fn({ lat: e.lngLat.lat, lng: e.lngLat.lng }); }); }

  return { init: init, set3D: set3D, is3D: is3D, setPickup: setPickup, setDrop: setDrop, drawRoute: drawRoute, clearRoute: clearRoute, flyTo: flyTo, onClick: onClick, get map() { return map; } };
})();
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/connectcare/binasmart && git add public/ride/map.js && git commit -m "feat(ride): map wrapper with 3D auto-degrade, markers, route" && git push origin main
```

---

### Task 12: Rider app — HTML, CSS, state machine

**Files:**
- Create: `public/ride.html` (replaces placeholder), `public/ride/ui.css`, `public/ride/app.js`
- Move: old `public/ride.html` → `public/ride-launch.html` (kept, unlinked)

- [ ] **Step 1: Keep the old landing page and write the new shell**

```bash
cd /var/www/connectcare/binasmart && git mv public/ride.html public/ride-launch.html
```

`public/ride.html`:
```html
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<title>BinaSmart Ride · ራይድ — Fixed-price rides in Addis Ababa</title>
<meta name="description" content="Get a ride in Addis Ababa in seconds. Fixed upfront price, no surge, no app to download. Pay cash, telebirr or Chapa. · በአዲስ አበባ በቋሚ ዋጋ መኪና ይያዙ።">
<link rel="canonical" href="https://bina.et/ride">
<meta property="og:title" content="BinaSmart Ride · ራይድ — Fixed-price rides in Addis">
<meta property="og:description" content="Fixed upfront price. No surge. No app to download. Moto · Bajaj · Economy · Comfort · XL.">
<meta property="og:image" content="https://bina.et/static/bina-property.png">
<meta property="og:url" content="https://bina.et/ride">
<meta name="theme-color" content="#059669">
<link rel="icon" href="/icon-32.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/static/vendor/maplibre-gl.css">
<link rel="stylesheet" href="/static/ride/ui.css">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"BinaSmart Ride","serviceType":"Ride hailing","provider":{"@type":"Organization","name":"BinaSmart","url":"https://bina.et"},"areaServed":{"@type":"City","name":"Addis Ababa"},"url":"https://bina.et/ride"}</script>
</head>
<body>
<div id="map"></div>

<header class="top">
  <a class="brand" href="/">🏢 Bina<span>Smart</span> <b>Ride</b></a>
  <button id="btn3d" class="chip3d" aria-label="Toggle 3D">3D</button>
</header>

<!-- Bottom sheet: one element, screens swap inside -->
<section id="sheet" class="sheet">
  <div class="grip"></div>

  <div class="screen" id="s-home">
    <h1>ወዴት? <small>Where to?</small></h1>
    <button class="field" id="openSearch"><span>🔍</span><span class="ph">መድረሻዎን ያስገቡ · Enter destination</span></button>
    <div class="from"><span class="dot"></span><span id="fromLabel">Locating you… · ቦታዎን እየፈለግን ነው</span><button id="editFrom">Change</button></div>
    <div class="hint">💸 Fixed price · no surge &nbsp;·&nbsp; 📲 No app needed &nbsp;·&nbsp; 💵 Cash / telebirr</div>
  </div>

  <div class="screen hidden" id="s-search">
    <div class="srow"><button class="back" id="closeSearch">‹</button><input id="q" placeholder="ሆቴል፣ ህንፃ፣ ሱቅ… · hotel, building, shop, street" autocomplete="off"></div>
    <div class="small" id="searchMode">Searching destination · <button id="pinMode" class="link">or tap the map</button></div>
    <ul id="results" class="results"></ul>
  </div>

  <div class="screen hidden" id="s-quote">
    <div class="tripline"><div><span class="dot"></span> <b id="qFrom"></b></div><div><span class="pin">📍</span> <b id="qTo"></b></div></div>
    <div class="small" id="qMeta"></div>
    <div id="tiers" class="tiers"></div>
    <div class="payrow">
      <label><input type="radio" name="pay" value="cash" checked> 💵 Cash · ጥሬ ገንዘብ</label>
      <label><input type="radio" name="pay" value="chapa"> 📱 telebirr / Chapa</label>
    </div>
    <button class="cta" id="request">ጉዞ ይጠይቁ · Request ride <span id="ctaFare"></span></button>
    <button class="link" id="cancelQuote">Change destination</button>
  </div>

  <div class="screen hidden" id="s-who">
    <h2>ስምዎ እና ስልክዎ <small>Your name & phone — once</small></h2>
    <input id="whoName" placeholder="ስም · Name" autocomplete="name">
    <input id="whoPhone" placeholder="09… · Phone" inputmode="tel" autocomplete="tel">
    <div class="small">ሹፌሩ ይደውልልዎታል · The driver will call this number.</div>
    <button class="cta" id="whoGo">ቀጥል · Continue</button>
  </div>

  <div class="screen hidden" id="s-finding">
    <div class="radar"><span></span><span></span><span></span><b>🚕</b></div>
    <h2 id="findTitle">ሹፌር እየፈለግን ነው… <small>Finding your driver…</small></h2>
    <div class="small" id="findSub">Usually under a minute.</div>
    <button class="link danger" id="cancelFinding">ሰርዝ · Cancel</button>
  </div>

  <div class="screen hidden" id="s-assigned">
    <div class="status" id="aStatus">ሹፌርዎ እየመጣ ነው · Driver on the way</div>
    <div class="driver">
      <div class="avatar" id="dPhoto">🚗</div>
      <div><b id="dName"></b><div class="small" id="dCar"></div><div class="small" id="dRating"></div></div>
      <div class="plate" id="dPlate"></div>
    </div>
    <div class="row2">
      <a class="btn" id="dCall" href="#">📞 Call</a>
      <a class="btn" id="dWa" href="#" target="_blank" rel="noopener">💬 WhatsApp</a>
    </div>
    <div class="fareline">Fare · ዋጋ <b id="aFare"></b> <span id="aPay"></span></div>
    <button class="link danger" id="cancelAssigned">ሰርዝ · Cancel ride</button>
  </div>

  <div class="screen hidden" id="s-done">
    <h2>ደረሱ! <small>You've arrived</small> 🎉</h2>
    <div class="fareline big">Total · ጠቅላላ <b id="doneFare"></b></div>
    <div id="payBox"></div>
    <div class="stars" id="stars"><button data-s="1">★</button><button data-s="2">★</button><button data-s="3">★</button><button data-s="4">★</button><button data-s="5">★</button></div>
    <div class="small" id="rateMsg">ሹፌሩን ይገምግሙ · Rate your driver</div>
    <div class="row2"><button class="btn" id="again">🔁 Ride again</button><button class="btn" id="returnTrip">↩️ Return trip</button></div>
  </div>

  <div class="screen hidden" id="s-cancelled">
    <h2>ጉዞው ተሰርዟል <small>Ride cancelled</small></h2>
    <button class="cta" id="againC">አዲስ ጉዞ · New ride</button>
  </div>
</section>

<div id="toast" class="toast hidden"></div>

<script src="/static/vendor/maplibre-gl.js"></script>
<script src="/static/vendor/pmtiles.js"></script>
<script src="/static/ride/map.js"></script>
<script src="/static/ride/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the CSS**

`public/ride/ui.css`:
```css
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--em:#059669;--em2:#047857;--ink:#0f172a;--mut:#64748b;--line:#e6ebe8;--gold:#d4a017;--bg:#fff}
html,body{height:100%;font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Ethiopic',sans-serif;color:var(--ink);background:#f3f7f4;overflow:hidden}
#map{position:fixed;inset:0}
.top{position:fixed;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top)) 14px 10px;pointer-events:none;z-index:5}
.top .brand{pointer-events:auto;text-decoration:none;color:#fff;font-weight:900;font-size:16px;background:linear-gradient(135deg,#064e3b,#059669);padding:8px 14px;border-radius:999px;box-shadow:0 8px 24px -10px rgba(6,78,59,.6)}
.top .brand span{color:var(--gold)}.top .brand b{font-weight:600;opacity:.9;margin-left:4px}
.chip3d{pointer-events:auto;border:0;background:#fff;color:var(--em2);font-weight:900;border-radius:999px;padding:8px 12px;box-shadow:0 6px 18px -8px rgba(0,0,0,.35);cursor:pointer}
.chip3d.off{color:var(--mut)}
.sheet{position:fixed;left:0;right:0;bottom:0;background:var(--bg);border-radius:24px 24px 0 0;box-shadow:0 -14px 40px -20px rgba(0,0,0,.35);padding:8px 18px calc(18px + env(safe-area-inset-bottom));max-height:72vh;overflow-y:auto;z-index:6;transition:transform .25s ease}
.grip{width:42px;height:5px;border-radius:5px;background:#dfe5e1;margin:2px auto 12px}
.hidden{display:none!important}
h1{font-size:26px;font-weight:900;letter-spacing:-.3px}h1 small,h2 small{display:block;font-size:13px;color:var(--mut);font-weight:600;margin-top:2px}
h2{font-size:20px;font-weight:900}
.field{width:100%;display:flex;gap:10px;align-items:center;background:#f1f5f2;border:1.5px solid var(--line);border-radius:16px;padding:14px;font-size:15.5px;margin:14px 0 12px;text-align:left;font-family:inherit;cursor:pointer}
.field .ph{color:#7b8a83}
.from{display:flex;align-items:center;gap:8px;font-size:13.5px;color:var(--mut)}
.from button,.link{background:none;border:0;color:var(--em2);font-weight:800;cursor:pointer;font-family:inherit;font-size:13px;margin-left:auto}
.link{display:block;margin:10px auto 0}
.link.danger{color:#b91c1c}
.dot{width:10px;height:10px;border-radius:50%;background:var(--em);display:inline-block;box-shadow:0 0 0 3px rgba(5,150,105,.2)}
.hint{margin-top:14px;font-size:11.5px;color:#8a9a92;text-align:center}
.srow{display:flex;gap:8px;align-items:center}
.back{border:0;background:#f1f5f2;width:40px;height:40px;border-radius:12px;font-size:22px;cursor:pointer}
#q,#whoName,#whoPhone{flex:1;width:100%;border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;font-size:15.5px;font-family:inherit;outline:0;margin:6px 0}
#q:focus,#whoName:focus,#whoPhone:focus{border-color:var(--em)}
.small{font-size:12.5px;color:var(--mut);margin:6px 0}
.results{list-style:none;margin-top:6px}
.results li{display:flex;gap:12px;align-items:center;padding:11px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.results .ic{width:36px;height:36px;border-radius:12px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}
.results b{display:block;font-size:14.5px}.results span{font-size:12px;color:var(--mut)}
.results .am{color:var(--em2);font-weight:700;margin-left:6px}
.tripline{font-size:14px;line-height:1.7}.tripline .pin{font-size:13px}
.tiers{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.tier{display:flex;align-items:center;gap:12px;border:1.5px solid var(--line);border-radius:16px;padding:10px 12px;cursor:pointer;transition:border-color .15s,background .15s}
.tier.sel{border-color:var(--em);background:#f0fdf7;box-shadow:0 0 0 3px rgba(5,150,105,.12)}
.tier .ic{font-size:26px}.tier b{display:block;font-size:14.5px}.tier .sub{font-size:11.5px;color:var(--mut)}
.tier .price{margin-left:auto;font-weight:900;font-size:16px;color:var(--em2)}
.payrow{display:flex;gap:14px;font-size:13.5px;margin:6px 0 12px}.payrow label{display:flex;gap:6px;align-items:center;cursor:pointer}
.cta{width:100%;border:0;border-radius:16px;padding:15px;font-size:16px;font-weight:900;color:#fff;background:linear-gradient(135deg,#064e3b,#059669 60%,#10b981);box-shadow:0 12px 28px -12px rgba(6,78,59,.7);cursor:pointer;font-family:inherit}
.cta:disabled{opacity:.6}
.cta span{opacity:.9;font-weight:700}
.radar{position:relative;width:110px;height:110px;margin:8px auto 14px}
.radar span{position:absolute;inset:0;border-radius:50%;border:2px solid var(--em);opacity:0;animation:ping 2.4s ease-out infinite}
.radar span:nth-child(2){animation-delay:.8s}.radar span:nth-child(3){animation-delay:1.6s}
.radar b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px}
@keyframes ping{0%{transform:scale(.3);opacity:.9}100%{transform:scale(1.15);opacity:0}}
.status{font-weight:900;color:var(--em2);font-size:15px;margin-bottom:10px}
.driver{display:flex;gap:12px;align-items:center;border:1.5px solid var(--line);border-radius:18px;padding:12px}
.avatar{width:52px;height:52px;border-radius:50%;background:#ecfdf5;display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden;flex:none}
.avatar img{width:100%;height:100%;object-fit:cover}
.plate{margin-left:auto;background:#0f172a;color:#fff;font-weight:900;padding:6px 10px;border-radius:8px;letter-spacing:1px;font-size:13px}
.row2{display:flex;gap:10px;margin:12px 0}
.btn{flex:1;text-align:center;text-decoration:none;border:1.5px solid var(--line);background:#fff;border-radius:14px;padding:12px;font-weight:800;color:var(--ink);cursor:pointer;font-family:inherit;font-size:14px}
.fareline{font-size:14px;color:var(--mut)}.fareline b{color:var(--ink);font-size:16px;margin-left:6px}.fareline.big b{font-size:26px;color:var(--em2)}
.stars{display:flex;gap:6px;justify-content:center;margin:12px 0 4px}
.stars button{border:0;background:none;font-size:34px;color:#d1d9d5;cursor:pointer}.stars button.on{color:var(--gold)}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76vh);background:#0f172a;color:#fff;padding:10px 16px;border-radius:999px;font-size:13.5px;z-index:9;box-shadow:0 10px 30px -10px rgba(0,0,0,.5)}
.bm-mk{position:relative}
.bm-dot{display:block;width:16px;height:16px;border-radius:50%;background:var(--em);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.35)}
.bm-pulse{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:rgba(5,150,105,.35);animation:ping 2s ease-out infinite}
.bm-pin{font-size:30px;filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))}
@media(prefers-reduced-motion:reduce){.radar span,.bm-pulse{animation:none}}
```

- [ ] **Step 3: Write the rider state machine**

`public/ride/app.js`:
```js
/* BinaSmart Ride — rider app. Screens: home → search → quote → (who) → finding → assigned → done. */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { pickup: null, dropoff: null, quote: null, tier: 'economy', ride: null, poll: null, searchTarget: 'dropoff', pinMode: false, settings: null };
  var ME = JSON.parse(localStorage.getItem('bina_ride_me') || 'null');

  function show(id) { document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); }); $(id).classList.remove('hidden'); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, 2600); }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function label(p) { return p ? p.label : ''; }

  // ---- map + location ----
  BinaMap.init('map', function () {
    $('btn3d').classList.toggle('off', !BinaMap.is3D());
    locate();
  });
  $('btn3d').addEventListener('click', function () { var on = !BinaMap.is3D(); BinaMap.set3D(on); $('btn3d').classList.toggle('off', !on); });

  function locate() {
    if (!navigator.geolocation) return setPickup({ lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa' });
    navigator.geolocation.getCurrentPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'የእርስዎ ቦታ · Your location' };
      if (p.lat < 8.5 || p.lat > 9.5 || p.lng < 38.4 || p.lng > 39.2) { toast('BinaSmart Ride is Addis Ababa only for now'); p = { lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa' }; }
      setPickup(p); BinaMap.flyTo(p, 15.5);
    }, function () { setPickup({ lat: 9.0108, lng: 38.7578, label: 'Bole, Addis Ababa (tap Change)' }); }, { enableHighAccuracy: true, timeout: 8000 });
  }
  function setPickup(p) { S.pickup = p; BinaMap.setPickup(p); $('fromLabel').textContent = p.label; }

  BinaMap.onClick(function (p) {
    if (!S.pinMode) return;
    p.label = p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    choose(p);
  });

  // ---- search ----
  $('openSearch').addEventListener('click', function () { S.searchTarget = 'dropoff'; openSearch(); });
  $('editFrom').addEventListener('click', function () { S.searchTarget = 'pickup'; openSearch(); });
  $('closeSearch').addEventListener('click', function () { S.pinMode = false; show('s-home'); });
  $('pinMode').addEventListener('click', function () { S.pinMode = true; toast(S.searchTarget === 'pickup' ? 'Tap the map to set pickup' : 'Tap the map to set destination'); });
  function openSearch() {
    $('searchMode').firstChild.textContent = (S.searchTarget === 'pickup' ? 'Searching pickup' : 'Searching destination') + ' · ';
    $('q').value = ''; $('results').innerHTML = ''; show('s-search'); setTimeout(function () { $('q').focus(); }, 60);
  }
  var st;
  $('q').addEventListener('input', function () {
    clearTimeout(st); var q = $('q').value.trim(); if (q.length < 2) { $('results').innerHTML = ''; return; }
    st = setTimeout(function () {
      var b = S.pickup ? '&lat=' + S.pickup.lat + '&lng=' + S.pickup.lng : '';
      api('/api/ride/search?q=' + encodeURIComponent(q) + b).then(function (d) {
        var icons = { building: '🏢', shop: '🛍️', osm: '📍' };
        $('results').innerHTML = (d.results || []).map(function (r, i) {
          return '<li data-i="' + i + '"><div class="ic">' + icons[r.kind] + '</div><div><b>' + esc(r.label) + (r.labelAm ? '<span class="am">' + esc(r.labelAm) + '</span>' : '') + '</b><span>' + esc(r.sub) + '</span></div></li>';
        }).join('') || '<li><span>ምንም አልተገኘም · Nothing found — try another name or tap the map</span></li>';
        $('results').querySelectorAll('li[data-i]').forEach(function (li) { li.addEventListener('click', function () { choose(d.results[+li.dataset.i]); }); });
      });
    }, 220);
  });
  function choose(p) {
    S.pinMode = false;
    if (S.searchTarget === 'pickup') { setPickup({ lat: p.lat, lng: p.lng, label: p.label }); if (S.dropoff) return quote(); show('s-home'); return; }
    S.dropoff = { lat: p.lat, lng: p.lng, label: p.label }; BinaMap.setDrop(S.dropoff); quote();
  }

  // ---- quote ----
  function quote() {
    if (!S.pickup || !S.dropoff) return;
    show('s-quote'); $('qFrom').textContent = label(S.pickup); $('qTo').textContent = label(S.dropoff); $('tiers').innerHTML = '<div class="small">ዋጋ እያሰላን ነው… · Calculating…</div>';
    api('/api/ride/quote', { pickup: S.pickup, dropoff: S.dropoff }).then(function (d) {
      if (!d.ok) { toast(d.error || 'Could not quote'); return show('s-home'); }
      S.quote = d; BinaMap.drawRoute(d.geometry, 360);
      $('qMeta').textContent = (d.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(d.durationS / 60) + ' min' + (d.estimate ? ' · estimate' : '');
      $('tiers').innerHTML = d.quotes.map(function (q) {
        return '<div class="tier' + (q.tier === S.tier ? ' sel' : '') + '" data-t="' + q.tier + '"><div class="ic">' + q.icon + '</div><div><b>' + esc(q.label) + ' · ' + esc(q.labelAm) + '</b><div class="sub">' + q.seats + ' seats · ~' + q.min + ' min</div></div><div class="price">' + q.fareEtb + ' ETB</div></div>';
      }).join('');
      $('tiers').querySelectorAll('.tier').forEach(function (el) { el.addEventListener('click', function () { S.tier = el.dataset.t; $('tiers').querySelectorAll('.tier').forEach(function (x) { x.classList.toggle('sel', x === el); }); setCta(); }); });
      setCta();
    });
  }
  function selQuote() { return (S.quote && S.quote.quotes.find(function (q) { return q.tier === S.tier; })) || null; }
  function setCta() { var q = selQuote(); $('ctaFare').textContent = q ? '· ' + q.fareEtb + ' ETB' : ''; }
  $('cancelQuote').addEventListener('click', function () { S.dropoff = null; BinaMap.setDrop(null); BinaMap.clearRoute(); show('s-home'); });

  // ---- identity + request ----
  $('request').addEventListener('click', function () { if (!ME) return show('s-who'); request(); });
  $('whoGo').addEventListener('click', function () {
    var name = $('whoName').value.trim(), phone = $('whoPhone').value.trim();
    if (name.length < 2 || !/^(\+?251|0)9\d{8}$/.test(phone.replace(/\s/g, ''))) return toast('ስም እና ትክክለኛ ስልክ ያስገቡ · Enter your name and a valid phone');
    ME = { name: name, phone: phone }; localStorage.setItem('bina_ride_me', JSON.stringify(ME)); request();
  });
  function request() {
    var q = selQuote(); if (!q) return;
    var pay = (document.querySelector('input[name=pay]:checked') || {}).value || 'cash';
    $('request').disabled = true;
    api('/api/ride/request', { idemKey: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())), tier: S.tier, pickup: S.pickup, dropoff: S.dropoff, paymentMethod: pay, riderName: ME.name, riderPhone: ME.phone })
      .then(function (d) {
        $('request').disabled = false;
        if (!d.ok) return toast(d.error || 'Could not request');
        S.ride = d.ride; localStorage.setItem('bina_ride_active', d.ride.id); show('s-finding'); startPoll();
      });
  }

  // ---- live status (poll every 4 s) ----
  function startPoll() { stopPoll(); tick(); S.poll = setInterval(tick, 4000); }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }
  function tick() {
    if (!S.ride) return;
    api('/api/ride/' + S.ride.id + '?phone=' + encodeURIComponent(ME.phone)).then(function (d) { if (d.ok) render(d.ride); });
  }
  function render(r) {
    S.ride = r;
    if (r.status === 'dispatching' || r.status === 'requested') {
      show('s-finding');
      $('findTitle').innerHTML = r.concierge ? 'ሹፌር እየመደብንልዎ ነው <small>A dispatcher is assigning your driver</small>' : 'ሹፌር እየፈለግን ነው… <small>Finding your driver…</small>';
      $('findSub').textContent = r.concierge ? 'እባክዎ ይጠብቁ — ወዲያውኑ እናሳውቅዎታለን · Please hold, we\'ll confirm shortly.' : 'Usually under a minute.';
    } else if (['assigned', 'arriving', 'arrived', 'ontrip'].includes(r.status)) {
      show('s-assigned');
      var d = r.driver || {};
      $('aStatus').textContent = { assigned: 'ሹፌር ተመድቧል · Driver assigned', arriving: 'ሹፌርዎ እየመጣ ነው · Driver on the way', arrived: 'ሹፌርዎ ደርሷል · Driver has arrived', ontrip: 'በጉዞ ላይ · On trip' }[r.status];
      $('dName').textContent = d.name || ''; $('dCar').textContent = [d.vehicle, r.tier].filter(Boolean).join(' · '); $('dRating').textContent = d.rating ? '★ ' + Number(d.rating).toFixed(1) : '';
      $('dPlate').textContent = d.plate || ''; $('dPhoto').innerHTML = d.photo ? '<img src="' + esc(d.photo) + '" alt="">' : '🚗';
      $('dCall').href = d.phone ? 'tel:' + d.phone : '#'; $('dWa').href = d.phone ? 'https://wa.me/' + String(d.phone).replace(/\D/g, '') : '#';
      $('aFare').textContent = r.fareEtb + ' ETB'; $('aPay').textContent = '· ' + (r.paymentMethod === 'cash' ? 'cash' : 'telebirr/Chapa');
      $('cancelAssigned').classList.toggle('hidden', r.status === 'ontrip');
    } else if (r.status === 'completed') {
      stopPoll(); localStorage.removeItem('bina_ride_active'); show('s-done');
      $('doneFare').textContent = r.fareEtb + ' ETB';
      $('payBox').innerHTML = r.paymentStatus === 'paid' ? '<div class="small">✅ ተከፍሏል · Paid</div>'
        : (r.paymentMethod === 'cash' ? '<div class="small">💵 ለሹፌሩ በጥሬ ገንዘብ ይክፈሉ · Pay the driver in cash</div>'
        : '<button class="cta" id="payNow">📱 Pay ' + r.fareEtb + ' ETB · telebirr / Chapa</button>');
      var pn = $('payNow'); if (pn) pn.addEventListener('click', payNow);
      if (r.driverRating) markStars(r.driverRating);
    } else if (r.status === 'cancelled') { stopPoll(); localStorage.removeItem('bina_ride_active'); show('s-cancelled'); }
  }
  function payNow() {
    api('/api/pay/init', { amount: S.ride.fareEtb, name: ME.name, phone: ME.phone, purpose: 'BinaSmart Ride ' + S.ride.id, bt: 'ride', bc: S.ride.id })
      .then(function (d) { if (d.ok && d.checkout_url) location.href = d.checkout_url; else toast(d.error || 'Payment unavailable — pay cash'); });
  }

  // ---- cancel / rate / again ----
  function cancel() { if (!S.ride) return; if (!confirm('ጉዞውን ይሰርዙ? · Cancel this ride?')) return; api('/api/ride/' + S.ride.id + '/cancel', { phone: ME.phone }).then(function (d) { if (d.ok) render(d.ride); else toast(d.error || 'Cannot cancel now'); }); }
  $('cancelFinding').addEventListener('click', cancel); $('cancelAssigned').addEventListener('click', cancel);
  function markStars(n) { $('stars').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.dataset.s <= n); }); }
  $('stars').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { var n = +b.dataset.s; markStars(n); api('/api/ride/' + S.ride.id + '/rate', { phone: ME.phone, stars: n }).then(function () { $('rateMsg').textContent = 'አመሰግናለሁ! · Thank you!'; }); }); });
  function reset(swap) {
    var a = S.pickup, b = S.dropoff; S.ride = null; S.quote = null; BinaMap.clearRoute();
    if (swap && a && b) { setPickup({ lat: b.lat, lng: b.lng, label: b.label }); S.dropoff = { lat: a.lat, lng: a.lng, label: a.label }; BinaMap.setDrop(S.dropoff); return quote(); }
    S.dropoff = null; BinaMap.setDrop(null); show('s-home');
  }
  $('again').addEventListener('click', function () { reset(false); }); $('againC').addEventListener('click', function () { reset(false); });
  $('returnTrip').addEventListener('click', function () { reset(true); });

  // ---- resume an active ride after reload ----
  var active = localStorage.getItem('bina_ride_active');
  if (active && ME) { S.ride = { id: active }; startPoll(); }
})();
```

- [ ] **Step 4: Verify the page serves, the map loads, and a full ride works in a real browser**

```bash
cd /var/www/connectcare/binasmart && pm2 restart binasmart-api && sleep 2
for p in /ride /static/ride/app.js /static/ride/ui.css /static/ride/map.js; do curl -s -o /dev/null -w "$p HTTP %{http_code}\n" http://127.0.0.1:4210$p; done
```
Expected: all `HTTP 200`.

Then in the browser (Claude Browser pane or Chrome) open `https://bina.et/ride` and check: map renders with 3D buildings and BinaSmart colours; Amharic labels render (not boxes); tapping "Where to?" → typing `darul` shows a 🏢 directory hit → choosing it draws the route and shows 5 tier prices; "Request ride" asks name/phone once, then shows the radar screen and (with no drivers online) switches to "A dispatcher is assigning your driver". Use the ops API from Task 9 Step 5 to assign a driver and advance to completed, and confirm the rider screen updates to the driver card, then "You've arrived" with stars. Clean up the test rows afterwards as in Task 9 Step 6.

- [ ] **Step 5: Commit**

```bash
git add public/ride.html public/ride-launch.html public/ride/ && git commit -m "feat(ride): rider app — 3D map, directory search, fixed-fare quote, request, live status, rating" && git push origin main
```

---

### Task 13: Ops console

**Files:**
- Create: `public/ride-ops.html`

- [ ] **Step 1: Write it**

`public/ride-ops.html`:
```html
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ride Ops · BinaSmart</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Ethiopic',sans-serif;background:#0b1220;color:#e5eef3;padding:14px}
h1{font-size:18px;margin-bottom:10px}h2{font-size:14px;color:#9fb3c8;margin:18px 0 8px;text-transform:uppercase;letter-spacing:1px}
.card{background:#111c2f;border:1px solid #1f2d45;border-radius:14px;padding:12px;margin-bottom:10px}
.card.con{border-color:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.25)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
button,select,input{font-family:inherit;font-size:13px;border-radius:9px;border:1px solid #2b3d5a;background:#0f1a2c;color:#e5eef3;padding:8px 10px}
button{cursor:pointer;background:#059669;border-color:#059669;color:#fff;font-weight:800}button.sec{background:#1f2d45;border-color:#2b3d5a}button.red{background:#b91c1c;border-color:#b91c1c}
.tag{font-size:11px;font-weight:900;padding:3px 8px;border-radius:999px;background:#1f2d45}.tag.con{background:#f59e0b;color:#000}
.mut{color:#9fb3c8;font-size:12.5px}a{color:#5fe3cf}textarea{width:100%;min-height:200px;font-family:monospace;font-size:12px;background:#0f1a2c;color:#e5eef3;border:1px solid #2b3d5a;border-radius:9px;padding:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}
</style></head><body>
<h1>🚕 BinaSmart Ride · Ops <span class="mut" id="clock"></span></h1>
<div class="card"><div class="row"><b>Add / update driver</b></div>
  <div class="row"><input id="dName" placeholder="Name"><input id="dPhone" placeholder="Phone 09…"><input id="dPlate" placeholder="Plate"><select id="dTier"><option>economy</option><option>moto</option><option>bajaj</option><option>comfort</option><option>xl</option></select><input id="dMake" placeholder="Vehicle e.g. Toyota Vitz"><input id="dColour" placeholder="Colour"><button id="dSave">Save driver</button></div>
</div>
<h2>Active rides <span id="nActive"></span></h2><div id="active"></div>
<h2>Recent</h2><div id="recent"></div>
<h2>Drivers</h2><div id="drivers" class="card grid"></div>
<h2>Settings (fares & knobs — JSON)</h2><div class="card"><textarea id="settings"></textarea><div class="row"><button id="saveSettings">Save settings</button><span class="mut">Prices in ETB. Changes apply to new quotes immediately.</span></div></div>
<script>
var K=new URLSearchParams(location.search).get('key')||'', FOCUS=new URLSearchParams(location.search).get('ride')||'';
function api(p,b){return fetch(p+(p.includes('?')?'&':'?')+'key='+encodeURIComponent(K),b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{}).then(function(r){return r.json();});}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
var DRIVERS=[];
function rideCard(r,active){
  var next={requested:['cancelled'],dispatching:['cancelled'],assigned:['arriving','arrived','cancelled'],arriving:['arrived','cancelled'],arrived:['ontrip','cancelled'],ontrip:['completed']}[r.status]||[];
  var osm='https://www.openstreetmap.org/?mlat='+r.pickup.lat+'&mlon='+r.pickup.lng+'#map=17/'+r.pickup.lat+'/'+r.pickup.lng;
  var h='<div class="card'+(r.concierge&&!r.driver?' con':'')+'" id="r-'+r.id+'"><div class="row"><span class="tag'+(r.concierge&&!r.driver?' con':'')+'">'+(r.concierge&&!r.driver?'NEEDS DRIVER':r.status.toUpperCase())+'</span><b>'+r.tier.toUpperCase()+'</b> · <b>'+r.fareEtb+' ETB</b> <span class="mut">('+r.paymentMethod+' · '+r.paymentStatus+')</span><span class="mut">'+new Date(r.requestedAt).toLocaleTimeString()+'</span></div>';
  h+='<div class="mut">From: <a target="_blank" href="'+osm+'">'+esc(r.pickup.label)+'</a><br>To: '+esc(r.dropoff.label)+' · '+(r.distanceM/1000).toFixed(1)+' km</div>';
  h+='<div class="mut">Rider: <b>'+esc(r.riderName)+'</b> <a href="tel:'+esc(r.riderPhone)+'">'+esc(r.riderPhone)+'</a></div>';
  if(r.driver) h+='<div class="mut">Driver: <b>'+esc(r.driver.name)+'</b> '+esc(r.driver.plate)+' · '+esc(r.driver.phone)+'</div>';
  if(active){
    if(!r.driver&&['requested','dispatching'].includes(r.status)) h+='<div class="row"><select id="sel-'+r.id+'">'+DRIVERS.filter(function(d){return d.status==='approved';}).map(function(d){return '<option value="'+d.id+'">'+esc(d.name)+' · '+esc(d.plate)+' · '+d.tier+'</option>';}).join('')+'</select><button onclick="assign(\''+r.id+'\')">Assign</button></div>';
    h+='<div class="row">'+next.map(function(s){return '<button class="'+(s==='cancelled'?'red':'sec')+'" onclick="setStatus(\''+r.id+'\',\''+s+'\')">'+s+'</button>';}).join('')+(r.status==='ontrip'?'<button onclick="setStatus(\''+r.id+'\',\'completed\',true)">completed + cash paid</button>':'')+(r.paymentStatus!=='paid'?'<button class="sec" onclick="paid(\''+r.id+'\')">mark paid</button>':'')+'</div>';
  }
  return h+'</div>';
}
function assign(id){api('/api/ride/ops/'+id+'/assign',{driverId:document.getElementById('sel-'+id).value}).then(load);}
function setStatus(id,s,cash){api('/api/ride/ops/'+id+'/status',{status:s,cashPaid:!!cash}).then(function(d){if(!d.ok)alert(d.error);load();});}
function paid(id){api('/api/ride/ops/'+id+'/paid',{}).then(load);}
function load(){
  api('/api/ride/ops/drivers').then(function(d){DRIVERS=d.drivers||[];document.getElementById('drivers').innerHTML=DRIVERS.map(function(x){return '<div><b>'+esc(x.name)+'</b><div class="mut">'+esc(x.plate)+' · '+x.tier+' · '+x.status+' · ★'+x.rating+' · '+x.ridesCount+' rides</div></div>';}).join('')||'<span class="mut">No drivers yet — add one above.</span>';
    return api('/api/ride/ops/queue');}).then(function(d){
    if(!d.ok){document.body.innerHTML='<h1>401 — bad key</h1>';return;}
    document.getElementById('nActive').textContent='('+d.active.length+')';
    document.getElementById('active').innerHTML=d.active.map(function(r){return rideCard(r,true);}).join('')||'<div class="mut">No active rides.</div>';
    document.getElementById('recent').innerHTML=d.recent.map(function(r){return rideCard(r,false);}).join('')||'<div class="mut">—</div>';
    if(FOCUS){var el=document.getElementById('r-'+FOCUS);if(el){el.scrollIntoView({block:'center'});FOCUS='';}}
    document.getElementById('clock').textContent='· updated '+new Date().toLocaleTimeString();
  });
}
document.getElementById('dSave').onclick=function(){api('/api/ride/ops/drivers',{name:dName.value,phone:dPhone.value,plate:dPlate.value,tier:dTier.value,vehicleMake:dMake.value,vehicleColour:dColour.value,status:'approved'}).then(function(d){if(!d.ok)return alert(d.error);dName.value=dPhone.value=dPlate.value=dMake.value=dColour.value='';load();});};
api('/api/ride/ops/settings').then(function(d){if(d.ok)document.getElementById('settings').value=JSON.stringify(d.settings,null,2);});
document.getElementById('saveSettings').onclick=function(){var v;try{v=JSON.parse(document.getElementById('settings').value);}catch(e){return alert('Invalid JSON');}api('/api/ride/ops/settings',v).then(function(d){if(d.ok)alert('Saved');else alert(d.error);});};
load();setInterval(load,5000);
</script></body></html>
```

- [ ] **Step 2: Verify**

```bash
cd /var/www/connectcare/binasmart && K=$(grep -E '^OWNER_KEY=' .env | cut -d= -f2-)
curl -s -o /dev/null -w "ops page HTTP %{http_code}\n" http://127.0.0.1:4210/ride-ops
curl -s "http://127.0.0.1:4210/api/ride/ops/queue?key=$K" | python3 -c "import sys,json;d=json.load(sys.stdin);print('queue ok',d['ok'],'| active',len(d['active']),'| recent',len(d['recent']))"
```
Expected: `HTTP 200`, `queue ok True | active 0 | recent 0` (after Task 9 cleanup). Open `https://bina.et/ride-ops?key=<OWNER_KEY>` in the browser: driver form, empty queue, drivers list, settings JSON pre-filled.

- [ ] **Step 3: Commit**

```bash
git add public/ride-ops.html && git commit -m "feat(ride): owner ops console — concierge queue, assign, status, drivers, settings" && git push origin main
```

---

### Task 14: Homepage card + Bini knows about Ride

**Files:**
- Modify: `public/gemini-home.html` (ride card), `server.js` (`ASSIST_SYS` "WHAT BINASMART OFFERS")

- [ ] **Step 1: Ride card text**

In `public/gemini-home.html` replace:
```html
<a class="sc" href="/ride"><div class="ic">🚕</div><div class="t">Ride · ራይድ</div><div class="d">Get a ride in Addis — no app, fixed price · coming soon</div></a>
```
with:
```html
<a class="sc" href="/ride"><div class="ic">🚕</div><div class="t">Ride · ራይድ</div><div class="d">Get a ride in Addis — fixed price, no surge, no app</div></a>
```

- [ ] **Step 2: Bini prompt line**

In `server.js`, inside `ASSIST_SYS`, after the line starting `- Also: events & cinema, hotel & travel booking, online payments and a wallet.` add:
```
- 🚕 BinaSmart Ride (/ride): fixed upfront price, no surge, no app to download; Moto, Bajaj, Economy, Comfort, XL; pay cash or telebirr/Chapa; Addis Ababa only. Quote a price by opening /ride and entering the destination — never guess fares yourself.
```

- [ ] **Step 3: Restart, verify, commit**

```bash
cd /var/www/connectcare/binasmart && pm2 restart binasmart-api && sleep 2
curl -s http://127.0.0.1:4210/ | grep -o "fixed price, no surge, no app" 
curl -s -m 30 -X POST http://127.0.0.1:4210/api/assistant -H 'content-type: application/json' -d '{"message":"ራይድ አላችሁ? ዋጋ ስንት ነው?"}' | python3 -c "import sys,json;r=json.load(sys.stdin)['reply'];print('mentions /ride:', '/ride' in r);print(r[:200])"
git add public/gemini-home.html server.js && git commit -m "feat(ride): homepage card live; Bini knows about Ride" && git push origin main
```
Expected: the card text is found; Bini's reply mentions `/ride` and does not state a fare number.

---

### Task 15: Go-live checks, silent flag off, docs

**Files:**
- Modify: `.env` (remove `RIDE_TG_SILENT`), `README.md`

- [ ] **Step 1: Full test suite + services**

```bash
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -3
pm2 jlist | python3 -c "import sys,json;print({p['name']:p['pm2_env']['status'] for p in json.load(sys.stdin) if p['name'] in ('binasmart-api','gh-routing')})"
```
Expected: `# fail 0`; both processes `online`.

- [ ] **Step 2: Turn real Telegram alerts on (the first real request is the proof — no test send)**

```bash
sed -i '/^RIDE_TG_SILENT=/d' .env && pm2 restart binasmart-api && grep -c RIDE_TG_SILENT .env
```
Expected: `0`.

- [ ] **Step 3: README section**

Add under "What's inside" in `README.md`:
```markdown
### 🚕 BinaSmart Ride
Fixed-price rides in Addis Ababa — no surge, no app. BinaSmart-styled 3D map (self-hosted OSM tiles + GraphHopper routing), directory-aware pickup/dropoff search, five tiers, cash or telebirr/Chapa. Phase 1 dispatches to online drivers and falls back to a concierge queue (owner assigns a driver) so rides work from day one. See `docs/superpowers/specs/2026-09-02-binasmart-ride-design.md`.
```

- [ ] **Step 4: Commit and record memory**

```bash
git add README.md && git commit -m "docs: BinaSmart Ride phase 1" && git push origin main
```
Then update the memory file `project_binasmart.md` (Windows side) with: GraphHopper under pm2 `gh-routing` on 127.0.0.1:8989 (graph in `/root/routing`), tiles at `public/map/addis.pmtiles`, ops console `/ride-ops?key=OWNER_KEY`, `RIDE_TG_SILENT=1` for silent verification, Phase 2/3 pending.

---

## Self-review (done while writing)

- **Spec coverage (Phase 1 items):** 3D map + BinaSmart style + auto-degrade (T10, T11) · directory + OSM search (T6, T9, T12) · routing + fallback (T1, T6) · 5-tier fixed fare, locked server-side (T4, T9) · idempotent, rate-limited request (T9) · concierge fallback to Telegram (T7, T8, T9) · driver-assigned screen + status progression (T9, T12, T13) · completion + rating (T9, T12) · cash + Chapa/telebirr payment via existing `/api/pay/init` + webhook hook (T9, T12) · ops console with concierge queue + settings + drivers (T13) · tile caching headers (T2) · tests for fare/settings/geo/dispatch (T4–T8) · silent verification, no live test sends (T9, T15). Deferred to Phase 2/3 by design: WebSockets/live GPS, driver app, Telegram Mini App, wallet, share-trip, SOS, cancel fees.
- **Placeholder scan:** none.
- **Type consistency:** `settings.get()/update()`, `geo.route()/searchPlaces()`, `telegram.conciergeAlert()/ownerNote()`, `dispatch.start()/cancel()/toConcierge()`, `quoteFare()/quoteAll()`, `pub()` shape used by app.js (`ride.driver.{name,phone,photo,plate,vehicle,rating}`), API paths, and the `ride:status` enum match across tasks.
