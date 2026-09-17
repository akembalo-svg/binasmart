# Business life in Ethiopia knowledge pack (sector pack 3) — design

**Date:** 17 September 2026 · **Status:** written on the live server from measurements taken the same day; awaits Ibrahim's review
**Where it sits:** the third sector pack. The method is **not restated here** — it is §1 of `docs/superpowers/specs/2026-09-16-airline-travel-design.md` ("The sector-pack method (reused by every later sector)"), and everything below is only what is *different* about business life: its scope, its sources, its agents, its words, its guardrails and the number it can honestly promise.

The machinery this pack runs on is already built and already generalised by the banking pack: `ops/packs/fetch-pack.js`, `ops/packs/build-gold.js`, `ops/packs/freshness.js`, `ops/packs/am-headers.js`, `assistant/intent.js`, `knowledge/index.js readSources` + `PACK_SOURCES`. This pack adds **data and vocabulary**, not machines.

---

## 1. Scope — the questions this pack exists to answer

Four people, and what each of them actually asks. The scope is defined by the questions, not by a list of ministries; a ministry whose pages answer none of them is out.

**The shopkeeper** (a sole proprietor with one shop in Addis)
- How do I register a business name, and what does it cost?
- What is the difference between a trade name registration, a commercial registration and a business licence — and do I need all three?
- When does my licence expire and what do I bring to renew it?
- I have a TIN. Do I also need to register for VAT, and at what turnover?
- What is a sales register machine, and must I have one?
- My licence lapsed two years ago. What happens now?

**The importer / exporter**
- What is the import-export licence, who issues it, and what is the paid-up capital requirement?
- What does a customs declaration need, and what is the Electronic Single Window?
- What duty band does my product fall in, and who classifies it?
- What is franco valuta, and can I use it?
- Which goods need a standards or an EFDA certificate before they clear?

**The startup founder / investor (including the diaspora)**
- Do I need an investment permit, and is it different from a business licence?
- What is the minimum capital for a foreign investor, and which sectors are reserved for Ethiopians?
- What does the Investment Commission's one-stop shop actually do for me?
- What incentives exist — the duty-free capital-goods window, the income-tax holiday — and for how long?
- How do I get into an industrial park, and what does a shed cost?
- How do I register a trademark or a patent?

**The employer**
- What must a written employment contract contain?
- What do I register with the pension agency, and what are the employer and employee contribution rates?
- What is a work permit for a foreign employee, and who issues it?
- What paperwork ends an employment — notice, severance, the clearance letter?
- What is the LMIS / labour ID, and who needs one?

**Explicitly out of scope in v1:** anything a court decides (Asmat's case advice), the text of a proclamation (that is `knowledge/law`), tenders (BinaSmart's own tender service), banking and money (sector pack 2), flights (sector pack 1), and anything a person would do about their own single case rather than about the procedure.

## 2. Sources — measured on 17 September 2026, from the VPS and from the laptop

Every character count below is the output of the pack's own `extract()` (`ops/packs/fetch-pack.js` → `knowledge/index.js htmlToText`), not a shell text-stripper, and is **pre-boilerplate-strip**; the pack's floor is 400 characters *after* the strip. "Ethiopic" is a count of characters in the Ethiopic block in the extracted text.

### 2.1 Fetchable from the VPS

| id | host | how | robots | Amharic | measured 2026-09-17 |
| --- | --- | --- | --- | --- | --- |
| `motri` | `motri.gov.et` — Ministry of Trade and Regional Integration | **`urls` + link discovery.** `/sitemap.xml` answers **200 with HTML**, not XML: this is Drupal with no sitemap module. There is no sitemap to read. | `200`, 1,586 B, the stock Drupal file (`Disallow: /core/`, `/admin/`, `/user/…`) | **yes** — the whole site is served at `/am` and the home page extracted **1,258 Ethiopic characters of 2,904** (43 %) | home 2,904 c; `/am` 2,904 c, opening `ንግድና ቀጣናዊ ትስስር ሚኒስትር … የመስመር ላይ የንግድ ምዝገባ እና` |
| `eic` | `investethiopia.gov.et` — Ethiopian Investment Commission | `sitemap_index.xml` → `post-sitemap.xml`, **`page-sitemap.xml` (77 URLs)**, `bricks_template-sitemap.xml`, `category-sitemap.xml`, `author-sitemap.xml` (only the first two are taken) | `robots.txt` **times out**; the sitemaps answer | **no** — home extracted 4,950 c with **0 Ethiopic characters** | home 4,950 c, "Home \| Ethiopian Investment Commission". `page-sitemap.xml` **timed out on two of three attempts** and answered 200 with 77 URLs on the third (`/`, `/get-started/`, `/about-eic/`, …) — this host is intermittent and the fetcher's retry matters |
| `mols` | `mols.gov.et` — Ministry of Labour and Skills | `wp-sitemap.xml` → 6 children (`posts-post-1`, `posts-page-1`, `posts-elementskit_content-1`, `posts-elementor-hf-1`, taxonomies). Only **`wp-sitemap-posts-page-1.xml`, 53 URLs**, is taken | `robots.txt` times out; `wp-sitemap.xml` answers 200 | thin — home 2,340 c with **287 Ethiopic** (12 %) | home 2,340 c; page sitemap 53 URLs, answered on the second attempt. `knowledge/web/mols/` already holds **37 pages from the 2026-09-08 crawl** — see §2.5 |
| `eccsa` | `ethiopianchamber.com` — Ethiopian Chamber of Commerce and Sectoral Associations | `sitemap.xml` (All in One SEO), a **sitemapindex of 9** — `post`, `page`, `pxl-template`, `portfolio`, … Only **`page-sitemap.xml`, 50 URLs**, is taken. Its `<loc>` values are **CDATA-wrapped**; `sitemapUrls()` in `fetch-pack.js` already handles CDATA (line 41), so no code change is needed — a naive `<loc>([^<]+)</loc>` reader sees zero, which is worth knowing before someone "fixes" an empty fetch | `200`, `Disallow: /wp-admin/` only, two `Sitemap:` lines | almost none — 326 Ethiopic of 6,999 (5 %) | home 6,999 c; page sitemap 50 URLs (`/`, `/managements/`, `/monthly-digital-magazine/`, …) |
| `aaccsa` | `addischamber.com` — Addis Ababa Chamber of Commerce and Sectoral Associations | `sitemap_index.xml` → 8 children; **`page-sitemap.xml` holds 71 URLs**; `jobs-sitemap.xml` and the category sitemaps are dropped | `200`, Yoast block, `Disallow:` **empty — everything allowed** | some — 394 Ethiopic of 3,257 (12 %) | home 3,257 c; page sitemap 71 URLs |
| `poessa` | `www.poessa.gov.et` — Private Organizations Employees Social Security Agency | **`urls` + link discovery** — `/sitemap.xml` and `/wp-sitemap.xml` both return an 808-byte 404 page | not probed clean | **yes** — home extracted **1,208 Ethiopic of 1,956 (62 %)**, and the page *title itself* is Amharic: `የግል ድርጅት ሠራተኞች ማህበራዊ ዋስትና አስተዳደር` | home 1,956 c. **The apex `possa.gov.et` does not resolve; the working host is `www.poessa.gov.et`** — the spelling matters and cost two probe rounds to find |
| `ipdc` | `ipdc.gov.et` — Industrial Parks Development Corporation | **`urls`** — `robots.txt` is 404 and all three sitemap paths are 404 | none published | some — 417 Ethiopic of 3,918 (11 %) | home 3,918 c. `/why-ethiopia/` and `/investor-services/` both return a **real 404**, so soft-404 confusion is not a risk here — but it also means the paths have to be discovered from the home page's links, not guessed |
| `motl` | `motl.gov.et` — Ministry of Transport and Logistics | **`urls` + link discovery** (Drupal; `wp-sitemap.xml` returns Drupal HTML at 404) | not probed clean | **yes** — home extracted 882 Ethiopic of 1,628 (**54 %**) | home 1,628 c. Relevant only for freight-forwarder and transport-operator licensing → **candidate, not core**; see §2.6 |

### 2.2 Reachable, and deliberately **not** fetched

| id | host | why not |
| --- | --- | --- |
| `efda` | `efda.gov.et` | Reachable (home 10,249 c, 13-child `wp-sitemap.xml`), but its `robots.txt` reads `User-agent: ClaudeBot / Disallow: /`, and the same for `GPTBot`, `OAI-SearchBot`, `ChatGPT-User` and `anthropic…`, under the comment *"AI training crawlers — blocked at WAF level"*. Our fetcher is not named, but the publisher's intent about AI systems is unambiguous. **Listed with `doNotFetch: true` and a `why` quoting the file**, so nobody turns it on later. The food-and-cosmetics licence question is answered from `knowledge/eservices/ethiopian-food-and-drug-authority.md` instead, and the pack says plainly that it does not hold EFDA's own pages. |
| `ppa` | `ppa.gov.et` — Federal Public Procurement and Property Authority | Reachable, Amharic title, an 18-child `wp-sitemap.xml`. Out of scope: public procurement is BinaSmart's **tender** service, not business registration, and pulling a procurement directive into a licence answer is the cross-service confusion §4 exists to prevent. |
| `mot` | `mot.gov.et` | Ministry of **Tourism**, not Trade — a name collision worth writing down. 2,451 c, **69 % Ethiopic**, a 57-URL page sitemap. Out of v1 scope; a good candidate for a later tourism slice. |
| `id` | `id.gov.et` — Fayda | Already crawled as `fayda` in `knowledge/sources-am.json` (34 pages on disk) and summarised in `public/fayda.html`. Reference only. Measured anyway: `/services` 2,673 c, `/faq` 948 c, **0 Ethiopic** in either. |

### 2.3 Unreachable from the VPS **and** from the laptop — no route at all today

Each was probed 5 × from the VPS (Paris) and 5 × from the laptop (UAE), one host at a time, ≥ 5 s apart, keep-alive on.

| id | host | what happened | what it costs the pack |
| --- | --- | --- | --- |
| `ecc` | `ecc.gov.et` — Ethiopian Customs Commission | **timeout on all five paths from both machines.** `www.` variant also probed. `knowledge/web/ecc/` is an empty directory: every weekly crawl since 2026-09-08 has saved 0 pages. | The customs procedure — declaration, clearance, the duty bands, franco valuta — has **no first-party source**. Falls back to `knowledge/law/customs-amendment-1425-2026` (the law, not the procedure) and `knowledge/eservices/ethiopian-customs-commission.md` (the catalogue, not the procedure). |
| `eipo` | `eipo.gov.et` — Ethiopian Intellectual Property Authority | timeout on all five paths from both machines | Trademark and patent registration has no first-party source; `knowledge/eservices/ethiopian-intellectual-property-authority.md` only. |
| `mor` | `mor.gov.et` — Ministry of Revenue | **timeout on all five paths from both machines today.** `sources-am.json` recorded it as *up with an incomplete TLS chain* on 2026-09-14, so this host is **intermittent**, not dead. | Nothing, as it happens — see §2.5: `knowledge/mor/` already holds the MoR FAQ and forms library and this pack deliberately does not re-fetch that host. |
| `moj` | `moj.gov.et` | timeout / `503`. Already retired in `sources-am.json` in favour of `justice.gov.et`. | nothing; `web:justice/*` covers it and Asmat already prefers it. |

The `www.` variant of each of these was probed separately, because the banking pack's neighbours taught that an apex and a `www.` host are not the same machine. `www.motri.gov.et`, `www.mor.gov.et`, `www.ecc.gov.et` and `www.eipo.gov.et` all time out too. The one case where it mattered is the opposite way round and is in §2.1: the pension agency answers **only** on `www.poessa.gov.et`.

A second thing this measurement overturns, and it is the good news of the day: **`motri.gov.et`, `mols.gov.et` and `investethiopia.gov.et` are recorded as `timeout` in `knowledge/sources-am.json` and all three answered the VPS today.** `motri` and `mols` also answered the laptop. Their empty or stale `knowledge/web/` directories are a snapshot of a bad week, not a permanent verdict — which is precisely why this pack curates them instead of leaving them to a crawler that gave up.

**The laptop is not a second route for the four above.** All four time out from the UAE as well. That is the difference between this pack and the banking one: banking's unreachable hosts (`ethiotelecom.et`, `m-pesa.safaricom.et`) answered the laptop and were harvested there. Here, `--from-dir` has nothing to import unless someone fetches from inside Ethiopia. Two hosts run the other way and are worth recording: **`mot.gov.et` and `investethiopia.gov.et` answer the VPS and time out from the laptop.**

### 2.4 The one that is reachable and still unfetchable: `etrade.gov.et`

This is the most important host in the sector and it is the one that cannot be fetched, so it is written out on its own.

`https://etrade.gov.et/` answers **HTTP 200 with 45 KB** from the VPS **and** from the laptop. Through the pack's own `extract()` it is **`thin` — zero characters — from both machines.** `/business-license-checker` is the same: 200, 45,445 bytes, `thin`. `robots.txt` is 404 and all three sitemap paths are 404. `/api/services` answers **405 Method Not Allowed**, which says there is a JSON API behind the page.

It is a client-rendered single-page application. **A laptop harvest does not fix this** — the laptop got the identical empty shell — so the banking pack's `--from-dir` route, which works for `.et` hosts that simply do not answer from Paris, does not apply here. Two ways in, and both are decisions for Ibrahim (§8):

1. **A rendered harvest** — drive the site with the headless Chromium already on the VPS, save the rendered DOM per URL into `/root/storage/packs/business-manual/etrade.gov.et/` with a `manifest.json` in the banking harvest's shape, then import with `--from-dir`. The pack's importer needs no change; only the capture does.
2. **The JSON API** — if `etrade.gov.et` publishes a documented read API, that is a cleaner and more durable source than any scrape.

Until one of those exists, `etrade` is `fetch: "manual"` with `costsUs` saying exactly what is missing: **online trade registration and licensing, the licence checker, the fee schedule and the renewal calendar — the four things a shopkeeper asks about most.** The pack must say so out loud rather than answer from `public/business-registration-ethiopia.html` as though that were the registry.

### 2.5 What the repository already knows about business — and how this pack avoids duplicating it

The rule is the repository's own, stated in `knowledge/sources-am.json` and enforced by the banking pack: **one source or the other, never both.** Every item below goes into `knowledge/business/sources.json` → `references` with `fetch: "none"` and a note, so the overlap is on the record before the fetch rather than discovered after it.

| what | where | why the pack does not re-fetch it |
| --- | --- | --- |
| **`knowledge/eservices/` — 52 curated office catalogues** | including `ministry-of-trade-and-regional-integration.md` (6 services), `ethiopian-investment-commission.md`, `ethiopian-customs-commission.md`, `ministry-of-revenues.md`, `ethiopian-intellectual-property-authority.md`, `ministry-of-labor-and-skills.md`, `private-organization-employees-social-security-agency.md`, `ethiopia-electronics-single-window.md`, `ministry-of-industry.md`, `document-authentication-and-registration-service.md`, `accounting-and-auditing-board-of-ethiopia.md`, `federal-tax-appeal-commission.md`, `ethiopian-metrology-institute.md`, `ethiopian-construction-authority.md`, `authority-for-civil-society-organizations.md` | These answer **which office and where to apply**, bilingually, in about 4 KB each (measured: `ministry-of-trade-and-regional-integration.md` is 4,297 B). They do **not** answer *how*, *what it costs* or *what to bring*. The pack adds the procedure; it never re-states the catalogue. |
| **`knowledge/law/` — the statutes** | `vat-proclamation-1341-2024` (+`-am`), `income-tax-amendment-1395-2025` (+`-am`), `income-tax-regulation-410-2017`, `tax-administration-983-2016` and `-amendment-1434-2026`, `tax-administration-regulation-407-2017`, `turnover-tax-308-2002`, `stamp-duty-110-1998-612-2008`, `customs-amendment-1425-2026` (+`-am`), `trade-competition-consumers-protection-813-2013`, `cooperative-societies-985-2016` (+`-am`), `labour-proclamation-1156-2019` (+`-om`), `urban-land-lease-721-2011` (+`-om`), `documents-authentication-registration-922-2015` (+`-am`), `directive-tax-clearance-certificate-180-2015`, `directive-taxpayer-registration-cancellation-3-2011`, `directive-sales-register-machine-amendment-87-2005`, `directive-tax-receipts-149-2011`, `directive-penalty-waiver-189-2017`, `federal-courts-proclamation-1234-2021` | **The law text stays in `law`.** This is the line §4 draws in words: the *rule* is `law`'s, the *counter* is business's. A pack that copied the VAT proclamation would duplicate Asmat's best source. |
| **`knowledge/mor/` — `mor-faqs.md`, `mor-forms.md`** | the Ministry of Revenue's own FAQ and forms library, plus `bina.et/tax-forms` | `mor.gov.et` is therefore **not** a site of this pack even on the day it answers. Already Asmat's preferred source since 2026-09-14. |
| **`knowledge/web/` — the weekly crawl** | `motri` 40 pages, `mols` 37, `eic` 35, `motl` 30, `ffic` 12, `fsc` 12; `etrade`, `ecc`, `mor`, `daro`, `chamber`, `aacity`, `mint` directories **exist and are empty** | This is the duplication to resolve. Every host this pack curates must be **removed from `knowledge/sources-am.json`** and its `knowledge/web/<site>/` directory **deleted from disk** — the loader reads every directory under `knowledge/web` regardless of the registry, which the banking pack found the hard way. That is `motri`, `mols`, `eic`, and `motl` if it is taken. Crawled pages are gitignored and **truncated at 20,000 characters**; curated ones are neither. |
| **bina.et's own pages, source `guide`** | `business-registration-ethiopia` (3,906 c, 1,513 Ethiopic), `how-to-start-a-business-in-ethiopia` (2,465 c, 982), `vat-registration-ethiopia` (4,200 c, 1,582), `tin-registration-ethiopia` (3,605 c, 1,632), `customs-import-duty-ethiopia` (3,884 c, 1,499), `ethiopia-income-tax-calculator` (2,025 c, 617), `coc-certificate-ethiopia` (9,787 c, 4,539), `lmis-labor-id-ethiopia` (9,299 c, 4,182), `import-car-to-ethiopia` (3,218 c, 1,411), `living-working-in-ethiopia-guide` (1,767 c, 727), `rental-agreement-ethiopia` (2,759 c, 1,302), `tenant-screening-ethiopia` (2,767 c, 1,336), `telesign` (4,000 c, 1,956), `ethiopian-origin-id-yellow-card` (2,505 c, 1,059) | These are **short bilingual summaries we wrote**, 2–10 KB each. They are the pack's companions, not its competitors: three of them are named in the `PREFER` list of §3. They are never a substitute for an official page and the guardrails forbid quoting a fee from them as though an office had published it. |
| **bina.et's `page` source** | `for-business` (3,107 c, 1,183 Ethiopic) | a marketing page; in `PREFER` only because "what can BinaSmart do for my business" is a real question. |
| **`knowledge/addis-ababa.md`** | Addis notes | city-level practicalities; unchanged. |

### 2.6 What the source list looks like when the plan starts

**Fetched (6):** `motri`, `eic`, `mols`, `eccsa`, `aaccsa`, `poessa`. **Candidate, decided in Task 1 on what link discovery actually returns:** `ipdc`, `motl`.
Sitemap-driven candidate pages before `allow`/`deny`: **251** — `eic` 77, `aaccsa` 71, `mols` 53, `eccsa` 50 — plus whatever link discovery finds on `motri`, `poessa` and `ipdc`. After the allow lists and the 400-character post-strip floor, a pack of roughly **90–140 documents** is the honest expectation; the plan records the real number rather than this one.
**`doNotFetch` with a quoted reason (1):** `efda` (its robots.txt names ClaudeBot).
**Manual, with a measured `why` and a `costsUs` (5):** `etrade`, `ecc`, `eipo`, `mor`, `moj`.
**Out of scope, recorded so the question is not re-asked (4):** `ppa`, `mot`, `id`, EFDA's licensing services.
**Hosts that do not resolve or do not answer — recorded so nobody chases them:** `eic.gov.et` (ENOTFOUND; the Commission is at `investethiopia.gov.et`), `possa.gov.et` and `www.possa.gov.et` (ENOTFOUND; the agency is at **`www.poessa.gov.et`**), `esa.gov.et` / `www.esa.gov.et` (ENOTFOUND), `daro.gov.et` / `www.daro.gov.et` (ENOTFOUND), `www.esla.gov.et` (ENOTFOUND), `addisababa.gov.et` / `www.addisababa.gov.et` (ENOTFOUND — confirms the 2026-09-14 note in `sources-am.json`), `chamber.org.et` (ENOTFOUND), `ecx.com.et` (ENOTFOUND on the apex, timeout on `www.`), `mint.gov.et` (ENOTFOUND on the apex, timeout on `www.`), `www.etrade.gov.et` (404 — the apex is the right host).
`chamber.org.et` and `addisababa.gov.et` are **still live crawl targets in `knowledge/sources-am.json`**; the first should be replaced there by `ethiopianchamber.com` and the second removed.

## 3. Which agents read this pack

| agent | setting | why |
| --- | --- | --- |
| **Bini** | prefers it **per message**, via `assistant/business.js` + `assistant/intent.js`, exactly as `assistant/banking.js` and `assistant/travel.js` do | Bini answers rides, hotels, tenders, tax, cinema, banks and now licences in one conversation. A standing preference would move the `+0.06` tie-breaker *away* from everything it does not name. |
| **Asmat (አስማት)** | **prefers it** — `business` is added to `knowledge.prefer`, which today is `['law', 'guide', 'eservices', 'mor', 'news:law-*', 'web:justice/*']` | Asmat is the law-and-paperwork agent, and a trade-licence renewal is paperwork. He already prefers `eservices` (which office) and `mor` (which tax form) for exactly this reason; the business pack is the third leg — what the office requires. Refusing him the pack would mean the agent whose job is Ethiopian paperwork cannot see the Ethiopian paperwork. |
| **Dr Afiya (ዶ/ር አፊያ)** | **excludes it** — `business` joins `['page', 'skill', 'llms', 'mor', 'travel', 'banking', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia', …]` | Not a judgement call: the gap audit of 2026-09-14 **measured** the etrade business-licence checker answering *"is this clinic / doctor licensed?"* — a patient sent to the wrong register. She already excludes the two bina.et business guides for that reason. The pack is a bigger version of the same hazard. |
| **Owner Bini** | nothing to do | `agents/owner/rules.js` has `knowledge: false`. |

**The gate on Asmat's preference, stated before it is made.** Adding a source to his `prefer` list moves the `+0.06` tie-breaker onto it for *every* legal question, not only paperwork ones. So the plan measures him immediately before the change and immediately after, and the rule is: **if Asmat's slice moves down by even one question, the `prefer` entry comes out and `business` goes into his `exclude` list instead**, and the report says so. The pack does not get to cost Asmat a point.

**And the gate is against a run taken that day, never against a number from a report.** `/root/bini-eval/retrieval-gold-v3-agents-latest.json` read **91.9 % / 95.5 %** at 08:05 on 2026-09-17 at **18,885 chunks**, with Asmat 93.0 / 96.5 and Afiya 90.7 / 94.4 — against 96.4 / 99.1, Asmat 96.5 / 100.0 and Afiya 96.3 / 98.1 in the 15b report six hours earlier at 18,611 chunks. In the same window `retrieval-gold-travel-latest.json` fell from 85.0 / 83.3 to **76.7 / 78.3** and banking from 71.1 / 72.2 to **66.7 / 71.1**. Another task was in flight while this design was written, and the corpus grew by 274 chunks between two of those runs. **None of those numbers is a gate; the run taken at the start of the work is.** This is recorded rather than smoothed over, because a plan that pins a floor to a number it did not measure itself is how a pack gets blamed for a regression it did not cause.

## 4. Intent tiers — and where the tax words go

The machine is `assistant/intent.js`, unchanged: `HARD` → `OTHER_SERVICE` → `STRONG` → two × `WEAK`. What is new is the vocabulary, and one decision.

**The decision: a tax *procedure* is this pack's; a tax *rule* is `law`'s.** "How do I get a TIN", "which form de-registers a taxpayer", "what do I bring to renew my licence", "how do I get a tax clearance certificate" are transactions with an office, and they belong here. "What is the VAT rate", "what does the income-tax proclamation say about brackets", "is stamp duty payable on this deed" are the text of a statute, and they stay with `knowledge/law` and with Asmat. The banking pack put `ግብር` / `tax` / `vat` in `OTHER_SERVICE` **for itself**, and that stays true — a bank tariff is not a tax answer. For this pack the same words move, but only in their procedural compounds.

- **`HARD`** — only this sector says these, and one is enough even against the guard below.
  `ንግድ ፈቃድ`, `የንግድ ምዝገባ`, `የንግድ ስም ምዝገባ`, `ግብር ከፋይ መለያ ቁጥር`, `የግብር ክሊራንስ`, `የኢንቨስትመንት ፈቃድ`, `የሥራ ፈቃድ`, `የኢንዱስትሪ ፓርክ`, `ጉምሩክ ዲክላራሲዮን`, `የመመዝገቢያ ካፒታል`, `የንግድ ምልክት`, `የፈጠራ ባለቤትነት`,
  `business licence`, `business license`, `trade licence`, `trade name registration`, `commercial registration`, `tin registration`, `taxpayer identification number`, `tax clearance certificate`, `sales register machine`, `investment permit`, `industrial park`, `one-stop shop`, `customs declaration`, `electronic single window`, `franco valuta`, `import licence`, `export licence`, `work permit`, `trademark registration`, `patent registration`, `renew my licence`, `licence renewal`.
- **`OTHER_SERVICE`** — another BinaSmart service or another knowledge source owns it, unless a `HARD` word overrides.
  ride / hotel / cinema / hospital words as in the other two packs; the banking pack's own `ባንክ`, `ብድር`, `ወለድ`, `ምንዛሪ`, `telebirr`, `m-pesa`, `bank`, `loan`, `interest rate`, `exchange rate`, `remittance`; the travel pack's `በረራ`, `ሻንጣ`, `flight`, `baggage`, `airline`; the tender service's `ጨረታ`, `tender`; and the **tax-rule** words `አዋጅ`, `ደንብ`, `ቁጥር … ዓ.ም`, `proclamation`, `vat rate`, `income tax rate`, `tax bracket`, `stamp duty`, `turnover tax rate`; and Asmat's own `ፍርድ ቤት`, `ጠበቃ`, `ክስ`, `court`, `lawyer`, `lawsuit`, `my case`.
- **`STRONG`** — one is enough once no other service has claimed the message.
  `ፈቃድ ማደስ`, `ግብር ከፋይ`, `ቀረጥ`, `ጉምሩክ`, `አስመጪ`, `ላኪ`, `የሥራ ውል`, `የጡረታ መዋጮ`, `አክሲዮን ማህበር`, `ኃላፊነቱ የተወሰነ የግል ማህበር`, `ግለሰብ ነጋዴ`, `ማህበር ለማቋቋም`,
  `register a business`, `register a company`, `sole proprietor`, `plc`, `share company`, `paid-up capital`, `minimum capital`, `import export`, `clear goods`, `customs duty band`, `employment contract`, `pension contribution`, `severance pay`, `foreign investor`, `chamber of commerce`, `certificate of competence`.
- **`WEAK`** — two distinct ones and the message is business.
  `ንግድ`, `ድርጅት`, `ኩባንያ`, `ፈቃድ`, `ምዝገባ`, `ካፒታል`, `ሠራተኛ`, `አሠሪ`, `ደመወዝ`, `ማህተም`, `ሰነድ`, `ማመልከቻ`,
  `business`, `company`, `firm`, `licence`, `permit`, `register`, `registration`, `capital`, `employee`, `employer`, `salary`, `document`, `application`, `office`, `fee`, `stamp`, `renewal`, `certificate`.

**`PREFER`** (what Bini's retrieval is pointed at on a business message) — deliberately short:
`['business', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia', 'guide:tin-registration-ethiopia', 'eservices']`.
`law` is **not** in it: a licence-procedure question pulled onto the VAT proclamation is a wrong answer that looks right, which is the mirror image of the mistake the banking pack avoided by keeping the tax guides out of *its* `PREFER`.

## 5. Guardrails — what this pack may and may not do

Added to Bini's system prompt for the message that triggered the preference, in the shape `assistant/banking.js GUARDRAILS` uses, in English and Amharic.

1. **Inform only.** BinaSmart is not the Ministry of Trade, the Revenue office, the Customs Commission or the Investment Commission, and is not a lawyer, an accountant or a customs broker.
2. **Never file on anyone's behalf.** Bini may not submit a registration, renew a licence, lodge a declaration, file a return, book an appointment or fill a form for a person. It may explain what the form asks and where it is lodged.
3. **Never accept an identifier.** No TIN, no licence number, no business registration number, no passport or Fayda number, no password and no OTP — and when one is offered, refuse *and* warn, in the language the person wrote in, the way the banking pack's refusal does.
4. **Never say "you are compliant", "you are registered", "your licence is valid" or "you do not need a licence."** Bini cannot see any register. The licence checker on `etrade.gov.et` is the only thing that can answer whether a licence is valid, and Bini's job is to send the person there.
5. **Every fee, every deadline, every capital threshold and every contribution rate carries the institution's name and the document's fetched date in the same sentence** — from the document's own `Source: … fetched YYYY-MM-DD` line (in Amharic, `ምንጭ፦ … የተወሰደበት ቀን YYYY-MM-DD`), copied digit for digit, never from memory, never converted to another calendar. **A link is not a date.** If the pack does not hold the figure, say so plainly rather than estimating it.
6. **No advice on structure or on tax position.** Never say which legal form to choose, which sector to enter, whether to register for VAT before the threshold, or how to reduce a liability. Lay out what the offices publish and let the person and their accountant decide.
7. **Say the gap out loud.** Where the pack has no first-party source — customs procedure, intellectual property, and `etrade` itself — Bini says which office publishes it and that BinaSmart does not hold the page, instead of answering from a bina.et summary as though it were the register.
8. **Fees and requirements change without notice**; say so, and tell the person to confirm with the office.

## 6. The gold set

**60 questions, 40 Amharic and 20 English**, ids `bz-001` … `bz-060`, built and verified by `ops/packs/build-gold.js --pack business` under the rule that has held for both previous packs: *a question may not enter the set unless the page it names is on disk, is live, and actually discusses the question's subject* — at least three English content words of the `topic` present in the page text, and a `topicAm` as well where the gold page is itself Amharic. **One unverifiable question and nothing is written at all.**

Shape: at least 7 distinct `section` keys, at least 4 distinct institutions, no single page carrying more than 8 questions. The sections follow §1's four people: `registration`, `licensing`, `tax-procedure`, `trade`, `customs`, `investment`, `industrial-parks`, `employment`, `ip`, `chamber`, `help`.

The four scopes of §1 each get a share, and the Amharic/English split is **not** distributed evenly across them on purpose: `motri` is the only core source with a real Amharic locale, so the Amharic questions cluster where Amharic pages exist, and §7 measures exactly that rather than hiding it.

## 7. Targets — stated per slice, because one number would be dishonest

The airline design asked for *"the right page in the top 3 for at least 90 %"*. Two packs later that number is known to be a property of **language supply**, not of the retriever. Measured on 2026-09-17, on the 90-question banking gold set, 18,611 chunks (`docs/superpowers/reports/2026-09-17-bilingual-query-retrieval.md`, `…/2026-09-17-banking-manual-sources.md` §15b.5):

| slice | banking, 15b report | banking, `-latest` 07:51 | travel, 15b report | travel, `-latest` 07:57 |
| --- | --- | --- | --- | --- |
| question and gold page **share a language** | **86.2 / 84.5** | 79.3 / 81.0 | — | 80.0 / 85.0 |
| Amharic question, gold page **only in English** | **43.8 / 50.0** | 43.8 / 53.1 | 87.5 / 82.5 | 75.0 / 75.0 |
| all questions | 71.1 / 72.2 | 66.7 / 71.1 | 85.0 / 83.3 | 76.7 / 78.3 |

Two readings of the same gold sets hours apart, and the ranking of the slices is the same in every one of them: **same-language beats cross-lingual by 25 to 35 points.** That, and not the absolute level, is the fact the targets are built on.

So this pack states five targets, and the plan writes them down **before** the first run so the run can falsify them:

| slice | n | target as shipped | why this number |
| --- | ---: | ---: | --- |
| question and gold page share a language | ~30 | **≥ 85 %** | this is what the retriever actually does when the language matches, in both previous packs |
| Amharic question, Amharic gold page | ~18 | **≥ 85 %** | banking's batch-2 Amharic slice measured 90.0 % |
| Amharic question, gold page only in English | ~22 | **≥ 50 %** | banking measured 43.8 / 50.0 *after* Amharic key-fact headers. Anything above 50 % is a gain; promising 90 % here would be a promise the corpus cannot keep |
| English questions | 20 | **≥ 80 %** | banking 83.3 / 80.0, travel 80.0 / 85.0 |
| **all 60** | 60 | **≥ 72 %**, predicted 70–78 % | the weighted consequence of the four above, not an aspiration |

Two things move these numbers and both are in the plan: `ops/packs/am-headers.js` writes an Amharic title and Amharic key facts onto every English document (worth **+6.7 points** on banking's cross-lingual slice when it was introduced), and `motri`'s genuine Amharic locale means more Amharic questions can have Amharic pages here than banking managed. `KNOWLEDGE_BILINGUAL_QUERY` stays **off**: it was measured and it moves the shipped number down.

## 8. What this needs from Ibrahim

1. **`etrade.gov.et` — the decision of §2.4.** A rendered harvest with the VPS's headless Chromium, or a request to the Ministry for API access, or accept that the pack does not hold the trade register. This is the single biggest lever on the pack's usefulness.
2. **`ecc.gov.et` and `eipo.gov.et`** answer from neither Paris nor the UAE. If Ibrahim has a contact who can fetch them from inside Ethiopia, the `--from-dir` route takes it unchanged. Otherwise the pack ships with customs procedure and IP registration as declared gaps.
3. **`knowledge/sources-am.json` hygiene:** `chamber.org.et` no longer resolves and should be replaced by `ethiopianchamber.com`; `addisababa.gov.et` has had no working domain since at least 2026-09-14. Both are in the crawler's registry, which is **gitignored**, so this is a server change with no commit — the durable record is the `references` block of `knowledge/business/sources.json`.
4. **`efda.gov.et`'s robots.txt names ClaudeBot.** The pack proposes to honour it. Confirm.
5. **`motl` and `ipdc`** — in or out of v1. Both are reachable; neither is core.

## 9. Not in v1

Tenders and public procurement; the text of any proclamation; regional (non-federal) trade bureaux; Addis Ababa city-level licensing, which has no reachable domain; tourism-business licensing; cooperative and civil-society registration; anything that files, books or submits; a demo agent — this pack serves Bini and Asmat, and a separate "business demo" page is a later decision.

## 10. Honesty rules

Every fee, threshold, capital figure, contribution rate and deadline Bini states comes from a document in this pack with the institution's name and the fetched date in the same sentence, or it is not stated. Where the pack has no source, Bini names the office that publishes it and says BinaSmart does not hold the page. Nothing is written from the model's memory, and no figure appears in an Amharic header that the English page did not print — `ops/packs/am-headers.js` already enforces that, digit for digit.
