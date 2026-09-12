'use strict';
// BinaSmart knowledge index (RAG). Sources: the binasmart-system skill, the Addis Ababa notes, the guide
// and service pages in public/, llms.txt and the MCP docs. Chunks are stored in Postgres (KnowledgeChunk)
// with a Gemini embedding; the whole matrix lives in RAM and search is a cosine scan plus a keyword score,
// so a Gemini outage degrades to keyword search instead of going dark. Everything is injectable for tests.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EMBED_MODEL = 'gemini-embedding-001';
const DIMS = 768;
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/' + EMBED_MODEL;
const CHUNK = 900, OVERLAP = 120;

const ROOT = path.join(__dirname, '..');
const GUIDE_SLUGS = ['fayda', 'telebirr', 'cbe-birr-guide', 'passport', 'ethiopia-evisa', 'telesign', 'mesob', 'tin-registration-ethiopia',
  'business-registration-ethiopia', 'how-to-start-a-business-in-ethiopia', 'vat-registration-ethiopia', 'customs-import-duty-ethiopia',
  'import-car-to-ethiopia', 'driving-licence-ethiopia', 'ethiopian-origin-id-yellow-card', 'open-bank-account-ethiopia',
  'birth-marriage-certificate-ethiopia', 'pay-utility-bills-ethiopia', 'lmis-labor-id-ethiopia', 'coc-certificate-ethiopia',
  'rental-agreement-ethiopia', 'tenant-screening-ethiopia', 'living-working-in-ethiopia-guide', 'digital-ethiopia-2026'];
const PAGE_SLUGS = ['pool', 'airport', 'hotels', 'insurance', 'cars', 'property', 'flights', 'travel', 'why-binasmart', 'drive-with-us',
  'for-business', 'for-cinemas', 'for-filmmakers', 'for-insurers', 'diaspora', 'ai', 'amharic-ai', 'support', 'guides', 'watch', 'cinema'];

// ---------- text helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) { return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => { if (ENT[e] !== undefined) return ENT[e]; if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16)); if (/^#/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10)); return m; }); }
function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, ' ').replace(/<(script|style|nav|footer|header|noscript|svg|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n').replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n').replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|dd|dt)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, ''); s = decode(s);
  s = s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}
function titleOf(html) { const m = /<title>([\s\S]*?)<\/title>/i.exec(html); return m ? decode(m[1]).replace(/\s*\|\s*BinaSmart\s*$/i, '').trim() : ''; }
function stripFrontmatter(md) { return String(md).replace(/^---[\s\S]*?\n---\s*/,''); }

// Split a document into heading-aware chunks of ~CHUNK chars with a small overlap. Each chunk carries
// "Title › Heading" so the embedding knows where it came from.
function chunkDoc(text, title) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const sections = []; let cur = { heading: '', body: [] };
  for (const l of lines) {
    const h = /^(#{1,3})\s+(.+)/.exec(l);
    if (h) { if (cur.body.join('\n').trim()) sections.push(cur); cur = { heading: h[2].trim(), body: [] }; }
    else cur.body.push(l);
  }
  if (cur.body.join('\n').trim()) sections.push(cur);
  const out = [];
  for (const sec of sections) {
    const paras = sec.body.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => { if (buf.trim().length > 40) out.push({ heading: sec.heading, text: buf.trim() }); };
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > CHUNK && buf) {
        flush();
        buf = buf.slice(-OVERLAP).replace(/^\S*\s/, '') + '\n\n' + p; // carry a little context over
      } else buf = buf ? buf + '\n\n' + p : p;
      while (buf.length > CHUNK * 1.6) { out.push({ heading: sec.heading, text: buf.slice(0, CHUNK).trim() }); buf = buf.slice(CHUNK - OVERLAP); }
    }
    flush();
  }
  return out.map((c, i) => ({ ord: i, heading: c.heading, text: (title ? title + (c.heading ? ' › ' + c.heading : '') + '\n' : '') + c.text }));
}
// Latin-letter Amharic people actually type; two hits = Amharic.
const LATIN_AM = /\b(selam|salam|sint|endet|endemin|yet|alegn|alesh|aleh|ebakih|ebakish|ebakwo|ameseginalehu|amesegnalehu|tadia|eshi|new|nesh|neh|nachu|min|man|wede|ke|lay|birr|awo|aydelem|yikirta|betam|dehna|dehena|chigir|yelem|alle|ale)\b/gi;
function isAmharic(s) { s = String(s || ''); if (/[ሀ-፿]/.test(s)) return true; const m = s.match(LATIN_AM); return !!m && m.length >= 2; }
const _voices = {};
// Glossary + voice rules = everything above "## Examples" in amharic-style.md; re-read when the file changes.
function voiceBlock(root, which) {
  const file = which === 'om' ? 'oromo-style.md' : 'amharic-style.md';
  const p = path.join(root || ROOT, 'knowledge', file);
  const cur = _voices[file] || (_voices[file] = { mtime: 0, text: '' });
  try {
    const st = fs.statSync(p); if (st.mtimeMs === cur.mtime) return cur.text;
    const raw = fs.readFileSync(p, 'utf8'); const head = raw.split(/^## Examples\s*$/m)[0] || '';
    cur.mtime = st.mtimeMs; cur.text = head.replace(/^# .*\n/, '').replace(/^Everything above[^\n]*\n/m, '').trim();
  } catch (e) { cur.mtime = 0; cur.text = ''; }
  return cur.text;
}
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
const { foldEthiopic } = require('../assistant/lang');
// Ethiopic folding on the keyword side. \u1200/\u1210/\u1280, \u1230/\u1220, \u12a0/\u12d0 and \u1338/\u1340 are the same sounds written
// differently, and Amharic prose uses the pairs interchangeably - \u134d\u1275\u1215/\u134d\u1275\u1205, \u1230\u1290\u12f5/\u1220\u1290\u12f5, \u12d0\u1240\u1264 \u1215\u130d/\u12a0\u1240\u1264 \u1205\u130d.
// asmat.js and afiya.js already fold their patterns; without the same folding here a user who types
// \u134d\u1275\u1205 never keyword-matches a chunk written \u134d\u1275\u1215, so real answers drop out of the hybrid score.
function tokens(s) { return foldEthiopic(String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')).split(/\s+/).filter(t => t.length > 1); }

// ---------- crawled-site hygiene ----------
// A crawler sees a site's nav, footer and "related links" on every single page. htmlToText only removes the
// semantic <nav>/<footer> elements, which most Ethiopian sites don't use, so the template survived into every
// page and became dozens of byte-identical chunks (ethiopianreporter's footer was in the index 55 times).
// Those clones crowd real answers out of the top results. Any paragraph that appears on a large share of ONE
// site's pages is template, not content, so we drop it before chunking. Self-tuning: no per-site rules.
const paras = t => String(t).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
const normPara = p => p.replace(/\s+/g, ' ').trim().toLowerCase();

function stripBoilerplate(docs, { minPages = 4, ratio = 0.15 } = {}) {
  const bySite = new Map();
  for (const d of docs) { const site = String(d.slug).split('/')[0]; if (!bySite.has(site)) bySite.set(site, []); bySite.get(site).push(d); }
  for (const ds of bySite.values()) {
    if (ds.length < minPages) continue;                       // too few pages to tell template from content
    const pages = new Map();
    for (const d of ds) for (const p of new Set(paras(d.text).map(normPara))) pages.set(p, (pages.get(p) || 0) + 1);
    const limit = Math.max(minPages, Math.ceil(ds.length * ratio));
    const boiler = new Set([...pages].filter(([, n]) => n >= limit).map(([p]) => p));
    if (!boiler.size) continue;
    for (const d of ds) d.text = paras(d.text).filter(p => !boiler.has(normPara(p))).join('\n\n');
  }
  return docs;
}

// Some crawled government pages have been injected with gambling spam (moe.gov.et served a casino page).
// Require two or more distinct markers, which always cluster, so a page mentioning one word in passing is safe.
const SPAM = /(slot gacor|maxwin|situs (?:slot|judi|togel)|judi bola|togel online|rtp live|bandar (?:judi|togel)|pragmatic play|joker ?\d{2,}|scatter hitam)/gi;
// Paid placement dressed as editorial. A page that announces itself as sponsored is advertising, and
// a patient asking where to get cancer treatment must not be handed an advertisement — which is
// exactly what happened on 2026-09-11: "የካንሰር ሕክምና የት ይሰጣል?" was answered with a private hospital
// chain in Turkey, from 11 chunks of one Ethiopian Reporter page titled "ስፖንሰር የተደረጉ" (Sponsored).
// Judged on the TITLE: an article that discusses advertising is legitimate; one that declares itself
// sponsored is not.
const ADVERT = /ስፖንሰር|sponsored|advertorial|paid (content|partnership)|promoted content/i;
function isAdvertorial(meta) {
  return ADVERT.test(String(meta.title || '') + ' ' + String(meta.source_name || ''));
}

function isSpam(text) { return new Set(String(text).toLowerCase().match(SPAM) || []).size >= 2; }

// ---------- sources ----------
function readSources(root, only) {
  const docs = [];
  const want = s => !only || only.includes(s);
  const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
  if (want('skill')) { const t = rd(path.join(root, 'skills', 'binasmart-system', 'SKILL.md')); if (t) docs.push({ source: 'skill', slug: 'binasmart-system', title: 'BinaSmart system', url: 'https://bina.et/llms.txt', lang: 'en', text: stripFrontmatter(t), internal: true }); }
  if (want('addis')) { const t = rd(path.join(root, 'knowledge', 'addis-ababa.md')); if (t) docs.push({ source: 'addis', slug: 'addis-ababa', title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide', lang: 'en', text: t }); }
  if (want('style')) { const t = rd(path.join(root, 'knowledge', 'amharic-style.md')); if (t) { const ex = t.split(/^## Examples\s*$/m)[1] || ''; if (ex.trim()) docs.push({ source: 'style', slug: 'amharic-voice', title: 'Bini Amharic voice', url: null, lang: 'am', text: ex, internal: true }); } }
  if (want('style-om')) { const t = rd(path.join(root, 'knowledge', 'oromo-style.md')); if (t) { const ex = t.split(/^## Examples\s*$/m)[1] || ''; if (ex.trim()) docs.push({ source: 'style-om', slug: 'oromo-voice', title: 'Bini Afaan Oromoo voice', url: null, lang: 'om', text: ex, internal: true }); } }
  if (want('law')) { // knowledge/law/*.md — curated statutes and court interpretations, added by hand.
    // Deliberately NOT under knowledge/web: that directory belongs to the crawler, is gitignored, and
    // its loader truncates every document at 20,000 characters. A statute must be indexed whole — the
    // Constitution is 87 KB, so under the web loader four fifths of it was silently missing.
    const ldir = path.join(root, 'knowledge', 'law');
    let files = []; try { files = fs.readdirSync(ldir).filter(f => f.endsWith('.md')); } catch (e) { /* none yet */ }
    for (const f of files) {
      const raw = rd(path.join(ldir, f)); if (!raw) continue;
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw); if (!fm) continue;
      const meta = {}; for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
      docs.push({ source: 'law', slug: f.replace(/\.md$/, ''), title: meta.title || f,
        url: meta.url || null, lang: meta.lang || 'am', text: raw.slice(fm[0].length) });
    }
  }
  if (want('health')) { // knowledge/health/*.md — curated Ethiopian health-system documents, added by hand.
    // Deliberately NOT under knowledge/web: that directory belongs to the crawler, is gitignored, and
    // its loader truncates every document at 20,000 characters. A statute must be indexed whole — the
    // Constitution is 87 KB, so under the web loader four fifths of it was silently missing.
    const ldir = path.join(root, 'knowledge', 'health');
    let files = []; try { files = fs.readdirSync(ldir).filter(f => f.endsWith('.md')); } catch (e) { /* none yet */ }
    for (const f of files) {
      const raw = rd(path.join(ldir, f)); if (!raw) continue;
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw); if (!fm) continue;
      const meta = {}; for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
      docs.push({ source: 'health', slug: f.replace(/\.md$/, ''), title: meta.title || f,
        url: meta.url || null, lang: meta.lang || 'am', text: raw.slice(fm[0].length) });
    }
  }

  if (want('web')) { // knowledge/web/<site>/<hash>.md written by knowledge/crawl.js (front matter: url, title, source_name, lang)
    const wdir = path.join(root, 'knowledge', 'web');
    let sites = []; try { sites = fs.readdirSync(wdir).filter(d => fs.statSync(path.join(wdir, d)).isDirectory()); } catch (e) { /* not crawled yet */ }
    const web = [];
    const hygiene = { spam: {}, advert: {}, boilerplateChars: 0 };
    for (const site of sites) for (const f of fs.readdirSync(path.join(wdir, site)).filter(f => f.endsWith('.md'))) {
      const raw = rd(path.join(wdir, site, f)); if (!raw) continue;
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw); if (!fm) continue;
      const meta = {}; for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
      const body = raw.slice(fm[0].length);
      if (isSpam(body)) { hygiene.spam[site] = (hygiene.spam[site] || 0) + 1; continue; }   // hacked page serving casino spam
      if (isAdvertorial(meta)) { hygiene.advert[site] = (hygiene.advert[site] || 0) + 1; continue; }  // paid placement, not editorial
      web.push({ source: 'web', slug: site + '/' + f.replace(/\.md$/, ''), title: (meta.source_name ? meta.source_name + ' · ' : '') + (meta.title || site), url: meta.url || null, lang: meta.lang || 'en', text: body.slice(0, 20000) });
    }
    // strip the site template FIRST, then judge the minimum length on what real content is left
    const before = web.reduce((n, d) => n + d.text.length, 0);
    for (const d of stripBoilerplate(web)) if (d.text.trim().length >= 400) docs.push(d);
    hygiene.boilerplateChars = before - web.reduce((n, d) => n + d.text.length, 0);
    hygiene.dropped = web.length - web.filter(d => d.text.trim().length >= 400).length;
    readSources.lastHygiene = hygiene;
  }
  if (want('llms')) { const t = rd(path.join(root, 'public', 'llms.txt')); if (t) docs.push({ source: 'llms', slug: 'llms', title: 'BinaSmart site guide', url: 'https://bina.et/llms.txt', lang: 'en', text: t }); }
  if (want('docs')) { const t = rd(path.join(root, 'mcp-server', 'docs.md')); if (t) docs.push({ source: 'docs', slug: 'mcp', title: 'BinaSmart MCP server', url: 'https://bina.et/mcp', lang: 'en', text: t }); }
  const pages = [];
  if (want('guide')) for (const s of GUIDE_SLUGS) pages.push(['guide', s]);
  if (want('page')) for (const s of PAGE_SLUGS) pages.push(['page', s]);
  for (const [source, slug] of pages) {
    const html = rd(path.join(root, 'public', slug + '.html')); if (!html) continue;
    let text = htmlToText(html); if (text.length > 30000) text = text.slice(0, 30000);
    docs.push({ source, slug, title: titleOf(html) || slug, url: 'https://bina.et/' + slug, lang: /[ሀ-፿]/.test(text.slice(0, 400)) ? 'am' : 'en', text });
  }
  return docs;
}

// ---------- Gemini ----------
function makeEmbedder({ apiKey, fetchImpl, sleep }) {
  const f = fetchImpl || fetch, zz = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  async function batch(texts, task) {
    if (!apiKey) throw new Error('no_gemini_key');
    const out = [];
    for (let i = 0; i < texts.length; i += 100) {
      if (i) await zz(4000); // stay under the per-minute quota (429s seen at ~3k chunks/min on gccdomestic)
      const body = { requests: texts.slice(i, i + 100).map(t => ({ model: 'models/' + EMBED_MODEL, content: { parts: [{ text: t.slice(0, 8000) }] }, taskType: task, outputDimensionality: DIMS })) };
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await f(GEMINI + ':batchEmbedContents?key=' + apiKey, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (r.status === 200) { const d = await r.json(); out.push(...d.embeddings.map(e => e.values)); break; }
        const txt = await r.text().catch(() => '');
        if ((r.status === 429 || r.status >= 500) && attempt < 5) { const m = /"retryDelay":\s*"(\d+)s"/.exec(txt); await zz(Math.min((m ? +m[1] + 2 : 30), 70) * 1000); continue; }
        throw new Error('gemini ' + r.status + ': ' + txt.slice(0, 160));
      }
    }
    return out;
  }
  async function query(q, timeoutMs) {
    if (!apiKey) throw new Error('no_gemini_key');
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs || 2500);
    try {
      const r = await f(GEMINI + ':embedContent?key=' + apiKey, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: { parts: [{ text: String(q).slice(0, 2000) }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: DIMS }) });
      if (r.status !== 200) throw new Error('gemini ' + r.status);
      return (await r.json()).embedding.values;
    } finally { clearTimeout(t); }
  }
  return { batch, query };
}

function toBuf(vec) { const f = Float32Array.from(vec); let n = 0; for (const v of f) n += v * v; n = Math.sqrt(n) || 1; for (let i = 0; i < f.length; i++) f[i] /= n; return Buffer.from(f.buffer); }
function fromBuf(buf) { return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4); }

// ---------- the index ----------
function makeKnowledge({ prisma, apiKey, fetchImpl, root, log, sleep }) {
  const embedder = makeEmbedder({ apiKey, fetchImpl, sleep });
  const say = log || (() => {});
  let rows = [];            // { id, source, slug, url, title, lang, ord, text, vec (Float32Array|null), toks:Set }
  let loadedAt = 0;
  const qcache = new Map(); // query -> vec
  const stats = { searches: 0, embedOk: 0, embedErr: 0, keywordOnly: 0, rerankOk: 0, rerankErr: 0, rerankSkipped: 0 };

  async function load() {
    const all = await prisma.knowledgeChunk.findMany({ orderBy: [{ source: 'asc' }, { slug: 'asc' }, { ord: 'asc' }] });
    rows = all.map(r => ({ id: r.id, source: r.source, slug: r.slug, url: r.url, title: r.title, lang: r.lang, ord: r.ord, text: r.text, vec: r.embedding && r.embedding.length ? fromBuf(r.embedding) : null, toks: new Set(tokens(r.text)) }));
    loadedAt = Date.now();
    return rows.length;
  }
  async function ensureLoaded() { if (!loadedAt) await load(); }

  // (Re)build the store: chunk every source, insert new hashes, embed only what has no embedding, drop stale.
  async function ingest({ only, embed = true } = {}) {
    const docs = readSources(root || ROOT, only);
    let inserted = 0, deleted = 0, embedded = 0;
    for (const d of docs) {
      const chunks = chunkDoc(d.text, d.title);
      const hashes = chunks.map(c => sha1(d.source + '|' + d.slug + '|' + c.text));
      // identical chunks inside one page (repeated blocks on crawled sites) would collide on the unique hash: keep the first
      const dupe = new Set(); for (let i = chunks.length - 1; i >= 0; i--) { if (dupe.has(hashes[i])) { chunks.splice(i, 1); hashes.splice(i, 1); } else dupe.add(hashes[i]); }
      const have = new Set((await prisma.knowledgeChunk.findMany({ where: { source: d.source, slug: d.slug }, select: { hash: true } })).map(x => x.hash));
      for (let i = 0; i < chunks.length; i++) {
        if (have.has(hashes[i])) continue;
        await prisma.knowledgeChunk.create({ data: { source: d.source, slug: d.slug, url: d.url, title: d.title, lang: d.lang, ord: chunks[i].ord, hash: hashes[i], text: chunks[i].text, internal: !!d.internal } });
        inserted++;
      }
      const del = await prisma.knowledgeChunk.deleteMany({ where: { source: d.source, slug: d.slug, hash: { notIn: hashes } } });
      deleted += del.count;
    }
    // Chunks whose document no longer exists anywhere. See collectOrphans above the ingest for why this
    // is fenced so carefully.
    let orphaned = 0;
    if (docs.length) {
      const scope = only && only.length ? [...new Set(only)] : [...new Set(docs.map(d => d.source))];
      const keep = new Set(docs.map(d => d.source + '\u0000' + d.slug));
      const inScope = await prisma.knowledgeChunk.findMany({ where: { source: { in: scope } }, select: { id: true, source: true, slug: true } });
      const dead = inScope.filter(r => !keep.has(r.source + '\u0000' + r.slug));
      if (dead.length > inScope.length / 2 && inScope.length > 20) {
        say('[knowledge] REFUSING to drop ' + dead.length + ' of ' + inScope.length + ' chunks in ' + scope.join(',')
          + ' — that looks like a failed fetch, not a removal. Index left alone; re-run when the source is back.');
      } else if (dead.length) {
        for (let i = 0; i < dead.length; i += 200) {
          await prisma.knowledgeChunk.deleteMany({ where: { id: { in: dead.slice(i, i + 200).map(r => r.id) } } });
        }
        orphaned = dead.length;
        const where = [...new Set(dead.map(r => r.slug.split('/')[0]))].slice(0, 6).join(', ');
        say('[knowledge] collected ' + orphaned + ' orphaned chunks from removed documents (' + where + ')');
      }
    }

    if (embed) {
      const pending = await prisma.knowledgeChunk.findMany({ where: { embedding: null }, select: { id: true, text: true }, take: 2000 });
      if (pending.length && apiKey) {
        try {
          const vecs = await embedder.batch(pending.map(p => p.text), 'RETRIEVAL_DOCUMENT');
          for (let i = 0; i < pending.length; i++) { await prisma.knowledgeChunk.update({ where: { id: pending[i].id }, data: { embedding: toBuf(vecs[i]) } }); embedded++; }
        } catch (e) { say('[knowledge] embedding failed, keyword search still works: ' + e.message); }
      }
    }
    await load();
    const hy = readSources.lastHygiene;
    if (hy && (Object.keys(hy.spam).length || hy.boilerplateChars)) {
      const spam = Object.entries(hy.spam).map(([k, v]) => k + ':' + v).join(' ');
      say('[knowledge] hygiene: ' + Math.round(hy.boilerplateChars / 1000) + 'k chars of site template stripped'
        + (spam ? ', spam pages skipped ' + spam : '') + (hy.dropped ? ', ' + hy.dropped + ' pages left too thin' : ''));
    }
    say('[knowledge] ingest: ' + docs.length + ' docs, +' + inserted + ' chunks, -' + deleted + ' stale, -' + orphaned + ' orphaned, ' + embedded + ' embedded, ' + rows.length + ' total');
    return { docs: docs.length, inserted, deleted, orphaned, embedded, total: rows.length };
  }

  // What BinaSmart wrote itself answers correctly 91.7% of the time; crawled sites manage 62.5%. Rank
  // accordingly, with a tie-breaker rather than a thumb on the scale: a crawled page that is genuinely the
  // better match still wins. Without this, a news article in the question's language outranks the guide that
  // actually answers it — which is exactly what Afaan Oromoo questions were hitting.
  const OWN_SOURCES = new Set(['guide', 'page', 'addis', 'skill', 'llms', 'docs']);
  const OWN_BOOST = 0.06;

  function keywordScore(qt, r) { let s = 0; for (const t of qt) if (r.toks.has(t)) s += 1; return qt.length ? s / qt.length : 0; }

  // Hybrid search: cosine on the embedding (when we can embed the query) plus keyword overlap.
  // ---------- reranking ----------
  // Vector similarity answers "is this chunk about the same topic", which is not the same question as
  // "does this chunk answer what was asked". A page about lease payments and a page about lease PERIODS
  // look nearly identical to an embedding. So: take a wider candidate pool, then have a small model read
  // the question against each candidate and order them by whether they actually answer it.
  //
  // Deliberately fail-open. If the call errors, times out, or returns anything unexpected we return the
  // candidates in their original order - a slightly worse answer beats a broken assistant. The 6s timeout
  // is shorter than the reply the user is waiting for.
  const RERANK_MODEL = process.env.RERANK_MODEL || 'gemini-2.5-flash';
  // Rerank only when the retrieval has not already made up its mind.
  //
  // Measured on the 114-question gold set (ops/bini/rerank-eval.js, ops/bini/rerank-gate.js):
  // reranking every message moved the right page to first 6 times and away from first 4 times —
  // McNemar exact p = 0.754, which is a coin — while costing a median 464 ms and ~3,650 tokens on
  // EVERY message, including the 98 of 114 where it changed nothing at all.
  //
  // But the 6 it helped were not spread evenly. They all sat where the top two pages were nearly
  // tied: gaps 0.007 to 0.043, median 0.013, against a median 0.069 for the questions it left alone.
  // The reranker is useful exactly when the score cannot separate the candidates, which is the only
  // place a second opinion has anything to add.
  //
  // At a 0.03 gap the gate fires on 31 of 114 questions, keeps 5 of the 6 improvements and only 1 of
  // the 4 regressions — a better net outcome than running it always, for 73% fewer calls.
  const RERANK_GAP = Number(process.env.RERANK_GAP || 0.03);
  const rrCache = new Map();

  async function rerank(query, cands, k) {
    if (!apiKey || cands.length <= k) return cands;
    const ck = query + '|' + cands.map(c => c.source + '/' + c.slug).join(',');
    if (rrCache.has(ck)) { const ord = rrCache.get(ck); return ord.map(i => cands[i]).filter(Boolean).slice(0, k); }
    const list = cands.map((c, i) => '[' + i + '] ' + (c.title || '') + '\n' + String(c.text || '').slice(0, 420)).join('\n\n');
    const prompt = 'Question:\n' + query + '\n\nPassages:\n' + list +
      '\n\nReturn ONLY a JSON array of passage numbers, most useful first, keeping at most ' + k +
      '. Judge whether a passage ANSWERS the question, not whether it shares its topic. Omit passages that do not help. No prose.';
    // thinkingBudget 0: gemini-2.5-flash thinks by default and those tokens count against maxOutputTokens,
    // so a small cap returns an empty string instead of the ordering.
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + RERANK_MODEL + ':generateContent?key=' + apiKey, {
        method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } } })
      });
      if (!r.ok) throw new Error('rerank ' + r.status);
      const j = await r.json();
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || '';
      const m = txt.match(/\[[\s\S]*?\]/); if (!m) throw new Error('no array');
      const ord = JSON.parse(m[0]).filter(n => Number.isInteger(n) && n >= 0 && n < cands.length);
      if (!ord.length) throw new Error('empty order');
      stats.rerankOk++;
      if (rrCache.size > 300) rrCache.clear();
      rrCache.set(ck, ord);
      return ord.map(i => cands[i]).slice(0, k);
    } catch (e) {
      stats.rerankErr++;
      return cands.slice(0, k);
    } finally { clearTimeout(t); }
  }

  async function search(q, { k = 4, sources, exclude, isPublic = false, rerankTo = 0 } = {}) {
    await ensureLoaded();
    stats.searches++;
    const query = String(q || '').trim(); if (!query) return [];
    const qt = tokens(query);
    let qv = qcache.get(query) || null;
    if (!qv && apiKey && rows.some(r => r.vec)) {
      try { qv = fromBuf(toBuf(await embedder.query(query))); stats.embedOk++; if (qcache.size > 500) qcache.clear(); qcache.set(query, qv); }
      catch (e) { stats.embedErr++; qv = null; }
    }
    if (!qv) stats.keywordOnly++;
    const scored = [];
    for (const r of rows) {
      if (isPublic && (r.source === 'skill' || r.source === 'style' || r.source === 'style-om')) continue;
      if (sources && !sources.includes(r.source)) continue;
      if (exclude && exclude.includes(r.source)) continue;
      let cos = 0;
      if (qv && r.vec) { for (let i = 0; i < DIMS; i++) cos += qv[i] * r.vec[i]; }
      const kw = keywordScore(qt, r);
      const own = OWN_SOURCES.has(r.source) ? OWN_BOOST : 0;
      const score = (qv ? cos + 0.15 * kw : kw) + (qv ? own : own * 0.5);
      if (score > 0) scored.push({ r, score, cos, kw });
    }
    scored.sort((a, b) => b.score - a.score);
    // one chunk per (source, slug) unless the same page clearly wins twice
    const want = rerankTo ? Math.min(k, 20) : k;
    const out = [], seen = new Map();
    for (const s of scored) {
      const key = s.r.source + '/' + s.r.slug; const n = seen.get(key) || 0;
      if (n >= 2) continue; seen.set(key, n + 1);
      out.push({ source: s.r.source, slug: s.r.slug, url: s.r.url, title: s.r.title, lang: s.r.lang, score: +s.score.toFixed(4), text: s.r.text.slice(0, 900) });
      if (out.length >= want) break;
    }
    if (!rerankTo) return out;
    // The gap between the two best PAGES, not the two best chunks: out may hold two chunks of one
    // page, and a page arguing with itself is not a contest.
    const best = []; for (const o of out) { if (!best.some(b => b.slug === o.slug)) best.push(o); if (best.length === 2) break; }
    if (best.length === 2 && best[0].score - best[1].score >= RERANK_GAP) { stats.rerankSkipped++; return out.slice(0, rerankTo); }
    return await rerank(query, out, rerankTo);
  }

  // The block Bini gets. Empty for greetings / very short messages so we never pad a "hello".
  // k was 3 and styleK 2. Three chunks out of a 6,500-chunk index is a thin slice, and the law library
  // alone is ~1,000 chunks, so a legal question routinely needed more than three to be answerable.
  // styleK was set when the style corpus was 30 chunks; it is now 70+ and carries the correction rules,
  // so two examples under-uses what is there. Amharic costs ~2 tokens per character, so this is not free -
  // revisit if latency or spend moves noticeably.
  async function contextFor(message, { k = 6, styleK = 4, lang } = {}) {
    const m = String(message || '').trim();
    const words = m.split(/\s+/).filter(Boolean);
    const am = lang ? (lang === 'am' || lang === 'am-latin') : isAmharic(m);
    const om = lang === 'om';
    const greeting = /^(hi|hello|hey|selam|ሰላም|salam|ok|thanks|thank you|አመሰግናለሁ)[!. ]*$/i.test(m);
    const blocks = [];
    if (!greeting && (words.length >= 2 || am || om)) {
      // Retrieve a wider pool, then rerank down to k. Style lookups below are deliberately NOT reranked:
      // voice examples are chosen for register, not for whether they answer the question.
      const hits = await search(m, { k: Math.min(k * 3, 18), exclude: ['style', 'style-om'], rerankTo: k });
      if (hits.length) {
        const lines = hits.map((h, i) => '[' + (i + 1) + '] ' + h.title + (h.url ? ' — ' + h.url : '') + '\n' + h.text.replace(/\n{2,}/g, '\n'));
        blocks.push('## Relevant BinaSmart knowledge (facts here override anything you remember; cite the page link when useful)\n' + lines.join('\n\n'));
      }
    }
    if (om && styleK > 0) {
      const ex = await search(m, { k: styleK, sources: ['style-om'] });
      if (ex.length) blocks.push('## Afaan Oromoo voice examples (match this voice; never copy a sentence verbatim)\n' + ex.map(h => h.text.replace(/^Bini Afaan Oromoo voice › /, '').replace(/\n{2,}/g, '\n')).join('\n\n'));
    }
    if (am && styleK > 0) {
      const ex = await search(m, { k: styleK, sources: ['style'] });
      if (ex.length) blocks.push('## Amharic voice examples (match this voice and register; never copy a sentence verbatim, never reuse its opener)\n' + ex.map(h => h.text.replace(/^Bini Amharic voice › /, '').replace(/\n{2,}/g, '\n')).join('\n\n'));
    }
    return blocks.join('\n\n');
  }

  function health() { return { chunks: rows.length, embedded: rows.filter(r => r.vec).length, loadedAt, gemini: !!apiKey, ...stats }; }
  return { load, ingest, search, contextFor, health, voice: which => voiceBlock(root || ROOT, which), isAmharic, _chunkDoc: chunkDoc, _htmlToText: htmlToText, _readSources: readSources };
}

module.exports = { makeKnowledge, chunkDoc, htmlToText, tokens, readSources, isAmharic, voiceBlock, stripBoilerplate, isSpam, GUIDE_SLUGS, PAGE_SLUGS, DIMS, toBuf, fromBuf };
