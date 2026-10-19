-- CreateEnum
CREATE TYPE "CampaignObjective" AS ENUM ('AWARENESS', 'SALES', 'DOWNLOADS', 'TRAFFIC');

-- CreateEnum
CREATE TYPE "CampaignPackage" AS ENUM ('BASIC', 'PRO', 'PREMIUM', 'ELITE');

-- CreateEnum
CREATE TYPE "NoAssetsChoice" AS ENUM ('CREATOR_VIDEOS', 'STUDIO');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('PROVIDED_ASSETS', 'VIDEO_WITH_POSTERS', 'FACECAM', 'VLOG_DEMO_UNBOXING', 'FULL_EDITING', 'MOTION_DESIGN', 'FREE_BRIEF');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACCEPTED', 'SUBMITTED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" "CampaignObjective" NOT NULL,
    "countries" TEXT[],
    "cities" TEXT[],
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "package" "CampaignPackage" NOT NULL,
    "budget" INTEGER NOT NULL,
    "hasAssets" BOOLEAN NOT NULL,
    "assetUrls" TEXT[],
    "noAssetsChoice" "NoAssetsChoice",
    "shipsProduct" BOOLEAN NOT NULL DEFAULT false,
    "productPickup" TEXT,
    "faceRequired" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL,
    "minDurationSec" INTEGER,
    "maxDurationSec" INTEGER,
    "tone" TEXT,
    "mandatoryElements" TEXT[],
    "forbiddenElements" TEXT[],
    "examples" TEXT[],
    "status" "CampaignStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTask" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "network" "SocialNetwork" NOT NULL,
    "contentType" "ContentType" NOT NULL,
    "budget" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "creatorRatePer1000" INTEGER NOT NULL,

    CONSTRAINT "CampaignTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACCEPTED',
    "postUrl" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignReview" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE INDEX "Campaign_status_createdAt_idx" ON "Campaign"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_advertiserId_createdAt_idx" ON "Campaign"("advertiserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTask_campaignId_network_key" ON "CampaignTask"("campaignId", "network");

-- CreateIndex
CREATE INDEX "TaskAssignment_creatorId_acceptedAt_idx" ON "TaskAssignment"("creatorId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_creatorId_key" ON "TaskAssignment"("taskId", "creatorId");

-- CreateIndex
CREATE INDEX "CampaignReview_campaignId_createdAt_idx" ON "CampaignReview"("campaignId", "createdAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTask" ADD CONSTRAINT "CampaignTask_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CampaignTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignReview" ADD CONSTRAINT "CampaignReview_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
