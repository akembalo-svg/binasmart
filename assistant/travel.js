'use strict';
// Is this message about flying? The one question that decides whether Bini's retrieval is pointed at the
// Ethiopian Airlines pack (knowledge/travel, source `travel`).
//
// The three-tier test moved to assistant/intent.js when the banking pack was built on the same idea; the
// words are unchanged and so is every answer this file gives. See assistant/intent.js for why it is asked
// per message rather than declared once on an agent.
//
// The collision this has to survive is our own. BinaSmart sells airport transfers, hotel rooms and rides:
// "ወደ ቦሌ አየር ማረፊያ ታክሲ ስንት ነው?" names an airport twice over and is a ride question, and
// "ሆቴል ውስጥ ቼክ ኢን ስንት ሰዓት ነው?" is a hotel question that says check-in.
const { makeIntent } = require('./intent');

// Only aviation says these. One is enough, and it beats the other-service guard.
const HARD = [
  'በረራ', 'አውሮፕላን', 'አየር መንገድ', 'ሻንጣ', 'ሸባማይልስ',
  'flight', 'flights', 'flying', 'airline', 'airlines', 'aircraft', 'aeroplane', 'airplane',
  'baggage', 'luggage', 'carry-on', 'carry on', 'hand luggage', 'checked bag', 'excess baggage',
  'boarding pass', 'e-ticket', 'eticket', 'layover', 'stopover', 'shebamiles', 'sheba miles',
  'cloud nine', 'seat map', 'in-flight', 'inflight', 'unaccompanied minor', 'medif',
];
// Another BinaSmart service owns the question, unless a HARD word says otherwise.
const OTHER_SERVICE = [
  'ታክሲ', 'ጋራ ጉዞ', 'ሾፌር', 'መኪና', 'ሆቴል', 'ሲኒማ', 'ፊልም', 'ሆስፒታል', 'ክሊኒክ', 'ጨረታ', 'ግብር', 'ንግድ ፈቃድ', 'ኪራይ',
  'taxi', 'ride', 'rides', 'pool', 'driver', 'car rental', 'hotel', 'cinema', 'film', 'movie',
  'hospital', 'clinic', 'tender', 'vat', 'tax', 'business licence', 'business license', 'rent', 'transfer',
];
// Aviation words that other things also use. One decides it, once no other service has claimed the message.
const STRONG = [
  'ቼክ ኢን', 'የመሳፈሪያ', 'የበረራ ቁጥር', 'ተሳፋሪ',
  'check-in', 'check in', 'boarding', 'booking code', 'booking reference', 'itinerary', 'cabin crew',
];
// Two distinct ones of these, and the message is about flying.
const WEAK = [
  'አየር ማረፊያ', 'ቦሌ', 'ቪዛ', 'ፓስፖርት', 'ትኬት', 'ማይል', 'ላውንጅ', 'ትራንዚት', 'ኢኮኖሚ', 'መነሳት', 'መድረሻ',
  'airport', 'bole', 'transit', 'connecting', 'miles', 'lounge', 'visa', 'passport', 'ticket',
  'departure', 'arrival', 'economy class', 'business class', 'refund',
];

const isTravelQuestion = makeIntent({ hard: HARD, otherService: OTHER_SERVICE, strong: STRONG, weak: WEAK });

// What Bini prefers on a travel question: the airline pack, plus BinaSmart's own travel pages — the Bole
// airport guide the design names as a reference (source `page`, slug `airport`) and the two travel landing
// pages. Nothing else gets the tie-breaker while this is in force.
const PREFER = ['travel', 'page:airport', 'page:flights', 'page:travel'];

module.exports = { isTravelQuestion, PREFER, HARD, OTHER_SERVICE, STRONG, WEAK };
