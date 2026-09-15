-- 2026-09-16  Owner actions in Bini with ✅ confirm: OwnerAction
--
-- One row per action Bini prepared and the owner has not yet confirmed, and its outcome afterwards (design
-- docs/superpowers/specs/2026-09-15-owner-actions-messaging-design.md §3.2, agents/owner/actions/). Additive: one new
-- table, no column changed on any existing one. The two per-building switches are AgentSwitch rows
-- ('owner-actions', 'owner-actions-staff'), so they need no schema change at all.
-- This project applies schema changes with the SQL here, then `npx prisma generate`, and
-- `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
-- must print an empty migration.
-- Nothing is dropped and no row is rewritten, so no table needs a backup before it; .down.sql reverses it.
SET lock_timeout = '5s';
BEGIN;
CREATE TABLE IF NOT EXISTS "OwnerAction" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "channel" TEXT NOT NULL,
    "preparedBy" TEXT NOT NULL,
    "preparedRole" TEXT NOT NULL,
    "preparedTg" TEXT,
    "args" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "text" TEXT,
    "cardText" TEXT,
    "fingerprint" TEXT NOT NULL,
    "bulk" BOOLEAN NOT NULL DEFAULT false,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "cards" JSONB,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnerAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OwnerAction_buildingId_createdAt_idx" ON "OwnerAction"("buildingId", "createdAt");
CREATE INDEX IF NOT EXISTS "OwnerAction_status_expiresAt_idx" ON "OwnerAction"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "OwnerAction_buildingId_bulk_confirmedAt_idx" ON "OwnerAction"("buildingId", "bulk", "confirmedAt");
COMMIT;
