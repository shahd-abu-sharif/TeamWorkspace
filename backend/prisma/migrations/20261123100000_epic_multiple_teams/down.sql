-- Roll back to one team per epic (extra owners are lost, the first is kept).
ALTER TABLE "Epic" ADD COLUMN "teamId" TEXT;
UPDATE "Epic" e SET "teamId" = (
    SELECT et."teamId" FROM "EpicTeam" et WHERE et."epicId" = e."id" ORDER BY et."teamId" LIMIT 1
);
CREATE INDEX "Epic_workspaceId_teamId_idx" ON "Epic"("workspaceId", "teamId");
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP TABLE "EpicTeam";
