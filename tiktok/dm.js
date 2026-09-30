'use strict';
/*
 * TikTok Business Messaging -> Bini.
 *
 * TikTok posts every direct message sent to the BinaSmart Business Account to /api/tiktok/webhook.
 * We verify the TikTok-Signature, answer 200 at once, then ask Bini (/api/assistant, in-process)
 * and send the answer back with /business/message/send/.
 *
 * Nothing runs until the app is approved and configured:
 *   .env  TIKTOK_APP_ID, TIKTOK_APP_SECRET  (+ optional TIKTOK_REDIRECT_URI)
 *   then the Business Account owner opens the "TikTok account holder authorization URL" from the
 *   developer portal; TikTok redirects to /api/tiktok/callback and the tokens are saved here.
 *   then run: node ops/tiktok/subscribe-webhook.js --apply
 *
 * TikTok rules: the user must message first; up to 10 replies within 48 h of their last message;
 * text max 6000 chars; accounts signed up in the EEA/CH/UK are not supported.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://business-api.tiktok.com/open_api/v1.3';
const TOKENS = path.join(__dirname, 'tokens.json');   // git-ignored, chmod 600

module.exports = async function tiktokDm(fastify, opts) {
  const APP_ID = process.env.TIKTOK_APP_ID || '';
  const SECRET = process.env.TIKTOK_APP_SECRET || '';
  const REDIRECT = process.env.TIKTOK_REDIRECT_URI || 'https://bina.et/api/tiktok/callback';
  const OWNER_KEY = opts.OWNER_KEY || '';
  const log = (m) => console.log('[tiktok] ' + m);

  // Raw body for this plugin only, so the signature is checked over exactly what TikTok sent.
  fastify.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 1048576 },
    (req, body, done) => done(null, body));

  // ---------- tokens ----------
  let tok = null;
  try { tok = JSON.parse(fs.readFileSync(TOKENS, 'utf8')); } catch (e) { tok = null; }
  function saveTokens(d) {
    const now = Date.now();
    tok = {
      open_id: d.open_id || (tok && tok.open_id),
      access_token: d.access_token,
      refresh_token: d.refresh_token || (tok && tok.refresh_token),
      expires_at: now + (Number(d.expires_in) || 86400) * 1000,
      refresh_expires_at: d.refresh_token_expires_in ? now + Number(d.refresh_token_expires_in) * 1000 : (tok && tok.refresh_expires_at),
      saved_at: new Date(now).toISOString(),
    };
    fs.writeFileSync(TOKENS, JSON.stringify(tok, null, 2), { mode: 0o600 });
  }
  async function post(url, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Access-Token'] = token;
    const r = await fetch(API + url, { method: 'POST', headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (j.code !== 0) throw new Error((url) + ' code=' + j.code + ' ' + (j.message || r.status));
    return j.data || {};
  }
  let refreshing = null;
  async function accessToken() {
    if (!tok || !tok.access_token) throw new Error('not connected');
    if (Date.now() < tok.expires_at - 3600 * 1000) return tok.access_token;
    if (!refreshing) {
      refreshing = post('/tt_user/oauth2/refresh_token/', {
        client_id: APP_ID, client_secret: SECRET, grant_type: 'refresh_token', refresh_token: tok.refresh_token,
      }).then(d => { saveTokens(d); log('token refreshed'); }).finally(() => { refreshing = null; });
    }
    await refreshing;
    return tok.access_token;
  }

  // ---------- OAuth callback ----------
  fastify.get('/api/tiktok/callback', async (req, reply) => {
    const code = (req.query && (req.query.code || req.query.auth_code)) || '';
    reply.type('text/html; charset=utf-8');
    if (!APP_ID || !SECRET) return reply.code(503).send('<p>TikTok app is not configured yet.</p>');
    if (!code) return reply.code(400).send('<p>Missing authorization code.</p>');
    try {
      const d = await post('/tt_user/oauth2/token/', {
        client_id: APP_ID, client_secret: SECRET, grant_type: 'authorization_code', auth_code: code, redirect_uri: REDIRECT,
      });
      saveTokens(d);
      log('connected business account ' + String(d.open_id || '').slice(0, 8) + '…');
      return '<meta name=viewport content="width=device-width"><div style="font:18px system-ui;padding:40px;text-align:center">' +
        '<h2>✅ BinaSmart TikTok connected</h2><p>ቢኒ አሁን የቲክቶክ መልእክቶችን ይመልሳል።</p></div>';
    } catch (e) {
      log('callback failed: ' + e.message);
      return reply.code(502).send('<p>Could not connect TikTok: ' + String(e.message).replace(/[<>&]/g, '') + '</p>');
    }
  });

  // ---------- status (owner only) ----------
  const stats = { received: 0, replied: 0, failed: 0, ignored: 0 };
  fastify.get('/api/tiktok/status', async (req, reply) => {
    if (!OWNER_KEY || (req.query && req.query.key) !== OWNER_KEY) return reply.code(404).send({ error: 'not_found' });
    return {
      configured: !!(APP_ID && SECRET),
      connected: !!(tok && tok.access_token),
      access_expires: tok ? new Date(tok.expires_at).toISOString() : null,
      refresh_expires: tok && tok.refresh_expires_at ? new Date(tok.refresh_expires_at).toISOString() : null,
      handled: stats,
    };
  });

  // ---------- webhook ----------
  function validSignature(raw, header) {
    if (!SECRET || !header) return false;
    const parts = Object.fromEntries(String(header).split(',').map(p => p.trim().split('=')));
    const t = Number(parts.t), s = String(parts.s || '');
    if (!t || !s || Math.abs(Date.now() / 1000 - t) > 600) return false;
    const want = crypto.createHmac('sha256', SECRET).update(t + '.' + raw).digest('hex');
    const a = Buffer.from(want), b = Buffer.from(s);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  const seen = new Map();          // message_id -> time (dedupe TikTok retries)
  const convo = new Map();         // conversation_id -> { hist: [], at }

  fastify.post('/api/tiktok/webhook', async (req, reply) => {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (!validSignature(raw, req.headers['tiktok-signature'])) return reply.code(401).send({ ok: false });
    reply.send({ ok: true });                       // acknowledge first; TikTok retries slow endpoints
    let ev; try { ev = JSON.parse(raw); } catch (e) { return; }
    handle(ev).catch(e => { stats.failed++; log('handle failed: ' + e.message); });
  });

  async function handle(ev) {
    if (ev.event !== 'im_receive_msg') { stats.ignored++; return; }
    let c; try { c = typeof ev.content === 'string' ? JSON.parse(ev.content) : (ev.content || {}); } catch (e) { return; }
    if (!c.conversation_id || (c.from_user && c.from_user.role !== 'personal_account')) { stats.ignored++; return; }
    if (c.message_id) {
      if (seen.has(c.message_id)) return;
      seen.set(c.message_id, Date.now());
      if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k);
    }
    stats.received++;
    const businessId = ev.user_openid || (tok && tok.open_id);
    const who = String(c.unique_identifier || (c.from_user && c.from_user.id) || c.from || 'x');

    let text;
    if (c.type === 'text' && c.text && c.text.body) {
      const q = String(c.text.body).slice(0, 1200).trim();
      const st = convo.get(c.conversation_id) || { hist: [] };
      const r = await fastify.inject({
        method: 'POST', url: '/api/assistant',
        headers: { 'content-type': 'application/json', 'x-real-ip': 'tiktok-' + who },
        payload: { message: q, history: st.hist.slice(-6), user: { uid: 'tiktok:' + who, name: c.from || '' } },
      });
      let j = {}; try { j = JSON.parse(r.body); } catch (e) { /* ignore */ }
      text = String(j.reply || '').trim() ||
        'ይቅርታ፣ አሁን መልስ መስጠት አልቻልኩም። እባክዎ በቴሌግራም ያግኙን፦ t.me/Bina_smart';
      st.hist.push({ role: 'user', content: q }, { role: 'assistant', content: text.slice(0, 1200) });
      st.hist = st.hist.slice(-12); st.at = Date.now();
      convo.set(c.conversation_id, st);
      if (convo.size > 3000) for (const [k, v] of convo) if (Date.now() - v.at > 48 * 3600e3) convo.delete(k);
    } else if (['image', 'video', 'sticker', 'emoji', 'share_post'].includes(c.type)) {
      text = 'ሰላም! 👋 እኔ ቢኒ ነኝ፣ የBinaSmart ረዳት። ጥያቄዎን በጽሑፍ ይጻፉልኝ — በአማርኛ ወይም በእንግሊዝኛ። ' +
        'ሹፌር ለመሆን፦ ቴሌግራም ላይ @binasmartdriverbot';
    } else { stats.ignored++; return; }

    text = plain(text).slice(0, 5900);
    await post('/business/message/send/', {
      business_id: businessId, recipient_type: 'CONVERSATION', recipient: c.conversation_id,
      message_type: 'TEXT', text: { body: text },
    }, await accessToken());
    stats.replied++;
  }

  // TikTok shows plain text: drop markdown emphasis/headings, keep links readable.
  function plain(s) {
    return String(s)
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  log((APP_ID && SECRET ? 'configured' : 'waiting for TIKTOK_APP_ID/TIKTOK_APP_SECRET') + ', ' + (tok ? 'connected' : 'not connected'));
};
