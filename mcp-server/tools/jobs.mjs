import { z } from 'zod';
import { toolError } from './ride.mjs';
import { htmlToText } from '../lib/html.mjs';
import { BASE } from './directory.mjs';

// Vacancies and the companies posting them. Like tenders, this dataset is public by nature: a Job row is
// an advert an employer published, and an Employer row is a company. No personal data passes through
// here - the Candidate table (people's CVs) has no tool and must never get one. A public search over
// job seekers is a list of vulnerable people for anyone who asks.
//
// Everything is read-only. Publishing a vacancy from an assistant is a separate question with a
// different answer (see jobs/routes.js POST /api/ops/jobs, owner key): an advert that reaches the board
// without a person approving it is how a jobs board becomes a scam board.

const like = s => '%' + String(s).replace(/[%_\\]/g, m => '\\' + m) + '%';

// A vacancy whose deadline has passed cannot be applied for, so open ones come first and closed ones
// only on request. deadline IS NULL means the advert never stated one - still worth showing.
const SQL = {
  jobs: `SELECT j.slug, j.title, j."titleAm", j.city, j."jobType", j.category, j.summary, j.salary,
                j.experience, j.education, j.vacancies, j.deadline, j."publishedAt",
                j."sourceName", e.name AS employer, e.slug AS employer_slug, e.verified, e."logoUrl"
           FROM "Job" j JOIN "Employer" e ON e.id = j."employerId"
          WHERE j.published = true
            AND ($1::boolean = true OR j.deadline IS NULL OR j.deadline > now())
            AND ($2::text IS NULL OR j.title ILIKE $2 OR j."titleAm" LIKE $2 OR j.summary ILIKE $2 OR e.name ILIKE $2)
            AND ($3::text IS NULL OR j.category = $3)
            AND ($4::text IS NULL OR j.city ILIKE $4)
          ORDER BY (j.deadline IS NULL), j.deadline ASC NULLS LAST, j."publishedAt" DESC
          LIMIT $5`,
  job: `SELECT j.slug, j.title, j."titleAm", j.city, j."jobType", j.category, j.summary, j."bodyHtml",
               j."howToApply", j.salary, j.experience, j.education, j.vacancies, j.deadline, j."publishedAt",
               j."sourceName", e.name AS employer, e.slug AS employer_slug, e.verified, e.about,
               e.website, e.address, e."locationNote", e."logoUrl", e.sector
          FROM "Job" j JOIN "Employer" e ON e.id = j."employerId"
         WHERE j.slug = $1 AND j.published = true`,
  categories: `SELECT category, count(*)::int AS n FROM "Job"
                WHERE published = true AND category IS NOT NULL
                  AND (deadline IS NULL OR deadline > now())
                GROUP BY category ORDER BY n DESC`,
  cities: `SELECT city, count(*)::int AS n FROM "Job"
            WHERE published = true AND (deadline IS NULL OR deadline > now())
            GROUP BY city ORDER BY n DESC LIMIT 15`,
  employer: `SELECT slug, name, "nameAm", sector, city, about, website, address, "locationNote",
                    verified, "logoUrl"
               FROM "Employer" WHERE slug = $1`,
  employerJobs: `SELECT slug, title, "titleAm", city, "jobType", category, deadline, "publishedAt"
                   FROM "Job" WHERE "employerId" = (SELECT id FROM "Employer" WHERE slug = $1)
                    AND published = true
                  ORDER BY (deadline IS NULL), deadline ASC NULLS LAST, "publishedAt" DESC LIMIT 40`,
};

// A model reading a deadline needs to know how long is left without doing calendar arithmetic itself.
function daysLeft(deadline) {
  if (!deadline) return undefined;
  const ms = new Date(deadline).getTime() - Date.now();
  return ms < 0 ? 0 : Math.ceil(ms / 86_400_000);
}

const jobRow = j => ({
  slug: j.slug, title: j.title, title_am: j.titleAm || undefined,
  employer: j.employer, employer_url: `${BASE}/employer/${j.employer_slug}`,
  employer_verified: j.verified || undefined,
  city: j.city, job_type: j.jobType || undefined, field: j.category || undefined,
  summary: j.summary, salary: j.salary || undefined,
  experience: j.experience || undefined, education: j.education || undefined,
  vacancies: j.vacancies || undefined,
  deadline: j.deadline || undefined, days_left: daysLeft(j.deadline),
  closed: j.deadline ? new Date(j.deadline) < new Date() : undefined,
  published_at: j.publishedAt,
  // Named, not linked: the board the advert came from. BinaSmart lists the vacancy; the employer owns it.
  listed_from: j.sourceName || undefined,
  url: `${BASE}/jobs/${j.slug}`,
});

export function registerJobTools(server, { db, wrap, json }) {
  const guard = fn => async args => {
    try { return await fn(args); }
    catch (e) { console.error('[mcp/jobs]', e.message); return toolError('BinaSmart jobs are temporarily unavailable. Try again shortly or browse https://bina.et/jobs.'); }
  };

  server.registerTool('list_jobs', {
    title: 'Job vacancies in Ethiopia',
    description: 'Open job vacancies in Ethiopia listed on BinaSmart (bina.et/jobs): the job title, the company posting it, the city, the deadline and days left, salary and requirements where the advert states them. Thousands of vacancies from Ethiopian job boards and employers, refreshed every morning. Search by keyword in English or Amharic, and filter by field of work (banking, accounting, engineering, it, health, education, sales, ngo, logistics, admin, hospitality, construction, agriculture, legal, security, media) or by city. Open vacancies only unless include_closed is set.',
    inputSchema: {
      query: z.string().max(80).optional().describe('Keyword in the job title, summary or company name — English or Amharic. Omit for the vacancies closing soonest.'),
      field: z.string().max(30).optional().describe('Field of work: banking, accounting, engineering, it, health, education, sales, ngo, logistics, admin, hospitality, construction, agriculture, legal, security, media. Use list_job_fields to see what is open now.'),
      city: z.string().max(40).optional().describe('City, e.g. Addis Ababa, Adama, Hawassa, Bahir Dar, Dire Dawa'),
      include_closed: z.boolean().optional().describe('Include vacancies whose deadline has passed (default false)'),
      limit: z.number().int().min(1).max(50).optional().describe('Max vacancies, default 20'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_jobs', guard(async ({ query, field, city, include_closed, limit }) => {
    const { rows } = await db.query(SQL.jobs, [
      !!include_closed, query ? like(query) : null,
      field ? String(field).toLowerCase().trim() : null,
      city ? like(city) : null, limit || 20,
    ]);
    if (!rows.length) {
      return toolError(query || field || city
        ? `No ${include_closed ? '' : 'open '}vacancy matching that on BinaSmart. Try a shorter keyword or a different field, or browse ${BASE}/jobs.`
        : `No open vacancies on BinaSmart right now. Browse ${BASE}/jobs.`);
    }
    return json({
      count: rows.length, jobs: rows.map(jobRow),
      note: 'Deadlines and requirements are as the employer published them. Open the BinaSmart url and apply through the route shown there — BinaSmart lists vacancies, it does not recruit and never charges a job seeker.',
      source_url: `${BASE}/jobs`,
    });
  })));

  server.registerTool('get_job', {
    title: 'One vacancy in full',
    description: 'The full advert for a single vacancy on BinaSmart, by its slug from list_jobs: the duties and requirements as the employer wrote them, how to apply, and the company behind it with its address when we hold one.',
    inputSchema: { slug: z.string().min(1).max(140).describe('Job slug from list_jobs') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_job', guard(async ({ slug }) => {
    const j = (await db.query(SQL.job, [slug])).rows[0];
    if (!j) return toolError(`No vacancy with slug "${slug}" on BinaSmart. Find it with list_jobs.`);
    const detail = j.bodyHtml ? htmlToText(j.bodyHtml) : '';
    return json({
      job: {
        ...jobRow(j),
        detail: detail || undefined,
        how_to_apply: j.howToApply || undefined,
        employer_profile: {
          name: j.employer, sector: j.sector || undefined, about: j.about || undefined,
          website: j.website || undefined, address: j.address || undefined,
          location_note: j.locationNote || undefined, verified: j.verified || undefined,
          url: `${BASE}/employer/${j.employer_slug}`,
        },
      },
      note: 'Apply through how_to_apply, or through the apply form on the BinaSmart page. Confirm the terms with the employer before travelling or paying anything — a genuine Ethiopian employer does not charge an applicant a fee.',
      source_url: `${BASE}/jobs/${j.slug}`,
    });
  })));

  server.registerTool('list_job_fields', {
    title: 'Fields of work hiring now',
    description: 'The fields of work with open vacancies on BinaSmart right now and how many are in each, plus the cities hiring most — useful before calling list_jobs with a field or city filter.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_job_fields', guard(async () => {
    const [{ rows: fields }, { rows: cities }] = await Promise.all([
      db.query(SQL.categories), db.query(SQL.cities),
    ]);
    if (!fields.length) return toolError(`No open vacancies on BinaSmart right now. Browse ${BASE}/jobs.`);
    return json({
      fields: fields.map(f => ({ field: f.category, open_vacancies: f.n, url: `${BASE}/jobs/category/${f.category}` })),
      cities: cities.map(c => ({ city: c.city, open_vacancies: c.n })),
      source_url: `${BASE}/jobs`,
    });
  })));

  server.registerTool('get_employer', {
    title: 'A company and its vacancies',
    description: 'A company listed on BinaSmart: what it does, its address and location when we hold them, and every vacancy it has posted. By employer slug from list_jobs or get_job.',
    inputSchema: { slug: z.string().min(1).max(120).describe('Employer slug, e.g. from list_jobs employer_url') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_employer', guard(async ({ slug }) => {
    const e = (await db.query(SQL.employer, [slug])).rows[0];
    if (!e) return toolError(`No company with slug "${slug}" on BinaSmart. Find one with list_jobs.`);
    const { rows } = await db.query(SQL.employerJobs, [slug]);
    return json({
      employer: {
        name: e.name, name_am: e.nameAm || undefined, sector: e.sector || undefined, city: e.city,
        about: e.about || undefined, website: e.website || undefined,
        address: e.address || undefined, location_note: e.locationNote || undefined,
        verified: e.verified || undefined, url: `${BASE}/employer/${e.slug}`,
      },
      vacancies: rows.map(j => ({
        slug: j.slug, title: j.title, title_am: j.titleAm || undefined, city: j.city,
        job_type: j.jobType || undefined, field: j.category || undefined,
        deadline: j.deadline || undefined, days_left: daysLeft(j.deadline),
        closed: j.deadline ? new Date(j.deadline) < new Date() : undefined,
        url: `${BASE}/jobs/${j.slug}`,
      })),
      note: 'Addresses are shown only where a person checked them; where none is listed, confirm with the employer before travelling.',
      source_url: `${BASE}/employer/${e.slug}`,
    });
  })));
}
