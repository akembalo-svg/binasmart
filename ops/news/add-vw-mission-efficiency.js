'use strict';
// News post: Volkswagen Mission Efficiency — written by Ibrahim Kedir Bedru, facts checked by the desk.
//
//   node --env-file=.env ops/news/add-vw-mission-efficiency.js
//
// Verified against Volkswagen's own newsroom, 24 September 2026, before publishing under his name:
//   · 54.9 kWh net battery, charged once, 1,278.36 km Wolfsburg → Poznań → Olomouc → Vienna
//   · 164.0 km of range remaining at the destination
//   · real-world 7.51 kWh/100 km incl. charging losses, 6.89 without; a separate "ideal trip" figure
//     of 6.48 kWh/100 km at a constant 68 km/h is VW's third record — kept out to avoid confusing the
//     two, since his draft used the real-drive numbers
//   · Cd 0.158 — VW's claim: lowest of any road-approved car
//   · near-production concept on the MEB+ platform, sharing parts with the ID. Polo AND ID. Cross
//   · APP290 front motor, 370 W roof/rear solar (up to ~30 km/day), bring-your-own-device infotainment
//   · VW frames it as three efficiency world records (aero, ideal-trip consumption, the long drive)
//
// Photographs: the owner sent Volkswagen's press images and asked for all of them to be used. They are
// Volkswagen press/newsroom photographs of the concept, credited to Volkswagen — editorial use in a
// news story about the car. His instruction, his platform; the share image is a real VW photo too.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'vw-mission-efficiency-ev-amharic';
const IMG = '/static/news/vw-mission-efficiency';
const cap = 'ፎቶ፦ Volkswagen';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> Volkswagen Newsroom (የካምፓኒው ኦፊሴላዊ መግለጫ)፣ ሴፕቴምበር 2026። ቁጥሮቹ ከ Volkswagen ራሱ የተገኙ ናቸው።</p>

<figure style="margin:8px 0 18px"><img src="${IMG}/vw2.jpg" alt="Volkswagen Mission Efficiency — front" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">Volkswagen Mission Efficiency — የሙከራ (concept) መኪና። ${cap}</figcaption></figure>

<p>የኤሌክትሪክ መኪና ሲታሰብ ብዙዎቻችን መጀመሪያ የምንጠይቀው “ባትሪው ስንት kWh ነው?” የሚል ነው። 100? 120? 150?</p>
<p>Volkswagen በአዲሱ <strong>Mission Efficiency</strong> ሌላ ጥያቄ አቀረበ፦ “ባትሪውን ከማሳደግ ይልቅ እያንዳንዱን የኃይል አሃድ በሚገባ ብንጠቀምስ?”</p>
<p>ይህ የሙከራ መኪና <strong>54.9 kWh</strong> ባትሪ ብቻ ይዞ፣ በኦፊሴላዊ ሙከራ <strong>1,278.36 ኪ.ሜ.</strong> ተጓዘ — ባትሪው በጉዞው አንድ ጊዜ ብቻ ተሞልቶ። መድረሻው ላይ ደግሞ <strong>164 ኪ.ሜ.</strong> የሚሆን ተጨማሪ አቅም ተርፎት ነበር።</p>

<h3>⚡ Mission Efficiency ምንድነው?</h3>
<p>ለሽያጭ የቀረበ መደበኛ ሞዴል አይደለም። <em>near-production concept</em> ነው — ማለትም አብዛኛውን የምርት ቴክኖሎጂ የሚጠቀም የሙከራ መኪና፣ Volkswagen የወደፊት EVዎቹ ምን ያህል ቀልጣፋ ሊሆኑ እንደሚችሉ ለማሳየት የሠራው። መሠረቱ <strong>MEB+</strong> ፕላትፎርም ነው፤ ከ<strong>ID. Polo</strong> እና <strong>ID. Cross</strong> ጋር ብዙ ክፍሎችን ይጋራል።</p>

<figure style="margin:18px 0"><img src="${IMG}/vw1.jpg" alt="Volkswagen Mission Efficiency — front, side and rear" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">ከፊት፣ ከጎንና ከኋላ — ረጅም፣ ዝቅተኛና የተዘጋ አካል፣ ሁሉም ለአየር ቅልጥፍና። ${cap}</figcaption></figure>

<h3>🪫 54.9 kWh ብቻ፣ 1,278 ኪ.ሜ. እንዴት?</h3>
<p>Volkswagen ባትሪ በመጨመር ላይ አልተመካችም። ይልቁንም፦ የአየር መቋቋምን ቀነሰች፣ ክብደትን ቀነሰች፣ ሞተሩን አሻሻለች፣ የኃይል መመለሻን (regenerative braking) አስተካከለች፣ የፀሐይ ኃይል ጨመረች፣ እና ከመኪናው ስር ያለውን ክፍል ሸፈነች። ዓላማው አንድ ነው፦ <strong>እያንዳንዱን kWh በተቻለ መጠን ረጅም ማድረግ</strong>።</p>

<h3>🌬️ Cd 0.158 — የአየር መቋቋም</h3>
<p>መኪና በፍጥነት ስትሄድ አየር ይቃወማታል፤ አየሩን ለመቁረጥ ብዙ ኃይል ከጠየቀ ባትሪው በፍጥነት ይሟጠጣል። <strong>Cd 0.158</strong> ማለት ይህ መቋቋም እጅግ ዝቅተኛ ነው ማለት ነው — Volkswagen እንደሚለው በመንገድ ላይ ለመሄድ ፈቃድ ካገኙ መኪኖች ሁሉ ዝቅተኛው። ረጅሙ ዝቅተኛ አካል፣ የተዘጉ የኋላ ጎማዎችና የተሸፈነ የታችኛው ክፍል ለዚህ ናቸው።</p>

<figure style="margin:18px 0"><img src="${IMG}/vw3.jpg" alt="Volkswagen Mission Efficiency — aerodynamic profile" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">የመኪናው ቅርፅ ራሱ የቅልጥፍና መሣሪያ ነው። ${cap}</figcaption></figure>

<h3>🔋 6.89 kWh/100 ኪ.ሜ.</h3>
<p>ከ Wolfsburg (ጀርመን) ተነስቶ በፖላንድ (Poznań) እና በቼክ (Olomouc) አድርጎ ወደ ቪየና የተደረገው 1,278.36 ኪ.ሜ. ጉዞ የመዘገበው፦ <strong>6.89 kWh/100 ኪ.ሜ.</strong> (የቻርጅ ኪሳራ ሳይጨምር)፣ ከቻርጅ ኪሳራ ጋር <strong>7.51 kWh/100 ኪ.ሜ.</strong>። አማካይ ፍጥነቱ 67.7 ኪ.ሜ./ሰ ነበር።</p>
<p>Volkswagen ይህን ጉዞ ከሁለት ተጨማሪ ውጤቶች ጋር <strong>ሦስት የዓለም ክብረ ወሰን</strong> ብሎ ያቀርበዋል፦ የአየር ቅልጥፍና (Cd 0.158)፣ በተመቻቸ ጉዞ 6.48 kWh/100 ኪ.ሜ. ፍጆታ፣ እና ይህ ረጅም መንገድ።</p>

<h3>☀️ ፀሐይም አጋር ናት</h3>
<p>በጣሪያውና በኋላ መስታወት ላይ <strong>370 ዋት</strong> የፀሐይ ስርዓት አለው። ዋናውን ባትሪ በቀጥታ ከመሙላት ይልቅ ሌሎች የመኪናውን የኤሌክትሪክ ፍላጎቶች ሸፍኖ ከባትሪው የሚወሰደውን ይቀንሳል፤ Volkswagen እንደሚገምተው እንደ አየሩ ሁኔታ <strong>እስከ 30 ኪ.ሜ.</strong> ተጨማሪ የቀን አቅም ሊሰጥ ይችላል።</p>

<h3>⚙️ ሞተሩ</h3>
<p>APP290 ኤሌክትሪክ ሞተር፣ 99 kW (135 PS)፣ 264 Nm፣ የፊት ጎማ ኃይል፣ 105 kW ከፍተኛ DC ቻርጅ፣ 160 ኪ.ሜ./ሰ ከፍተኛ ፍጥነት፣ ከ0–100 በ9 ሰከንድ ገደማ። መልእክቱ ግልጽ ነው፦ <strong>ዓላማው ፍጥነት ሳይሆን ኃይልን በብልህነት መጠቀም ነው</strong>።</p>

<h3>📱 የራስዎ ስልክ = ስክሪኑ</h3>
<p>ቋሚ የ infotainment ስክሪን ከመግጠም ይልቅ <strong>“Bring your own device”</strong> አቀራረብ ተጠቅሟል — የራስዎን Android ወይም iPhone/tablet እንደ ስክሪን ይጠቀማሉ። ይህ ክብደትን፣ ወጪንና ተጨማሪ ሃርድዌርን ይቀንሳል።</p>

<figure style="margin:18px 0"><img src="${IMG}/vw5.jpg" alt="Volkswagen Mission Efficiency — interior" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">ውስጠኛው ክፍል — ቋሚ ስክሪን የለም፤ ስልክዎ ቦታውን ይይዛል። ${cap}</figcaption></figure>

<h3>🚘 የXL1 መንፈስ</h3>
<p>Volkswagen ቀደም ሲል በ XL1 ሞዴል በእጅግ ዝቅተኛ ፍጆታ ትታወቅ ነበር። Mission Efficiency ያንኑ ፍልስፍና በኤሌክትሪክ ዘመን የሚያሳይ ነው፦ “ብዙ ኃይል ከመጨመር ይልቅ ትንሹን በብልህነት ተጠቀም።”</p>

<figure style="margin:18px 0"><img src="${IMG}/vw4.jpg" alt="Volkswagen Mission Efficiency — rear three-quarter" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">${cap}</figcaption></figure>

<h3>🇪🇹 ለኢትዮጵያ ምን ማለት ነው?</h3>
<p>የኢትዮጵያ የኤሌክትሪክ መኪና ገበያ እያደገ ነው። ትምህርቱ ግልጽ ነው፦ ጥያቄው “ባትሪው ስንት kWh ነው?” ብቻ መሆን የለበትም፤ <strong>“እያንዳንዱ kWh ስንት ኪ.ሜ. ያጓዛል?”</strong> የሚለውም እኩል ይመዝናል። ኃይል ቆጣቢነት፣ የቻርጅ መሠረተ ልማትና የፀሐይ ኃይል መዋሃድ ወደፊት የበለጠ የሚነሱ ጉዳዮች ናቸው።</p>
<p>መኪና ወደ ኢትዮጵያ ሲገባ ስለሚያስከትለው የጉምሩክ ቀረጥ <a href="https://bina.et/customs-import-duty-ethiopia">በዚህ መመሪያችን</a> ተብራርቷል። ስለ AI እና ቴክኖሎጂ ሌሎች ጽሑፎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a> ያግኙ፤ በምህንድስና ዘርፍ ክፍት ሥራዎችን <a href="https://bina.et/jobs/category/engineering">እዚህ</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>Volkswagen's <strong>Mission Efficiency</strong>, a near-production concept on the MEB+ platform (sharing parts with the ID. Polo and ID. Cross), drove <strong>1,278.36 km on a single charge</strong> of a <strong>54.9 kWh</strong> battery — Wolfsburg to Vienna via Poland and Czechia — and still had 164 km of range left. Real-world consumption was <strong>7.51 kWh/100 km including charging losses</strong> (6.89 without). Its drag coefficient of <strong>Cd 0.158</strong> is, VW says, the lowest of any road-approved car. A 370 W solar system adds up to ~30 km of daily range, and instead of a fixed infotainment screen it uses your own phone. The point is not a bigger battery — it is using every kWh well. VW presents it as three efficiency world records. It is not for sale; it is a statement about where efficient EVs could go.</p>
`.trim();

(async () => {
  const data = {
    title: 'Volkswagen Mission Efficiency — 1,278 km on a 54.9 kWh battery',
    titleAm: '54.9 kWh ብቻ፣ 1,278 ኪ.ሜ. — Volkswagen የ“ትልቅ ባትሪ” ሀሳብን ተገዳደረ',
    category: 'ቴክኖሎጂ',
    excerpt: 'Volkswagen Mission Efficiency የተባለው የሙከራ መኪና 54.9 kWh ባትሪ ብቻ ይዞ 1,278.36 ኪ.ሜ. በአንድ ሙሌት ተጓዘ — Cd 0.158 የአየር መቋቋም፣ 6.89 kWh/100 ኪ.ሜ. ፍጆታ፣ 370 ዋት የፀሐይ ኃይል። ቁልፉ ትልቅ ባትሪ ሳይሆን እያንዳንዱን kWh በብልህነት መጠቀም ነው። ለኢትዮጵያ ትምህርቱ፦ “ባትሪው ስንት kWh ነው?” ሳይሆን “እያንዳንዱ kWh ስንት ኪ.ሜ. ያጓዛል?”',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🚗',
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
