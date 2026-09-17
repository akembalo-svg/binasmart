'use strict';
// The two clauses of assistant/banking.js GUARDRAILS that the Task 14 close-out found half-obeyed, pinned so
// nobody quietly softens them back.
//
//   1. A figure without a date. Asked "የባንክ ብድር ወለድ ስንት ነው?" Bini named CBE, Zemen and CoopBank, linked all
//      three pages and gave 7–14 % and "from 8.5 % a year" — with the institution and the link and NO date.
//      The old clause asked for the institution and the date in one breath, and got the institution.
//   2. A refusal without the warning. Offered the account number 1000123456789, Bini refused the balance check
//      and never acknowledged the number — correct — but never said "do not share this with anyone". The
//      warning was the second half of a sentence whose first half had already been obeyed.
//
// Both are honest-provenance failures rather than safety failures, and both belong to the wording. So the
// wording now states each as its own instruction, in capitals, with the form of words to use.
const test = require('node:test');
const assert = require('node:assert');
const { GUARDRAILS, isBankingQuestion } = require('../../assistant/banking');

test('the date clause stands alone and gives the form of words, in both languages', () => {
  assert.match(GUARDRAILS, /EVERY FIGURE YOU STATE CARRIES ITS DATE IN THE SAME SENTENCE/,
    'the instruction is its own sentence, not a clause hanging off the institution');
  assert.match(GUARDRAILS, /as published on 16 September 2026/, 'and it shows the form to write');
  assert.ok(GUARDRAILS.includes('እንደታተመው'), 'the Amharic form of words is given too');
  assert.match(GUARDRAILS, /take the date from the document you are quoting, never from memory/,
    'the close-out also found a fabricated date: February 13, 2024 on a document stamped 2026-09-16');
  assert.match(GUARDRAILS, /carries no date, say that instead of inventing one/);
});

test('a refusal about an account must carry the warning about numbers, PINs and OTPs', () => {
  assert.match(GUARDRAILS, /EVERY TIME you refuse one of those/,
    'the warning is owed on every refusal, not only when a number is offered');
  assert.match(GUARDRAILS, /never share an account number, a card number, a PIN, a one-time code or a password/i);
  assert.match(GUARDRAILS, /including with you/i, 'especially not with Bini');
  assert.match(GUARDRAILS, /someone who says\s+they are from the bank/i, 'that is what the fraud looks like');
  assert.match(GUARDRAILS, /whether or not they offered you a number/i);
  assert.match(GUARDRAILS, /A bank never asks for a PIN or an OTP/);
  assert.ok(GUARDRAILS.includes('OTP'), 'the one-time code is named in the Amharic half as well');
  assert.ok(/ፒን/.test(GUARDRAILS) && /አያጋሩ/.test(GUARDRAILS), 'and the warning itself is written in Amharic');
});

test('the refusal list names a statement and a transaction, not only a balance', () => {
  assert.match(GUARDRAILS, /check a balance, see a statement or a transaction/);
});

// Measured live on 2026-09-17, before this was written. Asked "can you check my balance", Bini answered with
// telebirr's *804# and a list of bank apps: no refusal, no warning. The guardrail was not being disobeyed —
// it was never in the prompt, because `balance` on its own is a WEAK word and one weak word is not two. The
// possessive is what turns a product question into an account question.
test('a request to look inside MY account is a banking question, so the guardrails reach the prompt', () => {
  for (const q of ['can you check my balance', 'what is my balance', 'show me my transactions',
    'ቀሪ ሂሳቤ ስንት ነው?', 'ሂሳቤን ማየት እችላለሁ?', 'my account balance', 'send me my statement'])
    assert.equal(isBankingQuestion(q), true, 'must reach the banking guardrails: ' + q);
});

test('and a possessive that is not about money still does not', () => {
  for (const q of ['how do I delete my account on bina.et', 'my ride is late', 'my hotel booking is wrong'])
    assert.equal(isBankingQuestion(q), false, 'must not be pulled into banking: ' + q);
});

test('the balance clause says refuse FIRST and how-to only after', () => {
  assert.match(GUARDRAILS, /requests to look inside somebody's account/i);
  assert.match(GUARDRAILS, /START by saying you cannot see anyone's account or balance/);
  assert.match(GUARDRAILS, /not a USSD code, not a how-to/, 'that is exactly what it did instead');
  assert.match(GUARDRAILS, /Only AFTER that refusal and the warning/);
});

test('the date must be the one written on the document, not today and not the bare year', () => {
  assert.match(GUARDRAILS, /Source: \.\.\. fetched YYYY-MM-DD/, 'it is told where to find the date');
  // Task 15b put that line into the context for real (knowledge/index.js sourceLine), in both languages, so
  // the prompt names the Amharic form too and says to copy the date rather than convert or re-read it.
  assert.match(GUARDRAILS, /ምንጭ፦ \.\.\. የተወሰደበት ቀን YYYY-MM-DD/, 'the Amharic Source line is named as well');
  assert.match(GUARDRAILS, /COPY IT AS IT IS WRITTEN/, 'the date is copied, not converted');
  assert.match(GUARDRAILS, /Not today's date, not the year on its own/);
  assert.match(GUARDRAILS, /read back every figure in it/, 'a check before sending, not a hope');
});

// Measured live on 2026-09-17: asked for the National Bank's travel allowance, Bini gave USD 5,000, USD
// 10,000 and 10 % correctly, named the National Bank, linked https://nbe.gov.et/fx — and gave no date at all.
// A list of bullets under one link is the shape the clause kept missing.
test('a link is not a date, and a list of figures needs one on every line', () => {
  assert.match(GUARDRAILS, /A LINK IS NOT A DATE/);
  assert.match(GUARDRAILS, /Whenever you give a link, give the institution and the fetched date in the\s+same sentence/);
  assert.match(GUARDRAILS, /every bullet with a number in it\s+needs the date/);
});

test('the pack now HAS telebirr and M-PESA, and the guardrail no longer says it has not', () => {
  assert.ok(!/no source for telebirr/i.test(GUARDRAILS),
    'that sentence was true until 2026-09-17 and is now a lie Bini would repeat');
  assert.match(GUARDRAILS, /telebirr and M-PESA ARE in the pack as of 17 September 2026/);
  assert.match(GUARDRAILS, /say so\s+plainly when a particular telebirr or M-PESA figure is not among them/);
});

test('nothing that was already true was dropped', () => {
  for (const re of [/not a bank/i, /may NOT give advice/, /never predict/, /confirm with the institution/,
    /never estimate a rate, a fee or a limit from memory/]) assert.match(GUARDRAILS, re);
  assert.ok(/[ሀ-፿]/.test(GUARDRAILS), 'the guardrail is still stated in Amharic as well as English');
});
