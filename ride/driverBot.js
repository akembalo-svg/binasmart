'use strict';
// @binasmartdriverbot: seven-step registration → Driver(status:'pending'). Phase 1 only registers; Phase 2 adds online/offers.
// Two photos: the driving licence (private, owner-key only) and the front of the car with the plate visible
// (shown to riders once the driver is approved, so they can match the car at the kerb).
const fs = require('fs'); const path = require('path');
const { normPhone } = require('./phone');

const TIERS = { moto: '🏍 Moto', bajaj: '🛺 Bajaj', economy: '🚗 Economy', comfort: '🚙 Comfort', xl: '🚐 XL / Van' };
const TTL_MS = 3600 * 1000;

function makeDriverBot({ prisma, api, telegram, uploadsDir, baseUrl, now }) {
  const clock = now || Date.now;
  const sessions = new Map(); // chatId -> { step, data, t }
  function sess(chatId) {
    const s = sessions.get(chatId);
    if (s && clock() - s.t < TTL_MS) { s.t = clock(); return s; }
    const n = { step: 'name', data: {}, t: clock() }; sessions.set(chatId, n); return n;
  }
  const WELCOME = '👋 BinaSmart Driver · የቢናስማርት ሹፌር\n\nRegister as a BinaSmart driver — FREE, and 0% commission during our launch. Takes 2 minutes.\nምዝገባው ነጻ ነው፤ በመክፈቻ ወቅት ኮሚሽን የለም። 2 ደቂቃ ብቻ።\n\nWhat is your full name? · ሙሉ ስምዎን ይላኩ';
  const ASK = {
    name: chatId => api.sendMessage(chatId, 'What is your full name? · ሙሉ ስምዎን ይላኩ'),
    phone: chatId => api.sendMessage(chatId, 'Share your phone number · ስልክ ቁጥርዎን ያጋሩ', { reply_markup: { keyboard: [[{ text: '📱 Share my phone · ስልኬን አጋራ', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }),
    tier: chatId => api.sendMessage(chatId, 'Which vehicle do you drive? · የሚያሽከረክሩት ተሽከርካሪ', { reply_markup: { inline_keyboard: Object.keys(TIERS).map(t => [{ text: TIERS[t], callback_data: 'tier:' + t }]) } }),
    vehicle: chatId => api.sendMessage(chatId, 'Car make and colour? e.g. "Toyota Vitz white" · የመኪና አይነት እና ቀለም'),
    plate: chatId => api.sendMessage(chatId, 'Plate number? · ታርጋ ቁጥር (ለምሳሌ A12345)'),
    licence: chatId => api.sendMessage(chatId, '📄 Step 1 of 2 — send a PHOTO of your driving licence\nየመንጃ ፈቃድዎን ፎቶ ይላኩ\n\n(Private — only BinaSmart sees this.)', { reply_markup: { remove_keyboard: true } }),
    car: chatId => api.sendMessage(chatId, '📸 Step 2 of 2 — now send a photo of the FRONT of your car, with the plate clearly visible.\nየመኪናዎን የፊት ፎቶ ይላኩ — ታርጋው በደንብ እንዲታይ።\n\nRiders will see this photo so they can recognise your car. Take it in daylight if you can.\nተጓዦች መኪናዎን ለመለየት ይህን ፎቶ ያያሉ።'),
  };
  const ask = (chatId, step) => ASK[step](chatId);

  async function savePhoto(chatId, fileId, driverId, kind) {
    const f = await api.getFile(fileId);
    const buf = await api.downloadFile(f.file_path);
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    await fs.promises.writeFile(path.join(uploadsDir, driverId + (kind === 'car' ? '-car' : '') + '.jpg'), buf);
  }

  async function handleUpdate(update) {
    if (update.callback_query) {
      const cq = update.callback_query; const chatId = String(cq.message.chat.id);
      try { await api.answerCallbackQuery(cq.id); } catch (e) { /* ignore */ }
      const s = sess(chatId); const m = /^tier:(\w+)$/.exec(cq.data || '');
      if (s.step === 'tier' && m && TIERS[m[1]]) { s.data.tier = m[1]; s.step = 'vehicle'; return ask(chatId, 'vehicle'); }
      return ask(chatId, s.step);
    }
    const msg = update.message; if (!msg || !msg.chat) return;
    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();
    if (text.startsWith('/start')) { sessions.delete(chatId); sess(chatId); return api.sendMessage(chatId, WELCOME); }
    const s = sess(chatId);
    switch (s.step) {
      case 'name':
        if (text.length < 2 || text.startsWith('/')) return ask(chatId, 'name');
        s.data.name = text.slice(0, 60); s.step = 'phone'; return ask(chatId, 'phone');
      case 'phone': {
        const phone = normPhone(msg.contact ? msg.contact.phone_number : text);
        if (!phone) { await api.sendMessage(chatId, 'Please share an Ethiopian number (09…) · የኢትዮጵያ ስልክ ቁጥር ያስፈልጋል'); return ask(chatId, 'phone'); }
        const existing = await prisma.driver.findUnique({ where: { phone } });
        if (existing) { sessions.delete(chatId); return api.sendMessage(chatId, 'You are already registered ✅ We will call you. · ቀድሞ ተመዝግበዋል፤ እንደውልልዎታለን።', { reply_markup: { remove_keyboard: true } }); }
        s.data.phone = phone; s.step = 'tier'; return ask(chatId, 'tier');
      }
      case 'tier': return ask(chatId, 'tier');
      case 'vehicle':
        if (text.length < 3) return ask(chatId, 'vehicle');
        s.data.vehicle = text.slice(0, 70); s.step = 'plate'; return ask(chatId, 'plate');
      case 'plate':
        if (text.length < 3) return ask(chatId, 'plate');
        s.data.plate = text.slice(0, 20).toUpperCase(); s.step = 'licence'; return ask(chatId, 'licence');
      case 'licence': {
        const photos = msg.photo;
        if (!photos || !photos.length) return api.sendMessage(chatId, 'Please send a photo (not a file or text) of your licence · እባክዎ የፈቃድዎን ፎቶ ይላኩ');
        s.data.licenceFileId = photos[photos.length - 1].file_id;
        s.step = 'car'; return ask(chatId, 'car');
      }
      case 'car': {
        const photos = msg.photo;
        if (!photos || !photos.length) return api.sendMessage(chatId, 'Please send a photo of the front of your car, plate visible · የመኪናዎን የፊት ፎቶ ይላኩ');
        const d = s.data;
        const drv = await prisma.driver.create({ data: { name: d.name, phone: d.phone, tier: d.tier, plate: d.plate, vehicleMake: d.vehicle, vehicleColour: null, status: 'pending', telegramId: chatId } });
        const saved = { licence: false, car: false };
        try { await savePhoto(chatId, d.licenceFileId, drv.id, 'licence'); saved.licence = true; } catch (e) { console.error('[ride/driverBot] licence save failed for ' + drv.id + ': ' + e.message); }
        try { await savePhoto(chatId, photos[photos.length - 1].file_id, drv.id, 'car'); saved.car = true; } catch (e) { console.error('[ride/driverBot] car photo save failed for ' + drv.id + ': ' + e.message); }
        await prisma.driver.update({ where: { id: drv.id }, data: {
          licenceUrl: saved.licence ? '/api/ride/ops/driver-doc/' + drv.id + '?kind=licence' : null,
          carPhotoUrl: saved.car ? '/api/ride/car/' + drv.id + '.jpg' : null } });
        sessions.delete(chatId);
        await api.sendMessage(chatId, '✅ ' + d.name + ' · ' + TIERS[d.tier] + ' · ' + d.vehicle + ' · ' + d.plate + '\n\nThank you! We will call you within 24 hours to activate your account. Registration is free and there is 0% commission during our launch.\nአመሰግናለን! በ24 ሰዓት ውስጥ እንደውልልዎታለን። ምዝገባው ነጻ ነው፤ ኮሚሽን የለም።', { reply_markup: { remove_keyboard: true } });
        telegram.ownerNote('🧑‍✈️ NEW DRIVER (pending): ' + d.name + ' · ' + TIERS[d.tier] + ' · ' + d.vehicle + ' · plate ' + d.plate + ' · ' + d.phone
          + '\nPhotos: licence ' + (saved.licence ? '✅' : '❌') + ' · car ' + (saved.car ? '✅' : '❌')
          + '\nApprove: ' + baseUrl + '/ride-ops').catch(() => {});
        return;
      }
      default: sessions.delete(chatId); return ask(chatId, 'name');
    }
  }

  async function notifyStatus(driver, status) {
    if (!driver || !driver.telegramId) return false;
    const text = status === 'approved' ? '✅ Approved! Welcome to BinaSmart. We will message you here when trips start. Registration is free, 0% commission during launch.\nጸድቋል! እንኳን ደህና መጡ። ጉዞዎች ሲጀምሩ እዚህ እናሳውቅዎታለን።'
      : status === 'suspended' ? 'Your BinaSmart driver account is paused. Contact support: https://bina.et/support' : null;
    if (!text) return false;
    try { await api.sendMessage(String(driver.telegramId), text); return true; }
    catch (e) { console.error('[ride/driverBot] notifyStatus failed: ' + e.message); return false; }
  }

  return { handleUpdate, notifyStatus, _sessions: sessions };
}
module.exports = { makeDriverBot, TIERS };
