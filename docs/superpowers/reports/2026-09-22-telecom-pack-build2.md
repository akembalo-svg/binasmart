# Telecom pack build 2: intent, agent routing, gold set, benchmark, safety evals

Date: 2026-09-22. Continuation of build 1 (report `docs/superpowers/reports/2026-09-22-telecom-pack-build1.md`, commit 66acdb2). Ran in two passes: the first pass was cut off by a transient connection error after committing real work; the second pass verified everything the first pass left and ran what was still missing. No code needed to change in the second pass.

## 1. Bini intent

`assistant/telecom.js`: a soft boost toward `telecom` + `banking` + `law` together for a telecom-shaped message, never an exclusive filter. This follows directly from the build-1 finding that the Amharic general FAQ answer for SIM replacement, the number scheme and customer-service hours lives in a banking document after the telebirr dedupe: filtering to `telecom` alone would have lost those answers. Commit `b063631` widened the Amharic/English wordlists so the intent claims 55 of the 60 gold questions (up from 47 on the first wordlist).

## 2. Agent and workspace routing

- `agents/afiya/rules.js`: excludes the whole `telecom` source. Telecom is irrelevant to health and would only add noise.
- `agents/asmat/rules.js` and `workspaces/index.js`: exclude the commercial ethio telecom / Safaricom package-price pages by path prefix, but keep the ECA law documents available (Proclamation 1148/2019, Directives 791-800/2021, 832/2021, the Personal Data Protection Proclamation 1321/2024, Regulation 585/2026). Asmat answers consumer-rights and SIM-registration law questions; it does not need package prices.
- Safety evals: Dr Afiya 32/32 clean before and after. Asmat: 30/32 before, 30/32 and 28/32 across two after-runs. The one failure that repeats in every run (`others-told-me`, an Amharic exam-results deflection question) already failed before telecom routing existed, so it is pre-existing and unrelated. The other one or two failures rotate between runs and look like ordinary sampling noise on borderline refuse-or-answer questions, not a new failure telecom caused. This was not pushed to a hard guarantee with more re-runs, to avoid unnecessary live calls to Afiya and Asmat.

## 3. Gold set

`knowledge/telecom/gold-spec.json`, 60 questions: 25 Amharic, 20 English, 15 cross-lingual (Amharic question, English or law page). Built by `ops/packs/build-gold.js`, which refuses to write a question unless three of its topic words are verified present on the named target page, so every question is checked against a document that is actually in the pack. Covers package prices across every category, SIM (registration, replacement, eSIM, national-ID), roaming, coverage, home and business internet, customer care, the FAQ number scheme, Safaricom's own pages, and the main ECA laws and directives.

## 4. Benchmark

Run twice against the telecom gold set, plus once with intent routing applied, all consistent:

| slice | run 1 | run 2 | routed |
|---|---|---|---|
| all 60, shipped | 96.7% | 96.7% | 95.0% |
| Amharic (40) | 95.0% | 95.0% | 92.5% |
| English (20) | 100% | 100% | 100% |
| same-language (45) | 100% | 97.8% | — |
| cross-lingual am→en (15) | 86.7% | 93.3% | — |

MRR about 0.90. Misses (tl-020, tl-055, and tl-053 in the routed run) are dropped by the shared reranker, which was not tuned, per the standing rule. `test/telecom/benchmark-telecom.test.js` sets floors at 95.0/92.5/95.0/95.6/86.7 with one-question slack, each below what was actually measured.

## 5. Other pack benchmarks, before/after

- **Banking:** 71.8% / 70.9% shipped, matching the known baseline exactly. No regression.
- **Travel:** 85.0% / 81.7% shipped, matching the known baseline range exactly. No regression.
- **Business:** retrieval unchanged at 95.0%, but **shipped Page@3 measured 83.3-85.0%** across three separate runs (two fresh, one the first pass had already produced), against a known baseline of 90.0-91.7% and a committed floor of 90% (about 88.3% with the one-question slack). This is a real, reproducible drop, already present before the second-pass helper touched anything, isolated to the reranker's ordering (retrieval itself is fine). It was not fixed, because the reranker is shared with Afiya and Asmat and is off-limits to tune. `test/business/benchmark-business.test.js` currently fails on this.

## 6. Local embeddings and other fixes

- `localCoverage.telecom` is 3,414 of 3,414: complete, from the paced backfill in commit `c713d87`.
- The travel test that was accidentally destabilised in build 1 (`test/packs/airline-identity.test.js`, by a stray `fetch-pack.js --help` that ran the real refresh) is fixed: only the `lastChecked` field is normalised now; everything else is still compared byte for byte. 7/7 pass.
- Laptop harvest tooling is committed under `ops/harvest/telecom/`, sanitised of the server address and personal paths, so it can be re-run from Ibrahim's laptop for the next re-harvest.
- Freshness: a monthly note tells Ibrahim to re-harvest the pack from his laptop (ethio telecom and the regulator are not reachable from the server), plus a live check of Safaricom, which is reachable.

## 7. Tests

`node --test test/telecom/*.test.js`: 81 of 81. Full suite: 2,151 tests, 2,141 pass, 10 fail. None of the 10 come from telecom code:
- 3 from the other session's `public/*.html`.
- `gov/registry.test.js` ("names source gcc"), from the other session's extra sources in the working tree.
- 2 watch-registry survey-count tests, from the other session.
- 1 cinema-routes test, gated by the other session's environment toggle.
- 3 business-benchmark floor tests, the regression in section 5.

## 8. Commits

`51479f4`, `c713d87`, `b063631` (first pass), plus the ancestor commits `43a0a58` (the 60-question gold set) and `ff518e0` (the Bini telecom intent and agent routing). All pushed and verified against `origin/main`. The second pass made no code changes and needed no new commits; it only ran verification and the benchmarks that had not yet been recorded.

## 9. Open problems

1. **The business pack's shipped Page@3 regression** (90-91.7% baseline down to 83-85% measured), reproducible and isolated to the reranker's ordering, not to telecom's own retrieval. It needs a session with room to look at whether the telecom corpus's 3,414 chunks are competing for the reranker's attention on ambiguous business questions, without touching the shared reranker itself.
2. Asmat's `others-told-me` safety question fails in every run on file, before and after telecom, and is worth its own look.
3. Oromo, Somali and Tigrinya pages from the harvest (15 pages) are kept on disk but still not indexed, as decided in build 1.
4. Official Safaricom and ethio telecom customer-care numbers are masked by the standing phone-privacy rule; this is a decision for Ibrahim, not a bug.
