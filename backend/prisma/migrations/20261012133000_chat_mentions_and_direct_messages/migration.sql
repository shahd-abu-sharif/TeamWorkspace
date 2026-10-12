ALTER TABLE "ChatMessage"
    ADD COLUMN "recipientId" TEXT,
    ADD COLUMN "mentionUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "ChatMessage_workspaceId_recipientId_createdAt_idx"
    ON "ChatMessage"("workspaceId", "recipientId", "createdAt");

ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
