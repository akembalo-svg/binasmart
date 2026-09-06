'use strict';
// News post: Ethiopian Shipping & Logistics launches its Digital Customer Self-Service platform.
//
// Sources: ESL's own launch announcement (feature list, 4 Sep 2026); 2merkato / Sheger FM 102.1
// (Sheraton Addis venue, CEO Abdulber Shemsu, Takele Uma quotes, "four other digital systems",
// 4 Sep 2026); Fana (Fraol Tafa of the Ethiopian Maritime Authority, AI chatbot, Digital Ethiopia
// 2030, 5 Sep 2026); Ethiopia Today (Thursday 4 Sep, built with Koket Investment, "Digital ESL");
// Google Play listing et.eslse.esl "ESL Mobile" (updated 11 Aug 2026). No web-portal URL had been
// published on eslse.et at the time of writing, and the App Store's "ESL Mobile App" belongs to
// Emirates Shipping Line, not Ethiopian — both facts are stated in the post rather than papered over.
//
//   node ops/news/add-esl-selfservice.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const slug = 'esl-digital-customer-self-service-app-2026';

const body = `
<p><strong>የኢትዮጵያ የባህር ትራንስፖርትና ሎጂስቲክስ አገልግሎት ድርጅት (ESL)</strong> ሐሙስ ነሀሴ 29/2018 ዓ.ም (4 September 2026) በሸራተን አዲስ በተካሄደ ሥነ-ሥርዓት <strong>Digital Customer Self-Service</strong> የተባለውን የደንበኞች ራስ-አገልግሎት መድረክ ይፋ አድርጓል። በድር (web) እና በሞባይል መተግበሪያ የሚሰራው መድረክ አስመጪዎችና ላኪዎች የ ESL አገልግሎቶችን <strong>ቢሮ ሳይሄዱ</strong> እንዲያገኙ ያስችላል።</p>

<h3>🚢 በመድረኩ ምን ይቻላል?</h3>
<p>ESL በይፋዊ ማስታወቂያው የዘረዘራቸው አገልግሎቶች፦</p>
<ul>
<li>✅ <strong>ዋጋ መጠየቅና ቦታ ማስያዝ</strong> (quotation & booking)</li>
<li>✅ <strong>የኮንቴይነር ተቀማጭ (deposit) እና የጭነት መልቀቅ</strong> (cargo release)</li>
<li>✅ <strong>የመዘግየት ክፍያ (demurrage) ማየትና መክፈል</strong></li>
<li>✅ <strong>Track & Trace</strong> — የጭነት ሁኔታን በቅጽበት መከታተል</li>
<li>✅ <strong>24/7 የደንበኞች ድጋፍ</strong> — ፋና እንደዘገበው በ AI የሚደገፍ ቻትቦትን ጨምሮ</li>
<li>✅ የደንበኛ ምዝገባ፣ ዲጂታል ክፍያ እና ቅሬታ ማቅረብ</li>
</ul>

<h3>🗣 በሥነ-ሥርዓቱ የተባለው</h3>
<p>የ ESL ዋና ሥራ አስፈጻሚ <strong>ኢንጂነር አብዱልበር ሸምሱ</strong> መድረኩ ለበርካታ ዓመታት ሲለማ የቆየ መሆኑንና ድርጅቱን ወደ ዓለም አቀፍ ደረጃ ለማሸጋገር የሚደረገው ሰፊ ለውጥ መጀመሪያ እንደሆነ ተናግረዋል። የኢትዮ-ጅቡቲ ምድር ባቡር ዋና ሥራ አስፈጻሚና የ ESL ቦርድ አባል <strong>ታከለ ኡማ</strong> ዲጂታል ለውጡ የኢትዮጵያን የረጅም ጊዜ የባህር ትራንስፖርት ዕቅድ አካል መሆኑን ገልጸው የወደብ ተደራሽነትና ባለቤትነት ያለውን ጠቀሜታ አጽንኦት ሰጥተዋል። የኢትዮጵያ ማሪታይም ባለሥልጣን ምክትል ዋና ዳይሬክተር <strong>ፍራኦል ታፋ</strong> መድረኩ ከዲጂታል ኢትዮጵያ 2030 ጋር የተጣጣመ መሆኑን ተናግረዋል። ኢትዮጵያ ቱዴይ እንደዘገበው መድረኩ ከሀገር ውስጥ የቴክኖሎጂ ኩባንያ <strong>ኮከት ኢንቨስትመንት</strong> ጋር በትብብር ተገንብቷል።</p>
<p>ESL ከዚህ መድረክ በተጨማሪ <strong>አራት ሌሎች ዲጂታል ሥርዓቶችን</strong> እያስተዋወቀ ሲሆን፣ ሥርዓቱ ቀስ በቀስ ከዓለም አቀፍ ተመሳሳይ መድረኮች ጋር እንደሚተሳሰር ገልጿል።</p>

<h3>📲 እንዴት መጠቀም — እና ሁለት ማሳሰቢያዎች</h3>
<ul>
<li><strong>Android:</strong> "ESL Mobile" የተባለው ይፋዊ መተግበሪያ በ Google Play ላይ አለ (ገንቢ፦ Ethiopian Shipping and Logistics፣ package <code>et.eslse.esl</code>፣ የመጨረሻ ዝመና 11 August 2026)። የጭነት ክትትል፣ ዋጋና ቦታ ማስያዝ፣ የደረቅ ወደብ አገልግሎቶች፣ ያልተከፈሉ ክፍያዎችና ደረሰኞች በውስጡ አሉ።</li>
<li><strong>⚠️ iPhone:</strong> በ App Store ላይ "ESL Mobile App" ተብሎ የሚታየው መተግበሪያ የ<strong>Emirates Shipping Line</strong> እንጂ የኢትዮጵያ ESL አይደለም። ስሙ ተመሳሳይ ስለሆነ ያረጋግጡ።</li>
<li><strong>⚠️ የድር ፖርታል አድራሻ:</strong> እስከ ዛሬ (6 Sep 2026) ድረስ በ eslse.et ላይ የራስ-አገልግሎት ፖርታሉ ማስፈንጠሪያ አልተለጠፈም — ዋናው ገጽ "Track Your Shipment" ብቻ ነው ያለው። አድራሻው ይፋ ሲሆን ይህን ጽሑፍ እናዘምናለን፤ እስከዚያ Google Play መተግበሪያውን ይጠቀሙ ወይም ESLን በ +251 11 551 8280 ያግኙ።</li>
</ul>

<h3>💡 ይህ ለአስመጪዎች ምን ማለት ነው?</h3>
<p>የመዘግየት ክፍያ (demurrage) በ ESL ቢሮ ወረፋ ሳይሆን በስልክ ማየትና መክፈል መቻል ለአስመጪዎች ቀናትን ያድናል። ዕቃ እያስመጡ ከሆነ <a href="/customs-import-duty-ethiopia">የጉምሩክ ቀረጥ መመሪያ</a>ን እና <a href="/import-car-to-ethiopia">መኪና ማስመጣት (EV)</a> መመሪያን ያንብቡ — ESL ከጅቡቲ ወደብ እስከ ሞጆ ደረቅ ወደብ ያለው ሰንሰለት ባለቤት ነው።</p>

<h3>🇬🇧 In English</h3>
<p>Ethiopian Shipping &amp; Logistics (ESL) launched its <strong>Digital Customer Self-Service</strong> platform on Thursday 4 September 2026 at the Sheraton Addis. The web and mobile platform lets customers request quotations and book, process container deposits and cargo release, check and pay demurrage, track cargo in real time, and reach 24/7 support, including an AI chatbot. CEO Eng. Abdulber Shemsu called it the start of ESL's move to international standards; board member Takele Uma tied it to Ethiopia's maritime ambitions; the platform was built with local firm Koket Investment, and four more digital systems are coming. Two cautions: the Android app is "ESL Mobile" (package et.eslse.esl) on Google Play, while the App Store's "ESL Mobile App" belongs to Emirates Shipping Line; and no web-portal URL had been published on eslse.et when this was written.</p>

<p style="background:#f4f1ea;border-left:4px solid #8a6a00;padding:14px 18px;border-radius:8px;font-size:14px;color:#5c5548"><strong>ምንጮች፦</strong> የ ESL ይፋዊ ማስታወቂያ (4 Sep 2026) · 2merkato/ሸገር ኤፍኤም 102.1 (4 Sep) · ፋና (5 Sep) · Ethiopia Today (4 Sep) · Google Play (et.eslse.esl)። ESL የመንግሥት ልማት ድርጅት ነው፤ BinaSmart ከ ESL ጋር ግንኙነት የለውም።</p>
`.trim();

(async () => {
  const data = {
    title: 'ESL Launches Digital Customer Self-Service: Book, Pay Demurrage and Track Cargo Without Visiting an Office',
    titleAm: 'ESL የደንበኞች ራስ-አገልግሎት መተግበሪያ ይፋ አደረገ — ቦታ ማስያዝ፣ የመዘግየት ክፍያና ክትትል ያለ ቢሮ',
    category: 'ቴክኖሎጂ',
    excerpt: 'የኢትዮጵያ የባህር ትራንስፖርትና ሎጂስቲክስ (ESL) ነሀሴ 29/2018 (4 Sep 2026) በድርና በሞባይል የሚሰራ Digital Customer Self-Service መድረክ ይፋ አደረገ፦ ዋጋ ጥያቄና ቦታ ማስያዝ፣ የኮንቴይነር ተቀማጭና የጭነት መልቀቅ፣ የመዘግየት ክፍያ (demurrage)፣ Track & Trace እና 24/7 ድጋፍ — ቢሮ ሳይሄዱ። Android መተግበሪያው "ESL Mobile" ነው፤ የ App Store "ESL Mobile App" የ Emirates Shipping Line ነው።',
    bodyHtml: body, lang: 'am', heroEmoji: '🚢', readMinutes: 4, evergreen: false, published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
