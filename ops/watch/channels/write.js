'use strict';
// One admitted item, one dated document under knowledge/watch/.
//
// Not under knowledge/news: `news` is BinaSmart's own articles, read from the posts table. A ministry's
// announcement is not ours and must not borrow our byline.
//
// The document is built so that it cannot be mistaken for the law. Its first sentence is fixed and says who
// announced it, on what day, and where it was reported — "On 17 September 2026, the Ethiopian Customs
// Commission announced …, as reported by its official Telegram channel @EthiopianCustomsCommission." Never
// "the rule is", never "the law says". Quoted out of context it still carries its own provenance, which is
// the only property that makes a two-day-old Telegram post safe to keep next to a proclamation.
//
// Every front-matter key is a bare word, because knowledge/index.js reads front matter line by line with
// /^(\w+):\s*"?(.*?)"?\s*$/ — reported_by, reported_at and expires_at are fine, a hyphen would be silently
// dropped and the document would lose its date.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TTL_DAYS = 90;
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// The Gregorian months transliterated, as knowledge/amharic-style.md requires: an Ethiopian reader takes
// መስከረም 16 for 26 September, so a Gregorian date never borrows an Ethiopian month name.
const AM_MONTHS = ['ጃንዋሪ', 'ፌብሩዋሪ', 'ማርች', 'ኤፕሪል', 'ሜይ', 'ጁን', 'ጁላይ', 'ኦገስት', 'ሴፕቴምበር', 'ኦክቶበር', 'ኖቬምበር', 'ዲሴምበር'];

// "the National Bank of Ethiopia", but "ethio telecom" and "Ethiopian Airlines" take no article. The rule is
// the kind of body, not the spelling, so a new office does not need a new special case.
const TAKES_THE = /\b(bank|commission|ministry|authority|bureau|corporation|agency|administration|office|service|institute|council)\b/i;
function article(name) { return /^the\s/i.test(name) ? '' : (TAKES_THE.test(name) ? 'the ' : ''); }
// The office's Amharic name, so that an Amharic document does not open with an English institution. These
// names live in the classifier, which already has to recognise them in a post.
function officeNameAm(office, fallback) {
  try {
    const { OFFICES } = require('./classify');
    const o = OFFICES[office];
    const am = o && (o.names || []).find(n => /[ሀ-፿]/.test(n));
    return am || fallback;
  } catch (e) { return fallback; }
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function longDate(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  // እ.ኤ.አ. marks a Gregorian date in an Amharic sentence (knowledge/amharic-style.md, line 21).
  if (lang === 'am') return 'እ.ኤ.አ. ' + AM_MONTHS[m - 1] + ' ' + d + ' ቀን ' + y;
  return d + ' ' + EN_MONTHS[m - 1] + ' ' + y;
}
function quote(s) { return '"' + String(s == null ? '' : s).replace(/"/g, '\\"').replace(/\s*\n\s*/g, ' ').trim() + '"'; }
// A title is the item's own first line, trimmed at a word: nothing is summarised here, because a summary is a
// claim and this document's whole job is to make no claim of its own.
function titleOf(text, fallback) {
  const line = String(text || '').split('\n').map(s => s.trim()).find(s => s.length > 0) || fallback;
  const t = line.replace(/\s+/g, ' ').trim();
  if (t.length <= 90) return t;
  const cut = t.slice(0, 90);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}

// item: { post, source, label } as the classifier hands it over.
// -> { name, dir, text, meta }
function watchDoc(item, { today, expiresAt, ttlDays = DEFAULT_TTL_DAYS, pendingDocument = false } = {}) {
  const post = (item && item.post) || {};
  const src = (item && item.source) || {};
  const reportedAt = String(post.date || (post.at ? String(post.at).slice(0, 10) : '')).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportedAt)) throw new Error('a watch document needs a reported_at: ' + (post.url || post.id || 'unknown item'));
  const day = String(today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const office = String(item.office || src.office || 'unknown');
  const lang = post.lang === 'am' ? 'am' : 'en';
  const channel = String(post.channel || src.handle || '');
  const publisher = String(src.name || office);
  const url = String(post.url || '');
  const hash = crypto.createHash('md5').update(url || (channel + '/' + post.id)).digest('hex').slice(0, 8);
  const title = titleOf(post.text, publisher + ' — ' + reportedAt);
  const expires = expiresAt || addDays(reportedAt, ttlDays);

  const meta = {
    url, title, source_name: publisher, office,
    reported_by: publisher, channel, reported_at: reportedAt,
    lang, status: 'live', expires_at: expires, fetchedAt: day, lastChecked: day,
  };
  if (pendingDocument) meta.pending_document = 'yes';

  const fm = ['---', ...Object.entries(meta).map(([k, v]) => k + ': ' + quote(v)), '---', ''].join('\n');
  const said = titleOf(post.text, title);
  const where = channel ? (lang === 'am' ? 'በይፋዊ የቴሌግራም ቻናሉ ' + channel : 'its official Telegram channel ' + channel) : (lang === 'am' ? 'በይፋዊ ቻናሉ' : 'its official channel');
  // The announcement is quoted rather than paraphrased: a headline is not a clause, and rewriting one into a
  // sentence of our own is the first step towards a document that sounds like a rule.
  // The fixed first sentence. It reports an announcement; it does not state a rule.
  const first = lang === 'am'
    ? longDate(reportedAt, 'am') + '፣ ' + officeNameAm(office, publisher) + ' «' + said + '» ሲል ' + where + ' አስታውቋል።'
    : 'On ' + longDate(reportedAt, 'en') + ', ' + article(publisher) + publisher + ' announced: "' + said + '" — as reported by ' + where + '.';

  const body = [
    first,
    '',
    lang === 'am' ? '## የተለጠፈው ጽሑፍ' : '## What was posted',
    '',
    String(post.text || '').trim(),
    '',
    (lang === 'am' ? 'ምንጭ፦ ' : 'Source: ') + (url || channel) + (post.links && post.links.length ? '\n' + (lang === 'am' ? 'የተያያዙ አድራሻዎች፦ ' : 'Linked: ') + post.links.join(' ') : ''),
    '',
  ].join('\n');

  return { name: reportedAt + '-' + office + '-' + hash + '.md', dir: path.join('knowledge', 'watch'), text: fm + body, meta };
}

function writeWatchDoc(item, { root, today, expiresAt, ttlDays, pendingDocument } = {}) {
  const d = watchDoc(item, { today, expiresAt, ttlDays, pendingDocument });
  const dir = path.join(root, d.dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, d.name);
  fs.writeFileSync(file, d.text);
  return { ...d, file };
}

module.exports = { watchDoc, writeWatchDoc, titleOf, longDate, addDays, DEFAULT_TTL_DAYS };
