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
// Below this many live documents a pack is too small for "most of them vanished" to mean anything, so the
// guard stays out of the way of a first run and of a small site.
const MASS_LOSS_FLOOR = 20;

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
// Bumped whenever renderDoc changes the shape of a document. writePack re-renders anything older, so the
// pack is never half one format and half the other - and a re-render is not reported as a change, because the
// airline changed nothing.
const PACK_FORMAT = '2';
const FM_KEYS = ['url', 'title', 'source_name', 'section', 'lang', 'status', 'fetchedAt', 'lastChecked',
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

function header(page, site, today) {
  const heads = pageHeadings(page.text, page.title);
  const what = site.name + ' — ' + (page.section ? page.section + ' — ' : '') + (page.title || page.slug) + '.'
    + (heads.length ? ' On this page: ' + heads.join(', ') + '.' : '');
  const am = 'በአማርኛ፦ ' + (page.sectionTitleAm ? page.sectionTitleAm + ' — ' : '') + (page.title || page.slug) + '። '
    + 'ይህ ገጽ ' + fromAm(site.nameAm) + ' ኦፊሴላዊ ድረ-ገጽ የተወሰደ ነው፤ አየር መንገዱ የአማርኛ ገጽ ስለማያዘጋጅ ጽሑፉ በእንግሊዝኛ ነው። ከመጓዝዎ በፊት በገጹ ላይ ያረጋግጡ።';
  const en = 'Source: ' + page.url + ' (official ' + site.name + ' page, in English), fetched ' + today
    + '. Everything below is that page as it was written — figures, fees, kilos and time limits are copied, not restated.'
    + ' Confirm on the page before travelling.';
  return what + '\n\n' + am + '\n\n' + en;
}

function renderDoc(page, site, { today, firstFetched } = {}) {
  const title = site.name + ' — ' + (page.title || page.slug);
  const meta = { url: page.url, title, source_name: site.name, section: page.section || '', lang: site.lang || 'en',
    status: 'live', fetchedAt: today, lastChecked: today, firstFetched: firstFetched && firstFetched !== today ? firstFetched : '',
    contentHash: contentHash(page.text), generated_by: 'ops/travel/fetch-airline.js', packFormat: PACK_FORMAT };
  return frontMatter(meta) + '\n\n# ' + title + '\n\n' + header(page, site, today) + '\n\n' + page.text.trim() + '\n';
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
function writePack(dir, docs, site, { today, dryRun = false, failed = [] } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const day = today || new Date().toISOString().slice(0, 10);
  const r = { added: [], changed: [], unchanged: [], gone: [], goneWhy: {}, missed: [], revived: [], reformatted: [] };
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
      // The page did not change, but the way this script writes a page did. Re-render it from the text that
      // just came off the site, keeping the day the content was fetched, and keep it out of `changed`: the
      // weekly note is about what the airline did, not about what we did.
      if (oldMeta.packFormat !== PACK_FORMAT && !dryRun) {
        r.reformatted.push(slug);
        fs.writeFileSync(file, renderDoc(d, site, { today: oldMeta.fetchedAt || day, firstFetched: oldMeta.firstFetched || oldMeta.fetchedAt || day }));
        touchLastChecked(file, day);
        continue;
      }
      if (oldMeta.packFormat !== PACK_FORMAT) r.reformatted.push(slug);
      if (!dryRun && oldMeta.missedAt) clearMissed(file, day);
      else if (!dryRun && oldMeta.lastChecked !== day) touchLastChecked(file, day);
      continue;
    }
    const first = (oldMeta && (oldMeta.firstFetched || oldMeta.fetchedAt)) || day;
    if (!old) r.added.push(slug); else { r.changed.push(slug); if (oldMeta.status === 'gone') r.revived.push(slug); }
    if (!dryRun) fs.writeFileSync(file, renderDoc(d, site, { today: day, firstFetched: first }));
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
async function fetchSite(site, { fetchImpl, sleep, limit = 0, log = () => {} } = {}) {
  const get = makeFetcher({ fetchImpl, sleep, delayMs: (site.crawlDelaySeconds || 5) * 1000 });
  const pages = [], failed = [];
  let seeds = [];
  if (site.fetch === 'sitemap') {
    const queue = [site.sitemap];
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
  log('[travel] ' + site.id + ': ' + seeds.length + ' urls in the sitemap, ' + todo.length + ' selected');

  const fetched = new Map();
  const discovered = new Set();
  const take = async (list, round) => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (fetched.has(p.path)) continue;
      const r = await get(p.url);
      if (!r.ok) { failed.push({ url: p.url, why: r.why }); continue; }
      if (round === 1 && site.discoverLinks) for (const l of linksOn(r.html, p.url)) discovered.add(l);
      const ex = extract(r.html);
      if (!ex.ok) { failed.push({ url: p.url, why: ex.why }); continue; }
      fetched.set(p.path, { ...p, siteId: site.id, title: ex.title, text: ex.text });
      if ((i + 1) % 10 === 0) log('[travel] ' + site.id + ' round ' + round + ': ' + (i + 1) + '/' + list.length);
    }
  };
  await take(todo, 1);
  if (site.discoverLinks && !limit) {
    const extra = selectUrls(site, [...discovered]).filter(p => !fetched.has(p.path));
    if (extra.length) log('[travel] ' + site.id + ': ' + extra.length + ' pages the sitemap did not list');
    await take(extra, 2);   // one level only: round 2 never harvests links
  }
  pages.push(...assignSlugs([...fetched.values()]));
  return { pages, failed };
}

// ---------- command line ----------
//   node ops/travel/fetch-airline.js                       fetch every site in the registry and write the pack
//   node ops/travel/fetch-airline.js --site ethiopian-airlines
//   node ops/travel/fetch-airline.js --dry-run             fetch, report, write nothing
//   node ops/travel/fetch-airline.js --limit 5 --dry-run   a five-page smoke test
// About 120 pages at 5 s apiece is roughly 14 minutes, so run it detached and poll the log.
async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : '';
  const limit = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 0;
  const dryRun = argv.includes('--dry-run');
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : OUT_DIR;
  const today = new Date().toISOString().slice(0, 10);
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const log = m => console.log(m);
  let bad = 0;
  for (const site of reg.sites) {
    if (site.fetch === 'manual') { log('[travel] ' + site.id + ': manual (' + site.reach + ') — nothing fetched'); continue; }
    if (only && site.id !== only) continue;
    const t0 = Date.now();
    const { pages, failed } = await fetchSite(site, { limit, log });
    const docs = stripPackBoilerplate(pages);
    const { kept, thin } = splitThin(docs);
    const r = writePack(outDir, kept, site, { today, dryRun, failed });
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

module.exports = { sitemapUrls, pathOf, selectUrls, slugFor, assignSlugs, cleanTitle, extract,
  stripPackBoilerplate, splitThin, contentHash, frontMatter, readMeta, bodyOf, header, pageHeadings, PACK_FORMAT, renderDoc, touchLastChecked, clearMissed, writePack,
  makeFetcher, linksOn, fetchSite, main, UA, REGISTRY, OUT_DIR, ROOT, MIN_CHARS, MASS_LOSS_FLOOR };

if (require.main === module) main().catch(e => { console.error('[travel] failed: ' + e.message); process.exit(1); });
