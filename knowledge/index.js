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
  'for-business', 'for-cinemas', 'for-filmmakers', 'for-insurers', 'diaspora', 'ai', 'support', 'guides', 'watch', 'cinema'];

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
let _voice = { mtime: 0, text: '' };
// Glossary + voice rules = everything above "## Examples" in amharic-style.md; re-read when the file changes.
function voiceBlock(root) {
  const p = path.join(root || ROOT, 'knowledge', 'amharic-style.md');
  try {
    const st = fs.statSync(p); if (st.mtimeMs === _voice.mtime) return _voice.text;
    const raw = fs.readFileSync(p, 'utf8'); const head = raw.split(/^## Examples\s*$/m)[0] || '';
    _voice = { mtime: st.mtimeMs, text: head.replace(/^# .*\n/, '').replace(/^Everything above[^\n]*\n/m, '').trim() };
  } catch (e) { _voice = { mtime: 0, text: '' }; }
  return _voice.text;
}
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function tokens(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length > 1); }

// ---------- sources ----------
function readSources(root, only) {
  const docs = [];
  const want = s => !only || only.includes(s);
  const rd = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
  if (want('skill')) { const t = rd(path.join(root, 'skills', 'binasmart-system', 'SKILL.md')); if (t) docs.push({ source: 'skill', slug: 'binasmart-system', title: 'BinaSmart system', url: 'https://bina.et/llms.txt', lang: 'en', text: stripFrontmatter(t), internal: true }); }
  if (want('addis')) { const t = rd(path.join(root, 'knowledge', 'addis-ababa.md')); if (t) docs.push({ source: 'addis', slug: 'addis-ababa', title: 'Addis Ababa', url: 'https://bina.et/living-working-in-ethiopia-guide', lang: 'en', text: t }); }
  if (want('style')) { const t = rd(path.join(root, 'knowledge', 'amharic-style.md')); if (t) { const ex = t.split(/^## Examples\s*$/m)[1] || ''; if (ex.trim()) docs.push({ source: 'style', slug: 'amharic-voice', title: 'Bini Amharic voice', url: null, lang: 'am', text: ex, internal: true }); } }
  if (want('web')) { // knowledge/web/<site>/<hash>.md written by knowledge/crawl.js (front matter: url, title, source_name, lang)
    const wdir = path.join(root, 'knowledge', 'web');
    let sites = []; try { sites = fs.readdirSync(wdir).filter(d => fs.statSync(path.join(wdir, d)).isDirectory()); } catch (e) { /* not crawled yet */ }
    for (const site of sites) for (const f of fs.readdirSync(path.join(wdir, site)).filter(f => f.endsWith('.md'))) {
      const raw = rd(path.join(wdir, site, f)); if (!raw) continue;
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw); if (!fm) continue;
      const meta = {}; for (const line of fm[1].split('\n')) { const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line); if (m) meta[m[1]] = m[2].replace(/\\"/g, '"'); }
      const body = raw.slice(fm[0].length); if (body.trim().length < 400) continue;
      docs.push({ source: 'web', slug: site + '/' + f.replace(/\.md$/, ''), title: (meta.source_name ? meta.source_name + ' · ' : '') + (meta.title || site), url: meta.url || null, lang: meta.lang || 'en', text: body.slice(0, 20000) });
    }
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
  const stats = { searches: 0, embedOk: 0, embedErr: 0, keywordOnly: 0 };

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
      const have = new Set((await prisma.knowledgeChunk.findMany({ where: { source: d.source, slug: d.slug }, select: { hash: true } })).map(x => x.hash));
      for (let i = 0; i < chunks.length; i++) {
        if (have.has(hashes[i])) continue;
        await prisma.knowledgeChunk.create({ data: { source: d.source, slug: d.slug, url: d.url, title: d.title, lang: d.lang, ord: chunks[i].ord, hash: hashes[i], text: chunks[i].text, internal: !!d.internal } });
        inserted++;
      }
      const del = await prisma.knowledgeChunk.deleteMany({ where: { source: d.source, slug: d.slug, hash: { notIn: hashes } } });
      deleted += del.count;
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
    say('[knowledge] ingest: ' + docs.length + ' docs, +' + inserted + ' chunks, -' + deleted + ' stale, ' + embedded + ' embedded, ' + rows.length + ' total');
    return { docs: docs.length, inserted, deleted, embedded, total: rows.length };
  }

  function keywordScore(qt, r) { let s = 0; for (const t of qt) if (r.toks.has(t)) s += 1; return qt.length ? s / qt.length : 0; }

  // Hybrid search: cosine on the embedding (when we can embed the query) plus keyword overlap.
  async function search(q, { k = 4, sources, exclude, isPublic = false } = {}) {
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
      if (isPublic && (r.source === 'skill' || r.source === 'style')) continue;
      if (sources && !sources.includes(r.source)) continue;
      if (exclude && exclude.includes(r.source)) continue;
      let cos = 0;
      if (qv && r.vec) { for (let i = 0; i < DIMS; i++) cos += qv[i] * r.vec[i]; }
      const kw = keywordScore(qt, r);
      const score = qv ? cos + 0.15 * kw : kw;
      if (score > 0) scored.push({ r, score, cos, kw });
    }
    scored.sort((a, b) => b.score - a.score);
    // one chunk per (source, slug) unless the same page clearly wins twice
    const out = [], seen = new Map();
    for (const s of scored) {
      const key = s.r.source + '/' + s.r.slug; const n = seen.get(key) || 0;
      if (n >= 2) continue; seen.set(key, n + 1);
      out.push({ source: s.r.source, slug: s.r.slug, url: s.r.url, title: s.r.title, lang: s.r.lang, score: +s.score.toFixed(4), text: s.r.text.slice(0, 900) });
      if (out.length >= k) break;
    }
    return out;
  }

  // The block Bini gets. Empty for greetings / very short messages so we never pad a "hello".
  async function contextFor(message, { k = 3, styleK = 2 } = {}) {
    const m = String(message || '').trim();
    const words = m.split(/\s+/).filter(Boolean);
    const am = isAmharic(m);
    const greeting = /^(hi|hello|hey|selam|ሰላም|salam|ok|thanks|thank you|አመሰግናለሁ)[!. ]*$/i.test(m);
    const blocks = [];
    if (!greeting && (words.length >= 2 || am)) {
      const hits = await search(m, { k, exclude: ['style'] });
      if (hits.length) {
        const lines = hits.map((h, i) => '[' + (i + 1) + '] ' + h.title + (h.url ? ' — ' + h.url : '') + '\n' + h.text.replace(/\n{2,}/g, '\n'));
        blocks.push('## Relevant BinaSmart knowledge (facts here override anything you remember; cite the page link when useful)\n' + lines.join('\n\n'));
      }
    }
    if (am && styleK > 0) {
      const ex = await search(m, { k: styleK, sources: ['style'] });
      if (ex.length) blocks.push('## Amharic voice examples (match this voice and register; never copy a sentence verbatim, never reuse its opener)\n' + ex.map(h => h.text.replace(/^Bini Amharic voice › /, '').replace(/\n{2,}/g, '\n')).join('\n\n'));
    }
    return blocks.join('\n\n');
  }

  function health() { return { chunks: rows.length, embedded: rows.filter(r => r.vec).length, loadedAt, gemini: !!apiKey, ...stats }; }
  return { load, ingest, search, contextFor, health, voice: () => voiceBlock(root || ROOT), isAmharic, _chunkDoc: chunkDoc, _htmlToText: htmlToText, _readSources: readSources };
}

module.exports = { makeKnowledge, chunkDoc, htmlToText, tokens, readSources, isAmharic, voiceBlock, GUIDE_SLUGS, PAGE_SLUGS, DIMS, toBuf, fromBuf };
