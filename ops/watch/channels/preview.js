'use strict';
// The public Telegram web preview, read as HTML. No Telegram account, no bot token, no MTProto client:
// https://t.me/s/<handle> serves the last ~20 posts of a public channel to anybody, with an ISO datetime on
// every bubble. This module is the parser only — it never fetches; the caller does that, one host, 5 s apart.
//
// The one thing that must not be got wrong (measured 2026-09-18 over 109 handles): a handle that does not
// exist answers **HTTP 200** with a ~9.7 KB page that has no channel header and no bubbles. So `live` is a
// channel title AND at least one dated bubble. A status code proves nothing, and an empty `posts` array with
// `live: true` would be a channel that silently stops reporting — the failure mode that blinds a watch for
// months without a single error in a log.

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'", '#39': "'", '#34': '"' };
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(quot|amp|lt|gt|nbsp|apos);/g, (_, k) => ENTITIES[k]);
}
// <br> is a line break and everything else is furniture. Entities are decoded AFTER the tags are removed, so
// a &lt;b&gt; the office actually typed cannot turn into markup that the next step strips.
function textOf(html) {
  return decode(String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// Ethiopic is its own Unicode block, so this needs no word list. A post that is one emoji and a link is
// neither language and is left as en; the classifier drops it on length anyway.
const ETHIOPIC = /[ሀ-፿]/g;
function langOf(text) {
  const letters = (text.match(/[A-Za-zሀ-፿]/g) || []).length;
  if (!letters) return 'en';
  const eth = (text.match(ETHIOPIC) || []).length;
  return eth / letters >= 0.2 ? 'am' : 'en';
}
// t.me and telegram.org are Telegram's own plumbing — the "view in Telegram" button, the channel's own
// address, a reply to a sibling post. They are never the document a post points at.
const OWN_HOST = /^https?:\/\/(t\.me|telegram\.me|telegram\.org|telesco\.pe|cdn\d*\.telesco\.pe)\b/i;
function linksIn(html) {
  const out = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const u = decode(m[1]).trim();
    if (!/^https?:\/\//i.test(u)) continue;
    if (OWN_HOST.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const TITLE = /<div class="tgme_channel_info_header_title"[^>]*>\s*(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?\s*<\/div>/;
const USERNAME = /<div class="tgme_channel_info_header_username">\s*<a[^>]*>\s*(@[A-Za-z0-9_]+)\s*<\/a>/;
const WRAP = /<div class="tgme_widget_message_wrap[^"]*"[\s\S]*?(?=<div class="tgme_widget_message_wrap|<\/section>)/g;
const POSTID = /data-post="([A-Za-z0-9_]+)\/(\d+)"/;
const WHEN = /class="tgme_widget_message_date"[^>]*>\s*<time datetime="([^"]+)"/;
// The bubble's text starts at the first message_text div and ends where the footer (views, date, forwards)
// begins. Telegram nests a second div of the same class inside the first, so a "find the closing tag" parser
// would stop halfway through a long post; the footer marker does not move.
const TEXT_START = /<div class="tgme_widget_message_text[^"]*"[^>]*>/;
const TEXT_END = /<div class="tgme_widget_message_(footer|info)\b/;

// html -> { title, handle, live, posts: [{ id, at, date, text, links, lang, url }] }
function readPreview(html, { handle } = {}) {
  const s = String(html || '');
  const t = TITLE.exec(s);
  const title = t ? textOf(t[1]) : '';
  const u = USERNAME.exec(s);
  const found = u ? u[1] : (handle || '');
  const posts = [];
  for (const block of s.match(WRAP) || []) {
    const id = POSTID.exec(block);
    const when = WHEN.exec(block);
    if (!id || !when) continue;          // a bubble with no date is not evidence of anything
    const at = new Date(when[1]);
    if (isNaN(at.getTime())) continue;
    const start = TEXT_START.exec(block);
    let body = '';
    if (start) {
      const rest = block.slice(start.index + start[0].length);
      const end = TEXT_END.exec(rest);
      body = end ? rest.slice(0, end.index) : rest;
    }
    posts.push({
      id: Number(id[2]),
      channel: '@' + id[1],
      url: 'https://t.me/' + id[1] + '/' + id[2],
      at: at.toISOString(),
      date: at.toISOString().slice(0, 10),
      text: textOf(body),
      links: linksIn(body),
      lang: langOf(textOf(body)),
    });
  }
  posts.sort((a, b) => a.id - b.id);
  return { title, handle: found, live: !!(title && posts.length), posts };
}

module.exports = { readPreview, textOf, langOf, linksIn, decode };
