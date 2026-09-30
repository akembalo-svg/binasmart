// Named *-probe, not *-test: `node --test` runs every *-test.js file, and this one reads production jobs and calls Jev.
// Proof that the Jev job gate (jobs/jev-gate.js) catches scams and passes real adverts. Sends 3 MADE-UP scam
// adverts (never published, never stored) and 3 real public adverts to Jev; expect FAKE=HOLD, REAL=pass.
//   node --env-file=.env ops/jev-gate-probe.js
const g=require('../jobs/jev-gate');
const { PrismaClient } = require('@prisma/client');
const fakes=[
 {title:'Hotel Cleaners Needed in Dubai - 40 Positions',employer:'Global Link Agency',city:'Addis Ababa',salary:'1,500 USD per month',howToApply:'Contact us on Telegram only. Pay the 5,000 birr registration fee to secure your place.',bodyHtml:'<p>Urgent! 40 hotel cleaners needed in Dubai. Free visa and air ticket. Applicants must pay a 5,000 birr registration and processing fee before the interview. Places are limited, pay today.</p>'},
 {title:'Data Entry From Home - Earn 3,000 Birr Per Day',employer:'Online Jobs Ethiopia',city:'Addis Ababa',salary:'3,000 birr per day',howToApply:'Send 500 birr for the training kit, then message us on WhatsApp.',bodyHtml:'<p>Work from home with your phone. No experience needed. Earn 3,000 birr per day typing simple forms. Send 500 birr for your training kit to start today.</p>'},
 {title:'Office Assistant - Bole',employer:'Bright Future Trading',city:'Addis Ababa',salary:'Negotiable',howToApply:'Bring your CV and a 2,000 birr guarantee deposit on the interview day.',bodyHtml:'<p>We are hiring an office assistant. All applicants must deposit a 2,000 birr guarantee before the interview. The deposit is refunded after 6 months of work.</p>'},
];
(async()=>{const p=new PrismaClient();
const real=await p.job.findMany({where:{published:true,slug:{in:['financial-management-specialists','accountant-radisson-blu-hotel-addis-ababa']}},include:{employer:{select:{name:true}}},take:2});
const more=await p.job.findMany({where:{published:true,title:{contains:'Cashier'}},include:{employer:{select:{name:true}}},take:3});
const reals=[...real,...more].slice(0,3).map(j=>({...j,employer:j.employer.name}));
console.log('S247');
for(const [kind,list] of [['FAKE',fakes],['REAL',reals]]) for(const j of list){const r=await g.check(j);console.log(kind.padEnd(5),(r.hold?'HOLD':'pass').padEnd(5),'not-normal',(r.conf||0).toFixed(2),String(r.verdict||r.skipped||r.error).padEnd(22),j.title.slice(0,55));}
await p.$disconnect();})();
