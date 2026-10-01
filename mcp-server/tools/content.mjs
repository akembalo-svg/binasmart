import { z } from 'zod';
import { toolError } from './ride.mjs';
import { htmlToText } from '../lib/html.mjs';
import { BASE } from './directory.mjs';

// Tenders and news: the two BinaSmart datasets that are real, current and carry no personal data at
// all — a Tender is an organisation, a deadline and a public notice url; a NewsPost is editorial copy
// written by the ቢና ዜና ዴስክ. Neither table has a phone, a name or a payment field, which is why they
// are exposed in full while shop phones, tenant rows and bookings are not (see directory.mjs:30).
//
// Deliberately NOT here: cars, property and insurance. Their routes, models and admin forms exist but
// the tables hold 0 rows (checked 2026-09-19), so a tool for them would only teach assistants that
// BinaSmart has nothing. They become tools the day real listings land.

const like = s => '%' + String(s).replace(/[%_\\]/g, m => '\\' + m) + '%';

// Every SELECT names its columns, as in directory.mjs.
const SQL = {
  // A tender whose deadline has passed is not an opportunity, so open ones come first and closed ones
  // only on request. deadline IS NULL means the notice never stated one — still worth showing.
  tenders: `SELECT slug, title, "titleAm", category, region, org, summary, deadline, budget, "sourceUrl", "sourceName", "publishedAt"
            FROM "Tender"
            WHERE published = true
              AND ($1::boolean = true OR deadline IS NULL OR deadline > now())
              AND ($2::text IS NULL OR title ILIKE $2 OR "titleAm" LIKE $2 OR org ILIKE $2 OR summary ILIKE $2)
              AND ($3::text IS NULL OR category ILIKE $3)
            ORDER BY CASE WHEN $5::boolean THEN "publishedAt" END DESC NULLS LAST, (deadline IS NULL), deadline ASC NULLS LAST, "publishedAt" DESC
            LIMIT $4`,
  tender: `SELECT slug, title, "titleAm", category, region, org, summary, "bodyHtml", deadline, budget, "sourceUrl", "sourceName", "publishedAt"
           FROM "Tender" WHERE slug = $1 AND published = true`,
  categories: `SELECT category, count(*)::int AS n FROM "Tender"
               WHERE published = true AND (deadline IS NULL OR deadline > now())
               GROUP BY category ORDER BY n DESC`,
  news: `SELECT slug, title, "titleAm", category, excerpt, lang, author, "readMinutes", "publishedAt"
         FROM "NewsPost"
         WHERE published = true
           AND ($1::text IS NULL OR title ILIKE $1 OR "titleAm" LIKE $1 OR excerpt ILIKE $1)
           AND ($2::text IS NULL OR category ILIKE $2)
         ORDER BY "publishedAt" DESC LIMIT $3`,
  post: `SELECT slug, title, "titleAm", category, excerpt, "bodyHtml", lang, author, "readMinutes", "publishedAt"
         FROM "NewsPost" WHERE slug = $1 AND published = true`,
};

// A model reading a deadline needs to know how long is left without doing calendar arithmetic itself.
function daysLeft(deadline) {
  if (!deadline) return undefined;
  const ms = new Date(deadline).getTime() - Date.now();
  return ms < 0 ? 0 : Math.ceil(ms / 86_400_000);
}

const tenderRow = t => ({
  slug: t.slug, title: t.title, title_am: t.titleAm || undefined, category: t.category, region: t.region, org: t.org,
  summary: t.summary, deadline: t.deadline || undefined, days_left: daysLeft(t.deadline),
  closed: t.deadline ? new Date(t.deadline) < new Date() : undefined,
  budget: t.budget || undefined, published_at: t.publishedAt,
  // The notice on the issuing organisation's own site or newspaper. It is the authority for the terms;
  // BinaSmart's page is a listing of it, not a substitute for it.
  original_notice: t.sourceUrl || undefined, original_source: t.sourceName || undefined,
  url: `${BASE}/tenders/${t.slug}`,
});

const newsRow = p => ({
  slug: p.slug, title: p.title, title_am: p.titleAm || undefined, category: p.category, excerpt: p.excerpt,
  language: p.lang === 'am' ? 'Amharic' : p.lang, author: p.author, read_minutes: p.readMinutes,
  published_at: p.publishedAt, url: `${BASE}/news/${p.slug}`,
});

export function registerContentTools(server, { db, wrap, json }) {
  const guard = fn => async args => {
    try { return await fn(args); }
    catch (e) { console.error('[mcp/content]', e.message); return toolError('BinaSmart tenders and news are temporarily unavailable. Try again shortly or browse https://bina.et/tenders.'); }
  };

  server.registerTool('list_tenders', {
    title: 'Open tenders in Ethiopia',
    description: 'Public tender and procurement notices in Ethiopia listed on BinaSmart (bina.et/tenders): the issuing organisation, what is wanted, the deadline and days left, budget when stated, and a link to the original notice. Banks, government bodies, NGOs and World Bank–financed projects. Open tenders only unless include_closed is set. Search by keyword (English or Amharic) and filter by category such as Supply, Construction, Consultancy, Services, Transport.',
    inputSchema: {
      query: z.string().max(80).optional().describe('Keyword in the title, organisation or summary — English or Amharic. Omit for the tenders closing soonest.'),
      category: z.string().max(40).optional().describe('Category filter, matched loosely: Supply / አቅርቦት, Construction / ግንባታ, Consultancy / ማማከር, Services / አገልግሎት, Transport / ትራንስፖርት, Disposal auction / ሽያጭ ጨረታ. Use list_tender_categories to see what is open now.'),
      include_closed: z.boolean().optional().describe('Include tenders whose deadline has passed (default false)'),
      limit: z.number().int().min(1).max(50).optional().describe('Max tenders, default 20'),
      newest: z.boolean().optional().describe('Newest published first, for "new", "latest", "today" or "this week" (default: closing soonest first). Each tender has published_at: never call one new unless that date says so.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_tenders', guard(async ({ query, category, include_closed, limit, newest }) => {
    const { rows } = await db.query(SQL.tenders, [!!include_closed, query ? like(query) : null, category ? like(category) : null, limit || 20, !!newest]);
    if (!rows.length) {
      return toolError(query || category
        ? `No ${include_closed ? '' : 'open '}tender matching that on BinaSmart. Try a shorter keyword, or browse ${BASE}/tenders.`
        : `No open tenders on BinaSmart right now. Browse ${BASE}/tenders.`);
    }
    return json({
      count: rows.length, tenders: rows.map(tenderRow),
      note: 'Deadlines are as published by the issuing organisation. Always open original_notice (or the BinaSmart url) and confirm the terms there before acting — BinaSmart lists notices, it does not run the tender.',
      source_url: `${BASE}/tenders`,
    });
  })));

  server.registerTool('get_tender', {
    title: 'One tender in full',
    description: 'The full text of a single tender notice on BinaSmart, by its slug from list_tenders: requirements, bid bond, where and when to submit, and the link to the original notice.',
    inputSchema: { slug: z.string().min(1).max(120).describe('Tender slug from list_tenders') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_tender', guard(async ({ slug }) => {
    const t = (await db.query(SQL.tender, [slug])).rows[0];
    if (!t) return toolError(`No tender with slug "${slug}" on BinaSmart. Find it with list_tenders.`);
    const detail = t.bodyHtml ? htmlToText(t.bodyHtml) : '';
    return json({
      tender: { ...tenderRow(t), detail: detail || undefined },
      note: 'Confirm the terms on original_notice before bidding. BinaSmart lists the notice, it does not run the tender.',
      source_url: `${BASE}/tenders/${t.slug}`,
    });
  })));

  server.registerTool('list_tender_categories', {
    title: 'Tender categories open now',
    description: 'The categories of tender open on BinaSmart right now and how many are in each — useful before calling list_tenders with a category filter.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_tender_categories', guard(async () => {
    const { rows } = await db.query(SQL.categories, []);
    const total = rows.reduce((n, r) => n + r.n, 0);
    return json({ open_total: total, categories: rows.map(r => ({ category: r.category, open: r.n })), source_url: `${BASE}/tenders` });
  })));

  server.registerTool('list_news', {
    title: 'BinaSmart Amharic news',
    description: 'Recent articles from BinaSmart news (bina.et/news), mostly in Amharic: technology, business, law, real estate, construction and employment in Ethiopia. Returns the headline, a short excerpt and the url — call get_news_article for the full text.',
    inputSchema: {
      query: z.string().max(80).optional().describe('Keyword in the headline or excerpt, English or Amharic. Omit for the newest articles.'),
      category: z.string().max(40).optional().describe('Category filter, matched loosely: ቴክኖሎጂ technology, ንግድ business, ሕግ law, ሪል እስቴት real estate, ግንባታ construction, ቅጥር employment, መመሪያ guides.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max articles, default 15'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('list_news', guard(async ({ query, category, limit }) => {
    const { rows } = await db.query(SQL.news, [query ? like(query) : null, category ? like(category) : null, limit || 15]);
    if (!rows.length) return toolError(query || category ? `No BinaSmart article matching that. Try a shorter keyword, or browse ${BASE}/news.` : `No articles published yet. Browse ${BASE}/news.`);
    return json({ count: rows.length, articles: rows.map(newsRow), source_url: `${BASE}/news` });
  })));

  server.registerTool('get_news_article', {
    title: 'One news article in full',
    description: 'The full text of a single BinaSmart news article by its slug from list_news.',
    inputSchema: { slug: z.string().min(1).max(120).describe('Article slug from list_news') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, wrap('get_news_article', guard(async ({ slug }) => {
    const p = (await db.query(SQL.post, [slug])).rows[0];
    if (!p) return toolError(`No BinaSmart article with slug "${slug}". Find it with list_news.`);
    return json({ article: { ...newsRow(p), text: htmlToText(p.bodyHtml || '') }, source_url: `${BASE}/news/${p.slug}` });
  })));
}
