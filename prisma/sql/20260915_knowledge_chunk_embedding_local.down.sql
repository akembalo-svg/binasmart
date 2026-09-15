-- Reverses 20260915_knowledge_chunk_embedding_local.up.sql.
--
-- Order matters. The code of 2026-09-15 queries "embeddingLocal" during an ingest, so first either set
-- KNOWLEDGE_LOCAL_FALLBACK=0 in .env and `pm2 restart binasmart-api --update-env` (the nightly ingest reads .env
-- itself), or revert knowledge/index.js. Then run this file, remove the `embeddingLocal` line from
-- prisma/schema.prisma and run `npx prisma generate`.
--
-- Dropping the column only discards BGE vectors, which can be rebuilt (bge_v3.npy + ops/knowledge/local-embed-import.js).
-- To restore the whole table as it was before the change instead:
--   pg_restore --clean --if-exists -d binasmart /root/storage/backups/db/binasmart-KnowledgeChunk-<stamp>.dump
SET lock_timeout = '5s';
BEGIN;
ALTER TABLE "KnowledgeChunk" DROP COLUMN IF EXISTS "embeddingLocal";
COMMIT;
