# BinaSmart Ride — Design Spec

**Date:** 2026-09-02
**Status:** Approved design, pending implementation plan
**Owner:** Ibrahim Kedir (BinaSmart)

## 1. Goal

A real ride-hailing service on bina.et for Addis Ababa: fixed upfront prices,
no app download required, a beautiful 3D map in BinaSmart's own style, and a
booking experience that beats existing apps by knowing every building, shop,
hotel and restaurant on the BinaSmart platform.

## 2. Decisions taken during design

| Question | Decision |
|---|---|
| Driver supply at launch | **None yet** — build the full two-sided platform to attract drivers |
| Fulfilment before drivers exist | **Auto-dispatch first, concierge fallback** — if no driver accepts within ~60 s, the request goes to the owner's Telegram for manual assignment; the rider never hits a dead end |
| Map engine | **OpenStreetMap + MapLibre GL**, self-hosted Ethiopia vector tiles and GraphHopper routing on the VPS — zero per-use cost, no API keys |
| Map look | BinaSmart palette (emerald/gold), Amharic labels, 3D building extrusions, tilted camera, fly-to animations |
| Driver side | **Driver PWA + Telegram bot pings + Telegram Mini App** |
| Rider side | Web / PWA + Telegram Mini App (Telegram provides verified identity and pushes) |
| Build approach | **Approach 1** — inside BinaSmart as an isolated `ride/` module (not a microservice, not white-label) |

## 3. Architecture

### Surfaces (one codebase, three ways in)
- `bina.et/ride` — rider app (web + installable PWA)
- `bina.et/drive` — driver app (web + PWA)
- Both also run as a **Telegram Mini App** via the `@binasmart` bot: pages detect
  the Telegram WebApp SDK and use its verified user/phone for identity and its
  native buttons/theme.

### Server — `ride/` module
Mounted from `server.js` in one line. Fastify + Prisma + PostgreSQL (existing).

| File | Responsibility |
|---|---|
| `ride/routes.js` | REST: fare quote, create/cancel ride, driver online/offline, accept/arrive/start/complete, ops endpoints |
| `ride/dispatch.js` | Matching engine (see §6) |
| `ride/ws.js` | WebSockets (`@fastify/websocket`): live driver GPS → rider, ride status → both, offers → drivers |
| `ride/fare.js` | Fixed upfront price (see §7) |
| `ride/telegram.js` | Driver pings (Accept/Decline), rider status pushes, concierge alerts, Mini App auth validation |
| `ride/geo.js` | GraphHopper routing/ETA; place search — BinaSmart directory first, then OSM |

### Maps stack (self-hosted, zero per-use cost)
- **MapLibre GL** in the browser; custom BinaSmart style (emerald/gold, Amharic
  labels), 3D building extrusions, pitched camera, fly-to animations.
- **Ethiopia vector tiles** as a single PMTiles file served from the VPS.
- **GraphHopper 10** running on the VPS with the Ethiopia OSM extract for routing, distance, ETA.
- **Routing engine amendment (2026-09-02):** the VPS has no Docker, so routing runs on **GraphHopper 10** (Java 21 is installed) instead of OSRM. Same role and guarantees: self-hosted, free, ~10–50 ms responses, distance + time + geometry.

### Reused from BinaSmart
Chapa, telebirr and the BinaSmart wallet for payment; the existing Telegram bot
token; the building/hotel/restaurant/hospital directory for pickup/dropoff
search; the owner-key auth pattern for the ops console; Bini for ride FAQs.

## 4. Rider flow (`/ride`)

1. **Map (full-screen, 3D).** Opens on Addis, tilted, BinaSmart-styled with 3D
   buildings. Live location pulses as the pickup pin. Nearby online drivers move
   on the map. Bottom sheet with one field: **"Where to? · ወዴት?"**
2. **Destination search.** Results ordered: (1) BinaSmart directory — buildings,
   shops, hotels, restaurants, hospitals with `nameAm` (e.g. "JJ Darule · shop
   F3-02"); (2) recent places; (3) OSM places/streets. Tap a result or drop a pin.
   Pickup is editable the same way.
3. **Quote.** Route drawn with a fly-to framing both pins. Five tier cards —
   🛵 Moto · 🛺 Bajaj · 🚗 Economy · 🚙 Comfort · 🚐 XL — each with a fixed
   upfront ETB price, ETA to pickup, trip time. Payment chooser: Cash · telebirr
   · Chapa · Wallet. One button: **"Request ride · ጉዞ ይጠይቁ"**.
4. **Finding a driver.** Radar animation, Amharic/English status. If concierge
   fallback triggers, the rider sees "A dispatcher is assigning your driver" on
   the same screen.
5. **Driver assigned.** Driver card: photo, name, rating, vehicle + plate, tier;
   Call and WhatsApp buttons. Driver's vehicle moves live with ETA countdown.
   States: *arriving → arrived → on trip → completed*.
6. **Done.** Fare summary, payment (cash confirm / telebirr / Chapa / wallet),
   1–5 star rating, "Ride again" and "Return trip".

**Identity:** inside Telegram, automatic. On the web, phone + name entered once
(stored locally), optional Telegram link for pushes.

**Cross-sells:** from any building page, hotel booking, event or flight
confirmation, a "🚕 Get a ride here" button pre-fills the destination.

## 5. Driver flow (`/drive`)

- **Onboarding.** Name, phone, photo, tier, vehicle (make/colour/plate),
  licence + vehicle-registration photos. Status starts `pending`; owner approves
  in the ops console. Unapproved drivers cannot go online.
- **Home.** Online/Offline toggle. Online → PWA streams GPS every ~4 s over
  WebSocket (throttled, battery-aware); shows own position on the 3D map;
  earnings today, rides today, rating.
- **Ride offer.** Full-screen card with a 20 s countdown ring: pickup, dropoff,
  distance to pickup, trip distance, fixed fare and driver's take, payment
  method. Accept / Decline. A Telegram message with the same buttons arrives
  simultaneously; whichever is tapped first wins.
- **On trip.** Navigation view with GraphHopper route; buttons *Arrived → Start trip →
  Complete*. Cash rides: driver confirms cash received. Digital: driver sees
  "paid".
- **Earnings.** Daily/weekly ledger, commission shown transparently, settlement
  to telebirr/wallet.

## 6. Dispatch engine (`ride/dispatch.js`)

1. Ride requested → find **online, approved drivers of the requested tier**
   within a radius: 3 km, widening to 6 km, then 10 km.
2. Rank by ETA to pickup (GraphHopper), then rating. **Offer to the nearest driver
   only**, 20 s window. Decline or timeout → next driver. One-at-a-time
   prevents two drivers racing to one rider.
3. Accept → ride `assigned`; rider notified instantly; other pending offers
   cancelled.
4. **~60 s with no acceptance → concierge fallback:** Telegram alert to the
   owner with pickup, dropoff, fare, rider phone and a map link; owner assigns
   any driver from the console. Rider's screen never dead-ends.
5. Cancellation: rider free within 2 min of assignment, small configurable fee
   after; driver no-show → rider cancels free.

**Trust & safety:** approval gate; plate + photo shown to rider; share-my-trip
link (live map for a friend); in-app SOS that WhatsApps the owner the live
ride; ratings both ways; a driver below a rating threshold is auto-suspended
for review.

## 7. Fare (`ride/fare.js`)

`fare = base + perKm × km + perMin × min`, rounded to the nearest 5 ETB, floored
at the tier minimum. Quoted once and **locked at request time** — the rider
pays exactly the quote regardless of traffic. No surge. Driver take = fare −
commission. All knobs live in `RideSetting` (editable from the console).

Initial tier minimums (from the current placeholder page, to be tuned in
settings): Moto 60 · Bajaj 80 · Economy 150 · Comfort 230 · XL 350 ETB.

## 8. Data model (new Prisma models)

- **`Driver`** — id, name, phone, photo, telegramId, tier, vehicle {make,
  colour, plate}, docs {licenceUrl, registrationUrl}, status (`pending |
  approved | suspended`), online, lat/lng, lastSeenAt, rating, ridesCount,
  commissionPct.
- **`Rider`** — id, phone, name, telegramId, rating, createdAt.
- **`Ride`** — id, riderId, driverId?, tier, pickup {lat, lng, label}, dropoff
  {lat, lng, label}, distanceM, durationS, fareEtb, driverTakeEtb,
  paymentMethod (`cash | telebirr | chapa | wallet`), paymentStatus, status
  (`requested | dispatching | assigned | arriving | arrived | ontrip |
  completed | cancelled`), cancelledBy, concierge (bool), per-state timestamps,
  riderRating, driverRating.
- **`RideOffer`** — rideId, driverId, offeredAt, respondedAt, response
  (`accepted | declined | timeout`). Dispatch audit trail.
- **`DriverLocation`** — rolling GPS points per ride (share-trip replay,
  disputes), pruned after 30 days.
- **`RideSetting`** — fare table and knobs: per-tier base/perKm/perMin/minimum,
  cancel fee, offer window, radii, commission.

Payments reuse the existing `Payment` and `Wallet` / `WalletTxn` models.

## 9. Real-time

One WebSocket endpoint `/ride/ws`, rooms per ride and per driver. Small JSON
events: `driver:location`, `ride:status`, `offer:new`, `offer:result`. On
socket drop, clients auto-reconnect and re-sync from `GET /api/ride/:id`, so a
flaky mobile connection never leaves a stale screen.

## 10. Error handling

- **GraphHopper down** → fare from straight-line distance × 1.3 road factor, flagged
  as an estimate; rides still work.
- **Telegram API down** → offers still flow over WebSocket; concierge alert also
  emailed as backup.
- **GPS denied** → rider types/drops a pickup pin; drivers must grant GPS to go
  online.
- **Payment failure** (Chapa/telebirr) → ride completes, marked unpaid, rider
  gets a retry link; driver sees the honest status.
- **Double-accept race** → atomic DB update (`WHERE status='dispatching'`);
  exactly one driver wins, the other gets "already taken".

## 11. Ops console (`/ride-ops?key=OWNER_KEY`)

Owner-key pattern (as the tender queue). Live map of online drivers and active
rides; **concierge queue** with an "Assign driver" picker; driver approvals
(view docs, approve/suspend); fare/commission settings editor; daily report
(rides, revenue, commission, cancels). Telegram alerts for concierge rides and
new driver signups.

## 12. Phases (each shippable on its own)

**Phase 1 — Rider app + concierge (rides work on day one).** 3D map, directory
+ OSM search, GraphHopper routing, fixed-fare quote for all 5 tiers, ride request,
concierge fallback to owner's Telegram, driver-assigned screen (details entered
by owner), completion + rating. Payment: cash + telebirr/Chapa link. Ops
console: concierge queue + settings.

**Phase 2 — Driver app + auto-dispatch + live tracking.** `/drive` PWA with
onboarding, approval gate, online toggle, GPS streaming, offer cards, trip
states, earnings; dispatch engine; live driver-on-map for riders; Telegram
Accept/Decline pings.

**Phase 3 — Telegram Mini App + polish.** Mini App wrapping for both apps,
wallet payment, share-my-trip, SOS, cross-sell buttons across
buildings/hotels/events/flights, Bini answering ride questions.

## 13. Testing

- **Unit tests** (Node's built-in test runner) for fare math and rounding, tier
  minimums, offer sequencing, timeout → next driver, 60 s → concierge, atomic
  double-accept.
- **Simulated drivers**: a script spawning fake online drivers moving around
  Addis so the entire flow — request, dispatch, live tracking, completion — is
  testable with zero real drivers.
- **Real-device checks** on Android Chrome and the Telegram Mini App before each
  phase ships.

## 14. Robustness & performance additions

- **3D auto-degrade.** Detect weak devices (low `deviceMemory`, few CPU cores,
  or measured low frame rate in the first seconds) and switch off 3D building
  extrusions and pitch, keeping the same style flat. Keeps cheap Androids fast.
- **Driver keep-open UX + Wake Lock.** While a driver is online or on a trip,
  request the Screen Wake Lock API so the screen doesn't sleep, and show a
  persistent "Keep this page open while online" banner. If GPS updates stop
  for >30 s the driver is marked *away* (not offered rides) and pinged on
  Telegram; they return to online automatically when updates resume.
- **Map tile caching.** Tiles and the map engine are served with long-lived
  immutable cache headers (reusing the existing static-asset caching hook) and
  pre-cached by a service worker for central Addis, so repeat opens are
  instant and the map stays usable on flaky data.
- **Idempotent ride creation.** The rider client sends a generated idempotency
  key with each request; a double tap or a retried request on a bad connection
  never creates two rides.
- **Anti-abuse.** Per-phone and per-IP rate limits on quotes and ride requests;
  a rider with repeated no-shows/cancels is throttled. Protects drivers' time
  during the zero-supply phase.
- **GraphHopper health + cached quotes.** Health check every minute; quotes for the
  same pickup/dropoff pair are cached briefly; on GraphHopper failure the straight-line
  fallback (§10) kicks in without user-visible errors.
- **Instant feel.** Route is fetched the moment a destination is chosen (before
  the tier cards animate in); search is debounced and directory results are
  served from memory.

## 15. Out of scope (for now)

Scheduled/advance bookings, multi-stop rides, ride pooling, in-app chat (Call +
WhatsApp cover it), native iOS/Android apps, cities beyond Addis Ababa.
