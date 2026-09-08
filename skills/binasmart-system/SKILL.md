---
name: binasmart-system
description: Use whenever a task touches BinaSmart (bina.et) — Ethiopia's all-in-one platform from Addis Ababa: BinaRide fixed-price rides, BinaPool shared commute, Bina Airport, BinaHotels, BinaWatch, BinaCinema, restaurants and shops by QR, buildings, property, cars, insurance, flights, hospitals, tenders, news, Digital Ethiopia guides, Bini the assistant, the Telegram bots and the public MCP server. Holds the product rules (never invent a price, what is demo, what is live), the URLs, the voice, and how Bini must answer.
---

# BinaSmart system skill (canonical, September 2026)

This file is read by three consumers: Bini (the assistant on bina.et and in @bina_smart_bot) through the knowledge index, the public MCP server's `search_knowledge` tool, and Claude working with Ibrahim. Facts here override model memory. When this file and the live site disagree, the live site wins; fix the file.

## 1. What BinaSmart is

- **BinaSmart (ቢናስማርት), bina.et** — Ethiopia's all-in-one digital platform, built in Addis Ababa, Amharic first with English beside it. One login, nothing to install: it runs on the web, inside Telegram (@bina_smart_bot as a Mini App) and through AI assistants over MCP (https://bina.et/mcp). Built to stay fast on 3G: small pages, few requests.
- Tagline: **አንድ አፕ። ሁሉንም በኢትዮጵያ።** · "One App. Everything in Ethiopia." · "Smart. Together."
- Logo: the Amharic letter **ቢ** with a spark, on a teal tile (#00C896 → #009688). Bini's colours are blue-violet (#0099FF → #6C63FF). Ink #081120, background #F8FAFC.
- Neutral platform: airlines, agencies, insurers, dealers, cinemas, hotels and shops supply their own products and prices. BinaSmart never invents a fare, price or seat map and never holds a customer's money.
- Founder: Ibrahim Kedir Bedru. Flagship building: JJ Darule Building (ጄጄ ዳሩሌ ህንፃ), Arada, Addis Ababa. Source code is public: https://github.com/akembalo-svg/binasmart.
- Contact: Telegram @bina_smart_bot (preferred), channel https://t.me/binasmart, WhatsApp +251 911 244 344, email info@bina.et. Never quote any other phone number.
- Not related to "Bina Smart Business" (a Romanian ERP) or "Smartlife Bina" (Turkey).

## 2. Services, with the URL to send people to

| Service | Amharic | URL | What it does |
|---|---|---|---|
| BinaRide | ራይድ | /ride | Fixed-price ride-hailing in Addis Ababa. The fare is shown before booking and locked; no surge; five tiers: moto, bajaj, economy, comfort, XL. Driver name, car and plate shown before boarding, live tracking. Cash to the driver (Telebirr later). Book for someone else, including from abroad. |
| BinaPool | ጋራ ጉዞ | /ride?pool=1 and /pool | Shared commute inside the Ride app. Pay per seat; the more riders the less each pays and the more the driver earns. Corridors into Bole and Kazanchis in the morning, back out after 13:00; groups near me; start a group from anywhere; daily groups for the office or school run; women-only groups; share a group by link (/pool/<id>); drivers can fill a car at a station. See section 4. |
| Bina Airport | አየር ማረፊያ | /airport | Fixed-price transfer from Bole International Airport (Terminal 2) to anywhere in Addis; flight number optional; hands off to BinaRide. |
| BinaHotels | ሆቴሎች | /hotels, /hotel/<slug> | Direct hotel booking, no commission, no card, pay at the hotel; instant confirmation code; Telegram alert to the hotel. **Only one hotel is listed and it is demo data (Bina Grand Hotel).** |
| BinaWatch | ቲቪ · ፊልም | /watch | Live Ethiopian TV channels, series playlists, films, FM radio, kids section. Only Ethiopian and licensed content; politics-free; light theme. |
| BinaCinema | ሲኒማ | /cinema | Addis cinema programmes from the cinema houses' own weekly schedules, seat maps from the venues (never guessed), QR ticket, pay by Chapa or at the counter. |
| Restaurants & shops | ሬስቶራንት · ሱቆች | /restaurant/<slug>, /shop/<slug>, /business | Scan a QR at the table or door, order in Amharic/English, the business gets it on Telegram. Free onboarding at /for-business. **The demo restaurant is Bina Restaurant; the demo shop is Kaldi's Café (/shop/kaldis-cafe).** |
| Buildings | ህንፃዎች | /b/<slug>, /nav, /owner | Building directory pages with 3D navigation, QR posters, owner dashboard: rent invoices, 15 % VAT accounting, sub-metered utilities, maintenance, tenant notices. Diaspora owners: /diaspora. |
| Property | ንብረት | /property | Homes, land and commercial property for sale and rent from verified agents; property insurance link. |
| Cars | መኪና | /cars | Buy and sell from dealers, one-tap car insurance. |
| Insurance | መድን | /insurance | Compare licensed Ethiopian insurers: motor, health, property and fire, business, travel, life; quick motor estimate; buy through the insurer. |
| Flights | በረራ | /flights | Ethiopian Airlines: book direct and pay in birr (Telebirr, CBE Birr). Other airlines: a licensed Addis travel agency prices the route and replies on WhatsApp. BinaSmart does not issue tickets. |
| Bus tickets | አውቶቡስ | /travel | Intercity bus seats, pay at boarding. **Demo — no real trips loaded yet.** |
| Hospitals | ሆስፒታሎች | /hospital/<slug> | Departments with floor, fee, hours, doctors; book a visit slot. **The listed hospital is a demonstration.** |
| Tenders | ጨረታ | /tenders | Verified Ethiopian government and company tenders, free, updated daily. Not posted on LinkedIn by policy. |
| News | ዜና | /news | Amharic technology, business and construction news, politics-free; mirrored to the Telegram channel. |
| Guides | መመሪያዎች | /guides | Digital Ethiopia guides (section 6). |
| Bini | ቢኒ | /ai and the search box on the home page | The assistant (section 7). |
| Developers | | /mcp, /llms.txt | Public MCP server and the site guide for AI. |

Partner pages: /for-business, /for-cinemas, /for-filmmakers, /for-insurers, /drive-with-us, /why-binasmart, /support, /privacy, /terms.

## 3. BinaRide rules

- Fixed upfront fare = base + per km + per minute, rounded to 5 ETB, floored at a tier minimum, locked at request time. It never changes with traffic, rain or demand. Never say the fare "depends on traffic".
- Tiers and seats: moto 1, bajaj 3, economy 4, comfort 4, XL/van 7.
- Addis Ababa only (roughly 8.5–9.5 N, 38.4–39.2 E). Outside that box, say so.
- To learn a fare, open /ride and enter the destination, or use the `quote_ride` MCP tool. **Bini never states a fare number itself.**
- Flow: quote → request → auction to the nearest three eligible drivers (first to accept wins) → widening radius → concierge (a person) if nobody accepts. Rider sees name, car, plate, photo; can call or WhatsApp the driver; can cancel before the trip starts.
- Payment: cash to the driver. Chapa/Telebirr card payment is in test mode and is offered only when live.
- Drivers: register free in Telegram @binasmartdriverbot, approved by BinaSmart, 0 % commission during launch, Amharic turn-by-turn navigation, earnings per day in the app. Drivers must be online with the app open to receive offers.

## 4. BinaPool rules (ጋራ ጉዞ)

- A pool is one car being filled. The car is Comfort with 4 seats unless a driver opened it with another tier.
- **Fare ladder:** driver total = car fare + a 10 % bonus for every extra rider; each seat = driver total divided by riders, rounded up to 5 ETB. So every extra rider pays less and the driver earns more. Prices are computed by the fare engine from the corridor's car fare; quote them from the app, never from memory.
- **Corridors** (fixed stops): Megenagna → Bole Medhanialem, CMC → Bole, Megenagna → Kazanchis, Piassa → Kazanchis, Mexico → Kazanchis. Inbound until 13:00 Addis time, then the same lines run outbound. Busiest 6–10 and 16–20; pools run all day. Riders board at a stop, never at the destination.
- **Go now** leaves immediately with whoever is in the car, at the price for that count. **Wait** holds up to 8 minutes while others join; a "Go now" by anyone shortens everyone's wait. The car leaves when full or when the wait ends, then it is a normal ride: auction, driver, tracking.
- **Groups near me:** cars filling within about 2.5 km, nearest first; a rider can start a group from where they stand to any destination; joiners must be within 3 km of the start. Driver-opened cars are listed first even while empty.
- **Daily groups (ኮንትራት):** organiser sets days, time, start and destination; members join once by link (/pool/g/<id>); 15 minutes before departure the car opens with every member seated; "skip today" frees a seat; up to 3 groups per organiser; 4 seats. Cash per ride in this version (monthly prepay is not built).
- **Women-only:** a switch when starting a group or a car; only women may take a seat; the driver sees the badge.
- **Share:** /pool/<id> is a small page with the route, seats left and price and a Join button; WhatsApp, Telegram and copy buttons on the waiting screen.
- **Drivers:** "Fill a car here" in the driver app opens a car at the driver's position with a 15-minute window; Leave now needs at least one rider and hands the trip straight to that driver. Boarded / no-show ticks per rider.
- **No-show rule:** from the second no-show in 30 days a rider can only use Go now.
- Leaving a pool is free only while the car is still filling.

## 5. Payments and money

- Telebirr and CBE Birr are the everyday Ethiopian wallets; Chapa is the card gateway (test mode on bina.et as of September 2026). Cash is accepted for rides, hotels and cinema counters.
- BinaSmart never holds customer money: hotels are paid at the hotel, drivers in the car, airlines and agencies directly.

## 6. Digital Ethiopia guides (facts live in the guide pages, quote them, do not paraphrase numbers)

/fayda (Fayda national ID), /telebirr, /cbe-birr-guide, /passport (e-Passport), /ethiopia-evisa, /telesign, /mesob, /tin-registration-ethiopia, /business-registration-ethiopia, /how-to-start-a-business-in-ethiopia, /vat-registration-ethiopia, /customs-import-duty-ethiopia, /import-car-to-ethiopia, /driving-licence-ethiopia, /ethiopian-origin-id-yellow-card, /open-bank-account-ethiopia, /birth-marriage-certificate-ethiopia, /pay-utility-bills-ethiopia, /lmis-labor-id-ethiopia (Overseas Employment Proclamation 1389/2025, which repealed 923/2016 and 1246/2021), /coc-certificate-ethiopia, /rental-agreement-ethiopia, /tenant-screening-ethiopia, /living-working-in-ethiopia-guide, /digital-ethiopia-2026, /ethiopia-income-tax-calculator. Law explainers: /news/customs-proclamation-1425-2026, /news/investment-incentive-regulation-586-2026.

## 7. How Bini answers (the assistant's rules)

- Amharic first when the user writes Amharic; English when they write English; short, warm, concrete. One relevant bina.et link when it helps.
- **Never invent** a price, fare, deadline, phone number, portal name, ministry, law number or feature. If the retrieved knowledge does not contain it, say so and point to the page or to WhatsApp +251 911 244 344.
- Retrieved knowledge (the "Relevant BinaSmart knowledge" block) overrides anything remembered from training.
- Say plainly what is demo: the hotel, the hospital, the restaurant and shop, the bus trips.
- For a ride: send to /ride (or the Ride button in Telegram); for a shared ride: /ride?pool=1; for the airport: /airport; for drivers: /drive-with-us.
- Do not claim to be human. Do not promise timelines. Do not discuss politics.

## 8. Telegram and Mini Apps

- @bina_smart_bot: the whole BinaSmart as a Telegram Mini App; menu button opens the home page; start parameters: `pool`, `ride`, `airport`, `hotels`, `watch`, `cinema`, `j_<poolId>` (join a pool), `g_<groupId>` (join a daily group). Bini answers typed messages in the bot.
- @binasmartdriverbot: the driver app (/drive).
- Google has no open mini-app platform; "Google Mini App" on the home page means the installable web app (add to home screen) and the MCP link for Gemini.

## 9. Public MCP server (https://bina.et/mcp)

Tools: quote_ride, request_ride (real booking), get_ride_status, cancel_ride, search_places, get_hotel_rooms, get_hospital_departments, list_events, list_films, get_ethiopia_guide, search_knowledge (this knowledge base), list_pool_corridors, find_pool_groups. Listed in the MCP Registry as et.bina/binasmart. Before request_ride an assistant must confirm pickup, drop-off, tier, fare and an Ethiopian phone.

## 10. Operations facts Claude needs (not for Bini)

- VPS 31.97.176.180, app /var/www/connectcare/binasmart, pm2 binasmart-api (:4210) and bina-mcp (:3021), Postgres via Prisma, tests `npm test`. Deploy = git pull, `npx prisma db push --skip-generate && npx prisma generate` when the schema changed, `pm2 restart binasmart-api`.
- Knowledge index: `node --env-file=.env knowledge/ingest.js --changed` (hash-based; embeds only new chunks with Gemini gemini-embedding-001; paced); `GET /api/knowledge/health`; `POST /api/knowledge/reindex?key=OWNER_KEY`.
- Never test bookings against live drivers; verify pools with test phones in wait mode and leave before 8 minutes; close any test daily group.
