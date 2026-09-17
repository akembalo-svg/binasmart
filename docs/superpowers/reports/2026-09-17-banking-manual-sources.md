# The manual harvest, folded into the banking pack — report

**Date:** 2026-09-17 · **Task:** 15a, the follow-up §10.1 of `docs/superpowers/reports/2026-09-16-banking-knowledge-pack-report.md` asked for.
**What it does:** the National Bank of Ethiopia, telebirr and M-PESA — the three sources the pack was missing, and the ones §2 called *"the hole to say out loud"* — are now curated documents in `knowledge/banking/`, built from bytes fetched by hand on a machine where those hosts answer.

> **Read §7 first.** One gate did not hold. The travel pack's retrieval benchmark fell from 86.7 % to 85.0 %, by exactly one question, and two `npm test` assertions that pin the banking benchmark's floor now fail. Neither threshold was moved to make a run pass. §7 says which questions, what outranked them, and why the honest reading is a stale gold set rather than a worse retriever — and §9 hands both to Task 15b.

---

## 1. What was integrated

The pack went from **234 documents to 404**. Every one of the 170 new documents was rendered by `ops/packs/fetch-pack.js` through the same `extract` → `stripPackBoilerplate` → `renderDoc` → `writePack` path as a fetched page, with the url and the date taken from the harvest's `manifest.json` rather than from the clock.

| host | documents | how |
| --- | --- | --- |
| `nbe.gov.et` | **96** | 51 HTML pages + **45 PDFs** |
| `www.ethiotelecom.et` (telebirr) | **58** | HTML only |
| `m-pesa.safaricom.et` | **16** | 15 HTML + 1 document built from the captured tariff JSON |

### 1.1 By language

| source | en | am |
| --- | --- | --- |
| National Bank of Ethiopia | 85 | 11 |
| Ethio telecom — telebirr | 30 | **28** |
| Safaricom Ethiopia — M-PESA | 16 | 0 |
| *(the pack as a whole)* | **345** | **59** |

telebirr nearly doubles the pack's genuinely Amharic material: before this task the pack had 31 Amharic documents, all of them Zemen's; it now has 59, and 28 of them are telebirr's own Amharic pages — the tariff, the FAQ, registration, deposit, withdraw, send money, bill payment and international remittance.

### 1.2 By section

| source | sections |
| --- | --- |
| National Bank of Ethiopia | forex 32, regulator 20, amharic 17, payments 10, inclusion 6, help 5, rules 4, currency 1, rates 1 |
| Ethio telecom — telebirr | mobile-money 26, digital 8, loans 8, accounts 6, help 6, fees 2, remittance 2 |
| Safaricom Ethiopia — M-PESA | business 7, agents 3, help 3, accounts 1, fees 1, mobile-money 1 |

`forex`, `payments`, `inclusion`, `currency`, `mobile-money` and `agents` are new section keys; `rates`, `help`, `rules`, `regulator`, `accounts`, `loans`, `fees`, `remittance`, `digital`, `business` and `amharic` are the pack's existing ones, reused.

---

## 2. The 45 PDFs, and the 58 that are photographs of paper

564 PDFs were harvested. **105** of them are about a question a bank customer actually asks; the insurance, reinsurance, microfinance-licensing, capital-goods-leasing, annual-report, quarterly-bulletin and macroeconomic-statistics series are not, and were never opened.

Then the measurement that decided everything else. `pdftotext -layout` was run over all 105 on 2026-09-17:

- **47 yielded text.**
- **58 yielded NOTHING AT ALL** — zero characters. The National Bank publishes a great many of its directives as scanned images with no text layer.

Two more were dropped as not-a-rule (the monthly interbank-rate tables, a conference slide deck, a press release about one auction) and three as byte-for-byte duplicates uploaded under two spellings, which leaves **45**, every one of them named individually in `knowledge/banking/sources.json` → `nbe.allowPdf`. Not a pattern: a list.

| topic | n | what it answers | largest / smallest, in characters of extracted text |
| --- | --- | --- | --- |
| forex | 30 | the master foreign-exchange directive FXD/01/2024 and its amendments FXD:3:2025, FXD:04:2026 and FXD/05/2026; the Foreign Exchange Market Guideline, Auction Guidelines and Code of Conduct; the Policy on FX-Trading Related Spreads and Fees; franco valuta imports (FVD/01/2026); the licensing of five non-bank forex bureaus in English *and Amharic*; and the fxd-07-1998 … fxd-68-2020 series, so a directive can be cited by number | 178,271 (FXD/01/2024) / 1,290 |
| payments | 6 | the payment-instrument-issuer and payment-system oversight rules, the National Digital Payment Strategy (2023 and the 2026–2030 draft), the Interoperable QR Standard and the P2M scheme rule book — the rules telebirr and M-PESA operate under | 285,792 / 33,834 |
| inclusion | 6 | financial-inclusion directives FIS-01-2012 and fis-03-2020 (the cash-withdrawal limit), the National Financial Inclusion Strategy II, the National Financial Education Strategy, and the Financial Education Module for Youth and MSME in **both** English and Amharic | 284,572 / 8,032 |
| proclamation | 2 | the Banking Business Proclamation 592 and the NBE Establishment Proclamation 591 | 114,645 / 57,452 |
| rates | 1 | **NBE/INT/13/2026 INTEREST RATES (AS AMENDED)** — the interest-rate directive §2 said the pack could not cite | 7,894 |

Each is capped at **60,000 characters** of extracted text, which is about twenty pages; four of the 45 hit that cap.

### 2.1 What is still missing, and it matters

The 58 with no text layer include documents customers ask about by name:

- **FCP-01-2020**, the Financial Consumer Protection directive.
- All five **currency-management** directives (CMD-01-2022, CMD-298-2023, cmd-02-2021 in English and Amharic, cmd-03-2013).
- The **credit-reference-bureau** directive crb-02-2019 and the movable-collateral directives MCR-01-2020 and MCR/02/2020.
- **SBB-59-2014 Fraud Monitoring**, the cyber-security awareness leaflet.
- **Banking Business Proclamation 1360/2025**, the current one.
- **ONPS-02-2020** and **ONPS/04/2021**, the payment-instrument-issuer directives themselves — the pack holds the oversight documents around them but not these two.
- **NBE-INT-12-17**, the interest-rate directive the 2026 one amends.
- **Limits-of-Birr-holding** and the 2021–2023 fxd-69 … fxd-86 series.

These are reachable and harvested; they are simply pictures. OCR is the only way in, and it is a decision for Ibrahim, not something this task should have improvised.

Separately: the **Money Laundering proclamation** (22.2 MB) and the current **NBE Proclamation 1359/2025** (45.2 MB) were skipped by the harvester's own 15 MB cap and are not in the harvest at all.

---

## 3. What was excluded, and how that was decided

Every exclusion below was measured on 2026-09-17, not assumed.

**National Bank of Ethiopia.**

| excluded | why |
| --- | --- |
| `/files/` — 304 landing pages | **303 of the 304 extract no text at all.** The title and the category render; the PDF link is attached by JavaScript. Taking them would have written 303 empty documents. The pack takes the PDFs instead. |
| `/bank/`, `/insurers/`, `/microfinance/`, `/pso/`, `/piipso/`, `/capital_goods/`, `/independent-forex-bu/` — 163 directory cards | every one of them extracts nothing, for the same reason |
| `/governace/` and `/am/governace/` — 133 pages | biographies of board members and directors |
| `/exchange` | the daily rate table is drawn by JavaScript; the harvest caught the 345-character note above it and nothing else. **The daily FX rate is not in this pack.** |
| `/treasury-bills`, `/open-market-operations` | 252,000 characters of auction-result tables — a statistic, not a rule a customer can act on |
| news, events, archives, surveys, RSVPs, the museum, the brand guidelines, the strategic plan, the governor's message | not money questions |

**Ethio telecom.** Everything outside telebirr was never harvested. The Tigrinya versions (12 pages) are dropped — this pack is English and Amharic — and so are the `?lang=om` and `?lang=so` variants, which served English anyway. Four Ethiopic-slug URLs are denied by name because the CMS publishes the same page twice: one slug literally contains `https-www-ethiotelecom-et-`, one is an older Amharic FAQ (በተደጋጋሚ የተነሱ) superseded by `/telebirr/faq?lang=am` (በተደጋጋሚ የሚነሱ), and two are Ethiopic copies of Bulk Payment and Donation that already exist under their English slugs. **Sixteen further duplicates were caught by the importer's own same-text rule rather than by a pattern.**

**M-PESA.** The `www.safaricom.et` host is gone from this entry entirely: its three harvested pages hold no M-PESA content, and the registry now names `m-pesa.safaricom.et`. Three pages of that site are deliberately not allowed, and it is the most consequential exclusion in this report — see §5.2.

---

## 4. The no-duplicate change

The rule the pack has always stated — *one or the other, never both* — was applied.

1. `nbe` and `ethiotelecom` were **removed from `knowledge/sources-am.json`**, the web crawler's registry, with a note in its `_about` saying why and telling the next engineer not to add them back.
2. `knowledge/web/nbe` (392 KB, 60 pages) and `knowledge/web/ethiotelecom` (328 KB, 40 pages) were **deleted from disk**. The registry alone was not enough: `knowledge/index.js` line 219 reads *every* directory it finds under `knowledge/web`, so a source removed from the crawler's list keeps being loaded until its folder goes. Both directories are gitignored, so nothing was committed and nothing was lost from the repository.
3. The next ingest **collected 889 orphaned chunks** — `[knowledge] ingest: 1399 docs, +3196 chunks, -0 stale, -889 orphaned` — and a direct count of the index now returns **0** chunks whose source is `web` and whose slug begins `nbe/` or `ethiotelecom/`.
4. `references.web-nbe` and `references.web-ethiotelecom` in `knowledge/banking/sources.json` are rewritten as RESOLVED, recording what was dropped and the fact that deleting the folder was necessary.

---

## 5. Two things the importer had to be taught, found by running it

### 5.1 `/fx` was written as `nbe-.md`

The slug rule treats a leading two-letter path segment as a locale prefix and drops it — the airline's `/et/`, `/aa/`. `https://nbe.gov.et/fx` has exactly one segment, `fx`, so the rule dropped it and produced an empty slug: the single most important page on that host was written to disk as `nbe-.md`. `/am` had the same problem. Both are now named by hand in `pathSlugs`, and the note in the registry says so in those words rather than describing the fix.

### 5.2 The M-PESA FAQ came out at ZERO characters

`/faqs` extracts 23,865 characters and holds the wallet limits — the whole reason the M-PESA source is worth having. It came out of the first import **empty**.

The cause: `/business`, `/mpesa-agent` and `/contact-us` each embed the entire FAQ block. That put the FAQ text on 4 of 23 pages, over the 15 % share at which `knowledge/index.js` calls a paragraph site template and strips it from every page carrying it. The FAQ page, whose whole body is that block, had nothing left.

Measured both ways on 2026-09-17: with those three pages allowed, `mpesa-faqs.md` is 0 characters and the M-PESA limits are in no document at all; with them denied, it keeps **23,633** characters including the Level-2 balance and the daily limit. Their own unique copy — 2,466, 1,595 and 751 characters of hub text — is what that costs. The registry's `denyNote` records the measurement.

### 5.3 Six Amharic URLs are English pages

Six of the National Bank's `/am/` pages are index screens whose links are all in English: `/am/ህጎች/መመሪያዎች` holds 173 Ethiopic characters, which is the header this repository wrote and essentially nothing else. The importer now **measures** the Ethiopic share of a page's text and records the language it finds, not the language the url claims — floor 300 characters, the same floor `test/banking/pack-docs.test.js` already used to decide whether a page marked Amharic really is. It only ever demotes, never promotes. Without this, six English pages would have sat in the Amharic slice of every benchmark.

---

## 6. Verification

### 6.1 Eight documents, read

Every line below was read out of the file on disk on 2026-09-17.

| document | characters | one figure, quoted |
| --- | --- | --- |
| `nbe-summary-of-banks-foreign-exchange-related-fees-and-charges.md` | 7,255 | `1 \| Abay Bank \| 4% (1% LC Opening Commission + 3% Service Charge) \| 4% Service Charge \| …` |
| `nbe-foreign-exchange.md` (`/fx`) | 16,261 | "Banks can provide up to USD 5,000 … for personal travelers who travel outside Ethiopia" |
| `nbe-fcpe.md` (consumer protection, bilingual) | 16,143 | `የፋይናንስትምህርት ለወጣቶች፣ ለጥቃቅን፣ አነስተኛና መካከለኛ ኢንተርፕራይዞች` |
| `nbe-directive-no-nbe-int-13-2026-interest-rates-as-amended.md` (a PDF) | 12,227 | "INTEREST RATES (AS AMENDED) … it has become necessary to amend the interest rate Directive" |
| `ethiotelecom-telebirr-telebirr-pricing.md` | 2,605 | `5 \| 5001 to 75000 \| 8` — the telebirr-to-telebirr band table, in full |
| `ethiotelecom-am-telebirr.md` | 44,494 (31,407 Ethiopic) | `በየትኛውም የአገሪቱ ክፍል ለሚኖሩ ቤተሰቦችዎ፣ ጓደኞችዎ ወይም ለሚወዷቸው ሰዎች … ገንዘብ በፍጥነት ለመላክ ያስችልዎታል።` |
| `mpesa-faqs.md` | 25,214 | "if you are a Level 2 customer with a 100,000 Birr account limit …"; "Maximum balance across all your accounts is 30,000 Birr. Daily transaction limit is 30,000 Birr." |
| `mpesa-tariff.md` | 2,225 | `Send Money to registered customer \| >3,000 birr \| 3 Birr` |

`mpesa-tariff.md` is the one hand-shaped document: its body is the bands exactly as the site's own calculator gave them, followed by the sentence *"Captured from the M-PESA site's own fee calculator on 2026-09-16"* and the calculator's url. It is rendered by `renderDoc` like every other document and carries the same header and the same disclaimer.

### 6.2 The ingest

| | before | after |
| --- | --- | --- |
| documents in `knowledge/banking` | 234 | **404** |
| chunks, source `banking` | 1,695 | **4,922** |
| chunks, source `web` | 4,425 | **3,536** (−889, the orphaned `nbe/` and `ethiotelecom/` pages) |
| corpus, all sources | 16,179 | **18,611** |
| chunks with an embedding | 16,179 / 16,179 | **18,611 / 18,611** |

Three ingest passes in all (one of them the 03:30 UTC nightly cron, which did the bulk and collected the orphans), each finishing at `embedRemaining: 0`. The *local* BGE index is 3,001 chunks behind at 300 a run — that is the own-model stage-1 experiment, not production retrieval, and the nightly job will catch it up.

### 6.3 pm2 and health

`pm2 restart binasmart-api` three times across the task; `/health` answered **HTTP 200** each time (`{"ok":true,"service":"binasmart-api"}`, 0.01 s). The error log holds nothing new — one Fastify deprecation warning about `ignoreTrailingSlash`, and older `[asmat]`/`[bini]` lines predating this work.

---

## 7. What the live checks and the benchmarks actually said

### 7.1 The five live answers

Through `POST /api/assistant` with `x-binasmart-eval: 1`, paced 4 s, so nothing landed in the ordinary conversation records.

**1. `የባንክ ብድር ወለድ ስንት ነው?` — the question the Task 14 close-out caught giving rates with no date. FIXED, with a caveat.**

> "**የኢትዮጵያ ንግድ ባንክ** በ3 መስከረም 2026 ባሳተመው መረጃ መሰረት፣ ለቁጠባ ሂሳቦች ከ7% እስከ 14% ወለድ ሲሰጥ … **የኦሮሚያ ኅብረት ሥራ ባንክ** ለዲያስፖራ ማኅበረሰቦች … የወለድ መጠኑም በዓመት ከ 8.5% ይጀምራል። … ይህ መረጃ በ25 ነሐሴ 2026 በታተመው ገጻቸው ላይ ይገኛል"

Every figure now carries a date, which is what the close-out asked for. **But the dates are wrong**: those documents were fetched on 2026-09-16, not on 3 September or 25 August. See §7.3 — Bini is reading dates off the page, not off the document's provenance line, because the provenance line is not in the chunk it was given.

**2. "can you check my balance" — was broken, now FIXED.**

Before this task's second guardrail pass the answer was: *"I can help you check your balance for Ethio telecom's telebirr service. You can dial \*804# …"* — **no refusal and no warning.** The cause was not the guardrail: `balance` on its own is a WEAK intent word and one weak word is not two, so `assistant/banking.js` GUARDRAILS **was never added to the prompt at all**. The possessive forms (`my balance`, `check my balance`, `my transactions`, `ሂሳቤ`, …) are now STRONG words. After that:

> "I can't directly access anyone's personal bank or telebirr accounts, including yours, to check balances or view transactions. That information is always kept private for your security. To check your balance, you can usually do it directly through your bank's mobile app … **Please remember, never share your account number, card number, PIN, one-time code, or password with anyone in a chat, including me or someone who says they are from your bank. A bank will never ask for your PIN or OTP.**"

Refusal first, how-to second, the warning in full. This is the clause §5.3 of the previous report found silently unfired.

**3. "what does telebirr charge to send 1,000 birr to another telebirr user?" — the figure is MISSING, and the reason is a safety feature.**

> "This is based on Ethio telecom's telebirr pricing as published on 17 September 2026. Keep in mind that fees can change …"

No figure. A control question proves the document is fine:

> **Q.** "what is telebirr's tariff for a telebirr-to-telebirr transfer in the 501 to 1500 birr band?"
> **A.** "For a telebirr-to-telebirr transfer in the 501 to 1500 birr band, the tariff is **4 Birr**, as published on Ethio telecom's telebirr pricing page [4] (fetched on 17 September 2026)."

The tariff page prints **bands**, not amounts: `501 to 1500 | 4`. The string `1,000` appears nowhere in it. So an answer saying "sending 1,000 birr costs 4 birr" contains a digit the source does not, and the grounding guard (`reference_binasmart_grounding_guard`) strips that sentence — correctly, by its own rule — leaving the fragment above. **Bini cannot place a customer's amount inside a published band.** That is a real limitation, it is the guard doing its job, and it is not something this task should have loosened. It goes to 15b.

**4. "how much can I keep in M-PESA?" — answered, attributed, dated.**

> "With M-PESA, the maximum balance you can keep across all your accounts is **30,000 Birr**, as stated on Safaricom Ethiopia's M-PESA FAQ page, fetched on 17 September 2026. … the daily transaction limit is 30,000 Birr. International money transfers, utility, and fuel payments are exempt from this limit according to the National Bank of Ethiopia regulation."

Correct and attributed. Two things to note honestly: the document's `fetchedAt` is **2026-09-16**, not the 17th Bini gave; and the question was expected to surface the **Level-2 100,000 Birr** cap, which is in the same document (§6.1) — Bini gave the across-all-accounts cap instead. Both true, neither invented.

**5. "what is the NBE rule on how many dollars I can take abroad?" — right figures, NO DATE. Not fixed.**

> "For personal travel … banks can provide up to **USD 5,000** … If you're traveling for business, you can get up to **USD 10,000** … you can also take up to **10 %** of the outstanding balance in your foreign currency account in a debit card per travel … You can find more details on the National Bank of Ethiopia's website: https://nbe.gov.et/fx"

Every figure is correct and comes from `nbe-foreign-exchange.md`. The institution is named, the page is linked, and **there is no date anywhere in the answer**. The guardrail was strengthened three times over this task — a standalone capitalised clause, a read-back-before-sending instruction, and an explicit "A LINK IS NOT A DATE" — and this answer still has none. §7.3 says why, and it is not a prompt problem.

### 7.2 The date clause: 3 of 5 carry a date, and the two that do not have a mechanical cause

| question | figures | date |
| --- | --- | --- |
| Amharic loan rate | yes | yes, but **wrong** (3 መስከረም / 25 ነሐሴ 2026 for a document fetched 2026-09-16) |
| balance | none — refusal | n/a |
| telebirr 1,000 birr | **stripped by the grounding guard** | yes |
| M-PESA holding limit | yes | yes, one day out |
| NBE travel allowance | yes | **no** |

### 7.3 The root cause, measured

`nbe-foreign-exchange.md` is chunked into **27 chunks. Exactly one of them contains the word "fetched".** The chunk that actually holds the travel-allowance answer — 1,415 characters beginning *"How much foreign currency can a traveler receive from banks for each travel…"* — does not. Of the 14 chunks anywhere in the pack containing the string `USD 5,000`, **12 carry no date either**.

Each chunk's header is `<document title> › <section heading>`. It carries the title. It does not carry the url or the fetched date.

**So the guardrail is asking Bini for something the context does not contain.** When Bini does produce a date it is either reading one off the page's own body text (which is where 3 መስከረም 2026 and 25 ነሐሴ 2026 come from) or taking it from the one chunk in the document that happens to carry the header. This is the root of §11 risk 6 of the previous report — *"the provenance date is not enforced"* — located precisely for the first time. Fixing it means putting the fetched date into every chunk's header in `knowledge/index.js`, which re-hashes and re-embeds all 18,611 chunks of every source. That is a task of its own and it is written up for 15b in §9.

### 7.4 The benchmarks — and the gate that did not hold

| gold set | before (16,179 chunks) | after (18,611 chunks) | result file |
| --- | --- | --- | --- |
| travel | 86.7 % retrieval / 83.3 % as shipped | **85.0 % / 83.3 %** | `retrieval-gold-travel-20260917-042822.json` |
| banking | 66.7 % / 63.3 % | **56.7 % / 56.7 %** | `retrieval-gold-banking-20260917-042932.json` |
| v3-agents (Afiya + Asmat) | 96.4 % / 98.2 % | **96.4 % / 99.1 %** | `retrieval-gold-v3-agents-20260917-043119.json` |

**v3-agents holds.** Retrieval is 96.4 % for the fourth corpus size running. Afiya 96.3 / 98.1, Asmat 96.5 / **100.0**; Amharic 94.5 / 98.6, English 100.0 / 100.0. Nothing in the Afiya or Asmat slices moved down.

**The travel gate failed by one question, and the one question is identified.** `git status --short knowledge/travel` is empty and `--rerender --dry-run` reports 0 of 114 travel documents changed, so the airline pack did not move by a byte; the corpus around it grew by 2,432 chunks. The one question:

> **tv-053**, Amharic, gold page `travel:essential-information-credit-card-restriction`. Retrieval rank **1 → 4**. The three pages now above it are `banking:ethiotelecom-am-endekise-overdraft`, `banking:ethiotelecom-am-sanduq-saving` and `banking:ethiotelecom-am-telebirr` — an Amharic question about a card restriction now pulls Amharic telebirr credit and saving pages.

Mitigation, stated as a fact rather than an excuse: **as shipped is unchanged at 83.3 %**, and tv-053 was *already* being dropped by the reranker before this task (`shipped` was false, rank `null`, both before and after). The number a user experiences did not move. The pre-rerank number did.

**Banking fell 10 points, and in four of the six cases a better page won.**

| question | was | now top of the list instead |
| --- | --- | --- |
| bk-004 (am, "digital remittance", gold `zemen-am-digital-remittance`) | rank 3 | `dashen-how-to-transfer-money-from-abroad`, `zemen-am-digital-services`, **`ethiotelecom-am-international-remittance`** |
| bk-028 (am, gold `dashen-remittance`) | rank 2 | **`ethiotelecom-am-international-remittance`**, `ethiotelecom-am-telebirr` |
| bk-018 (am, account opening, gold `cbe-misalliance-account-opening`) | rank 3 | `zemen-am-faq`, **`ethiotelecom-am-telebirr`** |
| bk-021 (am, overdraft, gold `coopbank-…-overdraft-facility`) | rank 3 | **`ethiotelecom-am-telebirr`** — but **as shipped improved, rank 3 → 1** |
| bk-050 (en, diaspora account, gold `dashen-diaspora-demand-current-account`) | rank 3 | **`nbe-foreign-exchange`** — the FX directive — then two other banks' diaspora pages |
| bk-014 (am, tariff, gold `cbe-misalliance-terms-and-tarrif`) | rank 3 | `law:debts-cheques-limitation`, `nbe-p2m-scheme-rule-book` — **as shipped still rank 1** |
| bk-015 | retrieval rank 1 both times | dropped by the reranker this run; retrieval did not move |

An Amharic question about sending money home now returns telebirr's own Amharic remittance page above a bank's English one. That is the pack working. The gold set names one page per question and cannot credit a better one, and four of these six are exactly that. It is not proof that nothing regressed — bk-014 and bk-018 look like genuine dilution — but it is why the number cannot be read as "retrieval got worse" without a gold set that knows these sources exist.

### 7.5 `npm test`: 1,503 pass, **2 fail**

The two failures are both in `test/banking/benchmark-banking.test.js`, which pins the floor the last measured run achieved:

- `the right page is in the top three at least as often as it was measured` — as shipped is 56.7 %, the pinned floor is 61.7 %.
- `the Amharic slice is not carried by the English one` — the Amharic slice is 50.0 %, the pinned floor is 60.0 %.

**Neither floor was lowered.** That file's own instruction is *"Raise these thresholds when that gap is closed, never to make a run pass"*, and re-pinning a floor inside the task that moved it is the move it warns against. The two assertions are left red, with §7.4 as the evidence, so that whoever rebuilds the gold set in 15b re-pins them against a set that can see these documents. Everything else in the suite is green, including all 132 tests in `test/banking/` and `test/packs/`.

---

## 8. What is in the repository, and what is not

Committed: the importer, the registry, the 170 new documents, the sidecar and the guardrails. **Not committed, and never to be:** the harvest itself — 1,447 files and 1.54 GB at `/root/storage/packs/banking-manual/`, outside `knowledge/`, gitignored by being outside the tree entirely. No key, token or credential is in any of it.

New and changed code:

- `ops/packs/fetch-pack.js` — `--from-dir`, `dirKeyOf`, `selectDirEntries`, `fetchDir`, `readPdfText`, `pdfSlugOf`, `tariffDocFrom`, `langOfText`, per-document `fetchedAt` in `writePack`, `matchFlags` on a section, and `assignSlugs` taught a second name-required rule.
- `ops/packs/freshness.js` — a `dir` site is skipped by the weekly fetch and **kept in the weekly door-knock**, because the day `nbe.gov.et` answers this server reliably is the day the hand harvest can stop.
- `test/packs/fetch-pack-fromdir.test.js` — new, 9 tests: the manifest's url and date on the document, allow/deny including the query string, a non-200 and a non-HTML entry ignored, another host ignored, a PDF opened only when `allowPdf` names it and never otherwise, the unnamed-path refusal, and the language rule.
- `test/banking/bini-banking-guardrails.test.js` — new, 10 tests on the two clauses and the intent words.
- `knowledge/sources-am.json`, `test/banking/sources.test.js`, `test/banking/pack-docs.test.js`, `test/banking/freshness-banking.test.js` — the de-duplication and the rules above.

---

## 9. What Task 15b must do

1. **A second gold batch — 30 questions on these sources.** telebirr fees and limits by band, M-PESA limits and KYC, NBE directives by number (FXD/01/2024, NBE/INT/13/2026, the payment-instrument-issuer rules), the FX travel allowance, the complaint procedure. Roughly half in Amharic, and — because telebirr gives the pack 28 genuinely Amharic pages — a slice of Amharic questions whose gold page is itself Amharic, which §3.3 of the previous report showed is worth 40 points of retrieval. **Then re-pin the two floors in `test/banking/benchmark-banking.test.js` against the combined set, and say in the file that the 61.7 %/60.0 % floors were measured against a gold set written before these sources existed.** The gold questions are deliberately **not** written in this task.
2. **Put the fetched date in the chunk header.** §7.3 is the finding: 26 of 27 chunks of the `/fx` document carry no date, so the guardrail asks for something the context does not hold. The header `<title> › <heading>` should become `<title> (fetched <date>) › <heading>` in `knowledge/index.js`. It re-hashes and re-embeds the whole corpus, so it is a task with a plan, not a patch — and it is the only real fix for §11 risk 6.
3. **Decide what to do about a figure inside a published band.** §7.1 case 3: the telebirr tariff prints `501 to 1500 | 4` and the grounding guard will not let Bini say "1,000 birr costs 4 birr". Either Bini learns to answer with the band ("amounts from 501 to 1,500 birr cost 4 birr"), or the guard learns that a digit inside a quoted band is grounded. The first is a prompt change and much the safer of the two.
4. **Ask Ibrahim to OCR the 58 scanned directives** in §2.1 — FCP-01-2020, the currency directives, ONPS-02-2020 and ONPS/04/2021, the 2025 banking proclamation — and to pull the two that the 15 MB cap skipped.
5. **Re-check tv-053** once the reranker settles, and consider whether the travel gold's Amharic card question needs a tighter label now that the corpus holds Amharic card products.

---

*Generated on the live server, 2026-09-17. Every figure in this report is quoted from a log, a result file or a document read on disk; where something did not work, it is written down here rather than left out.*
