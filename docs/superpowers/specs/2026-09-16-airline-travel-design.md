# Ethiopian Airlines knowledge and Bini travel — design

**Date:** 16 September 2026 · **Status:** approved by Ibrahim in six parts (15–16 Sep 2026); this document awaits his review
**Where it sits:** the first "sector pack" of the Ethiopia knowledge programme (banking and business life follow with the same method). Decided by Ibrahim: sector packs (not a big crawl, not demo-first), Ethiopian Airlines first, full knowledge (not a sample), and Bini must also sell and handle tickets for BinaSmart users even if the airline never partners.

---

## 0. What this builds

Four pieces, each usable on its own, in this order:

1. **Airline knowledge pack** — every public information page of ethiopianairlines.com (plus passenger rights and the Bole airport guide) as dated, sourced knowledge documents, with 60 test questions and a weekly freshness check.
2. **Bini travel helper** — what Bini can do for a traveller with no partner: check-in link, ShebaMiles help, flight status and "my booking" links, a pre-trip checklist.
3. **Booking and paying** — search, hold, **payment link**, ticket issued after the payment company confirms. Two issuers: **3a** a licensed IATA agency in Addis (birr, telebirr/Chapa); **3b** an international booking company for the diaspora (card, dollars).
4. **Demo** — a private chat page marked "BinaSmart demo — not an official Ethiopian Airlines service", used to ask the airline for a meeting and real access.

Ibrahim's rule for booking: **Bini does everything up to the booking, then sends a payment link.** Payment never happens inside the chat.

---

## 1. The sector-pack method (reused by every later sector)

A pack has five parts:

1. **Source list** — a file naming the official sources: website or document, language, how often it changes, who publishes it.
2. **Knowledge files** — each page becomes a clean document with source URL, download date and last-checked date. Figures (kilos, fees, time limits) are kept exactly as the source writes them. Nothing is written from memory.
3. **Test questions** — 60 real questions (40 Amharic, 20 English), each with the page that answers it. Measured before and after every change, like Afiya and Asmat (target: the right page in the top 3 for at least 90%).
4. **Freshness check** — weekly re-read of every source page; changed text updates the knowledge and sends Ibrahim a short Telegram note ("Ethiopian baggage page changed"); a vanished page is marked and no longer used.
5. **Demo agent** — a chat page in the Afiya/Asmat style, private link, "BinaSmart demo — not an official <company> service", no company logo, answers only from the pack, a source link on every answer.

## 2. Airline knowledge pack (Piece 1)

- **Sources:** ethiopianairlines.com information pages — baggage, fares and rules, changes and refunds, special assistance, pets, medical travel, travel documents and visas, transit and the Addis hub, ShebaMiles (join, earn, use, tiers), lounges, check-in rules, cargo, Ethiopian Holidays, Skylight hotel. Amharic pages (`/et/`) where they exist, English otherwise. Booking and account pages are skipped. Plus: Ethiopian Civil Aviation Authority passenger-rights rules; the Bole airport guide already on bina.et/airport.
- **Reachability:** ethiopianairlines.com and its sitemap open from the server; `robots.txt` allows information pages with a 5-second crawl delay, which the crawler respects.
- **Files:** a new knowledge source (e.g. `knowledge/travel/`), curated the same way as the law and health libraries (never in `knowledge/web/`), with an English and Amharic header per document naming the key facts. The 60 gold questions become a benchmark file like gold v3.
- **Bini and the demo agent** prefer this source for travel questions; Afiya and Asmat exclude it.

## 3. Bini travel helper (Piece 2)

What Bini can do for a person without any airline access:

- **Check-in:** "open my check-in" → the person's own link to Ethiopian's check-in page with the booking code and surname filled in, plus the rules (when it opens, documents, baggage) from the pack.
- **ShebaMiles:** how to join, earn and use miles; a link to the person's account. Real balances and redemption need a partnership.
- **Flight status and "my booking":** official links with the flight number or booking code filled in.
- **Pre-trip checklist** built from the pack for the route: visa, yellow-fever card, baggage, transit rules.
- No automation of the airline's website (that breaks their rules and would stop working); only official deep links and public information.

## 4. Booking and paying (Piece 3)

### 4.1 Issuers
- **3a — birr, in Ethiopia (first):** a licensed IATA travel agency in Addis with Amadeus/Sabre. Bini finds the flight and collects the passenger details; the person pays by **telebirr or Chapa**; the agency issues the ticket; BinaSmart earns a commission or service fee. Needs: one agency (Ibrahim finds it), Chapa live keys.
- **3b — card, diaspora and foreigners (later):** an international booking company with a direct connection (search, book, issue). Dollar card payment on the provider's page. Needs: Ibrahim opens the account and accepts its terms himself.
- Both behind one internal interface (`search`, `hold`, `issue`, `cancel`, `status`), so Bini's flow is the same whoever issues.

### 4.2 The flow (approved Part 3)
1. The person asks in their words ("ከአዲስ ወደ ዱባይ ጥቅምት 10").
2. Bini searches and shows up to 3 options: times, stops, baggage, change rules, and the **full price with the BinaSmart fee on its own line** (birr or dollars).
3. The person picks one. Bini asks for name as in passport, passport number and expiry, date of birth, phone; checks spelling rules, passport validity (6 months after travel) and whether a visa is needed.
4. Bini shows a summary (flight, passenger, total, change/refund rules) and asks **"Confirm?"**
5. On yes, Bini **holds** the seat with a time limit (for example 2 hours) and gives the booking code. The price is re-checked just before the hold; if it changed, Bini says so before holding.
6. Bini sends the **payment link** (telebirr/Chapa for 3a; the provider's card page for 3b) showing the time limit: "pay within 2 hours or the seat is released".
7. The payment company confirms to our server directly (webhook). A "I paid" message or a screenshot never counts.
8. The ticket is issued; Bini sends the e-ticket number, booking code, check-in link and the pre-trip checklist.
9. If time runs out, the seat is released and Bini offers to search again (the price may have changed).

### 4.3 Rules
- **Money:** payment details never in the chat. Price shown as ticket + taxes + BinaSmart fee, each on its own line, before any hold. The fee per route type is set by Ibrahim and every change is logged. **The BinaSmart fee is refunded when the airline refunds the ticket** — nobody pays a fee for a ticket they did not get. Nothing is issued before the payment company's confirmation.
- **Changes and refunds (v1):** Bini explains the rules and passes the request to the issuer; automatic changes come later.
- **Records:** every step (who, what, when, amounts, issuer references) in an ops view for Ibrahim: bookings, holds, payments, commissions, failures.
- **Demo never books:** the demo page runs the flow with a test booking, no real seat, no payment.

## 5. Data and privacy (approved Part 5)

- Passport, date of birth and phone are collected only in the booking chat, stored **encrypted** on our server, and sent to **one place only: the ticket issuer**. Never to the AI model, never in logs, never in Telegram previews beyond "name as in passport" and the last 4 digits of the passport number.
- **Deleted 30 days after the trip**; only the receipt (name, route, amount, date) is kept for accounting. "Delete my passport data" is a Bini action with a confirmation.
- Who sees what: the person sees their own bookings; Ibrahim sees everything in the ops view; the agency sees only the bookings it issues. All access is logged.
- The demo uses public information and fake passenger data only; no airline or bank logos; "BinaSmart demo" label on every screen; private link, not indexed.

## 6. Demo page (Piece 4)

- The Afiya/Asmat chat front-end with a travel config: original avatar, private link, the demo label, sources on every answer.
- Includes the travel helper and a **test booking** walk-through that stops before payment.
- Purpose: the meeting with Ethiopian Airlines; if they say yes, BinaSmart asks for real check-in, ShebaMiles and booking access.

## 7. Testing and rollout (approved Part 6)

- **Automatic tests:** the 60 questions (≥ 90% right page in the top 3, every answer with a source, no figure without a source); helper links built correctly and never for another person's booking; the booking flow with a fake issuer and fake payment (search → hold → link → confirmation → ticket; hold expiry; price change before hold; double payment; refund; encryption and deletion schedule); the demo can never hold or charge; the model never sees passport numbers; nothing is issued without the payment company's confirmation.
- **Live:** issuer and payment in sandbox first; the **first real ticket is Ibrahim's own**, on a route he chooses, only when he says go.
- **Order:** (1) airline pack + freshness check, about a week; (2) travel helper; (3) demo page → Ibrahim pitches the airline; (4) booking 3a when the agency and Chapa live exist, 3b when the provider account exists; (5) then the banking pack with the same method.
- **Needed from Ibrahim:** one IATA agency in Addis, the booking-company account, Chapa live keys, the fee per route type, a yes before the first real ticket.

## 8. Not in v1

Automatic changes and refunds; seat and meal selection; multi-city trips; hotel bundles; real ShebaMiles balances or airline check-in through an API (needs the airline); any automation of the airline's website.

## 9. Honesty rules

Every price, kilo, fee and time limit Bini states comes from a source page or the issuer's live answer, never from the model; the demo says on every screen that it is not the airline; the booking summary shows the BinaSmart fee separately before the person confirms.
