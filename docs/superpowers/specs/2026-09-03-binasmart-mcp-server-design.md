# BinaSmart MCP Server — Design

**Date:** 2026-09-03 · **Status:** approved by Ibrahim (brainstorm 2026-09-03) · **Depends on:** BinaSmart Ride Phase 1 (live)

## 1. Why

Ibrahim asked for BinaSmart Ride on "Google's new mini-app platform". Research (2026-09-03) found Google has **no** open, Telegram-style mini-app platform:

| What Google shipped | Reality |
|---|---|
| Gemini *Connected apps* (Canva, OpenTable, Zocdoc…) | invite-only partnerships; developer question of 2026-08-07 unanswered |
| *Custom apps for Gemini Spark* | any remote MCP server URL, pasted at gemini.google.com → Settings → Connected apps; Spark = Gemini Ultra, US, 18+, English |
| Search "mini apps" (I/O 2026) | Google builds personal dashboards; AI Pro/Ultra, US |
| Opal mini apps in Gemini (Dec 2025) | no-code Gems users build for themselves |

The one artefact all three AI ecosystems accept today is a **remote MCP server**: Gemini Spark custom apps, ChatGPT Apps (MCP-backed, submitted to the app directory), Claude connectors/Claude Code. So BinaSmart gets a public MCP server at `https://bina.et/mcp`. When Google opens Connected apps publicly, this is what they will take.

## 2. Decisions

| Question | Decision |
|---|---|
| Booking through assistants | **Yes, full booking** — request/cancel a ride; a real ride lands in the concierge queue + Telegram like `/ride` |
| Scope | **Ride + directory + guides**, 9 tools; food orders, hotel/ticket booking, driver tools out of scope |
| Build approach | **Separate service `bina-mcp`** (same template as gccdomestic's `gcc-mcp`), not mounted in `binasmart-api` |
| URL | path `bina.et/mcp` (bina.et DNS is at Ethio Telecom with no subdomain records; a path needs no DNS/cert work) |
| Auth | none (public, like gccdomestic); write tools protected by phone validation + rate limits |

## 3. Architecture

`mcp-server/` inside the BinaSmart repo:

| File | Responsibility |
|---|---|
| `server.mjs` | Express + `StreamableHTTPServerTransport`, **stateless** (new McpServer per request). Listens 127.0.0.1:**3021**. `GET /mcp` → docs.md, `POST /mcp` → protocol, `GET /mcp/health` → 200/503 (pings Postgres + ride API). |
| `tools/ride.mjs` | 4 ride tools. Calls `http://127.0.0.1:4210/api/ride/*` (8 s timeout). Never touches ride tables directly, so fare locking, idempotency, dispatch and the Telegram alert are reused untouched. |
| `tools/directory.mjs` | `search_places`, `list_events`, `get_hotel_rooms`, `get_hospital_departments`. Prisma read-only, explicit `select` lists only. |
| `tools/guides.mjs` | `get_ethiopia_guide`. Startup: read the 21 guide HTML files from `public/`, strip nav/script/style/footer, keep headings + paragraphs + list items as text, cache in memory (refresh = restart). |
| `docs.md` | human/crawler page for `GET /mcp` |
| `package.json` | own deps: `@modelcontextprotocol/sdk`, `express`, `zod`, `@prisma/client` + `prisma` (generated from `../prisma/schema.prisma`). Main app's node_modules untouched. |

**Process:** pm2 `bina-mcp`, `max_memory_restart 256M`, `exp_backoff_restart_delay 2000`, saved.
**nginx:** `location ^~ /mcp { proxy_pass http://127.0.0.1:3021; proxy_buffering off; proxy_read_timeout 120s; }` in the bina.et 443 block. Nothing else changes.
**Main app touch points:** `/llms.txt` gains a "Developer resources → https://bina.et/mcp" line; `public/.well-known/mcp-registry-auth` proof file for the MCP Registry. No functional change to `server.js`.

**Caller identity for the ride API:** assistants call from OpenAI/Google/Anthropic egress, so the ride API's per-IP limit would throttle everyone together. `bina-mcp` sets `X-Real-IP: mcp-<sha1(phone)[:12]>` on ride API calls, so the existing **5 requests / 10 min / phone** rule governs booking. nginx overwrites `X-Real-IP` with `$remote_addr` for internet callers, so the rule cannot be bypassed from outside.

## 4. Tools

All responses: JSON text content; include `source_url` back to bina.et (ride tools also the WhatsApp fallback); Amharic names alongside English where present.

### Ride (via API)
- **`quote_ride(pickup, dropoff)`** — each point `{lat,lng}` or a place name (resolved via the directory first, then OSM/Photon through `/api/ride/search`). Returns `distance_m`, `eta_min`, five tiers with fixed ETB fares, note "fixed price, no surge, cash or telebirr/Chapa, Addis Ababa only". Ambiguous name → returns candidates, does not guess. `readOnlyHint: true`.
- **`request_ride(tier, pickup, dropoff, rider_name, rider_phone, payment_method='cash')`** — phone must normalise to `+2519…`/`+2517…` (13 chars). `idemKey = sha1(phone|lat4,lng4|lat4,lng4|floor(now/600s))` so retries and confirm loops never double-book. Returns `ride_id`, `fare_etb`, `status`, `tracking_url = https://bina.et/ride?id=<id>`; text tells the assistant to read fare + ID back to the user. `readOnlyHint: false`.
- **`get_ride_status(ride_id, rider_phone)`** — mirrors `/api/ride/:id?phone=` (phone must match). Returns status, driver name/vehicle/plate/phone when assigned. `readOnlyHint: true`.
- **`cancel_ride(ride_id, rider_phone)`** — `/api/ride/:id/cancel`; only before `ontrip`. `readOnlyHint: false, destructiveHint: true`.

### Directory (Prisma, read-only)
- **`search_places(query, category?, limit?)`** — buildings by name/nameAm; shops by name/nameAm or `category` (CAFE RESTAURANT PHARMACY RETAIL SERVICE GYM SALON CLINIC BANK OFFICE). Result: `kind`, `name`, `name_am`, `building`, `unit`, `phone` (shops only), `lat/lng` when the building is geocoded, `url`, and `is_hotel` / `is_hospital` flags so the assistant knows to call the next tools. Active tenancies only. Max 25.
- **`get_hotel_rooms(slug)`** — active room types: name, price_per_night, capacity, amenities, `book_url`.
- **`get_hospital_departments(slug, date?)`** — same maths as `/api/hospital/:slug`: name, fee, doctors, hours, floor/room, `slots_left`, `book_url`.
- **`list_events()`** — active, future events: title, type, venue, starts_at, price_from, seats_left, `url`.

### Guides
- **`get_ethiopia_guide(slug?)`** — no slug → list of 21 guides (slug, title, one-line summary). With slug → cleaned text (cap 12 000 chars) + `url`. Unknown slug → the list, not an error.

**Server `instructions`:** what BinaSmart is; Addis-only ride coverage; "always confirm fare and rider phone with the user before `request_ride`"; cite `source_url`.

## 5. Safety, limits, errors

- **Per-phone:** ride API 5 / 10 min (via synthetic `X-Real-IP`).
- **Per-caller (in `bina-mcp`, in-memory):** key = `Mcp-Session-Id` header if present else caller IP; 30 tool calls/min, 10 `request_ride`/hour. Over → tool error "slow down".
- **Validation:** zod on every input; phone checked before any network call; bad phone → error naming the expected format.
- **Ride API errors:** connection refused / 5xx / timeout → `isError` "BinaSmart Ride is temporarily unavailable — book at https://bina.et/ride or WhatsApp"; 429 → "slow down"; 400 → API message passed through.
- **Postgres error** in directory tools → `isError` "directory unavailable"; ride tools unaffected (they do not use Prisma).
- **Secrets:** only `DATABASE_URL`, read from `../.env` at startup. No owner key, no Telegram token in this process.
- **Data:** explicit selects; owner fields (TIN, bank accounts, ownerKey, tenant data) never selectable; ride lookups always need the phone.
- **Logs:** one line per tool call (tool, ms, ok/err); phones masked to last 3 digits. No stack traces to clients.

## 6. Testing

Node built-in runner from `mcp-server/` (`node --test`, bare — Node 22 treats a directory arg as a glob).
- Unit: phone normalisation (09…, +251…, 251…, rejects short/foreign), idemKey stable within a 10-min bucket and different across buckets, guide HTML→text on a fixture, per-caller limiter count/reset.
- Tool tests against a **local HTTP stub** of the ride API returning 200/400/429/500/timeout — every error branch exercised, nothing live touched.
- Protocol smoke: real server on a random port; `initialize` → `tools/list` (9 tools) → `tools/call get_ethiopia_guide`.
- ⛔ No test calls the live `/api/ride/request`. The first real assistant booking is the proof.

## 7. Rollout

1. Build + test on the VPS on :3021, no nginx change.
2. Read-only tools verified against live DB with curl.
3. nginx location, reload; `GET https://bina.et/mcp` shows docs; `tools/list` → 9.
4. `pm2 save`; commit + push; README section.
5. `claude mcp add --transport http binasmart https://bina.et/mcp`; `quote_ride` Bole → Piassa end to end; screenshot.
6. MCP Registry: proof at `https://bina.et/.well-known/mcp-registry-auth`, namespace `et.bina`, publish v1.0.0 (`mcp-publisher` in `/root/storage/mcp-publisher/`). PulseMCP/Glama sync automatically.
7. `/llms.txt` developer-resources line.

**Manual (Ibrahim), text prepared by Claude:** Gemini → Settings → Connected apps → Custom apps for Spark → `https://bina.et/mcp` (US Ultra only today); ChatGPT Apps submission portal (domain verification, 5 positive + 3 negative test cases, countries); Claude.ai connector directory partner form.

## 8. Out of scope
ChatGPT interactive UI widgets (Apps SDK `outputTemplate`), OAuth, food ordering, hotel/ticket booking, driver-side tools, Telegram Mini App (separate spec).

## 9. Amendments (2026-09-03, planning)
1. Directory tools use the `pg` driver with explicit SQL and column lists instead of a second Prisma client — a second `prisma generate` against `../prisma/schema.prisma` would write into the main app's `node_modules`. Same read-only guarantee, no shared build artefacts.
2. CORS headers are open on every `/mcp` method (as on gccdomestic's server) so browser-based MCP clients can connect. The server has no auth and no secrets in responses, so this exposes nothing extra.

## 9. Amendments (2026-09-03, planning)
1. Directory tools use the `pg` driver with explicit SQL and column lists instead of a second Prisma client — a second `prisma generate` against `../prisma/schema.prisma` would write into the main app's `node_modules`. Same read-only guarantee, no shared build artefacts.
2. CORS headers are open on every `/mcp` method (as on gccdomestic's server) so browser-based MCP clients can connect. The server has no auth and no secrets in responses, so this exposes nothing extra.
