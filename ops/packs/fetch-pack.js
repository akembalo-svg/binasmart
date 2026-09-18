#!/usr/bin/env node
'use strict';
// The Ethiopian Airlines knowledge pack: fetch the airline's public information pages and write them as
// curated knowledge documents under knowledge/travel/. Driven entirely by knowledge/travel/sources.json.
//
// Polite by construction: one request at a time, at least the crawlDelaySeconds the registry names (5 for
// ethiopianairlines.com, which is what its robots.txt asks for), a browser-shaped user agent that says
// BinaSmart and gives a contact page, and never a link off the site's own host.
//
// This file is split in three: the pure URL functions (here), the extractor, and the writer. Everything is
// exported so the tests can run the rules without a network.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
// A pack is a directory under knowledge/ holding a sources.json and the documents that registry produced.
// `travel` was the first; `banking` is the second. The name is a plain word because it becomes a path.
function packDir(pack) {
  if (typeof pack !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(pack)) throw new Error('pack name must be a plain lowercase word: ' + JSON.stringify(pack));
  return path.join(ROOT, 'knowledge', pack);
}
// Everything the airline fetcher hard-coded is now either a path derived from the pack name or a value the
// registry carries. forPack returns the module bound to one pack: same functions, different registry, output
// directory, generated_by string, log prefix and header wording.
const REGISTRY = path.join(ROOT, 'knowledge', 'travel', 'sources.json');
const OUT_DIR = path.join(ROOT, 'knowledge', 'travel');
// Named, versioned, and points at a page a webmaster can read. Not a lie about being a browser: the airline
// is told who we are. The Chrome prefix is there because Sitecore fronts refuse bare tokens.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 BinaSmart/1.0 (+https://bina.et/support)';

// ---------- sitemaps ----------
// Accepts raw or gzipped bytes and returns page urls and nested sitemap urls separately, because the
// airline's robots.txt points at an index whose only entry is a .gz.
function sitemapUrls(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
  if (b.length > 2 && b[0] === 0x1f && b[1] === 0x8b) { try { b = zlib.gunzipSync(b); } catch (e) { return { urls: [], indexes: [] }; } }
  let xml = b.toString('utf8');
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const isIndex = /<sitemapindex\b/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map(m => m[1].trim()).filter(Boolean);
  return isIndex ? { urls: [], indexes: locs } : { urls: locs, indexes: [] };
}

// One sitemap, a list of them, or none. Coop Bank of Oromia publishes its products and its FAQ answers in two
// separate sitemaps, and its index also lists seven sitemaps of daily exchange-rate posts — thousands of URLs
// we refuse to download at all. Naming the sitemaps we want is cheaper and politer than fetching the index
// and throwing nearly all of it away.
function sitemapsOf(site) {
  if (Array.isArray(site && site.sitemaps) && site.sitemaps.length) return [...site.sitemaps];
  return site && site.sitemap ? [site.sitemap] : [];
}

// ---------- paths ----------
function pathOf(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  } catch (e) { return null; }
}
const rx = list => (Array.isArray(list) ? list : []).map(p => new RegExp(p));
// A section may name its own regular-expression flags. Nothing in the travel pack does, and nothing that does
// not name them changes by a byte; the NBE harvest needs it because its PDF filenames are half SHOUTED
// (DIRECTIVE-NO.-FXD042026) and half whispered (fxd-67-2020), and writing every alternation twice would be a
// rule nobody could read.
function sectionOf(site, p) {
  for (const s of site.sections || []) if (new RegExp(s.match, s.matchFlags || '').test(p)) return s;
  return null;
}

// Keep only this host's allowlisted, non-denied paths. Deduplicated by path, sorted by path (so two runs
// fetch in the same order), capped at maxPages. Returns [{ url, path, section, sectionTitleAm }].
function selectUrls(site, urls) {
  const allow = rx(site.allow), deny = rx(site.deny);
  const seen = new Map();
  for (const raw of urls || []) {
    let u; try { u = new URL(raw); } catch (e) { continue; }
    if (u.hostname !== site.host) continue;                  // never another host, never a look-alike
    if (!/^https?:$/.test(u.protocol)) continue;
    const p = pathOf(raw);
    if (!p || p === '/') continue;
    if (!allow.some(r => r.test(p))) continue;
    if (deny.some(r => r.test(p))) continue;
    if (seen.has(p)) continue;
    const sec = sectionOf(site, p);
    seen.set(p, { url: 'https://' + site.host + p, path: p, section: sec ? sec.key : null, sectionTitleAm: sec ? sec.titleAm : null });
  }
  const out = [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const max = Number(site.maxPages) || 200;
  return out.slice(0, max);
}

// ---------- slugs ----------
// A pack with one fetched site needs no prefix and must not grow one: the airline's filenames are in a
// gold set, in a benchmark and in the index. `slugPrefix: false` says so explicitly.
const slugPrefixOf = site => (site && site.slugPrefix === false ? '' : ((site && (site.slugPrefix || site.id)) || '') + '-');
const clean = s => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
function segments(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  if (parts.length && /^[a-z]{2}$/.test(parts[0])) parts.shift();   // the locale prefix: /et/, /aa/
  return parts;
}
// The last two path segments: short enough to read, specific enough that
// /et/services/help-and-contact/frequently-asked-questions/shebamiles-faqs and
// /et/information/baggage-information/free-baggage-allowance do not look alike.
function slugFor(p, take = 2) {
  const parts = segments(p);
  if (!parts.length) return '';
  return clean(parts.slice(-take).join('-'));
}
// Give every page a slug no other page has, lengthening only the ones that clash. Order-independent: the
// input is sorted by path first, so the same set of pages always produces the same set of filenames.
// A path whose last segments are percent-encoded non-ASCII (Zemen's Amharic locale) cannot produce a readable
// slug by rule: clean() would turn %e1%8b%a8 into "-e1-8b-a8". Such a path must be named in the site's
// `pathSlugs` table, and if it is not, the run stops. Writing 200 characters of hex as a filename would be a
// document nobody can find in a gold set, a Telegram note or a git diff.
const NEEDS_NAME = /%[0-9a-f]{2}/i;
// A harvested site is keyed by path AND query, because ethio telecom puts the page's language in ?lang=am and
// the Amharic telebirr tariff is a different document from the English one at the same path. `telebirr-faq-lang-am`
// is a filename a rule can produce and no human would choose, so in dir mode anything that is not plain ascii
// path characters - a percent escape, a question mark, an equals sign - must be named in pathSlugs, and the run
// stops if it is not. Exactly the rule Task 4 wrote for Zemen's Amharic locale, widened by two characters.
const NEEDS_NAME_DIR = /[^a-zA-Z0-9/_.-]/;
function assignSlugs(pages, site, { needsName = NEEDS_NAME, slugOf = null } = {}) {
  const named = (site && site.pathSlugs) || {};
  const taken = new Map();
  for (const [p, s] of Object.entries(named)) {
    if (taken.has(s)) throw new Error('pathSlugs gives two paths the same slug: ' + s);
    taken.set(s, p);
  }
  const list = [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // A path with no last segment produces the EMPTY string by rule, and an empty slug is a document written as
  // "<prefix>-.md" that nothing can cite. Two paths do it: the root path, which a harvested site may now take
  // (etrade.gov.et's home page IS its catalogue), and a path that is nothing but a two-letter locale, like the
  // National Bank's /am - which was found by running it and naming it in pathSlugs after the fact. It stops
  // here now, for the same reason and with the same remedy as a percent-encoded path.
  for (const p of list) if (!(slugOf && slugOf(p)) && !named[p.path]
    && (needsName.test(String(p.path)) || !slugFor(String(p.path)))) {
    throw new Error('this path needs a name in the site pathSlugs table, it cannot be slugged by rule: ' + p.path);
  }
  const out = list.map(p => ({ ...p, slug: named[p.path] || (slugOf && slugOf(p)) || slugFor(p.path) }));
  for (let take = 3; take <= 8; take++) {
    const count = new Map();
    for (const p of out) count.set(p.slug, (count.get(p.slug) || 0) + 1);
    const clashing = [...count].filter(([, n]) => n > 1).map(([s]) => s);
    if (!clashing.length) break;
    for (const p of out) if (clashing.includes(p.slug) && !named[p.path] && !(slugOf && slugOf(p))) p.slug = slugFor(p.path, take) || clean(p.path);
  }
  return out;
}

// ---------- the extractor ----------
// htmlToText is the index's own converter: it drops head, script, style, nav, footer, header, noscript, svg
// and form, turns h1-h3 into markdown headings, li into "- ", and table cells into " | " rows. Using it
// rather than a second implementation means a page reads in the pack exactly as it would read in the index.
const { htmlToText } = require(path.join(ROOT, 'knowledge', 'index.js'));

// Every site brands its <title> differently, so the suffix to strip is the site's own business and lives in
// its registry entry as `titleSuffix` (a regular expression, as a string). A site that names none keeps its
// whole title. The airline's own pattern now sits in knowledge/travel/sources.json, where it belongs.
const suffixRe = s => { try { return s ? new RegExp(s, 'i') : null; } catch (e) { return null; } };
// The airline answers 200 with this title for a path that does not exist - /am/ (Armenia) does it today.
const NOT_FOUND = /^(page not found|404|not found)$/i;
const MIN_CHARS = 400;   // the same floor knowledge/index.js puts under a crawled page
// Below this many live documents a pack is too small for "most of them vanished" to mean anything, so the
// guard stays out of the way of a first run and of a small site.
const MASS_LOSS_FLOOR = 20;

function cleanTitle(raw, titleSuffix) {
  const re = suffixRe(titleSuffix);
  const t = htmlToText('<p>' + String(raw || '') + '</p>').replace(/\s+/g, ' ');
  return (re ? t.replace(re, '') : t).trim();
}

// { ok:true, title, text, chars } or { ok:false, why } where why is empty | soft_404 | thin.
function extract(html, { titleSuffix } = {}) {
  const s = String(html || '');
  if (s.length < 200 || !/<html|<body|<div/i.test(s)) return { ok: false, why: 'empty' };
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const title = cleanTitle(m ? m[1] : '', titleSuffix);
  if (NOT_FOUND.test(title)) return { ok: false, why: 'soft_404' };
  const text = htmlToText(s);
  if (text.trim().length < MIN_CHARS) return { ok: false, why: 'thin' };
  return { ok: true, title: title || '(untitled)', text, chars: text.length };
}

// ---------- documents on disk ----------
const crypto = require('crypto');
const { stripBoilerplate } = require(path.join(ROOT, 'knowledge', 'index.js'));

// The mega-menu and the site-wide notices (a Kigali roadworks advisory, a Russian card-payment notice, an
// Israel transit notice) are on EVERY page, so they cannot be spotted from one page. knowledge/index.js
// already solves this for crawled sites and is exported: any paragraph that appears on a large share of one
// site's pages is template, not content. It groups by the first path segment of the slug, so the site id is
// borrowed as that segment here and taken off again afterwards.
function stripPackBoilerplate(pages) {
  const wrapped = pages.map(p => ({ ...p, slug: p.siteId + '/' + p.slug }));
  const stripped = stripBoilerplate(wrapped, { minPages: 4, ratio: 0.15 });
  return stripped.map(p => ({ ...p, slug: p.slug.slice(p.siteId.length + 1), text: p.text.trim() }));
}

// Stripping the template can take a page under the floor: a page that was mostly mega-menu has almost
// nothing left once the mega-menu goes. The floor is therefore checked again AFTER stripping, and such a
// page is reported as thin rather than written to disk as a near-empty document.
function splitThin(docs) {
  const kept = [], thin = [];
  for (const d of docs) (String(d.text || '').trim().length >= MIN_CHARS ? kept : thin).push(d);
  return { kept, thin };
}

// Whitespace-insensitive so a reflowed paragraph is not "a change"; sensitive to everything else, because
// 23 kg becoming 32 kg is exactly what the weekly check exists to catch.
const normText = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
function contentHash(text) { return crypto.createHash('sha1').update(normText(text)).digest('hex'); }

const esc = s => String(s).replace(/"/g, '\\"');
// knowledge/index.js parses front matter line by line with /^(\w+):\s*"?(.*?)"?\s*$/, so every key is a
// single word and every value is one line. Order is fixed so a diff of two runs shows only what moved.
// Bumped whenever renderDoc changes the shape of a document. writePack re-renders anything older, so the
// pack is never half one format and half the other - and a re-render is not reported as a change, because the
// airline changed nothing.
const PACK_FORMAT = '2';
const FM_KEYS = ['url', 'title', 'titleAm', 'source_name', 'section', 'lang', 'part', 'pages', 'text_source',
  'ocr_quality', 'status', 'fetchedAt', 'lastChecked',
  'firstFetched', 'goneAt', 'missedAt', 'contentHash', 'generated_by', 'packFormat'];
function frontMatter(meta) {
  const lines = ['---'];
  for (const k of FM_KEYS) if (meta[k] !== undefined && meta[k] !== null && meta[k] !== '') lines.push(k + ': "' + esc(meta[k]) + '"');
  lines.push('---');
  return lines.join('\n');
}
function readMeta(md) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(String(md));
  if (!fm) return {};
  const meta = {};
  for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
  return meta;
}
function bodyOf(md) { const fm = /^---\n[\s\S]*?\n---\n/.exec(String(md)); return fm ? String(md).slice(fm[0].length) : String(md); }

// ---------- the Amharic header sidecar ----------
// Six of the seven fetched institutions in the banking pack publish nothing in Amharic, so every document of
// theirs opens in English, and an Amharic question can keyword-match only the one templated Amharic sentence
// the header already carries - which is word for word the same on every page, and therefore tells no two
// documents apart. ops/packs/am-headers.js writes knowledge/<pack>/am-headers.json: for each English
// document, an Amharic title and a two-or-three-sentence Amharic summary, generated from that page's own text
// and checked digit by digit against it. This file only READS that sidecar; it generates nothing.
// A pack asks for it with "amHeaders": true in its registry `pack` block. A pack that does not - travel -
// renders exactly the bytes it rendered before any of this existed, which test/packs/airline-identity.test.js
// holds it to.
const AM_HEADERS = 'am-headers.json';
function readAmHeaders(pack) {
  try { return JSON.parse(fs.readFileSync(path.join(packDir(pack), AM_HEADERS), 'utf8')); } catch (e) { return null; }
}
// Which sidecar entry, if any, a document may use. English documents only: an Amharic page already opens in
// Amharic, and giving it a second Amharic title would restate the bank's own words in ours.
function amEntry(page, site, pack, amHeaders) {
  if (!pack || !pack.amHeaders || !amHeaders) return null;
  if ((page.lang || langFor(site, page.path)) !== 'en') return null;
  const e = amHeaders[page.slug];
  if (!e || !(e.titleAm || e.summaryAm)) return null;
  // The entry was generated from ONE version of this page's text and stamped with that text's hash. When the
  // institution edits the page, the summary describes last week's page - a fee that moved, a product that
  // went - which is worse than no Amharic summary at all, because it reads like this week's. Such an entry is
  // ignored until ops/packs/am-headers.js writes it again from the new text, which ops/packs/freshness.js
  // makes it do in the same weekly run that noticed the change.
  if (e.contentHash && e.contentHash !== contentHash(page.text)) return null;
  return e;
}
// The grounding rule, enforced in code rather than trusted to the model: every run of digits in an Amharic
// title or summary must appear, digit for digit, in the page text. Thousands separators are normalised away
// (a bank writes 1,000 where a sentence may write 1000) and Ethiopic punctuation and spacing never matter,
// because only the digits are compared. A summary naming a figure its page does not name is not a summary of
// that page and is refused: the generator keeps the title and drops the summary rather than publish a number
// nobody published.
const digitRuns = s => (String(s || '').match(/[0-9][0-9.,]*/g) || [])
  .map(d => d.replace(/[.,]+$/, '').replace(/,/g, '')).filter(Boolean);
function ungroundedFigures(text, ...strings) {
  const have = new Set(digitRuns(text));
  const bad = [];
  for (const s of strings) for (const d of digitRuns(s)) if (!have.has(d) && !bad.includes(d)) bad.push(d);
  return bad;
}
// The page text of a document already on disk: everything after the header. The header's last paragraph is
// the one every registry's headerEnTemplate opens with, so the text starts after that paragraph however many
// paragraphs the header has - three today, four once a sidecar entry adds a summary. null means the file was
// not written by this renderer, and a caller must leave it alone rather than guess where its text begins.
// A correction note (see "corrections" below) sits INSIDE the page text, directly after the passage it
// corrects, so it is taken out again here: the page text is what the institution published, and what
// contentHash, the Amharic sidecar and the next re-render all read.
function bodyText(md) {
  const parts = bodyOf(md).split('\n\n');
  for (let i = 0; i < Math.min(parts.length, 8); i++) {
    if (/^Source: https?:\/\//.test(parts[i].trim())) return stripCorrections(parts.slice(i + 1).join('\n\n')).trim();
  }
  return null;
}

// ---------- corrections ----------
// Some institutions' pages restate a rule that has since changed: the Investment Commission's FAQ still gives
// overtime "from 1.25x", which is the repealed 377/2003 rate, and the model trusted it over the law. Editing
// that page by hand is wrong twice: the page must stay as the institution published it, and the weekly
// refetch would overwrite the edit anyway. So a pack's sources.json may carry a `corrections` array:
//   { slug, match, noteEn, noteAm, authority, authorityDoc, checked }
// renderDoc inserts the note as its own paragraph directly after the line holding `match` (a literal, or a
// regular expression written /like this/flags), and adds a one-line flag to the header. Every figure in
// noteEn and noteAm must appear in the authority's own text (knowledge/law/<authorityDoc>.md), or the render
// refuses: a correction can never introduce a number. If `match` is no longer on the page, the page changed;
// the document is still written, untouched, and the miss is reported to the caller and the weekly note.
const LAW_DIR = path.join(ROOT, 'knowledge', 'law');
const CORR_MARK = '⚠️ Correction by BinaSmart';
const CORR_RE = /\n\n⚠️ Correction by BinaSmart[^\n]*\n?/g;
const stripCorrections = text => String(text == null ? '' : text).replace(CORR_RE, '');
const CORR_FLAG_EN = '⚠️ BinaSmart has added a correction to this page: a passage below restates a rule that has since changed, and the current rule, with its legal authority, is marked directly after that passage. The page itself is left exactly as the institution published it.';
const CORR_FLAG_AM = '⚠️ ቢናስማርት በዚህ ገጽ ላይ እርማት አክሏል፦ ከታች ያለው አንድ ክፍል የተቀየረ ደንብ ይደግማል፤ የአሁኑ ደንብና ሕጋዊ ምንጩ ከዚያ ክፍል ቀጥሎ ተጠቅሰዋል። ገጹ ራሱ ተቋሙ ባሳተመው መልኩ ነው።';

function authorityTextOf(c, { lawDir = LAW_DIR } = {}) {
  if (c.authorityText != null) return String(c.authorityText);
  const name = String(c.authorityDoc || '');
  if (!/^[a-z0-9][a-z0-9-]{1,150}$/.test(name)) {
    throw new Error('[pack] correction for ' + c.slug + ' refused: authorityDoc must name a knowledge/law/ document without .md, got ' + JSON.stringify(name));
  }
  try { return fs.readFileSync(path.join(lawDir, name + '.md'), 'utf8'); }
  catch (e) { throw new Error('[pack] correction for ' + c.slug + ' refused: authority document not found: knowledge/law/' + name + '.md'); }
}
function findPassage(text, match) {
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(String(match || ''));
  if (m) {
    const r = new RegExp(m[1], m[2].replace(/g/g, '')).exec(text);
    return r ? { start: r.index, end: r.index + r[0].length } : null;
  }
  const i = match ? text.indexOf(String(match)) : -1;
  return i >= 0 ? { start: i, end: i + String(match).length } : null;
}
function correctionNote(c) {
  return CORR_MARK + ' (checked ' + c.checked + '): ' + String(c.noteEn).trim() + ' · በአማርኛ፦ ' + String(c.noteAm).trim()
    + ' (' + c.authority + ')';
}
// Returns { text, applied: [correction], unmatched: [correction] }. Idempotent: notes already in the text are
// taken out first, so a document rendered from its own rendered text carries each note once.
function applyCorrections(text, slug, corrections, opts = {}) {
  let out = stripCorrections(text);
  const applied = [], unmatched = [];
  for (const c of (Array.isArray(corrections) ? corrections : []).filter(x => x && x.slug === slug)) {
    for (const k of ['match', 'noteEn', 'noteAm', 'authority', 'checked']) {
      if (!c[k]) throw new Error('[pack] correction for ' + slug + ' refused: it has no ' + k);
    }
    for (const k of ['noteEn', 'noteAm']) if (/\n/.test(c[k])) throw new Error('[pack] correction for ' + slug + ' refused: ' + k + ' must be one line');
    const bad = ungroundedFigures(authorityTextOf(c, opts), c.noteEn, c.noteAm);
    if (bad.length) {
      throw new Error('[pack] correction for ' + slug + ' refused: ' + bad.join(', ') + ' not found in the authority text ('
        + (c.authorityDoc || c.authority) + ') - a correction may not introduce a figure');
    }
    const hit = findPassage(out, c.match);
    if (!hit) { unmatched.push(c); continue; }
    // After the line the passage ends on, never inside it: the institution's sentence stays whole.
    let at = out.indexOf('\n', Math.max(hit.start, hit.end - 1));
    if (at < 0) at = out.length;
    out = out.slice(0, at) + '\n\n' + correctionNote(c) + '\n' + out.slice(at);
    applied.push(c);
  }
  return { text: out, applied, unmatched };
}
// Two renders of one document differ in the two lines that move on their own: lastChecked advances every run,
// and missedAt is cleared by a run that succeeds. Everything else - the front matter, the header, the text -
// is what "did this document really change" means.
const VOLATILE = /^(?:lastChecked|missedAt): ".*"\n/gm;
const sameDoc = (a, b) => String(a).replace(VOLATILE, '') === String(b).replace(VOLATILE, '');

// What the page itself says it is about: its own H1-H3 headings, copied, never invented. htmlToText leaves
// some of this site's headings as a bare "##" with the label on the next line, so that shape is read too. A
// heading holding a digit is dropped - a figure in a header written by this script would be a fact restated
// outside the page text, which the design forbids and the tests check for.
function pageHeadings(text, title, max = 8) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  const t = String(title || '').toLowerCase().trim();
  for (let i = 0; i < lines.length; i++) {
    const m = /^#{1,3}[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let h = m[1].trim();
    if (!h) { let j = i + 1; while (j < lines.length && !lines[j].trim()) j++; h = (lines[j] || '').trim(); }
    h = h.replace(/\s+/g, ' ').trim();
    if (!h || h.length > 70 || /\d/.test(h)) continue;
    if (h.toLowerCase() === t) continue;
    if (!out.some(x => x.toLowerCase() === h.toLowerCase())) out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

// The header states provenance and what the page is, and nothing else. It must never contain a figure: a kilo
// or a fee in a header written by this script would be a fact from memory, which is the one thing the design
// forbids.
//
// Why "what the page is" comes first. Every document used to open with the same two provenance paragraphs, so
// the first chunk of all ~125 pages read alike. knowledge/index.js shows its reranker a title and 420
// characters of each candidate, and an Amharic question can only keyword-match the Amharic line - which was
// also the same on every page. The first measured run of Task 10 retrieved the right page and then dropped it
// nine times for exactly that reason. The page's own name, section and headings, first, are what tell one
// document of this pack from another. Every word of it is copied from the page or from sources.json.
//
// ከ is the Amharic "from" prefix, and nameAm is የኢትዮጵያ ..., whose leading የ is itself a
// prefix: ከየኢትዮጵያ is not a word. Drop that የ so the header reads ከኢትዮጵያ አየር መንገድ.
const fromAm = name => 'ከ' + String(name || '').replace(/^የ/, '');

// Which language a page is written in. Most sites are one language throughout and say so with `lang`. Zemen
// is not: its /am/ pages are genuinely Amharic and the rest of the site is English, so it carries
// langOverrides and a page's own path decides. This matters twice over — the header must not tell a reader
// an Amharic page is in English, and knowledge/index.js scores a cross-lingual match differently.
function langFor(site, p) {
  for (const o of (site && site.langOverrides) || []) if (new RegExp(o.match).test(String(p || ''))) return o.lang;
  return (site && site.lang) || 'en';
}

// The wording belongs to the pack, not to this file. The airline says "the airline publishes no Amharic page";
// a bank says "rates and fees change, confirm before you act". Both are registry text, filled in here.
// The placeholders, and nothing else, are substituted: {siteName} {sectionAm} {title} {fromAm} {url}
// {langWord} {today} {disclaimerEn} {disclaimerAm}. Every one of them is copied from the page or the
// registry, so the header can never contain a figure this code invented.
function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));
}

// ---------- personal numbers ----------
// The rule this serves: no full personal phone number enters the public repository. A registry site that sets
// `maskPhones` is one whose pages carry people's mobile numbers - mols.gov.et publishes the manager's mobile
// for each of the 1,222 licensed overseas employment agencies - and a register like that, once it sits in a
// git repository, is a harvestable list rather than a page somebody has to visit. The number is not deleted:
// the last four digits stay, so a person holding that number can still confirm an entry is theirs, and the
// institution's own page still carries it in full.
//
// An Ethiopian mobile is distinguishable from an office line, and this uses that rather than guessing.
// Mobiles are 09x (Ethio Telecom) and 07x (Safaricom Ethiopia), so in international form they are 251
// followed by 9 or 7. Landlines are 011, 022, 025, 033, 034, 046, 047, 057, 058 - 251 followed by 1, 2, 3, 4
// or 5 - so a switchboard like +251 11 551 0033 and a short code like 8482 or 6333 are left exactly as the
// institution published them. Separators inside the number are allowed (+251-900-000-004), and a digit on
// either side disqualifies the match, so a longer reference number is never half-masked. (The example
// numbers in this comment and in test/business/mask-phones.test.js are invented, not the register's.)
const MOBILE_RE = /(?<![0-9])(\+?251)[ -]?([79](?:[ -]?[0-9]){8})(?![0-9])/g;
const MASKED_RE = /251\u2022{5}[0-9]{4}/;
const maskPhones = text => String(text == null ? '' : text)
  .replace(MOBILE_RE, m => '251' + '\u2022'.repeat(5) + m.replace(/[^0-9]/g, '').slice(-4));

function header(page, site, today, pack, amh, corrected = false) {
  const heads = pageHeadings(page.text, page.title);
  const lang = page.lang || langFor(site, page.path);
  const vars = {
    siteName: site.name, sectionAm: page.sectionTitleAm || '', title: page.title || page.slug,
    fromAm: fromAm(site.nameAm), url: page.url, today,
    langWord: lang === 'am' ? 'in Amharic' : 'in English',
    langWordAm: lang === 'am' ? 'በአማርኛ' : 'በእንግሊዝኛ',
    ocrPages: page.ocrPages == null ? '' : String(page.ocrPages),
    ocrQuality: page.ocrQuality || '',
    part: page.parts > 1 ? String(page.part) : '', parts: page.parts > 1 ? String(page.parts) : '',
    disclaimerEn: (pack && pack.disclaimerEn) || '', disclaimerAm: (pack && pack.disclaimerAm) || '',
  };
  const what = site.name + ' — ' + (page.section ? page.section + ' — ' : '') + (page.title || page.slug) + '.'
    + (heads.length ? ' On this page: ' + heads.join(', ') + '.' : '');
  const am = 'በአማርኛ፦ ' + (page.sectionTitleAm ? page.sectionTitleAm + ' — ' : '') + (page.title || page.slug) + '። '
    + fill(pack && pack.headerAmTemplate, vars);
  const en = fill(pack && pack.headerEnTemplate, vars);
  // The Amharic summary of an English page belongs between the Amharic sentence and the Source line: after
  // everything else said in Amharic, before the provenance. Every figure in it is a figure the page itself
  // prints - ungroundedFigures above is what makes that true, and am-headers.js drops a summary that fails it.
  //
  // A document read by OCR says so, in the header where a reader will see it and not only in front matter a
  // reader never opens. The National Bank wrote these rules; a machine read them off a photograph, and a
  // figure in one of them may be a figure the machine got wrong. The wording is the pack's, like every other
  // sentence here, and a pack that sets no ocrNoteEn adds nothing - which is how the travel pack renders
  // exactly the bytes it always did. It goes BEFORE the Source paragraph because bodyText() finds the page
  // text by that paragraph, and anything after it would be read back as part of the page.
  const ocrNote = page.textSource === 'ocr' ? fill(pack && pack.ocrNoteEn, vars) || null : null;
  const ocrNoteAm = page.textSource === 'ocr' ? fill(pack && pack.ocrNoteAm, vars) || null : null;
  // A page whose numbers were masked says so, on the page, where a reader meets a number ending in bullets -
  // and only if this page actually holds one, so a site that sets maskPhones does not stamp the note on the
  // twenty pages of its own that never carried a mobile number. Like ocrNote it goes BEFORE the Source
  // paragraph, because bodyText() finds the page text by that paragraph and anything after it is read back
  // as part of the page.
  const masked = !!(site && site.maskPhones && MASKED_RE.test(page.text || ''));
  const maskNote = masked ? fill(pack && pack.maskNoteEn, vars) || null : null;
  const maskNoteAm = masked ? fill(pack && pack.maskNoteAm, vars) || null : null;
  // The correction flag, like the other notes, goes BEFORE the Source paragraph, and only on a page where a
  // correction actually landed. It carries no figure: the figures are in the note, checked against the law.
  const corr = corrected ? CORR_FLAG_EN + ' ' + CORR_FLAG_AM : null;
  return [what, am, (amh && amh.summaryAm) || null, ocrNoteAm, ocrNote, maskNoteAm, maskNote, corr, en].filter(Boolean).join('\n\n');
}

// `corrections` is the registry's corrections array; `onUnmatched(slug, correction)` hears about a correction
// whose passage is no longer on the page. Without a callback the miss is logged, never swallowed.
function renderDoc(page, site, { today, firstFetched, pack, amHeaders, corrections, onUnmatched } = {}) {
  const fixed = applyCorrections(page.text, page.slug, corrections);
  for (const c of fixed.unmatched) {
    if (onUnmatched) onUnmatched(page.slug, c);
    else console.log('[' + ((pack && pack.logPrefix) || (pack && pack.id) || 'pack') + '] correction no longer matches ' + page.slug);
  }
  const amh = amEntry(page, site, pack, amHeaders);
  const titleAm = (amh && amh.titleAm) || '';
  const title = site.name + ' — ' + (page.title || page.slug);
  const meta = { url: page.url, title, titleAm, source_name: site.name, section: page.section || '',
    lang: page.lang || langFor(site, page.path),
    // A document split out of a long one says which part of it this is, and both parts carry the same url,
    // so a citation still points at the one PDF the institution published. A document that was not split
    // carries no part line at all.
    part: page.parts > 1 && page.part ? page.part + ' of ' + page.parts : '',
    pages: page.ocrPages == null ? '' : String(page.ocrPages),
    text_source: page.textSource || '', ocr_quality: page.ocrQuality || '',
    status: 'live', fetchedAt: today, lastChecked: today, firstFetched: firstFetched && firstFetched !== today ? firstFetched : '',
    contentHash: contentHash(page.text), generated_by: (pack && pack.generatedBy) || 'ops/travel/fetch-airline.js',
    packFormat: (pack && pack.packFormat) || PACK_FORMAT };
  return frontMatter(meta) + '\n\n# ' + title + (titleAm ? ' · ' + titleAm : '')
    + '\n\n' + header(page, site, today, pack, amh, fixed.applied.length > 0) + '\n\n' + fixed.text.trim() + '\n';
}

// Rewrite exactly one line. Used when a page is unchanged: the body must stay byte-identical (so git shows
// nothing and the ingest's hash finds nothing to do) while the record of when we last looked still advances.
function touchLastChecked(file, today) {
  const cur = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, cur.replace(/^lastChecked: ".*"$/m, 'lastChecked: "' + esc(today) + '"'));
}

// The page answered again, so the miss is over. Rewrite the front matter without missedAt, leaving the body
// byte-identical: two misses a month apart are not two misses running.
function clearMissed(file, today) {
  const cur = fs.readFileSync(file, 'utf8');
  const meta = readMeta(cur);
  delete meta.missedAt;
  meta.lastChecked = today;
  fs.writeFileSync(file, frontMatter(meta) + '\n' + bodyOf(cur));
}

// The only three answers that mean a page is really not there any more. Everything else - a timeout, a 5xx,
// a DNS blip, a page that went thin - is the network having a bad Sunday, and must never orphan the chunks
// of a page that is still published. Those get one miss recorded and a week to come back.
const DEAD = { http_404: '404', http_410: '410', soft_404: 'the page says not found' };
const normUrl = u => String(u || '').replace(/\/+$/, '');

// docs: [{ siteId, slug, path, url, title, section, sectionTitleAm, text }] for ONE site, already stripped.
// failed: [{ url, why }] exactly as fetchSite reports it - what did not come back this run, and why.
// Returns { added, changed, unchanged, gone, goneWhy, missed, revived } as lists of slugs.
function writePack(dir, docs, site, { today, dryRun = false, failed = [], pack, amHeaders, corrections } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  // Every renderDoc below hears about a correction whose passage has left the page; the list goes back to the
  // caller as `uncorrected`, which is how the weekly note learns of it.
  const uncorrected = [];
  const onUnmatched = slug => {
    if (!uncorrected.includes(slug)) uncorrected.push(slug);
    console.log('[' + ((pack && pack.logPrefix) || (pack && pack.id) || 'pack') + '] correction no longer matches ' + slug);
  };
  // Masked BEFORE anything hashes or writes it, so contentHash is the hash of what the repository actually
  // holds and the unchanged-check below compares like with like. Re-fetching the same page therefore reads
  // as unchanged, rather than as 805 numbers that moved.
  if (site && site.maskPhones) for (const d of docs) d.text = maskPhones(d.text);
  const day = today || new Date().toISOString().slice(0, 10);
  const r = { added: [], changed: [], unchanged: [], gone: [], goneWhy: {}, missed: [], revived: [], reformatted: [], uncorrected };
  const deadUrls = new Map();
  for (const f of failed || []) { const w = DEAD[f.why]; if (w) deadUrls.set(normUrl(f.url), w); }
  const wanted = new Map(docs.map(d => [d.slug, d]));
  const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

  for (const [slug, d] of wanted) {
    const file = path.join(dir, slug + '.md');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const oldMeta = old ? readMeta(old) : null;
    if (oldMeta && oldMeta.contentHash === contentHash(d.text) && oldMeta.status !== 'gone') {
      r.unchanged.push(slug);
      // The page did not change, but the way this script writes a page did - a new packFormat, or an Amharic
      // header the sidecar did not hold last time. Re-render it from the text that just came off the site,
      // keeping the day the content was fetched, and keep it out of `changed`: the weekly note is about what
      // the airline did, not about what we did.
      const fresh = renderDoc(d, site, { today: oldMeta.fetchedAt || day, firstFetched: oldMeta.firstFetched || oldMeta.fetchedAt || day, pack, amHeaders, corrections, onUnmatched });
      if (oldMeta.packFormat !== PACK_FORMAT || !sameDoc(fresh, old)) {
        r.reformatted.push(slug);
        if (dryRun) continue;
        fs.writeFileSync(file, fresh);
        touchLastChecked(file, day);
        continue;
      }
      if (!dryRun && oldMeta.missedAt) clearMissed(file, day);
      else if (!dryRun && oldMeta.lastChecked !== day) touchLastChecked(file, day);
      continue;
    }
    // A document fetched over the network was fetched today. A document built from a harvest was fetched on
    // the day the harvest captured those bytes, and saying otherwise would date a 2026-09-16 tariff to
    // whatever day we happened to run the importer - which is the one thing every header in this pack promises
    // not to do. `lastChecked` still means today: we looked at it today, at bytes captured then.
    const dday = d.fetchedAt || day;
    const first = (oldMeta && (oldMeta.firstFetched || oldMeta.fetchedAt)) || dday;
    if (!old) r.added.push(slug); else { r.changed.push(slug); if (oldMeta.status === 'gone') r.revived.push(slug); }
    if (!dryRun) {
      fs.writeFileSync(file, renderDoc(d, site, { today: dday, firstFetched: first, pack, amHeaders, corrections, onUnmatched }));
      if (dday !== day) touchLastChecked(file, day);
    }
  }

  // A failed fetch must never look like a deleted site. If most of what is on disk is suddenly missing from
  // the fetch, that is the network, not the airline: refuse the whole gone pass and say so. This is the same
  // refusal knowledge/index.js makes before collecting orphaned chunks, for the same reason.
  const live = onDisk.filter(f => readMeta(fs.readFileSync(path.join(dir, f), 'utf8')).source_name === site.name
    && readMeta(fs.readFileSync(path.join(dir, f), 'utf8')).status !== 'gone');
  if (live.length >= MASS_LOSS_FLOOR && wanted.size < live.length / 2) {
    return { ...r, refused: true, refusedWhy: 'only ' + wanted.size + ' of ' + live.length + ' pages came back' };
  }
  for (const f of onDisk) {
    const slug = f.replace(/\.md$/, '');
    if (wanted.has(slug)) continue;
    const cur = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = readMeta(cur);
    if (meta.source_name !== site.name) continue;        // another site's document in the same directory
    if (meta.status === 'gone') continue;                // already marked, do not report it again every week
    // A page is gone when the site SAYS it is gone, or when it has been missing two runs running. One
    // timeout is not a deletion: record the miss, leave the document live and indexed, and let next
    // Sunday decide. Anything else drops a week of answers on the floor over a network blip.
    const dead = deadUrls.get(normUrl(meta.url));
    if (!dead && !meta.missedAt) {
      r.missed.push(slug);
      if (dryRun) continue;
      fs.writeFileSync(path.join(dir, f), frontMatter({ ...meta, missedAt: day, lastChecked: day }) + '\n' + bodyOf(cur));
      continue;
    }
    r.gone.push(slug);
    r.goneWhy[slug] = dead || 'missing two runs running';
    if (dryRun) continue;
    const next = { ...meta, status: 'gone', goneAt: day, lastChecked: day };
    delete next.missedAt;                                // the miss is spent
    fs.writeFileSync(path.join(dir, f), frontMatter(next) + '\n' + bodyOf(cur));
  }
  return r;
}

// ---------- re-render, without fetching ----------
//   node ops/packs/fetch-pack.js --pack banking --rerender
// Write every live document of a pack through renderDoc again, from the text already on disk. No network, and
// no institution is bothered: this exists for a change to the HEADER - a new Amharic sidecar entry, a new
// template - which must not look like a change to the page. contentHash, fetchedAt, firstFetched and
// lastChecked are carried through exactly as they stood, so the ingest re-chunks the document while the
// freshness record still says the institution changed nothing. Reported as re-rendered, never as changed.
function rerenderPack(dir, reg, { dryRun = false, amHeaders = null } = {}) {
  const r = { rerendered: [], unchanged: [], skipped: [], uncorrected: [] };
  const sites = new Map((reg.sites || []).map(s => [s.name, s]));
  const corrections = reg.corrections || [];
  const onUnmatched = slug => {
    if (!r.uncorrected.includes(slug)) r.uncorrected.push(slug);
    console.log('[' + ((reg.pack && reg.pack.logPrefix) || (reg.pack && reg.pack.id) || 'pack') + '] correction no longer matches ' + slug);
  };
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md')).sort()) {
    const slug = f.replace(/\.md$/, '');
    const file = path.join(dir, f);
    const old = fs.readFileSync(file, 'utf8');
    const meta = readMeta(old);
    const site = sites.get(meta.source_name);
    let text = site ? bodyText(old) : null;
    // A re-render re-applies the mask, and that is what makes it durable: a document that reached the
    // repository with full numbers is masked by the next --rerender rather than quietly kept as it is.
    if (text && site.maskPhones) text = maskPhones(text);
    // A document no site in this registry wrote, one this renderer did not produce, and one whose page is
    // already gone are all left exactly as they are - and counted, because silence would be worse.
    if (!site || !text || meta.status === 'gone') { r.skipped.push(slug); continue; }
    const p = pathOf(meta.url);
    // The document's own recorded section decides, and only a document that has none is matched again by
    // path. A re-render must not move a page between sections: pathOf throws the query away, and the M-PESA
    // fee table's url is a fragment on the home page rather than a path of its own, so matching by path alone
    // would rename its section every Sunday. Where a document records the section it was written with, every
    // site in the travel pack included, this finds exactly the entry that wrote it.
    const sec = (meta.section && (site.sections || []).find(s => s.key === meta.section)) || sectionOf(site, p || '');
    const pre = site.name + ' — ';
    // A re-render must not quietly drop what the document already records about where its text came from:
    // an OCR document that came back as an ordinary one would lose its quality grade, its page count and the
    // sentence telling a reader a machine read it off a photograph.
    const pt = /^(\d+) of (\d+)$/.exec(meta.part || '');
    const page = { url: meta.url, path: p, slug, lang: meta.lang, text,
      title: meta.title && meta.title.slice(0, pre.length) === pre ? meta.title.slice(pre.length) : meta.title,
      section: meta.section || (sec ? sec.key : null), sectionTitleAm: sec ? sec.titleAm : null,
      textSource: meta.text_source || '', ocrQuality: meta.ocr_quality || '',
      ocrPages: meta.pages === undefined || meta.pages === '' ? null : meta.pages,
      part: pt ? Number(pt[1]) : null, parts: pt ? Number(pt[2]) : 1 };
    let fresh = renderDoc(page, site, { today: meta.fetchedAt, firstFetched: meta.firstFetched || meta.fetchedAt, pack: reg.pack, amHeaders, corrections, onUnmatched });
    // renderDoc writes lastChecked from the day it is given, and the day it is given here is the day the page
    // was fetched. Put the record of when we last looked back exactly as it stood.
    if (meta.lastChecked) fresh = fresh.replace(/^lastChecked: ".*"$/m, 'lastChecked: "' + esc(meta.lastChecked) + '"');
    if (fresh === old) { r.unchanged.push(slug); continue; }
    r.rerendered.push(slug);
    if (!dryRun) fs.writeFileSync(file, fresh);
  }
  return r;
}

// ---------- the network ----------
// One request at a time, the registry's crawl delay between them, a 40 s timeout, one retry for a 5xx or a
// timeout and none for a 404. fetchImpl and sleep are injected so the tests never touch a network.
function makeFetcher({ fetchImpl, sleep, delayMs = 5000, ua = UA, timeoutMs = 40000 } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  let first = true;
  return async function get(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (first) first = false; else await zz(delayMs);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await f(url, { signal: ctrl.signal, redirect: 'follow',
          headers: { 'user-agent': ua, 'accept-language': 'en', accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
        if (r.status === 404 || r.status === 410) return { ok: false, why: 'http_' + r.status };
        if (r.status !== 200) { if (attempt) return { ok: false, why: 'http_' + r.status }; continue; }
        const ct = String(r.headers.get('content-type') || '');
        const buf = Buffer.from(await r.arrayBuffer());
        if (/xml|gzip|octet-stream/.test(ct) || /\.(xml|gz)$/.test(new URL(url).pathname)) return { ok: true, buf, ct };
        if (!/text\/html/.test(ct)) return { ok: false, why: 'not_html' };
        return { ok: true, buf, ct, html: buf.toString('utf8') };
      } catch (e) {
        if (attempt) return { ok: false, why: e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 60) };
      } finally { clearTimeout(t); }
    }
    return { ok: false, why: 'unreachable' };
  };
}

// Absolute, same-host, fragment-free links. Never another host: the pack is the airline's own pages.
function linksOn(html, base) {
  const out = new Set();
  let host; try { host = new URL(base).host; } catch (e) { return []; }
  for (const m of String(html).matchAll(/href\s*=\s*["']([^"'\s]+)["']/gi)) {
    let u; try { u = new URL(m[1], base); } catch (e) { continue; }
    if (u.host !== host || !/^https?:$/.test(u.protocol)) continue;
    u.hash = ''; u.search = '';
    out.add(u.toString().replace(/\/$/, ''));
  }
  return [...out];
}

// One site, start to finish. Returns { pages, failed, asked } where pages are ready for stripPackBoilerplate.
// `tag` is the pack's own logPrefix, threaded in rather than rewritten by whoever reads the line afterwards:
// a banking run whose progress says [travel] zemen: 233 urls reads as if the airline were being fetched, and
// the person reading a Sunday log at 06:30 has no way to tell. It defaults to travel, which is what every
// caller meant when travel was the only pack there was.
async function fetchSite(site, { fetchImpl, sleep, limit = 0, log = () => {}, tag = 'travel' } = {}) {
  const get = makeFetcher({ fetchImpl, sleep, delayMs: (site.crawlDelaySeconds || 5) * 1000 });
  const pages = [], failed = [];
  let seeds = [];
  if (site.fetch === 'sitemap') {
    const queue = sitemapsOf(site);
    const seen = new Set();
    while (queue.length) {
      const sm = queue.shift();
      if (seen.has(sm)) continue; seen.add(sm);
      const r = await get(sm);
      if (!r.ok) { failed.push({ url: sm, why: r.why }); continue; }
      const parsed = sitemapUrls(r.buf);
      seeds.push(...parsed.urls);
      for (const i of parsed.indexes) queue.push(i);
    }
  } else {
    seeds = [...(site.urls || [])];
  }
  seeds.push(...(site.seeds || []));
  let todo = selectUrls(site, seeds);
  if (limit) todo = todo.slice(0, limit);
  log('[' + tag + '] ' + site.id + ': ' + seeds.length + ' urls in the sitemap, ' + todo.length + ' selected');

  const fetched = new Map();
  const discovered = new Set();
  const take = async (list, round) => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (fetched.has(p.path)) continue;
      const r = await get(p.url);
      if (!r.ok) { failed.push({ url: p.url, why: r.why }); continue; }
      if (round === 1 && site.discoverLinks) for (const l of linksOn(r.html, p.url)) discovered.add(l);
      const ex = extract(r.html, { titleSuffix: site.titleSuffix });
      if (!ex.ok) { failed.push({ url: p.url, why: ex.why }); continue; }
      fetched.set(p.path, { ...p, siteId: site.id, title: ex.title, text: ex.text, lang: langFor(site, p.path) });
      if ((i + 1) % 10 === 0) log('[' + tag + '] ' + site.id + ' round ' + round + ': ' + (i + 1) + '/' + list.length);
    }
  };
  await take(todo, 1);
  if (site.discoverLinks && !limit) {
    const extra = selectUrls(site, [...discovered]).filter(p => !fetched.has(p.path));
    if (extra.length) log('[' + tag + '] ' + site.id + ': ' + extra.length + ' pages the sitemap did not list');
    await take(extra, 2);   // one level only: round 2 never harvests links
  }
  // One flat directory, six institutions. ECMA and EthSwitch both publish /contact-us; every WordPress site
  // publishes /about-us. Without the prefix the second site's document silently replaces the first's. With it,
  // a filename also says whose page it is, which is what an answer about a fee has to say anyway.
  const prefix = site.slugPrefix === false ? '' : (site.slugPrefix || site.id) + '-';
  pages.push(...assignSlugs([...fetched.values()], site).map(p => ({ ...p, slug: prefix + p.slug })));
  return { pages, failed };
}

// ---------- the local harvest: --from-dir ----------
// Three of the banking pack's sources do not answer this server at all: the National Bank sits behind a WAF,
// ethio telecom and m-pesa.safaricom.et answer inside Ethiopia and not from Paris. Their pages were fetched
// from a machine where they do answer and copied to /root/storage/packs/banking-manual/<host>/ — raw bytes,
// one file per URL, plus a manifest.json giving each file its url, status, content-type, sha256 and the moment
// it was captured.
//
// A site whose `fetch` is "dir" is built from that manifest instead of from the network. Nothing else about it
// is special: the same extract, the same stripPackBoilerplate, the same renderDoc, the same writePack, the same
// allow and deny discipline. What changes is where the bytes and the date come from — the manifest, not the
// clock — so a document says it was fetched on the day the harvest captured it, which is the day it is true of.
//
// The harvest itself never enters the repository. It stays in /root/storage, outside knowledge/, and only the
// curated documents this importer writes are committed.
const { execFileSync } = require('child_process');
const DIR_ROOT = '/root/storage/packs/banking-manual';
// A directive is not a book. 60,000 characters is about 20 pages of a PDF, past which a national payment
// strategy is a policy document being indexed as if it were an answer to a question about a fee.
const PDF_MAX_CHARS = 60000;

// ---------- the scanned directives: the OCR sidecar ----------
// A great many of the National Bank's rules are published as photographs of paper - a PDF with no text layer
// at all, for which pdftotext returns not a thin page but zero characters. Until this task the importer wrote
// no document for any of them, so the pack could not cite the Financial Consumer Protection directive, the
// currency directives, the fraud directive, the payment-instrument-issuer directives or the 2025 banking
// proclamation, and the previous report said so in those words.
//
// They were read by OCR on a workstation - this VPS's CPU is shared and throttled - and the text left beside
// the PDFs in <host>/ocr/: one <sha1>.ocr.txt per PDF, pages separated by a form feed, with an
// ocr-manifest.json giving each file its url, page count, language mode, the quality the run measured and,
// for the sixteen files the National Bank uploaded twice, `duplicate_of` naming the copy to keep.
//
// This importer READS that sidecar and never runs OCR. A harvest with no ocr/ folder behaves exactly as it
// did before, which is what the travel pack and every other `fetch: dir` site depend on.
const OCR_SUB = 'ocr';
const OCR_MANIFEST = 'ocr-manifest.json';
// Twice the text-layer cap, because two of these documents are proclamations - the Banking Business
// Proclamation 1360/2025 is 229,774 characters of OCR text - and a proclamation cut off at article 40 answers
// nothing asked about article 60. Past this the document is split at a PAGE BREAK into parts that each carry
// the same url and a part line, so the Source line stays true and a citation still points at the one PDF.
const OCR_MAX_CHARS = 120000;

function readOcrManifest(dir) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, OCR_SUB, OCR_MANIFEST), 'utf8')); }
  catch (e) { return null; }
  const rows = Array.isArray(raw) ? raw : (raw.files || raw.documents || []);
  if (!rows.length) return null;
  const byKey = new Map(), byStem = new Map();
  for (const f of rows) {
    const stem = String(f.file || '').replace(/\.ocr\.txt$/i, '');
    if (stem) byStem.set(stem, f);
    const key = dirKeyOf(f.url);
    if (key && !byKey.has(key)) byKey.set(key, f);
  }
  return { dir: path.join(dir, OCR_SUB), rows, byKey, byStem };
}

// The sidecar's title is the National Bank's own file name - FCP-01-2020.pdf, DIRECTVE_NO_MCR_02_2020.pdf -
// or, for the four documents re-fetched past the harvester's 15 MB cap, a sentence somebody typed. Cleaned
// means the extension off, the percent escapes decoded, the underscores made hyphens and the whitespace
// collapsed. No word is added and no number is changed. Where the file name is not the directive's own
// number - CMD-298-2023.pdf holds a directive numbered ከማዳ 3/2015, and fxd-65-2020.pdf holds FXD/80/2022 -
// the registry names the document by hand in `pdfTitles`, because a file name is not evidence about what is
// inside the file.
function ocrTitleOf(raw) {
  let t = String(raw || '').trim().replace(/\.pdf$/i, '');
  try { t = decodeURIComponent(t); } catch (e) { /* leave it encoded */ }
  return t.replace(/_+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// Split at the form feeds the OCR run wrote between pages, never inside one. A part is filled until the next
// page would take it past the cap. A single page longer than the cap goes into a part of its own and is left
// whole: cutting a page in half is the one thing this function exists to prevent.
function splitLongParts(text, maxChars = OCR_MAX_CHARS, sep = '\n') {
  const s = String(text == null ? '' : text);
  if (s.length <= maxChars) return [s];
  const parts = [];
  let cur = '';
  for (const pg of s.split(sep)) {
    if (cur && cur.length + sep.length + pg.length > maxChars) { parts.push(cur); cur = pg; }
    else cur = cur ? cur + sep + pg : pg;
  }
  if (cur.trim()) parts.push(cur);
  return parts.length ? parts : [s];
}
// A scanned document is split at the form feed the OCR run wrote between pages; an HTML page has no pages, so
// it is split at a line break instead, which is what keeps one agency's row in the mols register whole.
const splitOcrParts = (text, maxChars = OCR_MAX_CHARS) => splitLongParts(text, maxChars, '\f');
// The same ceiling as an OCR'd proclamation, for the same reason: past it a document is a library rather than
// an answer. mols.gov.et/agencies is 177,222 characters of licensed overseas employment agencies and becomes
// two documents, both citing the one page they came from.
const HTML_MAX_CHARS = 120000;

// The language of a scanned directive is a fact about its text, not about the folder it was uploaded to: the
// National Bank's currency directives are written in Amharic and sit on the same /wp-content/uploads/ path as
// the English ones. The floor is AM_FLOOR, the same one every other language decision in this file uses.
function ocrLangOf(text) {
  const eth = ethiopicCount(text);
  const lat = (String(text || '').match(/[A-Za-z]/g) || []).length;
  return eth >= AM_FLOOR && eth > lat ? 'am' : 'en';
}

// The key a harvested page is selected, deduplicated and named by. Two things the ordinary path is not:
//   - it keeps the query, because ethio telecom puts the language in ?lang=am and /telebirr/faq?lang=am is a
//     different document in a different language from /telebirr/faq;
//   - it lowercases the percent escapes, because the same Amharic URL was linked in both cases on that site
//     (/%E1%89%B4... and /%e1%89%b4...) and they are the same page by the URI standard's own rule.
function dirKeyOf(url) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const p = (u.pathname.replace(/\/+$/, '') || '/').replace(/%[0-9A-Fa-f]{2}/g, m => m.toLowerCase());
  return p + (u.search || '');
}

// A PDF is named after its own file, decoded and cleaned: FXD012024-FOREIGN-EXCHANGE-.pdf becomes
// fxd012024-foreign-exchange. The path it hangs off (/wp-content/uploads/2024/07/) says nothing about it.
const pdfSlugOf = p => {
  let b = String(p || '').split('?')[0].split('/').pop().replace(/\.pdf$/i, '');
  try { b = decodeURIComponent(b); } catch (e) { /* leave it encoded */ }
  return clean(b).slice(0, 60).replace(/-+$/, '');
};

// poppler's pdftotext, in layout mode so a fee table stays a table. A PDF with no text layer — and many of
// the National Bank's older directives are photographs of paper — returns nothing, and the caller reports it
// rather than writing an empty document.
function readPdfText(file, { maxChars = PDF_MAX_CHARS } = {}) {
  const out = execFileSync('pdftotext', ['-layout', '-q', file, '-'], { maxBuffer: 1 << 28, timeout: 180000 }).toString('utf8');
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

// A page is Amharic because its text is Amharic, not because its url sits on the /am/ tree. Six of the
// National Bank's Amharic pages are index screens whose links are all in English: /am/ህጎች/መመሪያዎች holds 173
// Ethiopic characters, which is the header this script wrote and almost nothing else. Calling those Amharic
// would tell an Amharic reader that a page is in their language when it is not, and would put six English
// pages into the Amharic slice of every benchmark. The floor is the one knowledge/banking's own document test
// already uses to decide whether a page marked Amharic really is.
const AM_FLOOR = 300;
const ethiopicCount = s => (String(s || '').match(/[ሀ-፿]/g) || []).length;
const langOfText = (declared, text) => (declared === 'am' && ethiopicCount(text) < AM_FLOOR ? 'en' : declared);

function readDirManifest(root, site) {
  const dir = path.join(root || DIR_ROOT, site.dir || site.host);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return { dir, entries: Array.isArray(raw) ? raw : (raw.items || raw.files || []) };
}

// Which entries of a manifest become documents. Status 200 only; text/html through allow/deny; application/pdf
// only through allowPdf, which a site that names none has none of. Identical bytes are written once: the same
// telebirr page is linked at /telebirr/withdraw, at /withdraw and under its Amharic slug, and three documents
// of one page is the duplication the whole pack exists to avoid. Where the same bytes have several URLs the
// plainest one wins — no percent escapes, then the shortest — because that is the one a person can read.
function selectDirEntries(site, entries, ocr = null) {
  const allow = rx(site.allow), deny = rx(site.deny), allowPdf = rx(site.allowPdf);
  // One host, spelled two ways. The National Bank serves the same file at nbe.gov.et and at www.nbe.gov.et,
  // and Directive ONPS/04/2021 - one of the documents this pack exists to be able to cite - is in the
  // harvest only under the www spelling. A site may therefore NAME the other spellings of its own host, as
  // a list and never as a pattern: `hostAliases` is an allowlist, so a look-alike domain is still refused.
  const hosts = new Set([site.host, ...(Array.isArray(site.hostAliases) ? site.hostAliases : [])]);
  const okPdf = key => allowPdf.length > 0 && allowPdf.some(r => r.test(key)) && !deny.some(r => r.test(key));
  const rows = [], skipped = [];
  for (const e of entries || []) {
    if (Number(e.status) !== 200) continue;
    const ct = String(e.contentType || '').split(';')[0].trim().toLowerCase();
    const isHtml = ct === 'text/html' || ct === 'application/xhtml+xml';
    const isPdf = ct === 'application/pdf';
    if (!isHtml && !isPdf) continue;
    let u; try { u = new URL(e.url); } catch (err) { continue; }
    if (!hosts.has(u.hostname)) continue;                    // never another host, never a look-alike
    const key = dirKeyOf(e.url);
    // The root path is normally not a document: everywhere else it is a landing page whose content lives
    // elsewhere. etrade.gov.et is the exception this pack found - its home page IS the catalogue of all
    // thirteen services, 14,602 characters against 909 on the only other page that holds anything - so a site
    // may say dirAllowRoot, and only a site that says it gets one.
    if (!key || (key === '/' && !site.dirAllowRoot)) continue;
    if (isHtml) {
      if (!allow.some(r => r.test(key)) || deny.some(r => r.test(key))) continue;
      // The harvester measured both of these before it wrote the manifest. 71 of the 187 pages harvested from
      // mols.gov.et answer 200 with 173 KB of Elementor chrome and no body at all - 12 MB of shell the
      // importer does not read again to discover what somebody already counted, and a counted reason is the
      // difference between "the crawl missed it" and "the ministry never published anything there".
      if (e.empty) {
        skipped.push({ url: e.url, why: 'the harvest measured this page as empty: ' + String(e.emptyReason || 'no reason given').slice(0, 90) });
        continue;
      }
      if (e.bodyChars != null && Number(e.bodyChars) < MIN_CHARS) {
        skipped.push({ url: e.url, why: 'the harvest measured ' + Number(e.bodyChars) + ' characters of body text, under the ' + MIN_CHARS + ' floor' });
        continue;
      }
    } else { if (!okPdf(key)) continue; }
    // The National Bank uploads the same directive under several names: sixteen of the 156 OCR'd files are
    // byte-identical to another and the sidecar says which copy to keep. A duplicate is not a document, and
    // it is reported rather than dropped in silence.
    const o = ocr && ocr.byKey.get(key);
    if (o && o.duplicate_of) {
      const kept = ocr.byStem.get(String(o.duplicate_of));
      skipped.push({ url: e.url, why: 'ocr duplicate of ' + ((kept && kept.title) || o.duplicate_of) });
      continue;
    }
    rows.push({ e, key, kind: isHtml ? 'html' : 'pdf' });
  }
  const plainest = (a, b) => {
    const enc = k => (/%[0-9a-f]{2}/.test(k) ? 1 : 0);
    return enc(a.key) - enc(b.key) || a.key.length - b.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  };
  const bySha = new Map(), byKey = new Map();
  for (const r of [...rows].sort(plainest)) {
    const sha = String(r.e.sha256 || r.e.file || r.key);
    if (bySha.has(sha) || byKey.has(r.key)) continue;
    bySha.set(sha, r); byKey.set(r.key, r);
  }
  const keep = [...byKey.values()];
  // Four of these documents are in no harvest row this importer can use: the Money Laundering proclamation,
  // the National Payment System amendment, the 2025 NBE proclamation and ONPS/09/2023 are 16 to 47 MB and the
  // harvester refused them at its own 15 MB cap, leaving a row with a null status and no file. They were
  // fetched again by hand and exist here only as OCR text, so the sidecar's own row is the entry. allowPdf
  // still decides: a sidecar does not let a document in through the back door.
  if (ocr) {
    const have = new Set(keep.map(r => r.key));
    for (const o of ocr.rows) {
      const key = dirKeyOf(o.url);
      if (!key || key === '/' || have.has(key) || o.duplicate_of || !okPdf(key)) continue;
      let u; try { u = new URL(o.url); } catch (err) { continue; }
      if (!hosts.has(u.hostname)) continue;
      have.add(key);
      keep.push({ e: { url: o.url, title: o.title, file: null, fetchedAt: o.generatedAt || '' },
        key, kind: 'pdf', ocrOnly: true });
    }
  }
  // maxPages is applied by fetchDir AFTER the duplicate texts have gone, so a site's budget counts documents
  // rather than URLs; maxPdfs is applied here, because opening a PDF costs a subprocess and the selection is
  // an explicit list rather than a pattern.
  const html = keep.filter(r => r.kind === 'html').sort((a, b) => (a.key < b.key ? -1 : 1));
  const pdf = keep.filter(r => r.kind === 'pdf').sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, Number(site.maxPdfs) || 0);
  return { html, pdf, skipped };
}

// The M-PESA transaction fee table is not in any HTML page: the site's own calculator fetches it from the
// server band by band, and the saved homepage ships `charges: []`. It was captured from that calculator into a
// JSON file whose provenance is written inside it. This turns that file into ONE document with the bands as a
// table — no figure restated, no band merged, nothing added but the sentence saying where it came from.
function tariffDocFrom(json, cfg) {
  const rows = (json && (json.tariff || json.charges)) || [];
  if (!rows.length) return null;
  const cur = json.currency ? ' (' + json.currency + ')' : '';
  const day = String(json.capturedAt || '').slice(0, 10);
  const lines = ['## ' + (cfg.heading || 'Transaction fees') + cur, '',
    'Action | Amount | Charge', '--- | --- | ---'];
  for (const r of rows) lines.push([r.action, r.band, r.charge].map(x => String(x == null ? '' : x).replace(/\|/g, '/')).join(' | '));
  lines.push('', 'Captured from the M-PESA site\'s own fee calculator on ' + day + '. '
    + String(json.note || '').replace(/\s+/g, ' ').trim());
  if (json.source) lines.push('', 'Calculator page: ' + json.source);
  return { text: lines.join('\n'), fetchedAt: day };
}

// One harvested site, start to finish. Returns { pages, failed } in exactly the shape fetchSite returns, so
// everything downstream — stripPackBoilerplate, splitThin, writePack — cannot tell the two apart.
function fetchDir(site, { root, log = () => {}, tag = 'pack', readPdf = readPdfText, limit = 0,
  ocrMaxChars = OCR_MAX_CHARS, htmlMaxChars = HTML_MAX_CHARS } = {}) {
  const { dir, entries } = readDirManifest(root, site);
  // motri.gov.et completes a TLS handshake and then presents a wildcard certificate for *.mint.gov.et that
  // expired on 2026-08-23, so its bytes could only be read with verification turned off. That is a fact about
  // where these documents came from, and a fact that lives only inside a harvest manifest is one that gets
  // lost the first time somebody copies the folder. A harvest that records a relaxed handshake must be
  // DECLARED by the registry entry, in the harvest's own words, and the run stops until it is.
  const tlsSeen = [...new Set((entries || []).map(e => String(e.tls || '')).filter(Boolean))];
  if (tlsSeen.length) log('[' + tag + '] ' + site.id + ': the harvest records tls: ' + tlsSeen.join(', '));
  for (const t of tlsSeen.filter(v => /disabled|expired|unverified|insecure/i.test(v))) {
    if (String(site.tls || '') !== t) {
      throw new Error('the harvest for ' + site.id + ' was taken with tls=' + t
        + ' and the registry does not say so; add tls: "' + t + '" to its entry before these bytes become documents');
    }
  }
  const ocr = readOcrManifest(dir);
  const sel = selectDirEntries(site, entries, ocr);
  const htmlRows = limit ? sel.html.slice(0, limit) : sel.html;
  const pdfRows = limit ? [] : sel.pdf;
  log('[' + tag + '] ' + site.id + ': ' + entries.length + ' entries in the harvest manifest, '
    + htmlRows.length + ' pages and ' + pdfRows.length + ' pdfs selected'
    + (ocr ? ' (' + ocr.rows.length + ' of them read by OCR, ' + (sel.skipped || []).length
      + ' refused as duplicate uploads)' : ''));
  const out = [], failed = [...(sel.skipped || [])];
  for (const r of htmlRows) {
    let ex;
    try { ex = extract(fs.readFileSync(path.join(dir, r.e.file), 'utf8'), { titleSuffix: site.titleSuffix }); }
    catch (err) { failed.push({ url: r.e.url, why: 'unreadable' }); continue; }
    if (!ex.ok) { failed.push({ url: r.e.url, why: ex.why }); continue; }
    // Every page of m-pesa.safaricom.et carries the same <title>, "M-PESA Ethiopia |" — 24 pages, one title.
    // A site that says so takes its document title from the page's own first heading instead, which is still
    // the page's own words: "KYC Requirements as per M-PESA", "Frequently Asked Questions".
    let title = ex.title;
    if (site.titleFrom === 'heading') {
      const h = (String(ex.text).match(/^#{1,3}[ \t]*(\S.*)$/m) || [])[1];
      if (h) title = h.replace(/\s+/g, ' ').trim().slice(0, 90);
    } else if (site.titleFrom === 'manifest-heading' && r.e.heading) {
      // Every route of the etrade application carries one <title>, "e-Trade Online Trade Registration &
      // License System", and the heading a visitor actually reads is written into the DOM by the application.
      // The rendered capture recorded it per page, so the document is named what the page calls itself.
      title = String(r.e.heading).replace(/\s+/g, ' ').trim().slice(0, 90);
    }
    const declared = langFor(site, r.key);
    const lang = langOfText(declared, ex.text);
    if (lang !== declared) log('[' + tag + '] ' + site.id + ': ' + r.key + ' is on the ' + declared
      + ' tree but holds only ' + ethiopicCount(ex.text) + ' Ethiopic characters — recorded as ' + lang);
    // One page can be too long to be one document: mols.gov.et/agencies is the register of 1,222 licensed
    // overseas employment agencies, 177,222 characters of table. It is split exactly as a long OCR'd
    // proclamation is, at a break that is never inside a row, and every part carries the page's own url so a
    // citation still points at the one page the text is on.
    const bodies = splitLongParts(ex.text, htmlMaxChars, '\n');
    for (let n = 0; n < bodies.length; n++) {
      out.push({ url: r.e.url, path: r.key, siteId: site.id, title, text: bodies[n],
        lang, fetchedAt: String(r.e.fetchedAt || '').slice(0, 10), isPdf: false,
        part: n + 1, parts: bodies.length });
    }
  }
  for (let i = 0; i < pdfRows.length; i++) {
    const r = pdfRows[i];
    // The OCR text wins wherever there is any, and pdftotext is not called at all for that file: pdftotext
    // returning nothing is the whole reason the file was OCR'd. This is a preference, not a fallback.
    const o = ocr && ocr.byKey.get(r.key);
    let bodies = null, prov = null, titleRaw = '';
    if (o) {
      let raw = '';
      try { raw = fs.readFileSync(path.join(ocr.dir, o.file), 'utf8'); }
      catch (err) { failed.push({ url: r.e.url, why: 'ocr text unreadable: ' + String(o.file) }); continue; }
      bodies = splitOcrParts(raw, ocrMaxChars);
      prov = { textSource: 'ocr', ocrQuality: o.ocr_quality || '', ocrPages: o.pages == null ? null : o.pages };
      titleRaw = ocrTitleOf(o.title);
    } else if (r.ocrOnly) {
      failed.push({ url: r.e.url, why: 'selected from the ocr manifest but its text is missing' }); continue;
    } else {
      let text = '';
      try { text = readPdf(path.join(dir, r.e.file)); }
      catch (err) { failed.push({ url: r.e.url, why: 'pdftotext: ' + String(err.message).split('\n')[0].slice(0, 50) }); continue; }
      bodies = [String(text || '')];
      prov = { textSource: 'pdf', ocrQuality: '', ocrPages: null };
      titleRaw = cleanTitle(r.e.title || '', site.titleSuffix);
    }
    const t = (site.pdfTitles && site.pdfTitles[r.key]) || titleRaw || pdfSlugOf(r.key);
    for (let n = 0; n < bodies.length; n++) {
      const text = String(bodies[n] || '').replace(/\f/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      if (text.replace(/\s+/g, ' ').trim().length < MIN_CHARS) {
        failed.push({ url: r.e.url, why: o ? 'ocr text too thin' + (bodies.length > 1 ? ' (part ' + (n + 1) + ')' : '') : 'no_text_layer' });
        continue;
      }
      out.push({ url: r.e.url, path: r.key, siteId: site.id, title: t, text,
        lang: o ? ocrLangOf(text) : langFor(site, r.key),
        fetchedAt: String(r.e.fetchedAt || '').slice(0, 10), isPdf: true,
        part: bodies.length > 1 ? n + 1 : 1, parts: bodies.length, ...prov });
    }
    if ((i + 1) % 10 === 0) log('[' + tag + '] ' + site.id + ' pdfs: ' + (i + 1) + '/' + pdfRows.length);
  }
  // A hand-shaped document, named by the registry, built from a captured JSON rather than from a page.
  const cfg = site.tariffDoc;
  if (cfg && !limit) {
    const hit = (entries || []).find(e => Number(e.status) === 200
      && /application\/json/.test(String(e.contentType || '')) && String(e.postType || '') === cfg.postType);
    if (!hit) log('[' + tag + '] ' + site.id + ': tariffDoc ' + cfg.slug + ' — no ' + cfg.postType + ' json in the harvest');
    else {
      const t = tariffDocFrom(JSON.parse(fs.readFileSync(path.join(dir, hit.file), 'utf8')), cfg);
      if (!t) log('[' + tag + '] ' + site.id + ': tariffDoc ' + cfg.slug + ' — the json holds no bands');
      else out.push({ url: hit.url, path: cfg.path || dirKeyOf(hit.url), siteId: site.id, title: cfg.title,
        text: t.text, lang: 'en', fetchedAt: t.fetchedAt || String(hit.fetchedAt || '').slice(0, 10),
        isPdf: false, fixedSlug: cfg.slug, fixedSection: cfg.section });
    }
  }
  // The no-duplicate rule, applied to the text rather than to the bytes. ethio telecom publishes the Amharic
  // telebirr pages twice — once at /telebirr/deposit?lang=am and once under the Ethiopic slug
  // /ቴሌብር/ተቀማጭ-ገንዘብ?lang=am — and the two files are not byte-identical (their canonical link differs), so the
  // sha check above cannot see it. What a reader would see is the same page, so it becomes one document, under
  // the plainer of the two URLs, and the other is reported as a duplicate rather than written.
  const byText = new Map();
  const kept = [];
  for (const p of [...out].sort((a, b) => {
    const enc = k => (/%[0-9a-f]{2}/.test(k) ? 1 : 0);
    return enc(a.path) - enc(b.path) || a.path.length - b.path.length || (a.path < b.path ? -1 : 1);
  })) {
    const h = contentHash(p.text);
    if (byText.has(h)) { failed.push({ url: p.url, why: 'same text as ' + byText.get(h) }); continue; }
    byText.set(h, p.path); kept.push(p);
  }
  const cap = Number(site.maxPages) || 200;
  const htmlKept = kept.filter(p => !p.isPdf);
  if (htmlKept.length > cap) {
    for (const p of htmlKept.slice(cap)) failed.push({ url: p.url, why: 'over maxPages ' + cap });
    const over = new Set(htmlKept.slice(cap));
    out.length = 0; out.push(...kept.filter(p => !over.has(p)));
  } else { out.length = 0; out.push(...kept); }
  for (const p of out) {
    const sec = p.fixedSection ? (site.sections || []).find(s => s.key === p.fixedSection) : sectionOf(site, p.path);
    p.section = sec ? sec.key : (p.fixedSection || null);
    p.sectionTitleAm = sec ? sec.titleAm : null;
  }
  const prefix = site.slugPrefix === false ? '' : (site.slugPrefix || site.id) + '-';
  const pages = assignSlugs(out, site, { needsName: NEEDS_NAME_DIR,
    slugOf: p => p.fixedSlug || (p.isPdf ? pdfSlugOf(p.path) : null) })
    // Parts of one long document share a path, so they are named after the document and then numbered. Part
    // one keeps the document's own name, which is the name a gold set, a citation and a git diff already use.
    .map(p => ({ ...p, slug: prefix + p.slug + (p.parts > 1 && p.part > 1 ? '-part-' + p.part : '') }));
  // Two documents with one filename is one document silently lost. The rule-made slugs cannot clash (the
  // lengthening loop sees to that), but two PDFs uploaded under the same basename in different months can, and
  // so can a hand-named slug that repeats one. Stop rather than overwrite.
  const seen = new Map();
  for (const p of pages) {
    if (seen.has(p.slug)) throw new Error('two harvested pages want the same document name: ' + p.slug
      + '  ' + seen.get(p.slug) + '  ' + p.path);
    seen.set(p.slug, p.path);
  }
  return { pages, failed };
}

// ---------- command line ----------
//   node ops/travel/fetch-airline.js                       fetch every site in the registry and write the pack
//   node ops/travel/fetch-airline.js --site ethiopian-airlines
//   node ops/travel/fetch-airline.js --dry-run             fetch, report, write nothing
//   node ops/travel/fetch-airline.js --limit 5 --dry-run   a five-page smoke test
//   node ops/packs/fetch-pack.js --pack banking --from-dir /root/storage/packs/banking-manual
//                                                          build every `fetch: "dir"` site from the harvest
//   node ops/packs/fetch-pack.js --pack banking --from-dir --site nbe --dry-run
// About 120 pages at 5 s apiece is roughly 14 minutes, so run it detached and poll the log.
async function main(bound = {}) {
  const argv = process.argv.slice(2);
  const pack = bound.pack || (argv.includes('--pack') ? argv[argv.indexOf('--pack') + 1] : 'travel');
  const registry = bound.REGISTRY || path.join(packDir(pack), 'sources.json');
  const defaultOut = bound.OUT_DIR || packDir(pack);
  const only = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : '';
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
  const dryRun = argv.includes('--dry-run');
  // --from-dir with no value means the default harvest root; without the flag at all, no dir site is built.
  const fromDir = argv.includes('--from-dir')
    ? ((argv[argv.indexOf('--from-dir') + 1] || '').startsWith('-') ? DIR_ROOT : (argv[argv.indexOf('--from-dir') + 1] || DIR_ROOT))
    : null;
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : defaultOut;
  const today = new Date().toISOString().slice(0, 10);
  const reg = JSON.parse(fs.readFileSync(registry, 'utf8'));
  const tag = (reg.pack && reg.pack.logPrefix) || pack;
  const log = m => console.log(String(m).replace(/^\[travel\]/, '[' + tag + ']'));
  const amHeaders = reg.pack && reg.pack.amHeaders ? readAmHeaders(pack) : null;
  if (argv.includes('--rerender')) {
    const rr = rerenderPack(outDir, reg, { dryRun, amHeaders });
    const n = rr.rerendered.length + rr.unchanged.length + rr.skipped.length;
    log('[travel] ' + pack + ': ' + n + ' documents (0 added, 0 changed, ' + rr.rerendered.length + ' re-rendered, '
      + rr.unchanged.length + ' unchanged, ' + rr.skipped.length + ' skipped)' + (dryRun ? '  [DRY RUN — nothing written]' : ''));
    console.log(JSON.stringify({ pack, rerendered: rr.rerendered.length, unchanged: rr.unchanged.length, skipped: rr.skipped, uncorrected: rr.uncorrected }));
    return;
  }
  let bad = 0;
  for (const site of reg.sites) {
    if (site.fetch === 'manual') { log('[travel] ' + site.id + ': manual (' + site.reach + ') — nothing fetched'); continue; }
    // A dir site is only built when a harvest root is named, so the Sunday job and every ordinary run leave it
    // exactly as it stands. Importing 200 documents is a deliberate act, not something a cron line does.
    if (site.fetch === 'dir' && !fromDir) {
      log('[travel] ' + site.id + ': dir (' + (site.dir || site.host) + ') — not built; pass --from-dir <root> to import the harvest'); continue;
    }
    if (only && site.id !== only) continue;
    const t0 = Date.now();
    const { pages, failed } = site.fetch === 'dir'
      ? fetchDir(site, { root: fromDir, log, tag, limit })
      : await fetchSite(site, { limit, log, tag });
    const docs = stripPackBoilerplate(pages);
    const { kept, thin } = splitThin(docs);
    const r = writePack(outDir, kept, site, { today, dryRun, failed, pack: reg.pack, amHeaders, corrections: reg.corrections });
    if (r.refused) { log('[travel] ' + site.id + ': REFUSED to update the pack — ' + r.refusedWhy + '. Nothing written.'); bad++; continue; }
    bad += failed.length;
    log('[travel] ' + site.id + ': ' + kept.length + ' documents'
      + ' (+' + r.added.length + ' added, ' + r.changed.length + ' changed, ' + r.unchanged.length + ' unchanged, ' + r.reformatted.length + ' re-rendered, '
      + r.gone.length + ' gone, ' + r.missed.length + ' kept after a failed fetch, ' + thin.length + ' too thin after stripping, ' + failed.length + ' failed)'
      + ' in ' + Math.round((Date.now() - t0) / 1000) + 's' + (dryRun ? '  [DRY RUN — nothing written]' : ''));
    for (const f of failed.slice(0, 12)) log('        ! ' + f.why + '  ' + f.url);
    for (const d of thin) log('        ~ thin after stripping  ' + d.slug);
    console.log(JSON.stringify({ site: site.id, ...r, failed: failed.length, thin: thin.length }));
  }
  if (bad) log('[travel] ' + bad + ' page(s) produced no document — see the lines above');
}

// Bind every pack-dependent thing to one pack. The functions themselves are shared; what changes is which
// registry is read, which directory is written, and — through the registry — what the document header says.
// Where every site in a pack that names a title suffix names the same one — the airline and its cargo site
// share a pattern, and the ECAA names none — the bound module keeps that pattern as its default. A caller of
// the bound module that names no suffix then gets exactly what it got when the pattern was a constant in this
// file. A pack whose sites disagree (every bank brands its titles differently) has no default, and there
// every call names the site's own pattern, which is what fetchSite does.
function packTitleSuffix(registry) {
  try {
    const all = (JSON.parse(fs.readFileSync(registry, 'utf8')).sites || []).map(s => s.titleSuffix).filter(Boolean);
    return all.length && all.every(s => s === all[0]) ? all[0] : '';
  } catch (e) { return ''; }
}

// The header's wording now lives in the registry's `pack` block, and so does which fetcher a document says
// generated it. A caller that reaches this module through forPack — the travel shim, every travel test, the
// cron line — must get that block without having to name it, or the airline's documents would lose the two
// sentences they have always opened with. The unbound module keeps the plan's semantics: no pack argument,
// no template, and the header says only what the page itself says.
function packBlock(registry) {
  try { return JSON.parse(fs.readFileSync(registry, 'utf8')).pack || {}; } catch (e) { return {}; }
}

// The registry's corrections travel with the pack the same way its header wording does.
function packCorrections(registry) {
  try { return JSON.parse(fs.readFileSync(registry, 'utf8')).corrections || []; } catch (e) { return []; }
}

function forPack(pack) {
  const dir = packDir(pack);
  const REGISTRY = path.join(dir, 'sources.json');
  const dflt = packTitleSuffix(REGISTRY);
  const blk = packBlock(REGISTRY);
  const amh = blk.amHeaders ? readAmHeaders(pack) : null;
  const corr = packCorrections(REGISTRY);
  const withPack = opts => ({ ...opts, pack: opts && opts.pack !== undefined ? opts.pack : blk,
    amHeaders: opts && opts.amHeaders !== undefined ? opts.amHeaders : amh,
    corrections: opts && opts.corrections !== undefined ? opts.corrections : corr });
  return { ...module.exports, pack, REGISTRY, OUT_DIR: dir, amHeaders: amh,
    cleanTitle: (raw, titleSuffix) => cleanTitle(raw, titleSuffix === undefined ? dflt : titleSuffix),
    extract: (html, opts) => extract(html, { titleSuffix: opts && opts.titleSuffix !== undefined ? opts.titleSuffix : dflt }),
    header: (page, site, today, pk, amEnt) => header(page, site, today, pk === undefined ? blk : pk, amEnt),
    renderDoc: (page, site, opts) => renderDoc(page, site, withPack(opts)),
    writePack: (outDir, docs, site, opts) => writePack(outDir, docs, site, withPack(opts)),
    main: () => main({ pack, REGISTRY, OUT_DIR: dir }) };
}

module.exports = { sitemapUrls, sitemapsOf, pathOf, sectionOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract, langFor, fill, slugPrefixOf,
  readAmHeaders, amEntry, ungroundedFigures, digitRuns, maskPhones, MOBILE_RE, bodyText, sameDoc, rerenderPack, AM_HEADERS,
  stripPackBoilerplate, splitThin, contentHash, frontMatter, readMeta, bodyOf, header, pageHeadings, PACK_FORMAT, renderDoc, touchLastChecked, clearMissed, writePack,
  makeFetcher, linksOn, fetchSite, main, forPack, packDir, UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS, MASS_LOSS_FLOOR,
  dirKeyOf, pdfSlugOf, readPdfText, readDirManifest, selectDirEntries, tariffDocFrom, fetchDir, DIR_ROOT,
  readOcrManifest, ocrTitleOf, splitOcrParts, splitLongParts, ocrLangOf, OCR_MAX_CHARS, HTML_MAX_CHARS,
  langOfText, ethiopicCount, AM_FLOOR,
  applyCorrections, stripCorrections, correctionNote, packCorrections, CORR_MARK,
  PDF_MAX_CHARS, NEEDS_NAME, NEEDS_NAME_DIR };

//   node ops/packs/fetch-pack.js --pack banking
//   node ops/packs/fetch-pack.js --pack banking --site zemen --limit 5 --dry-run
if (require.main === module) {
  const argv = process.argv.slice(2);
  const pack = argv.includes('--pack') ? argv[argv.indexOf('--pack') + 1] : 'travel';
  main({ pack }).catch(e => { console.error('[' + pack + '] failed: ' + e.message); process.exit(1); });
}
