'use strict';
// The call list for Addis cinemas — /ops/venues?key=…
//
// The booking side of cinema (seat maps, tickets, the door scanner) is built and has nothing real in
// it, because it needs something no amount of code produces: one cinema agreeing to put its halls and
// its prices on the platform. That starts with a phone call.
//
// Every number we hold was read off a blog, a business directory or a Facebook page. Not one came from
// the cinema, and a number nobody has dialled is a guess with a plus sign in front of it. This page is
// where calling turns those guesses into facts — the number that actually rings, who answered, what
// they said — so the work survives whoever did it and nobody rings the same cinema twice.
//
// Owner key only, noindex, no-store: it holds names of people who have not agreed to be listed
// anywhere, and a half-finished negotiation with a business that has competitors.
const STATUS = {
  new: { label: 'not called yet', cls: 'n' },
  called: { label: 'called, waiting', cls: 'c' },
  no_answer: { label: 'no answer / wrong number', cls: 'x' },
  interested: { label: 'interested', cls: 'i' },
  declined: { label: 'said no', cls: 'x' },
  signed: { label: 'signed up', cls: 'i' },
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');

// The source is already written at the end of the researched note, in brackets. Showing it beside the
// number is the difference between "call this" and "check this".
const sourceOf = notes => {
  const m = /\(([^)]{3,80})\)\s*$/.exec(String(notes || '').trim());
  return m ? m[1] : '';
};

module.exports = function opsVenues(fastify, { prisma, OWNER_KEY }) {
  // A plain HTML form, so it posts urlencoded. Parsed inside this plugin only - the rest of the API
  // still refuses form posts, which is what keeps a cross-site form from reaching a JSON endpoint.
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32768 },
    (req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (e) { done(e); } });

  const guard = (req, reply) => {
    if ((req.headers['x-owner-key'] || req.query.key || (req.body || {}).key) !== OWNER_KEY) {
      reply.code(401).type('text/html').send('<h2>Unauthorized</h2>');
      return false;
    }
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive').header('cache-control', 'private, no-store');
    return true;
  };

  fastify.get('/ops/venues', async (req, reply) => {
    if (!guard(req, reply)) return;
    const key = String(req.query.key || '');
    const now = new Date();

    const venues = await prisma.venue.findMany({
      where: { NOT: { slug: { startsWith: 'demo-' } } },
      include: { halls: { select: { id: true, name: true, capacity: true } } },
      orderBy: [{ outreach: 'asc' }, { name: 'asc' }],
    });
    // What each venue has actually given us so far: a programme we can show, or halls we can sell.
    const progs = await prisma.programme.groupBy({ by: ['venueId'], _count: { venueId: true },
      where: { dateTo: { gte: new Date(now.getTime() - 120 * 86400000) } } });
    const progBy = new Map(progs.map(p => [p.venueId, p._count.venueId]));

    const counts = venues.reduce((a, v) => { a[v.outreach] = (a[v.outreach] || 0) + 1; return a; }, {});
    const withPhone = venues.filter(v => v.phone).length;
    const checked = venues.filter(v => v.phoneChecked).length;

    const card = v => {
      const st = STATUS[v.outreach] || STATUS.new;
      const src = sourceOf(v.notes);
      return `<div class="c ${st.cls}">
        <div class="hd">
          <div><b>${esc(v.name)}</b><span class="mut"> · ${esc(v.address || '—')}</span></div>
          <span class="tag ${st.cls}">${esc(st.label)}</span>
        </div>
        <div class="ph">
          ${v.phone ? `<a href="tel:${esc(v.phone)}">${esc(v.phone)}</a>` : '<span class="mut">no number</span>'}
          ${v.phoneChecked ? `<span class="ok"> ✓ answered ${day(v.phoneChecked)}</span>`
                           : (v.phone ? `<span class="mut"> · not verified${src ? ' · from ' + esc(src) : ''}</span>` : '')}
          ${v.website ? ` · <a href="${esc(v.website)}" target="_blank" rel="noopener">site</a>` : ''}
        </div>
        ${v.contactName ? `<div class="sm">👤 ${esc(v.contactName)}${v.contactRole ? ' — ' + esc(v.contactRole) : ''}</div>` : ''}
        <div class="sm mut">${esc(v.notes || '')}</div>
        <div class="sm mut">${progBy.get(v.id) ? progBy.get(v.id) + ' programme entries' : 'no programme from them'}${v.halls.length ? ' · ' + v.halls.length + ' hall(s) set up' : ' · no halls set up'}</div>
        ${v.outreachNote ? `<p class="note">${esc(v.outreachNote)}${v.outreachAt ? ' <span class="mut">— ' + day(v.outreachAt) + '</span>' : ''}</p>` : ''}
        <form method="post" action="/ops/venues/${v.id}">
          <input type="hidden" name="key" value="${esc(key)}">
          <div class="row">
            <input name="phone" value="${esc(v.phone || '')}" placeholder="phone that actually rings">
            <label class="tick"><input type="checkbox" name="phoneChecked" ${v.phoneChecked ? 'checked' : ''}> got through</label>
          </div>
          <div class="row">
            <input name="contactName" value="${esc(v.contactName || '')}" placeholder="who you spoke to">
            <input name="contactRole" value="${esc(v.contactRole || '')}" placeholder="their job">
          </div>
          <div class="row">
            <select name="outreach">
              ${Object.keys(STATUS).map(k => `<option value="${k}"${v.outreach === k ? ' selected' : ''}>${esc(STATUS[k].label)}</option>`).join('')}
            </select>
            <button class="btn go">Save</button>
          </div>
          <textarea name="outreachNote" rows="2" placeholder="what they said — halls, seats, prices, who decides">${esc(v.outreachNote || '')}</textarea>
        </form>
      </div>`;
    };

    reply.type('text/html').send(`<!doctype html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
      <title>Cinemas — call list</title><style>
      body{font-family:system-ui,-apple-system,"Noto Sans Ethiopic",sans-serif;background:#f5f6f8;margin:0;padding:16px;color:#111}
      h1{font-size:19px;margin:0 0 4px} .mut{color:#667} .sm{font-size:12.5px;margin-top:4px} .ok{color:#047857}
      .c{background:#fff;border:1px solid #e3e6ec;border-left:4px solid #c9ced9;border-radius:14px;padding:13px 15px;margin:10px 0;max-width:720px}
      .c.i{border-left-color:#059669} .c.x{border-left-color:#b45309} .c.c{border-left-color:#1e3a8a}
      .hd{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
      .ph{margin-top:5px;font-size:14px} .note{background:#f7f8fa;border-radius:9px;padding:8px 10px;margin:8px 0 0;font-size:13.5px;line-height:1.5}
      .tag{font-size:11.5px;border-radius:999px;padding:3px 9px;background:#eef1f6;color:#445;white-space:nowrap}
      .tag.i{background:#ecfdf5;color:#065f46} .tag.x{background:#fff7ed;color:#9a3412} .tag.c{background:#eef2ff;color:#25408f}
      form{margin-top:9px} .row{display:flex;gap:7px;margin-top:6px;flex-wrap:wrap}
      input,select,textarea{border:1px solid #ccd;border-radius:9px;padding:8px 11px;font:inherit;flex:1;min-width:130px}
      textarea{width:100%;margin-top:6px;resize:vertical}
      .tick{display:flex;align-items:center;gap:6px;font-size:13px;flex:none;color:#445}
      .tick input{width:17px;height:17px;flex:none}
      .btn{border:1px solid #ccd;background:#fff;border-radius:999px;padding:8px 17px;font-weight:700;font-size:13px;cursor:pointer;flex:none}
      .go{background:#1e3a8a;color:#fff;border-color:#1e3a8a} a{color:#1e3a8a}
      .sum{max-width:720px;background:#fff;border:1px solid #e3e6ec;border-radius:14px;padding:12px 15px;font-size:13.5px;line-height:1.7}
      </style></head><body>
      <h1>Addis cinemas — the call list</h1>
      <div class="mut sm">Owner only. ${venues.length} venues · ${withPhone} have a number · <b>${checked} verified by someone getting through</b></div>
      <div class="sum" style="margin:12px 0">
        ${Object.keys(STATUS).map(k => `${STATUS[k].label}: <b>${counts[k] || 0}</b>`).join(' · ')}
        <div class="mut" style="margin-top:6px">Every unverified number came from a blog, a directory or a Facebook page — not from the cinema.
        Booking cannot start until one of these says yes and gives us halls, seats and prices.</div>
      </div>
      ${venues.map(card).join('')}
      </body></html>`);
  });

  // One venue, updated by whoever just put the phone down.
  fastify.post('/ops/venues/:id', async (req, reply) => {
    if (!guard(req, reply)) return;
    const b = req.body || {};
    const key = String(b.key || '');
    const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const before = await prisma.venue.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!before) return reply.code(404).type('text/html').send('<h2>Not found</h2>');

    const outreach = STATUS[b.outreach] ? b.outreach : before.outreach;
    const note = clean(b.outreachNote, 2000);
    const data = {
      phone: clean(b.phone, 30) || null,
      contactName: clean(b.contactName, 90) || null,
      contactRole: clean(b.contactRole, 60) || null,
      outreach,
      outreachNote: note || null,
      // "Got through" is a fact about a moment, so it keeps the date it was first ticked rather than
      // moving every time the row is saved.
      phoneChecked: b.phoneChecked ? (before.phoneChecked || new Date()) : null,
      outreachAt: (outreach !== before.outreach || note !== (before.outreachNote || '')) ? new Date() : before.outreachAt,
    };
    await prisma.venue.update({ where: { id: before.id }, data });
    return reply.redirect('/ops/venues?key=' + encodeURIComponent(key) + '#v');
  });
};
