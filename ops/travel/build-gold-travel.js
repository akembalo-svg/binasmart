#!/usr/bin/env node
'use strict';
// Build the travel retrieval gold set from ops/travel/gold-travel-spec.json.
//
//   node ops/travel/build-gold-travel.js            verify and write /root/storage/bina-embed/eval/gold-travel.json
//   node ops/travel/build-gold-travel.js --check    verify and print the evidence, write nothing
//   node ops/travel/build-gold-travel.js --out <p>  somewhere else
// Then:
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold travel
//
// The rule that makes this a measurement rather than a decoration: a question may not enter the gold file
// unless the page it names is on disk, is live, and actually discusses the question's subject. `topic` is
// the English subject in content words; three of them must be in the page's text. A question aimed at a page
// that never mentions its subject is refused by name, and NOTHING is written - a half-verified gold set is
// worse than none, because the number it produces looks exactly as trustworthy as a real one.
const fs = require('fs');
const path = require('path');
const { PREFER } = require(path.join(__dirname, '..', '..', 'assistant', 'travel'));

const PACK = path.join(__dirname, '..', '..', 'knowledge', 'travel');
const SPEC = path.join(__dirname, 'gold-travel-spec.json');
const OUT = '/root/storage/bina-embed/eval/gold-travel.json';
const MIN_MATCHES = 3;

const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at', 'is', 'are', 'my', 'your', 'i', 'it', 'be', 'do', 'can', 'what', 'how', 'when', 'who', 'with', 'from', 'by', 'not']);
function contentWords(topic) {
  return String(topic || '').toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2 && !STOP.has(w));
}
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');
function readDoc(dir, slug) {
  const f = path.join(dir, slug + '.md');
  if (!fs.existsSync(f)) return null;
  const raw = fs.readFileSync(f, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const meta = {};
  if (fm) for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2]; }
  return { meta, text: fm ? raw.slice(fm[0].length) : raw };
}

// -> { ok: [{ ...q, matched }], bad: [{ qid, slug, why, missing }] }
function verify(questions, dir = PACK) {
  const ok = [], bad = [];
  for (const q of questions) {
    const d = readDoc(dir, q.slug);
    if (!d) { bad.push({ qid: q.qid, slug: q.slug, why: 'no_document' }); continue; }
    if (d.meta.status === 'gone') { bad.push({ qid: q.qid, slug: q.slug, why: 'page_gone' }); continue; }
    const hay = norm(d.text);
    const words = contentWords(q.topic);
    const matched = words.filter(w => hay.includes(w));
    if (matched.length < MIN_MATCHES) {
      bad.push({ qid: q.qid, slug: q.slug, why: 'topic_not_on_page', missing: words.filter(w => !matched.includes(w)) });
      continue;
    }
    ok.push({ ...q, matched, pageLang: d.meta.lang || 'en', title: d.meta.title || q.slug });
  }
  return { ok, bad };
}

function buildGold(questions, dir, out) {
  const { ok, bad } = verify(questions, dir);
  if (bad.length) {
    for (const b of bad) console.error('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    throw new Error(bad.length + ' question(s) could not be verified against the fetched pages; nothing written');
  }
  const gold = {
    _about: 'Ethiopian Airlines travel pack, 60 questions (40 am, 20 en). Built by ops/travel/build-gold-travel.js '
      + 'from ops/travel/gold-travel-spec.json on ' + new Date().toISOString().slice(0, 10)
      + '. Every question was verified against the text of its gold page. Each question carries the prefer list '
      + 'assistant/travel.js passes for a travel message, so the benchmark measures what a user gets.',
    questions: ok.map(q => ({
      qid: q.qid, lang: q.lang, question: q.question, section: q.section,
      agent: 'bini', prefer: PREFER,
      gold_source: 'travel', gold_slug: q.slug,
      gold_pages: [{ source: 'travel', slug: q.slug }],
      grade: 'GOOD',
      crossLingual: q.lang !== q.pageLang,
      strictCrossLingual: q.lang !== q.pageLang,
      topic: q.topic, matched: q.matched, goldTitle: q.title,
    })),
    coverage_gaps: [],
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(gold, null, 1));
  return gold;
}

function main() {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT;
  const spec = JSON.parse(fs.readFileSync(SPEC, 'utf8'));
  if (argv.includes('--check')) {
    const { ok, bad } = verify(spec.questions);
    for (const q of ok) console.log('  ok      ' + q.qid + ' [' + q.lang + '] ' + q.slug + '  matched: ' + q.matched.join(', '));
    for (const b of bad) console.log('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    console.log('\n' + ok.length + ' verified, ' + bad.length + ' refused, of ' + spec.questions.length);
    if (bad.length) process.exit(1);
    return;
  }
  const g = buildGold(spec.questions, PACK, out);
  console.log('wrote ' + out + ': ' + g.questions.length + ' questions ('
    + g.questions.filter(q => q.lang === 'am').length + ' am, ' + g.questions.filter(q => q.lang === 'en').length + ' en), '
    + g.questions.filter(q => q.crossLingual).length + ' cross-lingual');
}

module.exports = { verify, buildGold, contentWords, readDoc, PACK, SPEC, OUT, MIN_MATCHES };
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
