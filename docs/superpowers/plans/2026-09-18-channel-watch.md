# The daily channel watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every morning at 02:00 the server reads fifteen Ethiopian government Telegram channels, six outlet channels and five RSS feeds through public web previews, keeps the few items that matter, writes each as a dated document under a new knowledge source `watch` whose every sentence says who announced it and when, fetches the PDF behind it when there is one, and sends Ibrahim one Telegram note — only on the days there is something to say. By the end of the plan, Bini answers "what changed this week for the customs office" from a document dated yesterday, and still answers "what is the work-permit fee" from Regulation 394/2016.

**Architecture:** One new directory `ops/watch/channels/` (the existing `ops/watch/` holds BinaWatch's film checker and is not touched), one new knowledge source `watch` with its documents in `knowledge/watch/`, one cron line at 02:00 and one at 02:10. No new pm2 process, no new npm dependency, no Prisma change. The harvest writes documents only; the existing **03:30 daily `knowledge/ingest.js`** indexes them ninety minutes later. The design is `docs/superpowers/specs/2026-09-18-channel-watch-design.md`.

**Tech stack:** Node 20 on the live VPS (`31.97.176.180`, `/var/www/connectcare/binasmart`), `node:test` (`npm test` = `node --test`), pm2 `binasmart-api` on 127.0.0.1:4210. Gemini `gemini-2.5-flash` for ambiguous items only, through the same key `knowledge/index.js` already uses.

**Tasks that need Ibrahim first:**

| Task | What he must decide or do first |
|---|---|
| 1 | Whether `@ethiopian_airlines` is the airline's real channel. It is **not** linked from `ethiopianairlines.com`; every other office handle in the registry is evidenced by the office's own site footer. Until he says yes it ships as `verified: false` and is not read. |
| 5 | Whether Gemini may see public Telegram post text at all (design §5.4). If no, the task still ships with `WATCH_NO_MODEL=1` as the default and the 27 % of items the rules cannot settle go into the note as questions. |
| 11 | The wording of the daily note and the two reply words (`pull N`, `drop N`). |
| 14 | The cron install, and the decision that the **first real morning is the proof** — there is no test send. |

---

## What was measured before this plan was written

All on 18 September 2026, from the server and from a laptop in the UAE. Nothing from memory.

**The crawl.** `knowledge/sources-am.json` has 31 entries, 19 `crawl: true`, four of them news hosts (`ena` 60 pages, `reporter` 60, `fana` 40, `ebc` 40; `press` is off — its home page is a JavaScript app with 42 characters of text). `knowledge/web/` holds **554 files across 13 hosts**, of which **260 (47 %) are the four news hosts** — ena 93, reporter 67, fana 50, ebc 50. It runs **Sundays at 04:00**; `last-run.txt` says `2026-09-13T04:49:39Z`, and on that run thirteen government hosts returned 0 pages. `knowledge/crawl.js:70` writes front matter `url, title, source_name, lang, fetched` — **no publication date**, `fetched` being the crawl day — and truncates the body at 20,000 characters. The first Fana document on disk is a political item about the Prime Minister and President Putin, dated `fetched: 2026-09-13`.

**Telegram, without an account.** 109 handles probed in two paced passes over `https://t.me/s/<handle>` (5 s apart, BinaSmart UA, keep-alive). **A handle that does not exist returns HTTP 200 with a ~9.7 KB body and zero message bubbles** — liveness is a channel title plus one dated bubble, never a status code. Fifteen office channels and six outlet channels are live and reachable **from both the VPS and the laptop**. Five handles are impostors or unrelated and are blacklisted by name, including `@addisstandard` ("Addis not Standard") and `@EthiopianAirlinesOfficial` (a vacancies board). Six offices have **no** usable channel: Ministry of Revenue, EIC, Ministry of Justice, INSA/Fayda, POESSA and the Addis Ababa city administration centrally. Handles for NBE, MoLS, ethio telecom, telebirr, Safaricom and eTrade were found **in the offices' own site HTML** in `/root/storage/packs/*-manual/`.

**Feeds.** RSS exists only for Fana (Amharic and English), The Reporter (Amharic and English) and Addis Fortune (weekly). EBC and ENA return 404 or time out; press.et returns the same 6,442-byte SPA shell on every feed path and is unreachable from the laptop; **Capital and Addis Standard return 403 from the VPS and from the laptop** — for those five, the Telegram preview is the only route that works.

**Thirty items, hand-classified** (every item from Fana's channel and ethio telecom's channel, 16–18 September): **3 pack-grade (10 %)**, 3 perishable tariff/offer, 2 weak, **22 excluded (73 %)**, and **0 linking a document**. The exclusions: 5 regional PR, 3 politics/conflict/diplomacy, 3 culture/holiday, 2 sport, 2 advertorial, 2 bare video links, 2 live-stream markers, 3 promotions.

**Where the yield really is.** NBE's channel, all 16 posts over 32 days: **9 pack-grade** — eight foreign-exchange auction notices and results, and one public awareness notice on illegal hawala — **0.28 a day, and every one is a 41–79-character title whose substance is an image or PDF on `nbe.gov.et`.** Customs, all 8 posts over 14 months: one pack-grade item, the best in the survey — on 17 September the commission announced every branch would serve until 19:00 from Meskerem 7 to Meskerem 30, 2019 EC. It never appeared on `ecc.gov.et` (which timed out and crawled 0 pages), and **it expires on 10 October 2026**.

**The pattern to copy, not invent.** `/root/storage/scripts/bina_news_candidates.py` (cron 06:30 daily) already does keyword categories, a `POLITICS` exclusion list, an md5-of-title seen set and one Telegram message **only when there are items**; its log shows 0–4 new stories a day. `ops/packs/freshness.js:37` `sendTgReal` is the operational-note path (same bot as `ops/health/weekly-audit.js`, chats `BINASMART_ADMIN_TG_CHAT` + `BINASMART_OPS_TG_CHAT`), and its own comment carries the standing rule: one note, only when something changed.

**The code this plan reuses, as it stands:**

- `knowledge/index.js:561` `OWN_SOURCES = new Set(['guide','page','addis','skill','llms','docs'])`; `hybridScore` at `:566` gives those `+0.06`. `search(q, { k, sources, exclude, prefer, rerankTo, isPublic })` at `:1047`; `pageMatcher` at `:519` accepts a whole source, `source:slug`, or a prefix.
- `knowledge/index.js:625` `PACK_SOURCES = [['law','am'],['health','am'],['eservices','en'],['mor','am'],['travel','en'],['banking','en'],['business','am']]` — packs are read **whole**; `knowledge/web/*` is truncated at 20,000 chars (`:335`).
- Front matter is parsed line by line with `/^(\w+):\s*"?(.*?)"?\s*$/` (`ops/packs/fetch-pack.js:218`), so **every key must be a bare word** — `reported_by`, `reported_at`, `expires_at` are fine, hyphens are not.
- `knowledge/index.js:300` drops a document whose `status` is not live; `:604` `sourceLine` prints `Source: <publisher> — <url> — fetched YYYY-MM-DD`, Amharic `ምንጭ፦`.
- `ops/packs/fetch-pack.js --pack <name> --from-dir <dir>` is the local-harvest route (`:790`, usage at `:1206`); `packDir` refuses a pack name that is not `^[a-z][a-z0-9-]{1,30}$`.
- `assistant/dating.js` already makes Bini speak a date once per message; `knowledge/amharic-style.md` line 21 requires እ.ኤ.አ. before a Gregorian date, and line 126 is the politics refusal.

---

## Conventions for every task

1. **This is the live server.** Every command is `ssh root@31.97.176.180 "<command>"`, run in `/var/www/connectcare/binasmart` unless it says otherwise.
2. **The coordinator's shell is PowerShell; the Bash tool is broken.** The whole remote command goes inside one pair of double quotes. **No here-documents, no apostrophes, no `$`, no Ethiopic characters inside an ssh string, ever.** Anything longer is written locally, base64-encoded and passed as a single `echo <b64> | base64 -d > <path>` argument (`scp` times out).
3. **Patch, never bulk-copy.** Before editing an existing file: `cp <file> <file>.bak-watch-<stamp>`.
4. **TDD with `node:test`.** Failing test first, watch it fail for the right reason, smallest implementation, `npm test` green before the commit.
5. **Stage by name, commit with `git commit -F <file>`**, never `git add -A`. If `index.lock` exists, wait 20 s and retry. Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
6. **Never touch** `server.js`, `public/agent-chat.js`, `auth.mjs`, `prisma/schema.prisma`, `public/*.html`, or `ops/watch/check-films.js` and its siblings.
7. **The repo is public.** No key, no token, no full Ethiopian mobile number in any committed file. `sources-am.json` stays gitignored; the new registry carries no secrets.
8. **Never print `.env`, a token, or raw `pm2 jlist`.** Check a secret exists with `grep -c '^GEMINI_API_KEY=' .env`.
9. **No Telegram send before Task 11, and no test send ever.** The first real morning with a real item is the proof.
10. **No Telegram account, bot token or MTProto client is used to read a channel.** Public `t.me/s/` previews only. A task that finds itself needing a login has found a source we do not use.
11. **Pacing:** 5 s between requests to `t.me`, 5 s per feed host, 4 s between Gemini classification calls.
12. **Verify the thing, not a proxy.** A 200 from `t.me/s/<handle>` proves nothing — 109 non-existent handles returned 200. Assert a channel title and a dated bubble. A green cron line is not a working watch: read the documents it wrote.
13. **No ingest is run by the watch.** The 03:30 daily ingest picks the documents up.

---

## Tasks

### Task 1: The registry

- [ ] Write `ops/watch/channels/registry.json`: for each source, `id`, `office`, `kind` (`office` | `outlet`), `handle` or `feed`, `name`, `evidence` (how we know it is official), `verified` (bool), `lang`, `pack` (the pack it feeds, or null), `active`.
- [ ] Seed it from the design's §2.1, §2.3 and §3 tables — fifteen office channels, six outlet channels, five feeds. `@etrade_gov_et` ships `active: false, note: "dormant since 2025-01-23"`. `@ethiopian_airlines` ships `verified: false` pending Ibrahim.
- [ ] Add a `blacklist` array naming `@addisstandard`, `@EthiopianAirlinesOfficial`, `@ethiopian_reporter`, `@EthiopianNewsAgency`, `@ethiopianbroadcastingcorporation`, each with what it actually is, so no later helper re-adds them.
- [ ] Record the six offices with **no** channel (MoR, EIC, MoJ, INSA/Fayda, POESSA, AA central) in an `uncovered` array with the handle counts tried — these are the ones the outlet net exists for.
- [ ] Test: every active entry has non-empty `evidence`; no active handle appears in `blacklist`; every `pack` names a real directory under `knowledge/`.

### Task 2: The preview reader

- [ ] Save two fixtures under `test/fixtures/watch/`: one real `t.me/s/` page with bubbles, one 9.7 KB non-existent-handle page. Strip nothing.
- [ ] `ops/watch/channels/preview.js` — a pure function from HTML to `{ title, live, posts: [{ id, at, text, links, lang }] }`. No network in this module.
- [ ] Test first: the non-existent-handle fixture must return `live: false`, **not** `posts: []` with `live: true`. This is the trap the survey found and the one that will silently blind the watch.
- [ ] Test: the real fixture yields the right count, ISO datetimes, Amharic detection, and links with `t.me`/`telegram.org` stripped.

### Task 3: The feed reader

- [ ] `ops/watch/channels/feeds.js` — RSS to the same item shape, `reported_at` from `pubDate`.
- [ ] Fixtures for Fana Amharic, Fana English, Reporter Amharic, Reporter English, Addis Fortune.
- [ ] Test: a 403 body and a 6,442-byte SPA shell both return "not a feed", never an empty success. (Capital, Addis Standard and press.et all do exactly this.)

### Task 4: The classifier, rules half

- [ ] `ops/watch/channels/classify.js` — stage 1 exclusions and stage 2 office/directive rules, no network, no model.
- [ ] Port the `POLITICS` list from `bina_news_candidates.py` and extend it with elections, ethnicity, rumour and opinion markers in Amharic and English. Add sport, holiday greeting, live-stream marker, advertorial and "under 60 characters with no link".
- [ ] Fixture: **the 30 classified items from the design §4, with their hand labels**, plus NBE's 16 and Customs' 8. This is the plan's regression set and it is real data.
- [ ] Test: the rules reproduce the hand labels for at least the 22 exclusions and the 3 pack-grade items; the customs opening-hours item and all nine NBE notices are admitted; the Siinqee Bank advertorial and the TPLF item are refused.

### Task 5: The classifier, model half

- [ ] Stage 3: one `gemini-2.5-flash` call per item the rules did not settle, 4 s apart, returning one of `pack-grade` / `perishable` / `excluded` plus an office.
- [ ] The prompt carries **the post text and nothing else** — never a user question, never a log line.
- [ ] `WATCH_NO_MODEL=1` short-circuits stage 3 entirely; an unsettled item is then queued for the note as a question, never guessed.
- [ ] Fail-closed: a timeout, an error or an unparseable answer queues the item, it does not admit it.
- [ ] Test with the model stubbed. Assert the pacing, the short-circuit, and that a stub throwing does not admit anything.

### Task 6: The document writer

- [ ] `ops/watch/channels/write.js` — one item to one `knowledge/watch/YYYY-MM-DD-<office>-<hash8>.md`.
- [ ] Front matter exactly as design §5.5: `url, title, source_name, office, reported_by, channel, reported_at, lang, status, expires_at, fetchedAt, lastChecked` — every key a bare word so `/^(\w+):\s*"?(.*?)"?\s*$/` reads it.
- [ ] The body's first sentence is the fixed provenance sentence, in the item's own language: *On <date>, <office> announced …, as reported by <outlet> (<channel>).* Never "the law is", never "the rule is".
- [ ] Test: the written file round-trips through the same front-matter regex `knowledge/index.js` uses; the first sentence names the office, the date and the channel; no document is written without `reported_at`.

### Task 7: `watch` as a knowledge source

- [ ] Register `watch` in `knowledge/index.js` as a directory source read **whole** (a watch item is short; there is nothing to truncate) and **deliberately absent from `OWN_SOURCES`**, so it never gets the `+0.06` boost.
- [ ] Honour `status: superseded` and `expires_at` the way `status: gone` is already honoured at `:300`.
- [ ] Test: a document with `expires_at` in the past is not returned; one marked superseded is not returned; a live one is, with a `Source:` line carrying `reported_at`.
- [ ] Do not change `hybridScore`, the reranker or `pageMatcher`.

### Task 8: Ranking

- [ ] `ops/watch/channels/recency.js` — does this question carry a recency marker (*new, latest, this week, today, changed, updated, አዲስ, ዛሬ, በዚህ ሳምንት, ተቀየረ, ተሻሽሏል*)?
- [ ] Government agent and Bini list `watch` in `exclude` by default; on a recency match the ask path drops that exclusion and passes `prefer: ['watch']`.
- [ ] Test both directions on the live index: "what is the work-permit fee" must **not** return a watch page; "what changed for work permits this month" may.

### Task 9: Document fetch

- [ ] When an admitted item links a PDF or a page on a `.gov.et` or office host, fetch it with the pack fetcher's UA and 5 s delay into `/root/storage/packs/watch-manual/<host>/`.
- [ ] On failure write the watch document anyway with `pending_document: "yes"` and name it in the note. `mols`, `ecc`, `mint`, `fsc`, `egov`, `esl`, `daro` and `eeu` all time out from this VPS today, so this path will fire.
- [ ] Hand-off is `node ops/packs/fetch-pack.js --pack <pack> --from-dir /root/storage/packs/watch-manual`. **The watch never writes into a pack directory itself.**
- [ ] Test with a stubbed fetcher: a success writes to the harvest directory and not to the pack; a timeout sets `pending_document` and still writes the document.

### Task 10: The pack re-fetch trigger

- [ ] An admitted item with a directive word naming a pack-owning office appends to `/root/storage/packs/<pack>-refetch.json`.
- [ ] `ops/packs/freshness.js` reads and clears that file at the top of its run. **Guard the edit:** another session has been editing `ops/packs/*`; if `git diff --stat ops/packs/freshness.js` is not empty, stop and ask.
- [ ] A second cron line at **02:10** runs `ops/packs/freshness.js --pack <pack>` for the named packs only, so the Sunday 05:00/06:00/07:00 runs are untouched and no two fetchers overlap.
- [ ] Test: a directive item for NBE writes the banking trigger; a promotional item writes nothing; an empty trigger file causes no run.

### Task 11: The daily note

- [ ] `ops/watch/channels/note.js` — build one message: the date, then per item the office, one line, the `t.me` link, numbered; then the failed fetches; then the unsettled questions.
- [ ] Send through `sendTgReal` from `ops/packs/freshness.js` — same bot, same admin chats. No new bot, no new token.
- [ ] **Send nothing at all when nothing was written and nothing failed.**
- [ ] `pull N` and `drop N` are read by the existing owner-Bini Telegram path; `pull N` queues that item's document for the next run, `drop N` blacklists it.
- [ ] Test with the sender stubbed: an empty day sends zero messages; a day with two items and one failure sends exactly one.

### Task 12: Retention

- [ ] `expires_at` defaults to `reported_at + 90 days`; an item naming its own end date takes that date (the customs item ends 2026-10-10, and the parser must read both the Gregorian and the Ethiopian form).
- [ ] A nightly sweep in the same script marks what is past and marks an item superseded when a pack or `law` document now covers it, recording `superseded_by`.
- [ ] Nothing is deleted from disk. The record of what was announced survives even when it stops being served.
- [ ] Test: the customs fixture expires on the right day; a superseded item keeps its file and leaves the index.

### Task 13: The eval

- [ ] `ops/watch/channels/gold.json` — about twelve "what changed this week for X" questions, half Amharic, half English, drawn from the real items in the §4 audits (customs hours, the hawala notice, the FX auction, Fayda card printing).
- [ ] Each question is scored **twice**: with the recency marker the gold page is the watch document; with the marker removed the gold page is the **curated** document.
- [ ] `ops/watch/channels/eval.js` reports both, and the build fails if the second half regresses. A watch item that outranks the law on a "what is the rule" question is the failure this eval exists to catch.
- [ ] 6 s pacing between questions if the run touches Gemini.

### Task 14: Cron, dry run, and the first real morning

- [ ] `ops/watch/channels/run.js --dry-run` does the whole harvest, classification and document rendering and **writes, ingests and sends nothing**. Run it and read its output by hand: how many raw items, how many admitted, which offices, which documents it would have written.
- [ ] Compare the dry run against the design's expectations (roughly 60 raw items, 6–10 admitted, 6–10 model calls). A wild divergence is a bug in the rules, not a new normal.
- [ ] Install the two cron lines only after Ibrahim's yes:
  - `0 2 * * * cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/watch/channels/run.js >> /var/log/bina-channel-watch.log 2>&1`
  - `10 2 * * * cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/watch/channels/refetch.js >> /var/log/bina-channel-watch.log 2>&1`
- [ ] Confirm nothing else runs at 02:00 or 02:10 (`crontab -l`), and that 03:00, 03:30 and the Sunday 04:00–07:00 slots are untouched.
- [ ] **The proof is the first real morning**: read `/var/log/bina-channel-watch.log`, read the documents in `knowledge/watch/`, confirm the 03:30 ingest picked them up (`/var/log/bina-knowledge.log`), and ask Bini a "what changed" question through the live API and read the answer's source line. Not a 200, not an exit code.

### Task 15: Report

- [ ] Write `docs/superpowers/notes/2026-09-<dd>-channel-watch-first-week.md`: seven days of counts per source, admitted vs excluded, documents fetched vs pending, the eval's two halves, and every source that went quiet or changed handle.
- [ ] Update the registry from what the week actually showed — a channel that posted nothing in seven days is a candidate for `active: false`, and a new handle found in an office's footer is a candidate for the opposite.
