'use strict';
const { makeSettings } = require('./settings');
const { makeGeo } = require('./geo');
const { makeTelegram } = require('./telegram');
const { makeDispatch } = require('./dispatch');
const routes = require('./routes');

// registerRide(fastify, { prisma, sendTg, OWNER_KEY, OWNER_CHAT, ROUTER_URL, BASE_URL })
module.exports = function registerRide(fastify, deps) {
  const settings = makeSettings(deps.prisma);
  const geo = makeGeo({ routerUrl: deps.ROUTER_URL, prisma: deps.prisma });
  const telegram = makeTelegram({ sendTg: deps.sendTg, ownerChat: deps.OWNER_CHAT, baseUrl: deps.BASE_URL, ownerKey: deps.OWNER_KEY });
  const dispatch = makeDispatch({ prisma: deps.prisma, telegram, settings });
  routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY });
  // In-memory concierge timers die with the process; the sweep escalates anything a restart stranded.
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  sweep.unref();
  console.log('[ride] BinaSmart Ride module mounted');
  return { settings, geo, telegram, dispatch };
};
