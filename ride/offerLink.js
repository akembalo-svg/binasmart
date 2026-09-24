'use strict';
// bina.et/o/<token>: one ride offer, for a driver reached by SMS — no Telegram, and an app that has lost
// its signal. SMS arrives with no mobile data at all; this page is a few kilobytes of plain HTML with no
// script, so it opens on the weakest line and on any phone browser.
//
// The token is the offer id plus an HMAC of it, so it can be neither guessed nor moved to another offer.
// Holding the link is what the Telegram card is: permission to accept or skip that one offer, for that
// one driver. The trip details (passenger, phone) show only while the ride is that driver's.
//
// GET never changes anything, because SMS apps and link checkers open links on their own. Accept and
// Skip are form POSTs from the page.
const crypto = require('crypto');

const ACTIVE = ['assigned', 'arriving', 'arrived', 'ontrip'];

function makeOfferLink({ secret, baseUrl } = {}) {
  if (!secret) throw new Error('offer links need a secret');
  const key = crypto.createHmac('sha256', String(secret)).update('bina-ride-offer-link').digest();
  const sig = id => crypto.createHmac('sha256', key).update(String(id)).digest('base64url').slice(0, 12);
  const token = id => id + '.' + sig(id);
  function verify(t) {
    const m = /^([A-Za-z0-9_-]{6,40})\.([A-Za-z0-9_-]{12})$/.exec(String(t || ''));
    if (!m) return null;
    const a = Buffer.from(sig(m[1])), b = Buffer.from(m[2]);
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? m[1] : null;
  }
  return { token, verify, url: id => (baseUrl || 'https://bina.et') + '/o/' + token(id) };
}

// The SMS itself (the delivery layer puts "BinaSmart Ride፦ " in front). Short: every Amharic letter
// makes it a Unicode SMS, billed per 67 characters.
function offerSmsText(ride, etaS, url) {
  const mins = Math.max(1, Math.round((etaS || 0) / 60));
  const pick = String((ride.pickup && ride.pickup.label) || '—').slice(0, 40);
  return 'አዲስ ጉዞ · New ride\nPickup: ' + pick + ' (' + mins + ' min)\nYou earn ' + ride.driverTakeEtb + ' ETB\n'
    + 'ፈጥነው ይቀበሉ · Accept fast: ' + url;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const km = m => Math.round((m || 0) / 100) / 10;

function page(title, body) {
  return '<!doctype html><html lang="am"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    + '<title>' + esc(title) + '</title><style>'
    + 'body{margin:0;background:#f4f6f5;color:#10231c;font:16px/1.5 system-ui,"Noto Sans Ethiopic",sans-serif}'
    + 'main{max-width:440px;margin:0 auto;padding:18px 16px 32px}h1{font-size:21px;margin:4px 0 12px}'
    + '.card{background:#fff;border:1px solid #dfe6e2;border-radius:16px;padding:14px 16px;margin:0 0 14px}'
    + '.row{margin:6px 0}.row small{display:block;color:#5b6d65;font-size:13px}.big{font-size:24px;font-weight:700;color:#0b7a55}'
    + 'form{display:inline}button,.btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:14px;padding:15px;margin:10px 0 0;'
    + 'font:700 17px system-ui,sans-serif;text-align:center;text-decoration:none;cursor:pointer}'
    + '.go{background:#00a884;color:#fff}.no{background:#e8ecea;color:#10231c}.map{background:#1d4ed8;color:#fff}'
    + '.note{color:#5b6d65;font-size:14px}a{color:#0b7a55}</style></head><body><main>'
    + '<p class="note">BinaSmart Ride · ሹፌር</p>' + body + '</main></body></html>';
}

function openView(ride, offer, leftS) {
  return page('New ride · አዲስ ጉዞ',
    '<h1>አዲስ ጉዞ · New ride</h1><div class="card">'
    + '<div class="row"><small>Pickup · መነሻ</small><b>' + esc(ride.pickup && ride.pickup.label) + '</b> · ' + Math.max(1, Math.round((offer.etaS || 0) / 60)) + ' min, ' + km(offer.distanceM) + ' km away</div>'
    + '<div class="row"><small>Drop-off · መድረሻ</small><b>' + esc(ride.dropoff && ride.dropoff.label) + '</b> · ' + km(ride.distanceM) + ' km trip</div>'
    + '<div class="row"><small>You earn · ገቢዎ</small><span class="big">' + esc(ride.driverTakeEtb) + ' ETB</span></div>'
    + '<p class="note">About ' + leftS + ' seconds left. First to accept gets it · ቀድሞ የተቀበለ ያገኛል</p></div>'
    + '<form method="post"><input type="hidden" name="do" value="accept"><button class="go" type="submit">ACCEPT · ተቀበል</button></form>'
    + '<form method="post"><input type="hidden" name="do" value="skip"><button class="no" type="submit">Skip · አትቀበል</button></form>');
}

function tripView(ride, baseUrl) {
  const p = ride.pickup || {}, lat = Number(p.lat), lng = Number(p.lng);
  const maps = Number.isFinite(lat) && Number.isFinite(lng)
    ? '<a class="btn map" href="https://www.google.com/maps/dir/?api=1&amp;destination=' + lat + ',' + lng + '&amp;travelmode=driving">🧭 Directions to pickup · አቅጣጫ</a>' : '';
  const phone = ride.riderPhone ? ' · <a href="tel:' + esc(ride.riderPhone) + '">' + esc(ride.riderPhone) + '</a>' : '';
  const by = ride.bookedBy && ride.bookedBy.name
    ? '<div class="row"><small>Booked by (not the passenger)</small>' + esc(ride.bookedBy.name) + (ride.bookedBy.phone ? ' · ' + esc(ride.bookedBy.phone) : '') + '</div>' : '';
  return page('Your ride · ጉዞዎ',
    '<h1>✅ ጉዞው የእርስዎ ነው · The ride is yours</h1><div class="card">'
    + '<div class="row"><small>Passenger · ተሳፋሪ</small><b>' + esc(ride.riderName || 'Passenger') + '</b>' + phone + '</div>' + by
    + '<div class="row"><small>Pickup · መነሻ</small><b>' + esc(p.label) + '</b></div>'
    + '<div class="row"><small>Drop-off · መድረሻ</small><b>' + esc(ride.dropoff && ride.dropoff.label) + '</b></div>'
    + '<div class="row"><small>Collect · ይሰብስቡ</small><span class="big">' + esc(ride.fareEtb) + ' ETB</span> ' + esc(String(ride.paymentMethod || 'cash').toUpperCase()) + '</div></div>'
    + maps
    + '<a class="btn no" href="' + esc((baseUrl || 'https://bina.et') + '/drive') + '">🚗 Open the driver app · መተግበሪያ</a>'
    + '<p class="note">Tap the trip steps (on my way, arrived, start, complete) in the app. With no signal they are saved and sent when it returns.</p>');
}

function closedView(why) {
  return page('Offer closed', '<h1>' + esc(why) + '</h1><p class="note">Keep the driver app open to get the next offer. · ቀጣዩን ጥሪ ለማግኘት መተግበሪያውን ክፍት ያድርጉ።</p>');
}

// Registers GET/POST /o/:t in its own scope (it reads a plain HTML form).
function offerPage(fastify, { prisma, offers, links, settings, baseUrl, now } = {}) {
  const clock = now || Date.now;
  fastify.register(async f => {
    if (!f.hasContentTypeParser('application/x-www-form-urlencoded')) {
      f.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 2048 },
        (req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (e) { done(e); } });
    }
    const send = (reply, code, html) => reply.code(code)
      .header('cache-control', 'no-store').header('x-robots-tag', 'noindex').header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8').send(html);

    async function load(t) {
      const id = links.verify(t);
      if (!id) return null;
      const offer = await prisma.rideOffer.findUnique({ where: { id } });
      if (!offer) return null;
      const ride = await prisma.ride.findUnique({ where: { id: offer.rideId } });
      return ride ? { offer, ride } : null;
    }
    async function show(reply, x) {
      const { offer, ride } = x;
      if (ride.driverId === offer.driverId && ACTIVE.includes(ride.status)) return send(reply, 200, tripView(ride, baseUrl));
      if (offer.status === 'open' && !ride.driverId && ['requested', 'dispatching'].includes(ride.status)) {
        const s = await settings.get();
        const left = Math.round((s.offerWindowS || 25) - (clock() - new Date(offer.createdAt).getTime()) / 1000);
        if (left > 0) return send(reply, 200, openView(ride, offer, left));
        return send(reply, 200, closedView('⌛ ጊዜው አልፎበታል · This offer has expired'));
      }
      if (offer.status === 'declined') return send(reply, 200, closedView('⏭ Skipped · ተዘሏል'));
      if (offer.status === 'expired') return send(reply, 200, closedView('⌛ ጊዜው አልፎበታል · This offer has expired'));
      return send(reply, 200, closedView('😔 ሌላ ሹፌር ቀድሞ ወሰደው · Another driver got this one'));
    }

    f.get('/o/:t', async (req, reply) => {
      const x = await load(req.params.t);
      if (!x) return send(reply, 404, closedView('This link is not valid · ሊንኩ አይሰራም'));
      return show(reply, x);
    });
    f.post('/o/:t', async (req, reply) => {
      const x = await load(req.params.t);
      if (!x) return send(reply, 404, closedView('This link is not valid · ሊንኩ አይሰራም'));
      const what = req.body && req.body.do;
      if (what === 'skip') {
        await offers.decline(x.offer.rideId, x.offer.driverId);
        return send(reply, 200, closedView('⏭ Skipped · ተዘሏል'));
      }
      if (what !== 'accept') return show(reply, x);
      const r = await offers.accept(x.offer.rideId, x.offer.driverId);
      if (r.ok || r.error === 'already_yours') return reply.code(303).header('location', '/o/' + req.params.t).send();
      const why = r.error === 'expired' || r.error === 'no_offer' ? '⌛ ጊዜው አልፎበታል · This offer has expired'
        : r.error === 'busy' ? '🚗 Finish your current ride first · መጀመሪያ የአሁኑን ጉዞ ይጨርሱ'
        : '😔 ሌላ ሹፌር ቀድሞ ወሰደው · Another driver got this one';
      return send(reply, 200, closedView(why));
    });
  });
}

module.exports = { makeOfferLink, offerSmsText, offerPage };
