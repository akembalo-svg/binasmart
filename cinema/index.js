'use strict';
const { makeHolds } = require('./holds');
const { makeTickets } = require('./tickets');
const { makeCheckin } = require('./checkin');
const { makeTgApi } = require('../ride/tgApi');
const routes = require('./routes');

// registerCinema(fastify, { prisma, OWNER_KEY, BASE_URL, chapa?, tgApi?, riderBotToken?, force?, noTimers? })
// Mounted only when CINEMA_ENABLED=1 (or deps.force in tests). Returns null when disabled.
module.exports = function registerCinema(fastify, deps) {
  if (process.env.CINEMA_ENABLED !== '1' && !deps.force) { console.log('[cinema] disabled (CINEMA_ENABLED != 1)'); return null; }
  const prisma = deps.prisma;
  const base = (deps.BASE_URL || 'https://bina.et').replace(/\/$/, '');
  const riderBotToken = deps.riderBotToken != null ? deps.riderBotToken : (process.env.BINA_RIDER_BOT_TOKEN || '');
  const api = deps.tgApi || (riderBotToken ? makeTgApi({ token: riderBotToken }) : null);

  // Buyers who came through Telegram get their ticket in @bina_smart_bot; web buyers have the ticket page.
  const notify = async (ticket, text) => {
    if (!ticket || !ticket.telegramId || !api) return false;
    try {
      await api.sendMessage(String(ticket.telegramId), text, { reply_markup: { inline_keyboard: [[{ text: '🎟️ ትኬቴን ክፈት · Open ticket', web_app: { url: base + '/ticket/' + ticket.code } }]] } });
      return true;
    } catch (e) { console.error('[cinema] telegram send failed for ' + ticket.code + ': ' + e.message); return false; }
  };

  const holds = makeHolds({ prisma });
  const tickets = makeTickets({ prisma, holds, notify, baseUrl: base });
  const checkin = makeCheckin({ prisma });
  const r = routes(fastify, { prisma, holds, tickets, checkin, OWNER_KEY: deps.OWNER_KEY, riderBotToken, chapa: deps.chapa || null, BASE_URL: base, notify });

  if (!deps.noTimers) {
    // Two idempotent loops, both safe to miss a beat: expired holds go back on the map; unpaid
    // counter reservations are released at the show's cutoff.
    const t1 = setInterval(() => holds.sweep().catch(e => console.error('[cinema] hold sweep: ' + e.message)), 30000);
    const t2 = setInterval(async () => {
      try {
        const soon = await prisma.show.findMany({ where: { status: 'onsale', startsAt: { gte: new Date(Date.now() - 3600000), lte: new Date(Date.now() + 6 * 3600000) } } });
        const n = await tickets.releaseUnpaid(soon);
        if (n) console.log('[cinema] released ' + n + ' unpaid reservation(s)');
      } catch (e) { console.error('[cinema] release sweep: ' + e.message); }
    }, 60000);
    t1.unref(); t2.unref();
  }
  console.log('[cinema] mounted' + (api ? ' (Telegram delivery on)' : ' (no rider bot token)') + (deps.chapa && deps.chapa.enabled ? ' chapa=' + deps.chapa.mode : ' chapa=off'));
  return { holds, tickets, checkin, confirmChapa: r.confirmChapa, notify };
};
