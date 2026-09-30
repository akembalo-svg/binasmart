'use strict';
// A photograph of a document → what it says, in the reader's own language.
//
// Ethiopians photograph paper constantly: a licence, a letter from a woreda, a prescription, a contract,
// a bank slip. Bini could already hear a voice note (assistant/transcribe.js) but could not see, although
// the same model and the same inlineData shape does images. This is that.
//
// The rule that matters more than the code: it READS, it does not AUTHENTICATE. "This looks like a real
// licence" is a sentence that can cost somebody money or their case, and no photograph can support it.
// It also never guesses at characters it cannot see - a misread digit in an account number or a fee is
// worse than "I cannot read this line", because the person acts on it.
const MODEL = 'gemini-2.5-flash';

const OK_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

// Written for the model, in the voice the rest of the system uses: read it out, say what it is, say what
// it asks of the person, and refuse the two things a photo cannot settle.
const PROMPT = [
  'You are reading a photograph of a document for someone in Ethiopia. Do four things, in this order:',
  '1. Say what the document appears to be (a letter, a licence, an invoice, a prescription, a court summons…) and which office or company issued it, if that is printed on it.',
  '2. Read out what it says. Keep every number, date, name, fee and reference exactly as printed. Do not round, translate or tidy a figure.',
  '3. Say plainly what it asks the person to do, and by when, if a deadline is printed.',
  '4. If any part is blurred, cut off or unreadable, say which part — never guess a digit, a name or a date.',
  '',
  'Answer in the language of the question. If no question was asked, answer in the language of the document (Amharic in Ethiopic script, Afaan Oromoo in Latin qubee, or English).',
  '',
  'Never say whether the document is genuine, valid, current or forged, and never say it "looks official" — a photograph cannot show that, and only the issuing office can confirm it. If the person asks whether it is real, say that plainly and tell them to check with the office that issued it.',
  'Never give legal, medical or financial advice about what is written. Read it, explain what it asks, and stop.',
  'If the photograph is not a document at all, say what you see in one line and ask what they would like to know.',
  '',
  'NEVER read out a secret, even when asked to: a password, a PIN, an API key, an access token, a private key, a card number or a CVV. Say that the image contains credentials, name what kind, and say they are not repeated here. Warn the person that a photograph of a secret has already left their phone and the secret should be changed.',
].join('\n');


// A prompt is an instruction, not a guarantee. Asked to read a screenshot of API credentials on
// 2026-09-20, the model printed the secret key in full AND then wrote "these are not repeated here" -
// it obeyed the warning and ignored the rule in the same breath. So the last word belongs to code:
// anything shaped like a secret is masked on the way out, whatever the model decided to say.
//
// The shapes: a labelled value (key/token/password/secret/PIN/CVV), and any opaque run of 24+ characters.
// A real document number - a TIN, an invoice, a plate, a phone - is far shorter, so the false-positive
// cost is a masked reference number, which the person can still read off their own paper. The other
// direction costs them the secret.
const LABELLED = /((?:token|key|secret|password|passphrase|pin|cvv|credential)[^\n:=]{0,24}[:=]\s*)([^\s\n][^\s\n]{5,})/gi;
const OPAQUE = /\b[A-Za-z0-9_\-]{24,}\b/g;
function redactSecrets(text) {
  let out = String(text).replace(LABELLED, (m, label, value) => label + '[' + value.length + ' characters, not repeated]');
  out = out.replace(OPAQUE, m => '[' + m.length + ' characters, not repeated]');
  return out;
}

function makeImageReader({ apiKey, fetchImpl }) {
  const f = fetchImpl || fetch;
  return async function readImage(base64, mime, question) {
    if (!apiKey) throw new Error('no_gemini_key');
    const m = String(mime || 'image/jpeg').toLowerCase();
    if (!OK_MIME.has(m)) throw new Error('unsupported_type');
    const parts = [{ inlineData: { mimeType: m, data: base64 } }, { text: PROMPT }];
    if (question && String(question).trim()) parts.push({ text: 'The person asks: ' + String(question).trim().slice(0, 500) });
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        // thinkingBudget 0, as the voice transcriber does: this model thinks before it answers and the
        // reasoning is billed against the SAME output budget, so the first reading of an Amharic document
        // stopped after 84 characters, mid-word, with the budget spent on deliberation nobody reads.
        // Reading a page needs care, not deliberation.
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status !== 200) throw new Error('gemini ' + r.status + ' ' + JSON.stringify(d).slice(0, 140));
      const text = (((d.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim() || '';
      if (!text) throw new Error('empty_reading');
      return redactSecrets(text);
    } finally { clearTimeout(t); }
  };
}

module.exports = { makeImageReader, PROMPT, OK_MIME, redactSecrets };
