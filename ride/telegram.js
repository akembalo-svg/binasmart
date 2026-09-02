'use strict';
// Owner-facing Telegram messages. RIDE_TG_SILENT=1 logs instead of sending (used for verification).
function makeTelegram({ sendTg, ownerChat, baseUrl, ownerKey }) {
  function silent() { return process.env.RIDE_TG_SILENT === '1'; }

  async function conciergeAlert(ride) {
    const p = ride.pickup, d = ride.dropoff;
    const text = [
      '🚕 RIDE REQUEST — needs a driver',
      'Tier: ' + String(ride.tier).toUpperCase() + ' · Fare: ' + ride.fareEtb + ' ETB · Pay: ' + ride.paymentMethod,
      'From: ' + p.label,
      '  https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=17/' + p.lat + '/' + p.lng,
      'To:   ' + d.label,
      'Trip: ' + (ride.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(ride.durationS / 60) + ' min' + (ride.estimate ? ' (estimate)' : ''),
      'Rider: ' + ride.riderName + ' · ' + ride.riderPhone,
      'Assign: ' + baseUrl + '/ride-ops?key=' + ownerKey + '&ride=' + ride.id
    ].join('\n');
    if (silent()) { console.log('[ride] TG SILENT:\n' + text); return true; }
    return sendTg(ownerChat, text);
  }

  async function ownerNote(text) {
    if (silent()) { console.log('[ride] TG SILENT: ' + text); return true; }
    return sendTg(ownerChat, text);
  }

  return { conciergeAlert, ownerNote };
}

module.exports = { makeTelegram };
