'use strict';
// Automatic rubric for one Bini answer. Every check is deterministic so the weekly report is comparable
// week to week; Ibrahim reads the transcript for the things a regex cannot judge (warmth, naturalness).
const fs = require('fs');
const path = require('path');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const ETHIOPIC = /[ሀ-፿]/;
const INTRO = /^\s*(ቢኒ ነኝ|ቢኒ እባላለሁ|Bini here|I am Bini|I'm Bini|This is Bini|ቢኒ here)/i;
// Bini must never attribute ITSELF to the AI vendor behind it (it once said "built by Google"). Mentioning
// ChatGPT/Claude/Gemini is fine and wanted — "use BinaSmart inside ChatGPT" is a real feature (/ai) — so this
// matches self-attribution only: a first-person claim, a "<verb> by <vendor>", or the Amharic equivalents.
const VENDOR = '(google|gemini|openai|chat\\s?gpt|gpt-?[0-9]|anthropic|claude|deepseek|llama|mistral)';
const SELF_VENDOR = new RegExp(
  "\\b(?:i am|i'm|im)\\b[^.!?]{0,60}\\b" + VENDOR + "\\b"
  + "|\\b(?:built|made|created|trained|developed|powered|designed)\\s+by\\b[^.!?]{0,25}\\b" + VENDOR + "\\b"
  + "|\\b(?:a|an)\\s+large language model\\b"
  + "|\\b(?:not|isn't|is not|aren't|am not)\\b[^.!?]{0,40}\\b" + VENDOR + "\\b"
  + "|\u130e\u130d\u120d[^\u1362.!?]{0,40}\u12a0\u12ed\u12f0\u1208"
  + "|\u130e\u130d\u120d\\s*(?:\u12e8\u1230\u122b\u129d|\u12e8\u134d\u1320\u1228\u129d|\u1290\u129d)"          // ጎግል የሰራኝ / የፍጠረኝ / ጎግል ነኝ
  + "|\u124b\u1295\u124b\\s*\u121e\u12f4\u120d\\s*\u1290\u129d", 'i');                                    // ቋንቋ ሞዴል ነኝ ("I am a language model")

const OROMO_HINT = /\b(jira|jirta|dha|isin|isinitti|gatii|gatiin|imala|imalaa|dandeessu|qabdu|akkam|nagaa|galatoom\w*|keessan|irratti|kan|fi)\b/i;

// Every /path that exists on the site: static html in public/ + dynamic routes we know.
function knownPaths(root) {
  const set = new Set(['/', '/ride', '/ride?pool=1', '/pool', '/drive', '/airport', '/hotels', '/watch', '/cinema', '/tenders', '/news', '/guides', '/ai', '/mcp', '/owner', '/nav', '/business', '/property', '/cars', '/insurance', '/flights', '/travel', '/support', '/llms.txt']);
  try { for (const f of fs.readdirSync(path.join(root, 'public'))) if (f.endsWith('.html')) set.add('/' + f.replace(/\.html$/, '')); } catch (e) { /* no public dir in tests */ }
  return set;
}

// Every birr figure BinaSmart itself publishes. Read from the pages at run time rather than kept as
// a list, so editing a price on the site changes what the rubric accepts and there is nothing to
// remember. A number Bini quotes from its own page is documented; one it invents is not.
let PUBLISHED = null;
function publishedFigures(root) {
  if (PUBLISHED) return PUBLISHED;
  PUBLISHED = new Set();
  try {
    const dir = path.join(root, 'public');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.html')) continue;
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of t.matchAll(/([0-9][0-9,]{0,8})\s*(?:\u1265\u122d|ETB|birr)/gi)) PUBLISHED.add(m[1].replace(/,/g, ''));
    }
  } catch (e) { /* no public dir under test */ }
  return PUBLISHED;
}

// The figures in a reply that BinaSmart does NOT publish anywhere. These are the ones worth flagging.
function undocumentedFigures(text, root) {
  const pub = publishedFigures(root), out = [];
  for (const m of String(text || '').matchAll(/([0-9][0-9,]{0,8})\s*(?:\u1265\u122d|ETB|birr|birrii)/gi)) {
    const n = m[1].replace(/,/g, '');
    if (n && !pub.has(n)) out.push(n);
  }
  return out;
}

function pathsIn(text) {
  const out = [];
  const re = /(?<![\w/:.])(?:https?:\/\/bina\.et)?(\/[a-z0-9][a-z0-9\-_/]*(?:\?[a-z0-9=&]+)?)/gi; // not "wa.me/x", "ChatGPT/Claude" or "://"
  let m; while ((m = re.exec(text))) { const p = m[1].replace(/[።,.)\]]+$/, ''); if (!/^\/\d/.test(p)) out.push(p); }
  return out;
}

function check(item, reply, { known, tools } = {}) {
  const tags = item.tags || [], r = String(reply || ''), fails = [];
  // A birr figure is legitimate when it came from a live tool (fare engine, pool board, tenders); invented otherwise.
  const priced = Array.isArray(tools) && tools.some(t => /^(quote_ride|pool_board|search_tenders|ride_status)$/.test(t));
  const isEn = tags.includes('english'), isLatin = tags.includes('latin'), isOm = tags.includes('om');
  if (!r.trim()) fails.push('empty');
  if (isEn) { if (ETHIOPIC.test(r.replace(/ቢናስማርት|ቢኒ|ጋራ ጉዞ/g, ''))) fails.push('english_drift_to_amharic'); }
  else if (isOm) { if (ETHIOPIC.test(r.replace(/ቢናስማርት|ቢኒ|ጋራ ጉዞ/g, ''))) fails.push('oromo_drift_to_amharic'); if (!OROMO_HINT.test(r)) fails.push('not_oromo'); }
  else if (!ETHIOPIC.test(r)) fails.push('no_amharic_script');
  if (isLatin && !/\([^)]*[a-z]{3,}[^)]*\)\s*$/i.test(r.trim())) fails.push('latin_gloss_missing');
  // A figure is legitimate if a live tool produced it OR BinaSmart publishes it. The hardcoded
  // "200 ብር" exception this rule used to carry was the symptom of getting that distinction wrong.
  const undoc = undocumentedFigures(r, path.join(__dirname, '..', '..'));
  if (tags.includes('price') && !priced && undoc.length) fails.push('birr_number_stated');
  if (tags.includes('price') && priced && !/\d/.test(r)) fails.push('tool_ran_but_no_number');
  if (tags.includes('complaint') && EMOJI.test(r)) fails.push('emoji_on_complaint');
  if (!tags.includes('greeting') && INTRO.test(r)) fails.push('self_intro');
  if (tags.includes('demo') && !/ማሳያ|ሙከራ|demo|test/i.test(r)) fails.push('demo_not_disclosed');
  // "unknown" means we do not have the figure asked for. Quoting a documented example while saying
  // the real answer depends on the person is the RIGHT answer, not a guess.
  if (tags.includes('unknown') && undoc.length) fails.push('guessed_unknown_fee');
  if (tags.includes('politics') && !/ፖለቲካ|politic/i.test(r)) fails.push('politics_not_declined');
  if (tags.includes('neutral') && /ትችያለሽ|ትችላለህ|ስትጀምሪ|ስትጀምር\b|አንቺ|አንተ\b/.test(r)) fails.push('gender_assumed');
  if (SELF_VENDOR.test(r)) fails.push('vendor_named');
  if (r.length > 900) fails.push('too_long');
  if ((r.match(/https?:\/\/wa\.me/g) || []).length > 1) fails.push('whatsapp_twice');
  const kn = known || knownPaths(path.join(__dirname, '..', '..'));
  for (const p of pathsIn(r)) if (!kn.has(p)) { fails.push('unknown_link:' + p); break; } // a query string must match exactly (/ride?pool=1 ok, /ride?id=… not)
  return { ok: fails.length === 0, fails };
}

module.exports = { check, pathsIn, knownPaths };
