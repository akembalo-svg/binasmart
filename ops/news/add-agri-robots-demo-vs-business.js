'use strict';
// News post: why agricultural robots win demos and struggle commercially.
//
//   node --env-file=.env ops/news/add-agri-robots-demo-vs-business.js
//
// His draft, desk-checked 28 September 2026. What was done to it:
//
// FACTS — the Carbon Robotics / LaserWeeder figures were read out of the Western Growers case study PDF
// itself, not a summary. Every one of his numbers was exact: $900/acre hand weeding at 90 minutes an
// acre, $267.72/acre to run the machine, $550 combined, $350 net saving, 2,350 acres a machine a year,
// $1.2m purchase. "$822,500, a 39% reduction" appears verbatim in the report. Added what he was missing:
// the farms are named (Braga Fresh; Triangle Farms for the romaine), and the romaine counter-example has
// its real figure, $88.73 more per acre, AND the report's reason for it — the machine was thinning as
// well as weeding, so it is not a weeding failure. Left in dollars: they are American figures.
//
// CURRENCY — his draft said "200,000 ዩዋን ወይም 200,000 ብር" as if those were the same money. One yuan is
// about 24 birr, so they are 24x apart, and section 4's whole calculation rests on that number. He chose
// birr. But 200,000 birr is about $1,450, which is not the price of anything that weeds a field, so the
// example is stated as 5,000,000 ብር — roughly what the original 200,000 yuan is actually worth. The
// per-acre results move with it (1,000 and 200 birr), and the 5:1 ratio, which is the point of the
// section, is unchanged. It is labelled in the text as an example, not a quoted price.
//
// AMHARIC — ከየሚተካው -> ከሚተካው; bare numbers in sections 4 and 12 given their currency; the closing line
// was in the informal masculine (እንዳያሳስብህ) while the rest of the piece is neutral.
//
// PICTURES — four of his photographs and four charts built here from his own sections 9, 11 and 15 in
// BinaSmart's styling, each captioned with the section it illustrates.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'agriculture-robots-demo-vs-business-amharic';
const IMG = '/static/news/agri-robots';
const fig = (f, alt, cap) =>
  `<figure style="margin:18px 0"><img src="${IMG}/${f}.jpg" alt="${alt}" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">${cap}</figcaption></figure>`;

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ስለ ቁጥሮቹ፦</strong> የወጪ ንጽጽሩ ቁጥሮች የመጡት ከ<strong>Western Growers</strong> ኦፊሴላዊ የጉዳይ ጥናት (2024) ነው፤ በአሜሪካ ዶላር ናቸው። የመሣሪያ ዋጋ ምሳሌዎች በብር የቀረቡ <strong>ምሳሌዎች</strong> እንጂ የተጠቀሰ የገበያ ዋጋ አይደሉም።</p>

<p>የግብርና ሮቦቲክስ ዘርፍ አስደናቂ ፍጥነት እያሳየ ነው። በኤግዚቢሽን ላይ ሮቦት በራሱ ይንቀሳቀሳል፣ ካሜራ የእፅዋትን ሁኔታ ይለያል፣ AI አረምን ይለያል፣ ሮቦቱ መንገዱን ይቀይራል፣ መሰናክልን ያስወግዳል፣ የሮቦት ክንድም የተመረጠውን በትክክል ይይዛል።</p>
<p>ሰዎች ያጨበጭባሉ። ኢንቨስተሮች “የወደፊቱ ገበያ ትልቅ ነው” ይላሉ። ደንበኞችም “ቴክኖሎጂው ጥሩ ነው” ይላሉ።</p>
<p>ነገር ግን Demo ከተጠናቀቀ በኋላ እውነተኛው ጥያቄ ይጀምራል፦ <strong>ማን ይከፍላል?</strong> ሮቦቱ በዓመት ስንት ኤከር ማረም ይችላል? በአንድ ኤከር የሥራ ወጪው ስንት ነው? በዓመት ስንት ጊዜ ይበላሻል? ጥገናውን ማን ያደርጋል? በእርሻ ወቅት ቀንና ሌሊት መሥራት ይችላል? ደንበኛው በሚቀጥለው ዓመት እንደገና ይገዛዋል?</p>

${fig('demo-floor', 'A field robot on an exhibition floor surrounded by visitors', 'በኤግዚቢሽን መድረክ ላይ — ሮቦት ማሸነፍ የሚጀምረው እዚህ ነው፤ ንግድ ግን እዚህ አያልቅም።')}

<h3>1. መሮጥ ማለት መሥራት ማለት አይደለም</h3>
<p>ሮቦትን በኤግዚቢሽን ላይ ለ10 ደቂቃ ማንቀሳቀስ ቀላል ሊመስል ይችላል። የግብርና ሥራ ግን 10 ደቂቃ አይደለም — 8 ሰዓት፣ 12 ሰዓት፣ ተከታታይ ቀናት ወይም የእርሻ ወቅት ሙሉ ሊሆን ይችላል።</p>
<p>Demo የሚያረጋግጠው “ማሽኑ መንቀሳቀስ ይችላል” የሚለውን ነው። ንግድ ግን “ማሽኑ ተግባሩን በተደጋጋሚ፣ በትክክልና በወጪ ቁጥጥር ማከናወን ይችላል” የሚለውን ይፈትሻል።</p>
<p>ለምሳሌ አረም ለማስወገድ የተሠራ ሮቦት በDemo ውስጥ አረሙን በትክክል ሊለይ ይችላል። ወደ እርሻ ሲገባ ግን፦ አፈሩ ይለያያል፣ የፀሐይ ብርሃን ይለያያል፣ የእፅዋት መጠን ይለያያል፣ የአረም ብዛት ይለያያል፣ መሬቱ ያልተስተካከለ ሊሆን ይችላል፣ ጎማው ሊንሸራተት ይችላል፣ ካሜራው በአቧራ ወይም በጭቃ ሊሸፈን ይችላል፣ ዝናብ ሊጀምር ይችላል፣ ሰው ወይም ሌላ ማሽን መንገዱን ሊዘጋ ይችላል፣ መሣሪያው ሊጣበቅ ይችላል፣ ባትሪው ሊያልቅ ይችላል፣ ግንኙነት ሊቋረጥ ይችላል።</p>
<p>ስለዚህ ትክክለኛው ጥያቄ፦ <strong>“100 ወይም 1,000 ኤከርን በተግባር ሙሉ በሙሉ ማከናወን ይችላል?”</strong> የሚለው ነው።</p>

<h3>2. መሥራት ማለት በተረጋጋ ሁኔታ መሥራት አይደለም</h3>
<p>የግብርና ሮቦት ትልቁ ጠላት ሁልጊዜ የAI አልጎሪዝም አይደለም። አንዳንድ ጊዜ ጭቃ፣ ውሃ፣ አቧራ፣ ንዝረት፣ ሙቀት፣ ብርድ፣ ከባድ ጭነትና የእርሻ ወቅት ራሱ ትልቁ ፈተና ይሆናል።</p>

${fig('mud-field', 'A field robot working in a wet, muddy vegetable field', 'በላቦራቶሪ 99% ትክክለኛነት ያለው ካሜራ በጭቃ ከተሸፈነ ምን ይሆናል? እውነተኛው ፈተና እዚህ ነው።')}

<p>የመንገድ እቅዱ ፍጹም ቢሆንም፣ ሮቦቱ ጉድጓድ ውስጥ ከገባ ወይም በውሃ ላይ ከተንሸራተተ ሥራው ይቋረጣል። ስለዚህ የግብርና ሮቦት ጥራት ሲለካ የAI ትክክለኛነት ብቻ አይበቃም። እንደ <strong>MTBF</strong> (የብልሽት መካከለኛ ጊዜ)፣ <strong>MTTR</strong> (የጥገና ጊዜ)፣ የሥራ ስኬት መጠን፣ የሰው ጣልቃ ገብነት መጠንና ትክክለኛው የሥራ ጊዜ ይጠበቃሉ።</p>
<p>በተለይ በግብርና የጊዜ አስተማማኝነት ወሳኝ ነው። መኪና ከተበላሸ ወደ ጋራዥ ወስደው መጠገን ይችላሉ። የእርሻ ማሽን ግን በወሳኝ የእርሻ ወቅት ከቆመ፣ የጠፋው ጊዜ የጠፋ ምርት ነው።</p>

<h3>3. መሥራትና መረጋጋትም እንኳን በቂ አይደለም — ገንዘብ ማስገኘት አለበት</h3>
<p>አንድ ሮቦት <strong>5,000,000 ብር ገደማ</strong> ያወጣል ብለን እንገምት (ይህ ምሳሌ ነው)። ቴክኖሎጂው ጥሩ ነው፣ አስተማማኝም ነው። ደንበኛው ግን የሚጠይቀው “ምን ቺፕ ተጠቀሙ?”፣ “ስንት TOPS አለው?”፣ “LiDAR ስንት መስመር አለው?” የሚለውን አይደለም።</p>
<p>ደንበኛው በመጨረሻ ሦስት ነገሮችን ይመለከታል፦ ከዚህ በፊት በአንድ ኤከር ምን ያህል ይከፍል ነበር? ሮቦቱን ከገዛ በኋላ በአንድ ኤከር ስንት ይከፍላል? በዓመት ምን ያህል ይቆጥባል?</p>
<p><strong>የግብርና ሮቦት ዋጋ የሚወሰነው በBOM ብቻ አይደለም፤ በሚፈጥረው ምርታማነት ነው።</strong></p>

<h3>4. ትክክለኛው ጥያቄ “ሮቦቱ ስንት ነው?” ሳይሆን “በአንድ ኤከር ስንት ነው?” ነው</h3>
<p>ያንኑ የ5,000,000 ብር ምሳሌ እንውሰድ። በ5 ዓመት ውስጥ በዓመት 1,000 ኤከር ብቻ ከሠራ፣ በአጠቃላይ 5,000 ኤከር ይሆናል፤ የመሣሪያው የዋጋ መቀነስ ብቻ በአንድ ኤከር <strong>1,000 ብር</strong> ይሆናል።</p>
<p>በዓመት 5,000 ኤከር ከሠራ ግን በ5 ዓመት 25,000 ኤከር ይሆናል፤ ያው ወጪ በአንድ ኤከር ወደ <strong>200 ብር</strong> ይወርዳል።</p>
<p>ተመሳሳይ ማሽን፣ ተመሳሳይ ዋጋ፣ አምስት እጥፍ ልዩነት። ስለዚህ የሮቦቱ <strong>አጠቃቀም መጠን (utilization)</strong> ከሽያጭ ብዛት በላይ ወሳኝ ሊሆን ይችላል።</p>

${fig('machine-scale', 'A cabbed agricultural machine with a wide implement working a vegetable field', 'በዓመት ስንት ኤከር ይሸፍናል? የአንድ ኤከር ወጪን የሚወስነው ይህ ነው። (ይህ ማሽን ሹፌር ያለው ነው።)')}

<h3>5. አንድ 1.2 ሚሊዮን ዶላር ሮቦት ለምን እርሻ ባለቤት ሊገዛው ይችላል?</h3>
<p>በካሊፎርኒያ የሚገኘው <strong>Braga Fresh</strong> የተባለው እርሻ ከ<strong>Carbon Robotics LaserWeeder</strong> ጋር ያለው ተሞክሮ በWestern Growers የጉዳይ ጥናት ተመዝግቧል። የማሽኑ ግዢ ዋጋ <strong>1.2 ሚሊዮን ዶላር</strong> ነበር። በመጀመሪያ ሲታይ እጅግ ውድ ነው።</p>
<p>ግን የንግድ ሂሳቡ የሚጀምረው ከዋጋው ሳይሆን ከሚተካው የሥራ ወጪ ነው።</p>

${fig('hand-weeding', 'A line of farm workers hand-weeding a lettuce field', 'የሚተካው ሥራ ይህ ነው፦ በእጅ አረም ማስወገድ። በጥናቱ መሠረት በአንድ ኤከር 90 ደቂቃ ይወስዳል፤ ወጪውም 900 ዶላር ነበር።')}

<p>በጥናቱ መሠረት፣ ከመሣሪያ ዋጋ መቀነስ፣ ከነዳጅ፣ ከትራክተር፣ ከሠራተኞች፣ ከአገልግሎትና ከሌሎች ወጪዎች ጋር የሮቦቱ ጠቅላላ የሥራ ወጪ በአንድ ኤከር <strong>267.72 ዶላር</strong> ነበር። ከዚያ በኋላ የሚቀረው የእጅ አረም ወጪ ተጨምሮ ጠቅላላው <strong>550 ዶላር በአንድ ኤከር</strong> ደርሷል። በቀድሞው ሙሉ የእጅ ዘዴ ግን <strong>900 ዶላር በአንድ ኤከር</strong> ነበር።</p>

${fig('chart-cost', 'Chart comparing weeding cost per acre', 'የወጪ ንጽጽሩ በአንድ ሥዕል። ምንጭ፦ Western Growers (2024)።')}

<p>900 − 550 = <strong>350 ዶላር በአንድ ኤከር ቁጠባ</strong>። በዓመት 2,350 ኤከር ሲሠራ፣ ጥናቱ እንደሚለው በዓመት <strong>822,500 ዶላር</strong> — ከሙሉ የእጅ ሥራ ጋር ሲነጻጸር <strong>39% ቅናሽ</strong>።</p>
<p>ስለዚህ ዋናው ጥያቄ “1.2 ሚሊዮን ዶላር ውድ ነው?” ብቻ አይደለም። ትክክለኛው ጥያቄ <strong>“ይህ ማሽን በዓመት ምን ያህል የምርት ዋጋ ይፈጥራል?”</strong> የሚለው ነው።</p>

<h3>6. አንድ ሮቦት በሁሉም እርሻ ላይ ትርፋማ አይሆንም</h3>
<p>ይህ ወሳኝ ነጥብ ነው። አንድ ቴክኖሎጂ በአንድ ሰብል ጥሩ የኢኮኖሚ ውጤት ቢያሳይ፣ በሌላ ላይ ያው ውጤት ላይኖረው ይችላል።</p>
<p>ያው ጥናት ሌላ እርሻን — <strong>Triangle Farms</strong> — ይመለከታል። እዚያ በቀጥታ በተዘራ ሮሜይን ሰላጣ ላይ የአረም ወጪ በሮቦቱ <strong>በአንድ ኤከር 88.73 ዶላር ጨምሯል</strong>፤ ማለትም ከእጅ ሥራ የበለጠ ወጪ ሆኗል።</p>
<p>ጥናቱ ምክንያቱን ይገልጻል፦ ማሽኑ በዚያ ሰብል ላይ አረም ከማስወገድ በተጨማሪ <strong>የተክል ማሳሳትንም (thinning) እየሠራ</strong> ስለነበር ነው — የአረም ሥራው ስለከሸፈ አይደለም።</p>
<p>ልብ ሊባል የሚገባው፣ ያው እርሻ በአራቱም ሰብሎች ላይ በአጠቃላይ በአንድ ኤከር <strong>388.34 ዶላር</strong> ቀንሷል፤ በዓመት <strong>430,277 ዶላር</strong> — <strong>40% ቅናሽ</strong>።</p>
<p><strong>ሮቦት በራሱ ትርፋማ አይደለም። ትክክለኛው የሥራ ቦታ ሲመረጥ ነው ትርፋማ የሚሆነው።</strong></p>

<h3>7. የግብርና ሮቦት አራት ዋና ሂሳቦች</h3>
<ul>
<li><strong>የመሣሪያ ዋጋ</strong> — ሮቦቱ ስንት ይገዛል?</li>
<li><strong>የሥራ አቅም</strong> — በዓመት ስንት ኤከር ይሠራል?</li>
<li><strong>የመተካት ዋጋ</strong> — ቀድሞ የሰው ሥራ ስንት ያስወጣ ነበር?</li>
<li><strong>የሕይወት ዘመን ሂሳብ</strong> — ስንት ዓመት ይሠራል? የጥገና ወጪው ስንት ነው? የመጨረሻ ዋጋውስ?</li>
</ul>
<p>በአጭሩ፦ የመሣሪያ ኢንቨስትመንት → የዓመት የሥራ መጠን → የአንድ ኤከር ወጪ → የደንበኛ ቁጠባ → የመመለሻ ጊዜ → የሕይወት ዘመን ዋጋ። ይህ ነው እውነተኛው የንግድ ሞዴል።</p>

<h3>8. ዋጋውን ከBOM ሳይሆን ከደንበኛ ዋጋ መጀመር</h3>
<p>ብዙ የቴክኖሎጂ ኩባንያዎች እንዲህ ያስባሉ፦ BOM → የማምረቻ ወጪ → ትርፍ → የሽያጭ ዋጋ → ደንበኛ መፈለግ።</p>
<p>የግብርና ሮቦት ግን ከተቃራኒው መጀመር አለበት፦ የደንበኛ የአሁኑ ወጪ → የሮቦት የሥራ ወጪ → ቁጠባ → የዓመት የሥራ መጠን → ROI → የሚቻል የሽያጭ ዋጋ → የሚፈለገው BOM።</p>

<h3>9. ትልቁ የንግድ አደጋ፦ ደንበኛ መውደዱን መግዛቱ እንደሆነ መቁጠር</h3>
<p>አንድ ደንበኛ “በጣም ጥሩ ነው” ማለቱ ገንዘብ ሊከፍል ነው ማለት አይደለም። “የወደፊት ትልቅ እድል ነው” ማለቱም ዛሬ ትዕዛዝ ሊሰጥ ነው ማለት አይደለም።</p>

${fig('chart-funnel', 'Seven-step customer funnel diagram in Amharic', 'ከማየት እስከ ዳግም ግዢ — ሰባቱ ደረጃዎች።')}

<p>ትክክለኛው የምርት ማረጋገጫ ብዙ ጊዜ <strong>የደንበኛው ሁለተኛ ግዢ</strong> ነው።</p>

<h3>10. Demo የሚያሳየውና ንግድ የሚለካው የተለያዩ ናቸው</h3>
<p>Demo ላይ ሮቦቱ በራሱ ይሄዳል፣ እፅዋትን ይለያል፣ AI አረምን ይለያል፣ ክንዱ ይይዛል። ንግድ የሚጠይቀው ግን፦ በቀን ስንት ሰዓት በእውነት ይሠራል? በአንድ ኤከር ስንት ያስወጣል? አንድ ብልሽት ምን ያህል ያሳጣል? ጥገናው ስንት ደቂቃ ይወስዳል? በዓመት ስንት ኤከር ይሠራል? ደንበኛው በሚቀጥለው ዓመት ይመለሳል?</p>
<p><strong>Demo የቴክኖሎጂ ማሳያ ነው። ክፍያ የንግድ ማረጋገጫ ነው። ዳግም ግዢ የምርት ማረጋገጫ ነው። የገንዘብ ፍሰት ደግሞ የኩባንያው ሕይወት ነው።</strong></p>

<h3>11. የግብርና ሮቦት የንግድ ጉዞ አምስት ደረጃዎች</h3>

${fig('chart-stages', 'Five commercial gates as an ascending staircase, in Amharic', 'አምስቱ ደጃፎች — በየደጃፉ መካከል ያለው “≠” ነው ኩባንያዎች የሚወድቁበት።')}

<p>መሮጥ ≠ መሥራት። መሥራት ≠ በተረጋጋ ሁኔታ መሥራት። በተረጋጋ ሁኔታ መሥራት ≠ ገንዘብ ማስገኘት። ገንዘብ ማስገኘት ≠ በመጠነ ሰፊ መንገድ ትርፋማ መሆን።</p>

<h3>12. ለምን አንዳንድ ሮቦቶች እየተሻሻሉ ሲሄዱ ንግዳቸው ይበልጥ ይወሳሰባል?</h3>
<p>የቴክኖሎጂ ቡድን ብዙ ጊዜ “ሌላ LiDAR እንጨምር”፣ “ሌላ ካሜራ እንጨምር”፣ “የተሻለ ኮምፒዩተር እንጠቀም”፣ “ትልቅ AI ሞዴል እንጨምር”፣ “ራስ-ሰር ቻርጅ እንጨምር” ይላል። በመጨረሻ ግን BOM ይጨምራል፣ ሲስተሙ ይወሳሰባል፣ ጥገናው ይከብዳል፣ ዋጋውም ይጨምራል። ከዚያ ደንበኛው መግዛት አይችልም።</p>
<p>ስለዚህ ጥሩ የግብርና ሮቦት መጠየቅ ያለበት፦ <strong>“ይህ ተጨማሪ ቴክኖሎጂ በእውነት ምን ያህል ተጨማሪ ምርታማነት ይፈጥራል?”</strong></p>
<p>በአንድ ማሽን ላይ <strong>1,000 ብር</strong> ተጨማሪ ወጪ አምጥቶ በዓመት <strong>500 ብር</strong> ብቻ ጥቅም የሚሰጥ ከሆነ፣ ለምን እንጨምረዋለን? ተጨማሪ ቴክኖሎጂ ሁልጊዜ የተሻለ ምርት ማለት አይደለም። ዋናው ግብ በትንሹ የሲስተም ውስብስብነት ከፍተኛውን የግብርና ዋጋ መፍጠር ነው።</p>

<h3>13. የግብርና ሮቦት ኩባንያ ከየት መጀመር አለበት?</h3>
<p>ብዙ ስታርታፖች የሚከተሉት መንገድ፦ ቴክኖሎጂ → ቻሲስ → AI → Demo → ኤግዚቢሽን → ደንበኛ። ይህ ግን ምርትን ከፍላጎት በፊት ያስቀምጣል።</p>
<p>የተሻለው ከተቃራኒው ይጀምራል፦ የእርሻ ችግር → ደንበኛ → የሥራ ውል → የአንድ ኤከር ሂሳብ → ROI → የሮቦት ዲዛይን።</p>
<p>እንዲያውም <strong>“መጀመሪያ 1,000 ኤከር የእውነተኛ ሥራ ትዕዛዝ አግኝ፤ ከዚያ ሮቦቱ ምን መምሰል እንዳለበት ወስን”</strong> የሚል አስተሳሰብ አለ። ምክንያቱም ደንበኛው በመጨረሻ ሮቦት አይገዛም፤ <strong>የተጠናቀቀ የግብርና ሥራ ይገዛል</strong>።</p>

<h3>14. እውነተኛው ተፎካካሪ ሌላ ሮቦት ብቻ አይደለም</h3>
<p>አንድ ስታርታፕ ራሱን ከሌላ ሮቦት ጋር ሊያወዳድር ይችላል። ደንበኛው ግን “አሁን ያለኝን ሰው ሥራ ለምን አልጠቀም?” እያለ ሊሆን ይችላል። ወይም ባህላዊ የግብርና ማሽን፣ የእርሻ አገልግሎት ቡድን፣ ከፊል-አውቶሜትድ መሣሪያ፣ የውጭ አገልግሎት፣ ወይም አሁን ያለውን ሥራ በቀጥታ መቀጠል።</p>
<p>ስለዚህ ሮቦቱ ከሌላ ሮቦት የተሻለ መሆኑ ብቻ አይበቃም። ደንበኛው አሁን ያለውን ዘዴ ለምን መቀየር እንዳለበት ግልጽ የኢኮኖሚ ምክንያት ማግኘት አለበት።</p>

<h3>15. እውነተኛው የንግድ ዑደት</h3>

${fig('chart-cycle', 'Business flywheel diagram in Amharic', 'ጤናማው ዑደት፦ ከትዕዛዝ ተነስቶ ወደ ተጨማሪ ትዕዛዝ ይመለሳል።')}

<p>ከዚህ በተቃራኒ ፋይናንስ → ምርምር → Demo → ተጨማሪ ፋይናንስ → ተጨማሪ Demo ብቻ ከሆነ፣ ኩባንያው የሚያመርተው ምርታማነት ሳይሆን Demo ሊሆን ይችላል።</p>

<h3>16. ሦስት ቁጥሮች በጣም ወሳኝ ናቸው</h3>
<ul>
<li><strong>ውጤታማ የሥራ ጊዜ</strong> — ሮቦቱ በቀን ስንት ሰዓት በእውነት ምርት እያመነጨ ነው?</li>
<li><strong>የአንድ ኤከር የሥራ ወጪ</strong> — እያንዳንዱ ሥራ ስንት ያስወጣል?</li>
<li><strong>የደንበኛ ዳግም ግዢ</strong> — ደንበኛው በሚቀጥለው ዓመት እንደገና ይገዛል?</li>
</ul>
<p>እነዚህ ሦስቱ ሦስት መሠረታዊ ጥያቄዎችን ይመልሳሉ፦ መሥራት ይችላል? መሥራቱ ዋጋ አለው? ደንበኛው እንደገና ይፈልገዋል?</p>

<h3>🌾 መደምደሚያ፦ Demo እንዳያሳስት</h3>
<p>ባለፉት ዓመታት ቴክኖሎጂው አንድ ነገር አሳይቷል፦ “ሮቦት ወደ እርሻ መግባት ይችላል።” አሁን የሚፈተነው ትልቁ ጥያቄ ግን <strong>“ሮቦት በእርሻ ውስጥ እውነተኛ ምርታማ የሥራ ኃይል መሆን ይችላል?”</strong> የሚለው ነው።</p>
<p>ሁለቱ ሐሳቦች በቃላት ቅርብ ቢሆኑም፣ በመካከላቸው ትልቅ የንግድ ርቀት አለ፦ ከDemo → ወደ እውነተኛ ምርት → ወደ ትርፍ → ወደ መጠነ ሰፊ ንግድ።</p>
<p>ስለዚህ የግብርና ሮቦት ኩባንያ ሲገመገም ጥያቄው “ሮቦቱ ምን ማድረግ ይችላል?” ብቻ መሆን የለበትም። ይልቁንም፦ በአንድ ኤከር ምን ያህል ያስወጣል? በዓመት ስንት ኤከር ይሠራል? ስንት ጊዜ ይበላሻል? ደንበኛው ምን ያህል ይቆጥባል? በሚቀጥለው ዓመት እንደገና ይገዛዋል?</p>
<p>የመጨረሻው ግብ ብዙ ሮቦቶችን መሸጥ ብቻ አይደለም። <strong>እያንዳንዱ ሮቦት ለደንበኛው የሚከፈልበትን እውነተኛ ምርታማነት በተከታታይ እንዲፈጥር ማድረግ ነው።</strong></p>
<p><strong>ሮቦቱ ግቡ አይደለም። ምርታማነት ነው ግቡ።</strong></p>

<p>ስለ ሮቦቲክስና AI ሌሎች ጽሑፎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a> ያግኙ፤ በግብርና ዘርፍ ክፍት ሥራዎችን <a href="https://bina.et/jobs/category/agriculture">እዚህ</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>Agricultural robots win exhibitions easily and struggle commercially, and the gap between the two is measured in money rather than technology. A demo proves a machine can move; a farm asks whether it can do the job repeatedly, in mud and rain and dust, for a whole season, at a cost per acre that beats what the grower pays today.</p>
<p>The numbers that make this concrete come from a Western Growers case study (2024). At <strong>Braga Fresh</strong> in California, hand weeding cost <strong>$900 an acre</strong> and took 90 minutes. A Carbon Robotics LaserWeeder, bought for <strong>$1.2 million</strong>, cost <strong>$267.72 an acre</strong> to run; with the hand weeding still needed afterwards the combined figure was <strong>$550</strong>. That is <strong>$350 saved per acre</strong>, and across <strong>2,350 acres</strong> a year the report puts the saving at <strong>$822,500</strong> — a 39% reduction.</p>
<p>But the same study shows the other side. At <strong>Triangle Farms</strong>, direct-seeded romaine cost <strong>$88.73 more per acre</strong> with the machine than by hand — because it was thinning as well as weeding, not because the weeding failed. Across all four of that farm's crops it still cut $388.34 an acre, $430,277 a year. A robot is not profitable in itself; it is profitable when it is pointed at the right job.</p>
<p>The rest follows from that: price the machine from the customer's existing cost rather than from the bill of materials, judge it on utilisation rather than on sales, and remember that a customer saying "this is good" is not a customer paying. The real proof of a product is the second purchase.</p>
`.trim();

(async () => {
  const data = {
    title: 'Why agricultural robots win demos and struggle in business',
    titleAm: 'የግብርና ሮቦቶች ለምን በDemo ያምራሉ፣ ወደ ንግድ ሲገቡ ግን አስቸጋሪ ይሆናሉ?',
    category: 'ቴክኖሎጂ',
    excerpt: 'ሮቦት መንቀሳቀሱ ብቻ አይበቃም፤ በእውነተኛ የእርሻ ሥራ ላይ ዋጋ የሚፈጥር ምርታማ መሣሪያ መሆን አለበት። በካሊፎርኒያ የተመዘገበ እውነተኛ ሂሳብ፦ በእጅ አረም 900 ዶላር በኤከር፣ በሌዘር ሮቦት 550 — በዓመት 822,500 ዶላር ቁጠባ። ነገር ግን በአንድ ሰብል ላይ ሮቦቱ ከእጅ ሥራ የበለጠ ወጪ ሆኗል።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🤖',
    readMinutes: 11,
    evergreen: true,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
