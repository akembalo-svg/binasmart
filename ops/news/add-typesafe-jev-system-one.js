'use strict';
// News post: TypeSafe AI and Jev — an AI that decides instead of writing, and what it found on our own board.
//
//   node --env-file=.env ops/news/add-typesafe-jev-system-one.js
//
// The owner sent an Amharic draft about TypeSafe and asked for it to be published. It is NOT reproduced
// here: every claim was checked against TypeSafe's own pages on 23 September 2026 and rewritten in our
// register, and the article's second half is something no other Amharic piece can carry — what happened
// when this very server ran Jev over its own job board.
//
// Sources, read 23 September 2026:
//   · typesafe.ai — "193.6x Faster, 444.6x Cheaper", footnoted "*based on workflows for System One
//     tasks"; "$42 Per Billion input tokens"; "238x Lower input price than Claude Fable 5.1";
//     System One Models defined as "a new architecture, a new sampler, and a new training algorithm:
//     Reinforcement Learning for Calibrated Decisions (RLCD)"
//   · typesafe.ai/team — Diogo Almeida (CEO, Google Brain, "co-invented RLHF and InstructGPT"),
//     Sasha Sheng (COO, ex-Meta/FAIR), Erik Gafni (CTO, repeat founder)
//   · press coverage of the 15 September 2026 launch: out of stealth with $40M seed
//
// Our own figures are from this server's logs, 22-23 September 2026, and are stated with their cost.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'typesafe-jev-system-one-amharic';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የTypeSafe AI የራሱ ገጾች (typesafe.ai እና typesafe.ai/team)፣ ሴፕቴምበር 23 ቀን 2026 የተነበቡ። የፍጥነትና የዋጋ ቁጥሮች የኩባንያው የራሱ መለኪያዎች ናቸው፤ ሁኔታቸው አብሮ ተጠቅሷል። የመጨረሻው ክፍል ግን የእኛ የራሳችን ሙከራ ነው።</p>

<figure style="display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;background:#fff;border:1px solid #e8e2d6;border-radius:12px;padding:20px 18px;margin:22px 0">
  <img src="/static/newslogos/typesafe.png" alt="TypeSafe AI" width="48" height="48" style="height:48px;width:48px;border-radius:12px">
  <span style="font-size:20px;font-weight:800;color:#141a24">TypeSafe AI</span>
  <figcaption style="flex-basis:100%;text-align:center;font-size:12px;color:#8b8578;margin-top:8px">የTypeSafe AI የንግድ ምልክት፡ ለመለያ ብቻ ያገለግላል። · TypeSafe AI trademark, shown for identification only.</figcaption>
</figure>

<p>AI ሲባል ChatGPT፣ Claude ወይም Gemini ይታወሰናል — እንጠይቃለን፣ ይጽፉልናል። ይህ ግን AI ከሚሠራው ሥራ አንዱ ዓይነት ብቻ ነው።</p>
<p>ብዙውን ጊዜ ሶፍትዌር የሚፈልገው ረጅም መልስ አይደለም። <strong>አንድ ውሳኔ</strong> ነው የሚፈልገው። "ይህ መልእክት ስለ ክፍያ ነው ወይስ ስለ ማድረስ?" — መልሱ አንድ ቃልና አንድ ቁጥር ነው። ለዚህ ሥራ ደግሞ አንቀጽ የሚጽፍ ሞዴል መጠቀም መዶሻ በሚያስፈልግበት ቦታ መኪና እንደመጠቀም ነው።</p>
<p>ይህ ጽሑፍ <strong>TypeSafe AI</strong> የተባለውን ኩባንያና <strong>Jev</strong> የተባለውን ሞዴሉን ነው የሚያብራራው — እንዲሁም እኛ ራሳችን በእውነተኛ ሥራ ላይ ስንሞክረው ያገኘነውን።</p>

<h3>🏢 TypeSafe AI ምንድነው?</h3>
<p>በሳን ፍራንሲስኮ የሚገኝ የAI ኩባንያ ሲሆን፣ ሴፕቴምበር 15 ቀን 2026 ከስውር ሥራ ወጥቶ የ40 ሚሊዮን ዶላር የመጀመሪያ ዙር ገንዘብ ማግኘቱን አስታውቋል። የሚሠራው ሞዴል ዓይነት <strong>"System One Models"</strong> ይባላል።</p>
<p>ስሙ ከሥነ-ልቦና የተወሰደ ነው፦ <em>System 1</em> ማለት ሰው ሳያስብ ወዲያውኑ የሚወስነው ነው፤ <em>System 2</em> ደግሞ ቁጭ ብሎ የሚያሰላው። አብዛኞቹ የዛሬ ሞዴሎች System 2 ናቸው — ያስባሉ፣ ይጽፋሉ፣ ጊዜ ይወስዳሉ። TypeSafe የሚለው ግን <strong>አብዛኛው የሶፍትዌር ውሳኔ System 1 ነው</strong> የሚፈልገው የሚል ነው።</p>
<p>የመጀመሪያው ምርቱ <strong>Jev</strong> ነው።</p>

<h3>🤖 Jev ምን ይለያል?</h3>
<p>ተራ ሞዴል ቃል በቃል እየጻፈ ይሄዳል። Jev ግን ጽሑፍ አያመነጭም፦ የተዘጋጀ ጥያቄ ተቀብሎ <strong>የተወሰነ መልስና የእምነት መጠን</strong> ይመልሳል።</p>
<p>ለምሳሌ አንድ የደንበኛ መልእክት፦</p>
<p style="background:#f7f7f5;border-radius:8px;padding:12px 16px;font-style:italic">"ከካርዴ ሁለት ጊዜ ገንዘብ ተቀንሷል።"</p>
<p>ተራ ሞዴል አንቀጽ ይጽፍለታል። Jev የሚመልሰው ይህን ነው፦</p>
<ul>
<li>ምድብ → <strong>ክፍያ</strong></li>
<li>እምነት → <strong>98%</strong></li>
</ul>
<p>ከዚያ ኮዱ ራሱ ቀጣዩን እርምጃ ይወስዳል። ልዩነቱ በአጭሩ፦ ከ"<em>ጥያቄ → ጽሑፍ</em>" ወደ "<em>ሁኔታ → ውሳኔ → እርምጃ</em>" መሸጋገር ማለት ነው።</p>

<h3>🛡️ የእምነት መጠኑ ለምን ዋጋ አለው</h3>
<p>ይህ የJev ዋና ነጥብ ነው፤ ፍጥነቱ አይደለም። ሞዴል ሲሳሳት ችግሩ መሳሳቱ ብቻ አይደለም — <strong>ሲሳሳትም በሙሉ ልብ መናገሩ</strong> ነው። የእምነት መጠኑ ከእውነታው ጋር የሚመጣጠን ከሆነ ግን ሶፍትዌሩ ደንብ ማበጀት ይችላል፦</p>
<ul>
<li>እምነቱ 95% ከሆነ → በራሱ ይፈጽመው።</li>
<li>እምነቱ 55% ከሆነ → ለሰው ያስተላልፈው።</li>
</ul>
<p>TypeSafe ለዚህ የራሱን የሥልጠና ዘዴ ነድፏል — <strong>RLCD</strong> (Reinforcement Learning for Calibrated Decisions)። የተለመደው RLHF ሰው የሚወደውን ጽሑፍ ለማምረት ያሠለጥናል፤ RLCD ደግሞ <strong>የእምነት መጠኑ እውነተኛ እንዲሆን</strong> ያሠለጥናል ይላል።</p>

<h3>⚡ ቁጥሮቹ — ሁኔታቸው ሳይለይ</h3>
<p>የTypeSafe ገጽ <strong>"193.6x Faster, 444.6x Cheaper"</strong> ይላል። ከሥሩ ግን የራሱ ማስታወሻ አለ፦ <em>"based on workflows for System One tasks"</em> — ማለትም <strong>ለዚህ ዓይነት ሥራ ብቻ</strong>። ዋጋውን <strong>$42 በአንድ ቢሊዮን input token</strong> ብሎ ያስቀምጠዋል።</p>
<p>እነዚህ የኩባንያው የራሱ መለኪያዎች ናቸው። "200 እጥፍ ፈጣን" ተብሎ ብቻውን ሲጠቀስ ያሳስታል፦ ደብዳቤ በመጻፍ ሳይሆን <strong>በመመደብ ላይ</strong> ነው የሚለካው። Jev ደብዳቤ አይጽፍም።</p>

<h3>🔎 እኛ ስንሞክረው ያገኘነው</h3>
<p>ከማመን ይልቅ መሞከር ይሻላል። የBinaSmart <a href="https://bina.et/jobs">የሥራ ማስታወቂያ ሰሌዳ</a> ከሰባት ምንጭ የሚሰበሰብ ሲሆን፣ የማስታወቂያውን ርዕስ የሚያጸዳው እኔው የጻፍኩት የደንብ ዝርዝር ነበር።</p>
<p><strong>የመጀመሪያው ሙከራ (ሴፕቴምበር 22)፦</strong> 60 ርዕስ ለJev ተሰጠ። በ52ቱ ከደንቦቻችን ጋር ተስማማ፤ በ7ቱ አልተስማማም። <strong>በሰባቱም ትክክል የነበረው እሱ ነው።</strong> ዋጋው በአጠቃላይ <strong>$0.0011</strong> — አንድ መቶኛ ብር እንኳ አይሞላም።</p>
<p>ካገኛቸው አንዱ ይህ ነበር፦ "Vacancy announcement — 21 Sept 2026" የሚል ርዕስ <em>የሥራ መደብ ስም አይደለም</em> ብሎ በ100% እምነት ለየው። ትክክል ነበር — እና ከዚያ በኋላ ስንፈትሽ <strong>529 ማስታወቂያ</strong> በዚህ ሁኔታ ተቀምጦ ተገኘ። የእኔ ደንብ ሁሉንም በሰላም አሳልፎ ነበር።</p>
<p><strong>ሁለተኛው (ሴፕቴምበር 23)፦</strong> ክፍት የነበሩትን ሁሉንም 3,749 ርዕሶች አለፈ። ዋጋው <strong>$0.0411</strong>፤ <strong>266</strong> ላይ ጥያቄ አነሳ። ከእነዚያ ውስጥ 167ቱ <em>አንድ ማስታወቂያ ስምንት የሥራ መደብ የያዘ</em> ሆነው ተገኙ — እያንዳንዱን ስንለያይ <strong>974 ተጨማሪ ክፍት የሥራ ቦታ</strong> ወጣ፤ 265ቱ ደግሞ ደመወዝ ይዘው።</p>
<p>ትምህርቱ ስለ ዋጋ አይደለም። <strong>እኔ የጻፍኩት ደንብ ማየት ያልቻለውን አየ</strong> — ያውም እርግጠኛ ባልሆነበት ቦታ እርግጠኛ ሳይመስል። ለዚህ ነው በሰሌዳችን ላይ የምንጠቀምበት፤ የጽሑፍ ሥራ ግን አንሰጠውም።</p>

<h3>⚠️ ChatGPTን ይተካል?</h3>
<p>አይተካም። Jev ደብዳቤ አይጽፍም፣ ኮድ አይሠራም፣ አያወራም። የተሠራው ለአንድ ሥራ ነው — <strong>ውሳኔ</strong>። ረጅም መልስ ለሚፈልግ ሰው የተለመዱት ሞዴሎች ይሻላሉ።</p>
<p>ትክክለኛው አስተሳሰብ "የትኛው ይበልጣል?" ሳይሆን፣ <strong>ለእያንዳንዱ ሥራ ተገቢውን ሞዴል መምረጥ</strong> ነው። ይህ ደግሞ የAI ወኪል (agent) የሚሠራበት መንገድ ነው — <a href="https://bina.et/news/ai-agent-inside-amharic">በዚህ ጽሑፋችን</a> እንደተብራራው ወኪል ማለት አንድ ትልቅ ሞዴል ሳይሆን፣ ሞዴል ከመሣሪያዎችና ከፈቃድ ጋር ተጣምሮ ማለት ነው።</p>

<h3>🇪🇹 ለኢትዮጵያ ምን ማለት ነው?</h3>
<p>ወጪው። አንድ የAI ውሳኔ በመቶኛ ሳንቲም ሲሆን፣ ትልቅ በጀት የሌለው ድርጅትም በሺህ የሚቆጠሩ ውሳኔዎችን ማስኬድ ይችላል። ባንክ፣ ኢንሹራንስ፣ የመንግሥት መሥሪያ ቤት — ሁሉም በቀን ብዙ "ይህ የትኛው ምድብ ነው?" ዓይነት ውሳኔ ያስተናግዳሉ።</p>
<p>ጥንቃቄውም እዚያው ነው። ርካሽ ስለሆነ ብቻ ውሳኔውን ለማሽን መስጠት ማለት አይደለም። የእምነት መጠኑ የሚጠቅመው <strong>ዝቅተኛ ሲሆን ወደ ሰው የሚሄድበት መንገድ ሲኖር</strong> ብቻ ነው። በእኛም ሰሌዳ ላይ ማስታወቂያ የሚያትመው ሰው ነው — <a href="https://bina.et/jobs/post">የተላከ ማስታወቂያ</a> ሁሉ በሰው ይታያል። ለምን እንደሆነ ግልጽ ነው፦ የሥራ ማጭበርበር በኢትዮጵያውያን ላይ ከሚፈጸሙ ማታለያዎች ቀዳሚው ነው፣ ሞዴል ደግሞ "እውነተኛ" እና "በደንብ የተጻፈ" የሚለውን መለየት አይችልም።</p>
<p>የድርጅትዎን ሥራ በAI ማስኬድ ከፈለጉ <a href="https://bina.et/ai">bina.et/ai</a> ላይ ይመልከቱ። ስለ LLM፣ RAG እና Agentic AI ልዩነት ደግሞ <a href="https://bina.et/news/llm-rag-ai-agent-agentic-ai-amharic">በዚህ ጽሑፍ</a> ተብራርቷል።</p>

<h3>👤 ከኋላው ያሉት</h3>
<p>የኩባንያው ዋና ሥራ አስፈጻሚ <strong>Diogo Almeida</strong> ሲሆን፣ በGoogle Brain ሠርቷል፤ የኩባንያው ገጽ "co-invented RLHF and InstructGPT" — ማለትም ወደ ChatGPT ያደረሱትን ዘዴዎች በጋራ መፍጠሩን ይገልጻል። <strong>Sasha Sheng</strong> (COO) ከMeta/FAIR የመጣች ተመራማሪ ናት፤ <strong>Erik Gafni</strong> (CTO) ደግሞ ድርጅት መሥርቶ የሚያውቅ መሐንዲስ ነው።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>The idea.</strong> Most software does not need a paragraph from an AI; it needs one decision. TypeSafe AI, which came out of stealth on 15 September 2026 with $40m in seed funding, builds what it calls <em>System One Models</em> — fast, structured decisions for software rather than prose for people. Its first model is <strong>Jev</strong>: send it a structured question, get a typed answer and a confidence figure. "Billing, 98%", not three paragraphs about your card.</p>
<p><strong>Why confidence is the point.</strong> A model that is wrong is a problem; a model that is confidently wrong is a worse one. If the confidence is calibrated, software can act on 95% by itself and send 55% to a person. TypeSafe trains for this with a method it calls RLCD — Reinforcement Learning for Calibrated Decisions — as against RLHF, which optimises for text a human prefers.</p>
<p><strong>The numbers, with their condition.</strong> typesafe.ai states "193.6x Faster, 444.6x Cheaper", footnoted "based on workflows for System One tasks", and prices input at $42 per billion tokens. Those are the company's own measurements, on classification-shaped work. Jev does not write, so it is not 200x faster at writing.</p>
<p><strong>What we found running it.</strong> Our <a href="https://bina.et/jobs">job board</a> collects from seven sources, and the titles were cleaned by rules I wrote. On 22 September we gave Jev 60 of those titles: it agreed with our rules on 52 and disagreed on 7 — and it was right on all 7, for $0.0011 in total. One disagreement ("Vacancy announcement — 21 Sept 2026" is not a job title, 100% confident) led us to 529 rows stored that way. The next day it read all 3,749 open titles for $0.0411 and flagged 266; 167 of those turned out to be single pages advertising many posts, which split into <strong>974 more vacancies</strong>, 265 of them with a salary. The lesson is not the price. It saw what the rule I wrote could not — and it did not sound certain where it was not.</p>
<p><strong>What it is not.</strong> Jev does not replace ChatGPT or Claude. It does not write, code or converse. The useful question is not which model is better but which model fits the job. And cheap decisions are not a reason to hand judgement to a machine: on our own board, a person still approves every submitted vacancy, because job fraud is the commonest scam run on Ethiopian workers and no model can tell "real" from "well written".</p>
`.trim();

(async () => {
  const data = {
    title: 'TypeSafe AI and Jev — an AI that decides instead of writing, tested on our own job board',
    titleAm: 'TypeSafe AI እና Jev — የማይጽፍ፣ የሚወስን AI፤ በራሳችን ሰሌዳ ላይ የተፈተነ',
    category: 'ቴክኖሎጂ',
    excerpt: 'ሶፍትዌር ብዙ ጊዜ የሚፈልገው ረጅም መልስ ሳይሆን አንድ ውሳኔ ነው። TypeSafe AI ሴፕቴምበር 15 ቀን 2026 ከስውር ሥራ ወጥቶ "System One Models" የተባለ ዓይነት አስተዋውቋል፤ የመጀመሪያው ሞዴሉ Jev ጽሑፍ ሳይሆን የተወሰነ መልስና የእምነት መጠን ይመልሳል። የኩባንያው ቁጥሮች ከሁኔታቸው ጋር ተቀምጠዋል — እና የመጨረሻው ክፍል የእኛ የራሳችን ሙከራ ነው፦ በ$0.0411 ሁሉንም ርዕሶቻችንን አንብቦ የራሴ ደንብ ያላየውን አገኘ፤ 974 ተጨማሪ ክፍት የሥራ ቦታ ወጣ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '⚡',
    readMinutes: 7,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
