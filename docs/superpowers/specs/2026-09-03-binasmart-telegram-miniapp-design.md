# BinaSmart Ride — Telegram Mini App + Driver Bot — Design

**Date:** 2026-09-03 · **Status:** approved by Ibrahim (brainstorm 2026-09-03) · **Depends on:** Ride Phase 1 (live), MCP server (live)

## 1. Goal

Riders open BinaSmart Ride inside Telegram (the one open mini-app platform Ethiopians use), book with a one-tap verified phone, and get status pushes in the same chat. Drivers register through a second bot. Anyone — including diaspora abroad — can book a ride for someone else in Addis Ababa.

## 2. Decisions

| Question | Decision |
|---|---|
| Bots | Two new bots created by Ibrahim on 2026-09-03: rider **@bina_smart_bot** (`BINA_RIDER_BOT_TOKEN`), driver **@binasmartdriverbot** (`BINA_DRIVER_BOT_TOKEN`). ⚠️ The old `BINASMART_TG_TOKEN` is **@gccandconectbot**, shared with GCC Domestic's "Hire a maid" Mini App — its menu button and webhook must not change. Owner alerts keep using it. |
| Rider app | **Option 1: one app, Telegram-aware.** `public/ride.html` loads Telegram's Mini App script; a small `public/ride/tg.js` adapts theme, main button and phone share when inside Telegram; outside Telegram nothing changes. |
| Phone | **Telegram one-tap share** (`WebApp.requestContact`), signature-verified server-side; fallback to the typed box if refused. |
| Driver bot scope | **Registration only** (Phase 1): six-step conversation → Driver `pending` → owner alert → approval in ops console. Online/offers = Phase 2. |
| Commission | **0% during launch** (RideSetting `commissionPct = 0`); registration free; the bot says so. |
| Book for someone else | **Yes**, website + Telegram + MCP: passenger name/phone separate from the booker; booker gets notifications; driver sees only the passenger. |
| Payment from abroad | Default passenger pays driver (cash/telebirr). Optional "I pay now" → existing Chapa link to the booker. Foreign-card acceptance to be confirmed in Chapa before advertising. |

## 3. Architecture

### New / changed files

| File | Responsibility |
|---|---|
| `public/ride/tg.js` (new) | Detects `window.Telegram.WebApp`; applies theme; `ready()`/`expand()`; drives `MainButton` ("Confirm ride · N ETB" → "Cancel ride"); `BackButton`; `requestContact` flow; exposes `TG.isTelegram()`, `TG.initData()`, `TG.contact()`, `TG.user()`, `TG.lang()`. No-op when not in Telegram. |
| `public/ride/app.js` (changed) | Uses `TG` when present: pre-fill name, language, phone from signed contact, Telegram main button instead of the sheet button; "Book for someone else" switch + passenger fields; on open with an active ride for this Telegram user, jump to tracking. |
| `public/ride.html` (changed) | `<script src="https://telegram.org/js/telegram-web-app.js">` before app scripts; passenger fields markup; `?v=4`. |
| `ride/tgauth.js` (new) | `verifyInitData(initData, botToken, maxAgeS=86400)` → `{ user, auth_date }` or null. `verifyContact(response, botToken)` → `{ phone_number, user_id }` or null. Standard Telegram HMAC: `secret = HMAC_SHA256("WebAppData", token)`, `hash = HMAC_SHA256(secret, data_check_string)`. |
| `ride/riderNotify.js` (new) | `notify(rideId, event)` for `assigned`, `arrived`, `completed`, `cancelled`: looks up the ride + rider; if `bookedBy.telegramId` or `rider.telegramId` exists, sends via the rider bot with an "Open tracking" `web_app` button. Fire-and-forget, errors logged. |
| `ride/driverBot.js` (new) | Webhook handler for @binasmartdriverbot. In-memory state per chat (`Map`, 1-hour TTL): `name → phone (contact keyboard) → vehicle type (inline buttons moto/bajaj/economy/comfort/xl) → make & colour → plate → licence photo`. Creates Driver `{status:'pending', telegramId, tier, vehicleMake, vehicleColour, plate, licenceUrl}`; photo downloaded via `getFile` to `uploads/drivers/<driverId>.jpg` (outside `public/`); owner alert via `telegram.ownerNote`. `/start` restarts; unknown input re-asks the step; duplicate phone → "already registered". |
| `ride/riderBot.js` (new) | Webhook handler for @bina_smart_bot: `/start` → welcome (EN+AM) with `web_app` button "🚕 Book a ride" and a share button; any other text → same welcome. |
| `ride/tgApi.js` (new) | Thin Bot API client per token: `sendMessage`, `getFile`, `download`, `setWebhook`, `setChatMenuButton`, `setMyCommands`. |
| `ride/routes.js` (changed) | `POST /api/tg/rider`, `POST /api/tg/driver` (check `X-Telegram-Bot-Api-Secret-Token` against env `TG_WEBHOOK_SECRET`; respond 200 fast). `POST /api/ride/request` accepts `tg: { initData, contact }` and `passenger: { name, phone }`. `GET /api/ride/mine?initData=` → latest active ride for the Telegram user. `POST /api/ride/ops/drivers/:id/status` `{status: approved\|suspended}` → updates + notifies driver via driver bot. `GET /api/ride/ops/driver-doc/:id` (owner key) streams the licence photo. |
| `ride/dispatch.js` / ops assign & status routes (changed) | Call `riderNotify.notify` on assign / arrived / completed / cancelled. |
| `ride/settings.js` | Unchanged; `commissionPct` set to 0 via ops settings API at rollout. |
| `prisma/schema.prisma` (changed) | `Ride.bookedBy Json?` `{ name, phone?, telegramId?, relation? }`. `Driver.telegramId` already exists. `Rider.telegramId` already exists. |
| `mcp-server/tools/ride.mjs` (changed) | `request_ride` gains optional `passenger_name`, `passenger_phone`; when given, `rider_name/rider_phone` become the booker (`bookedBy`) and the passenger is the ride's rider. |
| `ops/telegram/README.md` (new) | Runbook: webhooks, menu button, `/newapp` steps, secrets, how to rotate a token. |

### Entry points
- Rider bot **menu button** → `https://bina.et/ride` (via `setChatMenuButton`, no BotFather).
- `/start` reply button (web_app) → same URL.
- Direct link **`t.me/bina_smart_bot/ride`** after Ibrahim runs BotFather `/newapp` (title "BinaSmart Ride", short name `ride`, URL `https://bina.et/ride`).
- Notifications carry an "Open tracking" web_app button → `https://bina.et/ride?id=<rideId>`.

### Identity and trust
- Inside Telegram the client sends `initData` (signed by Telegram) with every booking; the server verifies it against the rider bot token and rejects if invalid or older than 24 h ("please reopen BinaSmart from the bot").
- Phone: `requestContact` → `contactRequested` event → signed `response`; server verifies with the same HMAC scheme; the phone in the signed payload wins over anything typed. Rider record gets `telegramId`.
- Outside Telegram: unchanged (typed phone, per-phone limit).

## 4. Rider flow (Telegram)
1. Open → full-height, BinaSmart theme, Amharic if Telegram language is `am`.
2. Pickup/destination/fares exactly as the website. Telegram MainButton "Confirm ride · N ETB" tracks the selected tier. BackButton cancels.
3. First booking: `requestContact` popup → one tap. Refusal → typed phone box.
4. Name pre-filled from Telegram profile, editable.
5. Optional **Book for someone else**: passenger name + Ethiopian phone; booker stays attached as `bookedBy`.
6. Confirm → `/api/ride/request` with `tg` + optional `passenger` → same fare lock, idempotency, dispatch, concierge alert (which now shows "Passenger: … · Booked by: …" when different).
7. Tracking screen; MainButton "Cancel ride" until assigned. Reopening the app later jumps to the active ride (`/api/ride/mine`).
8. Pushes from @bina_smart_bot to the booker: assigned (driver, vehicle, plate, phone), arrived, completed (+ rate link), cancelled.

## 5. Driver flow (@binasmartdriverbot)
`/start` → "Register as a BinaSmart driver — free, 0% commission during launch" → name → phone (share-contact keyboard) → vehicle type buttons → "make and colour" → plate → "send a photo of your driving licence" → summary + "We'll call you within 24 h" → Driver `pending`, owner alert with approve link. Ops: `/ride-ops` driver list shows pending drivers with the licence photo (owner-key route) and Approve/Suspend; approval message from the bot: "Approved ✅ — we'll message you here when trips start."

## 6. Safety, limits, errors
- Webhooks: reject without the secret header; always answer 200 within ~1 s; processing after reply (`setImmediate`) so Telegram never retries in a storm.
- Booking limits: 5 / 10 min counted on passenger phone **and** on booker key (Telegram user id or booker phone).
- Telegram signature invalid/expired → 401 with a clear message. Contact signature invalid → treated as no contact (typed box).
- Notification send failure → `console.error`, ride unaffected.
- Driver bot: non-image at the photo step → re-ask; duplicate phone → "already registered"; state TTL 1 h; photos stored outside `public/`, served only through the owner-key route.
- Secrets: bot tokens and `TG_WEBHOOK_SECRET` in `.env` only; never logged (mask in logs).
- The old @gccandconectbot: no webhook/menu changes.

## 7. Testing
Node built-in runner (`npm test`, bare).
- `tgauth`: valid initData passes; tampered hash fails; expired fails; contact response verified/forged.
- `request` with `tg`: phone from signed contact overrides typed; `telegramId` stored; `passenger` → `bookedBy` stored; limits on both keys.
- `driverBot`: happy path with a fake Bot API (all six steps → pending Driver + owner alert); wrong input re-asks; non-photo refused; duplicate phone.
- `riderNotify`: one message per event, correct text, only when a Telegram id exists.
- Webhook auth: missing/wrong secret → 401.
- Existing 24 ride tests + 28 MCP tests stay green. ⛔ No test sends a real Telegram message or books a real ride (`RIDE_TG_SILENT=1` + fake API).

## 8. Rollout
1. Code + tests; deploy with `?v=4`; `prisma db push` for `bookedBy`.
2. `setWebhook` for both bots with `secret_token`; `setMyCommands`; rider `setChatMenuButton` → web_app `https://bina.et/ride`.
3. Ops settings: `commissionPct = 0`.
4. Quote end to end inside Telegram Web (no booking); screenshot. Driver registration once with a test driver, then delete it.
5. Commit, push, README, memory.
**Ibrahim:** press Start on both bots; BotFather `/newapp` for the `ride` short name; optional logo images.

## 9. Out of scope
Driver online/offline, offers, live GPS (Phase 2); Telegram Stars / in-app payment; GCC Domestic Telegram app; SMS to passengers.
