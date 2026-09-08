'use strict';
// Automatic rubric for one Bini answer. Every check is deterministic so the weekly report is comparable
// week to week; Ibrahim reads the transcript for the things a regex cannot judge (warmth, naturalness).
const fs = require('fs');
const path = require('path');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const ETHIOPIC = /[ሀ-፿]/;
const INTRO = /^\s*(ቢኒ ነኝ|ቢኒ እባላለሁ|Bini here|I am Bini|I'm Bini|This is Bini|ቢኒ here)/i;
const OROMO_HINT = /\b(jira|jirta|dha|isin|isinitti|gatii|gatiin|imala|imalaa|dandeessu|qabdu|akkam|nagaa|galatoom\w*|keessan|irratti|kan|fi)\b/i;

// Every /path that exists on the site: static html in public/ + dynamic routes we know.
function knownPaths(root) {
  const set = new Set(['/', '/ride', '/ride?pool=1', '/pool', '/drive', '/airport', '/hotels', '/watch', '/cinema', '/tenders', '/news', '/guides', '/ai', '/mcp', '/owner', '/nav', '/business', '/property', '/cars', '/insurance', '/flights', '/travel', '/support', '/llms.txt']);
  try { for (const f of fs.readdirSync(path.join(root, 'public'))) if (f.endsWith('.html')) set.add('/' + f.replace(/\.html$/, '')); } catch (e) { /* no public dir in tests */ }
  return set;
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
  if (tags.includes('price') && !priced && /\d+\s*(ብር|birr|birrii|ETB)/i.test(r) && !/200 ብር/.test(r)) fails.push('birr_number_stated');
  if (tags.includes('price') && priced && !/\d/.test(r)) fails.push('tool_ran_but_no_number');
  if (tags.includes('complaint') && EMOJI.test(r)) fails.push('emoji_on_complaint');
  if (!tags.includes('greeting') && INTRO.test(r)) fails.push('self_intro');
  if (tags.includes('demo') && !/ማሳያ|ሙከራ|demo|test/i.test(r)) fails.push('demo_not_disclosed');
  if (tags.includes('unknown') && /\d+\s*ብር/.test(r)) fails.push('guessed_unknown_fee');
  if (tags.includes('politics') && !/ፖለቲካ|politic/i.test(r)) fails.push('politics_not_declined');
  if (tags.includes('neutral') && /ትችያለሽ|ትችላለህ|ስትጀምሪ|ስትጀምር\b|አንቺ|አንተ\b/.test(r)) fails.push('gender_assumed');
  if (r.length > 900) fails.push('too_long');
  if ((r.match(/https?:\/\/wa\.me/g) || []).length > 1) fails.push('whatsapp_twice');
  const kn = known || knownPaths(path.join(__dirname, '..', '..'));
  for (const p of pathsIn(r)) if (!kn.has(p)) { fails.push('unknown_link:' + p); break; } // a query string must match exactly (/ride?pool=1 ok, /ride?id=… not)
  return { ok: fails.length === 0, fails };
}

module.exports = { check, pathsIn, knownPaths };
