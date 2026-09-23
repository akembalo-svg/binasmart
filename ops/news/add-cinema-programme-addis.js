'use strict';
// News post: why you cannot Google what is showing in an Addis cinema tonight — and what we did.
//
//   node --env-file=.env ops/news/add-cinema-programme-addis.js
//
// Facts in this article, all checked on this server 23 September 2026:
//   · 23 active cinema venues in our directory (Venue, active), 123 programme rows (Programme)
//   · 15 films live on /cinema that morning: Gast 8, Alem 6, Adot 1
//   · the three channels we read: t.me/gastcinema, t.me/alem_cinema, t.me/AdotCinema
//   · phones taken from the cinemas' own posts, read at run time from the Venue rows alem-cinema and gast-cinema
//     (kept out of this public repository);
//     Adot publishes no number, only Hulu Beje
//   · the harvester runs 04:10 and 18:40 UTC daily (crontab), i.e. 07:10 and 21:40 Addis
//
// The point of the piece is not that we built something. It is the thing an Ethiopian reader keeps
// hitting and cannot name: the information exists, it is public, it was posted this morning — and it
// is inside a picture, so no search engine can read a word of it. That is worth explaining once.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const localForm = e164 => { const d = String(e164 || '').replace(/\D/g, '').replace(/^251/, '').replace(/^0/, ''); return /^[79][0-9]{8}$/.test(d) ? '0' + d.slice(0, 3) + ' ' + d.slice(3, 5) + ' ' + d.slice(5, 7) + ' ' + d.slice(7) : null; };
const slug = 'addis-cinema-programme-telegram-poster-amharic';

const bodyFor = P => `
<p>ፊልሙ ዛሬ ማታ ይታያል። ትኬቱ አለ፣ አዳራሹ ክፍት ነው፣ ሲኒማ ቤቱም ፕሮግራሙን ዛሬ ጠዋት አውጥቶታል። ግን "በአዲስ አበባ ዛሬ ምን ይታያል?" ብለው ጎግል ላይ ቢፈልጉ — አያገኙትም።</p>

<p>ይህ ጽሑፍ <strong>ለምን እንደማያገኙት</strong> ነው የሚያብራራው። ምክንያቱ የሲኒማ ቤቶቹ ስንፍና አይደለም። ፕሮግራሙ ተለጥፏል፤ ነገር ግን በሚነበብ ቦታ ላይ አልተለጠፈም።</p>

<h3>📸 ጽሑፉ በምስል ውስጥ ነው</h3>
<p>የአዲስ አበባ ሲኒማ ቤቶች ፕሮግራማቸውን በቴሌግራም ቻናላቸው ላይ በየሁለት ወይም ሦስት ቀኑ ያወጣሉ። ችግሩ የሚወጣበት <em>መልክ</em> ነው፦ የፊልሙ ስም፣ ሰዓቱ፣ አዳራሹ — ሁሉም <strong>በፖስተሩ ምስል ውስጥ ታትሞ</strong> ነው የሚወጣው።</p>
<p>ለሰው ዓይን ይህ ችግር የለውም። ለፍለጋ ሞተር ግን ምስል ማለት <strong>ቀለም ያለው ሳጥን ማለት ነው</strong>። ጎግል በውስጡ ያለውን ጽሑፍ አያነብም፤ ስለዚህ "ወንጀለኛዉ" የሚለው ፊልም ዛሬ 7፡10 ላይ እንደሚታይ የሚያውቅ አንድም የፍለጋ ውጤት የለም።</p>
<p>ውጤቱ ይህ ነው፦ መረጃው <strong>ሕዝባዊ ነው፣ ነጻ ነው፣ ዛሬ የወጣ ነው</strong> — ግን ቴሌግራም ከፍተው እያንዳንዱን ቻናል ካላዩ በቀር አያገኙትም። ለማያውቀው ሰው ደግሞ የማይገኝ መረጃ ማለት ነው።</p>

<h3>🕐 ሁለተኛው ችግር፦ የትኛው ሰዓት?</h3>
<p>አንድ ፖስተር "1፡10" ብሎ ሲጽፍ ምን ማለቱ ነው? በኢትዮጵያ አቆጣጠር ሰባት ሰዓት ከአሥር ደቂቃ — ማለትም በዓለም አቀፍ አቆጣጠር <strong>19፡10</strong> ነው። ሌላ ፖስተር ደግሞ በዓለም አቀፍ አቆጣጠር "19:10" ብሎ ይጽፋል።</p>
<p>ሁለቱም ትክክል ናቸው። ግን አንድ ላይ ሲቀመጡ፣ የተሳሳተ ግምት አንድን ሰው ለባዶ አዳራሽ ከቤቱ ያስወጣዋል። ስለዚህ ደንባችን ግልጽ ነው፦ <strong>የታተመው ሰዓትና የተቀየረው ሰዓት ካልተስማሙ፣ ረድፉ ይጣላል እንጂ አይገመትም</strong>። ከዚያም ሁለቱም አቆጣጠሮች ጎን ለጎን ይታያሉ።</p>

<h3>🎬 ታዲያ ምን ሠራን</h3>
<p>የሲኒማ ቤቶቹን የራሳቸውን ቻናል እናነባለን — ጽሑፉንም፣ <strong>ፖስተሩንም</strong>። ምስሉን የሚያነብ ሞዴል የፊልሙን ስምና ሰዓት አውጥቶ ይሰጣል፤ እኛ ደግሞ ከመታተሙ በፊት እንፈትሸዋለን። (አንድ ሞዴል ምስል አይቶ እንዴት መልስ እንደሚሰጥ <a href="https://bina.et/news/ai-agent-inside-amharic">በዚህ ጽሑፋችን</a> ተብራርቷል።)</p>
<p>የምንጠብቃቸው ደንቦች፦</p>
<ul>
<li><strong>የታተመው ብቻ።</strong> ያልተጻፈ ሰዓት አይጨመርም፤ ያልተረጋገጠ ደግሞ ይወድቃል።</li>
<li><strong>ቀን አይፈጠርም።</strong> ፖስተሩ ቀኖቹን ከጻፈ እነሱ ይያዛሉ፤ ካልጻፈ ለአንድ ሳምንት ብቻ ይቆይና በራሱ ያበቃል።</li>
<li><strong>ምንጩ አብሮ ይሄዳል።</strong> እያንዳንዱ ረድፍ የመጣበት ፖስት ተያይዞታል — ያነበብነውን ከፖስተሩ ጋር ማመሳከር ይቻላል።</li>
</ul>
<p>ፕሮግራሙ <strong>በቀን ሁለት ጊዜ ይታደሣል</strong> — ጠዋት 1፡10 እና ማታ 3፡40 (በዓለም አቀፍ 07፡10 እና 21፡40)። ማንም በእጁ የሚጽፈው ነገር የለም።</p>

<h3>📅 አሁን ያለው (መስከረም 13 ቀን 2019 ዓ.ም / ሴፕቴምበር 23 ቀን 2026)</h3>
<p>በ<a href="https://bina.et/cinema">bina.et/cinema</a> ላይ በዚህ ቀን <strong>15 ፊልም</strong> ከሦስት ሲኒማ ቤት ይታያል፦</p>
<ul>
<li><strong>ጋስት ሲኒማ</strong> (ጋስት ሞል፣ ሲኤምሲ) — 8 ፊልም፤ አብዛኛው የውጭ ፊልም።</li>
<li><strong>ዓለም ሲኒማ</strong> (አፍሪካ ጎዳና፣ ቦሌ) — 6 ፊልም፤ ሁሉም ኢትዮጵያዊ።</li>
<li><strong>አዶት መልቲፕሌክስ</strong> (ቢስራተ ገብርኤል) — 1 ፊልም።</li>
</ul>
<p>ቁጥሩ በየሁለት ቀኑ ይቀየራል፤ ስለዚህ ይህ የዛሬው ስዕል ነው እንጂ ቋሚ አይደለም። ገጹ ግን ራሱን ያድሳል።</p>
<p>በገጹ ላይ ያለው ትንሽ ነገር ግን ጠቃሚ የሆነው፦ <strong>ያለፈው ሰዓት ደብዝዞ፣ ገና የሚቀረው ትርዒት ጎልቶ</strong> ይታያል። ማታ 12፡00 ላይ ሰው የሚፈልገው "ዛሬ ምን ነበር?" ሳይሆን "አሁን ምን ማየት እችላለሁ?" ነው።</p>

<h3>🎟️ ግልጽ እንሁን፦ ትኬቱን የሚሸጡት እነሱ ናቸው</h3>
<p>ቢናስማርት ለእነዚህ ሲኒማ ቤቶች ትኬት አይሸጥም። የምናደርገው አንድ ነገር ነው — <strong>የወጣውን ፕሮግራም የሚነበብና የሚፈለግ ማድረግ</strong>። ትኬቱ በሲኒማ ቤቱ በር ላይ ነው፤ ዓለም ሲኒማ ደግሞ በቴሌብር እና በሁሉ በጀ ይሸጣል።</p>
<p>ስልኮቹ ከራሳቸው ፖስቶች የተወሰዱ ናቸው፦ ዓለም ሲኒማ <strong>${P.alem}</strong>፣ ጋስት ሲኒማ <strong>${P.gast}</strong>። አዶት ስልክ አያወጣም — በቴሌግራም <a href="https://t.me/AdotCinema">t.me/AdotCinema</a> ነው።</p>
<p>ከመሄድዎ በፊት ደውለው ያረጋግጡ። ፕሮግራም በመጨረሻ ሰዓት ሊቀየር ይችላል፤ እኛ የምናሳየው ሲኒማ ቤቱ ያወጣውን ነው።</p>

<h3>🏢 ለሲኒማ ቤቶችና ለዝግጅት አዘጋጆች</h3>
<p>በአዲስ አበባ <strong>23 ሲኒማ ቤት</strong> በዝርዝራችን ውስጥ አለ፤ ፕሮግራም የምናነብላቸው ግን ገና ሦስቱ ብቻ ናቸው። ቻናል ካለዎት ማከል ቀላል ነው፤ ትኬትም እዚህ መሸጥ ይችላሉ — <a href="https://bina.et/for-cinemas">bina.et/for-cinemas</a>። በጅምር ወቅት ነጻ ነው።</p>
<p>ወደ ሲኒማ ቤቱ መሄጃ ከፈለጉ <a href="https://bina.et/ride">የቢና ራይድ</a> ዋጋውን አስቀድሞ ይነግርዎታል። ስለ አዲስ አበባ ሌሎች ተግባራዊ መመሪያዎች ደግሞ <a href="https://bina.et/guides">በመመሪያዎቻችን</a> ውስጥ አሉ።</p>

<hr style="border:none;border-top:1px solid #e8e2d6;margin:30px 0">

<h3>In English — the short version</h3>
<p><strong>The problem.</strong> Addis cinemas publish their programme every two or three days on their own Telegram channel — and the film names and showtimes are printed <em>inside the poster image</em>. To a person that is fine. To a search engine an image is a coloured box: Google cannot read a word of it. So the information is public, free and posted this morning, and still nobody can find it without opening Telegram and checking each channel by hand.</p>
<p><strong>The second problem.</strong> A poster that says "1:10" means 19:10 on the international clock; another cinema writes 19:10 directly. Both are right, and a wrong guess sends somebody across the city for nothing. Our rule: if the printed time and the converted time do not reconcile, the row is dropped rather than guessed at — and the page shows both clocks.</p>
<p><strong>What we did.</strong> We read the cinemas' own channels, the text and the poster, and a model that can read an image returns the films and times. Only what is printed; dates are never invented (a poster naming its days is trusted for those days, one that does not is held for a week and expires by itself); and every row carries a link to the post it came from, so anyone can check our reading against the picture. It refreshes twice a day, 07:10 and 21:40 Addis time, with nobody retyping anything.</p>
<p><strong>Today, 23 September 2026:</strong> 15 films across three cinemas on <a href="https://bina.et/cinema">bina.et/cinema</a> — Gast 8, Alem 6, Adot 1. Showtimes already past are faded and the next screening still to come is highlighted, because at 6pm the question is not what was on, it is what you can still catch.</p>
<p><strong>What we do not do.</strong> We do not sell these tickets. The cinema does, at the door; Alem also sells through telebirr and Hulu Beje. Phone numbers come from the cinemas' own posts: Alem ${P.alem}, Gast ${P.gast}; Adot publishes none. Call before you travel — a programme can change at the last minute, and what we show is what the cinema published.</p>
`.trim();

(async () => {
  const v = Object.fromEntries((await prisma.venue.findMany({ where: { slug: { in: ['alem-cinema', 'gast-cinema'] } }, select: { slug: true, phone: true } })).map(r => [r.slug, localForm(r.phone)]));
  if (!v['alem-cinema'] || !v['gast-cinema']) throw new Error('Alem or Gast has no phone in the Venue table: not publishing an article without them');
  const body = bodyFor({ alem: v['alem-cinema'], gast: v['gast-cinema'] });
  const data = {
    title: 'What is showing in Addis tonight — and why you cannot Google it',
    titleAm: 'የአዲስ አበባ ሲኒማ ፕሮግራም — ጎግል ማንበብ የማይችለው፣ በፖስተር ውስጥ ያለው',
    category: 'ቴክኖሎጂ',
    excerpt: 'የአዲስ አበባ ሲኒማ ቤቶች ፕሮግራማቸውን በቴሌግራም ያወጣሉ — ግን የፊልሙ ስምና ሰዓቱ በፖስተሩ ምስል ውስጥ ታትሞ ነው የሚወጣው። ለፍለጋ ሞተር ምስል ማለት ቀለም ያለው ሳጥን ማለት ነው፤ ስለዚህ ዛሬ ማታ ምን እንደሚታይ ጎግል ላይ አይገኝም። ፖስተሩን አንብበን በቀን ሁለት ጊዜ የሚታደስ ፕሮግራም ሠራን — እና የኢትዮጵያ ሰዓት ካልተስማማ ረድፉን እንጥላለን እንጂ አንገምትም።',
    bodyHtml: body,
    lang: 'am',
    heroEmoji: '🎬',
    readMinutes: 5,
    evergreen: false,
    published: true,
  };
  const r = await prisma.newsPost.upsert({ where: { slug }, create: Object.assign({ slug }, data), update: data });
  console.log('news post ready: https://bina.et/news/' + r.slug + ' (' + body.length + ' chars)');
  await prisma.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
