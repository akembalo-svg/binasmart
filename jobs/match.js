'use strict';
// Matching a CV to the vacancies worth reading.
//
// Deliberately arithmetic, not a model. A score anybody can explain beats a vector nobody can argue
// with: when a person asks "why is this job on my list?", the answer has to be a sentence — "your
// field, your city, three of your skills" — and when the list is wrong we can see which rule did it.
// The embeddings we already run (BGE-M3) would add semantic reach; they can be layered on later
// without changing what this returns.
//
// What the score is built from, in order of how much it should matter:
//   field        the CV's field against the vacancy's category. The strongest single signal.
//   skills       how many of the person's skills appear in the advert.
//   city         same city, because most people cannot move for a job.
//   experience   the advert asking for less than the person has is fine; far more is not.
//   freshness    among equals, the one closing later is the better use of their evening.
//
// A vacancy that fails nothing but matches nothing scores near zero and never reaches a list.
const { CATEGORIES, BY_SLUG } = require('./categories');

const norm = s => String(s || '').toLowerCase();
// Rank, as titles state it. Used only to hold a junior back from a post they cannot get.
const SENIOR = /\b(?:senior|head\s+of|chief|director|deputy|manager|principal|lead|supervisor|coordinator)\b/i;
const YEARS = /(\d+)\s*(?:\+)?\s*(?:years?|yrs?|ዓመት)/i;

// A skill counts when its words appear in the advert - "customer service" matches "customer service
// officer", and a two-word skill needs both words, so "sales" does not match "salesforce admin".
function skillHits(skills, hay) {
  const out = [];
  for (const raw of skills || []) {
    const s = norm(raw).replace(/[^a-z0-9ሀ-፿ ]+/g, ' ').trim();
    if (s.length < 3) continue;
    const words = s.split(/\s+/).filter(w => w.length >= 3);
    if (!words.length) continue;
    if (words.every(w => hay.includes(w))) out.push(raw);
  }
  return out;
}

// The field a CV belongs to. read-cv.js stores a free-text category ("Accounting", "Civil engineering"),
// so it is matched against the same rules the board uses rather than trusted as a slug.
function fieldOf(candidate) {
  const c = norm(candidate.category);
  if (!c) return null;
  if (BY_SLUG.get(c)) return c;
  for (const cat of CATEGORIES) if (cat.re.test(c)) return cat.slug;
  return null;
}

function scoreJob(job, candidate, { now = new Date(), field = null } = {}) {
  const hay = norm([job.title, job.titleAm, job.summary, job.experience, job.education].filter(Boolean).join(' '));
  const reasons = [];
  let score = 0;

  const f = field !== null ? field : fieldOf(candidate);
  if (f && job.category === f) { score += 50; reasons.push('field'); }
  else if (f && job.category) { score -= 10; }

  const hits = skillHits(candidate.skills, hay);
  if (hits.length) { score += Math.min(30, hits.length * 10); reasons.push('skills:' + hits.slice(0, 3).join(', ')); }

  if (candidate.city && job.city && norm(candidate.city) === norm(job.city)) { score += 12; reasons.push('city'); }

  // "5 years required" against someone with 1 is a wasted application; the reverse is fine.
  const want = (YEARS.exec(hay) || [])[1];
  if (want != null && candidate.years != null) {
    const gap = Number(want) - Number(candidate.years);
    if (gap <= 0) { score += 8; reasons.push('experience'); }
    else if (gap >= 3) { score -= 25; }
    else { score -= 5; }
  }

  // Not every advert states its years, but the title almost always states its rank. Sending somebody
  // with one year of work to "Head of Marketing" wastes their application and the employer's morning.
  if (SENIOR.test(job.title || '') && candidate.years != null && candidate.years < 4) score -= 30;

  // Among equals, more days left is the better use of somebody's evening.
  if (job.deadline) {
    const days = Math.ceil((new Date(job.deadline).getTime() - now.getTime()) / 86400000);
    if (days >= 7) score += 5; else if (days <= 1) score -= 5;
  }

  return { score, reasons };
}

// The vacancies worth showing this person. Candidates are few and vacancies are thousands, so the
// field (when known) narrows the query before anything is scored.
async function matchesFor(prisma, candidate, { limit = 12, now = new Date(), openSince, isClosed } = {}) {
  const field = fieldOf(candidate);
  const where = { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] };
  if (field) where.category = field;
  let rows = await prisma.job.findMany({
    where, include: { employer: { select: { name: true, slug: true, logoUrl: true } } },
    orderBy: { publishedAt: 'desc' }, take: field ? 400 : 250,
  });
  // Without a field we cannot narrow, so widen the net rather than return nothing.
  if (field && rows.length < 40) {
    const extra = await prisma.job.findMany({
      where: { published: true, OR: [{ deadline: null }, { deadline: { gte: openSince(now) } }] },
      include: { employer: { select: { name: true, slug: true, logoUrl: true } } },
      orderBy: { publishedAt: 'desc' }, take: 250,
    });
    const seen = new Set(rows.map(r => r.id));
    rows = rows.concat(extra.filter(r => !seen.has(r.id)));
  }
  return rows
    .filter(j => !isClosed(j.deadline, now))
    .map(j => ({ job: j, ...scoreJob(j, candidate, { now, field }) }))
    .filter(m => m.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// The other direction: who should this employer read for this vacancy? Only people who agreed to be
// shown beyond the job they applied for, or who applied to this vacancy themselves.
async function candidatesFor(prisma, job, { limit = 20, now = new Date() } = {}) {
  const pool = await prisma.candidate.findMany({
    where: { OR: [{ shareWider: true }, { jobId: job.id }] },
    orderBy: { createdAt: 'desc' }, take: 500,
  });
  return pool
    .map(c => ({ candidate: c, ...scoreJob(job, c, { now }) }))
    .filter(m => m.score >= 25 || m.candidate.jobId === job.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { scoreJob, matchesFor, candidatesFor, fieldOf, skillHits };
