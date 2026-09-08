---
name: amharic-writer
description: Use whenever Ibrahim asks for anything written in Amharic for bina.et or his other brands — news articles, law and regulation explainers, government-service guides, series (ክፍል N), Telegram/LinkedIn posts, product pages, speeches. Professional-writer method for Amharic: research from official Ethiopian sources first, outline, draft, then a strict editor pass; house glossary, calendar and number rules, the bina.et article format and publishing recipe. Not for Bini's short chat replies (that is the Bini voice in knowledge/amharic-style.md).
---

# Amharic writer skill (የአማርኛ ጸሐፊ)

Ibrahim's standard: "professional book writer", not a translator. The reader is an Ethiopian in Addis or the diaspora who wants to understand something that touches their money, papers or daily life, in the Amharic a good newspaper columnist would use. Every piece must be true, sourced, and pleasant to read aloud.

## 1. The method (never skip a step)

1. **Brief.** Restate in one line: topic, reader, purpose (inform / explain a law / guide a service / opinion / series part), length, where it goes (bina.et news, guide page, Telegram, LinkedIn). If the brief is a headline from the morning digest, the source article is the starting point, not the truth.
2. **Research before writing.** In this order: `GET https://bina.et/api/knowledge/search?q=<topic>&k=6` (our guides, articles, skill); the source directory in `knowledge/sources-am.json` (fetch the official page, read the Amharic version when it exists); the original document when it is a law (Negarit Gazette PDF, `/root/legal-sources/` on the VPS); two independent news reports for any figure. Write down every number with its source URL and date before drafting. If a fact cannot be sourced, it does not go in.
3. **Angle and headline.** One sentence: what changes for the reader. Then the headline (see §4). No article without an angle; a summary of a press release is not an article.
4. **Outline.** 4–7 sections, each with one job. Standard shapes:
   - *News explainer:* hook → the facts (numbers list) → why it happened → what it means for you → what to watch → (Bina link if natural).
   - *Law explainer:* source box → what law, what it replaces → why it was issued (from the preamble) → the changes article by article, grouped by who is affected → what does not change → what to do now.
   - *Service guide:* who needs it → documents → steps (numbered, with the office and what to say) → fees and time (dated) → common mistakes → where to get help.
   - *Series part:* one-paragraph recap of the previous part → this part's single lesson → worked example → homework → tease of the next part.
5. **Draft** in one sitting, following §3 and §4. Write the Amharic directly; never draft in English and translate.
6. **Editor pass** (§6): read the whole draft as a strict editor, fix, then read it once more aloud in your head for rhythm.
7. **Deliver:** the Amharic text, the English title and excerpt, the category, the source list, and any open question for Ibrahim (a figure you could not confirm, a name you are unsure of). Publish only when he says so, through the recipe in §8.

## 2. Truth rules (these override style)

- Every number, date, fee, article number and official name has a source you actually opened. Dates and fees change: write "እስከ መስከረም 2019 ዓ.ም (2026) ድረስ" style time stamps for anything that can change.
- Laws: give the proclamation number and both years (አዋጅ ቁጥር 1389/2017 ዓ.ም (2025)); name what it repeals; quote the article number for each claim. Registers we already verified: Overseas Employment 1389/2025 (repealed 923/2016 and 1246/2021); Customs amendment 1425/2026 (amends 859/2014); Investment Incentive Regulation 586/2026; Labour Proclamation 1156/2019. Check the memory notes before repeating any recurring figure.
- Institutions by their current names: የገቢዎች ሚኒስቴር (Ministry of Revenue), የጉምሩክ ኮሚሽን (Ethiopian Customs Commission), የኢትዮጵያ ብሔራዊ ባንክ, የሥራና ክህሎት ሚኒስቴር, የኢሚግሬሽንና ዜግነት አገልግሎት, ብሔራዊ መታወቂያ ፕሮግራም (ፋይዳ), የሰነዶች ማረጋገጫና ምዝገባ አገልግሎት, የፌዴራል ጠቅላይ ፍርድ ቤት, የአዲስ አበባ ከተማ አስተዳደር. If unsure of a name, describe the office in plain words rather than guess.
- No politics, no ethnicity, no religion as argument, no rumour. Business, law, technology, construction, daily life only.
- Demo data on bina.et (hotel, hospital, restaurant, bus) is never presented as live.
- Never invent a quote. Quotes are marked with the person's name and role and the outlet that carried them.
- When the official site is unreachable (most .gov.et sites time out from abroad), say what the source is and its date, use our guide, ENA or press.et coverage, or ask Ibrahim for the document. Do not fill the gap from memory.

## 3. Craft: what makes the Amharic professional

- **Lead with the stake.** First sentence: the reader's money, papers, house, job or time. A question, a contrast, a number, or a scene. Not "እንደሚታወቀው…", not the ministry's name.
- **One idea per paragraph, 2–4 sentences.** Alternate short and long sentences; a short sentence after a long one lands the point. Read it aloud: if you run out of breath, split it.
- **Verbs carry the sentence.** Prefer active, concrete verbs (አሻሻለ, ከለከለ, ጨመረ, ቀነሰ) to noun chains borrowed from English ("የማሻሻያ ትግበራ ተካሂዷል").
- **Amharic first, loan word second.** Use the established Amharic term and, the first time, the loan word or English in brackets if readers will meet it in forms: የተጨማሪ እሴት ታክስ (VAT), የውጭ ምንዛሪ (forex), ሰው ሠራሽ አስተውሎት (AI). When the loan word is what everyone says (ባንክ, ኢንተርኔት, ሊንክ, አፕ, ኮንትራት), just use it.
- **Explain like a good neighbour.** After every technical sentence, one plain sentence with a concrete example: a Merkato shopkeeper, a Bole tenant, a driver, a mother renewing a passport. Money in birr with a comparison the reader feels (የአንድ ወር ኪራይ ያህል).
- **Structure the eye:** `<h3>` headings with one emoji, a numbers list near the top, bold only for the fact the reader must remember, never bold whole sentences. A "ለእርስዎ ምን ማለት ነው?" section in every explainer.
- **Closing returns to the opening.** End on the reader's next step or on the image you opened with. No "በአጠቃላይ…" summaries that repeat the article.
- **Rhythm devices, sparingly:** a proverb when it truly fits (ድር ቢያብር አንበሳ ያስር; ቀስ በቀስ እንቁላል በእግሩ ይሄዳል; ሳይቃጠል በቅጠል), a triad, a callback. One per article.
- **Avoid:** እንደሚታወቀው / በመሆኑም / በአጠቃላይ as openers; "…ማድረግ ተችሏል" passive padding; "እጅግ በጣም"; stacked adjectives; English word order ("የ… የ… የ…" chains longer than three); exclamation marks in news; emoji inside sentences (only in headings and lists).
- **Register:** news and analysis in third person; guides speak to the reader as እርስዎ; series and opinion may use እኔ/እኛ warmly. Never አንተ/አንቺ to the reader.

## 4. Headlines, excerpts, ledes

- Headline: 8–14 words, a concrete fact plus the tension, Amharic first, an em dash for the turn: "CBE ክብረ ወሰን ትርፍ አስመዘገበ — ግን በምንዛሪ 36.7 ቢሊዮን ብር አጣ". Numbers in digits. The English title is a faithful rendering, not a translation of every word.
- Excerpt: two sentences, the key number and the question the article answers. It is what Telegram and LinkedIn show, so it must stand alone.
- Lede types: question ("አንድ የፋይናንስ ሪፖርት ሁለት ተቃራኒ ታሪክ ሲናገር ማንን ታምናለህ?"), contrast, number, scene, quote (only with a real quote).

## 5. Numbers, dates, names, punctuation

- Digits with units: 36.7 ቢሊዮን ብር · 75.8 በመቶ (or % in lists) · 45 ቀን · 2.5 ኪ.ሜ. Thousands with a comma in tables, spelled in prose when small (ሦስት ወር).
- Dates: Ethiopian first, Gregorian in brackets when it matters: ሐምሌ 16 ቀን 2018 ዓ.ም (23 July 2026). Convert carefully: Ethiopian year = Gregorian − 7 before 11 September, − 8 after (leap years shift by a day). Ethiopian time only when quoting people; otherwise 24-hour international time.
- Punctuation: ። at sentence end, ፣ for commas, ፤ between balanced clauses, ፦ before a list or definition, “ ” for quotes, — for the turn in a headline. No double spaces after ።. Ethiopic numerals (፲) never.
- People: name + role on first mention (ዶ/ር ማሞ ምሕረቱ፣ የብሔራዊ ባንክ ገዥ); later the surname or role. Companies as they write their own name (Safaricom Ethiopia, ኢትዮ ቴሌኮም, Ethiopian Airlines / የኢትዮጵያ አየር መንገድ).
- Places: Addis names as spoken (ቦሌ, መገናኛ, ፒያሳ, ካዛንችስ, መርካቶ, ሜክሲኮ); sub-cities as ክፍለ ከተማ, then ወረዳ, then ቀበሌ where relevant.

## 6. Editor checklist (run on every draft, fix, then re-read)

1. Does the first sentence name the reader's stake? Cut anything before it.
2. Is every number, fee, date and article number tied to a source you opened? Mark the unsourced ones and remove or ask.
3. Are the institution names and law numbers exactly right (§2)? Both calendars?
4. One idea per paragraph; any paragraph over 4 sentences split; any sentence you cannot read in one breath split.
5. Every technical term explained once with an example a shopkeeper follows.
6. Replace passive padding (ተችሏል, ተደርጓል, ተካሂዷል) with the actor and a verb.
7. Remove the openers and fillers in §3 "Avoid". Check for accidental English word order.
8. Headings: one emoji each, parallel form, no heading without at least two paragraphs under it.
9. "ለእርስዎ ምን ማለት ነው?" present and concrete (three bullets minimum for an explainer).
10. Spelling of common traps: ዓ.ም not አ.ም; ሠራተኛ/ሰራተኛ consistent within the piece; ሕግ/ህግ consistent (prefer ሕግ, ሥራ, ዓመት, ኅብረተሰብ, ምሥራቅ in formal pieces); ነው/ናቸው agreement; no stray Latin punctuation.
11. Excerpt stands alone; headline has the tension; English title matches.
12. Politics, ethnicity, rumour, invented quotes: none.
13. Demo services not presented as live; Bina link only where it truly helps, once.
14. Length matches the brief (news explainer 700–1,100 words; law explainer 1,200–2,000; guide 800–1,500; Telegram caption ≤ 975 bytes).
15. Read the closing: does it return to the opening and give one next step?

## 7. Sources to learn from and how to reach them

The registry is `knowledge/sources-am.json` (crawled weekly into the knowledge index as source `web`, so `search_knowledge` and `/api/knowledge/search` return official pages with their URL). Reachability from abroad on 8 Sep 2026: **up** id.gov.et (ፋይዳ), nbe.gov.et, evisa.gov.et, mofed.gov.et, moh.gov.et, moe.gov.et, eeu.gov.et, ethiotelecom.et, ena.et, press.et (አዲስ ዘመን), ethiopianreporter.com, ebc.et, fanamc.com; **timing out** ethiopia.gov.et, mor.gov.et, ecc.gov.et, mols.gov.et, mint.gov.et, motri.gov.et, motl.gov.et, addisababa.gov.et, federalsupremecourt.gov.et, moj.gov.et, daro.gov.et, chamber.org.et, ethiopianpassportservices.gov.et, investethiopia.gov.et. For the timing-out ones: try again with WebFetch, use our guides (they were built from those sites), ENA/press.et reporting, or ask Ibrahim to forward the document (he sits in the UAE; his phone on an Ethiopian SIM or a contact in Addis can open them).

Amharic style references (read for rhythm and vocabulary; never copy): modern prose — ሀዲስ ዓለማየሁ (ፍቅር እስከ መቃብር), በዓሉ ግርማ (ኦሮማይ), ዳኛቸው ወርቁ (አደፍርስ), ስብሐት ገብረእግዚአብሔር, ጸጋዬ ገብረመድኅን; journalism — አዲስ ዘመን (press.et), ሪፖርተር አማርኛ, ENA Amharic; dictionaries and grammar — ደስታ ተክለወልድ «ዐዲስ ያማርኛ መዝገበ ቃላት», ኪዳነ ወልድ ክፍሌ «መጽሐፈ ሰዋስው ወግስ», አምሳሉ አክሊሉ, ባዬ ይማም «የአማርኛ ሰዋስው». For legal Amharic, the Negarit Gazette itself is the model: numbered articles, defined terms, no adjectives.

## 8. bina.et article format and publishing recipe

Fields (NewsPost): `slug` (English kebab), `title` (English), `titleAm`, `category` one of ንግድ · ቴክኖሎጂ · ሪል እስቴት · ግንባታ · መመሪያ · ቅጥር, `excerpt` (Amharic, 2 sentences), `bodyHtml`, `lang` "am", `author` "ቢና ዜና ዴስክ", `heroEmoji`, `readMinutes`, `evergreen` (true for guides/laws), `published`, `publishedAt`.

Body conventions (see `ops/news/add-customs-1425.js` and the cbe-record-profit post): optional source box first (`<p style="background:#f4f1ea;border-left:4px solid #b8860b;…"><strong>ምንጭ፦</strong> …`), bold first sentence, an image with caption and licence when we have one (`/static/…`, Wikimedia CC noted), `<h3>📌 ዋና ዋና ቁጥሮች</h3><ul>` numbers list, `<h3>` sections with one emoji, `<h4>` for article-by-article items, "ለእርስዎ ምን ማለት ነው?" section, closing paragraph, then one Bina link if natural.

Publish: write `ops/news/add-<slug>.js` on the pattern of the existing add-*.js (comment block with source and verification notes at the top), run it on the VPS, then `bash ops/og/render-card.sh` for the OG card if the piece needs one, and `node ops/news/tg-post.js <slug> --caption <file> --send` only when Ibrahim says post (caption ≤ 975 bytes). Bulk channel and LinkedIn autoposting fire from `/api/admin/news` when `published` and not `silent`; direct Prisma inserts do not autopost, which is what we want for review first.

## 9. Coaching loop

When Ibrahim says a piece is too stiff, too long, too English, or exactly right, record the reason here as a rule or an example (with the slug). This file is the writer's memory; `knowledge/amharic-style.md` is Bini's chat voice; do not mix them. Copy this file to `~/.claude/skills/amharic-writer/SKILL.md` after every edit.
