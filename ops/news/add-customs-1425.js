'use strict';
// News post: Customs Proclamation (Further Amendment) No. 1425/2026.
//
// Source: Federal Negarit Gazette, 32nd Year No. 42, 23 July 2026, pages 19856–19873, forwarded by
// the Ethiopian Customs Commission (ref. 4/032a/19). The gazette is a scanned PDF with no text
// layer and sits on ecc.gov.et, which is unreachable from outside Ethiopia — so as of 5 Sep 2026 no
// searchable copy of this law exists online. A copy of the PDF is kept at
// /root/legal-sources/customs-proclamation-1425-2026.pdf.
//
// Every article number and figure below was checked against the page image, not the OCR. Two
// provisions readable only through OCR (Art. 118 security types, Art. 62 contraband proceeds) are
// deliberately left out.
//
//   node ops/news/add-customs-1425.js         create or update the post
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'customs-proclamation-1425-2026';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የፌዴራል ነጋሪት ጋዜጣ፣ 32ኛ ዓመት ቁጥር 42፣ ሐምሌ 16 ቀን 2018 ዓ.ም (23 July 2026)፣ ገጽ 19856–19873። ይህ ጽሑፍ የአዋጁን ዋና ዋና ለውጦች በቀላል ቋንቋ የሚያብራራ ማጠቃለያ ነው እንጂ የሕግ ምክር አይደለም። ለውሳኔ ሁልጊዜ የአዋጁን ሙሉ ጽሑፍ ወይም ባለሙያ ያማክሩ።</p>

<p><strong>ኢትዮጵያ የጉምሩክ ሕጓን አሻሽላለች።</strong> <em>የጉምሩክ አዋጅ (እንደተሻሻለ) እንደገና ለማሻሻል የወጣ አዋጅ ቁጥር 1425/2018</em> — በእንግሊዝኛው <em>Proclamation No. 1425/2026</em> — በፌዴራል ነጋሪት ጋዜጣ ላይ ታትሞ ከ<strong>ሐምሌ 16 ቀን 2018 ዓ.ም (23 July 2026)</strong> ጀምሮ ተፈጻሚ ሆኗል። አዋጁ የተፈረመው በፕሬዚዳንት ታዬ አጽቀሥላሴ ነው።</p>

<p>የሚያሻሽለው <strong>የጉምሩክ አዋጅ ቁጥር 859/2006 (859/2014)</strong>ን ነው — ከ2006 ዓ.ም ጀምሮ የኢትዮጵያ ጉምሩክ ሥርዓት መሠረት የሆነውን ሕግ። ስለዚህ ዛሬ "የጉምሩክ አዋጅ 859/2014" ብቻ የሚጠቅስ ማንኛውም ጽሑፍ ጊዜው ያለፈበት ነው።</p>

<h3>🎯 አዋጁ ለምን ወጣ?</h3>
<p>አዋጁ በመግቢያው ላይ አራት ምክንያቶችን ይጠቅሳል፦ የገቢና ወጪ ንግድን ማቅለል፤ የጉምሩክ ሥርዓቱን ኢትዮጵያ ከፈረመቻቸው ዓለም አቀፍ፣ አህጉራዊና ቀጣናዊ ስምምነቶች ጋር ማጣጣም፤ <strong>አስመጪዎች የቀረጥና የታክስ ውሳኔን ለመቃወም የሚያጋጥማቸውን መሰናክል ማስወገድ</strong>፤ እና የኮንትሮባንድ ንግድን መከላከል።</p>

<h3>📦 ለአስመጪዎች ትልልቆቹ ለውጦች</h3>

<h4>1. ዕቃን ከፊል መልቀቅ ይቻላል — አንቀጽ 25(5)</h4>
<p>እስካሁን በአንድ ዲክላሬሽን የገባ ዕቃ በሙሉ አንድ ላይ ነበር የሚለቀቀው። አሁን አስመጪው "ቀረጡን በሙሉ አንድ ጊዜ መክፈል አልችልም" ብሎ ከፊል መልቀቅ ሲጠይቅ፣ <strong>ለሚለቀቀው ክፍል ብቻ ቀረጥና ታክስ መከፈሉ ተረጋግጦ</strong> ያ ክፍል ይለቀቃል። ለትንንሽ አስመጪዎችና ለመኪና አስመጪዎች ትልቅ እፎይታ ነው።</p>

<h4>2. ዕቃ በመጋዘን የሚቆይበት ጊዜ — አንቀጽ 51</h4>
<ul>
<li>🚢 <strong>በባሕር ወይም በየብስ</strong> የገባ ዕቃ ከጊዜያዊ የጉምሩክ መጋዘን በ<strong>45 ቀን</strong> ውስጥ መውጣት አለበት።</li>
<li>✈️ <strong>በአየር</strong> የገባ ዕቃ በ<strong>30 ቀን</strong> ውስጥ።</li>
<li>መዘግየቱ በጉምሩክ ቁጥጥር፣ በአስተዳደራዊ እርምጃ ወይም ከአቅም በላይ በሆነ ምክንያት ከሆነ ጊዜው ይራዘማል።</li>
<li>በጊዜው ያልወጣ ዕቃ ወደ <strong>የመንግሥት ጉምሩክ መጋዘን</strong> ይዛወራል — ግን ባለቤቱ ከመሸጡ በፊት ቀረጡን፣ ታክሱንና ወጪውን ከፍሎ የመውሰድ መብት አለው (አንቀጽ 51(8))።</li>
</ul>

<h4>3. የዋጋ ዳታቤዝ "ዝቅተኛ ዋጋ" አይደለም — አንቀጽ 89(5)</h4>
<p>ይህ ለብዙ አስመጪዎች ትልቁ ዜና ነው። ጉምሩክ ኮሚሽን የዋጋ ዳታቤዝ መጠቀም ይችላል — ግን <strong>ለስጋት ግምገማና ለማረጋገጫ ብቻ</strong>። አዋጁ በግልጽ እንዲህ ይላል፦ ዳታቤዙ "እንደ ቋሚ ወይም ዝቅተኛ ዋጋ ሆኖ አያገለግልም፤ በዚህ አዋጅ የተቀመጡትን የዋጋ አወሳሰን ዘዴዎችም አይተካም።" ከዳታቤዙ የሚገኘው መረጃ የሚጠቅመው የተገለጸው ዋጋ ምክንያታዊ መሆኑን ለመገምገም ብቻ ነው። በተጨማሪም የገንዘብ ሚኒስቴር የሚያወጣው መመሪያ ከአንቀጽ 90–95 ውጪ አዲስ የዋጋ አወሳሰን ዘዴ መፍጠር አይችልም (አንቀጽ 89(4))።</p>

<h4>4. ዋጋዎ ሲቀር በጽሑፍ ምክንያት የማግኘት መብት — አንቀጽ 99</h4>
<p>ኮሚሽኑ የገለጹት የግብይት ዋጋ ትክክል አይደለም ብሎ ከጠረጠረ ተጨማሪ ማስረጃ ሊጠይቅ ይችላል። ነገር ግን <strong>በጽሑፍ ሲጠየቅ የወሰነውን ዋጋ ምክንያት በጽሑፍ የመስጠት ግዴታ አለበት</strong>፣ እና <strong>የመጨረሻ ውሳኔ ከመሰጠቱ በፊት አስመጪው መልስ የመስጠት ዕድል ማግኘት አለበት</strong> (አንቀጽ 99(3))።</p>

<h4>5. የምንዛሪ ተመን — አንቀጽ 101</h4>
<p>የጉምሩክ ዋጋ የሚሰላው <strong>ዲክላሬሽኑ ለጉምሩክ ኮሚሽን ቀርቦ ተቀባይነት ባገኘበት ቀን</strong> የኢትዮጵያ ብሔራዊ ባንክ ባወጣው <strong>አመላካች የምንዛሪ ተመን</strong> ነው። ብር በየቀኑ በሚለዋወጥበት ወቅት የትኛው ቀን እንደሚቆጠር ማወቅ ወሳኝ ነው።</p>

<h4>6. የመነሻ ሀገር ምልክት በእንግሊዝኛ — አንቀጽ 107</h4>
<p>የሚገባ ዕቃ ሁሉ የመነሻ ሀገሩ ስም <strong>በእንግሊዝኛ</strong>፣ በቀላሉ በማይጠፋ፣ በማይወገድ ወይም በማይለወጥ መንገድ በእያንዳንዱ ዕቃ ወይም በማሸጊያው ላይ መለጠፍ አለበት። ለንግድ ያልሆኑ የግል ዕቃዎች ላይ አይተገበርም (አንቀጽ 107(2))። ዝርዝሩን የገንዘብ ሚኒስቴር በመመሪያ ያወጣል።</p>

<h4>7. ተመላሽ ገንዘብ — በአንድ ዓመት ውስጥ — አንቀጽ 123(2)</h4>
<p>የቀረጥና ታክስ ተመላሽ ጥያቄ ተቀባይነት የሚያገኘው የጉምሩክ ሥነ ሥርዓቱ ተጠናቅቆ ዲክላሬሽኑ ከተዘጋበት ቀን ጀምሮ <strong>በአንድ ዓመት ውስጥ</strong> ከቀረበ ብቻ ነው። ዕቃው ወደ ሀገር እንደማይገባ ከተረጋገጠ፣ ዲክላሬሽኑ ከሲስተም ከተሰረዘበት ቀን ይቆጠራል።</p>

<h4>8. ይግባኝ ለማለት 50% መክፈል — አንቀጽ 155(2)</h4>
<p>ይግባኙ የቀረጥና ታክስ ክፍያን የሚመለከት ከሆነ፣ የፌዴራል ታክስ ይግባኝ ኮሚሽን ይግባኙን የሚቀበለው <strong>ከተከራከረው ቀረጥና ታክስ 50% (ሃምሳ በመቶ) ከተከፈለ</strong> ብቻ ነው። ይግባኝ ከማለትዎ በፊት ይህን ያቅዱ።</p>

<h3>🚛 ለአጓጓዦችና ለተሽከርካሪ ባለቤቶች</h3>
<ul>
<li><strong>ኮንትሮባንድ የያዘ ተሽከርካሪ (አንቀጽ 147(3))</strong> — ዕቃ ለመደበቅ የተሠራ ወይም የተሻሻለ ተሽከርካሪ ሊወረስ ይችላል። ኮንትሮባንድ ተይዞበት የተገኘ ተሽከርካሪ ባለቤት እንደ ጥፋቱ ክብደትና እንደ ዕቃው መጠን የገንዘብ ቅጣት ወይም እስከ መወረስ የሚደርስ ቅጣት ሊጣልበት ይችላል። ነገር ግን <strong>ከመወረሱ በፊት ባለቤቱ ማሳወቂያ ተሰጥቶት ማስረጃ ወይም ማብራሪያ የማቅረብ ዕድል ማግኘት አለበት</strong>።</li>
<li><strong>የአጓጓዦች ግዴታ (አንቀጽ 160)</strong> — የተሳፋሪ ወይም የጭነት ማኒፌስት በጊዜው አለማቅረብ፣ ያልተፈቀደለት ሰው ወደ ተሽከርካሪው እንዲገባ መፍቀድ፣ ወይም እንዲነሳ ከታዘዘ በኋላ ያለ ፈቃድ መዘግየት — ከ<strong>ብር 4,000 እስከ 10,000</strong> ቅጣት። ወደ ጉምሩክ ወደብ ከደረሰ በኋላ ያለ ጉምሩክ ባለሥልጣን ፈቃድ መጫን ወይም ማውረድ — ከ<strong>ብር 15,000 እስከ 20,000</strong>።</li>
</ul>

<h3>🔍 የዕቃ ምርመራ — አንቀጽ 23</h3>
<p>ኮሚሽኑ ዕቃን በሙሉ፣ በከፊል ወይም ናሙና በመውሰድ ሊመረምር ይችላል፤ ምርመራው በስካነር፣ በላቦራቶሪ ትንተና፣ በአካል ወይም በሌላ መንገድ ሊሆን ይችላል። የሰነድ ምርመራም ሆነ የተመረመረን ዕቃ እንደገና መመርመር ተፈቅዷል። በተጨማሪ የቅድሚያ ታሪፍ አያያዝ (preferential origin — ለምሳሌ በአፍሪካ ነጻ የንግድ ቀጣና ወይም COMESA) አሁን በስምምነቶቹ ሕጎች ብቻ ይመራል፣ ኮሚሽኑም የመነሻ ማስረጃ የሚያወጣና የሚያረጋግጥ ብቸኛ አካል ነው (አንቀጽ 108)።</p>

<h3>🚗 መኪና እያስመጡ ነው?</h3>
<p>ከላይ ካሉት ውስጥ አምስቱ በቀጥታ የመኪና አስመጪዎችን ይነካሉ፦ ከፊል መልቀቅ፣ የ45 ቀን የመጋዘን ገደብ፣ የዋጋ ዳታቤዝ ዝቅተኛ ዋጋ አለመሆኑ፣ የምንዛሪ ተመን ቀን፣ እና የመነሻ ሀገር ምልክት። ሙሉ መመሪያውን <a href="/import-car-to-ethiopia">መኪና ወደ ኢትዮጵያ እንዴት ማስመጣት</a> ላይ ያንብቡ፤ ቀረጡን ለማስላት <a href="/customs-import-duty-ethiopia">የጉምሩክ ቀረጥ ማስያ</a>ን ይጠቀሙ።</p>

<h3>🇬🇧 In English — what changed</h3>
<p><strong>Customs Proclamation (as Amended) Further Amendment No. 1425/2026</strong> amends Customs Proclamation No. 859/2014. Published in the Federal Negarit Gazette, 32nd Year No. 42, and in force from <strong>23 July 2026</strong>.</p>
<ul>
<li><strong>Partial release</strong> (Art. 25/5): an importer who cannot pay all duties at once may release part of a shipment after paying the duties on that part.</li>
<li><strong>Storage deadlines</strong> (Art. 51): 45 days for sea/land imports, 30 days for air, extended for customs controls or force majeure; unclaimed goods move to a government customs warehouse, and the owner may still collect them before disposal on paying what is due.</li>
<li><strong>Valuation databases are not minimum values</strong> (Art. 89/5): they may be used only for risk management and to decide whether a declared value needs further inquiry. A Ministry of Finance directive cannot add valuation methods beyond Articles 90–95 (Art. 89/4).</li>
<li><strong>Written reasons and a right to respond</strong> (Art. 99/3) before a declared value is finally rejected.</li>
<li><strong>Exchange rate</strong> (Art. 101): the NBE indicative rate on the date the declaration is submitted to and accepted by the Commission.</li>
<li><strong>Origin marking in English</strong> (Art. 107), indelibly, on each good or its package; personal-use items exempt.</li>
<li><strong>Refund claims within one year</strong> (Art. 123/2).</li>
<li><strong>Appeals on duties require 50% paid</strong> (Art. 155/2) before the Federal Tax Appeal Commission admits the appeal.</li>
<li><strong>Vehicles carrying contraband</strong> (Art. 147/3): fine or confiscation, with prior notice and a chance to explain.</li>
<li><strong>Carrier fines</strong> (Art. 160): ETB 4,000–10,000 for manifest and departure offences; ETB 15,000–20,000 for loading or unloading without a customs officer.</li>
</ul>

<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:14px;color:#5c5548"><strong>ስለ ምንጩ፦</strong> አዋጁ የታተመው በስካን የተደረገ PDF ሆኖ ነው፤ ጽሑፉ በፍለጋ ሞተሮች አይነበብም። ይህ ገጽ በኢትዮጵያ ጉምሩክ ኮሚሽን (ecc.gov.et፣ ስልክ +251 116 67 54 58) ከተሰራጨው ኦፊሴላዊ ቅጂ ተነብቦ ተዘጋጅቷል። የተጠቀሱት አንቀጾች በሙሉ ከጋዜጣው ገጾች ጋር ተመሳክረዋል።</p>
`.trim();

(async () => {
  const data = {
    title: 'Ethiopia Amends Its Customs Law — Proclamation 1425/2026: What Importers Need to Know',
    titleAm: 'የጉምሩክ አዋጅ ተሻሻለ — አዋጅ 1425/2018፤ አስመጪዎች ማወቅ ያለባቸው ነገር',
    category: 'ንግድ',
    excerpt: 'ከሐምሌ 16/2018 (23 July 2026) ጀምሮ ተፈጻሚ የሆነው አዲሱ የጉምሩክ አዋጅ ከፊል መልቀቅ፣ የ45/30 ቀን የመጋዘን ገደብ፣ የዋጋ ዳታቤዝ ዝቅተኛ ዋጋ አለመሆኑን፣ የምንዛሪ ተመን ቀን፣ የአንድ ዓመት ተመላሽ ገደብና የ50% ይግባኝ ቅድመ ክፍያን ያመጣል። ከነጋሪት ጋዜጣ ተመሳክሮ የተዘጋጀ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🛃',
    readMinutes: 7,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
