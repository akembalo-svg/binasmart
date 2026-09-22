# Business pack: merging the near-duplicate investment pages

Date: 2026-09-22. Ibrahim's instruction: "merge the pages", "check gold".

## Why

The business pack's search quality had dropped from about 90-91.7% to 83.3-85.0%. Two earlier checks had already cleared the telecom pack and the search engine's model of any blame. The remaining real cause: several pages about Ethiopia's investment zones repeat each other so closely that the system keeps confusing them.

## What was read

Thirteen pages from the Ethiopian Investment Commission were read in full, including the main "why invest in Ethiopia" page and its five sub-pages.

## What was found

- Two pages open with the exact same paragraph about Ethiopia's economic transformation.
- Two other pages share their first two paragraphs word for word; only one of them also carries the real table of 14 industrial parks.
- Two sub-pages are word-for-word copies of sections already printed in full on the main page.
- **Three pages actually disagree with each other on real numbers**: Ethiopia's population is given as both 117 million and 120 million; the regional trade bloc is described as both 19 members serving 400 million consumers and 21 members serving 583 million. A third pair disagrees on the economy's growth rate. These three were **not merged**, because they are not simple duplicates, and the disagreement itself is worth knowing. I am flagging it here rather than guessing which figure is right.

## What was done

Four pages that were pure, confirmed duplicates were removed. The business pack went from 119 pages to 115, and from 1,734 to 1,716 searchable passages. Nothing else in the corpus changed.

## Gold questions checked

Before removing anything, every one of the 60 business test questions was checked against the pages being removed. **None of them targeted a removed page**, so no question needed to move. All 60 still point to real pages that are still in the pack.

## Before and after

| | Before this fix | After this fix | Original target |
|---|---|---|---|
| Business search quality (shipped) | 83.3-85.0% | 85.0% (two runs, same result) | 90.0-91.7% |
| Business search quality (Amharic) | — | 97.5% retrieval, 90.0% shipped | — |
| Business search quality (English) | — | 95.0% retrieval, 75.0% shipped | — |

One specific question that was failing, about the number of investment zones asked in Amharic, now passes. One other question, about shed rental costs, still fails: two different pages give two different real prices for two genuinely different things, and I did not force them together, because that would hide a real distinction rather than fix a duplicate.

**The fix is real but partial.** It closed part of the gap, not all of it. The business test still does not reach its target, so three of its checks still show red.

## Everything else, checked for damage

- **Telecom:** 96.7%, unaffected.
- **Banking:** 71.8% and 70.9%, an exact match to its known level.
</br>
- **Travel:** 85.0% and 81.7%, within its known range.
- **Dr Afiya and Asmat:** both close to their usual level. Business pages are excluded from both by design, so this pack change should not touch them, and the small differences look like the normal run-to-run variation already known from before.
- **Full test suite:** 2,140 of 2,151 pass. Seven of the eleven failures are known and unrelated to this work. The other four are the business target still not being met, which is the open problem above.

## What is committed

One commit, pushed to GitHub: it removes the four duplicate files and updates the business pack's source list with a note explaining each decision.

## What is still open

- The business search quality has not returned to its old level. The remaining failure looks like a real, hard case rather than a duplicate: two genuinely different pages that a reader could reasonably want, competing for the same question.
- One more question started failing that had not failed before; it may or may not be related to this change, and I could not fully confirm which.
