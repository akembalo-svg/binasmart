'use strict';
// News post: how an AI agent is built inside — our own Amharic explainer.
//
//   node ops/news/add-ai-agent-inside.js
//
// WHY THIS REPLACED THE EARLIER DRAFT (22 September 2026). The first version was written as "Chapter 1
// of Claude Code from Source, in Amharic, with the author's permission". The owner then told me plainly
// that he had taken the link from LinkedIn and does not know the person — so there is no permission.
// A translation of somebody's chapter, published on our domain under a permission line that is not
// true, is worse than no article: it is a false claim next to their name.
//
// So this is a different thing, and the difference is not cosmetic:
//   · the architecture ideas here (a loop around a model, tools, context, permission gates, provider
//     abstraction) are common knowledge in the field, explained in our own words and order;
//   · his section names and his framing are NOT reused;
//   · the worked example is BinaSmart's own assistant, which nobody else can write;
//   · his site is credited and linked as further reading, which is ordinary and fair — the thing you
//     may always do without asking is point at someone's work and say "read it".
//
// If we ever do want his chapter in Amharic, the route is a message to the author and a yes in writing.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'ai-agent-inside-amharic';

const body = `
<p><strong>አንድ ተራ ፕሮግራም አስቀድሞ የተጻፈ ቅደም ተከተል ይከተላል።</strong> ግቤት ይቀበላል፣ የተባለውን ይሠራል፣ ውጤት ያወጣል። ፕሮግራመሩ እያንዳንዱን እርምጃ አስቀድሞ ጽፎታል።</p>
<p>የAI ወኪል (agent) ግን እንዲህ አይደለም። <strong>ቅደም ተከተሉን ራሱ በሚሠራበት ጊዜ ይፈጥረዋል።</strong> ይህ ትንሽ ልዩነት አይደለም — የፕሮግራሙን አሠራር በሙሉ ይለውጠዋል። ታዲያ እንዲህ ያለ ነገር ውስጡ እንዴት ይገነባል?</p>

<h3>🔁 ልቡ፦ ዙሪያ</h3>
<p>የወኪል መሠረቱ <strong>ዙሪያ</strong> ነው፦</p>
<ol>
<li>ተጠቃሚው ይጠይቃል።</li>
<li>ጥያቄው፣ የውይይቱ ታሪክና ያሉት መሣሪያዎች ዝርዝር ለሞዴሉ ይላካሉ።</li>
<li>ሞዴሉ አንድ ነገር ይመልሳል — ወይ መልስ፣ ወይ "ይህን መሣሪያ ጥራልኝ" የሚል ጥያቄ።</li>
<li>መሣሪያ ከጠየቀ፦ ሥርዓቱ ያስፈጽማል፤ ውጤቱን መልሶ ወደ ውይይቱ ይጨምራል፤ እንደገና ወደ ሞዴሉ ይልካል።</li>
<li>ሞዴሉ ተጨማሪ እስካልጠየቀ ድረስ ይደጋገማል። ሲያቆም መልሱ ይወጣል።</li>
</ol>
<p>"ቀጥሎ ምን ይደረግ?" የሚለውን የወሰነ ፕሮግራመር የለም። በየዙሩ ሞዴሉ ይወስናል። ስለዚህ የተቀረው የሥርዓቱ ክፍል ሁሉ ያንን ዙሪያ <strong>ለማሽከርከርና ለመግራት</strong> የተሠራ ነው።</p>

<h3>🧩 አራቱ ክፍሎች</h3>

<h4>1. ዐውድ (context) — ሞዴሉ የሚያየው ሁሉ</h4>
<p>ሞዴሉ ትዝታ የለውም። በየጥሪው የሚያውቀው የተላከለትን ብቻ ነው። ስለዚህ "ምን ያስታውሳል?" የሚለው ጥያቄ በእውነቱ "ምን ልንልክለት መረጥን?" ማለት ነው። ውይይቱ፣ የተገኙ ሰነዶች፣ የመሣሪያ ውጤቶች — ሁሉም እዚህ ይገባሉ። ቦታው ውስን ስለሆነ ምርጫው ወሳኝ ነው።</p>

<h4>2. መሣሪያዎች (tools) — ወኪሉ ሊያደርግ የሚችለው</h4>
<p>እያንዳንዱ መሣሪያ ሦስት ነገር አለው፦ ስም፣ <strong>መግለጫ</strong>፣ እና የግቤት ቅርጽ። ሞዴሉ መቼ እንደሚጠቀምበት የሚማረው ከመግለጫው ነው — ስለዚህ መግለጫው በደንብ ካልተጻፈ መሣሪያው ጥሩ ቢሠራም አይጠራም። መሣሪያ መጻፍ ማለት ኮድ መጻፍ ብቻ ሳይሆን <em>መመሪያ መጻፍ</em> ጭምር ነው።</p>

<h4>3. ፈቃድ (permissions) — የት ላይ ሰው ግድ ይላል</h4>
<p>ማንበብ የሚችል ሞዴል ቢሳሳት ብዙ አያስከፍልም። መጻፍ፣ ማጥፋት ወይም ትእዛዝ ማሄድ የሚችል ሲሳሳት ግን ያስከፍላል። ስለዚህ ፈቃድ የተለየ ንብርብር ሆኖ ይሠራል፦ የትኛው ያለጥያቄ ይፈጸማል፣ የትኛው ማረጋገጫ ይጠይቃል፣ የትኛው ፈጽሞ አይፈቀድም።</p>
<p>ይህ የደኅንነት ጉዳይ ብቻ አይደለም። <strong>የእምነት ጉዳይ ነው።</strong> አንድ ወኪል ሊሠራልዎ የሚችለው እርስዎ እንዲሠራ የፈቀዱትን ያህል ነው — እና ጥሩ ንድፍ ማለት የት ላይ ማቆም እንዳለበት ማወቅ ነው።</p>

<h4>4. የአቅራቢ ንብርብር (provider layer)</h4>
<p>ሞዴሉ ከየት እንደሚመጣ ከቀሪው ሥርዓት ተለይቶ ይያዛል። አቅራቢ ሲቀየር — ዋጋ ሲጨምር፣ አዲስ ሞዴል ሲወጣ፣ አንዱ ሲቆም — የወኪሉ ሎጂክ መቀየር የለበትም። በተግባር ይህ ማለት ነገ የተሻለ ሞዴል ሲመጣ መቀየር የአንድ ፋይል ሥራ ነው እንጂ የሥርዓቱ ዳግም ግንባታ አይደለም።</p>

<h3>🇪🇹 በቢናስማርት ውስጥ ይህ እንዴት ይታያል</h3>
<p>ይህ ንድፍ በ<a href="https://bina.et/ai">ቢኒ</a> ውስጥ የሚሠራው እንዲህ ነው፦</p>
<ul>
<li><strong>ዐውድ፦</strong> ጥያቄው ከ27,825 ምንባቦች መካከል ተዛማጆቹን አምጥቶ ከሞዴሉ ጋር ይልካል — መልሱ ከሰነድ እንጂ ከግምት እንዳይሆን።</li>
<li><strong>መሣሪያዎች፦</strong> 13 አሉ — የታክሲ ዋጋ ማስላት፣ ከ3,782 ክፍት ሥራዎች መፈለግ፣ ጨረታ ማውጣት፣ ከቀጣሪ ማስታወቂያ መቀበል።</li>
<li><strong>ፈቃድ፦</strong> ቢኒ ክፍት የሥራ ማስታወቂያ <em>መቀበል</em> ይችላል፤ <em>ማተም</em> ግን አይችልም። ሰው እስኪያጸድቅ ድረስ ወረፋ ላይ ይቆያል። ምክንያቱ ቀላል ነው፦ የሐሰት የሥራ ማስታወቂያ በኢትዮጵያ ሠራተኞች ላይ የሚደርስ የተለመደ ማጭበርበር ነው፤ ሞዴል ደግሞ "እውነተኛ"ውንና "በደንብ የተጻፈ"ውን መለየት አይችልም።</li>
</ul>
<p>አራቱ ክፍሎች በአንድ ላይ ሲሠሩ ምን እንደሚፈጠር — እና ብዙ ወኪሎች ሲቀናጁ agentic ሲስተም ምን እንደሚሆን — <a href="https://bina.et/news/llm-rag-ai-agent-agentic-ai-amharic">በዚህ ጽሑፋችን</a> ተብራርቷል።</p>
<p>በዚህ ዘርፍ መሥራት የሚፈልጉ በbina.et ላይ ያሉትን <a href="https://bina.et/jobs/category/it">ክፍት የአይቲ ሥራዎች</a> ይመልከቱ።</p>

<h3>📚 ለበለጠ ንባብ</h3>
<p>የእውነተኛ ወኪል ውስጣዊ አሠራርን በዝርዝር — በኮድ ደረጃ — ማየት ለሚፈልግ፣ <em>Claude Code from Source</em> የሚባል ነጻ የመስመር ላይ መጽሐፍ አለ፤ የClaude Code ሥነ ሕንጻን ይመረምራል። በእንግሊዝኛ ነው፦ <a href="https://claude-code-from-source.com/ch01-architecture/" target="_blank" rel="noopener nofollow">claude-code-from-source.com</a>። (ከBinaSmart ጋር ግንኙነት የለውም፤ ይህ ጽሑፍም የእሱ ትርጉም አይደለም።)</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p>A conventional program follows a sequence its author wrote. An AI agent generates its own sequence while it runs, and that single difference reshapes everything around it.</p>
<p><strong>The loop.</strong> The question, the conversation so far and the list of available tools go to the model. The model replies with an answer or a tool call. If it is a tool call, the system runs it, appends the result to the conversation and sends it back. Repeat until the model stops asking. Nobody wrote "step 3, then step 4".</p>
<p><strong>Context.</strong> The model has no memory; it knows only what is sent on each call. "What does it remember?" really means "what did we choose to send?" — and the space is finite.</p>
<p><strong>Tools.</strong> Name, description, input shape. The description is what teaches the model when to reach for it, so writing a tool is as much writing instructions as writing code.</p>
<p><strong>Permissions.</strong> A model that can only read is cheap to get wrong. One that can write, delete or run commands is not. Which actions run silently, which need a human, which are never allowed — that layer is what makes an agent something you can trust, and good design is knowing where to stop.</p>
<p><strong>The provider layer.</strong> Where the model comes from is kept separate from what the agent does, so switching is one file, not a rebuild.</p>
<p><strong>In our own system:</strong> Bini retrieves from 27,825 passages before answering, has 13 tools, and may accept a job advert but may not publish one — a person approves first, because fake vacancies are the commonest fraud against Ethiopian workers and no model can tell "real" from "well-written".</p>
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:14px;color:#5c5548"><strong>Further reading:</strong> for a code-level study of a real agent, the free online book <em>Claude Code from Source</em> (<a href="https://claude-code-from-source.com/ch01-architecture/" target="_blank" rel="noopener nofollow">claude-code-from-source.com</a>) is worth your time. It is not affiliated with BinaSmart, and this article is our own explanation, not a translation of it.</p>
`.trim();

(async () => {
  const data = {
    title: 'How an AI agent is built inside — the loop, the tools, and the permission that makes it trustworthy',
    titleAm: 'የAI ወኪል ውስጡ እንዴት ይሠራል — ዙሪያው፣ መሣሪያዎቹና ፈቃዱ',
    category: 'ቴክኖሎጂ',
    excerpt: 'የAI ወኪል አስቀድሞ የተጻፈ ቅደም ተከተል አይከተልም — ቅደም ተከተሉን ራሱ በሩጫ ጊዜ ይፈጥራል። ዙሪያው፣ ዐውዱ፣ መሣሪያዎቹ፣ የፈቃድ ንብርብሩና የአቅራቢ ንብርብሩ በአማርኛ — በቢናስማርት ራሱ ምሳሌነት፦ ቢኒ ማስታወቂያ መቀበል ይችላል፣ ማተም ግን አይችልም።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🧠',
    readMinutes: 6,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
