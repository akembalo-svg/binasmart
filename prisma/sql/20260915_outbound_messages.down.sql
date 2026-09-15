-- Reverses 20260915_outbound_messages.up.sql.
--
-- Order matters: first revert the server.js wiring of messaging/ (or restore server.js from its .bak-planA-t6 and
-- .bak-planA-t9 copies) and `pm2 restart binasmart-api --update-env`, since that code writes these tables. Then run
-- this file, remove the three models and the two Building lines from prisma/schema.prisma, and `npx prisma generate`.
-- Dropping discards the message records and the short links (links then show the "not valid" page).
SET lock_timeout = '5s';
BEGIN;
DROP TABLE IF EXISTS "OutboundMessage";
DROP TABLE IF EXISTS "OutboundBatch";
DROP TABLE IF EXISTS "InvoiceLink";
ALTER TABLE "Building" DROP COLUMN IF EXISTS "smsSender", DROP COLUMN IF EXISTS "smsMonthlyLimit";
COMMIT;
