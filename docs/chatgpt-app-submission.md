# BinaSmart — ChatGPT App (plugin "With MCP") submission pack

Prepared 2026-09-03 from OpenAI's current plugin submission guidelines. Copy each block into the matching portal field. Items marked **YOU** need Ibrahim; items marked **CLAUDE** are one message away.

## 0. Before you open the portal

| # | Step | Who |
|---|---|---|
| 1 | Verify your developer identity: OpenAI Platform → Settings → General → "Verify organization / individual". Submissions from unverified accounts are rejected. | **YOU** |
| 2 | Publish the three legal/support pages drafted in §8 at `https://bina.et/privacy`, `https://bina.et/terms`, `https://bina.et/support`. Read them first — they describe what BinaSmart actually does with rider data. | **CLAUDE** (say "publish the pages") |
| 3 | In the portal, MCP tab → Domain verification → copy the token, paste it to me. I drop it at `https://bina.et/.well-known/openai-apps-challenge` (the nginx slot already exists). Then click Verify. | **YOU** → **CLAUDE** |
| 4 | Tell your dispatcher that rides whose phone is **+251911244344** are OpenAI reviewer test bookings: acknowledge, do not send a driver. | **YOU** |

## 1. Info tab

**Plugin name:** BinaSmart

**Short description (≈80 chars):**
Fixed-price rides in Addis Ababa, Ethiopia's BinaSmart directory and official-process guides.

**Long description:**
BinaSmart (bina.et) is Ethiopia's all-in-one digital platform. With this app ChatGPT can:

- Quote a **fixed, upfront fare** for a ride anywhere in Addis Ababa, for five vehicle tiers (moto, bajaj, economy, comfort, XL). No surge pricing.
- **Book the ride** once the user confirms pickup, drop-off, tier, fare and their Ethiopian phone number. A BinaSmart dispatcher assigns a licensed driver and confirms by phone; the rider pays the driver directly (cash or telebirr). Users can check status or cancel before the trip starts.
- Search the **BinaSmart directory** of buildings, hotels, hospitals and shops (cafés, restaurants, pharmacies, banks, gyms, clinics) with English and Amharic names, contact numbers and page links.
- Show **hotel room types and prices**, **hospital departments, fees and appointment slots**, and **upcoming events** with ticket prices.
- Read 22 bilingual, regularly updated **Digital Ethiopia guides**: Fayda national ID, telebirr, CBE Birr, e-Passport, eVisa, TIN, business licence, VAT/TOT, customs, driving licence, car import, Yellow Card, bank accounts, certificates, utility bills, rental agreements, tenant screening.

Ride booking is available in Addis Ababa only. No payments are taken inside ChatGPT. Answers are grounded in BinaSmart's live database and link back to bina.et.

**Category:** Travel & transportation (secondary: Local services / Lifestyle if the portal allows one only, choose Travel & transportation)

**Logo:** https://bina.et/icon-512.png (512×512 PNG, brand mark on emerald)

**Website:** https://bina.et
**Support URL:** https://bina.et/support
**Privacy policy URL:** https://bina.et/privacy
**Terms URL:** https://bina.et/terms
**Support email:** the address you verify in the portal (gmail is accepted); WhatsApp +251 911 244 344 is listed on the support page.

**Developer identity:** your verified name / organisation exactly as it appears in OpenAI Platform settings.

**Screenshots:** none (this plugin has no UI components).

## 2. MCP tab

| Field | Value |
|---|---|
| Server URL type | **Universal** |
| MCP Server URL | `https://bina.et/mcp` |
| Transport | Streamable HTTP |
| Authentication | **None** — no user accounts, no OAuth. Booking identity is the rider's phone number given in conversation. |
| Challenge base URL | `https://bina.et` |
| Verification token path | `https://bina.et/.well-known/openai-apps-challenge` (plain text, only the token) |
| Health | `https://bina.et/mcp/health` |

**Tool scan:** the scan should list exactly 9 tools. Justification for each (paste per tool if the portal asks):

| Tool | Justification | Annotations |
|---|---|---|
| `quote_ride` | Returns the fixed fare, distance and ETA for every vehicle tier between two places in Addis Ababa. Inputs are two place names (landmarks, buildings) — the minimum needed to price a trip. Read-only. | readOnly ✔ |
| `request_ride` | Books the ride the user just quoted. Inputs: tier, pickup, drop-off, rider name, Ethiopian phone — the minimum a dispatcher needs to send a driver and confirm by phone. Payment method is cash or telebirr paid to the driver; nothing is charged in ChatGPT. Idempotent: repeated identical requests within 10 minutes return the same booking. | readOnly ✘, destructive ✘, idempotent ✔ |
| `get_ride_status` | Status, driver name, vehicle and plate for a booking. Requires the ride id **and** the booking phone so only the rider can look it up. Read-only. | readOnly ✔ |
| `cancel_ride` | Cancels a booking before the driver starts the trip. Same ride-id + phone check. | readOnly ✘, destructive ✔, idempotent ✔ |
| `search_places` | Name/category search over BinaSmart's public directory of buildings, hotels, hospitals and shops. Returns public listing data only (no tenant or owner data). Read-only. | readOnly ✔ |
| `get_hotel_rooms` | Room types, nightly prices, capacity and amenities for one listed hotel. Read-only. | readOnly ✔ |
| `get_hospital_departments` | Departments, consultation fees, doctors, hours and remaining appointment slots for a date. Read-only; booking happens on bina.et. | readOnly ✔ |
| `list_events` | Upcoming public events with venue, time, price and seats left. Ticket purchase happens on bina.et. Read-only. | readOnly ✔ |
| `get_ethiopia_guide` | Full text of one of 22 bilingual step-by-step guides to Ethiopian government and banking processes, or the list of guides. Read-only, public content. | readOnly ✔ |

**Content Security Policy:** not applicable — the plugin returns text only and renders no UI components. Leave the CSP domain list empty.

**Reviewer credentials:** not required (no authentication). For end-to-end booking tests reviewers should use:
- Rider name: `OpenAI Review`
- Rider phone: `+251911244344` (BinaSmart operations line — bookings on this number are recognised as test bookings and are not dispatched)
- Note: the server allows 5 bookings per phone per 10 minutes; if a test returns "slow down", wait 10 minutes.

## 3. Test cases

### Positive (5)

**P1 — Quote a ride**
- Prompt: *"How much is a BinaSmart ride from Edna Mall to Piassa?"*
- Expected: ChatGPT calls `quote_ride(pickup:"Edna Mall", dropoff:"Piassa")`. Result: `distance_km`, `eta_min`, five `quotes[]` each with `tier`, `label`, `fare_etb`, plus `pickup_coords`/`dropoff_coords` and `source_url: https://bina.et/ride`. ChatGPT lists the fares in ETB and mentions the price is fixed.
- Fixture: none; live data.

**P2 — Book after confirming**
- Prompt: *"Book the economy one. My name is OpenAI Review, phone +251911244344."*
- Expected: ChatGPT confirms pickup, drop-off, tier, fare and phone, then calls `request_ride(tier:"economy", pickup:<coords or name>, dropoff:<coords or name>, rider_name:"OpenAI Review", rider_phone:"+251911244344")`. Result: `ride_id`, `status:"dispatching"`, `fare_etb`, `tracking_url: https://bina.et/ride?id=<id>`, `next_step`. ChatGPT reads back the fare and ride id and gives the tracking link.
- Fixture: the test phone above.

**P3 — Check status**
- Prompt: *"Where is my ride? Ride id <id from P2>, phone +251911244344."*
- Expected: `get_ride_status(ride_id, rider_phone)` → `status` (dispatching / assigned …), `driver` (null until assigned), `tracking_url`. ChatGPT reports the status plainly.

**P4 — Directory search**
- Prompt: *"Find a pharmacy in Addis Ababa on BinaSmart."*
- Expected: `search_places(query:"pharmacy", category:"pharmacy")` → `results[]` with `kind:"shop"`, `name`, `name_am`, `building`, `unit`, `phone`, `url`. ChatGPT lists them with the building and phone.

**P5 — Guide**
- Prompt: *"How do I apply for an Ethiopian eVisa?"*
- Expected: `get_ethiopia_guide(slug:"ethiopia-evisa")` → `title`, `summary`, `text` (Amharic + English), `source_url: https://bina.et/ethiopia-evisa`. ChatGPT summarises the steps and cites the URL. (Calling with no slug returns the list of 22 guides.)

### Negative (3)

**N1 — Foreign phone number**
- Prompt: *"Book an economy ride from Edna Mall to Piassa, name Test, phone +254700000000."*
- Expected: `request_ride` returns `isError: true` with "rider_phone must be an Ethiopian mobile number: 09XXXXXXXX or +2519XXXXXXXX". Nothing is booked. ChatGPT asks for an Ethiopian number.
- Reason: rides are dispatched by phone inside Ethiopia; foreign numbers cannot be confirmed.

**N2 — Place outside Addis Ababa**
- Prompt: *"Quote a ride from Bahir Dar to Gondar."*
- Expected: `quote_ride` returns `isError: true` — "Could not find … in Addis Ababa" (or the ride API's "pickup and dropoff inside Addis required"). ChatGPT explains BinaSmart Ride covers Addis Ababa only.
- Reason: service area limit; no fare is invented.

**N3 — Unknown guide slug / ambiguous place**
- Prompt: *"Get me the BinaSmart guide 'moon-visa'."*
- Expected: `get_ethiopia_guide(slug:"moon-visa")` returns the list of valid guides with the note `Unknown slug "moon-visa" — pick one from this list.` — a safe fallback, not a fabricated guide.
- Reason: the tool never returns content that does not exist. (Variant: *"ride from Bole to Edna"* → `quote_ride` returns the Bole candidates and asks which one instead of guessing.)

## 4. Starter prompts

1. "How much is a BinaSmart ride from Bole Airport to Piassa?"
2. "Book me a bajaj from Edna Mall to Sarbet — I'll give you my phone number."
3. "Find a pharmacy or clinic near Bole on BinaSmart."
4. "What documents do I need for an Ethiopian TIN?"
5. "What events are on in Addis Ababa this month?"

## 5. Availability (Global tab)

Recommended: **Ethiopia** first. Add **United Arab Emirates, Saudi Arabia, Kenya, United States, United Kingdom, Canada, Germany** — where the Ethiopian diaspora books rides and reads guides for family at home. The ride service itself is Addis Ababa only; that is stated in the description and enforced by the server.

## 6. Policy attestations — how BinaSmart complies

- **Commerce / checkout:** no purchase happens in ChatGPT. Ride fares are paid to the driver (cash or telebirr); hotel rooms, tickets and appointments are booked on bina.et (external checkout on our own domain). We sell no digital goods, subscriptions or credits.
- **Travel services:** a booking creates a dispatch request; there is no prepayment and no chargeback exposure. Cancellation before the trip is free.
- **Data minimisation:** the only personal data collected is the rider's name and Ethiopian mobile number, required to dispatch and confirm the ride. No conversation history, no account creation, no payment data, no government IDs.
- **Location:** tools take **place names** (landmarks, buildings). Coordinates are accepted only as optional user-typed text and are never requested from the device.
- **Restricted data:** none collected (no PCI, PHI, government identifiers or credentials).
- **Tool responses:** contain only user-relevant fields plus a `source_url` and `tracking_url`; no telemetry, session or trace IDs.
- **Support:** https://bina.et/support and WhatsApp +251 911 244 344.

## 7. Known review risks and the answer ready for each

| Risk | Our answer |
|---|---|
| "Travel services are high-chargeback" | No money moves through the app; fares are fixed at quote time and paid to the driver. |
| "Precise location data" | Inputs are place names; coordinates are optional text the user can type. If the reviewer objects, we can remove the coordinate option for ChatGPT in one line. |
| "Phone number collection" | Required to dispatch; disclosed in the privacy policy with 12-month retention and a deletion contact. |
| "Booking without confirmation" | Server instructions and the `request_ride` description tell the model to confirm pickup, drop-off, tier, fare and phone first; `readOnlyHint:false` makes ChatGPT show its own confirmation. |

## 8. Pages to publish on bina.et (drafts — review, then say "publish the pages")

### /privacy — Privacy Policy

**BinaSmart Privacy Policy** — last updated 3 September 2026

BinaSmart ("we", "us") operates bina.et and the BinaSmart services, including BinaSmart Ride. This policy explains what personal data we collect, why, who receives it, how long we keep it, and your choices.

**What we collect and why**
- *Ride bookings:* your name, Ethiopian mobile number, pickup and drop-off places, vehicle tier, and the fare. Used to dispatch a driver, confirm the ride by phone, and resolve disputes.
- *Directory, hotel, hospital and event enquiries:* the search terms you enter. Used only to answer the enquiry.
- *Bookings made on bina.et* (hotel rooms, appointments, tickets, food orders): the name and phone number you enter, and the booking details.
- *Technical data:* server logs with request time, tool name and a masked phone (last 3 digits) for security and abuse prevention.
- We do **not** collect payment card data, government identification numbers, health records, passwords or precise device location. Ride fares are paid directly to the driver or through telebirr/Chapa on their own secure pages.

**AI assistants (ChatGPT, Claude, Gemini)**
When you use BinaSmart through an AI assistant, the assistant sends us only the information needed for the action you asked for (for example the pickup, drop-off, your name and phone to book a ride). We do not receive your conversation history. The assistant's own privacy policy governs what it stores.

**Who receives your data**
- The driver assigned to your ride (name, phone, pickup, drop-off).
- BinaSmart dispatch staff.
- Hosting provider (servers in the EU) and messaging providers (Telegram, WhatsApp) used to notify dispatch.
We do not sell personal data and do not share it for advertising.

**Retention**
Ride and booking records: 12 months after the ride or booking, then deleted or anonymised. Security logs: 90 days.

**Your choices**
You can ask us to correct or delete your data, or to stop contacting you, via WhatsApp +251 911 244 344 or the support page. We answer within 7 days.

**Children** — BinaSmart services are for users aged 18 and over.

**Changes** — we will post updates on this page with a new date.

Contact: BinaSmart, Addis Ababa, Ethiopia · https://bina.et/support

### /terms — Terms of Service

**BinaSmart Terms of Service** — last updated 3 September 2026

1. **Service.** BinaSmart (bina.et) provides an online directory, guides, and booking services, including BinaSmart Ride, a fixed-fare ride dispatch service in Addis Ababa, Ethiopia. Rides are performed by independent licensed drivers dispatched by BinaSmart.
2. **Eligibility.** You must be 18 or older and provide an accurate Ethiopian mobile number for ride bookings.
3. **Fares.** The fare shown at quote time is the price for that trip. There is no surge pricing. Fares are paid directly to the driver in cash or via telebirr/Chapa. Waiting time beyond 10 minutes or additional stops may be charged as displayed on bina.et/ride.
4. **Bookings and cancellation.** A booking is a request for dispatch; it is confirmed when a dispatcher or driver contacts you. You may cancel free of charge at any time before the trip starts. Repeated no-shows may lead to suspension.
5. **Using BinaSmart through AI assistants.** You may use BinaSmart via ChatGPT, Claude, Gemini or similar. The assistant acts on your instructions; review the pickup, drop-off, fare and phone number it shows before confirming a booking. BinaSmart is not responsible for errors introduced by the assistant.
6. **Directory content and guides.** Directory listings are provided by the businesses concerned. Guides are for general information and are updated regularly, but official requirements can change; confirm with the relevant authority for legal, tax or immigration decisions.
7. **Acceptable use.** Do not submit false bookings, harass drivers or staff, scrape the service, or attempt to bypass limits. We may suspend access for misuse.
8. **Liability.** To the extent permitted by Ethiopian law, BinaSmart is not liable for indirect losses, delays caused by traffic or weather, or actions of third parties. Nothing limits liability that cannot be limited by law.
9. **Privacy.** Our Privacy Policy at bina.et/privacy forms part of these terms.
10. **Governing law.** These terms are governed by the laws of the Federal Democratic Republic of Ethiopia. Disputes are handled by the courts of Addis Ababa.
11. **Contact.** https://bina.et/support · WhatsApp +251 911 244 344.

### /support — Support

**BinaSmart Support**

- **WhatsApp (fastest):** +251 911 244 344 — https://wa.me/251911244344
- **Ride problems:** open your tracking link (bina.et/ride?id=…) or message WhatsApp with your ride id and phone number.
- **Privacy requests** (access, correction, deletion): WhatsApp or the contact form on bina.et; answered within 7 days.
- **Business listings** (add or fix a building, shop, hotel or hospital): message WhatsApp.
- **Developers / AI assistants:** MCP server documentation at https://bina.et/mcp.

Hours: 7 days a week, 07:00–22:00 EAT.
