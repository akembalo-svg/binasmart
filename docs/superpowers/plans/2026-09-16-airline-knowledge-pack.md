# Ethiopian Airlines knowledge pack (Piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every public information page of ethiopianairlines.com into a dated, sourced, searchable knowledge library that Bini prefers for travel questions, with 60 gold questions, a benchmark, and a weekly freshness check that tells Ibrahim on Telegram when the airline changes a page.

**Architecture:** A new curated knowledge source `travel`, loaded exactly the way `law`, `health`, `eservices` and `mor` are loaded (`knowledge/index.js`, `readSources`) — one markdown file per page under `knowledge/travel/`, front matter carrying `url`, `title`, `lang`, `fetchedAt`, `lastChecked`, `contentHash`, and never under `knowledge/web/` (that directory is the crawler's, is gitignored, and truncates at 20,000 characters). A polite fetcher (`ops/travel/fetch-airline.js`) reads the airline's own sitemap, keeps only allowlisted information paths, fetches one page at a time with at least 5 seconds between requests as `robots.txt` asks, strips the site template with the index's own `stripBoilerplate`, and writes the files. A weekly job (`ops/travel/freshness.js`) re-runs the same fetch, updates what changed, marks what vanished, re-ingests the `travel` source, and sends Ibrahim one Telegram note — only when something moved. Bini's route detects a travel question and passes `prefer: ['travel', …]` to `contextFor`; Dr Afiya and Asmat add `'travel'` to their `exclude` lists; the owner agent already has `knowledge: false` and cannot see it at all.

**Tech Stack:** Node 20 on the live VPS (`31.97.176.180`, `/var/www/connectcare/binasmart`), `node:test` (`npm test` = 1252 passing today), Prisma + Postgres (`KnowledgeChunk`), Gemini `gemini-embedding-001` for document and query vectors with BGE-M3 (`pm2 bina-embed`, 127.0.0.1:3031) as the local fallback, pm2 process `binasmart-api` on port 4210, Telegram bot `@bina_smart_bot`.

---

## What was measured before this plan was written

Everything below was read or fetched from the live server on 16 September 2026. Nothing here is from memory.

**The site.** `https://www.ethiopianairlines.com/robots.txt` names one sitemap, `https://www.ethiopianairlines.com/et/sitemap/sitemap-index.xml`, and sets `Crawl-delay: 5`. The index points at a single gzipped sitemap, `https://www.ethiopianairlines.com/et/sitemap/sitemap.gz` (2.5 KB gzipped, 31 KB of XML, `lastmod 2026-09-14`), holding **228 URLs, every one of them under `/et/`**. There is no Amharic locale: `https://www.ethiopianairlines.com/am/` answers **HTTP 200 with the title "Page Not Found | Ethiopian Airlines | AM"** — `am` is the Armenia country site, not Amharic, and it is a soft 404. The `hreflang` list on a real page is `ar, de, en, es, fr, it, ja, ko, pt, ru, tr, zh, x-default`: **no Amharic anywhere.** So the pack is English, and the plan says so in every document's own header.

**The pages are server-rendered, but buried.** `/et/information/baggage-information/free-baggage-allowance` is 276 KB of HTML that `knowledge/index.js htmlToText` reduces to 19,652 characters. The real content is there — `## Checked baggage … Maximum weight: 50 lbs (23 kg) need to be 70lbs(32kg)`, `## Carry-on baggage … Economy: 1 piece, 7kg`, `## Infant Baggage Allowance … 10 kg (Weight System) or 23 kg (Piece System)`, and an FAQ block — but roughly the first 460 lines are the mega-menu, and the last third is site-wide notification text (a Kigali roadworks advisory, a Russian card-payment notice, an Israel transit notice) that appears on **every** page. There are no `<table>` elements on that page; the fee and kilo figures are in paragraph and list text. That is why the fetcher strips the template across the whole corpus instead of trusting `<nav>`/`<footer>`.

**The sitemap is incomplete.** The mega-menu links to pages the sitemap never lists, including `/et/explore/et-specials/shebamiles-deals-offers`, `/et/explore/et-specials/et-holidays`, `/et/explore/et-specials/ethiopian-skylight-hotel-packages`, `/et/explore/et-specials/apply-ethiopian-e-visa`, `/et/services/add-on-services/car-rental-airport-transfer`, `/et/services/add-on-services/mysheba-neighbour-free-seat`, `/et/services/on-board-services/in-flight-experience` and `/et/services/help-and-contact/lost-property-report-form`. ShebaMiles, Ethiopian Holidays and the Skylight hotel — three sections the design names — are **only** reachable this way. So the fetcher seeds from the sitemap **and** from the same-host `/et/` links found on the pages it fetches, filtered by the same allowlist.

**Counts.** The allowlist in Task 1, run against the sitemap that was downloaded while this plan was written, selects **119 of the 228 URLs** and produces 119 distinct slugs with no collision. With the eight or so pages only the mega-menu links to, the run is about **125 pages**. At 5 seconds of pacing plus roughly 2 seconds a fetch that is **about 15 minutes**, which is why the live fetch runs detached with a polled log.

**Neighbouring hosts.** `cargo.ethiopianairlines.com` answers 200 and publishes `sitemap.xml` (61 KB) but has no `robots.txt` (the request returns its 404 page); its homepage is an application shell, 5,042 characters of mostly navigation. `https://www.ethiopianholidays.com/` answers 200. `shebamiles.ethiopianairlines.com` is the loyalty login portal — an account site, excluded by the design. **The Ethiopian Civil Aviation Authority is unreachable from this server**: `ecaa.gov.et` resolves (197.156.91.124) but every connection fails, which is the same behaviour `ops/health/weekly-audit.js` already documents for Ethiopian government hosts ("unreachable from Paris (fine in Ethiopia)"). It is therefore listed in `sources.json` as `fetch: "manual"`, not silently dropped.

**The corpus and the numbers this plan must not break.** 12,750 chunks today. `/root/bini-eval/` holds, measured 2026-09-15:

| gold set | n | retrieval Page@3 | as shipped |
| --- | --- | --- | --- |
| v1 `gold.json` | 114 | 76.3% | 77.2% |
| v2 `gold-v2.json` | 114 | 95.6% | 92.1% |
| v3 `gold-v3-agents.json` | 111 | 96.4% | 98.2% (MRR 0.965) |

v3 slices: afiya 54 questions 96.3%/96.3%, asmat 57 questions 96.5%/100.0%, "am question, gold only in English" 33 questions 87.9%/93.9%. That last slice matters: the pack is English and 40 of the 60 gold questions are Amharic, so the travel gold set is measuring the same thing on a new corpus.

---

## Conventions for every task

These apply to all thirteen tasks. Read them once; they are not repeated.

1. **This is the live server.** `ssh root@31.97.176.180`, repo `/var/www/connectcare/binasmart`. Every command in this plan is a **remote** command: the coordinator issues it as `ssh root@31.97.176.180 "<command>"`. Expected output is what the remote command prints.
2. **The coordinator's shell is PowerShell.** The Bash tool is broken; use the PowerShell tool. PowerShell 5.1 strips double quotes from native-command arguments, so the whole remote command goes inside one pair of double quotes, or into a wrapper script written on the server and deleted afterwards. **No here-documents, no apostrophes and no Ethiopic characters inside an ssh string, ever.**
3. **Ethiopic and multi-line code are sliced out of this plan on the server**, never typed into an ssh string. Task 0 restores the slicer. Usage: `python3 /tmp/extract_plan.py <plan.md> "### Task N:" <block-index> <out-path>`. The index counts **every** fenced block in that task section, shell blocks included, from 0. Run it with `-` as the out-path first: it prints `blocks in section: [(lang, length), ...]`, so the index and the language can be confirmed before anything is written. It refuses to overwrite an existing file.
4. **Patch, never bulk-copy.** Before editing an existing file take a backup next to it: `cp <file> <file>.bak-<name>-<stamp>` where `<stamp>` is `date +%Y%m%d-%H%M%S`.
5. **TDD with `node:test`.** Write the failing test, run it, see it fail for the right reason, write the smallest implementation, run it again. `npm test` must be green at the end of every task. It is 1252 passing today; the number only goes up.
6. **Every network fetch is paced and sequential.** At least 5 seconds between requests to ethiopianairlines.com, one request at a time, a browser-like user agent that names BinaSmart. Never run two fetchers at once. Any run longer than about a minute goes detached (`nohup … &`) with its log polled — never sit silent for ten minutes.
7. **Commit with `git commit -F <file>`** and stage by name. The repo has about 141 untracked files; **never `git add -A`**. Never touch `broadcast-am-fbcomment.js` or `uploader.js`. Every commit message ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
8. **The repo is public.** No keys, no tokens, no chat ids in any committed file. The freshness script reads its token from `.env`, which is not committed.
9. **Restart pm2 only for server changes.** `server.js` changed means `pm2 restart binasmart-api`, then check `/health` and the error log. A change under `ops/` or `knowledge/*.md` needs no restart.
10. **No Telegram or WhatsApp sends during the build.** The freshness note is exercised with `--dry-run`, which sends nothing. The **first real freshness note is the proof** — it is sent by cron, in production, when the airline actually changes a page, and not before.
11. **Gemini pacing is 4 seconds** between calls in any evaluation loop.
12. **Never call `/api/afiya` or `/api/asmat` with an emergency message.** The safety evals in Task 12 are the existing scripts, which are already written for it.
13. **Verify the thing, not a proxy.** A 200 is not a fetched page (the airline serves soft 404s at 200). An exit code 0 from a fetch is not a written file. Read the file, count the characters, look at the text.

---

### Task 0: The slicer, the working state, and the baseline

**Files:**
- Create: `/tmp/extract_plan.py` (only if missing — it is not part of the repo)
- Read: `/root/bini-eval/retrieval-latest.json`, `/root/bini-eval/retrieval-gold-v2-latest.json`, `/root/bini-eval/retrieval-gold-v3-agents-latest.json`

- [ ] **Step 1: Check whether the slicer is still there**

```
ls -la /tmp/extract_plan.py
```

Expected: `-rw-r--r-- 1 root root 1206 ... /tmp/extract_plan.py`. If it prints `No such file or directory`, do Step 2. If it exists, skip to Step 3.

- [ ] **Step 2: Restore the slicer (only if Step 1 said it is gone)**

Slice this block out with... nothing, because the slicer is what is missing. Write it with `scp` from a local file containing exactly:

```python
import io, re, sys, os
# usage: extract_plan.py PLAN "### Task N:" INDEX OUT  -> writes the INDEX-th fenced block of that task section
plan, head, idx, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
s = io.open(plan, encoding='utf-8').read()
start = s.index('\n' + head) + 1
nxt = s.find('\n### Task ', start + 1)
sec = s[start: nxt if nxt != -1 else len(s)]
blocks = []
lines = sec.split('\n')
i = 0
while i < len(lines):
    m = re.match(r'^(\s*)```(\w*)\s*$', lines[i])
    if m:
        ind = m.group(1); lang = m.group(2); body = []
        i += 1
        while not re.match(r'^' + ind + r'```\s*$', lines[i]):
            body.append(lines[i][len(ind):] if lines[i].startswith(ind) else lines[i])
            i += 1
        blocks.append((lang, '\n'.join(body) + '\n'))
    i += 1
print('blocks in section:', [(b[0], len(b[1])) for b in blocks])
if out != '-':
    d = os.path.dirname(out)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    if os.path.exists(out):
        raise SystemExit('refusing to overwrite ' + out)
    io.open(out, 'w', encoding='utf-8', newline='\n').write(blocks[idx][1])
    print('wrote', out, len(blocks[idx][1]), 'chars, lang', blocks[idx][0])
```

- [ ] **Step 3: Confirm the tree is what this plan expects**

```
cd /var/www/connectcare/binasmart && git log --oneline -1 && ls knowledge/ | head -20 && ls ops/ | head -5 && ls test/travel
```

Expected: the newest commit is `a0f80a9 Design: Ethiopian Airlines knowledge pack and Bini travel (booking with a payment link)` or a later one; `knowledge/` lists `crawl.js eservices health index.js ingest.js law mor routes.js sources-am.json web`; `test/travel` lists `demo-trips.test.js` (an unrelated existing file — the new travel tests join it in that directory).

- [ ] **Step 4: Record the green baseline**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -12
```

Expected: `# pass 1252`, `# fail 0`. **If it is not 1252/0, stop and report** — this plan assumes a green tree.

- [ ] **Step 5: Record the retrieval baseline and the corpus size**

```
cd /var/www/connectcare/binasmart && node -e "for (const f of ['retrieval-latest.json','retrieval-gold-v2-latest.json','retrieval-gold-v3-agents-latest.json']) { const j = require('/root/bini-eval/' + f); console.log(f, j.at, 'chunks', j.chunks); for (const t of j.table.slice(0,2)) console.log('   ', t.name, t.n, t.plain, t.shipped); }"
```

Expected (the figures measured on 2026-09-15; re-record whatever prints, that is the "before"):

```
retrieval-latest.json 2026-09-15T07:34:50.956Z chunks 12750
    all questions 114 76.3% 77.2%
    of those, gold page still exists 112 77.7% 78.6%
retrieval-gold-v2-latest.json 2026-09-15T07:36:31.466Z chunks 12750
    all questions 114 95.6% 92.1%
    of those, gold page still exists 114 95.6% 92.1%
retrieval-gold-v3-agents-latest.json 2026-09-15T07:38:24.279Z chunks 12750
    all questions 111 96.4% 98.2%
    of those, gold page still exists 111 96.4% 98.2%
```

Write those six numbers down. Task 12 compares against them.

- [ ] **Step 6: No commit**

Task 0 changes nothing in the repo. Nothing to commit.

---

### Task 1: The source list, `knowledge/travel/sources.json`

**Files:**
- Create: `knowledge/travel/sources.json`
- Test: `test/travel/sources.test.js`

The file is the design's §1.1 "source list": what is fetched, from which host, under which paths, what is deliberately excluded, and what a human has to do by hand. `ops/travel/fetch-airline.js` (Task 5) is driven entirely by it, so it is data, not documentation.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/sources.test.js`.

```javascript
'use strict';
// knowledge/travel/sources.json drives ops/travel/fetch-airline.js: an entry that is wrong here becomes a
// page fetched that should not have been, or a section of the airline's site silently missing from the pack.
// So the shape is pinned, and so are the two rules the design sets: booking, account and promotional pages
// are never fetched, and a source we cannot reach from this server is listed as manual rather than dropped.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'knowledge', 'travel', 'sources.json');
const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('the registry has a version, a note and a list of sites', () => {
  assert.equal(typeof reg.version, 'number');
  assert.ok(reg._about.length > 40, 'the file says what it is for');
  assert.ok(Array.isArray(reg.sites) && reg.sites.length >= 2);
});

test('every site has the fields the fetcher reads', () => {
  for (const s of reg.sites) {
    assert.match(s.id, /^[a-z0-9-]+$/, 'id is a slug: ' + s.id);
    assert.match(s.host, /^[a-z0-9.-]+$/, s.id + ' host');
    assert.equal(typeof s.name, 'string');
    assert.ok(['sitemap', 'list', 'manual'].includes(s.fetch), s.id + ' fetch mode: ' + s.fetch);
    assert.ok(Number.isInteger(s.crawlDelaySeconds) && s.crawlDelaySeconds >= 5, s.id + ' pacing >= 5s');
    assert.equal(typeof s.reach, 'string');
    assert.ok(s.checked, s.id + ' says when reachability was checked');
    if (s.fetch === 'sitemap') assert.match(s.sitemap, /^https:\/\//, s.id + ' sitemap url');
    if (s.fetch === 'list') assert.ok(Array.isArray(s.urls) && s.urls.length, s.id + ' needs urls');
    if (s.fetch === 'manual') assert.ok(s.why && s.why.length > 20, s.id + ' must say why it is manual');
  }
});

test('an id is used once', () => {
  const ids = reg.sites.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every fetched site has an allowlist and a denylist, and every pattern is a valid regular expression', () => {
  for (const s of reg.sites.filter(x => x.fetch !== 'manual')) {
    assert.ok(Array.isArray(s.allow) && s.allow.length, s.id + ' allow');
    assert.ok(Array.isArray(s.deny), s.id + ' deny');
    for (const p of [...s.allow, ...s.deny]) assert.doesNotThrow(() => new RegExp(p), s.id + ' bad pattern ' + p);
  }
});

test('booking, account and promotional paths are denied on the airline site', () => {
  const et = reg.sites.find(s => s.id === 'ethiopian-airlines');
  const deny = et.deny.map(p => new RegExp(p));
  const allow = et.allow.map(p => new RegExp(p));
  const blocked = p => deny.some(r => r.test(p)) || !allow.some(r => r.test(p));
  for (const p of ['/et/book/booking/flight', '/et/home-page/save-10', '/et/home-page/flash-sales',
    '/et/customer-surveys/module-1/cc', '/et/blog/travel-tips', '/et/explore/deals-offers/top-flights',
    '/et/ethiopian-offers', '/et/sitemap', '/et/supporttest', '/et/customer-survey-landing'])
    assert.ok(blocked(p), 'must not be fetched: ' + p);
});

test('the information sections the design names are allowed', () => {
  const et = reg.sites.find(s => s.id === 'ethiopian-airlines');
  const deny = et.deny.map(p => new RegExp(p));
  const allow = et.allow.map(p => new RegExp(p));
  const ok = p => allow.some(r => r.test(p)) && !deny.some(r => r.test(p));
  for (const p of ['/et/information/baggage-information/free-baggage-allowance',
    '/et/information/rules-and-regulations/conditions-of-carriage',
    '/et/information/essential-information/optional-service-charges',
    '/et/information/special-needs/travelling-with-pets',
    '/et/book/manage/refund-request', '/et/book/check-in/online-check-in',
    '/et/book/special-deals/medical-travel',
    '/et/services/services-at-the-airport/minimum-connecting-time',
    '/et/services/add-on-services/premium-lounge-access',
    '/et/services/on-board-services/cloud-nine-services',
    '/et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs',
    '/et/explore/et-specials/et-holidays',
    '/et/explore/et-specials/ethiopian-skylight-hotel-packages',
    '/et/meet-and-greet-services-at-addis-ababa-airport'])
    assert.ok(ok(p), 'must be fetched: ' + p);
});

test('the passenger-rights regulator is listed even though the server cannot reach it', () => {
  const ecaa = reg.sites.find(s => s.id === 'ecaa');
  assert.equal(ecaa.fetch, 'manual');
  assert.match(ecaa.reach, /unreachable/i);
  assert.match(ecaa.why, /Ethiopia/);
});

test('the bina.et airport guide is a reference, never re-crawled', () => {
  const ref = reg.references.find(r => /bina\.et\/airport/.test(r.url));
  assert.ok(ref, 'the Bole guide is named');
  assert.equal(ref.fetch, 'none');
  assert.match(ref.note, /already indexed/i);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/sources.test.js 2>&1 | tail -8
```

Expected: it throws before any test runs — `ENOENT: no such file or directory, open '/var/www/connectcare/binasmart/knowledge/travel/sources.json'`.

- [ ] **Step 3: Write the registry**

```
mkdir -p /var/www/connectcare/binasmart/knowledge/travel
```

Slice block 3 of this task to `knowledge/travel/sources.json`.

```json
{
  "version": 1,
  "_about": "Official sources for the BinaSmart travel knowledge pack (design 2026-09-16, Piece 1). ops/travel/fetch-airline.js reads this file and nothing else: it fetches each site the way `fetch` says, keeps only paths matching `allow` and not matching `deny`, waits crawlDelaySeconds between requests, and writes knowledge/travel/<slug>.md. Booking, account, promotional and survey pages are never fetched. reach/checked are what was measured from this VPS on the stated date. A source we cannot reach is listed as manual, not deleted, so it is not quietly forgotten.",
  "sites": [
    {
      "id": "ethiopian-airlines",
      "name": "Ethiopian Airlines",
      "nameAm": "የኢትዮጵያ አየር መንገድ",
      "host": "www.ethiopianairlines.com",
      "fetch": "sitemap",
      "sitemap": "https://www.ethiopianairlines.com/et/sitemap/sitemap-index.xml",
      "seeds": ["https://www.ethiopianairlines.com/et/information/baggage-information/free-baggage-allowance"],
      "discoverLinks": true,
      "maxPages": 200,
      "crawlDelaySeconds": 5,
      "robots": "https://www.ethiopianairlines.com/robots.txt — Crawl-delay: 5, information paths allowed",
      "lang": "en",
      "langNote": "No Amharic locale exists. /am/ is the Armenia country site and answers HTTP 200 with the title 'Page Not Found'. The hreflang set is ar,de,en,es,fr,it,ja,ko,pt,ru,tr,zh,x-default. The pack is therefore English, and every document says so in its own header.",
      "reach": "up",
      "checked": "2026-09-16",
      "allow": [
        "^/et/information(/|$)",
        "^/et/services/add-on-services(/|$)",
        "^/et/services/on-board-services(/|$)",
        "^/et/services/services-at-the-airport(/|$)",
        "^/et/services/help-and-contact(/|$)",
        "^/et/services$",
        "^/et/book/check-in(/|$)",
        "^/et/book/manage(/|$)",
        "^/et/book/booking/(flight-schedule|flight-status|rail-fly|charter-flights)(/|$)",
        "^/et/book/special-deals/(medical-travel|corporate-travel|ethiopian-airlines-conventions)$",
        "^/et/explore/fleet(/|$)",
        "^/et/explore/network(/|$)",
        "^/et/explore/et-specials(/|$)",
        "^/et/travel-update(/|$)",
        "^/et/tsa-pre-check$",
        "^/et/ethiopian-app$",
        "^/et/meet-and-greet-services-at-addis-ababa-airport$"
      ],
      "deny": [
        "^/et/home-page(/|$)",
        "^/et/customer-surveys(/|$)",
        "^/et/customer-survey-landing$",
        "^/et/blog(/|$)",
        "^/et/book/booking/flight$",
        "^/et/book/booking$",
        "^/et/book$",
        "^/et/explore/deals-offers(/|$)",
        "^/et/ethiopian-offers$",
        "^/et/ethiopian-airlines-brand-audit-questionnaire$",
        "^/et/sitemap$",
        "^/et/supporttest$",
        "^/et/services/help-and-contact/call-center-survey$",
        "^/et/explore/et-specials/apply-ethiopian-e-visa/apply",
        "\\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4|mp3)$"
      ],
      "sections": [
        { "key": "baggage", "titleAm": "ሻንጣ", "match": "^/et/information/baggage-information(/|$)" },
        { "key": "rules", "titleAm": "ደንቦችና ሁኔታዎች", "match": "^/et/information/rules-and-regulations(/|$)" },
        { "key": "essential", "titleAm": "ከመብረርዎ በፊት", "match": "^/et/information/essential-information(/|$)" },
        { "key": "special-assistance", "titleAm": "ልዩ እርዳታ", "match": "^/et/information/special-needs(/|$)" },
        { "key": "check-in", "titleAm": "ቼክ ኢን", "match": "^/et/book/check-in(/|$)" },
        { "key": "changes-refunds", "titleAm": "ለውጥና ተመላሽ ገንዘብ", "match": "^/et/book/manage(/|$)" },
        { "key": "flight-info", "titleAm": "የበረራ መረጃ", "match": "^/et/book/booking(/|$)" },
        { "key": "special-deals", "titleAm": "ልዩ ቅናሾችና የሕክምና ጉዞ", "match": "^/et/book/special-deals(/|$)" },
        { "key": "transit-hub", "titleAm": "የአዲስ አበባ ማዕከል", "match": "^/et/services/services-at-the-airport(/|$)" },
        { "key": "add-ons", "titleAm": "ተጨማሪ አገልግሎቶች", "match": "^/et/services/add-on-services(/|$)" },
        { "key": "on-board", "titleAm": "በበረራ ላይ", "match": "^/et/services/on-board-services(/|$)" },
        { "key": "help", "titleAm": "እገዛና አድራሻ", "match": "^/et/services/help-and-contact(/|$)" },
        { "key": "et-specials", "titleAm": "ShebaMiles፣ ሆሊደይስና ስካይላይት", "match": "^/et/explore/et-specials(/|$)" },
        { "key": "fleet-network", "titleAm": "አውሮፕላኖችና መዳረሻዎች", "match": "^/et/explore/(fleet|network)(/|$)" },
        { "key": "updates", "titleAm": "የጉዞ ማሳሰቢያዎች", "match": "^/et/(travel-update|tsa-pre-check|ethiopian-app|meet-and-greet)" }
      ]
    },
    {
      "id": "ethiopian-cargo",
      "name": "Ethiopian Cargo and Logistics Services",
      "nameAm": "የኢትዮጵያ ካርጎ",
      "host": "cargo.ethiopianairlines.com",
      "fetch": "sitemap",
      "sitemap": "https://cargo.ethiopianairlines.com/sitemap.xml",
      "discoverLinks": false,
      "maxPages": 40,
      "crawlDelaySeconds": 5,
      "robots": "none published (the request returns the site's own 404 page) — the airline's 5 s pacing is applied here too",
      "lang": "en",
      "reach": "up",
      "checked": "2026-09-16",
      "allow": [
        "^/(cargo-services|products|services|special-cargo|information|customer-support|network)(/|$)"
      ],
      "deny": [
        "^/(book|track|login|account|errors)(/|$)",
        "\\.(pdf|jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|mp4|mp3)$"
      ],
      "sections": [
        { "key": "cargo", "titleAm": "ካርጎ", "match": "^/" }
      ],
      "note": "The homepage is an application shell: 95 KB of HTML, 5,042 characters of text, nearly all navigation. Pages under 400 characters of real text are dropped by the extractor, so a thin section simply produces no document rather than a document with nothing in it."
    },
    {
      "id": "ecaa",
      "name": "Ethiopian Civil Aviation Authority — passenger rights",
      "nameAm": "የኢትዮጵያ ሲቪል አቪዬሽን ባለሥልጣን",
      "host": "www.ecaa.gov.et",
      "fetch": "manual",
      "crawlDelaySeconds": 5,
      "lang": "en",
      "reach": "unreachable from this server",
      "checked": "2026-09-16",
      "why": "ecaa.gov.et resolves to 197.156.91.124 but every connection from this VPS times out, over http and https alike. This is the same behaviour ops/health/weekly-audit.js already records for Ethiopian government hosts, which answer inside Ethiopia and not from Paris. Until someone in Ethiopia saves the passenger-rights pages, the pack has no regulator text, and Bini must not imply it does."
    }
  ],
  "references": [
    {
      "id": "bina-airport-guide",
      "name": "BinaSmart Bole airport guide",
      "url": "https://bina.et/airport",
      "fetch": "none",
      "note": "Already indexed as source `page`, slug `airport` (PAGE_SLUGS in knowledge/index.js). Referenced by the pack and preferred alongside it for travel questions; never re-crawled, because crawling our own page would put it in the index twice."
    },
    {
      "id": "shebamiles-portal",
      "name": "ShebaMiles member portal",
      "url": "https://shebamiles.ethiopianairlines.com",
      "fetch": "none",
      "note": "An account site: sign-in, enrolment, balances. The design excludes account pages. ShebaMiles knowledge comes from the airline's own ShebaMiles FAQ and et-specials pages instead."
    }
  ]
}
```

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/sources.test.js 2>&1 | tail -8
```

Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Run the whole suite**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1260`, `# fail 0`.

- [ ] **Step 6: Commit**

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel pack: the source list" "" "knowledge/travel/sources.json names every source of the Ethiopian Airlines" "knowledge pack: what is fetched, from which host, under which paths, and what" "is deliberately left out. Booking, account, promotional and survey pages are" "denied by pattern, not by hand." "" "The Civil Aviation Authority is listed as manual: ecaa.gov.et resolves but no" "connection from this server completes, the same way every other Ethiopian" "government host behaves from Paris. Listing it keeps it visible instead of" "quietly missing." "" "No Amharic locale exists on the airline site - /am/ is Armenia and answers 200" "with a Page Not Found title - so the pack is English and says so." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm1.txt && git add knowledge/travel/sources.json test/travel/sources.test.js && git commit -F /tmp/cm1.txt && rm /tmp/cm1.txt
```

Expected: `2 files changed`, and the commit line names `knowledge/travel/sources.json` and `test/travel/sources.test.js`.

---
### Task 2: Choosing the URLs — sitemap parsing, the allowlist, and slugs

**Files:**
- Create: `ops/travel/fetch-airline.js` (first half — the pure URL functions; the fetching CLI arrives in Task 5)
- Test: `test/travel/fetch-urls.test.js`

Everything in this task is pure: bytes in, URLs out. No network, so it is all unit-tested.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/fetch-urls.test.js`.

```javascript
'use strict';
// Which pages the travel fetcher will ask for, decided from bytes alone. A mistake here is either a booking
// page in the knowledge index or a whole section of the airline's site silently missing, and neither shows
// up as an error, so the rules are pinned here rather than discovered on the live site.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs } = require('../../ops/travel/fetch-airline');
const reg = require('../../knowledge/travel/sources.json');
const ET = reg.sites.find(s => s.id === 'ethiopian-airlines');

const SITEMAP = `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.ethiopianairlines.com/et</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/information/baggage-information/free-baggage-allowance</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/home-page/save-10</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/book/booking/flight</loc></url>
  <url><loc>https://www.ethiopianairlines.com/et/book/check-in/online-check-in</loc></url>
</urlset>`;

const INDEX = `<?xml version="1.0" encoding="utf-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://www.ethiopianairlines.com/et/sitemap/sitemap.gz</loc></sitemap>
</sitemapindex>`;

test('sitemapUrls reads a urlset', () => {
  assert.equal(sitemapUrls(Buffer.from(SITEMAP)).urls.length, 5);
  assert.deepEqual(sitemapUrls(Buffer.from(SITEMAP)).indexes, []);
});

test('sitemapUrls reads a sitemap index as indexes, not as pages', () => {
  const r = sitemapUrls(Buffer.from(INDEX));
  assert.deepEqual(r.urls, []);
  assert.deepEqual(r.indexes, ['https://www.ethiopianairlines.com/et/sitemap/sitemap.gz']);
});

test('sitemapUrls gunzips a gzipped sitemap, because the airline serves sitemap.gz', () => {
  const r = sitemapUrls(zlib.gzipSync(Buffer.from(SITEMAP)));
  assert.equal(r.urls.length, 5);
});

test('sitemapUrls survives a byte-order mark and CDATA', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<urlset><url><loc><![CDATA[https://www.ethiopianairlines.com/et/services]]></loc></url></urlset>')]);
  assert.deepEqual(sitemapUrls(bom).urls, ['https://www.ethiopianairlines.com/et/services']);
});

test('pathOf returns the path with no query, no fragment and no trailing slash', () => {
  assert.equal(pathOf('https://www.ethiopianairlines.com/et/services/?x=1#a'), '/et/services');
  assert.equal(pathOf('https://www.ethiopianairlines.com/'), '/');
  assert.equal(pathOf('not a url'), null);
});

test('selectUrls keeps information pages and drops booking, promo and the site root', () => {
  const picked = selectUrls(ET, sitemapUrls(Buffer.from(SITEMAP)).urls);
  assert.deepEqual(picked.map(p => p.path), [
    '/et/book/check-in/online-check-in',
    '/et/information/baggage-information/free-baggage-allowance',
  ]);
});

test('selectUrls refuses another host, whatever the allowlist says', () => {
  const picked = selectUrls(ET, ['https://evil.example.com/et/information/baggage-information/x',
    'https://www.ethiopianairlines.com.evil.com/et/information/y']);
  assert.deepEqual(picked, []);
});

test('selectUrls drops duplicates, normalises to https and sorts by path so a run is reproducible', () => {
  const picked = selectUrls(ET, [
    'https://www.ethiopianairlines.com/et/services/on-board-services/allergy-policy',
    'http://www.ethiopianairlines.com/et/services/on-board-services/allergy-policy/',
    'https://www.ethiopianairlines.com/et/information/baggage-information/extra-baggage',
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].path, '/et/information/baggage-information/extra-baggage');
  assert.equal(picked[0].url, 'https://www.ethiopianairlines.com/et/information/baggage-information/extra-baggage');
});

test('selectUrls stops at maxPages', () => {
  const many = [];
  for (let i = 0; i < 300; i++) many.push('https://www.ethiopianairlines.com/et/information/essential-information/p' + i);
  assert.equal(selectUrls({ ...ET, maxPages: 5 }, many).length, 5);
});

test('selectUrls tags each page with the section it belongs to', () => {
  const [bag] = selectUrls(ET, ['https://www.ethiopianairlines.com/et/information/baggage-information/restricted-items']);
  assert.equal(bag.section, 'baggage');
  assert.equal(bag.sectionTitleAm, 'ሻንጣ');
});

test('slugFor drops the locale and keeps the last two path segments', () => {
  assert.equal(slugFor('/et/information/baggage-information/free-baggage-allowance'), 'baggage-information-free-baggage-allowance');
  assert.equal(slugFor('/et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs'), 'frequently-asked-questions-shebamiles-faqs');
  assert.equal(slugFor('/et/meet-and-greet-services-at-addis-ababa-airport'), 'meet-and-greet-services-at-addis-ababa-airport');
  assert.equal(slugFor('/et'), '');
});

test('assignSlugs lengthens a colliding slug instead of overwriting a file', () => {
  const out = assignSlugs([{ path: '/et/a/shared/name' }, { path: '/et/b/shared/name' }]);
  assert.deepEqual(out.map(p => p.slug).sort(), ['a-shared-name', 'b-shared-name']);
});

test('assignSlugs falls back to the whole path when even that collides', () => {
  const out = assignSlugs([{ path: '/et/x/a/shared/name' }, { path: '/et/y/a/shared/name' }]);
  assert.equal(new Set(out.map(p => p.slug)).size, 2);
  assert.ok(out.every(p => /^[a-z0-9-]+$/.test(p.slug)), 'slugs stay filename-safe');
});

test('assignSlugs does not depend on the order it was given', () => {
  const a = assignSlugs([{ path: '/et/a/shared/name' }, { path: '/et/b/shared/name' }]);
  const b = assignSlugs([{ path: '/et/b/shared/name' }, { path: '/et/a/shared/name' }]);
  assert.deepEqual(a.map(p => p.path + '=' + p.slug).sort(), b.map(p => p.path + '=' + p.slug).sort());
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-urls.test.js 2>&1 | tail -8
```

Expected: `Cannot find module '../../ops/travel/fetch-airline'`.

- [ ] **Step 3: Write the module**

```
mkdir -p /var/www/connectcare/binasmart/ops/travel
```

Slice block 3 of this task to `ops/travel/fetch-airline.js`.

```javascript
#!/usr/bin/env node
'use strict';
// The Ethiopian Airlines knowledge pack: fetch the airline's public information pages and write them as
// curated knowledge documents under knowledge/travel/. Driven entirely by knowledge/travel/sources.json.
//
// Polite by construction: one request at a time, at least the crawlDelaySeconds the registry names (5 for
// ethiopianairlines.com, which is what its robots.txt asks for), a browser-shaped user agent that says
// BinaSmart and gives a contact page, and never a link off the site's own host.
//
// This file is split in three: the pure URL functions (here), the extractor, and the writer. Everything is
// exported so the tests can run the rules without a network.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, 'knowledge', 'travel', 'sources.json');
const OUT_DIR = path.join(ROOT, 'knowledge', 'travel');
// Named, versioned, and points at a page a webmaster can read. Not a lie about being a browser: the airline
// is told who we are. The Chrome prefix is there because Sitecore fronts refuse bare tokens.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BinaSmart/1.0 (+https://bina.et/support)';

// ---------- sitemaps ----------
// Accepts raw or gzipped bytes and returns page urls and nested sitemap urls separately, because the
// airline's robots.txt points at an index whose only entry is a .gz.
function sitemapUrls(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) { try { b = zlib.gunzipSync(b); } catch (e) { return { urls: [], indexes: [] }; } }
  let xml = b.toString('utf8');
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const isIndex = /<sitemapindex\b/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].trim()).filter(Boolean);
  return isIndex ? { urls: [], indexes: locs } : { urls: locs, indexes: [] };
}

// ---------- paths ----------
function pathOf(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  } catch (e) { return null; }
}
const rx = list => (Array.isArray(list) ? list : []).map(p => new RegExp(p));
function sectionOf(site, p) {
  for (const s of site.sections || []) if (new RegExp(s.match).test(p)) return s;
  return null;
}

// Keep only this host's allowlisted, non-denied paths. Deduplicated by path, sorted by path (so two runs
// fetch in the same order), capped at maxPages. Returns [{ url, path, section, sectionTitleAm }].
function selectUrls(site, urls) {
  const allow = rx(site.allow), deny = rx(site.deny);
  const seen = new Map();
  for (const raw of urls || []) {
    let u; try { u = new URL(raw); } catch (e) { continue; }
    if (u.hostname !== site.host) continue;                  // never another host, never a look-alike
    if (!/^https?:$/.test(u.protocol)) continue;
    const p = pathOf(raw);
    if (!p || p === '/') continue;
    if (!allow.some(r => r.test(p))) continue;
    if (deny.some(r => r.test(p))) continue;
    if (seen.has(p)) continue;
    const sec = sectionOf(site, p);
    seen.set(p, { url: 'https://' + site.host + p, path: p, section: sec ? sec.key : null, sectionTitleAm: sec ? sec.titleAm : null });
  }
  const out = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const max = Number(site.maxPages) || 200;
  return out.slice(0, max);
}

// ---------- slugs ----------
const clean = s => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
function segments(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (parts.length && /^[a-z]{2}$/.test(parts[0])) parts.shift();   // the locale prefix: /et/, /aa/
  return parts;
}
// The last two path segments: short enough to read, specific enough that
// /et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs and
// /et/information/baggage-information/free-baggage-allowance do not look alike.
function slugFor(p, take = 2) {
  const parts = segments(p);
  if (!parts.length) return '';
  return clean(parts.slice(-take).join('-'));
}
// Give every page a slug no other page has, lengthening only the ones that clash. Order-independent: the
// input is sorted by path first, so the same set of pages always produces the same set of filenames.
function assignSlugs(pages) {
  const list = [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const out = list.map(p => ({ ...p, slug: slugFor(p.path) }));
  for (let take = 3; take <= 8; take++) {
    const count = new Map();
    for (const p of out) count.set(p.slug, (count.get(p.slug) || 0) + 1);
    const clashing = [...count].filter(([, n]) => n > 1).map(([s]) => s);
    if (!clashing.length) break;
    for (const p of out) if (clashing.includes(p.slug)) p.slug = slugFor(p.path, take) || clean(p.path);
  }
  return out;
}

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, UA, REGISTRY, OUT_DIR, ROOT };
```

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-urls.test.js 2>&1 | tail -6
```

Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 5: Check the allowlist against the real sitemap already on disk**

The real sitemap was downloaded to `/tmp/et-sitemap.xml` while this plan was written. If it is gone, skip this step — Task 5 re-downloads it.

```
cd /var/www/connectcare/binasmart && node -e "const f=require('./ops/travel/fetch-airline');const reg=require('./knowledge/travel/sources.json');const ET=reg.sites.find(s=>s.id==='ethiopian-airlines');const fs=require('fs');if(!fs.existsSync('/tmp/et-sitemap.xml'))return console.log('sitemap not on disk, skip');const u=f.sitemapUrls(fs.readFileSync('/tmp/et-sitemap.xml')).urls;const picked=f.assignSlugs(f.selectUrls(ET,u));console.log('sitemap urls',u.length,'selected',picked.length,'slugs',new Set(picked.map(p=>p.slug)).size);const by={};for(const p of picked)by[p.section]=(by[p.section]||0)+1;console.log(JSON.stringify(by));"
```

Expected (measured against the sitemap of 2026-09-14; the exact counts depend on the sitemap of the day):

```
sitemap urls 228 selected 119 slugs 119
{"add-ons":14,"help":11,"fleet-network":10,"baggage":9,"flight-info":8,"essential":7,"rules":7,"special-assistance":7,"on-board":7,"changes-refunds":6,"transit-hub":6,"updates":5,"check-in":4,"special-deals":3,"et-specials":1,"null":2}
```

**What must be true:** `selected` is about 119, `slugs` equals `selected` (no collisions), and **no selected path starts with `/et/home-page/`, `/et/customer-surveys/` or `/et/blog/`**. The two `null` sections are `/et/information` and `/et/services`, the two top-level hub pages, which belong to no one section; a document with no section simply omits the Amharic section name from its header. Check the forbidden paths explicitly:

```
cd /var/www/connectcare/binasmart && node -e "const f=require('./ops/travel/fetch-airline');const ET=require('./knowledge/travel/sources.json').sites.find(s=>s.id==='ethiopian-airlines');const fs=require('fs');const u=f.sitemapUrls(fs.readFileSync('/tmp/et-sitemap.xml')).urls;const bad=f.selectUrls(ET,u).filter(p=>/^\/et\/(home-page|customer-surveys|blog)\//.test(p.path));console.log('forbidden paths selected:',bad.length);"
```

Expected: `forbidden paths selected: 0`.

- [ ] **Step 6: Run the whole suite and commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1273`, `# fail 0`.

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel pack: which URLs the fetcher will ask for" "" "sitemapUrls reads a urlset or a sitemap index, gunzipping when the bytes are" "gzipped, because the airline's robots.txt points at an index whose only entry" "is sitemap.gz." "" "selectUrls keeps only this host - a look-alike hostname is refused before the" "allowlist is even consulted - and only paths the registry allows and does not" "deny. It sorts by path so two runs fetch in the same order." "" "assignSlugs gives every page the last two segments of its path and lengthens" "only the ones that clash, so a filename never silently overwrites another." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm2.txt && git add ops/travel/fetch-airline.js test/travel/fetch-urls.test.js && git commit -F /tmp/cm2.txt && rm /tmp/cm2.txt
```

Expected: `2 files changed`.

---

### Task 3: The extractor — real text out of a marketing page

**Files:**
- Modify: `ops/travel/fetch-airline.js` (add `cleanTitle`, `extract`, and the module exports)
- Test: `test/travel/fetch-extract.test.js`

The airline's pages are server-rendered but buried: a baggage page is 276 KB of HTML, 19,652 characters of text, of which the first ~460 lines are the mega-menu. This task turns HTML into text and decides whether a page is usable at all. It does **not** remove the mega-menu — that is a whole-corpus judgement and belongs in Task 4.

Two traps this must handle, both observed on the live site:

- **Soft 404.** `https://www.ethiopianairlines.com/am/` answers **HTTP 200** with `<title>Page Not Found | Ethiopian Airlines | AM</title>`. A status code is not a page.
- **Application shells.** `cargo.ethiopianairlines.com` serves 95 KB of HTML with 5 KB of text, nearly all navigation. Under 400 characters of real text, there is nothing to index — the same threshold `knowledge/index.js` already uses for crawled pages.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/fetch-extract.test.js`.

```javascript
'use strict';
// HTML in, indexable text out. The fixtures are written by hand rather than saved from the live site: they
// are small enough to read, they exercise one rule each, and they never go stale. The real site is checked
// separately, live, in Task 3 Step 5 - a fixture proves the rule, a live page proves the site.
const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, extract } = require('../../ops/travel/fetch-airline');

const page = (title, body) => '<!DOCTYPE html><html lang="en"><head><title>' + title +
  '</title><meta name="x" content="y"><style>.a{color:red}</style></head><body>' +
  '<nav><a href="/et/book">Book</a><a href="/et/manage">Manage</a></nav>' + body +
  '<footer><p>&copy; Ethiopian Airlines</p></footer><script>var a=1;</script></body></html>';

const BAGGAGE = page('Free Baggage Allowance | Ethiopian Airlines | ET', `
  <h1>Free Baggage Allowance</h1>
  <h2>Checked baggage</h2>
  <p>Maximum total size: 62 inches (158 cm), including handles and wheels. Maximum weight: 50 lbs (23 kg).</p>
  <h2>Carry-on baggage</h2>
  <ul><li>Economy: 1 piece, 7kg</li><li>Business: 2 pieces, 7kg each</li></ul>
  <h3>Dimensions</h3>
  <table><tr><th>Class</th><th>Pieces</th><th>Weight</th></tr>
  <tr><td>Economy</td><td>2</td><td>23 kg each</td></tr>
  <tr><td>Cloud Nine</td><td>2</td><td>32 kg each</td></tr></table>
  <p>Some weight systems depend on the route on which you are travelling. Where the weight system applies,
  the allowance is expressed in kilograms for the whole journey rather than as a number of pieces, and the
  two cannot be combined on one ticket. Check the ticket before travelling.</p>`);

test('cleanTitle drops the airline suffix and decodes entities', () => {
  assert.equal(cleanTitle('Free Baggage Allowance | Ethiopian Airlines | ET'), 'Free Baggage Allowance');
  assert.equal(cleanTitle('Lost &amp; Found | Ethiopian Airlines'), 'Lost & Found');
  assert.equal(cleanTitle('\n\tPage  Not   Found\n'), 'Page Not Found');
  assert.equal(cleanTitle('Cargo Services | Ethiopian Cargo Website'), 'Cargo Services');
});

test('extract keeps the headings', () => {
  const r = extract(BAGGAGE);
  assert.equal(r.ok, true);
  assert.equal(r.title, 'Free Baggage Allowance');
  const heads = r.text.split('\n').filter(l => /^#{1,3} /.test(l));
  assert.deepEqual(heads, ['# Free Baggage Allowance', '## Checked baggage', '## Carry-on baggage', '### Dimensions']);
});

test('extract keeps the figures a traveller came for', () => {
  const r = extract(BAGGAGE);
  for (const fact of ['158 cm', '23 kg', '7kg', '32 kg']) assert.ok(r.text.includes(fact), 'lost ' + fact);
});

test('extract keeps list items and table rows', () => {
  const r = extract(BAGGAGE);
  assert.ok(r.text.includes('- Economy: 1 piece, 7kg'), 'list item');
  assert.ok(/Cloud Nine \| 2 \| 32 kg each/.test(r.text), 'table row: ' + r.text);
});

test('extract drops script, style, nav and footer', () => {
  const r = extract(BAGGAGE);
  assert.ok(!r.text.includes('var a=1'), 'script');
  assert.ok(!r.text.includes('color:red'), 'style');
  assert.ok(!r.text.includes('Manage'), 'nav');
  assert.ok(!r.text.includes('Ethiopian Airlines'), 'footer');
});

test('extract refuses the soft 404 the airline serves at HTTP 200', () => {
  const body = '<h1>Page Not Found</h1><p>' + 'The page you are looking for is not here. '.repeat(30) + '</p>';
  const r = extract(page('Page Not Found | Ethiopian Airlines | AM', body));
  assert.equal(r.ok, false);
  assert.equal(r.why, 'soft_404');
});

test('extract refuses an application shell with nothing to read', () => {
  const r = extract(page('Book | Ethiopian Cargo Website', '<div><a href="/track">Track</a></div>'));
  assert.equal(r.ok, false);
  assert.equal(r.why, 'thin');
});

test('extract refuses bytes that are not a page at all', () => {
  assert.equal(extract('').why, 'empty');
  assert.equal(extract('{"error":"nope"}').why, 'empty');
});

test('extract reports how much it kept, so a run can be read at a glance', () => {
  const r = extract(BAGGAGE);
  assert.equal(typeof r.chars, 'number');
  assert.equal(r.chars, r.text.length);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-extract.test.js 2>&1 | tail -8
```

Expected: `TypeError: cleanTitle is not a function` (the module exists but does not export it yet).

- [ ] **Step 3: Add the extractor**

Slice block 2 of this task to `/tmp/travel-extract.js`, then paste it into `ops/travel/fetch-airline.js` immediately above the `module.exports` line, and replace the `module.exports` line with the one at the end of the block.

```javascript
// ---------- the extractor ----------
// htmlToText is the index's own converter: it drops head, script, style, nav, footer, header, noscript, svg
// and form, turns h1-h3 into markdown headings, li into "- ", and table cells into " | " rows. Using it
// rather than a second implementation means a page reads in the pack exactly as it would read in the index.
const { htmlToText } = require(path.join(ROOT, 'knowledge', 'index.js'));

const SITE_SUFFIX = /\s*\|\s*(Ethiopian Airlines(\s*\|\s*[A-Z]{2})?|Ethiopian Cargo Website)\s*$/i;
// The airline answers 200 with this title for a path that does not exist - /am/ (Armenia) does it today.
const NOT_FOUND = /^(page not found|404|not found)$/i;
const MIN_CHARS = 400;   // the same floor knowledge/index.js puts under a crawled page

function cleanTitle(raw) {
  return htmlToText('<p>' + String(raw || '') + '</p>').replace(/\s+/g, ' ').replace(SITE_SUFFIX, '').trim();
}

// { ok:true, title, text, chars } or { ok:false, why } where why is empty | soft_404 | thin.
function extract(html) {
  const s = String(html || '');
  if (s.length < 200 || !/<html|<body|<div/i.test(s)) return { ok: false, why: 'empty' };
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const title = cleanTitle(m ? m[1] : '');
  if (NOT_FOUND.test(title)) return { ok: false, why: 'soft_404' };
  const text = htmlToText(s);
  if (text.trim().length < MIN_CHARS) return { ok: false, why: 'thin' };
  return { ok: true, title: title || '(untitled)', text, chars: text.length };
}

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract,
  UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS };
```

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-extract.test.js 2>&1 | tail -6
```

Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 5: Check the extractor against a real page — not a fixture**

Fetch one live page, once, with the pacing already respected (this is a single request), and read what comes out.

```
cd /tmp && curl -s -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BinaSmart/1.0 (+https://bina.et/support)" -L --max-time 40 -o /tmp/live-bag.html -w "http %{http_code} bytes %{size_download}\n" https://www.ethiopianairlines.com/et/information/baggage-information/free-baggage-allowance
```

Expected: `http 200 bytes 27xxxx` (roughly 276,000).

```
cd /var/www/connectcare/binasmart && node -e "const {extract}=require('./ops/travel/fetch-airline');const r=extract(require('fs').readFileSync('/tmp/live-bag.html','utf8'));console.log(r.ok,r.why||'',JSON.stringify(r.title),r.chars);console.log(r.text.split('\n').filter(l=>/^#{1,3} /.test(l)).join(' | '));console.log((r.text.match(/\d+\s?(kg|cm|lbs?)/gi)||[]).slice(0,12).join(', '));"
```

Expected, close to:

```
true  "Free Baggage Allowance" 19652
### Search a country | ## Checked baggage | ## Carry-on baggage | ## Personal item | ## Infant Baggage Allowance | ### Subscribe
20Kg, 158 cm, 158 cm, 50 lbs, 23 kg, 32kg, 7kg, 7kg, 7Kg, 10 kg, 23 kg, 23kg
```

**What must be true:** `ok` is `true`, the title is the page's own, the content headings (`Checked baggage`, `Carry-on baggage`, `Infant Baggage Allowance`) are present, and the kilo figures survive. `Search a country` and `Subscribe` are template headings — Task 4 removes them.

And check the soft 404 is really refused, against the live one:

```
cd /tmp && curl -s -A "Mozilla/5.0 BinaSmart/1.0" -L --max-time 40 -o /tmp/live-am.html -w "http %{http_code}\n" https://www.ethiopianairlines.com/am/ && cd /var/www/connectcare/binasmart && node -e "console.log(JSON.stringify(require('./ops/travel/fetch-airline').extract(require('fs').readFileSync('/tmp/live-am.html','utf8'))))"
```

Expected:

```
http 200
{"ok":false,"why":"soft_404"}
```

That is the whole point: **HTTP 200 and still not a page.**

- [ ] **Step 6: Run the whole suite and commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1282`, `# fail 0`.

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel pack: HTML in, indexable text out" "" "extract() uses knowledge/index.js htmlToText rather than a second converter, so" "a page reads in the pack exactly as it reads in the index: markdown headings," "list items, and table cells as pipe-separated rows - which is where the kilos" "and the fees are, since the baggage page has no table elements at all." "" "Two refusals, both measured on the live site. The airline answers HTTP 200 with" "a Page Not Found title for a path that does not exist (/am/ does it today), so" "a status code is not a page. And an application shell - cargo's homepage is" "95 KB of HTML and 5 KB of navigation - has nothing to index, so anything under" "400 characters of text is dropped, the same floor crawled pages already have." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm3.txt && git add ops/travel/fetch-airline.js test/travel/fetch-extract.test.js && git commit -F /tmp/cm3.txt && rm /tmp/cm3.txt
```

Expected: `2 files changed`.

---
### Task 4: Documents on disk — template stripping, front matter, and the write rules

**Files:**
- Modify: `ops/travel/fetch-airline.js` (add `stripPackBoilerplate`, `contentHash`, `frontMatter`, `renderDoc`, `readMeta`, `touchLastChecked`, `writePack`)
- Test: `test/travel/pack-docs.test.js`

The mega-menu is on every page, so it cannot be removed by looking at one page. `knowledge/index.js` already solves exactly this for crawled sites — `stripBoilerplate` drops any paragraph that appears on a large share of one site's pages, self-tuning, no per-site rules — and it is exported. Reuse it; do not write a second one.

**The consequence, and why it is written down:** because the template is removed by comparing pages, a document's `contentHash` is taken over the **stripped** text. If the airline changes its site-wide notification bar, many pages change at once. Task 11's freshness check therefore reports a site-wide change as one line, not fifty.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/pack-docs.test.js`.

```javascript
'use strict';
// What ends up on disk under knowledge/travel/. The front matter is not decoration: knowledge/index.js reads
// title, url and lang out of it with a line-by-line regex, and Task 6 adds `status` to that. The hash is what
// the weekly freshness check compares, so it must ignore whitespace and nothing else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripPackBoilerplate, contentHash, frontMatter, renderDoc, readMeta, touchLastChecked, writePack } =
  require('../../ops/travel/fetch-airline');

const SITE = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', lang: 'en' };
const MENU = 'Book a Flight Rail and Fly Flight Status Flight Schedules Charter Services';
const NOTICE = 'Please note that payment by bank cards issued in Russia is not available on the website.';
const pageOf = (slug, body) => ({ siteId: 'ethiopian-airlines', slug, path: '/et/x/' + slug,
  url: 'https://www.ethiopianairlines.com/et/x/' + slug, title: slug, section: 'baggage',
  sectionTitleAm: 'ሻንጣ', text: MENU + '\n\n' + body + '\n\n' + NOTICE });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'travelpack-'));

test('stripPackBoilerplate removes what every page repeats and keeps what only one page says', () => {
  const pages = ['a', 'b', 'c', 'd', 'e', 'f'].map((s, i) => pageOf(s, 'Only page ' + i + ' says this, at length, so it is content.'));
  const out = stripPackBoilerplate(pages);
  for (let i = 0; i < out.length; i++) {
    assert.ok(!out[i].text.includes(MENU), out[i].slug + ' kept the menu');
    assert.ok(!out[i].text.includes(NOTICE), out[i].slug + ' kept the site notice');
    assert.ok(out[i].text.includes('Only page ' + i), out[i].slug + ' lost its own content');
  }
});

test('stripPackBoilerplate never mixes two sites', () => {
  const et = ['a', 'b', 'c', 'd'].map(s => pageOf(s, 'shared sentence that both sites happen to print on every page.'));
  const cargo = ['p', 'q', 'r', 'sX'].map(s => ({ ...pageOf(s, 'cargo only text ' + s + ' long enough to count as content.'), siteId: 'ethiopian-cargo' }));
  const out = stripPackBoilerplate([...et, ...cargo]);
  assert.ok(out.filter(p => p.siteId === 'ethiopian-cargo').every(p => p.text.includes('cargo only text')));
});

test('contentHash ignores whitespace and nothing else', () => {
  assert.equal(contentHash('Maximum weight: 23 kg'), contentHash('Maximum   weight:\n23 kg'));
  assert.notEqual(contentHash('Maximum weight: 23 kg'), contentHash('Maximum weight: 32 kg'));
  assert.match(contentHash('x'), /^[0-9a-f]{40}$/);
});

test('frontMatter escapes a quote so knowledge/index.js can still read the line', () => {
  const fm = frontMatter({ title: 'The "Cloud Nine" cabin', url: 'https://x/y', lang: 'en' });
  assert.ok(fm.includes('title: "The \\"Cloud Nine\\" cabin"'));
  const meta = readMeta(fm + '\nbody\n');
  assert.equal(meta.title, 'The "Cloud Nine" cabin');
});

test('renderDoc writes the fields the freshness check and the index both need', () => {
  const md = renderDoc(pageOf('free-baggage-allowance', 'Maximum weight: 50 lbs (23 kg).'), SITE, { today: '2026-09-16' });
  const meta = readMeta(md);
  assert.equal(meta.url, 'https://www.ethiopianairlines.com/et/x/free-baggage-allowance');
  assert.equal(meta.lang, 'en');
  assert.equal(meta.section, 'baggage');
  assert.equal(meta.fetchedAt, '2026-09-16');
  assert.equal(meta.lastChecked, '2026-09-16');
  assert.equal(meta.status, 'live');
  assert.equal(meta.source_name, 'Ethiopian Airlines');
  assert.equal(meta.generated_by, 'ops/travel/fetch-airline.js');
  assert.match(meta.contentHash, /^[0-9a-f]{40}$/);
});

test('renderDoc names the airline in the title, so every retrieved chunk says whose rule it is', () => {
  const meta = readMeta(renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' }));
  assert.equal(meta.title, 'Ethiopian Airlines — carry-on-baggage');
});

test('renderDoc heads the document in English and Amharic, and says the airline publishes no Amharic page', () => {
  const md = renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' });
  assert.ok(md.includes('Source: https://www.ethiopianairlines.com/et/x/carry-on-baggage'), 'English provenance line');
  assert.ok(md.includes('በአማርኛ፦'), 'Amharic provenance line');
  assert.ok(md.includes('ሻንጣ'), 'the section name in Amharic, so an Amharic question has something to match');
  assert.ok(md.includes('Economy: 1 piece, 7kg.'), 'the page text itself');
});

test('renderDoc states no fact of its own: every figure in it comes from the page text', () => {
  const md = renderDoc(pageOf('carry-on-baggage', 'Economy: 1 piece, 7kg.'), SITE, { today: '2026-09-16' });
  const head = md.split('Economy: 1 piece')[0];
  const numbers = (head.match(/\b\d+\s?(kg|kilo|cm|lbs?|birr|usd|hours?|days?)\b/gi) || []);
  assert.deepEqual(numbers, [], 'the header invented a figure: ' + numbers.join(', '));
});

test('writePack adds a file that is not there', () => {
  const dir = tmp();
  const r = writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16' });
  assert.deepEqual(r.added, ['a']);
  assert.ok(fs.existsSync(path.join(dir, 'a.md')));
});

test('writePack refuses to rewrite a file whose content has not changed, and only moves lastChecked', () => {
  const dir = tmp();
  const page = pageOf('a', 'first page content, long enough to be real.');
  writePack(dir, [page], SITE, { today: '2026-09-16' });
  const before = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  const r = writePack(dir, [page], SITE, { today: '2026-09-23' });
  const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  assert.deepEqual(r.unchanged, ['a']);
  assert.deepEqual(r.changed, []);
  assert.equal(readMeta(after).fetchedAt, '2026-09-16', 'fetchedAt must not move when nothing changed');
  assert.equal(readMeta(after).lastChecked, '2026-09-23', 'lastChecked must move');
  assert.equal(after.split('---\n')[2], before.split('---\n')[2], 'the body is byte-identical');
});

test('writePack rewrites a changed page and keeps the date it was first seen', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'Maximum weight 23 kg.')], SITE, { today: '2026-09-16' });
  const r = writePack(dir, [pageOf('a', 'Maximum weight 32 kg.')], SITE, { today: '2026-09-23' });
  assert.deepEqual(r.changed, ['a']);
  const meta = readMeta(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'));
  assert.equal(meta.fetchedAt, '2026-09-23');
  assert.equal(meta.firstFetched, '2026-09-16');
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('32 kg'));
});

test('writePack marks a vanished page gone instead of deleting what we last knew', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'still here and readable.'), pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-16' });
  const r = writePack(dir, [pageOf('a', 'still here and readable.')], SITE, { today: '2026-09-23' });
  assert.deepEqual(r.gone, ['b']);
  const meta = readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8'));
  assert.equal(meta.status, 'gone');
  assert.equal(meta.goneAt, '2026-09-23');
  assert.ok(fs.readFileSync(path.join(dir, 'b.md'), 'utf8').includes('about to disappear'), 'the last known text stays on disk');
});

test('writePack marks a page live again when it comes back', () => {
  const dir = tmp();
  writePack(dir, [pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-16' });
  writePack(dir, [], SITE, { today: '2026-09-23' });
  const r = writePack(dir, [pageOf('b', 'about to disappear from the site.')], SITE, { today: '2026-09-30' });
  assert.deepEqual(r.changed, ['b']);
  assert.equal(readMeta(fs.readFileSync(path.join(dir, 'b.md'), 'utf8')).status, 'live');
});

test('writePack in dry-run writes nothing at all but still reports what it would do', () => {
  const dir = tmp();
  const r = writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16', dryRun: true });
  assert.deepEqual(r.added, ['a']);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('writePack never touches sources.json', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'sources.json'), '{"keep":true}');
  writePack(dir, [], SITE, { today: '2026-09-16' });
  assert.equal(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'), '{"keep":true}');
});

test('touchLastChecked changes exactly one line', () => {
  const dir = tmp();
  writePack(dir, [pageOf('a', 'first page content, long enough to be real.')], SITE, { today: '2026-09-16' });
  const f = path.join(dir, 'a.md');
  const before = fs.readFileSync(f, 'utf8').split('\n');
  touchLastChecked(f, '2026-10-01');
  const after = fs.readFileSync(f, 'utf8').split('\n');
  const diff = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b);
  assert.equal(diff.length, 1);
  assert.match(diff[0][1], /^lastChecked: "2026-10-01"$/);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/pack-docs.test.js 2>&1 | tail -8
```

Expected: `TypeError: stripPackBoilerplate is not a function`.

- [ ] **Step 3: Add the document layer**

Slice block 2 of this task to `/tmp/travel-docs.js`, then paste it into `ops/travel/fetch-airline.js` above the `module.exports` line, and replace `module.exports` with the version at the end of the block.

```javascript
// ---------- documents on disk ----------
const crypto = require('crypto');
const { stripBoilerplate } = require(path.join(ROOT, 'knowledge', 'index.js'));

// The mega-menu and the site-wide notices (a Kigali roadworks advisory, a Russian card-payment notice, an
// Israel transit notice) are on EVERY page, so they cannot be spotted from one page. knowledge/index.js
// already solves this for crawled sites and is exported: any paragraph that appears on a large share of one
// site's pages is template, not content. It groups by the first path segment of the slug, so the site id is
// borrowed as that segment here and taken off again afterwards.
function stripPackBoilerplate(pages) {
  const wrapped = pages.map(p => ({ ...p, slug: p.siteId + '/' + p.slug }));
  const stripped = stripBoilerplate(wrapped, { minPages: 4, ratio: 0.15 });
  return stripped.map(p => ({ ...p, slug: p.slug.slice(p.siteId.length + 1), text: p.text.trim() }));
}

// Whitespace-insensitive so a reflowed paragraph is not "a change"; sensitive to everything else, because
// 23 kg becoming 32 kg is exactly what the weekly check exists to catch.
const normText = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
function contentHash(text) { return crypto.createHash('sha1').update(normText(text)).digest('hex'); }

const esc = s => String(s).replace(/"/g, '\\"');
// knowledge/index.js parses front matter line by line with /^(\w+):\s*"?(.*?)"?\s*$/, so every key is a
// single word and every value is one line. Order is fixed so a diff of two runs shows only what moved.
const FM_KEYS = ['url', 'title', 'source_name', 'section', 'lang', 'status', 'fetchedAt', 'lastChecked',
  'firstFetched', 'goneAt', 'contentHash', 'generated_by'];
function frontMatter(meta) {
  const lines = ['---'];
  for (const k of FM_KEYS) if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') lines.push(k + ': "' + esc(meta[k]) + '"');
  lines.push('---');
  return lines.join('\n');
}
function readMeta(md) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(String(md));
  if (!fm) return {};
  const meta = {};
  for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
  return meta;
}
function bodyOf(md) { const fm = /^---\n[\s\S]*?\n---\n/.exec(String(md)); return fm ? String(md).slice(fm[0].length) : String(md); }

// The header states provenance and nothing else. It must never contain a figure: a kilo or a fee in a header
// written by this script would be a fact from memory, which is the one thing the design forbids.
function header(page, site, today) {
  const en = 'Source: ' + page.url + ' (official ' + site.name + ' page, in English), fetched ' + today
    + '. Everything below is that page as it was written — figures, fees, kilos and time limits are copied, not restated.'
    + ' Confirm on the page before travelling.';
  const am = 'በአማርኛ፦ ይህ ገጽ ከ' + site.nameAm + ' ኦፊሴላዊ ድረ-ገጽ (' + page.url + ') የተወሰደ ነው። '
    + (page.sectionTitleAm ? 'ክፍል፦ ' + page.sectionTitleAm + '። ' : '')
    + 'አየር መንገዱ የአማርኛ ገጽ ስለማያዘጋጅ ጽሑፉ በእንግሊዝኛ ነው። ኪሎዎች፣ ክፍያዎችና የጊዜ ገደቦች እንደተጻፉ ናቸው፤ ከመጓዝዎ በፊት በገጹ ላይ ያረጋግጡ።';
  return en + '\n\n' + am;
}

function renderDoc(page, site, { today, firstFetched } = {}) {
  const title = site.name + ' — ' + (page.title || page.slug);
  const meta = { url: page.url, title, source_name: site.name, section: page.section || '', lang: site.lang || 'en',
    status: 'live', fetchedAt: today, lastChecked: today, firstFetched: firstFetched && firstFetched !== today ? firstFetched : '',
    contentHash: contentHash(page.text), generated_by: 'ops/travel/fetch-airline.js' };
  return frontMatter(meta) + '\n\n# ' + title + '\n\n' + header(page, site, today) + '\n\n' + page.text.trim() + '\n';
}

// Rewrite exactly one line. Used when a page is unchanged: the body must stay byte-identical (so git shows
// nothing and the ingest's hash finds nothing to do) while the record of when we last looked still advances.
function touchLastChecked(file, today) {
  const cur = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, cur.replace(/^lastChecked: ".*"$/m, 'lastChecked: "' + esc(today) + '"'));
}

// docs: [{ siteId, slug, path, url, title, section, sectionTitleAm, text }] for ONE site, already stripped.
// Returns { added, changed, unchanged, gone, revived } as lists of slugs.
function writePack(dir, docs, site, { today, dryRun = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const day = today || new Date().toISOString().slice(0, 10);
  const r = { added: [], changed: [], unchanged: [], gone: [], revived: [] };
  const wanted = new Map(docs.map(d => [d.slug, d]));
  const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

  for (const [slug, d] of wanted) {
    const file = path.join(dir, slug + '.md');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const oldMeta = old ? readMeta(old) : null;
    if (oldMeta && oldMeta.contentHash === contentHash(d.text) && oldMeta.status !== 'gone') {
      r.unchanged.push(slug);
      if (!dryRun && oldMeta.lastChecked !== day) touchLastChecked(file, day);
      continue;
    }
    const first = (oldMeta && (oldMeta.firstFetched || oldMeta.fetchedAt)) || day;
    if (!old) r.added.push(slug); else { r.changed.push(slug); if (oldMeta.status === 'gone') r.revived.push(slug); }
    if (!dryRun) fs.writeFileSync(file, renderDoc(d, site, { today: day, firstFetched: first }));
  }

  for (const f of onDisk) {
    const slug = f.replace(/\.md$/, '');
    if (wanted.has(slug)) continue;
    const cur = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = readMeta(cur);
    if (meta.source_name !== site.name) continue;        // another site's document in the same directory
    if (meta.status === 'gone') continue;                // already marked, do not report it again every week
    r.gone.push(slug);
    if (dryRun) continue;
    const next = { ...meta, status: 'gone', goneAt: day, lastChecked: day };
    fs.writeFileSync(path.join(dir, f), frontMatter(next) + '\n' + bodyOf(cur));
  }
  return r;
}

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract,
  stripPackBoilerplate, contentHash, frontMatter, readMeta, bodyOf, renderDoc, touchLastChecked, writePack,
  UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS };
```

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/pack-docs.test.js 2>&1 | tail -6
```

Expected: `# pass 16`, `# fail 0`.

- [ ] **Step 5: Run the whole suite and commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1298`, `# fail 0` (1282 from Task 3 plus the 16 new tests).

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel pack: what a page looks like on disk" "" "The mega-menu and the site-wide notices are on every page, so no single page" "shows which part of it is template. knowledge/index.js already answers that for" "crawled sites and is exported, so stripPackBoilerplate borrows it rather than" "writing a second one: a paragraph on a large share of one site's pages is" "template. The consequence is written down - the content hash is taken over the" "stripped text, so a change to the site-wide notice moves many pages at once," "which the weekly check reports as one line, not fifty." "" "writePack refuses to rewrite a page whose content has not changed; it moves the" "lastChecked line and leaves the body byte-identical. A page that leaves the site" "is marked gone and keeps its last known text instead of being deleted." "" "The document header states provenance in English and Amharic and contains no" "figure at all - a kilo written there would be a fact from memory." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm4.txt && git add ops/travel/fetch-airline.js test/travel/pack-docs.test.js && git commit -F /tmp/cm4.txt && rm /tmp/cm4.txt
```

Expected: `2 files changed`.

---

### Task 5: The fetcher itself — pacing, discovery, dry run, and the real 120-page run

**Files:**
- Modify: `ops/travel/fetch-airline.js` (add `makeFetcher`, `linksOn`, `fetchSite`, `main`)
- Test: `test/travel/fetch-run.test.js`

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/fetch-run.test.js`.

```javascript
'use strict';
// The fetching loop, with an injected network and an injected clock: the pacing, the retry, the refusal to
// leave the host, and the one level of link discovery that is the only reason ShebaMiles, Ethiopian Holidays
// and the Skylight hotel are in the pack at all - the airline's sitemap does not list them.
const test = require('node:test');
const assert = require('node:assert');
const { makeFetcher, linksOn, fetchSite } = require('../../ops/travel/fetch-airline');

const html = (title, body) => '<!DOCTYPE html><html><head><title>' + title + ' | Ethiopian Airlines | ET</title></head><body>' +
  '<h1>' + title + '</h1><p>' + body + '</p><p>' + 'padding sentence to clear the four hundred character floor. '.repeat(12) + '</p></body></html>';

function net(map) {
  const asked = [];
  return { asked, impl: async url => {
    asked.push(String(url));
    const v = map[String(url)];
    if (v === undefined) return { status: 404, ok: false, headers: { get: () => 'text/html' }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    if (typeof v === 'number') return { status: v, ok: false, headers: { get: () => 'text/html' }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return { status: 200, ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => v, arrayBuffer: async () => Buffer.from(v) };
  } };
}

test('makeFetcher waits the crawl delay between requests and not before the first', async () => {
  const slept = [];
  const n = net({ 'https://h/a': html('A', 'a'), 'https://h/b': html('B', 'b') });
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async ms => slept.push(ms), delayMs: 5000 });
  await get('https://h/a');
  await get('https://h/b');
  assert.deepEqual(slept, [5000]);
});

test('makeFetcher retries once on a 5xx and gives up cleanly', async () => {
  const slept = [];
  const n = net({ 'https://h/a': 503 });
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async ms => slept.push(ms), delayMs: 5000 });
  const r = await get('https://h/a');
  assert.equal(r.ok, false);
  assert.equal(r.why, 'http_503');
  assert.equal(n.asked.filter(u => u === 'https://h/a').length, 2, 'one retry, not a loop');
});

test('makeFetcher does not retry a 404', async () => {
  const n = net({});
  const get = makeFetcher({ fetchImpl: n.impl, sleep: async () => {}, delayMs: 0 });
  const r = await get('https://h/missing');
  assert.equal(r.why, 'http_404');
  assert.equal(n.asked.length, 1);
});

test('makeFetcher refuses a response that is not HTML', async () => {
  const get = makeFetcher({ delayMs: 0, sleep: async () => {},
    fetchImpl: async () => ({ status: 200, ok: true, headers: { get: () => 'application/pdf' }, text: async () => 'x', arrayBuffer: async () => Buffer.from('x') }) });
  assert.equal((await get('https://h/a.html')).why, 'not_html');
});

test('linksOn returns absolute same-host links only', () => {
  const body = '<a href="/et/explore/et-specials/et-holidays">Holidays</a>' +
    '<a href="https://shebamiles.ethiopianairlines.com/enrollment">Join</a>' +
    '<a href="https://www.ethiopianairlines.com/et/services/add-on-services/on-board-wifi#x">Wifi</a>' +
    '<a href="mailto:x@y.z">Mail</a>';
  const out = linksOn(body, 'https://www.ethiopianairlines.com/et/information/baggage-information/x');
  assert.deepEqual(out.sort(), [
    'https://www.ethiopianairlines.com/et/explore/et-specials/et-holidays',
    'https://www.ethiopianairlines.com/et/services/add-on-services/on-board-wifi',
  ]);
});

test('fetchSite fetches the sitemap, follows the index it points at, and keeps only allowlisted pages', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap-index.xml']: '<sitemapindex><sitemap><loc>' + H + '/et/sitemap/sitemap.xml</loc></sitemap></sitemapindex>',
    [H + '/et/sitemap/sitemap.xml']: '<urlset>' +
      '<url><loc>' + H + '/et/information/baggage-information/free-baggage-allowance</loc></url>' +
      '<url><loc>' + H + '/et/home-page/save-10</loc></url></urlset>',
    [H + '/et/information/baggage-information/free-baggage-allowance']: html('Free Baggage Allowance', 'Maximum weight 23 kg.'),
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap-index.xml', discoverLinks: false, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)'], deny: ['^/et/home-page(/|$)'], sections: [{ key: 'baggage', titleAm: 'ሻንጣ', match: '^/et/information/baggage-information/' }] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.deepEqual(r.pages.map(p => p.slug), ['baggage-information-free-baggage-allowance']);
  assert.equal(r.failed.length, 0);
  assert.ok(!n.asked.includes(H + '/et/home-page/save-10'), 'a denied page was requested anyway');
});

test('fetchSite finds the pages the sitemap forgot, one level deep and no further', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap.xml']: '<urlset><url><loc>' + H + '/et/information/baggage-information/a</loc></url></urlset>',
    [H + '/et/information/baggage-information/a']: html('A', 'text <a href="/et/explore/et-specials/et-holidays">Holidays</a>'),
    [H + '/et/explore/et-specials/et-holidays']: html('Ethiopian Holidays', 'packages <a href="/et/information/baggage-information/deep">Deeper</a>'),
    [H + '/et/information/baggage-information/deep']: html('Deep', 'should never be fetched'),
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap.xml', discoverLinks: true, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)', '^/et/explore/et-specials(/|$)'], deny: [], sections: [] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.deepEqual(r.pages.map(p => p.slug).sort(), ['baggage-information-a', 'et-specials-et-holidays']);
  assert.ok(!n.asked.includes(H + '/et/information/baggage-information/deep'), 'discovery went two levels deep');
});

test('fetchSite records why a page produced no document instead of losing it', async () => {
  const H = 'https://www.ethiopianairlines.com';
  const n = net({
    [H + '/et/sitemap/sitemap.xml']: '<urlset>' +
      '<url><loc>' + H + '/et/information/a</loc></url>' +
      '<url><loc>' + H + '/et/information/b</loc></url></urlset>',
    [H + '/et/information/a']: html('Page Not Found', 'nothing here at all but plenty of words'),
    [H + '/et/information/b']: 500,
  });
  const site = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', host: 'www.ethiopianairlines.com',
    fetch: 'sitemap', sitemap: H + '/et/sitemap/sitemap.xml', discoverLinks: false, maxPages: 50, crawlDelaySeconds: 5,
    lang: 'en', allow: ['^/et/information(/|$)'], deny: [], sections: [] };
  const r = await fetchSite(site, { fetchImpl: n.impl, sleep: async () => {} });
  assert.equal(r.pages.length, 0);
  assert.deepEqual(r.failed.map(f => f.why).sort(), ['http_500', 'soft_404']);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-run.test.js 2>&1 | tail -8
```

Expected: `TypeError: makeFetcher is not a function`.

- [ ] **Step 3: Add the fetching loop and the command line**

Slice block 2 of this task to `/tmp/travel-run.js`, then paste it into `ops/travel/fetch-airline.js` above the `module.exports` line and replace `module.exports` with the version at the end of the block.

```javascript
// ---------- the network ----------
// One request at a time, the registry's crawl delay between them, a 40 s timeout, one retry for a 5xx or a
// timeout and none for a 404. fetchImpl and sleep are injected so the tests never touch a network.
function makeFetcher({ fetchImpl, sleep, delayMs = 5000, ua = UA, timeoutMs = 40000 } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  let first = true;
  return async function get(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (first) first = false; else await zz(delayMs);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await f(url, { signal: ctrl.signal, redirect: 'follow',
          headers: { 'user-agent': ua, 'accept-language': 'en', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
        if (r.status === 404 || r.status === 410) return { ok: false, why: 'http_' + r.status };
        if (r.status !== 200) { if (attempt) return { ok: false, why: 'http_' + r.status }; continue; }
        const ct = String(r.headers.get('content-type') || '');
        const buf = Buffer.from(await r.arrayBuffer());
        if (/xml|gzip|octet-stream/.test(ct) || /\.(xml|gz)$/.test(new URL(url).pathname)) return { ok: true, buf, ct };
        if (!/text\/html/.test(ct)) return { ok: false, why: 'not_html' };
        return { ok: true, buf, ct, html: buf.toString('utf8') };
      } catch (e) {
        if (attempt) return { ok: false, why: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 60) };
      } finally { clearTimeout(t); }
    }
    return { ok: false, why: 'unreachable' };
  };
}

// Absolute, same-host, fragment-free links. Never another host: the pack is the airline's own pages.
function linksOn(html, base) {
  const out = new Set();
  let host; try { host = new URL(base).host; } catch (e) { return []; }
  for (const m of String(html).matchAll(/href\s*=\s*["']([^"'\s]+)["']/gi)) {
    let u; try { u = new URL(m[1], base); } catch (e) { continue; }
    if (u.host !== host || !/^https?:$/.test(u.protocol)) continue;
    u.hash = ''; u.search = '';
    out.add(u.toString().replace(/\/$/, ''));
  }
  return [...out];
}

// One site, start to finish. Returns { pages, failed, asked } where pages are ready for stripPackBoilerplate.
async function fetchSite(site, { fetchImpl, sleep, limit = 0, log = () => {} } = {}) {
  const get = makeFetcher({ fetchImpl, sleep, delayMs: (site.crawlDelaySeconds || 5) * 1000 });
  const pages = [], failed = [];
  let seeds = [];
  if (site.fetch === 'sitemap') {
    const queue = [site.sitemap];
    const seen = new Set();
    while (queue.length) {
      const sm = queue.shift();
      if (seen.has(sm)) continue; seen.add(sm);
      const r = await get(sm);
      if (!r.ok) { failed.push({ url: sm, why: r.why }); continue; }
      const parsed = sitemapUrls(r.buf);
      seeds.push(...parsed.urls);
      for (const i of parsed.indexes) queue.push(i);
    }
  } else {
    seeds = [...(site.urls || [])];
  }
  seeds.push(...(site.seeds || []));
  let todo = selectUrls(site, seeds);
  if (limit) todo = todo.slice(0, limit);
  log('[travel] ' + site.id + ': ' + seeds.length + ' urls in the sitemap, ' + todo.length + ' selected');

  const fetched = new Map();
  const discovered = new Set();
  const take = async (list, round) => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (fetched.has(p.path)) continue;
      const r = await get(p.url);
      if (!r.ok) { failed.push({ url: p.url, why: r.why }); continue; }
      if (round === 1 && site.discoverLinks) for (const l of linksOn(r.html, p.url)) discovered.add(l);
      const ex = extract(r.html);
      if (!ex.ok) { failed.push({ url: p.url, why: ex.why }); continue; }
      fetched.set(p.path, { ...p, siteId: site.id, title: ex.title, text: ex.text });
      if ((i + 1) % 10 === 0) log('[travel] ' + site.id + ' round ' + round + ': ' + (i + 1) + '/' + list.length);
    }
  };
  await take(todo, 1);
  if (site.discoverLinks && !limit) {
    const extra = selectUrls(site, [...discovered]).filter(p => !fetched.has(p.path));
    if (extra.length) log('[travel] ' + site.id + ': ' + extra.length + ' pages the sitemap did not list');
    await take(extra, 2);   // one level only: round 2 never harvests links
  }
  pages.push(...assignSlugs([...fetched.values()]));
  return { pages, failed };
}

// ---------- command line ----------
//   node ops/travel/fetch-airline.js                       fetch every site in the registry and write the pack
//   node ops/travel/fetch-airline.js --site ethiopian-airlines
//   node ops/travel/fetch-airline.js --dry-run             fetch, report, write nothing
//   node ops/travel/fetch-airline.js --limit 5 --dry-run   a five-page smoke test
// About 120 pages at 5 s apiece is roughly 14 minutes, so run it detached and poll the log.
async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : '';
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
  const dryRun = argv.includes('--dry-run');
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT_DIR;
  const today = new Date().toISOString().slice(0, 10);
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const log = m => console.log(m);
  let bad = 0;
  for (const site of reg.sites) {
    if (site.fetch === 'manual') { log('[travel] ' + site.id + ': manual (' + site.reach + ') — nothing fetched'); continue; }
    if (only && site.id !== only) continue;
    const t0 = Date.now();
    const { pages, failed } = await fetchSite(site, { limit, log });
    const docs = stripPackBoilerplate(pages);
    const kept = docs.filter(d => d.text.trim().length >= MIN_CHARS);
    const thin = docs.length - kept.length;
    const r = writePack(outDir, kept, site, { today, dryRun });
    bad += failed.length;
    log('[travel] ' + site.id + ': ' + kept.length + ' documents'
      + ' (+' + r.added.length + ' added, ' + r.changed.length + ' changed, ' + r.unchanged.length + ' unchanged, '
      + r.gone.length + ' gone, ' + thin + ' too thin after stripping, ' + failed.length + ' failed)'
      + ' in ' + Math.round((Date.now() - t0) / 1000) + 's' + (dryRun ? '  [DRY RUN — nothing written]' : ''));
    for (const f of failed.slice(0, 12)) log('        ! ' + f.why + '  ' + f.url);
    console.log(JSON.stringify({ site: site.id, ...r, failed: failed.length, thin }));
  }
  if (bad) log('[travel] ' + bad + ' page(s) produced no document — see the lines above');
}

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract,
  stripPackBoilerplate, contentHash, frontMatter, readMeta, bodyOf, renderDoc, touchLastChecked, writePack,
  makeFetcher, linksOn, fetchSite, main, UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS };

if (require.main === module) main().catch(e => { console.error('[travel] failed: ' + e.message); process.exit(1); });
```

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/fetch-run.test.js 2>&1 | tail -6
```

Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: A five-page dry run against the real site**

```
cd /var/www/connectcare/binasmart && node ops/travel/fetch-airline.js --site ethiopian-airlines --limit 5 --dry-run
```

Expected, in about 30 seconds:

```
[travel] ethiopian-airlines: 228 urls in the sitemap, 5 selected
[travel] ethiopian-airlines: 5 documents (+5 added, 0 changed, 0 unchanged, 0 gone, 0 too thin after stripping, 0 failed) in 3xs  [DRY RUN — nothing written]
{"site":"ethiopian-airlines","added":[...5 slugs...],"changed":[],"unchanged":[],"gone":[],"revived":[],"failed":0,"thin":0}
```

```
ls /var/www/connectcare/binasmart/knowledge/travel/
```

Expected: `sources.json` and nothing else. **A dry run that wrote a file is a bug, not a convenience.**

- [ ] **Step 6: The real run, detached, with the log polled**

```
cd /var/www/connectcare/binasmart && rm -f /tmp/travel-fetch.log && nohup node ops/travel/fetch-airline.js > /tmp/travel-fetch.log 2>&1 & echo started $!
```

Then poll about every 90 seconds — **do not sit silent**:

```
tail -5 /tmp/travel-fetch.log; echo ---; ls /var/www/connectcare/binasmart/knowledge/travel/*.md 2>/dev/null | wc -l
```

Expected while it runs: `[travel] ethiopian-airlines round 1: 40/119` and a file count climbing. Expected at the end, after roughly 15 minutes for the airline plus a few for cargo:

```
[travel] ethiopian-airlines: 1xx documents (+1xx added, 0 changed, 0 unchanged, 0 gone, N too thin after stripping, M failed) in 8xxs
[travel] ethiopian-cargo: ... 
[travel] ecaa: manual (unreachable from this server) — nothing fetched
```

**What must be true:** at least 110 documents for `ethiopian-airlines`, `added` equal to the document count (this is the first run), and `failed` small. If `failed` is above about 10, read the reasons before going on — a wall of `timeout` means the pacing is being refused and the run should stop, not be retried harder.

- [ ] **Step 7: Read what was actually written, page by figure**

```
cd /var/www/connectcare/binasmart/knowledge/travel && ls *.md | wc -l && head -14 baggage-information-free-baggage-allowance.md && echo ---- && grep -c "Book a Flight" *.md | grep -v ":0" | head && echo ---- && grep -o "23 kg\|32kg\|7kg" baggage-information-free-baggage-allowance.md | sort | uniq -c
```

Expected:

```
1xx
---
url: "https://www.ethiopianairlines.com/et/information/baggage-information/free-baggage-allowance"
title: "Ethiopian Airlines — Free Baggage Allowance"
source_name: "Ethiopian Airlines"
section: "baggage"
lang: "en"
status: "live"
fetchedAt: "2026-09-16"
lastChecked: "2026-09-16"
contentHash: "..."
generated_by: "ops/travel/fetch-airline.js"
---

# Ethiopian Airlines — Free Baggage Allowance
----
----
      2 23 kg
      1 32kg
      2 7kg
```

**What must be true:** the `grep -c "Book a Flight"` block prints **nothing** — the mega-menu is gone from every file — and the kilo figures are still there. If the menu survived, `stripPackBoilerplate` did not have enough pages or the ratio is wrong; check `docs.length` before assuming the code is broken.

- [ ] **Step 8: Run the whole suite and commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1306`, `# fail 0` (1298 plus the 8 new tests).

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel pack: fetch the airline's information pages" "" "One request at a time, five seconds apart, which is what the airline's robots.txt" "asks for; a user agent that says BinaSmart and gives a contact page; one retry" "for a 5xx, none for a 404; never a link off the host." "" "Link discovery goes exactly one level and only from the sitemap round. That is" "not a nicety: the airline's sitemap does not list ShebaMiles, Ethiopian" "Holidays, the Skylight hotel packages, the e-visa page or car rental, and those" "are only reachable through the menu." "" "The first run wrote the pack from the live site." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm5.txt && git add ops/travel/fetch-airline.js test/travel/fetch-run.test.js knowledge/travel/ && git commit -F /tmp/cm5.txt && rm /tmp/cm5.txt
```

Expected: about 110 files changed. Check the list names only `knowledge/travel/*.md`, `ops/travel/fetch-airline.js` and the test — `git add knowledge/travel/` is a directory, which is allowed here because that directory is this task's own output; it is still not `git add -A`.

---
### Task 6: `travel` as a knowledge source

**Files:**
- Modify: `knowledge/index.js:180-201` (the curated-library loop and the comment above it)
- Test: `test/travel/knowledge-travel.test.js`

`knowledge/travel/` is loaded exactly the way `law`, `health`, `eservices` and `mor` are: whole documents, front matter for title/url/lang, **no 20,000-character truncation** (that belongs to the crawler's `web` loader, and a conditions-of-carriage page is long). One new rule: a document whose front matter says `status: "gone"` is not loaded at all, so the airline removing a page removes it from Bini's answers at the next ingest while the last known text stays on disk and in git.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/knowledge-travel.test.js`.

```javascript
'use strict';
// The travel pack as a knowledge source. Two things must hold that are easy to get silently wrong: a long
// page must be indexed whole (the crawler's loader truncates at 20,000 characters and a conditions-of-
// carriage page is longer than that), and a page the airline has removed must stop being an answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSources } = require('../../knowledge/index');

function root(files) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'travelsrc-'));
  fs.mkdirSync(path.join(r, 'knowledge', 'travel'), { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(r, 'knowledge', 'travel', name), body);
  return r;
}
const doc = (extra, body) => '---\nurl: "https://www.ethiopianairlines.com/et/x"\n' +
  'title: "Ethiopian Airlines — Free Baggage Allowance"\nsource_name: "Ethiopian Airlines"\nlang: "en"\n' + extra + '---\n' + body + '\n';

test('a travel document is loaded with its title, url and language', () => {
  const r = root({ 'a.md': doc('status: "live"\n', 'Maximum weight: 50 lbs (23 kg).') });
  const docs = readSources(r, ['travel']);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].source, 'travel');
  assert.equal(docs[0].slug, 'a');
  assert.equal(docs[0].title, 'Ethiopian Airlines — Free Baggage Allowance');
  assert.equal(docs[0].url, 'https://www.ethiopianairlines.com/et/x');
  assert.equal(docs[0].lang, 'en');
  assert.ok(docs[0].text.includes('23 kg'));
});

test('travel defaults to English, because the airline publishes no Amharic page', () => {
  const r = root({ 'a.md': '---\nurl: "https://x/y"\ntitle: "t"\n---\n' + 'body text long enough to be real.\n' });
  assert.equal(readSources(r, ['travel'])[0].lang, 'en');
});

test('a travel document is indexed whole, never truncated at 20,000 characters', () => {
  const long = 'Article 1. The carrier is not liable beyond the stated limit. '.repeat(600);   // ~37,000 chars
  const r = root({ 'conditions.md': doc('status: "live"\n', long) });
  const d = readSources(r, ['travel'])[0];
  assert.ok(d.text.length > 30000, 'truncated to ' + d.text.length);
});

test('a page the airline removed is not loaded, so it stops being an answer', () => {
  const r = root({
    'live.md': doc('status: "live"\n', 'This page is still on the airline site.'),
    'gone.md': doc('status: "gone"\ngoneAt: "2026-09-23"\n', 'This page was removed from the airline site.'),
  });
  const docs = readSources(r, ['travel']);
  assert.deepEqual(docs.map(d => d.slug), ['live']);
});

test('a document with no front matter is skipped rather than indexed as raw text', () => {
  const r = root({ 'bad.md': 'no front matter here at all\n' });
  assert.deepEqual(readSources(r, ['travel']), []);
});

test('asking for another source does not load travel, and travel does not load the others', () => {
  const r = root({ 'a.md': doc('status: "live"\n', 'body text long enough to be real.') });
  assert.deepEqual(readSources(r, ['law']), []);
  assert.equal(readSources(r, ['travel']).length, 1);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/knowledge-travel.test.js 2>&1 | tail -10
```

Expected: the first test fails with `Expected values to be strictly equal: 0 !== 1` — `readSources` does not know the source name `travel` yet.

- [ ] **Step 3: Back up and patch `knowledge/index.js`**

```
cd /var/www/connectcare/binasmart && cp knowledge/index.js knowledge/index.js.bak-travel-$(date +%Y%m%d-%H%M%S) && ls knowledge/index.js.bak-travel-*
```

Slice block 3 of this task to `/tmp/patch-knowledge-travel.js` and run it with `node /tmp/patch-knowledge-travel.js`, then delete it.

```javascript
const fs = require('fs');
const f = '/var/www/connectcare/binasmart/knowledge/index.js';
let s = fs.readFileSync(f, 'utf8');
if (s.includes("['travel', 'en']")) throw new Error('already patched');

const OLD_COMMENT = "  //   mor        the Ministry of Revenue's FAQs and forms list, generated by ops/mor/mor-to-md.js (do not edit by hand);\n" +
  "  //              the Ministry's proclamations, regulations and directives themselves are curated under law\n";
const NEW_COMMENT = OLD_COMMENT +
  "  //   travel     the Ethiopian Airlines information pages, generated by ops/travel/fetch-airline.js from\n" +
  "  //              knowledge/travel/sources.json (do not edit by hand). English: the airline publishes no\n" +
  "  //              Amharic locale. A document whose front matter says status: \"gone\" is skipped, which is how a\n" +
  "  //              page the airline removed stops being an answer while its last known text stays on disk.\n";
if (!s.includes(OLD_COMMENT)) throw new Error('comment anchor not found');
s = s.replace(OLD_COMMENT, NEW_COMMENT);

const OLD_LOOP = "  for (const [source, defaultLang] of [['law', 'am'], ['health', 'am'], ['eservices', 'en'], ['mor', 'am']]) {";
const NEW_LOOP = "  for (const [source, defaultLang] of [['law', 'am'], ['health', 'am'], ['eservices', 'en'], ['mor', 'am'], ['travel', 'en']]) {";
if (!s.includes(OLD_LOOP)) throw new Error('loop anchor not found');
s = s.replace(OLD_LOOP, NEW_LOOP);

const OLD_PUSH = "      const meta = {}; for (const line of fm[1].split('\\n')) { const m = /^(\\w+):\\s*\"?(.*?)\"?\\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\\\\"/g, '\"'); }\n" +
  "      docs.push({ source, slug: f.replace(/\\.md$/, ''), title: meta.title || f,";
const NEW_PUSH = "      const meta = {}; for (const line of fm[1].split('\\n')) { const m = /^(\\w+):\\s*\"?(.*?)\"?\\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\\\\"/g, '\"'); }\n" +
  "      // A curated document may record that its source page no longer exists (ops/travel/freshness.js writes\n" +
  "      // status: \"gone\"). It stays on disk as the last thing we knew and stays out of the index: the ingest's\n" +
  "      // orphan collection then drops its chunks on the next run.\n" +
  "      if (meta.status === 'gone') continue;\n" +
  "      docs.push({ source, slug: f.replace(/\\.md$/, ''), title: meta.title || f,";
if (!s.includes(OLD_PUSH)) throw new Error('push anchor not found');
s = s.replace(OLD_PUSH, NEW_PUSH);

fs.writeFileSync(f, s);
console.log('patched knowledge/index.js');
```

Expected output: `patched knowledge/index.js`.

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/knowledge-travel.test.js 2>&1 | tail -6
```

Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 5: Prove the whole suite still passes, then ingest the pack for real**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1312`, `# fail 0`.

The first ingest embeds every new chunk with Gemini and is paced, so run it detached and poll.

```
cd /var/www/connectcare/binasmart && rm -f /tmp/travel-ingest.log && nohup node --env-file=.env knowledge/ingest.js --source travel > /tmp/travel-ingest.log 2>&1 & echo started $!
```

Poll every 60 seconds:

```
tail -3 /tmp/travel-ingest.log
```

Expected at the end:

```
[knowledge] ingest: 1xx docs, +1xxx chunks, -0 stale, -0 orphaned, 1xxx embedded, 14xxx total
{"docs":1xx,"inserted":1xxx,"deleted":0,"orphaned":0,"embedded":1xxx,"embedRemaining":0,"localEmbedded":300,"localPending":1xxx,"total":14xxx}
```

**What must be true:** `docs` is the number of `.md` files written in Task 5, `embedRemaining` is 0 (every chunk has a Gemini vector), and `total` has grown from 12,750 by the number inserted. `localPending` will be large — the BGE-M3 local embedder is capped at 300 a run by design and catches up on later nights; it is only the fallback path.

- [ ] **Step 6: Ask the index a question, with no preference at all**

```
cd /var/www/connectcare/binasmart && node --env-file=.env -e "const {PrismaClient}=require('@prisma/client');const {makeKnowledge}=require('./knowledge');(async()=>{const p=new PrismaClient();const k=makeKnowledge({prisma:p,apiKey:process.env.GEMINI_API_KEY});await k.load();for(const q of ['how many kilos of checked baggage in economy on Ethiopian Airlines','what is the minimum connecting time at Addis Ababa']){const h=await k.search(q,{k:3});console.log(q);for(const x of h)console.log('   ',x.source+'/'+x.slug,x.score);}await p.\$disconnect();})()"
```

Expected: the top hit for each question is a `travel/...` page — `travel/baggage-information-free-baggage-allowance` and `travel/services-at-the-airport-minimum-connecting-time`. If a `guide` or `page` document wins instead, note it: Task 10 is where that is fixed, not here.

- [ ] **Step 7: Commit**

```
cd /var/www/connectcare/binasmart && printf '%s\n' "travel is a knowledge source" "" "knowledge/travel/ loads the way law, health, eservices and mor load: whole" "documents, front matter for title, url and language, and no truncation. The" "crawler's web loader cuts every document at 20,000 characters, and a conditions" "of carriage page is longer than that, which is exactly why the pack is not in" "knowledge/web." "" "One new rule, shared by every curated library: a document whose front matter" "says status gone is not loaded. That is how a page the airline removes stops" "being one of Bini's answers - the ingest collects its chunks as orphans - while" "the last text we saw stays on disk and in the history." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm6.txt && git add knowledge/index.js test/travel/knowledge-travel.test.js && git commit -F /tmp/cm6.txt && rm /tmp/cm6.txt
```

Expected: `2 files changed`.

---

### Task 7: Bini prefers the pack for travel questions; Afiya, Asmat and the owner never see it

**Files:**
- Create: `assistant/travel.js`
- Modify: `server.js:987-995` (one require) and `server.js:1048` (the Bini context call)
- Modify: `agents/afiya/rules.js:21-25`, `agents/asmat/rules.js` (`knowledge.exclude`)
- Test: `test/travel/bini-travel-prefer.test.js`

**How the preference is done, and why this way.** `contextFor(q, { prefer })` already exists: when `prefer` is given, the +0.06 tie-breaker that normally goes to BinaSmart's own sources moves to exactly what is named, and nothing else gets one (`hybridScore`, `pageMatcher` in `knowledge/index.js`). Dr Afiya and Asmat declare theirs statically in `agents/<name>/rules.js`, because a health agent is always a health agent. **Bini is not.** He answers rides, hotels, tenders, tax and cinema in the same conversation, so a static preference would put the airline pack ahead of the guide that answers "how do I register a business". So Bini's preference is per-message: a small, deterministic travel-intent test in `assistant/travel.js`, and `prefer` passed only when it fires.

The intent test has to survive one specific collision: **BinaRide sells airport transfers.** "ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?" contains two airport-ish words and is a ride question. So: one strong aviation word is enough on its own; otherwise two weak ones are needed **and** the message must not name another BinaSmart service.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/bini-travel-prefer.test.js`.

```javascript
'use strict';
// Who may read the Ethiopian Airlines pack. Bini, when the message is about flying; nobody else. The ride
// cases are not padding: BinaSmart sells airport transfers, so "a taxi to Bole" must stay a ride question
// even though it names an airport.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isTravelQuestion, PREFER } = require('../../assistant/travel');
const { contextSearchOptions, pageMatcher } = require('../../knowledge/index');

const TRAVEL = [
  'ከአዲስ አበባ ወደ ዱባይ በረራ ስንት ሰዓት ይፈጃል?',
  'በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?',
  'የመሳፈሪያ ወረቀቴን በስልኬ ላይ ማውረድ እችላለሁ?',
  'ውሻዬን ይዤ በአውሮፕላን መጓዝ እችላለሁ?',
  'የኢትዮጵያ አየር መንገድ ትኬቴን መቀየር እችላለሁ?',
  'how much carry-on baggage can I take?',
  'when does online check-in open for my flight?',
  'what is the Ethiopian Airlines refund policy?',
  'how do I join ShebaMiles?',
  'can I upgrade to Cloud Nine?',
];
const NOT_TRAVEL = [
  'ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?',
  'ከቦሌ ወደ ፒያሳ ጋራ ጉዞ አለ?',
  'a taxi from the airport to Piassa, how much?',
  'airport transfer price please',
  'ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?',
  'what time is hotel check-in?',
  'ንግድ ፈቃድ እንዴት አወጣለሁ?',
  'how do I register a business in Ethiopia?',
  'ዛሬ ምን ፊልም አለ?',
  'what is the VAT rate?',
  'ሰላም',
  'የደመወዝ ግብር ስንት ነው?',
];

test('a travel question is recognised, in Amharic and in English', () => {
  for (const q of TRAVEL) assert.equal(isTravelQuestion(q), true, 'missed: ' + q);
});

test('another BinaSmart service is not a travel question, even when it names an airport', () => {
  for (const q of NOT_TRAVEL) assert.equal(isTravelQuestion(q), false, 'wrongly claimed: ' + q);
});

test('a word only aviation uses beats the other-service guard', () => {
  assert.equal(isTravelQuestion('a taxi to the airport for my flight to Dubai, and how much baggage can I take?'), true);
});

test('an aviation word other things also use decides it only when no other service is named', () => {
  assert.equal(isTravelQuestion('ቼክ ኢን ለማድረግ ምን ምን ሰነድ ያስፈልገኛል?'), true);
  assert.equal(isTravelQuestion('ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?'), false);
});

test('a service word inside a longer word is not a service word', () => {
  // Without word boundaries the `rent` in `current` would hand this question to the rental service.
  assert.equal(isTravelQuestion('what is the current transit visa rule at the airport?'), true);
});

test('isTravelQuestion never throws on rubbish', () => {
  for (const q of [null, undefined, '', 0, {}, []]) assert.equal(isTravelQuestion(q), false);
});

test('PREFER names the pack and the BinaSmart travel pages, and nothing else', () => {
  assert.deepEqual(PREFER, ['travel', 'page:airport', 'page:flights', 'page:travel']);
  const m = pageMatcher(PREFER);
  assert.equal(m('travel', 'baggage-information-free-baggage-allowance'), true);
  assert.equal(m('page', 'airport'), true);
  assert.equal(m('guide', 'passport'), false);
  assert.equal(m('law', 'labour-proclamation-1156-2019'), false);
});

test('the preference becomes real search options', () => {
  assert.deepEqual(contextSearchOptions({ prefer: PREFER }),
    { k: 18, exclude: ['style', 'style-om'], rerankTo: 6, prefer: PREFER });
});

test('Dr Afiya excludes the travel pack and keeps everything she excluded before', () => {
  const a = require('../../agents/afiya/rules');
  assert.ok(a.knowledge.exclude.includes('travel'));
  for (const e of ['page', 'skill', 'llms', 'mor', 'guide:mesob', 'guide:telebirr']) assert.ok(a.knowledge.exclude.includes(e), 'lost ' + e);
  assert.equal(a.knowledge.prefer.includes('travel'), false);
});

test('Asmat excludes the travel pack and keeps everything he excluded before', () => {
  const s = require('../../agents/asmat/rules');
  assert.ok(s.knowledge.exclude.includes('travel'));
  for (const e of ['page', 'skill', 'llms']) assert.ok(s.knowledge.exclude.includes(e), 'lost ' + e);
  assert.equal(s.knowledge.prefer.includes('travel'), false);
});

test('the owner agent reads no general knowledge at all, so the pack can never reach it', () => {
  assert.equal(require('../../agents/owner/rules').knowledge, false);
});

test('Bini asks for the pack only when the message is about flying', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.ok(src.includes("const biniTravel = require('./assistant/travel');"), 'assistant/travel is not required');
  assert.ok(src.includes('const travelPrefer = biniTravel.isTravelQuestion(msg) ? { prefer: biniTravel.PREFER } : {};'),
    'the per-message preference is not computed');
  assert.ok(src.includes('knowledge.contextFor(msg, { lang, ...travelPrefer })'), 'contextFor is not given the preference');
  assert.equal(src.includes('knowledge.contextFor(msg, { lang }).catch'), false, 'the old unconditional call is still there');
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/bini-travel-prefer.test.js 2>&1 | tail -8
```

Expected: `Cannot find module '../../assistant/travel'`.

- [ ] **Step 3: Write the intent test**

Slice block 2 of this task to `assistant/travel.js`.

```javascript
'use strict';
// Is this message about flying? The one question that decides whether Bini's retrieval is pointed at the
// Ethiopian Airlines pack (knowledge/travel, source `travel`).
//
// Why per message rather than a fixed preference on an agent definition: Dr Afiya is always a health agent
// and Asmat is always a legal one, so they declare knowledge: { prefer } once, in agents/<name>/rules.js.
// Bini answers rides, hotels, tenders, tax and cinema in the same conversation. A standing preference for
// the airline pack would put it ahead of the guide that answers "how do I register a business", because
// `prefer` moves the +0.06 tie-breaker away from everything it does not name (knowledge/index.js,
// hybridScore). So it is asked for one message at a time.
//
// The collision this has to survive is our own. BinaSmart sells airport transfers, hotel rooms and rides:
// "ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?" names an airport twice over and is a ride question, and "ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?"
// is a hotel question that says check-in. So there are three tiers, consulted in this order:
//
//   HARD           a word only aviation uses — በረራ, ሻንጣ, flight, baggage, ShebaMiles. It decides on its own
//                  and overrides the guard below, because "a taxi to the airport for my flight, and how much
//                  baggage can I take" is a flight question with a taxi in it.
//   OTHER_SERVICE  a word another BinaSmart service owns — ታክሲ, ሆቴል, ፊልም, taxi, hotel, tender, tax. With no
//                  HARD word anywhere in the message, this ends it: the question belongs to that service.
//   STRONG / WEAK  aviation words that other things also use — ቼክ ኢን, የመሳፈሪያ, check-in, boarding. One STRONG
//                  is enough once no other service has claimed the message; otherwise two distinct WEAK ones.
//
// Deliberately conservative, and it can afford to be: a message this test misses is answered from the whole
// index, which contains the pack. What is lost is the tie-breaker, not the knowledge.
const { foldEthiopic } = require('./lang');

const fold = s => foldEthiopic(String(s == null ? '' : s).toLowerCase());
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Amharic is folded at load for the same reason knowledge/index.js folds it: ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ and ጸ/ፀ are the
// same sounds written differently and people type both. A Latin term also gets word boundaries, so "tax" does
// not match inside "syntax" and "rent" does not match inside "current"; Ethiopic does not, because \b in
// JavaScript is defined on ASCII word characters and would never fire next to an Ethiopic letter.
const rxOf = terms => new RegExp(terms.map(t => {
  const f = escRe(fold(t));
  return /^[\x00-\x7F]+$/.test(t) ? '\\b' + f + '\\b' : f;
}).join('|'), 'gi');

// Only aviation says these. One is enough, and it beats the other-service guard.
const HARD = rxOf([
  'በረራ', 'አውሮፕላን', 'አየር መንገድ', 'ሻንጣ', 'ሸባማይልስ',
  'flight', 'flights', 'flying', 'airline', 'airlines', 'aircraft', 'aeroplane', 'airplane',
  'baggage', 'luggage', 'carry-on', 'carry on', 'hand luggage', 'checked bag', 'excess baggage',
  'boarding pass', 'e-ticket', 'eticket', 'layover', 'stopover', 'shebamiles', 'sheba miles',
  'cloud nine', 'seat map', 'in-flight', 'inflight', 'unaccompanied minor', 'medif',
]);
// Another BinaSmart service owns the question, unless a HARD word says otherwise.
const OTHER_SERVICE = rxOf([
  'ታክሲ', 'ጋራ ጉዞ', 'ሾፌር', 'መኪና', 'ሆቴል', 'ሲኒማ', 'ፊልም', 'ሆስፒታል', 'ክሊኒክ', 'ጨረታ', 'ግብር', 'ንግድ ፈቃድ', 'ኪራይ',
  'taxi', 'ride', 'rides', 'pool', 'driver', 'car rental', 'hotel', 'cinema', 'film', 'movie',
  'hospital', 'clinic', 'tender', 'vat', 'tax', 'business licence', 'business license', 'rent', 'transfer',
]);
// Aviation words that other things also use. One decides it, once no other service has claimed the message.
const STRONG = rxOf([
  'ቼክ ኢን', 'የመሳፈሪያ', 'የበረራ ቁጥር', 'ተሳፋሪ',
  'check-in', 'check in', 'boarding', 'booking code', 'booking reference', 'itinerary', 'cabin crew',
]);
// Two distinct ones of these, and the message is about flying.
const WEAK = rxOf([
  'አየር ማረፊያ', 'ቦሌ', 'ቪዛ', 'ፓስፖርት', 'ትኬት', 'ማይል', 'ላውንጅ', 'ትራንዚት', 'ኢኮኖሚ', 'መነሳት', 'መድረሻ',
  'airport', 'bole', 'transit', 'connecting', 'miles', 'lounge', 'visa', 'passport', 'ticket',
  'departure', 'arrival', 'economy class', 'business class', 'refund',
]);

function hits(re, s) { re.lastIndex = 0; return new Set((s.match(re) || []).map(x => x.toLowerCase())); }

function isTravelQuestion(msg) {
  const s = fold(msg);
  if (!s) return false;
  if (hits(HARD, s).size) return true;
  if (hits(OTHER_SERVICE, s).size) return false;
  if (hits(STRONG, s).size) return true;
  return hits(WEAK, s).size >= 2;
}

// What Bini prefers on a travel question: the airline pack, plus BinaSmart's own travel pages — the Bole
// airport guide the design names as a reference (source `page`, slug `airport`) and the two travel landing
// pages. Nothing else gets the tie-breaker while this is in force.
const PREFER = ['travel', 'page:airport', 'page:flights', 'page:travel'];

module.exports = { isTravelQuestion, PREFER };
```

- [ ] **Step 4: Patch the three wiring points**

```
cd /var/www/connectcare/binasmart && S=$(date +%Y%m%d-%H%M%S) && cp server.js server.js.bak-travel-$S && cp agents/afiya/rules.js agents/afiya/rules.js.bak-travel-$S && cp agents/asmat/rules.js agents/asmat/rules.js.bak-travel-$S && ls *.bak-travel-* agents/*/*.bak-travel-*
```

Slice block 4 of this task to `/tmp/patch-bini-travel.js`, run `node /tmp/patch-bini-travel.js`, then delete it.

```javascript
const fs = require('fs');
const R = '/var/www/connectcare/binasmart/';

// 1. server.js: the require, next to the other assistant modules.
let s = fs.readFileSync(R + 'server.js', 'utf8');
if (s.includes('biniTravel')) throw new Error('server.js already patched');
const REQ_OLD = "const biniPolitics = require('./assistant/politics');";
const REQ_NEW = REQ_OLD + "\nconst biniTravel = require('./assistant/travel');";
if (!s.includes(REQ_OLD)) throw new Error('require anchor not found');
s = s.replace(REQ_OLD, REQ_NEW);

// 2. server.js: the Bini context call.
const CTX_OLD = "    const [ctx, profile] = await Promise.all([knowledge.contextFor(msg, { lang }).catch(() => ''), Promise.resolve(biniMemory.profileText(known))]);";
const CTX_NEW = [
  "    // A travel question is pointed at the Ethiopian Airlines pack (assistant/travel.js): `prefer` moves the",
  "    // +0.06 tie-breaker to the pack and BinaSmart's own travel pages for this one message, and to nothing",
  "    // else. Every other message gets exactly the retrieval it got before, with no prefer key at all.",
  "    const travelPrefer = biniTravel.isTravelQuestion(msg) ? { prefer: biniTravel.PREFER } : {};",
  "    const [ctx, profile] = await Promise.all([knowledge.contextFor(msg, { lang, ...travelPrefer }).catch(() => ''), Promise.resolve(biniMemory.profileText(known))]);",
].join('\n');
if (!s.includes(CTX_OLD)) throw new Error('contextFor anchor not found');
s = s.replace(CTX_OLD, CTX_NEW);
fs.writeFileSync(R + 'server.js', s);

// 3. Dr Afiya: the airline pack is not health knowledge.
let a = fs.readFileSync(R + 'agents/afiya/rules.js', 'utf8');
const A_OLD = "    exclude: ['page', 'skill', 'llms', 'mor', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',";
const A_NEW = "    // `travel` added 2026-09-16 with the Ethiopian Airlines pack: baggage rules and lounge access are not\n" +
  "    // health answers, and a page about travelling while pregnant belongs to the airline, not to a clinician.\n" +
  "    exclude: ['page', 'skill', 'llms', 'mor', 'travel', 'guide:business-registration-ethiopia', 'guide:how-to-start-a-business-in-ethiopia',";
if (a.includes("'travel'")) throw new Error('afiya already patched');
if (!a.includes(A_OLD)) throw new Error('afiya anchor not found');
fs.writeFileSync(R + 'agents/afiya/rules.js', a.replace(A_OLD, A_NEW));

// 4. Asmat: likewise.
let m = fs.readFileSync(R + 'agents/asmat/rules.js', 'utf8');
const M_OLD = "    exclude: ['page', 'skill', 'llms'],";
const M_NEW = "    // `travel` added 2026-09-16 with the Ethiopian Airlines pack: an airline's conditions of carriage are\n" +
  "    // a commercial contract, not Ethiopian law, and must never be quoted as one.\n" +
  "    exclude: ['page', 'skill', 'llms', 'travel'],";
if (m.includes("'travel'")) throw new Error('asmat already patched');
if (!m.includes(M_OLD)) throw new Error('asmat anchor not found');
fs.writeFileSync(R + 'agents/asmat/rules.js', m.replace(M_OLD, M_NEW));

console.log('patched server.js, agents/afiya/rules.js, agents/asmat/rules.js');
```

Expected: `patched server.js, agents/afiya/rules.js, agents/asmat/rules.js`.

- [ ] **Step 5: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/bini-travel-prefer.test.js 2>&1 | tail -6
```

Expected: `# pass 12`, `# fail 0`.

- [ ] **Step 6: Run the whole suite**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1324`, `# fail 0`. **`test/knowledge-prefer.test.js` and `test/kit/engine-knowledge.test.js` must still pass unchanged** — they are the guarantee that a caller declaring nothing gets the retrieval it always had, and this task must not have moved that.

- [ ] **Step 7: Restart and check the live service**

`server.js` changed, so the API must be restarted.

```
pm2 restart binasmart-api && sleep 4 && curl -s http://127.0.0.1:4210/health | head -c 300 && echo && pm2 logs binasmart-api --err --lines 20 --nostream | tail -20
```

Expected: the health JSON, and an error log with nothing new since the restart. A `Cannot find module './assistant/travel'` here means the file was written to the wrong path.

- [ ] **Step 8: Ask Bini a travel question on the live service, with the evaluation header**

The evaluation header (`x-binasmart-eval: 1`) keeps the exchange out of the ordinary conversation records.

```
curl -s -X POST http://127.0.0.1:4210/api/bini -H "content-type: application/json" -H "x-binasmart-eval: 1" -d "{\"message\":\"how much checked baggage do I get in economy on Ethiopian Airlines?\"}" | head -c 1200
```

Expected: a reply quoting the pack's figures (2 pieces of 23 kg in Economy) and citing `ethiopianairlines.com`. **If it answers with a figure that is not in `knowledge/travel/baggage-information-free-baggage-allowance.md`, stop** — that is the model speaking from memory, which is the failure the whole pack exists to prevent.

- [ ] **Step 9: Commit**

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Bini prefers the airline pack for travel questions; nobody else sees it" "" "contextFor already takes prefer, and Afiya and Asmat declare theirs once in" "agents/<name>/rules.js because a health agent is always a health agent. Bini is" "not: he answers rides, hotels, tenders, tax and cinema in one conversation, and" "prefer moves the tie-breaker away from everything it does not name. So his" "preference is decided one message at a time." "" "The collision the intent test has to survive is our own: BinaSmart sells airport" "transfers, so a taxi to Bole names an airport twice and is still a ride" "question. One strong aviation word decides it alone; otherwise two weak ones are" "needed and no other BinaSmart service may be named." "" "Afiya and Asmat exclude travel. An airline's conditions of carriage are a" "commercial contract, not Ethiopian law. The owner agent reads no general" "knowledge at all and needed no change." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm7.txt && git add assistant/travel.js server.js agents/afiya/rules.js agents/asmat/rules.js test/travel/bini-travel-prefer.test.js && git commit -F /tmp/cm7.txt && rm /tmp/cm7.txt
```

Expected: `5 files changed`.

---
### Task 8: Teach the benchmark about the travel gold set

**Files:**
- Modify: `ops/bini/rerun-retrieval-benchmark.js` (`goldPath`, `searchOptionsFor`, `strictGold`)
- Test: `test/travel/benchmark-travel.test.js`

Three small changes, each with a reason:

1. **`--gold travel`.** Today `--gold` takes a path. A bare name with no slash and no `.json` now means "the gold set of that name in the standard directory" — `/root/storage/bina-embed/eval/gold-travel.json`. A path still works exactly as before, so the v1, v2 and v3 commands are untouched.
2. **A gold question may carry its own `prefer`.** v3 questions name an agent and the benchmark looks that agent's declaration up in `agents/<name>/rules.js`. Bini has no such file — his preference is decided per message in `assistant/travel.js` — so a travel question carries the prefer list itself, and the benchmark measures exactly what a user gets.
3. **`gold_pages` means strict matching.** v1 and v2 match on slug alone and their published figures depend on that, so they must not change. A question that names `gold_pages` is matching `source:slug`, as v3 already does.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/benchmark-travel.test.js`.

```javascript
'use strict';
// The three benchmark changes the travel gold set needs. The first rule of this file: v1 and v2 numbers are
// published and must not move, so every test here also checks the old behaviour still holds.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { goldPath, goldTag, searchOptionsFor, normalizeGold, goldKeys, GOLD } =
  require('../../ops/bini/rerun-retrieval-benchmark');
const { contextSearchOptions } = require('../../knowledge/index');

const knowledgeOf = agent => { throw new Error('knowledgeOf must not be called for ' + agent); };

test('--gold travel means gold-travel.json in the standard directory', () => {
  assert.equal(goldPath(['--gold', 'travel'], {}), '/root/storage/bina-embed/eval/gold-travel.json');
  assert.equal(goldTag('/root/storage/bina-embed/eval/gold-travel.json'), 'gold-travel');
});

test('a path is still a path, and the default is still v1', () => {
  assert.equal(goldPath(['--gold', '/root/storage/bina-embed/eval/gold-v2.json'], {}), '/root/storage/bina-embed/eval/gold-v2.json');
  assert.equal(goldPath(['--gold', './gold-v2.json'], {}), './gold-v2.json');
  assert.equal(goldPath([], {}), GOLD);
  assert.equal(goldPath([], { BINI_GOLD: '/tmp/x.json' }), '/tmp/x.json');
  assert.equal(goldPath(['--gold', 'v2'], { BINI_GOLD: '/tmp/x.json' }), '/root/storage/bina-embed/eval/gold-v2.json');
});

test('a question with no agent and no prefer gets the options the benchmark always used', () => {
  const o = searchOptionsFor({ qid: 'q1' }, { contextSearchOptions, knowledgeOf });
  assert.deepEqual(o.plain, { k: 18, exclude: ['style', 'style-om'] });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 });
});

test('a question that carries its own prefer is searched with it, and no agent file is read', () => {
  const prefer = ['travel', 'page:airport', 'page:flights', 'page:travel'];
  const o = searchOptionsFor({ qid: 'tv-001', agent: 'bini', prefer }, { contextSearchOptions, knowledgeOf });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om'], rerankTo: 6, prefer });
  assert.deepEqual(o.plain, { k: 18, exclude: ['style', 'style-om'], prefer });
});

test('an agent question with no prefer still reads that agent declaration', () => {
  const o = searchOptionsFor({ qid: 'q', agent: 'afiya' },
    { contextSearchOptions, knowledgeOf: () => ({ prefer: ['health'], exclude: ['page'] }) });
  assert.deepEqual(o.shipped, { k: 18, exclude: ['style', 'style-om', 'page'], rerankTo: 6, prefer: ['health'] });
});

test('gold_pages means the source has to match too, so travel:x is not guide:x', () => {
  const { questions } = normalizeGold([{ qid: 'tv-001', gold_pages: [{ source: 'travel', slug: 'baggage-information-free-baggage-allowance' }] }]);
  assert.deepEqual(goldKeys(questions[0]), ['travel:baggage-information-free-baggage-allowance']);
});

test('a v1 or v2 question still matches on slug alone', () => {
  const { questions } = normalizeGold([{ qid: 'q1', gold_source: 'guide', gold_slug: 'passport' }]);
  assert.deepEqual(goldKeys(questions[0]), ['passport']);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/benchmark-travel.test.js 2>&1 | tail -10
```

Expected: the first test fails — `'travel' !== '/root/storage/bina-embed/eval/gold-travel.json'`.

- [ ] **Step 3: Patch the benchmark**

```
cd /var/www/connectcare/binasmart && cp ops/bini/rerun-retrieval-benchmark.js ops/bini/rerun-retrieval-benchmark.js.bak-travel-$(date +%Y%m%d-%H%M%S)
```

Slice block 3 of this task to `/tmp/patch-benchmark-travel.js`, run `node /tmp/patch-benchmark-travel.js`, then delete it.

```javascript
const fs = require('fs');
const f = '/var/www/connectcare/binasmart/ops/bini/rerun-retrieval-benchmark.js';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('GOLD_DIR')) throw new Error('already patched');

const OLD_PATH = "// --gold <path> beats $BINI_GOLD beats v1.\n" +
  "function goldPath(argv = process.argv, env = process.env) {\n" +
  "  const i = argv.indexOf('--gold');\n" +
  "  if (i !== -1 && argv[i + 1]) return argv[i + 1];\n" +
  "  return env.BINI_GOLD || GOLD;\n" +
  "}";
const NEW_PATH = "// --gold <path> beats $BINI_GOLD beats v1. A bare name - no slash, no .json - is a gold set in the same\n" +
  "// directory as v1: --gold travel is gold-travel.json there, --gold v2 is gold-v2.json. A path still behaves\n" +
  "// exactly as it did, so the published v1 and v2 commands are unchanged.\n" +
  "const GOLD_DIR = path.dirname(GOLD);\n" +
  "function goldPath(argv = process.argv, env = process.env) {\n" +
  "  const i = argv.indexOf('--gold');\n" +
  "  const v = (i !== -1 && argv[i + 1]) ? argv[i + 1] : (env.BINI_GOLD || '');\n" +
  "  if (!v) return GOLD;\n" +
  "  if (!/[\\\\/]/.test(v) && !/\\.json$/i.test(v)) return path.join(GOLD_DIR, 'gold-' + v + '.json');\n" +
  "  return v;\n" +
  "}";
if (!s.includes(OLD_PATH)) throw new Error('goldPath anchor not found');
s = s.replace(OLD_PATH, NEW_PATH);

const OLD_STRICT = "const strictGold = q => !!q.agent;";
const NEW_STRICT = "// v1 and v2 match on slug alone and their published figures depend on it. A question that names gold_pages\n" +
  "// - v3's agent questions, and the travel set - matches source AND slug, so travel:x is not guide:x.\n" +
  "const strictGold = q => !!q.agent || (Array.isArray(q.gold_pages) && q.gold_pages.length > 0);";
if (!s.includes(OLD_STRICT)) throw new Error('strictGold anchor not found');
s = s.replace(OLD_STRICT, NEW_STRICT);

const OLD_OPTS = "function searchOptionsFor(q, { contextSearchOptions, knowledgeOf }) {\n" +
  "  if (!q.agent) return { plain: { k: 18, exclude: ['style', 'style-om'] }, shipped: { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 } };\n" +
  "  const shipped = contextSearchOptions(knowledgeOf(q.agent) || {});";
const NEW_OPTS = "function searchOptionsFor(q, { contextSearchOptions, knowledgeOf }) {\n" +
  "  // A question may carry its own preference. Bini has no agents/<name>/rules.js to look up - his travel\n" +
  "  // preference is decided per message in assistant/travel.js - so the travel gold set names the same list\n" +
  "  // the route passes, and the benchmark measures exactly what a user gets.\n" +
  "  if (Array.isArray(q.prefer) || Array.isArray(q.exclude)) {\n" +
  "    const shipped = contextSearchOptions({ prefer: q.prefer, exclude: q.exclude });\n" +
  "    const plain = { ...shipped }; delete plain.rerankTo;\n" +
  "    return { plain, shipped };\n" +
  "  }\n" +
  "  if (!q.agent) return { plain: { k: 18, exclude: ['style', 'style-om'] }, shipped: { k: 18, exclude: ['style', 'style-om'], rerankTo: 6 } };\n" +
  "  const shipped = contextSearchOptions(knowledgeOf(q.agent) || {});";
if (!s.includes(OLD_OPTS)) throw new Error('searchOptionsFor anchor not found');
s = s.replace(OLD_OPTS, NEW_OPTS);

fs.writeFileSync(f, s);
console.log('patched ops/bini/rerun-retrieval-benchmark.js');
```

Expected: `patched ops/bini/rerun-retrieval-benchmark.js`.

- [ ] **Step 4: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/benchmark-travel.test.js test/retrieval-benchmark-output.test.js 2>&1 | tail -6
```

Expected: `# fail 0`, and the existing benchmark-output tests all still pass.

- [ ] **Step 5: Whole suite, then commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1331`, `# fail 0`.

```
cd /var/www/connectcare/binasmart && printf '%s\n' "The benchmark can run a gold set by name and a question can carry its own prefer" "" "--gold travel now means gold-travel.json in the directory v1 already lives in. A" "path is still a path, so the published v1 and v2 commands are untouched." "" "A gold question may name its own prefer list. v3 questions name an agent and the" "benchmark reads agents/<name>/rules.js, but Bini has no such file: his travel" "preference is decided per message in assistant/travel.js. Carrying the list on" "the question means the benchmark measures what a user actually gets." "" "A question that names gold_pages matches source AND slug. v1 and v2 match on" "slug alone, as their published figures require." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm8.txt && git add ops/bini/rerun-retrieval-benchmark.js test/travel/benchmark-travel.test.js && git commit -F /tmp/cm8.txt && rm /tmp/cm8.txt
```

Expected: `2 files changed`.

---

### Task 9: The 60 gold questions and the builder

**Files:**
- Create: `ops/travel/gold-travel-spec.json` (the 60 questions)
- Create: `ops/travel/build-gold-travel.js`
- Test: `test/travel/gold-travel.test.js`
- Output: `/root/storage/bina-embed/eval/gold-travel.json`

**60 questions: 40 Amharic, 20 English**, each naming the page that answers it. Distribution, by the design's own section list:

| section | Amharic | English | total |
| --- | --- | --- | --- |
| baggage | 8 | 4 | 12 |
| check-in | 4 | 2 | 6 |
| changes and refunds | 5 | 2 | 7 |
| special assistance, pets, medical | 6 | 3 | 9 |
| transit, the Addis hub and lounges | 6 | 2 | 8 |
| ShebaMiles | 3 | 1 | 4 |
| travel documents and visas | 2 | 1 | 3 |
| rules, fees and carriage | 4 | 2 | 6 |
| on board and add-ons | 2 | 3 | 5 |
| **total** | **40** | **20** | **60** |

**The questions are written against the page, not from memory, and the builder enforces it.** Every entry carries a `topic`: English content words that describe what the page must say. The builder refuses to write the gold file unless, for every question, the named document exists, is `status: "live"`, and **at least three of the topic's content words appear in that document's text**. A question pointed at a page that does not discuss its subject cannot reach the gold file. Step 4 prints the evidence for all 60 and it is read before the set is used.

The spec lives in the repo, unlike the v2 spec: these are questions about public airline pages with nothing confidential in them, and keeping them next to the builder means a change to the questions shows up in a diff.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/gold-travel.test.js`.

```javascript
'use strict';
// The travel gold set. The check that matters is the last one: a question may not enter the gold file unless
// the page it names actually discusses its subject. A benchmark whose gold pages do not answer their
// questions measures nothing, and measures it very convincingly.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verify, buildGold, contentWords } = require('../../ops/travel/build-gold-travel');
const { PREFER } = require('../../assistant/travel');
const spec = require('../../ops/travel/gold-travel-spec.json');

function pack(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'goldpack-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name + '.md'), body);
  return d;
}
const doc = (status, body) => '---\nurl: "https://x/y"\ntitle: "t"\nlang: "en"\nstatus: "' + status + '"\n---\n' + body + '\n';

test('the spec holds exactly 60 questions, 40 Amharic and 20 English', () => {
  assert.equal(spec.questions.length, 60);
  assert.equal(spec.questions.filter(q => q.lang === 'am').length, 40);
  assert.equal(spec.questions.filter(q => q.lang === 'en').length, 20);
});

test('every question has a unique id, a question, a slug and a topic', () => {
  const ids = spec.questions.map(q => q.qid);
  assert.equal(new Set(ids).size, 60);
  for (const q of spec.questions) {
    assert.match(q.qid, /^tv-\d{3}$/);
    assert.ok(q.question.trim().length > 8, q.qid);
    assert.match(q.slug, /^[a-z0-9-]+$/, q.qid);
    assert.ok(contentWords(q.topic).length >= 3, q.qid + ' topic is too thin: ' + q.topic);
    assert.ok(q.section, q.qid + ' names no section');
  }
});

test('an Amharic question is written in Ethiopic and an English one is not', () => {
  for (const q of spec.questions)
    assert.equal(/[ሀ-፿]/.test(q.question), q.lang === 'am', q.qid + ': ' + q.question);
});

test('the sections add up the way the design set them', () => {
  const by = {};
  for (const q of spec.questions) { by[q.section] = by[q.section] || { am: 0, en: 0 }; by[q.section][q.lang]++; }
  assert.deepEqual(by, {
    baggage: { am: 8, en: 4 }, 'check-in': { am: 4, en: 2 }, 'changes-refunds': { am: 5, en: 2 },
    'special-assistance': { am: 6, en: 3 }, 'transit-hub': { am: 6, en: 2 }, shebamiles: { am: 3, en: 1 },
    documents: { am: 2, en: 1 }, rules: { am: 4, en: 2 }, 'on-board': { am: 2, en: 3 },
  });
});

test('contentWords drops the small words that match everything', () => {
  assert.deepEqual(contentWords('what is the free baggage allowance for economy'), ['free', 'baggage', 'allowance', 'economy']);
});

test('verify accepts a question whose page discusses its subject', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const r = verify([{ qid: 'tv-001', slug: 'bags', topic: 'free baggage allowance economy' }], dir);
  assert.deepEqual(r.bad, []);
  assert.equal(r.ok[0].matched.length >= 3, true);
});

test('verify refuses a question whose page never mentions its subject', () => {
  const dir = pack({ bags: doc('live', 'Lounges at Addis Ababa are open to Cloud Nine passengers.') });
  const r = verify([{ qid: 'tv-001', slug: 'bags', topic: 'free baggage allowance economy' }], dir);
  assert.equal(r.ok.length, 0);
  assert.equal(r.bad[0].why, 'topic_not_on_page');
});

test('verify refuses a question whose page is missing or gone', () => {
  const dir = pack({ gone: doc('gone', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const r = verify([{ qid: 'a', slug: 'gone', topic: 'free baggage allowance economy' },
    { qid: 'b', slug: 'nothere', topic: 'free baggage allowance economy' }], dir);
  assert.deepEqual(r.bad.map(x => x.why).sort(), ['no_document', 'page_gone']);
});

test('buildGold refuses to write anything at all when one question fails', () => {
  const dir = pack({ bags: doc('live', 'Lounges at Addis Ababa are open to Cloud Nine passengers.') });
  const out = path.join(dir, 'gold.json');
  assert.throws(() => buildGold([{ qid: 'tv-001', lang: 'en', question: 'how much baggage?', slug: 'bags', topic: 'free baggage allowance economy', section: 'baggage' }], dir, out),
    /1 question\(s\) could not be verified/);
  assert.equal(fs.existsSync(out), false, 'a rejected build must not leave a half-written gold file');
});

test('buildGold writes a question the benchmark can run', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const out = path.join(dir, 'gold.json');
  buildGold([{ qid: 'tv-001', lang: 'en', question: 'how much checked baggage in economy?', slug: 'bags',
    topic: 'free baggage allowance economy', section: 'baggage' }], dir, out);
  const g = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(g.questions.length, 1);
  const q = g.questions[0];
  assert.equal(q.agent, 'bini');
  assert.deepEqual(q.prefer, PREFER);
  assert.deepEqual(q.gold_pages, [{ source: 'travel', slug: 'bags' }]);
  assert.equal(q.gold_source, 'travel');
  assert.equal(q.gold_slug, 'bags');
  assert.equal(q.crossLingual, false);
  assert.equal(q.strictCrossLingual, false);
});

test('an Amharic question against an English page is marked cross-lingual, because that is the hard case', () => {
  const dir = pack({ bags: doc('live', 'Free baggage allowance in Economy class is 2 pieces of 23 kg each.') });
  const out = path.join(dir, 'gold.json');
  buildGold([{ qid: 'tv-001', lang: 'am', question: 'ስንት ኪሎ ሻንጣ ነፃ ነው?', slug: 'bags',
    topic: 'free baggage allowance economy', section: 'baggage' }], dir, out);
  const q = JSON.parse(fs.readFileSync(out, 'utf8')).questions[0];
  assert.equal(q.crossLingual, true);
  assert.equal(q.strictCrossLingual, true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/gold-travel.test.js 2>&1 | tail -8
```

Expected: `Cannot find module '../../ops/travel/build-gold-travel'`.

- [ ] **Step 3: Write the spec — the 60 questions**

Slice block 2 of this task to `ops/travel/gold-travel-spec.json`.

```json
{
  "version": 1,
  "_about": "The 60 gold questions for the Ethiopian Airlines knowledge pack (design 2026-09-16, section 1.3): 40 Amharic, 20 English, each naming the page under knowledge/travel/ that answers it. `topic` is the English subject the page must discuss; ops/travel/build-gold-travel.js refuses to write the gold file unless at least three of a topic's content words are in that page's text, so a question can never point at a page that does not talk about it. Questions were written from the fetched pages, never from memory.",
  "questions": [
    { "qid": "tv-001", "lang": "am", "section": "baggage", "slug": "baggage-information-free-baggage-allowance", "topic": "free baggage allowance economy checked pieces", "question": "በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?" },
    { "qid": "tv-002", "lang": "am", "section": "baggage", "slug": "baggage-information-carry-on-baggage", "topic": "carry-on baggage weight dimensions cabin", "question": "ከእጄ ጋር የምይዘው ሻንጣ ስንት ኪሎ መሆን አለበት?" },
    { "qid": "tv-003", "lang": "am", "section": "baggage", "slug": "baggage-information-extra-baggage", "topic": "extra baggage purchase additional allowance charge", "question": "ተጨማሪ ሻንጣ ብወስድ ክፍያው እንዴት ነው የሚሰላው?" },
    { "qid": "tv-004", "lang": "am", "section": "baggage", "slug": "baggage-information-delayed-lost-or-damaged-baggage", "topic": "delayed lost damaged baggage report claim", "question": "ሻንጣዬ ጠፋ፤ ማንን ነው ማነጋገር ያለብኝ?" },
    { "qid": "tv-005", "lang": "am", "section": "baggage", "slug": "baggage-information-baggage-tracker", "topic": "baggage tracker track your bag online reference", "question": "ሻንጣዬ የት እንደደረሰ በኦንላይን መከታተል እችላለሁ?" },
    { "qid": "tv-006", "lang": "am", "section": "baggage", "slug": "baggage-information-restricted-items", "topic": "restricted items prohibited dangerous batteries carriage", "question": "በሻንጣ ውስጥ መጫን የማይፈቀዱ ዕቃዎች የትኞቹ ናቸው?" },
    { "qid": "tv-007", "lang": "am", "section": "baggage", "slug": "baggage-information-special-baggage", "topic": "special baggage sports equipment musical instrument oversized", "question": "የሙዚቃ መሣሪያ ወይም የስፖርት ዕቃ እንዴት ነው የሚጫነው?" },
    { "qid": "tv-008", "lang": "am", "section": "baggage", "slug": "baggage-information-interline-and-partners-baggage-policy", "topic": "interline partner airlines baggage policy applies", "question": "ከሌላ አየር መንገድ ጋር ስገናኝ የሻንጣ ፈቃዱ የማን ነው የሚሠራው?" },
    { "qid": "tv-009", "lang": "en", "section": "baggage", "slug": "baggage-information-free-baggage-allowance", "topic": "maximum dimensions checked baggage inches centimetres", "question": "What are the maximum dimensions for a checked bag?" },
    { "qid": "tv-010", "lang": "en", "section": "baggage", "slug": "baggage-information-carry-on-baggage", "topic": "personal item laptop bag in addition carry-on", "question": "Can I bring a laptop bag in addition to my carry-on?" },
    { "qid": "tv-011", "lang": "en", "section": "baggage", "slug": "baggage-information-delayed-lost-or-damaged-baggage", "topic": "damaged baggage report arrival claim property irregularity", "question": "My bag was damaged on arrival — how do I report it?" },
    { "qid": "tv-012", "lang": "en", "section": "baggage", "slug": "frequently-asked-questions-baggage-faqs", "topic": "baggage questions answers allowance pieces weight route", "question": "How many bags can I check in for free?" },
    { "qid": "tv-013", "lang": "am", "section": "check-in", "slug": "check-in-online-check-in", "topic": "online check-in opens hours before departure", "question": "ኦንላይን ቼክ ኢን መቼ ነው የሚከፈተው?" },
    { "qid": "tv-014", "lang": "am", "section": "check-in", "slug": "check-in-check-in-at-the-airport", "topic": "airport check-in counter closes hours before departure", "question": "በአውሮፕላን ማረፊያ ቼክ ኢን ለማድረግ ስንት ሰዓት ቀደም ብዬ ልድረስ?" },
    { "qid": "tv-015", "lang": "am", "section": "check-in", "slug": "check-in-check-in-process", "topic": "check-in process documents passport ticket identification", "question": "ቼክ ኢን ለማድረግ ምን ምን ሰነድ ያስፈልገኛል?" },
    { "qid": "tv-016", "lang": "am", "section": "check-in", "slug": "check-in-web-check-in", "topic": "boarding pass mobile print download web", "question": "የመሳፈሪያ ወረቀቴን በስልኬ ላይ ማውረድ እችላለሁ?" },
    { "qid": "tv-017", "lang": "en", "section": "check-in", "slug": "check-in-online-check-in", "topic": "online check-in closes before departure time", "question": "When does online check-in close before departure?" },
    { "qid": "tv-018", "lang": "en", "section": "check-in", "slug": "frequently-asked-questions-check-in-faqs", "topic": "check-in eligibility not eligible flights passengers", "question": "Which passengers are not eligible for online check-in?" },
    { "qid": "tv-019", "lang": "am", "section": "changes-refunds", "slug": "manage-refund-request", "topic": "refund request form ticket submit process", "question": "ትኬቴን መመለስ ብፈልግ ገንዘቤ እንዴት ይመለስልኛል?" },
    { "qid": "tv-020", "lang": "am", "section": "changes-refunds", "slug": "manage-exchange-request", "topic": "exchange request change date flight fare difference", "question": "የበረራ ቀኔን መቀየር እፈልጋለሁ፤ ምን ላድርግ?" },
    { "qid": "tv-021", "lang": "am", "section": "changes-refunds", "slug": "manage-name-change-request", "topic": "name change request spelling correction passenger ticket", "question": "ትኬቱ ላይ ስሜ በስህተት ተጽፏል፤ ማስተካከል ይቻላል?" },
    { "qid": "tv-022", "lang": "am", "section": "changes-refunds", "slug": "manage-upgrade-to-cloud-nine", "topic": "upgrade cloud nine business class bid offer", "question": "ቦታዬን ወደ ክላውድ ናይን ማሳደግ እችላለሁ?" },
    { "qid": "tv-023", "lang": "am", "section": "changes-refunds", "slug": "manage-manage-booking", "topic": "manage booking retrieve reservation code surname", "question": "ትኬቴን ከገዛሁ በኋላ ዝርዝሩን የት ነው የማየው?" },
    { "qid": "tv-024", "lang": "en", "section": "changes-refunds", "slug": "manage-refund-request", "topic": "refund processing time days request submitted", "question": "How long does a refund take once the request is submitted?" },
    { "qid": "tv-025", "lang": "en", "section": "changes-refunds", "slug": "upgrade-to-cloud-nine-plus-grade-terms-and-conditions", "topic": "plusgrade bid upgrade terms conditions accepted offer", "question": "What are the terms of a bid upgrade to Cloud Nine?" },
    { "qid": "tv-026", "lang": "am", "section": "special-assistance", "slug": "special-needs-travelling-with-pets", "topic": "travelling pets cabin hold container health certificate", "question": "ውሻዬን ወይም ድመቴን ይዤ መጓዝ እችላለሁ?" },
    { "qid": "tv-027", "lang": "am", "section": "special-assistance", "slug": "special-needs-travelling-while-pregnant", "topic": "pregnancy travel weeks medical certificate fitness fly", "question": "ነፍሰ ጡር ሆኜ እስከ ስንተኛ ወር ድረስ መብረር እችላለሁ?" },
    { "qid": "tv-028", "lang": "am", "section": "special-assistance", "slug": "special-needs-unaccompanied-minor", "topic": "unaccompanied minor children age service escort", "question": "ልጄ ብቻውን ይጓዛል፤ ምን ዓይነት አገልግሎት አለ?" },
    { "qid": "tv-029", "lang": "am", "section": "special-assistance", "slug": "special-needs-services-for-customers-with-special-need", "topic": "special needs wheelchair assistance request advance", "question": "የተሽከርካሪ ወንበር አገልግሎት እንዴት እጠይቃለሁ?" },
    { "qid": "tv-030", "lang": "am", "section": "special-assistance", "slug": "special-needs-medical-case-passengers", "topic": "medical case passengers clearance oxygen stretcher approval", "question": "የሕክምና ሁኔታ ካለብኝ ከመብረሬ በፊት ምን ማቅረብ አለብኝ?" },
    { "qid": "tv-031", "lang": "am", "section": "special-assistance", "slug": "special-needs-medical-request", "topic": "medical information form medif doctor submit", "question": "የMEDIF ቅጽ ከየት አገኛለሁ?" },
    { "qid": "tv-032", "lang": "en", "section": "special-assistance", "slug": "special-needs-disability-service-request-form", "topic": "disability service request form assistance submit", "question": "How do I request special assistance for a disability?" },
    { "qid": "tv-033", "lang": "en", "section": "special-assistance", "slug": "special-deals-medical-travel", "topic": "medical travel package patient companion discount treatment", "question": "Is there a special fare for patients travelling for medical treatment?" },
    { "qid": "tv-034", "lang": "en", "section": "special-assistance", "slug": "special-needs-unaccompanied-minor", "topic": "unaccompanied minor age years service fee accepted", "question": "From what age can a child fly alone?" },
    { "qid": "tv-035", "lang": "am", "section": "transit-hub", "slug": "services-at-the-airport-addis-ababa-stopovers", "topic": "stopover addis ababa hours transit passengers", "question": "በአዲስ አበባ ትራንዚት ስሆን ስንት ሰዓት መቆየት እችላለሁ?" },
    { "qid": "tv-036", "lang": "am", "section": "transit-hub", "slug": "services-at-the-airport-minimum-connecting-time", "topic": "minimum connecting time addis ababa international domestic", "question": "በቦሌ አየር ማረፊያ በረራ ለመቀየር ዝቅተኛው ጊዜ ስንት ነው?" },
    { "qid": "tv-037", "lang": "am", "section": "transit-hub", "slug": "services-at-the-airport-lounges-at-addis-ababa", "topic": "lounges addis ababa cloud nine access terminal", "question": "በአዲስ አበባ አየር ማረፊያ ምን ዓይነት ላውንጆች አሉ?" },
    { "qid": "tv-038", "lang": "am", "section": "transit-hub", "slug": "add-on-services-cip-lounge-pass", "topic": "cip lounge pass purchase access economy passengers", "question": "የላውንጅ መግቢያ ክፍያ ከፍዬ መጠቀም እችላለሁ?" },
    { "qid": "tv-039", "lang": "am", "section": "transit-hub", "slug": "services-at-the-airport-arrival-services-at-addis-ababa", "topic": "arrival services addis ababa immigration baggage assistance", "question": "አዲስ አበባ ስደርስ ምን ምን አገልግሎቶች ይጠብቁኛል?" },
    { "qid": "tv-040", "lang": "am", "section": "transit-hub", "slug": "add-on-services-stopover-at-addis", "topic": "stopover addis hotel accommodation city tour package", "question": "በአዲስ አበባ ማደሪያ ሆቴል ይሰጠኛል?" },
    { "qid": "tv-041", "lang": "en", "section": "transit-hub", "slug": "services-at-the-airport-minimum-connecting-time", "topic": "minimum connecting time addis ababa minutes international", "question": "What is the minimum connecting time at Addis Ababa?" },
    { "qid": "tv-042", "lang": "en", "section": "transit-hub", "slug": "meet-and-greet-services-at-addis-ababa-airport", "topic": "meet greet service addis ababa airport booking assistance", "question": "How do I book a meet-and-greet service at Bole airport?" },
    { "qid": "tv-043", "lang": "am", "section": "shebamiles", "slug": "frequently-asked-questions-shebamiles-faqs", "topic": "shebamiles join enrolment membership account miles", "question": "ShebaMiles እንዴት ነው የምቀላቀለው?" },
    { "qid": "tv-044", "lang": "am", "section": "shebamiles", "slug": "frequently-asked-questions-shebamiles-faqs", "topic": "miles expiry validity months account inactive", "question": "ያሰባሰብኳቸው ማይሎች መቼ ነው የሚያበቁት?" },
    { "qid": "tv-045", "lang": "am", "section": "shebamiles", "slug": "et-specials-shebamiles-deals-offers", "topic": "shebamiles award ticket redeem miles offers", "question": "በማይል ትኬት መግዛት እችላለሁ?" },
    { "qid": "tv-046", "lang": "en", "section": "shebamiles", "slug": "frequently-asked-questions-shebamiles-faqs", "topic": "missing miles claim retroactive credit flight", "question": "How do I claim missing miles for a past flight?" },
    { "qid": "tv-047", "lang": "am", "section": "documents", "slug": "et-specials-apply-ethiopian-e-visa", "topic": "ethiopia evisa apply online tourist arrival", "question": "ወደ ኢትዮጵያ ለመግባት ቪዛ እንዴት አመለክታለሁ?" },
    { "qid": "tv-048", "lang": "am", "section": "documents", "slug": "add-on-services-travel-visa-services", "topic": "visa service destination apply assistance passengers", "question": "የመዳረሻ አገር ቪዛ በአየር መንገዱ በኩል ማመልከት ይቻላል?" },
    { "qid": "tv-049", "lang": "en", "section": "documents", "slug": "essential-information-travel-tips-and-information", "topic": "travel documents passport validity visa requirements destination", "question": "What travel documents do I need to check before flying?" },
    { "qid": "tv-050", "lang": "am", "section": "rules", "slug": "rules-and-regulations-conditions-of-carriage", "topic": "conditions carriage contract passenger baggage liability", "question": "የበረራው ሁኔታዎችና ደንቦች የት ተጽፈዋል?" },
    { "qid": "tv-051", "lang": "am", "section": "rules", "slug": "essential-information-dangerous-goods", "topic": "dangerous goods prohibited lithium batteries carriage forbidden", "question": "አደገኛ ዕቃዎች ተብለው የሚቆጠሩት የትኞቹ ናቸው?" },
    { "qid": "tv-052", "lang": "am", "section": "rules", "slug": "essential-information-optional-service-charges", "topic": "optional service charges fees seat baggage payment", "question": "ለተጨማሪ አገልግሎቶች ምን ያህል ክፍያ አለ?" },
    { "qid": "tv-053", "lang": "am", "section": "rules", "slug": "essential-information-credit-card-restriction", "topic": "credit card restriction payment verification cardholder", "question": "በክሬዲት ካርድ ስከፍል ምን ገደብ አለ?" },
    { "qid": "tv-054", "lang": "en", "section": "rules", "slug": "essential-information-tarmac-delay-contingency-plan", "topic": "tarmac delay contingency plan passengers aircraft hours", "question": "What happens if the aircraft is delayed on the tarmac?" },
    { "qid": "tv-055", "lang": "en", "section": "rules", "slug": "rules-and-regulations-exit-row-disclaimer", "topic": "exit row seating requirements passengers not permitted", "question": "Who is not allowed to sit in an exit row?" },
    { "qid": "tv-056", "lang": "am", "section": "on-board", "slug": "add-on-services-on-board-wifi", "topic": "on-board wifi internet aircraft purchase connection", "question": "በበረራ ላይ ኢንተርኔት አለ?" },
    { "qid": "tv-057", "lang": "am", "section": "on-board", "slug": "add-on-services-preferred-seat", "topic": "preferred seat selection purchase advance legroom", "question": "የተመረጠ መቀመጫ አስቀድሜ መያዝ እችላለሁ?" },
    { "qid": "tv-058", "lang": "en", "section": "on-board", "slug": "on-board-services-cloud-nine-services", "topic": "cloud nine business class service meal seat", "question": "What is served in Cloud Nine?" },
    { "qid": "tv-059", "lang": "en", "section": "on-board", "slug": "on-board-services-allergy-policy", "topic": "allergy policy nut passengers on-board meals", "question": "What is the allergy policy on board?" },
    { "qid": "tv-060", "lang": "en", "section": "on-board", "slug": "add-on-services-refund-protection", "topic": "refund protection cover booking cancellation reasons", "question": "What does refund protection cover?" }
  ]
}
```

- [ ] **Step 4: Write the builder**

Slice block 3 of this task to `ops/travel/build-gold-travel.js`.

```javascript
#!/usr/bin/env node
'use strict';
// Build the travel retrieval gold set from ops/travel/gold-travel-spec.json.
//
//   node ops/travel/build-gold-travel.js            verify and write /root/storage/bina-embed/eval/gold-travel.json
//   node ops/travel/build-gold-travel.js --check    verify and print the evidence, write nothing
//   node ops/travel/build-gold-travel.js --out <p>  somewhere else
// Then:
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold travel
//
// The rule that makes this a measurement rather than a decoration: a question may not enter the gold file
// unless the page it names is on disk, is live, and actually discusses the question's subject. `topic` is
// the English subject in content words; three of them must be in the page's text. A question aimed at a page
// that never mentions its subject is refused by name, and NOTHING is written - a half-verified gold set is
// worse than none, because the number it produces looks exactly as trustworthy as a real one.
const fs = require('fs');
const path = require('path');
const { PREFER } = require(path.join(__dirname, '..', '..', 'assistant', 'travel'));

const PACK = path.join(__dirname, '..', '..', 'knowledge', 'travel');
const SPEC = path.join(__dirname, 'gold-travel-spec.json');
const OUT = '/root/storage/bina-embed/eval/gold-travel.json';
const MIN_MATCHES = 3;

const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at', 'is', 'are', 'my', 'your', 'i', 'it', 'be', 'do', 'can', 'what', 'how', 'when', 'who', 'with', 'from', 'by', 'not']);
function contentWords(topic) {
  return String(topic || '').toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2 && !STOP.has(w));
}
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');
function readDoc(dir, slug) {
  const f = path.join(dir, slug + '.md');
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const meta = {};
  if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2]; }
  return { meta, text: fm ? raw.slice(fm[0].length) : raw };
}

// -> { ok: [{ ...q, matched }], bad: [{ qid, slug, why, missing }] }
function verify(questions, dir = PACK) {
  const ok = [], bad = [];
  for (const q of questions) {
    const d = readDoc(dir, q.slug);
    if (!d) { bad.push({ qid: q.qid, slug: q.slug, why: 'no_document' }); continue; }
    if (d.meta.status === 'gone') { bad.push({ qid: q.qid, slug: q.slug, why: 'page_gone' }); continue; }
    const hay = norm(d.text);
    const words = contentWords(q.topic);
    const matched = words.filter(w => hay.includes(w));
    if (matched.length < MIN_MATCHES) {
      bad.push({ qid: q.qid, slug: q.slug, why: 'topic_not_on_page', missing: words.filter(w => !matched.includes(w)) });
      continue;
    }
    ok.push({ ...q, matched, pageLang: d.meta.lang || 'en', title: d.meta.title || q.slug });
  }
  return { ok, bad };
}

function buildGold(questions, dir, out) {
  const { ok, bad } = verify(questions, dir);
  if (bad.length) {
    for (const b of bad) console.error('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    throw new Error(bad.length + ' question(s) could not be verified against the fetched pages; nothing written');
  }
  const gold = {
    _about: 'Ethiopian Airlines travel pack, 60 questions (40 am, 20 en). Built by ops/travel/build-gold-travel.js '
      + 'from ops/travel/gold-travel-spec.json on ' + new Date().toISOString().slice(0, 10)
      + '. Every question was verified against the text of its gold page. Each question carries the prefer list '
      + 'assistant/travel.js passes for a travel message, so the benchmark measures what a user gets.',
    questions: ok.map(q => ({
      qid: q.qid, lang: q.lang, question: q.question, section: q.section,
      agent: 'bini', prefer: PREFER,
      gold_source: 'travel', gold_slug: q.slug,
      gold_pages: [{ source: 'travel', slug: q.slug }],
      grade: 'GOOD',
      crossLingual: q.lang !== q.pageLang,
      strictCrossLingual: q.lang !== q.pageLang,
      topic: q.topic, matched: q.matched, goldTitle: q.title,
    })),
    coverage_gaps: [],
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(gold, null, 1));
  return gold;
}

function main() {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT;
  const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  if (argv.includes('--check')) {
    const { ok, bad } = verify(spec.questions);
    for (const q of ok) console.log('  ok      ' + q.qid + ' [' + q.lang + '] ' + q.slug + '  matched: ' + q.matched.join(', '));
    for (const b of bad) console.log('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    console.log('\n' + ok.length + ' verified, ' + bad.length + ' refused, of ' + spec.questions.length);
    if (bad.length) process.exit(1);
    return;
  }
  const g = buildGold(spec.questions, PACK, out);
  console.log('wrote ' + out + ': ' + g.questions.length + ' questions ('
    + g.questions.filter(q => q.lang === 'am').length + ' am, ' + g.questions.filter(q => q.lang === 'en').length + ' en), '
    + g.questions.filter(q => q.crossLingual).length + ' cross-lingual');
}

module.exports = { verify, buildGold, contentWords, readDoc, PACK, SPEC, OUT, MIN_MATCHES };
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
```

- [ ] **Step 5: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/gold-travel.test.js 2>&1 | tail -6
```

Expected: `# pass 11`, `# fail 0`.

- [ ] **Step 6: Verify all 60 against the pages actually on disk**

```
cd /var/www/connectcare/binasmart && node ops/travel/build-gold-travel.js --check 2>&1 | tail -30
```

Expected on a good day: `60 verified, 0 refused, of 60`.

**Expect some refusals on the first run, and handle them like this — in this order:**

1. `no_document` — the slug is wrong, or that page is not in the sitemap and was not discovered. Find the real slug: `ls knowledge/travel/ | grep <word>`. If the page genuinely is not in the pack, **move the question to a page that does answer it**, do not weaken the check.
2. `topic_not_on_page` — read the page before deciding: `head -40 knowledge/travel/<slug>.md`. If the page does answer the question in other words, fix the `topic` to words that are actually on the page. **If the page does not answer the question, change the question**, or point it at the page that does.
3. Never lower `MIN_MATCHES`, and never delete a question to make the count work: the table in this task fixes the per-section and per-language counts and `test/travel/gold-travel.test.js` enforces them, so a replacement must keep the same `lang` and `section`.

Re-run `--check` until it prints `60 verified, 0 refused`.

- [ ] **Step 7: Write the gold file**

```
cd /var/www/connectcare/binasmart && node ops/travel/build-gold-travel.js && node -e "const g=require('/root/storage/bina-embed/eval/gold-travel.json');console.log(g.questions.length,'questions');const by={};for(const q of g.questions)by[q.section]=(by[q.section]||0)+1;console.log(JSON.stringify(by));console.log('cross-lingual',g.questions.filter(q=>q.crossLingual).length);"
```

Expected:

```
wrote /root/storage/bina-embed/eval/gold-travel.json: 60 questions (40 am, 20 en), 40 cross-lingual
60 questions
{"baggage":12,"check-in":6,"changes-refunds":7,"special-assistance":9,"transit-hub":8,"shebamiles":4,"documents":3,"rules":6,"on-board":5}
cross-lingual 40
```

All 40 Amharic questions are cross-lingual because the pack is English — the airline publishes no Amharic page. That is the hardest slice in the whole system and the one this set exists to watch.

- [ ] **Step 8: Whole suite and commit**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1342`, `# fail 0`.

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Sixty gold questions for the airline pack" "" "Forty Amharic, twenty English, spread across the sections the design names, each" "pointing at the page that answers it." "" "The builder refuses to write the gold file unless every question's page is on" "disk, is live, and actually discusses the question's subject - three content" "words of the topic must be in the page's text. One failure and nothing is" "written, because a half-verified gold set produces a number that looks exactly" "as trustworthy as a real one." "" "All forty Amharic questions are cross-lingual: the airline publishes no Amharic" "page, so an Amharic question must find an English one. That is the slice this" "set exists to watch." "" "The spec is in the repo, unlike the v2 spec, because these are questions about" "public airline pages and a change to them should show in a diff." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm9.txt && git add ops/travel/build-gold-travel.js ops/travel/gold-travel-spec.json test/travel/gold-travel.test.js && git commit -F /tmp/cm9.txt && rm /tmp/cm9.txt
```

Expected: `3 files changed`.

---
### Task 10: Measure the pack, and get Page@3 to 90%

**Files:**
- Possibly modify: `ops/travel/gold-travel-spec.json`, `knowledge/travel/sources.json` (only as the allowed remedies below permit)
- Output: `/root/bini-eval/retrieval-gold-travel-<stamp>.json`, `/root/bini-eval/retrieval-gold-travel-latest.json`

Target from the design: **the right page in the top 3 for at least 90%** of the 60 questions.

- [ ] **Step 1: Run the travel benchmark**

It makes two searches per question with a 300 ms pause, plus Gemini query embeddings and the reranker — about four minutes. Detached, with the log polled.

```
cd /var/www/connectcare/binasmart && rm -f /tmp/travel-bench.log && nohup node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold travel > /tmp/travel-bench.log 2>&1 & echo started $!
```

Poll every 60 seconds:

```
tail -30 /tmp/travel-bench.log
```

Expected shape at the end:

```
corpus: 14xxx chunks, 14xxx embedded, gemini=true, local vectors xxxx
gold set: /root/storage/bina-embed/eval/gold-travel.json  (tag gold-travel)
gold questions: 60, whose gold page still exists: 60

  Page@3 — is the right page in the top three?

  slice                                   n   retrieval   as shipped
  all questions                          60       9x.x%        9x.x%
    of those, gold page still exists     60       9x.x%        9x.x%
  Amharic                                40       9x.x%        9x.x%   MRR 0.9xx
  English                                20      10x.x%       10x.x%   MRR 0.9xx
  bini                                   60       9x.x%        9x.x%   MRR 0.9xx
    bini am                              40       9x.x%        9x.x%
    bini en                              20      100.0%       100.0%
  am question, gold only in English      40       9x.x%        9x.x%
  question + gold share a language       20      100.0%       100.0%

  written: /root/bini-eval/retrieval-gold-travel-2026xxxx-xxxxxx.json  (and retrieval-gold-travel-latest.json)
```

- [ ] **Step 2: If "as shipped / all questions" is 90.0% or better, stop here and go to Step 4**

- [ ] **Step 3: If it is below 90%, read the misses before changing anything**

```
cd /var/www/connectcare/binasmart && node -e "const j=require('/root/bini-eval/retrieval-gold-travel-latest.json');const s=require('/root/storage/bina-embed/eval/gold-travel.json').questions;const q=Object.fromEntries(s.map(x=>[x.qid,x]));for(const r of j.rows.filter(r=>!r.shipped))console.log(r.qid,'['+r.lang+']',q[r.qid].question.slice(0,54),'\n    want:',r.gold.join(','),'\n    got :',r.top.join(', '),'\n');"
```

Read every miss. Then apply **only** these remedies, in this order:

1. **The gold page is wrong.** The question is answered by a different page of the pack, and the retriever found it. Fix the spec's `slug` and `topic` (keeping `lang` and `section`), re-run `build-gold-travel.js`. This is not moving the goalposts; it is correcting a label.
2. **A BinaSmart guide legitimately answers it better.** For example, `guide:ethiopia-evisa` may genuinely be a better answer for an Ethiopian visa question than the airline's e-visa landing page. Say so in the spec's `note`, move the question to a question the pack itself answers, and record the displacement in the Task 12 report. Do not fight a correct answer.
3. **The page is in the pack but too thin to rank.** Check `wc -c knowledge/travel/<slug>.md`. A page that is mostly a form has little text; move the question to the FAQ page that covers the same subject (`frequently-asked-questions-*`), which is where the airline actually writes the rules.
4. **The section's Amharic label is missing a word people type.** `sources.json` `sections[].titleAm` is what a document header says in Amharic, and it is the only Amharic an Amharic question can keyword-match. Adding another Amharic **label** for the same section (for example both ሻንጣ and ተሳፋሪ ሻንጣ) is allowed — it is a name, not a fact. Re-run the fetcher for that site and re-ingest.

**Forbidden, all of them, whatever the number says:**

- lowering `MIN_MATCHES` in the builder, or deleting a question to lift the average;
- changing `k`, `rerankTo` or `RERANK_GAP` in `knowledge/index.js` — those are shared with Dr Afiya, Asmat and every other caller, and Task 12 has to show their numbers unchanged;
- adding a fact, a figure or a paraphrase to a knowledge document by hand. `generated_by` says these files are produced by the fetcher; an edited file is overwritten by the next freshness run anyway, so a hand-edit is both dishonest and temporary.

After each change re-run Step 1. Keep every run: the benchmark never overwrites a dated file.

- [ ] **Step 4: Record the number**

```
cd /var/www/connectcare/binasmart && node -e "const j=require('/root/bini-eval/retrieval-gold-travel-latest.json');for(const t of j.table)console.log(t.name.padEnd(36),String(t.n).padStart(4),String(t.plain).padStart(8),String(t.shipped).padStart(8),t.mrrShipped?'MRR '+t.mrrShipped:'');"
```

Write down `all questions / as shipped`. Task 12's report quotes it, and every later freshness run is compared against it.

- [ ] **Step 5: Commit only if the spec changed**

If Step 3 changed `ops/travel/gold-travel-spec.json` or `knowledge/travel/sources.json`:

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Travel gold set: corrections from the first measured run" "" "Page@3 as shipped on the 60 questions: <fill in>. The questions changed below" "were pointed at the wrong page of the pack, not at a page that failed to rank -" "the retriever found the page that answers them and the label was wrong." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm10.txt && git add ops/travel/gold-travel-spec.json knowledge/travel/sources.json && git commit -F /tmp/cm10.txt && rm /tmp/cm10.txt
```

If nothing changed, there is nothing to commit. Say so and move on.

---

### Task 11: The weekly freshness check and the note to Ibrahim

**Files:**
- Create: `ops/travel/freshness.js`
- Modify: `ops/travel/fetch-airline.js` (`writePack` gains the mass-loss guard)
- Test: `test/travel/freshness.test.js`

What it does, every Sunday, after the site crawl: re-fetch every page in the pack at the same pacing, update what changed, mark what vanished, re-ingest the `travel` source, and send Ibrahim **one** Telegram note — **only if something moved**. A week where the airline changed nothing sends nothing.

Two guards that are the whole point of writing this carefully:

- **A failed fetch must never look like a deleted site.** If the airline is unreachable on a Sunday, the naive behaviour is to mark all 120 pages `gone` and empty the pack. `knowledge/index.js` already refuses the equivalent ("REFUSING to drop N of M chunks — that looks like a failed fetch, not a removal") and `writePack` gets the same refusal.
- **A site-wide template change is one event, not fifty.** The content hash is taken over the boilerplate-stripped text, so a change to the airline's global notification bar can move most pages at once. The note says that in one line instead of listing them.

- [ ] **Step 1: Write the failing test**

Slice block 0 of this task to `test/travel/freshness.test.js`.

```javascript
'use strict';
// The weekly check. Everything is injected - the network, the clock, the ingest and the Telegram sender -
// so the tests exercise the real decisions and send nothing. The first REAL note is the proof, and it is
// sent by cron, in production, when the airline actually changes a page.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, noteFor } = require('../../ops/travel/freshness');
const { writePack } = require('../../ops/travel/fetch-airline');

const SITE = { id: 'ethiopian-airlines', name: 'Ethiopian Airlines', nameAm: 'የኢትዮጵያ አየር መንገድ', lang: 'en' };
const page = (slug, body) => ({ siteId: 'ethiopian-airlines', slug, path: '/et/x/' + slug,
  url: 'https://www.ethiopianairlines.com/et/x/' + slug, title: slug, section: 'baggage', sectionTitleAm: 'ሻንጣ',
  text: body + ' ' + 'padding to clear the four hundred character floor. '.repeat(10) });

function dirWith(pages, today = '2026-09-16') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  writePack(d, pages, SITE, { today });
  return d;
}
// A fake fetchSite: returns the pages it was given, in the shape the real one returns.
const fakeFetch = (pages, failed = []) => async () => ({ pages, failed });

function harness(dir, pages, opts = {}) {
  const sent = [], ingested = [];
  const res = { sent, ingested };
  res.run = () => run({
    dir, today: opts.today || '2026-09-23', dryRun: !!opts.dryRun, log: () => {},
    sites: [SITE], fetchSite: fakeFetch(pages, opts.failed || []),
    sendTg: async t => { sent.push(t); return true; },
    runIngest: async () => { ingested.push(1); return { inserted: 18, deleted: 12, total: 14000 }; },
  });
  return res;
}

test('a week where nothing changed sends nothing and does not re-ingest', async () => {
  const p = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const h = harness(dirWith(p), p);
  const r = await h.run();
  assert.equal(r.quiet, true);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.ingested, []);
});

test('a changed page is rewritten, re-ingested and reported once', async () => {
  const before = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const dir = dirWith(before);
  const after = [page('a', 'Maximum weight 32 kg.'), page('b', 'Carry-on 7 kg.')];
  const h = harness(dir, after);
  const r = await h.run();
  assert.deepEqual(r.changed, ['a']);
  assert.equal(h.ingested.length, 1);
  assert.equal(h.sent.length, 1, 'exactly one note');
  assert.match(h.sent[0], /changed/i);
  assert.match(h.sent[0], /\ba\b/);
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('32 kg'));
});

test('a vanished page is marked gone, kept on disk, and named in the note', async () => {
  const before = [page('a', 'Maximum weight 23 kg.'), page('b', 'Carry-on 7 kg.')];
  const dir = dirWith(before);
  const h = harness(dir, [page('a', 'Maximum weight 23 kg.')]);
  const r = await h.run();
  assert.deepEqual(r.gone, ['b']);
  const b = fs.readFileSync(path.join(dir, 'b.md'), 'utf8');
  assert.match(b, /status: "gone"/);
  assert.ok(b.includes('Carry-on 7 kg.'), 'the last known text was deleted');
  assert.match(h.sent[0], /gone/i);
});

test('a dry run writes nothing, ingests nothing and sends nothing', async () => {
  const before = [page('a', 'Maximum weight 23 kg.')];
  const dir = dirWith(before);
  const h = harness(dir, [page('a', 'Maximum weight 32 kg.')], { dryRun: true });
  const r = await h.run();
  assert.deepEqual(r.changed, ['a']);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.ingested, []);
  assert.ok(fs.readFileSync(path.join(dir, 'a.md'), 'utf8').includes('23 kg'), 'a dry run rewrote the file');
});

test('a failed fetch never empties the pack, and says so out loud', async () => {
  const before = [];
  for (let i = 0; i < 30; i++) before.push(page('p' + i, 'Page ' + i + ' content.'));
  const dir = dirWith(before);
  const h = harness(dir, [page('p0', 'Page 0 content.')], { failed: [{ url: 'x', why: 'timeout' }] });
  const r = await h.run();
  assert.equal(r.refused, true);
  assert.deepEqual(r.gone, []);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.md')).length, 30, 'files were removed or rewritten');
  assert.match(h.sent[0], /could not be checked|refus/i, 'a silent failure is the one thing this must not do');
  assert.deepEqual(h.ingested, []);
});

test('a site-wide template change is one line, not fifty', () => {
  const note = noteFor([{ site: 'ethiopian-airlines', name: 'Ethiopian Airlines', total: 40,
    added: [], changed: Array.from({ length: 32 }, (_, i) => 'p' + i), unchanged: [], gone: [], revived: [], failed: 0 }],
    { today: '2026-09-23' });
  assert.match(note, /32 of 40 pages changed at once/);
  assert.equal((note.match(/•/g) || []).length <= 3, true, 'the note listed every page: ' + note);
});

test('the note names the page, not only the slug, when the pack has a title for it', () => {
  const note = noteFor([{ site: 'ethiopian-airlines', name: 'Ethiopian Airlines', total: 40, added: [],
    changed: ['baggage-information-free-baggage-allowance'], unchanged: [], gone: [], revived: [], failed: 0,
    titles: { 'baggage-information-free-baggage-allowance': 'Free Baggage Allowance' } }], { today: '2026-09-23' });
  assert.match(note, /Free Baggage Allowance/);
});

test('writePack refuses a mass loss on a pack that already has pages', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(page('p' + i, 'Page ' + i + ' content.'));
  const dir = dirWith(many);
  const r = writePack(dir, [page('p0', 'Page 0 content.')], SITE, { today: '2026-09-23' });
  assert.equal(r.refused, true);
  assert.deepEqual(r.gone, []);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.md')).length, 30);
});

test('writePack still allows the first run, where everything is new', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-'));
  const many = [];
  for (let i = 0; i < 30; i++) many.push(page('p' + i, 'Page ' + i + ' content.'));
  const r = writePack(dir, many, SITE, { today: '2026-09-16' });
  assert.equal(r.refused, undefined);
  assert.equal(r.added.length, 30);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```
cd /var/www/connectcare/binasmart && node --test test/travel/freshness.test.js 2>&1 | tail -8
```

Expected: `Cannot find module '../../ops/travel/freshness'`.

- [ ] **Step 3: Add the mass-loss guard to `writePack`**

Slice block 2 of this task to `/tmp/patch-writepack-guard.js`, run `node /tmp/patch-writepack-guard.js`, then delete it.

```javascript
const fs = require('fs');
const f = '/var/www/connectcare/binasmart/ops/travel/fetch-airline.js';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('MASS_LOSS_FLOOR')) throw new Error('already patched');

const OLD = "  for (const f of onDisk) {\n" +
  "    const slug = f.replace(/\\.md$/, '');\n" +
  "    if (wanted.has(slug)) continue;";
const NEW = "  // A failed fetch must never look like a deleted site. If most of what is on disk is suddenly missing from\n" +
  "  // the fetch, that is the network, not the airline: refuse the whole gone pass and say so. This is the same\n" +
  "  // refusal knowledge/index.js makes before collecting orphaned chunks, for the same reason.\n" +
  "  const live = onDisk.filter(f => readMeta(fs.readFileSync(path.join(dir, f), 'utf8')).source_name === site.name\n" +
  "    && readMeta(fs.readFileSync(path.join(dir, f), 'utf8')).status !== 'gone');\n" +
  "  if (live.length >= MASS_LOSS_FLOOR && wanted.size < live.length / 2) {\n" +
  "    return { ...r, refused: true, refusedWhy: 'only ' + wanted.size + ' of ' + live.length + ' pages came back' };\n" +
  "  }\n" +
  "  for (const f of onDisk) {\n" +
  "    const slug = f.replace(/\\.md$/, '');\n" +
  "    if (wanted.has(slug)) continue;";
if (!s.includes(OLD)) throw new Error('gone-pass anchor not found');
s = s.replace(OLD, NEW);

const OLD_CONST = "const MIN_CHARS = 400;   // the same floor knowledge/index.js puts under a crawled page";
const NEW_CONST = OLD_CONST + "\n// Below this many live documents a pack is too small for \"most of them vanished\" to mean anything, so the\n" +
  "// guard stays out of the way of a first run and of a small site.\nconst MASS_LOSS_FLOOR = 20;";
if (!s.includes(OLD_CONST)) throw new Error('MIN_CHARS anchor not found');
s = s.replace(OLD_CONST, NEW_CONST);

s = s.replace("UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS };", "UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS, MASS_LOSS_FLOOR };");
fs.writeFileSync(f, s);
console.log('patched writePack with the mass-loss guard');
```

Then make `main()` in the same file report a refusal instead of claiming success:

```
cd /var/www/connectcare/binasmart && grep -n "r.gone.length + ' gone" ops/travel/fetch-airline.js
```

Add, immediately after the `const r = writePack(...)` line in `main()`:

```javascript
    if (r.refused) { log('[travel] ' + site.id + ': REFUSED to update the pack — ' + r.refusedWhy + '. Nothing written.'); bad++; continue; }
```

- [ ] **Step 4: Write the freshness check**

Slice block 5 of this task to `ops/travel/freshness.js`.

```javascript
#!/usr/bin/env node
'use strict';
// The weekly freshness check for the travel knowledge pack.
//
//   node --env-file=.env ops/travel/freshness.js            re-fetch, update, re-ingest, tell Ibrahim if something moved
//   node --env-file=.env ops/travel/freshness.js --dry-run   do all of it and write, ingest and send NOTHING
//
// Cron, Sunday 05:00 UTC - an hour after knowledge/crawl.js at 04:00, so the two are never fetching at once:
//   0 5 * * 0 cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/travel/freshness.js >> /var/log/bina-travel-freshness.log 2>&1
//
// The rule Ibrahim set: one note, and only when something changed or vanished. A week in which the airline
// changed nothing sends nothing at all - an alert that arrives every week is an alert nobody reads.
//
// The exception is a failure. If the site could not be checked, that IS the news: a weekly check that fails
// silently is worse than no check, because the pack goes stale while the calendar says it is fresh.
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchSite: realFetchSite, stripPackBoilerplate, writePack, readMeta, OUT_DIR, REGISTRY, MIN_CHARS } =
  require('./fetch-airline');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');

// Telegram: the same bot and the same chats ops/health/weekly-audit.js already uses, so there is one place
// to change where operational news goes. One message, sent to each admin chat.
async function sendTgReal(text) {
  const token = process.env.BINA_RIDER_BOT_TOKEN || process.env.BINASMART_TG_TOKEN || '';
  const chats = [...new Set([process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].map(c => String(c || '').trim()).filter(Boolean))];
  if (!token || !chats.length) { console.error('[travel-freshness] no bot token or admin chat configured — the note is mute'); return false; }
  let delivered = false;
  for (const chat of chats) {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }),
    }).catch(() => null);
    if (r && r.ok) delivered = true;
  }
  if (!delivered) console.error('[travel-freshness] NO DELIVERY ROUTE WORKED — the note is mute');
  return delivered;
}

async function runIngestReal() {
  const out = execFileSync('/usr/bin/node', ['--env-file=.env', 'knowledge/ingest.js', '--source', 'travel'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30 * 60 * 1000 });
  const last = out.trim().split('\n').pop();
  try { return JSON.parse(last); } catch (e) { return { raw: out.slice(-400) }; }
}

// More than half the pages moving at once is the airline changing its template, not 32 separate edits.
const MASS_CHANGE = 0.5;
const label = (rep, slug) => (rep.titles && rep.titles[slug]) ? rep.titles[slug] : slug;

// One message. Written to be read on a phone.
function noteFor(reports, { today } = {}) {
  const lines = [];
  let headline = 0;
  for (const rep of reports) {
    if (rep.refused) { lines.push('⚠️ ' + rep.name + ': could not be checked — ' + rep.refusedWhy + '. The pack was left exactly as it was.'); headline++; continue; }
    if (rep.failed) lines.push('… ' + rep.name + ': ' + rep.failed + ' page(s) did not answer this time');
    if (rep.changed.length && rep.total && rep.changed.length > rep.total * MASS_CHANGE) {
      lines.push('⚠️ ' + rep.name + ': ' + rep.changed.length + ' of ' + rep.total + ' pages changed at once — that is a site-wide template change, not ' + rep.changed.length + ' edits');
      headline++;
    } else if (rep.changed.length) {
      lines.push('✏️ ' + rep.name + ': ' + rep.changed.length + ' page(s) changed');
      for (const s of rep.changed.slice(0, 8)) lines.push('   • ' + label(rep, s));
      if (rep.changed.length > 8) lines.push('   • … and ' + (rep.changed.length - 8) + ' more');
      headline += rep.changed.length;
    }
    if (rep.added.length) {
      lines.push('➕ ' + rep.name + ': ' + rep.added.length + ' new page(s)');
      for (const s of rep.added.slice(0, 6)) lines.push('   • ' + label(rep, s));
      headline += rep.added.length;
    }
    if (rep.gone.length) {
      lines.push('🗑 ' + rep.name + ': ' + rep.gone.length + ' page(s) gone from the site');
      for (const s of rep.gone.slice(0, 6)) lines.push('   • ' + label(rep, s));
      headline += rep.gone.length;
    }
    if (rep.revived.length) lines.push('↩️ ' + rep.name + ': ' + rep.revived.length + ' page(s) are back');
    if (rep.ingest) lines.push('   re-indexed: +' + rep.ingest.inserted + ' chunks, −' + rep.ingest.deleted + ' stale');
  }
  return '✈️ Airline knowledge pack — ' + headline + ' thing(s) moved\n\n' + lines.join('\n')
    + '\n\n' + (today || new Date().toISOString().slice(0, 10)) + ' · ops/travel/freshness.js';
}

// Everything injectable, so the tests run the real decisions with no network, no database and no Telegram.
async function run({ dir = OUT_DIR, today, dryRun = false, sites, fetchSite = realFetchSite,
  sendTg = sendTgReal, runIngest = runIngestReal, log = m => console.log(m) } = {}) {
  const day = today || new Date().toISOString().slice(0, 10);
  const list = sites || JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).sites.filter(s => s.fetch !== 'manual');
  const reports = [];
  let moved = false, anyRefused = false;

  for (const site of list) {
    const { pages, failed } = await fetchSite(site, { log });
    const docs = stripPackBoilerplate(pages).filter(d => d.text.trim().length >= MIN_CHARS);
    const r = writePack(dir, docs, site, { today: day, dryRun });
    const titles = {};
    for (const d of docs) titles[d.slug] = d.title;
    const total = r.added.length + r.changed.length + r.unchanged.length;
    const rep = { site: site.id, name: site.name, total, titles, failed: failed.length,
      added: r.added || [], changed: r.changed || [], unchanged: r.unchanged || [], gone: r.gone || [],
      revived: r.revived || [], refused: !!r.refused, refusedWhy: r.refusedWhy };
    if (rep.refused) anyRefused = true;
    else if (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length) moved = true;
    log('[travel-freshness] ' + site.id + ': +' + rep.added.length + ' new, ' + rep.changed.length + ' changed, '
      + rep.unchanged.length + ' unchanged, ' + rep.gone.length + ' gone, ' + rep.failed + ' failed'
      + (rep.refused ? '  REFUSED: ' + rep.refusedWhy : '') + (dryRun ? '  [DRY RUN]' : ''));
    reports.push(rep);
  }

  const quiet = !moved && !anyRefused;
  const result = { quiet, refused: anyRefused, reports,
    added: reports.flatMap(r => r.added), changed: reports.flatMap(r => r.changed), gone: reports.flatMap(r => r.gone) };

  if (quiet) { log('[travel-freshness] nothing changed — no note sent, which is the point'); return result; }
  if (dryRun) { log('[travel-freshness] would have sent:\n' + noteFor(reports, { today: day })); return result; }

  if (moved) {
    for (const rep of reports) if (!rep.refused && (rep.added.length || rep.changed.length || rep.gone.length || rep.revived.length)) {
      try { rep.ingest = await runIngest(); } catch (e) { rep.ingest = null; log('[travel-freshness] ingest failed: ' + e.message); }
      break;   // one ingest covers the whole `travel` source, whichever site moved
    }
  }
  const note = noteFor(reports, { today: day });
  log(note);
  await sendTg(note);
  return result;
}

module.exports = { run, noteFor, sendTgReal, runIngestReal, MASS_CHANGE };
if (require.main === module) run({ dryRun: process.argv.includes('--dry-run') })
  .catch(e => { console.error('[travel-freshness] failed: ' + e.message); process.exit(1); });
```

- [ ] **Step 5: Run the test and watch it pass**

```
cd /var/www/connectcare/binasmart && node --test test/travel/freshness.test.js test/travel/pack-docs.test.js 2>&1 | tail -6
```

Expected: `# fail 0`. `pack-docs.test.js` is re-run here on purpose: the guard was added to `writePack`, and its existing tests must still hold.

- [ ] **Step 6: Whole suite**

```
cd /var/www/connectcare/binasmart && npm test 2>&1 | tail -6
```

Expected: `# pass 1351`, `# fail 0`.

- [ ] **Step 7: A real dry run against the live site — which sends nothing**

This re-fetches every page at 5 seconds apiece, so it takes about the same 14 minutes. Detached, polled.

```
cd /var/www/connectcare/binasmart && rm -f /tmp/travel-fresh.log && nohup node --env-file=.env ops/travel/freshness.js --dry-run > /tmp/travel-fresh.log 2>&1 & echo started $!
```

Poll every 90 seconds with `tail -6 /tmp/travel-fresh.log`. Expected at the end, hours after Task 5 fetched the same pages:

```
[travel-freshness] ethiopian-airlines: +0 new, 0 changed, 1xx unchanged, 0 gone, 0 failed  [DRY RUN]
[travel-freshness] ethiopian-cargo: +0 new, 0 changed, N unchanged, 0 gone, 0 failed  [DRY RUN]
[travel-freshness] nothing changed — no note sent, which is the point
```

**What must be true:** `changed` is 0 or very small. A large `changed` on the same day the pack was fetched means the hash is unstable — most likely a rotating element (a notification carousel) survived the boilerplate stripping. Find it before enabling the cron:

```
cd /var/www/connectcare/binasmart && git status --porcelain knowledge/travel/ | head
```

Expected: **no output** — a dry run must not have touched a single file.

- [ ] **Step 8: Commit**

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Weekly freshness check for the airline pack" "" "Every Sunday, an hour after the site crawl: re-fetch every page at the same" "pacing, update what changed, mark what vanished, re-ingest the travel source," "and send Ibrahim one Telegram note - only if something moved. A week in which" "the airline changed nothing sends nothing, because an alert that arrives every" "week is an alert nobody reads." "" "Two guards. A failed fetch must never look like a deleted site, so writePack" "refuses the whole gone pass when most of the pack does not come back - the same" "refusal knowledge/index.js makes before collecting orphaned chunks - and the" "refusal itself is the news, because a weekly check that fails silently leaves" "the pack stale while the calendar says it is fresh. And a site-wide template" "change is reported as one line, not fifty, because the hash is taken over the" "boilerplate-stripped text." "" "The cron line is in the file's header. It is not installed yet; the close-out" "step installs it, and the first real note is the proof." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm11.txt && git add ops/travel/freshness.js ops/travel/fetch-airline.js test/travel/freshness.test.js && git commit -F /tmp/cm11.txt && rm /tmp/cm11.txt
```

Expected: `3 files changed`.

---
### Task 12: Close-out — the numbers, the safety evals, the cron, and the report

**Files:**
- Create: `docs/superpowers/reports/2026-09-16-airline-knowledge-pack-report.md`
- Modify: the root crontab (one line)

Nothing here is optional. The pack has already changed what Bini reads, so Dr Afiya's and Asmat's numbers have to be shown unmoved, not assumed unmoved.

- [ ] **Step 1: A full ingest and the chunk count**

```
cd /var/www/connectcare/binasmart && rm -f /tmp/final-ingest.log && nohup node --env-file=.env knowledge/ingest.js > /tmp/final-ingest.log 2>&1 & echo started $!
```

Poll with `tail -3 /tmp/final-ingest.log`. Expected at the end:

```
[knowledge] ingest: xxx docs, +N chunks, -M stale, -0 orphaned, N embedded, 14xxx total
```

Then the breakdown by source:

```
cd /var/www/connectcare/binasmart && node --env-file=.env -e "const {PrismaClient}=require('@prisma/client');(async()=>{const p=new PrismaClient();const rows=await p.knowledgeChunk.findMany({select:{source:true,slug:true}});const by={};for(const r of rows)by[r.source]=(by[r.source]||0)+1;const pages={};for(const r of rows)pages[r.source]=pages[r.source]||new Set(),pages[r.source].add(r.slug);console.log('total chunks',rows.length);for(const s of Object.keys(by).sort())console.log('  '+s.padEnd(12)+String(by[s]).padStart(6)+' chunks  '+String(pages[s].size).padStart(5)+' pages');await p.\$disconnect();})()"
```

Expected: a `travel` line with roughly 100–130 pages and 1,000–2,000 chunks, and every other source at the count it had before (`total` was 12,750 on 2026-09-15). **Write the `travel` figures into the report.**

- [ ] **Step 2: Re-run all four benchmarks, one after another**

Each is a few minutes and they all call Gemini, so run them **sequentially**, not at once.

```
cd /var/www/connectcare/binasmart && rm -f /tmp/bench-all.log && nohup sh -c "node --env-file=.env ops/bini/rerun-retrieval-benchmark.js; node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold v2; node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold v3-agents; node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold travel" > /tmp/bench-all.log 2>&1 & echo started $!
```

Poll every two minutes with `grep -E "gold set|all questions|written:" /tmp/bench-all.log`. Expected, about 20 minutes later, four `written:` lines.

- [ ] **Step 3: Put the four "after" numbers next to the four "before" numbers**

```
cd /var/www/connectcare/binasmart && node -e "for (const f of ['retrieval-latest.json','retrieval-gold-v2-latest.json','retrieval-gold-v3-agents-latest.json','retrieval-gold-travel-latest.json']) { const j=require('/root/bini-eval/'+f); console.log(f,'  chunks',j.chunks); for (const t of j.table) if (/all questions|afiya|asmat|Amharic|English|am question/.test(t.name)) console.log('   '+t.name.padEnd(36)+String(t.n).padStart(4)+String(t.plain).padStart(9)+String(t.shipped).padStart(9)); }"
```

Compare against the baseline recorded in Task 0:

| gold set | before (retrieval / shipped) | after |
| --- | --- | --- |
| v1 | 76.3% / 77.2% | must be within ±0.9 points, or explained |
| v2 | 95.6% / 92.1% | must be within ±0.9 points, or explained |
| v3 all | 96.4% / 98.2% | must be within ±0.9 points, or explained |
| v3 afiya | 96.3% / 96.3% | **must be identical** — Afiya excludes `travel`, so the pack cannot reach her |
| v3 asmat | 96.5% / 100.0% | **must be identical** — Asmat excludes `travel` |
| travel | — | ≥ 90.0% shipped |

**If Afiya's or Asmat's numbers moved at all, stop.** The exclusion is not working, and a health agent quoting an airline's pregnancy page is exactly the outcome the exclusion exists to prevent. Check `agents/afiya/rules.js` and `agents/asmat/rules.js` really contain `'travel'` in `exclude`.

**If v1 or v2 moved by more than about one point,** name the questions that flipped before accepting it:

```
cd /var/www/connectcare/binasmart && node -e "const a=require('/root/bini-eval/retrieval-gold-v2-latest.json').rows;const b=require('/root/bini-eval/retrieval-gold-v2-20260915-073631.json').rows;const m=Object.fromEntries(b.map(r=>[r.qid,r]));for(const r of a) if(m[r.qid] && m[r.qid].shipped!==r.shipped) console.log((r.shipped?'GAINED ':'LOST   ')+r.qid,'want',r.slug,'got',r.top.join(', '));"
```

A travel page displacing a guide on a travel-ish v2 question is a legitimate change — say which question and why in the report. A travel page winning a question about tax is a bug.

- [ ] **Step 4: The safety evals, 32 of 32 each**

These call the live service and are the existing scripts; they already contain the emergency cases and are the only place an emergency message is ever sent.

```
cd /var/www/connectcare/binasmart && node --env-file=.env ops/health/afiya-eval.js 2>&1 | tail -14
```

Expected: `Dr Afiya check · 32/32 clean` and `replies containing a dosage: 0 (must be 0)`.

```
cd /var/www/connectcare/binasmart && node --env-file=.env ops/law/asmat-eval.js 2>&1 | tail -14
```

Expected: `32/32 clean` with no flagged cases.

**Anything below 32/32 stops the close-out.**

- [ ] **Step 5: Ten real Bini answers to travel questions**

Through the live API with the evaluation header, so nothing lands in the ordinary conversation records. Never an emergency message.

Slice block 8 of this task to `/tmp/bini-travel-sample.js` and run `node /tmp/bini-travel-sample.js`, then delete it.

```javascript
// Ten travel questions through the live Bini route, with the evaluation header. Paced 4 s, the Gemini pacing
// this repo keeps for evaluations. Prints the reply and whether a bina.et or ethiopianairlines.com source was
// cited, because an answer with no source is the failure the pack exists to prevent.
const QS = [
  'በኢኮኖሚ ክፍል ስንት ኪሎ ሻንጣ ነፃ ይፈቀድልኛል?',
  'ከእጄ ጋር የምይዘው ሻንጣ ስንት ኪሎ መሆን አለበት?',
  'ውሻዬን ይዤ በአውሮፕላን መጓዝ እችላለሁ?',
  'ኦንላይን ቼክ ኢን መቼ ነው የሚከፈተው?',
  'ትኬቴን መመለስ ብፈልግ ገንዘቤ እንዴት ይመለስልኛል?',
  'በአዲስ አበባ ትራንዚት ስሆን ስንት ሰዓት መቆየት እችላለሁ?',
  'how much checked baggage do I get in economy on Ethiopian Airlines?',
  'when does online check-in close?',
  'what is the minimum connecting time at Addis Ababa?',
  'how do I join ShebaMiles?',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const q of QS) {
    const r = await fetch('http://127.0.0.1:4210/api/bini', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-binasmart-eval': '1' }, body: JSON.stringify({ message: q }) });
    const j = await r.json().catch(() => ({}));
    const reply = String(j.reply || j.error || '');
    console.log('\nQ: ' + q);
    console.log('A: ' + reply.replace(/\s+/g, ' ').slice(0, 420));
    console.log('   source cited: ' + (/ethiopianairlines\.com|bina\.et/.test(reply) ? 'yes' : 'NO'));
    await sleep(4000);
  }
})();
```

Read all ten. **What must be true:** every figure quoted appears in the matching file under `knowledge/travel/`; grep for it. An answer that states a kilo or a fee with no source, or one that is not in the pack, means the model is speaking from memory and the close-out stops.

```
cd /var/www/connectcare/binasmart && grep -l "23 kg" knowledge/travel/*.md && grep -o "2 pieces 23kg each\|2 pieces of 23 kg" knowledge/travel/baggage-information-free-baggage-allowance.md | head -3
```

- [ ] **Step 6: Install the cron line**

Sunday 05:00 UTC — one hour after `knowledge/crawl.js` at 04:00, so the two never fetch at the same time.

```
crontab -l > /tmp/crontab.bak-travel-$(date +%Y%m%d-%H%M%S) && cp /tmp/crontab.bak-travel-* /root/ && ls -la /root/crontab.bak-travel-*
```

```
(crontab -l; echo "# Ethiopian Airlines knowledge pack freshness check - Sunday 05:00 UTC (08:00 Addis), one hour after knowledge/crawl.js. Telegrams Ibrahim only when a page changed or vanished. Added 2026-09-16."; echo "0 5 * * 0 cd /var/www/connectcare/binasmart && /usr/bin/node --env-file=.env ops/travel/freshness.js >> /var/log/bina-travel-freshness.log 2>&1") | crontab - && crontab -l | tail -4
```

Expected: the last four lines show the comment and the new job.

**This is the only place the freshness note becomes real.** It sends nothing now. The first real note arrives on a Sunday when the airline has actually changed a page, and that note is the proof that this piece works.

- [ ] **Step 7: The service is healthy**

```
pm2 describe binasmart-api | grep -E "status|restarts" && curl -s http://127.0.0.1:4210/health | head -c 400 && echo && pm2 logs binasmart-api --err --lines 30 --nostream | tail -20
```

Expected: `status online`, the health JSON with a `knowledge` chunk count matching Step 1, and no new errors.

- [ ] **Step 8: Write the report**

```
mkdir -p /var/www/connectcare/binasmart/docs/superpowers/reports
```

Write `docs/superpowers/reports/2026-09-16-airline-knowledge-pack-report.md` with, and only with, what was measured:

1. **The pack** — pages fetched per site, pages refused and why, chunks added, total corpus before and after.
2. **What the site is really like** — 228 sitemap URLs all under `/et/`, no Amharic locale (`/am/` is Armenia and soft-404s at HTTP 200), the sitemap missing ShebaMiles, Ethiopian Holidays, the Skylight packages, the e-visa page and car rental, and the mega-menu that had to be stripped across the corpus.
3. **The gold set** — 60 questions, the per-section table, 40 of 60 cross-lingual, Page@3 retrieval and as-shipped, plus any question moved in Task 10 and why.
4. **The other benchmarks** — v1, v2 and v3 before and after, with every flipped question named.
5. **Safety** — Afiya 32/32, Asmat 32/32, and the confirmation their v3 slices did not move.
6. **The ten sampled answers** — the questions, whether a source was cited, and where each figure came from.
7. **What is not covered** — the Ethiopian Civil Aviation Authority (unreachable from this server; a human in Ethiopia must save the passenger-rights pages), the ShebaMiles member portal (an account site), and anything the airline renders only in JavaScript.
8. **The freshness check** — the cron line, and the plain statement that no note has been sent yet and the first real one is the proof.

- [ ] **Step 9: Commit the report and the plan**

```
cd /var/www/connectcare/binasmart && printf '%s\n' "Airline knowledge pack: the close-out numbers" "" "Chunks, the four benchmark runs before and after, the two safety evals at 32 of" "32 each, ten sampled Bini answers with the file each figure came from, and what" "the pack does not cover." "" "Afiya's and Asmat's v3 slices are unchanged, which is what the travel exclusion" "was for." "" "The freshness cron is installed and has sent nothing. The first real note is the" "proof, and it arrives on a Sunday when the airline changes a page." "" "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" > /tmp/cm12.txt && git add docs/superpowers/reports/2026-09-16-airline-knowledge-pack-report.md docs/superpowers/plans/2026-09-16-airline-knowledge-pack.md && git commit -F /tmp/cm12.txt && rm /tmp/cm12.txt
```

- [ ] **Step 10: Clean up**

```
rm -f /tmp/travel-*.js /tmp/patch-*.js /tmp/bini-travel-sample.js /tmp/cm*.txt && ls /tmp/*.js 2>/dev/null | head
```

Leave `/tmp/extract_plan.py` and the `.log` files. Leave the `.bak-travel-*` backups in the repo — they are the rollback and the repo is full of them by convention. They are untracked, so they were never committed.

---

## Self-review

**Spec coverage.** Checked against the design (`docs/superpowers/specs/2026-09-16-airline-travel-design.md`) §1 and §2, and against the five parts of a sector pack:

| requirement | where |
| --- | --- |
| §1.1 source list naming source, language, change rate, publisher | Task 1 — `knowledge/travel/sources.json` |
| §1.2 knowledge files with source URL, download date, last-checked date; figures kept as written; nothing from memory | Tasks 3, 4, 5 — front matter `url/fetchedAt/lastChecked/contentHash`; the header carries no figure and a test enforces it |
| §1.2 bilingual header naming the key facts | Task 4 — English and Amharic provenance lines with the section name; the "key facts" are the page's own text, because inventing a summary is writing from memory |
| §1.3 60 questions, 40 am / 20 en, each with its page, ≥ 90% Page@3 | Tasks 9 and 10 |
| §1.4 weekly re-read, changed text updates, Telegram note, vanished page marked and unused | Tasks 11 and 12 — `status: "gone"` plus the loader skip in Task 6 |
| §2 sources: baggage, fares and rules, changes/refunds, special assistance, pets, medical, documents and visas, transit and hub, ShebaMiles, lounges, check-in, cargo, Ethiopian Holidays, Skylight | Task 1 allowlist and `sections`; ShebaMiles, Holidays and Skylight arrive through the link discovery in Task 5 because the sitemap omits them; cargo is its own site entry |
| §2 Civil Aviation Authority passenger rights | Task 1 — `fetch: "manual"`, unreachable from this server, with the reason |
| §2 the bina.et airport guide as a reference, not re-crawled | Task 1 `references`, and `page:airport` in `PREFER` in Task 7 |
| §2 Amharic pages where they exist, English otherwise | Measured: none exist. Task 1 records it and every document says so |
| §2 never in `knowledge/web/`, curated like law and health | Task 6 |
| §2 Bini prefers it; Afiya and Asmat exclude it | Task 7 |
| §2 gold questions become a benchmark file like v3 | Tasks 8 and 9 |
| §7 the 60 questions run automatically, with a source on every answer | Tasks 10 and 12 |

No gaps found. The demo agent of §1.5 is Piece 4 and is deliberately out of scope.

**Placeholder scan.** Every code step carries the code. Every command carries its expected output. Three places ask the executor to exercise judgement rather than follow a script — Task 10 Step 3 (what to do about a miss), Task 12 Step 3 (explaining a moved benchmark number) and Task 12 Step 8 (the report) — and each names the allowed responses, the forbidden ones, and the stop conditions. The one literal fill-in is the `<fill in>` percentage in the optional Task 10 commit message, which is a number that does not exist until the run happens. No "TBD", no "add error handling", no "similar to Task N".

**Type and name consistency.** `selectUrls` returns `{ url, path, section, sectionTitleAm }`; `fetchSite` adds `siteId`, `title`, `text`; `assignSlugs` adds `slug`; `stripPackBoilerplate` takes and returns that same shape; `writePack` reads `slug`, `text`, `title`, `url`, `section`, `sectionTitleAm`. `writePack` returns `{ added, changed, unchanged, gone, revived }` in Task 4 and gains `refused`/`refusedWhy` in Task 11, which Task 11's `noteFor` and Task 5's `main` both read. `readMeta`/`frontMatter` share the `FM_KEYS` list, and `knowledge/index.js` parses those same lines with its existing regex — `status`, `fetchedAt`, `lastChecked`, `contentHash`, `firstFetched`, `goneAt`, `generated_by` are all single `\w+` keys, which is what that regex requires. `assistant/travel.js` exports `isTravelQuestion` and `PREFER`; both names are used by `server.js`, by `test/travel/bini-travel-prefer.test.js` and by `ops/travel/build-gold-travel.js`. The benchmark's `searchOptionsFor`, `goldPath`, `goldTag`, `normalizeGold` and `goldKeys` keep their existing signatures.

**One thing to watch during execution.** Task 4's `stripPackBoilerplate` needs at least four pages of a site before it removes anything (`minPages: 4`). The cargo site may yield fewer than four usable pages, in which case its documents keep their navigation and are probably below the 400-character floor anyway, so they simply do not appear. That is the right outcome and needs no code — but if cargo produces exactly four or five thin documents full of menu text, drop the site to `fetch: "manual"` in `sources.json` rather than letting menu text into the index.

---

## What this plan does not build

Pieces 2, 3 and 4 of the design are separate plans and nothing here anticipates them:

- **Piece 2 — the Bini travel helper.** Check-in deep links with the booking code and surname filled in, ShebaMiles links, flight status and "my booking" links, and a pre-trip checklist built from this pack for a route. It needs the pack, which is why it comes after.
- **Piece 3 — booking and paying.** The issuer interface (`search`, `hold`, `issue`, `cancel`, `status`), the IATA agency in Addis, telebirr and Chapa, the international provider for the diaspora, the fee line, the encrypted passenger record and its 30-day deletion. Ibrahim has to supply the agency, the provider account, the Chapa live keys and the fee per route type before any of it can be built.
- **Piece 4 — the demo page.** The Afiya/Asmat chat front-end with a travel configuration, a private link, the "BinaSmart demo — not an official Ethiopian Airlines service" label on every screen, and a source link on every answer. It is what Ibrahim shows the airline.

And one thing no plan can build: the **Ethiopian Civil Aviation Authority passenger-rights pages**. The server cannot reach `ecaa.gov.et`, the way it cannot reach most Ethiopian government hosts. Somebody inside Ethiopia has to save those pages; until then the pack has no regulator text and Bini must not imply that it does.
