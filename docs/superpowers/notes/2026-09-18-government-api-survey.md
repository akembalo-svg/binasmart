# What already exists for a public Ethiopia knowledge API for government offices

**Survey date:** 2026-09-18 · **Host:** `root@31.97.176.180` · **Repo:** `/var/www/connectcare/binasmart` (branch working tree, uncommitted changes present)
**Scope:** inventory only. Nothing was changed, committed, restarted or fetched from outside the VPS. Every number below was read live from the server: the database, the health endpoints, the pm2 log files and the eval logs in `/root/bini-eval/`.

The question this answers: if Ibrahim offers an Ethiopian government website an API or a plugin that answers its visitors' questions in Amharic from our curated knowledge, **what is already built, and what is not.**

---

## 1. The knowledge surface today

### 1.1 How retrieval works

The index is one table, `KnowledgeChunk` (`prisma/schema.prisma:1146–1164`), held in RAM by the API process: one row per ~900-character chunk with 120 characters of overlap (`knowledge/index.js:14`), a Gemini 768-d embedding in `embedding` (`knowledge/index.js:11–12`, model `gemini-embedding-001`) and an optional BGE-M3 1024-d vector in `embeddingLocal`. No pgvector; the cosine is computed in a JavaScript loop over the in-memory matrix (`knowledge/index.js:958`).

The pipeline for one question, in order:

| Step | Where | What it does |
|---|---|---|
| `contextFor(message, …)` | `knowledge/index.js:1035` | The only entry point an agent uses. Returns an empty block for greetings and one-word messages, so a "hello" is never padded. |
| `contextSearchOptions` | `knowledge/index.js:538` | Fixes the retrieval shape: fetch `min(k*3, 18)` candidates, always exclude the voice corpora, rerank down to `k` (default `k=6`). |
| `search(q, …)` | `knowledge/index.js:914` | Hybrid: cosine + `0.15 × keyword overlap`, `+0.06` tie-break for own sources. At most 2 chunks per page. |
| `hybridScore` | `knowledge/index.js:505` | The scoring formula. `OWN_SOURCES` (`:500`) = guide, page, addis, skill, llms, docs. An agent that declares `knowledge.prefer` moves that boost onto its own sources instead. |
| `pageMatcher` | `knowledge/index.js:519` | Parses `prefer`/`exclude` entries: a whole source (`health`), one page (`guide:mesob`), or a prefix (`web:moh/*`). |
| `embedQuery` | `knowledge/index.js:859` | Gemini query embedding (768-d). Falls back to BGE-M3 (1024-d) **only** when Gemini was asked and threw. The two vector spaces are never mixed. |
| `rerank` | `knowledge/index.js:821` | One `gemini-2.5-flash` call (`:803`) that reorders candidates by "does this answer the question". Fail-open, 6 s timeout, cached. |
| the rerank gate | `knowledge/index.js:818`, applied at `:1023` | Rerank runs **only** when the top two *pages* are within `RERANK_GAP = 0.03`. Measured: fires on 31 of 114 gold questions, keeps 5 of 6 improvements and 1 of 4 regressions, 73 % fewer calls. |
| `sourceLine` | `knowledge/index.js:604` | Prints one `Source: <publisher> — <url> — fetched YYYY-MM-DD (checked …)` line per page, read from the document's front matter on disk at context-build time (`docMeta`, `:581`). Amharic label `ምንጭ፦` at `:601`. This is the attribution the answer is supposed to speak. |
| `readSources` | `knowledge/index.js:251` | Builds the corpus from disk. Curated packs (`PACK_SOURCES`, `:564`) are read **whole**; `knowledge/web/*` is truncated at 20,000 chars (`:335`) and boilerplate-stripped, spam-filtered and advertorial-filtered (`:329–333`). |
| `curatedHosts` | `knowledge/index.js:196` | Any host a curated pack registry claims is refused to the crawler and dropped from the `web` source, so a curated page and its crawled twin cannot both be served. |

The local fallback embedder is `bina-embed` (pm2, FastAPI, `127.0.0.1:3031`, `knowledge/index.js:387–415`, `makeLocalEmbedder` at `:396`). It is BGE-M3, 1024-d. Measured on gold v3 (comment at `:383`): Page@3 **96.4 % Gemini, 85.6 % BGE-M3, 59.5 % keyword-only**.

Bilingual query rendering (`knowledge/index.js:430–490`, `renderOther` at `:890`) exists but is **off in production**: the flag defaults to `0` (`:462`) and the live log shows `bilingual` zero times and `bilingualFused: 0` in `/api/knowledge/health`.

### 1.2 The sources, with live counts

Read from `KnowledgeChunk` on 2026-09-18. "Docs" = distinct slugs; "Gemini vec" / "BGE vec" = chunks carrying each embedding.

| Source | Docs | Chunks | Gemini vec | BGE vec | Langs | Curated & dated? |
|---|---:|---:|---:|---:|---|---|
| `banking` | 506 | 7,830 | 7,830 | 3,891 | am/en | **Curated**, fetched by `ops/packs/fetch-pack.js`, front matter carries `fetchedAt`/`lastChecked` |
| `law` | 135 | 4,446 | 4,446 | 3,612 | am/en/om | **Curated by hand**, indexed whole (a statute is never truncated) |
| `web` | 494 | 2,886 | 2,886 | 2,886 | am/en/om | **Crawled third-party pages**, truncated at 20,000 chars, boilerplate-stripped |
| `health` | 22 | 2,132 | 2,132 | 2,132 | am/en/om | **Curated by hand** |
| `business` | 113 | 1,680 | 1,680 | **0** | am/en | **Curated** (`ops/packs/fetch-pack.js --pack business`) |
| `travel` | 114 | 1,436 | 1,436 | 1,436 | en | **Curated**, Ethiopian Airlines pages; `status: "gone"` drops a removed page (`knowledge/index.js:300`) |
| `news` | 115 | 1,206 | 1,206 | 1,149 | am/en | BinaSmart's own articles, from the `posts` table (`readNewsSources`, `:164`) |
| `eservices` | 52 | 1,120 | 1,120 | 1,120 | am/en/om | **Curated**, generated by `ops/knowledge/eservices-to-md.js` — one document per government office |
| `guide` | 25 | 340 | 340 | 340 | am | Our own HTML guide pages, HTML-to-text, capped at 30,000 chars |
| `page` | 21 | 204 | 204 | 171 | am | Our own service pages |
| `style` | 1 | 75 | 75 | 75 | am | **Internal** — Amharic voice examples, never served publicly |
| `mor` | 2 | 55 | 55 | 55 | am/en | **Curated**, Ministry of Revenue FAQs/forms, `ops/mor/mor-to-md.js` |
| `skill` | 1 | 16 | 16 | 16 | en | **Internal** — the system skill |
| `llms` | 1 | 13 | 13 | 13 | en | `public/llms.txt` |
| `addis` | 1 | 11 | 11 | 11 | en | Addis Ababa notes |
| `style-om` | 1 | 9 | 9 | 9 | om | **Internal** — Afaan Oromoo voice examples |
| `docs` | 1 | 4 | 4 | 4 | en | `mcp-server/docs.md` |
| **TOTAL** | **1,605** | **23,463** | **23,463** | **16,920** | | |

Notes that matter for a government offering:

- **Every chunk has a Gemini vector. 6,543 chunks (28 %) have no local vector** — and `business` (1,680 chunks, the licence/permit/TIN pack, i.e. exactly the government-counter material) has **zero**. If Gemini's embedding call fails, the business pack degrades to keyword-only.
- `eservices` is already **one markdown document per government office** — 52 offices, listed in `knowledge/eservices/` (Ministry of Revenues, Immigration and Citizenship Service, DARS, EFDA, Ethiopian Investment Commission, MoFA, MoJ, MoLS, ECA, Customs Commission, NBE, ethio telecom, EAES, the city administrations, and so on). This is the closest thing we have to a government product already.
- `web` (494 documents, 2,886 chunks) is **crawled third-party content**. Serving it through a paid or branded API is re-serving someone else's pages. See §6.
- Language: `law`, `health`, `eservices` and `mor` carry Amharic; `travel` is English-only (the airline publishes no Amharic locale); `banking` is mixed and only Zemen publishes a real Amharic locale.

---

## 2. Existing public doors

| Endpoint | Where | Auth | Rate limit | CORS | Who calls it |
|---|---|---|---|---|---|
| `GET /api/knowledge/search` | `knowledge/routes.js:14–23` | **None.** An `x-owner-key` / `?key=` only *widens* it: without the owner key `isPublic` is forced true and the internal `skill`/`style` chunks are withheld (`:20`) | 60 requests / minute / IP, in-process `Map` (`:6`), keyed on `x-real-ip` | `origin: true` — reflects **any** origin (`server.js:33`) | Public. Documented in `public/llms.txt:49`. Also the MCP `search_knowledge` tool, over loopback |
| `GET /api/knowledge/health` | `knowledge/routes.js:24` | **None** | none | any | monitoring; it leaks corpus size and per-path counters |
| `POST /api/knowledge/reload` | `knowledge/routes.js:25` | `OWNER_KEY` | none | any | ops |
| `POST /api/knowledge/reindex` | `knowledge/routes.js:26–30` | `OWNER_KEY` | none | any | ops |
| `POST /mcp` (→ `https://bina.et/mcp`) | `mcp-server/server.mjs:64–76`, nginx `bina.et.conf:20–28`, pm2 `bina-mcp` on `127.0.0.1:3021` | **None** | 30 tool calls / minute per caller key; `request_ride` additionally 10 / hour (`server.mjs:49–51`, `lib/limiter.mjs`). Caller key = `Mcp-Session-Id` header, else `X-Real-IP` — **client-chosen, so trivially rotated** | `Access-Control-Allow-Origin: *` (`server.mjs:56`) | Any MCP client; registered publicly (`.well-known/mcp-registry-auth`, `.well-known/openai-apps-challenge` in nginx `:10–18`) |
| `GET /mcp` | `mcp-server/server.mjs:80–83` | none | none | `*` | serves `mcp-server/docs.md` as markdown to browsers/crawlers |
| `GET /mcp/health` | `mcp-server/server.mjs:85–91` | none | none | `*` | monitoring |
| `POST /api/assistant` (Bini) | `server.js:1028` | **None** | 25 messages / 10 minutes per IP, in-process `Map` (`server.js:1035`); over the limit it returns a polite WhatsApp deflection, not a 429 | any | `bina.et` chat, Telegram bridge |
| `POST /api/afiya` | `server.js:1238` | **None** | `makeAgentLimit` (`assistant/kit/limit.js:11`): **30 questions/hour per uid, 150/hour per X-Real-IP** (`server.js:1229`). Loopback with no `X-Real-IP` is exempt (`limit.js:16`) so the eval harness is never counted | any | `public/afiya.html` |
| `POST /api/asmat` | `server.js:1232` | **None** | same limiter, shared counters with Afiya | any | `public/asmat.html` |
| `POST /api/assistant/voice` | `server.js:1213` | none | own ip/uid limiter (`server.js:1212`) | any | the chat widget's mic |
| `POST /api/assistant/transcribe` | `server.js:1200–1201` | `OWNER_KEY` | none | any | ops |
| `GET /api/assistant/misses` | `server.js:1240–1241` | `OWNER_KEY` | none | any | weekly review |

**The only credential in the system is one shared `OWNER_KEY`** (`server.js:142`, default `'change-me'` if unset). There is no per-consumer API key, no key issuance, no key rotation, no per-key quota and no per-key accounting anywhere in the codebase.

**`x-binasmart-eval: 1`** (`server.js:1013`) is an opt-in header a harness sets. It is honoured by `biniMemory.userKey(…, { evaluation })` so eval traffic does not pollute per-user memory, and it is passed into the agent engine. **It is unauthenticated** — any caller can set it.

**nginx** (`/etc/nginx/sites-enabled/bina.et.conf`): `/mcp` → `127.0.0.1:3021`, everything else → `127.0.0.1:4210`. **There is no `limit_req_zone`, no `limit_conn` and no auth at the nginx layer for bina.et at all.** (By contrast `telesign.site.conf:17–28` does define rate-limit zones — so the pattern exists on this box, just not here.) `client_max_body_size 8m`. Security headers are set in the app's `onSend` hook (`server.js:6–24`), including `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://*.telegram.org` — so **bina.et pages cannot be iframed by a third-party site today**, though scripts served from `/static/` can be included anywhere.

**What is already publicly documented:**
- `public/llms.txt:48` — the MCP server and its tool list.
- `public/llms.txt:49` — *"[Knowledge search](https://bina.et/api/knowledge/search?q=Megenagna): JSON passages with source urls, same index Bini uses"*. This endpoint is, today, an advertised open public API.
- `mcp-server/docs.md` (32 lines), served at `GET https://bina.et/mcp`.
- `public/robots.txt` disallows `/api/` and `/owner/` for crawlers — which affects indexing, not access.

---

## 3. What an embedding site would need — and how close we already are

There **is** an embeddable chat, and it is already config-driven rather than hard-coded.

- `public/agent-chat-core.js` (10.1 KB) — shared primitives.
- `public/agent-chat.js` (17.1 KB) — the widget. It mounts into `#agent-chat` and reads its entire configuration from a JSON `<script id="agent-chat-config">` block (`public/agent-chat.js:7`).
- `public/agent-chat.css` (9.2 KB).
- `public/afiya.html`, `public/asmat.html` — the two live chat pages.

A page wires itself to an agent with four things (`public/afiya.html:17`, `:20–76`, `:79`, `:128–129`):

1. `<link rel="stylesheet" href="/static/agent-chat.css?v=1">`
2. a JSON config block declaring `agent`, **`api` (`/api/afiya`)**, `voiceApi`, `storageKey`, `avatar`, and — fully translated into am/en/om — `name`, `role`, `greeting`, `intro`, `placeholder`, `banner`, `suggestions`, `chips`, `disclosure`, `emergency` numbers and every UI string
3. `<div id="agent-chat" class="ac">` with its server-rendered skeleton
4. `<script src="/static/agent-chat-core.js">` and `<script src="/static/agent-chat.js">`

The widget POSTs `{ message, user: { uid } }` to `cfg.api` (`public/agent-chat.js:220–221`), where `uid` is a per-device value from `localStorage` (`:44`). Conversations are stored **on the device only** (`storageKey`); the UI says so ("Your chats stay on this phone").

So a third-party government page would need: our CSS, our two scripts, a config block, one div — and permission to POST cross-origin to `bina.et`. The CORS setting (`origin: true`, `server.js:33`) already permits that from any origin. **What it does not have is a way for us to know which site is calling, or to bill/limit/revoke it**, because `uid` is client-chosen and there is no key.

Nothing in the widget is branded-agnostic yet: the avatar, the name and the disclosure all come from config, but the assets are served from `bina.et/static/` and the emergency numbers and disclosures are Ethiopian-health/legal specific per page.

---

## 4. Safety and attribution machinery that must ride along

The agent engine runs a fixed order (`assistant/kit/engine.js:7`):

> gates → scope → limit → prompt → model (+ tool rounds) → retry → filters → grounding → finish → log / audit

Nothing below is optional; an API sold to a ministry inherits all of it or inherits none of the guarantees.

| Machinery | Where | What it does |
|---|---|---|
| **Grounding guard** | `assistant/grounding.js:116` (`dropUngrounded`), detector at `:58` | A figure with a unit (money / distance / percent, always; duration / count above 24) may only appear in an answer if those digits appear in the retrieved documents, the tool results or the user's own question. Otherwise **the sentence carrying it is dropped**. Added `YEAR` at `:33` — a bare four-digit year is a claim too, and document numbers like `1360/2025` are excluded so the rule does not lean on them. |
| **Ethiopian-calendar marker fix** | `assistant/grounding.js:103` (`fixCalendarMarker`), regex `:93` | Rewrites a `ዓ.ም.` marker the context never put there to `(እ.ኤ.አ.)`. Measured failure: a Gregorian fetch date `2026-09-16` labelled as an Ethiopian year reads as seven years in the future. |
| **Tidy filter** | `assistant/tidy.js:11` (`tidyAnswer`) | Strips the context's `[1]` bracket numbers, any `Source: …` / `ምንጭ፦ …` line the model copied, and bare trailing URL lines. Reference furniture only — never a sentence, a figure or a link the answer itself offers. |
| **Refusal guard inside `stripIntro`** | `assistant/tidy.js:27` (`REFUSAL_MARKER`), applied at `:71`, plus the negation rule at `:50`/`:75` | A self-introduction is removed once — **unless** it declines, warns, or sends the reader to a professional, or carries the only negation in the reply. Added 2026-09-18 after Afiya's safety eval fell 31/32 → 26/32 with the refuse bucket at 5/11: the openers being stripped *were the refusals*. |
| **Afiya's dosage filter** | `assistant/afiya.js:126` (`stripDosage`), pattern `:125`; wired at `agents/afiya/rules.js:76` | Drops any sentence containing mg/ml/mcg/g/IU, a tablet/capsule/ክኒን count, or "twice a day" / `በቀን N ጊዜ`. The eval asserts **0 replies containing a dosage**. |
| **Asmat's verdict filter** | `assistant/asmat.js:135` (`stripVerdict`), pattern `:134`; wired at `agents/asmat/rules.js:92` | Drops any sentence promising an outcome ("you will win", "the court will rule", `ታሸንፋለህ`, `ፍርድ ቤቱ ይወስንልዎታል`). |
| **Emergency gate (before the model)** | `server.js:1052` for Bini; the agents' own gates | `afiya.isEmergency` answers with the ambulance number without calling any model at all, and triggers handover. Decided after measuring Bini missing chest-pain-with-no-breathing and "I want to kill myself" on 2026-09-12. |
| **Per-agent source rules** | `agents/afiya/rules.js:23–31`, `agents/asmat/rules.js:27–43` | Afiya **prefers** `health`, `web:moh/*`, the labour proclamation, `addis`, EFDA; **excludes** `page`, `skill`, `llms`, `mor`, `travel`, `banking`, `business` and the business guides. Asmat **prefers** `law`, `guide`, `eservices`, `mor`, `news:law-*`, `web:justice/*`; **excludes** `page`, `skill`, `llms`, `travel`, `banking`, `business`. Both lists come from a 120-question gap audit on 2026-09-14 (Afiya was being handed the business licence checker for "is this clinic licensed?"). The `business` exclusion on Asmat is measured: 84.2 % → 86.0 % retrieval. |
| **Money guardrail text** | `assistant/banking.js:96–130` (`GUARDRAILS`), `PREFER` at `:83`, detector `isBankingQuestion` | Appended to the prompt for money questions. Contains the rule **"EVERY FIGURE YOU STATE CARRIES ITS DATE IN THE SAME SENTENCE"** (`:114`) — which is why `sourceLine` exists at all. |
| **Business/licence guardrail text** | `assistant/business.js:89–126` (`GUARDRAILS`), `PREFER` at `:81` | Same shape for office-procedure questions. The design line, stated at `:10`: *a tax **procedure** at an office is this pack's; the text of a tax **rule** is law's.* |
| **Scope** | `assistant/scope.js`, enforced at `assistant/kit/engine.js:53–54` | What an agent may read is set by the route's own authentication only — **never** from `c.user` or the request body, both of which are attacker-controlled. |
| **Politics refusal** | `assistant/politics.js`, called in `/api/assistant` | Politics is declined as a subject, not merely as an opinion. |
| **Source attribution to the reader** | `assistant/kit/sources.js:27` (`sourcesFrom`), returned at `engine.js:175–179` | The reply carries a `sources` array parsed from the numbered context headers; the widget shows it as "From: / ምንጭ፦". |

### Safety evals (in `/root/bini-eval/`, last run 2026-09-17 23:00–23:02)

| Eval | Script | Buckets scored | Latest score |
|---|---|---|---|
| Dr Afiya check | `afiya-fix-run3.log` → `/root/afiya-eval.json` | emergency, urgent, refuse, answer, redirect; plus a hard assertion of **zero dosages** | **32/32 clean** (emergency 9/9, urgent 1/1, refuse 11/11, answer 9/9, redirect 2/2; dosages 0) |
| Asmat check | `asmat-fix-run2.log` → `/root/asmat-eval.json` | urgent, emergency, assess, template, refuse, answer, redirect; plus "every figure traceable to a document" | **31/32 clean** — one failure: `[others-told-me]` (expected refuse, got answer); two untraced figures in `[predict-en]`: "15 days, 7 days" |
| Bini automatic rubric | `ops/bini/checks.js` | deterministic: emoji, Ethiopic, self-introduction, **self-attribution to an AI vendor** (`SELF_VENDOR`, `:15–22` — Bini once said "built by Google"), Oromo leakage, unknown `/paths`, and birr figures checked against figures actually published on our own pages (`publishedFigures`, `:41`) | run weekly; transcript read by Ibrahim for what a regex cannot judge |
| Retrieval gold sets | `ops/bini/rerank-eval.js`, `rerank-gate.js`, `build-gold-v2.js`, `rerun-retrieval-benchmark.js`, `ops/packs/build-gold.js` | Page@k on 114- and 90-question gold sets | the 0.03 rerank gate and the +6.7-point Amharic-header result come from these |
| Government coverage probe | `ops/bini/gov-sector-probe.js` (2026-09-17) | **no gold pages** — deliberately: it lists the top pages the shipped search returns per citizen question so a reviewer can find sectors where the corpus has *nothing* | the directly relevant prior art for this project |

---

## 5. Cost and capacity

### Where an external call is made per answered question

| Call | Model | When |
|---|---|---|
| Query embedding | `gemini-embedding-001`, 768-d (`knowledge/index.js:368`) | once per distinct question string; cached in-process, 500 entries (`:875`). 2.5 s timeout. |
| Rerank | `gemini-2.5-flash` (`knowledge/index.js:803`, `:833`) | only when the top two pages are within 0.03. Live counters below say ~54 % of reranked-eligible searches actually call it. 6 s timeout, fail-open, cached 300 entries. |
| Generation | **`gemini-2.5-flash`** via the OpenAI-compatible path in `callBini` (`server.js:833`, primary = `BINI_API_BASE`/`BINI_API_MODEL`; README.md:50 and :70 name the model), thinking explicitly off (`server.js:841`) | once per reply, plus up to 5 tool rounds (`server.js:865`), plus up to 2 retry calls (`server.js:1159`, `:1170`, `:1178`). 30 s timeout. |
| Fallback generation | local GLM, Anthropic-compatible, `http://127.0.0.1:4000` (`server.js:908`) — **on this VPS, no tools on that path** | only when the cloud call throws |
| Bilingual query rendering | `gemini-2.5-flash`, 1.5 s timeout (`knowledge/index.js:430–431`) | **disabled in production** (flag default `0` at `:462`; live counters all zero) |
| Voice transcription | `gemini-2.5-flash` inline audio (`assistant/transcribe.js`) | only on `/api/assistant/voice` |

**So: a typical answered question = 1 Gemini embedding + ~0.25–0.5 Gemini flash rerank + 1 Gemini flash generation.** Roughly **2 to 3 Gemini calls per question**, all of them to Google.

### Pacing rules in code

- Document embedding: 100 texts per batch, **4 s sleep between batches**, 6 attempts with the server's own `retryDelay` honoured up to 70 s (`knowledge/index.js:352–367`). The comment records 429s at ~3k chunks/min.
- Local BGE ingest: 10 chunks per call, 3 s pause, **hard stop at 300 chunks per run** (`knowledge/index.js:394`), because the CPU is shared with ~40 apps and the host throttles (comment at `:390–393`: 0.41 chunks/s, steal up to 19 %). Anything left over waits for the next run or is embedded on the laptop and imported (`ops/knowledge/local-embed-export.js` / `local-embed-import.js`).
- The index is reloaded from the DB every 10 minutes without a restart (`server.js:915`).

### Measured token cost per question

From `/root/bini-eval/token-cost-20260913-231721.txt` (the library was 8,510 chunks then; `contextFor`'s `k` has not changed since):

- **average retrieved context: 1,531 tokens per question** (2,053 / 1,592 / 948 for an Amharic passport-fee question, an Amharic lease-registration question and an Oromo health question).
- Amharic costs **1.85 chars per token** versus 3.55 for English — an Amharic answer is ~1.9× the tokens of the same English sentence.
- The reranker, when it fires, costs a further ~3,650 tokens and a median 464 ms (comment at `knowledge/index.js:807–813`).

### Live counters (`GET /api/knowledge/health`, 42 minutes after the last restart)

```
chunks 23463 · embedded 23463 · embeddedLocal 16920 · gemini true · localFallback true
searches 103 · embedOk 40 · embedErr 1 · keywordOnly 0
rerankOk 26 · rerankErr 1 · rerankSkipped 22
localOk 1 · localErr 0 · localUsed 1
bilingual* all 0
```

Since the last log rotation the pm2 log shows **631 `query embed: gemini`** lines against **1 `local`** and **0 `keyword`**. Gemini is not a fallback — it is the load-bearing path.

### The local embedder, honestly

`bina-embed` health: `{"model":"BAAI/bge-m3","dim":1024,"loaded":true,"requests":1101,"texts":6755,"avg_ms":10918.4,"uptime_s":491938,"threads":2}`.

**Average 10.9 seconds per request on 2 threads.** The query timeout is 3,000 ms (`knowledge/index.js:389`). It can therefore serve the *ingest* (batched, patient, capped at 300/run) but it cannot reliably serve a *live query* — which is exactly why the fallback fired once in 631 searches. It also **cannot generate an answer at all**; it is an embedder, not a language model. There is no local generation path other than the GLM shim on `127.0.0.1:4000`, whose quality is untested against the safety evals.

### VPS shape

- **4 vCPU, 15.99 GB RAM** (7.6 GB used, 8.4 GB available), load average **0.73 / 0.65 / 1.00**, up 9 days.
- **One VPS, no redundancy, no second region, no failover.**
- **40 pm2 processes** share it. BinaSmart's are `binasmart-api`, `bina-mcp`, `bina-embed`, `bina-uploader`. The other 36 are GCC Domestic, Tadbeer, Telesign, n8n, WhatsApp bridges, autoposters and watchers — an unrelated business on the same 4 cores.
- `binasmart-api` shows **115 restarts**; `bina-mcp` 2; the rest 0 over 5 days.
- The host throttles under sustained load (CPU steal up to 19 %, recorded in `knowledge/index.js:390`).

---

## 6. What would block a government office from using it today

Unsentimental list. Each item is a thing that does not exist, not a thing that needs polishing.

1. **There are no API keys.** The only credential in the system is one shared `OWNER_KEY` (`server.js:142`), and it is an *admin* key — it widens access rather than scoping it. `/api/knowledge/search`, `/mcp`, `/api/assistant`, `/api/afiya` and `/api/asmat` are all completely unauthenticated. We cannot tell one caller from another, cannot revoke one, and cannot give a ministry a credential it could put in a procurement document.

2. **There is no usage accounting.** Nothing counts calls per consumer. The rate limiters are in-process `Map`s (`knowledge/routes.js:6`, `server.js:1035`, `mcp-server/lib/limiter.mjs`) keyed on an IP or a client-supplied `Mcp-Session-Id`; they reset on every restart — and `binasmart-api` restarted 115 times in 5 days. `AssistantLog` (4,357 rows) records Bini turns for the weekly review, not billable usage. There is no invoice, no quota, no overage, no dashboard an office could be shown.

3. **The limits we do have are trivially bypassed and do not degrade gracefully.** 60/min per IP on knowledge search, 30/min per *self-chosen session id* on MCP, 25 per 10 min per IP on `/api/assistant`. An office behind one NAT address shares a single bucket; Ethio Telecom already puts many phones behind one address, which is why the per-IP agent limit is 150/hour (`server.js:1229`). There is **no nginx-layer rate limiting for bina.et at all** — the zones exist elsewhere on this box (`telesign.site.conf:17`) but not here. Over the limit, `/api/assistant` returns a chatty WhatsApp deflection rather than a 429 a client could handle.

4. **There are no terms for this.** `public/terms.html` mentions **api / mcp / third-party / developer zero times**. There is no developer agreement, no acceptable-use policy, no liability cap, no indemnity, no data-processing agreement, no service description. A government office cannot sign what does not exist.

5. **There is no SLA and nothing to base one on.** No uptime measurement, no error budget, no status page, no incident process, no support channel other than a WhatsApp number in a fallback string. `/api/knowledge/health` and `/mcp/health` exist but nothing consumes them into a published number.

6. **Single VPS, no redundancy.** 4 vCPU and 16 GB shared with 36 unrelated processes, on a host that visibly steals CPU. One machine, one region, one nginx, one Postgres, one process per service. A restart of `binasmart-api` drops the in-RAM index, the query cache, the rerank cache and every rate-limit counter. There is no failover and no read replica. A ministry's front page pointing at this is a single point of failure they do not control.

7. **Gemini dependency — and it directly contradicts the standing rule.** Ibrahim's rule is *BinaSmart data never leaves the VPS: no external AI or voice APIs.* Gemini is already the exception, twice over: **every query embedding** (`knowledge/index.js:368`) and **every generated answer** (`gemini-2.5-flash` via `callBini`, `server.js:833`, README.md:50) go to Google, a US company — plus the reranker and voice transcription. Live evidence: 631 Gemini query embeds against 1 local fallback. Today that exception is our own choice about our own users. **The moment a government office routes its citizens' questions through this, we are sending Ethiopian citizens' questions to a US company on behalf of an Ethiopian ministry, and saying so out loud is unavoidable.** The local alternative does not close the gap: `bina-embed` averages 10.9 s per request against a 3 s query timeout, `business` (1,680 chunks) has no local vectors at all, and there is **no local generation model** in the stack that has passed the safety evals — only an untested GLM shim on `127.0.0.1:4000`. Either we get an explicit, written exception from the office, or we build a local answer path first. Pretending the tension is not there is the one option that is not available.

8. **Data protection is unaddressed for a third party.** `public/privacy.html` mentions Gemini exactly once and is written for bina.et's own visitors, not for a ministry's visitors. Questions arrive with a client-chosen `uid` and are written to `AssistantLog` with the full message and the full reply (`prisma/schema.prisma:1131–1143`) — that is citizen text at rest on our disk, with no retention policy, no deletion path, no residency guarantee and no controller/processor split. The chat widget stores transcripts in the visitor's own `localStorage` (`public/agent-chat.js:44`), which is fine for us and not obviously fine under a government's own rules.

9. **`knowledge/web/*` is crawled third-party content we would be re-serving.** 494 documents, 2,886 chunks, truncated to 20,000 characters each (`knowledge/index.js:335`), with only spam and advertorial filters (`:329–331`) between the crawler and the index. We have no licence from those publishers. `curatedHosts` (`:196`) removes the *duplicates* of hosts our packs own — it says nothing about permission. Serving `web` through a branded government API is redistribution; it needs either a per-source licence review or a hard exclusion of `web` from any government-facing route.

10. **Licence questions on the curated packs too.** `law` is statute text (generally reproducible), but `travel` is Ethiopian Airlines' own pages, `banking` is 506 documents scraped from banks, the Capital Market Authority and EthSwitch, `eservices` and `mor` are government portal content, and `news` is ours. Each family needs a stated basis before it is resold. There is no licence field in the front matter and no per-source attribution policy beyond the `Source:` line.

11. **No versioning, no contract, no deprecation policy on the response shape.** `/api/knowledge/search` returns `{ ok, q, results }` with no version in the path or a header, and its behaviour changes whenever `hybridScore`, the prefer/exclude lists or the reranker gate move — which they have, repeatedly, and for good reasons. A caller building a citizen-facing page on it has nothing stable to build against.

12. **CORS is wide open and is doing no work.** `origin: true` on the API (`server.js:33`) and `Access-Control-Allow-Origin: *` on MCP (`mcp-server/server.mjs:56`) mean anybody can already embed our answers on any page. That is convenient for a pilot and useless as a control: we cannot restrict a partner to their own domain, and we cannot tell a partner's traffic from a scraper's.

13. **The safety machinery is per-agent, not per-tenant.** The dosage filter, the verdict filter, the prefer/exclude lists and the disclosures live in `agents/afiya/rules.js` and `agents/asmat/rules.js` — files in the repo, deployed with the code. There is no way for a third office to get its own agent, its own scope, its own refusals or its own disclosure without a code change and a deploy. A government-office agent would today be a fourth hard-coded agent.

14. **The chat widget is close but not white-labellable.** It is fully config-driven (`public/agent-chat.js:7`; `public/afiya.html:20–76`), which is the hard part already done — but the assets are served from `bina.et/static/`, the config is inline in our own HTML rather than fetched per tenant, the CSP forbids framing bina.et pages elsewhere (`server.js:13`), and there is no build that a ministry's webmaster could drop in and point at their own `api` without us editing a file.

15. **One open eval failure and two untraced figures.** Asmat is at 31/32: `[others-told-me]` answers where it should refuse, and `[predict-en]` states "15 days, 7 days" with no document behind them. Afiya is clean at 32/32. Before anything is sold, Asmat's refusal bucket is the one to close — an office's visitors asking a legal question is precisely the case that failure describes.

---

## What is missing before an outside office can call this — numbered

1. Per-consumer **API keys**: issuance, storage, rotation, revocation, and a key that *scopes down* rather than the current admin key that scopes up.
2. **Usage accounting** per key, durable across restarts (the current counters are in-process `Map`s that reset — 115 restarts in 5 days), with a figure an office and an invoice can both read.
3. **Real rate limiting**, at nginx as well as in-process, per key rather than per IP, returning proper `429` with `Retry-After` instead of a chat-style deflection.
4. **Terms of use for the API** — developer agreement, acceptable use, liability, and a data-processing agreement. `terms.html` currently contains none of these words.
5. **An SLA, and the measurement behind it**: uptime target, error budget, a status page, an incident and escalation path, a named support channel.
6. **Redundancy**: at minimum a second process and a second machine, a restart that does not drop the whole in-RAM index, and a plan for the shared-CPU host that steals up to 19 %.
7. **A written decision on Gemini.** Either an explicit exception from the office covering embeddings *and* generation going to a US company, or a local answer path — which means a local generation model that passes the Afiya and Asmat evals, plus closing the local-embedding gaps (`business` has 0 of 1,680 local vectors; `bina-embed` averages 10.9 s against a 3 s timeout).
8. **A data-protection position for someone else's citizens**: retention and deletion for `AssistantLog`, residency, a controller/processor split, and a privacy notice written for the office's visitors rather than ours.
9. **A licence review per source**, and a hard exclusion of `knowledge/web/*` (494 crawled third-party documents) from any government-facing route until each host is cleared. Add a licence field to front matter so this is checkable rather than remembered.
10. **A versioned, contracted response shape** (`/api/v1/…`), with a deprecation policy, so a ministry's page does not change behaviour when the reranker gate or a prefer list moves.
11. **A tenant model**: per-office agent definitions (scope, prefer/exclude, refusals, disclosure, emergency numbers) as data rather than as files in `agents/`, so a new office does not require a code deploy.
12. **A white-label widget build**: versioned assets on a path meant for embedding, a per-tenant config fetched by key instead of inlined in our HTML, and a documented snippet a government webmaster can paste.
13. **Origin binding** — tie a key to the domains allowed to use it, replacing today's `origin: true` / `Access-Control-Allow-Origin: *`.
14. **Close Asmat's open refusal failure** (`[others-told-me]`) and the two untraced figures in `[predict-en]`, and add a government-office eval bucket built from `ops/bini/gov-sector-probe.js`, which already exists for exactly this purpose.
15. **Amharic coverage proof per office**, question by question: `eservices` is 52 offices and 1,120 chunks, but `travel` is English-only and `banking` is mostly English, and the measured cross-lingual gap is 86.2 % same-language against 43.8 % when only an English page answers an Amharic question. Bilingual query rendering, which was built to attack this, is **off** in production.

---

## Things that surprised me

- **`/api/knowledge/search` is already a public, unauthenticated, advertised API.** `public/llms.txt:49` invites the world to call it. The "should we offer an API" question is partly retrospective: we already do, we just get nothing back and control nothing.
- **The `business` pack has zero local embeddings** — 1,680 chunks, the licence/TIN/permit material that a government-office product would lean on hardest, with no fallback vector at all.
- **`bina-embed` averages 10.9 seconds per request against a 3-second query timeout.** The "own model" fallback is real for ingest and effectively unavailable for live queries.
- **`eservices` is already one document per government office** — 52 of them, generated, dated and Amharic-capable. The product's corpus largely exists.
- **The chat widget is already fully config-driven**, including every UI string in three languages. White-labelling is a packaging problem, not a rewrite.
- **The MCP caller key is whatever the client puts in `Mcp-Session-Id`** (`mcp-server/server.mjs:65`), so its 30-calls-per-minute limit is honour-system.
- **`terms.html` does not contain the word "API".**
- **`x-binasmart-eval: 1` is unauthenticated** — any caller can mark their traffic as evaluation traffic.
- **36 of the 40 pm2 processes on this VPS are not BinaSmart.** A ministry would be depending on a box that mostly runs a UAE recruitment business.
