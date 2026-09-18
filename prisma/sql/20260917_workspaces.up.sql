-- 2026-09-17  Business assistants: Workspace, WorkspaceDoc, WorkspaceChunk, WorkspaceQuestion (workspaces/).
-- Additive: four new tables, no existing table or column touched. Nothing is dropped, so no backup is needed.
-- Apply this file, then `npx prisma generate`; the migrate diff check must print an empty migration.
SET lock_timeout = '5s';
BEGIN;
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#059669',
    "lang" TEXT NOT NULL DEFAULT 'am',
    "welcome" TEXT,
    "about" TEXT,
    "secretHash" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyLimit" INTEGER NOT NULL DEFAULT 100,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_secretHash_key" ON "Workspace"("secretHash");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_siteKey_key" ON "Workspace"("siteKey");
CREATE TABLE IF NOT EXISTS "WorkspaceDoc" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "kind" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "chars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceDoc_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkspaceDoc_workspaceId_idx" ON "WorkspaceDoc"("workspaceId");
CREATE TABLE IF NOT EXISTS "WorkspaceChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "vec" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceChunk_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkspaceChunk_workspaceId_idx" ON "WorkspaceChunk"("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkspaceChunk_docId_idx" ON "WorkspaceChunk"("docId");
CREATE TABLE IF NOT EXISTS "WorkspaceQuestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "question" TEXT NOT NULL,
    "answered" BOOLEAN NOT NULL DEFAULT true,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkspaceQuestion_workspaceId_createdAt_idx" ON "WorkspaceQuestion"("workspaceId", "createdAt");
COMMIT;
