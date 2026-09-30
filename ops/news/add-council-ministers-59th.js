'use strict';
// News post: the Council of Ministers' 59th regular session, 28 September 2026.
//
//   node --env-file=.env ops/news/add-council-ministers-59th.js
//
// Written from the government's own statement (FMC), NOT a copy of it. The statement lists six
// decisions in the order they were taken; that order is useless to a reader. The thing a reader
// actually needs to know — and the thing the statement buries — is that FOUR of the six are only
// DRAFTS on their way to parliament and are not law, while TWO are regulations that bite the moment
// they appear in the Negarit Gazeta. That distinction is the spine of this piece.
//
// Checked before writing:
//   · 145,800,000 SDR at the late-September 2026 rate (~1.364 USD/SDR) is about 199 million dollars.
//     SDR is the IMF's unit of account, not a currency anyone holds, so it is explained rather than
//     quoted bare — a reader who sees "145.8 million SDR" learns nothing.
//   · Proclamation and regulation numbers are Ethiopian-calendar as the statement gives them:
//     income tax 979/2008, CoM regulation 410/2009, defence 1286/2015.
//   · Meskerem 18, 2019 EC = 28 September 2026.
// Nothing beyond the statement is asserted. Where the statement gives a reason, it is attributed to
// the Council rather than stated as fact.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'ministers-council-59th-session-decisions-amharic';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የኢ.ፌ.ዴ.ሪ የሚኒስትሮች ምክር ቤት 59ኛ መደበኛ ስብሰባ መግለጫ (የመንግሥት ኮሙኒኬሽን አገልግሎት)፣ መስከረም 18 ቀን 2019 ዓ.ም — ሴፕቴምበር 28 ቀን 2026።</p>

<p>የሚኒስትሮች ምክር ቤት በ59ኛ መደበኛ ስብሰባው ስድስት ጉዳዮችን አይቶ አጽድቋል። ነገር ግን ስድስቱም ተመሳሳይ ክብደት የላቸውም፤ ልዩነቱም ለአንባቢ ወሳኝ ነው።</p>

<p><strong>አራቱ ገና ሕግ አልሆኑም።</strong> ረቂቆች ናቸው፤ ወደ ሕዝብ ተወካዮች ምክር ቤት ተልከው እዚያ ካልጸደቁ ምንም አይሠሩም።</p>
<p><strong>ሁለቱ ግን ወዲያውኑ ተፈጻሚ ይሆናሉ።</strong> ደንቦች ናቸው፤ በፌዴራል ነጋሪት ጋዜጣ ታትመው ከወጡበት ቀን ጀምሮ በሥራ ላይ ይውላሉ። የምክር ቤቱ ውሳኔ ብቻውን ይበቃቸዋል።</p>

<h3>💰 ወዲያውኑ የሚጸኑት ሁለቱ — ታክስ</h3>

<p><strong>1. የተጨማሪ እሴት ታክስ (ቫት) ማሻሻያ ደንብ።</strong> ይህ ለብዙ ነጋዴዎች በቀጥታ የሚነካ ነው። የተርን ኦቨር ታክስ ስለተሻረ፣ ቀደም ሲል የሙያ አገልግሎትና ሌሎች አቅርቦቶችን እየሰጡ ያንን ታክስ ይሰበስቡ የነበሩ ግብር ከፋዮች አሁን <strong>ለቫት ተመዝግበው</strong> ታክሱን እንዲሰበስቡ ይደረጋል።</p>
<p>በተጨማሪም ምክር ቤቱ እንደገለጸው፣ በአንዳንድ አቅርቦቶች ላይ የተጣለው ታክስ <strong>ለሕብረተሰቡ በሚቀርቡ መሠረታዊ አቅርቦቶችና በአገር ውስጥ ኢንዱስትሪዎች ተወዳዳሪነት ላይ ጫና አሳድሯል</strong>፤ ስለዚህ እነዚያ አቅርቦቶች ከታክሱ ነፃ ይሆናሉ። የትኞቹ አቅርቦቶች እንደሆኑ በመግለጫው አልተዘረዘረም — ዝርዝሩ በነጋሪት ጋዜጣው ላይ ይታያል።</p>

<p><strong>2. የፌዴራል ገቢ ግብር ማሻሻያ ደንብ።</strong> ይህኛው አዲስ ግብር የሚጥል ሳይሆን የማስተካከያ ሥራ ነው። የሚኒስትሮች ምክር ቤት የገቢ ግብር ደንብ ቁጥር 410/2009 ከተሻሻለው የፌዴራል ገቢ ግብር አዋጅ ቁጥር 979/2008 ጋር እንዲጣጣም ተደርጓል። ዓላማው፣ እንደ ምክር ቤቱ አገላለጽ፣ <strong>ግልጽነትና አስተዳደራዊ ቅልጥፍና</strong> ነው።</p>

<h3>🗄️ ወደ ፓርላማ ከሚሄዱት — ብሔራዊ የዳታ አስተዳደር ረቂቅ አዋጅ</h3>
<p>ከስድስቱ ውስጥ ለቴክኖሎጂው ዘርፍ በጣም የሚመለከተው ይህ ነው። ረቂቁ የተዘጋጀው ኢትዮጵያ የያዘችውን የዲጂታል ትራንስፎርሜሽን ግብ ለማሳካት ሲሆን፣ የሚሸፍናቸው ነጥቦች፦</p>
<ul>
<li><strong>የዳታ ደኅንነትና ሉዓላዊነት</strong> — የሀገሪቱ ዳታ የት እንደሚቀመጥና ማን እንደሚያገኘው</li>
<li><strong>የዳታ መጋራት፣ ተናባቢነትና መልሶ አጠቃቀም</strong> — አንድ መሥሪያ ቤት የያዘውን መረጃ ሌላው እንደገና እንዳይጠይቅ</li>
<li><strong>የአርቲፊሻል ኢንተለጀንስ ምርምርና የፈጠራ አቅም</strong></li>
<li><strong>የዲጂታል ኢኮኖሚ ዕድገትና በዳታ የተመራ የኢኮኖሚ ሥርዓት</strong></li>
</ul>
<p>ይህ ከ<a href="https://bina.et/news/mesob-one-stop-service-my-experience">መሶብ የአንድ ማዕከል አገልግሎት</a> ጋር በቀጥታ ይገናኛል፤ የአንድ ማዕከል አገልግሎት የሚሠራው መሥሪያ ቤቶች መረጃ ሲጋሩ ብቻ ነው። ረቂቁ ያንን መጋራት የሚገዛ ሕጋዊ መሠረት ለመጣል የቀረበ ነው።</p>

<h3>⚡ የኃይል ዘርፍ ብድር — 145.8 ሚሊዮን ኤስ.ዲ.አር.</h3>
<p>ምክር ቤቱ ከዓለም አቀፉ የልማት ማኅበር (IDA) ጋር የተፈረመውን የብድር ስምምነት ማጽደቂያ ረቂቅ አዋጅ አጽድቆ ወደ ፓርላማ ልኳል። ብድሩ <strong>ለኃይል ሴክተር ሪፎርም፣ ኢንቨስትመንትና ዝመና ምዕራፍ አንድ ፕሮጀክት</strong> የሚውል ነው።</p>
<p><strong>ኤስ.ዲ.አር. ምንድነው?</strong> የዓለም የገንዘብ ድርጅት (IMF) የሒሳብ መለኪያ ነው — ማንም የሚይዘው ገንዘብ ሳይሆን፣ ከአምስት ዋና ምንዛሬዎች የተሠራ ቅርጫት። በሴፕቴምበር 2026 መጨረሻ ምንዛሬ መሠረት <strong>145.8 ሚሊዮን ኤስ.ዲ.አር. ወደ 199 ሚሊዮን የአሜሪካ ዶላር ገደማ</strong> ይሆናል።</p>
<p>ምክር ቤቱ ስምምነቱ ከሀገሪቱ የብድር ፖሊሲ ጋር የሚጣጣም መሆኑን አረጋግጧል።</p>

<h3>🏛️ የአስፈጻሚ አካላት አደረጃጀት — ለምን አሁን?</h3>
<p>ይህ ረቂቅ የመጣው በፖለቲካ ውሳኔ ሳይሆን በሕገ መንግሥቱ ግዴታ ነው። በየአምስት ዓመቱ ሀገራዊ ምርጫ ከተካሄደ በኋላ፣ በሕገ መንግሥቱ <strong>አንቀጽ 56</strong> መሠረት የአስፈጻሚ አካላት ሥልጣንና ተግባር በአዲስ መልክ መደራጀት አለበት። በ2018 ዓ.ም የተካሄደውን ምርጫ ተከትሎ የቀረበ ነው።</p>
<p>በተግባር ሲታይ፣ ሚኒስቴር መሥሪያ ቤቶች ሊዋሃዱ፣ ሊከፋፈሉ ወይም ሥልጣናቸው ሊለወጥ ይችላል ማለት ነው። ዝርዝሩ የሚታወቀው ፓርላማው ሲያጸድቀው ነው።</p>

<h3>🛡️ የመከላከያ ሠራዊት አዋጅ ማሻሻያ</h3>
<p>የመከላከያ ሠራዊት አዋጅ ቁጥር 1286/2015 እንዲሻሻል ረቂቅ ቀርቦ ወደ ፓርላማ ተልኳል። ምክንያቱ፣ እንደ መግለጫው፣ ተቋሙ በሕገ መንግሥቱ <strong>አንቀጽ 87</strong> የተሰጡትን ሀገራዊ ተልዕኮዎች በሕግ አግባብ እንዲፈጽም ለማስቻል ነው። የማሻሻያው ይዘት በመግለጫው አልተገለጸም።</p>

<h3>📌 ቀጥሎ ምን ይሆናል?</h3>
<ul>
<li><strong>ወዲያውኑ፦</strong> ሁለቱ የታክስ ደንቦች በነጋሪት ጋዜጣ ሲታተሙ ይጸናሉ። ነጋዴዎችና ሒሳብ ባለሙያዎች የሚከታተሉት ያንን ጋዜጣ ነው።</li>
<li><strong>ወደፊት፦</strong> አራቱ ረቂቆች — የአስፈጻሚ አካላት፣ የዳታ አስተዳደር፣ የብድር ማጽደቂያና የመከላከያ — በሕዝብ ተወካዮች ምክር ቤት መጽደቅ አለባቸው። እስከዚያ ድረስ ሕግ አይደሉም።</li>
</ul>

<p>ሌሎች የቴክኖሎጂና የመንግሥት አገልግሎት ዜናዎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a>፣ ክፍት ጨረታዎችን <a href="https://bina.et/tenders">በጨረታ ገጻችን</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>Ethiopia's Council of Ministers took six decisions at its 59th regular session on 28 September 2026, and they are not equal. <strong>Four are drafts on their way to the House of People's Representatives and are not law yet</strong>: a proclamation reorganising the federal executive (required by Article 56 after the 2018 EC election), a National Data Administration proclamation, ratification of a 145.8 million SDR credit from the International Development Association for phase one of the Energy Sector Reform, Investment and Modernization Project — roughly 199 million US dollars at late-September rates — and an amendment to Defence Forces Proclamation 1286/2015.</p>
<p><strong>Two take effect the day they are published in the Federal Negarit Gazeta.</strong> A VAT amendment brings professional-service providers who used to pay the now-repealed turnover tax into the VAT system, and exempts certain supplies the Council says were putting pressure on basic goods and on the competitiveness of domestic industry. An income tax regulation aligns Council of Ministers Regulation 410/2009 with the amended Federal Income Tax Proclamation 979/2008.</p>
<p>The data proclamation is the one to watch if you work in technology: it covers data security and sovereignty, sharing and interoperability between government bodies, AI research capacity and the digital economy — the legal floor that a one-stop government service actually needs in order to function.</p>
`.trim();

(async () => {
  const data = {
    title: "Ethiopia's Council of Ministers: six decisions, and only two become law immediately",
    titleAm: 'የሚኒስትሮች ምክር ቤት ስድስት ውሳኔ አሳለፈ — ሁለቱ ወዲያውኑ ይጸናሉ፣ አራቱ ገና ፓርላማ ይጠብቃሉ',
    category: 'ሕግ',
    excerpt: 'የሚኒስትሮች ምክር ቤት በ59ኛ መደበኛ ስብሰባው ስድስት ውሳኔ አሳልፏል። ሁለቱ የታክስ ደንቦች በነጋሪት ጋዜጣ ሲታተሙ ወዲያውኑ ይጸናሉ፤ አራቱ ግን ረቂቅ ሆነው ወደ ሕዝብ ተወካዮች ምክር ቤት ተልከዋል። ቫት፣ የገቢ ግብር፣ ብሔራዊ የዳታ አስተዳደር፣ የ145.8 ሚሊዮን ኤስ.ዲ.አር. የኃይል ብድር፣ የአስፈጻሚ አካላት አደረጃጀትና የመከላከያ አዋጅ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🏛️',
    readMinutes: 5,
    evergreen: false,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
