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
