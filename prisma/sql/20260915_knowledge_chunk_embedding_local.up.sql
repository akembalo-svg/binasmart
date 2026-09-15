-- 2026-09-15  KnowledgeChunk.embeddingLocal
--
-- BGE-M3 vectors from bina-embed (127.0.0.1:3031): 1024 x float32 little-endian, L2-normalised, stored exactly like
-- the Gemini column "embedding" (768 x float32, bytes, no pgvector). knowledge/index.js ranks with it only when the
-- Gemini query embedding fails; the normal search path never reads it.
--
-- Additive and nullable, no default: Postgres records the column in the catalogue and rewrites no rows.
-- This project applies schema changes with `prisma db push`; the SQL is kept here so the change can be reviewed,
-- applied on its own and reversed (see the .down.sql next to it). After applying: `npx prisma generate`, and
-- `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma`
-- must report an empty migration.
--
-- Back up the table first:
--   pg_dump -Fc -t '"KnowledgeChunk"' -f /root/storage/backups/db/binasmart-KnowledgeChunk-<stamp>.dump
SET lock_timeout = '5s';
BEGIN;
ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "embeddingLocal" BYTEA;
COMMIT;
