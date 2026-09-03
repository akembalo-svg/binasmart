# BinaSmart Telegram bots — runbook

| Bot | Username | Env var | Webhook |
|---|---|---|---|
| Rider (Mini App) | @bina_smart_bot | `BINA_RIDER_BOT_TOKEN` | `https://bina.et/api/tg/rider` |
| Driver (registration + work) | @binasmartdriverbot | `BINA_DRIVER_BOT_TOKEN` | `https://bina.et/api/tg/driver` |

⚠️ `BINASMART_TG_TOKEN` is **@gccandconectbot**, shared with GCC Domestic's Mini App. Never set its webhook or menu button from BinaSmart. It only sends owner alerts.

Both webhooks require the `X-Telegram-Bot-Api-Secret-Token` header = `TG_WEBHOOK_SECRET` (in `.env`). The server answers 200 immediately and processes afterwards.

## Re-register a webhook (after a token or secret change)
`curl -X POST https://api.telegram.org/bot<TOKEN>/setWebhook -d url=https://bina.et/api/tg/rider -d secret_token=<TG_WEBHOOK_SECRET>`
Check: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`

## Menu button / commands (rider bot)
`setChatMenuButton` → web_app `https://bina.et/ride`; `setMyCommands` → `start`.

## Direct link (BotFather, once, Ibrahim)
`/newapp` → @bina_smart_bot → title `BinaSmart Ride`, short name `ride`, web app URL `https://bina.et/ride`, photo optional → link `https://t.me/bina_smart_bot/ride`.

## Rotate a token
1. BotFather `/revoke` for the bot → new token.
2. Edit `.env`, `pm2 restart binasmart-api --update-env`.
3. Re-run setWebhook (above) with the new token.

## Data
- Licence photos: `uploads/drivers/<driverId>.jpg` (git-ignored, outside public/). Served only via `GET /api/ride/ops/driver-doc/:id?key=OWNER_KEY`.
- Rider notifications go to `Ride.bookedBy.telegramId` (booker) else `Rider.telegramId`.
- Driver registrations arrive as `status: pending`; approve in `/ride-ops` → Drivers.
- Launch policy: `commissionPct = 0` in ride settings; the driver bot says registration is free and 0% commission.

## Phase 2 — the driver app

`node ops/ride/setup-driver-bot.js` shows the driver bot's webhook, menu button and commands.
Add `--apply` to set the menu button to `https://bina.et/drive`, register `/start` and `/app`, and
re-register the webhook. It never messages anybody and never prints the token.

⚠️ **Known Bot API quirk.** `setChatMenuButton` returns `ok: true` but `getChatMenuButton` keeps
reporting `{"type":"commands"}` for this bot, because a Mini App configured in BotFather takes
precedence over the API's default menu button. Do not treat the `ok: true` as proof. Set the driver
bot's Mini App URL to `https://bina.et/drive` in **BotFather** (`/myapps` → the driver app → Edit Web
App URL, or `/newapp` if it does not exist yet).

Drivers do not depend on the menu button. Every path into the app is an inline button the server
sends: `/start` for an approved driver, the approval message, and every ride offer card.

### Where a ride offer goes
`ride/offers.js` pushes the card to `Driver.telegramId` through the DRIVER bot, with
`callback_data` `acc:<rideId>` / `dec:<rideId>`. `ride/driverBot.js` answers the tap, edits the card
so it stops looking live, and reports the outcome. The auction owns the race; the bot only reports it.

### End-to-end proof
`node ops/ride/sim-phase2.js` drives request → auction → race → accept → GPS → rider map → status
ladder → completion → concierge fallback against the **live database** with every outbound channel
stubbed, then deletes every row it created. Expect `ALL 37 CHECKS PASSED` and
`Telegram messages actually sent to the network: 0`.

### Live dispatch settings
`offerWindowS 25` · `conciergeAfterS 60` · `radiiKm 3/6/10` · `commissionPct 0`.
Change them in `/ride-ops` → Settings, never by editing `ride/settings.js` defaults (the DB row wins).

### Demo mode — reviewing the driving view from outside Ethiopia
`https://bina.et/drive?demo=1` replays a **real baked Addis route** (Bole Medhanealem → Piassa,
4.4 km, 12 manoeuvres including roundabouts) through the real app code. Needed because
`ride/location.js` rejects every GPS fix outside the Addis box, which makes the driving view
impossible to judge from abroad.

It answers every `/api/drive/*` call locally in `public/ride/drivedemo.js`. The only network request
is the static `demo-route.json` (plus the car photo image). **No Telegram sign-in, no server writes,
no fake position ever stored** — verified: a full demo run issues zero `/api/drive/*` requests.

Options: `?speed=<m/s>` (default 14, so ~50 km/h), `?car=<file>` or `?car=none` for the marker photo,
`?name=<label>`. A purple **DEMO** badge is always on screen so it cannot be mistaken for a real trip.

Flow: idle → offer card with sound after 2.5 s → Accept → short leg to the passenger →
ተነሳ”/ደረስክሩ/ጁዝ ጀምር → the full 12-turn Amharic route → ጁዝ ጣርስ. Declining or letting it
expire brings the offer back a few seconds later, so the loop can be replayed without reloading.

To re-bake the route after a map update, re-run the generator against the live router (see git history
for `gen-demo-route.js`) and commit `public/ride/demo-route.json`.
