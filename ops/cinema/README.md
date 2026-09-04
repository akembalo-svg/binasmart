# BinaSmart Cinema & Events — seat booking (Phase A)

Spec: `docs/superpowers/specs/2026-09-04-binasmart-cinema-seat-booking-design.md` · Plan: `docs/superpowers/plans/2026-09-04-binasmart-cinema-seat-booking.md`

Mounted by `server.js` through `cinema/index.js` only when `.env` has `CINEMA_ENABLED=1`.

## Pages

| URL | Who | What |
|---|---|---|
| `/cinema` | public | shows on sale grouped by film, plus the directory of Addis Ababa cinemas |
| `/cinema/<showId>` | public | live seat map: tap = 10-minute hold, checkout sheet, Chapa or counter |
| `/ticket/<code>` | buyer | QR ticket, status, "Send to Telegram" (`@bina_smart_bot /start ticket_<code>`) |
| `/scan?key=<OWNER_KEY>` | door staff | camera QR scan (Chrome) or typed code; green/red result, counts |
| `/ops/cinema?key=<OWNER_KEY>` | ops | venues, halls (seat template with live preview), events, shows, tickets, mark paid, cancel |

## How a show goes on sale

1. **Venue** exists (22 Addis cinemas are seeded by `ops/cinema/seed-addis-cinemas.js`; add more on the ops page).
2. **Hall**: rows × seats per row, aisles, VIP rows, blocked and wheelchair seats. The template must come from the cinema — never guess a seat map. Capacity is derived.
3. **Event** (the film): title, Amharic title, kind, runtime, rating, language, poster URL.
4. **Show**: event + hall + start time (typed as Addis time) + price per section + counter cutoff (default 30 min).

## General admission (concerts, theatre, meetings)

A hall can be **tiers instead of chairs**: `{ "kind": "ga", "sections": [{ "name": "VIP", "nameAm": "ቪአይፒ", "capacity": 50 }, …] }` (ops page: "General admission" switch). The server turns each tier into invisible numbered places (`VIP-001 …`), so a buyer's "2 VIP" holds two of them under the same unique guard — the last place can never be sold twice. Up to 10 places per order. Tickets and the door show `VIP × 2` instead of chair ids. The listing groups Films and Events by `Event.kind`.

The old `/events` page is retired: `/events` → 301 `/cinema`, `/api/events*` → 410. `ops/cinema/retire-old-events.js` removed the pre-cinema demo events.

## Ticket states

`RESERVED` (counter: unpaid; chapa: awaiting) → `CONFIRMED` (ops "paid ✓" or Chapa verify/webhook) → `CHECKED_IN` (first scan) · `CANCELLED` (ops, show cancel, or counter cutoff sweep).

Only `CONFIRMED` tickets pass the door. A `RESERVED` counter ticket is released automatically `counterCutoffMin` before showtime and the buyer is told (Telegram buyers only).

## Guarantees

- One seat, one row: `SeatHold @@unique([showId, seat])` — the second person's insert fails with P2002 and they are told "taken". Proven concurrently in `test/cinema/holds.test.js`, `routes.test.js` and live in `ops/cinema/sim.js`.
- Prices come from `Show.prices` server-side; the client's number is never used.
- Checkout is a transaction with an idempotency key: a double tap returns the same ticket.
- Chapa is gated server-side: `payMethod=chapa` only when a Chapa key is configured; `CHAPA_MODE=live` switches keys. Cinema refs start with `bina-cin-` and are confirmed by the webhook or `/verify-chapa`.

## Background loops (`cinema/index.js`)

- every 30 s: delete expired holds
- every 60 s: release unpaid counter reservations for shows starting within 6 h

## Scripts

```bash
node ops/cinema/seed-addis-cinemas.js      # upsert the venue directory (idempotent)
node ops/cinema/demo.js                    # throwaway demo venue/hall/show; --clean removes it
node ops/cinema/sim.js                     # live end-to-end proof, cleans up after itself
node --test test/cinema/*.test.js          # 45 unit + route tests
```

## Going live with a real cinema

1. Get the hall's seat plan and the counter phone from the cinema; create venue → hall → event → show on `/ops/cinema`.
2. Run `node ops/cinema/sim.js` once more.
3. Open `/scan?key=…` on the door phone (Chrome, camera allowed).
4. Chapa live: set `CHAPA_MODE=live` + `CHAPA_SECRET_LIVE`, restart, buy one real ticket.
