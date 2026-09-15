-- Reverses 20260916_owner_actions.up.sql.
--
-- Order matters: first switch owner actions off for every building (node ops/owner/actions.js off <slug>, or
-- `UPDATE "AgentSwitch" SET "disabledAt" = now() WHERE agent IN ('owner-actions','owner-actions-staff')`), then revert the
-- server.js wiring (or restore server.js from its .bak-planB copies) and `pm2 restart binasmart-api --update-env`, since
-- that code writes this table. Then run this file, remove model OwnerAction from prisma/schema.prisma, and
-- `npx prisma generate`. Dropping discards the record of which action was prepared, confirmed or cancelled; the messages
-- themselves stay in OutboundBatch/OutboundMessage and the building's AuditLog.
SET lock_timeout = '5s';
BEGIN;
DROP TABLE IF EXISTS "OwnerAction";
COMMIT;
