'use strict';
// The classifier's third stage, and the only place in the watch where anything leaves the VPS.
//
// The standing rule is that BinaSmart data never leaves this server. What is sent here is not BinaSmart data:
// it is a public Telegram post that a government office or a newspaper has already published to tens of
// thousands of subscribers, and nothing else travels with it — no user question, no log line, no rider, no
// patient, not even the API key inside the prompt. Two guards keep that true rather than intended: the prompt
// is built from the post text alone, and WATCH_NO_MODEL=1 turns this stage off completely without turning the
// watch off (the rules settle the great majority on their own; the rest reach Ibrahim as a question).
//
// It fails CLOSED. A timeout, an HTTP error, an answer that does not parse or a verdict that is not one of
// the three words leaves the item `unsettled` and `queued`. An item is never admitted by an accident.

const MODEL = 'gemini-2.5-flash';
const PACE_MS = 4000;      // t.me is paced at 5 s; the model at 4 s, per the plan
const TIMEOUT_MS = 8000;
const VERDICTS = new Set(['pack-grade', 'perishable', 'excluded']);
const ADMITTED = new Set(['pack-grade', 'perishable']);

const PROMPT = [
  'You are sorting public announcements from Ethiopian government offices and newspapers.',
  'Answer with ONE JSON object and no prose: {"verdict": "pack-grade" | "perishable" | "excluded", "office": "<id or null>"}',
  'pack-grade  = a fact a reference library would keep: a directive, a notice, a fee, a deadline, opening hours, a public warning, how to use a service.',
  'perishable  = true today but soon false: a tariff, a price, a temporary offer.',
  'excluded    = politics, conflict, elections, ethnicity, rumour, opinion, sport, holiday greetings, ceremonies, diplomacy, advertising, promotions.',
  'Judge only the text below. If it is not clearly one of the three, answer excluded.',
  '',
  'TEXT:',
].join('\n');

function parseVerdict(txt) {
  const m = String(txt || '').match(/\{[\s\S]*?\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { return null; }
  const v = String(j.verdict || '').trim().toLowerCase();
  if (!VERDICTS.has(v)) return null;
  return { verdict: v, office: j.office == null ? null : String(j.office).trim() };
}

// items: [{ post, source }] — only the ones classifyByRules left unsettled.
// -> { results: [{ post, source, label, admit, office, reason, queued }], calls, failed, skipped }
async function classifyWithModel(items, { apiKey, env = process.env, fetchImpl, sleep, log } = {}) {
  const f = fetchImpl || fetch;
  const zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const say = log || (() => {});
  const off = /^(1|on|true|yes)$/i.test(String(env.WATCH_NO_MODEL || '').trim());
  const key = apiKey === undefined ? env.GEMINI_API_KEY : apiKey;
  const queue = (it, reason) => ({ post: it.post, source: it.source, label: 'unsettled', admit: false, office: (it.source && it.source.office) || null, reason, queued: true });

  if (off) return { results: items.map(it => queue(it, 'stage 3 skipped: WATCH_NO_MODEL=1')), calls: 0, failed: 0, skipped: items.length };
  if (!key) return { results: items.map(it => queue(it, 'stage 3 skipped: no model key')), calls: 0, failed: 0, skipped: items.length };

  const results = [];
  let calls = 0, failed = 0;
  for (const it of items) {
    if (calls) await zz(PACE_MS);
    const text = String((it.post && it.post.text) || '').slice(0, 2000);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      calls++;
      const r = await f('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + key, {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT + '\n' + text }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (!r.ok) throw new Error('model ' + r.status);
      const j = await r.json();
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '';
      const v = parseVerdict(txt);
      if (!v) throw new Error('unparseable answer');
      // The office is the channel we read the item from. The model may name one, and it is only believed when
      // the channel did not already say — an invented ministry never becomes a document's office.
      const office = (it.source && it.source.office) || (v.office && /^[a-z][a-z0-9-]{1,30}$/.test(v.office) ? v.office : null);
      results.push({ post: it.post, source: it.source, label: v.verdict, admit: ADMITTED.has(v.verdict), office, reason: 'stage 3: the model said ' + v.verdict, queued: false });
    } catch (e) {
      failed++;
      say('[watch] model failed on ' + ((it.post && it.post.url) || '') + ': ' + String(e.message || e).slice(0, 80));
      results.push(queue(it, 'stage 3 failed closed: ' + String(e.message || e).slice(0, 60)));
    } finally { clearTimeout(t); }
  }
  return { results, calls, failed, skipped: 0 };
}

module.exports = { classifyWithModel, parseVerdict, MODEL, PACE_MS, PROMPT };
