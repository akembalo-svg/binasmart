// The price rule was just made more permissive, so show it still bites when a tool ran and the agent
// said nothing useful.
const { check } = require('/var/www/connectcare/binasmart/ops/bini/checks.js');
const item = { q: 'x', tags: ['price', 'pool'] };
const cases = [
  ['ከሲኤምሲ ወደ ቦሌ የሚወስድ የጋራ ጉዞ መስመር አሁን ክፍት የለም።', false, 'correctly says the route is not open'],
  ['እሺ ልረዳዎት እችላለሁ። ሌላ ጥያቄ አለዎት?', true, 'tool ran and the reply says nothing useful'],
  ['አንድ መቀመጫ 165 ብር ነው።', false, 'gives the fare'],
];
let bad = 0;
for (const [r, want, note] of cases) {
  const res = check(item, r, { tools: ['pool_board'] });
  const list = Array.isArray(res) ? res : (res && res.fails) || [];
  const fired = list.includes('tool_ran_but_no_number');
  if (fired !== want) { bad++; console.log('  WRONG    ' + note + ' -> ' + (fired ? 'flagged' : 'passed')); }
  else console.log('  correct  ' + (fired ? 'FLAGGED    ' : 'passes     ') + note);
}
console.log(bad ? '\n  ' + bad + ' FAILURES' : '\n  the rule still bites');
