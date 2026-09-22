'use strict';
// Reading a CV into a short profile, so a vacancy can be matched to the right person.
//
// What it extracts: a two-line summary, up to a dozen skills, years of experience, and the field of
// work. Nothing else - and deliberately nothing about age, gender, marital status, religion, ethnicity,
// disability or place of birth, which Ethiopian CVs often carry because the old templates asked for
// them. If we extracted those fields they would become filters, and a filter on them is discrimination
// with a database behind it. The model is told plainly not to return them.
//
// The summary is for matching inside the platform. It is never shown publicly: the person applied for a
// job, they did not publish a profile.
const MODEL = 'gemini-2.5-flash';

const PROMPT = [
  'This is a job applicant\'s CV from Ethiopia. Return ONLY a JSON object, no other text, with:',
  '  "summary"  — two short sentences: what they do and their strongest relevant experience.',
  '  "skills"   — up to 12 short skill or tool names, as written on the CV.',
  '  "years"    — whole number of years of work experience, or null if it cannot be worked out.',
  '  "category" — the field of work in two or three words (e.g. "Accounting", "Civil engineering", "Sales", "Nursing").',
  '',
  'Never include or infer: age, date of birth, gender, marital status, religion, ethnicity, region of origin, disability, photograph or ID numbers. If the CV states them, leave them out.',
  'Do not invent experience the CV does not state. If it is not a CV at all, return {"summary": null}.',
  'Write the summary in the CV\'s own language (Amharic in Ethiopic script, or English).',
].join('\n');

function makeCvReader({ apiKey, fetchImpl }) {
  const f = fetchImpl || fetch;
  return async function readCv(buf, mime) {
    if (!apiKey || !buf) return null;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey, {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ inlineData: { mimeType: mime, data: Buffer.from(buf).toString('base64') } }, { text: PROMPT }] }],
          // Same lesson as the document reader: this model's deliberation is billed against the output
          // budget, and a CV summary that stops mid-sentence is worse than none.
          generationConfig: { temperature: 0, maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json' },
        }),
      });
      if (r.status !== 200) return null;
      const d = await r.json().catch(() => null);
      const text = (((d?.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('').trim();
      if (!text) return null;
      const info = JSON.parse(text);
      if (!info || typeof info !== 'object' || !info.summary) return null;
      return {
        summary: String(info.summary).slice(0, 600),
        skills: Array.isArray(info.skills) ? info.skills.map(s => String(s).slice(0, 40)).filter(Boolean) : [],
        years: Number.isFinite(Number(info.years)) ? Math.max(0, Math.min(60, Math.round(Number(info.years)))) : null,
        category: info.category ? String(info.category).slice(0, 60) : null,
      };
    } catch (e) { return null; } finally { clearTimeout(t); }
  };
}

module.exports = { makeCvReader, PROMPT };
