'use strict';
// What a chat answer must not carry, however the model wrote it: the context's bracket numbers and the
// "Source: … fetched …" lines it was shown. Asked for by the owner on 2026-09-17 after showing Bini to
// companies: the answers read like a report. The rules are in prompts/bini.txt; a prompt is probabilistic,
// so this is the deterministic half. It removes only reference furniture — never a sentence, never a figure,
// and never a link the answer itself offers ("open /ride", "wa.me/…").
const REF = /\s*\[(?:\d{1,2}|[^\]\n]{1,40}\s\d{1,2})(?:\s*,\s*(?:\d{1,2}|[^\]\n]{1,40}\s\d{1,2}))*\]/g;
const SOURCE_LINE = /^\s*(?:\(|\[)?\s*(?:source|sources|ምንጭ|ምንጮች|Madda)\s*[:：፦·\-–—]\s*.*$/gim;
const TRAILING_URL_LINE = /^\s*(?:\(|\[)?\s*https?:\/\/\S+\s*(?:\)|\])?\s*$/gim;

function tidyAnswer(text) {
  const before = String(text || '');
  let out = before.replace(REF, '');
  out = out.replace(SOURCE_LINE, '');
  out = out.replace(TRAILING_URL_LINE, '');
  out = out.replace(/[ \t]+([,.;:።?!])/g, '$1').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, removed: out === before ? 0 : 1 };
}

// A sentence that declines, warns, or sends someone to a professional is the answer, not an opener —
// however much it looks like an introduction. "I'm not a doctor, so I can't tell you what to take" both
// introduces and refuses; removing it leaves the helpful half and loses the refusal, which is the one
// sentence the reply exists for. Added 2026-09-18 after Dr Afiya's safety eval fell from 31/32 to 26/32
// with the refuse bucket at 5/11: the openers stripIntro removed were the refusals themselves.
// Deliberately broad in both languages — a marker that fires too often costs a duplicated introduction,
// a marker that misses costs a refusal.
const REFUSAL_MARKER = new RegExp([
  // English — declining, or naming what the speaker is not
  "can'?t\\b", '\\bcannot\\b', '\\bcan not\\b', '\\bnot able\\b', '\\bunable\\b',
  '\\bnot (?:qualified|licensed|permitted|allowed|in a position)\\b',
  '\\bnot (?:a|an|your) (?:doctor|nurse|physician|pharmacist|clinician|lawyer|medical|health|financial|legal)\\b',
  '\\bnot (?:a |an )?(?:medical|health|healthcare|legal|financial) (?:professional|advisor|adviser|expert|practitioner)\\b',
  '\\bnot (?:something|advice|a substitute)\\b',
  '\\bonly a (?:licensed|registered|qualified|doctor|clinician|pharmacist|nurse|lawyer|health)',
  '\\b(?:never|do not|don\'?t) (?:share|send|give out|disclose|tell anyone)\\b',
  '\\b(?:see|consult|visit|speak to) (?:a|an|your) (?:doctor|clinician|physician|nurse|pharmacist|lawyer|health|medical)',
  '\\b(?:seek|get) (?:medical|urgent|immediate|professional)\\b',
  '\\bemergency\\b', '\\bambulance\\b', "\\bi'?m sorry\\b", '\\bi am sorry\\b',
  // Amharic — declining, "I am not a …", "only a …", warnings, "consult a professional"
  'አልችልም', 'ባልችልም', 'ስለማልችል', 'አልሰጥም', 'አልመክርም', 'የለኝም', 'አይደለሁም', 'አይደለም',
  'ብቃት የለኝም', 'መረጃ የለኝም', 'አታጋሩ', 'አያጋሩ', 'አያካፍሉ', 'ያማክሩ', 'ይማከሩ', 'ያነጋግሩ',
  'ድንገተኛ', 'አስቸኳይ', 'አምቡላንስ', '907',
  '(?:ሐኪም|ሀኪም|ዶክተር|ነርስ|ባለሙያ|ጠበቃ)\\s*(?:\\S+\\s*){0,3}(?:ብቻ|ዘንድ|ያስፈልግ)',
  // Oromo
  '\\bhin danda(?:eenyu|eenye|a\\b)', '\\bmiti\\b', '\\bofatti\\b',
].join('|'), 'iu');

// Any mark of negation, in any of the three languages. Used for the second rule: a sentence may not be
// removed if it is the only thing in the reply saying no.
const NEGATION = /\b(?:not|no|never|cannot|can'?t|won'?t|don'?t|doesn'?t|isn'?t|unable|without)\b|አይ|አል|የለ|አታ|አያ|\bhin\b|\bmiti\b/iu;

// A self-introduction in a reply that is not the first one. The kit engine sends the model one message at a
// time, so the model cannot know whether it has already introduced itself: the prompt asks for one
// introduction, and this removes the rest. Only a standalone opener goes — never a name inside a sentence,
// and never a sentence that declines or warns (see REFUSAL_MARKER).
function stripIntro(text, names) {
  const before = String(text || '');
  const list = (names || []).map(n => String(n).trim()).filter(Boolean);
  if (!list.length) return { text: before, removed: 0 };
  const copula = /(?:ነኝ|እባላለሁ|እባላለው|ተባልኩ|jedhama|\bdha\b)|\b(?:i'?m|i am|this is)\b/i;
  const isIntro = seg => (list.some(n => seg.includes(n)) || /\b(?:i'?m|i am|this is)\s/i.test(seg)) && copula.test(seg) && seg.length <= 170;
  // Sentence by sentence, but only the first two: an introduction lives there or not at all, and the rest of
  // the reply is the answer. A reply that is nothing but an introduction is left alone.
  const parts = before.match(/[^።.!?፧\n]+[።.!?፧\n]*/gu) || [];
  let removed = 0, i = 0;
  // At most one sentence is ever removed: a reply has one introduction, and a second removal has always
  // been the answer rather than an opener.
  while (i < parts.length && i < 2 && !removed) {
    const seg = parts[i];
    // A refusal, a warning, or a "see a doctor" is the answer. It stays even when it introduces.
    if (isIntro(seg) && !REFUSAL_MARKER.test(seg)) {
      // …and it stays anyway if it carries the only negation in the reply: removing it would turn a no
      // into a yes, which is the failure this guard exists to prevent.
      const rest = parts.slice(0, i).concat(parts.slice(i + 1)).join('');
      if (NEGATION.test(seg) && !NEGATION.test(rest)) { i++; continue; }
      parts.splice(i, 1); removed = 1;
    } else i++;
  }
  const rest = parts.join('').replace(/^[\s—–\-:፣,]+/u, '').trim();
  if (!removed || !rest) return { text: before, removed: 0 };
  return { text: rest, removed: 1 };
}

module.exports = { tidyAnswer, stripIntro, REF, SOURCE_LINE, REFUSAL_MARKER };
