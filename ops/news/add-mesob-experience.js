'use strict';
// News post: MESOB, written by somebody who went and used it.
//
//   node --env-file=.env ops/news/add-mesob-experience.js
//
// Written by Ibrahim Kedir Bedru (owner, 24 September 2026) from his own visit. The desk's job was to
// check the institutional facts around his story and to say what could not be checked.
//
// Verified 24 September 2026:
//   · Federal pilot: 12 federal institutions, 41 services (ENA)
//   · MESOB super app rolled out 20 June 2026, 185+ public services online
//   · Addis Mesob: 11 one-stop centres operating, 25+ institutions, 150+ services
//     (Addis Media Network, 20 July 2026 — the owner's draft said 1 September; corrected)
//   · Third Addis Mesob centre: 112 services from 20 institutions across 69 service windows (AMN)
//   · MESOB Mobile Bus Service launched by the Prime Minister, April 2026 (Government Communication
//     Service, 22 April 2026): new TIN, business licence issue and renewal, driver medical, ID renewal,
//     birth registration, driving licence and plate renewal, Ethio Post road-fund payment, National ID,
//     prepaid electricity. 8kW solar, queue management, cameras.
//   · Establishment of MESOB Service, Council of Ministers Regulation No. 583/2026
//
// REMOVED from the draft: "MESOB Bridge API Gateway". No government or news source names it, and a
// made-up system name is the one thing this desk does not publish about a government service — the
// rule in prompts/bini.txt applies to us as much as to Bini. The article says instead what IS
// documented: the institutions' systems are connected so a citizen's data is shared between them.
//
// His own visit — the queue, the staff, the 20-30 minutes — is his testimony and stands as his. The
// closing note distinguishing personal experience from checked facts was his idea and is kept.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'mesob-one-stop-service-my-experience';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ማስታወሻ፦</strong> የ20–30 ደቂቃው ተሞክሮ የጸሐፊው የግል ተሞክሮ ነው። ስለ MESOB መዋቅርና አገልግሎቶች የተጠቀሱት ቁጥሮች ከመንግሥት ምንጮችና ከዜና ተረጋግጠዋል፤ ቀናቸውም አብሮ ተቀምጧል።</p>

<p>በኢትዮጵያ "የመንግሥት አገልግሎት" ሲባል ብዙዎቻችን የምናስበው ረጅም ወረፋ፣ ከቢሮ ወደ ቢሮ መላክ፣ እና "ይህን ከዚያ ቢሮ አምጣ" የሚል ሂደት ነው።</p>
<p>ይህ ጽሑፍ <strong>MESOB</strong> የተባለውን የአንድ ማዕከል (One-Stop Service) ሥርዓት ነው የሚያብራራው — ከዜና ሳይሆን፣ ራሴ ሄጄ ከተጠቀምኩበት ተሞክሮ ተነስቼ።</p>

<h3>😩 ያጋጠመኝ</h3>
<p>አዲስ የንግድ ፈቃድ ለማውጣት ወደ መሥሪያ ቤት ሄድኩ። መጀመሪያ "TIN ቁጥር ውሰድ" ተባልኩ። TIN ለማውጣት ስሄድ ሌላ መስፈርት — ፋይዳ መታወቂያ — ተነገረኝ።</p>
<p>በዚህ መሀል ቀናት ተመላለስኩ። እውነቱን ለመናገር፣ በአንድ ወቅት የንግድ ፈቃዱን ሙሉ በሙሉ ለመተው አስቤ ነበር።</p>
<p>ከዚያ አንድ ሰው MESOBን ነገረኝ።</p>

<h3>😮 ሄጄ ያየሁት</h3>
<p>መጀመሪያ ስሰማው እንደ ሌላ የመንግሥት ቢሮ መስሎኝ ነበር። ቦታው ስደርስ ግን የጠበቅኩት አልነበረም።</p>
<p>ከበሩ ላይ ካለው የደኅንነት ሠራተኛ ጀምሮ እስከ መረጃ ሰጪውና አገልግሎት ሰጪው ድረስ — አቀራረቡ የተለየ ነበር። አክብሮት፣ ፈገግታ፣ እና ለመምራት ዝግጁ መሆን።</p>
<p>ከዚያም ሂደቱን ጀመርኩ፦ <strong>TIN → የንግድ ስም → የንግድ ፈቃድ</strong>፤ ሁሉም በአንድ ቦታ።</p>
<p>በቀናት ያልጨረስኩትን እዚያ በአጭር ጊዜ ጨረስኩ። የሚያስደንቀው የወረቀቱ ፍጥነት ብቻ አልነበረም — <strong>ጊዜዬ መከበሩ ነው</strong>።</p>

<h3>🧺 MESOB ምንድነው?</h3>
<p>MESOB የተለያዩ የመንግሥት ተቋማት አገልግሎቶችን በአንድ ቦታ የሚያቀርብ ሥርዓት ነው። ዓላማው ዜጋው ከተቋም ወደ ተቋም እየተመላለሰ ጊዜና ገንዘብ እንዳያጠፋ ማድረግ ነው። የተቋማቱ ሥርዓቶች እርስ በርስ ስለሚገናኙ፣ አንዱ ቢሮ ያለውን መረጃ ሌላው እንደገና አይጠይቅም።</p>
<p>በፌዴራል ደረጃ የሙከራው ምዕራፍ <strong>12 ተቋማትንና 41 አገልግሎቶችን</strong> ይዞ ተጀመረ። ሰኔ 13 ቀን 2018 ዓ.ም (እ.ኤ.አ. ጁን 20 ቀን 2026) ደግሞ <strong>የMESOB ሱፐር አፕ</strong> ይፋ ሆኖ ከ<strong>185 በላይ አገልግሎቶች</strong> በኦንላይን መቅረብ ጀመሩ። ሥርዓቱ በሚኒስትሮች ምክር ቤት ደንብ <strong>ቁጥር 583/2026</strong> ተቋቁሟል።</p>

<h3>🏢 በአዲስ አበባ የት ደረሰ?</h3>
<p>እ.ኤ.አ. ጁላይ 20 ቀን 2026 በወጣ ሪፖርት መሠረት በአዲስ አበባ <strong>11 የአንድ ማዕከል አገልግሎት ማዕከላት</strong> እየሠሩ ሲሆን፣ <strong>ከ25 በላይ ተቋማት</strong> ወደ ሥርዓቱ ገብተው <strong>ከ150 በላይ አገልግሎቶች</strong> እየተሰጡ ናቸው።</p>
<p>ሦስተኛው የአዲስ መሶብ ማዕከል ሲከፈት <strong>ከ20 ተቋማት 112 አገልግሎቶችን በ69 የአገልግሎት መስኮቶች</strong> ይዞ ነበር።</p>

<h3>🚍 ወደ ሕዝቡ የሚሄደው — MESOB Mobile</h3>
<p>እ.ኤ.አ. በኤፕሪል 2026 ጠቅላይ ሚኒስትሩ <strong>MESOB Mobile Bus Service</strong> አስጀመሩ — በአውቶቡስ ውስጥ የተዘጋጀ ተንቀሳቃሽ የአገልግሎት ማዕከል።</p>
<p>በውስጡ የሚሰጡት፦ አዲስ TIN፣ የንግድ ፈቃድ ማውጣትና ማደስ፣ ለመንጃ ፈቃድ የሚያስፈልግ የሕክምና ምርመራ፣ የመታወቂያ እድሳትና የልደት ምዝገባ፣ የመንጃ ፈቃድና የሰሌዳ እድሳት፣ የፖስታ አገልግሎትና የመንገድ ፈንድ ክፍያ፣ የብሔራዊ መታወቂያ ምዝገባ፣ እና የቅድመ ክፍያ ኤሌክትሪክ።</p>
<p>አውቶቡሱ በ8 ኪሎዋት የፀሐይ ኃይል ይሠራል፤ የወረፋ ማስተዳደሪያ ሥርዓትና የክትትል ካሜራዎችም አሉት። ትርጉሙ ቀላል ነው፦ <strong>አገልግሎቱ ወደ ዜጋው እየቀረበ ነው</strong>።</p>

<h3>🌍 ከባሕረ ሰላጤው አገሮች ልምድ ጋር</h3>
<p>በተባበሩት ዓረብ ኤምሬትስና በሌሎች የባሕረ ሰላጤው አገሮች ተመሳሳይ የአንድ ማዕከልና የዲጂታል መንግሥት አገልግሎቶችን አይቻለሁ። በኢትዮጵያ MESOBን ስመለከት የሚሰማኝ አንድ ነገር ነው፦ <em>"እኛም ይህን ደረጃ መድረስ እንችላለን።"</em></p>

<h3>📱 ዲጂታል ኢትዮጵያ በተግባር</h3>
<p>ዲጂታል ለውጥ ማለት ድረ-ገጽ መሥራት ብቻ አይደለም። ከጀርባ ያሉት የተቋማት ሥርዓቶች ሲገናኙ፣ መረጃ ሲጋራ፣ እና አንድ ጉዳይ ለመጨረስ ብዙ ቢሮ መዞር ሲቀር — ያኔ ነው ለውጡ በተግባር የሚታየው።</p>
<p>ስለ ፋይዳ መታወቂያ፣ ስለ TIN እና ስለ ንግድ ፈቃድ ሂደት ዝርዝር መመሪያ <a href="https://bina.et/guides">በመመሪያዎቻችን</a> ውስጥ አለ፤ ስለ MESOB አጠቃላይ ማብራሪያ ደግሞ <a href="https://bina.et/news/mesob-one-stop-service-guide">በዚህ ጽሑፋችን</a> ቀርቧል። የንግድ ፈቃድ ምዝገባና ማጣሪያ <a href="https://bina.et/business-registration-ethiopia">እዚህ</a> ተብራርቷል።</p>

<h3>❤️ ትልቁ ጉዳይ ቴክኖሎጂው ብቻ አይደለም</h3>
<p>MESOB ላይ የሚያስደስተኝ ቴክኖሎጂው ብቻ አይደለም። <strong>የዜጋው ጊዜ እንደ ዋጋ ያለው ነገር መቆጠሩ ነው።</strong></p>
<p>አንድ ሰው ለንግድ ፈቃድ ወይም ለTIN ቀናት ሲያጠፋ፣ ኪሳራው የግለሰቡ ብቻ አይደለም። ጊዜ ሲቆጠብ፣ የመመላለሻ ወጪ ሲቀንስ፣ ሂደቱ ግልጽ ሲሆን — ዜጋውም መንግሥትም ይጠቀማሉ።</p>

<h3>💡 ያስተማረኝ</h3>
<p>ጥሩ የመንግሥት አገልግሎት ሰውን ማስደነቅ የለበትም፤ <strong>መደበኛ መሆን አለበት</strong>። ነገር ግን ከቀድሞ ልምድ የተነሳ ብዙ ጊዜ የምንጠብቀው ሂደት በአጭር ጊዜ ሲጠናቀቅ ሰው ይደነቃል። የሚመጣውም ጥያቄ፦ "እንዴት ይህን ቀድሜ አላወቅኩም?"</p>
<p>ስለዚህ እንዲህ ያለ አገልግሎት ካለ፣ ሰዎች ማወቅ አለባቸው።</p>

<h3>🇪🇹 የምንፈልጋት ኢትዮጵያ</h3>
<p>ዘመናዊ ኢትዮጵያ ማለት አዲስ ሕንፃ ብቻ አይደለም። ዘመናዊ ኢትዮጵያ ማለት ዜጋው ጊዜው የተከበረለት፣ አገልግሎቱ ግልጽ የሆነ፣ እና መንግሥት ዜጋውን በአክብሮት የሚያገለግልበት ኢትዮጵያ ናት።</p>
<p>ከብዙ ቢሮ → ወደ አንድ ቦታ። ከብዙ ቀን → ወደ አጭር ጊዜ። ከወረቀት → ወደ ዲጂታል። ከመጨነቅ → ወደ ቀላል አገልግሎት።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>What MESOB is.</strong> Ethiopia's one-stop government service: instead of walking a file between offices, a citizen completes several services in one place, because the institutions' systems are connected and one office no longer asks for what another already holds. The federal pilot began with <strong>12 institutions and 41 services</strong>; on <strong>20 June 2026</strong> the MESOB super app opened <strong>more than 185 services</strong> online. The service is established by <strong>Council of Ministers Regulation No. 583/2026</strong>.</p>
<p><strong>In Addis Ababa</strong>, as reported on 20 July 2026: <strong>11 one-stop centres</strong> operating, <strong>25+ institutions</strong> integrated and <strong>over 150 services</strong> delivered. The third Addis Mesob centre opened with <strong>112 services from 20 institutions across 69 windows</strong>.</p>
<p><strong>MESOB Mobile.</strong> In April 2026 the Prime Minister launched a bus fitted out as a travelling service centre: new TIN, business licence issue and renewal, the medical examination for a driving licence, ID renewal and birth registration, driving licence and plate renewal, postal and road-fund payment, National ID, and prepaid electricity. It runs partly on an 8kW solar system and has queue management and cameras.</p>
<p><strong>And the part that is mine.</strong> I went to get a business licence and spent days being sent between offices — TIN first, then Fayda, then back again. I nearly gave the licence up. Somebody told me to try MESOB, and there I finished TIN, trade name and licence in one visit. What struck me was not the speed of the paperwork. It was that my time was treated as worth something. Good government service should not astonish anyone; it should be ordinary. Until it is, the people who need it should at least know it exists.</p>
`.trim();

(async () => {
  const data = {
    title: 'MESOB — I went to get a business licence, and Ethiopian government service surprised me',
    titleAm: 'MESOB — የኢትዮጵያ የመንግሥት አገልግሎት አዲስ ፊት',
    category: 'ቴክኖሎጂ',
    excerpt: 'የንግድ ፈቃድ ለማውጣት ከቢሮ ወደ ቢሮ ስመላለስ ቀናት አጠፋሁ፤ ልተወው እንኳ አስቤ ነበር። ከዚያ MESOB ሄድኩ — TIN፣ የንግድ ስም እና የንግድ ፈቃድ በአንድ ቦታ። የፌዴራል ሙከራው በ12 ተቋማትና በ41 አገልግሎት ተጀምሮ፣ ሱፐር አፑ ከ185 በላይ አገልግሎት ይዟል፤ በአዲስ አበባ 11 ማዕከላት ከ150 በላይ አገልግሎት እየሰጡ ነው። የሚያስደንቀው ፍጥነቱ ሳይሆን ጊዜዬ መከበሩ ነው።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🧺',
    readMinutes: 6,
    evergreen: false,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
