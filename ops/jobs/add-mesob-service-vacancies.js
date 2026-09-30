#!/usr/bin/env node
'use strict';
// የኢፌዴሪ መሶብ አገልግሎት — five contract vacancies, 25 September 2026.
//
//   node --env-file=.env ops/jobs/add-mesob-service-vacancies.js --dry-run
//   node --env-file=.env ops/jobs/add-mesob-service-vacancies.js
//
// Source: a Google Form the employer is collecting applications through, sent in by the owner
// (https://docs.google.com/forms/d/e/1FAIpQLSctWysqc5_cVJBpdjm0tgv7imWv_hPtg8oQQX_T0HKT1TnGRA/viewform).
// The form sits behind a Google sign-in, so only its FIRST page could be read, from the owner's
// screenshot. That page gives the employer, the contract basis and the five post titles — nothing else.
//
// What is deliberately left EMPTY rather than filled in:
//   · experience, education — the announcement we can see states none.
//   · salary — the owner confirmed the employer does not publish one.
//   · deadline, vacancies — not on the page we could read.
// The schema says "as the advert states it, never our own guess", so these stay null and the page shows
// nothing there. A guessed closing date on a government vacancy costs somebody a job.
//
// city falls back to the schema default of Addis Ababa. The announcement does not state a duty station;
// flagged to the owner rather than presented as fact.
const DRY = process.argv.includes('--dry-run');

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSctWysqc5_cVJBpdjm0tgv7imWv_hPtg8oQQX_T0HKT1TnGRA/viewform';

const EMPLOYER = {
  slug: 'mesob-service',
  name: 'MESOB Service (FDRE)',
  nameAm: 'የኢፌዴሪ መሶብ አገልግሎት',
  sector: 'Government',
  website: 'https://id.gov.et/mesob',
  about: 'መሶብ የኢትዮጵያ መንግሥት የአንድ ማዕከል ዲጂታል አገልግሎት መድረክ ነው — በርካታ የመንግሥት አገልግሎቶችን በአንድ ቦታ የሚያቀርብ። MESOB is the Ethiopian government’s one-stop digital service platform, bringing services from many institutions into a single place.',
  logoUrl: '/static/logos/mesob-service.png',
  verified: false,
};

// The same notice covers all five posts, so the body is shared. It says only what the announcement says.
const BODY = `
<p>የኢፌዴሪ መሶብ አገልግሎት ከዚህ በታች በተዘረዘሩት የሥራ መደቦች ላይ አመልካቾችን <strong>አወዳድሮ በኮንትራት</strong> ለመቅጠር ይፈልጋል።</p>

<h3>ክፍት የሥራ መደቦች</h3>
<ul>
<li>ሾፌር መካኒክ</li>
<li>ሹፌር III</li>
<li>የቢሮ ረዳት</li>
<li>የህጻናት ተንከባካቢ ባለሙያ</li>
<li>አትክልተኛ</li>
</ul>

<h3>አመልካቾች ልብ ይበሉ</h3>
<p>ማመልከቻው የሚሞላው በGoogle ቅጽ ነው። ቅጹን ለመክፈት <strong>በGmail (Google) መለያዎ መግባት ይጠበቅብዎታል</strong>፤ ስምዎ፣ ኢሜልዎና ፎቶዎ ከማመልከቻው ጋር ይመዘገባሉ።</p>
<p><strong>የትምህርት ደረጃ፣ የሥራ ልምድ፣ ደመወዝና የመዝጊያ ቀን</strong> በደረሰን ማስታወቂያ ላይ አልተገለጹም። ዝርዝሩ በቅጹ ውስጥ ሊኖር ስለሚችል ቅጹን በሙሉ ያንብቡ።</p>
<p>ይህን ማስታወቂያ ያገኘነው ከቀጣሪው የማመልከቻ ቅጽ ነው። ቢናስማርት አያስቀጥርም፤ ማመልከቻውም በቀጥታ ወደ ቀጣሪው ይሄዳል።</p>

<h3>In English</h3>
<p>The FDRE MESOB Service is hiring on a <strong>contract</strong> basis for five posts: driver-mechanic, driver III, office assistant, childcare worker and gardener. Applications go through the employer’s own Google Form, which <strong>requires you to sign in with a Gmail account</strong> — your name, email and photo are recorded with the application. The notice we received states no education or experience requirement, no salary and no closing date; read the whole form, as details may appear on its later pages. BinaSmart does not recruit for this employer and does not receive the applications.</p>
`.trim();

const APPLY = `ማመልከቻውን በዚህ ቅጽ ይሙሉ (በGmail መለያ መግባት ያስፈልጋል)፦ ${FORM} · Apply on the employer’s Google Form (Gmail sign-in required): ${FORM}`;

const JOBS = [
  { slug: 'driver-mechanic-mesob-service', title: 'Driver Mechanic', titleAm: 'ሾፌር መካኒክ', category: 'logistics',
    summary: 'የኢፌዴሪ መሶብ አገልግሎት በኮንትራት የሚቀጥረው የሾፌር መካኒክ የሥራ መደብ። ማመልከቻው በGoogle ቅጽ ነው።' },
  { slug: 'driver-iii-mesob-service', title: 'Driver III', titleAm: 'ሹፌር III', category: 'logistics',
    summary: 'የኢፌዴሪ መሶብ አገልግሎት በኮንትራት የሚቀጥረው የሹፌር III የሥራ መደብ። ማመልከቻው በGoogle ቅጽ ነው።' },
  { slug: 'office-assistant-mesob-service', title: 'Office Assistant', titleAm: 'የቢሮ ረዳት', category: 'admin',
    summary: 'የኢፌዴሪ መሶብ አገልግሎት በኮንትራት የሚቀጥረው የቢሮ ረዳት የሥራ መደብ። ማመልከቻው በGoogle ቅጽ ነው።' },
  { slug: 'childcare-worker-mesob-service', title: 'Childcare Worker', titleAm: 'የህጻናት ተንከባካቢ ባለሙያ', category: null,
    summary: 'የኢፌዴሪ መሶብ አገልግሎት በኮንትራት የሚቀጥረው የህጻናት ተንከባካቢ ባለሙያ የሥራ መደብ። ማመልከቻው በGoogle ቅጽ ነው።' },
  { slug: 'gardener-mesob-service', title: 'Gardener', titleAm: 'አትክልተኛ', category: 'security',
    summary: 'የኢፌዴሪ መሶብ አገልግሎት በኮንትራት የሚቀጥረው የአትክልተኛ የሥራ መደብ። ማመልከቻው በGoogle ቅጽ ነው።' },
];

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    let employer = await prisma.employer.findUnique({ where: { slug: EMPLOYER.slug } });
    if (!employer) {
      console.log('[jobs] creating employer ' + EMPLOYER.nameAm + (DRY ? ' (dry run)' : ''));
      if (!DRY) employer = await prisma.employer.create({ data: EMPLOYER });
    } else {
      console.log('[jobs] employer exists: ' + employer.nameAm);
      if (!DRY) employer = await prisma.employer.update({ where: { id: employer.id }, data: EMPLOYER });
    }

    for (const j of JOBS) {
      const data = Object.assign({}, j, {
        employerId: employer ? employer.id : '(dry)',
        jobType: 'contract',
        bodyHtml: BODY,
        howToApply: APPLY,
        sourceName: 'የኢፌዴሪ መሶብ አገልግሎት',
        sourceUrl: FORM,
        published: true,
      });
      console.log('  · ' + j.titleAm + '  [' + (j.category || 'other') + ']');
      if (DRY) continue;
      await prisma.job.upsert({ where: { slug: j.slug }, update: data, create: data });
      console.log('    https://bina.et/jobs/' + j.slug);
    }
    if (DRY) console.log('[jobs] nothing written.');
  } finally {
    await prisma.$disconnect();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
