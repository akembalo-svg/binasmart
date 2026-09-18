# What BinaSmart could honestly answer on mols.gov.et — measured 2026-09-18

Read-only audit. Nothing was changed, committed, restarted or sent. The 40 questions were
asked through the live `POST /api/assistant` on `127.0.0.1:4210` with `x-binasmart-eval: 1`,
6 s apart, from `/tmp/mols-run.js` on the VPS; transcript at `/tmp/mols-eval.json`.
API process PID 2459554 started 2026-09-17 22:55:28, i.e. **after** the MoLS pack landed at
22:53, so the register was in the loaded corpus.

**Headline: 24 of 40 good, 10 thin, 5 wrong, 1 correctly refused.** The single most serious
defect is not a gap — it is that Bini **invented the masked digits of agency managers'
personal phone numbers**. Details in §4.

---

## 1. Inventory — what we hold on this ministry's subjects

### 1a. The ministry's own pages (`knowledge/business/mols-*.md`, fetched 2026-09-17)

| Doc | Size | What it is |
|---|---|---|
| `mols-agencies.md` | 173 KB | Part 1 of the ministry's register of licensed overseas employment agencies: Amharic name, English name, address (city/subcity/woreda), manager phone **masked** as `251•••••NNNN`, allowed countries. |
| `mols-agencies-part-2.md` | 85 KB | Part 2 of the same register. Together ~1,222 agencies. |
| `mols-about.md` | 3.8 KB | Ministry profile: vision, mission, values, that it was established by Proclamation 1263/2022, and the institutions under it (federal TVET institute, entrepreneurship development institute, agricultural TVET colleges, tourism institute). |
| `mols-am-about.md` | 3.8 KB | The Amharic version of the same profile page. |

Register coverage by destination country (raw mentions across both parts):
Saudi Arabia 1,153 · UAE 243 · Jordan 282 · Qatar 88 · **Kuwait 1 · Bahrain 0 · Oman 0 ·
Lebanon 0**. So the register answers for four destinations and is silent on the rest.
It carries **no licence number, no licence status, no issue or expiry date** — only name,
address, masked phone and permitted countries.

### 1b. Law (`knowledge/law/`, 133 files; the labour-relevant ones)

| Doc | One line |
|---|---|
| `labour-proclamation-1156-2019.md` (18 KB) | The workhorse. Contract types, unwritten contracts (Arts 5–8), probation (Art 11, max 60 working days), notice periods (Art 35, the 1/2/3-month table), severance (Arts 39–40), unlawful dismissal and reinstatement (Arts 26, 43), hours (Art 61, 8/day 48/week), weekly rest (Art 69), annual leave (Art 77, 16 days then +1 per 2 years), sick leave (Arts 85–86), maternity (Art 88, 30 pre + 90 post). |
| `labour-proclamation-1156-2019-om.md` (5 KB) | Afaan Oromoo condensation of the same. |
| `foreign-work-permit-mols-directive-44-2013-fee-regulation-394-2016.md` (12 KB) | **The best document we have on this ministry.** Work permits for foreigners: Art 176 of 1156/2019 verbatim, Directive 44/2013 Arts 6, 12, 15, 16 verbatim, fees from Regulation 394/2016 (new 2,000 / renewal 1,500 / replacement 1,200 Birr), the ewp.lmis.gov.et portal, MoLS phone +251 116 671792 and info@Mols.gov.et, EIC Directive 772/2021 and the 10% expatriate cap. |
| `private-employees-pension-1268-2022-retirement-age-contributions.md` (11 KB) | Private-sector retirement age 60 (Art 18), contribution rates, how to verify contributions. |
| `public-servants-pension-1267-2022-retirement-age.md` (10 KB) | Public-servant retirement age. |
| `civil-servants-proclamation-1353-2025-leave-hours-probation.md` (15 KB) | Federal civil servants: annual leave, maternity leave, working hours, probation. A *different regime* from 1156/2019 — and the source of one wrong answer (§4, Q32). |
| `refugee-right-to-work-permit-1110-2019.md` (10 KB) | Refugees' right to work and how their work permit is issued. |
| `medical-certificate-for-local-job-1362-2024-labour-1156-2019.md` (8 KB) | Medical certificate for a job inside Ethiopia. |
| `returnee-migrants-reintegration-support.md` (7 KB) | Support for Ethiopians returning from abroad; mentions 923/2016 and 1389 in passing. |
| `federal-government-vacancies.md` (10 KB) | Where federal vacancies are advertised (fcsc.ecsc.gov.et). |

### 1c. Health (`knowledge/health/`)

`overseas-employment-medical-exam-1389-2025.md` (5.9 KB) — the **only** place we hold text
of the Overseas Employment Proclamation 1389/2025, and only four fragments: Art 17 (medical
examination), Art 19 (expense coverage), and MoLS overseas-employment directive (2018 E.C.)
Arts 5 and 26.

### 1d. eServices (`knowledge/eservices/`, 52 offices)

`ministry-of-labor-and-skills.md` (7.8 KB, fetched 2026-09-14) — the portal's **15 MoLS
services**: collective agreement registration and amendment, bylaw amendment registration,
new/renewal/replacement/cancellation of work permit, competency certificate for consultancy
and for OSH consultancy (plus OSH renewal), safety committee certification, knowledge
transfer report, occupational accident report, trade union registration, trade union leader
registration. `private-organization-employees-social-security-agency.md` (3 KB) covers POESSA.

### 1e. bina.et's own guides (indexed via `GUIDE_SLUGS` in `knowledge/index.js`)

`lmis-labor-id-ethiopia` (the Labor ID / LMIS A-to-Z), `coc-certificate-ethiopia`,
`living-working-in-ethiopia-guide`, plus the `/news/law-*` legal-guide series (part 3 on
employment contracts, part 4 on working abroad). These carried most of the good
overseas-employment answers.

### 1f. Where we hold nothing — say it plainly

- **The Overseas Employment Proclamation 1389/2025 itself.** Four articles out of ~90.
  No licensing conditions for agencies, no capital or bond requirement, no worker-protection
  chapter, no prohibited acts, no penalties, no complaint machinery, no repeal schedule
  beyond a second-hand mention of Art 86.
- **Occupational safety and health.** Two files mention the phrase; we hold no OSH duties,
  no safety-committee rules, no accident-reporting procedure, no inspection powers.
- **Trade unions and collective agreements.** One passing mention of "trade union" in the
  whole of 1156/2019 as we hold it. No Arts 113–134.
- **Overtime rates.** No Art 68 multipliers anywhere.
- **Employment-injury compensation.** No Arts 92–112, no disability degrees, no benefit tables.
- **Labour disputes, labour courts, labour inspection.** Nothing.
- **Minimum wage.** One file, and it is an investment-promotion page, not the ministry.
- **Training and skills / TVET.** Nothing beyond the ministry's profile paragraph — no
  curriculum, no TVET strategy, no assessment-centre directory.
- **Job vacancies.** Only the federal civil service pointer; no MoLS vacancy feed.
- **MoLS contact directory.** One phone number, buried in the work-permit doc. No complaint
  hotline, no regional labour bureaux, no embassy labour attachés in the destination countries.
- **Domestic workers as a category.** Two files mention the phrase. No bilateral labour
  agreements with Saudi Arabia, UAE, Qatar or Jordan.

---

## 2. The ministry's own gap — this is the pitch

From `/root/storage/packs/business-manual/mols.gov.et/manifest.json` (189 files, 187 HTML,
0 fetch failures, harvested 2026-09-17).

**71 of 187 HTML pages are empty server-side.** Every one carries the same reason:

> page renders header/footer chrome only — no body widgets server-side
> (not JS-gated: no iframe, no ajax content loader)

That is not a crawler problem. The ministry published 71 pages with nothing in them.

### The five emptiest pages, with body character counts

| bodyChars | Title | URL |
|---:|---|---|
| **40** | E-library | `mols.gov.et/e-library/` |
| **41** | Who is Who | `mols.gov.et/who-is-who/` |
| **41** | Researches | `mols.gov.et/researches/` |
| **43** | Map Location | `mols.gov.et/map-location/` |
| **44** | OS, CM & TTLM | `mols.gov.et/os-cm-ttlm/` |

### The empty pages that matter most for a visitor

| bodyChars | Title |
|---:|---|
| 45 | Download Forms |
| 47 | Public Complaint |
| 50 | የውጭ አገር ሥራ ሥምሪት አዋጅ (the Overseas Employment Proclamation page) |
| 52 | Ministry Proclamation |
| 55 | Applications and Appeals |
| 55 | International labor laws |
| 55 | Constitutional Provision |
| 57 | **Overseas Ethiopian workers** |
| 58 | **Labor Identification number** |
| 60 | **Licensed Requirement agencies** |
| 62 | Appellate Authority / Kereta semi |
| 66 | key-statistics |
| 82 | ANNUAL-REPORT-2022 – ETHIOPIA |
| 96 | Approved budget FY2017 E.C. |
| 102 | Budget utilisation statement FY2016 E.C. |

Most of these exist four times over (`/`, `/oro/`, `/tig/`, `/som/`) — empty in every language.

### Which pages ARE substantial

Exactly one: **`/agencies/` at 163,739 body chars (30,400 Ethiopic)** — the agency register.
After that the drop is a cliff:

| bodyChars | Page |
|---:|---|
| 163,739 | `/agencies/` — the register |
| 10,681 | `/privacy/` — the privacy policy |
| 2,869 | `/am/` homepage |
| 2,251 | `/` homepage (identical at `/oro/`, `/tig/`, `/som/`) |
| 2,245 | a ministerial speech ("ሥራ ፈጣሪዎች እንጂ ሥራ ፈላጊዎች…") |
| 1,924–1,101 | `administration2`…`administration6` — staff/leadership cards |
| 1,857 / 1,830 | two Amharic news items (occupational streams from 2019 E.C.; reform article) |
| 1,629 | `Sample Page` — the unedited WordPress default |
| 1,254 | FY2018 E.C. employer/worker sector note |

**The whole of mols.gov.et is one register, a privacy policy, a homepage, five staff cards
and a handful of speeches — and its own "Sample Page" outranks its Labor ID page by 28×.**

---

## 3. Method for the 40 questions

28 Amharic, 12 English, across six personas: a worker going to Saudi Arabia (7), a family
checking an agency (4), an employer on contracts/dismissal/leave (13), a labour-ID enquirer
(3), a foreigner on work permits (3), a pensioner (4), plus local worker / skills /
complaint / jobs (6). Amharic text travelled as a scp'd JSON file; no Ethiopic in any ssh
string. Each call got its own synthetic `x-real-ip` so the rate limiter stayed out of it.
Mean latency 2.6 s; no errors; no answer used a tool (`tools: []` on all 40 — everything came
from the RAG corpus, so **`sources` is never returned by the API**; provenance exists only as
prose inside the reply, which is itself a finding).

Scoring: **good** = correct, specific, and it names a law/institution; **thin** = generically
true but unsourced, or it missed material we demonstrably hold; **wrong** = a false statement,
a false citation, or the wrong legal regime applied; **refused-correctly** = it said it does
not have the figure and pointed elsewhere.

---

## 4. Scoreboard

| | good | thin | wrong | refused-correctly |
|---|---:|---:|---:|---:|
| Amharic (28) | 18 | 5 | 4 | 1 |
| English (12) | 6 | 5 | 1 | 0 |
| **Total (40)** | **24** | **10** | **5** | **1** |

Only **10 of 40** answers carried a fetch date or a publication date. One more (#38) carried a
corrupt one. So **29 of 40 state rules or figures with no date at all** — exactly the defect
the brief said to name.

### The ten most interesting

**Q3 — WRONG, and the worst result of the run.** Amharic, "how do I check the agency is
licensed?" Bini listed five agencies from the register with full phone numbers:
`251•••••4258`, `251•••••2174`, `251•••••1044`, `251•••••3504`, `251•••••9223`. The corpus
holds those rows as `251•••••4258`, `251•••••2174`, `251•••••1044`. **It invented the five
masked digits and presented them as the ministry's published data.** The masking was a
deliberate privacy decision; the model reversed it by confabulation. On a government site
this is not a quality issue, it is an incident.

**Q32 vs Q11 — WRONG, and a cross-language contradiction.** English: "How many days of annual
leave does Ethiopian labour law give?" → *"20 working days… up to 30… Proclamation 1353/2025"*
(that is the **federal civil servants** regime). Amharic, same question: *"16 working days in
the first year, +1 every two years"* (correct, Art 77 of 1156/2019). The same engine gives two
different, incompatible answers depending on the language of the question.

**Q13 — WRONG.** "Can I dismiss my employee without notice?" Bini answered that this is
possible *only* during probation. Art 27 of 1156/2019 lists the grounds for termination
without notice; we do not hold Art 27, so the model answered from the one section we do hold
and turned a gap into a false statement an employer could act on.

**Q18 — WRONG and unsourced.** "How many workers to form a trade union?" → *"at least 50; the
Ministry may lower it but not below 10."* We hold no trade-union provisions at all; the figure
is invented. (Art 114 of 1156/2019 sets ten.)

**Q19 — WRONG citation.** "What is a collective agreement?" The definition was reasonable; the
authority given was **the Stamp Duty Proclamation 110/1998 and 612/2008**. A ministry lawyer
would spot that in one second.

**Q21 — the best answer of the run, and the one to demo.** Amharic work permit: who applies,
the Ethiopians-cannot-fill test, the 90-working-day bar, the full Art 15 document list,
validity of three years renewed annually, fees **2,000 / 1,500 / 1,200 Birr** citing
Regulation 394/2016, and the `ewp.lmis.gov.et` portal. Cites Proclamation 1156/2019 Art 176
and Directive 44/2013 by article.

**Q35 — THIN, the same question in English.** Correct on structure, cites four articles with
2026-09-17 fetch dates — then says *"I don't have the exact fee amounts at hand"* for the very
fees it had just given in Amharic. Retrieval is language-asymmetric.

**Q29 — THIN, and the one a ministry official will type first.** English: "how do I check
whether an agency is licensed?" → *"The Ministry publishes a list on their website."* It never
touched the 1,222-row register it holds. The Amharic version of this question did use it.

**Q20 — the only honest refusal, and it should be the model.** "What is the overtime rate?"
Bini said the rate is not set out in the civil-servants proclamation it could see, and pointed
to HR and justice.gov.et. We genuinely do not hold Art 68. That is the right behaviour.

**Q28 — THIN, with a bogus citation.** "Where do I complain, and what is the phone number?"
Bini said it had no phone number — while **+251 116 671792 and info@Mols.gov.et sit in
`foreign-work-permit-mols-directive-44-2013…md`** — and attributed the complaint procedure to
"Proclamation No. 43", which is not a thing.

### Other defects worth naming

- **Q1 and Q4** point readers at **`bima.et/...`** — a typo of bina.et. Dead links in the
  flagship answer.
- **Q6** correctly says 923/2016 was repealed by 1389/2025 Art 86, then appends a paragraph
  about **the Customs Proclamation 1425/2026**, which has nothing to do with the question.
- **Q5 vs Q6 vs Q30** give three different in-force dates for 1389/2025 (published 8 Aug 2025 /
  in force from ነሐሴ 8 / in force 14 Aug 2025).
- **Q26** (workplace injury) rendered malformed — a numbered list containing "2." and "3." with
  no content — and gave no compensation figures, because we hold none.
- **Q38** stamps its provenance as *"fetched on 2011 E.C."* — an Ethiopian-calendar year
  emitted as a fetch date.
- **Q7** returned Qatar-licensed agencies as mangled fragments ("EMPLOYMENT AGENT PLC",
  "ዳዉዶ") — the register rows survive retrieval but not summarisation.
- **Q12** correctly gives 48 hours/week, then adds "most government offices work 39 hours a
  week" with no source of any kind.

---

## 5. The top five gaps, and what would close each

1. **The Overseas Employment Proclamation 1389/2025 itself.** We hold four articles, reached
   sideways through a health document. Everything the ministry exists to regulate — agency
   licensing conditions, capital and bond, the model contract, prohibited acts, penalties,
   the complaints and appeals route, worker protections abroad — is absent. This is why Q6,
   Q8 and Q28 were thin and why Q3's grounding was so weak that the model padded it.
   *Close it by:* fetching the Negarit Gazette PDF of 1389/2025 into `knowledge/law/` as a
   full bilingual document. It is one file and it is the single highest-value fetch available.

2. **Labour Proclamation 1156/2019 is half-loaded.** Missing Art 27 (termination without
   notice), Arts 28–29, Art 68 (overtime multipliers), Arts 92–112 (employment injury),
   Arts 113–134 (trade unions and collective agreements), Arts 137+ (disputes), Art 178
   (inspection). Those absences produced Q13 (wrong), Q18 (wrong), Q19 (wrong), Q20 (refused),
   Q26 (thin) — five of the sixteen non-good answers.
   *Close it by:* extending `knowledge/law/labour-proclamation-1156-2019.md` from the same
   Negarit Gazette PDF already cited in the document's own footer.

3. **The agency register is a table, not a register — and it leaks.** 1,222 rows with no
   licence number, no status, no expiry, and masked phones the model unmasks by invention.
   Four destination countries only.
   *Close it by:* (a) a hard non-negotiable rule that masked values are never completed —
   this is a correctness guard, not a style preference; (b) loading the register as a
   structured table behind an exact-match lookup tool rather than as free text the model
   paraphrases; (c) asking the ministry for licence number, status and expiry per agency,
   which is the one thing only they can give and the thing every visitor actually wants.

4. **No contact and no complaint route.** The ministry's own `/public-complaint/` (47 chars),
   `/map-location/` (43) and `/applications-and-appeals/` (55) pages are empty, so there was
   nothing to harvest; and Bini failed to surface the one phone number we do hold.
   *Close it by:* a short contacts document from the ministry — head office, the complaints
   desk, regional labour bureaux, and the labour attachés at the Ethiopian missions in Riyadh,
   Abu Dhabi, Doha and Amman. This is also the most persuasive thing to ask them for, because
   it costs them a page and fixes a hole on their own site.

5. **English retrieval is materially weaker than Amharic.** Q29 vs Q3, Q32 vs Q11, Q35 vs Q21
   — same facts in the corpus, worse answers in English. Half our English answers were thin.
   *Close it by:* language-agnostic retrieval (query translation into Amharic before the
   embedding search, or a bilingual index). This one is engineering, not fetching, and it is
   the difference between a 24/40 and something closer to 30/40 without adding a single
   document.

Runner-up gaps worth the ministry's attention: occupational safety and health (they license
OSH consultants and take accident reports, and we hold nothing), TVET and skills (their name
is half "Skills" and we hold one paragraph), and the bilateral labour agreements with the
four destination countries.

---

## 6. Recommendation — what the demo should lead with

**Lead with the overseas-employment journey; back it with labour law; do not lead with the
agency register.**

- **Lead: the worker's path abroad.** Labor ID → LMIS registration → COC → medical exam →
  contract approval, plus who pays for what. Q1, Q2, Q4, Q5, Q9, Q10, Q31, Q39 were all good
  and sourced. It is the ministry's own mission, and the argument writes itself: *their*
  "Overseas Ethiopian workers" page is 57 characters and *their* "Labor Identification number"
  page is 58 characters, while a visitor asking those questions gets a sourced answer from us
  today. That is the gap-to-value story in one slide.
- **Back it with labour law and work permits.** Q21, Q22, Q23, Q24, Q25, Q14, Q11, Q17 are the
  most defensible answers we produced — real article numbers, real fee figures, real portal
  URLs. This is where an official pokes hardest and where we hold up best.
- **Hold the agency register back until the masking bug is fixed.** It is our most impressive
  asset — 1,222 rows against a ministry page that is the only substantial thing on their site —
  and simultaneously our biggest liability, because the very first thing an official will do is
  type an agency they know, and today that can return a phone number we made up. Fix the
  unmask-by-confabulation defect and put the register behind an exact-match lookup, and it
  becomes the strongest part of the demo rather than the reason the meeting ends early.
- **Show the refusal.** Demo Q20 deliberately. A government buyer trusts a system that says
  "that figure is not in what I hold, here is who has it" far more than one that never says it.

Honest summary for the owner: **we can answer about six in ten of what a visitor would ask,
and about seven in ten of what they would ask in Amharic.** That is enough for a credible
demo, but only after the phone-number fabrication is fixed — that defect alone would end the
conversation with a regulator.

---

## Appendix — provenance

- Harvest: `/root/storage/packs/business-manual/mols.gov.et/` — README, `manifest.json`,
  `manifest.jsonl`, 187 HTML + 2 XML, 33.6 MB, 0 failures, harvested 2026-09-17, robots.txt
  respected, nothing disallowed fetched.
- Corpus: `/var/www/connectcare/binasmart/knowledge/` — `business/mols-*.md`, `law/`,
  `health/overseas-employment-medical-exam-1389-2025.md`, `eservices/`, guides via
  `GUIDE_SLUGS` in `knowledge/index.js`.
- Transcript: `/tmp/mols-eval.json` on the VPS (40 rows: question, reply, tools, latency),
  log at `/tmp/mols-eval.log`, runner `/tmp/mols-run.js`, questions `/tmp/mols-questions.json`.
- Manifest analysis: `/tmp/manifest_analyze.py` → `/tmp/mols_manifest_report.txt`.
