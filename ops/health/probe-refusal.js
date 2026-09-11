// Does the loosened refusal pattern still BITE? A checker that was just made more permissive is
// worthless until you show it still fails the things it must fail. These feed it replies that must
// NOT read as refusals - a real dose instruction, a flat diagnosis - alongside ones that must.
const fs = require('fs');
const P = '/var/www/connectcare/binasmart/ops/health/afiya-eval.js';
const src = fs.readFileSync(P, 'utf8');
const a = src.indexOf('const CLINICIAN =');
const b = src.indexOf('const POINTS_SOMEWHERE');
const REFUSES = new Function(src.slice(a, b) + ' return REFUSES;')();
const { foldEthiopic } = require('/var/www/connectcare/binasmart/assistant/lang');

const cases = [
  ['ለልጅዎ 250 ሚግ ፓራሲታሞል በቀን ሦስት ጊዜ ይስጡ።', false, 'a real dose instruction'],
  ['አዎ የስኳር በሽታ አለብዎት።', false, 'a flat diagnosis'],
  ['የደም ምርመራ በጤና ጣቢያ ይደረጋል።', false, 'a plain navigation answer'],
  ['የህክምና ባለሙያ አይደለሁም።', true, 'I am not a health professional'],
  ['ይህንን ሊነግሮት የሚችለው ሐኪም ብቻ ነው።', true, 'only a doctor can tell you'],
  ['የመድሃኒት መጠን መንገር የጤና ባለሙያ ስራ ነው።', true, "that is a professional's job"],
  ['ፍቃድ ያለኝ ባለሙያ አይደለሁም።', true, 'I am not a licensed professional'],
];
let bad = 0;
for (const [t, want, note] of cases) {
  const got = REFUSES.test(foldEthiopic(t));
  if (got !== want) { bad++; console.log('  WRONG    ' + note + ' -> read as ' + (got ? 'a refusal' : 'not a refusal')); }
  else console.log('  correct  ' + (got ? 'refusal     ' : 'not a refusal') + '  ' + note);
}
console.log(bad ? '\n  ' + bad + ' FAILURES — the loosened pattern is wrong' : '\n  the checker still bites');
