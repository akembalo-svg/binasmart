'use strict';
// Who may use Bini for owners, and through which Telegram account (owner Bini design §3).
//
// Three facts, three tables: a number is approved for a business (OwnerAccess), a Telegram account proved it
// holds that number (OwnerTgLink), and the agent is switched on for the business (AgentSwitch). Access is the
// intersection, computed afresh for every message — a removed number or a switched-off building ends access
// on the next message, not at the next sign-in.
//
// Proof is Telegram's, never the user's word: a contact counts only when it is the sender's own account
// (contact.user_id === from.id), shared in a private chat, not forwarded.
const { phoneKey } = require('../../ride/phone');

const KINDS = ['building'];        // v1 is the building pack; shops, venues and hotels use the same rows later
const TOUCH_MS = 3600000;          // lastSeen written at most hourly

function limiter(max, windowMs, clock) {
  const hits = new Map();
  return key => {
    const t = clock().getTime();
    const list = (hits.get(key) || []).filter(x => t - x < windowMs);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(t); hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

function makeOwnerAccessStore(prisma) {
  const accessSelect = { id: true, kind: true, entityId: true, phoneKey: true, role: true, label: true };
  return {
    linkByTelegram: telegramId => prisma.ownerTgLink.findUnique({ where: { telegramId } }),
    linkById: id => prisma.ownerTgLink.findUnique({ where: { id } }),
    activeAccessByPhone: pk => prisma.ownerAccess.findMany({ where: { phoneKey: pk, revokedAt: null }, select: accessSelect }),
    accessForEntity: (kind, entityId) => prisma.ownerAccess.findMany({ where: { kind, entityId, revokedAt: null }, select: accessSelect }),
    enabledEntities: async (agent, kind, ids) =>
      (await prisma.agentSwitch.findMany({ where: { agent, kind, entityId: { in: ids }, disabledAt: null }, select: { entityId: true } })).map(r => r.entityId),
    upsertLink: ({ telegramId, chatId, phoneKey: pk, at }) => prisma.ownerTgLink.upsert({ where: { telegramId },
      create: { telegramId, chatId, phoneKey: pk, linkedAt: at, lastSeen: at },
      update: { chatId, phoneKey: pk, linkedAt: at, lastSeen: at, revokedAt: null, mode: 'owner' } }),
    revokeLink: (id, at) => prisma.ownerTgLink.update({ where: { id }, data: { revokedAt: at } }),
    touchLink: (id, at) => prisma.ownerTgLink.update({ where: { id }, data: { lastSeen: at } }),
    setMode: (id, mode) => prisma.ownerTgLink.update({ where: { id }, data: { mode } }),
    linksForPhones: pks => prisma.ownerTgLink.findMany({ where: { phoneKey: { in: pks } }, orderBy: { linkedAt: 'desc' }, take: 50 }),
  };
}

function makeOwnerAccess({ store, audit = () => {}, now = () => new Date(), limit }) {
  const allow = limit || limiter(5, 15 * 60000, now);
  const note = (buildingId, action, detail) => Promise.resolve().then(() => audit(buildingId, action, detail)).catch(() => {});
  const last4 = s => String(s || '').replace(/\D/g, '').slice(-4);

  async function buildingsFor(pk) {
    const rows = (await store.activeAccessByPhone(pk)).filter(r => KINDS.includes(r.kind));
    if (!rows.length) return [];
    const on = new Set(await store.enabledEntities('owner', 'building', [...new Set(rows.map(r => r.entityId))]));
    return [...new Set(rows.filter(r => on.has(r.entityId)).map(r => r.entityId))];
  }

  async function linkFromContact({ chat, from, contact, forwarded }) {
    if (!chat || chat.type !== 'private') return { ok: false, reason: 'not_private' };
    if (!from || !contact || forwarded || contact.user_id == null || String(contact.user_id) !== String(from.id))
      return { ok: false, reason: 'not_own_contact' };
    const telegramId = String(from.id);
    if (!allow(telegramId)) return { ok: false, reason: 'too_many' };
    const pk = phoneKey(contact.phone_number);
    const ids = pk ? await buildingsFor(pk) : [];
    if (!ids.length) return { ok: false, reason: 'not_registered' };    // never says which businesses exist
    const link = await store.upsertLink({ telegramId, chatId: String(chat.id), phoneKey: pk, at: now() });
    for (const id of ids) await note(id, 'OWNER_TG_LINKED', 'telegram …' + last4(telegramId) + ' · phone …' + last4(pk));
    return { ok: true, scope: { buildingIds: ids, mode: 'owner', linkId: link.id } };
  }

  async function scopeFor(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return null;
    const ids = await buildingsFor(link.phoneKey);
    if (!ids.length) return null;
    if (!link.lastSeen || now() - new Date(link.lastSeen) > TOUCH_MS) Promise.resolve(store.touchLink(link.id, now())).catch(() => {});
    return { buildingIds: ids, mode: link.mode === 'bini' ? 'bini' : 'owner', linkId: link.id };
  }

  async function unlink(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.revokeLink(link.id, now());
    for (const r of await store.activeAccessByPhone(link.phoneKey))
      await note(r.entityId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · signed out in Telegram');
    return true;
  }

  async function setMode(telegramId, mode) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.setMode(link.id, mode === 'bini' ? 'bini' : 'owner');
    return true;
  }

  // For the dashboard: the Telegram accounts currently holding one of this building's approved numbers.
  async function linksForBuilding(buildingId) {
    const rows = await store.accessForEntity('building', buildingId);
    const byPhone = new Map(rows.map(r => [r.phoneKey, r]));
    if (!byPhone.size) return [];
    return (await store.linksForPhones([...byPhone.keys()])).filter(l => !l.revokedAt).map(l => ({
      id: l.id, role: byPhone.get(l.phoneKey).role, label: byPhone.get(l.phoneKey).label || null,
      phoneLast4: last4(l.phoneKey), linkedAt: l.linkedAt, lastSeen: l.lastSeen, mode: l.mode }));
  }

  // Remove signs that Telegram account out. Only a link holding one of THIS building's numbers can be removed from
  // this building's dashboard. The number stays approved until ops revoke it (ops/owner/access.js).
  async function revokeForBuilding(buildingId, linkId) {
    const phones = new Set((await store.accessForEntity('building', buildingId)).map(r => r.phoneKey));
    const link = await store.linkById(String(linkId));
    if (!link || link.revokedAt || !phones.has(link.phoneKey)) return false;
    await store.revokeLink(link.id, now());
    await note(buildingId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · removed from the dashboard');
    return true;
  }

  return { linkFromContact, scopeFor, unlink, setMode, linksForBuilding, revokeForBuilding };
}

module.exports = { makeOwnerAccess, makeOwnerAccessStore, KINDS };
