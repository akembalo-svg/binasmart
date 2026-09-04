# BinaSmart Watch (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/watch` lists licensed Amharic films whose video lives elsewhere; free films play at once, paid films are rented for 48 hours via Chapa once live.

**Architecture:** One module `watch/index.js` (`registerWatch(fastify, deps)`) mounted next to the cinema module, with the visibility and play-access rules in `watch/rules.js` (pure, tested). Two static pages (`watch.html` for grid + player, `ops-watch.html`), reusing `/static/cinema/ui.css`. Chapa via the same `deps.chapa` object the cinema module gets; refs `bina-w-…` are confirmed by the shared webhook hook.

**Tech Stack:** as Phase A. hls.js from cdnjs for `.m3u8` sources.

**Spec:** `docs/superpowers/specs/2026-09-04-binasmart-watch-design.md`

---

### Task 1: Schema (`Film`, `Rental`)
- [ ] Append the two models from spec §3 to `prisma/schema.prisma`; `npx prisma db push && npx prisma generate`.
- [ ] Test `test/watch/schema.test.js`: models exist, `Rental.code @unique`, `Film.status @default("draft")`, `Film.rentHours @default(48)`.

### Task 2: `watch/rules.js` (pure)
- [ ] Tests `test/watch/rules.test.js`: `isPublic(film, now)` — draft → false; public without rights → false; rights expired → false; public + rights → true. `canPlay(film, rental, now)` → `{ ok:true }` for free; `{ ok:false, error:'rent' }` paid without rental; ok with ACTIVE unexpired rental of that film; `{ ok:false, error:'expired' }` when past `expiresAt`; `{ ok:false, error:'rent' }` for a rental of another film. `embedFor(film)` → youtube id extraction from full URL / short URL / bare id → `{ kind:'youtube', id }`; mp4/hls → `{ kind, url }`.
- [ ] Implement.

### Task 3: `watch/index.js` routes
- [ ] Tests `test/watch/routes.test.js` (Fastify inject, fake Prisma as in cinema tests): list shows only public+rights films; film page 404 for draft; play free → source + views 1; play paid w/o rental → 402 `rent` with price; rent with Chapa off → 409 `chapa_off`; rent with Chapa on → PENDING + checkoutUrl; verify → ACTIVE, `expiresAt - startsAt === 48h`; play with that code → source; expired → 402 `expired` and status EXPIRED; ops: 401 without key; create; public without rights → 400; pages served.
- [ ] Implement endpoints: `GET /watch`, `/watch/:slug` (shell with per-film title/og), `GET /api/watch/films`, `GET /api/watch/films/:slug`, `POST /api/watch/films/:slug/play {rental?}`, `POST /api/watch/rent`, `GET /api/watch/rentals/:code`, `POST /api/watch/rentals/:code/verify`, ops `GET/POST /api/watch/ops/films`, `POST /api/watch/ops/films/:slug` (update), `GET /api/watch/ops/rentals`, page `/ops/watch`. Export `confirmChapa(ref)`.
- [ ] Mount in `server.js` after the cinema module with the same deps; add `bina-w-` to the webhook hook; sitemap `/watch` + public film slugs.

### Task 4: Pages
- [ ] `public/watch.html` + `public/watch/app.js`: grid; player page with poster → play; rent card; rental code kept in `localStorage bw_<slug>`; `?rental=<code>` on return from Chapa triggers verify then play.
- [ ] `public/ops-watch.html`: film form (all fields, rights note, status), film table, rentals table.
- [ ] `/cinema` header link "ይመልከቱ · Watch"; `/watch` header links back.

### Task 5: Demo, docs, deploy
- [ ] `ops/watch/demo.js` seeds one CC demo film (Big Buck Bunny mp4, rights note "Creative Commons BY 3.0 — Blender Foundation", free) and one paid draft example; `--clean` removes them.
- [ ] README section; `npm test` green; curl checks; commit; push.
