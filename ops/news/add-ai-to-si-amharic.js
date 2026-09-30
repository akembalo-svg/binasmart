'use strict';
// News post: AI, AGI, ASI and the 2026 "SI" rename.
//
//   node --env-file=.env ops/news/add-ai-to-si-amharic.js
//
// Desk check, 28 September 2026. Both load-bearing facts were verified before publishing:
//
//  · The rename is real. At the UN General Assembly on 22 September 2026 the US President said the word
//    "artificial" makes intelligence sound fake and that US documents would use "super" instead. The
//    State Department then instructed its diplomats to use the term. Added to his draft, because it
//    shows this became an instruction rather than staying a remark.
//  · SuperARC is real: published in Nature Communications, led by Dr Hector Zenil of King's College
//    London, built on algorithmic complexity rather than human-style exam questions. His draft cited it
//    but left out its actual finding, which answers his own section 6: leading models are still far from
//    AGI or ASI, newer versions are sometimes weaker than older ones, and a hybrid neuro-symbolic
//    approach beat the large language models. That is evidence where he had an opinion.
//
// His central distinction — SI-as-a-name is not ASI-as-a-concept — is exactly the point commentators
// made at the time, and it is the strongest paragraph in the piece. It is carried into the artwork.
//
// Three graphics were built here from his own sections 4, 7 and 12 in BinaSmart's styling.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'ai-agi-asi-si-explained-amharic';
const IMG = '/static/news/ai-to-si';
const fig = (f, alt, cap) =>
  `<figure style="margin:18px 0"><img src="${IMG}/${f}.jpg" alt="${alt}" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">${cap}</figcaption></figure>`;

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ማስታወሻ፦</strong> ይህ ጽሑፍ AI፣ AGI፣ ASI እና SI የሚሉ ቃላትን ለማብራራት የተዘጋጀ ነው። የ2026 የ“SI” ስያሜ አጠቃቀምና የAI ምርምር “ASI” ጽንሰ-ሐሳብ <strong>እንዳይደባለቁ</strong> ተለይተው ቀርበዋል።</p>

<p>የAI ዓለም በፍጥነት እየተቀየረ ነው። ከቀላል የድር ፍለጋና የጽሑፍ ማመንጨት ጀምሮ፣ ዛሬ AI ኮድ መጻፍ፣ ምስልና ቪዲዮ መፍጠር፣ ሳይንሳዊ መረጃ መተንተን፣ ምርምር ማገዝና በተወሰኑ ሥራዎች ከሰው ጋር የሚወዳደር አፈጻጸም ማሳየት ጀምሯል።</p>
<p>አሁን ግን አዲስ ቃል በዓለም የቴክኖሎጂ ውይይት ውስጥ ገብቷል፦ <strong>SI — Super Intelligence</strong>።</p>
<p>ታዲያ AI በእውነት ወደ SI ተቀይሯል? SI ማለት ምንድነው? AGI እና ASI ከዚህ ጋር ምን ያገናኛቸዋል? የዛሬ AI ከሰው አእምሮ በላይ ደርሷል ማለት ይቻላል?</p>

<h3>1. AI ምንድነው?</h3>
<p><strong>AI — Artificial Intelligence</strong> ወይም ሰው ሠራሽ አስተውሎት ማለት በኮምፒውተር ሥርዓት ውስጥ በሰው አእምሮ የሚፈጸሙ አንዳንድ የማሰብ፣ የመማር፣ የመተንተንና የውሳኔ ሥራዎችን ማከናወን የሚችል ቴክኖሎጂ ነው።</p>
<p>ለምሳሌ፦ ጽሑፍ መጻፍ፣ ቋንቋ መተርጎም፣ ፎቶ መተንተን፣ ድምፅ መረዳት፣ ኮድ መጻፍ፣ የመረጃ ትንተና፣ ምስልና ቪዲዮ መፍጠር፣ ሳይንሳዊ ምርምርን ማገዝ።</p>
<p>ዛሬ የምንጠቀምባቸው ብዙ AI ሥርዓቶች ግን ለተወሰኑ ዓይነት ሥራዎች የተሠሩ ናቸው። ስለዚህ “AI ሁሉንም ነገር ያውቃል” ብሎ መደምደም ትክክል አይደለም።</p>

<h3>2. ከAI በኋላ AGI ምንድነው?</h3>
<p><strong>AGI — Artificial General Intelligence</strong> ከAI የበለጠ ሰፊ ጽንሰ-ሐሳብ ነው። ዛሬ ያሉ AI ሥርዓቶች በብዙ ሥራዎች ጠንካራ ቢሆኑም፣ AGI የሚባለው በተለያዩ የእውቀት መስኮች በሰፊው መማር፣ መረዳት፣ መላመድና ችግር መፍታት የሚችል ሥርዓትን ያመለክታል።</p>
<p>ለምሳሌ አንድ ሥርዓት ዛሬ ኮድ ይጽፋል፣ ነገ ሳይንስ ይማራል፣ ከዚያ የንግድ ችግር ይፈታል፣ ከዚያ ሮቦት ይቆጣጠራል፤ አዲስ ችግር ሲመጣም ራሱን አስተካክሎ ይማራል። ይህ ወደ AGI የሚያመለክት ሀሳብ ነው።</p>
<p>ነገር ግን AGI ምን ያህል እንደተሳካ የሚለካበት አንድ የተስማማ የዓለም መለኪያ የለም።</p>

<h3>3. ከAGI በኋላ ASI ምንድነው?</h3>
<p><strong>ASI — Artificial Superintelligence</strong> በአሁኑ ጊዜ የተረጋገጠ የሚሠራ ቴክኖሎጂ ሳይሆን የወደፊት ግምታዊ ደረጃ ነው። በብዙ የእውቀት መስኮች ከሰው አእምሮ በእጅጉ የሚበልጥ የማሰብ፣ የመማር፣ የፈጠራና የችግር መፍታት ችሎታ ያለው ሥርዓት ማለት ነው።</p>
<p>ሦስቱን በአጭሩ፦ <strong>AI</strong> የእውቀት ሥራዎችን የሚያግዝ ቴክኖሎጂ · <strong>AGI</strong> እንደ ሰፊ የሰው ችሎታ ሊሠራ የሚችል ግብ · <strong>ASI</strong> ከሰው አእምሮ በእጅጉ የሚበልጥ የወደፊት ጽንሰ-ሐሳብ።</p>

<h3>4. ታዲያ SI ምንድነው?</h3>
<p>እዚህ ላይ የ2026 አዲሱ ውይይት ይጀምራል። <strong>በሴፕቴምበር 22 ቀን 2026 በተባበሩት መንግሥታት ጠቅላላ ጉባኤ ንግግር ወቅት</strong> የአሜሪካ ፕሬዚዳንት ዶናልድ ትራምፕ “artificial” የሚለው ቃል ብልህነትን ሐሰተኛ ያስመስለዋል በማለት፣ ከዚያ ወዲህ የአሜሪካ ሰነዶች “super” የሚለውን እንዲጠቀሙ ገለጹ።</p>
<p>ይህ በንግግር ብቻ አልቀረም፦ <strong>የአሜሪካ የውጭ ጉዳይ መሥሪያ ቤት ዲፕሎማቶቹ ቃሉን እንዲጠቀሙ አዘዘ</strong>።</p>
<p>ነገር ግን ይህ ማለት አዲስ የAI ቴክኖሎጂ ተፈጥሯል ማለት አይደለም። በዚህ አጠቃቀም “SI” የሚለው ቃል AIን ለመጥራት የቀረበ <strong>አዲስ ስያሜ</strong> ነው። በAI ምርምር ውስጥ ግን superintelligence / ASI ቀድሞውኑ ያለ ቴክኒካዊ ቃል ነው።</p>

${fig('si-vs-asi', 'Comparison of SI as a 2026 naming decision versus ASI as a scientific concept', 'ሁለቱ ቃላት አንድ አይደሉም — አንዱ የስያሜ ውሳኔ ነው፤ ሌላው የሳይንስ ጽንሰ-ሐሳብ።')}

<p><strong>SI እንደ አዲስ ስያሜ ≠ ASI እንደ የሳይንስ ጽንሰ-ሐሳብ።</strong> ይህን ልዩነት ማወቅ ወሳኝ ነው።</p>

<h3>5. ለምን “Artificial” ከ“Super” ተቀየረ?</h3>
<p>የቀረበው ምክንያት ቃሉ የሰው ሠራሽ ወይም ሐሰተኛ የሚመስል ትርጉም ሊፈጥር ስለሚችል ነው። ነገር ግን ይህን ከሳይንሳዊ ትርጉሙ ጋር ማደባለቅ አይገባም። <strong>ስም መቀየር የቴክኖሎጂ ደረጃን በራሱ አይቀይርም።</strong></p>

<h3>6. ዛሬ ያለው AI በእውነት “Super” ነው?</h3>
<p>አንዳንድ የAI ሥርዓቶች በተወሰኑ ሥራዎች ከሰው የተሻለ ውጤት ሊያሳዩ ይችላሉ፦ ብዙ ጽሑፍ በፍጥነት መተንተን፣ በአጭር ጊዜ ኮድ ማመንጨት፣ ብዙ ሰነዶችን ማወዳደር፣ ምስልን በፍጥነት መመርመር፣ የሂሳብ ወይም የኮድ ችግሮችን መፍታት።</p>
<p>ነገር ግን በአንድ ሥራ ላይ ከሰው መብለጥ ማለት በሁሉም የእውቀት መስኮች ከሰው መብለጥ አይደለም።</p>
<p>ይህን ለመለካት የተሠራ አንድ ፈተና አለ። <strong>SuperARC</strong> የሚባለው ምርምር በ<strong>Nature Communications</strong> የታተመ ሲሆን፣ የሚመራውም በKing's College London የሚገኙት ዶ/ር ሄክተር ዜኒል ናቸው። ፈተናው የተገነባው በአልጎሪዝማዊ ውስብስብነት ላይ እንጂ በሰው ዓይነት የፈተና ጥያቄዎች ላይ አይደለም።</p>
<p><strong>ውጤቱ ግልጽ ነው፦</strong> መሪዎቹ ሞዴሎች ገና ከAGI ወይም ከASI በጣም ሩቅ ናቸው፤ አንዳንዴም አዲሶቹ ከቀድሞዎቹ ያንሳሉ፤ እንዲሁም ድቅል (neuro-symbolic) አቀራረብ ከትልልቆቹ የቋንቋ ሞዴሎች የተሻለ ውጤት አሳይቷል።</p>

<h3>7. AI → AGI → ASI የሚለው ጉዞ እንዴት ይታያል?</h3>

${fig('stages', 'Five stages from narrow AI to ASI, in Amharic', 'አምስቱ ደረጃዎች። የመጀመሪያዎቹ ሦስቱ ዛሬ አሉ፤ የመጨረሻዎቹ ሁለቱ ገና ጽንሰ-ሐሳብ ናቸው።')}

<p>ይህ ግን የተረጋገጠ የቴክኖሎጂ መንገድ አይደለም፤ ለመረዳት የሚያገለግል ማብራሪያ ነው።</p>

<h3>8. SI እና ሮቦት — ለምን አብረው ይመጣሉ?</h3>
<p>AI አእምሮ ከሆነ፣ ሮቦት ደግሞ በአካላዊ ዓለም የሚሠራ አካል ሊሆን ይችላል። ይህንን <strong>Embodied AI / Physical AI</strong> በሚባለው መስክ እያየነው ነው።</p>
<p>ሮቦት፦ ይመለከታል → ይረዳል → ያቅዳል → ይወስናል → ይንቀሳቀሳል → ውጤቱን ይመለከታል → እንደገና ይማራል። ይህ ነው AI ከዲጂታል ዓለም ወጥቶ ወደ አካላዊ ዓለም የሚገባበት መንገድ።</p>
<p>በዚህ ምክንያት የሰው ቅርጽ ያላቸው ሮቦቶች፣ የፋብሪካ ሮቦቶች፣ <a href="https://bina.et/news/agriculture-robots-demo-vs-business-amharic">የግብርና ሮቦቶች</a> እና ራሳቸውን የሚመሩ ማሽኖች ከAI ዕድገት ጋር በጣም የተያያዙ ሆነዋል።</p>

<h3>9. AI ሳይንስን ሊቀይር ይችላል?</h3>
<p>አዎ፣ ይህ ከትልቁ የAI ተስፋዎች አንዱ ነው። AI የሳይንስ ምርምርን ሊያግዝ የሚችለው ብዙ ሳይንሳዊ ጽሑፎችን በፍጥነት በማንበብ፣ አዲስ ግንኙነቶችን በመፈለግ፣ አዲስ ሙከራዎችን በመጠቆም፣ የሞለኪውልና የፕሮቲን ምርምርን በማፋጠን፣ የጄኔቲክ መረጃን በመተንተን፣ ኮድን በመጻፍና የሙከራ ውጤትን በመተንተን ነው።</p>

<h3>10. ከዚህ በኋላ የሚመጣው ትልቁ ጥያቄ</h3>
<p>ትልቁ ጥያቄ “AI ምን ያህል ብልህ ነው?” ብቻ አይደለም። ከዚያ የበለጠ አስፈላጊው፦ <strong>AI ምን ያህል በእውነተኛ ዓለም ላይ ጠቃሚ ነው?</strong></p>
<p>AI አንድ ሪፖርት መጻፍ ይችላል — ግን ያንን ተጠቅሞ ትክክለኛ የንግድ ውሳኔ ሊወስን ይችላል? AI ኮድ መጻፍ ይችላል — ግን ትልቅ የሶፍትዌር ሥርዓት በራሱ ሊያስተዳድር ይችላል? AI ሮቦትን ማዘዝ ይችላል — ግን በእውነተኛ ፋብሪካ ላይ ለሰዓታት ያለማቋረጥ በደኅንነት ሊሠራ ይችላል?</p>

<h3>11. የAI ወደ SI ዘመን ትልቁ ፈተና</h3>
<p>የቴክኖሎጂ እድገት ብቻ በቂ አይደለም። የሚመጡት ጥያቄዎች፦</p>
<ul>
<li><strong>ደኅንነት</strong> — AI ስህተት ሲሠራ ማን ይጠየቃል?</li>
<li><strong>የግል መረጃ</strong> — AI ምን ያህል መረጃ ሊያገኝ ይገባል?</li>
<li><strong>ሥራ</strong> — አንዳንድ ሥራዎች ሲቀየሩ ሰዎች እንዴት ይላመዳሉ?</li>
<li><strong>ትምህርት</strong> — ተማሪዎች AIን እንደ መማሪያ መሣሪያ እንዴት ይጠቀማሉ?</li>
<li><strong>ሳይንስ</strong> — AI አዲስ ግኝት ሲያቀርብ ሰው እንዴት ያረጋግጠዋል?</li>
<li><strong>ሕግና ኃላፊነት</strong> — AI የወሰነው ውሳኔ ለጉዳት ቢዳርግ ኃላፊነቱ የማን ነው?</li>
</ul>

<h3>🇪🇹 12. ኢትዮጵያ ከዚህ ምን መማር ትችላለች?</h3>

${fig('ethiopia', 'Nine areas where AI can be applied in Ethiopia, in Amharic', 'AIን መጠቀም ማለት አዲስ chatbot መክፈት ብቻ አይደለም።')}

<p>በተለይ እንደ አማርኛ ያሉ ቋንቋዎችን AI እንዲረዳ የሚያደርጉ የውሂብ ስብስቦች፣ የድምፅ መረጃ፣ የትርጉም ቴክኖሎጂና የአካባቢ እውቀት መገንባት የሚቀጥለው ትልቅ የቴክኖሎጂ ሥራ ሊሆን ይችላል።</p>

<h3>13. ስለዚህ AI ወደ SI ደርሷል?</h3>
<p>በቀጥታ እንዲህ ማለት አይገባም። በ2026 የተነሳው “AI አሁን SI ይባላል” የሚለው ዜና በዋናነት የስያሜና የፖሊሲ ውይይት ነው። በሳይንሳዊ ዓለም ግን “superintelligence” ከሰው በላይ የሆነ ችሎታን ይገልጻል፤ ያ ደረጃ ዛሬ ተረጋግጧል ብሎ መናገር ገና አይቻልም።</p>

<h3>🌍 ከAI ወደ SI — የሚመጣው ዘመን</h3>
<p>የAI ታሪክን በአንድ መስመር ብንመለከት፦ የሚያውቅ ማሽን → የሚማር ማሽን → የሚያመነጭ AI → የሚያቅድ AI Agent → AGI የሚባል ሰፊ ችሎታ → እና ምናልባት አንድ ቀን ASI።</p>
<p>ይህ ጉዞ ግን በአንድ ሌሊት አይጠናቀቅም። ዛሬ የምናየው የAI ሥርዓቶች ከ“መልስ ሰጪ መሣሪያ” ወደ “ሥራ የሚያከናውን ዲጂታል ወኪል”፣ ከዚያም ወደ “ሳይንስንና አካላዊ ዓለምን የሚረዳ ሥርዓት” እየተሸጋገሩ መሆናቸው ነው።</p>
<p>ስለዚህ ትልቁ ጥያቄ <strong>“AI ምን ይባላል?” ሳይሆን “AI ምን ማድረግ ይችላል?”</strong> ነው። የሚቀጥለው የቴክኖሎጂ ዘመን ምናልባት በስም ለውጥ ሳይሆን በችሎታ ለውጥ ይለካል።</p>

<p>ስለ AI፣ ሮቦቲክስና ቴክኖሎጂ ሌሎች ጽሑፎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a> ያግኙ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>On 22 September 2026, at the UN General Assembly, the US President said the word "artificial" makes intelligence sound fake and announced that American documents would use "super" instead — SI rather than AI. The State Department then told its diplomats to use the term.</p>
<p>That is a naming decision, not a technological one, and it collides with a word that already had a meaning. In AI research, <strong>superintelligence</strong> (ASI) describes a system that far exceeds human ability across many domains — a future concept, not a shipping product. So SI-as-a-label and ASI-as-a-concept are not the same thing, and confusing them is the easiest mistake to make this year.</p>
<p>Is today's AI actually "super"? A test built for that question — <strong>SuperARC</strong>, published in Nature Communications and led by Dr Hector Zenil at King's College London — measures models on algorithmic complexity rather than human-style exam questions. Its finding: leading models remain far from AGI or ASI, newer versions are sometimes weaker than older ones, and a hybrid neuro-symbolic approach outperformed the large language models.</p>
<p>The useful question for Ethiopia is not what the technology is called. It is where it can do real work — agriculture, health, education, banking, transport, trade, government services, scientific research, and above all Amharic language technology: the datasets, speech data and local knowledge that would let any of these systems understand the language in the first place.</p>
`.trim();

(async () => {
  const data = {
    title: 'AI, AGI, ASI and the 2026 "Super Intelligence" rename — what actually changed',
    titleAm: 'AI ወደ SI እየተቀየረ ነው? — AI፣ AGI እና ASI ምንድናቸው?',
    category: 'ቴክኖሎጂ',
    excerpt: 'በሴፕቴምበር 2026 “Artificial Intelligence” በ“Super Intelligence” እንዲተካ ተወሰነ። ይህ ግን የስያሜ ውሳኔ እንጂ አዲስ ቴክኖሎጂ አይደለም። AI፣ AGI፣ ASI እና SI ምን ማለት ናቸው? በNature Communications የታተመው SuperARC ፈተና ደግሞ ምን አለ? እና ለኢትዮጵያ ትርጉሙ ምንድነው?',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🤖',
    readMinutes: 9,
    evergreen: true,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
