-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CAMPAIGN_COMPLETED';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "completedAt" TIMESTAMP(3);
