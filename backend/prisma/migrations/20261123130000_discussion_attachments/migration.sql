-- Files attached to a discussion post or to one of its replies.
CREATE TABLE "DiscussionAttachment" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "replyId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DiscussionAttachment_discussionId_idx" ON "DiscussionAttachment"("discussionId");
CREATE INDEX "DiscussionAttachment_replyId_idx" ON "DiscussionAttachment"("replyId");

ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "TeamDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "TeamDiscussionReply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionAttachment" ADD CONSTRAINT "DiscussionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
