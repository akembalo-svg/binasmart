# BinaSmart Business — an owner-controlled page for every shop, office and venue — Design

**Date:** 2026-09-04 · **Status:** approved in conversation · **Owner:** Ibrahim

## 1. Goal

A shop, office or venue owner signs in with their phone, and manages **their own page** on bina.et: profile, product/service catalogue, offers, and the orders customers place. Their public page (`/shop/<slug>`) is a small, professional storefront with Amharic-first SEO. One login serves all owner kinds: a cinema owner sees its programme and shows instead of products.

Today the database holds **416 shops and 256 products** entered by us, **0 orders**, and no way for an owner to touch any of it. That is the gap.

## 2. Non-goals (this phase)

Stock counts, delivery fees and zones, staff sub-accounts, multi-branch, online card payment for products (Chapa comes when live keys exist), ratings moderation, chat.

## 3. Who can sign in, and how

- **Claim** (`/business`): owner enters a phone → if a Shop with that phone exists, an `OwnerClaim` (PENDING) is created and a 6-digit code is sent to their Telegram if they have one; otherwise the claim waits for Ibrahim's approval in ops. No phone match → a "register your business" form that creates a PENDING Shop (nothing public until approved).
- **Session**: verifying the code (or Ibrahim approving) issues an `OwnerSession` token (32 bytes, 30 days, httpOnly cookie `bsown`). One session = one shop; an owner with several shops picks from a list.
- **Guard**: every dashboard API resolves the shop from the session, never from the request body. An owner can only ever read and write their own shop's rows. Ops can hide any shop, product or offer.
- **Cinema owners**: the same claim, matched on `Venue.phone`. Their dashboard shows Programme (add/remove entries) and, when they have a Hall, their Shows — not Products.

## 4. Data (Prisma)

```
model OwnerClaim {                       model OwnerSession {
  id        String @id @default(cuid())    id        String   @id @default(cuid())
  kind      String   // shop | venue       token     String   @unique
  shopId    String?                        kind      String   // shop | venue
  venueId   String?                        shopId    String?
  phone     String                         venueId   String?
  name      String?                        phone     String
  code      String   // 6 digits           createdAt DateTime @default(now())
  telegramId String?                       lastSeen  DateTime @default(now())
  status    String   @default("PENDING")   expiresAt DateTime
  tries     Int      @default(0)         }
  createdAt DateTime @default(now())
  expiresAt DateTime
  @@index([phone, status])
}
```
`Shop` gains `slug String? @unique`, `ownerPhone String?`, `logoUrl String?`, `about String?` (long text), `mapUrl String?`, `status String @default("live")` (live | hidden | pending). `Product` and `Offer` already have everything needed (`visible`, `approved`).

Slugs: from `nameAm || name`, ASCII-folded, deduplicated with a 2-hex suffix; existing 416 shops get slugs by a backfill script.

## 5. Dashboard (`/business`, after sign-in)

Tabs, all Amharic-first:
1. **ገጼ · My page** — name (am/en), category, about, phone, Telegram, opening hours (7 rows), address, map link, logo, up to 8 photos. "See my page" opens `/shop/<slug>`.
2. **ምርቶች · Products** — list with photo, name, price ETB, category, description, visible toggle, "order on page" vs "call to order". Add/edit/delete. Max 200 per shop.
3. **ቅናሽ · Offers** — title, description, start and end date; shows as a badge on the page and in the building's offers feed.
4. **ትዕዛዞች · Orders** — incoming orders with customer name and phone; status buttons NEW → ACCEPTED → COMPLETED (or CANCELLED). A Telegram ping to the owner when one arrives.
5. **QR** — a printable A5 poster PNG with the shop name and a QR to its page.
For venue owners tabs 2–4 are replaced by **ፕሮግራም · Programme** (add/remove entries, same rules as ops: source and dates mandatory) and **ትርዒቶች · Shows** (read-only list of their shows and ticket counts).

## 6. Public page (`/shop/<slug>`)

Hero (logo, name, category, open/closed by hours, rating), photos, catalogue grid with prices, offers, hours table, phone/Telegram/map buttons, "order" form (name, phone, items, note) that creates an `Order` — no payment, the shop calls back. Cross-links to the building page if the shop is in one.

SEO: title `<name> (<nameAm>) — <category> in <sub-city>, Addis Ababa | BinaSmart`, description from `about`, canonical, OG card from the first photo, JSON-LD **LocalBusiness** (address, geo, phone, openingHoursSpecification, image, priceRange) + **ItemList of Product** (name, image, price, ETB, availability) + breadcrumbs. Sitemap gains every live shop; IndexNow ping on publish.

## 7. Footer and explainer pages

A shared footer partial injected on the main pages: **አገልግሎቶች** (Ride, Cinema, Watch, Business, Guides, Tenders, News), **ይቀላቀሉን** (/for-business, /for-cinemas, /for-filmmakers, /drive-with-us), **ስለ እኛ** (/why-binasmart, GitHub, Telegram, phone), and a line "BinaSmart · Addis Ababa · © 2026". New page **/for-business**: what an owner gets, how to register in 3 steps, what it costs (free during launch), FAQ, in the same style as /for-cinemas, with Service + FAQ schema.

## 8. Rules that must hold

- A session may only read or write its own shop/venue rows; the shop id never comes from the client.
- Claims expire in 15 minutes, 5 code attempts, then the claim is dead.
- A new (unclaimed-phone) registration is `pending` and invisible until Ibrahim approves.
- Photos: max 8, 5 MB each, jpeg/png/webp only, stored under `uploads/shops/<shopId>/`, served from `/uploads/...`.
- Prices are integers in ETB; nothing is ever charged online in this phase.
- Ops can hide anything: `status=hidden` removes the page from the site and the sitemap.

## 9. Tests

Claim: unknown phone → registration path; known phone → code; wrong code 5× → dead; expired claim refused. Session: one owner cannot read another's products (403), cannot set `shopId` in a body. Products: create/edit/delete, cap 200, invisible products hidden from the public page. Orders: created from the public page, status transitions valid only forward, Telegram stubbed. Page: slug 404 for hidden shops, LocalBusiness + Product schema present, sitemap includes live shops only. Sim `ops/business/sim.js`: register → approve → login → add product → public page → order → status → cleanup, zero leftovers.

## 10. Rollout

Behind `BUSINESS_ENABLED=1`. Order: schema + slugs backfill → claim/session → dashboard API → dashboard page → public shop page → footer + /for-business → sim → GSC/IndexNow.
