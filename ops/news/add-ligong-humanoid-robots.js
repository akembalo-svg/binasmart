'use strict';
// News post: LiGong Industrial (里工实业) and its 里掂 LiDian humanoid robots.
// Written by Ibrahim Kedir Bedru from material he took from the company; facts checked by the desk.
//
//   node --env-file=.env ops/news/add-ligong-humanoid-robots.js
//
// Desk check, 26 September 2026 — what was INDEPENDENTLY verified and is stated as fact:
//   · 广州里工实业 LiGong Industrial, Guangzhou, Panyu district; smart factory in Panyu since 2022
//   · CEO 李卫铳 Li Weichong, born 1979, took the family factory over in 2003, studied biology;
//     founded with his father 李庆光 Li Qingguang — a second-generation family firm
//   · it began in rubber and plastic: rubber sealing rings for a state-owned beer-bottling equipment
//     maker. His draft said "plastic packaging"; corrected, and it is the better story
//   · 2023: national "little giant" (专精特新); robot revenue over 100 million yuan
//   · 里掂 D1 full-size biped, unveiled 6 Aug 2024, 28 DOF, 320 N·m peak joint torque
//   · 里掂 F1 wheeled humanoid, 20 DOF, SLAM, dual-arm 12 kg / single arm 5 kg
//   · the robot line is branded 里掂 LiDian, which his draft never named — it is on every photograph
//
// What could NOT be verified anywhere, and is therefore attributed to the company IN THE TEXT rather
// than asserted: the price range, the 42 g glove, the delivery and revenue figures, the "three times a
// human" figure, the Siemens ambition and the customer anecdote. Ibrahim's source is the company itself
// ("from company I take", 26 Sep), so these are published as what LiGong says, which is what they are.
//
// One figure carries a named warning in the text itself: the "over 2,000 robots on order" line. A widely
// published figure says GUANGDONG PROVINCE has over 2,000 humanoid robots deployed in factories. Same
// number. The article says plainly that this is the company's own statement.
//
// Amharic corrections made to his draft: ችግኝ (seedling) -> ችግር (problem), six times, including the
// closing sentence; ተሽከርካሪ (vehicle) -> ባለ ጎማ (wheeled); ፕሬዝዳንት -> ዋና ሥራ አስፈጻሚ (CEO).
//
// Photographs are LiGong's own press images of its own robots, used in a news story about the company —
// the same editorial basis as the Volkswagen piece. Credited to the company on every figure.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'ligong-lidian-humanoid-robots-amharic';
const IMG = '/static/news/ligong-robots';
const cap = 'ፎቶ፦ 里工实业 LiGong Industrial';

const fig = (file, alt, caption) =>
  `<figure style="margin:18px 0"><img src="${IMG}/${file}" alt="${alt}" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">${caption} ${cap}</figcaption></figure>`;

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> 里工实业 LiGong Industrial (የኩባንያው ራሱ መረጃና ፎቶዎች)፣ ሴፕቴምበር 2026። የኩባንያው መገለጫ፣ የD1 እና የF1 ቴክኒካዊ መረጃ በተናጠል ተረጋግጧል። <strong>ዋጋ፣ የትዕዛዝ ብዛት፣ የገቢ ግምትና የምርታማነት ንጽጽር ቁጥሮች የኩባንያው የራሱ መግለጫዎች ናቸው</strong> — በጽሑፉ ውስጥ እንደዚያው ተጠቅሰዋል።</p>

<p>በሰው ልጅ የሮቦቲክስ ታሪክ ውስጥ አሁን የምንገኘው ዘመን በጣም የሚለይ ነው።</p>
<p>በፊት የሮቦት ጥያቄ በአብዛኛው <em>“ሮቦቱ መንቀሳቀስ ይችላል?”</em> የሚል ነበር።</p>
<p>ዛሬ ግን ጥያቄው ተቀይሯል፦ <strong>“ሮቦቱ በእውነተኛ የሥራ ቦታ ላይ ሥራ መሥራት ይችላል?”</strong></p>
<p>ይህ ለውጥ የሚያሳየው የሰው-መሰል ሮቦቶች ከማሳያ መድረክ ወደ እውነተኛ ኢንዱስትሪያዊ ሥራ እየተሸጋገሩ መሆናቸውን ነው።</p>
<p>በቻይና ጓንግዙ የሚገኘው <strong>里工实业 LiGong Industrial</strong> የሚባለው ኩባንያ ይህን ለውጥ በተግባር እየፈተነ ካሉት አንዱ ነው። የሮቦቶቹ የምርት ስም <strong>里掂 LiDian</strong> ሲሆን፣ ሁለቱ ዋና ሞዴሎች <strong>D1</strong> እና <strong>F1</strong> ይባላሉ።</p>

${fig('li-weichong.jpg', 'Li Weichong, CEO of LiGong Industrial', 'ሊ ዌይቾንግ (李卫铳) — የ里工实业 ዋና ሥራ አስፈጻሚ።')}

<p>ኩባንያው ወደ 40 ዓመት የሚጠጋ የኢንዱስትሪ ታሪክ አለው። የተመሠረተው በሊ ዌይቾንግ እና በአባታቸው <strong>ሊ ቺንግጓንግ (李庆光)</strong> ሲሆን፣ ዛሬ በሁለተኛ ትውልድ የሚመራ የቤተሰብ ድርጅት ነው።</p>
<p>ጅማሬው ግን ሮቦት አልነበረም። ኩባንያው የጀመረው <strong>የጎማና የላስቲክ ምርቶች</strong> በማምረት ነው — በተለይ ለመንግሥት የቢራ ማሸጊያ መሣሪያ ፋብሪካ የሚሆኑ <strong>የጎማ ማሸጊያ ቀለበቶች (rubber sealing rings)</strong>። ከዚያ ወደ አውቶሜሽን፣ ወደ ዲጂታል ሲስተም፣ ወደ ሮቦቲክስ፣ እና አሁን ደግሞ <strong>Physical AI / Embodied Intelligence</strong> ወደሚባለው የአካላዊ AI ዘርፍ ተሸጋግሯል።</p>
<p>ሊ ዌይቾንግ በ1979 የተወለዱ ሲሆን፣ በዩኒቨርሲቲ የተማሩት ባዮሎጂ ነበር፤ በ2003 ደግሞ መለወጥ የሚፈልገውን የቤተሰቡን ፋብሪካ ተረከቡ። በ2022 በፓንዩ (番禺) ስማርት ፋብሪካ ከፈቱ፤ በ2023 ደግሞ ኩባንያው የቻይና ብሔራዊ “ትንሹ ግዙፍ” (专精特新) ደረጃ አግኝቶ የሮቦት ነክ ገቢው ከ100 ሚሊዮን ዩዋን አለፈ።</p>
<p>እንደ ሊ ዌይቾንግ አገላለጽ፣ የዚህ ሁሉ ለውጥ ዋና ምክንያት አንድ ነው፦ <strong>የኢንዱስትሪን እውነተኛ ችግር መፍታት።</strong></p>

<h3>01. ደንበኛው የጠየቀው “ሰው-መሰል ሮቦት” አልነበረም</h3>
<p>ይህ ታሪክ በጣም የሚስብበት ነጥብ እዚህ ላይ ነው።</p>
<p>ኩባንያው እንደሚገልጸው፣ በ2023 መጨረሻ ላይ ሰው-መሰል ሮቦት ለመሥራት ሲጀምሩ አንድም ደንበኛ “ሰው-መሰል ሮቦት እፈልጋለሁ” ብሎ አልጠየቀም። ደንበኞቹ የጠየቁት ሁለት ቀላል ጥያቄዎች ነበሩ፦</p>
<p>“በአንድ ጊዜ ብዙ እቃ ማንሳት ትችላለህ?” እና “ከዚህ የበለጠ ክብደት ማንሳት ትችላለህ?”</p>
<p>እነዚህ ሁለት ጥያቄዎች የኩባንያውን የምርምር አቅጣጫ ቀየሩት። አንድ እጅ ያለው ሮቦት የሥራ ፍጥነቱ ሊገደብ ይችላል፤ ሁለት እጆች ግን አንድን እቃ በጋራ ለመያዝ፣ ለማንሳት፣ ለማዘዋወርና ለመጫን ተጨማሪ አቅም ይሰጣሉ።</p>
<p>ስለዚህ ቡድኑ የደንበኛውን ችግር ወደ ቴክኖሎጂ ቀየረ፦ <em>“ደንበኛው ሰው-መሰል ሮቦት አያስፈልገውም፤ ነገር ግን ሁለት እጅ ያለው ሮቦት ያስፈልገዋል።”</em></p>

${fig('li-weichong-robot.jpg', 'Li Weichong working on a LiDian robot', 'ሊ ዌይቾንግ በሮቦቱ ላይ ሲሠሩ።')}

<h3>02. ለምን ሁለት እጆች?</h3>
<p>ሰውን እንደ ምሳሌ እንውሰድ። ሰው በፋብሪካ ውስጥ ሲሠራ ዓይኑ ያያል፣ ጆሮው ይሰማል፣ አእምሮው ያስባል፣ እጆቹ ደግሞ ሥራውን ይፈጽማሉ።</p>
<p>ሁለት እጆች አንድ እቃ ከማንሳት በተጨማሪ፣ አንድ እጅ እቃውን ሲይዝ ሌላው እጅ ሌላ ሥራ እንዲያከናውን ያስችላሉ። ይህንን በሮቦት ውስጥ ማስገባት ማለት ሮቦቱን ለብዙ ዓይነት ሥራዎች የሚለዋወጥ መሣሪያ ማድረግ ማለት ነው።</p>
<p>ኩባንያው ይህንን <strong>flexibility — ተለዋዋጭነት</strong> ብሎ ያብራራል። ዛሬ አንድ ፋብሪካ የስልክ እቃ ሊያመርት ይችላል፤ ነገ ደግሞ የመኪና እቃ። ማሽኑ አንድ ሥራ ብቻ የሚያውቅ ከሆነ የዘመናዊ ምርት ፍላጎትን ለመከተል ይቸገራል።</p>
<p>የወደፊቱ ሮቦት እንደ Lego ሊሆን ይችላል፤ አካላቱና ሶፍትዌሩ እንደ ፍላጎቱ ሊዋቀሩ ይችላሉ።</p>

${fig('f1-two-robots.jpg', 'Two LiDian F1 robots working together', 'ሁለት 里掂 F1 ሮቦቶች አንድን ሥራ በጋራ ሲሠሩ።')}

<h3>03. ሰውን መምሰል የግድ ነው?</h3>
<p>“ሰው-መሰል ሮቦት” ማለት በግድ ሁለት እግር፣ ሁለት እጅና ሰው የሚመስል ጭንቅላት ያለው ማለት ነው? እንደ ኩባንያው አባባል፣ አይደለም።</p>
<p>በኢንዱስትሪ ውስጥ ዋናው ጥያቄ ሮቦቱ ሰውን በመልክ መምሰሉ ሳይሆን፣ ሥራውን በተለዋዋጭና በተረጋጋ መንገድ መሥራት መቻሉ ነው። ለምሳሌ በአንዳንድ ፋብሪካዎች <strong>ባለ ጎማ</strong> ሮቦት ከሁለት እግር ሮቦት የበለጠ ተገቢ ሊሆን ይችላል።</p>
<p>ስለዚህ የወደፊቱ ዓለም አንድ ዓይነት ሮቦት ብቻ ሳይሆን፣ የተለያዩ ሮቦቶች በጋራ የሚሠሩበት ስርዓት ሊሆን ይችላል።</p>
<p>የኩባንያው ሁለቱ ሞዴሎች ይህንኑ ያሳያሉ፦</p>
<ul>
<li><strong>里掂 D1</strong> — ሙሉ ቁመት ያለው የሁለት እግር ሰው-መሰል ሮቦት። ኦገስት 6 ቀን 2024 ይፋ ሆነ፤ <strong>28 የመንቀሳቀሻ ነጥቦች (degrees of freedom)</strong> እና እስከ <strong>320 N·m</strong> የመገጣጠሚያ ኃይል አለው።</li>
<li><strong>里掂 F1</strong> — ባለ ጎማ ሁለት-ክንድ ሮቦት። <strong>20 የመንቀሳቀሻ ነጥቦች</strong>፣ በ<strong>SLAM</strong> ቴክኖሎጂ ራሱን የሚመራ፣ በሁለት ክንዶች <strong>12 ኪ.ግ.</strong> በአንድ ክንድ ደግሞ <strong>5 ኪ.ግ.</strong> የመሸከም አቅም አለው።</li>
</ul>

${fig('d1-factory.jpg', 'LiDian D1 biped humanoid robot in a factory', '里掂 D1 — ሙሉ ቁመት ያለው የሁለት እግር ሮቦት በፋብሪካ ውስጥ።')}

<h3>04. ከ2023 ጀምሮ ምን ያህል ፈጣን ነበር?</h3>
<p>እንደ ኩባንያው መረጃ፣ የሁለት-ክንድ ሮቦት ፕሮጀክት በ2023 መጨረሻ ተጀምሮ በ2024 መጀመሪያ ወደ ተግባር ገባ። የመጀመሪያውን የሁለት-እግር ሮቦት ለመገንባት ወደ 10 ወር ያህል ወሰደ።</p>
<p>ባለ ጎማው ሮቦት ደግሞ ኩባንያው ከዚህ በፊት የነበረውን የመሠረት ቴክኖሎጂ ስለተጠቀመ የልማት ጊዜው በአንፃራዊነት አጭር ነበር።</p>
<p>ይህ አንድ ነገር ያሳያል፦ ሮቦት ማምረት ከዜሮ መጀመር ብቻ አይደለም፤ የቀድሞ የኢንዱስትሪ እውቀትን በአዲስ ቴክኖሎጂ ላይ ማዋልም ነው።</p>

${fig('robot-hall.jpg', 'A row of LiDian robots with an engineer', 'የሮቦቶቹ ማሠልጠኛና ሙከራ አዳራሽ።')}

<h3>05. አሁን ሮቦቶቹ የት እየሠሩ ነው?</h3>
<p>ይህ ታሪክ ከሌሎች የሮቦት ዜናዎች የሚለየው እዚህ ነው። ኩባንያው ሮቦቶቹን በማሳያ መድረክ ብቻ አይደለም የሚያሳየው፤ በእውነተኛ የሥራ ቦታዎች ላይ ለደንበኞች ማድረስ ጀምሯል። እንደ ኩባንያው ገለጻ አምስት ዋና የሥራ መስኮች አሉ፦</p>
<ol>
<li><strong>የፋብሪካ ማጓጓዣ</strong> — በተለይ የኤሌክትሪክ መኪና ክፍሎችን በፋብሪካ ውስጥ ማንቀሳቀስ።</li>
<li><strong>መጋዘን እና ሎጂስቲክስ</strong> — እቃ መለየት፣ መውሰድ፣ መሸከምና ማሸግ።</li>
<li><strong>የመኪና አገልግሎትና ቀለም ሥራ</strong> — በተለይ ለሰው አደገኛ ሊሆኑ የሚችሉ ሥራዎች።</li>
<li><strong>የመድኃኒት መጋዘን</strong> — የመድኃኒት ማሸግና የመጋዘን ሂደቶች።</li>
<li><strong>ስማርት ላቦራቶሪ</strong> — AI for Science እና የሳይንስ ምርምርን መደገፍ።</li>
</ol>

${fig('f1-warehouse.jpg', 'LiDian F1 stacking boxes in a warehouse', '里掂 F1 በመጋዘን ውስጥ እቃ ሲደረድር።')}
${fig('f1-sorting.jpg', 'LiDian F1 sorting small parts into trays', 'ትናንሽ ክፍሎችን በትሪ ውስጥ መለየትና ማስቀመጥ።')}
${fig('f1-production.jpg', 'LiDian F1 working on a production line', 'በማምረቻ መስመር ላይ።')}

<h3>06. ሮቦት ከሰው ሦስት እጥፍ ይሠራል?</h3>
<p>እንደ ኩባንያው ገለጻ፣ በአንዳንድ የሎጂስቲክስ ትግበራዎች ሮቦቱ የሚያሸንፈው ከሰው የበለጠ ፈጣን ስለሆነ አይደለም። ዋናው ጥቅም <strong>ቀጣይነትና መረጋጋት</strong> ነው።</p>
<p>ሰው ይደክማል፣ ዕረፍት ያስፈልገዋል፣ የሥራ ፍጥነቱም በጊዜ ሊለዋወጥ ይችላል። ሮቦት ግን በተወሰነ ስርዓት 24 ሰዓት ሊሠራ ይችላል።</p>
<p>ኩባንያው በአንዳንድ የተተገበሩ ሥራዎች አጠቃላይ የሥራ ውጤት ከሰው ጋር ሲነፃፀር <strong>እስከ ሦስት እጥፍ</strong> ሊደርስ እንደሚችል ገልጿል። ይህ ግን በሁሉም ሥራ ላይ የሚሠራ አጠቃላይ ሕግ አይደለም፤ በተወሰኑ የተግባር ሁኔታዎች ላይ የተመሠረተ የኩባንያው መረጃ ነው።</p>

<h3>07. የሰው-መሰል ሮቦት ዋጋ ስንት ነው?</h3>
<p>እንደ ኩባንያው መረጃ፣ የሮቦቱ ዋጋ በሚመረጡት የሃርድዌርና የሥራ አቅም መሠረት ይለያያል — በግምት <strong>ከ300,000 እስከ 600,000 ዩዋን</strong> የሚደርስ የምርት ክልል እንዳለ ዋና ሥራ አስፈጻሚው ገልጸዋል።</p>
<p>ነገር ግን ዋናው ጥያቄ “ዋጋው ስንት ነው?” የሚለው ብቻ አይደለም፤ <strong>“ሮቦቱ ምን ያህል የምርት ውጤት ይፈጥራል?”</strong> የሚለው ነው።</p>
<p>ለምሳሌ አንድ ድርጅት 600,000 ዩዋን አውጥቶ 1,200,000 ዩዋን የሚገመት የምርት ጥቅም ካገኘ፣ የግዢው ውሳኔ በዋጋ ብቻ አይመራም። ይህንን በኢንዱስትሪ ቋንቋ <strong>ROI — Return on Investment</strong> ይሉታል።</p>

<h3>08. ሮቦት እንዲማር ዳታ ያስፈልገዋል</h3>
<p>እዚህ ላይ የሮቦቲክስና የAI ዓለም ይገናኛሉ። አካላዊ ሮቦት ብቻ በቂ አይደለም።</p>
<p>ሮቦቱ በእውነተኛ ዓለም ውስጥ የሰውን ሥራ ለመማር የሰው እንቅስቃሴ፣ የእጅ አጠቃቀም፣ የሥራ ሂደትና የአካባቢ መረጃ ያስፈልገዋል። ለዚህ ምክንያት ኩባንያው የዳታ ማሰባሰቢያ ቴክኖሎጂ እያዘጋጀ ነው፤ ከእነዚህ መካከል በጣም የሚስበው <strong>42 ግራም ብቻ የሚመዝን የዳታ ማሰባሰቢያ ጓንት</strong> ነው።</p>

${fig('data-capture.jpg', 'A worker wearing motion-capture gear in front of a LiDian F1', 'ሠራተኛው የእንቅስቃሴ መቅጃ መሣሪያ ለብሶ ከF1 ፊት ለፊት — ሮቦቱ ከሰው እንዲማር የሚደረግ የዳታ ማሰባሰብ ሂደት።')}
${fig('capture-glove.jpg', 'Close view of the motion-capture harness and glove in use', 'የእጅ እንቅስቃሴ መቅጃው በሥራ ላይ። (ይህ ፎቶ አጠቃላይ የመቅጃ መሣሪያውን ያሳያል፤ የ42 ግራሙ ጓንት የቅርብ ፎቶ አይደለም።)')}

<h3>09. ለምን ጓንቱ በጣም ቀላል መሆን አለበት?</h3>
<p>ይህ ጥልቅ የሆነ የምርምር ጥያቄ ነው። አንድ ሠራተኛ በፋብሪካ ውስጥ በየቀኑ የሚሠራውን እንቅስቃሴ በጓንት ለመመዝገብ እንሞክር።</p>
<p>ጓንቱ ከባድ ከሆነ ሠራተኛው እጁን እንደ ቀድሞው አያንቀሳቅስም፤ እንቅስቃሴው ይቀየራል። ከዚያም የምንሰበስበው ዳታ የሰውዬውን ተፈጥሯዊ ክህሎት ሳይሆን፣ መሣሪያው የፈጠረውን የተቀየረ እንቅስቃሴ ሊያሳይ ይችላል።</p>
<p>ስለዚህ የኩባንያው አስተሳሰብ፦ <em>የዳታ ማሰባሰቢያ መሣሪያው ራሱ የሰውን ሥራ መቀየር የለበትም።</em> ይህንን <strong>Low-intrusion Data Collection</strong> — ዝቅተኛ ጣልቃ ገብነት ያለው ዳታ ማሰባሰብ ማለት ይቻላል።</p>

<h3>10. “ትክክለኛነት” ብቻ አይበቃም</h3>
<p>በAI እና ሮቦቲክስ ውስጥ ብዙ ጊዜ <strong>accuracy — ትክክለኛነት</strong> እንሰማለን። ነገር ግን ኩባንያው ሌላ ነገር በጣም እንደሚያስፈልግ ያስረዳል፦ <strong>Consistency — ወጥነት</strong>።</p>
<p>ማለትም ሮቦቱ ዛሬ የሠራውን ሥራ ነገና ከአንድ ሺህ ጊዜ በኋላም በተመሳሳይ ጥራት ማከናወን መቻሉ። ፋብሪካ የሚፈልገው አንድ ጊዜ ብቻ የሚያምር ሮቦት አይደለም፤ በየቀኑ የሚሠራ ሮቦት ነው።</p>

<h3>11. የAI ሞዴልን ከዜሮ ለምን አይገነቡም?</h3>
<p>ኩባንያው ሁሉንም ነገር በራሱ ለመሥራት አይሞክርም። የመሠረት AI ሞዴል (foundation model) ከዜሮ መገንባት እጅግ ትልቅ ገንዘብ፣ የሰው ኃይልና ጊዜ ይፈልጋል።</p>
<p>ስለዚህ ኩባንያው ሞዴል ከመገንባት ይልቅ ያሉትን ሞዴሎች ወደ ልዩ የኢንዱስትሪ ሥራ ለማስማማት <strong>post-training</strong> ይጠቀማል። ይህ ማለት፦ “AI ሞዴል እንደገና ከመፍጠር ይልቅ፣ ለሮቦት የሚጠቅመውን ክህሎት እናስተምረዋለን።”</p>

<h3>12. ሮቦት በላቦራቶሪ ውስጥም ሊሠራ ይችላል</h3>
<p>ኩባንያው የሚመለከተው ሌላ ዘርፍ <strong>AI for Science</strong> ነው — AI እና ሮቦት በሳይንሳዊ ምርምር ሂደት ውስጥ እንዲረዱ ማድረግ። ለምሳሌ፦</p>
<ul>
<li>የላቦራቶሪ እቃዎችን ማንቀሳቀስ</li>
<li>ናሙናዎችን ማዘጋጀት</li>
<li>ተደጋጋሚ የላብ ሥራዎችን መፈጸም</li>
<li>የሙከራ ሂደቶችን መደገፍ</li>
</ul>
<p>እዚህ ላይ AI አእምሮ ሊሆን ይችላል፣ ሮቦት ደግሞ በአካላዊ ዓለም ውስጥ እንደ እጅ ሊሠራ ይችላል።</p>

${fig('f1-lab.jpg', 'LiDian F1 working in a laboratory', '里掂 F1 በላቦራቶሪ ውስጥ — ናሙና ሲያዘጋጅ።')}

<h3>13. ከAGI በፊት Embodied AI ሊሳካ ይችላል?</h3>
<p><strong>AGI — Artificial General Intelligence</strong> ማለት በቀላሉ ሲብራራ፣ በተለያዩ የአእምሮ ሥራዎች ላይ ሰፊ አቅም ያለው አጠቃላይ AI ማለት ነው።</p>
<p>አንዳንድ ሰዎች ሰው-መሰል ሮቦት በእውነት ብዙ ሥራዎችን ለመሥራት AGI እስኪመጣ መጠበቅ አለበት ብለው ያስባሉ። ሊ ዌይቾንግ ግን ሁለቱ ነገሮች የግድ እርስ በርሳቸው እንዲጠባበቁ አያስፈልግም የሚል አመለካከት ያቀርባሉ።</p>
<p>ሮቦት በመጀመሪያ አንድ ሥራ ይማራል፤ ከዚያ ሁለተኛ፤ ከዚያ ሦስተኛ። እያንዳንዱ ሥራ የተሻለ ዳታ ያመጣል፤ የተሻለ ዳታ የተሻለ ሞዴልን ይረዳል፤ የተሻለ ሞዴል ደግሞ የተሻለ የሮቦት ችሎታን ያመጣል።</p>
<p>ስለዚህ Embodied AI ከቀላል ሥራ ወደ ውስብስብ ሥራ በቀስታ ሊያድግ ይችላል።</p>

<h3>14. የ“Capability Economics” ዘመን</h3>
<p>ሊ ዌይቾንግ የሚጠቀሙበት አንድ አስደሳች ሀሳብ <strong>Capability Economics</strong> ነው — በአማርኛ በቀላሉ “የችሎታ ኢኮኖሚ” ማለት ይቻላል።</p>
<p>ቀድሞ የሮቦት ዓለም ጥያቄ “ሮቦቱ መሮጥ ይችላል?” የሚል ነበር። ዛሬ ግን፦</p>
<ul>
<li>“ሮቦቱ ምን ሥራ መሥራት ይችላል?”</li>
<li>“ይህንን ሥራ በምን ያህል ዋጋ ሊሠራ ይችላል?”</li>
<li>“ስንት ጊዜ ሳይቋረጥ ሊሠራ ይችላል?”</li>
<li>“የስኬት መጠኑ ስንት ነው?”</li>
<li>“የገዛውን ገንዘብ መቼ ይመልሳል?”</li>
</ul>
<p>እነዚህ ናቸው የሚቀጥሉት የሮቦቲክስ ዓለም ዋና ጥያቄዎች።</p>

<h3>15. ሮቦት ከመሣሪያ ወደ የምርት ሠራተኛ</h3>
<p>የድሮ ሮቦት ብዙውን ጊዜ አንድ ሥራ ብቻ ይሠራል — “ይህን እቃ ከዚህ ቦታ አንስተህ እዚያ አስቀምጥ።”</p>
<p>አዲሱ የEmbodied AI አስተሳሰብ ግን “አካባቢውን ተረዳ፣ የሥራውን ዓላማ ተረዳ፣ እቃውን ለይተህ የሚገባውን መንገድ ምረጥ” የሚል ነው። ይህ ከባድ የቴክኖሎጂ ለውጥ ነው።</p>

${fig('robot-cnc.jpg', 'A LiDian robot tending a CNC machine tool', 'ሮቦቱ የCNC ማሽንን ሲያገለግል — ከአንድ ተግባር ወደ ሙሉ የሥራ ሂደት።')}

<h3>16. ኩባንያው ለምን “ሁሉንም ነገር በራሳችን” አይልም?</h3>
<p>ይህ ለቴክኖሎጂ ስታርታፕና ለኢንዱስትሪ ኩባንያዎች ጠቃሚ ትምህርት ነው። የሮቦት ኩባንያ ማለት ሞተር፣ ባትሪ፣ ቺፕ፣ የመገጣጠሚያ ክፍል፣ ሶፍትዌር፣ AI ሞዴልና ሌሎችን ሁሉ በራሱ ማምረት አይደለም።</p>
<p>የተሻለው አሠራር አንዳንድ ክፍሎችን ከልዩ ባለሙያ ኩባንያዎች መውሰድ፣ ሌሎቹን በራስ መሥራትና ሁሉንም በአንድ የሚሠራ ስርዓት ውስጥ ማገናኘት ሊሆን ይችላል።</p>
<p>ኩባንያው ራሱን በአስተሳሰብ ደረጃ ከ<strong>Siemens</strong> ጋር ማነፃፀር ይፈልጋል። ዓላማው አንድ ሮቦት ብቻ መሸጥ ሳይሆን፣ ሮቦቶች፣ ዳታ፣ AI ሞዴሎች፣ የሰው ክህሎትና የፋብሪካ ሲስተሞች እርስ በርሳቸው የሚገናኙበት መሠረተ ልማት መገንባት ነው።</p>

<h3>17. እነሱ የሚያዩት የወደፊቱ ሮቦቲክስ ምንድነው?</h3>
<p>የሰው-መሰል ሮቦት ወደፊት ሰውን በሙሉ ይተካል ብሎ በቀላሉ መደምደም ትክክል አይሆንም። ነገር ግን በተወሰኑ ሥራዎች ውስጥ ሰውን ሊያግዝ፣ አደገኛ ሥራዎችን ሊወስድ፣ የተደጋጋሚ ሥራን ሊያከናውንና የሰውን ጉልበት ሊቀንስ ይችላል።</p>
<p>በተለይ መጋዘን፣ ፋብሪካ፣ ሎጂስቲክስ፣ አደገኛ የሥራ ቦታዎች፣ ላቦራቶሪና የመኪና ኢንዱስትሪ ለመጀመሪያ ትግበራዎች ተገቢ መድረኮች ሊሆኑ ይችላሉ።</p>

<h3>18. ትልቁ ትምህርት፦ “Bad News” ማዳመጥ</h3>
<p>ከሊ ዌይቾንግ አባባሎች በጣም የሚያስተምረው አንዱ “bad news ማሰባሰብ” ነው።</p>
<p>አንድ ኩባንያ ሁልጊዜ “ሁሉም ነገር ጥሩ ነው” የሚል መረጃ ብቻ ከሰማ፣ እውነተኛውን ችግር ሊያይ አይችልም። እውነተኛ ችግር የሚገኘው ከደንበኛ፣ ከሠራተኛና ከቴክኒክ ቡድን የሚመጣውን አሉታዊ ግብረመልስ ሲያዳምጡ ነው።</p>
<p>ስለዚህ የኩባንያው አቀራረብ፦ <strong>ትንሽ ሞክር → ችግር ፈልግ → አስተካክል → እንደገና ሞክር።</strong> ይህንን በ24 እና በ48 ሰዓት የፈጣን ግብረመልስ ዑደት ለማከናወን እንደሚሞክሩ ይገልጻሉ።</p>
<p><em>“እኛ ፍጹምነትን ብቻ አንፈልግም፤ የምንፈልገው የሚሻሻል ስርዓት ነው።”</em></p>

<h3>19. ከ2,000 በላይ ትዕዛዞች?</h3>
<p>ኩባንያው እንደገለጸው፣ በ2026 ከጃንዋሪ እስከ ኦገስት ድረስ በመቶዎች የሚቆጠሩ ሮቦቶችን ለደንበኞች አስረክቧል። በተጨማሪም <strong>ከ2,000 በላይ ሮቦቶች የሚያካትቱ የማድረስ ትዕዛዞች</strong> በእጁ እንዳሉና በ2026 የሮቦት፣ የዳታና የሶፍትዌር ንግዱ ገቢ <strong>ከ300 ሚሊዮን ዩዋን በላይ</strong> እንደሚሆን ዋና ሥራ አስፈጻሚው ተናግረዋል።</p>
<p><strong>እነዚህ ቁጥሮች የኩባንያው የራሱ መግለጫዎች ናቸው</strong>፤ በነፃ ምንጭ አልተረጋገጡም። ልብ ሊባል የሚገባው፣ በተለየ መረጃ መሠረት <em>በጠቅላላው የጓንግዶንግ ክፍለ ሀገር</em> ከ2,000 በላይ ሰው-መሰል ሮቦቶች በፋብሪካዎች ውስጥ እየሠሩ እንደሆነ ይገለጻል — ተመሳሳይ ቁጥር ስለሆነ ሁለቱን ላለመቀላቀል ጥንቃቄ ያስፈልጋል።</p>

${fig('factory-floor.jpg', 'Robots and workers on a LiGong factory floor', 'የፋብሪካው ወለል — ሮቦቶችና ሰዎች በአንድ ቦታ።')}

<h3>20. የወደፊቱ ጥያቄ፦ 101ኛው ሥራ ከ1ኛው ይሻላል?</h3>
<p>የሮቦት ኩባንያ 100 የተለያዩ ፕሮጀክቶችን ካደረገ በኋላ፣ 101ኛውን ፕሮጀክት ከ1ኛው ይሻለው ይሆን?</p>
<p>ከሆነ፣ የቀድሞ ሥራዎች ዳታ፣ ሞዴሎች፣ ክህሎትና ልምድ ለቀጣዩ ሥራ ይጠቅማሉ። ይህ ማለት ኩባንያው በእያንዳንዱ ደንበኛ ላይ ከዜሮ እንደገና መጀመር የለበትም። ይህ ነው የAI እና የሮቦቲክስ የመማር ኢኮኖሚ።</p>

<h3>🇪🇹 21. ይህ ለኢትዮጵያ ምን ያሳያል?</h3>
<p>ሮቦቲክስ ማለት ሁልጊዜ በጣም ውድ የሆነ ሰው-መሰል ማሽን መግዛት ብቻ አይደለም። በኢትዮጵያ በቀላል ደረጃ መጀመር ይቻላል፦</p>
<ul>
<li>የመጋዘን አውቶሜሽን</li>
<li>የግብርና ማሽኖች</li>
<li>የፋብሪካ ማጓጓዣ</li>
<li>የሆስፒታል ሎጂስቲክስ</li>
<li>የላቦራቶሪ አውቶሜሽን</li>
<li>የእቃ መለያ ሲስተሞች</li>
<li>የኢንዱስትሪ ዳታ ማሰባሰብ</li>
<li>AI የሚቆጣጠራቸው የማምረቻ ሂደቶች</li>
</ul>
<p>በመጀመሪያ ሰውን ሙሉ በሙሉ ለመተካት ሳይሆን፣ የሰውን ሥራ ለማቃለልና ምርታማነትን ለመጨመር መጀመር ይቻላል።</p>
<p>ስለ AI እና ቴክኖሎጂ ሌሎች ጽሑፎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a> ያግኙ፤ በምህንድስና ዘርፍ ክፍት ሥራዎችን <a href="https://bina.et/jobs/category/engineering">እዚህ</a>፣ የኢንዱስትሪ ጨረታዎችን ደግሞ <a href="https://bina.et/tenders">በጨረታ ገጻችን</a> ይመልከቱ።</p>

<h3>🚀 22. የሚቀጥለው የሮቦቲክስ ውድድር ምን ይሆናል?</h3>
<p>ወደፊት የሮቦት ውድድር “ማን በጣም ፈጣን ነው?” ወይም “ማን ከፍ መዝለል ይችላል?” በሚለው ብቻ አይወሰንም። ዋናው ውድድር ወደዚህ ይሄዳል፦</p>
<ul>
<li>ማን በፍጥነት ሮቦትን ወደ እውነተኛ ሥራ ማስገባት ይችላል?</li>
<li>ማን የተሻለ የሥራ ዳታ ያገኛል?</li>
<li>ማን ሮቦቱን በተለያዩ ሥራዎች ማስማማት ይችላል?</li>
<li>ማን የሮቦት ዋጋን ከሚያመጣው የምርት ውጤት ጋር በተሻለ ሁኔታ ያመጣጥናል?</li>
</ul>

<h3>🧠 የመጨረሻ ሀሳብ</h3>
<p>የ里工实业 ታሪክ በቀላሉ “አንድ የቻይና ኩባንያ ሰው-መሰል ሮቦት ሠራ” የሚል ዜና ብቻ አይደለም። የበለጠ ጥልቅ ትምህርት አለው።</p>
<p>አንድ ቴክኖሎጂ የሚያሸንፈው ሰዎችን በማስደነቅ ብቻ አይደለም። <strong>የሚያሸንፈው እውነተኛ ችግር ሲፈታ ነው።</strong></p>
<p>ሮቦት መዝለል ይችላል። መሮጥ ይችላል። መደነስ ይችላል። ነገር ግን የኢንዱስትሪው ትልቁ ጥያቄ፦ <em>“ሙሉ ቀን በእውነተኛ የሥራ ቦታ ላይ የሚጠቅም ሥራ መሥራት ይችላል?”</em> የሚለው ነው።</p>
<p>ስለዚህ የወደፊቱ ሮቦት ብቻውን የሚሠራ ማሽን ሳይሆን፣ <strong>AI + Robot + Data + Human Skill + Industrial System</strong> የተቀናጀበት አካላዊ የAI ስርዓት ሊሆን ይችላል።</p>
<p>ከዚያም በኋላ ጥያቄው “AI ምን ሊያደርግ ይችላል?” ብቻ አይሆንም። <strong>“AI በእውነተኛው ዓለም ምን ሊሠራ ይችላል?”</strong> የሚለው ይሆናል።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>LiGong Industrial (里工实业)</strong> of Guangzhou spent close to forty years going from rubber sealing rings — made for a state-owned beer-bottling equipment factory — to humanoid robots. It is a second-generation family firm: CEO <strong>Li Weichong</strong>, born 1979, took it over from his father Li Qingguang in 2003, and opened a smart factory in Panyu in 2022. Its robots are branded <strong>里掂 LiDian</strong>: the <strong>D1</strong>, a full-size biped unveiled on 6 August 2024 with 28 degrees of freedom and 320 N·m of peak joint torque, and the <strong>F1</strong>, a wheeled dual-arm robot with 20 degrees of freedom, SLAM navigation and a 12 kg two-arm payload.</p>
<p>The interesting part is why they built them. No customer ever asked for a humanoid. They asked two questions — can you carry more at once, and can you carry heavier — and two arms were the answer. The company says the robots now work in factory transport, warehousing, vehicle painting, pharmaceutical storage and smart laboratories; that continuity rather than speed is what beats a human shift; and that a robot costs roughly 300,000 to 600,000 yuan, which only matters against what it produces. It also says it holds delivery orders covering more than 2,000 robots and expects over 300 million yuan of robot, data and software revenue in 2026. Those last figures are the company's own and are not independently confirmed — and note that a separate published figure puts <em>the whole of Guangdong province</em> at over 2,000 humanoid robots deployed in factories, so the two should not be confused.</p>
<p>For Ethiopia the lesson is not to buy a humanoid. It is that automation starts small — warehouse handling, agricultural machinery, hospital logistics, laboratory work, industrial data collection — and begins by making human work lighter, not by replacing it.</p>
`.trim();

(async () => {
  const data = {
    title: 'A 40-year-old Guangzhou factory built humanoid robots — LiGong and the LiDian D1 and F1',
    titleAm: '40 ዓመት የኢንዱስትሪ ታሪክ ያለው የጓንግዙ ኩባንያ ወደ ሰው-መሰል ሮቦት ዓለም ገባ',
    category: 'ቴክኖሎጂ',
    excerpt: 'ጥያቄው “ሮቦት መንቀሳቀስ ይችላል?” ከሚለው ወደ “ሮቦት በእውነት ሥራ መሥራት ይችላል?” ተቀይሯል — የጓንግዙው 里工实业 ከጎማ ማሸጊያ ቀለበት ተነስቶ በ40 ዓመት ውስጥ ወደ 里掂 D1 እና F1 ሰው-መሰል ሮቦቶች የደረሰበት መንገድ፣ እና ለኢትዮጵያ የሚሰጠው ትምህርት።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🤖',
    readMinutes: 12,
    evergreen: false,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
