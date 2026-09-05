'use strict';
// News post: Investment Incentive Regulation No. 586/2026 — tax holidays replaced by reduced rates.
//
// Source: Council of Ministers Regulation No. 586/2026, Federal Negarit Gazette 32nd Year No. 17,
// Addis Ababa, 23 February 2026 (የካቲት 16/2018), signed by PM Abiy Ahmed; in force on publication.
// Copy at /root/legal-sources/investment-incentive-regulation-586-2026.pdf (text layer present).
// Every article and figure below was read from the regulation's own English column. The annexed
// Table 1 (sectors and years for the 15% rate) and Table 2 (eligible capital goods) did not extract
// as text, so this post names them without quoting their contents.
//
//   node ops/news/add-investment-586.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const slug = 'investment-incentive-regulation-586-2026';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #8a6a00;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የሚኒስትሮች ምክር ቤት ደንብ ቁጥር 586/2018 — የፌዴራል ነጋሪት ጋዜጣ፣ 32ኛ ዓመት ቁጥር 17፣ የካቲት 16 ቀን 2018 ዓ.ም (23 February 2026)። ይህ ጽሑፍ የደንቡን ዋና ነጥቦች በቀላል ቋንቋ የሚያብራራ ማጠቃለያ ነው እንጂ የሕግ ወይም የግብር ምክር አይደለም። ለውሳኔ ደንቡን ሙሉ ያንብቡ ወይም ባለሙያ ያማክሩ።</p>

<p><strong>ኢትዮጵያ የኢንቨስትመንት ማበረታቻ ሥርዓቷን ቀይራለች።</strong> ለዓመታት የነበረው "ከግብር ነፃ የሆኑ ዓመታት" (tax holiday) ሥርዓት ቀርቷል። በምትኩ <strong>የቀነሰ የገቢ ግብር መጣኔ</strong> ለተወሰኑ ዓመታት፣ በአፈጻጸም ስምምነት ላይ የተመሠረተ ማበረታቻ መጥቷል። ደንብ ቁጥር <strong>586/2018 (586/2026)</strong> ከ<strong>የካቲት 16 ቀን 2018 ዓ.ም (23 February 2026)</strong> ጀምሮ ተፈጻሚ ሆኗል፤ የቀድሞውን ደንብ ቁጥር 517/2014 (517/2022) እንደተሻሻለ ሙሉ በሙሉ ሽሮታል (አንቀጽ 37፣ 38)።</p>

<h3>🚀 ለስታርታፖች — ትልቁ ዜና</h3>
<p>በስታርታፕ አዋጅ ቁጥር 1396/2017 (1396/2025) መሠረት <strong>እውቅና ያገኘ ስታርታፕ</strong> (አንቀጽ 2(12)):</p>
<ul>
<li>ሥራ ከጀመረበት ቀን ጀምሮ ለ<strong>10 ዓመታት የ5% የገቢ ግብር</strong> ብቻ ይከፍላል፤ ከዚያ በኋላ መደበኛው መጣኔ (አንቀጽ 10(1))።</li>
<li>ለባለአክሲዮኖች የሚከፈል <strong>የትርፍ ድርሻ ለ5 ዓመታት ከግብር ነፃ</strong> ነው (አንቀጽ 10(2))።</li>
</ul>
<p>የስታርታፕ ምኅዳር ገንቢዎችና በስታርታፕ ውስጥ የሚያፈሱ ባለሀብቶችም ማበረታቻ አላቸው (አንቀጽ 11)፦ በስታርታፕ ውስጥ ያለውን ድርሻ ሲሸጡ የሚገኝ <strong>ካፒታል ትርፍ ከግብር ነፃ</strong>፤ ከስታርታፕ የሚቀበሉት የትርፍ ድርሻ ለ5 ዓመታት ነፃ፤ በስታርታፕ ኢንቨስትመንት ኪሳራ የደረሰበት ባለሀብት በኪሳራው መጠን ልክ ለ3 ዓመታት ከአማራጭ አነስተኛ ግብር (Minimum Alternative Tax) ነፃ ይሆናል።</p>

<h3>📉 ከግብር ነፃ ዓመታት ወደ የቀነሰ መጣኔ</h3>
<ul>
<li><strong>የልዩ ኢኮኖሚ ዞን ገንቢዎች</strong> (አንቀጽ 8)፦ የንግድ ፈቃድ ከወሰዱበት ቀን ጀምሮ ለ10 ዓመታት 5%፤ የትርፍ ድርሻ ለ5 ዓመታት ነፃ፤ ከአማራጭ አነስተኛ ግብር ለ10 ዓመታት ነፃ።</li>
<li><strong>በልዩ ኢኮኖሚ ዞን ውስጥ ያሉ ድርጅቶች</strong> (አንቀጽ 9)፦ በሰንጠረዥ 1 በተመለከቱ ዘርፎች 15%፤ በዞን ውስጥ ማዳበሪያ የሚያመርት ድርጅት ለ10 ዓመታት 5%።</li>
<li><strong>ከዞን ውጭ</strong> በሰንጠረዥ 1 በተዘረዘሩ የሥራ መስኮች የተሰማራ ባለሀብት (አንቀጽ 13)፦ 15%፤ የዓመታቱ ብዛት በዘርፍ ይለያያል፣ ዝርዝሩን የገንዘብ ሚኒስቴር በመመሪያ ያወጣል።</li>
<li><strong>በካፒታል ገበያ አክሲዮን የሚያሸጥ ኩባንያ</strong> (አንቀጽ 16)፦ ከመጀመሪያው የሕዝብ ሽያጭ (IPO) ቀን ጀምሮ ለ3 ዓመታት 25%።</li>
<li><strong>አካባቢ</strong> (አንቀጽ 12)፦ በካርቦን ልቀት ግብይት የሚሳተፉ ለ10 ዓመታት 15%፤ ቢያንስ 50% ታዳሽ ኃይል የሚጠቀም ወይም 50% ከአገር ውስጥ የተመለሰ ግብዓት የሚጠቀም ለ5 ዓመታት 15% — በየዓመቱ የተረጋገጠ የኃይል ኦዲት ሪፖርት ያስፈልጋል።</li>
</ul>

<h3>⚠️ ትልቁ ገደብ — 10 ሚሊዮን ዶላር</h3>
<p>የቀነሰውን የገቢ ግብር መጣኔ ለማግኘት ባለሀብቱ ቢያንስ <strong>USD 10,000,000</strong> ወይም ተመጣጣኙን ብር ማፍሰስ አለበት (አንቀጽ 7(2))። <strong>አነስተኛና መካከለኛ ኢንተርፕራይዞች ግን ከዚህ ገደብ ውጭ ናቸው</strong> — ማበረታቻ የሚያገኙት የገንዘብ ሚኒስቴር ከሚመለከታቸው አካላት ጋር በመመካከር በሚያወጣው መመሪያ መሠረት ነው (አንቀጽ 7(3)፣ 7(4))። ማበረታቻው የሚሰጠው ተጨማሪ የማምረት አቅም ወይም እሴት ለሚፈጥር፣ እንደ ግብር ከፋይ ለተመዘገበ፣ ለእያንዳንዱ ፕሮጀክት የተለየ ሂሳብ ለሚይዝ እና ማበረታቻውን ለሌላ ለማይያስተላልፍ ብቻ ነው (አንቀጽ 7(1))።</p>

<h3>🏗 የካፒታል ወጪ ተቀናሽ — 2 ሚሊዮን ዶላር</h3>
<p>በሰንጠረዥ 2 በተዘረዘሩ የኢንቨስትመንት መስኮች ለካፒታልና ለግንባታ ዕቃዎች የወጣ ወጪ ተቀናሽ ይደረጋል — ግን ቢያንስ <strong>USD 2,000,000</strong> ወይም ተመጣጣኙን ብር ላፈሰሱ ብቻ (አንቀጽ 14(2))። ዕቃው በግብር ከፋዩ ስም መሆን፣ ግብር የሚከፈልበትን ገቢ ለማግኘት መዋል፣ መደበኛ ወጪ አለመሆን፣ እና ተቀናሹ ዕቃው ገቢ ማመንጨት ከጀመረበት ጊዜ (ከተገዛበት ሳይሆን) መቆጠር አለበት፤ የተከራዩ ዕቃዎች ተቀናሽ በተከፈለው ኪራይ ብቻ ይወሰናል (አንቀጽ 14(3)፣ 14(4))። ለሳይንሳዊ ምርምር የሚወጣ ወጪም ተቀናሽ ነው (አንቀጽ 15)።</p>

<h3>📝 የአፈጻጸም ስምምነት — ግዴታ ነው</h3>
<p>ማበረታቻ የሚያገኝ ባለሀብት ከመንግሥት ጋር <strong>የአፈጻጸም ስምምነት</strong> ይፈርማል፤ ስምምነቱ የኢንቨስትመንት መጠን፣ የካፒታል መጠን፣ የሚፈጠር የሥራ ዕድል፣ የምርት መጠን፣ የቴክኖሎጂ ሽግግር እና ሌሎች መለኪያዎችን ይይዛል፣ የሪፖርትና የክትትል ሥርዓትም ያቋቁማል (አንቀጽ 26(2))። ስምምነቱ ባለሀብቱ ግዴታውን ካልተወጣ <strong>መንግሥት ማበረታቻውን ሊያነሳ እንደሚችል</strong> መደንገግ አለበት (አንቀጽ 26(4))። በሌላ ሕግ የአፈጻጸም ስምምነት የተፈረመ ከሆነ አንድ ስምምነት ብቻ በቂ ነው (አንቀጽ 26(3))።</p>

<h3>🔄 ቀድሞ ማበረታቻ ያላቸው ባለሀብቶች</h3>
<p>በቀድሞው ደንብ 517/2014 (እንደተሻሻለ) እና በአገር ውስጥ ባለሀብቶች ደንብ 270/2004 መሠረት የተሰጡ ማበረታቻዎች <strong>እስከ ጊዜያቸው መጨረሻ ድረስ ይቀጥላሉ</strong>፤ ባለሀብቱ ከፈለገ በአዲሱ ደንብ መሠረት መስተናገድን ሊመርጥ ይችላል (አንቀጽ 36(1)፣ 36(2))። በማዕድን፣ በነዳጅ፣ በጂኦተርማል፣ በባዮፊውል እና በተፈጥሮ ጋዝ ስምምነቶች የተሰጡ ነፃነቶች እስከ ስምምነቱ መጨረሻ ይቀጥላሉ (አንቀጽ 36(3))።</p>

<h3>💡 ይህ ለቢና ተጠቃሚዎች ምን ማለት ነው?</h3>
<p>ሱቅ፣ ካፌ ወይም ቢሮ ካለዎት — የ10 ሚሊዮን ዶላር ገደብ እርስዎን አይመለከትም፤ ለአነስተኛና መካከለኛ ኢንተርፕራይዞች የሚወጣውን መመሪያ ይጠብቁ። ስታርታፕ እየገነቡ ከሆነ — በስታርታፕ አዋጅ እውቅና ማግኘት አሁን የ10 ዓመት የ5% ግብር ማለት ነው፤ ይህ በአፍሪካ ካሉ ደፋር ማበረታቻዎች አንዱ ነው። ንግድ ለመጀመር <a href="/how-to-start-a-business-in-ethiopia">በኢትዮጵያ ንግድ እንዴት እንደሚጀመር</a> እና <a href="/business-registration-ethiopia">የንግድ ምዝገባ መመሪያ</a>ን ያንብቡ።</p>

<h3>🇬🇧 In English — what changed</h3>
<p><strong>Council of Ministers Regulation No. 586/2026</strong> (Federal Negarit Gazette No. 17, 23 February 2026) replaces Investment Incentive Regulation 517/2022. Tax holidays are gone; in their place, reduced income tax rates for fixed periods, conditional on a performance agreement.</p>
<ul>
<li><strong>Startups</strong> recognised under Startup Proclamation 1396/2025: <strong>5% income tax for 10 years</strong> from commencement, dividends exempt for 5 years (Art. 10). Ecosystem builders: capital gains on startup stakes exempt; dividends from a startup exempt 5 years; investors' losses offset Minimum Alternative Tax for 3 years (Art. 11).</li>
<li><strong>Special Economic Zones</strong>: developers 5% for 10 years, dividends exempt 5 years, MAT exempt 10 years (Art. 8); zone enterprises 15% in Table 1 sectors, fertilizer 5% for 10 years (Art. 9).</li>
<li><strong>Outside zones</strong>, Table 1 activities: 15%, duration by sector per Ministry directive (Art. 13).</li>
<li><strong>Listed companies</strong>: 25% for 3 years from the IPO (Art. 16).</li>
<li><strong>Environment</strong>: carbon-trading participants 15% for 10 years; ≥50% renewable energy or ≥50% locally recycled inputs, 15% for 5 years with an annual audit (Art. 12).</li>
<li><strong>Threshold</strong>: the reduced rate requires at least <strong>USD 10 million</strong> invested — small and medium enterprises are exempt from the threshold and covered by a Ministry directive (Art. 7).</li>
<li><strong>Capital expenditure deduction</strong> on Table 2 capital goods and building materials for investments of at least <strong>USD 2 million</strong>; leased goods limited to lease payments (Art. 14). Scientific research spending deductible (Art. 15).</li>
<li><strong>Performance agreement</strong> mandatory — investment, capital, jobs, output, technology transfer — and the Government may withdraw incentives on failure (Art. 26).</li>
<li><strong>Existing incentives</strong> run to their expiry; investors may opt into the new regime (Art. 36).</li>
</ul>

<p style="background:#f4f1ea;border-left:4px solid #8a6a00;padding:14px 18px;border-radius:8px;font-size:14px;color:#5c5548"><strong>ስለ ምንጩ፦</strong> ደንቡ 50 ገጽ ነው። የተጠቀሱት አንቀጾች ከደንቡ የእንግሊዝኛ ጽሑፍ ተነብበዋል። ሰንጠረዥ 1 (ዘርፎችና ዓመታት) እና ሰንጠረዥ 2 (ተቀባይነት ያላቸው ዕቃዎች) ከደንቡ ጋር ተያይዘዋል፤ ይዘታቸው እዚህ አልተጠቀሰም — ለዘርፍዎ የሚመለከተውን ጊዜ ከደንቡ ራሱ ያረጋግጡ።</p>
`.trim();

(async () => {
  const data = {
    title: 'Ethiopia Ends Tax Holidays — Regulation 586/2026: 5% for Startups, 15% for Priority Sectors, and a USD 10m Threshold',
    titleAm: 'ከግብር ነፃ ዓመታት ቀሩ — ደንብ 586/2018፤ ለስታርታፕ 5%፣ ለቅድሚያ ዘርፎች 15%፣ የ10 ሚሊዮን ዶላር ገደብ',
    category: 'ንግድ',
    excerpt: 'ከየካቲት 16/2018 (23 Feb 2026) ጀምሮ ተፈጻሚ የሆነው አዲሱ የኢንቨስትመንት ማበረታቻ ደንብ የግብር ነፃ ዓመታትን በቀነሰ መጣኔ ተክቷል፦ እውቅና ያገኘ ስታርታፕ ለ10 ዓመታት 5%፣ ልዩ ኢኮኖሚ ዞን 5%/15%፣ የተዘረዘሩ ዘርፎች 15%፣ አክሲዮን የሚያሸጡ 25%። ገደቡ 10 ሚሊዮን ዶላር — አነስተኛና መካከለኛ ኢንተርፕራይዞች ግን ከገደቡ ውጭ። ከነጋሪት ጋዜጣ ተመሳክሮ።',
    bodyHtml: body, lang: 'am', heroEmoji: '📈', readMinutes: 7, evergreen: true, published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
