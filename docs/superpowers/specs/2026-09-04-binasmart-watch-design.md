# BinaSmart Watch — Amharic films online (Phase B) — Design

**Date:** 2026-09-04 · **Status:** approved in conversation · **Owner:** Ibrahim
**Decisions:** rent per film (option 1); rental window **48 hours**; video never lives on our VPS.

## 1. Goal

A "Watch · ይመልከቱ" section on the cinema side of bina.et where BinaSmart lists Amharic films it has licensed. The video file lives elsewhere (YouTube, or an mp4/HLS link on another server). Users watch free films now; paid films are rented per film for 48 hours once Chapa is live.

## 2. Non-goals

Uploading video to bina.et; downloads; subtitles upload; comments; DRM; subscriptions. Piracy: a film with no rights note is never public.

## 3. Data (Prisma)

```
model Film {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  titleAm     String?
  year        Int?
  runtimeMin  Int?
  rating      String?
  language    String   @default("Amharic")
  genre       String?
  descr       String?
  posterUrl   String?
  sourceKind  String   // youtube | mp4 | hls
  sourceUrl   String   // the link on the other server / YouTube URL or id
  priceEtb    Int      @default(0)      // 0 = free
  rentHours   Int      @default(48)
  rights      String?  // "Licence from <producer>, streaming Ethiopia, signed 2026-09-01"
  rightsUntil DateTime?
  status      String   @default("draft") // draft | public
  views       Int      @default(0)
  createdAt   DateTime @default(now())
  rentals     Rental[]
}
model Rental {
  id         String   @id @default(cuid())
  code       String   @unique         // BW-XXXXXX
  filmId     String
  film       Film     @relation(fields: [filmId], references: [id])
  name       String
  phone      String
  telegramId String?
  priceEtb   Int
  chapaRef   String?
  status     String   @default("PENDING") // PENDING | ACTIVE | EXPIRED | CANCELLED
  startsAt   DateTime?                // set when payment confirms
  expiresAt  DateTime?                // startsAt + rentHours
  createdAt  DateTime @default(now())
  @@index([phone]) @@index([filmId, status])
}
```

**Visibility rule:** a film is public only when `status = public` AND `rights` is non-empty AND (`rightsUntil` is null or in the future). Enforced in one function, used by every public query.

## 4. Flows

- `/watch` — poster grid (Amharic title first), "ነፃ · Free" or the rent price, year, runtime. Newest first.
- `/watch/<slug>` — details + player. Free film: plays at once (`POST /api/watch/films/:slug/play` returns the source; views += 1). Paid film: if the browser holds an ACTIVE rental code for that film (localStorage `bw_<slug>`) the play call is made with it and succeeds; otherwise a **rent card** ("48 ሰዓት · 48 hours · 80 ብር"). When Chapa is not live the rent card shows "በቅርቡ · coming soon" and is disabled.
- **Rent** — `POST /api/watch/rent { slug, name, phone, tg? }` creates a PENDING rental and a Chapa checkout (refs `bina-w-…`); return URL `/watch/<slug>?rental=<code>`. `POST /api/watch/rentals/:code/verify` (and the Chapa webhook hook) confirms → ACTIVE with `startsAt=now`, `expiresAt=+rentHours`. Telegram buyers get the link in `@bina_smart_bot`.
- **Play check** — server side, every time: film public, and (free OR rental ACTIVE for that film and `expiresAt > now`). Expired rentals flip to EXPIRED lazily on the next check. The source URL for a paid film is only ever returned by the play call, never in the page HTML.
- **Player** — youtube: `youtube-nocookie.com/embed/<id>` iframe; mp4: `<video controls playsinline>`; hls: hls.js from cdnjs (Safari native). Poster shown before play.
- **Ops** (`/ops/watch`, owner key) — create/edit films, set price, rights note, status; list rentals. A film cannot be set public without a rights note (400).

## 5. Rules

- Rights first: no rights note, not public. Ops sees a red "no rights" badge.
- Price and rental window come from the Film row; the client's numbers are never used.
- Chapa gate identical to tickets: rent only when a Chapa key is configured; `CHAPA_MODE=live` for real money; rent card is disabled otherwise, with the "coming soon" label.
- No video bytes through bina.et. Ever.

## 6. Pages, look

Same light Amharic-first system as /cinema (`/static/cinema/ui.css`). `/cinema` header gets "ይመልከቱ · Watch". Share cards per film use the poster (og:image = posterUrl).

## 7. Tests

Visibility rule (draft / no rights / rights expired / public); play: free ok, paid without rental 402, with ACTIVE rental ok, expired → 402 + EXPIRED; rent: gated when Chapa off, PENDING → verify → ACTIVE with the 48 h window; ops: public without rights refused. Pages served.

## 8. Rollout

Mounted with `CINEMA_ENABLED=1` (same flag). Demo film: a Creative Commons short (Big Buck Bunny, mp4) marked clearly as a demo — never a real film without a licence. Real films are added by Ibrahim on `/ops/watch` with the rights note.
