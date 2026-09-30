import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerContentTools } from '../tools/content.mjs';

const json = d => ({ content: [{ type: 'text', text: JSON.stringify(d) }] });
const wrap = (_n, fn) => fn;
const out = r => JSON.parse(r.content[0].text);

function fakeDb(handler) { return { query: async (sql, params) => ({ rows: handler(sql, params) }) }; }
function tools(db) { const reg = {}; registerContentTools({ registerTool: (n, _d, f) => { reg[n] = f; } }, { db, wrap, json }); return reg; }

const inDays = n => new Date(Date.now() + n * 86_400_000);
const TENDER = {
  slug: 'cbe-atm-supply-2026', title: 'Supply of ATM machines', titleAm: 'የኤቲኤም ማሽኖች አቅርቦት',
  category: 'አቅርቦት Supply', region: 'Addis Ababa', org: 'Commercial Bank Of Ethiopia',
  summary: 'CBE invites sealed bids for the supply of 40 ATM machines.', deadline: inDays(10),
  budget: null, sourceUrl: 'https://example.et/notice/1', sourceName: 'Public tender notice (via Reporter Tenders)',
  publishedAt: new Date('2026-09-19T06:00:00Z'),
};
const POST = {
  slug: 'telebirr-limits-2026', title: 'telebirr raises daily limits', titleAm: 'ቴሌብር ገደብ ጨመረ',
  category: 'ቴክኖሎጂ', excerpt: 'The wallet now allows more per day.', lang: 'am', author: 'ቢና ዜና ዴስክ',
  readMinutes: 3, publishedAt: new Date('2026-09-19T05:00:00Z'),
};

test('list_tenders returns open tenders with days left and both urls', async () => {
  const db = fakeDb(sql => (/FROM "Tender"/.test(sql) ? [TENDER] : []));
  const r = out(await tools(db).list_tenders({}));
  assert.equal(r.count, 1);
  const t = r.tenders[0];
  assert.equal(t.org, 'Commercial Bank Of Ethiopia');
  assert.equal(t.title_am, 'የኤቲኤም ማሽኖች አቅርቦት');
  assert.equal(t.url, 'https://bina.et/tenders/cbe-atm-supply-2026');
  assert.equal(t.original_notice, 'https://example.et/notice/1');
  assert.equal(t.closed, false);
  assert.ok(t.days_left >= 9 && t.days_left <= 10, 'days_left is counted from the deadline');
  assert.equal(t.budget, undefined, 'a null budget is omitted, not sent as null');
});

test('list_tenders hides closed tenders by default and passes include_closed through', async () => {
  let seen;
  const db = fakeDb((sql, params) => { if (/FROM "Tender"/.test(sql)) { seen = params; return [TENDER]; } return []; });
  await tools(db).list_tenders({});
  assert.equal(seen[0], false, 'include_closed defaults to false');
  await tools(db).list_tenders({ include_closed: true });
  assert.equal(seen[0], true);
});

test('list_tenders passes the keyword and category as LIKE parameters', async () => {
  let seen;
  const db = fakeDb((sql, params) => { if (/FROM "Tender"/.test(sql)) { seen = params; return [TENDER]; } return []; });
  await tools(db).list_tenders({ query: 'ATM', category: 'Supply', limit: 5 });
  assert.equal(seen[1], '%ATM%');
  assert.equal(seen[2], '%Supply%');
  assert.equal(seen[3], 5);
});

test('a deadline in the past is reported closed with 0 days left', async () => {
  const db = fakeDb(sql => (/FROM "Tender"/.test(sql) ? [{ ...TENDER, deadline: inDays(-3) }] : []));
  const r = out(await tools(db).list_tenders({ include_closed: true }));
  assert.equal(r.tenders[0].closed, true);
  assert.equal(r.tenders[0].days_left, 0);
});

test('a tender with no deadline is listed without inventing one', async () => {
  const db = fakeDb(sql => (/FROM "Tender"/.test(sql) ? [{ ...TENDER, deadline: null }] : []));
  const r = out(await tools(db).list_tenders({}));
  assert.equal(r.tenders[0].deadline, undefined);
  assert.equal(r.tenders[0].days_left, undefined);
  assert.equal(r.tenders[0].closed, undefined);
});

test('list_tenders says so plainly when nothing matches, instead of an empty list', async () => {
  const r = await tools(fakeDb(() => [])).list_tenders({ query: 'submarines' });
  assert.equal(r.isError, true);
});

test('get_tender turns the notice body into text and keeps the source', async () => {
  const db = fakeDb(sql => (/FROM "Tender" WHERE slug/.test(sql)
    ? [{ ...TENDER, bodyHtml: '<h2>Requirements</h2><ul><li>Bid bond 2%</li></ul><script>x()</script>' }] : []));
  const r = out(await tools(db).get_tender({ slug: 'cbe-atm-supply-2026' }));
  assert.match(r.tender.detail, /## Requirements/);
  assert.match(r.tender.detail, /- Bid bond 2%/);
  assert.doesNotMatch(r.tender.detail, /script|x\(\)/, 'scripts are stripped');
  assert.equal(r.tender.original_source, 'Public tender notice (via Reporter Tenders)');
});

test('get_tender refuses an unknown slug', async () => {
  const r = await tools(fakeDb(() => [])).get_tender({ slug: 'nope' });
  assert.equal(r.isError, true);
});

test('list_tender_categories totals what is open', async () => {
  const db = fakeDb(sql => (/GROUP BY category/.test(sql)
    ? [{ category: 'አቅርቦት Supply', n: 171 }, { category: 'አገልግሎት Services', n: 46 }] : []));
  const r = out(await tools(db).list_tender_categories({}));
  assert.equal(r.open_total, 217);
  assert.equal(r.categories[0].open, 171);
});

test('list_news returns headlines with excerpt, language and url', async () => {
  const db = fakeDb(sql => (/FROM "NewsPost"\s+WHERE/.test(sql) ? [POST] : []));
  const r = out(await tools(db).list_news({}));
  assert.equal(r.count, 1);
  assert.equal(r.articles[0].url, 'https://bina.et/news/telebirr-limits-2026');
  assert.equal(r.articles[0].language, 'Amharic');
  assert.equal(r.articles[0].read_minutes, 3);
});

test('get_news_article returns the body as text, not HTML', async () => {
  const db = fakeDb(sql => (/FROM "NewsPost" WHERE slug/.test(sql)
    ? [{ ...POST, bodyHtml: '<p>ቴሌብር ገደቡን ጨመረ።</p><p>Second line.</p>' }] : []));
  const r = out(await tools(db).get_news_article({ slug: 'telebirr-limits-2026' }));
  assert.match(r.article.text, /ቴሌብር ገደቡን ጨመረ።/);
  assert.match(r.article.text, /Second line\./);
  assert.doesNotMatch(r.article.text, /<p>/);
});

test('get_news_article refuses an unknown slug', async () => {
  const r = await tools(fakeDb(() => [])).get_news_article({ slug: 'nope' });
  assert.equal(r.isError, true);
});

test('a database failure becomes a plain refusal, never a stack trace', async () => {
  const db = { query: async () => { throw new Error('connection refused'); } };
  const r = await tools(db).list_tenders({});
  assert.equal(r.isError, true);
  assert.doesNotMatch(JSON.stringify(r), /connection refused/);
});
