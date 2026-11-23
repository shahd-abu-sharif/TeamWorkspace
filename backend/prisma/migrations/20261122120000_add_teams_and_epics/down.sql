-- Down migration for 20261122120000_add_teams_and_epics.
--
-- Prisma's `migrate` has no built-in rollback, so this file is applied by hand:
--   psql "$DATABASE_URL" -f prisma/migrations/20261122120000_add_teams_and_epics/down.sql
--
-- It reverses the up migration exactly: epics are dropped (their tasks survive
-- with epicId reset to NULL first), then teams, then the two enum types.

-- Drop the epic link from tasks. Detach tasks first so nothing is deleted with
-- the Epic table.
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_epicId_fkey";
UPDATE "Task" SET "epicId" = NULL WHERE "epicId" IS NOT NULL;
DROP INDEX IF EXISTS "Task_workspaceId_epicId_idx";
ALTER TABLE "Task" DROP COLUMN IF EXISTS "epicId";

-- Drop epic relations before the tables they point at.
ALTER TABLE "Epic" DROP CONSTRAINT IF EXISTS "Epic_workspaceId_fkey";
ALTER TABLE "Epic" DROP CONSTRAINT IF EXISTS "Epic_teamId_fkey";
ALTER TABLE "Epic" DROP CONSTRAINT IF EXISTS "Epic_createdById_fkey";
DROP TABLE IF EXISTS "Epic";

ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_teamId_fkey";
ALTER TABLE "TeamMember" DROP CONSTRAINT IF EXISTS "TeamMember_userId_fkey";
DROP TABLE IF EXISTS "TeamMember";

ALTER TABLE "Team" DROP CONSTRAINT IF EXISTS "Team_workspaceId_fkey";
DROP TABLE IF EXISTS "Team";

DROP TYPE IF EXISTS "TeamType";
DROP TYPE IF EXISTS "TeamMemberRole";
