'use strict';
// Status pushes to the person who booked (bookedBy.telegramId), else the rider's Telegram. Fire-and-forget:
// never throws, never blocks a ride. Only riders who came through Telegram have an id, so web riders are untouched.
function makeRiderNotify({ prisma, api, baseUrl }) {
  const vehicle = d => [d.vehicleColour, d.vehicleMake].filter(Boolean).join(' ');
  const TEXT = {
    assigned: r => '🚗 Driver ' + r.driver.name + ' is on the way\n' + vehicle(r.driver) + ' · plate ' + r.driver.plate + ' · ' + r.driver.phone + '\nሹፌርዎ እየመጣ ነው። ' + (r.pickup && r.pickup.label ? 'Pickup: ' + r.pickup.label : ''),
    arrived: r => '📍 Your driver has arrived' + (r.pickup && r.pickup.label ? ' at ' + r.pickup.label : '') + '.\nሹፌርዎ ደርሷል።',
    completed: r => '✅ Trip complete · ' + r.fareEtb + ' ETB' + (r.paymentStatus === 'paid' ? ' (paid)' : ' — pay the driver') + '\nጉዞው ተጠናቅቋል። Please rate your driver in the app. አመሰግናለን!',
    cancelled: r => '❌ Ride cancelled.' + (r.cancelledBy === 'ops' ? ' Our dispatcher could not find a driver this time — sorry.' : '') + '\nጉዞው ተሰርዟል።',
  };
  async function notify(rideId, event) {
    try {
      const fn = TEXT[event]; if (!fn) return false;
      const ride = await prisma.ride.findUnique({ where: { id: rideId }, include: { driver: true, rider: true } });
      if (!ride) return false;
      const chat = (ride.bookedBy && ride.bookedBy.telegramId) || (ride.rider && ride.rider.telegramId);
      if (!chat) return false;
      if (event === 'assigned' && !ride.driver) return false;
      await api.sendMessage(String(chat), fn(ride), { reply_markup: { inline_keyboard: [[{ text: '📍 Open tracking · መከታተያ', web_app: { url: baseUrl + '/ride?id=' + ride.id } }]] } });
      return true;
    } catch (e) { console.error('[ride/riderNotify] ' + event + ' for ' + rideId + ' failed: ' + e.message); return false; }
  }
  return { notify };
}
module.exports = { makeRiderNotify };
