'use strict';
// Business assistants: one private knowledge base and one assistant per client company (a Workspace).
//
// Isolation is the whole design. A client's documents are stored in WorkspaceChunk and searched here, per
// workspace, and never enter KnowledgeChunk: knowledge/index.js loads that table whole for Bini, the agents and
// the public MCP search, so anything written there is served to everyone. A workspace's assistant reads its own
// chunks plus the public Ethiopian knowledge (laws, government services); it can never read another workspace.
//
// Vectors are BGE-M3 from bina-embed on this server, so a client's documents are not sent to an outside
// embedding service. The answer itself is written by the same model and engine as Afiya and Asmat
// (assistant/kit/engine.js): grounding, figure checks and the calendar fix apply unchanged.

const crypto = require('crypto');
const { execFile } = require('child_process');
const dns = require('dns').promises;
const net = require('net');
const { chunkDoc, htmlToText, tokens, makeLocalEmbedder, LOCAL_DIMS } = require('../knowledge');
const afiya = require('../assistant/afiya');
const asmat = require('../assistant/asmat');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const MAX_DOC_CHARS = 400000;        // one document; a 300-page PDF is about this size
const MAX_CHUNKS_PER_WS = 5000;      // pilot ceiling per company
const EMBED_BATCH = 8;
const TOP_K = 5;

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomKey = prefix => prefix + crypto.randomBytes(24).toString('base64url');
const toBuf = v => Buffer.from(Float32Array.from(v).buffer);
const fromBuf = b => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function pdfToText(buf, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = execFile('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs },
      (err, out) => err ? reject(new Error('pdftotext: ' + err.message)) : resolve(String(out)));
    p.stdin.end(buf);
  });
}

const PRIVATE_V4 = /^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/;
function privateAddress(ip) {
  if (net.isIPv4(ip)) return PRIVATE_V4.test(ip);
  const v = String(ip).toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
// Every address the name resolves to must be public, checked before each request (and each redirect hop).
async function publicHost(url) {
  const h = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(h) ? [{ address: h }] : await dns.lookup(h, { all: true }).catch(() => []);
  return addrs.length > 0 && addrs.every(a => !privateAddress(a.address));
}

// Only public http(s) pages: a client URL must never make this server fetch its own or a private network's pages.
function safeUrl(u) {
  let url; try { url = new URL(String(u)); } catch (e) { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '::1' || h.startsWith('[')) return null;
  return url;
}

function makeWorkspaces({ prisma, embedder, fetchImpl, now } = {}) {
  const local = embedder || makeLocalEmbedder({});
  const f = fetchImpl || fetch;
  const clock = now || Date.now;
  const cache = new Map(); // workspaceId -> { at, rows: [{ id, docId, title, url, heading, text, vec, toks }] }

  // ---------- accounts ----------
  async function create({ slug, name, color, lang, welcome, about, origins, dailyLimit, plan }) {
    slug = String(slug || '').toLowerCase().trim();
    if (!SLUG_RE.test(slug)) throw Object.assign(new Error('slug must be 3-40 lowercase letters, digits or dashes'), { status: 400 });
    if (!String(name || '').trim()) throw Object.assign(new Error('name required'), { status: 400 });
    const secret = randomKey('bsk_'), siteKey = randomKey('bpk_');
    const ws = await prisma.workspace.create({ data: {
      slug, name: String(name).trim().slice(0, 120),
      color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : undefined,
      lang: ['am', 'en', 'om'].includes(lang) ? lang : undefined,
      welcome: welcome ? String(welcome).slice(0, 300) : null,
      about: about ? String(about).slice(0, 1500) : null,
      origins: cleanOrigins(origins),
      dailyLimit: Number.isInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : undefined,
      plan: ['free', 'business', 'enterprise'].includes(plan) ? plan : undefined,
      secretHash: sha256(secret), siteKey,
    } });
    return { workspace: publicView(ws), secretKey: secret, siteKey };
  }

  async function update(ws, patch) {
    const data = {};
    if (patch.name) data.name = String(patch.name).trim().slice(0, 120);
    if (/^#[0-9a-f]{6}$/i.test(patch.color || '')) data.color = patch.color;
    if (['am', 'en', 'om'].includes(patch.lang)) data.lang = patch.lang;
    if (patch.welcome !== undefined) data.welcome = patch.welcome ? String(patch.welcome).slice(0, 300) : null;
    if (patch.about !== undefined) data.about = patch.about ? String(patch.about).slice(0, 1500) : null;
    if (patch.origins !== undefined) data.origins = cleanOrigins(patch.origins);
    if (Number.isInteger(patch.dailyLimit) && patch.dailyLimit > 0) data.dailyLimit = patch.dailyLimit;
    if (['free', 'business', 'enterprise'].includes(patch.plan)) data.plan = patch.plan;
    if (typeof patch.active === 'boolean') data.active = patch.active;
    return publicView(await prisma.workspace.update({ where: { id: ws.id }, data }));
  }

  async function rotateSecret(ws) {
    const secret = randomKey('bsk_');
    await prisma.workspace.update({ where: { id: ws.id }, data: { secretHash: sha256(secret) } });
    return secret;
  }

  function cleanOrigins(list) {
    return (Array.isArray(list) ? list : []).map(o => { try { const u = new URL(String(o)); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch (e) { return null; } })
      .filter(Boolean).slice(0, 20);
  }

  function publicView(ws) {
    return { slug: ws.slug, name: ws.name, color: ws.color, lang: ws.lang, welcome: ws.welcome, about: ws.about,
      siteKey: ws.siteKey, origins: ws.origins, dailyLimit: ws.dailyLimit, plan: ws.plan, active: ws.active, createdAt: ws.createdAt };
  }

  async function bySecret(key) {
    if (!/^bsk_[A-Za-z0-9_-]{20,}$/.test(String(key || ''))) return null;
    const ws = await prisma.workspace.findUnique({ where: { secretHash: sha256(key) } });
    return ws && ws.active ? ws : null;
  }

  async function bySiteKey(key, origin) {
    if (!/^bpk_[A-Za-z0-9_-]{20,}$/.test(String(key || ''))) return null;
    const ws = await prisma.workspace.findUnique({ where: { siteKey: String(key) } });
    if (!ws || !ws.active) return null;
    // An empty list means "not set up yet": only bina.et itself (the demo page) may use the key.
    const allowed = ws.origins.length ? ws.origins : ['https://bina.et'];
    return allowed.includes(String(origin || '')) ? ws : null;
  }

  // ---------- usage ----------
  async function usedToday(ws) {
    const d = new Date(clock()); d.setUTCHours(0, 0, 0, 0);
    return prisma.workspaceQuestion.count({ where: { workspaceId: ws.id, createdAt: { gte: d } } });
  }

  async function record(ws, { channel, lang, question, answered, ms }) {
    try {
      await prisma.workspaceQuestion.create({ data: { workspaceId: ws.id, channel, lang: lang || 'en',
        question: String(question || '').slice(0, 1000), answered: !!answered, ms: ms || 0 } });
    } catch (e) { /* recording never breaks an answer */ }
  }

  async function stats(ws, days = 30) {
    const since = new Date(clock() - days * 86400000);
    const [total, unanswered, docs, chunks, today, recentMisses, recent] = await Promise.all([
      prisma.workspaceQuestion.count({ where: { workspaceId: ws.id, createdAt: { gte: since } } }),
      prisma.workspaceQuestion.count({ where: { workspaceId: ws.id, createdAt: { gte: since }, answered: false } }),
      prisma.workspaceDoc.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, kind: true, url: true, chars: true, createdAt: true } }),
      prisma.workspaceChunk.count({ where: { workspaceId: ws.id } }),
      usedToday(ws),
      prisma.workspaceQuestion.findMany({ where: { workspaceId: ws.id, answered: false }, orderBy: { createdAt: 'desc' }, take: 20, select: { question: true, lang: true, createdAt: true } }),
      prisma.workspaceQuestion.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { question: true, lang: true, channel: true, answered: true, createdAt: true } }),
    ]);
    return { days, total, unanswered, today, dailyLimit: ws.dailyLimit, plan: ws.plan, documents: docs, chunks, unansweredRecent: recentMisses, recent };
  }

  // ---------- documents ----------
  async function addDocument(ws, { kind, title, text, url, pdf, lang }) {
    let body = '', docUrl = null;
    if (kind === 'text') body = String(text || '');
    else if (kind === 'url') {
      const u = safeUrl(url); if (!u) throw Object.assign(new Error('a public http(s) address is required'), { status: 400 });
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
      try {
        let r = null, at = u;
        for (let hop = 0; hop < 4; hop++) {
          if (!(await publicHost(at))) throw Object.assign(new Error('a public http(s) address is required'), { status: 400 });
          r = await f(at.href, { signal: ctrl.signal, redirect: 'manual', headers: { 'user-agent': 'BinaSmartBot/1.0 (+https://bina.et/ai)' } });
          if (r.status < 300 || r.status >= 400) break;
          const next = safeUrl(new URL(r.headers.get('location') || '', at).href);
          if (!next) throw Object.assign(new Error('the page redirects to an address that is not allowed'), { status: 400 });
          at = next; r = null;
        }
        if (!r) throw Object.assign(new Error('too many redirects'), { status: 400 });
        if (!r.ok) throw Object.assign(new Error('the page answered ' + r.status), { status: 400 });
        const type = String(r.headers.get('content-type') || '');
        if (/pdf/i.test(type)) body = await pdfToText(Buffer.from(await r.arrayBuffer()));
        else { const html = await r.text(); body = htmlToText(html); if (!title) { const m = /<title>([\s\S]*?)<\/title>/i.exec(html); title = m ? m[1].trim() : u.href; } }
      } finally { clearTimeout(t); }
      docUrl = u.href;
    } else if (kind === 'pdf') {
      if (!Buffer.isBuffer(pdf) || pdf.slice(0, 4).toString() !== '%PDF') throw Object.assign(new Error('not a PDF file'), { status: 400 });
      body = await pdfToText(pdf);
    } else throw Object.assign(new Error('kind must be text, url or pdf'), { status: 400 });

    body = body.replace(/\f/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
    if (body.length < 40) throw Object.assign(new Error('no readable text found'), { status: 400 });
    if (body.length > MAX_DOC_CHARS) throw Object.assign(new Error('document too large (max ' + MAX_DOC_CHARS + ' characters)'), { status: 413 });
    title = String(title || docUrl || 'Document').replace(/\s+/g, ' ').trim().slice(0, 200);

    const chunks = chunkDoc(body, title);
    const have = await prisma.workspaceChunk.count({ where: { workspaceId: ws.id } });
    if (have + chunks.length > MAX_CHUNKS_PER_WS) throw Object.assign(new Error('knowledge limit reached for this plan'), { status: 413 });

    // Embed first, write after: a document is stored whole or not at all.
    const vecs = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map(c => (c.heading ? c.heading + '\n' : '') + c.text);
      vecs.push(...await local.documents(batch));
    }
    const doc = await prisma.workspaceDoc.create({ data: { workspaceId: ws.id, title, url: docUrl, kind,
      lang: /[ሀ-፿]/.test(body) ? 'am' : (lang || 'en'), chars: body.length } });
    await prisma.workspaceChunk.createMany({ data: chunks.map((c, i) => ({ workspaceId: ws.id, docId: doc.id, ord: i,
      heading: c.heading || null, text: c.text, vec: vecs[i] && vecs[i].length === LOCAL_DIMS ? toBuf(vecs[i]) : null })) });
    cache.delete(ws.id);
    return { id: doc.id, title, kind, chars: body.length, chunks: chunks.length };
  }

  async function removeDocument(ws, docId) {
    const doc = await prisma.workspaceDoc.findFirst({ where: { id: String(docId), workspaceId: ws.id } });
    if (!doc) return false;
    await prisma.workspaceChunk.deleteMany({ where: { docId: doc.id, workspaceId: ws.id } });
    await prisma.workspaceDoc.delete({ where: { id: doc.id } });
    cache.delete(ws.id);
    return true;
  }

  // ---------- search (this workspace only) ----------
  async function rowsFor(ws) {
    const hit = cache.get(ws.id);
    if (hit && clock() - hit.at < 10 * 60000) return hit.rows;
    const [chunks, docs] = await Promise.all([
      prisma.workspaceChunk.findMany({ where: { workspaceId: ws.id }, orderBy: [{ docId: 'asc' }, { ord: 'asc' }] }),
      prisma.workspaceDoc.findMany({ where: { workspaceId: ws.id }, select: { id: true, title: true, url: true } }),
    ]);
    const meta = new Map(docs.map(d => [d.id, d]));
    const rows = chunks.map(c => ({ id: c.id, docId: c.docId, title: (meta.get(c.docId) || {}).title || '', url: (meta.get(c.docId) || {}).url || null,
      heading: c.heading, text: c.text, vec: c.vec && c.vec.length === LOCAL_DIMS * 4 ? fromBuf(c.vec) : null,
      toks: new Set(tokens((c.heading || '') + ' ' + c.text)) }));
    cache.set(ws.id, { at: clock(), rows });
    return rows;
  }

  async function search(ws, q, k = TOP_K) {
    const rows = await rowsFor(ws);
    if (!rows.length) return [];
    let qv = null;
    try { qv = await local.query(q, 8000); } catch (e) { qv = null; }
    const qt = tokens(q);
    const scored = rows.map(r => {
      let cos = 0;
      if (qv && r.vec) for (let i = 0; i < LOCAL_DIMS; i++) cos += qv[i] * r.vec[i];
      const kw = qt.length ? qt.filter(t => r.toks.has(t)).length / qt.length : 0;
      return { r, score: qv ? 0.8 * cos + 0.2 * kw : kw };
    }).filter(x => x.score > (qv ? 0.35 : 0.2));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(x => ({ ...x.r, score: x.score }));
  }

  function contextBlock(ws, hits) {
    return hits.map((h, i) => '[' + ws.name + ' ' + (i + 1) + '] ' + h.title + (h.heading ? ' — ' + h.heading : '') + '\n' + h.text).join('\n\n');
  }

  // ---------- the assistant (an engine definition, one per workspace) ----------
  function agentFor(ws, state) {
    const name = ws.name;
    const soul = [
      'You are the virtual assistant of ' + name + ', built by BinaSmart for Ethiopian customers.',
      ws.about ? 'About ' + name + ': ' + ws.about : '',
      'Answer customers of ' + name + ' clearly and briefly, in the language they wrote in (Amharic, English or Afaan Oromoo).',
      'Use the "' + name + ' documents" below first; for Ethiopian law and government procedure you may use the other information given.',
      'Never invent a price, rate, fee, deadline, account detail, phone number or policy. If the documents do not say, say you do not have that information and suggest contacting ' + name + ' directly.',
      'Never ask for or accept passwords, PINs, OTP codes or full card numbers. Never claim to perform transactions.',
      'You are an information assistant; you do not give legal, medical or investment advice.',
    ].filter(Boolean).join('\n');
    const noInfo = {
      am: 'ይቅርታ፣ ለዚህ ጥያቄ በቂ መረጃ የለኝም። እባክዎ ' + name + 'ን በቀጥታ ያነጋግሩ።',
      om: 'Dhiifama, gaaffii kanaaf odeeffannoo gahaa hin qabu. Maaloo ' + name + ' kallattiin qunnamaa.',
      en: 'Sorry, I don\'t have enough information on that. Please contact ' + name + ' directly.',
    };
    return {
      name: 'ws:' + ws.slug,
      names: [name],
      soul,
      maxTokens: 600,
      log: false,                       // client customers' questions stay out of Bini's chat log (see record())
      knowledge: { exclude: ['page', 'skill', 'llms', 'news', 'banking'] }, // public law and government knowledge; not BinaSmart marketing, news or other banks' tariffs
      gates: [
        // A medical emergency still gets the ambulance number first, without paging BinaSmart's staff.
        { test: c => afiya.isEmergency(c.msg), answer: c => ({ body: { reply: afiya.emergencyReply(c.l), emergency: true } }) },
        { test: c => asmat.isUrgent(c.msg), answer: c => ({ body: { reply: asmat.urgentReply(c.l), urgent: true } }) },
      ],
      inScope: () => true,
      redirect: c => noInfo[c.l] || noInfo.en,
      async context(c) {
        const hits = await search(ws, c.msg);
        state.hits = hits;
        if (!hits.length) return {};
        const block = contextBlock(ws, hits);
        return { prompt: '\n\n## ' + name + ' documents\n' + block, grounding: block };
      },
      finish: (c, text) => text || noInfo[c.l] || noInfo.en,
      fallback: c => noInfo[c.l] || noInfo.en,
      body: () => {
        const seen = new Set();
        const sources = (state.hits || []).filter(h => { const k = h.docId; if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 3).map(h => ({ title: h.title, url: h.url }));
        return sources.length ? { companySources: sources } : {};
      },
    };
  }

  return { create, update, rotateSecret, bySecret, bySiteKey, usedToday, record, stats, addDocument, removeDocument,
    search, agentFor, publicView, pdfText: buf => pdfToText(buf), _cache: cache };
}

module.exports = { makeWorkspaces, safeUrl, publicHost, privateAddress, sha256, SLUG_RE };
