-- Per-assignee subtask ticks: a subtask is done only when every assignee checked it.
CREATE TABLE "SubtaskCompletion" (
    "subtaskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtaskCompletion_pkey" PRIMARY KEY ("subtaskId","userId")
);

CREATE INDEX "SubtaskCompletion_userId_idx" ON "SubtaskCompletion"("userId");

ALTER TABLE "SubtaskCompletion" ADD CONSTRAINT "SubtaskCompletion_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "Subtask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubtaskCompletion" ADD CONSTRAINT "SubtaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: keep existing completions attributed to whoever ticked them.
INSERT INTO "SubtaskCompletion" ("subtaskId", "userId", "completedAt")
SELECT s."id", s."doneById", COALESCE(s."doneAt", s."updatedAt")
FROM "Subtask" s
WHERE s."done" = true AND s."doneById" IS NOT NULL
ON CONFLICT DO NOTHING;
