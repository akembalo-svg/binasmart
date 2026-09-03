'use strict';
const path = require('path');
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
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
  const riderApi = makeTgApi({ token: riderBotToken }), driverApi = makeTgApi({ token: driverBotToken });
  // Owner alerts go through the BinaSmart bot to BINA_OWNER_TG_CHAT when set; legacy shared bot is the fallback.
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY,
    api: riderBotToken ? riderApi : null, ownerChatNew: process.env.BINA_OWNER_TG_CHAT || '' });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });
  const uploadsDir = path.join(__dirname, '..', 'uploads', 'drivers');
  // @bina_smart_bot is the whole BinaSmart: service menu + Bini (via the app's own /api/assistant on localhost).
  const riderBot = makeBinaBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant' });
  const driverBot = makeDriverBot({ prisma: deps.prisma, api: driverApi, telegram, uploadsDir, baseUrl: deps.BASE_URL });
  const riderNotify = makeRiderNotify({ prisma: deps.prisma, api: riderApi, baseUrl: deps.BASE_URL });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY,
    riderBotToken, webhookSecret: process.env.TG_WEBHOOK_SECRET || '', riderBot, driverBot, riderNotify, uploadsDir });
  // In-memory concierge timers die with the process; the sweep escalates anything a restart stranded.
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  sweep.unref();
  console.log('[ride] BinaSmart Ride module mounted' + (riderBotToken ? ' (Telegram bots on)' : ' (no Telegram bot tokens)'));
  return { settings, geo, telegram, dispatch, riderNotify };
};
