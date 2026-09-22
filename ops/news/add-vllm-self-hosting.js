'use strict';
// News post: running an LLM on your own server — vLLM, and when it is the right answer in Ethiopia.
//
//   node ops/news/add-vllm-self-hosting.js
//
// Sources, read 22 September 2026:
//   · vLLM documentation, docs.vllm.ai — the feature list quoted here (OpenAI-compatible server,
//     hardware support, quantization formats, prefix caching, multi-LoRA, speculative decoding)
//   · vLLM's own announcement, 20 June 2023, vllm.ai/blog/2023-06-20-vllm — the memory and throughput
//     numbers: "existing systems waste 60% - 80% of memory", "a mere waste of under 4%",
//     "14x - 24x higher throughput than HF" for one completion per request, "8.5x - 15x" for three.
//
// The owner sent a viral list about vLLM and asked whether we had covered it. We had not — and copying
// the list would have meant publishing a project's own marketing as our reporting. This article uses the
// documented numbers WITH their date and their condition (the 24x is one completion per request, from a
// 2023 benchmark), and spends most of its length on the question an Ethiopian reader actually has:
// what would this cost me, and is it the right choice? The honest answer for most is no, and the
// article says so — including what BinaSmart itself decided, which is the part no competitor can copy.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'vllm-self-hosting-ai-ethiopia-amharic';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የvLLM ሰነድ (docs.vllm.ai) እና የvLLM ራሱ ማስታወቂያ (እ.ኤ.አ. ጁን 20 ቀን 2023)። የተጠቀሱት የፍጥነትና የማህደረ ትውስታ ቁጥሮች የእነሱ የራሳቸው መለኪያዎች ናቸው፤ ቀኑና ሁኔታው ተጠቅሷል።</p>

<p>አንድ ድርጅት "የራሳችን AI እንፈልጋለን" ሲል፣ ሁለት የተለያዩ ነገሮችን ሊያመለክት ይችላል፦ (1) የራሱን ሰነዶች የሚያውቅ ረዳት፣ ወይም (2) <strong>ሞዴሉ ራሱ በድርጅቱ ሰርቨር ላይ እንዲሮጥ</strong>። ሁለተኛው በጣም የተለየ ውሳኔ ነው — እና የሚያስወጣውም የተለየ ነው።</p>
<p>ይህ ጽሑፍ ስለ ሁለተኛው ነው የሚያብራራው፦ በራስ ሰርቨር ላይ ማስኬድ፣ የሚያስፈልገው ነገር፣ እና <em>መቼ ትክክል እንደሆነ</em>።</p>

<h3>🔧 vLLM ምንድን ነው?</h3>
<p><strong>vLLM</strong> ክፍት ምንጭ የ<em>inference engine</em> ነው — ማለትም ሞዴሉን አሠልጥኖ የሚሰጥ ሳይሆን፣ የተሠራን ሞዴል ወስዶ <strong>በፍጥነትና በርካሽ የሚያገለግል</strong> ንብርብር ማለት ነው። ሞዴል መያዝ ብቻ በቂ አይደለም፤ ብዙ ሰው በአንድ ጊዜ ሲጠቀምበት ጂፒዩን በአግባቡ ማስተዳደር ያስፈልጋል። ያ የvLLM ሥራ ነው።</p>

<h4>ዋናው ብልሃት፦ PagedAttention</h4>
<p>ሞዴል ሲመልስ ለእያንዳንዱ ውይይት በጂፒዩ ማህደረ ትውስታ ውስጥ ቦታ ይይዛል (KV cache)። የቀድሞ ሥርዓቶች ይህን ቦታ አስቀድመው በጅምላ ይይዙ ነበር — ስለዚህ ብዙው ቦታ ባዶ ሆኖ ይባክን ነበር። vLLM ይህን እንደ ኮምፒውተር ኦፐሬቲንግ ሲስተም የRAM አያያዝ በ"ገጾች" (pages) ይከፋፍለዋል።</p>
<p>በራሳቸው መለኪያ፦ የቀድሞ ሥርዓቶች <strong>ከ60–80% የሚሆነውን ማህደረ ትውስታ ያባክኑ ነበር</strong>፤ በPagedAttention ብክነቱ <strong>ከ4% በታች</strong> ወርዷል። ብክነቱ ሲቀንስ በአንድ ጂፒዩ ላይ የሚስተናገደው ተጠቃሚ ቁጥር ይጨምራል።</p>

<h4>ፍጥነት — ቁጥሩን በትክክል እንመልከተው</h4>
<p>የvLLM ማስታወቂያ (እ.ኤ.አ. ጁን 2023) ይላል፦ ከHuggingFace Transformers ጋር ሲነጻጸር <strong>14–24 እጥፍ</strong> የበለጠ አገልግሎት — ይህ <em>እያንዳንዱ ጥያቄ አንድ መልስ ሲጠይቅ</em> ነው። እያንዳንዱ ጥያቄ ሦስት መልስ ሲጠይቅ ደግሞ <strong>8.5–15 እጥፍ</strong>። ከTGI ጋር ሲነጻጸር እስከ 3.5 እጥፍ።</p>
<p>ልብ ይበሉ፦ "24 እጥፍ" የሚለው ቁጥር ብቻውን ሲጠቀስ ያሳስታል። ሁኔታው አለው፣ ቀኑም 2023 ነው። ትክክለኛው መልእክት "ተመሳሳይ ጂፒዩ፣ ተመሳሳይ ሞዴል፣ የተሻለ የአገልግሎት ንብርብር ⇒ በእጅጉ የበለጠ ተጠቃሚ" የሚል ነው።</p>

<h4>ሌሎቹ ጠቃሚ ነገሮች</h4>
<ul>
<li><strong>ከOpenAI ጋር ተስማሚ API</strong> — ኮድዎን ሳይቀይሩ ከውጭ አገልግሎት ወደ የራስዎ ሞዴል መቀየር ይችላሉ።</li>
<li><strong>ሰፊ ሃርድዌር</strong> — NVIDIA፣ AMD፣ x86/ARM ሲፒዩዎች፣ እንዲሁም TPU፣ Intel Gaudi፣ Apple Silicon እና ሌሎችም።</li>
<li><strong>Quantization</strong> (FP8፣ INT8፣ INT4፣ GPTQ/AWQ፣ GGUF…) — ትልቅ ሞዴልን በትንሽ ጂፒዩ ላይ ለማስኬድ።</li>
<li><strong>Prefix caching</strong> — ሺህ ተጠቃሚዎች አንድ ዓይነት የሥርዓት መመሪያ ሲልኩ አንድ ጊዜ ብቻ ይሰላል።</li>
<li><strong>Multi-LoRA</strong> — አንድ ጂፒዩ ለብዙ የተስተካከሉ ሞዴሎች በአንድ ጊዜ ያገለግላል።</li>
<li><strong>Speculative decoding</strong> — ቃላትን አስቀድሞ ገምቶ በአንድ ዙር በማረጋገጥ ፍጥነት መጨመር።</li>
</ul>

<h3>🇪🇹 ዋናው ጥያቄ፦ በኢትዮጵያ ይሠራል?</h3>
<p>ሶፍትዌሩ ነጻ ነው። ውድ የሆነው ሌላው ነገር ነው፦</p>
<ol>
<li><strong>ጂፒዩ።</strong> ከባድ ሞዴል ለማስኬድ የሚያስፈልገው ካርድ በአገር ውስጥ በቀላሉ አይገኝም፤ ማስመጣት ደግሞ ከዋጋው በተጨማሪ ቀረጥና ታክስ ያስከትላል (<a href="https://bina.et/customs-import-duty-ethiopia">የጉምሩክ ቀረጥ መመሪያችን</a>)።</li>
<li><strong>ኤሌክትሪክ።</strong> አንድ የአገልግሎት ጂፒዩ ከ300–700 ዋት አካባቢ ይስባል፤ ቀንና ሌሊት ሲሠራ ደግሞ ይህ ተደምሮ ይመጣል። የኃይል መቋረጥ ካለ ደግሞ UPS ወይም ጀነሬተር ማለት ነው።</li>
<li><strong>ሰው።</strong> ሞዴል ማዘመን፣ ችግር መፍታት፣ ደኅንነት መጠበቅ — ይህን የሚሠራ ሰው ያስፈልጋል። ይህ ወጪ ብዙ ጊዜ ይረሳል።</li>
</ol>
<p>ከዚህ ጎን ለጎን፦ API መጠቀም ማለት ካርድ አይገዙም፣ ኤሌክትሪክ አይከፍሉም፣ ሰው አይቀጥሩም። ለአብዛኛው የኢትዮጵያ ድርጅት ዛሬ <strong>API ርካሽና የተሻለ ነው</strong>።</p>

<h3>✅ ታዲያ መቼ በራስ ሰርቨር ማስኬድ ትክክል ነው?</h3>
<p>አንድ ምክንያት ብቻ፣ ግን ከባድ ምክንያት፦ <strong>መረጃው መውጣት ሲከለከል።</strong></p>
<ul>
<li>ባንክ — የደንበኛ የሂሳብ እንቅስቃሴ።</li>
<li>ሆስፒታል — የታካሚ መዝገብ።</li>
<li>የመንግሥት መሥሪያ ቤት — የዜጎች መረጃ።</li>
<li>ማንኛውም ድርጅት በሕግ ወይም በውል መረጃው ከአገር (ወይም ከሕንፃው) እንዳይወጣ የተገደበ።</li>
</ul>
<p>በዚህ ሁኔታ ጥያቄው "የትኛው ርካሽ ነው?" አይደለም። "መረጃው የት ይቀመጣል?" ነው — እና መልሱ አንድ ብቻ ነው።</p>

<h3>🔎 እኛ ራሳችን ምን መረጥን?</h3>
<p>ግልጽ እንሁን፦ <strong>ቢናስማርት ሞዴል በራሱ ሰርቨር ላይ አያስኬድም።</strong> ቢኒ የሚሠራው 4 ኮር ሲፒዩና 16 ጊባ ማህደረ ትውስታ ባለው ተራ ሰርቨር ላይ ነው — ጂፒዩ የለም።</p>
<ul>
<li>የ27,825 ምንባቦች ፍለጋ (embeddings) — በከፊል በአገልግሎት፣ በከፊል በዚሁ ሰርቨር ላይ በሲፒዩ (BGE-M3)።</li>
<li>መልስ ማመንጨት — በውጭ ሞዴል በAPI።</li>
</ul>
<p>ለምን? ምክንያቱም መረጃችን ሕዝባዊ ነው — የሥራ ማስታወቂያ፣ ጨረታ፣ የመንግሥት መመሪያ። መውጣት የማይገባው ነገር የለም። ስለዚህ ጂፒዩ መግዛት ብልህነት አይሆንም።</p>
<p>የBinaSmart ተጠቃሚዎች ሲቪ ግን የተለየ ነው — እሱ ከዚህ ሰርቨር አይወጣም። ደንቡ "ሁሉም በራስ ሰርቨር" ወይም "ሁሉም በAPI" ሳይሆን፣ <strong>ለእያንዳንዱ መረጃ ተገቢውን ቦታ መምረጥ</strong> ነው።</p>

<h3>💬 ለድርጅትዎ</h3>
<p>የራስዎ ሰርቨር ላይ የሚሠራ ረዳት የሚያስፈልግዎ ከሆነ — ወይም መጀመሪያ የትኛው አማራጭ እንደሚስማማዎ ማወቅ ከፈለጉ — <a href="https://bina.et/ai">bina.et/ai</a> ላይ ይመልከቱ። የግል ዝርጋታ (private deployment) በደንበኛው ሰርቨር ላይ ይቻላል።</p>
<p>ስለ AI ወኪሎች አሠራር <a href="https://bina.et/news/ai-agent-inside-amharic">በዚህ ጽሑፋችን</a>፣ ስለ LLM፣ RAG እና Agentic AI ልዩነት ደግሞ <a href="https://bina.et/news/llm-rag-ai-agent-agentic-ai-amharic">በዚህ</a> ተብራርቷል። በዘርፉ ለመሥራት የሚፈልጉ <a href="https://bina.et/jobs/category/it">ክፍት የአይቲ ሥራዎችን</a> ይመልከቱ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>What vLLM is.</strong> An open-source inference engine: it does not train a model, it serves one — fast, and on fewer GPUs. Its core idea, PagedAttention, manages GPU memory the way an operating system manages RAM. By vLLM's own measurement, earlier systems wasted 60–80% of that memory; PagedAttention brings the waste under 4%, which means more users on the same card.</p>
<p><strong>About the "24x" figure.</strong> vLLM's announcement (June 2023) reports 14–24x the throughput of HuggingFace Transformers when each request asks for one completion, and 8.5–15x when each asks for three. Quoted bare, "24x" misleads: it has a condition and a date. The honest version is: same GPU, same model, a better serving layer, far more users.</p>
<p><strong>What it gives you:</strong> an OpenAI-compatible API (swap a hosted model for your own without changing code), broad hardware support, quantization down to INT4/FP8, prefix caching, multi-LoRA on one GPU, speculative decoding.</p>
<p><strong>The Ethiopian question.</strong> The software is free; the GPU, the electricity (300–700W, around the clock) and the person to maintain it are not. For most Ethiopian companies today an API is cheaper and better. Self-hosting wins for one reason, and it is a serious one: <em>the data is not allowed to leave</em> — banks, hospitals, government offices, anyone bound by law or contract.</p>
<p><strong>What we chose.</strong> BinaSmart runs no model of its own. Bini sits on an ordinary 4-core, 16GB server with no GPU: retrieval over 27,825 passages partly on this machine (BGE-M3 on CPU), generation through a hosted API. Our content is public — vacancies, tenders, government procedures — so a GPU would buy us nothing. The CVs people send us are different, and those never leave this server. The rule is not "self-host everything" or "API everything"; it is to put each kind of data where it belongs.</p>
`.trim();

(async () => {
  const data = {
    title: 'Running an LLM on your own server — vLLM, and when it is the right answer in Ethiopia',
    titleAm: 'AI በራስዎ ሰርቨር ላይ ማስኬድ — vLLM፣ እና በኢትዮጵያ መቼ ትክክል ነው',
    category: 'ቴክኖሎጂ',
    excerpt: 'vLLM ሞዴልን በርካሽና በፍጥነት የሚያገለግል ክፍት ምንጭ ንብርብር ነው — PagedAttention የማህደረ ትውስታ ብክነትን ከ60–80% ወደ 4% ያወርዳል። ግን ጂፒዩ፣ ኤሌክትሪክና ሰው ያስፈልጋል። ለአብዛኛው የኢትዮጵያ ድርጅት API ርካሽ ነው፤ በራስ ሰርቨር ማስኬድ የሚያሸንፈው መረጃው መውጣት ሲከለከል ብቻ ነው — ባንክ፣ ሆስፒታል፣ መንግሥት። ቢናስማርት ራሱ ምን እንደመረጠም አለ።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🖥️',
    readMinutes: 7,
    evergreen: true,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
