'use strict';
// Does this question ask for what is NEW?
//
// The whole ranking rule of the channel watch turns on this one question (design §5.7). A watch document is a
// Telegram post a ministry published yesterday; the law is Regulation 394/2016. "What is the work-permit fee"
// must always reach the regulation, and only "what changed for work permits this month" may reach the post.
// So `watch` is excluded from retrieval by default, and the exclusion is lifted — and `prefer: ['watch']`
// applied instead — only when the question itself carries a recency marker.
//
// The list is the design's, in both languages, and nothing more. It is deliberately small: every word added
// here is a question that stops reaching the law, and that is the failure the eval (Task 13) exists to catch.
// "new" is the one that can misfire — "how do I register a new business" carries it — which is why lifting the
// exclusion is all it does. The item still has to out-score the curated document on its own merits, and the
// gold set scores the no-marker half of every question to prove it does not.
//
// Pure: no network, no fs, no state. knowledge/index.js (contextSearchOptions) is the only caller that matters.

// Latin markers. Word-bounded, so "renew" is not "new" and "newspaper" is not "new".
const EN = [
  /\bnew\b/i, /\bnewly\b/i, /\blatest\b/i, /\brecent(ly)?\b/i, /\bjust announced\b/i,
  /\bthis week\b/i, /\bthis month\b/i, /\blast week\b/i, /\bpast (few )?(days|weeks)\b/i,
  /\btoday\b/i, /\byesterday\b/i, /\bright now\b/i, /\bso far this\b/i,
  /\bchange[ds]?\b/i, /\bchanging\b/i, /\bupdate[ds]?\b/i, /\bannounce[ds]?\b/i, /\bannouncement\b/i,
];

// Amharic markers. አዲስ (new), ዛሬ (today), ትናንት (yesterday), በዚህ ሳምንት (this week), በዚህ ወር (this month),
// ሰሞኑን (these past days), ተቀየረ / ተለወጠ (changed), ተሻሽሏል (was updated), አዲስ ማስታወቂያ (new notice),
// የቅርብ ጊዜ (recent). Amharic is written without spaces between a word and its suffixes, so these are
// substring tests on purpose — \b does not help in Ethiopic.
const AM = [
  'አዲስ', 'አዳዲስ', 'ዛሬ', 'ትናንት', 'በዚህ ሳምንት', 'በዚህ ወር', 'ሰሞኑን', 'በቅርቡ', 'የቅርብ ጊዜ',
  'ተቀየረ', 'ተቀይሯል', 'ተለወጠ', 'ተሻሻለ', 'ተሻሽሏል', 'አዲሱ', 'አዲሷ', 'አሁን',
];

function hasRecencyMarker(question) {
  const q = String(question || '');
  if (!q.trim()) return false;
  for (const re of EN) if (re.test(q)) return true;
  for (const w of AM) if (q.includes(w)) return true;
  return false;
}

module.exports = { hasRecencyMarker, EN, AM };
