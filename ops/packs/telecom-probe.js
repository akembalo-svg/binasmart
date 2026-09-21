#!/usr/bin/env node
'use strict';
// The telecom pack's retrieval probe: twenty real citizen questions, ten English and ten Amharic, each put through
// knowledge.search (the path /api/knowledge/search and the MCP tool use) against the WHOLE index, and the rank of
// the page that answers it recorded. It measures; it tunes nothing. The reranker, the hybrid score and the
// bilingual flags are exactly what the running app has.
//
//   node --env-file=.env ops/packs/telecom-probe.js [--json out.json]
//
// A question names the pages that would answer it (any one of them counts). "rank" is the position of the first
// of them among the top eight results, or 0 when none is there. Not a benchmark and not a gold set: the gold
// set, the intent detector and the floors are a separate task.
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { makeKnowledge } = require('../../knowledge/index');

const T = 'telecom:';
const Q = [
  // ---- English
  { lang: 'en', q: 'How much is a monthly mobile data package from Ethio telecom?', want: [T + 'telecom-ethiotelecom-mobile-data-package-new'] },
  { lang: 'en', q: 'How do I replace a lost or damaged SIM card and what does it cost?', want: [T + 'telecom-ethiotelecom-faq', T + 'telecom-eca-directive-799-2021-sim-card-registration', 'law:stolen-phone-police-report-sim-block'] },
  { lang: 'en', q: 'What are the rules for registering a SIM card in Ethiopia?', want: [T + 'telecom-eca-directive-799-2021-sim-card-registration'] },
  { lang: 'en', q: 'How much does roaming cost if I travel to Dubai (United Arab Emirates)?', want: [T + 'telecom-ethiotelecom-international-roaming'] },
  { lang: 'en', q: 'Where does Ethio telecom have 5G coverage?', want: [T + 'telecom-ethiotelecom-5g-launch', T + 'telecom-ethiotelecom-new-ethio-telecom-4g-lte-sites', T + 'telecom-ethiotelecom-5g-mobile-package'] },
  { lang: 'en', q: 'How do I complain to the regulator about my telecom operator?', want: [T + 'telecom-eca-consumer-affairs', T + 'telecom-eca-directive-832-2021-consumer-rights-and-protection', T + 'telecom-eca-directive-796-2021-dispute-resolution', 'law:telecom-consumer-complaint-eca-directive-832-2021'] },
  { lang: 'en', q: 'My airtime was deducted wrongly, what are my consumer rights and how long does the operator have to answer?', want: [T + 'telecom-eca-directive-832-2021-consumer-rights-and-protection', T + 'telecom-eca-consumer-affairs'] },
  { lang: 'en', q: 'What does Proclamation 1148/2019 say about the powers and duties of the Ethiopian Communications Authority?', want: [T + 'telecom-eca-communications-service-proclamation-1148-2019'] },
  { lang: 'en', q: 'Safaricom Ethiopia data package prices in ETB', want: [T + 'telecom-safaricom-packages-data'] },
  { lang: 'en', q: 'Does Ethio telecom support eSIM and how do I activate it?', want: [T + 'telecom-ethiotelecom-esim'] },
  // ---- Amharic
  { lang: 'am', q: 'የኢትዮ ቴሌኮም ወርሃዊ የዳታ ጥቅል ዋጋ ስንት ነው?', want: [T + 'telecom-ethiotelecom-am-mobile-data-package-new', T + 'telecom-ethiotelecom-mobile-data-package-new'] },
  { lang: 'am', q: 'የጠፋ ወይም የተበላሸ ሲም ካርድ እንዴት መቀየር እችላለሁ?', want: [T + 'telecom-ethiotelecom-am-faq', T + 'telecom-ethiotelecom-faq', T + 'telecom-eca-directive-799-2021-sim-card-registration', 'law:stolen-phone-police-report-sim-block'] },
  { lang: 'am', q: 'ኢ-ሲም ምንድነው? እንዴት ማግኘት እችላለሁ?', want: [T + 'telecom-ethiotelecom-am-esim', T + 'telecom-ethiotelecom-esim'] },
  { lang: 'am', q: 'ወደ ሳዑዲ ዓረቢያ ስሄድ የሮሚንግ አገልግሎት እንዴት ነው?', want: [T + 'telecom-ethiotelecom-am-international-roaming', T + 'telecom-ethiotelecom-am-umrah-roaming-package', T + 'telecom-ethiotelecom-am-hajj-roaming', T + 'telecom-ethiotelecom-international-roaming'] },
  { lang: 'am', q: 'የኢትዮ ቴሌኮም የሞባይል ቁጥር አወቃቀር ምንድነው?', want: [T + 'telecom-ethiotelecom-am-faq', T + 'telecom-ethiotelecom-faq', T + 'telecom-eca-directive-795-2021-numbering'] },
  { lang: 'am', q: 'የደንበኞች አገልግሎት እስከ ስንት ሰዓት ድረስ ይሰራል?', want: [T + 'telecom-ethiotelecom-am-faq', T + 'telecom-ethiotelecom-faq'] },
  { lang: 'am', q: 'የቤት ውስጥ ፊክስድ ብሮድባንድ ኢንተርኔት ዋጋ ስንት ነው?', want: [T + 'telecom-ethiotelecom-am-fixed-bb-internet', T + 'telecom-ethiotelecom-fixed-bb-internet'] },
  { lang: 'am', q: 'ለድርጅት የሚሆን የቢዝነስ ኢንተርኔት አገልግሎት ምን አማራጮች አሉ?', want: [T + 'telecom-ethiotelecom-am-fixed-bb-enterprise', T + 'telecom-ethiotelecom-fixed-bb-enterprise', T + 'telecom-safaricom-fixed-service-fiber', T + 'telecom-safaricom-fixed-service-4g-5g-business-internet'] },
  { lang: 'am', q: 'በቴሌኮም አገልግሎት ላይ ቅሬታ ለማቅረብ ወዴት መሄድ አለብኝ?', want: [T + 'telecom-eca-consumer-affairs', T + 'telecom-eca-directive-832-2021-consumer-rights-and-protection', 'law:telecom-consumer-complaint-eca-directive-832-2021', T + 'telecom-eca-directive-796-2021-dispute-resolution'] },
  { lang: 'am', q: 'የማጭበርበር ጥሪ ወይም የሐሰት መልዕክት ሲደርሰኝ ምን ማድረግ አለብኝ?', want: [T + 'telecom-ethiotelecom-am-fraud-awareness', T + 'telecom-ethiotelecom-am-cyberawareness', T + 'telecom-ethiotelecom-fraud-awareness', T + 'telecom-ethiotelecom-am-what-are-frequent-fraud-types'] },
];

(async () => {
  const outArg = process.argv.indexOf('--json');
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY || '', log: () => {} });
  const rows = [];
  try {
    const n = await k.load();
    console.log('index loaded: ' + n + ' chunks; health ' + JSON.stringify((({ chunks, embedded, embeddedLocal, localCoverage }) => ({ chunks, embedded, embeddedLocal, localCoverage }))(k.health())));
    for (const item of Q) {
      const hits = await k.search(item.q, { k: 8 });
      const pages = [];
      for (const h of hits) { const id = h.source + ':' + h.slug; if (!pages.includes(id)) pages.push(id); }
      const rank = pages.findIndex(id => item.want.includes(id)) + 1;
      rows.push({ lang: item.lang, q: item.q, want: item.want, top1: pages[0] || null, rank, top3: rank > 0 && rank <= 3, pages: pages.slice(0, 5) });
      console.log(item.lang + ' rank=' + (rank || '-') + '  top1=' + pages[0] + '  | ' + item.q);
      await new Promise(r => setTimeout(r, 4000));   // one Gemini query embedding per question, paced like every loop here
    }
  } finally { await prisma.$disconnect(); }
  const s = f => rows.filter(f).length;
  console.log('\nfirst: ' + s(r => r.rank === 1) + '/20   top-3: ' + s(r => r.top3) + '/20   in top-8: ' + s(r => r.rank > 0) + '/20'
    + '   (en first ' + s(r => r.lang === 'en' && r.rank === 1) + '/10, top-3 ' + s(r => r.lang === 'en' && r.top3) + '/10;  am first ' + s(r => r.lang === 'am' && r.rank === 1) + '/10, top-3 ' + s(r => r.lang === 'am' && r.top3) + '/10)');
  if (outArg > 0) fs.writeFileSync(process.argv[outArg + 1], JSON.stringify(rows, null, 1));
})().catch(e => { console.error('probe failed:', e.message); process.exit(1); });
