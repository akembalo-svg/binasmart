'use strict';
// Table QR ordering for claimed restaurants (1 Oct 2026, step 3 of bina.et/restaurants; Ibrahim chose "Telegram +
// dashboard"). A confirmed restaurant's dishes become a menu at /restaurants/<slug>/menu?table=N; printed table cards
// (/restaurants/<slug>/qr) open it. When the owner has switched ordering ON in the dashboard, a guest picks dishes
// and sends the order; it reaches the owner's Telegram (linked once through @bina_smart_bot, start=rest_<token>) and
// the dashboard. Prices are always the restaurant's own, taken on the server; the guest pays at the table. No
// online payment, no delivery.
//   GET  /restaurants/:slug/menu?table=N             the menu (and the order sheet when ordering is on)
//   GET  /restaurants/:slug/qr?n=&from=              printable table cards (A4, 4 per page)
//   POST /api/restaurants/:slug/order                {table, items:[{i, qty}], name, note}
//   POST /api/restaurants/:slug/call                 {table, kind: waiter|bill}: "call the waiter" / "bring the bill"
//   GET  /api/restaurants/mine/:id/orders            the owner's orders (newest first)
//   POST /api/restaurants/mine/:id/orders/:oid       {status: seen|done}
//   POST /api/restaurants/mine/:id/settings          {ordersOn}
//   GET  /api/restaurants/mine/:id/telegram          the owner's link to connect Telegram (makes the token once)
// Orders are kept in /root/storage/restaurants/orders.json (the last 2,000).

const fs = require('fs'), path = require('path'), crypto = require('crypto');
const H = require('../health/directory');
const R = require('./directory');
const { esc } = H;
const ORDERS = () => process.env.RESTAURANT_ORDERS_FILE || '/root/storage/restaurants/orders.json';
const BOT = () => process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot';
const price = s => { const m = /(\d[\d,]*(?:\.\d+)?)/.exec(String(s || '')); const n = m ? Number(m[1].replace(/,/g, '')) : NaN; return isFinite(n) && n > 0 && n < 1e6 ? n : null; };
function readOrders() { try { return JSON.parse(fs.readFileSync(ORDERS(), 'utf8')); } catch (e) { return { orders: [] }; } }
function writeOrders(s) { const f = ORDERS(); fs.mkdirSync(path.dirname(f), { recursive: true }); s.orders = s.orders.slice(-2000); fs.writeFileSync(f + '.part', JSON.stringify(s)); fs.renameSync(f + '.part', f); }

// the restaurant behind a page: its newest live entry (the owner's), or null when nobody has confirmed it
function entryFor(p) {
  const S = R.readStore(), mine = S.entries.filter(e => e.ref === p.ref && e.status === 'live')
    .sort((a, b) => String(b.updatedAt || b.approvedAt || '').localeCompare(String(a.updatedAt || a.approvedAt || '')));
  return { S, E: mine[0] || null };
}
async function sendTelegram(chatId, text) {
  const tok = process.env.BINA_RIDER_BOT_TOKEN;
  if (!tok || !chatId) return false;
  try { const r = await fetch('https://api.telegram.org/bot' + tok + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) }); return (await r.json()).ok === true; } catch (e) { return false; }
}
// @bina_smart_bot, /start rest_<token>: binds the owner's chat (ride/binaBot.js calls this through ride/index.js)
function linkTelegram(token, chatId) {
  if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return null;
  const S = R.readStore(), E = S.entries.find(e => e.status === 'live' && e.tgToken && H.tokEq(e.tgToken, token));
  if (!E) return null;
  // one use (1 Oct 2026 security pass): a link the owner forwarded must not let someone else take the orders later
  E.tgChatId = String(chatId); E.tgLinkedAt = new Date().toISOString(); E.tgToken = null; R.writeStore(S);
  return { name: E.restaurant };
}
// A table card's code (1 Oct 2026 security pass). The order and call links are public, so without it anyone anywhere could
// send "Table 5" orders to a restaurant's Telegram. Only cards the signed-in owner prints carry it; "New cards" changes it.
const cardKey = (E, table) => (E && E.tableKey && table > 0 ? crypto.createHmac('sha256', E.tableKey).update(String(table)).digest('hex').slice(0, 12) : null);
function cardOk(E, table, k) { const want = cardKey(E, table); return !!want && /^[a-f0-9]{12}$/.test(String(k || '')) && crypto.timingSafeEqual(Buffer.from(String(k)), Buffer.from(want)); }

const PAGE = (title, body, extra) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin">
<title>${esc(title)}</title><meta name="theme-color" content="#00704A"><link rel="icon" href="/icon-32.png"><link rel="stylesheet" href="/static/fonts/fonts.css?v=2"><link rel="stylesheet" href="/static/restaurants.css?v=1">${extra || ''}</head><body>${body}</body></html>`;

module.exports = function restaurantOrders(fastify, { limiter, tell, send }, done) {
  const notifyTeam = tell || R.tellTeam, sendTg = send || sendTelegram;   // tests pass their own send: no real Telegram
  const orderRL = limiter(600000, 6), placeRL = limiter(3600000, 80), editRL = limiter(3600000, 120), callRL = limiter(600000, 8);
  const who = req => (req.authUser && req.authUser.id ? req.authUser : null);
  const ipOf = req => String(req.headers['x-real-ip'] || req.ip || '');
  const owned = (S, id, uid) => S.entries.find(e => e.id === String(id || '').slice(0, 20) && e.ownerUserId === uid && ['live', 'hidden'].includes(e.status));

  // ---- the menu a table QR opens ----
  fastify.get('/restaurants/:slug/menu', async (req, reply) => {
    const p = R.places().bySlug.get(String(req.params.slug));
    const table = Math.max(0, Math.min(500, parseInt((req.query || {}).table, 10) || 0));
    if (!p) return reply.code(404).type('text/html; charset=utf-8').send(PAGE('Not found | BinaSmart', '<main class="w"><div class="none">This restaurant is not on BinaSmart. <a href="/restaurants">All restaurants</a></div></main>'));
    const { E } = entryFor(p), dishes = E ? (E.dishes || []) : [];
    reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store');
    if (!dishes.length) return reply.redirect('/restaurants/' + p.slug);   // nothing to order from: the restaurant's page
    const on = !!E.ordersOn, k = String((req.query || {}).k || '').slice(0, 20), can = on && table > 0 && cardOk(E, table, k);
    const rows = dishes.map((d, i) => '<div class="dish" data-i="' + i + '" data-p="' + (price(d.price) || '') + '"><span><b>' + esc(d.name) + '</b>' + (d.price ? '<br><small>' + esc(d.price) + '</small>' : '') + '</span>'
      + (can ? '<span class="qty"><button type="button" class="m" aria-label="less">−</button><i>0</i><button type="button" class="p" aria-label="more">+</button></span>' : '') + '</div>').join('');
    const body = '<header class="top"><div class="w"><a class="brand" href="/restaurants/' + esc(p.slug) + '"><i>🍽</i>' + esc(p.name) + (p.nameAm ? ' <small class="am">' + esc(p.nameAm) + '</small>' : '') + '</a>' + (table ? '<span class="join">🪑 Table ' + table + '</span>' : '') + '</div></header>'
      + '<main class="w" style="max-width:640px;padding-top:18px;padding-bottom:120px"><h1 style="font-size:24px;margin:4px 0">Menu · <span class="am">ሜኑ</span></h1><p class="muted">' + (can ? 'Choose your dishes and send the order. You pay at your table. · ይምረጡ፣ ይላኩ፣ በጠረጴዛዎ ይክፈሉ።' : on ? 'To order, scan the QR card on your table. · ለማዘዝ በጠረጴዛዎ ያለውን QR ይቃኙ።' : 'Prices from the restaurant. Order with the waiter. · ከአስተናጋጁ ያዙ።') + '</p>'
      + (can ? '<div class="calls"><button type="button" data-k="waiter">🙋 Call the waiter · አስተናጋጅ</button><button type="button" data-k="bill">🧾 Bring the bill · ሂሳብ</button></div><p class="muted" id="cmsg" hidden></p>' : '')
      + '<div class="dishes">' + rows + '</div>'
      + (can ? '<label style="display:block;font-weight:600;margin:16px 0 4px">Note for the kitchen (optional) · ማስታወሻ</label><input id="note" maxlength="140" style="width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--ln);border-radius:12px">' : '')
      + '<p class="src">Dishes and prices come from the restaurant. BinaSmart does not take payments or deliver food.</p></main>'
      + (can ? '<div id="bar" hidden style="position:fixed;left:0;right:0;bottom:0;background:var(--b);color:#fff;padding:14px 16px calc(14px + env(safe-area-inset-bottom));display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:700"><span id="sum"></span><button id="send" style="border:0;background:#fff;color:var(--b);font:inherit;font-weight:800;padding:12px 16px;border-radius:12px">Send order · ላክ</button></div>'
        + '<script>(function(){var T=' + table + ',K="' + k + '",S="' + esc(p.slug) + '",q={};function sum(){var n=0,t=0,un=false;[].forEach.call(document.querySelectorAll(".dish"),function(d){var k=q[d.getAttribute("data-i")]||0;d.querySelector("i").textContent=k;n+=k;var pr=parseFloat(d.getAttribute("data-p"));if(k){if(pr)t+=pr*k;else un=true;}});var b=document.getElementById("bar");b.hidden=!n;document.getElementById("sum").textContent=n+" · "+(t?t.toLocaleString()+" ETB":"")+(un?" + ?":"");}'
        + 'document.addEventListener("click",function(e){var d=e.target.closest(".dish");if(!d||!e.target.matches("button"))return;var i=d.getAttribute("data-i");q[i]=Math.max(0,Math.min(20,(q[i]||0)+(e.target.classList.contains("p")?1:-1)));sum();});'
        + 'function tbl(){return T||parseInt((document.getElementById("tb")||{}).value,10)||0}'
        + '[].forEach.call(document.querySelectorAll(".calls button"),function(b){b.addEventListener("click",function(){var tb=tbl(),m=document.getElementById("cmsg");if(!tb){alert("Please type your table number · የጠረጴዛ ቁጥር ያስገቡ");return;}b.disabled=true;'
        + 'fetch("/api/restaurants/"+S+"/call",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({table:tb,k:K,kind:b.getAttribute("data-k")})}).then(function(r){return r.json()}).then(function(j){m.hidden=false;m.textContent=j.ok?"✓ Sent. Someone will come to table "+tb+". · ተልኳል።":(j.error==="slow_down"?"Please wait a moment.":"Could not send. Please wave to the staff.");setTimeout(function(){b.disabled=false},j.ok?60000:3000);}).catch(function(){b.disabled=false;});});});'
        + 'document.getElementById("send").addEventListener("click",function(){var b=this,tb=tbl();if(!tb){alert("Please type your table number · የጠረጴዛ ቁጥር ያስገቡ");return;}var items=Object.keys(q).filter(function(i){return q[i]>0}).map(function(i){return{i:+i,qty:q[i]}});b.disabled=true;'
        + 'fetch("/api/restaurants/"+S+"/order",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({table:tb,k:K,items:items,note:(document.getElementById("note")||{}).value||""})}).then(function(r){return r.json()}).then(function(j){if(j.ok){document.querySelector("main").innerHTML="<div class=\\"card\\" style=\\"margin-top:30px;text-align:center\\"><div style=\\"font-size:56px\\">✓</div><h1>Order sent · ተልኳል</h1><p>Order "+j.code+" · Table "+tb+"</p><p class=\\"muted\\">The restaurant has it. Pay at your table. · በጠረጴዛዎ ይክፈሉ።</p></div>";document.getElementById("bar").hidden=true;}else{b.disabled=false;alert(j.error==="off"?"Ordering is off right now. Please ask the waiter.":j.error==="slow_down"?"Please wait a moment and try again.":"Could not send. Please ask the waiter.");}}).catch(function(){b.disabled=false;alert("Could not send. Please ask the waiter.");});});})();</script>' : '');
    const css = '<style>.dish{align-items:center}.dish>span:first-child{color:var(--ink);font-weight:400;white-space:normal}.dish small{color:var(--b);font-weight:700;font-size:15px}'
      + '.qty{display:flex;align-items:center;gap:10px}.qty button{width:38px;height:38px;border-radius:50%;border:1px solid var(--b);background:#fff;color:var(--b);font-size:20px;font-weight:700;cursor:pointer}.qty i{font-style:normal;min-width:18px;text-align:center;color:var(--ink);font-weight:700}'
      + '.calls{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.calls button{border:1px solid var(--b);background:#fff;color:var(--b);font:inherit;font-weight:700;padding:12px 8px;border-radius:14px;cursor:pointer}.calls button:disabled{opacity:.5}</style>';
    return reply.type('text/html; charset=utf-8').send(PAGE(p.name + ' · Menu | BinaSmart', body, css));
  });

  // ---- printable table cards ----
  fastify.get('/restaurants/:slug/qr', async (req, reply) => {
    const p = R.places().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).send('not found');
    const n = Math.max(1, Math.min(60, parseInt((req.query || {}).n, 10) || 8)), from = Math.max(1, Math.min(500, parseInt((req.query || {}).from, 10) || 1));
    const { S, E } = entryFor(p), uid = req.authUser && req.authUser.id, own = !!(E && uid && E.ownerUserId === uid);
    if (own && !E.tableKey) { E.tableKey = crypto.randomBytes(16).toString('hex'); R.writeStore(S); }
    const cards = Array.from({ length: n }, (_, k) => from + k).map(t => {
      const pth = '/restaurants/' + p.slug + '/menu?table=' + t + (own ? '&k=' + cardKey(E, t) : '');
      return '<div class="qc"><div class="qt"><b>' + esc(p.name) + '</b>' + (p.nameAm ? '<span class="am">' + esc(p.nameAm) + '</span>' : '') + '</div><div class="tn">' + t + '</div>'
        + '<img src="/qr.svg?p=' + encodeURIComponent(pth) + '" alt="QR for table ' + t + '"><div class="st">Scan · Order · Eat<br><span class="am">ይቃኙ · ይዘዙ · ይመገቡ</span></div><div class="ft">No app needed · bina.et</div></div>';
    }).join('');
    const css = '<style>@page{size:A4;margin:10mm}body{background:#fff}.bar{max-width:820px;margin:16px auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:0 16px}.bar input{width:80px;font:inherit;padding:8px;border:1px solid #ccc;border-radius:8px}.bar button,.bar a{background:#00704A;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}'
      + '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6mm;max-width:190mm;margin:0 auto}.qc{border:1px dashed #9ca3af;border-radius:10px;overflow:hidden;text-align:center;break-inside:avoid;padding-bottom:8px}.qt{background:#00704A;color:#fff;padding:8px}.qt b{display:block;font-size:17px}.qt span{font-size:13px}'
      + '.tn{font-size:40px;font-weight:800;color:#00704A;margin:4px 0}.qc img{width:46mm;height:46mm}.st{font-weight:700;margin-top:4px}.ft{color:#6b7280;font-size:12px;margin-top:4px}@media print{.bar{display:none}}</style>';
    const bar = '<form class="bar" method="get"><b>Table cards for ' + esc(p.name) + '</b> Tables <input name="from" value="' + from + '" inputmode="numeric"> to <input name="to" value="' + (from + n - 1) + '" inputmode="numeric" oninput="this.form.n.value=Math.max(1,(+this.value)-(+this.form.from.value)+1)"><input type="hidden" name="n" value="' + n + '"><button>Show</button><a href="#" onclick="print();return false">🖨 Print</a></form>';
    const who = '<p class="bar" style="color:' + (own ? '#065f46' : '#92400e') + '">' + (own
      ? 'These cards take orders for your tables. Keep them in the restaurant; if a photo of one gets out, press "New cards" in your dashboard and print again.'
      : 'These cards open the menu only. The owner, signed in at bina.et/restaurants/dashboard, prints cards that take orders.') + '</p>';
    reply.header('X-Robots-Tag', 'noindex').header('Cache-Control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(PAGE('Table QR cards · ' + p.name + ' | BinaSmart', bar + who + '<div class="grid">' + cards + '</div>', css));
  });

  // ---- a guest's order ----
  fastify.post('/api/restaurants/:slug/order', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const p = R.places().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!orderRL('ip:' + ipOf(req)) || !placeRL('p:' + p.ref)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const { E } = entryFor(p);
    if (!E || !E.ordersOn || !(E.dishes || []).length) return reply.code(400).send({ ok: false, error: 'off' });
    const b = req.body || {}, table = parseInt(b.table, 10);
    if (!(table >= 1 && table <= 500)) return reply.code(400).send({ ok: false, error: 'table' });
    if (!cardOk(E, table, b.k)) return reply.code(400).send({ ok: false, error: 'card' });
    const items = (Array.isArray(b.items) ? b.items : []).map(x => ({ i: parseInt(x && x.i, 10), qty: Math.min(20, parseInt(x && x.qty, 10) || 0) }))
      .filter(x => x.qty > 0 && E.dishes[x.i]).slice(0, 30)
      .map(x => { const d = E.dishes[x.i]; return { name: d.name, price: price(d.price), qty: x.qty }; });   // the restaurant's own prices, never the guest's
    if (!items.length) return reply.code(400).send({ ok: false, error: 'empty' });
    const total = items.reduce((s, x) => s + (x.price ? x.price * x.qty : 0), 0);
    const o = { id: crypto.randomBytes(5).toString('hex'), code: crypto.randomBytes(2).toString('hex').toUpperCase(), entryId: E.id, ref: E.ref, table, items, total,
      priced: items.every(x => x.price), note: H.clean(b.note, 140) || null, createdAt: new Date().toISOString(), status: 'new' };
    const O = readOrders(); O.orders.push(o); writeOrders(O);
    const text = '🍽 New order ' + o.code + ' · Table ' + table + '\n' + items.map(x => x.qty + ' × ' + x.name + (x.price ? ' (' + x.price + ')' : '')).join('\n')
      + (total ? '\nTotal: ' + total.toLocaleString('en-US') + ' ETB' + (o.priced ? '' : ' + items without a price') : '') + (o.note ? '\nNote: ' + o.note : '') + '\nPay at the table. Dashboard: bina.et/restaurants/dashboard';
    const sent = await sendTg(E.tgChatId, text).catch(() => false);
    o.telegram = sent; writeOrders(Object.assign(O, { orders: O.orders.map(x => (x.id === o.id ? o : x)) }));
    return { ok: true, code: o.code, total };
  });

  // ---- "call the waiter" / "bring the bill" from the table (same switch as ordering) ----
  fastify.post('/api/restaurants/:slug/call', { bodyLimit: 1024 }, async (req, reply) => {
    const p = R.places().bySlug.get(String(req.params.slug));
    if (!p) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {}, table = parseInt(b.table, 10), kind = String(b.kind || '');
    if (!['waiter', 'bill'].includes(kind)) return reply.code(400).send({ ok: false, error: 'kind' });
    if (!(table >= 1 && table <= 500)) return reply.code(400).send({ ok: false, error: 'table' });
    if (!callRL('ip:' + ipOf(req)) || !placeRL('p:' + p.ref)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const { E } = entryFor(p);
    if (!E || !E.ordersOn || !(E.dishes || []).length) return reply.code(400).send({ ok: false, error: 'off' });
    if (!cardOk(E, table, b.k)) return reply.code(400).send({ ok: false, error: 'card' });
    const O = readOrders(), now = Date.now();
    // a second tap while the first is still open is the same call: no second Telegram
    const open = O.orders.find(o => o.type === 'call' && o.entryId === E.id && o.table === table && o.kind === kind && o.status === 'new' && now - Date.parse(o.createdAt) < 120000);
    if (open) return { ok: true, duplicate: true };
    const c = { id: crypto.randomBytes(5).toString('hex'), type: 'call', kind, entryId: E.id, ref: E.ref, table, items: [], total: 0, createdAt: new Date().toISOString(), status: 'new' };
    O.orders.push(c); writeOrders(O);
    c.telegram = await sendTg(E.tgChatId, (kind === 'bill' ? '🧾 Table ' + table + ' asks for the bill.' : '🙋 Table ' + table + ' is calling the waiter.') + '\nDashboard: bina.et/restaurants/dashboard').catch(() => false);
    writeOrders(Object.assign(O, { orders: O.orders.map(x => (x.id === c.id ? c : x)) }));
    return { ok: true };
  });

  // ---- the owner's side (signed in, as in restaurants/dashboard.js) ----
  fastify.get('/api/restaurants/mine/:id/orders', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const E = owned(R.readStore(), req.params.id, u.id); if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    return { ok: true, ordersOn: !!E.ordersOn, telegram: !!E.tgChatId, orders: readOrders().orders.filter(o => o.entryId === E.id).slice(-50).reverse() };
  });
  fastify.post('/api/restaurants/mine/:id/orders/:oid', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const E = owned(R.readStore(), req.params.id, u.id); if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    const st = String((req.body || {}).status || ''); if (!['seen', 'done'].includes(st)) return reply.code(400).send({ ok: false, error: 'status' });
    const O = readOrders(), o = O.orders.find(x => x.id === String(req.params.oid) && x.entryId === E.id);
    if (!o) return reply.code(404).send({ ok: false, error: 'not_found' });
    o.status = st; o[st + 'At'] = new Date().toISOString(); writeOrders(O);
    return { ok: true };
  });
  fastify.post('/api/restaurants/mine/:id/settings', async (req, reply) => {
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    if (!editRL('u:' + u.id)) return reply.code(429).send({ ok: false, error: 'slow_down' });
    const S = R.readStore(), E = owned(S, req.params.id, u.id); if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    const b = req.body || {};
    if (b.ordersOn !== undefined) {
      if (b.ordersOn === true && !(E.dishes || []).length) return reply.code(400).send({ ok: false, error: 'no_dishes' });
      E.ordersOn = b.ordersOn === true;
      if (E.ordersOn && !E.tableKey) E.tableKey = crypto.randomBytes(16).toString('hex');
    }
    if (b.newCards === true) E.tableKey = crypto.randomBytes(16).toString('hex');   // the old cards only show the menu from now on
    R.writeStore(S);
    if (b.newCards === true) notifyTeam('🍽 <b>' + esc(E.restaurant) + '</b> printed new table cards (the old ones no longer take orders).').catch(() => {});
    if (b.ordersOn !== undefined) notifyTeam('🍽 <b>' + esc(E.restaurant) + '</b> turned table ordering ' + (E.ordersOn ? 'ON' : 'off') + '.').catch(() => {});
    return { ok: true, ordersOn: !!E.ordersOn };
  });
  fastify.get('/api/restaurants/mine/:id/telegram', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const u = who(req); if (!u) return reply.code(401).send({ ok: false, error: 'not_signed_in' });
    const S = R.readStore(), E = owned(S, req.params.id, u.id); if (!E) return reply.code(404).send({ ok: false, error: 'not_found' });
    if (!E.tgToken) { E.tgToken = crypto.randomBytes(16).toString('hex'); R.writeStore(S); }
    return { ok: true, linked: !!E.tgChatId, url: 'https://t.me/' + BOT() + '?start=rest_' + E.tgToken };
  });
  done();
};
Object.assign(module.exports, { linkTelegram, readOrders, price, cardKey, cardOk });
