'use strict';
// Must Bini's FIRST round call a tool before it may answer? (server.js, /api/assistant)
//
// Gemini Flash answers a price, a BinaPool corridor or "remember me" out of its own head often enough that
// some intents have to reach a tool first. But `tool_choice: required` only says "call SOMETHING", and the
// one priced tool Bini owns is quote_ride — a fixed BinaRide fare between two points in Addis Ababa. So every
// message carrying a price word had a taxi fare forced onto it, whoever the money belonged to.
//
// Measured 2026-09-17, §15d of docs/superpowers/reports/2026-09-17-banking-manual-sources.md:
// "ቴሌብር 1,000 ብር ለመላክ ስንት ያስከፍላል?" — what does telebirr charge to send 1,000 birr — forced quote_ride,
// which has nothing to say about a wallet tariff; the answer came back without its date and the error log
// said `forced intent called no tool`.
//
// So a price word on its own no longer forces anything. A bank charges, an airline charges and a taxi
// charges; forcing is for the BinaSmart thing that actually has a tool behind it. Three gates, in order:
//
//   1. A non-price intent still forces, exactly as before: remember, BinaPool, a tender, the cinema
//      programme, a ride status, TV/radio, or a shop. Those words name their own tool.
//   2. A banking, travel or business question never forces. Those are answered from a pack
//      (knowledge/banking, knowledge/travel, knowledge/business) with the institution or the office and the
//      date of the page — not from a tool, and never from a fare. An office charges for a licence the way a
//      bank charges for a transfer. The same three tests that point retrieval at the pack, so the two can
//      never disagree.
//   3. A price word forces only when the same message also carries a ride cue — a vehicle, a driver, a
//      pickup or a destination. quote_ride needs two points inside Addis; with no such word in the message
//      there is nothing for it to quote, and forcing can only produce the wrong tool or none.
//
// Deliberately message-only: no history, no model, no clock. A bare "ስንት ነው?" after a route was named in
// an earlier turn is no longer forced — the model still has the route and the tool, and a missed nudge is
// cheaper than a taxi fare quoted at someone asking about their bank.
const banking = require('./banking');
const travel = require('./travel');
const business = require('./business');

// A price word. Lifted verbatim from the old FORCE_TOOL_RE in server.js; on its own it now decides nothing.
const PRICE_RE = /(ስንት ብር|ስንት ነው|ስንት ይሆናል|ስንት ያስከፍላል|ስንት ያወጣል|ስንት ይከፈላል|ምን ያህል ነው|ምን ያህል ይሆናል|ስንት ነበር|ዋጋ|how much|fare|price|cost|gatii|meeqa)/i;

// Every other forced intent, unchanged: remember, pool, tender, cinema, ride status, BinaWatch, shops.
// One repair while moving it: `ክፈት` (open — as in "open Sheger radio") is anchored to the start of a word,
// because as a bare substring it also sits inside `ለመክፈት` and `መክፈት`, which is how "የባንክ ሂሳብ ለመክፈት ስንት
// ያስከፍላል?" — what does it cost to OPEN a bank account — was a forced media request.
const OTHER_FORCE_RE = /(remember|አስታውስ|አስታውሰኝ|yaadadh|መቀመጫ|ጋራ ጉዞ|\bpool\b|imala waliinii|tender|ጨረታ|caalbaasii|cinema|ሲኒማ|film|ፊልም|showing|የት ደረሰ|ride status|my ride|where is (the|my) (car|driver)|radio|ራዲዮ|ራድዮ|\btv\b|ቲቪ|ቴሌቪዥን|channel|ቻናል|series|ድራማ|ተከታታይ|watch|listen|open the|play the|raadiyoo|televizhinii|(^|\s)ክፈት|ምግብ ቤት|ሬስቶራንት|ካፌ|ቡና ቤት|ፋርማሲ|መድኃኒት ቤት|ሳሎን|ጂም|ክሊኒክ|የት ልብላ|የት እንብላ|restaurant|where (can i |to )?eat|pharmacy|cafe\b|coffee shop|gym\b|salon\b|recommend a place)/i;

// A ride cue: what quote_ride would need to have anything to answer. A vehicle, a driver, a pickup, or a
// destination — `ወደ` (to) and `from … to` carry most real ride questions. A bare `ከ` (from) is deliberately
// absent: it is a letter inside ordinary words, ያስከፍላል among them.
const RIDE_CUE_RE = /(ታክሲ|ባጃጅ|ሞተር ሳይክል|መኪና|ሾፌር|ጉዞ|መነሻ|መድረሻ|አየር ማረፊያ|ወደ|takisii|baajaajii|konkolaataa|konkolaachisaa|gara |\btaxi\b|\bcab\b|\brides?\b|\blift\b|bajaj|\bmoto\b|driver|pick ?up|pick me|drop ?-?off|airport|\bfrom\b.+\bto\b)/i;

// shouldForceTool(msg) -> boolean. The whole decision, in the order the comment above sets out.
function shouldForceTool(msg) {
  const s = String(msg == null ? '' : msg);
  if (!s.trim()) return false;
  if (OTHER_FORCE_RE.test(s)) return true;
  if (!PRICE_RE.test(s)) return false;
  if (banking.isBankingQuestion(s) || travel.isTravelQuestion(s) || business.isBusinessQuestion(s)) return false;
  return RIDE_CUE_RE.test(s);
}

module.exports = { shouldForceTool, PRICE_RE, OTHER_FORCE_RE, RIDE_CUE_RE };
