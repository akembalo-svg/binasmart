# Owner actions and tenant messaging — design

**Date:** 15 September 2026 · **Status:** approved by Ibrahim in three parts ("C both", "yes part 1/2/3 good"); this document awaits his review
**Builds on:** `docs/superpowers/specs/2026-09-13-owner-bini-design.md` (answer-only owner Bini), the owner tools added 15 September (`floor`, `find_tenant`, action-request gate).

---

## 0. Why

The first real owner (Darulle, linked 15 September) asked Bini on Telegram to *send a message to the tenants*. Before building that, delivery was checked (counts only):

- 71 active tenancies; **0** tenants have linked Telegram; 67 have an Ethiopian mobile number.
- The WhatsApp bridge (`127.0.0.1:8081`) does not answer.
- All **3** invoices the owner sent with the dashboard's 📤 Send are audited `INVOICE_SENT … (delivery pending — channel down)` — no tenant received them.

So an action button alone would deliver nothing. This design adds (1) a delivery layer that actually reaches tenants — Telegram when linked, SMS otherwise — (2) a way for tenants to link Telegram, (3) owner actions in Bini that always preview and wait for ✅, and (4) the dashboard view of all of it.

---

## 1. Delivery layer

### 1.1 One message per tenant, in this order
1. **Telegram** — if the tenant's user has a linked Telegram chat (free).
2. **SMS** — to the tenant's Ethiopian mobile (`+2519XXXXXXXX` / `+2517XXXXXXXX` normalised).
3. **Not delivered** — no chat, no valid mobile, or the SMS provider refused. The owner sees these by unit.

Never two channels for the same message. WhatsApp is not used by this layer (bridge down; Meta templates needed — out of scope).

### 1.2 SMS provider
- One adapter module (e.g. `messaging/sms.js`) with a provider interface: `send({ to, text, sender }) → { ok, providerId, error }` and a delivery-status check where the provider offers one. First provider: **AfroMessage** (Ethiopian, Amharic Unicode, sender IDs). Another provider can be added behind the same interface.
- Credentials only from the server environment (`SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER`), entered by Ibrahim. Never in code, commits, logs or chat.
- **Test mode** (`SMS_MODE=test`, the default until Ibrahim switches it): everything runs and is recorded as `test`, nothing leaves the server. Demo buildings are always test mode, whatever the setting. *(16 Sep 2026: this became two switches. `SMS_MODE` is the provider switch — without it nothing leaves at all — and `SMS_TENANT_MODE`, default `test`, is what a message to a tenant needs on top of it. Sign-in codes (Plan D) and the one-SMS go-live test are transactional and need `SMS_MODE` only, so the phone door can open while every tenant message is still recorded as `test`.)*
- Sender name per building when the provider has approved one (e.g. "Darulle"), otherwise the account default ("BinaSmart").

### 1.3 Short invoice links
- An SMS carries a short text and a link, e.g. `የDarulle ክፍያ መጠየቂያ፦ ክፍል 211፣ 12,500 ብር፣ እስከ … ። ዝርዝር፦ bina.et/i/Ab3xK9`.
- `bina.et/i/<token>`: a random unguessable token (≥ 10 chars, not the invoice id or payment code), valid **60 days**, shows that one invoice only (building, unit, type, amount, late fee, due date, bank accounts, payment reference) — the same content as today's Telegram invoice text. No login, no other tenant data, `noindex`, rate-limited. Expired or unknown tokens show a neutral page.
- Receipts use the same mechanism.

### 1.4 Cost control
- A **monthly SMS limit per building** (field on Building, set by Ibrahim; e.g. 500 for Darulle). A send that would exceed it is refused in the preview (§3.2), not half-sent.
- Counting is per SMS part (Amharic Unicode SMS ≈ 70 characters per part); the preview shows parts × recipients.
- Who pays (included or charged to the owner) is Ibrahim's business decision; v1 only counts and limits.

### 1.5 Record of every message
New table (e.g. `OutboundMessage`): building, recipient tenancy/user, kind (`notice`, `reminder`, `invoice`, `receipt`), channel (`telegram`/`sms`/`none`), status (`queued`, `sent`, `delivered`, `failed`, `test`), provider id, error kind, batch id (links to the action that created it), created/updated. The text is stored once per batch (not per recipient) for notices; invoice/receipt messages reference the invoice. Phone numbers are not copied into this table.

Existing senders (`notifyTenant`, the daily renewal/due/penalty checks, dashboard 📤 Send) move onto this layer so every tenant message follows the same order and is recorded. The daily checks keep their existing budget (8 tenant messages per building per run) and `NOTIFY_WHITELIST`/`notifyTenants` switches.

### 1.6 The three stuck invoices
When SMS goes live, the dashboard lists invoices whose earlier send is still `delivery pending`, with **Send now**. They are sent only when the owner taps it (they are old; amounts or status may have changed — the send uses the invoice's current data).

---

## 2. Tenant Telegram linking

- Per building: a QR code and link `t.me/bina_smart_bot?start=tenant_<building-slug>` ("Get your rent notices on Telegram"), and a printable A4 poster (Amharic + English) from the dashboard.
- The first SMS a not-yet-linked tenant receives ends with the short link to the same start page (once per tenant, not on every SMS).
- Flow in the bot: `/start tenant_<slug>` → "Share my phone" → proof exactly as for owners: `contact.user_id === from.id`, private chat, `chat.id === from.id`, not forwarded; match the **full E.164 number** against active tenancies **in that building** (never last-9 digits). Match → the tenant's user gets `telegramChatId`; later messages go by Telegram. No match → a neutral reply (no hint whether the number exists).
- A shared contact counts as a link only within 10 minutes after `/start tenant_…` (Mini Apps also share contacts — the owner-link bug of 13 September).
- Linking gives the tenant **messages only** in v1 — no chat with Bini about their account (§6).
- Unlink: tenant sends `/stop`; the owner can remove a tenant link from the dashboard.

---

## 3. Owner actions in Bini

### 3.1 Actions (v2)
| Owner says (examples) | Action | Data |
|---|---|---|
| "ለሁሉም ተከራዮች መልእክት ላክ፦ ነገ ውሃ ይቋረጣል" | `message` to all active tenants | owner's text |
| "ለ2ኛ ፎቅ …", "ለ211 …" | `message` to a floor / unit(s) | owner's text; floor and unit resolution reuse the `floor` and `unit` tools |
| "ያልከፈሉትን አስታውስ" | `remind_unpaid` | per tenant: own amount, due date, payment code — from the database |
| "የ211ን ደረሰኝ ላክ" | `send_invoice` | the existing invoice(s) of that unit (newest unpaid first) |
| "ለሁሉም የመስከረም ኪራይ ደረሰኝ አዘጋጅ" | `create_invoices` for a month | from each active contract's rent; skips units that already have that month's rent invoice; creating does **not** send (sending is a separate confirmed action) |
| "211 ከፍሏል 12,500" | `record_payment` | matches the unit's open invoice; full or partial per existing invoice statuses; then a receipt message (same confirm card shows it) |

Anything else that changes records (rent, contracts, vacate, expenses, staff) keeps the answer from 15 September: not from Telegram, here is the dashboard tab and button.

### 3.2 How every action works
1. **Nothing happens on the first message.** The model may only call *prepare* tools (`prepare_message`, `prepare_reminders`, `prepare_invoice_send`, `prepare_invoices`, `prepare_payment`). A prepare tool validates in code and stores a **pending action** (building, requesting owner access id, action kind, fully resolved recipients and data, exact final text, SMS parts and cost, expiry). It returns a preview; it sends and writes nothing else.
2. **Preview card** in Telegram (and the same in the dashboard chat): recipients (count + units), exact text, channel split (Telegram n / SMS n / not reachable n), SMS parts and remaining monthly balance; for payments the unit, invoice, amount and new status; for invoice creation the list of units and amounts and any skipped.
3. **Buttons ✅ ላክ / Confirm and ✖ ሰርዝ / Cancel** (Telegram inline keyboard; dashboard buttons). The callback carries only a random pending-action id.
4. **Confirm is checked in code, not by the model:** the pressing Telegram user is the same linked owner (or dashboard session for the same building); the action is not expired (**10 minutes**), not already used (**single use**, atomic status change `pending → running`), and the owner's access is still valid (re-read, as for every owner message). Recipients and figures are **re-resolved** at confirm time; if anything changed (a tenant paid, a tenancy ended, the balance changed) the card is replaced by an updated preview instead of executing.
5. **Execution** runs the existing server logic (the same functions the dashboard uses for mark-paid, invoice send, invoice generation), through the delivery layer, and edits the card: "✅ Sent: Telegram 0 · SMS 64 · not reachable 7 (units …)". Delivery updates arrive later in the dashboard Messages list.

### 3.3 Rules
- **Text is the owner's.** A notice goes out exactly as the owner wrote it. If Bini proposes a cleaned-up Amharic version, the preview shows that version and the owner confirms that exact text. The building name and "— BinaSmart" signature are appended by code.
- **Figures come from the database**, never from the model: amounts, dates, payment codes, unit numbers, recipient counts. The grounding rule of the engine applies to previews.
- **Who may act:** only approvals with role `owner` confirm. Staff approvals may prepare; the card then says the owner must confirm, and it is sent to the owner's linked chat. Per-building setting to let staff confirm, off by default.
- **Limits:** at most **2 bulk sends** (`message` to more than one tenant, `remind_unpaid`) per building per day; quiet hours **21:00–07:00 Addis time** — a bulk send in quiet hours is refused unless the owner marks it urgent (a second explicit button "⚠️ አስቸኳይ ነው — አሁን ላክ"); single-unit sends and payments are not limited by quiet hours.
- **Record:** every prepare, confirm, cancel, expiry and execution is written to the building's AuditLog (actor = owner access id and channel; detail = action kind, counts, batch id — not the message text for notices, which is in the batch record) and shown in the dashboard activity log. These rows are excluded from nothing the owner sees.
- **Undo:** a recorded payment can be reversed with the existing dashboard "undo mark-paid"; created invoices can be cancelled from the dashboard. Sent messages cannot be recalled — that is why the preview exists.
- **Privacy:** tenant names in previews are restored on the server after the model (the `[[P1]]` token rule); phone numbers are never shown in Telegram previews or sent to the model.
- **Buildings:** actions that send require the building to be in `NOTIFY_WHITELIST` and `notifyTenants` on (today: Darulle only). Demo buildings run everything in test mode.

---

## 4. Dashboard

- **Messages** tab: batches (date, kind, who prepared/confirmed, channel split, delivered/failed/not reachable), drill-down by unit; the SMS count and monthly limit; "pending delivery" invoices with **Send now**.
- **Tenant Telegram** card: linked count (e.g. 12 / 71), the QR poster download, remove a tenant link.
- The Bini chat in the dashboard shows the same preview card and buttons as Telegram.

---

## 5. Testing and rollout

- **Unit/integration tests (node:test):** channel choice (Telegram → SMS → none); E.164 normalisation; SMS part counting and monthly limit; short-link token (unguessable, expiry, one invoice only); tenant link proof (forwarded contact, other user's contact, Mini App contact after 10 minutes, number in another building); every prepare tool (recipients, figures from DB, skipped units); confirm (wrong user, expired, double tap, access revoked, data changed → new preview); quiet hours and daily bulk limit; staff prepares / owner confirms; nothing sent or written without confirm; audit rows.
- **Model evaluation:** the owner eval on the demo building gains action questions — the model must call a prepare tool, the preview figures must match the database, and **no send or write may occur without a confirm step** (scored in code).
- **No test sends to live channels.** SMS stays in test mode on every building until Ibrahim switches it on. Demo data uses fake numbers (`0900…`).
- **Go-live order:** (1) Ibrahim enters the SMS key and approves; (2) **with his explicit permission, one first real SMS to his own phone** through a single-unit test tenancy he chooses; (3) Darulle's owner uses it; (4) the report (`ops/owner/report.js`) shows actions, deliveries and failures daily for the first week.
- **Rollback:** `SMS_TENANT_MODE=test` stops every tenant SMS instantly and leaves sign-in codes working; `SMS_MODE=test` stops all SMS of every kind; a per-building `ownerActions` switch turns the actions off while answers keep working.

## 6. Not in this version
Tenants chatting with Bini about their own account; WhatsApp; changing rent/contracts/tenants from Telegram; paying online from the invoice link (Chapa/telebirr later); scheduled messages; message templates library; recalling a sent message.

## 7. Needed from Ibrahim
1. An SMS provider account (suggested: AfroMessage), a sender name, and the API key entered into the server environment by him.
2. The monthly SMS limit per building and whether SMS is included or charged.
3. Tell the Darulle owner, and put the tenant Telegram QR poster up in the building.

## 8. Open facts to check during planning
- Darulle has only July 2026 rent invoices although a monthly invoice cron exists (1st of each month, 06:00): find out why August and September were not generated before `create_invoices` is built on the same logic.
- Which route the dashboard uses for mark-paid today (the owner route list shows `unpay` and `send`; the pay path must be found and reused, not duplicated).
- Whether the provider offers delivery reports (webhook or polling) and Amharic sender IDs.
