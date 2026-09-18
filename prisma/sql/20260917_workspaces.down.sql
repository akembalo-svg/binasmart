-- Reverses 20260917_workspaces.up.sql. First remove the workspaces wiring line from server.js and restart
-- binasmart-api (that code writes these tables), then run this file, remove the four Workspace* models from
-- prisma/schema.prisma and `npx prisma generate`. Dropping deletes every client's uploaded documents and history.
SET lock_timeout = '5s';
BEGIN;
DROP TABLE IF EXISTS "WorkspaceQuestion";
DROP TABLE IF EXISTS "WorkspaceChunk";
DROP TABLE IF EXISTS "WorkspaceDoc";
DROP TABLE IF EXISTS "Workspace";
COMMIT;
