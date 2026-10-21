-- CreateEnum
CREATE TYPE "DisputeSide" AS ENUM ('CREATOR', 'ADVERTISER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('KEEP', 'SET_VIEWS', 'REJECT_POST');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DISPUTE_UPDATED';

-- AlterEnum
ALTER TYPE "PostReviewAction" ADD VALUE 'STILL_ONLINE';
ALTER TYPE "PostReviewAction" ADD VALUE 'REMOVED';

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "captureRemindersSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onlineCheckedAt" TIMESTAMP(3),
ADD COLUMN     "stillOnline" BOOLEAN;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "frozen" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "side" "DisputeSide" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "DisputeOutcome",
    "decisionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_assignmentId_createdAt_idx" ON "Dispute"("assignmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

