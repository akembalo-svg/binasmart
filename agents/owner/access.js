'use strict';
// Who may use Bini for owners, and through which Telegram account (owner Bini design §3).
//
// Three facts, three tables: a number is approved for a business (OwnerAccess), a Telegram account proved it
// holds that number (OwnerTgLink), and the agent is switched on for the business (AgentSwitch). Access is the
// intersection, computed afresh for every message — a removed number or a switched-off building ends access
// on the next message, not at the next sign-in.
//
// Proof is Telegram's, never the user's word: a contact counts only when it is the sender's own account
// (contact.user_id === from.id), shared in their private chat with the bot (chat.id === from.id), not forwarded.
//
// Numbers are matched as full international numbers (E.164), never by phoneKey's last nine digits: +91 99 1234 5678
// and +251 91 123 4567 share nine digits and are two different people. phoneKey is kept for display only.
//
// A link does not outlive what it proved. One active link per number (a newer proof replaces the older account);
// an approval counts for a link only if it existed when the link was made (a revoked-then-re-approved number
// needs the phone shared again); and a Remove from the dashboard or ops sticks until ops approve the number again.
const { phoneKey } = require('../../ride/phone');

const KINDS = ['building'];        // v1 is the building pack; shops, venues and hotels use the same rows later
const TOUCH_MS = 3600000;          // lastSeen written at most hourly
const MODES = ['owner', 'bini'];
const STICKY = ['dashboard', 'ops', 'access'];   // revoked for the person, not by them: relinking needs a new approval

const E164 = /^\+[1-9]\d{7,14}$/;

// from 'ops': a number typed by a person approving it — forgiving about spacing and the local 0… form.
// from 'telegram': contact.phone_number exactly as Telegram sent it — digits with an optional +, nothing else.
function toE164(raw, { from } = {}) {
  if (from === 'telegram') {
    const s = typeof raw === 'string' ? raw : '';
    return /^\+?[1-9]\d{7,14}$/.test(s) ? '+' + s.replace(/^\+/, '') : null;
  }
  if (from === 'ops') {
    let s = String(raw == null ? '' : raw).trim().replace(/[\s\-.()]/g, '');
    if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1);
    else if (/^00/.test(s)) s = '+' + s.slice(2);
    else if (/^251\d{9}$/.test(s)) s = '+' + s;
    return E164.test(s) ? s : null;
  }
  throw new TypeError("toE164: from must be 'ops' or 'telegram'");
}

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
  const accessSelect = { id: true, kind: true, entityId: true, phoneKey: true, phoneE164: true, role: true, label: true, createdAt: true };
  return {
    linkByTelegram: telegramId => prisma.ownerTgLink.findUnique({ where: { telegramId } }),
    linkById: id => prisma.ownerTgLink.findUnique({ where: { id } }),
    activeAccessByPhone: e164 => prisma.ownerAccess.findMany({ where: { phoneE164: e164, revokedAt: null }, select: accessSelect }),
    accessForEntity: (kind, entityId) => prisma.ownerAccess.findMany({ where: { kind, entityId, revokedAt: null }, select: accessSelect }),
    accessById: id => prisma.ownerAccess.findUnique({ where: { id }, select: { ...accessSelect, revokedAt: true } }),
    revokeAccess: (id, at) => prisma.ownerAccess.update({ where: { id }, data: { revokedAt: at } }),
    enabledEntities: async (agent, kind, ids) =>
      (await prisma.agentSwitch.findMany({ where: { agent, kind, entityId: { in: ids }, disabledAt: null }, select: { entityId: true } })).map(r => r.entityId),
    upsertLink: ({ telegramId, chatId, phoneKey: pk, phoneE164, at }) => prisma.ownerTgLink.upsert({ where: { telegramId },
      create: { telegramId, chatId, phoneKey: pk, phoneE164, linkedAt: at, lastSeen: at },
      update: { chatId, phoneKey: pk, phoneE164, linkedAt: at, lastSeen: at, revokedAt: null, revokedReason: null, mode: 'owner' } }),
    revokeLink: (id, at, reason) => prisma.ownerTgLink.update({ where: { id }, data: { revokedAt: at, revokedReason: reason } }),
    touchLink: (id, at) => prisma.ownerTgLink.update({ where: { id }, data: { lastSeen: at } }),
    setMode: (id, mode) => prisma.ownerTgLink.update({ where: { id }, data: { mode } }),
    linksForPhones: e164s => prisma.ownerTgLink.findMany({ where: { phoneE164: { in: e164s }, revokedAt: null }, orderBy: { linkedAt: 'desc' }, take: 50 }),
  };
}

function makeOwnerAccess({ store, audit = () => {}, now = () => new Date(), limit }) {
  const allow = limit || limiter(5, 15 * 60000, now);
  const note = (buildingId, action, detail) => Promise.resolve().then(() => audit(buildingId, action, detail)).catch(() => {});
  const last4 = s => String(s || '').replace(/\D/g, '').slice(-4);
  const ms = d => new Date(d).getTime();

  // Approved rows (optionally only those that existed at `asOf`) intersected with switched-on buildings.
  // When one number holds several approvals for a building, owner outranks staff.
  async function grantsFor(rows, asOf) {
    rows = rows.filter(r => KINDS.includes(r.kind) && (asOf == null || ms(r.createdAt) <= ms(asOf)));
    if (!rows.length) return { ids: [], roles: {} };
    const on = new Set(await store.enabledEntities('owner', 'building', [...new Set(rows.map(r => r.entityId))]));
    const roles = {};
    for (const r of rows) if (on.has(r.entityId) && roles[r.entityId] !== 'owner') roles[r.entityId] = r.role === 'owner' ? 'owner' : (r.role || 'staff');
    return { ids: Object.keys(roles), roles };
  }

  async function linkFromContact({ chat, from, contact, forwarded }) {
    if (!chat || chat.type !== 'private') return { ok: false, reason: 'not_private' };
    if (!from || !contact || forwarded || contact.user_id == null || String(contact.user_id) !== String(from.id))
      return { ok: false, reason: 'not_own_contact' };
    if (String(chat.id) !== String(from.id)) return { ok: false, reason: 'not_private' };
    const telegramId = String(from.id);
    if (!allow(telegramId)) return { ok: false, reason: 'too_many' };
    const e164 = toE164(contact.phone_number, { from: 'telegram' });
    if (!e164) return { ok: false, reason: 'not_registered' };
    const approvals = await store.activeAccessByPhone(e164);
    const prev = await store.linkByTelegram(telegramId);
    if (prev && prev.revokedAt && STICKY.includes(prev.revokedReason) && !approvals.some(a => ms(a.createdAt) > ms(prev.revokedAt)))
      return { ok: false, reason: 'blocked' };
    const { ids, roles } = await grantsFor(approvals);
    if (!ids.length) return { ok: false, reason: 'not_registered' };    // never says which businesses exist
    const at = now();
    const link = await store.upsertLink({ telegramId, chatId: String(chat.id), phoneKey: phoneKey(e164), phoneE164: e164, at });
    for (const other of await store.linksForPhones([e164])) {
      if (other.revokedAt || other.telegramId === telegramId) continue;
      await store.revokeLink(other.id, at, 'replaced');
      for (const id of ids) await note(id, 'OWNER_TG_UNLINKED', 'telegram …' + last4(other.telegramId) + ' · replaced by a newer link');
    }
    for (const id of ids) await note(id, 'OWNER_TG_LINKED', 'telegram …' + last4(telegramId) + ' · phone …' + last4(e164));
    return { ok: true, scope: { buildingIds: ids, roles, mode: 'owner', linkId: link.id } };
  }

  async function scopeFor(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return null;
    const { ids, roles } = await grantsFor(await store.activeAccessByPhone(link.phoneE164), link.linkedAt);
    if (!ids.length) return null;
    if (!link.lastSeen || now() - new Date(link.lastSeen) > TOUCH_MS) Promise.resolve(store.touchLink(link.id, now())).catch(() => {});
    return { buildingIds: ids, roles, mode: link.mode === 'bini' ? 'bini' : 'owner', linkId: link.id };
  }

  async function unlink(telegramId) {
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.revokeLink(link.id, now(), 'self');
    for (const r of await store.activeAccessByPhone(link.phoneE164))
      await note(r.entityId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · signed out in Telegram');
    return true;
  }

  async function setMode(telegramId, mode) {
    if (!MODES.includes(mode)) return false;
    const link = await store.linkByTelegram(String(telegramId));
    if (!link || link.revokedAt) return false;
    await store.setMode(link.id, mode);
    return true;
  }

  // For the dashboard: the Telegram accounts whose link currently carries one of this building's approvals.
  async function linksForBuilding(buildingId) {
    const rows = (await store.accessForEntity('building', buildingId)).filter(r => KINDS.includes(r.kind));
    const byPhone = new Map();
    for (const r of rows) (byPhone.get(r.phoneE164) || byPhone.set(r.phoneE164, []).get(r.phoneE164)).push(r);
    if (!byPhone.size) return [];
    const out = [];
    for (const l of await store.linksForPhones([...byPhone.keys()])) {
      if (l.revokedAt) continue;
      const held = byPhone.get(l.phoneE164).filter(r => ms(r.createdAt) <= ms(l.linkedAt));
      if (!held.length) continue;                                  // approved again after this link: not a live link here
      const r = held.find(x => x.role === 'owner') || held[0];
      out.push({ id: l.id, role: r.role, label: r.label || null, phoneLast4: last4(l.phoneE164), linkedAt: l.linkedAt, lastSeen: l.lastSeen, mode: l.mode });
    }
    return out;
  }

  // Remove signs that Telegram account out, and it stays out until ops approve the number again. Only a link
  // holding one of THIS building's numbers can be removed from this building's dashboard. The number itself stays
  // approved until ops revoke it (revokeAccess).
  async function revokeForBuilding(buildingId, linkId) {
    const link = await store.linkById(String(linkId));
    if (!link || link.revokedAt) return false;
    const phones = new Set((await store.accessForEntity('building', buildingId)).map(r => r.phoneE164));
    if (!phones.has(link.phoneE164)) return false;
    await store.revokeLink(link.id, now(), 'dashboard');
    await note(buildingId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(link.telegramId) + ' · removed from the dashboard');
    return true;
  }

  // Ops withdraw one approval. When the number has no approval left anywhere, the Telegram accounts it proved are
  // signed out too (reason `access`, which sticks until a new approval).
  async function revokeAccess(accessId, { by } = {}) {
    const row = await store.accessById(String(accessId));
    if (!row || row.revokedAt) return { ok: false, linksRevoked: 0 };
    const at = now();
    await store.revokeAccess(row.id, at);
    await note(row.entityId, 'OWNER_ACCESS_REVOKED', 'phone …' + last4(row.phoneE164) + ' · by ' + String(by || 'ops').replace(/\d/g, '').slice(0, 40));
    const remaining = (await store.activeAccessByPhone(row.phoneE164)).filter(r => r.id !== row.id);
    let linksRevoked = 0;
    if (!remaining.length) {
      for (const l of await store.linksForPhones([row.phoneE164])) {
        if (l.revokedAt) continue;
        await store.revokeLink(l.id, at, 'access');
        linksRevoked++;
        await note(row.entityId, 'OWNER_TG_UNLINKED', 'telegram …' + last4(l.telegramId) + ' · number no longer approved');
      }
    }
    return { ok: true, linksRevoked };
  }

  return { linkFromContact, scopeFor, unlink, setMode, linksForBuilding, revokeForBuilding, revokeAccess };
}

// limiter is reused by messaging/tenant-link.js: the same attempt limit (its own counters) for tenant Share-my-phone links.
module.exports = { makeOwnerAccess, makeOwnerAccessStore, toE164, KINDS, limiter };
