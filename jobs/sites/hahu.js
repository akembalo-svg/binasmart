'use strict';
// hahu.jobs — read through the API their own website uses.
//
// Their pages carry no job data at all: the site is a Nuxt app and a job page is a 3.8KB shell. The
// vacancy is fetched in the browser from a public GraphQL endpoint, whose address the app publishes in
// its own page source (window.__NUXT__.config.public.hahu_key). We query the same endpoint, anonymously,
// exactly as any visitor's browser does - and take far less from them than rendering 10,000 pages would.
//
// One page of results per request, paced, and only vacancies they have not marked expired. Nothing here
// touches a login, a token, or anything a visitor could not read.
//
// Note hahu is itself an aggregator: some of its adverts carry a `url` pointing back at ethiojobs. Our
// duplicate rule (employer + title) already folds those into the copy we hold, whichever arrived first.
const ENDPOINT = 'https://graph.aggregator.hahu.jobs/v1/graphql';
const UA = 'BinaSmartBot/1.0 (+https://bina.et/jobs; Ethiopian jobs aggregator; contact https://t.me/Bina_smart)';
const PAGE = 50;
const PACE_MS = 1200;

const QUERY = `query BinaSmartJobs($limit: Int!, $offset: Int!) {
  jobs(limit: $limit, offset: $offset, order_by: {created_at: desc}, where: {expired: {_eq: false}}) {
    id title amharic_title description deadline created_at salary salary_currency application_url
    entity { name logo }
    company { name }
    job_application_city { name }
  }
}`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Their description is employer-written HTML. Keep the structure that carries meaning, drop the rest.
const clean = html => String(html || '')
  .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/\son\w+="[^"]*"/gi, '')
  .replace(/<(?!\/?(p|ul|ol|li|strong|b|em|i|u|br|h[2-6])\b)[^>]*>/gi, '')
  .replace(/\n{3,}/g, '\n\n').trim();
const textOf = html => clean(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function gql(variables) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ query: QUERY, variables }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d || d.errors) return null;
    return d.data && d.data.jobs;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// maxAgeDays is applied here rather than by the caller: the API can order by date, so old adverts are
// never fetched at all.
module.exports = async function fetchHahu({ limit = 0, maxAgeDays = 120, log = console.log } = {}) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await gql({ limit: PAGE, offset });
    if (!rows || !rows.length) break;
    let tooOld = false;
    for (const j of rows) {
      const made = j.created_at ? new Date(j.created_at) : new Date();
      if (made.getTime() < cutoff) { tooOld = true; break; }
      const employer = (j.entity && j.entity.name) || (j.company && j.company.name) || '';
      const title = String(j.title || '').replace(/\s+/g, ' ').trim();
      if (!employer || !title) continue;
      const body = clean(j.description);
      const deadline = j.deadline ? new Date(j.deadline) : null;
      out.push({
        title,
        titleAm: j.amharic_title ? String(j.amharic_title).trim() : null,
        employer: employer.replace(/\s+/g, ' ').trim(),
        website: null,
        employerLogo: (j.entity && j.entity.logo) || null,
        city: (j.job_application_city && j.job_application_city.name) || 'Addis Ababa',
        jobType: null,
        // Their salary is a single number; publishing it without knowing the period would invent terms.
        salary: Number(j.salary) > 0 ? Math.round(Number(j.salary)).toLocaleString('en-US') + ' ' + (j.salary_currency || 'ETB') : null,
        summary: (textOf(j.description).slice(0, 280) || title),
        bodyHtml: body || null,
        howToApply: j.application_url && /^https?:\/\//i.test(j.application_url)
          ? 'Apply online: ' + j.application_url : null,
        deadline: deadline && !isNaN(deadline.getTime()) ? deadline : null,
        publishedAt: made,
        sourceUrl: 'https://hahu.jobs/jobs/' + j.id,
        sourceName: 'HaHu Jobs',
      });
      if (limit && out.length >= limit) return out;
    }
    log('[hahu] read ' + out.length + ' vacancies');
    if (tooOld || rows.length < PAGE) break;
    await sleep(PACE_MS);
  }
  return out;
};

module.exports.ENDPOINT = ENDPOINT;
