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

// ---------- paths ----------
function pathOf(url) {
  try {
    const u = new URL(url);
    let p = u.pathname.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  } catch (e) { return null; }
}
const rx = list => (Array.isArray(list) ? list : []).map(p => new RegExp(p));
function sectionOf(site, p) {
  for (const s of site.sections || []) if (new RegExp(s.match).test(p)) return s;
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
function assignSlugs(pages) {
  const list = [...pages].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const out = list.map(p => ({ ...p, slug: slugFor(p.path) }));
  for (let take = 3; take <= 8; take++) {
    const count = new Map();
    for (const p of out) count.set(p.slug, (count.get(p.slug) || 0) + 1);
    const clashing = [...count].filter(([, n]) => n > 1).map(([s]) => s);
    if (!clashing.length) break;
    for (const p of out) if (clashing.includes(p.slug)) p.slug = slugFor(p.path, take) || clean(p.path);
  }
  return out;
}

// ---------- the extractor ----------
// htmlToText is the index's own converter: it drops head, script, style, nav, footer, header, noscript, svg
// and form, turns h1-h3 into markdown headings, li into "- ", and table cells into " | " rows. Using it
// rather than a second implementation means a page reads in the pack exactly as it would read in the index.
const { htmlToText } = require(path.join(ROOT, 'knowledge', 'index.js'));

const SITE_SUFFIX = /\s*\|\s*(Ethiopian Airlines(\s*\|\s*[A-Z]{2})?|Ethiopian Cargo Website)\s*$/i;
// The airline answers 200 with this title for a path that does not exist - /am/ (Armenia) does it today.
const NOT_FOUND = /^(page not found|404|not found)$/i;
const MIN_CHARS = 400;   // the same floor knowledge/index.js puts under a crawled page

function cleanTitle(raw) {
  return htmlToText('<p>' + String(raw || '') + '</p>').replace(/\s+/g, ' ').replace(SITE_SUFFIX, '').trim();
}

// { ok:true, title, text, chars } or { ok:false, why } where why is empty | soft_404 | thin.
function extract(html) {
  const s = String(html || '');
  if (s.length < 200 || !/<html|<body|<div/i.test(s)) return { ok: false, why: 'empty' };
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(s);
  const title = cleanTitle(m ? m[1] : '');
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
const FM_KEYS = ['url', 'title', 'source_name', 'section', 'lang', 'status', 'fetchedAt', 'lastChecked',
  'firstFetched', 'goneAt', 'contentHash', 'generated_by'];
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

// The header states provenance and nothing else. It must never contain a figure: a kilo or a fee in a header
// written by this script would be a fact from memory, which is the one thing the design forbids.
// ሆ is the Amharic "from" prefix, and nameAm is የኢትዮጵያ ..., whose leading የ is itself a
// prefix: ከየኢትዮጵያ is not a word. Drop that የ so the header reads ከኢትዮጵያ አየር መንገድ.
const fromAm = name => 'ከ' + String(name || '').replace(/^የ/, '');

function header(page, site, today) {
  const en = 'Source: ' + page.url + ' (official ' + site.name + ' page, in English), fetched ' + today
    + '. Everything below is that page as it was written — figures, fees, kilos and time limits are copied, not restated.'
    + ' Confirm on the page before travelling.';
  const am = 'በአማርኛ፦ ይህ ገጽ ' + fromAm(site.nameAm) + ' ኦፊሴላዊ ድረ-ገጽ (' + page.url + ') የተወሰደ ነው። '
    + (page.sectionTitleAm ? 'ክፍል፦ ' + page.sectionTitleAm + '። ' : '')
    + 'አየር መንገዱ የአማርኛ ገጽ ስለማያዘጋጅ ጽሑፉ በእንግሊዝኛ ነው። ኪሎዎች፣ ክፍያዎችና የጊዜ ገደቦች እንደተጻፉ ናቸው፤ ከመጓዝዎ በፊት በገጹ ላይ ያረጋግጡ።';
  return en + '\n\n' + am;
}

function renderDoc(page, site, { today, firstFetched } = {}) {
  const title = site.name + ' — ' + (page.title || page.slug);
  const meta = { url: page.url, title, source_name: site.name, section: page.section || '', lang: site.lang || 'en',
    status: 'live', fetchedAt: today, lastChecked: today, firstFetched: firstFetched && firstFetched !== today ? firstFetched : '',
    contentHash: contentHash(page.text), generated_by: 'ops/travel/fetch-airline.js' };
  return frontMatter(meta) + '\n\n# ' + title + '\n\n' + header(page, site, today) + '\n\n' + page.text.trim() + '\n';
}

// Rewrite exactly one line. Used when a page is unchanged: the body must stay byte-identical (so git shows
// nothing and the ingest's hash finds nothing to do) while the record of when we last looked still advances.
function touchLastChecked(file, today) {
  const cur = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, cur.replace(/^lastChecked: ".*"$/m, 'lastChecked: "' + esc(today) + '"'));
}

// docs: [{ siteId, slug, path, url, title, section, sectionTitleAm, text }] for ONE site, already stripped.
// Returns { added, changed, unchanged, gone, revived } as lists of slugs.
function writePack(dir, docs, site, { today, dryRun = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const day = today || new Date().toISOString().slice(0, 10);
  const r = { added: [], changed: [], unchanged: [], gone: [], revived: [] };
  const wanted = new Map(docs.map(d => [d.slug, d]));
  const onDisk = fs.readdirSync(dir).filter(f => f.endsWith('.md'));

  for (const [slug, d] of wanted) {
    const file = path.join(dir, slug + '.md');
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const oldMeta = old ? readMeta(old) : null;
    if (oldMeta && oldMeta.contentHash === contentHash(d.text) && oldMeta.status !== 'gone') {
      r.unchanged.push(slug);
      if (!dryRun && oldMeta.lastChecked !== day) touchLastChecked(file, day);
      continue;
    }
    const first = (oldMeta && (oldMeta.firstFetched || oldMeta.fetchedAt)) || day;
    if (!old) r.added.push(slug); else { r.changed.push(slug); if (oldMeta.status === 'gone') r.revived.push(slug); }
    if (!dryRun) fs.writeFileSync(file, renderDoc(d, site, { today: day, firstFetched: first }));
  }

  for (const f of onDisk) {
    const slug = f.replace(/\.md$/, '');
    if (wanted.has(slug)) continue;
    const cur = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = readMeta(cur);
    if (meta.source_name !== site.name) continue;        // another site's document in the same directory
    if (meta.status === 'gone') continue;                // already marked, do not report it again every week
    r.gone.push(slug);
    if (dryRun) continue;
    const next = { ...meta, status: 'gone', goneAt: day, lastChecked: day };
    fs.writeFileSync(path.join(dir, f), frontMatter(next) + '\n' + bodyOf(cur));
  }
  return r;
}

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract,
  stripPackBoilerplate, splitThin, contentHash, frontMatter, readMeta, bodyOf, renderDoc, touchLastChecked, writePack,
  UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS };
