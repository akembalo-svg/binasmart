#!/usr/bin/env node
'use strict';
// Build the v2 retrieval gold set (14 September 2026). v1 stays untouched.
//
// Why: 31 of v1's 48 crawled-web questions were written (by Gemini, from one chunk each, on 9 September)
// from news home and section pages — ena.et/web/amh, ena.et/web/amh/technology, ethiopianreporter.com/business/
// — whose headlines rotate every week. The weekly crawl rewrites those pages, so the question's answer
// leaves the page and the benchmark counts a miss the retriever never made. Two gold pages are gone
// altogether, and for 28 of the 48 the ingest's cross-page de-duplication strips the answer passage.
//
// v2 = v1's 66 own-document questions, copied unchanged + 48 new crawled-web questions (36 Amharic,
// 12 English, the v1 mix). Each new question:
//   - points at a single ARTICLE page (a permalink keyed by an article id or slug), never a home, section,
//     category, writer or listing page — the crawler only ever rewrites a file for the same URL, and an
//     article URL does not change its story;
//   - carries a `passage` (<= 25 words) that must be found in KnowledgeChunk.text for that page TODAY —
//     so a passage the boilerplate stripper removed cannot be used — and must not sit in the page title,
//     so the answer is not guessable from the title alone;
//   - was written by hand (Claude, in the session that built this) from that passage, in the page's
//     language, as a short user-style question, without copying more than a short phrase.
// The spec (questions + passages) lives next to the gold files, not in the repo, like v1.
//
//   node ops/bini/build-gold-v2.js <spec.json> [<out.json>]
//   default out: /root/storage/bina-embed/eval/gold-v2.json

const fs = require('fs');
const path = require('path');

const V1 = '/root/storage/bina-embed/eval/gold.json';
const OUT_DEFAULT = '/root/storage/bina-embed/eval/gold-v2.json';

// Article permalinks only. Anything else (a front page, /business/, /archives/category/…, ?CatId=…) is refused.
const ARTICLE = [
  [/^https:\/\/www\.ena\.et\/web\/amh\/w\/amh_\d+$/, 'ENA article permalink (/w/amh_<id>): one story per id'],
  [/^https:\/\/ethiopianreporter\.com\/\d+\/$/, 'Reporter article by numeric post id, not a section or writer page'],
  [/^https:\/\/www\.ebc\.et\/Home\/NewsDetails\?NewsId=\d+$/, 'EBC single news item by NewsId, not a CategorialNews listing'],
  [/^https:\/\/www\.fanamc\.com\/archives\/\d+$/, 'Fana article by numeric post id, not a category or language front page'],
  [/^https:\/\/nbe\.gov\.et\/(am\/)?nbe_news\/[^/]+\/$/, 'National Bank press release under /nbe_news/<slug>, not the news listing'],
  [/^https:\/\/justice\.gov\.et\/en\/news\/[^/]+\/$/, 'Ministry of Justice news item /en/news/<slug>, not the /newsroom/ listing'],
  [/^https:\/\/www\.motri\.gov\.et\/am\/news\/-+\d+$/, 'Ministry of Trade news item by id, not the /am/news listing'],
  [/^https:\/\/www\.mofed\.gov\.et\/blog\/(?!category\/)[^/]+\/$/, 'Ministry of Finance blog post, not a /blog/category/ listing'],
  [/^https:\/\/investethiopia\.gov\.et\/(crown-packaging|sunselet|official-invitation)[^/]*\/$/, 'EIC company profile / announcement article, a single page, not a sector or listing page'],
];
const stableReason = url => { for (const [re, why] of ARTICLE) if (re.test(url)) return why; return null; };
const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(Boolean);

// Longest run of consecutive words the question shares with the page — a copy check, not a style rule.
function longestSharedRun(question, text) {
  const q = words(question.replace(/[?？።፧፣,]/g, ' ')), t = ' ' + norm(text) + ' ';
  let best = 0;
  for (let i = 0; i < q.length; i++) for (let j = i + best + 1; j <= q.length; j++) {
    if (t.includes(' ' + q.slice(i, j).join(' '))) best = j - i; else break;
  }
  return best;
}

async function main() {
  const [specPath, outPath = OUT_DEFAULT] = process.argv.slice(2);
  if (!specPath) throw new Error('usage: build-gold-v2.js <spec.json> [<out.json>]');
  if (path.resolve(outPath) === path.resolve(V1)) throw new Error('refusing to overwrite v1');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const v1 = JSON.parse(fs.readFileSync(V1, 'utf8'));
  const own = v1.filter(q => q.gold_source !== 'web');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const chunks = await prisma.knowledgeChunk.findMany({ where: { source: { notIn: ['style', 'style-om'] } },
    select: { id: true, source: true, slug: true, url: true, title: true, lang: true, ord: true, text: true } });
  await prisma.$disconnect();

  const problems = [], web = [];
  const seen = new Set();
  spec.forEach((s, i) => {
    const qid = 201 + i;
    const bad = m => problems.push('q' + qid + ' ' + s.slug + ': ' + m);
    if (seen.has(s.slug)) bad('duplicate gold page'); seen.add(s.slug);
    const page = chunks.filter(c => c.source === 'web' && c.slug === s.slug).sort((a, b) => a.ord - b.ord);
    if (!page.length) return bad('page not in the index');
    const url = page[0].url, title = page[0].title;
    const why = stableReason(decodeURI(url));
    if (!why) bad('not an article permalink: ' + url);
    if (page[0].lang !== s.lang) bad('lang ' + s.lang + ' but page is ' + page[0].lang);
    if (s.lang === 'am' && !/[ሀ-፿]/.test(s.question)) bad('Amharic question without Ethiopic');
    if (s.lang === 'en' && /[ሀ-፿]/.test(s.question)) bad('English question in Ethiopic');
    const nw = words(s.passage).length;
    if (nw > 25) bad('passage is ' + nw + ' words');
    if (norm(title).includes(norm(s.passage))) bad('passage is in the title');
    const hit = page.find(c => norm(c.text).includes(norm(s.passage)));
    if (!hit) bad('passage not found in the indexed text of its page');
    const shared = longestSharedRun(s.question, page.map(c => c.text.split(title).join(' ')).join(' '));
    if (shared >= 6) bad('question copies ' + shared + ' consecutive words from the page');
    const answerPages = [...new Set(chunks.filter(c => norm(c.text).includes(norm(s.passage))).map(c => c.slug))];
    web.push({ qid, question: s.question, gold_id: hit ? hit.id : null, gold_slug: s.slug, gold_source: 'web', lang: s.lang,
      title, gold_url: url, passage: s.passage, stable_reason: why, answer_pages_at_build: answerPages, shared_words: shared });
  });

  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const out = [...own, ...web];
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  const count = (list, f) => list.filter(f).length;
  console.log('v2 gold set: ' + out.length + ' questions -> ' + outPath);
  console.log('  own documents (unchanged from v1): ' + own.length);
  console.log('  crawled web: ' + web.length + '  (am ' + count(web, q => q.lang === 'am') + ', en ' + count(web, q => q.lang === 'en') + ')');
  console.log('  all: am ' + count(out, q => q.lang === 'am') + ', en ' + count(out, q => q.lang === 'en'));
  console.log('  passage also on another page: ' + count(web, q => q.answer_pages_at_build.length > 1)
    + '  [' + web.filter(q => q.answer_pages_at_build.length > 1).map(q => q.qid + ':' + q.answer_pages_at_build.length).join(', ') + ']');
  console.log('  longest run of words copied into a question: ' + Math.max(...web.map(q => q.shared_words)));
}

module.exports = { stableReason, longestSharedRun };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
