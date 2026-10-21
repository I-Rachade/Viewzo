-- Live sale offers sold by creators. Lives made before this change become
-- the advertiser's own lives (mode SELF), each with one session.

-- CreateEnum
CREATE TYPE "LiveMode" AS ENUM ('CREATORS', 'SELF');
CREATE TYPE "LiveSessionStatus" AS ENUM ('INVITED', 'ACCEPTED', 'RUNNING', 'ENDED', 'WITHDRAWN', 'DECLINED', 'MISSED', 'CANCELLED');
CREATE TYPE "LivePayoutStatus" AS ENUM ('NONE', 'TO_REVIEW', 'PAID', 'REFUSED');

-- AlterEnum
ALTER TYPE "CreatorTaskType" ADD VALUE 'LIVE_SELLING';
ALTER TYPE "NotificationType" ADD VALUE 'LIVE_UPDATED';

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "creatorId" TEXT,
    "tiktokUsername" TEXT NOT NULL,
    "followers" INTEGER,
    "status" "LiveSessionStatus" NOT NULL DEFAULT 'ACCEPTED',
    "scheduledAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "viewers" INTEGER,
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "sourceState" TEXT,
    "sourceMessage" TEXT,
    "flag" TEXT,
    "payout" "LivePayoutStatus" NOT NULL DEFAULT 'NONE',
    "earned" INTEGER NOT NULL DEFAULT 0,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "payoutReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- One session per existing live, with the same id.
INSERT INTO "LiveSession" ("id", "liveId", "tiktokUsername", "status", "scheduledAt", "acceptedAt", "startedAt", "endedAt", "viewers", "peakViewers", "sourceState", "sourceMessage", "createdAt", "updatedAt")
SELECT "id", "id", "tiktokUsername",
       (CASE "status"::text
          WHEN 'SCHEDULED' THEN 'ACCEPTED'
          WHEN 'RUNNING' THEN 'RUNNING'
          WHEN 'ENDED' THEN 'ENDED'
          ELSE 'CANCELLED' END)::"LiveSessionStatus",
       "scheduledAt", "createdAt", "startedAt", "endedAt", "viewers", COALESCE("viewers", 0),
       "sourceState", "sourceMessage", "createdAt", CURRENT_TIMESTAMP
FROM "LiveSale";

-- AlterEnum: offer statuses
CREATE TYPE "LiveSaleStatus_new" AS ENUM ('PENDING_PAYMENT', 'PENDING_REVIEW', 'ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED');
ALTER TABLE "LiveSale" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LiveSale" ALTER COLUMN "status" TYPE "LiveSaleStatus_new" USING (
  CASE "status"::text
    WHEN 'SCHEDULED' THEN 'ACTIVE'
    WHEN 'RUNNING' THEN 'ACTIVE'
    WHEN 'ENDED' THEN 'COMPLETED'
    ELSE 'CANCELLED' END
)::"LiveSaleStatus_new";
ALTER TYPE "LiveSaleStatus" RENAME TO "LiveSaleStatus_old";
ALTER TYPE "LiveSaleStatus_new" RENAME TO "LiveSaleStatus";
DROP TYPE "LiveSaleStatus_old";
ALTER TABLE "LiveSale" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable LiveSale
DROP INDEX "LiveSale_sellerId_scheduledAt_idx";
DROP INDEX "LiveSale_status_scheduledAt_idx";
ALTER TABLE "LiveSale" RENAME COLUMN "scheduledAt" TO "startsAt";
ALTER TABLE "LiveSale" RENAME COLUMN "cancelReason" TO "statusReason";
ALTER TABLE "LiveSale"
ADD COLUMN     "mode" "LiveMode" NOT NULL DEFAULT 'CREATORS',
ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "slots" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "budget" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fundedAt" TIMESTAMP(3),
ADD COLUMN     "spent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refunded" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceFee" INTEGER,
ADD COLUMN     "completedAt" TIMESTAMP(3);
UPDATE "LiveSale" SET "mode" = 'SELF', "completedAt" = "endedAt";
ALTER TABLE "LiveSale"
DROP COLUMN "endedAt",
DROP COLUMN "sourceMessage",
DROP COLUMN "sourceState",
DROP COLUMN "startedAt",
DROP COLUMN "tiktokUsername",
DROP COLUMN "viewers";
CREATE INDEX "LiveSale_sellerId_startsAt_idx" ON "LiveSale"("sellerId", "startsAt");
CREATE INDEX "LiveSale_status_startsAt_idx" ON "LiveSale"("status", "startsAt");

-- AlterTable LiveLead and LiveComment: attach to the session
ALTER TABLE "LiveLead" ADD COLUMN "sessionId" TEXT;
UPDATE "LiveLead" SET "sessionId" = "liveId";
ALTER TABLE "LiveLead" ALTER COLUMN "sessionId" SET NOT NULL;
DROP INDEX "LiveLead_liveId_tiktokUser_key";
CREATE UNIQUE INDEX "LiveLead_sessionId_tiktokUser_key" ON "LiveLead"("sessionId", "tiktokUser");

ALTER TABLE "LiveComment" ADD COLUMN "sessionId" TEXT;
UPDATE "LiveComment" SET "sessionId" = "liveId";
ALTER TABLE "LiveComment" ALTER COLUMN "sessionId" SET NOT NULL;
DROP INDEX "LiveComment_liveId_externalId_key";
CREATE UNIQUE INDEX "LiveComment_sessionId_externalId_key" ON "LiveComment"("sessionId", "externalId");
CREATE INDEX "LiveComment_sessionId_at_idx" ON "LiveComment"("sessionId", "at");

-- AlterTable Transaction
ALTER TABLE "Transaction" ADD COLUMN "liveId" TEXT, ADD COLUMN "liveSessionId" TEXT;
CREATE INDEX "Transaction_liveId_idx" ON "Transaction"("liveId");

-- CreateTable
CREATE TABLE "LiveRate" (
    "country" TEXT NOT NULL,
    "advertiserPer100" INTEGER NOT NULL,
    "creatorPer100" INTEGER NOT NULL,
    "selfFee" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveRate_pkey" PRIMARY KEY ("country")
);

CREATE TABLE "LiveCreatorStanding" (
    "userId" TEXT NOT NULL,
    "withdrawStreak" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "bannedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveCreatorStanding_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "LiveSession_creatorId_status_idx" ON "LiveSession"("creatorId", "status");
CREATE INDEX "LiveSession_status_scheduledAt_idx" ON "LiveSession"("status", "scheduledAt");
CREATE UNIQUE INDEX "LiveSession_liveId_creatorId_key" ON "LiveSession"("liveId", "creatorId");

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveCreatorStanding" ADD CONSTRAINT "LiveCreatorStanding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveLead" ADD CONSTRAINT "LiveLead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
