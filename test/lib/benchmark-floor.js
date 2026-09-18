'use strict';
// How a benchmark floor on the "as shipped" column is judged.
//
// The retrieval benchmark reports two numbers per slice. `plain` is retrieval alone, and it is
// deterministic: the same corpus and the same gold set give the same pages, run after run. `shipped` is
// what Bini actually uses, retrieval followed by the reranker, and the reranker is a Gemini call whose
// ordering of two close candidates is not stable. Measured, not assumed: on identical retrieval the
// shipped column has moved by exactly one question between runs in every pack that was run twice
// (business bz-018, banking bk-050, travel tv-015), in both directions.
//
// The floor tests read whichever result file is newest. Pinning `shipped` at the lowest value ever seen
// therefore made the suite fail on the next run that happened to land one question low, which is noise,
// and a floor that fails on noise gets lowered by the next person to meet it, which is how a real
// regression gets through. So:
//   - retrieval (`plain`) floors stay exact. They are not touched here.
//   - a shipped floor passes if the slice is no more than ONE QUESTION below it. For a slice of n
//     questions one question is 100/n points. Two questions below still fails.
// The slack is one question and not a percentage so that it means the same thing in a slice of 16 as in
// a slice of 110.
const pctOf = v => Number(String(v).replace('%', ''));

function oneQuestion(row) {
  const n = Number(row && row.n);
  if (!Number.isFinite(n) || n <= 0) throw new Error('benchmark row has no question count: ' + JSON.stringify(row));
  return 100 / n;
}

// Questions, not percentages: the benchmark prints one decimal, so "one question below 90.0 in 60"
// arrives as 88.3 while 90 - 100/60 is 88.33 — a percentage comparison would call one question two.
const questions = (row, p) => Math.round(pctOf(p) * Number(row.n) / 100);

// true if the slice's shipped figure is at the floor, or at most one question below it.
function shippedFloor(row, floor) {
  oneQuestion(row);                       // throws on a row with no question count
  return questions(row, row.shipped) >= questions(row, floor) - 1;
}

module.exports = { shippedFloor, oneQuestion, pctOf };
