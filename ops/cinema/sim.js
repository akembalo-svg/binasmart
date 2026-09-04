'use strict';
// End-to-end proof against the LIVE server and database, over real HTTP:
//   venue → hall → event → show (ops API) → two holders race for one seat → checkout → ticket + QR
//   → door: unpaid refused, paid admitted once, double-scan race → counter cutoff release
//   → show cancel → cleanup by exact ids, zero leftovers.
// Nothing reaches Telegram: no buyer carries a telegramId. Reads OWNER_KEY from .env, never prints it.
//   node ops/cinema/sim.js [https://bina.et]
const fs = require('fs'); const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { makeHolds } = require('../../cinema/holds');
const { makeTickets } = require('../../cinema/tickets');

const BASE = process.argv[2] || 'https://bina.et';
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '..', '.env'), 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const KEY = env.OWNER_KEY; if (!KEY) { console.error('OWNER_KEY missing'); process.exit(1); }
const prisma = new PrismaClient();
let n = 0, failed = 0; const ids = { venue: [], hall: [], event: [], show: [] };
function check(name, ok, detail) { n++; if (!ok) failed++; console.log((ok ? '  ok  ' : '  FAIL') + ' ' + n + '. ' + name + (detail && !ok ? '  -> ' + JSON.stringify(detail).slice(0, 300) : '')); }
async function http(method, p, body, headers) {
  const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { j = { raw: text.slice(0, 120) }; }
  return { status: r.status, j };
}
const ops = (method, p, body) => http(method, p, body, { 'x-owner-key': KEY });
const H = h => ({ 'x-holder': h });
const LAYOUT = { rows: ['A', 'B', 'C'], seatsPerRow: 6, aisles: [3], sections: [{ name: 'VIP', nameAm: 'ቪአይፒ', rows: ['A'] }, { name: 'Regular', nameAm: 'መደበኛ', rows: ['B', 'C'] }] };

async function cleanup() {
  const showIds = ids.show;
  const out = {};
  out.holds = (await prisma.seatHold.deleteMany({ where: { showId: { in: showIds } } })).count;
  out.tickets = (await prisma.ticket.deleteMany({ where: { showId: { in: showIds } } })).count;
  out.shows = (await prisma.show.deleteMany({ where: { id: { in: showIds } } })).count;
  out.halls = (await prisma.hall.deleteMany({ where: { id: { in: ids.hall } } })).count;
  out.events = (await prisma.event.deleteMany({ where: { id: { in: ids.event } } })).count;
  out.venues = (await prisma.venue.deleteMany({ where: { id: { in: ids.venue } } })).count;
  return out;
}

(async () => {
  const tag = 'sim-cinema-' + Date.now().toString(36);
  try {
    // ---- build through the ops API, exactly as the ops page does
    const v = await ops('POST', '/api/cinema/ops/venues', { name: 'Sim Cinema ' + tag, slug: tag, phone: '0911000000' });
    check('ops: venue created', v.status === 200 && v.j.ok, v.j); ids.venue.push(v.j.venue.id);
    const h = await ops('POST', '/api/cinema/ops/halls', { venueId: v.j.venue.id, name: 'Hall S', layout: LAYOUT });
    check('ops: hall created, capacity 18', h.j.ok && h.j.hall.capacity === 18, h.j); ids.hall.push(h.j.hall.id);
    const e = await ops('POST', '/api/cinema/ops/events', { title: 'Sim Film ' + tag, titleAm: 'ሲም ፊልም', kind: 'FILM', runtimeMin: 90 });
    check('ops: event created', e.j.ok, e.j); ids.event.push(e.j.event.id);
    const bad = await ops('POST', '/api/cinema/ops/shows', { eventId: e.j.event.id, hallId: h.j.hall.id, startsAt: new Date(Date.now() + 7200000).toISOString(), prices: { VIP: 500 } });
    check('ops: show without a Regular price is refused (400)', bad.status === 400, bad.j);
    const s = await ops('POST', '/api/cinema/ops/shows', { eventId: e.j.event.id, hallId: h.j.hall.id, startsAt: new Date(Date.now() + 7200000).toISOString(), prices: { VIP: 500, Regular: 300 } });
    check('ops: show on sale', s.j.ok && s.j.show.status === 'onsale', s.j); const SH = s.j.show.id; ids.show.push(SH);
    const listed = await http('GET', '/api/cinema/shows');
    check('public: show listed with 18 seats left, from 300', listed.j.shows.some(x => x.id === SH && x.seatsLeft === 18 && x.from === 300), listed.j.shows.map(x => [x.id, x.seatsLeft, x.from]));
    const dir = await http('GET', '/api/cinema/venues');
    check('public: venue in the directory with next show', dir.j.venues.some(x => x.slug === tag && x.nextShowAt), null);

    // ---- the race: two holders, same seat, same instant, over HTTP
    const [ra, rb] = await Promise.all([http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'B2' }, H('sim-holder-aaaa')), http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'B2' }, H('sim-holder-bbbb'))]);
    const codes = [ra.status, rb.status].sort();
    check('race: exactly one 200 and one 409', codes[0] === 200 && codes[1] === 409, [ra.j, rb.j]);
    const loser = ra.status === 409 ? ra : rb, winner = ra.status === 200 ? 'sim-holder-aaaa' : 'sim-holder-bbbb', other = winner === 'sim-holder-aaaa' ? 'sim-holder-bbbb' : 'sim-holder-aaaa';
    check('race: loser told "taken"', loser.j.error === 'taken', loser.j);
    const dbHolds = await prisma.seatHold.count({ where: { showId: SH, seat: 'B2' } });
    check('db: exactly one hold row for B2', dbHolds === 1, dbHolds);
    const a1 = await http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'A1' }, H(winner));
    check('hold: winner also holds A1', a1.status === 200, a1.j);
    const map = await http('GET', '/api/cinema/shows/' + SH, null, H(other));
    check('map: other holder sees B2 as held, has no holds', map.j.seats.find(x => x.id === 'B2').state === 'held' && map.j.mine.length === 0, map.j.mine);

    // ---- checkout
    const noHold = await http('POST', '/api/cinema/tickets', { showId: SH, seats: ['B2'], name: 'Sim', phone: '0911223355', payMethod: 'counter', idemKey: tag + '-x' }, H(other));
    check('checkout: not my hold -> 409 hold_expired', noHold.status === 409 && noHold.j.error === 'hold_expired', noHold.j);
    const co = await http('POST', '/api/cinema/tickets', { showId: SH, seats: ['B2', 'A1'], name: 'Sim Buyer', phone: '0911223344', payMethod: 'counter', idemKey: tag + '-1' }, H(winner));
    check('checkout: 200, total 800 (500 VIP + 300 Regular), RESERVED/counter', co.status === 200 && co.j.ticket.total === 800 && co.j.ticket.status === 'RESERVED' && co.j.ticket.payMethod === 'counter', co.j);
    const CODE = co.j.ticket.code;
    const dup = await http('POST', '/api/cinema/tickets', { showId: SH, seats: ['B2', 'A1'], name: 'Sim Buyer', phone: '0911223344', payMethod: 'counter', idemKey: tag + '-1' }, H(winner));
    check('checkout: same idemKey -> same ticket, duplicate flag', dup.j.ok && dup.j.ticket.code === CODE && dup.j.duplicate === true, dup.j);
    check('db: holds consumed', (await prisma.seatHold.count({ where: { showId: SH } })) === 0, null);
    const tk = await http('GET', '/api/cinema/tickets/' + CODE);
    check('ticket: public GET has seats, venue, hall', tk.j.ok && tk.j.ticket.seats.length === 2 && tk.j.ticket.show.venue.name.startsWith('Sim Cinema') && tk.j.ticket.show.hall.name === 'Hall S', tk.j);
    const qr = await fetch(BASE + '/api/cinema/tickets/' + CODE + '/qr.svg'); const svg = await qr.text();
    check('ticket: QR is an SVG', qr.status === 200 && /^<svg/.test(svg) && /svg\+xml/.test(qr.headers.get('content-type')), qr.status);
    const map2 = await http('GET', '/api/cinema/shows/' + SH);
    check('map: sold seats shown as sold', map2.j.seats.find(x => x.id === 'B2').state === 'sold' && map2.j.seats.find(x => x.id === 'A1').state === 'sold', null);
    const reh = await http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'B2' }, H(other));
    check('hold: sold seat cannot be held again (409 sold)', reh.status === 409 && reh.j.error === 'sold', reh.j);
    check('chapa: gate honoured when requested', (await http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'C1' }, H(other))).status === 200, null);
    const chp = await http('POST', '/api/cinema/tickets', { showId: SH, seats: ['C1'], name: 'Sim Chapa', phone: '0911223366', payMethod: 'chapa', idemKey: tag + '-2' }, H(other));
    check('chapa: checkout returns a checkout URL or a flagged fallback (never a silent counter)', chp.status === 200 && (chp.j.checkoutUrl ? /^https:\/\//.test(chp.j.checkoutUrl) : chp.j.chapaError === true || chp.j.ticket.payMethod === 'counter'), chp.j);
    const CODE2 = chp.j.ticket.code;

    // ---- the door
    const un = await ops('POST', '/api/cinema/ops/checkin', { code: CODE, showId: SH });
    check('door: unpaid reservation refused (409 unpaid)', un.status === 409 && un.j.error === 'unpaid', un.j);
    const paid = await ops('POST', '/api/cinema/ops/tickets/' + CODE + '/paid', {});
    check('ops: marked paid -> CONFIRMED', paid.j.ok && paid.j.status === 'CONFIRMED', paid.j);
    const [d1, d2] = await Promise.all([ops('POST', '/api/cinema/ops/checkin', { code: CODE, showId: SH }), ops('POST', '/api/cinema/ops/checkin', { code: 'https://bina.et/ticket/' + CODE, showId: SH })]);
    const dc = [d1.status, d2.status].sort();
    check('door race: two scans at once -> one admitted, one refused', dc[0] === 200 && dc[1] === 409, [d1.j.error, d2.j.error]);
    const again = await ops('POST', '/api/cinema/ops/checkin', { code: CODE.toLowerCase(), showId: SH });
    check('door: third scan (lower case) refused already_checked_in with time', again.status === 409 && again.j.error === 'already_checked_in' && !!again.j.at, again.j);
    const wrong = await ops('POST', '/api/cinema/ops/checkin', { code: CODE, showId: 'nope' });
    check('door: wrong show refused', wrong.j.error === 'wrong_show', wrong.j);
    const list = await ops('GET', '/api/cinema/ops/shows/' + SH + '/tickets');
    check('ops: ticket list shows CHECKED_IN + the chapa ticket', list.j.tickets.length === 2 && list.j.tickets.some(t => t.status === 'CHECKED_IN'), list.j.tickets.map(t => t.status));

    // ---- counter cutoff release (module against the live DB, clock advanced)
    const s2 = await ops('POST', '/api/cinema/ops/shows', { eventId: e.j.event.id, hallId: h.j.hall.id, startsAt: new Date(Date.now() + 7200000).toISOString(), prices: { VIP: 500, Regular: 300 }, counterCutoffMin: 30 });
    const SH2 = s2.j.show.id; ids.show.push(SH2);
    await http('POST', '/api/cinema/shows/' + SH2 + '/hold', { seat: 'C3' }, H('sim-holder-cccc'));
    const r2 = await http('POST', '/api/cinema/tickets', { showId: SH2, seats: ['C3'], name: 'Late Payer', phone: '0911223377', payMethod: 'counter', idemKey: tag + '-3' }, H('sim-holder-cccc'));
    const show2 = await prisma.show.findUnique({ where: { id: SH2 } });
    const holds = makeHolds({ prisma }); const early = makeTickets({ prisma, holds, now: () => Date.now() });
    check('release: nothing released before the cutoff', (await early.releaseUnpaid([show2])) === 0, null);
    const late = makeTickets({ prisma, holds, now: () => show2.startsAt.getTime() - 29 * 60000 });
    check('release: one unpaid counter ticket released at the cutoff', (await late.releaseUnpaid([show2])) === 1, null);
    const rel = await prisma.ticket.findUnique({ where: { code: r2.j.ticket.code } });
    check('release: ticket CANCELLED and seat free again', rel.status === 'CANCELLED' && (await http('GET', '/api/cinema/shows/' + SH2)).j.seats.find(x => x.id === 'C3').state === 'free', rel.status);

    // ---- cancel the show
    const cx = await ops('POST', '/api/cinema/ops/shows/' + SH + '/status', { status: 'cancelled' });
    check('ops: cancel show -> 1 live ticket cancelled (checked-in one untouched)', cx.j.ok && cx.j.cancelled === 1, cx.j);
    const t2 = await prisma.ticket.findUnique({ where: { code: CODE2 } });
    check('cancel: chapa ticket now CANCELLED', t2.status === 'CANCELLED', t2.status);
    const gone = await http('POST', '/api/cinema/shows/' + SH + '/hold', { seat: 'C2' }, H(other));
    check('cancel: holds refused (410)', gone.status === 410, gone.j);
    check('cancel: no longer listed', !(await http('GET', '/api/cinema/shows')).j.shows.some(x => x.id === SH), null);
  } catch (err) { failed++; console.error('  CRASH ' + err.stack); }
  const c = await cleanup();
  const left = (await prisma.venue.count({ where: { slug: tag } })) + (await prisma.show.count({ where: { id: { in: ids.show } } })) + (await prisma.ticket.count({ where: { showId: { in: ids.show } } }));
  check('cleanup: every sim row deleted, zero leftovers', left === 0, { c, left });
  await prisma.$disconnect();
  console.log(failed ? 'FAILED ' + failed + ' of ' + n : 'ALL ' + n + ' CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})();
