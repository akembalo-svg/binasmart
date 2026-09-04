'use strict';
// Checkout is a transaction: verify every seat is held by THIS holder and not sold, price each seat
// from the show's section prices, create the ticket, delete the holds. The idempotency key makes a
// double tap return the same ticket. Counter reservations are released at the cutoff by a sweep.
const crypto = require('crypto');
const QR = require('qrcode');
const { normPhone } = require('../ride/phone');
const { priceOf, isSeat } = require('./seatmap');
const { SOLD_STATES } = require('./holds');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
function makeCode() {
  const b = crypto.randomBytes(6); let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return 'BINA-' + s;
}

const TZ = 'Africa/Addis_Ababa';
function whenAddis(d) {
  return new Date(d).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}

function makeTickets({ prisma, holds, now, notify, baseUrl }) {
  const clock = now || Date.now;
  const base = (baseUrl || 'https://bina.et').replace(/\/$/, '');
  const ticketUrl = code => base + '/ticket/' + code;
  const send = (t, text) => notify ? Promise.resolve().then(() => notify(t, text)).catch(e => console.error('[cinema/tickets] notify failed: ' + e.message)) : Promise.resolve(false);

  async function checkout({ showId, holderKey, seats, name, phone, guest, payMethod, telegramId, idemKey }) {
    if (idemKey) { const dup = await prisma.ticket.findUnique({ where: { idemKey } }); if (dup) return { ok: true, ticket: dup, duplicate: true }; }
    const show = await prisma.show.findUnique({ where: { id: showId }, include: { hall: { include: { venue: true } }, event: true } });
    if (!show) return { ok: false, error: 'no_show' };
    if (show.status !== 'onsale') return { ok: false, error: 'show_closed' };
    seats = [...new Set((Array.isArray(seats) ? seats : []).filter(s => isSeat(show.hall.layout, s)))];
    if (!seats.length) return { ok: false, error: 'no_seats' };
    // Who is the ticket for? Booking for someone else needs an Ethiopian number for the guest.
    let who = { name: String(name || '').trim().slice(0, 60), phone: normPhone(phone) };
    if (guest && (guest.name || guest.phone)) who = { name: String(guest.name || '').trim().slice(0, 60), phone: normPhone(guest.phone) };
    if (!who.phone) return { ok: false, error: 'phone' };
    if (!who.name) return { ok: false, error: 'name' };
    const method = payMethod === 'chapa' ? 'chapa' : 'counter';

    const out = await prisma.$transaction(async tx => {
      const t = clock();
      const mine = (await tx.seatHold.findMany({ where: { showId, holderKey, seat: { in: seats } } })).filter(h => h.expiresAt.getTime() > t);
      const missing = seats.filter(s => !mine.some(h => h.seat === s));
      if (missing.length) return { ok: false, error: 'hold_expired', seats: missing };
      const sold = new Set((await tx.ticket.findMany({ where: { showId, status: { in: SOLD_STATES } } })).flatMap(x => x.seats || []));
      const gone = seats.filter(s => sold.has(s));
      if (gone.length) return { ok: false, error: 'sold', seats: gone };
      let total = 0; for (const s of seats) total += priceOf(show.hall.layout, show.prices, s);
      let ticket = null;
      for (let attempt = 0; attempt < 3 && !ticket; attempt++) {
        try {
          ticket = await tx.ticket.create({ data: { code: makeCode(), showId, seats, name: who.name, phone: who.phone, telegramId: telegramId ? String(telegramId) : null, total, payMethod: method, status: 'RESERVED', idemKey: idemKey || null } });
        } catch (e) {
          if (!e || e.code !== 'P2002') throw e;
          if (idemKey) { const dup = await tx.ticket.findUnique({ where: { idemKey } }); if (dup) return { ok: true, ticket: dup, duplicate: true }; }
          // otherwise a code collision (1 in 32^6): loop and draw another
        }
      }
      if (!ticket) return { ok: false, error: 'code_collision' };
      await tx.seatHold.deleteMany({ where: { showId, holderKey, seat: { in: seats } } });
      return { ok: true, ticket, show };
    });
    if (out.ok && !out.duplicate) await send(out.ticket, ticketText(out.ticket, out.show));
    return out;
  }

  function ticketText(t, show) {
    const venue = show.hall && show.hall.venue;
    const pay = t.payMethod === 'counter'
      ? 'በካውንተር ይከፈላል · pay at the counter' + (show.counterCutoffMin ? ' (' + show.counterCutoffMin + ' ደቂቃ በፊት · ' + show.counterCutoffMin + ' min before)' : '')
      : (t.status === 'CONFIRMED' ? 'ተከፍሏል · paid (Chapa)' : 'Chapa · በመጠበቅ ላይ · awaiting payment');
    return ['🎟️ ' + (show.event.titleAm || show.event.title),
      '📍 ' + (venue ? venue.name : '') + (show.hall.name ? ' · ' + show.hall.name : ''),
      '🕒 ' + whenAddis(show.startsAt),
      '💺 ' + t.seats.join(', '),
      '💰 ' + t.total + ' ብር · ' + pay,
      '', 'ኮድ · Code: ' + t.code, ticketUrl(t.code)].join('\n');
  }

  async function markPaid(code, via, chapaRef) {
    const data = { status: 'CONFIRMED', payMethod: via === 'chapa' ? 'chapa' : 'counter' };
    if (chapaRef) data.chapaRef = chapaRef;
    const r = await prisma.ticket.updateMany({ where: { code, status: 'RESERVED' }, data });
    return r.count > 0;
  }

  async function cancel(code) {
    const r = await prisma.ticket.updateMany({ where: { code, status: { in: ['RESERVED', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } });
    return r.count > 0;
  }

  // Counter reservations that are still unpaid at the cutoff give their seats back.
  async function releaseUnpaid(shows) {
    let n = 0; const t = clock();
    for (const show of shows) {
      const cutoff = new Date(show.startsAt).getTime() - (show.counterCutoffMin == null ? 30 : show.counterCutoffMin) * 60000;
      if (t < cutoff) continue;
      const due = await prisma.ticket.findMany({ where: { showId: show.id, status: 'RESERVED', payMethod: 'counter' } });
      for (const tk of due) {
        const r = await prisma.ticket.updateMany({ where: { id: tk.id, status: 'RESERVED' }, data: { status: 'CANCELLED' } });
        if (r.count) { n++; await send(tk, '⌛ ' + tk.code + ' · ' + tk.seats.join(', ') + ' — ክፍያው በሰዓቱ ስላልተፈጸመ ወንበሮቹ ተለቀዋል። · released: unpaid by the cutoff.'); }
      }
    }
    return n;
  }

  async function qrSvg(code) { return QR.toString(ticketUrl(code), { type: 'svg', margin: 1, width: 320, errorCorrectionLevel: 'M' }); }

  return { checkout, markPaid, cancel, releaseUnpaid, qrSvg, ticketText, ticketUrl };
}

module.exports = { makeTickets, makeCode, whenAddis };
