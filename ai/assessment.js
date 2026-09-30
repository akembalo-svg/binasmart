'use strict';
// "Show us your system" — the first contact for the portal-copilot service.
//
//   POST /api/ai/assessment      { org, contact, phone, email?, licence?, tin?, systems?, pain?, sector? }
//   GET  /ops/ai-assessments?key=…   the queue
//
// The owner's two rules, built into the form rather than left to a conversation (2026-09-22):
//
//   1. We promise an ASSESSMENT, never a delivery date. "Show us your system and within 3-5 days we
//      tell you exactly what we can do, free." Portals like LMIS and Musaned are slow, login-gated and
//      change without warning; a missed delivery date on the first client travels Addis faster than any
//      advert. An assessment is a promise we can always keep.
//   2. Licensed organisations only - a trade licence, a TIN/VAT number, a real company, or a government
//      office. Those systems carry workers' passports and identity documents. Asking at first contact
//      is not paperwork; it is the difference between a client and a problem.
//
// Nothing here is published anywhere. It is a lead, it goes to the owner, and it waits for a person.
const crypto = require('crypto');

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Sent by @bina_smart_bot (BINA_RIDER_BOT_TOKEN) to the admin chats. Not BINASMART_TG_TOKEN: that is the old
// @gccandconectbot, which the owner never started - getChat on 26 Sep 2026 said "chat not found" for both chats,
// so every alert sent with it was lost. The sending bot and the chat must belong together.
async function tellOwner(text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN;
  const chats = [process.env.BINASMART_ADMIN_TG_CHAT, process.env.BINASMART_OPS_TG_CHAT].filter(Boolean);
  if (!tok || !chats.length) return false;
  let ok = false;
  for (const chat of [...new Set(chats)]) {
    try {
      const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
      ok = (await r.json()).ok === true || ok;
    } catch (e) { /* the other chat may still get it */ }
  }
  return ok;
}

// Ethiopian mobile, in the shapes people type it.
const normPhone = raw => {
  const d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^09\d{8}$/.test(d)) return '+251' + d.slice(1);
  if (/^(\+?251)9\d{8}$/.test(d)) return '+251' + d.replace(/^\+?251/, '');
  return d.length >= 9 ? d.slice(0, 20) : null;
};

module.exports = function assessmentRoutes(fastify, { prisma, limiter, OWNER_KEY }) {
  const ipRL = limiter(3600000, 6);

  fastify.post('/api/ai/assessment', async (req, reply) => {
    const b = req.body || {};
    const ip = String(req.headers['x-real-ip'] || req.ip || '');
    if (!ipRL(ip)) return reply.code(429).send({ ok: false, error: 'slow_down' });

    const org = clean(b.org, 120);
    const contact = clean(b.contact, 90);
    const phone = normPhone(b.phone);
    if (org.length < 2) return reply.code(400).send({ ok: false, error: 'org_required' });
    if (contact.length < 2) return reply.code(400).send({ ok: false, error: 'contact_required' });
    if (!phone) return reply.code(400).send({ ok: false, error: 'phone_invalid' });

    const row = await prisma.aiAssessment.create({ data: {
      org, contact, phone,
      email: clean(b.email, 120) || null,
      licence: clean(b.licence, 60) || null,
      tin: clean(b.tin, 40) || null,
      systems: clean(b.systems, 300) || null,
      pain: clean(b.pain, 600) || null,
      sector: clean(b.sector, 40) || null,
    } });

    const lines = [
      '🏢 <b>AI assessment request</b>',
      '',
      '<b>' + esc(org) + '</b>' + (row.sector ? ' · ' + esc(row.sector) : ''),
      esc(contact) + ' · ' + esc(phone) + (row.email ? ' · ' + esc(row.email) : ''),
      row.licence || row.tin ? 'Licence: ' + esc(row.licence || '—') + ' · TIN/VAT: ' + esc(row.tin || '—')
        : '⚠️ no licence or TIN given',
      row.systems ? '\nSystems: ' + esc(row.systems) : '',
      row.pain ? '\nStuck on: ' + esc(row.pain) : '',
      '',
      'All requests: https://bina.et/ops/ai-assessments?key=' + encodeURIComponent(OWNER_KEY),
    ].filter(Boolean).join('\n');
    tellOwner(lines).catch(() => {});

    return { ok: true, id: row.id,
      message: 'Thank you. We will look at your system and come back within 3–5 working days with exactly what we can do — free, and with no obligation.' };
  });

  fastify.get('/ops/ai-assessments', async (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key) !== OWNER_KEY) {
      return reply.code(401).type('text/html').send('<h2>Unauthorized</h2>');
    }
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'private, no-store');
    const rows = await prisma.aiAssessment.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const card = r => `<div class="c">
      <div class="hd"><b>${esc(r.org)}</b><span class="mut">${r.status} · ${new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span></div>
      <div>${esc(r.contact)} · <a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>${r.email ? ' · ' + esc(r.email) : ''}</div>
      <div class="mut sm">${r.licence || r.tin ? 'Licence ' + esc(r.licence || '—') + ' · TIN ' + esc(r.tin || '—') : '⚠️ no licence or TIN given'}${r.sector ? ' · ' + esc(r.sector) : ''}</div>
      ${r.systems ? `<p><b>Systems:</b> ${esc(r.systems)}</p>` : ''}
      ${r.pain ? `<p><b>Stuck on:</b> ${esc(r.pain)}</p>` : ''}
    </div>`;
    reply.type('text/html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="robots" content="noindex"><title>AI assessment requests</title>
      <body style="font-family:system-ui,-apple-system,'Noto Sans Ethiopic',sans-serif;background:#f5f6f8;margin:0;padding:16px;color:#111">
      <h1 style="font-size:19px;margin:0 0 4px">AI assessment requests</h1>
      <div style="color:#667;font-size:13px">${rows.filter(r => r.status === 'new').length} new</div>
      <style>.c{background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:13px 15px;margin:10px 0;max-width:720px}
      .hd{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.mut{color:#667}.sm{font-size:12.5px}
      p{margin:7px 0;line-height:1.5}a{color:#1e3a8a}</style>
      ${rows.map(card).join('') || '<p style="color:#667">Nothing yet.</p>'}</body>`);
  });
};
