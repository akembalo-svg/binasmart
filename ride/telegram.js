'use strict';
// Owner-facing Telegram messages. Prefers the BinaSmart bot (api + ownerChatNew) so everything about
// BinaSmart lives in one chat; falls back to the legacy shared bot (sendTg + ownerChat) when the new
// chat is not configured or the send fails. RIDE_TG_SILENT=1 logs instead of sending (verification).
function makeTelegram({ sendTg, ownerChat, baseUrl, ownerKey, api, ownerChatNew }) {
  function silent() { return process.env.RIDE_TG_SILENT === '1'; }

  async function deliver(text, extra) {
    if (api && ownerChatNew) {
      try { await api.sendMessage(String(ownerChatNew), text, extra); return true; }
      catch (e) { console.error('[ride/telegram] BinaSmart bot send failed (' + e.message + '), falling back to legacy bot'); }
    }
    return sendTg(ownerChat, text);
  }

  async function conciergeAlert(ride) {
    const p = ride.pickup, d = ride.dropoff;
    const bb = ride.bookedBy;
    const text = [
      '🚕 RIDE REQUEST — needs a driver',
      'Tier: ' + String(ride.tier).toUpperCase() + ' · Fare: ' + ride.fareEtb + ' ETB · Pay: ' + ride.paymentMethod,
      'From: ' + p.label,
      '  https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lng + '#map=17/' + p.lat + '/' + p.lng,
      'To:   ' + d.label,
      'Trip: ' + (ride.distanceM / 1000).toFixed(1) + ' km · ~' + Math.round(ride.durationS / 60) + ' min' + (ride.estimate ? ' (estimate)' : ''),
      (bb ? 'Passenger: ' : 'Rider: ') + ride.riderName + ' · ' + ride.riderPhone,
      bb ? 'Booked by: ' + (bb.name || '?') + (bb.phone ? ' · ' + bb.phone : '') + (bb.telegramId ? ' · via Telegram' : '') : null,
      'Assign: ' + baseUrl + '/ride-ops?key=' + ownerKey + '&ride=' + ride.id
    ].filter(Boolean).join('\n');
    if (silent()) { console.log('[ride] TG SILENT:\n' + text.split(ownerKey).join('<key>')); return true; }
    const ok = await deliver(text, { reply_markup: { inline_keyboard: [[{ text: '🧑‍✈️ Assign a driver', url: baseUrl + '/ride-ops?key=' + ownerKey + '&ride=' + ride.id }]] } });
    if (!ok) console.error('[ride/telegram] concierge alert send returned false for ride ' + ride.id);
    return ok;
  }

  async function ownerNote(text) {
    if (silent()) { console.log('[ride] TG SILENT: ' + text); return true; }
    return deliver(text);
  }

  return { conciergeAlert, ownerNote };
}

module.exports = { makeTelegram };
