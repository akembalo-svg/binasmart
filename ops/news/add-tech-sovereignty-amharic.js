'use strict';
// News post: technological sovereignty, from the minister's STRIDE Ethiopia 2.0 remarks.
//
//   node --env-file=.env ops/news/add-tech-sovereignty-amharic.js
//
// Desk check, 30 September 2026. Verified and kept:
//   · Dr Belete Molla Getahun has been Minister of Innovation and Technology since 6 October 2021.
//   · STRIDE Ethiopia 2.0 runs 29 September – 1 October 2026, theme "Fifty Years Journey, Five Years
//     of Delivery, Fifty Years Ahead" — added, his draft did not have the dates or the theme.
//   · His framing of sovereignty as choosing, adapting, creating and deciding independently — and
//     explicitly NOT isolation — matches Fana's report of the speech closely.
//   · EthioLLM, Amharic LLaMA and Walia-LLM are real; Walia has an ACL Anthology paper behind it.
//
// TWO NUMBERS TAKEN OUT because they could not be stood up:
//   · His draft said BinaSmart has "8,510 document chunks" and "114 self-test questions". Neither
//     figure appears anywhere in this codebase or in llms.txt, and the live count is 31,918 chunks,
//     31,803 of them public. Our own system in our own article - replaced with the real number.
//   · His draft said EthioNLP has 48 models, 29 datasets and works on 80+ languages. Their HuggingFace
//     organisation lists 13 models and 6 datasets and states no language count. Asked him for the
//     source; no answer, so the counts are dropped and only what is verifiable is named.
//
// Amharic: የሚያስደስበው -> የሚያስደስተው; ከረዥም -> ከረጅም.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'technological-sovereignty-ethiopia-amharic';
const IMG = '/static/news/tech-sovereignty';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የኢኖቬሽንና ቴክኖሎጂ ሚኒስትር ዶ/ር በለጠ ሞላ በSTRIDE Ethiopia 2.0 (መስከረም 19–21 ቀን 2019 ዓ.ም) መክፈቻ ላይ ያደረጉት ንግግር፤ በኢዜአ እና በፋና እንደተዘገበው። የጉባኤው መሪ ሃሳብ “Fifty Years Journey, Five Years of Delivery, Fifty Years Ahead” ነው።</p>

<p>ኢትዮጵያ ወደ አዲስ የቴክኖሎጂ ዘመን እየገባች ነው። ዛሬ ጥያቄው “ቴክኖሎጂ አለን?” ብቻ አይደለም። <strong>“የምንጠቀመውን ቴክኖሎጂ ለኢትዮጵያ ፍላጎት ማስማማት እንችላለን? የራሳችንን መፍጠርስ እንችላለን?”</strong> የሚለው ነው ዋናው።</p>

<figure style="margin:18px 0"><img src="${IMG}/cover.jpg" alt="Layers of Ethiopian technological sovereignty" style="width:100%;border-radius:12px" loading="lazy"><figcaption style="font-size:12.5px;color:#7b7566;margin-top:6px">ከዳታ ተነስቶ ወደ ቋንቋ፣ ወደ ሞዴል፣ ወደ አገልግሎት፣ ከዚያም ወደ አፍሪካ ገበያ።</figcaption></figure>

<h3>🧠 ቴክኖሎጂያዊ ሉዓላዊነት ማለት ምንድነው?</h3>
<p><strong>Technological Sovereignty</strong> ማለት ከውጭ የመጣን ቴክኖሎጂ በፍጹም አለመጠቀም ማለት አይደለም። በተቃራኒው፦ ቴክኖሎጂን መምረጥ፣ መረዳት፣ ለራስ ፍላጎት ማስማማት፣ መገንባትና ወሳኝ ውሳኔዎችን በራስ አቅም መወሰን መቻል ነው።</p>
<p>ሚኒስትሩ እንደገለጹት፣ የውጭ ቴክኖሎጂን መጠቀም ችግር አይደለም፤ ከተጠቀምንበት ቴክኖሎጂ ምንም ማስማማትና መፍጠር አለመቻል ግን ችግር ነው።</p>

<h3>🇪🇹 ከ“ተጠቃሚ” ወደ “ፈጣሪ”</h3>
<ul>
<li><strong>ደረጃ 1 — መጠቀም፦</strong> ከውጭ የመጣ ቴክኖሎጂን መጠቀም።</li>
<li><strong>ደረጃ 2 — መረዳት፦</strong> እንዴት እንደሚሠራ መማር።</li>
<li><strong>ደረጃ 3 — ማስማማት፦</strong> ለኢትዮጵያ ቋንቋ፣ ሕግ፣ ገበያና ባህል ማስማማት።</li>
<li><strong>ደረጃ 4 — መፍጠር፦</strong> የራስን ሶፍትዌር፣ AI ሞዴሎች፣ የዳታ ሥርዓቶችና መሠረተ ልማት መገንባት።</li>
<li><strong>ደረጃ 5 — ወደ ውጭ መላክ፦</strong> የኢትዮጵያ ቴክኖሎጂ ለአፍሪካና ለዓለም ገበያ መቅረብ።</li>
</ul>
<p>ኢዜአ የሚኒስትሩን ሀሳብ ሲዘግብ ኢትዮጵያ ከቴክኖሎጂ መግዛት ወደ ማስማማት፣ ማምረትና በመጨረሻም መላክ መሸጋገር እንዳለባት ጠቅሷል።</p>

<h3>🤖 ይህ ለAI ምን ማለት ነው?</h3>
<p>AI አሁን በትምህርት፣ በጤና፣ በግብርና፣ በፋይናንስ፣ በመንግሥት አገልግሎትና በኢንዱስትሪ ውስጥ እየገባ ያለ ቴክኖሎጂ ነው። ነገር ግን አንድ ትልቅ ጥያቄ አለ፦ <strong>“ኢትዮጵያን የሚያውቅ AI ማን ይገነባል?”</strong></p>
<p>አንድ ዓለም አቀፍ ሞዴል አማርኛ መጻፍ ይችላል። ይህ ብቻ ግን የኢትዮጵያን ሕጎች፣ የመንግሥት አሠራሮች፣ የአካባቢ ንግድና እውነታ ያውቃል ማለት አይደለም።</p>
<p>ስለዚህ AI sovereignty ማለት ሞዴል ብቻ መገንባት አይደለም፦ <strong>ዳታ + ቋንቋ + ሞዴል + ኮምፒውቲንግ + ሶፍትዌር + ሰው ኃይል + ደኅንነት + የአካባቢ እውቀት</strong> አብረው የሚሠሩበት ሥርዓት ነው።</p>

<h3>🗣️ ኢትዮጵያ በአማርኛ AI ላይ ምን እየተሠራ ነው?</h3>
<p>ይህ ከንድፈ ሀሳብ ብቻ አይደለም። <strong>EthioNLP</strong> የኢትዮጵያ ቋንቋዎች የቋንቋ ቴክኖሎጂ ላይ የሚሠራ የምርምር ማኅበረሰብ ሲሆን፣ <strong>EthioLLM</strong>፣ <strong>Amharic LLaMA</strong> እና <strong>Walia-LLM</strong> የተባሉ ሞዴሎችንና datasets ያሳትማል። Walia-LLM በአማርኛ ላይ የተስተካከለ LLaMA-2 ሞዴል ሲሆን፣ በACL Anthology የታተመ ጥናት አለው።</p>
<p>ይህ ማለት ኢትዮጵያ በAI ዘርፍ ዜሮ ላይ አይደለችም። ነገር ግን ከምርምር ወደ ትልቅ የንግድና የሀገር መሠረተ ልማት ደረጃ ለመሸጋገር ብዙ ሥራ ይቀራል።</p>

<h3>🏛️ የDigital Ethiopia 2030 አቅጣጫ</h3>
<p>የDigital Ethiopia 2030 ስትራቴጂ ቴክኖሎጂን በኢትዮጵያ ማንነትና ብሔራዊ ቅድሚያዎች ላይ የተመሠረተ እንዲሆን ያተኩራል። ሉዓላዊነት፣ ሀገር በቀልነት፣ ደኅንነት፣ ተናባቢነትና ዓለም አቀፍ ተወዳዳሪነት ከተጠቀሱ መርሆዎች መካከል ይገኛሉ።</p>
<p>እንደተዘገበው፣ የEthiopian Artificial Intelligence Institute አመራር የኢትዮጵያ ዳታና በአካባቢው የሚተዳደር ዲጂታል መሠረተ ልማት ለኢትዮጵያዊ AI ግንባታ ወሳኝ መሆኑን አብራርቷል፤ በአማርኛ፣ በአፋን ኦሮሞ፣ በትግርኛና በሶማልኛ የሚሠራ ሀገር በቀል LLM ሀሳብም ተነስቷል።</p>

<h3>🧩 BinaSmart ምን ያሳያል?</h3>
<p>እዚህ ላይ Bina.et ራሱ አንድ ተግባራዊ ምሳሌ ይሰጣል። BinaSmart በአማርኛና በአፋን ኦሮሞ ላይ የተተኮረ የሰነድ-ተመራ AI ሥርዓት ሲሆን፣ የኢትዮጵያ ሰነዶችን፣ የመንግሥት አገልግሎት መመሪያዎችን፣ ሕጎችንና የአዲስ አበባ መረጃዎችን ፈልጎ መልስ ይሰጣል። <strong>የእውቀት መደርደሪያው ዛሬ ከ31,800 በላይ የሰነድ ክፍሎች አሉት</strong>፤ መልሱም ሁልጊዜ ከምንጩ ጋር ይቀርባል።</p>
<p>በተለይ የሚያስደስተው ነጥብ ግን BinaSmart ራሱ ስለ AI sovereignty ግልጽ መሆኑ ነው፦ የኢትዮጵያ የሰነድ እውቀት፣ የአማርኛ/አፋን ኦሮሞ የአጻጻፍ መመሪያ፣ የተግባር tools፣ የተጠቃሚ ማኅደርና ኮዱ የራሱ ናቸው፤ <strong>የቋንቋ ሞዴሉ ግን ከዓለም አቀፍ አቅራቢ በፈቃድ የሚመጣ መሆኑን በግልጽ ይናገራል</strong>።</p>
<p>ቴክኖሎጂያዊ ሉዓላዊነት ማለት “ሁሉም ነገር 100% የእኛ ነው” ማለት አይደለም። <strong>የትኛው ክፍል የእኛ ነው? የትኛውን ከውጭ እንጠቀማለን? የትኛውን ነገ ራሳችን እንገነባለን?</strong> — ይህን በግልጽ መለየት ራሱ የሉዓላዊነት አካል ነው።</p>

<h3>🗣️ “አማርኛ AI” ማለት አማርኛ መጻፍ ብቻ አይደለም</h3>
<p>እውነተኛ Ethiopian AI ሲባል፦ ቋንቋን ያውቃል → የአካባቢውን እውቀት ያውቃል → የኢትዮጵያን ሕግና ሥርዓት ይረዳል → ችግሩን ይለያል → ተግባር ይፈጽማል።</p>
<p>ለምሳሌ <em>“የንግድ ፈቃድ እንዴት አወጣለሁ?”</em> ሲባል፣ የውጭ AI አጠቃላይ መልስ ሊሰጥ ይችላል። Ethiopian AI ግን የኢትዮጵያን የንግድ ምዝገባ፣ ፋይዳ፣ ግብር፣ ፈቃድና የአሁኑን መመሪያ ከትክክለኛ ምንጭ ፈልጎ መመለስ ይኖርበታል። ይህ ነው <strong>local intelligence</strong>።</p>

<h3>🔐 ሌላው ትልቅ ጉዳይ — ዳታ</h3>
<p>AI ያለ ዳታ አይገነባም። የኢትዮጵያ መረጃ ካልተደራጀ፣ ተደራሽ ካልሆነና በአግባቡ ካልተጠበቀ፣ የኢትዮጵያን ችግር በጥልቀት የሚፈታ AI መገንባት አስቸጋሪ ይሆናል። በግብርና፣ በጤና፣ በትምህርት፣ በፍትሕ፣ በንግድ፣ በከተማ አገልግሎትና በኢንዱስትሪ የሚፈጠሩ መረጃዎች ለወደፊት AI ትልቅ ሀብት ናቸው።</p>

<h3>🌾 ከቴክኖሎጂ ወደ የሀገር ችግር መፍትሔ</h3>
<p>የሚኒስትሩ ንግግር አንድ ጠቃሚ ሀሳብ ይዟል፦ ምርምር ከወረቀት ወደ ማኅበረሰብ፣ ከላቦራቶሪ ወደ ፋብሪካ፣ ከጽሑፍ ወደ ገበያ መሄድ አለበት።</p>
<p>AI የሚጠቅመው የሰብል ምርትን ለመገመት፣ በጤና ዘርፍ ለማገዝ፣ ትምህርትን ለማሻሻል፣ የፋብሪካ ምርታማነትን ለማሳደግ፣ የከተማ አገልግሎትን ለማሻሻል፣ የሕግ ሰነዶችን ለማደራጀት፣ የኢትዮጵያ ቋንቋዎችን ወደ ዲጂታል ዓለም ለማስገባትና ለአዳዲስ የሥራ ዕድሎች ነው።</p>

<h3>👨‍💻 የወጣቶች ሚና</h3>
<p>የቴክኖሎጂ ሉዓላዊነት በመንግሥት ብቻ ሊገነባ አይችልም። ፕሮግራመሮች፣ የAI ተመራማሪዎች፣ data scientists፣ መሐንዲሶች፣ ዲዛይነሮች፣ ሥራ ፈጣሪዎች፣ የቋንቋ ባለሙያዎችና የሳይበር ደኅንነት ባለሙያዎች ያስፈልጋሉ። ሚኒስትሩም ወጣቶችን እንደ አገሪቱ ትልቁ ሀብት በመጥቀስ ማብቃት እንደሚያስፈልግ ገልጸዋል።</p>

<h3>🌍 ሉዓላዊነት ማለት ከዓለም መለየት አይደለም</h3>
<p><strong>Sovereignty ≠ Isolation።</strong> የዓለም ኩባንያዎችን፣ ዩኒቨርሲቲዎችን፣ open-source ማኅበረሰቦችንና አጋሮችን መጠቀም ይቻላል። ዋናው ጥያቄ ግን <strong>“እኛ ራሳችን ምን እንችላለን?”</strong> የሚለው ነው።</p>

<h3>🇪🇹 መደምደሚያ</h3>
<p>የዶ/ር በለጠ ሞላ ንግግር አንድ ትልቅ ጥያቄ ከፍቷል፦ ኢትዮጵያ በቴክኖሎጂ ተጠቃሚ ብቻ ትሆናለች? ወይስ ፈጣሪም ትሆናለች?</p>
<p>የቴክኖሎጂ ሉዓላዊነት ማለት ከዓለም መለየት አይደለም። የዓለምን ቴክኖሎጂ መማር፣ መጠቀም፣ ማስማማት፣ በራስ አቅም መገንባትና በመጨረሻ ለሌሎች ማቅረብ ነው።</p>
<p>በAI ዘመን ዋናው ጥያቄ ምናልባት ይህ ይሆናል፦ <strong>“AI ኢትዮጵያን ይረዳል?” ብቻ ሳይሆን — “ኢትዮጵያ የራሷን AI ለምን መፍጠር አትችልም?”</strong></p>

<p>ስለ AI፣ ሮቦቲክስና ቴክኖሎጂ ሌሎች ጽሑፎቻችንን <a href="https://bina.et/news">በዜና ገጻችን</a>፣ ስለ <a href="https://bina.et/news/ai-agi-asi-si-explained-amharic">AI፣ AGI እና ASI</a> ደግሞ እዚህ ያንብቡ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>Opening STRIDE Ethiopia 2.0 (29 September – 1 October 2026), Innovation and Technology Minister Dr Belete Molla argued that technological sovereignty is not isolation. It is the capacity to choose technologies, understand them, adapt them to Ethiopia's needs, build domestic capability and make the strategic decisions independently — while still collaborating internationally. Using foreign technology is not the problem; being unable to adapt or create anything from it is.</p>
<p>For AI that widens the question from "can it write Amharic?" to "who builds an AI that knows Ethiopia?" — its laws, its administrative processes, its markets and its realities. Sovereignty there is not a model alone but a stack: data, languages, models, compute, software, people, security and local knowledge.</p>
<p>Ethiopia is not starting from zero. EthioNLP publishes models and datasets for Ethiopian languages, including EthioLLM, Amharic LLaMA and Walia-LLM, an Amharic-tuned LLaMA-2 with a published paper behind it. BinaSmart is a working example of the split in practice: the Ethiopian document knowledge, the Amharic and Afaan Oromoo writing rules, the tools, the memory and the code are ours — over 31,800 passages, always answered with the source — while the language model itself is licensed from an international provider, and the site says so plainly. Sovereignty does not mean everything is yours. It means knowing which part is.</p>
`.trim();

(async () => {
  const data = {
    title: 'Technological sovereignty: Ethiopia must choose, adapt and create — not only use',
    titleAm: 'ቴክኖሎጂያዊ ሉዓላዊነት፦ ኢትዮጵያ ቴክኖሎጂን መጠቀም ብቻ ሳይሆን መምረጥ፣ ማስማማትና መፍጠር አለባት',
    category: 'ቴክኖሎጂ',
    excerpt: 'የኢኖቬሽንና ቴክኖሎጂ ሚኒስትር ዶ/ር በለጠ ሞላ በSTRIDE Ethiopia 2.0 መክፈቻ ላይ ያነሱት ሀሳብ፦ የውጭ ቴክኖሎጂን መጠቀም ችግር አይደለም፤ ከእሱ ምንም ማስማማትና መፍጠር አለመቻል ግን ችግር ነው። ለኢትዮጵያ የAI ዘመን ይህ ምን ማለት ነው?',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🇪🇹',
    readMinutes: 8,
    evergreen: true,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
