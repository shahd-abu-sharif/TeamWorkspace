ALTER TABLE "Task" ADD COLUMN "startedAt" TIMESTAMP(3);

CREATE TABLE "TaskTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "TaskTimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskTimeEntry_taskId_userId_endedAt_idx" ON "TaskTimeEntry"("taskId", "userId", "endedAt");
CREATE INDEX "TaskTimeEntry_userId_startedAt_idx" ON "TaskTimeEntry"("userId", "startedAt");

ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTimeEntry" ADD CONSTRAINT "TaskTimeEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Task" SET "startedAt" = "updatedAt" WHERE "status" = 'IN_PROGRESS';

INSERT INTO "TaskTimeEntry" ("id", "taskId", "userId", "startedAt")
SELECT 'tte_' || md5(random()::text || clock_timestamp()::text || a."taskId" || a."userId"), a."taskId", a."userId", t."startedAt"
FROM "TaskAssignee" a
JOIN "Task" t ON t."id" = a."taskId"
WHERE t."status" = 'IN_PROGRESS';
