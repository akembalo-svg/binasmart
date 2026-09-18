#!/usr/bin/env node
'use strict';
// The channel watch's eval (design §5.11). Every subject is scored TWICE:
//
//   with a recency marker    the answer may be the watch item
//   with the marker removed  the answer must be the CURATED document, and no watch page may appear at all
//
// A build that passes the first and fails the second has made Bini prefer gossip to law, and must not ship.
// That is the whole reason this file exists, so the second half is the one that sets the exit code.
//
//   node ops/watch/channels/eval.js --check                 verify the set itself; no index, no network
//   node --env-file=.env ops/watch/channels/eval.js         score both halves against the live index
//
// It does not fit ops/packs/build-gold.js, which verifies one pack's pages against one pack's directory: a
// question here names a page in `law` and expects a page in `watch`, and is asked in two forms. The discipline
// is borrowed rather than the code — a question may not be scored unless its curated page is on disk, is live,
// and actually discusses the subject, and those checks are build-gold's own functions.

const fs = require('fs');
const path = require('path');
const { contentWords, contentWordsAm, readDoc } = require('../../packs/build-gold');
const { hasRecencyMarker } = require('./recency');
const { foldEthiopic } = require('../../../assistant/lang.js');

const ROOT = path.join(__dirname, '..', '..', '..');
const GOLD = path.join(__dirname, 'gold.json');
const MIN_MATCHES = 2;
const K = 6;
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');

function readGold(file = GOLD) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// ---------- half one: the set itself, with no index at all ----------
// Two failures this catches and nothing else does: a "recent" question that carries no marker (so it would
// silently score the plain half twice), and a "plain" question that carries one (so the law would never be
// asked for). Both are easy to write by accident in a second language.
function checkGold(gold, { root = ROOT } = {}) {
  const bad = [], ok = [];
  for (const q of gold.questions || []) {
    const why = [];
    if (!hasRecencyMarker(q.recent)) why.push('the recent form carries no recency marker');
    if (hasRecencyMarker(q.plain)) why.push('the plain form carries a recency marker, so it would never reach the law');
    const [source, slug] = String(q.curated || '').split('/');
    const d = source && slug ? readDoc(path.join(root, 'knowledge', source), slug) : null;
    if (!d) why.push('no curated document at knowledge/' + q.curated + '.md');
    else {
      if (d.meta.status && d.meta.status !== 'live') why.push('the curated document is ' + d.meta.status);
      const am = (d.meta.lang || 'en') === 'am';
      const words = am ? contentWordsAm(q.topicAm || q.topic) : contentWords(q.topic || q.topicAm);
      const hay = am ? foldEthiopic(norm(d.text + ' ' + (d.meta.title || ''))) : norm(d.text + ' ' + (d.meta.title || ''));
      const matched = words.filter(w => hay.includes(am ? foldEthiopic(w) : w));
      if (!words.length) why.push('no topic to verify against');
      else if (matched.length < MIN_MATCHES) why.push('the curated page does not discuss "' + (q.topicAm || q.topic)
        + '" (' + matched.length + ' of ' + words.length + ' words)');
    }
    if (why.length) bad.push({ qid: q.qid, why }); else ok.push(q);
  }
  return { ok, bad };
}

// ---------- half two: the two scores, against a real index ----------
// `search` is injected, so this scores the production retrieval and never a copy of it.
async function score(gold, { search, contextSearchOptions, k = K, log = () => {} } = {}) {
  const rows = [];
  for (const q of gold.questions || []) {
    const [, slug] = String(q.curated).split('/');
    const source = String(q.curated).split('/')[0];
    const plainHits = await search(q.plain, contextSearchOptions({ message: q.plain, k }));
    const recentHits = await search(q.recent, contextSearchOptions({ message: q.recent, k }));
    const row = {
      qid: q.qid, lang: q.lang, office: q.office,
      plain: {
        curatedAt: plainHits.findIndex(h => h.source === source && h.slug === slug) + 1,   // 0 = not in the top k
        watchPages: plainHits.filter(h => h.source === 'watch').map(h => h.slug),
        top: plainHits.length ? plainHits[0].source + '/' + plainHits[0].slug : '',
      },
      recent: {
        watchAt: recentHits.findIndex(h => h.source === 'watch') + 1,
        watchForOffice: recentHits.some(h => h.source === 'watch' && String(h.slug).includes('-' + q.office + '-')),
        top: recentHits.length ? recentHits[0].source + '/' + recentHits[0].slug : '',
      },
    };
    rows.push(row);
    log('  ' + q.qid + ' [' + q.lang + '] plain: ' + (row.plain.curatedAt ? 'curated at ' + row.plain.curatedAt : 'CURATED MISSING')
      + (row.plain.watchPages.length ? '  WATCH LEAKED: ' + row.plain.watchPages.join(', ') : '')
      + '   recent: ' + (row.recent.watchAt ? 'watch at ' + row.recent.watchAt : 'no watch page yet'));
  }
  const n = rows.length || 1;
  const leaked = rows.filter(r => r.plain.watchPages.length);
  return {
    questions: rows.length,
    plainPageAtK: rows.filter(r => r.plain.curatedAt > 0).length / n,
    plainLeaks: leaked.map(r => ({ qid: r.qid, pages: r.plain.watchPages })),
    recentWatchAtK: rows.filter(r => r.recent.watchAt > 0).length / n,
    recentForOffice: rows.filter(r => r.recent.watchForOffice).length / n,
    rows,
  };
}

// The verdict. The plain half sets it: a watch page in a "what is the rule" answer fails the build outright,
// and the curated page has to be found for at least plainFloor of the questions. The recent half is REPORTED
// and does not fail anything until there are watch documents to find — on the day this ships, knowledge/watch
// is empty by design, and a floor on an empty directory would only teach us to ignore a red build.
function verdict(result, gold) {
  const floor = typeof gold.plainFloor === 'number' ? gold.plainFloor : 0.6;
  const fails = [];
  if (result.plainLeaks.length) fails.push(result.plainLeaks.length + ' plain question(s) returned a watch page: '
    + result.plainLeaks.map(l => l.qid + ' (' + l.pages.join(', ') + ')').join('; '));
  if (result.plainPageAtK < floor) fails.push('the curated page was found for only '
    + Math.round(result.plainPageAtK * 100) + '% of the plain questions, under the ' + Math.round(floor * 100) + '% floor');
  return { ok: !fails.length, fails };
}

module.exports = { readGold, checkGold, score, verdict, GOLD, K, MIN_MATCHES };

async function main() {
  const argv = process.argv.slice(2);
  const gold = readGold(argv.includes('--gold') ? argv[argv.indexOf('--gold') + 1] : GOLD);
  const { ok, bad } = checkGold(gold);
  console.log('[watch-eval] ' + gold.questions.length + ' subject(s), ' + gold.questions.length * 2 + ' questions ('
    + gold.questions.filter(q => q.lang === 'am').length + ' Amharic, ' + gold.questions.filter(q => q.lang === 'en').length + ' English)');
  for (const b of bad) console.log('  ! ' + b.qid + ': ' + b.why.join('; '));
  if (bad.length) { console.log('[watch-eval] ' + bad.length + ' question(s) refused — fix the set before it is scored'); process.exit(1); }
  console.log('[watch-eval] every curated page is on disk, live, and discusses its subject; every marker reads the way it must');
  if (argv.includes('--check')) return;

  const { PrismaClient } = require('@prisma/client');
  const { makeKnowledge, contextSearchOptions } = require(path.join(ROOT, 'knowledge'));
  const prisma = new PrismaClient();
  const k = makeKnowledge({ prisma, apiKey: process.env.GEMINI_API_KEY });
  const r = await score({ questions: ok }, { search: (q, o) => k.search(q, o), contextSearchOptions, log: m => console.log(m) });
  const v = verdict(r, gold);
  console.log('[watch-eval] plain half: curated page in the top ' + K + ' for ' + Math.round(r.plainPageAtK * 100) + '% of questions, '
    + r.plainLeaks.length + ' watch page(s) leaked');
  console.log('[watch-eval] recent half: a watch page in the top ' + K + ' for ' + Math.round(r.recentWatchAtK * 100) + '% of questions ('
    + Math.round(r.recentForOffice * 100) + '% for the office asked about)');
  await prisma.$disconnect();
  if (!v.ok) { for (const f of v.fails) console.log('[watch-eval] FAIL: ' + f); process.exit(1); }
  console.log('[watch-eval] the law still answers what the rule is');
}

if (require.main === module) main().catch(e => { console.error('[watch-eval] ' + e.message); process.exit(1); });
