'use strict';
// Voice notes → text with Gemini (audio understanding). Telegram voice is OGG/Opus, which Gemini accepts inline.
const MODEL = 'gemini-2.5-flash';
function makeTranscriber({ apiKey, fetchImpl }) {
  const f = fetchImpl || fetch;
  return async function transcribe(base64, mime) {
    if (!apiKey) throw new Error('no_gemini_key');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 40000);
    try {
      const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        contents: [{ parts: [{ inlineData: { mimeType: mime || 'audio/ogg', data: base64 } }, { text: 'Transcribe this voice message exactly, in the language spoken (Amharic in Ethiopic script, Afaan Oromoo in Latin qubee, or English). Output only the transcript, no commentary. If it is silence or noise, output [unclear].' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } } }) });
      const d = await r.json().catch(() => ({}));
      if (r.status !== 200) throw new Error('gemini ' + r.status + ' ' + JSON.stringify(d).slice(0, 120));
      const text = (((d.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim() || '';
      return text;
    } finally { clearTimeout(t); }
  };
}
module.exports = { makeTranscriber };
