# BinaSmart Events — General Admission (Phase A.5) — Design

**Date:** 2026-09-04 · **Status:** approved in conversation · **Owner:** Ibrahim
**Builds on:** `2026-09-04-binasmart-cinema-seat-booking-design.md` (Phase A, live). Watch (streaming, rent-per-film) is a separate spec, gated on Chapa live keys and a signed film licence.

## 1. Goal

Concerts, theatre, meetings and other events sell tickets on the same `/cinema` side as films, with QR tickets and the same door scanner — without a seat map. A buyer picks **how many** places in a tier (VIP × 2), not which chairs. The old `/events` page and its booking API are retired.

## 2. Approach: tiers are invisible chairs

A general-admission event is a Show in a Hall whose template is `{ "kind": "ga", "sections": [{ "name": "VIP", "nameAm": "ቪአይፒ", "capacity": 50 }, { "name": "Regular", "nameAm": "መደበኛ", "capacity": 200 }] }`.
`seatmap.js` expands a GA template into synthetic seat ids `VIP-001 … VIP-050`, `REGULAR-001 … REGULAR-200` (section name upper-cased, non-alphanumerics dropped, 3-digit index). Every existing rule then applies unchanged: `SeatHold @@unique([showId, seat])` prevents overselling, checkout prices each place from `Show.prices[section]`, cutoff release, check-in first-scan-wins, cancellation.

Rejected: separate `sold` counters per tier with their own compare-and-swap (second concurrency path, second ticket path, double the tests).

## 3. Data

No new tables. `Hall.layout.kind` is `"seats"` (default, today's rows/seatsPerRow) or `"ga"`. `Hall.capacity` = sum of tier capacities. `Ticket.seats` keeps the synthetic ids; presentation collapses them to `VIP × 2`.

`seatmap.js` additions: `isGa(layout)`, `validateLayout` accepts GA (1–20 sections, capacity 1–5000 each, unique names), `seatsFor` yields `{ id, section, blocked:false, wheelchair:false, row:null, n }`, `isSeat`/`sectionOf`/`priceOf` work on synthetic ids, `summarise(layout, seats)` → `[{ section, nameAm, count }]`.

## 4. API

- `POST /api/cinema/shows/:id/hold` accepts either `{ seat }` (seated) or `{ section, qty }` (GA). GA path: server picks the lowest free synthetic ids not sold/held, holds them one by one under the unique guard, stops at the first `taken` and rolls its own partial holds back if it could not reach `qty`; replies `{ ok, seats:[…], expiresAt }` or `409 { error:'sold_out', left:N }`. Per-holder cap: 10 places for GA (`MAX_GA`), 8 chairs for seated (unchanged).
- `POST …/release` accepts `{ section, qty }` too (releases that many of mine in that section).
- `GET /api/cinema/shows/:id` for GA returns `layout.kind:'ga'`, `tiers:[{ name, nameAm, price, capacity, left, mine }]` instead of per-seat states (still returns `seats` for seated halls).
- Checkout, ticket, QR, verify-chapa, ops endpoints: unchanged. `pubTicket` adds `summary:[{ section, nameAm, count }]` for every ticket (seated tickets summarise too, e.g. `Regular × 2`).
- `GET /api/cinema/shows` adds `ga:true|false` per show; listing groups Films (kind FILM) vs Events.
- Check-in response includes `summary` so the door screen can show "VIP × 2".

## 5. Pages

- `/cinema` listing: two headings, **ፊልሞች · Films** and **ዝግጅቶች · Events**; event cards show date prominently and "from N birr".
- `/cinema/<id>` for GA: tier cards (name, price, "N ቀርተዋል · left", − / + stepper), bottom bar shows "VIP × 2 · Regular × 1", countdown and checkout exactly as today. Sold-out tier is greyed. On `sold_out` the tier refreshes and shows the real number left.
- `/ticket/<code>` and `/scan`: show the summary line instead of chair ids for GA tickets (chair ids for seated tickets stay).
- `/ops/cinema` hall form: "General admission" switch → tier rows (name, Amharic, capacity) with add/remove; preview shows capacity per tier. Show form unchanged (prices per section name).

## 6. Retire the old events page

- `GET /events` → 301 `/cinema`. `GET /api/events` and `POST /api/events/:slug/book` → 410 `{ ok:false, error:'moved', url:'/cinema' }`.
- Delete `public/events.html`; remove `'https://bina.et/events'` from the sitemap; the `list_events` MCP tool (bina-mcp) reads from the new shows endpoint (`/api/cinema/shows`) so AI assistants keep working.
- Remove the 4 demo Event rows (`ops/cinema/retire-old-events.js`, deletes Events with no Show and their EventTickets; prints what it removed). Model `EventTicket` stays in the schema, unused.
- Homepage card already points to `/cinema`. Bot command `/events` (if present) → `/cinema`.

## 7. Errors

`sold_out` (409, with `left`), `too_many` (400, cap 10), `no_such_section` (400). Everything else as Phase A.

## 8. Tests

- `seatmap.test.js`: GA expansion, ids, capacity, validation (duplicate tier, capacity 0, >5000), summarise.
- `holds.test.js`: `holdMany` — race for the last place (two buyers, one wins, loser `sold_out left:0`), partial rollback when qty exceeds what's free, cap 10.
- `routes.test.js`: GA show end-to-end (hold qty → 200 with 2 seats, oversell → 409 left, checkout total, summary on ticket and at the door), listing `ga` flag, `/events` 301, `/api/events` 410.
- `ops/cinema/sim.js`: a GA show flow appended (create GA hall, race for the last ticket, checkout, scan).

## 9. Rollout

Ship behind the existing `CINEMA_ENABLED` flag; no new flag. Order: seatmap → holds → routes → pages → retire old events → sim → deploy.
