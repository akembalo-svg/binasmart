'use strict';
// Is this message about one particular sector? The question a per-message knowledge preference turns on.
//
// The airline pack asked it first and got three tiers right; the banking pack needs the same three tiers and
// a different vocabulary. So the tiers live here and each pack is a table of words.
//
// Why per message rather than a fixed preference on an agent definition: Dr Afiya is always a health agent
// and Asmat is always a legal one, so they declare knowledge: { prefer } once, in agents/<name>/rules.js.
// Bini answers rides, hotels, tenders, tax, cinema and banks in the same conversation. A standing preference
// for one pack would put it ahead of the guide that answers everything else, because `prefer` moves the
// +0.06 tie-breaker AWAY from everything it does not name (knowledge/index.js, hybridScore).
//
// The tiers, consulted in this order:
//   HARD           a word only this sector uses. It decides on its own and overrides the guard below, because
//                  "I paid for the taxi by card, but what does the bank charge on an overdraft" is a banking
//                  question with a taxi in it.
//   OTHER_SERVICE  a word another BinaSmart service or another knowledge source owns. With no HARD word
//                  anywhere in the message, this ends it: the question belongs to that service.
//   STRONG / WEAK  sector words that other things also use. One STRONG is enough once no other service has
//                  claimed the message; otherwise two distinct WEAK ones.
//
// Deliberately conservative, and it can afford to be: a message this test misses is answered from the whole
// index, which contains the pack. What is lost is the tie-breaker, not the knowledge.
const { foldEthiopic } = require('./lang');

const fold = s => foldEthiopic(String(s == null ? '' : s).toLowerCase());
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Amharic is folded at load for the same reason knowledge/index.js folds it: ሀ/ሐ/ኀ, ሰ/ሠ, አ/ዐ and ጸ/ፀ are the
// same sounds written differently and people type both. A Latin term also gets word boundaries, so "tax" does
// not match inside "syntax" and "rent" does not match inside "current"; Ethiopic does not, because \b in
// JavaScript is defined on ASCII word characters and would never fire next to an Ethiopic letter.
const rxOf = terms => new RegExp(terms.map(t => {
  const f = escRe(fold(t));
  return /^[\x00-\x7F]+$/.test(t) ? '\\b' + f + '\\b' : f;
}).join('|'), 'gi');

function hits(re, s) { re.lastIndex = 0; return new Set((s.match(re) || []).map(x => x.toLowerCase())); }

// makeIntent({ hard, otherService, strong, weak }) -> (msg) => boolean
function makeIntent({ hard = [], otherService = [], strong = [], weak = [] } = {}) {
  const HARD = rxOf(hard), OTHER = rxOf(otherService), STRONG = rxOf(strong), WEAK = rxOf(weak);
  return function isSectorQuestion(msg) {
    const s = fold(msg);
    if (!s) return false;
    if (hits(HARD, s).size) return true;
    if (hits(OTHER, s).size) return false;
    if (hits(STRONG, s).size) return true;
    return hits(WEAK, s).size >= 2;
  };
}

module.exports = { makeIntent, rxOf, hits, fold };
