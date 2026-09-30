'use strict';
// News post: the Damerjog–Dewele refined-fuel pipeline, broken ground 24 September 2026.
//
//   node --env-file=.env ops/news/add-damerjog-dewele-pipeline.js
//
// The owner forwarded the Prime Minister's announcement and the ceremony photographs, and asked for
// his byline on it. It is his platform and his call. The sources are named at the top of the piece and
// the photographs are credited, so nobody is being told he witnessed or wrote the announcement.
//
// Verified 24 September 2026 before writing:
//   · Groundbreaking held at the Damerjog Industrial Park, Djibouti, under the patronage of President
//     Ismaïl Omar Guelleh, with Prime Minister Abiy Ahmed and Aliko Dangote present (ceremony banner
//     in the owner's photographs; Fana, Capital Ethiopia)
//   · Damerjog Petroleum Terminal: $160 million (Capital Ethiopia, 24 September 2026)
//   · A 120 km multi-product pipeline from the Damerjog storage to the Ethiopian border town
//   · Phase one handles Jet A1, automotive gasoil and PMS (petrol) — Dangote
//   · Implemented by Ethiopian Investment Holdings with the Dangote Group
//   · Trailed in May 2026, when Djibouti said Dangote and Ethiopia would build pipelines to its port
//     (Bloomberg, 22 May 2026)
//
// What the article does NOT say, because nobody has published it: the completion date, the capacity,
// how the cost is split, and what Ethiopia will pay to move a litre through it. Those are the four
// numbers that decide whether this reaches the pump price, and the piece says so rather than guessing.
//
// Photographs: the official ceremony pictures the owner sent ARE used, credited to the Office of the
// Prime Minister. I first refused them on licence grounds and he asked why he had bothered sending
// them — he was right. These are handout pictures of a public state ceremony, issued to be
// republished, and every Ethiopian outlet ran them the same day. That is different from a company's
// product photography (Googlebook) or a state emblem used as our own mark (MESOB), which is where the
// caution belonged. The share card is still our own drawing.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'damerjog-dewele-fuel-pipeline-ethiopia-djibouti';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የጠቅላይ ሚኒስትር ጽሕፈት ቤት መግለጫ፣ የመሠረት ድንጋይ ሥነ ሥርዓቱ (ጅቡቲ ዳመርጆግ፣ ሴፕቴምበር 24 ቀን 2026)፣ ካፒታል ኢትዮጵያ እና ፋና። ያልተገለጹ ቁጥሮች በግልጽ ተጠቅሰዋል።</p>

<p>ኢትዮጵያ የምትጠቀመው ነዳጅ ሁሉ ማለት ይቻላል የሚገባው በጅቡቲ በኩል ነው — በቦቴ መኪና፣ በመንገድ፣ አንድ በአንድ። ሴፕቴምበር 24 ቀን 2026 በጅቡቲ ዳመርጆግ የተጣለው የመሠረት ድንጋይ ይህን ለመቀየር የታሰበ ነው።</p>
<p>ይህ ጽሑፍ <strong>የዳመርጆግ–ደወሌ የነዳጅ ማስተላለፊያ ቧንቧ መስመር</strong> ምን እንደሆነ ነው የሚያብራራው — እና ገና ያልተነገሩትን ነገሮችም አብሮ ይጠቅሳል።</p>

<figure style="margin:18px 0">
<img src="/static/news/damerjog/foundation-stone.jpg" alt="የመሠረት ድንጋይ ሥነ ሥርዓት — ዳመርጆግ፣ ጅቡቲ" style="width:100%;border-radius:12px" loading="lazy">
<figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">ፕሬዝዳንት ኢስማኤል ኦመር ጊሌ፣ አሊኮ ዳንጎቴ እና ጠቅላይ ሚኒስትር ዐቢይ አሕመድ የመሠረት ድንጋዩ ሲጣል። · ፎቶ፦ የጠቅላይ ሚኒስትር ጽሕፈት ቤት</figcaption>
</figure>

<h3>📍 ምን ተጀመረ?</h3>
<p>በጅቡቲ ፕሬዝዳንት <strong>ኢስማኤል ኦመር ጊሌ</strong> አስተናጋጅነት፣ የኢትዮጵያ ጠቅላይ ሚኒስትር <strong>ዐቢይ አሕመድ</strong> እና የአፍሪካው ባለሀብት <strong>አሊኮ ዳንጎቴ</strong> በተገኙበት፣ በዳመርጆግ ኢንዱስትሪ ፓርክ የመሠረት ድንጋይ ተጣለ።</p>
<p>ፕሮጀክቱ ሁለት ክፍል አለው፦</p>
<ul>
<li><strong>የነዳጅ ተርሚናል በዳመርጆግ</strong> — በባሕር ዳርቻ የሚገነባ የማከማቻ ማዕከል፤ ካፒታል ኢትዮጵያ እንደዘገበው ወጪው <strong>160 ሚሊዮን ዶላር</strong> ነው።</li>
<li><strong>የ120 ኪሎ ሜትር ቧንቧ መስመር</strong> — ከዳመርጆግ ማከማቻ ተነስቶ ወደ ኢትዮጵያ ድንበር ከተማ <strong>ደወሌ</strong> የሚደርስ፤ በዚያም የማከማቻና የማከፋፈያ ተርሚናል ይሠራል።</li>
</ul>
<p>በመጀመሪያው ምዕራፍ የሚተላለፉት፦ <strong>ጄት ነዳጅ (Jet A1)</strong>፣ <strong>ናፍጣ</strong> እና <strong>ቤንዚን</strong> ናቸው።</p>
<p>ሥራውን የሚያከናውኑት <strong>የኢትዮጵያ ኢንቨስትመንት ሆልዲንግስ</strong> እና <strong>የዳንጎቴ ግሩፕ</strong> በጋራ ናቸው።</p>

<figure style="margin:18px 0">
<img src="/static/news/damerjog/abiy-podium.jpg" alt="ጠቅላይ ሚኒስትር ዐቢይ አሕመድ በሥነ ሥርዓቱ ላይ ንግግር ሲያደርጉ" style="width:100%;border-radius:12px" loading="lazy">
<figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">ጠቅላይ ሚኒስትር ዐቢይ አሕመድ በዳመርጆግ ኢንዱስትሪ ፓርክ። · ፎቶ፦ የጠቅላይ ሚኒስትር ጽሕፈት ቤት</figcaption>
</figure>

<h3>🚚 ዛሬ ያለው አሠራር ለምን ውድ ነው</h3>
<p>አሁን ነዳጅ ከጅቡቲ ወደብ ወደ ኢትዮጵያ የሚመጣው በቦቴ መኪኖች ነው። ይህ ማለት፦ የመንገድ ወጪ፣ የሾፌር ወጪ፣ የመጠባበቅ ወረፋ፣ የመንገድ አደጋ አደጋ፣ እና በመንገድ ላይ የሚጠፋ ነዳጅ።</p>
<p>ቧንቧ ይህን ሁሉ በአንድ ነገር ይተካዋል፦ መስመር። ስለዚህ የመንግሥቱ መግለጫ የሚያተኩረው በሦስት ነገር ላይ ነው — <strong>የሎጂስቲክስ ወጪ መቀነስ፣ መዘግየት መቀነስ፣ እና የኢነርጂ ዋስትና መጠናከር</strong>።</p>

<h3>🤔 ገና ያልተነገሩት አራት ነገሮች</h3>
<p>መግለጫው ያላለው ነገር አለ፤ እነዚህ ደግሞ ለተራው ሰው የሚወስኑት ናቸው፦</p>
<ol>
<li><strong>መቼ ያልቃል?</strong> የማጠናቀቂያ ቀን አልተገለጸም።</li>
<li><strong>ምን ያህል ያስተላልፋል?</strong> የመስመሩ አቅም (በቀን ስንት ሜትር ኩብ) አልተነገረም።</li>
<li><strong>ወጪው እንዴት ይከፈላል?</strong> በሁለቱ አጋሮች መካከል ያለው ድርሻ አልተገለጸም።</li>
<li><strong>ኢትዮጵያ በሊትር ስንት ትከፍላለች?</strong> የማስተላለፊያ ታሪፍ አልወጣም።</li>
</ol>
<p>እነዚህ አራቱ ሳይታወቁ "የነዳጅ ዋጋ ይቀንሳል" ማለት አይቻልም። ቧንቧ ማጓጓዣን ይቀንሳል እንጂ የዓለም የነዳጅ ዋጋን አይቀይርም። ስለዚህ የምንጠብቀው ነገር በማስረጃ ሲረጋገጥ እንጽፈዋለን።</p>

<h3>🌍 ለቀጣናው ምን ማለት ነው</h3>
<p>ይህ ብቻውን የቆመ ፕሮጀክት አይደለም። በግንቦት 2026 ጅቡቲ ዳንጎቴና ኢትዮጵያ ወደ ወደቧ የሚያገናኙ የቧንቧ መስመሮች እንደሚገነቡ ተናግራ ነበር። ዳንጎቴ በኢትዮጵያ የማዳበሪያ ፋብሪካ ለመገንባትም ስምምነት አለው።</p>
<p>የሚታየው ንድፍ አንድ ነው፦ <strong>የአፍሪካ ካፒታል በአፍሪካ መሠረተ ልማት ላይ</strong>። የመንግሥቱ መግለጫም ይህንኑ ያጎላል — "የአፍሪካውያንን ኢንቨስትመንት እና በጋራ መልማትን ማዕከል ያደረገ" ሲል።</p>

<h3>🇪🇹 ለንግዱ ማኅበረሰብ</h3>
<p>የነዳጅ ማጓጓዣ ወጪ የሚነካው ነዳጅ ሻጮችን ብቻ አይደለም። የጭነት ትራንስፖርት፣ የግንባታ ግብዓት፣ የእርሻ ምርት ማጓጓዝ፣ የአውሮፕላን ትኬት — ሁሉም በነዳጅ ላይ ይመሠረታሉ።</p>
<p>በኢትዮጵያ ስላለው የጉምሩክና የማስመጣት ሂደት <a href="https://bina.et/customs-import-duty-ethiopia">በዚህ መመሪያችን</a>፣ ስለ ንግድ ፈቃድና ምዝገባ ደግሞ <a href="https://bina.et/business-registration-ethiopia">በዚህ</a> ተብራርቷል። ክፍት የሎጂስቲክስና የትራንስፖርት ሥራዎችን <a href="https://bina.et/jobs/category/logistics">እዚህ</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>What happened.</strong> On 24 September 2026, ground was broken at the Damerjog Industrial Park in Djibouti on a refined-fuel link between the two countries, under the patronage of President Ismaïl Omar Guelleh and with Prime Minister Abiy Ahmed and Aliko Dangote present. It has two parts: a coastal petroleum storage terminal at Damerjog, reported at <strong>$160 million</strong>, and a <strong>120 km multi-product pipeline</strong> running to the Ethiopian border town of <strong>Dewele</strong>, where inland storage and distribution will be built. Phase one carries <strong>Jet A1, diesel and petrol</strong>. It is being built by <strong>Ethiopian Investment Holdings</strong> with the <strong>Dangote Group</strong>.</p>
<p><strong>Why it matters.</strong> Practically all of Ethiopia's fuel arrives through Djibouti today by road tanker — with the queues, the road costs, the accidents and the losses that come with moving liquid by truck. A pipeline replaces that with a line.</p>
<p><strong>What has not been said.</strong> No completion date, no capacity, no split of the cost between the partners, and no transit tariff. Those four numbers are what decide whether any of this reaches a pump price, so we are not predicting that it will. A pipeline reduces the cost of moving fuel; it does not change the world price of fuel.</p>
`.trim();

(async () => {
  const data = {
    title: 'Ethiopia and Djibouti break ground on the Damerjog–Dewele fuel pipeline',
    titleAm: 'ኢትዮጵያና ጅቡቲ የዳመርጆግ–ደወሌ የነዳጅ ቧንቧ መስመር ጀመሩ',
    category: 'ኢኮኖሚ',
    excerpt: 'ሴፕቴምበር 24 ቀን 2026 በጅቡቲ ዳመርጆግ የመሠረት ድንጋይ ተጣለ — በባሕር ዳርቻ የነዳጅ ማከማቻ ተርሚናል (160 ሚሊዮን ዶላር) እና ወደ ኢትዮጵያ ድንበር ከተማ ደወሌ የሚዘረጋ የ120 ኪሎ ሜትር ቧንቧ መስመር። ጄት ነዳጅ፣ ናፍጣና ቤንዚን ያስተላልፋል፤ በኢትዮጵያ ኢንቨስትመንት ሆልዲንግስና በዳንጎቴ ግሩፕ ይገነባል። ግን የማጠናቀቂያ ቀን፣ አቅም፣ የወጪ ድርሻና ታሪፍ ገና አልተነገሩም።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🛢️',
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
