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
// One narrow exception since 30 Sep 2026, isRideFollowUp below: a short message that is only a tier ("and with
// bajaj?") right after a ride-price question. The previous question must itself pass gate 3.
const banking = require('./banking');
const travel = require('./travel');
const business = require('./business');

// A price word. Lifted verbatim from the old FORCE_TOOL_RE in server.js; on its own it now decides nothing.
const PRICE_RE = /(ስንት ብር|ስንት ነው|ስንት ይሆናል|ስንት ያስከፍላል|ስንት ያወጣል|ስንት ይከፈላል|ምን ያህል ነው|ምን ያህል ይሆናል|ስንት ነበር|ዋጋ|how much|fare|price|cost|gatii|meeqa)/i;

// Every other forced intent, unchanged: remember, pool, tender, cinema, ride status, BinaWatch, shops.
// One repair while moving it: `ክፈት` (open — as in "open Sheger radio") is anchored to the start of a word,
// because as a bare substring it also sits inside `ለመክፈት` and `መክፈት`, which is how "የባንክ ሂሳብ ለመክፈት ስንት
// ያስከፍላል?" — what does it cost to OPEN a bank account — was a forced media request.
const OTHER_FORCE_RE = /(remember|አስታውስ|አስታውሰኝ|yaadadh|መቀመጫ|ጋራ ጉዞ|\bpool\b|imala waliinii|tender|ጨረታ|auction|ሐራጅ|ሃራጅ|caalbaasii|cinema|ሲኒማ|film|ፊልም|showing|የት ደረሰ|ride status|my ride|where is (the|my) (car|driver)|radio|ራዲዮ|ራድዮ|\btv\b|ቲቪ|ቴሌቪዥን|channel|ቻናል|series|ድራማ|ተከታታይ|watch|listen|open the|play the|raadiyoo|televizhinii|(^|\s)ክፈት|ምግብ ቤት|ሬስቶራንት|ካፌ|ቡና ቤት|ፋርማሲ|መድኃኒት ቤት|ሳሎን|ጂም|ክሊኒክ|የት ልብላ|የት እንብላ|restaurant|where (can i |to )?eat|pharmacy|cafe\b|coffee shop|gym\b|salon\b|recommend a place)/i;

// A ride cue: what quote_ride would need to have anything to answer. A vehicle, a driver, a pickup, or a
// destination — `ወደ` (to) and `from … to` carry most real ride questions. A bare `ከ` (from) is deliberately
// absent: it is a letter inside ordinary words, ያስከፍላል among them.
// `ራይድ` (ride, as Amharic writers spell it) added 30 Sep 2026: "ከቦሌ ፒያሳ ራይድ ስንት ነው?" was not forced.
const RIDE_CUE_RE = /(ራይድ|ታክሲ|ባጃጅ|ሞተር ሳይክል|መኪና|ሾፌር|ጉዞ|መነሻ|መድረሻ|አየር ማረፊያ|ወደ|takisii|baajaajii|konkolaataa|konkolaachisaa|gara |\btaxi\b|\bcab\b|\brides?\b|\blift\b|bajaj|\bmoto\b|driver|pick ?up|pick me|drop ?-?off|airport|\bfrom\b.+\bto\b)/i;

// shouldForceTool(msg) -> boolean. The whole decision, in the order the comment above sets out.
// Looking for a home, land or a shop to buy or rent -> search_properties (the live /property listings).
// A car to rent is not a property: BinaSmart's cars have no tool here, so those never force.
const PROPERTY_RE = /(\bapartments?\b|\bcondo(minium)?s?\b|\bvillas?\b|\breal ?estate\b|\bpropert(y|ies)\b|\b(house|home|flat|studio|office|shop|land)s? (for|to) (rent|sale|buy)\b|\b(rent|buy|renting|buying) (a |an )?(house|home|flat|studio|apartment|place|office|shop|land)\b|\bbed ?rooms?\b|ኪራይ|የሚከራይ|ለመከራየት|የሚሸጥ ቤት|አፓርታማ|አፓርት|ኮንዶ|ቪላ|መኖሪያ ቤት|ሪል ?እስቴት|ባለ \d+ መኝታ|መኝታ ቤት)/i;
// Wanting to BUY a car (or its price) -> search_cars. "መኪና"/"car" is also a ride cue, so only a real trip cue
// (to/from a place, ወደ, taxi, driver) keeps it a ride; "car to Bole price" is a fare, "used Toyota for sale" is a car.
const BRAND = '(toyota|suzuki|hyundai|kia|nissan|byd|honda|volkswagen|vw|mitsubishi|isuzu|ford|mercedes|bmw|chery|geely|changan|jac|haval|tesla|peugeot|lexus|mazda|jetour|zeekr|xpeng)';
const CAR_BUY_RE = new RegExp('(\\b(cars?|vehicles?|suvs?|pick-?ups?)\\b[^.?!]{0,25}\\b(for sale|to buy|sale|price|prices|cost)\\b' +
  '|\\bbuy(ing)? (a |an )?(new |used |second-?hand |electric )?(car|vehicle|suv|pick-?up)\\b|\\b(used|new|electric|second-?hand|ev) (cars?|vehicles?|suvs?)\\b' +
  '|\\bcar (dealers?|market|showroom)s?\\b|\\b' + BRAND + '\\b[^.?!]{0,25}\\b(for sale|sale|price|prices|cost)\\b|\\b(used|new|buy) ' + BRAND + '\\b' +
  '|የሚሸጥ መኪና|መኪና[^።?]{0,15}(ለመግዛት|መግዛት|ልግዛ|ሽያጭ|የሚሸጥ|ዋጋ)|ያገለገለ መኪና|ኤሌክትሪክ መኪና|አዲስ መኪና)', 'i');
// "want to book / stay / find ..." is not a destination: without these, "I want to book a hotel in Bole" was a trip
// and never reached search_hotels (replay of real questions, 28 Sep 2026).
const TRIP_RE = /(\bto\s+(?!buy\b|sell\b|rent\b|import\b|book\b|stay\b|find\b|reserve\b|check\b|get\b|see\b|know\b|have\b|make\b|look\b)[a-z]|\bfrom\s+[a-z]|ወደ\s*\S|\bride\b|\btaxi\b|ታክሲ|ራይድ|\bdriver\b|ሹፌር|ጉዞ|pick me up)/i;
const isCarBuying = s => CAR_BUY_RE.test(s) && !TRIP_RE.test(s);
// Looking for a place to stay -> search_hotels. A trip to a hotel is a ride; a hotel job is a job.
const HOTEL_RE = /(\bhotels?\b|guest ?houses?|\bpensions?\b|\bhostels?\b|\bmotels?\b|\blodges?\b|\bresorts?\b|place to stay|ሆቴል|ፔንሲዮን|እንግዳ ማረፊያ|ማረፊያ|ሎጅ)/i;
// A hotel JOB is a job: "ኢንተርናሽናል ሆቴል ወይትረስ" (a waitress looking for work) got a list of hotels (real chat, 29 Sep 2026).
const HOTEL_NOT_RE = /(\bjobs?\b|vacanc|hiring|\bwork\b|\bcareer|ሥራ|ስራ|ቅጥር|ክፍት የሥራ|software|system|waiter|waitress|receptionist|\bcooks?\b|\bchefs?\b|housekeep|bartender|barista|cashier|ወይትረስ|ዌይትረስ|አስተናጋጅ|ሪሴፕሽን|ሪሰፕሽን|ምግብ አብሳይ|ሼፍ|ባርቴንደር|ካሸር|ፅዳት|ጽዳት)/i;
const isHotelSearch = s => HOTEL_RE.test(s) && !TRIP_RE.test(s) && !HOTEL_NOT_RE.test(s);
// Looking for a place to be seen -> search_health (bina.et/health, 30 Sep 2026). A trip to a hospital is a ride, a hospital
// job is a job, a clinic that wants to be listed joins (the tool's own description says how), and asking Dr Afiya is not a
// search. "close to Piassa" is not a trip: it is read as "near" before the trip test.
const HEALTH_RE = /(hospital|clinic|dentist|dental|\bdoctors?\b|physician|p(a)?ediatrician|gyn(a)?ecolog|obstetric|dermatolog|cardiolog|ophthalm|laborator|\blab\b|blood test|health cent(er|re)|ሆስፒታል|ክሊኒክ|ሐኪም|ሀኪም|ሃኪም|ዶክተር|የጥርስ|ጥርስ ሕክምና|ጥርስ ህክምና|ላብራቶሪ|ላቦራቶሪ|ጤና ጣቢያ)/i;
const HEALTH_NOT_RE = /(\bjobs?\b|vacanc|hiring|\bwork(ing)? (at|in|as)\b|career|ሥራ|ስራ|ቅጥር|\bmy (clinic|hospital|practice)\b|\bour (clinic|hospital)\b|\bregister\b|\bjoin\b|list my|add my|ክሊኒኬ|ክሊኒካችን|ሆስፒታላችን|afiya|አፍያ)/i;
// ...and a WHERE: a health word alone is not a search ("just tell me roughly, I will check with a doctor" and "how much
// is dental treatment?" were read as place searches by Dr Afiya's regression check, 30 Sep 2026). An area counts as a where.
const PLACE_INTENT_RE = /(\bwhere\b|\bwhich\b|\bnear(by|est)?\b|closest|\bfind\b|looking for|recommend|\blist\b|is there|are there|\bany\b|phone|number|address|contact|\bopen (at|on|now|today|tonight|late|on sunday|24)|\bneed an? |\bin (addis|bole|kirkos|arada|yeka|lideta|gulele|kolfe|akaki)|የት|የትኛው|የቱ|አካባቢ|ቅርብ|ስልክ|ፈልግ|ፈልጊ|ጠቁመኝ|አለ\?|አሉ\?|አለ፧|እፈልጋለሁ|ያስፈልገኛል)/i;
const hasArea = s => { try { return !!require('./health-args').healthArgsFromText(s).area; } catch (e) { return false; } };
const isHealthSearch = s => { s = String(s || ''); return HEALTH_RE.test(s) && !HEALTH_NOT_RE.test(s) && (PLACE_INTENT_RE.test(s) || hasArea(s))
  && !TRIP_RE.test(s.replace(/\b(close|next|near|nearest|closest)\s+to\b/gi, 'near')); };
const CAR_RE = /(\bcars?\b|\bvehicles?\b|\bdriver\b|መኪና|ተሽከርካሪ)/i;
function shouldForceTool(msg) {
  const s = String(msg == null ? '' : msg);
  if (!s.trim()) return false;
  if (OTHER_FORCE_RE.test(s)) return true;
  if (PROPERTY_RE.test(s) && !CAR_RE.test(s)) return true;
  if (isCarBuying(s)) return true;
  if (isHotelSearch(s)) return true;
  if (isHealthSearch(s)) return true;
  if (!PRICE_RE.test(s)) return false;
  if (banking.isBankingQuestion(s) || travel.isTravelQuestion(s) || business.isBusinessQuestion(s)) return false;
  return RIDE_CUE_RE.test(s);
}

// A job TITLE is a job search even without the word "job": "ኢንተርናሽናል ሆቴል ወይትረስ" (a waitress, real chat,
// 29 Sep 2026) got a hotel list, then only a promise to search. Strong titles count alone; words with a second
// meaning (ጥበቃ is also "protection", ፅዳት "cleanliness", cook a verb) count only next to a job word. An employer
// ("I need a waiter", "ሰራተኛ መቅጠር"), a CV, an alert, a fee or a trip is not this. Driver is left out on purpose:
// "ሹፌር ሆኜ መስራት" is BinaRide registration.
const JOB_STRONG_RE = /(waiter|waitress|receptionist|bartender|barista|housekeeper|\bchefs?\b|ወይትረስ|ዌይትረስ|አስተናጋጅ|ሪሴፕሽን|ሪሰፕሽን|ምግብ አብሳይ|ባርቴንደር|ሼፍ)/i;
// Office and professional titles (1 Oct 2026: an accountant search got companies' total vacancy counts from the notes,
// no job search) - weak too, so \"I am an accountant\" alone is not a search.
const JOB_WEAK_RE = /(\bcooks?\b|\bguards?\b|security|cleaner|housekeeping|ጥበቃ|ዘበኛ|ፅዳት|ጽዳት|accountant|accounting|አካውንታንት|አካውንቲንግ|ሒሳብ ሰራተኛ|ሂሳብ ሰራተኛ|cashier|ካሸር|ካሼር|\bnurses?\b|ነርስ|engineer|ኢንጂነር|መሐንዲስ|መሀንዲስ|secretary|ፀሐፊ|ጸሐፊ|ሴክሬታሪ|teacher|መምህር|አስተማሪ|pharmacist|ፋርማሲስት|\bsales\b|ሽያጭ)/i;
const JOB_WORD_RE = /(ስራ|ሥራ|\bjobs?\b|vacanc|ቅጥር|መቀጠር|ተቀጥሬ|work as|\bsira\b)/i;
const NOT_SEEKER_RE = /(መቅጠር እፈልጋለሁ|ልቅጠር|እቀጥራለሁ|ሰራተኛ እፈልጋለሁ|ሰራተኛ ፈልጌ|ሰራተኛ ያስፈልገኛል|post (a )?job|ማስታወቂያ ማውጣት|\b(need|hire|hiring|recruit)\b[^.?!]{0,12}\b(a|an)\s+(waiter|waitress|cook|chef|guard|cleaner|receptionist|bartender|barista)\b(?!\s*(job|position|work))|ክፈል|ክፍያ|ከፍለ|\bfee\b|\bcv\b|ሲቪ|\balert|አሳውቀኝ)/i;
const isJobTitleSearch = s => { s = String(s || ''); return (JOB_STRONG_RE.test(s) || (JOB_WEAK_RE.test(s) && JOB_WORD_RE.test(s))) && !NOT_SEEKER_RE.test(s) && !TRIP_RE.test(s); };
const JOB_Q = [[/waiter|waitress|ወይትረስ|ዌይትረስ|አስተናጋጅ/i, 'waiter', 'hospitality'], [/receptionist|ሪሴፕሽን|ሪሰፕሽን/i, 'receptionist', 'hospitality'],
  [/\bcooks?\b|\bchefs?\b|ምግብ አብሳይ|ሼፍ/i, 'cook', 'hospitality'], [/housekeep/i, 'housekeeping', 'hospitality'], [/bartender|ባርቴንደር/i, 'bartender', 'hospitality'],
  [/barista/i, 'barista', 'hospitality'], [/\bguards?\b|security|ጥበቃ|ዘበኛ/i, 'guard', 'security'], [/cleaner|ፅዳት|ጽዳት/i, 'cleaner', ''],
  [/accountant|accounting|አካውንታንት|አካውንቲንግ|ሒሳብ ሰራተኛ|ሂሳብ ሰራተኛ/i, 'accountant', ''], [/cashier|ካሸር|ካሼር/i, 'cashier', ''], [/\bnurses?\b|ነርስ/i, 'nurse', ''],
  [/engineer|ኢንጂነር|መሐንዲስ|መሀንዲስ/i, 'engineer', ''], [/secretary|ፀሐፊ|ጸሐፊ|ሴክሬታሪ/i, 'secretary', ''], [/teacher|መምህር|አስተማሪ/i, 'teacher', ''],
  [/pharmacist|ፋርማሲስት/i, 'pharmacist', ''], [/\bsales\b|ሽያጭ/i, 'sales', '']];
const JOB_CITY = [[/adama|nazret|አዳማ|ናዝሬት/i, 'Adama'], [/hawassa|awassa|ሀዋሳ|ሃዋሳ/i, 'Hawassa'], [/bahir ?dar|ባሕር ዳር|ባህር ዳር/i, 'Bahir Dar'],
  [/mekel+e|መቀሌ/i, 'Mekelle'], [/dire ?dawa|ድሬ ?ዳዋ/i, 'Dire Dawa'], [/gond[ae]r|ጎንደር/i, 'Gondar'], [/jimma|ጅማ/i, 'Jimma'],
  [/addis|አዲስ አበባ|bole|ቦሌ|piassa|ፒያሳ|kazanchis|ካዛንቺስ|megenagna|መገናኛ|\bcmc\b|sarbet|ሳርቤት/i, 'Addis Ababa']];
function jobTitleArgs(s) {
  const a = {}, t = JOB_Q.find(([re]) => re.test(s)), c = JOB_CITY.find(([re]) => re.test(s));
  if (t) { a.q = t[1]; if (t[2]) a.field = t[2]; }
  if (c) a.city = c[1];
  return a;
}

// A tier on its own, right after a ride-price question, is that question again with one word changed. Measured
// 30 Sep 2026: "and with bajaj?" after "How much is a ride from Bole to Piassa?" was answered with only a link to
// /ride in 1 run of 4, and in 3 of 6 earlier runs. No price word, so shouldForceTool never saw it. Short messages only:
// a sentence that merely names a tier is not a follow-up.
const TIER_RE = /(\bbajaj\b|\bmoto\b|\bmotorbike\b|\beconomy\b|\bcomfort\b|\bvan\b|\bxl\b|ባጃጅ|ሞተር|ኢኮኖሚ|ኮምፎርት|ቫን|baajaajii)/i;
function isRideFollowUp(msg, prev) {
  const s = String(msg == null ? '' : msg).trim(), p = String(prev == null ? '' : prev);
  if (!s || s.split(/\s+/).length > 6 || !TIER_RE.test(s)) return false;
  return PRICE_RE.test(p) && RIDE_CUE_RE.test(p) && shouldForceTool(p);
}

// A reply that only PROMISES a search ("መገናኛ አካባቢ ... ልፈልግልዎ። እባክዎ ትንሽ ይጠብቁ።", 30 Sep 2026) when the tool had
// already answered. Short, no link, and a waiting phrase: a real answer that says "let me know" is not one.
const PROMISE_RE = /(please wait|one moment|just a moment|let me (search|find|check|look)|i('ll| will) (search|find|look|check)|ትንሽ ይጠብቁ|ይጠብቁኝ|ልፈልግልዎ|ልፈልግልህ|ልፈልግልሽ|እፈልግልዎታለሁ|እየፈለግሁ ነው)/i;
const isPromiseOnly = t => { t = String(t || ''); return t.length < 400 && !/https?:\/\/|bina\.et\//.test(t) && PROMISE_RE.test(t); };

module.exports = { isJobTitleSearch, jobTitleArgs, shouldForceTool, isRideFollowUp, isPromiseOnly, PRICE_RE, OTHER_FORCE_RE, RIDE_CUE_RE, PROPERTY_RE, CAR_BUY_RE, isCarBuying, isHotelSearch, isHealthSearch };
