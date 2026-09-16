#!/usr/bin/env node
'use strict';
// Build a pack's retrieval gold set from knowledge/<pack>/gold-spec.json.
//
//   node ops/packs/build-gold.js --pack banking            verify and write /root/storage/bina-embed/eval/gold-banking.json
//   node ops/packs/build-gold.js --pack banking --check    verify and print the evidence, write nothing
//   node ops/packs/build-gold.js --pack banking --out <p>  somewhere else
// Then:
//   node --env-file=.env ops/bini/rerun-retrieval-benchmark.js --gold banking
//
// The rule that makes this a measurement rather than a decoration: a question may not enter the gold file
// unless the page it names is on disk, is live, and actually discusses the question's subject. `topic` is the
// English subject in content words; three of them must be in the page's text. A question aimed at a page that
// never mentions its subject is refused by name, and NOTHING is written — a half-verified gold set is worse
// than none, because the number it produces looks exactly as trustworthy as a real one.
//
// Written for the airline pack first (ops/travel/build-gold-travel.js, which now calls this), generalised
// when the banking pack needed the same thing.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GOLD_DIR = '/root/storage/bina-embed/eval';
const MIN_MATCHES = 3;

const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'and', 'or', 'to', 'in', 'on', 'at', 'is', 'are', 'my', 'your', 'i', 'it', 'be', 'do', 'can', 'what', 'how', 'when', 'who', 'with', 'from', 'by', 'not']);
function contentWords(topic) {
  return String(topic || '').toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2 && !STOP.has(w));
}
// The banking pack has something the travel pack did not: gold pages that are themselves in Amharic, because
// Zemen publishes a real Amharic locale. An English topic can never be found in an Amharic page, so such a
// question carries `topicAm` and is verified against the page in Amharic instead — folded, the same way
// knowledge/index.js folds, so ሀ/ሐ/ኀ and ሰ/ሠ and አ/ዐ and ጸ/ፀ do not cause a false refusal.
const { foldEthiopic } = require(path.join(ROOT, 'assistant', 'lang.js'));
function contentWordsAm(topic) {
  return String(topic || '').split(/[\s፣።,፤]+/).map(w => w.trim()).filter(w => w.length >= 2 && /[ሀ-፿]/.test(w)).map(foldEthiopic);
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
function verify(questions, dir) {
  const ok = [], bad = [];
  for (const q of questions) {
    const d = readDoc(dir, q.slug);
    if (!d) { bad.push({ qid: q.qid, slug: q.slug, why: 'no_document' }); continue; }
    if (d.meta.status === 'gone') { bad.push({ qid: q.qid, slug: q.slug, why: 'page_gone' }); continue; }
    const pageAm = (d.meta.lang || 'en') === 'am';
    if (pageAm && !q.topicAm) { bad.push({ qid: q.qid, slug: q.slug, why: 'no_topic_am' }); continue; }
    const hay = pageAm ? foldEthiopic(norm(d.text)) : norm(d.text);
    const words = pageAm ? contentWordsAm(q.topicAm) : contentWords(q.topic);
    const matched = words.filter(w => hay.includes(w));
    if (matched.length < MIN_MATCHES) {
      bad.push({ qid: q.qid, slug: q.slug, why: 'topic_not_on_page', missing: words.filter(w => !matched.includes(w)) });
      continue;
    }
    ok.push({ ...q, matched, pageLang: d.meta.lang || 'en', title: d.meta.title || q.slug });
  }
  return { ok, bad };
}

function buildGold(questions, dir, out, { source, prefer, about } = {}) {
  const { ok, bad } = verify(questions, dir);
  if (bad.length) {
    for (const b of bad) console.error('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    throw new Error(bad.length + ' question(s) could not be verified against the fetched pages; nothing written');
  }
  const gold = {
    _about: (about || source + ' pack') + '. Built by ops/packs/build-gold.js on ' + new Date().toISOString().slice(0, 10)
      + '. Every question was verified against the text of its gold page. Each question carries the prefer list '
      + 'Bini passes for a message of this kind, so the benchmark measures what a user gets.',
    questions: ok.map(q => ({
      qid: q.qid, lang: q.lang, question: q.question, section: q.section,
      agent: 'bini', prefer,
      gold_source: source, gold_slug: q.slug,
      gold_pages: [{ source, slug: q.slug }],
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

// A pack binds the four things that differ: where its documents are, where its spec is, where the gold file
// goes, and which prefer list its questions carry.
function forPack(pack, { specFile, out, prefer, about } = {}) {
  const dir = path.join(ROOT, 'knowledge', pack);
  return {
    pack, PACK: dir,
    SPEC: specFile || path.join(dir, 'gold-spec.json'),
    OUT: out || path.join(GOLD_DIR, 'gold-' + pack + '.json'),
    prefer: prefer || [pack], about,
    verify: (qs, d) => verify(qs, d || dir),
    buildGold: (qs, d, o, opts) => buildGold(qs, d || dir, o || path.join(GOLD_DIR, 'gold-' + pack + '.json'),
      { source: pack, prefer: prefer || [pack], about, ...(opts || {}) }),
    contentWords, readDoc, MIN_MATCHES,
  };
}

const PREFER_OF = {
  travel: () => require(path.join(ROOT, 'assistant', 'travel.js')).PREFER,
  banking: () => require(path.join(ROOT, 'assistant', 'banking.js')).PREFER,
};

function main(argv = process.argv.slice(2)) {
  const pack = argv.includes('--pack') ? argv[argv.indexOf('--pack') + 1] : 'travel';
  const prefer = PREFER_OF[pack] ? PREFER_OF[pack]() : [pack];
  const bound = forPack(pack, { prefer });
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : bound.OUT;
  const spec = JSON.parse(fs.readFileSync(bound.SPEC, 'utf8'));
  if (argv.includes('--check')) {
    const { ok, bad } = verify(spec.questions, bound.PACK);
    for (const q of ok) console.log('  ok      ' + q.qid + ' [' + q.lang + '] ' + q.slug + '  matched: ' + q.matched.join(', '));
    for (const b of bad) console.log('  REFUSED ' + b.qid + ' -> ' + b.slug + '  ' + b.why + (b.missing ? '  missing: ' + b.missing.join(', ') : ''));
    console.log('\n' + ok.length + ' verified, ' + bad.length + ' refused, of ' + spec.questions.length);
    if (bad.length) process.exit(1);
    return;
  }
  const g = buildGold(spec.questions, bound.PACK, out, { source: pack, prefer, about: spec._about });
  console.log('wrote ' + out + ': ' + g.questions.length + ' questions ('
    + g.questions.filter(q => q.lang === 'am').length + ' am, ' + g.questions.filter(q => q.lang === 'en').length + ' en), '
    + g.questions.filter(q => q.crossLingual).length + ' cross-lingual');
}

module.exports = { verify, buildGold, contentWords, contentWordsAm, readDoc, forPack, main, GOLD_DIR, MIN_MATCHES, ROOT };
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
