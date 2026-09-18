# The daily channel watch — design

**Date:** 18 September 2026
**Problem:** Ethiopian government offices rarely edit their websites. When something changes — a counter's opening hours, a foreign-exchange auction, a public warning about unlicensed hawala — it is announced on the office's Telegram channel and carried by Fana, EBC, ENA, press.et and the newspapers, and it may never reach the office's own site at all. BinaSmart's crawl runs once a week and writes no publication date, so Bini learns today's announcement up to seven days late and cannot tell it from a 2024 archive page.
**What this design decides:** which sources to read, when, how to tell a directive from a football fixture, how to write the item down so that it can never be mistaken for the law, and when to stop believing it.

Everything in §1–§3 was measured on 18 September 2026, from the VPS (`31.97.176.180`) and, where the VPS failed, from a laptop in the UAE. Nothing is from memory.

---

## 1. What the crawl already covers, and where it stops

`knowledge/sources-am.json` (gitignored, 14,701 bytes) holds 31 entries, 19 of them `crawl: true`. Four are news hosts:

| id | url | crawl | maxPages | pages on disk |
|---|---|---|---:|---:|
| `ena` | `https://www.ena.et/web/amh/` | true | 60 | 93 |
| `reporter` | `https://www.ethiopianreporter.com/` | true | 60 | 67 |
| `fana` | `https://www.fanamc.com/` | true | 40 | 50 |
| `ebc` | `https://www.ebc.et/` | true | 40 | 50 |
| `press` | `https://www.press.et/` | **false** | 60 | 0 |

`press` is off with the note "home is a JavaScript app (42 chars of text)". `knowledge/web/` holds **554 files across 13 host directories**; the four news hosts are **260 of them, 47 %**. The survey note of the same day (`docs/superpowers/notes/2026-09-18-government-api-survey.md` §1.2) counts the `web` source at **494 documents / 2,886 chunks**, truncated at 20,000 characters and boilerplate-stripped.

**Cadence.** `0 4 * * 0 knowledge/crawl.js && knowledge/ingest.js --source web`. `knowledge/web/last-run.txt` says the last crawl finished `2026-09-13T04:49:39Z`. On that run ten of the twenty-seven sites returned **0 pages** (`mor`, `ecc`, `mols`, `mint`, `ics`, `aacity`, `fsc`, `daro`, `egov`, `chamber`, `esl`, `ffic`, `eeu`) — the government hosts, which time out from this VPS.

**The dating gap.** `knowledge/crawl.js:70` writes exactly this front matter:

```
url, title, source_name, lang, fetched
```

`fetched` is `new Date().toISOString().slice(0,10)` — **the day we crawled, not the day the article was published.** There is no publication date anywhere in a crawled news document. A sample from disk:

```
url: "https://www.fanamc.com/archives/322502"
title: "ጠቅላይ ሚኒስትር ዐቢይ (ዶ/ር) ከፕሬዚዳንት ፑቲን ጋር ተወያዩ …"
lang: am
fetched: 2026-09-13
```

Two things are wrong with that document and both matter here. It is undated news presented with a fetch date, and it is a **political** item — the thing the Amharic writer rules (`knowledge/amharic-style.md`, the ፖለቲካ example at line 126) tell Bini to decline. The weekly crawl pulls politics into the index by the hundred and dates none of it.

**What already runs daily.** There is a working pattern to copy, not invent:

| time | job | what it is |
|---|---|---|
| 03:00 | `ops/watch/check-films.js` | BinaWatch film checker (unrelated to this design; the name `ops/watch/` is already taken by it) |
| 03:30 | `knowledge/ingest.js` | **daily, all sources** |
| 04:00 Sun | `knowledge/crawl.js` + `ingest --source web` | the weekly crawl |
| 05:00 Sun | `ops/travel/freshness.js` | airline |
| 06:00 Sun | `ops/packs/freshness.js --pack banking` | banking |
| 07:00 Sun | `ops/packs/freshness.js --pack business` | business |
| 06:00 | `bina_tender_reminders.js` | tender sweep |
| 06:15 | `bina_tender_candidates.py` | tender digest |
| 06:30 | `bina_news_candidates.py` | **the daily news digest** |
| 07:00, 15:00 | `bina_tender_autopublish.py` | tender autopublish |

`/root/storage/scripts/bina_news_candidates.py` is the closest prior art. It pulls Fana English RSS, Capital RSS and Reporter HTML, categorises by keyword into Banking / Construction / Technology, drops anything matching a `POLITICS` list, dedupes on an md5 of the first 80 characters of the title, and sends **one** Telegram message **only when there are items**. Its measured yield, from the last eighteen runs in `/var/log/bina-news-digest.log`: `0 0 3 1 0 4 0 3 1 1 1 0 2 1 1 3` — **0 to 4 stories a day**. Its purpose is different (Ibrahim picks stories to publish as BinaSmart articles); the machinery is right.

The Telegram path for operational notes is `sendTgReal` in `ops/packs/freshness.js:37`: the bot token from `BINA_RIDER_BOT_TOKEN` / `BINASMART_TG_TOKEN`, sent to the de-duplicated set of `BINASMART_ADMIN_TG_CHAT` and `BINASMART_OPS_TG_CHAT`, with the standing rule written into its own comment — *"one note, and only when something changed or vanished. An alert that arrives every week is an alert nobody reads."*

---

## 2. Telegram channels, measured without an account

Every channel below was read through the **public web preview** `https://t.me/s/<handle>` — no Telegram account, no bot token, no MTProto client. 109 candidate handles were tried in two paced passes (5 s between requests, BinaSmart user agent, keep-alive).

**A trap worth naming first.** A handle that does not exist answers **HTTP 200** with a 9,550–9,900-byte page and zero message bubbles. Status code is not reachability. A channel counts as live only when the preview yields **a channel title and at least one dated bubble**.

### 2.1 Offices — live and official

"Evidence" is how we know it is the office's own channel. *site footer* means the handle appears in the office's own HTML in the manual harvests under `/root/storage/packs/*-manual/<host>/`.

| Office | Handle | Official — evidence | VPS | Laptop | Posts/day (window) | Lang | Links to documents |
|---|---|---|---|---|---|---|---|
| Ministry of Labour and Skills | `@FDRE_MoLSofficial` | **site footer**, `mols.gov.et` (186 hits) | 200, 20 posts | 200 | **0.5** (1 Aug – 10 Sep) | am 95 % | 15/20 link `mols.gov.et`; 0 PDF |
| National Bank of Ethiopia | `@nbethiopia` | **site footer**, `nbe.gov.et` (721 hits) | 200, 16 | 200 | **0.5** (10 Aug – 11 Sep) | en 94 % | 1/16; notices are images, document lives on `nbe.gov.et` |
| ethio telecom | `@ethio_telecom` | **site footer**, `ethiotelecom.et` | 200, 20 | 200 | **4.0** (13–18 Sep) | am 80 % | 13/20, incl. `fixedservices.ethiotelecom.et` |
| telebirr | `@telebirr` | **site footer**, `ethiotelecom.et` (76 hits) | 200, 20 | 200 | **4.0** (13–18 Sep) | am 100 % | 15/20, shorteners |
| Safaricom Ethiopia | `@Safaricom_Ethiopia_PLC` | **site footer**, `safaricom.et` | 200, 20 | 200 | **2.0** (8–18 Sep) | am 100 % | **0/20** |
| Ethiopian Customs Commission | `@EthiopianCustomsCommission` | title + posts link `ecc.gov.et` and `facebook.com/ecczena` | 200, 8 | 200 | **0.02** (31 Jul 2025 – 18 Sep 2026) | am 88 % | 6/8 link `ecc.gov.et` |
| EFDA | `@ethiopianfoodanddrugauthority` | handle present in `knowledge/` from EFDA's own pages | 200, 3 | 200 | **1.5** (17–18 Sep) | am 67 % | 0/3 |
| Ministry of Health | `@M0H_EThiopia` | title "Ministry of Health ET"; promoted by the ministry's own X account `@FMoHealth` | 200, 9 | 200 | **1.0** (9–18 Sep) | am 100 % | **9/9** |
| Ministry of Education | `@ethio_moe` | title "Ministry of Education Ethiopia" | 200, 9 | 200 | **2.2** (14–18 Sep) | am 89 % | 6/9 |
| AA Land Development & Administration Bureau | `@AddisLand` | title matches the bureau | 200, 7 | 200 | **2.3** (14–17 Sep) | am 57 % | 0/7 |
| AA Design & Construction Works Bureau | `@AddisCityCon` | title matches | 200, 5 | 200 | **1.7** (15–18 Sep) | am 80 % | 0/5 |
| AA Education Bureau | `@wwwAddisAbabaeducationbureau` | title matches | 200, 5 | 200 | **3.3** (17–18 Sep) | am 100 % | 4/5 |
| AA Bureau of Justice | `@AAbureauofattorney` | title matches | 200, 15 | 200 | **0.17** (18 Jun – 15 Sep) | en 87 % | 6/15 |
| Ethiopian Airlines | `@ethiopian_airlines` | title "Ethiopian Airlines የኢትዮጵያ አየር መንገድ" — **not** linked from `ethiopianairlines.com`; treat as probable, verify before trusting | 200, 20 | 200 | **1.0** (28 Aug – 17 Sep) | am 100 % | 15/20 |
| MoTRI eTrade portal | `@etrade_gov_et` | **site footer**, `etrade.gov.et` | 200, 20 | 200 | **DORMANT** — last post 23 Jan 2025 | am 95 % | 10/20 |

### 2.2 Offices with no usable channel

Every one of these was searched for and probed; the count is how many handles were tried.

| Office | Handles tried | Result |
|---|---:|---|
| Ministry of Revenue | 8 | none. `@MinistryofRevenues` has 1 post (14 Aug 2026, title "e"); `@ethiopiantax` is a private file-sharing channel |
| Ethiopian Investment Commission | 6 | none. Note separately: the commission's site has **moved to `investinethiopia.gov.et`**; `sources-am.json` still names `investethiopia.gov.et` |
| Ministry of Justice | 6 | none |
| INSA | 5 | none. `@insa_et` / `@INSA_ET` is "Pop", 2 posts, May 2024 |
| Fayda / National ID | 8 | none. `@NationalIDEthiopia` is "CreativeThree"; `@ethiopianid` is "Ethio ID", 1 post, May 2025 |
| POESSA | 5 | none |
| Addis Ababa City Administration (central) | 4 | none — the city publishes **per bureau**, not centrally. (Its website `addisababa.gov.et` is `ENOTFOUND`, per `sources-am.json`.) |
| MoH (old channel) | — | `@MoHEthiopia` dormant since 9 Jun 2024 — the live one is `@M0H_EThiopia` |
| AA Health Bureau | — | `@aacahealthbureau` dormant since 20 Sep 2024 |
| Ethiopian Airlines (old) | — | `@flyethiopian` dormant since 31 Mar 2024 |

### 2.3 Outlets

| Outlet | Handle | Official — evidence | VPS | Laptop | Posts/day (window) | Lang | Links |
|---|---|---|---|---|---|---|---|
| EBC | `@EBCNEWSNOW` | title "EBC (Ethiopian Broadcasting Corporation)" | 200, 20 | 200 | **19.5** (17–18 Sep) | am 100 % | **20/20** |
| Fana (FBC) | `@fanatelevision` | handle present in `knowledge/web/fana` from `fanamc.com` | 200, 19 | 200 | **18.2** (17–18 Sep) | am 89 % | 18/19 to `fanamc.com` |
| Addis Standard | `@AddisstandardEng` | title "Addis Standard" | 200, 20 | 200 | **9.9** (16–18 Sep) | en 100 % | 17/20 |
| Capital | `@capitalethiopia` | title "Capitalethiopia" | 200, 18 | 200 | **8.7** (16–18 Sep) | en 78 % | 13/18 |
| ENA | `@EthiopianNewsA` | title "Ethiopian News Agency" | 200, 14 | 200 | **5.4** (16–18 Sep) | — | 12/14 — **but 11 of 14 are a bare `ena.et` URL with no text at all** |
| The Reporter (English) | `@thereporterethiopia` | title "The Reporter (Ethiopian Reporter English)" | 200, 20 | 200 | **5.2** (14–18 Sep) | en 75 % | 15/20 |
| press.et / Addis Zemen | **none found** | 4 handles tried; `@ethiopianpressagency` has 2 posts from 2019, `@presset` is unrelated | — | — | — | — | — |

### 2.4 Impostors and look-alikes — blacklist these by name

| Handle | What it actually is |
|---|---|
| `@addisstandard` | **"Addis not Standard"** — a satire/impostor channel, 20 posts, last 24 Feb 2026. The real one is `@AddisstandardEng`. |
| `@EthiopianAirlinesOfficial` | "Ethiopian Airlines **Vacancies**" — a job board, 20 posts, very active. Not the airline's newsroom. |
| `@ethiopian_reporter` | "Smart jobs" |
| `@EthiopianNewsAgency` | stale ENA mirror, last post 7 Jul 2022 |
| `@ethiopianbroadcastingcorporation` | 1 post, 2018 |

---

## 3. Feeds

| Outlet | URL | VPS | Laptop | Items | Window | Verdict |
|---|---|---|---|---:|---|---|
| Fana (Amharic) | `https://www.fanamc.com/feed/` | 200, **RSS** | — | 10 | 17–18 Sep | **use** — 10/10 Amharic titles |
| Fana (English) | `https://www.fanamc.com/english/feed/` | 200, **RSS** | — | 10 | 17–18 Sep | **use** (already used by `bina_news_candidates.py`; times out intermittently) |
| The Reporter (Amharic) | `https://www.ethiopianreporter.com/feed/` | 200, **RSS** | — | 10 | 16–18 Sep | **use** |
| The Reporter (English) | `https://www.thereporterethiopia.com/feed/` | 200, **RSS** | — | 10 | 14–18 Sep | **use** |
| Addis Fortune | `https://addisfortune.news/feed/` | 200, **RSS** | — | 12 | 6–13 Sep | **use**, weekly |
| Fana (`/amharic/feed/`) | | 404 | — | — | — | does not exist |
| EBC | `/feed/`, `/rss` | **404** (18-byte body) | — | — | — | **no feed** → Telegram only |
| ENA | `/web/amh/rss` **timeout**; `/rss`, `/feed/` 404 | — | **unreachable** | — | — | **no feed** → Telegram only |
| press.et | `/feed/`, `/rss`, `/Am/feed/` — all return the **same 6,442-byte SPA shell** | 200 but not a feed | **unreachable** | — | — | **no feed, no channel** — press.et is unreachable by every route tested |
| Capital | `/feed/` | 5,176-byte non-feed (soft block) | **403** | — | — | blocked → use `@capitalethiopia` |
| Addis Standard | `/feed/` | **403** | **403** | — | — | blocked both routes → use `@AddisstandardEng` |
| `mols` / `moh` / `mor` `.gov.et` `/feed/` | | 404 / timeout | — | — | — | offices publish no feeds |

**Conclusion:** RSS is available for exactly two outlets in two languages each, plus a weekly. For EBC, ENA, Capital, Addis Standard and every office, the **public Telegram preview is the only route that works** — and it works from both the VPS and the laptop.

---

## 4. Thirty items, classified by hand

Sample: **every item from the two most active text-bearing sources in the three-day window 16–18 September 2026** — Fana's channel (19) and ethio telecom's channel (11). ENA was excluded from the thirty because 11 of its 14 posts carry no text at all, which is itself a finding.

| Verdict | Fana (19) | ethio telecom (11) | Total | Share |
|---|---:|---:|---:|---:|
| **Pack-grade** — a fact a pack would want | 0 | **3** | **3** | **10 %** |
| Tariff / offer — true but perishable | 0 | 3 | 3 | 10 % |
| Weak — office-adjacent, no directive | 2 | 0 | 2 | 7 % |
| **Excluded by rule** | 17 | 5 | **22** | **73 %** |
| **Items linking a PDF or a new directive** | **0** | **0** | **0** | **0 %** |

**The three pack-grade items, all from ethio telecom:** Fayda card printing ordered through the telebirr SuperApp (ID / eservices); fraud reports to shortcode **9090** (consumer protection); the `fixedservices.ethiotelecom.et` self-service portal for fixed line and WiFi.

**The 22 exclusions, by reason:** regional-government PR 5; politics / conflict / diplomacy 3 (300 TPLF fighters surrendering; a Chinese diplomat on BRICS; elders and clergy "for peace"); culture and holiday greetings 3; sport 2; **advertorial 2** (a Siinqee Bank interest-free banking advert carried as a Fana post; an Addis Ababa city development advertorial); bare video links 2; live-stream start/stop markers 2; promotional games and ticket sales 3.

**The two weak ones:** Addis Ababa feeding over 1 million pupils; the Federal Supreme Court on digital courts. Real, but neither is a rule anyone can act on.

### 4.1 Where the yield actually is — two supplementary audits

Thirty items from the loudest sources produced three usable facts and no documents. The quiet office channels are the opposite.

**NBE `@nbethiopia`, all 16 posts, 10 Aug – 11 Sep (32 days):**

| Verdict | Count |
|---|---:|
| **Pack-grade (banking)** | **9** — eight foreign-exchange auction notices and results (Nos. 25, 27, a special auction, 28) and one **PUBLIC AWARENESS NOTICE ON ILLEGAL HAWALA AND UNAUTHORIZED REMITTANCE OPERATORS** |
| Weak | 1 — NBE/IFC mortgage-finance cooperation |
| Excluded | 6 — four governor bilaterals and BRICS, one New Year greeting, one Green Legacy |

**0.28 pack-grade items a day**, and *every one of the nine is a 41–79-character title whose substance is an image or a PDF on `nbe.gov.et`.* The channel tells you a document exists and when; it does not tell you what is in it. This is the document-fetch case, and it is the strongest argument for the watch: the hawala notice answers a question BinaSmart is actually asked.

**Ethiopian Customs `@EthiopianCustomsCommission`, all 8 posts, 31 Jul 2025 – 18 Sep 2026:**

One item is pack-grade, and it is the best single item in the whole survey. On **17 September 2026 (Meskerem 7, 2019 EC)** the commission announced that **every customs branch office, plus Kality, Mojo and Adama, will serve until 1:00 in the evening (19:00), Monday to Friday, from Meskerem 7 to Meskerem 30, 2019 EC.** It is an operational fact a citizen can act on this week; it never appeared on `ecc.gov.et` (which times out from this VPS and crawled 0 pages on 13 September); and **it expires on 10 October 2026.** One item like this a month is worth the whole watch — and it is also the reason retention is not optional.

---

## 5. The design

### 5.1 Sources per office

Two classes, with different jobs.

**Office channels are the signal.** Fifteen live ones (§2.1), of which `@etrade_gov_et` is kept in the registry but marked dormant so nobody re-discovers it. They are quiet — 0.02 to 4 posts a day — and a high share of what they do post is exactly what a pack wants.

**Outlet channels and feeds are the safety net**, and only that. They cover the offices with no channel at all: Ministry of Revenue, EIC, Ministry of Justice, INSA/Fayda, POESSA and the Addis Ababa city administration centrally. An outlet item is admitted only when it **names one of those offices** and passes the directive rule — never on its own merits. §4 is the justification: 19 Fana posts yielded nothing, and the two loudest channels (EBC at 19.5/day, Fana at 18.2/day) would otherwise drown the fifteen office channels by a factor of forty.

So: `@EBCNEWSNOW`, `@fanatelevision`, `@AddisstandardEng`, `@capitalethiopia`, `@EthiopianNewsA`, `@thereporterethiopia`, plus the five RSS feeds — all read, all filtered by office name before anything else.

press.et is **not** in the design. It has no feed, no channel and no reachable site; there is nothing to read.

### 5.2 Transport

`https://t.me/s/<handle>` and nothing else. **No Telegram account, no bot token, no MTProto client.** The preview returns the last ~20 posts with ISO datetimes, text and links, and it answered from both the VPS and the laptop for every live handle. A handle is judged live by **a channel title plus at least one dated bubble**, never by the status code (§2).

### 5.3 When

**02:00 daily**, `ops/watch/channels.js`. It harvests and writes; it does **not** ingest. The existing **03:30 daily `knowledge/ingest.js`** picks the new documents up ninety minutes later, so the watch adds no ingest run and cannot collide with one.

02:00 is free and stays free: 03:00 is BinaWatch's film check, 03:30 the daily ingest, 04:00 Sunday the crawl, 05:00/06:00/07:00 Sunday the three pack fetchers, 06:00–07:00 daily the tender and news digests. The watch finishes long before any of them start.

Pacing: `t.me` is one host, so 5 s between every preview request — 21 channels is about two minutes. Feed hosts get 5 s each. Keep-alive on `.et` hosts, per the banking harvest's finding.

### 5.4 Classification

Three stages, in this order, and the model is last.

1. **Hard exclusions, no model.** The `POLITICS` list already in `bina_news_candidates.py`, extended with elections, ethnicity, rumour and opinion markers; plus sport, holiday greetings, live-stream markers, advertorial markers (`#Sponsored`, a bank or product name with no office named), and any post under 60 characters with no link. This alone settled 22 of the 30 items in §4.
2. **Office and directive rules, no model.** An item is admitted when it names an office in the registry **and** carries a directive word — መመሪያ, አዋጅ, ደንብ, ማስታወቂያ, directive, proclamation, regulation, circular, notice, auction, tariff, fee, deadline, hours — or when it comes from an office channel and links to that office's own host. This is what catches the customs opening-hours item and all nine NBE notices.
3. **Gemini only for what neither rule settled.** One `gemini-2.5-flash` call per unsettled item, **4 s apart**, asking for one of `pack-grade / perishable / excluded` and the office it belongs to.

**Cost.** 22 of 30 settled by rule (73 %). Across roughly 60 raw items a day from all sources, expect **6–10 model calls a day, about 250 a month**, at ~700 input and ~20 output tokens each on the same model the reranker already uses — **well under one US dollar a month**. The classifier is skipped entirely when `WATCH_NO_MODEL=1`, and an unsettled item is then queued for Ibrahim rather than guessed.

**The data-leaves-the-VPS tension, stated plainly.** The standing rule is that BinaSmart data never leaves the VPS — no external AI or voice API. This design sends text to Gemini, so it has to answer for itself. What is sent is a **public Telegram post already published by a government office or a newspaper to tens of thousands of subscribers**, and nothing else: never a user's question, never a log line, never a rider's or a patient's anything. That is not BinaSmart data; it is a press release. The rule's spirit is still kept by two guards — the classifier's prompt is the post text alone, and `WATCH_NO_MODEL=1` turns the model off completely without turning the watch off. If Ibrahim wants the model off permanently, the rules alone handle 73 % and the rest reach him as a question.

### 5.5 The write — provenance first

A relevant item becomes **one dated document** under a new source **`watch`**, in `knowledge/watch/`, named `YYYY-MM-DD-<office>-<hash8>.md`.

Not into `news`: `news` is BinaSmart's *own* articles, read from the `posts` table by `readNewsSources` (`knowledge/index.js:164`). A ministry's announcement is not ours and must not borrow our byline. A new source also means the ranking rule in §5.7 can be written about it without touching anything else.

Front matter — `knowledge/index.js` parses it line by line with `/^(\w+):\s*"?(.*?)"?\s*$/`, so every key is a bare word:

```
url: "https://t.me/EthiopianCustomsCommission/412"
title: "Customs branch offices to serve until 19:00 to 10 October 2026"
source_name: "Ethiopian Customs Commission"
office: "ecc"
reported_by: "Ethiopian Customs Commission"
channel: "@EthiopianCustomsCommission"
reported_at: "2026-09-17"
lang: am
status: "live"
expires_at: "2026-10-10"
fetchedAt: "2026-09-18"
lastChecked: "2026-09-18"
```

The body's **first sentence is fixed**, in the document's own language:

> On 17 September 2026, the Ethiopian Customs Commission announced that branch offices will serve until 19:00 from Meskerem 7 to Meskerem 30, 2019 EC, as reported by its official Telegram channel @EthiopianCustomsCommission.

Never "the rule is", never "the law says". The sentence names **who announced it, when, and where it was reported** — so that even quoted out of context it cannot be read as statute. Two existing mechanisms then finish the job without new code: `sourceLine` (`knowledge/index.js:604`) prints `Source: <publisher> — <url> — fetched YYYY-MM-DD` under the page, and the dating rule (`assistant/dating.js`) already makes Bini speak a date on every message — which for a watch item is `reported_at`, marked እ.ኤ.አ. as `knowledge/amharic-style.md` line 21 requires.

### 5.6 Document fetch

When an admitted item links a PDF, or a page on a `.gov.et` or office host, the watch fetches it from the VPS with the pack fetcher's user agent and its 5 s delay. This is the NBE case: nine notices in a month whose substance is a file, not the post.

On success the file lands in `/root/storage/packs/watch-manual/<host>/` and is handed to the owning pack by the existing route — `node ops/packs/fetch-pack.js --pack <pack> --from-dir /root/storage/packs/watch-manual`. The watch **never writes into a pack directory itself**; curation stays where it is.

On failure — and `mols`, `ecc`, `mint`, `fsc`, `egov`, `esl`, `daro` and `eeu` all time out from this VPS today — the watch document is written anyway with `pending_document: "yes"`, and the item is named in the daily note so the file can be fetched by the laptop route, exactly as the banking manual harvest was done on 17 September.

### 5.7 Ranking

`watch` is **not** added to `OWN_SOURCES` (`knowledge/index.js:561`), so it never gets the `+0.06` boost. On top of that, the government agent and Bini list `watch` in `exclude` **by default**.

The exclusion is lifted, and `prefer: ['watch']` applied instead, only when the question carries a recency marker: *new, latest, this week, today, changed, updated, አዲስ, ዛሬ, በዚህ ሳምንት, ተቀየረ, ተሻሽሏል*. So "what is the work-permit fee" always reaches Regulation 394/2016, and "what changed for work permits this month" can reach the watch. Both halves are asserted in the eval (§5.10) — the second half is the one that catches a watch item shouting over the law.

### 5.8 Exclusions

Politics, conflict, elections, ethnicity, rumour, opinion, and personal or party attribution — always, in every language, before any model call. Sport, holiday greetings, live-stream markers and advertorials are excluded too, for a different reason: they are not wrong, they are noise, and §4 shows they are 73 % of the traffic.

### 5.9 The daily note

**One Telegram message a day, through the same `sendTgReal` that `ops/packs/freshness.js` uses** — same bot, same admin chats, no new bot and no new token. It is sent **only when something was written, or a document fetch failed**. A day in which the offices published nothing sends nothing, which is the standing rule already written into that file's comments.

It lists each item: office, one line of what it says, and the `t.me` link. Each is numbered, and Ibrahim can reply with one word:

- `pull 3` — fetch that item's linked document on the next run (for the VPS-timeout cases)
- `drop 3` — blacklist that item and the pattern behind it

The replies are read by the **existing owner-Bini Telegram path**, not by a new bot. **No test send.** The first real morning with a real item is the proof.

### 5.10 Retention

A watch item is news, and news stops being true. Three rules:

1. **`expires_at`.** Default 90 days. An item that names its own end date takes that date — the customs opening hours expire on 10 October 2026, not in December.
2. **Superseded by curation.** When a pack or `law` document later covers the same fact, the watch document is marked `status: "superseded"` with `superseded_by`. `knowledge/index.js:300` already drops a document whose `status` is not live, so no retrieval change is needed.
3. **A nightly sweep** in the same 02:00 script retires whatever is past. An expired item is removed from the index, not from disk, so the record of what was announced survives.

### 5.11 Evals

`ops/watch/gold.json`: about twelve questions of the form *"what changed this week for X"*, half Amharic and half English, scored on Page@k the way `ops/packs/build-gold.js` already scores. Each question is **two assertions**:

- with the recency marker, the gold page is the watch document;
- with the marker removed, the gold page is the **curated** document.

A build that passes the first and fails the second has made Bini prefer gossip to law, and must not ship.

### 5.12 Freshness interplay

When an admitted item carries a directive word **and** names an office that owns a pack, the watch appends a line to `/root/storage/packs/<pack>-refetch.json` and, at **02:10**, runs `ops/packs/freshness.js --pack <pack>` for that one pack — instead of waiting for Sunday. `freshness.js` reads and clears that file at the top of its run, so the Sunday run is unaffected and no two fetchers ever overlap. The customs and NBE cases are exactly this: the channel says a document exists, and the pack goes and gets it the same night.

---

## 6. What this design does not do

- It does not touch `knowledge/crawl.js`, `sources-am.json` or the Sunday schedule. The crawl's undated-news problem is real, but narrowing the crawl is a separate decision with its own evidence.
- It does not use a Telegram account, a bot token or MTProto, and it must not start.
- It does not publish anything. The watch writes knowledge and sends one private note; `bina_news_candidates.py` remains the path for articles BinaSmart publishes.
- It does not add a pm2 process or an npm dependency.
