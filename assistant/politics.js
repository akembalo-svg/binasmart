'use strict';
// Bini declines politics entirely — not only opinions, but the subject.
//
// Measured on 2026-09-11 before this existed: he reliably refused to say which party was better
// (7 of 10, in many different words) and then, asked "ምርጫው መቼ ነበር?", reported polling-station
// closing times, voter numbers and extensions in Arba Minch out of crawled Reporter articles. The
// opinion was withheld; the coverage was not. Ibrahim's decision: decline entirely.
//
// Deterministic, like the emergency gates and for the same reason — a model in a helpful mood will
// answer a factual-sounding political question, and "when was the election" sounds factual.
//
// THE HARD PART IS NOT DECLINING, IT IS NOT OVER-DECLINING. Government services ARE the day job:
// passports, national ID, tax, trade licences, customs. "መንግስት" appears in both "what do you think
// of the government" and "which government office issues this". So an institution word never fires
// on its own — only when the message also asks for a view, or names something that is politics and
// nothing else. A service word always wins.
//
// Two Amharic traps, both found by testing this gate before wiring it in:
//   • \b DOES NOT WORK after an Ethiopic character. It is defined on ASCII word characters, so there
//     is no boundary between ምርጫ and the space after it, and a trailing \b kills the match.
//   • The definite article REPLACES the final character rather than appending: ጦርነ-ት becomes ጦርነ-ቱ,
//     ሚኒስት-ር becomes ሚኒስት-ሩ. The stem does not survive as a substring, unlike ምርጫ -> ምርጫው which
//     appends. So any word whose last syllable inflects is written as a class over that syllable.
const { foldEthiopic } = require('./lang');

// Politics and nothing else: elections, parties, the political figures, unrest, conflict.
const POLITICAL = [
  /ምርጫ|ድምጽ አሰጣጥ|ምርጫ ቦርድ|ተመራጭ|እጩ|ሪፈረንደ/,
  /ፓርቲ|ተቃዋሚ|ገዢው ፓርቲ|ብልጽግና|ኢዜማ|ፖለቲካ|ፖለቲከኛ/,
  /ጠቅላይ ሚኒስት[ርሩሯ]|ፕሬዚዳን[ትቱቷ]|አብይ|ዐቢይ|ዐብይ/,
  /ሰላማዊ ሰልፍ|አመፅ|አመጽ|ተቃውሞ|ጦርነ[ትቱቷ]|ግጭ[ትቱቷ]|ተኩስ አቁም|ብሔር ፖለቲካ|ዘረኝነት/,
  /\belections?\b|\bvot(e|es|ed|ing)\b|ballot|polling|political part(y|ies)|\bpolitics\b|politician|opposition part/i,
  /prime minister|\bpresident\b|protests?\b|uprising|\bwar\b|ceasefire|ethnic (politics|conflict)/i,
  /filannoo|paartii|siyaasa|sagalee kennuu|mormitoota|waraana|jeequmsa/i,
];
// Asking for a view, rather than for a service or a fact about paperwork.
const ASKS_A_VIEW = /ምን ታስባለህ|ምን ትላለህ|ምን ይመስልሃል|ምን ታውቃለህ|አስተያየትህ|ድጋፍ ትሰጣለህ|ማንን ትደግፋለህ|ይሻላል|ትክክል ነው ወይ|ማን ይሻላል|what do you think|your (opinion|view|take)|do you support|who is better|whose side/i;
// Institutions Bini legitimately helps with — political only WITH a request for a view.
const INSTITUTION = /መንግስት|መንግሥት|ባለስልጣን|ፖሊሲ|government|\bpolicy\b|mootummaa/i;
// Never political, whatever else the sentence contains. This is the day job and it always wins.
const SERVICE = /ፓስፖርት|መታወቂያ|ፋይዳ|ግብር|ቲን|ንግድ ፈቃድ|ጉምሩክ|ቪዛ|ልደት|ጋብቻ|ውርስ|ኪራይ|ማመልከቻ|አገልግሎት|ቢሮ|ጽ\/ቤት|ክፍያ|ሰነድ|ፈቃድ|ምዝገባ|ዲጂታል|ሚኒስቴር/i;
const SERVICE_EN = /passport|national id|fayda|\btax\b|\btin\b|licen[cs]e|customs|visa|birth certificate|marriage|inherit|lease|application|service|office|\bfee\b|document|registration|digital id|ministry/i;

function isPolitical(msg) {
  const m = foldEthiopic(String(msg || ''));
  if (SERVICE.test(m) || SERVICE_EN.test(m)) return false;     // the day job always wins
  if (POLITICAL.some(re => re.test(m))) return true;
  return INSTITUTION.test(m) && ASKS_A_VIEW.test(m);
}

// One fixed reply, so it cannot drift into commentary on a helpful day.
function politicalReply(lang) {
  if (lang === 'om') return 'Dhimma siyaasaa, filannoo fi paartiilee irratti waanan dubbadhu hin qabu — kun gita koo miti.\n\nGaruu imala, ragaa fi tajaajila Addis Ababaa irratti gaafadhaa — sana irratti gargaaruu nan danda\'a. 😊';
  if (lang === 'en') return 'I do not discuss politics, elections or parties — that is not what I am for.\n\nAsk me about rides, paperwork or getting around Addis Ababa and I will gladly help. 😊';
  return 'ስለ ፖለቲካ፣ ስለ ምርጫ ወይም ስለ ፓርቲዎች የምናገረው ነገር የለም — የእኔ ስራ አይደለም።\n\nስለ ጉዞ፣ ስለ ሰነድ መመሪያ ወይም ስለ አዲስ አበባ ግን ማንኛውንም ይጠይቁኝ፤ በደስታ እረዳዎታለሁ። 😊';
}

module.exports = { isPolitical, politicalReply };
