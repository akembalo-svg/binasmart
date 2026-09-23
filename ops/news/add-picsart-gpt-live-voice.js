'use strict';
// News post: Picsart + OpenAI GPT-Live-1 — talking to an AI instead of typing at it.
//
//   node --env-file=.env ops/news/add-picsart-gpt-live-voice.js
//
// Written by Ibrahim Kedir Bedru (owner, 23 September 2026); published under his byline. The desk's
// job here was to check every claim and to add the part an Ethiopian reader needs, which no
// announcement carries: Amharic is the hard part, and we know that from our own driver app.
//
// Sources, read 23 September 2026:
//   · picsart.com/blog/picsart-agents-get-live-voice-with-gpt-live-1 — "Live voice is available now in
//     Picsart AI Agents on web and iOS, and it will reach more of Picsart shortly"; "Interrupt
//     mid-sentence and it adjusts"; "You do not need to set anything up: open an Agent, start talking";
//     OpenAI's line: "Powered by OpenAI's GPT-Live-1, Picsart's creative AI Agents let creators
//     brainstorm, generate, refine, and publish content through real-time voice conversation."
//   · GPT-Live-1 released in the OpenAI API 10 September 2026: full-duplex voice at $0.05 per session
//     minute billed by the second, with backend model, tools and telephony charged separately; not on
//     the free tier; concurrency by usage tier (25 sessions at tier 1, 500 at tier 5). Picsart was named
//     in the launch alongside Yelp, Cognition and HeyGen.
//
// The one figure that needed its condition attached is the $0.05: it buys the listening and the
// speaking, not the thinking. An article that prints it bare tells an Ethiopian developer a voice agent
// costs three birr an hour, which is not true.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const slug = 'picsart-openai-gpt-live-1-voice-amharic';

const body = `
<p style="background:#f4f1ea;border-left:4px solid #b8860b;padding:14px 18px;border-radius:8px;font-size:15px;color:#5c5548"><strong>ምንጭ፦</strong> የPicsart የራሱ ማስታወቂያ እና የOpenAI የGPT-Live-1 መረጃ፣ ሴፕቴምበር 23 ቀን 2026 የተነበቡ። ዋጋውና ገደቦቹ እንደተገለጹት ተቀምጠዋል።</p>

<figure style="display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;background:#fff;border:1px solid #e8e2d6;border-radius:12px;padding:22px 18px;margin:22px 0">
  <img src="/static/newslogos/picsart.svg" alt="Picsart" width="121" height="28" style="height:28px;width:auto">
  <span style="font-size:22px;color:#b0aa9e;font-weight:700">+</span>
  <img src="/static/newslogos/openai-wordmark.svg" alt="OpenAI" width="88" height="24" style="height:24px;width:auto">
  <figcaption style="flex-basis:100%;text-align:center;font-size:12px;color:#8b8578;margin-top:6px">Picsart እና OpenAI — የባለቤቶች የንግድ ምልክቶች ናቸው፡ ለመለያ ብቻ ያገለግላሉ። · Trademarks of their owners, shown for identification only.</figcaption>
</figure>

<p>AIን ለመጠቀም እስካሁን የምናደርገው አንድ ነገር ነበር፦ እንጽፋለን፣ እንጠብቃለን፣ መልስ ይመጣል። ሐሳባችን በመሃል ቢቀየር እንኳ እስኪጨርስ መጠበቅ ነበረብን።</p>
<p>ይህ ጽሑፍ <strong>ያ መጠበቅ የቀረበትን</strong> ለውጥ ነው የሚያብራራው። Picsart የፈጠራ AI ረዳቶቹን ከOpenAI አዲሱ የድምፅ ሞዴል <strong>GPT-Live-1</strong> ጋር አገናኝቷል — ማለትም ከAI ጋር እንደ ሰው መነጋገር፣ በመሃል ማቋረጥና አቅጣጫ መቀየር ማለት ነው።</p>

<h3>🗣️ ተራ መጠበቅ የለም — full-duplex ማለት ምንድነው?</h3>
<p>የቀድሞዎቹ የድምፅ ሥርዓቶች እንደ ዋኪቶኪ ነበሩ፦ አንዱ ሲናገር ሌላው ያዳምጣል። <strong>Full-duplex</strong> ማለት ግን እንደ ስልክ ጥሪ <strong>በተመሳሳይ ጊዜ መናገርና ማዳመጥ መቻል ማለት ነው</strong>።</p>
<p>ልዩነቱ በተግባር ይህ ነው፦ AI እየመለሰ ሳለ "ቆይ፣ ያ አይደለም" ብለው ሊያቋርጡት ይችላሉ፤ እሱም ይከተላል። Picsart በራሱ ቃል፦ <em>"Interrupt mid-sentence and it adjusts."</em></p>

<h3>🎨 Picsart ላይ ምን ይመስላል</h3>
<p>አንድ ምሳሌ፦ "ይህን ፎቶ ለInstagram ማስታወቂያ አድርገው፤ ቀለሙን አሻሽለው" ይላሉ። ሥራውን ሲጀምር ደግሞ "ቆይ፣ ሰማያዊ አድርገው፤ እና ለLinkedIn የሚሆን መጠን ጨምር" ብለው ይቀይሩታል — ከመጀመሪያ መጀመር ሳያስፈልግ።</p>
<p>ማዘጋጀት የሚያስፈልግ ነገር የለም፤ Picsart እንደሚለው <em>"open an Agent, start talking"</em>። ለአሁኑ በ<strong>ድረ-ገጹና በiOS ላይ ብቻ</strong> ነው — አንድሮይድ ገና አልደረሰውም፣ እና ይህ በኢትዮጵያ ትልቅ ልዩነት ነው።</p>

<h3>💰 ዋጋው — እና የማይነገረው ክፍል</h3>
<p>GPT-Live-1 ሴፕቴምበር 10 ቀን 2026 ለገንቢዎች ተለቋል። ዋጋው <strong>በደቂቃ $0.05</strong> ሲሆን በሰከንድ ይሰላል።</p>
<p>ይህ ቁጥር ብቻውን ሲጠቀስ ግን ያሳስታል። <strong>$0.05 የሚገዛው ማዳመጡንና መናገሩን ነው</strong> — ማሰቡን አይደለም። ከጀርባ የሚሠራው ሞዴል፣ የሚጠቀማቸው መሣሪያዎች እና የስልክ መስመሩ <strong>ለየብቻ ይከፈላሉ</strong>። ስለዚህ የአንድ ውይይት ትክክለኛ ወጪ AI ምን ያህል ሥራ ወደ ኋላ እንደሚልክ ይወሰናል።</p>
<p>ሁለት ተጨማሪ ገደቦች፦ በነጻ እቅድ ላይ <strong>አይሠራም</strong>፤ እና በአንድ ጊዜ የሚያዙት ውይይቶች ብዛት በክፍያ ደረጃ ይወሰናል (በመጀመሪያው ደረጃ 25፣ በከፍተኛው 500)።</p>

<h3>📞 ከፈጠራ ሥራ ባሻገር</h3>
<p>የድምፅ ወኪል ለስልክ ጥሪም ይሠራል። ማለትም የደንበኛ አገልግሎት፣ ቦታ ማስያዝ፣ ሽያጭ — በድምፅ የሚሠራ AI መገንባት ይቻላል። Picsart በOpenAI ማስታወቂያ ውስጥ ከYelp፣ Cognition እና HeyGen ጋር አብሮ ተጠቅሷል።</p>
<p>ይህ ከchatbot ወደ <strong>ወኪል</strong> የሚደረገው ሽግግር ነው፦ መረዳት → ማቀድ → መሥራት → ማስተካከል። ወኪል ማለት ምን ማለት እንደሆነ <a href="https://bina.et/news/ai-agent-inside-amharic">በዚህ ጽሑፋችን</a> ተብራርቷል፤ ውሳኔ ላይ ያተኮረ ሌላ ዓይነት ሞዴል ደግሞ <a href="https://bina.et/news/typesafe-jev-system-one-amharic">በዚህ</a> ቀርቧል።</p>

<h3>🇪🇹 ለኢትዮጵያ — እና እኛ ያጋጠመን እውነት</h3>
<p>በድምፅ መሥራት ለኢትዮጵያ ትልቅ ነገር ነው። ብዙ ሰው በስልኩ ላይ በፍጥነት መጻፍ አይችልም፤ አማርኛ መተየብ ደግሞ የባሰ ዘገምተኛ ነው። ስለዚህ "መናገር በቂ ነው" የሚለው ሐሳብ ከየትኛውም ቦታ በላይ እዚህ ይጠቅማል።</p>
<p>ግን እውነቱን እንናገር፦ <strong>ከባዱ ክፍል ሞዴሉ አይደለም፤ አማርኛው ነው።</strong> ይህን ከራሳችን ሥራ አይተነዋል። የ<a href="https://bina.et/ride">ቢና ራይድ</a> የሹፌር መተግበሪያ አቅጣጫውን በድምፅ እንዲናገር ተሠርቶ ነበር፤ ነገር ግን በኢትዮጵያ በስፋት የሚሸጡት ርካሽ አንድሮይድ ስልኮች <strong>የአማርኛ ድምፅ የላቸውም</strong>። ውጤቱ፦ ሹፌሩ የሚሰማው ድምፅ ሳይሆን ምልክት ብቻ ነበር።</p>
<p>ስለዚህ የዚህ ዜና ትክክለኛ ትርጉም ለእኛ ይህ ነው፦ ዓለም አቀፍ የድምፅ ሞዴሎች እየበሰሉ ነው፤ ለአማርኛ ግን ጥራቱ ገና መፈተሽ አለበት። ቃል ከመግባታችን በፊት መሞከር ነው ደንባችን።</p>
<p>አሁን <a href="https://bina.et/ai">ቢኒ</a> በጽሑፍ ይሠራል — በአማርኛ፣ በኦሮምኛና በእንግሊዝኛ። የድምፅ ውይይት ቀጣዩ ግልጽ እርምጃ ነው፤ ግን የሚጨመረው በሙከራ ካለፈ በኋላ ነው። አንድ ደንብ ግን አይቀየርም፦ የተጠቃሚዎቻችን የግል መረጃ — ሲቪን ጨምሮ — ከዚህ ሰርቨር አይወጣም።</p>

<h3>💡 ለፈጠራ ሠራተኞች</h3>
<p>YouTuber፣ ፎቶግራፍ አንሺ፣ ዲዛይነር ወይም የንግድ ባለቤት ከሆኑ፣ ዛሬውኑ የሚጠቅምዎት ነገር አለ፦ ማስታወቂያ ማዘጋጀት፣ መጠን መቀየር፣ ለተለያዩ መድረኮች ስሪት ማውጣት — ሁሉም በአንድ የተቀጠለ ውይይት። ይህ የፈጠራ ሂደቱን ያፋጥናል።</p>
<p>በዘርፉ ሥራ የሚፈልጉ ደግሞ <a href="https://bina.et/jobs/category/it">ክፍት የአይቲ ሥራዎችን</a> ይመልከቱ።</p>

<h3>🔮 በአጭሩ</h3>
<p>AI የምንጽፍለት መሣሪያ ከመሆን ወደ <strong>አብሮን የሚሠራ ባልደረባ</strong> እየተቀየረ ነው። ዛሬ ሐሳብዎን ይናገራሉ፤ ይሰማዎታል፤ ይጀምራል፤ በመሃል ሲቀይሩ ይከተላል።</p>
<p>ለኢትዮጵያ ጥያቄው "ይህ ይመጣል?" አይደለም — ይመጣል። ጥያቄው <strong>በአማርኛ መቼ በደንብ ይሠራል?</strong> የሚለው ነው። እሱን የሚመልሰው ማስታወቂያ ሳይሆን ሙከራ ነው።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>What happened.</strong> Picsart has put live voice into its AI Agents, built on <strong>GPT-Live-1</strong>, the full-duplex voice model OpenAI released to developers on 10 September 2026. Full-duplex means the model listens and speaks at the same time, like a phone call rather than a walkie-talkie: in Picsart's own words, "interrupt mid-sentence and it adjusts". There is nothing to configure — "open an Agent, start talking". It is on web and iOS for now; Android has not arrived, which matters here more than it does elsewhere.</p>
<p><strong>The price, with the part that is usually left off.</strong> $0.05 per session minute, billed by the second. That buys the listening and the speaking, not the thinking: the backend model, the tools it calls and any telephony are billed separately, so the real cost of a conversation depends on how much work the voice layer hands off. It does not run on the free tier, and concurrent sessions are capped by usage tier — 25 at the bottom, 500 at the top.</p>
<p><strong>Why it matters in Ethiopia — and what we already learned.</strong> Typing is slow here and typing Amharic is slower, so "just say it" is worth more in Addis than in San Francisco. But the hard part is not the model, it is Amharic. We know because we shipped it: the BinaSmart Ride driver app was built to speak directions aloud, and the cheap Android phones most drivers carry have no Amharic voice installed, so the driver hears a chime and nothing else. Global voice models are maturing; Amharic quality still has to be tested rather than assumed. Bini works in text today — Amharic, Afaan Oromoo and English — and voice is the obvious next step, after it passes a test rather than before. One rule does not change: our users' personal data, CVs included, never leaves this server.</p>
`.trim();

(async () => {
  const data = {
    title: 'Picsart and OpenAI put live voice into AI Agents — and what that is worth in Amharic',
    titleAm: 'Picsart እና OpenAI የድምፅ AI አስተዋወቁ — ከመጻፍ ይልቅ መናገር',
    category: 'ቴክኖሎጂ',
    excerpt: 'Picsart የፈጠራ AI ረዳቶቹን ከOpenAI አዲሱ GPT-Live-1 የድምፅ ሞዴል ጋር አገናኝቷል፤ ማዳመጥና መናገር በተመሳሳይ ጊዜ ስለሚሆን በመሃል ማቋረጥና አቅጣጫ መቀየር ይቻላል። ዋጋው በደቂቃ $0.05 ነው — ግን ያ የሚገዛው ማዳመጡንና መናገሩን ብቻ ነው። ለኢትዮጵያ ግን ከባዱ ክፍል ሞዴሉ ሳይሆን አማርኛው ነው፤ ይህን ከራሳችን የሹፌር መተግበሪያ አይተነዋል።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🎙️',
    readMinutes: 6,
    evergreen: false,
    published: true,
    author: 'Ibrahim Kedir Bedru',
    authorUrl: 'https://www.linkedin.com/in/ibrahimkedir',
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
