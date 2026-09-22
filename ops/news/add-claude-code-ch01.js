'use strict';
// News post: Claude Code from Source, Chapter 1 — the architecture of an AI agent, in Amharic.
//
//   node ops/news/add-claude-code-ch01.js
//
// PERMISSION. The original is Chapter 1 of "Claude Code from Source" by alejandrobalderas
// (https://claude-code-from-source.com/ch01-architecture/, repo github.com/alejandrobalderas/
// claude-code-from-source). The site carries NO licence file, so the only thing that makes an Amharic
// edition ours to publish is the author's own permission — which the owner obtained and reported on
// 22 September 2026, adding that the author invited questions. The article says so in both languages,
// at the top and at the foot, and links the original in every place a reader might look for it.
//
// If that permission is ever disputed, this post comes down the same day. Written here so the next
// person knows the ground it stands on.
//
// What this is NOT: a copy. It follows the author's structure and teaches his six abstractions, in our
// own Amharic, with examples from a system Ethiopian readers can open. The original stays the place to
// read the code walk-throughs and the diagrams.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'claude-code-architecture-amharic-ch1';
const ORIGIN = 'https://claude-code-from-source.com/ch01-architecture/';

const body = `
<p style="background:#eef4ff;border-left:4px solid #2563eb;padding:14px 18px;border-radius:8px;font-size:15px;color:#25408f"><strong>ስለዚህ ጽሑፍ፦</strong> ይህ የ<em>Claude Code from Source</em> ምዕራፍ አንድ የአማርኛ እትም ነው። ዋናው ጽሑፍ የ<strong>alejandrobalderas</strong> ሥራ ሲሆን፣ በአማርኛ ለማቅረብ <strong>ከደራሲው ፈቃድ ተጠይቆ ተሰጥቷል</strong>። ዋናውን በ<a href="${ORIGIN}" target="_blank" rel="noopener">claude-code-from-source.com</a> ያገኙታል — የኮድ ማብራሪያዎቹና ሥዕላዊ መግለጫዎቹ እዚያ አሉ።</p>

<p>አንድ ተራ የትእዛዝ መስመር መሣሪያ (CLI) አስቀድሞ የተጻፈ ቅደም ተከተል ይከተላል፦ ግቤት ተቀበል፣ አሂድ፣ ውጤት አሳይ። የAI ወኪል ግን እንዲህ አይሠራም። <strong>ቅደም ተከተሉን ራሱ በሩጫ ጊዜ ይፈጥረዋል።</strong> ይህ ልዩነት ትንሽ አይደለም — መላውን የፕሮግራሙን አሠራር ይቀይረዋል።</p>

<p>ምዕራፍ አንድ የሚመልሰው ጥያቄ ይህ ነው፦ <em>እንዲህ ያለ ፕሮግራም ውስጡ እንዴት ተገንብቷል?</em></p>

<h3>🔁 ዋናው ሐሳብ፦ ዙሪያ (loop) እንጂ መስመር አይደለም</h3>
<p>Claude Code በመሠረቱ <strong>በቋንቋ ሞዴል ዙሪያ የተሠራ ዙሪያ</strong> ነው። ሞዴሉ ቀጥሎ ምን መደረግ እንዳለበት ይወስናል፤ ፕሮግራሙ ያንን ያስፈጽማል፤ ውጤቱን መልሶ ለሞዴሉ ያሳያል፤ ሞዴሉ እንደገና ይወስናል። ግቡ እስኪደርስ ድረስ ይቀጥላል።</p>
<p>ስለዚህ "ቀጥሎ ምን ይሆናል?" የሚለውን የሚወስነው ፕሮግራመሩ ሳይሆን፣ በዚያች ቅጽበት ሞዴሉ ነው። የተቀረው ሁሉ — ፈቃድ፣ መሣሪያዎች፣ ታሪክ — ያንን ዙሪያ ለማሽከርከርና <strong>ለመግራት</strong> የተሠራ ነው።</p>

<h3>🧩 ስድስቱ መሠረታዊ ክፍሎች</h3>
<p>ደራሲው መላውን ሥርዓት በስድስት ረቂቅ ክፍሎች ይከፍለዋል። እነዚህን መረዳት ማለት ፕሮግራሙን መረዳት ማለት ነው።</p>
<ol>
<li><strong>ውይይቱ (the conversation)</strong> — የተባለው ሁሉ በቅደም ተከተል የተቀመጠ ነው። ሞዴሉ "ትዝታ" የለውም፤ ያለው ይህ ዝርዝር ነው። ስለዚህ ምን እንደሚያስታውስ የሚወስነው ምን በዝርዝሩ ውስጥ እንደሚቀመጥ ነው።</li>
<li><strong>መሣሪያዎች (tools)</strong> — ሞዴሉ ሊጠራቸው የሚችሉ ተግባራት፦ ፋይል ማንበብ፣ መጻፍ፣ ትእዛዝ ማስኬድ፣ መፈለግ። እያንዳንዱ መሣሪያ ስም፣ መግለጫና የግቤት ቅርጽ አለው። <em>መግለጫው</em> ወሳኝ ነው — ሞዴሉ መቼ እንደሚጠቀምበት የሚያውቀው ከዚያ ነው።</li>
<li><strong>የመሣሪያ ጥሪ ዑደት (the tool loop)</strong> — ሞዴሉ መሣሪያ ይጠራል፤ ሥርዓቱ ያስፈጽማል፤ ውጤቱ ወደ ውይይቱ ይመለሳል፤ ሞዴሉ ይቀጥላል። ይህ የወኪል ልብ ነው።</li>
<li><strong>ፈቃድ (permissions)</strong> — የትኛው እርምጃ ያለጥያቄ ይሠራል፣ የትኛው ሰው መፍቀድ አለበት። ፋይል ማንበብና ፋይል ማጥፋት አንድ አይደሉም።</li>
<li><strong>ብዙ አቅራቢዎች (multi-provider)</strong> — ሞዴሉ ከየት እንደሚመጣ (Anthropic፣ Bedrock፣ Vertex) ከቀሪው ሥርዓት ተለይቶ ይያዛል፤ አቅራቢ መቀየር ፕሮግራሙን አይነካም።</li>
<li><strong>የግንባታ ሥርዓት (the build system)</strong> — ይህ ሁሉ ተጠቃልሎ አንድ የሚሠራ ትእዛዝ የሚሆንበት መንገድ።</li>
</ol>

<h3>⌨️ ከአንዲት ቁልፍ እስከ ውጤት</h3>
<p>ደራሲው "the golden path" ይለዋል — አንድ ጥያቄ ከተተየበበት ቅጽበት እስከ መልሱ ያለው መንገድ፦</p>
<ol>
<li>የተጻፈው ጽሑፍ ይነበባል፤</li>
<li>ከውይይቱ ታሪክና ካሉት መሣሪያዎች ጋር ተጣምሮ ወደ ሞዴሉ ይላካል፤</li>
<li>ሞዴሉ ይመልሳል — ወይ ጽሑፍ፣ ወይ <em>የመሣሪያ ጥሪ</em>፤</li>
<li>የመሣሪያ ጥሪ ከሆነ፦ ፈቃድ ይጣራል፣ መሣሪያው ይሠራል፣ ውጤቱ ወደ ውይይቱ ይታከላል፣ እንደገና ወደ ሞዴሉ ይላካል፤</li>
<li>ሞዴሉ ተጨማሪ መሣሪያ እስካልጠየቀ ድረስ ይህ ይደጋገማል። ሲያቆም፣ መልሱ ለተጠቃሚው ይታያል።</li>
</ol>
<p>ልብ ይበሉ፦ በዚህ መንገድ ውስጥ "ደረጃ 3 ቀጥሎ ደረጃ 4 ይሁን" ብሎ የጻፈ ፕሮግራመር የለም። <strong>ቅደም ተከተሉ በየጊዜው ይወለዳል።</strong></p>

<h3>🔐 የፈቃድ ሥርዓት — ለምን ዋናው ነገር ነው</h3>
<p>ሞዴል ማንበብ ብቻ ሲችል ስህተቱ ዋጋ የለውም። ሲጽፍ፣ ሲያጠፋ፣ ትእዛዝ ሲያስኬድ ግን ስህተት ዋጋ ያስከፍላል። ስለዚህ ፈቃድ የተለየ ንብርብር ሆኖ ተሠርቷል፦ የትኛው መሣሪያ ያለጥያቄ ይሠራል፣ የትኛው ማረጋገጫ ይጠይቃል፣ የትኛው ፈጽሞ አይፈቀድም።</p>
<p>ይህ የደኅንነት ጉዳይ ብቻ አይደለም — የ<strong>እምነት</strong> ጉዳይ ነው። አንድ ወኪል ሊሠራልዎ የሚችለው እርስዎ እንዲሠራ የፈቀዱትን ያህል ብቻ ነው።</p>

<h3>🌍 ይህ ለእኛ ምን ይሠራል?</h3>
<p>ይህ ንድፍ በቢናስማርት ውስጥም የምናየው ነው። <a href="https://bina.et/ai">ቢኒ</a> የሚሠራው በዚሁ ዙሪያ ነው፦ ጥያቄ ይመጣል፣ ከ27,825 ምንባቦች ተዛማጁ ይመጣል፣ ሞዴሉ ይወስናል፣ መሣሪያ ከፈለገ ይጠራል — የታክሲ ዋጋ ማስላት፣ ክፍት ሥራ መፈለግ፣ ጨረታ ማውጣት — ውጤቱ ተመልሶ ይገባል፣ መልሱ ይወጣል።</p>
<p>የፈቃድ ነጥቡም እንዲሁ በተግባር ይታያል፦ ቢኒ ክፍት የሥራ ማስታወቂያ <em>መቀበል</em> ይችላል፤ <em>ማተም</em> ግን አይችልም። ሰው እስኪፈቅድ ድረስ ማስታወቂያው ወረፋ ላይ ይቆያል። ለምን እንደሆነ <a href="https://bina.et/news/llm-rag-ai-agent-agentic-ai-amharic">በዛሬው ሌላኛው ጽሑፋችን</a> ተብራርቷል።</p>
<p>የAndroid ወይም የባክኤንድ ችሎታ ካለዎትና በዚህ ዘርፍ መሥራት ከፈለጉ፣ በbina.et ላይ ያሉትን <a href="https://bina.et/jobs/category/it">ክፍት የአይቲ ሥራዎች</a> ይመልከቱ።</p>

<h3>📚 ቀጣዩ</h3>
<p>ይህ ምዕራፍ አንድ ነው። ተከታዮቹ ምዕራፎች በዚሁ ገጽ በአማርኛ ይቀርባሉ። የኮድ ዝርዝሮቹንና ሥዕላዊ መግለጫዎቹን ለማየት ግን ዋናውን ጽሑፍ ይክፈቱ፦ <a href="${ORIGIN}" target="_blank" rel="noopener">claude-code-from-source.com/ch01-architecture</a>።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — what this is</h3>
<p>This is an Amharic edition of Chapter 1 of <em>Claude Code from Source</em> by alejandrobalderas, published <strong>with the author's permission</strong>. The original — with its code walk-throughs and diagrams — is at <a href="${ORIGIN}" target="_blank" rel="noopener">claude-code-from-source.com/ch01-architecture</a>, and it remains the place to read the detail.</p>
<p>The chapter's argument: an AI agent is not a program that follows a fixed sequence. It is a loop around a language model that generates its own instruction sequence at runtime. Six abstractions carry that idea — the conversation, the tools, the tool loop, permissions, the multi-provider layer and the build system — and the "golden path" from a keystroke to an answer runs through all of them. The permission system is the part that turns a clever loop into something you can trust with your files.</p>
<p>We added one thing the original cannot: a local example. BinaSmart's own assistant runs the same shape, and the permission argument is not theoretical for us — Bini may accept a job advert but may not publish one.</p>
<p style="background:#eef4ff;border-left:4px solid #2563eb;padding:14px 18px;border-radius:8px;font-size:14px;color:#25408f"><strong>Credit:</strong> Original work and structure © alejandrobalderas, <a href="${ORIGIN}" target="_blank" rel="noopener">claude-code-from-source.com</a> and <a href="https://github.com/alejandrobalderas/claude-code-from-source" target="_blank" rel="noopener">GitHub</a>. Translated and adapted into Amharic by the BinaSmart desk with his permission, 22 September 2026. If the author asks us to change or remove anything, we will do it the same day.</p>
`.trim();

(async () => {
  const data = {
    title: 'The Architecture of an AI Agent — Claude Code from Source, Chapter 1, in Amharic',
    titleAm: 'የAI ወኪል ውስጣዊ አሠራር — Claude Code from Source፣ ምዕራፍ አንድ በአማርኛ',
    category: 'ቴክኖሎጂ',
    excerpt: 'የAI ወኪል አስቀድሞ የተጻፈ ቅደም ተከተል አይከተልም — ቅደም ተከተሉን ራሱ በሩጫ ጊዜ ይፈጥራል። ስድስቱ መሠረታዊ ክፍሎች፣ ከአንዲት ቁልፍ እስከ ውጤት ያለው መንገድ፣ እና የፈቃድ ሥርዓቱ ለምን ዋናው እንደሆነ። የalejandrobalderas ሥራ፣ በፈቃዱ በአማርኛ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🧠',
    readMinutes: 7,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
