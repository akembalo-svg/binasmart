// Vacancies the Jev gate held back (jobs/jev-gate.js). The owner decides; this only carries out his answer.
//   node --env-file=.env ops/jobs-held.js                 list what is waiting
//   node --env-file=.env ops/jobs-held.js publish <slug>  put it on the board
//   node --env-file=.env ops/jobs-held.js reject <slug>   keep it off (the row stays, unpublished)
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const FILE = process.env.BINA_JOBS_HELD || '/root/storage/jev/jobs-held.json';
const [action, slug] = process.argv.slice(2);
(async () => {
  let list = []; try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* none yet */ }
  if (!action) {
    const waiting = list.filter(x => x.status === 'held');
    console.log(waiting.length + ' held' + (waiting.length ? ':' : ''));
    for (const x of waiting) console.log('  ' + Math.round(x.conf * 100) + '% ' + x.verdict + ' · ' + x.title + ' - ' + x.employer + ' · ' + x.slug + ' · ' + (x.sourceUrl || ''));
    return;
  }
  if (!['publish', 'reject'].includes(action) || !slug) throw new Error('usage: ops/jobs-held.js [publish|reject <slug>]');
  const item = list.find(x => x.slug === slug && x.status === 'held');
  if (!item) throw new Error('not in the held list: ' + slug);
  const prisma = new PrismaClient();
  try {
    if (action === 'publish') await prisma.job.update({ where: { slug }, data: { published: true } });
    item.status = action === 'publish' ? 'published' : 'rejected'; item.decidedAt = new Date().toISOString();
    fs.writeFileSync(FILE, JSON.stringify(list, null, 1));
    console.log(item.status + ': ' + item.title + (action === 'publish' ? '  https://bina.et/jobs/' + slug : ''));
  } finally { await prisma.$disconnect(); }
})().catch(e => { console.error('[jobs-held] ' + e.message); process.exit(1); });
