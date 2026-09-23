#!/usr/bin/env node
'use strict';
// BinaSmart's own two vacancies, 23 September 2026.
//
//   node --env-file=.env ops/jobs/add-binasmart-vacancies.js --dry-run
//   node --env-file=.env ops/jobs/add-binasmart-vacancies.js
//
// The owner dictated these on Telegram. Two things are written the way they are on purpose:
//
//   · The field role is COMMISSION ONLY and the advert says so in the first line, with the condition
//     attached — 20% of the profit, after the business's free trial ends and money actually moves.
//     An advert that buries that recruits ten people who leave angry in week three, and this platform
//     tells other employers not to do exactly that. We hold our own advert to the rule we publish.
//   · It does not promise a dashboard. There is no agent-earnings page today; the owner's position is
//     that it can be built on Telegram once somebody actually brings a business, which is fair. So the
//     advert says commission is agreed and reported, not that anything is visible live.
const DRY = process.argv.includes('--dry-run');

const EMPLOYER = {
  slug: 'binasmart',
  name: 'BinaSmart',
  nameAm: 'ቢናስማርት',
  city: 'Addis Ababa',
  website: 'https://bina.et',
  sector: 'Technology',
  about: 'የኢትዮጵያ ዲጂታል መድረክ — ሥራ፣ ጨረታ፣ ዜና፣ ሲኒማ፣ ራይድና የAI ረዳት። BinaSmart is an Ethiopian digital platform: jobs, tenders, news, cinema, rides and an Amharic AI assistant.',
  verified: true,
};

const DEADLINE = new Date('2026-10-23T20:59:59.999Z');   // one month, to the end of that day in Addis
const APPLY = 'በቴሌግራም ያመልክቱ፦ https://t.me/Bina_smart · Apply on Telegram: https://t.me/Bina_smart';

const JOBS = [
  {
    slug: 'field-sales-data-collector-binasmart',
    title: 'Field Sales & Data Collector (Freelance, commission)',
    titleAm: 'የመስክ ሽያጭና የመረጃ ሰብሳቢ (ፍሪላንስ፣ በኮሚሽን)',
    category: 'sales',
    city: 'Addis Ababa',
    jobType: 'contract',
    vacancies: 10,
    experience: 'የሥራ ልምድ አያስፈልግም · No experience required',
    education: 'ማንበብና መጻፍ — በአማርኛ ወይም በእንግሊዝኛ · Able to read and write, Amharic or English',
    salary: 'ኮሚሽን ብቻ — ከትርፍ 20% · Commission only — 20% of profit',
    summary: 'በአዲስ አበባ ያሉ ድርጅቶችን በመጎብኘት በቢናስማርት ሥርዓት ላይ እንዲመዘገቡ የሚያደርጉ 10 ፍሪላንስ ሠራተኞች። ክፍያው ኮሚሽን ብቻ ነው።',
    bodyHtml: `
<p><strong>ክፍያው ኮሚሽን ብቻ ነው።</strong> ወርሃዊ ደመወዝ የለውም። ያመጡት ድርጅት የሙከራ ጊዜው አልቆ ገቢ መግባት ሲጀምር፣ ከዚያ ድርጅት ከሚገኘው <strong>ትርፍ 20%</strong> ያገኛሉ። ይህን አስቀድመን በግልጽ እንናገራለን — ወዲያውኑ ገቢ አይጠብቁ።</p>

<h3>ሥራው ምንድነው?</h3>
<p>በአዲስ አበባ ያሉ ድርጅቶችን በአካል ማግኘት፣ ቢናስማርት ምን እንደሆነ ማስረዳት፣ እና መረጃቸውን በሥርዓታችን ላይ እንዲሞሉ መርዳት።</p>
<ul>
<li>የመኪና ነጋዴዎች፣ ሱቆች፣ የእጅ ሙያ ባለቤቶች</li>
<li>ሆቴሎች፣ ሲኒማ ቤቶች</li>
<li>የሪል እስቴት ኩባንያዎች</li>
</ul>
<p>ከዚያም የምርታቸውን መረጃና <strong>እውነተኛ ፎቶ</strong> መሰብሰብ፤ እንዲሁም ለታክሲ ሹፌሮችና ለሌሎች ፍላየር ማደል።</p>
<p>ስምምነቱ በእርስዎ ስም ይመዘገባል፤ ያመጡት ድርጅት የእርስዎ ሆኖ ይቆያል።</p>

<h3>የሚያስፈልግ</h3>
<ul>
<li><strong>አማርኛና አፋን ኦሮሞ</strong> መናገር</li>
<li>መሠረታዊ የኮምፒውተር እውቀት</li>
<li>ማንበብና መጻፍ — በአማርኛ ወይም በእንግሊዝኛ</li>
<li>የሥራ ልምድ አያስፈልግም</li>
<li>ሰው የማነጋገር ፍላጎት — ሥራው በአብዛኛው በመስክ ነው</li>
</ul>

<h3>የሥራ ሰዓት</h3>
<p>ፍሪላንስ ነው። በሚችሉበት ሰዓት ይሠራሉ፤ የተወሰነ የቢሮ ሰዓት የለም።</p>

<hr>
<h3>In English</h3>
<p><strong>This is commission only.</strong> There is no monthly salary. You earn <strong>20% of the profit</strong> from a business you bring, once its free trial has ended and it is actually earning. We say this plainly up front: do not expect income immediately.</p>
<p><strong>The work:</strong> visit businesses across Addis Ababa in person — car dealers, shops, skilled-trade owners, hotels, cinemas, real estate companies — explain BinaSmart, and help them put their data onto the system. Collect their product information and <strong>real photographs</strong>, and hand flyers to taxi drivers and others. The agreement is recorded under your name and the business stays yours.</p>
<p><strong>You need:</strong> Amharic and Afaan Oromoo, basic computer skills, and to be able to read and write in Amharic or English. No experience required. Freelance hours — you work when you are free.</p>
`.trim(),
  },
  {
    slug: 'office-data-entry-customer-support-binasmart',
    title: 'Office — Data Entry & Customer Support',
    titleAm: 'የቢሮ ሠራተኛ — መረጃ ማስገባትና የደንበኞች ድጋፍ',
    category: 'admin',
    city: 'Addis Ababa',
    jobType: 'full-time',
    vacancies: 4,
    experience: 'የሥራ ልምድ አያስፈልግም · No experience required',
    education: 'ማንበብና መጻፍ — በአማርኛ ወይም በእንግሊዝኛ · Able to read and write, Amharic or English',
    salary: 'ወርሃዊ ደመወዝ — በስምምነት · Monthly salary, agreed at interview',
    summary: 'በቢሮ ውስጥ መረጃ ማስገባት፣ ስልክ ማንሳትና ከደንበኞች ጋር መጻፍ። የኮምፒውተር እውቀት ያስፈልጋል፤ ማንኛውም ጾታ ማመልከት ይችላል።',
    bodyHtml: `
<h3>ሥራው ምንድነው?</h3>
<ul>
<li>ሙሉ የመረጃ ማስገባት ሥራ — የድርጅቶችና የምርቶች መረጃ በሥርዓቱ ላይ ማስገባት</li>
<li>ስልክ ማንሳትና መመለስ</li>
<li>ከደንበኞች ጋር በጽሑፍ መነጋገር — ከቢኒ (የቢናስማርት የAI ረዳት) ጋር አብሮ በመሥራት</li>
</ul>
<p>ቢኒ የመጀመሪያውን መልስ ይሰጣል፤ እርስዎ ደግሞ ሰው የሚያስፈልገውን ይይዛሉ። AI ሊይዘው የማይገባውን መለየት የሥራው አካል ነው።</p>

<h3>የሚያስፈልግ</h3>
<ul>
<li>የኮምፒውተር እውቀት — መተየብና በኢንተርኔት መሥራት</li>
<li>ማንበብና መጻፍ — በአማርኛ ወይም በእንግሊዝኛ</li>
<li><strong>ማንኛውም ጾታ</strong> ማመልከት ይችላል</li>
<li>የሥራ ልምድ አያስፈልግም</li>
</ul>

<hr>
<h3>In English</h3>
<p>Office work at BinaSmart in Addis Ababa: full data entry — putting business and product information onto the system — answering the phone, and handling written conversations with customers alongside Bini, our Amharic AI assistant. Bini answers first; you take what needs a person, and deciding what the AI should not handle is part of the job.</p>
<p><strong>You need:</strong> computer skills (typing and working online) and to be able to read and write in Amharic or English. <strong>Applications welcome from any gender.</strong> No experience required.</p>
`.trim(),
  },
];

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    let employer = await prisma.employer.findUnique({ where: { slug: EMPLOYER.slug } });
    if (!employer) {
      console.log('[jobs] creating employer ' + EMPLOYER.name + (DRY ? ' (dry run)' : ''));
      if (!DRY) employer = await prisma.employer.create({ data: EMPLOYER });
    } else {
      console.log('[jobs] employer exists: ' + employer.name);
    }

    for (const j of JOBS) {
      const data = Object.assign({}, j, {
        employerId: employer ? employer.id : '(dry)',
        deadline: DEADLINE,
        howToApply: APPLY,
        sourceName: 'BinaSmart',
        sourceUrl: 'https://bina.et/jobs',
        published: true,
      });
      console.log('  · ' + j.titleAm + '  [' + j.category + (j.vacancies ? ', ' + j.vacancies + ' posts' : '') + ']');
      if (DRY) continue;
      await prisma.job.upsert({ where: { slug: j.slug }, update: data, create: data });
      console.log('    https://bina.et/jobs/' + j.slug);
    }
    if (DRY) console.log('[jobs] nothing written.');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
