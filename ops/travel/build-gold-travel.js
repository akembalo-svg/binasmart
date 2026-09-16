#!/usr/bin/env node
'use strict';
// Build the travel retrieval gold set from ops/travel/gold-travel-spec.json.
//
//   node ops/travel/build-gold-travel.js            verify and write /root/storage/bina-embed/eval/gold-travel.json
//   node ops/travel/build-gold-travel.js --check    verify and print the evidence, write nothing
//   node ops/travel/build-gold-travel.js --out <p>  somewhere else
//
// The builder itself moved to ops/packs/build-gold.js when the banking pack needed the same rules. The rule
// is unchanged and is the reason this file exists at all: a question may not enter the gold file unless the
// page it names is on disk, is live, and actually discusses the question's subject.
const path = require('path');
const fs = require('fs');
const B = require('../packs/build-gold.js');
const { PREFER } = require('../../assistant/travel');

const PACK = path.join(__dirname, '..', '..', 'knowledge', 'travel');
const SPEC = path.join(__dirname, 'gold-travel-spec.json');
const OUT = '/root/storage/bina-embed/eval/gold-travel.json';
const ABOUT = 'Ethiopian Airlines travel pack, 60 questions (40 am, 20 en)';

const verify = (questions, dir = PACK) => B.verify(questions, dir);
const buildGold = (questions, dir = PACK, out = OUT) => B.buildGold(questions, dir, out, { source: 'travel', prefer: PREFER, about: ABOUT });

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

module.exports = { verify, buildGold, contentWords: B.contentWords, readDoc: B.readDoc, PACK, SPEC, OUT, MIN_MATCHES: B.MIN_MATCHES };
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
