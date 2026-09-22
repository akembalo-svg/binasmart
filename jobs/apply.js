'use strict';
// Sending a CV through bina.et.
//
//   POST /api/jobs/apply   { jobId?, name, phone, city?, category?, cv (base64), cvMime, shareWider }
//
// Base64 in a JSON body rather than a multipart upload: no new dependency on a live service, and the
// browser already does this for the photo reader. A CV is small; the cap below is generous for a PDF.
//
// Where the file goes, and why it matters more than the code: /root/storage/cv, mode 700, outside the
// web root. A CV holds a person's name, phone, address, education and often their ID number. It is not
// served by nginx, it is not in public/, and it is not in the off-site backup bundle - if that ever
// changes it should be a decision somebody makes on purpose, not a directory that drifted into a tar.
//
// Consent is a column, not a sentence in a policy: shareWider is only true when the person ticked the
// box. Forwarding a CV to an employer they did not choose can cost them the job they currently have.
const fs = require('fs');
const path = require('path');

const CV_DIR = '/root/storage/cv';
const MAX_BYTES = 6 * 1024 * 1024;
const OK_MIME = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
};
// A CV is kept for a year unless the person withdraws it sooner. Long enough to be matched to a vacancy
// that opens next season, short enough that it is not still circulating years later.
const KEEP_DAYS = 365;

// Ethiopian mobile, in the shapes people actually type it.
const normPhone = raw => {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^(\+?251)?9\d{8}$/.test(d.replace(/^\+?251/, '9'))) return '+251' + d.replace(/^\+?251/, '').replace(/^0/, '');
  if (/^09\d{8}$/.test(d)) return '+251' + d.slice(1);
  return null;
};

module.exports = function applyRoutes(fastify, { prisma, limiter, readCv }) {
  const ipRL = limiter(3600000, 12);      // a busy internet café shares one address
  const phoneRL = limiter(86400000, 4);   // four applications a day from one person is plenty

  fastify.post('/api/jobs/apply', { bodyLimit: 9 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!ipRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const name = String(b.name || '').trim().slice(0, 90);
    const phone = normPhone(b.phone);
    if (name.length < 3) return reply.code(400).send({ ok: false, error: 'name_required' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone_invalid' });
    if (!phoneRL(phone)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const mime = String(b.cvMime || '').toLowerCase();
    const ext = OK_MIME[mime];
    if (!ext) return reply.code(415).send({ ok: false, error: 'cv_type' });
    const raw = String(b.cv || '');
    if (raw.length < 200) return reply.code(400).send({ ok: false, error: 'cv_required' });
    let buf;
    try { buf = Buffer.from(raw, 'base64'); } catch (e) { return reply.code(400).send({ ok: false, error: 'cv_unreadable' }); }
    if (!buf.length || buf.length > MAX_BYTES) return reply.code(413).send({ ok: false, error: 'cv_too_large' });

    // The vacancy they applied for, when they came from one. A wrong id is not fatal - the CV is still
    // worth keeping - so it is looked up, not trusted.
    let job = null;
    if (b.jobId) job = await prisma.job.findUnique({ where: { id: String(b.jobId) }, select: { id: true, employerId: true, title: true, city: true } }).catch(() => null);

    fs.mkdirSync(CV_DIR, { recursive: true, mode: 0o700 });
    const id = 'cv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const file = path.join(CV_DIR, id + '.' + ext);
    fs.writeFileSync(file, buf, { mode: 0o600 });

    const cand = await prisma.candidate.create({ data: {
      name, phone, email: String(b.email || '').trim().slice(0, 120) || null,
      city: String(b.city || job?.city || '').trim().slice(0, 60) || null,
      category: String(b.category || '').trim().slice(0, 60) || null,
      jobId: job?.id || null, employerId: job?.employerId || null,
      cvPath: file, cvMime: mime,
      shareWider: b.shareWider === true || b.shareWider === 'true',
      deleteAfter: new Date(Date.now() + KEEP_DAYS * 86400000),
    } });

    // Reading the CV is best-effort and never blocks the person: they have applied either way, and a
    // parser that is down must not turn into "your application failed".
    if (readCv) {
      readCv(buf, mime).then(async info => {
        if (!info) return;
        await prisma.candidate.update({ where: { id: cand.id }, data: {
          summary: info.summary || null,
          skills: Array.isArray(info.skills) ? info.skills.slice(0, 12) : [],
          years: Number.isFinite(info.years) ? info.years : null,
          category: cand.category || info.category || null,
        } }).catch(() => {});
      }).catch(() => {});
    }

    return { ok: true, id: cand.id, matches: '/jobs/matches/' + cand.id };
  });
};

module.exports.CV_DIR = CV_DIR;
module.exports.OK_MIME = OK_MIME;
module.exports.normPhone = normPhone;
module.exports.KEEP_DAYS = KEEP_DAYS;
