# Local (BGE-M3) fallback: backfill to 100 % and whether it earns its keep — 2026-09-18

## What was wrong

`KnowledgeChunk.embeddingLocal` was missing for 6,543 of 23,463 chunks. The two big holes:

| source   | total | with local | missing |
|----------|------:|-----------:|--------:|
| business | 1,680 |          0 |   1,680 |
| banking  | 7,830 |      3,891 |   3,939 |
| law      | 4,446 |      3,612 |     834 |
| news     | 1,206 |      1,149 |      57 |
| page     |   204 |        171 |      33 |
| (all others were at 100 %) | | | |

The ingest's local pass stops at 300 chunks a run, so every pack that lands in one go (business, the banking
manual harvest) leaves thousands behind, and nothing catches up except more ingests.

**A partly-embedded source is worse than an unembedded index, not just "keyword-only".** When Gemini's query
embedding fails, `embedQuery` switches the whole search to BGE-M3 as soon as *any* chunk has a local vector.
Chunks without one then score zero on the vector side while every other source competes with a real cosine,
so the unembedded source is pushed out of the top results. Measured on the 60-question business gold set with
`ops/bini/rerun-retrieval-benchmark.js --gold business --force-embed-fail gemini`:

| business gold, Page@3 (retrieval / as shipped) | before       | after        |
|-----------------------------------------------|--------------|--------------|
| normal (Gemini)                               | 95.0 / 91.7  | (unchanged)  |
| forced Gemini failure → BGE-M3                | **5.0 / 5.0** | **88.3 / 91.7** |
| forced keyword-only (`--force-embed-fail all`) | 56.7 / 63.3 | —            |

At the midpoint (924 of 1,687 business chunks embedded) it was 68.3 / 68.3.

Banking gold (110 questions), same method:

| banking gold, Page@3        | before       | after        |
|-----------------------------|--------------|--------------|
| normal (Gemini)             | 71.8 / 70.9  | (unchanged)  |
| forced Gemini failure → BGE | 54.5 / 59.1  | 67.3 / 70.0  |
| forced keyword-only         | —            | 30.0 / 37.3  |

## How it was filled

The laptop route (`ops/knowledge/local-embed-export.js` → `embed_v3.py` → `local-embed-import.js`), no code
change: 6,543 chunks exported, embedded on the laptop (16 threads, BGE-M3, same settings as bina-embed; ~7 h
wall-clock including two laptop sleeps, ~2.5 h of actual compute), imported in three passes (import is
idempotent and skips re-chunked ids: 324 had gone by the end because the business/law texts were re-ingested
the same day). A final 469 (re-chunked business + law) were exported and embedded on the laptop in 8 min. One
server-side `--embed-missing 300` run was started and stopped at ~80 chunks when load hit 4.4 (mysqld/php-fpm
traffic, not the embedder) with steal at 30 %. Final: 23,686 / 23,686 chunks with a local vector; the live API
picked them up on its 10-minute reload (`/api/knowledge/health` → `embeddedLocal: 23686`). No restart, no
default changed.

## Verdict: keep the fallback — but only if coverage is kept at 100 %

- For business, BGE under a Gemini outage now matches Gemini as shipped (91.7 %) and beats keyword-only by
  ~28 points. For banking it is within 1 point of Gemini as shipped and nearly double keyword-only.
- The failure mode is the gap, not the model: with a source half-embedded, the fallback is *worse* than
  turning it off (business 5 % vs 57 %). So any pack ingest that leaves local vectors pending should be followed
  by the laptop route, not by waiting for the 300-per-run cap to catch up.
- A cheap guard worth adding later (not done here): report per-source local coverage in
  `/api/knowledge/health`, or have `embedQuery` fall back to keyword-only for the sources whose local coverage is
  below some threshold. Either would have caught this.
