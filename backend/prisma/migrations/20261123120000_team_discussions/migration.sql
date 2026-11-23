-- Threaded discussion board per team (decisions, not live chat).
CREATE TYPE "DiscussionStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "TeamDiscussion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "DiscussionStatus" NOT NULL DEFAULT 'OPEN',
    "lastReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamDiscussion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamDiscussionReply" (
    "id" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamDiscussionReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamDiscussion_teamId_createdAt_idx" ON "TeamDiscussion"("teamId", "createdAt");
CREATE INDEX "TeamDiscussion_workspaceId_status_idx" ON "TeamDiscussion"("workspaceId", "status");
CREATE INDEX "TeamDiscussionReply_discussionId_createdAt_idx" ON "TeamDiscussionReply"("discussionId", "createdAt");

ALTER TABLE "TeamDiscussion" ADD CONSTRAINT "TeamDiscussion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamDiscussion" ADD CONSTRAINT "TeamDiscussion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamDiscussion" ADD CONSTRAINT "TeamDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamDiscussionReply" ADD CONSTRAINT "TeamDiscussionReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "TeamDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamDiscussionReply" ADD CONSTRAINT "TeamDiscussionReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
