# Dr Afiya and Asmat as chat apps — design

**Date:** 14 September 2026 · **Status:** direction approved by Ibrahim from the mockup ("nice"); this document awaits his review
**Pages:** `bina.et/afiya` (health-system guide) and `bina.et/asmat` (legal-procedure guide). Both run on the agent engine (`assistant/kit/engine.js`, `agents/afiya/rules.js`, `agents/asmat/rules.js`).

---

## 0. What changes and what does not

The two pages become chat apps: an avatar and name at the top, conversation bubbles, reply cards, suggestion cards on an empty screen, one input bar with voice and a language switch, and a list of past chats kept on the person's own phone. The feel is borrowed from modern assistant apps (a messaging app rather than a form); the design, illustrations and wording are BinaSmart's own — no other product's logo, avatar or trade dress.

**Nothing about the safety rules changes.** Emergencies are still answered by code before any model (Afiya: 907/991/939; Asmat: arrests and evictions), doses and verdicts are still removed, the disclosure still closes every answer, the demo hospital is still disclosed. The page only presents what the engine returns.

**Ibrahim's addition:** the same chat must be reusable for companies — a hospital can have its own health guide and a law firm its own legal guide. v1 builds BinaSmart's two pages in a way that makes a company version a configuration, not a rewrite (§6). Company versions themselves are a later plan.

---

## 1. Layout (mobile first; centred column on desktop, max width ~720px)

1. **Header:** menu button (opens past chats) · avatar · name and one-line role ("Health system guide · not a doctor" / "Legal procedure guide · not a lawyer") · **+** new chat.
2. **Empty screen:** large avatar, greeting in the page language ("ሰላም፣ ዶ/ር አፍያ ነኝ" / "ሰላም፣ አስማት ነኝ"), one line on what it helps with, **four suggestion cards** (tap = send), and "Your chats stay on this phone".
3. **Conversation:** the person's message as a right-aligned bubble; the reply as a **card**:
   - the answer text (markdown bold stripped as today; line breaks kept);
   - **source line** — "From: <title>" linking to the guide, law or page the answer drew on (see §3);
   - **safety strip:**
     - Afiya, emergency reply → a large red card with **tap-to-call 907** (and the other numbers), shown above the text;
     - Asmat, urgent reply → an amber card with the urgent guidance and the numbers the reply contains;
     - redirect reply (off-subject) → a small card with the link to Bini or the other agent;
   - **disclosure** as a quiet grey strip at the bottom of the card, separate from the answer.
   - Up to three **follow-up chips** under the latest reply (fixed per topic in v1, e.g. "What to bring?", "Opening hours", "Insurance"; Asmat: "Which office?", "Documents needed", "Template"). Tapping sends that text as a new question.
4. **Input bar (bottom, sticky):** language switch `አማ · EN · OM` · text box with a real example as placeholder · **microphone** button (becomes send when there is text).
5. **Waiting state:** a typing indicator in the reply position; the send and mic buttons stay usable-looking but ignore taps while a reply is pending.
6. **Errors:** "Couldn't get an answer. Try again." with a retry chip; Afiya's error text always includes 907.

Colours: Afiya teal, Asmat deep blue, on BinaSmart's light site style (`site-v3.css`, existing fonts). Avatars: original illustrations (Afiya with a stethoscope, Asmat with scales), SVG, both themes readable.

## 2. Language

- The switch sets the page language for the greeting, suggestions, placeholder, chips and fixed texts, and is remembered per device (`localStorage`).
- The engine keeps detecting the language from the message itself (as today). The switch does not override what the person actually writes.
- Afaan Oromoo fixed texts: use only the Oromo strings the agents already carry (disclosures, emergency replies); new UI strings in Oromo need a native speaker — until then the Oromo switch shows English UI text with Oromo answers.

## 3. What the page needs from the server

- **Unchanged:** `POST /api/afiya` and `POST /api/asmat` with `{ message, user: { uid } }`, returning `reply`, `emergency`, `ambulance`, `urgent`, `redirected`.
- **New, additive:** `sources: [{ title, url }]` (at most 2) — the knowledge documents the answer's context came from, so the card can show "From: …". Added in the engine from the context it already retrieves; only public knowledge URLs (guides, laws, pages, news, crawled official sites), never internal data. Agents without knowledge (the owner agent) return none.
- **Conversation memory:** v1 sends each question on its own, exactly as the engine works today. The chat looks continuous, but a follow-up like "and for adults?" is answered without the earlier turns. The follow-up chips are written as complete questions for that reason. Sending recent turns to the engine is a separate, later change (it touches the safety gates' inputs and needs its own tests).

## 4. Voice

- Browser recording (`MediaRecorder`, max 60 seconds, visible timer, tap to stop) → a **new public route** `POST /api/assistant/voice` that transcribes and returns `{ text }`. The existing `/api/assistant/transcribe` requires the owner key and stays private to the Telegram bot.
- The public route: rate-limited per IP (e.g. 10 per 10 minutes) and per `uid`, body limit ~1.5 MB, audio types from the browser only, audio never written to disk or logged, transcript returned to the page and then sent as a normal question (so every safety gate applies to spoken questions exactly as to typed ones).
- The transcript is shown in the person's bubble before sending, with a small "edit" affordance; an unclear transcription shows "I couldn't hear that. Type it or try again."
- Transcription uses the same Gemini path as Telegram voice notes today (audio goes to Google to be transcribed — the existing practice for Bini voice; stated here so it is a known decision).

## 5. Past chats (on the phone only)

- Stored in `localStorage` under the page's key: up to 20 chats × 40 messages, newest first, each with a title from the first question (truncated). No server copy.
- Menu → list of chats (tap to open, swipe or button to delete), "Delete all chats".
- Wrapped in try/catch: private browsing or blocked storage simply means no history, never a broken page.
- Opening an old chat shows it read-only-looking with the input ready for a new question (because the engine has no memory of it, per §3).

## 6. Built to be reusable for companies

One shared chat front-end (`public/static/agent-chat.js` + `agent-chat.css`) driven by a small config object embedded in each page:

```js
{ agent: 'afiya', api: '/api/afiya', name: { am: 'ዶ/ር አፍያ', en: 'Dr Afiya' }, role: { am: '…', en: 'Health system guide · not a doctor' },
  color: 'teal', avatar: '/static/agents/afiya.svg', suggestions: { am: [...4], en: [...4] }, chips: { am: [...], en: [...] },
  emergency: { numbers: ['907', '991', '939'] }, storageKey: 'bina_chat_afiya' }
```

`afiya.html` and `asmat.html` become thin pages (SEO head, config, the shared script). A company version later is a new config plus a scoped agent on the server (e.g. a hospital's own departments and hours) — the same pattern as the owner agent's scope. Company versions, their routes, branding and data are **not** in v1.

## 7. Search engines and first paint

- Keep each page's current title, description, canonical and structured data; keep the existing explanatory text below the chat (collapsed under "About Dr Afiya / About Asmat") so search engines and first-time visitors still see what it is and its limits.
- The empty screen renders without JavaScript (greeting and suggestions as plain links to `?q=…`); the script enhances it.

## 8. Accessibility and performance

- Real buttons with labels (menu, new chat, mic, send, call), visible focus, 44px touch targets, messages announced with `aria-live="polite"`, emergency card with `role="alert"`.
- No framework; the shared script and CSS under ~25 KB together; avatars as small SVGs; bump `?v=` on every asset change.

## 9. Testing

- **Engine:** `sources` is returned (≤2, public URLs only, deduplicated) for Afiya and Asmat and absent for the owner agent; the Plan 1 equivalence tests still pass (reply text and flags unchanged).
- **Voice route:** rate limits, size limit, missing audio → 400, transcription failure → clean error; never logs audio or transcript; a spoken emergency goes through the same gate (tested by sending the transcript through the route's documented flow with the model faked).
- **Front-end (pure functions tested in `node:test`, lifted like the market-pages tests):** reply → card model (emergency, urgent, redirect, sources, disclosure separation); history storage (limits, corrupt JSON, blocked storage); language switch persistence; text is always inserted as text (no HTML injection from replies).
- **Live checks without paging anyone:** off-topic and ordinary questions with `x-binasmart-eval: 1`; never an emergency sent to the live routes; voice route checked with a short silent recording for the error path.
- **Visual:** screenshots of both pages at mobile and desktop widths in light and dark system themes before release.

## 10. Not in v1

Conversation memory in the engine; company-branded versions and their routes; Oromo UI strings beyond what exists; answer feedback buttons; sharing a chat.

## 11. Decisions (Ibrahim, 14 September 2026: "do your recommend")

1. **Voice:** accepted — transcription through the same Gemini path as Telegram voice notes.
2. **Conversation memory:** not in v1; follow-up chips are complete questions. Memory is a later change.
3. **Avatars:** original illustrated faces — a woman health guide (Afiya) and a man legal guide (Asmat), drawn for BinaSmart, friendly and professional, no resemblance to any existing product's mascot or to real people.
4. **Plans:** free plan plus a paid plan for people, and paid branded versions for companies (§12). Everything is open during launch.

## 12. Plans: free, paid, and company versions

**The fixed rule:** emergency and urgent answers are free forever and never counted against any limit. They are answered by code (Afiya's 907/991/939 reply, Asmat's arrest/eviction reply), cost nothing to serve, and no one in an emergency ever sees a limit or a payment screen. Redirects to other services are not counted either.

| Plan | Who | What | When |
|---|---|---|---|
| **Launch** | everyone | Everything open: unlimited questions, voice, history on the phone | From v1 until Ibrahim ends the launch period |
| **Free** | people | A daily number of questions (set by Ibrahim; suggested starting point 10 per day), text answers, history on the phone; emergencies unlimited | After launch |
| **Plus** (paid) | people | Many more questions per day, voice, chat history saved to the account across devices, longer answers, priority when busy | After launch, once payments are live |
| **Company** (paid) | hospitals, law firms, clinics | Their own branded guide (name, avatar, colours, suggestions) with their own data in scope — e.g. a hospital's real departments, hours and fees — on bina.et and in Telegram | Separate plan, after the pages ship |

Prices in birr, set by Ibrahim. Plan names and numbers above are placeholders until he sets them.

**Phases (each its own plan):**
1. **v1 — the chat pages (this design).** No limits enforced, no paywall. Usage is already recorded per anonymous user in `AssistantLog` (with evaluation traffic excluded), which gives real numbers for choosing the free daily limit. The front-end keeps a slot for a future "questions left today" line and an upgrade card, hidden in v1.
2. **v2 — accounts and limits.** Needs working sign-in on bina.et (Telegram and Google doors exist; still waiting on the BotFather domain setting and Google OAuth keys from Ibrahim). Count questions per account per day (anonymous visitors counted per device with a lower limit), exclude emergency/urgent/redirect answers from the count, show "questions left today", and a clear upgrade card when the limit is reached — never mid-emergency.
3. **v3 — payments.** Needs a live payment provider (Chapa is in test mode; telebirr needs BinaSmart's own merchant key). Subscription purchase, renewal, cancellation, receipts, and what happens when a payment fails (fall back to Free, never lose the person's chats on their phone).
4. **Company versions.** A company config plus a scoped agent on the server (§6), onboarding with proven ownership, and billing per company.

**Honesty rules for paid plans:** the paid plan buys more use and convenience, never better safety — the same gates, disclosures and figure checks apply on every plan; the page never implies a paid answer is medical or legal advice.
