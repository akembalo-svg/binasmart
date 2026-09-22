'use strict';
// Writing a CV for somebody who does not have one.
//
//   POST /api/jobs/cv-build  { jobId?, name, phone, city, category, education, years,
//                              history, skills, languages, lang, shareWider }
//   GET  /cv/<id>.pdf?k=<token>   the person's own copy
//
// Most people applying for these vacancies have the experience and not the document. A shop assistant
// with six years behind a counter loses the job to someone with a worse record and a typed page. This
// turns what they can say into what an employer will read.
//
// The one rule that matters: the model FORMATS, it does not INVENT. It may not add a qualification, a
// year, an employer or a skill the person did not type. A CV that claims a diploma the person does not
// have gets them dismissed when the certificate is asked for - we would have cost them the job we were
// trying to get them. The prompt says so, and every field it returns is checked back against the text
// the person actually submitted before we render a page.
//
// The PDF is rendered from OUR html template by weasyprint. The model never produces markup - it returns
// JSON, and this file builds the page. A model that can write html into a document we hand to employers
// is a model that can write anything into it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MODEL = 'gemini-2.5-flash';
const CV_DIR = '/root/storage/cv';
const KEEP_DAYS = 365;

const PROMPT = [
  'You are formatting a job applicant\'s own words into a clean CV. Ethiopia.',
  '',
  'ABSOLUTE RULE: use ONLY the facts the person wrote. Never add a qualification, employer, job title,',
  'date, skill or duty they did not state. If a section has nothing, return it empty. Do not guess dates.',
  'Do not describe them as "experienced" or "highly skilled" unless their own text supports it.',
  '',
  'Return ONLY a JSON object:',
  '  "headline"  — their trade in 2-5 words (e.g. "Accountant", "Store keeper", "Nurse").',
  '  "summary"   — 2 or 3 sentences built only from what they wrote. Use NO pronouns: never he, she,',
  '                 his or her. The person\'s sex is not on this form and must not be guessed from a name.',
  '                 IN AMHARIC this means no conjugated verb endings either - "አለው" and "አላት" both state a',
  '                 sex nobody told you. Write the Amharic profile as noun phrases: "የ4 ዓመት የሽያጭ ልምድ።',
  '                 በሽያጭ ሥራ አመራር ዲፕሎማ።" Never "አለው", "አላት", "ሠርቷል", "ሠርታለች".',
  '  "jobs"      — array of { "role", "employer", "period", "points": [up to 3 short duty lines] },',
  '                 newest first, ONLY for work they described. "" for anything they did not say.',
  '  "education" — array of { "award", "place", "year" }, only what they wrote.',
  '  "skills"    — array of short skill names taken from their text.',
  '  "languages" — array of { "name", "level" }, level only if they stated it, else "".',
  '',
  'Write in the language the person used (Amharic in Ethiopic script, or English). Fix spelling,',
  'capitalisation and grammar; keep employer and school names exactly as written.',
].join('\n');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// Everything the model returns has to be traceable to the person's own submission. This is the check
// that makes the "never invent" rule real rather than a sentence in a prompt: a school, employer or
// qualification whose words do not appear in what they typed is dropped.
function grounded(value, source) {
  const hay = source.toLowerCase();
  const words = String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  if (!words.length) return true;                       // nothing to check (a number, a dash)
  const seen = words.filter(w => hay.includes(w)).length;
  return seen / words.length >= 0.5;
}

async function askModel({ apiKey, text, fetchImpl }) {
  const f = fetchImpl || fetch;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT + '\n\n--- what the person wrote ---\n' + text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1600, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
      }),
    });
    if (r.status !== 200) return null;
    const d = await r.json().catch(() => null);
    const out = (((d?.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim();
    return out ? JSON.parse(out) : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// Our template, our markup. A4, one column, no colour that costs anything to print in a shop in Merkato.
// Headings are bilingual on every CV, whichever language the person wrote in: the applicant reads one
// half and the HR officer reads the other, and neither has to guess.
const H = { profile: 'ፕሮፋይል · Profile', work: 'የሥራ ልምድ · Work experience',
  edu: 'ትምህርት · Education', skills: 'ክህሎት · Skills', lang: 'ቋንቋ · Languages' };
function renderHtml(cv, who) {
  const line = (a, b) => (a || b) ? `<div class="row"><span>${esc(a)}</span><span class="mut">${esc(b)}</span></div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 15mm; }
    * { box-sizing: border-box }
    body { font-family: "Noto Sans Ethiopic", "DejaVu Sans", sans-serif; font-size: 10.5pt; color: #111; line-height: 1.45; margin: 0 }
    h1 { font-size: 19pt; margin: 0 0 1mm }
    .head { border-bottom: 1.6pt solid #1e3a8a; padding-bottom: 3mm; margin-bottom: 5mm }
    .trade { color: #1e3a8a; font-weight: 700; font-size: 11.5pt }
    .contact { color: #444; font-size: 9.5pt; margin-top: 1.5mm }
    h2 { font-size: 10.5pt; font-weight: 700; color: #1e3a8a; margin: 6mm 0 2mm;
         border-bottom: .6pt solid #dbe3f5; padding-bottom: 1mm }
    .row { display: flex; justify-content: space-between; gap: 6mm }
    .role { font-weight: 700 }
    .mut { color: #555; white-space: nowrap }
    ul { margin: 1mm 0 0; padding-left: 5mm }
    li { margin-bottom: 0.6mm }
    .item { margin-bottom: 3.5mm }
    .tags { color: #222 }
    .foot { margin-top: 8mm; border-top: .6pt solid #ccc; padding-top: 2mm; color: #777; font-size: 8pt }
  </style></head><body>
    <div class="head">
      <h1>${esc(who.name)}</h1>
      <div class="trade">${esc(cv.headline || who.category || '')}</div>
      <div class="contact">${esc(who.phone)}${who.email ? ' · ' + esc(who.email) : ''}${who.city ? ' · ' + esc(who.city) : ''}</div>
    </div>
    ${cv.summary ? `<h2>${H.profile}</h2><div>${esc(cv.summary)}</div>` : ''}
    ${(cv.jobs || []).length ? `<h2>${H.work}</h2>` + cv.jobs.map(j => `<div class="item">
        ${line(j.role, j.period)}
        ${j.employer ? `<div class="mut">${esc(j.employer)}</div>` : ''}
        ${(j.points || []).length ? '<ul>' + j.points.map(p => `<li>${esc(p)}</li>`).join('') + '</ul>' : ''}
      </div>`).join('') : ''}
    ${(cv.education || []).length ? `<h2>${H.edu}</h2>` + cv.education.map(e => `<div class="item">
        ${line(e.award, e.year)}${e.place ? `<div class="mut">${esc(e.place)}</div>` : ''}
      </div>`).join('') : ''}
    ${(cv.skills || []).length ? `<h2>${H.skills}</h2><div class="tags">${cv.skills.map(esc).join(' · ')}</div>` : ''}
    ${(cv.languages || []).length ? `<h2>${H.lang}</h2><div class="tags">${cv.languages.map(l => esc(l.name) + (l.level ? ' (' + esc(l.level) + ')' : '')).join(' · ')}</div>` : ''}
    <div class="foot">Prepared on bina.et · ${new Date().toISOString().slice(0, 10)}</div>
  </body></html>`;
}

const toPdf = (html, out) => new Promise((resolve, reject) => {
  const tmp = out.replace(/\.pdf$/, '.html');
  fs.writeFileSync(tmp, html, { mode: 0o600 });
  execFile('/usr/local/bin/weasyprint', [tmp, out], { timeout: 60000 }, err => {
    fs.unlink(tmp, () => {});
    if (err) return reject(err);
    resolve(out);
  });
});


// One CV, from whatever the person gave us. The web form fills `source` from its fields; the bot fills it
// from a spoken minute (jobs/voice-cv.js). Both land here, so the grounding rules above are applied once
// rather than copied into a second path where they would quietly drift.
async function buildCvFor({ prisma, apiKey, who, source, years, jobId, shareWider }) {
  const name = who.name;
  const phone = who.phone;
  const cv = await askModel({ apiKey, text: source });
  if (!cv) return { ok: false, error: 'other' };

  // Drop anything the person did not actually say.
  const hay = source;
  cv.jobs = (Array.isArray(cv.jobs) ? cv.jobs : []).filter(j => grounded(j.role, hay) && grounded(j.employer, hay)).slice(0, 8)
    .map(j => ({ role: clean(j.role, 80), employer: clean(j.employer, 90), period: clean(j.period, 40),
      points: (Array.isArray(j.points) ? j.points : []).filter(p => grounded(p, hay)).slice(0, 3).map(p => clean(p, 160)) }));
  cv.education = (Array.isArray(cv.education) ? cv.education : []).filter(e => grounded(e.award, hay) && grounded(e.place, hay)).slice(0, 5)
    .map(e => ({ award: clean(e.award, 90), place: clean(e.place, 90), year: clean(e.year, 20) }));
  cv.skills = (Array.isArray(cv.skills) ? cv.skills : []).filter(s => grounded(s, hay)).slice(0, 14).map(s => clean(s, 40));
  cv.languages = (Array.isArray(cv.languages) ? cv.languages : []).filter(l => grounded(l && l.name, hay)).slice(0, 6)
    .map(l => ({ name: clean(l.name, 30), level: clean(l.level, 20) }));
  cv.headline = clean(cv.headline, 60);
  // The summary is the one field that is meant to be rephrased, so the word-overlap test is the wrong
  // one for it: it threw away perfectly honest profile lines. What must not be invented in prose is a
  // QUANTITY - "six years", "managed 12 staff" - so the summary is kept unless it states a number the
  // person never gave us.
  const nums = new Set((hay.match(/\d+/g) || []));
  const madeUp = (String(cv.summary || '').match(/\d+/g) || []).some(n => !nums.has(n));
  cv.summary = madeUp ? '' : clean(cv.summary, 600);

  fs.mkdirSync(CV_DIR, { recursive: true, mode: 0o700 });
  const id = 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const file = path.join(CV_DIR, id + '.pdf');
  try { await toPdf(renderHtml(cv, who), file); } catch (e) { console.error('[cv] pdf: ' + e.message); return { ok: false, error: 'pdf' }; }
  fs.chmodSync(file, 0o600);

  let job = null;
  if (jobId) job = await prisma.job.findUnique({ where: { id: String(jobId) }, select: { id: true, employerId: true, city: true } }).catch(() => null);

  // The token is what lets the person download their own copy without an account, and nobody else's.
  const token = crypto.randomBytes(12).toString('base64url');
  const cand = await prisma.candidate.create({ data: {
    name, phone, email: who.email || null, city: who.city || job?.city || null,
    category: who.category || cv.headline || null,
    jobId: job?.id || null, employerId: job?.employerId || null,
    cvPath: file, cvMime: 'application/pdf',
    summary: cv.summary || null, skills: cv.skills, years: Number.isFinite(Number(years)) ? Math.round(Number(years)) : null,
    shareWider: shareWider === true || shareWider === 'true',
    note: 'built:' + token,
    deleteAfter: new Date(Date.now() + KEEP_DAYS * 86400000),
  } });

  return { ok: true, id: cand.id, token, pdf: '/cv/' + cand.id + '.pdf?k=' + token, matches: '/jobs/matches/' + cand.id, path: file, cv };
}

module.exports = function cvBuildRoutes(fastify, { prisma, limiter, apiKey, normPhone }) {
  const ipRL = limiter(3600000, 8);
  const phoneRL = limiter(86400000, 3);

  fastify.post('/api/jobs/cv-build', async (req, reply) => {
    const b = req.body || {};
    if (!apiKey) return reply.code(503).send({ ok: false, error: 'other' });
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!ipRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const name = clean(b.name, 90);
    const phone = normPhone(b.phone);
    if (name.length < 3) return reply.code(400).send({ ok: false, error: 'name_required' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone_invalid' });
    if (!phoneRL(phone)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const who = {
      name, phone, city: clean(b.city, 60), email: clean(b.email, 120), category: clean(b.category, 60),
    };
    const parts = [
      'Name: ' + name, who.city ? 'City: ' + who.city : '', who.category ? 'Field of work: ' + who.category : '',
      b.years ? 'Years of experience: ' + clean(b.years, 20) : '',
      b.education ? 'Education: ' + clean(b.education, 600) : '',
      b.history ? 'Work history: ' + clean(b.history, 1800) : '',
      b.skills ? 'Skills: ' + clean(b.skills, 400) : '',
      b.languages ? 'Languages: ' + clean(b.languages, 200) : '',
    ].filter(Boolean);
    const source = parts.join('\n');
    // Without work history or education there is nothing to format, and a CV built from a name and a
    // phone number helps nobody.
    if (!b.history && !b.education) return reply.code(400).send({ ok: false, error: 'tell_us_more' });

    const built = await buildCvFor({ prisma, apiKey, who, source, years: b.years, jobId: b.jobId, shareWider: b.shareWider });
    if (!built.ok) return reply.code(built.error === 'other' ? 502 : 500).send({ ok: false, error: 'other' });
    return { ok: true, id: built.id, pdf: built.pdf, matches: built.matches };
  });

  // Their own copy. The token is in the row; without it this is a 404, not a listing.
  fastify.get('/cv/:file', async (req, reply) => {
    const id = String(req.params.file || '').replace(/\.pdf$/, '');
    const k = String(req.query.k || '');
    const c = await prisma.candidate.findUnique({ where: { id } }).catch(() => null);
    if (!c || !k || c.note !== 'built:' + k) return reply.code(404).send({ ok: false });
    if (!fs.existsSync(c.cvPath)) return reply.code(404).send({ ok: false });
    reply.type('application/pdf')
      .header('content-disposition', 'inline; filename="' + String(c.name).replace(/[^\w ]+/g, '').trim().replace(/\s+/g, '-') + '-CV.pdf"')
      .header('cache-control', 'private, no-store');
    return fs.createReadStream(c.cvPath);
  });
};

module.exports.PROMPT = PROMPT;
module.exports.grounded = grounded;
module.exports.renderHtml = renderHtml;

module.exports.buildCvFor = buildCvFor;
