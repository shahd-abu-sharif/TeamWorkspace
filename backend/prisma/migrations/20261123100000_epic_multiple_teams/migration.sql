-- An epic can now be owned by several teams (union of members may be assigned).
CREATE TABLE "EpicTeam" (
    "epicId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "EpicTeam_pkey" PRIMARY KEY ("epicId","teamId")
);

-- Backfill: the previous single team becomes the epic's first owner.
INSERT INTO "EpicTeam" ("epicId", "teamId")
SELECT "id", "teamId" FROM "Epic" WHERE "teamId" IS NOT NULL;

CREATE INDEX "EpicTeam_teamId_idx" ON "EpicTeam"("teamId");

ALTER TABLE "EpicTeam" ADD CONSTRAINT "EpicTeam_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpicTeam" ADD CONSTRAINT "EpicTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "Epic_workspaceId_teamId_idx";
ALTER TABLE "Epic" DROP CONSTRAINT "Epic_teamId_fkey";
ALTER TABLE "Epic" DROP COLUMN "teamId";
