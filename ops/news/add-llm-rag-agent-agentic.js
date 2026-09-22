'use strict';
// News post: LLM → RAG → AI agent → Agentic AI, explained from a system that is actually running.
//
//   node ops/news/add-llm-rag-agent-agentic.js
//
// Why this article and not another explainer: the four words are everywhere and almost every Amharic
// explanation of them is translated from an English blog, with no example a reader can check. This one
// describes bina.et itself — the same four layers, with the numbers as they stood when it was written
// (22 Sep 2026): 27,825 knowledge passages, 13 tools, 7,081 vacancies from seven sources, 1,696
// companies, 353 tenders. Every claim here is about software the reader can open and test.
//
// Numbers in the text are stated as "as of 22 September 2026" on purpose. They will drift; a dated
// number that drifts is honest, an undated one that drifts is wrong.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'llm-rag-ai-agent-agentic-ai-amharic';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548">አራቱ ቃላት — <strong>LLM</strong>፣ <strong>RAG</strong>፣ <strong>AI agent</strong> እና <strong>Agentic AI</strong> — በየቦታው ይነገራሉ፤ ግን ልዩነታቸው ብዙ ጊዜ አይብራራም። ይህ ጽሑፍ በምሳሌ ያብራራቸዋል፤ ምሳሌውም ራሱ bina.et ነው። የተጠቀሱት ቁጥሮች የመስከረም 12 ቀን 2019 ዓ.ም (22 September 2026) ሁኔታ ናቸው።</p>

<p>እነዚህ አራቱ <strong>ተለዋጭ አይደሉም</strong>። አንዱ በሌላው ላይ የሚቆም መሰላል ናቸው። እያንዳንዱ እርከን የቀደመውን አንድ ችግር ይፈታል።</p>

<h3>1️⃣ LLM — መልስ የሚጽፍ ሞዴል</h3>
<p><strong>LLM</strong> (Large Language Model) ጥያቄ ተቀብሎ መልስ ይጽፋል። መልሱን የሚያመነጨው ከሠለጠነበት ዕውቀት ብቻ ነው — ቃል በቃል፣ የሚቀጥለውን ቃል እየገመተ።</p>
<p><strong>ጥንካሬው፦</strong> ቋንቋ ይረዳል፤ ያጠቃልላል፤ ይተረጉማል።<br>
<strong>ገደቡ፦</strong> ያለውን ብቻ ነው የሚያውቀው። ስለ ዛሬው የቤት ኪራይ አዋጅ፣ ስለ ትናንት የወጣ ክፍት የሥራ ቦታ፣ ወይም ስለ እርስዎ ድርጅት ምንም አያውቅም። ሲጠየቅም "አላውቅም" ከማለት ይልቅ አሳማኝ የሆነ የተሳሳተ መልስ ሊሰጥ ይችላል።</p>
<p>ይህ ብቻውን ለአንድ መድረክ አይበቃም። የተሳሳተ የመንግሥት ሂደት ለአንድ ሰው መንገር ቀኑን ሙሉ ያስቀረዋል።</p>

<h3>2️⃣ RAG — ከመመለሱ በፊት የሚያነብ</h3>
<p><strong>RAG</strong> (Retrieval-Augmented Generation) ማለት፦ ጥያቄው ወደ ሞዴሉ ከመድረሱ በፊት ወደ <em>ፈላጊ</em> (retriever) ይሄዳል። ፈላጊው ከተደራጀ የዕውቀት ክምችት ተዛማጅ ምንባቦችን አውጥቶ ከጥያቄው ጋር ለሞዴሉ ይሰጣል። ሞዴሉ የሚመልሰው ካነበበው ላይ ተመሥርቶ ነው።</p>
<p>በbina.et ላይ ቢኒ (Bini) የሚሠራው እንዲሁ ነው። <strong>27,825 ምንባቦች</strong> — የመንግሥት ሂደቶች፣ የአዲስ አበባ ተግባራዊ መረጃ፣ የBinaSmart አገልግሎቶች — በቬክተር ተጠቁመዋል። አንድ ሰው "ፋይዳ እንዴት ነው የሚመዘገበው?" ሲል፣ ቢኒ መጀመሪያ ያንን ምንባብ ያመጣል፤ ከዚያ ይመልሳል፤ ምንጩንም ያሳያል።</p>
<p><strong>ትልቁ ልዩነት፦</strong> መልሱ ከትዝታ ሳይሆን ከሰነድ ይመጣል። ሰነዱ ሲቀየር መልሱም ይቀየራል።</p>
<p><strong>ግን፦</strong> RAG ትክክለኛነትን አያረጋግጥም። መልሱን ይመሠርታል እንጂ አያረጋግጥም — እና ማንበብ ብቻ ነው የሚችለው። <em>ማድረግ</em> አይችልም።</p>

<h3>3️⃣ AI agent — መሣሪያ የሚጠቀም</h3>
<p><strong>AI agent</strong> ግብ አለው፤ የሥራውን ሁኔታ ይከታተላል፤ ቀጥሎ ምን ማድረግ እንዳለበት ያቅዳል፤ <strong>መሣሪያ ይጠራል</strong>፤ ውጤቱን አይቶ ቀጣዩን እርምጃ ያስተካክላል። ይህ ዑደት — ዕቅድ → መሣሪያ → ውጤት → ማስተካከል — ነው agent የሚያደርገው።</p>
<p>ቢኒ ዛሬ <strong>13 መሣሪያዎች</strong> አሉት። ለምሳሌ፦</p>
<ul>
<li>🚕 <strong>quote_ride</strong> — በአዲስ አበባ ውስጥ ቋሚ የታክሲ ዋጋ ያሰላል። ዋጋውን አይገምትም፤ ከሥርዓቱ ያመጣል።</li>
<li>💼 <strong>search_jobs</strong> — ከ<strong>3,782 ክፍት የሥራ ቦታዎች</strong> መካከል በሙያ፣ በከተማና በቃል ይፈልጋል።</li>
<li>📋 <strong>search_tenders</strong> — ከ353 ጨረታዎች ገና ያልተዘጉትን ያወጣል።</li>
<li>📨 <strong>post_job</strong> — ቀጣሪ ክፍት ቦታ ሲሰጠው ተቀብሎ ለግምገማ ያስተላልፋል።</li>
</ul>
<p>ልዩነቱ ትልቅ ነው፦ LLM ስለ ታክሲ ዋጋ <em>ያወራል</em>፤ agent <em>ዋጋውን ያመጣል</em>። RAG ስለ ክፍት ሥራ የተጻፈ ሰነድ ያነባል፤ agent ዛሬ ክፍት የሆነውን ሥራ ከመረጃ ቋቱ ያወጣል።</p>

<h3>4️⃣ Agentic AI — አብረው የሚሠሩ ብዙ ወኪሎች</h3>
<p>አንድ ወኪል በአንድ ውይይት ውስጥ ይሠራል። <strong>Agentic AI</strong> ማለት ብዙ ወኪሎችና ሂደቶች አንድ ግብ ላይ ተቀናጅተው ሲሠሩ ነው — በዕቅድ፣ በመሣሪያ አጠቃቀምና በግብረ መልስ፤ ሰው ሳይነካቸው።</p>
<p>በbina.et ላይ በየጠዋቱ 1፡40 (የአዲስ አበባ ሰዓት 7፡40) የሚከተለው ይሆናል፦</p>
<ol>
<li><strong>ሰብሳቢዎቹ</strong> ሰባት የሥራ ማስታወቂያ ጣቢያዎችን ያነባሉ — የእያንዳንዱን robots.txt አክብረው፣ በሰከንድ አንድ ገጽ ብቻ።</li>
<li><strong>አጣሪው</strong> ተደጋጋሚ ማስታወቂያዎችን ያስወግዳል — አንድ ሥራ በሦስት ጣቢያ ቢወጣም አንድ ጊዜ ብቻ ይመዘገባል።</li>
<li><strong>ከፋፋዩ</strong> እያንዳንዱን ሥራ በ16 የሙያ ዘርፎች ይመድባል።</li>
<li><strong>የአርማ አምጪው</strong> አዲስ ለተመዘገበ ድርጅት ከራሱ ድረ-ገጽ ወይም ከማስታወቂያው አርማውን ያመጣል።</li>
<li><strong>አስታዋቂው</strong> አዲሶቹን ሥራዎች በቴሌግራም ቻናል ያሰራጫል።</li>
<li><strong>ተቆጣጣሪው</strong> መረጃው ከቆየ ያስጠነቅቃል።</li>
</ol>
<p>ማንም ቁልፍ አልተጫነም። ይህ ነው agentic ማለት።</p>

<h3>⚖️ የት ላይ ሰው ግድ ይላል</h3>
<p>አንድ ነገር ግን ሆን ብለን ለወኪል አልሰጠንም፦ <strong>ማስታወቂያ ማተም</strong>።</p>
<p>ቀጣሪ ወይም ቢኒ አዲስ ክፍት ቦታ ሲቀበል፣ ወደ ጣቢያው <em>አይወጣም</em>። ወደ ማጽደቂያ ወረፋ ይገባል፤ ሰው አይቶ ሲፈቅድ ብቻ ይወጣል። ምክንያቱ ቀላል ነው፦ በኢትዮጵያ ሠራተኞች ላይ የሚደርሰው በጣም የተለመደ ማጭበርበር የሐሰት የሥራ ማስታወቂያ ነው — "የምዝገባ ክፍያ ይክፈሉ" ተብሎ ገንዘብ ተወስዶ መጥፋት። ሞዴል <em>እውነተኛ</em>ውንና <em>በደንብ የተጻፈ</em>ውን መለየት አይችልም። ስለዚህ ሥርዓቱ ምልክቶቹን ለሰው ያሳያል — ክፍያ መጠየቅ፣ የግል ስልክ ቁጥር፣ ከዚህ በፊት ያልታየ ድርጅት — ውሳኔውን ግን ሰው ይወስናል።</p>
<p>መሰላሉን መውጣት ማለት ሁሉንም ነገር ለወኪል መስጠት ማለት አይደለም። የት ላይ ማቆም እንዳለብህ ማወቅ ጭምር ነው።</p>

<h3>📌 በአጭሩ</h3>
<ul>
<li><strong>LLM</strong> — ከትዝታው ይመልሳል።</li>
<li><strong>RAG</strong> — ከመመለሱ በፊት ያነባል፤ መልሱ ምንጭ አለው።</li>
<li><strong>AI agent</strong> — መሣሪያ ይጠቀማል፤ ያደርጋል እንጂ አይተርክም።</li>
<li><strong>Agentic AI</strong> — ብዙ ወኪሎች በራሳቸው ተቀናጅተው ይሠራሉ።</li>
</ul>
<p>ቢኒን በ<a href="https://bina.et/ai">bina.et/ai</a> ወይም በቴሌግራም <a href="https://t.me/bina_smart_bot">@bina_smart_bot</a> ይሞክሩት። ክፍት የሥራ ቦታዎቹን በ<a href="https://bina.et/jobs">bina.et/jobs</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the same ladder, in one paragraph each</h3>
<p><strong>LLM.</strong> A model that answers from what it learned, predicting one token at a time. It understands language; it does not know today's vacancy, this month's proclamation, or your company. Asked anyway, it can produce a confident wrong answer.</p>
<p><strong>RAG.</strong> The question goes to a retriever first. It pulls the relevant passages out of an indexed knowledge base and hands them to the model with the question, so the answer is grounded in a document instead of a memory. On bina.et that index holds 27,825 passages — government procedures, practical Addis Ababa information, every BinaSmart service — and Bini cites the source. RAG grounds an answer; it does not guarantee it is right, and it can only read.</p>
<p><strong>AI agent.</strong> It has a goal, tracks the state of the task, plans the next step, calls tools, reads the result and adjusts. Bini has 13 tools: it quotes a real ride fare, searches 3,782 open vacancies, pulls tenders that have not closed, takes a vacancy from an employer. An LLM talks about a fare; an agent fetches it.</p>
<p><strong>Agentic AI.</strong> Several agents and processes working to one objective, with planning, tool use and feedback, coordinated without a person. Every morning at 07:40 Addis time, bina.et reads seven job boards (each one's robots.txt obeyed, one page every 2.5 seconds), removes duplicates across all of them, sorts each vacancy into one of sixteen fields, fetches the logo of every new company, posts the new jobs to Telegram and warns if anything has gone stale. Nobody presses a button.</p>
<p><strong>And where we stopped.</strong> Publishing an advert is deliberately not given to an agent. Job scams are the commonest fraud against Ethiopian workers, and no model can tell a real employer from a well-written one. Every submitted vacancy waits in a queue with the warning signs listed — a fee demanded, a personal mobile as the application route, a company never seen before — and a person decides. Climbing the ladder is not the same as handing everything over.</p>
`.trim();

(async () => {
  const data = {
    title: 'LLM, RAG, AI Agent & Agentic AI — the four layers, explained from a system that is actually running',
    titleAm: 'LLM፣ RAG፣ AI Agent እና Agentic AI — አራቱ እርከኖች በአማርኛ',
    category: 'ቴክኖሎጂ',
    excerpt: 'LLM ከትዝታ ይመልሳል፤ RAG ከመመለሱ በፊት ያነባል፤ AI agent መሣሪያ ይጠቀማል፤ Agentic AI ብዙ ወኪሎችን ያቀናጃል። አራቱ እርከኖች በbina.et ራሱ ምሳሌነት ተብራርተዋል — 27,825 ምንባቦች፣ 13 መሣሪያዎች፣ 3,782 ክፍት የሥራ ቦታዎች፣ እና ሆን ተብሎ ለወኪል ያልተሰጠው አንድ ሥራ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🪜',
    readMinutes: 6,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
