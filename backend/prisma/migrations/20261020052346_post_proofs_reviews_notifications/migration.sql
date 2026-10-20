-- CreateEnum
CREATE TYPE "PostReviewStatus" AS ENUM ('TO_REVIEW', 'VALIDATED', 'NEEDS_FIX', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('SCREENSHOT', 'LINK');

-- CreateEnum
CREATE TYPE "ViewSource" AS ENUM ('CREATOR', 'STAFF', 'API');

-- CreateEnum
CREATE TYPE "PostReviewAction" AS ENUM ('VIEWS', 'VALIDATE', 'NEEDS_FIX', 'REJECT', 'SUSPEND_ACCOUNT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_TASK', 'PROOF_REMINDER', 'POST_VALIDATED', 'POST_NEEDS_FIX', 'POST_REJECTED', 'ACCOUNT_REVIEWED', 'CAMPAIGN_REVIEWED', 'WITHDRAWAL_UPDATED');

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewStatus" "PostReviewStatus" NOT NULL DEFAULT 'TO_REVIEW',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "riskScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "viewsFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PostProof" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" "ProofKind" NOT NULL,
    "url" TEXT,
    "fileKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "capturedAt" TIMESTAMP(3),
    "declaredViews" INTEGER,
    "deviceId" TEXT,
    "ip" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewSnapshot" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "source" "ViewSource" NOT NULL,
    "proofId" TEXT,
    "recordedById" TEXT,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostReview" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" "PostReviewAction" NOT NULL,
    "views" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostProof_assignmentId_uploadedAt_idx" ON "PostProof"("assignmentId", "uploadedAt");

-- CreateIndex
CREATE INDEX "PostProof_sha256_idx" ON "PostProof"("sha256");

-- CreateIndex
CREATE INDEX "PostProof_deviceId_idx" ON "PostProof"("deviceId");

-- CreateIndex
CREATE INDEX "ViewSnapshot_assignmentId_takenAt_idx" ON "ViewSnapshot"("assignmentId", "takenAt");

-- CreateIndex
CREATE INDEX "PostReview_assignmentId_createdAt_idx" ON "PostReview"("assignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAssignment_status_reviewStatus_riskScore_idx" ON "TaskAssignment"("status", "reviewStatus", "riskScore");

-- AddForeignKey
ALTER TABLE "PostProof" ADD CONSTRAINT "PostProof_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewSnapshot" ADD CONSTRAINT "ViewSnapshot_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReview" ADD CONSTRAINT "PostReview_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing posts: their link becomes the first proof, and validated views
-- the first point of the views history.
INSERT INTO "PostProof" ("id", "assignmentId", "kind", "url", "uploadedAt")
SELECT gen_random_uuid()::text, "id", 'LINK', "postUrl", COALESCE("submittedAt", "acceptedAt")
FROM "TaskAssignment" WHERE "postUrl" IS NOT NULL;

INSERT INTO "ViewSnapshot" ("id", "assignmentId", "views", "source", "takenAt")
SELECT gen_random_uuid()::text, "id", "validViews", 'STAFF', CURRENT_TIMESTAMP
FROM "TaskAssignment" WHERE "validViews" > 0;

UPDATE "TaskAssignment" SET "reviewStatus" = 'VALIDATED', "reviewedAt" = CURRENT_TIMESTAMP
WHERE "validViews" > 0;
