'use strict';
// A vacancy somebody wants published — collected here, published only by a person.
//
//   POST /api/jobs/submit                      { employerName, title, city?, summary?, ... }
//   GET  /ops/job-submissions?key=…            the queue
//   GET  /ops/job-submissions/:id/:action?t=…  one tap from the Telegram message
//
// The owner asked (2026-09-22) whether Bini could accept a vacancy in chat and publish it if it looks
// real. It can accept; it must not publish. Three reasons, and they are the design:
//
//   1. Job scams are the commonest fraud against Ethiopian workers - a vacancy that does not exist, a
//      "registration fee", and silence. A board that publishes what it is told becomes the delivery
//      route, on our domain, with our name on it.
//   2. We now hold real people's CVs. A fake employer with a published vacancy is a CV harvester.
//   3. No model can tell "real" from "well-written". Neither can a rule list. Both can spot the SIGNS,
//      and that is what `checks` carries to the reviewer - reasons, not a verdict.
//
// Note on auto-publishing for known employers: matching a submitted name against a company already on
// the board is not authentication - anyone can type "Awash Bank". Until an employer can prove who they
// are, every submission is reviewed. Said plainly here so it is not "simplified" later.
const crypto = require('crypto');

const KEEP_DAYS = 90;

// Signs of the fraud this queue exists to stop. None of these reject anything on their own - they are
// what the reviewer is shown, in the reviewer's own language.
const SIGNS = [
  [/(registration|application|processing|service)\s*(fee|payment|charge)|ክፍያ\s*(ይከፍሉ|ያስፈልጋል)|የምዝገባ\s*ክፍያ/i,
    'asks the applicant to pay a fee — the commonest sign of a job scam'],
  [/\b(western union|moneygram|telebirr\s*(to|ወደ)|cbe\s*account|send\s*money|deposit)\b/i,
    'asks for money to be sent to an account'],
  [/\b(no experience needed|earn \$?\d{3,}|work from home).{0,40}\b(daily|weekly|guaranteed)\b/i,
    'promises unusually easy money'],
  [/\b(whatsapp|telegram|viber)\s*[:+]?\s*(\+?251|0)\d{8,}/i,
    'applications go to a personal mobile number, not a company address'],
  [/@(gmail|yahoo|hotmail|outlook)\./i,
    'applications go to a personal email, not a company one'],
];

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function runChecks(body, employerKnown) {
  const hay = [body.title, body.summary, body.bodyHtml, body.howToApply].filter(Boolean).join(' \n ');
  const found = SIGNS.filter(([re]) => re.test(hay)).map(([, why]) => why);
  if (!employerKnown) found.push('we have never listed this company before');
  return found;
}

// The shared sendTg() in server.js posts plain text; this message needs links and bold, so it sends its
// own request rather than changing a helper a dozen other features depend on.
// Sent by @bina_smart_bot (BINA_RIDER_BOT_TOKEN) to the admin chats. Not BINASMART_TG_TOKEN: that is the old
// @gccandconectbot, which the owner never started - getChat on 26 Sep 2026 said "chat not found" for both chats,
// so every alert sent with it was lost. The sending bot and the chat must belong together.
async function tellOwner(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN;
  const chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
      ok = (await r.json()).ok === true || ok;
    } catch (e) { /* the other chat may still get it */ }
  }
  return ok;
}

module.exports = function submitRoutes(fastify, { prisma, limiter, OWNER_KEY }) {
  const ipRL = limiter(3600000, 10);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  fastify.post('/api/jobs/submit', { bodyLimit: 256 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!ipRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const employerName = clean(b.employerName || b.employer, 120);
    const title = clean(b.title, 140);
    if (employerName.length < 2) return reply.code(400).send({ ok: false, error: 'employer_required' });
    if (title.length < 2) return reply.code(400).send({ ok: false, error: 'title_required' });

    const { normName } = require('./publish');
    const all = await prisma.employer.findMany({ select: { id: true, name: true } });
    const known = all.find(e => normName(e.name) === normName(employerName)) || null;

    const checks = runChecks(b, !!known);
    const deadline = b.deadline ? new Date(b.deadline) : null;
    const sub = await prisma.jobSubmission.create({ data: {
      source: clean(b.source, 20) || 'bini',
      submitter: clean(b.submitter, 90) || null,
      submitterRef: clean(b.submitterRef, 90) || ip || null,
      employerName, title,
      titleAm: clean(b.titleAm, 140) || null,
      city: clean(b.city, 60) || null,
      jobType: clean(b.jobType, 20) || null,
      salary: clean(b.salary, 60) || null,
      summary: clean(b.summary, 600) || null,
      bodyHtml: clean(b.bodyHtml, 12000) || null,
      howToApply: clean(b.howToApply, 700) || null,
      deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
      checks: checks.length ? checks.join(' · ') : null,
      token: crypto.randomBytes(16).toString('base64url'),
    } });

    // The owner decides. The message carries the reasons, not a recommendation.
    const base = 'https://bina.et/ops/job-submissions/' + sub.id;
    const lines = [
      '📥 <b>New vacancy submitted</b>',
      '',
      '<b>' + esc(sub.title) + '</b>',
      esc(sub.employerName) + (sub.city ? ' · ' + esc(sub.city) : '') + (known ? ' · already on the board' : ''),
      sub.deadline ? 'Deadline: ' + sub.deadline.toISOString().slice(0, 10) : '',
      sub.howToApply ? '\nApply: ' + esc(sub.howToApply).slice(0, 200) : '',
      sub.submitter ? '\nFrom: ' + esc(sub.submitter) : '',
      checks.length ? '\n⚠️ ' + checks.map(esc).join('\n⚠️ ') : '\n✅ nothing unusual found',
      '',
      '<a href="' + base + '/publish?t=' + sub.token + '">✅ PUBLISH</a>   ·   '
        + '<a href="' + base + '/reject?t=' + sub.token + '">❌ REJECT</a>',
    ].filter(Boolean).join('\n');
    tellOwner(lines).catch(() => {});

    return { ok: true, id: sub.id, status: 'pending',
      message: 'Thank you. The vacancy has been sent to BinaSmart for checking and will be published once a person has reviewed it.' };
  });

  // One tap from the Telegram message. The token is the authority; it is single-use in effect, because
  // after the first tap the submission is no longer pending.
  fastify.get('/ops/job-submissions/:id/:action', async (req, reply) => {
    const { id, action } = req.params;
    const t = String(req.query.t || '');
    const page = (title, body) => reply.type('text/html').header('cache-control', 'no-store').send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <meta name="robots" content="noindex"><title>${esc(title)}</title>
       <body style="font-family:system-ui,-apple-system,'Noto Sans Ethiopic',sans-serif;background:#f5f6f8;margin:0;padding:28px;color:#111">
       <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e6ec;border-radius:16px;padding:22px">
       <h2 style="margin:0 0 10px;font-size:19px">${esc(title)}</h2>${body}</div></body>`);

    const sub = await prisma.jobSubmission.findUnique({ where: { id: String(id) } }).catch(() => null);
    if (!sub || !t || sub.token !== t) return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    if (sub.status !== 'pending') {
      return page('Already ' + sub.status, '<p>This vacancy was ' + esc(sub.status)
        + (sub.reviewedAt ? ' on ' + sub.reviewedAt.toISOString().slice(0, 16).replace('T', ' ') : '') + '.</p>');
    }

    if (action === 'reject') {
      await prisma.jobSubmission.update({ where: { id: sub.id }, data: { status: 'rejected', reviewedAt: new Date() } });
      return page('❌ Rejected', '<p><b>' + esc(sub.title) + '</b> — ' + esc(sub.employerName)
        + '</p><p>It was not published and will not appear on the board.</p>');
    }
    if (action !== 'publish') return reply.code(404).type('text/html').send('<h2>Not found</h2>');

    const { findOrCreateEmployer, uniqueJobSlug } = require('./publish')({ prisma });
    const { cleanCity } = require('./publish');
    const city = cleanCity(sub.city || 'Addis Ababa');
    const emp = await findOrCreateEmployer(sub.employerName, { city });
    const job = await prisma.job.create({ data: {
      slug: await uniqueJobSlug(sub.title + '-' + sub.employerName),
      title: sub.title, titleAm: sub.titleAm, employerId: emp.id, city,
      jobType: sub.jobType, salary: sub.salary,
      category: require('./categories').categorise(sub.title, sub.summary),
      summary: sub.summary || sub.title,
      bodyHtml: sub.bodyHtml, howToApply: sub.howToApply, deadline: sub.deadline,
      publishedAt: new Date(), sourceName: 'Employer notice',
    } });
    await prisma.jobSubmission.update({ where: { id: sub.id }, data: { status: 'published', reviewedAt: new Date(), jobId: job.id } });
    return page('✅ Published', '<p><b>' + esc(job.title) + '</b> — ' + esc(sub.employerName) + '</p>'
      + '<p><a href="https://bina.et/jobs/' + esc(job.slug) + '" style="font-weight:700">Open the vacancy →</a></p>');
  });

  // The queue, for reviewing without Telegram.
  fastify.get('/ops/job-submissions', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) {
      return reply.code(401).type('text/html').send('<h2>Unauthorized</h2>');
    }
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'private, no-store');
    const rows = await prisma.jobSubmission.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const card = s => `<div style="background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:13px 15px;margin:10px 0">
      <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(s.title)}</b>
        <span style="color:#667;font-size:12.5px">${s.status}</span></div>
      <div style="color:#667">${esc(s.employerName)}${s.city ? ' · ' + esc(s.city) : ''}</div>
      ${s.summary ? `<p style="margin:7px 0;line-height:1.5">${esc(s.summary)}</p>` : ''}
      ${s.checks ? `<div style="color:#b45309;font-size:13px">⚠️ ${esc(s.checks)}</div>` : '<div style="color:#047857;font-size:13px">✅ nothing unusual found</div>'}
      ${s.status === 'pending' ? `<div style="margin-top:10px;display:flex;gap:8px">
        <a href="/ops/job-submissions/${s.id}/publish?t=${esc(s.token)}" style="background:#1e3a8a;color:#fff;border-radius:999px;padding:8px 16px;font-weight:700;text-decoration:none">✅ Publish</a>
        <a href="/ops/job-submissions/${s.id}/reject?t=${esc(s.token)}" style="border:1px solid #ccd;border-radius:999px;padding:8px 16px;font-weight:700;text-decoration:none;color:#111">❌ Reject</a></div>` : ''}
    </div>`;
    reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="robots" content="noindex"><title>Submitted vacancies</title>
      <body style="font-family:system-ui,-apple-system,'Noto Sans Ethiopic',sans-serif;background:#f5f6f8;margin:0;padding:16px;color:#111">
      <h1 style="font-size:19px;margin:0 0 4px">Submitted vacancies</h1>
      <div style="color:#667;font-size:13px">${rows.filter(r => r.status === 'pending').length} waiting for you</div>
      <div style="max-width:720px">${rows.map(card).join('') || '<p style="color:#667">Nothing submitted yet.</p>'}</div></body>`);
  });
};

module.exports.SIGNS = SIGNS;
module.exports.runChecks = runChecks;
module.exports.KEEP_DAYS = KEEP_DAYS;
