'use strict';
// The owner's desk for CVs — /ops/candidates?key=…
//
// Everything in this file is about people who are looking for work and trusted us with their documents,
// so the rules are stricter than for the rest of the site:
//   · owner key only, on every route, including the file download. No session, no cookie, no guessing.
//   · noindex and no-store. This page must never reach a search engine or a proxy cache.
//   · the list shows what is needed to match a person to a vacancy. It is not a public profile and there
//     is no route that makes one.
//   · "send to employer" records WHO we sent a CV to and when (sentTo, status). A CV that travels with
//     no record is a CV nobody can answer for when the person asks where it went.
//   · a candidate who did not tick the box is marked as such, in red, and cannot be sent to anyone but
//     the employer whose vacancy they applied for.
const fs = require('fs');
const { candidatesFor } = require('./match');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = d => {
  const h = Math.floor((Date.now() - new Date(d).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  return days === 1 ? 'yesterday' : days + ' days ago';
};

module.exports = function opsCandidates(fastify, { prisma, OWNER_KEY }) {
  const guard = (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) {
      reply.code(401).type('text/html').send('<h2>Unauthorized</h2>');
      return false;
    }
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive').header('cache-control', 'private, no-store');
    return true;
  };

  fastify.get('/ops/candidates', async (req, reply) => {
    if (!guard(req, reply)) return;
    const key = String(req.query.key || '');
    const cat = String(req.query.cat || '').trim();
    const q = String(req.query.q || '').trim();

    const where = {};
    if (cat) where.category = { contains: cat, mode: 'insensitive' };
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } },
      { summary: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }];

    // jobId and employerId are plain columns on Candidate, not Prisma relations (the model was kept
    // deliberately loose so a CV survives the vacancy it was sent for being deleted). So the vacancy and
    // the company are looked up in one query each rather than through include.
    const rows = await prisma.candidate.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const jobs = new Map((await prisma.job.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.jobId).filter(Boolean))] } },
      select: { id: true, slug: true, title: true },
    })).map(j => [j.id, j]));
    const emps = new Map((await prisma.employer.findMany({
      where: { id: { in: [...new Set(rows.map(r => r.employerId).filter(Boolean))] } },
      select: { id: true, name: true, slug: true },
    })).map(e => [e.id, e]));
    for (const r of rows) { r.job = r.jobId ? jobs.get(r.jobId) : null; r.employer = r.employerId ? emps.get(r.employerId) : null; }
    const cats = await prisma.candidate.groupBy({ by: ['category'], _count: { category: true }, orderBy: { _count: { category: 'desc' } }, take: 20 });
    const total = await prisma.candidate.count();

    const card = c => `
      <div class="c">
        <div class="hd">
          <div>
            <b>${esc(c.name)}</b>
            <span class="mut">· ${esc(c.city || '—')}${c.category ? ' · ' + esc(c.category) : ''}${c.years != null ? ' · ' + c.years + 'y' : ''}</span>
          </div>
          <span class="mut">${ago(c.createdAt)}</span>
        </div>
        <div><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>${c.email ? ' · ' + esc(c.email) : ''}</div>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : '<p class="mut">CV not read yet.</p>'}
        ${(c.skills || []).length ? `<div class="tags">${c.skills.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
        <div class="mut sm">
          ${c.job ? 'Applied for: ' + esc(c.job.title) + (c.employer ? ' — ' + esc(c.employer.name) : '') : 'No vacancy attached'}
          ${c.shareWider ? '<b class="ok"> · may be sent to other employers</b>' : '<b class="no"> · this employer only</b>'}
          ${(c.sentTo || []).length ? ' · sent to: ' + c.sentTo.map(esc).join(', ') : ''}
        </div>
        <div class="row">
          <a class="btn" href="/ops/candidates/${c.id}/cv?key=${esc(key)}" target="_blank">⬇ CV</a>
          <a class="btn" href="/jobs/matches/${c.id}?lang=en" target="_blank">🔎 matching vacancies</a>
          <input id="to-${c.id}" placeholder="sent to (company)">
          <button class="btn go" onclick="rec('${c.id}')">Record</button>
        </div>
      </div>`;

    reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
      <title>CVs · BinaSmart</title><style>
      body{font-family:system-ui,-apple-system,"Noto Sans Ethiopic",sans-serif;background:#f5f6f8;margin:0;padding:16px;color:#111}
      h1{font-size:19px;margin:0 0 4px} .mut{color:#667} .sm{font-size:12.5px} .ok{color:#047857} .no{color:#b45309}
      .c{background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:13px 15px;margin:10px 0;max-width:720px}
      .hd{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
      p{margin:7px 0;line-height:1.5} .tags span{display:inline-block;background:#eef2ff;color:#25408f;border-radius:999px;padding:3px 10px;font-size:12px;margin:2px 4px 2px 0}
      .row{display:flex;gap:8px;align-items:center;margin-top:9px;flex-wrap:wrap}
      form{display:flex;gap:6px} input,select{border:1px solid #ccd;border-radius:9px;padding:8px 11px;font:inherit}
      .btn{border:1px solid #ccd;background:#fff;border-radius:999px;padding:8px 15px;font-weight:700;font-size:13px;text-decoration:none;color:#111;cursor:pointer}
      .go{background:#1e3a8a;color:#fff;border-color:#1e3a8a}
      .bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;max-width:720px}
      a{color:#1e3a8a}
      </style></head><body>
      <h1>CVs — ${total} in total</h1>
      <div class="mut sm">Owner only. Files never leave this server; each is deleted a year after it arrives.</div>
      <form class="bar" method="get">
        <input type="hidden" name="key" value="${esc(key)}">
        <input name="q" value="${esc(q)}" placeholder="name, phone, city…">
        <select name="cat"><option value="">All fields</option>
          ${cats.filter(c => c.category).map(c => `<option${cat === c.category ? ' selected' : ''}>${esc(c.category)}</option>`).join('')}
        </select>
        <button class="btn go">Filter</button>
      </form>
      ${rows.length ? rows.map(card).join('') : '<p class="mut">No CVs yet.</p>'}
      <script>
      function rec(id){
        var el=document.getElementById('to-'+id), to=(el.value||'').trim();
        if(!to){ el.focus(); return; }
        fetch('/ops/candidates/'+id+'/sent?key=${encodeURIComponent(key)}',{method:'POST',
          headers:{'content-type':'application/json'},body:JSON.stringify({to:to})})
          .then(function(r){ return r.json().catch(function(){return{ok:false};}); })
          .then(function(d){ if(d.ok) location.reload(); else alert(d.error||'not allowed'); })
          .catch(function(){ alert('failed'); });
      }
      </script>
      </body></html>`);
  });

  // The other direction: an employer asks "who have you got for this post?" - jobs/match.js scores every
  // CV we may show against one vacancy, so the answer is a list to read rather than a promise to look.
  // Consent still decides: a CV that did not tick the box appears only for the vacancy it was sent for.
  fastify.get('/ops/job-candidates', async (req, reply) => {
    if (!guard(req, reply)) return;
    const key = String(req.query.key || '');
    const ref = String(req.query.job || '').trim();
    const job = ref ? await prisma.job.findFirst({
      where: { OR: [{ slug: ref }, { id: ref }] },
      include: { employer: { select: { name: true } } },
    }).catch(() => null) : null;

    const found = job ? await candidatesFor(prisma, job, { limit: 30 }) : [];
    const row = m => `<div class="c">
      <div class="hd"><div><b>${esc(m.candidate.name)}</b>
        <span class="mut">· ${esc(m.candidate.city || '—')}${m.candidate.category ? ' · ' + esc(m.candidate.category) : ''}${m.candidate.years != null ? ' · ' + m.candidate.years + 'y' : ''}</span></div>
        <span class="mut">${m.candidate.jobId === job.id ? 'applied for this' : 'score ' + m.score}</span></div>
      ${m.candidate.summary ? `<p>${esc(m.candidate.summary)}</p>` : '<p class="mut">CV not read yet.</p>'}
      <div class="mut sm">${m.reasons.join(' · ') || 'no strong reason'}${m.candidate.shareWider ? '<b class="ok"> · may be sent to other employers</b>' : '<b class="no"> · this employer only</b>'}</div>
      <div class="row"><a class="btn" href="/ops/candidates/${m.candidate.id}/cv?key=${esc(key)}" target="_blank">⬇ CV</a>
        <a class="btn" href="tel:${esc(m.candidate.phone)}">${esc(m.candidate.phone)}</a></div></div>`;

    reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
      <title>Candidates for a vacancy · BinaSmart</title><style>
      body{font-family:system-ui,-apple-system,"Noto Sans Ethiopic",sans-serif;background:#f5f6f8;margin:0;padding:16px;color:#111}
      h1{font-size:19px;margin:0 0 4px} .mut{color:#667} .sm{font-size:12.5px} .ok{color:#047857} .no{color:#b45309}
      .c{background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:13px 15px;margin:10px 0;max-width:720px}
      .hd{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
      p{margin:7px 0;line-height:1.5} .row{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap}
      form{display:flex;gap:6px;margin:12px 0;max-width:720px} input{border:1px solid #ccd;border-radius:9px;padding:8px 11px;font:inherit;flex:1}
      .btn{border:1px solid #ccd;background:#fff;border-radius:999px;padding:8px 15px;font-weight:700;font-size:13px;text-decoration:none;color:#111;cursor:pointer}
      .go{background:#1e3a8a;color:#fff;border-color:#1e3a8a} a{color:#1e3a8a}
      </style></head><body>
      <h1>${job ? 'Candidates for ' + esc(job.title) : 'Candidates for a vacancy'}</h1>
      <div class="mut sm">${job ? esc(job.employer.name) + ' · ' + esc(job.city || '') : 'Paste a vacancy slug (the last part of its bina.et/jobs/… address) or its id.'}</div>
      <form method="get"><input type="hidden" name="key" value="${esc(key)}">
        <input name="job" value="${esc(ref)}" placeholder="vacancy slug or id"><button class="btn go">Find</button></form>
      ${job ? (found.length ? `<div class="mut sm">${found.length} CV${found.length === 1 ? '' : 's'} worth reading</div>` + found.map(row).join('')
                            : '<p class="mut">No CV on file matches this vacancy yet.</p>')
            : ''}
      <p><a href="/ops/candidates?key=${encodeURIComponent(key)}">← all CVs</a></p>
      </body></html>`);
  });

  // The file itself, behind the same key.
  fastify.get('/ops/candidates/:id/cv', async (req, reply) => {
    if (!guard(req, reply)) return;
    const c = await prisma.candidate.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!c || !fs.existsSync(c.cvPath)) return reply.code(404).type('text/html').send('<h2>Not found</h2>');
    const ext = (c.cvPath.match(/\.(\w+)$/) || [])[1] || 'pdf';
    return reply.type(c.cvMime || 'application/pdf')
      .header('content-disposition', 'inline; filename="' + String(c.name).replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-') + '-CV.' + ext + '"')
      .send(fs.createReadStream(c.cvPath));
  });

  // Who it went to, and when. Recorded, not guessed.
  fastify.post('/ops/candidates/:id/sent', async (req, reply) => {
    if (!guard(req, reply)) return;
    const to = String((req.body || {}).to || '').trim().slice(0, 80);
    const c = await prisma.candidate.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (c && c.employerId) c.employer = await prisma.employer.findUnique({ where: { id: c.employerId }, select: { name: true } }).catch(() => null);
    if (!c || !to) return reply.code(400).send({ ok: false, error: 'nothing to record' });
    // The tick box is a limit, not a preference: without it a CV goes to the employer they applied to
    // and nowhere else.
    // Without the tick, the ONLY destination is the employer whose vacancy they applied for. If we do
    // not know that employer, there is no consented destination at all - the answer is no, not "anywhere".
    const ownEmployer = c.employer ? c.employer.name : null;
    if (!c.shareWider && (!ownEmployer || to.toLowerCase() !== String(ownEmployer).toLowerCase())) {
      return reply.code(403).send({ ok: false, error: 'This person did not agree to their CV being sent to other employers.' });
    }
    await prisma.candidate.update({ where: { id: c.id }, data: {
      sentTo: [...new Set([...(c.sentTo || []), to])],
      status: 'sent',
    } });
    return { ok: true };
  });
};
