'use strict';
const { makeOfferLink, offerPage } = require('./offerLink');
const { makeSmsFromEnv } = require('../messaging/sms');
const { makeDelivery, makeDeliveryStore } = require('../messaging/delivery');
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
const { makePool } = require('./pool/pool');
const { makeGroups } = require('./pool/groups');
const poolRoutes = require('./pool/routes');
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
  // Job alerts live here rather than in server.js because they send through the rider bot's own
  // Telegram client - the chat people already have open for rides and Bini (jobs/alerts.js).
  const { openSince: jobOpenSince, isClosed: jobIsClosed } = require('../tenders/deadline');
  const jobAlerts = require('../jobs/alerts').makeJobAlerts({
    prisma: deps.prisma, api: riderApi, openSince: jobOpenSince, isClosed: jobIsClosed });

  // Tender alerts, the job alerts' twin for businesses (tenders/alerts.js); ops/send-tender-alerts.js sends them.
  const tenderAlerts = require('../tenders/alerts').makeTenderAlerts({
    prisma: deps.prisma, api: riderApi, openSince: jobOpenSince, isClosed: jobIsClosed });
  // Every tender-alert link goes through bina.et so a tap is one countable nginx line (as /jobs/alert/<field>).
  fastify.get('/tenders/alert/:cat', async (req, reply) => {
    const c = String(req.params.cat || '').toLowerCase();
    const slug = require('../tenders/alerts').BY_SLUG.get(c) ? c : 'all';
    return reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
      .redirect('https://t.me/' + (process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot') + '?start=tenders_' + slug, 302);
  });

  // Speaking a CV instead of typing one. Built here for the same reason as the alerts: it answers through
  // the rider bot's own client, and it needs no route of its own (jobs/voice-cv.js).
  const voiceCv = require('../jobs/voice-cv').makeVoiceCv({
    prisma: deps.prisma, apiKey: process.env.GEMINI_API_KEY || '' });

  // @bina_smart_bot is the whole BinaSmart: service menu + Bini (via the app's own /api/assistant on localhost).
  const riderBot = makeBinaBot({ api: riderApi, baseUrl: deps.BASE_URL, botUsername: process.env.BINA_RIDER_BOT_USERNAME || 'bina_smart_bot',
    // only a live, onboarded shop can be linked; a demo row or a guessed id links nothing
    linkShop: async (shopId, chatId) => { const n = await deps.prisma.shop.updateMany({ where: { id: shopId, status: 'live' }, data: { tgChatId: String(chatId) } });
      return n.count ? deps.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, nameAm: true } }) : null; },
    assistantUrl: 'http://127.0.0.1:' + (process.env.PORT || 4210) + '/api/assistant', internalKey: deps.OWNER_KEY,
    owner: deps.ownerTelegram || null,    // Bini for owners (agents/owner/access.js); absent = off
    tenant: deps.tenantTelegram || null,   // tenant notices (messaging/tenant-link.js); absent = off
    jobs: jobAlerts,                       // job alerts: /start jobs_<field>, /jobs, /stopjobs
    tenders: tenderAlerts,                 // tender alerts: /start tenders_<kind>, /tenders, /stoptenders
    cv: voiceCv });                        // a CV spoken instead of typed: /cv (jobs/voice-cv.js)
  // BinaPool shares the fare engine, the auction and the driver app; riderNotify fans ride events out to every seat.
  const pool = makePool({ prisma: deps.prisma, geo, settings, dispatch, api: riderBotToken ? riderApi : null, baseUrl: deps.BASE_URL, dstate: require('./driverState') });
  const riderNotify = makeRiderNotify({ prisma: deps.prisma, api: riderApi, baseUrl: deps.BASE_URL, pool });
  // secret signs the leave handle the untrusted answer carries instead of the group id; same
  // sourcing as building/visit.js, so it is a real secret in production rather than the fallback.
  const groups = makeGroups({ prisma: deps.prisma, pool, settings, api: riderBotToken ? riderApi : null, baseUrl: deps.BASE_URL,
    secret: process.env.POOL_REF_SECRET || process.env.VISIT_SECRET || deps.OWNER_KEY });
  // offers needs dispatch (to escalate and to cancel its timer) and dispatch needs offers (to run the
  // auction), so dispatch is built first and told about the auction afterwards.
  // Offer SMS for weak-signal drivers with no Telegram: only when SMS is live and a link secret exists.
  // It goes out through the same transactional road as sign-in codes, so every one is logged and billed.
  const linkSecret = process.env.RIDE_LINK_SECRET || process.env.BETTER_AUTH_SECRET || deps.OWNER_KEY || '';
  const offerLinks = linkSecret ? makeOfferLink({ secret: linkSecret, baseUrl: deps.BASE_URL }) : null;
  let offerSms = null;
  try {
    const smsLayer = makeSmsFromEnv(process.env, { log: m => console.log(m) });
    if (smsLayer.mode === 'live' && offerLinks) {
      const road = makeDelivery({ store: makeDeliveryStore(deps.prisma), sendTg: async () => false, sms: smsLayer, log: m => console.log(m) });
      offerSms = { send: async (phone, text) => {
        const r = await road.sendTransactionalSms({ to: phone, text, label: 'BinaSmart Ride', kind: 'ride_offer', source: 'ride-offer', live: true });
        return (r && r.status) || 'failed';
      } };
    }
  } catch (e) { console.error('[ride] offer SMS off: ' + e.message); }
  const offers = makeOffers({ prisma: deps.prisma, geo, settings, api: driverTgApi, riderNotify,
    concierge: rideId => dispatch.toConcierge(rideId), cancelTimer: rideId => dispatch.cancel(rideId),
    baseUrl: deps.BASE_URL, sms: offerSms, links: offerLinks });
  if (offerLinks) offerPage(fastify, { prisma: deps.prisma, offers, links: offerLinks, settings, baseUrl: deps.BASE_URL });
  dispatch.setOffers(offers);
  const driverBot = makeDriverBot({ prisma: deps.prisma, api: driverTgApi, telegram, uploadsDir, baseUrl: deps.BASE_URL, offers });
  const drive = makeDriverApi({ prisma: deps.prisma, driverBotToken, location, offers, telegram, riderNotify, geo, settings, pool });
  const helpers = routes(fastify, { prisma: deps.prisma, settings, geo, telegram, dispatch, OWNER_KEY: deps.OWNER_KEY,
    riderBotToken, webhookSecret: process.env.TG_WEBHOOK_SECRET || '', riderBot, driverBot, riderNotify, uploadsDir, drive, location, askBini: deps.askBini || null, pool });
  poolRoutes(fastify, { pool, groups, riderBotToken, drive, limiter: helpers.limiter, clientIp: helpers.clientIp, OWNER_KEY: deps.OWNER_KEY });
  const poolSweep = setInterval(() => pool.sweep().catch(e => console.error('[pool] sweep error:', e.message)), 10000);
  const groupTick = setInterval(() => groups.tick().catch(e => console.error('[pool/groups] tick error:', e.message)), 60000);
  poolSweep.unref(); groupTick.unref();
  // Four background loops, all idempotent and all safe to miss a beat:
  //  - sweep: in-memory concierge timers die with the process, so escalate anything a restart stranded
  //  - expiry: close offer windows and widen the radius (5 s granularity on a 25 s window)
  //  - away: drivers whose phone stopped sending fixes stop receiving offers
  //  - abandoned: a driver who closes the app mid-trip freezes the ride AND himself — free him and say so
  const sweep = setInterval(() => dispatch.sweepStale().catch(e => console.error('[ride] sweep error:', e.message)), 30000);
  const expiry = setInterval(() => offers.expire().catch(e => console.error('[ride] offer expiry error:', e.message)), 5000);
  const awaySweep = setInterval(() => location.staleSweep().catch(e => console.error('[ride] away sweep error:', e.message)), 20000);
  const abandonSweep = setInterval(() => dispatch.sweepAbandoned().catch(e => console.error('[ride] abandoned sweep error:', e.message)), 300000);
  // A request no driver took in ten minutes is closed, and the rider is told instead of waiting for ever.
  const unservedSweep = setInterval(() => dispatch.sweepUnserved(Date.now(), id => riderNotify.notify(id, 'cancelled'))
    .catch(e => console.error('[ride] unserved sweep error:', e.message)), 60000);
  if (unservedSweep.unref) unservedSweep.unref();
  sweep.unref(); expiry.unref(); awaySweep.unref(); abandonSweep.unref();
  console.log('[ride] BinaSmart Ride module mounted' + (riderBotToken ? ' (Telegram bots on)' : ' (no Telegram bot tokens)'));
  return { settings, geo, telegram, dispatch, riderNotify, offers, location, drive, pool, groups, jobAlerts };
};
