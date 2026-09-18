# The daily channel watch — the first week

**Started:** 19 September 2026, 02:00 (the cron was installed 18 September 15:52 UTC)
**Filled in:** day by day, from `/var/log/bina-channel-watch.log` and `knowledge/watch/`. A row is written
from the log, never from memory, and an empty row means the watch ran and found nothing — which is the design's
expectation for most mornings, not a failure.

This file is a skeleton on the day it is committed. Everything under §2–§6 is to be filled from real runs.

---

## 1. What was measured before the first morning

A dry run against the live sources, 18 September 2026, 15:40 UTC — reading previews and feeds, classifying with
the model allowed, writing nothing and sending nothing.

| | |
|---|---:|
| sources read | 24 of 26 (`@etrade_gov_et` dormant, `@ethiopian_airlines` unverified — neither is asked for) |
| raw items read | 314 |
| inside the two-day window (since 2026-09-16) | 176 |
| dropped as already carried by another channel | 18 |
| sources that did not answer | 1 — `addisfortune-feed`, HTTP 502 |
| admitted | 16 |
| excluded by rule | 160 |
| unsettled | 0 |
| model calls | 5 |
| documents it would have written | 16 |
| packs it would have queued | `mor` (1), `eservices` (2) |
| documents it would have fetched | 3 — `fixedservices.ethiotelecom.et` ×2, `hple.moh.gov.et` |

**Against the plan's expectation of 6–10 admitted and 6–10 model calls.** The model half is inside it. The
admitted half is not, and the reason is worth writing down rather than normalising:

| what the 16 are | count |
|---|---:|
| pack-grade, and the watch is worth running for them | 7 — the customs notice (expiring 10 Oct, its own date read out of መስከረም 30 ቀን 2019 ዓ.ም), the ethio telecom fraud-report shortcode, the Fayda card printing note, the `fixedservices` self-service portal, two Ministry of Education notices, one Ministry of Health licence-exam notice |
| perishable tariffs and offers | 6 — telecom bundles, Ethio Call, a loan line, a Safaricom voice bundle, a telebirr bus-ticket note. Admitted by design (§5.4 keeps `perishable` as a class), and they are what makes the count look large |
| the three the rules should have refused | 3 — a Ministry of Health *consultative forum was held* item and two Addis Ababa Education Bureau PR items, every one admitted only because the word ብር appears in it. `TARIFF` is too wide a net for an office channel, and `CEREMONY` has ውይይት but not መድረክ or ምክክር |

**The defect the dry run found and this branch fixed:** ethio telecom and telebirr carry the *same*
announcements within minutes of each other — six pairs in one morning — and every one would have become two
documents. An item is now keyed on its own words and its day, and the channel that said it first keeps it.
23 documents became 16.

**Ranking, measured on the live index the same day** (the curated corpus as it stands, plus two fixture watch
documents in a temp root; `knowledge/watch/` was left empty):

| question | options built | what came back |
|---|---|---|
| የጉምሩክ ቀረጥ አዋጅ ምን ይላል? | `exclude: style, style-om, watch` | `law/customs-amendment-1425-2026-am`, 0 watch pages |
| የጉምሩክ ጽ/ቤት የስራ ሰዓት በዚህ ሳምንት ተቀይሯል? | `prefer: watch` | the watch item first (0.879) above the law (0.750) |
| what is the work permit fee in Ethiopia | `exclude: … watch` | `law/foreign-work-permit-mols-…-394-2016` first, 0 watch pages |
| how does a diaspora foreign currency account work | `exclude: … watch` | `law/diaspora-foreign-currency-account-nbe-fxd-01-2024` first, 0 watch pages |
| is there a new foreign exchange notice from the national bank | `prefer: watch` | the NBE watch item in the answer, beside the curated FXD directives |

And the gold set, scored on the live index: the curated page is in the top 6 for **10 of 10** plain questions,
at rank 1 for 8 of them, with **0** watch pages leaked into any of them.

---

## 2. Seven days, by source

`raw` is what the preview or the feed returned; `window` is what fell inside the two days; `admitted` is what
became a document. Fill one column per morning from the log.

| source | 19 Sep | 20 Sep | 21 Sep | 22 Sep | 23 Sep | 24 Sep | 25 Sep | total admitted |
|---|---|---|---|---|---|---|---|---|
| mols | | | | | | | | |
| nbe | | | | | | | | |
| ethiotelecom | | | | | | | | |
| telebirr | | | | | | | | |
| safaricom | | | | | | | | |
| ecc | | | | | | | | |
| efda | | | | | | | | |
| moh | | | | | | | | |
| moe | | | | | | | | |
| aa-land | | | | | | | | |
| aa-construction | | | | | | | | |
| aa-education | | | | | | | | |
| aa-justice | | | | | | | | |
| ebc | | | | | | | | |
| fana-tg | | | | | | | | |
| addisstandard-tg | | | | | | | | |
| capital-tg | | | | | | | | |
| ena-tg | | | | | | | | |
| reporter-tg | | | | | | | | |
| fana-feed-am | | | | | | | | |
| fana-feed-en | | | | | | | | |
| reporter-feed-am | | | | | | | | |
| reporter-feed-en | | | | | | | | |
| addisfortune-feed | | | | | | | | |

## 3. Admitted against excluded

| day | raw | window | duplicates | admitted | excluded | unsettled | model calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| 19 Sep | | | | | | | |
| 20 Sep | | | | | | | |
| 21 Sep | | | | | | | |
| 22 Sep | | | | | | | |
| 23 Sep | | | | | | | |
| 24 Sep | | | | | | | |
| 25 Sep | | | | | | | |

## 4. Documents fetched against pending

The offices that time out from this VPS are `mols`, `ecc`, `mint`, `fsc`, `egov`, `esl`, `daro` and `eeu`, so
this column is expected to have entries. Each one is named in that morning's note and can be fetched by the
laptop route into `/root/storage/packs/watch-manual/<host>/`.

| day | fetched | pending | which hosts |
|---|---:|---:|---|
| 19 Sep | | | |
| … | | | |

## 5. The eval, both halves

Run `node --env-file=.env ops/watch/channels/eval.js` at the end of the week and record both numbers. The
second column is the one that must not move.

| run | recent half (a watch page in the top 6) | plain half (the curated page in the top 6) | watch pages leaked into a plain answer |
|---|---:|---:|---:|
| 18 Sep, before any document | 0 % | 100 % | 0 |
| end of week 1 | | | |

## 6. Sources that went quiet or changed handle

A channel that posted nothing in seven days is a candidate for `active: false`; a handle found in an office's
own site footer is a candidate for the opposite. Both are edits to `ops/watch/channels/registry.json`, each
with its evidence written into the entry.

| source | what happened | what to do about it |
|---|---|---|
| | | |

**Already known before the week began:**

- `addisfortune-feed` answered HTTP 502 on 18 September. It answered 200 with 12 items when the registry was
  built on the same day, so this is intermittent, not gone. Two failed weeks in a row is the mark to act on.
- `mols`, `nbe` and `aa-justice` posted nothing inside the two-day window on 18 September. That is their normal
  cadence — 0.5, 0.5 and 0.17 posts a day — and not a fault.
- `@ethiopian_airlines` ships `verified: false` and is not read until Ibrahim says the channel is the airline's.

## 7. What to change after the week

To be written from §2–§6. The three candidates already visible from the dry run:

1. Narrow `TARIFF` so a post is not admitted on the bare word ብር, and add መድረክ and ምክክር to `CEREMONY`. Three
   of the sixteen admitted items on 18 September were admitted for no better reason than a price-like word.
2. Decide whether `perishable` should be written at all, or only named in the note. Six of the sixteen were
   telecom offers, and the pack-grade seven are what the watch exists for.
3. If a whole office posted nothing in seven days, say so in its registry entry rather than leaving the
   reader to wonder whether the watch was broken.
