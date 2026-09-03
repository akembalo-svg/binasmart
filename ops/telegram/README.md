# BinaSmart Telegram bots — runbook

| Bot | Username | Env var | Webhook |
|---|---|---|---|
| Rider (Mini App) | @bina_smart_bot | `BINA_RIDER_BOT_TOKEN` | `https://bina.et/api/tg/rider` |
| Driver (registration) | @binasmartdriverbot | `BINA_DRIVER_BOT_TOKEN` | `https://bina.et/api/tg/driver` |

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
