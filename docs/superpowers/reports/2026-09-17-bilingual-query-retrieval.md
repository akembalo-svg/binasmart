# Bilingual query retrieval — measured, switchable, and left off

2026-09-17. BinaSmart shared knowledge RAG (`knowledge/index.js`), 18,611 chunks, live server.

**Decision: NOT kept on.** The code, the flag and the tests are in the tree;
`KNOWLEDGE_BILINGUAL_QUERY` defaults to `0`, and with it off retrieval is — measured, not assumed —
byte for byte what it was before. The experiment is switchable because it is worth re-running when the
corpus changes; it is off because on the pack it was built for it moves the shipped number **down**.

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
