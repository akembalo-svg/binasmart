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

## 11. Open points for Ibrahim

1. **Voice goes to Google for transcription**, as Telegram voice notes already do. Accept for the web pages too?
2. **Follow-up questions don't remember earlier turns in v1** (§3). Acceptable for the first version?
3. **Avatars:** simple illustrated faces (a woman health guide, a man legal guide) or symbols only (stethoscope, scales)?
