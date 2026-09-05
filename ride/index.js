'use strict';
const path = require('path');
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
const { makeLocation } = require('./location');
const { makeOffers } = require('./offers');
const { makeDriverApi } = require('./driverApi');
const { makeTgApi } = require('./tgApi');
const { makeBinaBot } = require('./binaBot');
const { makeDriverBot } = require('./driverBot');
const { makeRiderNotify } = require('./riderNotify');
const routes = require('./routes');

// registerRide(fastify, { prisma, sendTg, OWNER_KEY, OWNER_CHAT, ROUTER_URL, BASE_URL })
module.exports = function registerRide(fastify, deps) {
  const settings = makeSettings(deps.prisma);
  const geo = makeGeo({ routerUrl: deps.ROUTER_URL, prisma: deps.prisma });
  // Telegram bots (rider @bina_smart_bot, driver @binasmartdriverbot). Tokens only from .env.
  const riderBotToken = process.env.BINA_RIDER_BOT_TOKEN || '', driverBotToken = process.env.BINA_DRIVER_BOT_TOKEN || '';
  const riderApi = makeTgApi({ token: riderBotToken }), driverTgApi = makeTgApi({ token: driverBotToken });
  // Owner alerts go through the BinaSmart bot to BINA_OWNER_TG_CHAT when set; legacy shared bot is the fallback.
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY,
    api: riderBotToken ? riderApi : null, ownerChatNew: process.env.BINA_OWNER_TG_CHAT || '' });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });
  // Driver positions arrive here and nowhere else. offers/driverApi read through it, so swapping the
  // transport later (WebSockets) touches this module and the browser only.
  const location = makeLocation({ prisma: deps.prisma, api: driverTgApi });
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'drivers');
  // @bina_smart_bot is the whole BinaSmart: service menu + Bini (via the app's own /api/assistant on localhost).
  const riderBot = makeBinaBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
    // only a live, onboarded shop can be linked; a demo row or a guessed id links nothing
    linkShop: async (shopId, chatId) => { const n = await deps.prisma.shop.updateMany({ where: { id: shopId, status: 'live' }, data: { tgChatId: String(chatId) } });
      return n.count ? deps.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, nameAm: true } }) : null; },
    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant' });
  const riderNotify = makeRiderNotify({ prisma: deps.prisma, api: riderApi, baseUrl: deps.BASE_URL });
  // offers needs dispatch (to escalate and to cancel its timer) and dispatch needs offers (to run the
  // auction), so dispatch is built first and told about the auction afterwards.
  const offers = makeOffers({ prisma: deps.prisma, geo, settings, api: driverTgApi, riderNotify,
    concierge: rideId => dispatch.toConcierge(rideId), cancelTimer: rideId => dispatch.cancel(rideId),
    baseUrl: deps.BASE_URL });
  dispatch.setOffers(offers);
  const driverBot = makeDriverBot({ prisma: deps.prisma, api: driverTgApi, telegram, uploadsDir, baseUrl: deps.BASE_URL, offers });
  const drive = makeDriverApi({ prisma: deps.prisma, driverBotToken, location, offers, telegram, riderNotify, geo, settings });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY,
    riderBotToken, webhookSecret: process.env.TG_WEBHOOK_SECRET || '', riderBot, driverBot, riderNotify, uploadsDir, drive, location });
  // Three background loops, all idempotent and all safe to miss a beat:
  //  - sweep: in-memory concierge timers die with the process, so escalate anything a restart stranded
  //  - expiry: close offer windows and widen the radius (5 s granularity on a 25 s window)
  //  - away: drivers whose phone stopped sending fixes stop receiving offers
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  const expiry = setInterval(() => offers.expire().catch(e => console.error('[ride] offer expiry error:', e.message)), 5000);
  const awaySweep = setInterval(() => location.staleSweep().catch(e => console.error('[ride] away sweep error:', e.message)), 20000);
  sweep.unref(); expiry.unref(); awaySweep.unref();
  console.log('[ride] BinaSmart Ride module mounted' + (riderBotToken ? ' (Telegram bots on)' : ' (no Telegram bot tokens)'));
  return { settings, geo, telegram, dispatch, riderNotify, offers, location, drive };
};
