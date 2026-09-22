'use strict';
// "12 vacancies match your CV."
//
//   GET /jobs/matches/<candidate id>     the vacancies worth this person's evening
//
// Why this page exists. Somebody uploads a CV to apply for one vacancy, gets "received", and leaves.
// That is one application from a person who is looking for work today, on a board holding three and a
// half thousand open vacancies. The moment after they apply is the moment they are still reading, so
// that is where the other twelve belong.
//
// What is on the page, and what is not. Vacancies, and the reason each one is listed. No name, no phone,
// no summary, nothing read out of the CV - the page is addressed to the person but discloses nothing
// about them, so a guessed URL leaks nothing. The one personal thing it implies is the field they work
// in, which is also what they typed into a public form to get here.
//
// Timing. An uploaded CV is read in the background (jobs/read-cv.js), so a person can arrive here a
// second after applying, before the reader has finished. They still typed a field and a city into the
// form, so matching starts from that and improves when the reading lands; the page refreshes itself
// once while a fresh CV is still being read rather than showing an empty list.
const { matchesFor, fieldOf } = require('./match');
const { isClosed, openSince, closesAt } = require('../tenders/deadline');
const { label: catLabel } = require('./categories');

const T = {
  am: {
    title: 'ለእርስዎ የሚስማሙ ክፍት የሥራ ቦታዎች',
    head: n => n + ' ክፍት የሥራ ቦታ ከሲቪዎ ጋር ይስማማል',
    lede: 'ካመለከቱበት በተጨማሪ — በዘርፍዎ፣ በከተማዎና በችሎታዎ መሠረት።',
    reading: 'ሲቪዎን በማንበብ ላይ ነን…',
    readingSub: 'ይህ ገጽ በጥቂት ሰከንድ ውስጥ ራሱን ያድሳል።',
    none: 'አሁን የሚስማማ ክፍት ቦታ አልተገኘም።',
    noneSub: 'አዲስ ማስታወቂያ በየቀኑ ይታከላል — ሁሉንም ክፍት ቦታዎች ይመልከቱ።',
    all: '📋 ሁሉንም ክፍት ቦታዎች ይመልከቱ',
    alert: '🔔 በዚህ ዘርፍ አዲስ ሲወጣ በቴሌግራም ይድረስዎ',
    why: { field: 'ዘርፍዎ', city: 'ከተማዎ', experience: 'የሥራ ልምድዎ', skills: 'ችሎታዎ' },
    deadline: 'እስከ',
    closed: 'ተዘግቷል',
    privacy: 'ይህ ገጽ ስምዎን፣ ስልክዎን ወይም ሲቪዎን አያሳይም።',
  },
  en: {
    title: 'Vacancies that match your CV',
    head: n => n + ' vacanc' + (n === 1 ? 'y' : 'ies') + ' match your CV',
    lede: 'Besides the one you applied for — by your field, your city and your skills.',
    reading: 'We are reading your CV…',
    readingSub: 'This page refreshes itself in a few seconds.',
    none: 'Nothing open matches right now.',
    noneSub: 'New vacancies are added every day — see all of them.',
    all: '📋 See every open vacancy',
    alert: '🔔 Get new ones in this field on Telegram',
    why: { field: 'your field', city: 'your city', experience: 'your experience', skills: 'your skills' },
    deadline: 'until',
    closed: 'closed',
    privacy: 'This page shows no name, phone number or CV.',
  },
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `<style>
main.mx{max-width:680px;margin:0 auto;padding:22px 16px 40px}
.mx h1{font-size:23px;line-height:1.35;margin:0 0 6px}
.mx .lede{color:var(--mut);font-size:14.5px;margin:0 0 18px}
.mx .m{display:block;background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin:0 0 11px}
.mx .m b{display:block;font-size:15.5px;line-height:1.4;margin-bottom:3px}
.mx .who{color:var(--mut);font-size:13.5px}
.mx .why{margin-top:7px;display:flex;gap:6px;flex-wrap:wrap}
.mx .why span{background:#ecfdf5;color:#065f46;border-radius:999px;padding:3px 10px;font-size:12px;font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans Ethiopic',sans-serif}
.mx .dl{color:#8a6a00;font-size:12.5px;margin-top:5px}
.mx .cta{display:block;text-align:center;background:linear-gradient(135deg,#065f46,#059669);color:#fff;border-radius:999px;
  padding:12px 18px;font-weight:800;font-size:14.5px;margin:18px 0 9px}
.mx .cta2{display:block;text-align:center;border:1.5px solid var(--line);border-radius:999px;padding:11px 18px;font-size:14px;color:var(--mut)}
.mx .note{color:var(--mut);font-size:12.5px;margin-top:16px;text-align:center}
.mx .wait{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 16px;text-align:center}
</style>`;

module.exports = function matchRoutes(fastify, { prisma, shell }) {
  fastify.get('/jobs/matches/:id', async (req, reply) => {
    const lang = req.query.lang === 'en' ? 'en' : 'am';
    const t = T[lang];
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'private, no-store');

    const cand = await prisma.candidate.findUnique({
      where: { id: String(req.params.id || '') },
      select: { id: true, city: true, category: true, skills: true, years: true, summary: true, createdAt: true },
    }).catch(() => null);

    const page = body => reply.type('text/html').send(shell({
      title: t.title, desc: '', canonical: 'https://bina.et/jobs',
      extraHead: CSS + '<meta name="robots" content="noindex,nofollow">', active: 'jobs', body,
    }));

    if (!cand) return reply.code(404).type('text/html').send(shell({
      title: t.title, desc: '', canonical: 'https://bina.et/jobs', extraHead: CSS,
      body: `<main class="mx"><div class="wait"><p>${esc(t.none)}</p></div><a class="cta" href="/jobs">${esc(t.all)}</a></main>`,
    }));

    // Still being read, and nothing typed to match on yet. Refresh once rather than show an empty list -
    // but only while the reading could still be running, so a CV that failed to parse never loops.
    const fresh = Date.now() - new Date(cand.createdAt).getTime() < 90000;
    if (fresh && !cand.category && !(cand.skills || []).length) {
      return reply.type('text/html').send(shell({
        title: t.title, desc: '', canonical: 'https://bina.et/jobs',
        extraHead: CSS + '<meta http-equiv="refresh" content="8">', active: 'jobs',
        body: `<main class="mx"><div class="wait"><p><b>${esc(t.reading)}</b></p><p class="lede">${esc(t.readingSub)}</p></div></main>`,
      }));
    }

    const now = new Date();
    const found = await matchesFor(prisma, cand, { limit: 12, now, openSince, isClosed });
    const field = fieldOf(cand);

    const card = m => {
      const j = m.job;
      const title = (j.titleAm || j.title || '').replace(/\s+/g, ' ').trim();
      const why = m.reasons.map(r => {
        if (r === 'field') return t.why.field;
        if (r === 'city') return t.why.city;
        if (r === 'experience') return t.why.experience;
        if (r.startsWith('skills:')) return t.why.skills + ': ' + r.slice(7);
        return null;
      }).filter(Boolean);
      const dl = j.deadline ? `<div class="dl">${esc(t.deadline)} ${new Date(closesAt(j.deadline)).toISOString().slice(0, 10)}</div>` : '';
      return `<a class="m" href="/jobs/${esc(j.slug)}">
        <b>${esc(title)}</b>
        <div class="who">${esc(j.employer.name)}${j.city ? ' · ' + esc(j.city) : ''}</div>
        ${dl}
        <div class="why">${why.map(w => '<span>' + esc(w) + '</span>').join('')}</div></a>`;
    };

    const alertLink = 'https://t.me/bina_smart_bot?start=jobs_' + (field || 'all');
    const body = found.length
      ? `<main class="mx"><h1>${esc(t.head(found.length))}</h1><p class="lede">${esc(t.lede)}</p>
         ${found.map(card).join('')}
         <a class="cta" href="${esc(alertLink)}">${esc(t.alert)}</a>
         <a class="cta2" href="/jobs${field ? '/category/' + field : ''}">${esc(t.all)}</a>
         <p class="note">${esc(t.privacy)}</p></main>`
      : `<main class="mx"><div class="wait"><p><b>${esc(t.none)}</b></p><p class="lede">${esc(t.noneSub)}</p></div>
         <a class="cta" href="${esc(alertLink)}">${esc(t.alert)}</a>
         <a class="cta2" href="/jobs">${esc(t.all)}</a>
         <p class="note">${esc(t.privacy)}</p></main>`;
    return page(body);
  });
};
