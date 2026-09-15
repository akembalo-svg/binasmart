-- 2026-09-15  Tenant messages: OutboundBatch, OutboundMessage, InvoiceLink; Building.smsMonthlyLimit, Building.smsSender
--
-- messaging/delivery.js records every tenant message here (design docs/superpowers/specs/2026-09-15-owner-actions-
-- messaging-design.md §1.5); messaging/invoice-links.js keeps the bina.et/i/<token> links. Additive only: three new
-- tables and two Building columns (a constant default, so Postgres rewrites no rows). Every building starts with a
-- monthly limit of 500 SMS parts (decided 15 Sep); SMS still goes nowhere while SMS_MODE is not live. No phone numbers are stored.
-- This project applies schema changes with `prisma db push`; the SQL is kept so the change can be reviewed, applied on
-- its own and reversed (.down.sql). After applying: `npx prisma generate`, and
-- `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
-- must print an empty migration.
--
-- Back up Building first:
--   pg_dump -Fc -t '"Building"' -f /root/storage/backups/db/binasmart-Building-<stamp>.dump <database url without ?schema>
SET lock_timeout = '5s';
BEGIN;
ALTER TABLE "Building" ADD COLUMN IF NOT EXISTS "smsMonthlyLimit" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Building" ADD COLUMN IF NOT EXISTS "smsSender" TEXT;
CREATE TABLE IF NOT EXISTS "OutboundBatch" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actor" TEXT,
    "text" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboundBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "OutboundMessage" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "buildingId" TEXT,
    "tenancyId" TEXT,
    "userId" TEXT,
    "invoiceId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "smsParts" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "errorKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "InvoiceLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "OutboundBatch_buildingId_createdAt_idx" ON "OutboundBatch"("buildingId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_buildingId_createdAt_idx" ON "OutboundMessage"("buildingId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboundMessage_invoiceId_idx" ON "OutboundMessage"("invoiceId");
CREATE INDEX IF NOT EXISTS "OutboundMessage_batchId_idx" ON "OutboundMessage"("batchId");
CREATE INDEX IF NOT EXISTS "OutboundMessage_providerId_idx" ON "OutboundMessage"("providerId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceLink_token_key" ON "InvoiceLink"("token");
CREATE INDEX IF NOT EXISTS "InvoiceLink_invoiceId_idx" ON "InvoiceLink"("invoiceId");
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OutboundBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
