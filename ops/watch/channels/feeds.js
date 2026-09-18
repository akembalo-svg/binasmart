'use strict';
// RSS, reduced to the same item shape the Telegram preview produces, so the classifier downstream never has
// to know where an item came from. Parser only: the caller fetches, one feed host at a time, 5 s apart.
//
// The rule this module exists to keep: a body that is not a feed is a FAILURE, never an empty success. Of the
// feed URLs tried on 2026-09-18, Addis Standard answered 403 with a Cloudflare challenge page, press.et
// answered the same 6,442-byte SPA shell on every path, and Addis Fortune answered 502 with an HTML error
// page — all of them bodies that parse to "no items" and would otherwise read as a quiet news day.

const { textOf, langOf, decode } = require('./preview');

const ITEM = /<item\b[\s\S]*?<\/item>/gi;
const ENTRY = /<entry\b[\s\S]*?<\/entry>/gi;
function tag(block, name) {
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(block);
  if (!m) return '';
  return String(m[1]).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}
// Atom puts the address in an attribute rather than in the element's text.
function atomLink(block) {
  const m = /<link\b[^>]*href="([^"]+)"/i.exec(block);
  return m ? decode(m[1]) : '';
}
// The feed's own utm_* campaign is the feed's, not the article's: two feeds carrying the same story would
// otherwise look like two different documents, and the address in a watch document is the one a reader opens.
function cleanUrl(u) {
  const s = decode(String(u || '')).trim();
  if (!/^https?:\/\//i.test(s)) return '';
  try {
    const url = new URL(s);
    for (const k of [...url.searchParams.keys()]) if (/^utm_/i.test(k)) url.searchParams.delete(k);
    return url.toString().replace(/\?$/, '');
  } catch (e) { return s; }
}
function whenOf(block) {
  const raw = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date');
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// xml -> { title, live, posts: [{ id, url, at, date, text, links, lang, channel }], error }
// `lang` is measured from the text; the registry's declared language is only the fallback for an item with no
// letters at all (a bare link, which ENA's channel is full of).
function readFeed(xml, { id = '', lang = 'en', name = '' } = {}) {
  const s = String(xml || '');
  const dead = (why) => ({ title: '', live: false, posts: [], error: why });
  if (s.trim().length < 200) return dead('not a feed: body is ' + s.trim().length + ' characters');
  if (!/<(rss|feed|rdf:RDF)\b/i.test(s.slice(0, 4000))) return dead('not a feed: no rss or atom root element');
  const blocks = (s.match(ITEM) || []).concat(s.match(ENTRY) || []);
  if (!blocks.length) return dead('not a feed: no item or entry elements');
  const head = s.split(/<item\b|<entry\b/i)[0];
  const title = textOf(tag(head, 'title')) || name;
  const posts = [];
  for (const b of blocks) {
    const at = whenOf(b);
    const url = cleanUrl(tag(b, 'link') || atomLink(b));
    if (!at || !url) continue;                      // an undated item is not evidence of a change
    const heading = textOf(tag(b, 'title'));
    const body = textOf(tag(b, 'description') || tag(b, 'summary') || '');
    const text = (heading + (body ? '\n\n' + body : '')).trim();
    posts.push({
      id: url,
      channel: id || title,
      url,
      at: at.toISOString(),
      date: at.toISOString().slice(0, 10),
      text,
      links: [url],
      lang: /[A-Za-zሀ-፿]/.test(text) ? langOf(text) : lang,
    });
  }
  if (!posts.length) return dead('not a feed: no dated items');
  posts.sort((a, b) => (a.at < b.at ? 1 : -1));     // newest first, the way a feed reads
  return { title, live: true, posts, error: '' };
}

module.exports = { readFeed, cleanUrl };
