'use strict';
// One sign-in for all owners (23 Sep 2026). A person signed in to their bina.et account opens /business
// without the phone claim again when that account holds an ACTIVE OWNER membership for the shop or venue.
// A membership is only ever granted after a proven claim (business/index.js /api/business/verify calls
// onClaimVerified, which runs only for a code the owner typed back), so it proves exactly what a bsown
// session proves, and it is scoped to the memberships themselves: the client may choose among them
// (the bsacct cookie or /api/business/switch), never name a business outside them.
//
// Rules, each pinned by test/business-account.test.js:
//   - status 'active' and role 'owner' only. There is no staff tier in /business; a staff membership
//     is not dashboard access and keeps the phone sign-in.
//   - a hidden shop or an inactive venue opens nothing, the same as owners.session() refuses them.
//   - a valid bsown session always wins (index.js me() asks it first), so today's behaviour is unchanged.

const PICK = 'bsacct';
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function makeAccountOwners({ prisma }) {
  // Every shop and venue this account may run, oldest membership first.
  async function list(userId) {
    if (!userId) return [];
    const ms = await prisma.membership.findMany({
      where: { userId: String(userId), status: 'active', role: 'owner', kind: { in: ['shop', 'venue'] } },
      orderBy: { createdAt: 'asc' }
    });
    const out = [], seen = new Set();
    for (const m of ms) {
      if (m.kind === 'shop' && m.shopId && !seen.has(m.shopId)) {
        const shop = await prisma.shop.findUnique({ where: { id: m.shopId } });
        if (shop && shop.status !== 'hidden') { seen.add(shop.id); out.push({ kind: 'shop', id: shop.id, shop }); }
      } else if (m.kind === 'venue' && m.venueId && !seen.has(m.venueId)) {
        const venue = await prisma.venue.findUnique({ where: { id: m.venueId } });
        if (venue && venue.active) { seen.add(venue.id); out.push({ kind: 'venue', id: venue.id, venue }); }
      }
    }
    return out;
  }

  // The chosen one if it is in the list, else the first. The cookie is a preference, not a credential.
  function pick(targets, want) {
    if (!targets.length) return null;
    return targets.find(t => t.id === want) || targets[0];
  }

  // The same shape owners.session() returns, so every /business route works unchanged.
  function asSession(t, userId, all) {
    const session = { viaAccount: String(userId), kind: t.kind, shopId: t.kind === 'shop' ? t.id : null, venueId: t.kind === 'venue' ? t.id : null };
    return t.kind === 'shop' ? { kind: 'shop', shop: t.shop, session, account: all } : { kind: 'venue', venue: t.venue, session, account: all };
  }

  function pages(all, current) {
    return all.map(t => { const x = t.shop || t.venue; return { id: t.id, kind: t.kind, name: x.nameAm || x.name, current: t.id === current }; });
  }

  const pickOf = req => { const m = String((req.headers && req.headers.cookie) || '').match(/(?:^|;\s*)bsacct=([A-Za-z0-9_-]{1,40})/); return m ? m[1] : null; };
  const pickCookie = id => PICK + '=' + id + '; Path=/; Max-Age=' + (30 * 24 * 3600) + '; HttpOnly; Secure; SameSite=Lax';
  const clearCookie = PICK + '=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

  return { list, pick, asSession, pages, pickOf, pickCookie, clearCookie, ID_RE };
}

module.exports = { makeAccountOwners };
