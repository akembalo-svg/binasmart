'use strict';
// News post: Googlebook — Google's new laptop category, pre-orders opened 21 September 2026.
//
//   node ops/news/add-googlebook.js
//
// Sources, all read on 22 September 2026:
//   · Google's own announcement — blog.google/products-and-platforms/devices/googlebook/pre-order-googlebook/
//     (Googlebook OS, Glowbar, Magic Pointer, Rambler, Create My Widget, $899, 21 Sep pre-order,
//      4 Oct US / 5 Oct Canada, UK, Ireland, France, Germany, Australia)
//   · Bloomberg, 21 Sep 2026 — "Google Rolls Out $899-Plus Googlebooks from Dell, HP, Lenovo, Acer, ASUS"
//   · VideoCardz and Windows Report, 21 Sep 2026 — the five launch models and their prices
//
// Every price and date below comes from those. Nothing is estimated. What is NOT known is stated as not
// known: there is no Ethiopian price, no Ethiopian availability date and no birr figure, because none
// has been published — and a made-up birr price is the one thing a reader would act on.
//
// Internal links (the owner's instruction, 22 Sep 2026: every post from here links back into the site):
// the import-duty guide, the AI explainer published this morning, /ai, and the IT jobs category.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'googlebook-google-new-laptop-2026';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የGoogle ይፋዊ ማስታወቂያ (blog.google፣ መስከረም 11/2019 ዓ.ም — 21 September 2026)፣ Bloomberg እና VideoCardz። ዋጋዎቹና ቀኖቹ በሙሉ ከእነዚህ ምንጮች የተወሰዱ ናቸው። <strong>በኢትዮጵያ የሚሸጥበት ዋጋ ወይም ቀን እስካሁን አልታወቀም</strong> — ስለዚህ በብር የተጻፈ ግምት በዚህ ጽሑፍ ውስጥ የለም።</p>

<p><strong>Google ወደ ላፕቶፕ ገበያ በአዲስ መልክ ተመልሷል።</strong> መስከረም 11 ቀን 2019 ዓ.ም (21 September 2026) <em>Googlebook</em> የተባለ አዲስ የላፕቶፕ ዓይነት ቅድመ-ትዕዛዝ ተከፍቷል። ይህ የChromebook ተተኪ ሲሆን፣ የሚሠራውም <strong>Googlebook OS</strong> በሚባል — በAndroid ቴክኖሎጂ ላይ የተገነባ፣ የChromeOS ዴስክቶፕ መሠረት ያለው — አዲስ ኦፐሬቲንግ ሲስተም ነው።</p>

<h3>💻 አምስቱ የመጀመሪያ ሞዴሎችና ዋጋቸው</h3>
<ul>
<li><strong>Acer Googlebook 14 — $899</strong> (ዝቅተኛው ዋጋ)፦ Intel Core Ultra 5፣ እስከ 49 TOPS የNPU አቅም፣ 16GB ማህደረ ትውስታ፣ 512GB ማከማቻ፣ 14 ኢንች 2.8K OLED ንክኪ ስክሪን፣ እስከ 16 ሰዓት ባትሪ።</li>
<li><strong>Lenovo Googlebook 15 — $1,099</strong>፦ Intel Core Ultra 5፣ 16GB፣ 512GB።</li>
<li><strong>Dell XPS Googlebook — ከ$1,199 ጀምሮ</strong>።</li>
<li><strong>ASUS እና HP — ከ$1,299 ጀምሮ</strong> (የመጀመሪያዎቹ ውድ ሞዴሎች)።</li>
</ul>
<p>አምስቱም በአሜሪካ ገበያ <strong>16GB ማህደረ ትውስታ፣ 512GB ማከማቻ፣ የንክኪ ስክሪን፣ የሚበራ ኪቦርድና የጣት አሻራ አንባቢ</strong> ይዘው ይመጣሉ።</p>

<h3>📅 መቼ?</h3>
<ul>
<li><strong>ቅድመ-ትዕዛዝ፦</strong> መስከረም 11/2019 (21 Sep 2026) ተከፍቷል — በGoogle Store እና በBest Buy።</li>
<li><strong>ወደ መደብር፦</strong> መስከረም 24/2019 (4 October 2026) በአሜሪካ፤ መስከረም 25/2019 (5 October) በካናዳ፣ እንግሊዝ፣ አየርላንድ፣ ፈረንሳይ፣ ጀርመንና አውስትራሊያ።</li>
<li><strong>ኢትዮጵያ፦</strong> በዝርዝሩ ውስጥ የለችም። ይፋዊ የኢትዮጵያ ቀንም ሆነ ዋጋ አልወጣም።</li>
</ul>

<h3>✨ ከGemini ጋር የተሠራው ክፍል</h3>
<p>የGooglebook ልዩነት ሃርድዌሩ ብቻ አይደለም — Gemini በኦፐሬቲንግ ሲስተሙ ውስጥ ተሠርቷል፦</p>
<ul>
<li><strong>Magic Pointer</strong> — መዳፊቱን ማወዛወዝ Geminiን ይጠራል፤ በስክሪኑ ላይ ስላለው ነገር ይረዳል።</li>
<li><strong>Rambler</strong> — የተናገሩትን ወደ የተደራጀ ጽሑፍ ይለውጣል — ርዕሶችና ዝርዝሮች ጭምር። ለዚህ የተለየ <em>Rambler key</em> በኪቦርዱ ላይ አለ።</li>
<li><strong>Create My Widget</strong> — በተራ ቋንቋ የሚፈልጉትን ነግረው ዴስክቶፕዎ ላይ መሣሪያ ያሠራሉ።</li>
<li><strong>Glowbar</strong> — በውጭው በኩል ያለ የብርሃን መስመር፤ ሲከፈት ይበራል፣ የባትሪ መጠን ያሳያል፣ ከGemini ጋር ሲነጋገሩ ይንቀሳቀሳል።</li>
</ul>
<p>በደኅንነት በኩል Googlebook OS <strong>pKVM hypervisor</strong> ይጠቀማል — የLinux አካባቢዎችን ለይቶ የሚያሄድ፣ በLevel 5 የተመሰከረለት።</p>

<h3>🇪🇹 ለኢትዮጵያዊ ገዢ ምን ማለት ነው?</h3>
<p>ቀጥተኛ ሽያጭ የለም። ስለዚህ አማራጩ ማስመጣት ነው — እና እዚያ ላይ ዋጋው $899 ብቻ አይደለም። የጉምሩክ ቀረጥ፣ ታክስና የመላኪያ ወጪ ይታከላል። ስንት እንደሚሆን ከመገመት ይልቅ በራስዎ ማስላት ይሻላል፦ የ<a href="https://bina.et/customs-import-duty-ethiopia">የጉምሩክ ቀረጥና ታክስ መመሪያ</a> ላይ የሚሠራበትን ቀመር አስቀምጠናል።</p>
<p>ሁለተኛው ነጥብ፦ Googlebook ዋጋው ያለው ከGemini ጋር ተያይዞ ነው። Gemini በአማርኛ ይሠራል፤ ግን የኮምፒውተር ላይ ገጽታው በአማርኛ ምን ያህል እንደሚሠራ እስካሁን አልታየም። <a href="https://bina.et/news/llm-rag-ai-agent-agentic-ai-amharic">የዛሬው ጽሑፋችን</a> እንደገለጸው፣ ሞዴል መልስ መስጠቱና ሥራ መሥራቱ ሁለት የተለያዩ ነገሮች ናቸው።</p>
<p>ሦስተኛ፦ በኢትዮጵያ ለሚሠሩ የIT ባለሙያዎች ይህ ትልቅ ለውጥ ነው። የAndroid መተግበሪያዎች በላፕቶፕ ላይ በቀጥታ መሮጣቸው ማለት የAndroid ችሎታ ያለው ሰው የዴስክቶፕ ገበያም ላይ መሥራት ይችላል ማለት ነው። በbina.et ላይ አሁን ክፍት ያሉትን <a href="https://bina.et/jobs/category/it">የአይቲ ሥራዎች</a> ይመልከቱ።</p>

<h3>🤔 ቢኒ ምን ይላል?</h3>
<p>ስለ ዋጋ፣ ስለ ማስመጣት ወይም ስለ ቴክኖሎጂው በአማርኛ ጥያቄ ካለዎት <a href="https://bina.et/ai">ቢኒን</a> ወይም በቴሌግራም <a href="https://t.me/bina_smart_bot">@bina_smart_bot</a> ይጠይቁ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>What happened.</strong> On 21 September 2026 Google opened pre-orders for the Googlebook, a new laptop category replacing the Chromebook. It runs Googlebook OS — built on Android technology with ChromeOS desktop foundations — and ships from five makers.</p>
<p><strong>The line-up.</strong> Acer Googlebook 14 at $899 (Intel Core Ultra 5, up to 49 TOPS NPU, 16GB/512GB, 14-inch 2.8K OLED touchscreen, up to 16 hours); Lenovo Googlebook 15 at $1,099; Dell XPS Googlebook from $1,199; ASUS and HP from $1,299. All five US configurations carry 16GB of memory, 512GB of storage, a touchscreen, a backlit keyboard and a fingerprint reader.</p>
<p><strong>Dates.</strong> Pre-orders opened 21 September through the Google Store and Best Buy. On shelves 4 October in the US, and 5 October in Canada, the UK, Ireland, France, Germany and Australia. Ethiopia is not on the list, and no Ethiopian price or date has been published.</p>
<p><strong>What is actually new.</strong> Gemini is in the operating system, not an app on it: Magic Pointer (wiggle the cursor to ask Gemini about what is on screen), Rambler (speak, and it returns organised writing — there is a dedicated Rambler key), Create My Widget (describe a desktop tool in plain language and it is built), and the Glowbar on the lid that shows charge and animates when Gemini is spoken to. Underneath, a Level 5 certified pKVM hypervisor runs isolated Linux environments.</p>
<p><strong>For a buyer in Ethiopia.</strong> There is no local sale, so importing is the only route — and $899 is not the landed cost. Duty, tax and shipping are added on top; our <a href="https://bina.et/customs-import-duty-ethiopia">customs duty guide</a> holds the formula to work it out rather than guess. For developers, Android apps running natively on a laptop means Android skills now reach the desktop market — the open <a href="https://bina.et/jobs/category/it">IT vacancies</a> are here.</p>
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:14px;color:#5c5548"><strong>የምስሉ ማብራሪያ፦</strong> በዚህ ገጽ ላይ ያለው ምስል በBinaSmart የተሠራ ሥዕላዊ መግለጫ ነው እንጂ የGoogle ይፋዊ ፎቶ አይደለም። የምርቱን ትክክለኛ ፎቶዎች በGoogle ይፋዊ ገጽ ላይ ይመልከቱ።</p>
`.trim();

(async () => {
  const data = {
    title: 'Googlebook — Google\'s new laptop is here: $899 to $1,299, Gemini built into the operating system',
    titleAm: 'Googlebook — የGoogle አዲሱ ላፕቶፕ ወጣ፤ ከ$899 እስከ $1,299፣ Gemini በሲስተሙ ውስጥ',
    category: 'ቴክኖሎጂ',
    excerpt: 'Google መስከረም 11/2019 (21 Sep 2026) የGooglebook ቅድመ-ትዕዛዝ ከፈተ — የChromebook ተተኪ። አምስት ሞዴሎች ከAcer፣ ASUS፣ Dell፣ HP እና Lenovo፣ ከ$899 እስከ $1,299። Gemini በኦፐሬቲንግ ሲስተሙ ውስጥ፦ Magic Pointer፣ Rambler፣ Glowbar። ወደ መደብር መስከረም 24/2019። ኢትዮጵያ በዝርዝሩ የለችም — ስለ ማስመጣት ወጪው ምን ማወቅ እንዳለብዎ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '💻',
    readMinutes: 5,
    evergreen: false,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
