# BinaSmart Cinema & Events — Seat Booking (Phase A) — Design

**Date:** 2026-09-04 · **Status:** approved in conversation, spec for review · **Owner:** Ibrahim
**Scope:** Phase A only. Phase B (Watch / video library) and Phase C (live payments, reminders, MCP tools) are separate specs.

## 1. Goal

A person in Addis Ababa opens `bina.et/cinema`, picks a show, **taps the exact seats they want on a live seat map**, and walks out with a QR ticket — paid on Chapa or reserved to pay at the counter. Two people can never buy the same chair. Door staff scan the QR to let them in.

Same operating principles as BinaSmart Ride: Amharic first, works inside Telegram without an app, honest prices, nothing invented, a human fallback where automation cannot decide.

## 2. Non-goals (Phase A)

- Scraping or syncing real cinemas' showtimes. Shows are entered on the ops page by Ibrahim or a partner venue.
- A drag-and-drop hall designer. Halls are described by a small grid template (§4.2).
- Video playback of any kind (Phase B).
- Refunds/exchanges beyond a manual ops cancel (Phase C).
- Live Chapa money. The switch exists (`CHAPA_MODE=live`) but Phase A ships with it in test, exactly as Ride does.

## 3. What exists and what happens to it

`Event` (4 demo rows, general-admission `tiers` JSON) and `EventTicket` (0 rows) already exist and `public/events.html` books against them. They are **kept and wrapped**, not replaced:

- `Event` stays the thing being shown (a film, a concert, a play). It gains `kind` (`FILM|CONCERT|THEATER|MEETUP|OTHER`), `posterUrl`, `runtimeMin`, `rating`, `language`.
- A new `Show` is one screening of an Event in one Hall at one time. Seat booking is per Show.
- `EventTicket` is superseded by `Ticket` (§4.5). Existing general-admission booking keeps working for Events that have no Show, so nothing currently live breaks.

## 4. Data model (Prisma)

### 4.1 Venue
```
model Venue {
  id        String  @id @default(cuid())
  slug      String  @unique
  name      String
  nameAm    String?
  address   String?
  lat/lng   Float?
  phone     String?          // shown on tickets for "pay at counter"
  active    Boolean @default(true)
  halls     Hall[]
}
```

### 4.2 Hall and the seat template
```
model Hall {
  id       String @id @default(cuid())
  venueId  String
  name     String            // "Hall 1", "Rooftop"
  layout   Json              // see below
  capacity Int               // derived from layout, stored for listing
  shows    Show[]
}
```
`layout` is a grid template, editable as a form on the ops page:
```json
{ "rows": ["A","B","C","D","E","F","G","H"],
  "seatsPerRow": 14,
  "aisles": [4, 10],                // a gap after seat 4 and after seat 10
  "blocked": ["A1","A14"],          // pillars, broken chairs
  "wheelchair": ["H1","H14"],
  "sections": [                     // price sections by row
    { "name": "VIP",     "nameAm": "ቪአይፒ",  "rows": ["A","B"] },
    { "name": "Regular", "nameAm": "መደበኛ", "rows": ["C","D","E","F","G","H"] } ] }
```
A seat id is `row + number` ("C7"). The server derives the full seat list from the template; the client never invents seats.

### 4.3 Show
```
model Show {
  id        String   @id @default(cuid())
  eventId   String
  hallId    String
  startsAt  DateTime
  prices    Json      // { "VIP": 500, "Regular": 300 }  ETB per seat, by section name
  status    String    @default("onsale")   // onsale | soldout | cancelled | closed
  holds     SeatHold[]
  tickets   Ticket[]
  @@index([startsAt])
}
```

### 4.4 SeatHold — the mutex
```
model SeatHold {
  id        String   @id @default(cuid())
  showId    String
  seat      String            // "C7"
  holderKey String            // rider-style session key or tg:<id>
  expiresAt DateTime
  @@unique([showId, seat])    // THE guarantee: one row per seat per show
  @@index([expiresAt])
}
```
Holding a seat is an `INSERT`; the unique constraint makes the second person's insert fail. That is the whole concurrency story — the same DB-level compare-and-swap the ride auction uses, and it holds across processes. Holds expire after **10 minutes**; a sweep every 30 s deletes expired holds so seats return to the map. A ticket purchase deletes the holds it consumed and writes the seats onto the Ticket; a seat with a `CONFIRMED` or `RESERVED` ticket is never holdable again (checked in the same transaction).

### 4.5 Ticket
```
model Ticket {
  id         String   @id @default(cuid())
  code       String   @unique     // "BINA-7K3Q2M", printed in the QR
  showId     String
  seats      String[]             // ["C7","C8"]
  name       String
  phone      String
  telegramId String?
  total      Int                  // ETB
  status     String   @default("RESERVED") // RESERVED (pay at counter) | CONFIRMED (paid) | CHECKED_IN | CANCELLED
  payMethod  String   @default("counter")  // counter | chapa
  chapaRef   String?
  checkedInAt DateTime?
  createdAt  DateTime @default(now())
  @@index([showId, status])
}
```

## 5. Flows

### 5.1 Buying (rider-side, `/cinema`)
1. `/cinema` lists upcoming Shows grouped by Event, poster-first, Amharic titles.
2. `/cinema/<showId>` renders the hall from the template + live availability (`GET /api/cinema/shows/:id/seats` → `{ seat, state: free|held|sold|blocked, section }`).
3. Tap a seat → `POST /api/cinema/shows/:id/hold { seat }` with the holder key. Success turns it green with a **10-minute countdown**; failure (someone else got it) turns it grey with a toast in Amharic and English. Max 8 seats per order.
4. Checkout: name, Ethiopian phone (or Telegram identity via `initData` as in Ride), choose **Pay on Chapa** or **Pay at the counter**.
5. `POST /api/cinema/tickets` → verifies every requested seat is held by *this* holder and not sold, creates the Ticket, deletes the holds, returns the ticket with a QR (SVG generated server-side, no external service).
   - counter → status `RESERVED`; the ticket says "pay at <venue> before <startsAt − 30 min> or the seats are released".
   - chapa → status `RESERVED` until Chapa's webhook/verify confirms, then `CONFIRMED`. In test mode this is the same flow with test keys — no money moves, and the UI labels it.
6. Ticket page `/ticket/<code>` + Telegram delivery via `@bina_smart_bot` (existing `deliver()` path) with the QR image.

### 5.2 Releasing counter reservations
A sweep at showtime − 30 min sets unpaid `RESERVED` tickets to `CANCELLED`, frees the seats and messages the buyer. Venues can extend this per Show on the ops page (`counterCutoffMin`, default 30).

### 5.3 Door (`/scan`)
Staff page (owner key or a per-venue scanner key): camera QR scan → `POST /api/cinema/checkin { code }` → shows name, seats, status, and a big green ✅ or red ✕ ("already checked in at 19:42", "reserved but unpaid", "wrong show"). First scan wins; a second scan of the same code is refused.

### 5.4 Ops (`/ops/cinema`, owner key)
Create Venue → Hall (fill the template; live preview of the map) → Event → Show (pick hall, time, prices). List tickets per show, mark counter payments as paid, cancel a ticket, cancel a show (all tickets → CANCELLED, buyers messaged).

## 6. Rules that must hold

- A seat is sold at most once per show. Enforced by `SeatHold @@unique` + the ticket transaction, never by client state.
- Prices come from `Show.prices` server-side; the client's number is never trusted.
- Holds are per holder; you cannot buy a seat someone else is holding, and your own holds die at 10 minutes.
- Phone must be Ethiopian (`normPhone`) unless the buyer is booking for someone else (same "book for someone else" pattern as Ride).
- Nothing is sent to Telegram in tests; the sim stubs the bot exactly as `sim-phase2` does.

## 7. Pages and look

Light theme, Amharic-first, same type and spacing as `/why-binasmart` and the news pages. The seat map is the only complex UI: a CSS grid from the template, seat states as colours, screen at the top ("ስክሪን · SCREEN"), section legend with prices, a sticky bottom bar with chosen seats, total and countdown. Works as a Telegram Mini App (`window.TG` shim) and in a plain browser.

## 8. Errors and edge cases

- Hold conflict → 409 `taken`; expired hold at checkout → 409 `hold_expired` with the seat list, map refreshes.
- Show cancelled between hold and checkout → 410 `show_cancelled`.
- Chapa verify fails or times out → ticket stays `RESERVED` with `payMethod=chapa`; ops sees it flagged; buyer told to pay at the counter.
- Duplicate checkout (double tap) → idempotency key per checkout, same ticket returned.

## 9. Testing

- Unit: template → seat list; hold/expire/consume; ticket transaction refuses a seat held by another key; price computed from section; check-in state machine.
- Race: two holders insert the same seat concurrently → exactly one succeeds (in-memory fake Prisma with the unique guard, as `test/offers.test.js` does), then proven against live Postgres over HTTP like `race-live.js`.
- Sim: `ops/cinema/sim.js` creates a venue/hall/show, holds, buys, scans, cancels, and cleans up — all Telegram stubbed.

## 10. Rollout

1. Schema + `ops/cinema` + seat-map page behind a `CINEMA_ENABLED` flag.
2. Seed one real venue and hall from Ibrahim's details; run the sim against production.
3. Switch the existing `/events` link on the homepage to `/cinema` once one real show is on sale.
4. Phase B (Watch) starts only after a real ticket has been scanned at a door.

## 11. Open questions for Ibrahim

1. First venue: name, hall size (rows × seats), sections and prices?
2. Counter-payment cutoff: 30 minutes before showtime, or something else?
3. Should the scanner page be usable by venue staff with their own key, or owner-only at first?
