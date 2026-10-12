ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TABLE "ChatMessageReceipt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    CONSTRAINT "ChatMessageReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatMessageReceipt_messageId_userId_key" ON "ChatMessageReceipt"("messageId", "userId");
CREATE INDEX "ChatMessageReceipt_userId_deliveredAt_readAt_idx" ON "ChatMessageReceipt"("userId", "deliveredAt", "readAt");

ALTER TABLE "ChatMessageReceipt" ADD CONSTRAINT "ChatMessageReceipt_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessageReceipt" ADD CONSTRAINT "ChatMessageReceipt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ChatMessageReceipt" ("id", "messageId", "userId")
SELECT 'cmr_' || md5(random()::text || clock_timestamp()::text || message."id" || message."recipientId"), message."id", message."recipientId"
FROM "ChatMessage" message
WHERE message."recipientId" IS NOT NULL
ON CONFLICT ("messageId", "userId") DO NOTHING;

INSERT INTO "ChatMessageReceipt" ("id", "messageId", "userId")
SELECT 'cmr_' || md5(random()::text || clock_timestamp()::text || message."id" || member."userId"), message."id", member."userId"
FROM "ChatMessage" message
JOIN "WorkspaceMember" member ON member."workspaceId" = message."workspaceId" AND member."isActive" = TRUE
WHERE message."recipientId" IS NULL AND member."userId" <> message."senderId"
ON CONFLICT ("messageId", "userId") DO NOTHING;
