# BinaSmart Ride Phase 2 — Driver app, auto-dispatch, live tracking — Design

**Date:** 2026-09-03 · **Status:** approved by Ibrahim (brainstorm 2026-09-03; "you know better" = design decisions delegated) · **Depends on:** Ride Phase 1 (live), Telegram bots + car photos (live)

## 1. Goal

Drivers go online in their own app, receive ride offers automatically, and the rider watches their car — the driver's own car photo — glide along the road to the pickup with a live ETA. The concierge queue remains the safety net, never removed.

## 2. Decisions (this brainstorm)

| Question | Decision | Why |
|---|---|---|
| Offer model | **Broadcast to the nearest 3 drivers, first accept wins** (25 s), radius 3→6→10 km, concierge at 60 s | With 2–3 drivers online, one-at-a-time (the Phase 1 spec's plan) makes riders wait a minute before anyone even sees the request. A DB-level mutex makes a double-accept impossible. |
| Live location transport | **HTTP polling** — driver POSTs every 6 s on a job / 20 s idle; rider's existing 4 s status poll returns the position | No new dependency, no reconnect loop, degrades gracefully on Addis 3G. WebSockets are the right answer at hundreds of concurrent rides; the client is structured so swapping transport touches `ride/location.js` + `public/ride/track.js` only. |
| Driver auth | **Telegram initData signature** (same check as riders), no passwords | Drivers already registered in @binasmartdriverbot; nothing to lose or reset. Browser-only drivers use a one-time link with a signed token from the ops console. |
| Background GPS | **Not attempted.** Wake Lock + "keep this open while online" + `away` after 45 s of silence | A web page cannot send GPS with the screen off. Pretending otherwise would silently drop drivers from dispatch. Real background tracking arrives with the Android wrapper (Phase 3); only `location.js` changes. |
| Commission | **0 %** during launch (already set) | Ibrahim's launch decision. |
| Cancellation | Free both ways for now; `freeCancelMin`/`cancelFeeEtb` remain settings, unused | Business choice, changeable without a deploy. |

## 3. Architecture

### New server modules (each one job, unit-testable in isolation)

| File | Responsibility |
|---|---|
| `ride/location.js` | `record(driverId, fix)` validates and stores the latest fix (Driver row) + an in-memory trail per active ride (last 25 points, 5 min TTL); `latest(driverId)`, `trail(rideId)`, `staleSweep()` marks drivers `away` after 45 s of silence and pings them. **The only file that knows how position arrives.** |
| `ride/offers.js` | `open(rideId)`: candidate drivers (online, approved, matching tier, not on a ride) → ETA via `geo.route` → nearest 3 → one `RideOffer` row each → Telegram card with Accept/Decline. `accept(offerId, driverId)` = DB mutex (`updateMany` where ride still unassigned **and** offer still `open`) → ride `assigned`, sibling offers `lost`. `decline`, `expire(now)` (25 s), `widen(rideId)` (3→6→10 km), `giveUp(rideId)` → existing `telegram.conciergeAlert`. |
| `ride/driverApi.js` | Driver-facing REST: `online`, `offline`, `location`, `me` (current job + earnings), `accept`, `decline`, `arrived`, `start`, `complete`. Auth via `tgauth.verifyInitData` against the **driver** bot token; every handler resolves the Driver by `telegramId` and refuses unless `status === 'approved'`. |
| `ride/simulate.js` | Dev-only: spawns N fake drivers along real GraphHopper routes in Addis, driving the whole flow. Guarded by `RIDE_SIM=1`; never loaded in production paths. |

### Changed
- `ride/dispatch.js` — `start(rideId)` now calls `offers.open()` when online drivers exist; the 60 s concierge escalation and `sweepStale()` stay exactly as they are (the safety net).
- `ride/routes.js` — mounts `driverApi` under `/api/drive/*`, adds `driverLocation` to the rider's `GET /api/ride/:id` reply, serves `/drive`.
- `ride/index.js` — wires `location`, `offers`, `driverApi`; one 10 s interval for `offers.expire()` + `location.staleSweep()` (`.unref()`, same pattern as the existing sweep).
- `ride/riderNotify.js` — unchanged behaviour, plus `driver_near` push when the car is < 80 m away.
- `public/ride/map.js` — `setDriver({lat,lng,bearing})` (animated marker, car photo or glyph), `clearDriver()`, `drawDriverRoute(coords)`.
- `public/ride/track.js` (new) — owns the rider's live view: takes the ride payload from each poll, interpolates the car between fixes with `requestAnimationFrame`, updates the ETA line, fires the "driver is here" haptic once.
- `public/ride/app.js` — calls `track.update(ride)` on each poll; no other change.

### New pages
`public/drive.html`, `public/drive/app.js`, `public/drive/ui.css` — the driver app. Opens as a Telegram Mini App from @binasmartdriverbot (menu button + `/start` button) or at `https://bina.et/drive`.

### Data model
```prisma
model RideOffer {
  id        String   @id @default(cuid())
  rideId    String
  ride      Ride     @relation(fields: [rideId], references: [id])
  driverId  String
  driver    Driver   @relation(fields: [driverId], references: [id])
  status    String   @default("open")   // open | accepted | declined | expired | lost
  etaS      Int?                        // driving seconds to pickup at offer time
  distanceM Int?
  round     Int      @default(1)        // 1 = 3 km, 2 = 6 km, 3 = 10 km
  createdAt DateTime @default(now())
  decidedAt DateTime?
  @@unique([rideId, driverId])
  @@index([rideId, status])
  @@index([driverId, status])
}

model DriverLocation {            // append-only breadcrumb, kept 7 days
  id        String   @id @default(cuid())
  driverId  String
  driver    Driver   @relation(fields: [driverId], references: [id])
  rideId    String?
  lat       Float
  lng       Float
  bearing   Float?
  speedKph  Float?
  at        DateTime @default(now())
  @@index([driverId, at])
  @@index([rideId, at])
}
```
Driver gains: `bearing Float?`, `speedKph Float?`, `away Boolean @default(false)`, `onRideId String?`, `earningsTodayEtb Int @default(0)`, `earningsDay DateTime?`. Ride gains `driverAcceptedAt DateTime?`.

## 4. Driver experience

1. **Open** from the driver bot (menu button "🚗 Drive") or bina.et/drive. Telegram signature identifies the driver; a `pending` driver sees "We're reviewing your registration", a `suspended` one sees support contact.
2. **ONLINE switch.** Going online asks for location permission once, starts the 20 s heartbeat, holds a Wake Lock, and shows: today's trips, today's earnings, and "You'll get offers for *economy* rides near you."
3. **Offer card** (Telegram push + in-app): pickup label, destination label, distance to pickup, trip distance, fare, **your take**, a 25 s ring, Accept / Decline. Accept from either surface works; whoever is first wins.
4. **On the job**: one big primary button per step — Navigate (opens the map to pickup) → **I've arrived** → **Start trip** → **Complete**. Rider name and phone with a call button; the rider's pickup pin on a small map. Heartbeat rises to 6 s.
5. **Complete** shows the fare, the take, cash or telebirr, and returns to the online screen with earnings updated.
6. **Away**: 45 s without a position → `away`, no offers, Telegram ping "You've gone quiet, open the BinaSmart Driver app to receive rides." Positions resume → online again automatically.

## 5. Rider experience (the live track)

- The moment a driver accepts, the assigned card appears with the **car photo** (already built) and the map switches to tracking.
- **The car marker** is the driver's car photo in a 44 px rounded square with a soft shadow, rotated to the driving bearing; falls back to a clean car glyph when there's no photo or on a weak device.
- **Smooth motion**: each fix animates the marker from its current point to the new one over the polling interval with ease-in-out, using `requestAnimationFrame`; `prefers-reduced-motion` and weak devices jump instead.
- **Driver→pickup route** drawn in emerald, redrawn every 30 s (not every fix — GraphHopper calls cost time), shortening as they come.
- **Live ETA line** above the sheet: "Abel is 3 min away · white Toyota Vitz · A12345", recomputed from the route, floored at "arriving now".
- **Arrival**: within 80 m the marker pulses once, the phone vibrates once, the card reads "Your driver is here", and a Telegram push says the same. Fires once per ride.
- **On trip**: the map redraws pickup→destination, the ETA becomes "arriving ~14:32", and the cancel button disappears.
- No location for 45 s: the ETA line becomes "Reconnecting to your driver…" and the last known position stays put. The ride never breaks because of a lost fix.

## 6. Safety, privacy, failure

- **Auth**: every driver call needs a valid Telegram signature ≤ 24 h old and an `approved` driver; a `suspended` driver is rejected mid-session at the next call.
- **Position privacy**: a rider sees a driver's position **only** while that driver is assigned to their active ride. `DriverLocation` rows are pruned after 7 days by the existing daily cron pattern. No rider location is ever sent to a driver beyond the pickup/destination they were offered.
- **Double-accept**: `updateMany({ where: { id: rideId, status: { in: ['requested','dispatching'] }, driverId: null } })` — the loser gets a clear "taken" and the offer row is marked `lost`.
- **Driver on two rides**: `Driver.onRideId` must be null to be a candidate, set inside the accept transaction.
- **Offer expiry**: a 10 s interval expires offers older than the window; a restart cannot strand them because expiry is computed from `createdAt`, not a timer.
- **GPS junk**: a fix is rejected unless it is inside the Addis box, `accuracy` < 200 m, and no more than 2 km from the previous fix within 10 s (teleport guard).
- **Rate limits**: location 20/min per driver, accept 30/min, online toggle 20/min.
- **Concierge never removed**: if dispatch fails for any reason — no drivers, all declined, GraphHopper down — the owner alert fires at 60 s exactly as today.
- **Errors**: every driver endpoint returns a plain sentence the app shows verbatim; no stack traces. Telegram send failures are logged, never fatal.

## 7. Testing

- `location.js`: valid/invalid fixes, teleport guard, trail cap and TTL, stale sweep marks `away` and pings once.
- `offers.js`: candidate selection (tier, online, approved, not busy, radius, `away`), nearest-3 ordering by ETA, **two drivers accepting in the same tick → exactly one wins**, decline → not re-offered this round, expiry → widen, 60 s → concierge alert fired once.
- `driverApi.js`: signature required; pending/suspended refused; the full happy path online→accept→arrived→start→complete with a fake clock; earnings accumulate per day.
- `track.js`: interpolation maths (position at t, bearing), arrival fires once, stale banner after 45 s. Pure functions, no DOM.
- `simulate.js` run in CI mode: 3 fake drivers, 1 request → assigned, tracked, completed; asserts one winner and a monotonic trail.
- All 84 existing tests stay green. ⛔ No test sends a real Telegram message or books a real ride.

## 8. Rollout

1. Schema + modules + tests (nothing user-visible).
2. Driver app deployed but **only reachable by approved drivers** — there are none, so no rider is affected.
3. Simulator proves dispatch + tracking end to end on the live server with fake drivers, then its data is deleted.
4. Rider tracking turned on (it activates only when a ride has an assigned driver with a recent position, so today's concierge rides look exactly as they do now).
5. Driver bot gets the "🚗 Drive" menu button; `/drive` linked from bina.et/ride and /ai.
6. First real driver: Ibrahim approves them, they go online, one real ride proves it.

## 9. Out of scope
Driver-side navigation turn-by-turn (we open the phone's map app); scheduled rides; shared rides; in-app chat; wallet payouts; Android background tracking (Phase 3); WebSocket transport (revisit at scale).
