'use strict';
// Tenants link @bina_smart_bot to receive their building's messages (owner actions and messaging design §2).
//
// Proof is Telegram's, exactly as for owners (agents/owner/access.js): the sender's own contact (contact.user_id ===
// from.id), in their private chat with the bot (chat.id === from.id), not forwarded or composed via a bot. The number
// must equal, as a full international number, the phone of an ACTIVE tenancy in the building the start link names —
// never the last nine digits, never another building. The bot calls this only within ten minutes of
// /start tenant_<slug> (ride/binaBot.js), because Mini Apps drop contacts into the same chat; it passes startedAt (when
// that /start arrived) and this module checks the window again, so a caller that forgets gets 'expired', not a link.
// forwarded must be exactly false (the bot folds forward_origin, forward_from, forward_date and via_bot into it).
//
// A match writes the tenant's User.telegramChatId, and messaging/delivery.js then prefers Telegram. Nothing else is
// granted: no chat with Bini about the account in v1. Every failure to match gets one neutral reason, whatever the cause.
const { toE164, limiter } = require('../agents/owner/access');

const SLUG = /^[A-Za-z0-9-]{1,60}$/;
const PENDING_MS = 10 * 60000;     // same window as /start owner in ride/binaBot.js
const SKEW_MS = 5000;              // startedAt a few seconds ahead of now() is clock noise, not a fresh start
const last4 = s => String(s == null ? '' : s).replace(/\D/g, '').slice(-4);

function makeTenantLinkStore(prisma) {
  return {
    buildingBySlug: slug => prisma.building.findUnique({ where: { qrSlug: slug }, select: { id: true, qrSlug: true } }),
    activeTenancies: buildingId => prisma.tenancy.findMany({ where: { active: true, unit: { buildingId } },
      select: { id: true, userId: true, unit: { select: { number: true } }, user: { select: { phone: true, telegramChatId: true } } } }),
    setChat: (userId, chatId) => prisma.user.update({ where: { id: userId }, data: { telegramChatId: chatId }, select: { id: true } }),
    clearChat: userId => prisma.user.update({ where: { id: userId }, data: { telegramChatId: null }, select: { id: true } }),
    usersWithChat: chatId => prisma.user.findMany({ where: { telegramChatId: chatId },
      select: { id: true, tenancies: { where: { active: true }, select: { unit: { select: { buildingId: true, number: true } } } } } }),
  };
}

function makeTenantLink({ store, audit = () => {}, now = () => new Date(), limit }) {
  const allow = limit || limiter(5, 15 * 60000, now);
  const note = (buildingId, action, detail) => Promise.resolve().then(() => audit(buildingId, action, detail)).catch(() => {});

  async function linkFromContact({ slug, chat, from, contact, forwarded, startedAt }) {
    if (!chat || chat.type !== 'private') return { ok: false, reason: 'not_private' };
    if (!from || !contact || forwarded !== false || contact.user_id == null || String(contact.user_id) !== String(from.id))
      return { ok: false, reason: 'not_own_contact' };
    if (String(chat.id) !== String(from.id)) return { ok: false, reason: 'not_private' };
    const started = startedAt == null ? NaN : new Date(startedAt).getTime();
    const age = now().getTime() - started;
    if (!(age >= -SKEW_MS && age <= PENDING_MS)) return { ok: false, reason: 'expired' };   // uses up no attempt
    const telegramId = String(from.id);
    if (!allow(telegramId)) return { ok: false, reason: 'too_many' };
    const e164 = toE164(contact.phone_number, { from: 'telegram' });
    if (!e164 || !SLUG.test(String(slug || ''))) return { ok: false, reason: 'no_match' };
    const b = await store.buildingBySlug(String(slug));
    if (!b) return { ok: false, reason: 'no_match' };
    const mine = (await store.activeTenancies(b.id)).filter(t => t.user && toE164(t.user.phone, { from: 'ops' }) === e164);
    if (!mine.length) return { ok: false, reason: 'no_match' };
    for (const userId of new Set(mine.map(t => t.userId))) await store.setChat(userId, String(chat.id));
    const units = mine.map(t => t.unit.number);
    await note(b.id, 'TENANT_TG_LINKED', ('units ' + units.join(', ')).slice(0, 120) + ' · telegram …' + last4(telegramId));
    return { ok: true, buildingId: b.id, units };
  }

  // /stop in the bot. In a private chat the chat id is the account id, which is what setChat stored.
  async function unlink(telegramId) {
    const users = await store.usersWithChat(String(telegramId));
    for (const u of users) {
      await store.clearChat(u.id);
      const byBuilding = new Map();
      for (const t of u.tenancies) (byBuilding.get(t.unit.buildingId) || byBuilding.set(t.unit.buildingId, []).get(t.unit.buildingId)).push(t.unit.number);
      for (const [buildingId, units] of byBuilding) await note(buildingId, 'TENANT_TG_UNLINKED', ('units ' + units.join(', ')).slice(0, 120) + ' · /stop in Telegram');
    }
    return users.length;
  }

  async function statsForBuilding(buildingId) {
    const ts = await store.activeTenancies(buildingId);
    const linked = ts.filter(t => t.user && t.user.telegramChatId);
    return { active: ts.length, linked: linked.length, units: linked.map(t => ({ tenancyId: t.id, unit: t.unit.number })) };
  }

  // The owner removes a unit's link. It clears the tenant's Telegram chat for every building (one chat per person);
  // the tenant can link again from the poster, since their number still matches.
  async function removeForBuilding(buildingId, tenancyId) {
    const t = (await store.activeTenancies(buildingId)).find(x => x.id === String(tenancyId));
    if (!t || !t.user || !t.user.telegramChatId) return false;
    await store.clearChat(t.userId);
    await note(buildingId, 'TENANT_TG_UNLINKED', 'unit ' + t.unit.number + ' · removed from the dashboard');
    return true;
  }

  return { linkFromContact, unlink, statsForBuilding, removeForBuilding };
}

module.exports = { makeTenantLink, makeTenantLinkStore };
