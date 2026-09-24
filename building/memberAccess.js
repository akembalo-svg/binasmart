'use strict';
// One sign-in for all owners (23 Sep 2026): a building held through an account Membership (not the
// account's own AuthUser.buildingSlug) opens /owner/<slug> for a signed-in account, with EXACTLY the
// rights that building's owner key gives: server.js authBuildingFail calls this and nothing else changes,
// so every route it guards (and only those) opens, for that one slug only.
// Only status 'active' and role 'owner'. A staff membership is not dashboard access: the dashboard has
// no staff tier, and building staff today use the Telegram owner assistant, not /owner.
// Any error reads as "no": a failed lookup must never open a dashboard.
function makeBuildingMember({ prisma }) {
  return async function isBuildingMember(userId, slug) {
    if (!userId || !slug || typeof slug !== 'string') return false;
    try {
      const m = await prisma.membership.findFirst({
        where: { userId: String(userId), kind: 'building', buildingSlug: slug, status: 'active', role: 'owner' },
        select: { id: true }
      });
      return !!m;
    } catch (e) { return false; }
  };
}

module.exports = { makeBuildingMember };
