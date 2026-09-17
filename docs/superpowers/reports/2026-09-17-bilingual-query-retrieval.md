# Bilingual query retrieval — measured, switchable, and left off

2026-09-17. BinaSmart shared knowledge RAG (`knowledge/index.js`), 18,611 chunks, live server.

**Decision: NOT kept on.** The code, the flag and the tests are in the tree;
`KNOWLEDGE_BILINGUAL_QUERY` defaults to `0`, and with it off retrieval is — measured, not assumed —
byte for byte what it was before. The experiment is switchable because it is worth re-running when the
corpus changes; it is off because on the pack it was built for it moves the shipped number **down**.

§1 is the first three fusion variants. **§2, appended later the same day, is two more** — `augment` and
`augment-top`, which may only ADD pages the question never surfaced and never displace one it did. They are
off as well, and §2.5 says by how much each gate missed.

---

## 1. What the gap was

Measured on the 90-question banking gold set (`/root/storage/bina-embed/eval/gold-banking.json`),
before this task:

| slice | n | retrieval | as shipped |
|---|---|---|---|
| all questions | 90 | 71.1% | 72.2% |
| question and gold page share a language | 58 | 86.2% | 84.5% |
| **Amharic question, gold page only in English** | **32** | **43.8%** | **50.0%** |

Only some institutions publish Amharic at all — Zemen and telebirr do, Dashen, CBE and CoopBank do not —
so an Amharic question is captured by whatever Amharic page is nearest, even when the right English page
exists. Amharic key-fact headers on the English documents (`ops/packs/am-headers.js`) closed part of it
from the document side (+6.7). This task attacked the remaining half from the query side.

## 2. What was built

`knowledge/index.js`:

* **Query rendering.** A question that the existing Amharic detector (`isAmharic`, Ethiopic script or two
  or more Latin-Amharic words) calls Amharic is also rendered into English by one short
  `gemini-2.5-flash` call — *"Translate this Amharic question into a short natural English search query;
  output only the query"* — with `temperature: 0`, `thinkingBudget: 0`, a hard **1,500 ms** timeout and an
  **LRU cache of 500** keyed on the NFC-normalised, case-folded, whitespace-collapsed question. A timeout,
  an HTTP error, an empty answer or a rendering identical to the question all fall back to exactly the
  single-query path and log `[knowledge] bilingual: skipped (<reason>)`. The symmetric direction
  (English → Amharic) is a separate switch, `KNOWLEDGE_BILINGUAL_EN2AM`.
* **Fusion, before the reranker.** Both renderings are embedded (`embedQuery`, refactored out of `search`
  so both go through the same Gemini-then-BGE-M3 path). The two must land in the **same vector space** —
  a Gemini cosine and a BGE-M3 cosine are not comparable numbers — so the second rendering is embedded
  with `forceLocal` set to whatever the first ended up using, and is dropped if it still disagrees. Every
  candidate chunk is scored under each rendering with `hybridScore` unchanged, and keeps the **max** of
  the two. The keyword component is the **union** of both renderings' tokens.
* **Untouched, deliberately:** `hybridScore` and its 0.15 keyword weight, the +0.06 own-source
  tie-breaker, the reranker, and its 0.03 gate. They run on the fused list exactly as they always have.
* **Voice lookups are exempt.** A `sources: ['style']` search is about register, not facts, and is never
  rendered into another language.

`ops/bini/rerun-retrieval-benchmark.js` already ran the production `search()` rather than a copy of it
(verified: `main()` calls `k.search(g.question, opts)` on a `makeKnowledge` built from the same module the
API uses), so **no ranking code was duplicated into the eval and none had to be added there.** What was
added: the run now records the bilingual setting it ran under, the bilingual counters, and its own
search latency.

`ops/bini/bilingual-latency.js` is new: `contextFor` over the 90 banking questions, one setting per run.

## 3. What it measured

All runs on the same 18,611-chunk corpus, same gold sets, same live Gemini.

### 3.1 Banking (90 questions) — the pack this was built for

| slice | n | baseline (off) | **max + union keywords** | max + per-rendering keywords | reciprocal-rank fusion | + EN2AM |
|---|---|---|---|---|---|---|
| all questions | 90 | 71.1 / **72.2** | 72.2 / **70.0** | 63.3 / 68.9 | 68.9 / 70.0 | 70.0 / 70.0 |
| Amharic | 60 | 65.0 / 68.3 | 66.7 / 65.0 | 53.3 / 63.3 | 61.7 / 65.0 | 66.7 / 65.0 |
| English | 30 | 83.3 / 80.0 | 83.3 / 80.0 | 83.3 / 80.0 | 83.3 / 80.0 | 76.7 / 80.0 |
| **am question, gold only in English** | 32 | **43.8 / 50.0** | **62.5 / 53.1** | 53.1 / 56.3 | 62.5 / 59.4 | 62.5 / 53.1 |
| question + gold share a language | 58 | **86.2 / 84.5** | **77.6 / 79.3** | 69.0 / 75.9 | 72.4 / 75.9 | 74.1 / 79.3 |
| batch 1 | 60 | 60.0 / 61.7 | 65.0 / 61.7 | 60.0 / 65.0 | 56.7 / 58.3 | 61.7 / 61.7 |
| batch 2 | 30 | 93.3 / 93.3 | 86.7 / 86.7 | 70.0 / 76.7 | 93.3 / 93.3 | 86.7 / 86.7 |

Result files, all in `/root/bini-eval/`:
`retrieval-gold-banking-20260917-053403.json` (baseline),
`-062930.json` (max + union), `-063555.json` (per-rendering keywords), `-063935.json` (RRF),
`-071756.json` (EN2AM), `-072113.json` (the flag off again, on the finished code).

### 3.2 The other gold sets, with the flag on (max + union)

| gold set | slice | n | off | on |
|---|---|---|---|---|
| travel | all | 60 | 85.0 / 83.3 | **88.3 / 83.3** |
| travel | am question, gold only in English | 40 | 87.5 / 82.5 | **92.5 / 82.5** |
| travel | English | 20 | 80.0 / 85.0 | 80.0 / 85.0 |
| v3-agents | all | 111 | 96.4 / 99.1 | **98.2 / 99.1** |
| v3-agents | Afiya | 54 | 96.3 / 98.1 | **98.1 / 98.1** |
| v3-agents | Asmat | 57 | 96.5 / 100.0 | **98.2 / 100.0** |
| v3-agents | am question, gold only in English | 33 | 87.9 / 97.0 | **93.9 / 100.0** |
| v2 | all | 114 | 91.2 / 88.6 | **93.0 / 88.6** |
| v2 | own documents | 66 | 93.9 / 93.9 | **97.0 / 95.5** |
| v2 | crawled web | 48 | 87.5 / 81.3 | 87.5 / **79.2** |

`retrieval-gold-travel-20260917-053102.json` / `-064328.json`;
`retrieval-gold-v3-agents-20260917-052600.json` / `-064729.json`;
`retrieval-gold-v2-20260917-065705.json` / `-065237.json`.

> The v2 baseline that was on disk (`-20260917-012216.json`) was measured on **16,179** chunks, before the
> National Bank, telebirr and M-PESA joined the corpus. Compared against it, the flag looked like a 2.6-point
> regression; five of the questions it "lost" are the five whose gold passage the corpus no longer holds.
> A fresh flag-off run on 18,611 chunks is the comparison above, and it says the opposite. The stale number
> is recorded here because it was the first number this task produced.

### 3.3 Latency

`contextFor` over the 90 banking questions, one process per setting
(`bilingual-latency-off-20260917-070139.json`, `bilingual-latency-on-20260917-071244.json`):

| | n | p50 | p95 | mean | am p50 / p95 | en p50 / p95 |
|---|---|---|---|---|---|---|
| flag off | 90 | 925 ms | 3,128 ms | 1,027 ms | 930 / 3,128 | 892 / 2,500 |
| flag on | 90 | 1,441 ms | 2,078 ms | 1,343 ms | 1,634 / 2,144 | 770 / 1,364 |

p50 rises 516 ms; p95 **falls** 1,050 ms, because the tail of both distributions is the reranker's own
variance on a live model call, not the retrieval. The ≤1.2 s p95 budget is met with room to spare. At the
`search()` level, where the reranker is out of the picture on the first call, the cost is unambiguous and
small: cold p50 346 ms → 908 ms, cold p95 520 ms → 1,116 ms.

## 4. The decision, against the gates that were set

| gate | required | measured (max + union) | |
|---|---|---|---|
| banking cross-lingual rises | ≥ +10 points | retrieval **+18.7** (43.8 → 62.5); as shipped +3.1 | pass on retrieval |
| banking overall as shipped | ≥ 72.2% | **70.0%** | **fail** |
| travel | ≥ 85.0 retrieval, ≥ 83.3 shipped | 88.3 / 83.3 | pass |
| v3 Afiya / Asmat retrieval | ≥ 96.3 / 96.5 | 98.1 / 98.2 | pass |
| p95 latency increase | ≤ 1.2 s | −1.05 s | pass |

One gate fails, and it is the one that counts the whole pack as a user gets it. So the flag ships off.

**Why it fails, question by question** (baseline → flag on, banking):

* *gained on retrieval* (7, all Amharic): bk-014, bk-018, bk-021, bk-023, bk-024, bk-033, bk-039.
* *lost on retrieval* (6, all Amharic): bk-004, bk-005, bk-008, bk-040, bk-066, bk-070 — and their gold
  pages are `ethiotelecom-am-international-remittance`, `zemen-am-internet-banking`,
  `zemen-am-consumer-deposit`, `zemen-cybersecurity`, `ethiotelecom-am-deposit-cash`,
  `ethiotelecom-am-endekise-overdraft`. **Every one of them is an Amharic page.**

That is the whole finding in one line: on a pack that is half Amharic pages, an English rendering buys one
cross-lingual hit and sells one same-language hit, and the reranker does not recover the difference — net
+1 question on retrieval, −2 as shipped. On a pack with **no** Amharic pages at all (the airline: every
Amharic question is cross-lingual) it is free money, +3.3 points of retrieval and nothing given back.

## 5. The two fusion variants, and why max + union won

* **Per-rendering keyword denominators** were tried on the suspicion that the union dilutes a
  same-language question (ask four Amharic words, get seven, and a page that matched all four scores 4/7).
  It is worse everywhere: 63.3 / 68.9. Giving the English rendering its own small denominator makes its
  keyword score *stronger* relative to the Amharic one, which is the opposite of the repair wanted.
  Kept behind `KNOWLEDGE_BILINGUAL_KEYWORD=per` so the measurement can be repeated.
* **Reciprocal-rank fusion** (`KNOWLEDGE_BILINGUAL_FUSION=rrf`) protects the slice max fusion hurts most —
  batch 2 holds at 93.3 / 93.3 instead of falling to 86.7 — and has the best cross-lingual *shipped*
  number of any variant (59.4). But it costs batch 1 (60.0 → 56.7 retrieval) and lands at the same
  68.9 / 70.0 overall. It also changes what the reranker's 0.03 gate is looking at: the candidates arrive
  ordered by reciprocal rank while still carrying their max hybrid score, so the gate's input is no longer
  monotonic with the order. That is a second, unmeasured change riding on the first, which is another
  reason not to ship it.
* **EN2AM** was measured on banking and it is a loss: the English slice falls 83.3 → 76.7 on retrieval and
  the pack falls to 70.0 / 70.0. An English question already reaches the English pages; an Amharic
  rendering only adds a way to be pulled off them. Left off.

## 6. What is in the tree

* `knowledge/index.js` — `makeQueryTranslator`, `bilingualEnabled`, `bilingualEn2AmEnabled`,
  `normaliseQuery`, `embedQuery`, `renderOther`, and the fusion inside `search()`. Flags:
  `KNOWLEDGE_BILINGUAL_QUERY` (default 0), `KNOWLEDGE_BILINGUAL_EN2AM` (0),
  `KNOWLEDGE_BILINGUAL_FUSION` (`max`), `KNOWLEDGE_BILINGUAL_KEYWORD` (`union`). All injectable, so the
  tests never touch the network.
* `test/knowledge-bilingual.test.js` — 11 tests. The one that matters most pins the **off** path to a
  fixture captured from `8e47cf6` before any of this existed: same four queries, same scores to four
  decimal places, and the translator asserted never to be called.
* `ops/bini/rerun-retrieval-benchmark.js` — records the bilingual setting, the bilingual counters and the
  search latency of every run.
* `ops/bini/bilingual-latency.js` — the `contextFor` measurement.
* `test/banking/benchmark-banking.test.js`, `test/travel/benchmark-travel-floor.test.js` — the floors did
  **not** move. Both now skip result files written with the flag on, so an experiment can never raise or
  lower a floor; runs from before the flag existed carry no `bilingual` block and count as shipped runs.

**The off path was verified against the live index, not just against the unit fixture.** Both packs were
re-benchmarked with the flag off on the finished code, through the live reranker, and both reproduce their
baseline in every slice: banking `-072113.json` = 71.1 / 72.2 with cross-lingual 43.8 / 50.0, batch 1
60.0 / 61.7, batch 2 93.3 / 93.3, identical to `-053403.json`; travel `-072427.json` = 85.0 / 83.3,
identical to `-053102.json`. The refactor that pulled the query embedding out of `search()` changed
nothing.

## 6.1 The live check, after the restart

`pm2 restart binasmart-api`, `/health` 200, error log clean apart from the standing Fastify
`ignoreTrailingSlash` deprecation warning. Three of the Amharic banking questions the cross-lingual slice
misses, asked through `/api/assistant` with `x-binasmart-eval: 1`, four seconds apart — the texts posted
from a file on the server, never typed:

| qid | gold page | what Bini cited |
|---|---|---|
| bk-012 *"is there a monthly account maintenance fee?"* | `banking/zemen-tariff` (English) | Oromia Cooperative Bank's savings page (16 Sep 2026) and Dashen's diaspora current account — **not** the Zemen tariff. The miss, live. |
| bk-030 *"what is a foreign currency retention account?"* | `banking/zemen-international-banking-2-forex-service` (English) | NBE directive FXD/04/2026, Zemen Bank (16 Sep 2026), Oromia Cooperative Bank Wadi'ah retention accounts. Correct, and dated from the Source line. |
| bk-035 *"what types of bank card are there?"* | `banking/dashen-card-services` (English) | Zemen Bank throughout — debit, credit, prepaid, salary and gift cards. Answers the question from the wrong bank's page: the label's problem as much as retrieval's. |

bk-012 is worth reading twice: it is exactly the failure this task set out to fix, still there with the
flag off, and the flag would not have fixed it either — with bilingual on, bk-012 is one of the six that
stayed missed.

One non-emergency question per agent, to confirm the restart broke nothing: Dr Afiya on enrolling in
community-based health insurance answered from Regulation 535/2023 and Proclamation 1273/2022 with the
Meskerem 1 – Yekatit 30 window and the three-resident testimony rule; Asmat on registering a house rental
contract answered from Proclamation 1320/2024 with the 30-day deadline, Article 4(4) and the up-to-three-
months-rent penalty, both opening with their own guard sentence. Neither agent was asked anything urgent.

## 7. What still misses, and what would be worth trying next

* **The 12 cross-lingual questions still missed as shipped with the flag on** are mostly Dashen and
  CoopBank pages (`dashen-frequently-asked-questions`, `coopbank-ufaqs`, `dashen-card-services`) where the
  question names no institution at all. A translated query cannot choose between six banks' identically
  named products; nothing on the query side can. That is a gold-label problem as much as a retrieval one,
  and the banking floor test has said so since it was written.
* **The obvious next variant is a per-question decision rather than a global one**: run the rendering, but
  only let it *add* candidates it finds that the original query did not, rather than letting it outscore
  the original query's own candidates. Max fusion currently lets an English page displace an Amharic page
  that was correctly first. A "union of candidates, original ranking preserved for ties" rule would take
  the +18.7 on the cross-lingual slice without paying the −8.6 on the same-language one — if it works,
  which is a measurement, not a claim.
* **Re-run this when the corpus changes.** The result turned on one thing only: how much of the corpus is
  in the question's own language. If the banking pack ever gains Amharic from Dashen, CBE or CoopBank, the
  arithmetic that failed the gate changes, and the flag is one environment variable away.

## 8. Reproducing

```
cd /var/www/connectcare/binasmart
node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold banking            # as shipped
KNOWLEDGE_BILINGUAL_QUERY=1 node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold banking
KNOWLEDGE_BILINGUAL_QUERY=1 KNOWLEDGE_BILINGUAL_FUSION=rrf  ... --gold banking
KNOWLEDGE_BILINGUAL_QUERY=1 KNOWLEDGE_BILINGUAL_KEYWORD=per ... --gold banking
node --env-file=.env ops/bini/bilingual-latency.js                                   # p50/p95, flag off
KNOWLEDGE_BILINGUAL_QUERY=1 node --env-file=.env ops/bini/bilingual-latency.js       # p50/p95, flag on
```

Run them detached (`setsid nohup … &`) and poll the log: a 90-question run is about five minutes, and a
run started with a plain `&` over ssh was killed with the session once during this task.

---

# §2 — The rescue-only variants: `augment` and `augment-top`

2026-09-17, later the same day, same live server, same `search()`. §7 above named the obvious next thing to
try: *"run the rendering, but only let it add candidates it finds that the original query did not, rather
than letting it outscore the original query's own candidates."* Both readings of that sentence were built
and measured. **Neither is kept on.** `KNOWLEDGE_BILINGUAL_QUERY` still defaults to `0`; the two new fusion
modes sit beside `max` and `rrf` behind `KNOWLEDGE_BILINGUAL_FUSION`, tested, for the day the corpus changes.

## 2.1 What the two modes do

* **`augment`.** The original query's ranked candidate list is kept exactly as it is with the flag off —
  same scores, same order. The English rendering may only **append** pages that list does not already hold,
  after it, each carrying the hybrid score the rendering gave it. A page the Amharic question already ranked
  can be neither displaced nor re-scored. The `≤2-chunks-per-page` rule, the reranker, its 0.03 gate and the
  +0.06 tie-breaker run on the extended list unchanged. At most `BILINGUAL_AUGMENT_MAX` = 12 chunks are
  appended, because the list it extends is the reranker's prompt.
* **`augment-top`.** The same rescue, but the appended pages are then merged into the list by their own
  score with the original **top-1 pinned**: the page the question itself ranked first can never be
  displaced; everything under it competes. That pin is the one protection max fusion did not give, and the
  six Amharic pages max fusion lost (§4) are what it was aimed at.
* **Keyword side.** Both modes force per-rendering tokens whatever `KNOWLEDGE_BILINGUAL_KEYWORD` says: the
  union would change the keyword denominator of every page the question found for itself, and an augment
  run promises those scores are untouched. A rescued page is scored on the English rendering's tokens alone,
  which is what it was found by.
* **Untouched, again:** `hybridScore`, its 0.15 keyword weight, the +0.06 own-source boost, the reranker and
  its 0.03 gate.

**One consequence, before any measurement.** This report's *retrieval* column is a search with
`rerankTo` unset (`ops/bini/rerun-retrieval-benchmark.js`, `searchOptionsFor`: `{ k: 18 }` with no
reranker), and it scores the first three distinct pages of that list. Under `augment` the rescued pages are
strictly after the candidates that column reads. **`augment` therefore cannot move the retrieval number at
all** — its entire effect is on what the reranker is shown. The gate "banking cross-lingual retrieval ≥ 55"
was unreachable for it before the first question was asked. That is not a flaw in the measurement; it is
what "may only append" means, and the runs below confirm the code does exactly that and nothing else.

## 2.2 Banking (90 questions), 18,611 chunks

| slice | n | baseline (off) | **augment** | **augment-top** | max + union (§3.1) |
|---|---|---|---|---|---|
| all questions | 90 | 71.1 / 72.2 | 71.1 / **73.3** | 66.7 / 71.1 | 72.2 / 70.0 |
| Amharic | 60 | 65.0 / 68.3 | 65.0 / **70.0** | 58.3 / 66.7 | 66.7 / 65.0 |
| English | 30 | 83.3 / 80.0 | 83.3 / 80.0 | 83.3 / 80.0 | 83.3 / 80.0 |
| am question, gold only in English | 32 | 43.8 / 50.0 | 43.8 / **56.3** | 43.8 / 53.1 | 62.5 / 53.1 |
| question + gold share a language | 58 | 86.2 / **84.5** | 86.2 / 82.8 | 79.3 / 81.0 | 77.6 / 79.3 |
| batch 1 | 60 | 60.0 / 61.7 | 60.0 / **63.3** | 56.7 / 61.7 | 65.0 / 61.7 |
| batch 2 | 30 | 93.3 / 93.3 | 93.3 / 93.3 | 86.7 / 90.0 | 86.7 / 86.7 |

`/root/bini-eval/retrieval-gold-banking-20260917-053403.json` (baseline),
`-074708.json` (augment), `-075149.json` (augment-top).

The retrieval column of the augment run is **identical to the baseline in every slice**, which is the
design's promise measured rather than asserted: a per-question diff of the two result files finds 0
questions gained and 0 lost on `plain`, over all 90.

## 2.3 Travel (60) and the two agents (111)

| gold set | slice | n | baseline (off) | **augment** | **augment-top** |
|---|---|---|---|---|---|
| travel | all | 60 | 85.0 / **83.3** | 85.0 / 81.7 | 76.7 / 78.3 |
| travel | am question, gold only in English | 40 | 87.5 / 82.5 | 87.5 / 80.0 | 75.0 / 75.0 |
| travel | English | 20 | 80.0 / 85.0 | 80.0 / 85.0 | 80.0 / 85.0 |
| v3-agents | all | 111 | 96.4 / 99.1 | 96.4 / 99.1 | — |
| v3-agents | Afiya | 54 | **96.3** / 98.1 | 96.3 / 98.1 | — |
| v3-agents | Asmat | 57 | **96.5** / 100.0 | 96.5 / 100.0 | — |
| v3-agents | am question, gold only in English | 33 | 87.9 / 97.0 | 87.9 / 97.0 | — |

`retrieval-gold-travel-20260917-053102.json` (baseline), `-075419.json` (augment), `-075724.json`
(augment-top); `retrieval-gold-v3-agents-20260917-052600.json` (baseline), `-080129.json` (augment).
On v3 the augment run is not merely equal in the slices: its per-question diff against the baseline is 0
gained and 0 lost on **both** columns, all 111 questions.

**The augment-top v3 run is on a different corpus, and says so.** Between 08:01 and 08:05 UTC, between the
augment v3 run and the augment-top one, the index grew from **18,611 to 18,885 chunks** — from outside this
task (`/var/log/bina-knowledge.log` has nothing after 03:43, so a manual ingest). Rather than compare
across corpora — the mistake §3.2 records — a fresh **flag-off** v3 baseline was measured on 18,885:

| v3-agents, 18,885 chunks | n | off (`-081451.json`) | **augment-top** (`-080502.json`) |
|---|---|---|---|
| all questions | 111 | 94.6 / 96.4 | 91.9 / 95.5 |
| Afiya | 54 | 96.3 / 96.3 | 90.7 / 94.4 |
| Asmat | 57 | 93.0 / 96.5 | 93.0 / 96.5 |
| am question, gold only in English | 33 | 84.8 / 90.9 | 78.8 / 87.9 |

Same corpus, same day: augment-top loses 3 questions on retrieval (A12, A20, A28) and 1 as shipped (A20),
and gains none. The +274 chunks cost the flag-off baseline 1.8 points of retrieval on their own
(96.4 → 94.6) — worth remembering the next time a number from this pack is quoted.

## 2.4 Latency

Search latency, from the benchmark runs themselves (`coldP50` / `coldP95`: the first search of each
question, which pays for the rendering and the second embedding; no reranker):

| run | n | cold p50 | cold p95 |
|---|---|---|---|
| flag off (v3, 18,885) | 111 | 317 ms | **459 ms** |
| augment — banking | 90 | 957 ms | **1,238 ms** |
| augment — travel | 60 | 961 ms | **1,245 ms** |
| augment — v3-agents | 111 | 921 ms | **1,479 ms** |
| augment-top — banking | 90 | 967 ms | 1,326 ms |
| augment-top — travel | 60 | 998 ms | 1,297 ms |

`contextFor` over the 90 banking questions under `augment`
(`bilingual-latency-on-20260917-080941.json`): p50 1,469 ms, p95 2,093 ms, mean 1,324 ms — within a few
milliseconds of the flag-on figure in §3.3 (1,441 / 2,078). The rescue itself costs nothing measurable; the
translation call and the second embedding cost what they always cost.

## 2.5 The decision, against the gates that were set

| gate | required | **augment** | **augment-top** |
|---|---|---|---|
| banking overall as shipped | ≥ 72.2 | **73.3** pass | 71.1 — fail by 1.1 |
| banking cross-lingual retrieval | ≥ 55 | **43.8 — fail by 11.2** | 43.8 — fail by 11.2 |
| banking same-language as shipped | ≥ 84.5 | **82.8 — fail by 1.7** (1 question) | 81.0 — fail by 3.5 |
| travel | ≥ 85.0 / 83.3 | 85.0 / **81.7 — fail by 1.6** (1 question) | 76.7 / 78.3 — fail by 8.3 / 5.0 |
| v3 Afiya / Asmat retrieval | ≥ 96.3 / 96.5 | 96.3 / 96.5 pass | 90.7 / 93.0 — fail by 5.6 / 3.5 |
| `search()` p95 | ≤ 1,200 ms | **1,238–1,479 ms — fail by 38–279 ms** | 1,297–1,326 ms — fail |

**`augment` fails four of the six gates, `augment-top` fails all six. The flag stays off.** The code and the
tests are committed anyway, for the same reason the first three variants were: the arithmetic turns on how
much of the corpus is in the question's own language, and that changes.

## 2.6 Per question, win by win

**Banking, `augment` vs baseline** — `plain`: **0 gained, 0 lost**. `shipped`:

* gained (3, all Amharic): bk-030 (`zemen-international-banking-2-forex-service`, English gold),
  bk-039 (`coopbank-ufaqs`, English gold), bk-070 (`ethiotelecom-am-endekise-overdraft`, Amharic gold).
* lost (2, both Amharic, both with **Amharic** gold pages): bk-007 (`zemen-am-digital-services`),
  bk-075 (`ethiotelecom-am-mela-micro-credit`).

Net +1 question overall (72.2 → 73.3) and +2 on the cross-lingual slice (50.0 → 56.3), paid for with 1
same-language question (84.5 → 82.8). The pattern §4 found survives in miniature: **even when the English
rendering is forbidden to displace anything, giving the reranker more English candidates still costs an
Amharic page.** It is a far smaller price than max fusion's — 2 lost instead of 6 — but it is the same coin.

**Banking, `augment-top` vs baseline** — `plain`: gained bk-039; lost bk-004, bk-006, bk-026, bk-066,
bk-070. `shipped`: gained bk-018, bk-039; lost bk-007, bk-033, bk-074. Three of the five pages lost on
retrieval (bk-004, bk-066, bk-070) are among the six max fusion lost, so **pinning first place does not
save them**: they were not first, they were second or third, and a rescued English page merged in by score
took the slot.

**Travel, `augment`** — `plain` 0/0; `shipped` gained tv-030 (`special-needs-medical-case-passengers`),
lost tv-014 and tv-015 (`check-in-check-in-at-the-airport`, `check-in-check-in-process`). Net −1.
**Travel, `augment-top`** — `plain` lost 5 (tv-023, tv-039, tv-040, tv-045, tv-047), gained none.

**v3-agents, `augment`** — 0 gained, 0 lost, both columns. **`augment-top`** (same-corpus comparison) —
3 lost on retrieval, 1 as shipped, 0 gained.

## 2.7 What the two runs actually taught

1. **The promise held exactly.** Across 261 questions on three gold sets, `augment` changed the retrieval
   column on **zero** of them. A fusion mode that says it will not touch the original ranking, and then does
   not touch it on a live 18,611-chunk index, is worth having in the tree even switched off.
2. **The rescue only reaches the reranker, and the reranker is not always called.** The 0.03 gate skipped
   reranking on 28 of the 90 banking searches; on those the augment result is the baseline to the byte. The
   whole variant lives in the 62 that were reranked, and there it is worth +3/−2.
3. **Pinning top-1 is not enough.** The English rendering's scores are systematically higher than a
   cross-lingual Amharic cosine, so once the rescued pages are allowed to merge by score they take second
   and third place, which is where Page@3 is decided. `augment-top` protects one slot and loses the two
   behind it: banking same-language retrieval 86.2 → 79.3, travel 85.0 → 76.7.
4. **The cross-lingual gate needs a different lever.** The English gold page these 32 questions want is
   usually already in the candidate pool and merely below third — `augment` cannot rescue what was never
   missing. Moving it up means re-scoring it, which is max fusion, which sells the same-language slice.
   Nothing on the query side has yet escaped that trade; §7's remaining suggestion — Amharic pages for
   Dashen, CBE and CoopBank, i.e. the document side — is still the honest answer.
