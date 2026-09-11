'use strict';
const { foldEthiopic } = require('./lang');
// Dr Afiya (ዶ/ር አፍያ) — BinaSmart's health guide for Ethiopia.
//
// What she is: a guide to the health SYSTEM. Which department treats what, what a visit costs and needs,
// how insurance and documents work, and when to stop reading and go to a hospital.
//
// What she is NOT, by construction and not merely by instruction: a doctor. She does not diagnose, does not
// name a medicine or a dose, does not read test results, and does not tell anyone their illness is or is not
// serious. Those judgements belong to a licensed clinician who can examine the person.
//
// The safety here is deterministic. An emergency is answered by this file, never by the model, because a
// model that is right 99 times out of 100 is not good enough when the hundredth person is having a stroke.

// ---------- 1. emergency: answered here, immediately, without the model ----------
// Sources: Ethiopian Red Cross ambulance 907 (Addis Ababa), police 991, fire 939 — the set already carried in
// knowledge/addis-ababa.md. Never let these be generated.
const AMBULANCE = '907', POLICE = '991', FIRE = '939';

// Both sides of the comparison must be folded. foldEthiopic normalises the INPUT (ሐ→ሀ, ሠ→ሰ, ዐ→አ,
// ፀ→ጸ); a pattern still written with one of the originals - ህፃን is the common one - could then never
// match anything. So pattern sources are folded too, at construction, and a pattern may be written
// with whatever spelling is natural.
const foldRe = list => list.map(re => new RegExp(foldEthiopic(re.source), re.flags));

const EMERGENCY = foldRe([
  // Amharic conjugates and negates around the stem, so match stems: ያመ- covers ያመኛል/ያመዋል/ያማል,
  // ተነፈሰ/ተንፈስ covers እየተነፈሰ አይደለም/መተንፈስ አልቻለም/አይተነፍስም.
  // cardiac / stroke
  /ደረት|ደረቱ|ደረቷ|ደረቴ/i.source && /(ደረት|ደረቱ|ደረቷ|ደረቴ)[^።.!?]{0,18}(ያመ|ያማ|ያም|ህመም|ማመም|ይጠበ|ጠበበ|ተጫነ)/,
  /chest (pain|tightness|pressure)|heart attack|የልብ ድካም|ልቤ.{0,14}(ያመኛል|ቆመ)/i,
  /ስትሮክ|stroke|face.{0,10}droop|slurred speech|sudden numbness|አንደበቱ?.{0,12}(ተሳሰረ|ዘጋ)|አንድ ጎን.{0,14}(ሽባ|ደነዘዘ)/i,
  // breathing — the most important line in this file
  /(አይተነፍስ|አትተነፍስ|እየተነፈሰ አይደለም|እየተነፈሰች አይደለም|መተንፈስ[^።.!?]{0,14}(አልቻ|ተቸገረ|አቃተ|አይችል)|ትንፋሽ[^።.!?]{0,12}(አጠረ|ቆመ|የለም)|አየር አጣ|ታነቀ|ተነቀ)/,
  /can(no|')?t breathe|not breathing|stopped breathing|struggling to breathe|difficulty breathing|choking|gasping/i,
  // bleeding / trauma
  /ደም[^።.!?]{0,16}(አይቆም|በዛ|ይፈሳል|ፈሰሰ|አፈሰሰ)|ከባድ ደም/,
  /heavy bleeding|bleeding (a lot|badly)|won'?t stop bleeding|haemorrhag|hemorrhag/i,
  /አደጋ[^።.!?]{0,10}ደረሰ|የመኪና አደጋ|ተገጨ|ወደቀ[^።.!?]{0,14}(ራሱን ስቶ|አልነቃም)/,
  /car accident|hit by a car|fell from|serious injury|stabbed|shot/i,
  // consciousness / seizure
  /ራሱን ስቶ|ራሷን ስታ|ራሱን ሳተ|አልነቃም|አትነቃም|መንቀጥቀጥ|ይንቀጠቀጣል|ደነዘዘ/,
  /unconscious|passed out|not waking|unresponsive|convulsion|seizure|fitting|collaps/i,
  // poisoning / burns
  /መርዝ|ተመረዘ|ብዙ ክኒን[^።.!?]{0,14}ወሰደ|መድ[ሀሃ]ኒት[^።.!?]{0,10}በዛበት|ከባድ ቃጠሎ|ተቃጠለ/,
  /poison|overdose|swallowed.{0,18}(bleach|poison|pills)|severe burn|scalded/i,
  // obstetric
  /ምጥ[^።.!?]{0,16}(ደም|ችግር|ጀመረ)|ነፍሰ ጡር[^።.!?]{0,18}ደም|እርጉዝ[^።.!?]{0,18}ደም/,
  /labou?r.{0,14}bleeding|pregnan.{0,24}(bleeding|heavy bleeding)|water broke.{0,20}bleeding/i,
  // infant
  /ህፃኑ|ህፃኗ|ልጄ/.source && /(ህፃኑ|ህፃኗ|ልጁ|ልጅ|ልጄ)[^።.!?]{0,20}(አይተነፍስም|አልነቃም|ደነዘዘ|ራሱን ስቶ|አይንቀሳቀስም)/,
  /baby.{0,20}(not breathing|unresponsive|limp|blue|won'?t wake)/i,
  // Afaan Oromoo. Stems, not whole forms, because the verbs inflect: dhukkub-, danda'-, dammaq-.
  // cardiac / chest
  /onnee[^.!?]{0,20}(dhukkub|jabaa|dhaabbate)|laphee[^.!?]{0,18}dhukkub|dhukkubbii onnee/i,
  // breathing
  /hafuura[^.!?]{0,22}(hin baafat|baafachuu hin danda|dhaabbate|hin argat|rakkat)|hin hargan|harganuu hin danda/i,
  // consciousness
  /of wallaal|of hin beek|hin dammaq|dammaquu hin danda|ka'uu hin danda/i,
  // bleeding / injury
  /dhiig[^.!?]{0,20}(hin dhaabb|hin dhaabat|baay|yaa'|dhangala)|madaa cimaa/i,
  /balaa[^.!?]{0,18}(konkolaataa|geesse|qaqqabe)|konkolaataan rukut|kufe[^.!?]{0,18}(hin ka'|of wallaal)/i,
  // poisoning / burns
  /summii|qoricha[^.!?]{0,18}baay'ee (fudhate|liqimse)|gubaa cimaa|gube[^.!?]{0,12}cimaa/i,
  // obstetric
  /da'umsa[^.!?]{0,20}dhiiga|ulfa[^.!?]{0,22}dhiig|dhiiga ulfaa/i,
  // infant
  /(mucaa|daa'ima|ilma)[^.!?]{0,24}(hin hargan|hafuura hin|hin dammaq|of wallaal|hin socho)/i,
  // self-harm
  /of ajjeesuu|of ajjeesuun|ofin ajjeesa|du'uu barbaad|lubbuu koo/i,
  // self-harm

  /ራሴን ማጥፋት|ራሱን ሊያጠፋ|ራሷን ልታጠፋ|ራሴን ልገድል|መሞት እፈልጋለሁ/,
  /suicide|kill myself|end my life|want to die|harm myself/i,
]);

function isEmergency(msg) { const m = foldEthiopic(String(msg || '')); return EMERGENCY.some(re => re.test(m)); }

// A fixed answer. No model, no retrieval, no variation.
function emergencyReply(lang) {
  if (lang === 'om') {
    return `⚠️ Kun haala ariifachiisaa fakkaata. Amma bilbili: **Ambulaansii ${AMBULANCE}**.\n`
      + `Poolisii ${POLICE} · Ibidda ${FIRE}\n\n`
      + `Yoo dandeessan gara hospitaala dhiyootti jiru deemaa. Namicha/dubartii sana kophaa hin dhiisinaa.\n\n`
      + `Ani gargaartuu odeeffannoo qofa — ogeessa fayyaa miti. Amma bilbiluun caalaa barbaachisaadha.`;
  }
  if (lang === 'en') {
    return `⚠️ This sounds like an emergency. Call an ambulance now: **${AMBULANCE}**.\n`
      + `Police ${POLICE} · Fire ${FIRE}\n\n`
      + `If you can get there faster yourselves, go to the nearest hospital emergency department. Do not leave the person alone.\n\n`
      + `I am an information guide, not a medical professional. Calling now matters more than anything I can tell you.`;
  }
  return `⚠️ ይህ አስቸኳይ ሁኔታ ይመስላል። አሁኑኑ አምቡላንስ ይደውሉ፦ **${AMBULANCE}**\n`
    + `ፖሊስ ${POLICE} · እሳት አደጋ ${FIRE}\n\n`
    + `በራስዎ በፍጥነት መድረስ የሚችሉ ከሆነ ወደ ቅርብ ሆስፒታል ድንገተኛ ክፍል ይሂዱ። ሰውየውን ብቻውን አይተውት።\n\n`
    + `እኔ የመረጃ አገልግሎት ነኝ እንጂ የህክምና ባለሙያ አይደለሁም። አሁን መደወል ከሁሉ ይቀድማል።`;
}

// ---------- 2. clinical questions she must not answer ----------
// Asking to be diagnosed, medicated, or reassured about a symptom. She redirects to a clinician and offers
// the part she can help with: which department, what it costs, what to bring.
const CLINICAL = foldRe([
  /ምን በሽታ|በሽታዬ ምንድ|what (disease|do i have|is wrong with me)|do i have (cancer|hiv|tb|covid|diabetes)|diagnos/i,
  /ምን መድ[ሀሃ]ኒት|የትኛው መድ[ሀሃ]ኒት|what medicine|which (medicine|drug|antibiotic)|should i take|ክኒን.{0,10}(ልውሰድ|እወስዳለሁ)|prescri/i,
  // Amharic marks the object on the verb, so asking on someone else's behalf uses a different word
  // entirely: ልስጠው / ልስጣት / ልስጣቸው (give him / her / them), never ልውሰድ (take). A parent asking a
  // child's dose is the highest-stakes version of this question and it used to walk past the gate.
  /ስንት[^።.!?]{0,14}(ልውሰድ|እወስዳለሁ|ልስጠው|ልስጣት|ልስጣቸው|ልጠጣ|ላጠጣው|ልውሰድለት)|how (much|many).{0,24}(should i (take|give)|tablets|mg|spoons?)|መጠን.{0,12}ስንት|dosage|dose/i,

  /ውጤቴን|የላብራቶሪ ውጤት|test result|lab result|x-?ray (result|show)|ውጤቱ ምን ማለት|what does (my|this) (result|scan) mean/i,
  /አደገኛ ነው|ከባድ ነው ወይ|is (it|this) serious|should i (worry|be worried)|is it dangerous|life threatening/i,
  /ማርገዝ|እርግዝና.{0,14}(አቋርጥ|ማስወረድ)|abortion|terminate.{0,12}pregnan/i,
  // Afaan Oromoo: diagnosis, medicine, dose, results, "is it serious"
  /dhukkubni koo maali|dhukkuba maalii|maal na qabe|qoricha maalii|qoricha maal fudhadh|qoricha naaf/i,
  /hangam fudhadh|meeqa fudhadh|hangam.{0,14}kenn|meeqa.{0,14}kenn|safartuu qorichaa|bu'aan qorannoo|firiin qorannoo maal/i,

  /cimaadhaa|balaa qaba|yaaddessaadha|nan du'aa/i,
]);
// Folded first: ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ and ጸ/ፀ are the same sounds written differently, and a patient
// uses whichever they were taught. See foldEthiopic in lang.js.
function isClinical(msg) { const m = foldEthiopic(String(msg || '')); return CLINICAL.some(re => re.test(m)); }

// ---------- 3. an output filter, because a prompt is a request and a filter is a rule ----------
// Any dosage instruction is removed no matter how it arrived. This is the sentence that gets someone hurt.
const DOSAGE = /\b\d[\d.,]*\s*(mg|ml|mcg|µg|g|iu)\b|\b\d+\s*(tablets?|capsules?|pills?|ክኒን|ጠብታ|ማንኪያ)\b|\b(twice|three times|[0-9]+ times)\s*(a|per)\s*day\b|በቀን\s*\d+\s*(ጊዜ|ጊዜያት)/i;
function stripDosage(text) {
  const parts = String(text || '').split(/(?<=[.!?።])\s+/);
  const kept = parts.filter(p => !DOSAGE.test(p));
  return { text: kept.join(' ').replace(/\s{2,}/g, ' ').trim(), removed: parts.length - kept.length };
}

// ---------- 4. the persona and the rules the model does get ----------
const { loadPrompt } = require('./prompt');
const SYSTEM = loadPrompt('afiya', 'You are Dr Afiya, BinaSmart\'s guide to the Ethiopian health system. You are not a clinician and you never give a diagnosis, a medicine or a dose. Say which KIND of department treats the problem, what to bring and how soon. The operational prompt for this agent is not published.');

// The line that closes every substantive answer, in the user's language.
function disclosure(lang) {
  if (lang === 'om') return 'Ani gargaartuu odeeffannoo BinaSmart — ogeessa fayyaa miti. Murtoo fayyaa keessaniif ogeessa fayyaa mari\'adhaa.';
  if (lang === 'en') return 'I am BinaSmart\'s information guide, not a medical professional. For any decision about your health, please see a clinician.';
  return 'እኔ የቢናስማርት የመረጃ አገልግሎት ነኝ እንጂ የህክምና ባለሙያ አይደለሁም። ስለ ጤናዎ ውሳኔ ከባለሙያ ጋር ይማከሩ።';
}

function clinicalNudge(lang) {
  if (lang === 'om') return '\n\nGaaffiin kee nama si qorachuu danda\'u barbaada. Waan ani gochuu danda\'u: kutaa kamitti akka deemtuu fi maal akka qabattu sitti himuu.';
  if (lang === 'en') return '\n\nThat needs someone who can examine you. What I can do is tell you which department to go to and what to bring.';
  return '\n\nይህ እርስዎን በአካል ሊመረምር የሚችል ባለሙያ ይፈልጋል። እኔ ልረዳዎ የምችለው የትኛው ክፍል እንደሚያስፈልግና ምን ይዘው መሄድ እንዳለብዎ በመንገር ነው።';
}

// Appended by the route when a reply repeats demo-hospital data without saying so. Deterministic for
// the same reason the ambulance number is: a parent given a department and an opening time for a
// hospital that does not exist is the concrete harm here, and a model in a helpful mood drops caveats.
function demoNotice(lang) {
  if (lang === 'om') return '\n\n\u26a0\ufe0f Yaadachiisa: hospitaalli fi kutaaleen armaan olii fakkeenya (demo) qofa — bakka dhugaa miti. Hospitaala dhugaa naannoo keessan jiru bira deemaa.';
  if (lang === 'en') return '\n\n\u26a0\ufe0f Note: the hospital and departments above are demonstration data, not a real place. Go to a real hospital or health centre near you.';
  return '\n\n\u26a0\ufe0f \u121b\u1233\u1230\u1262\u12eb\u1366 \u12a8\u120b\u12ed \u12eb\u1208\u12cd \u1206\u1235\u1352\u1273\u120d\u1293 \u12ad\u134d\u120e\u127d \u121b\u1233\u12eb (demo) \u1218\u1228\u1303 \u1290\u12cd \u2014 \u12a5\u12cd\u1290\u1270\u129b \u1264\u1275 \u12a0\u12ed\u12f0\u1208\u121d\u1362 \u1260\u12a0\u1245\u122b\u1262\u12ce \u12c8\u12f0\u121a\u1308\u129d \u1206\u1235\u1352\u1273\u120d \u12c8\u12ed\u121d \u12e8\u1320\u1293 \u1320\u1262\u12eb \u12ed\u1202\u12f1\u1362';
}

module.exports = { SYSTEM, demoNotice, isEmergency, emergencyReply, isClinical, stripDosage, disclosure, clinicalNudge, AMBULANCE, POLICE, FIRE, DOSAGE };
