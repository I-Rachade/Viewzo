-- CreateEnum
CREATE TYPE "ContentCase" AS ENUM ('READY', 'PARTIAL', 'NONE');

-- CreateEnum
CREATE TYPE "CampaignFileKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'PDF');

-- CreateEnum
CREATE TYPE "CampaignFilePurpose" AS ENUM ('ASSET', 'BRIEF');

-- AlterTable: hasAssets becomes contentCase (ready content, or nothing).
ALTER TABLE "Campaign"
ADD COLUMN     "callToAction" TEXT,
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "contentCase" "ContentCase",
ADD COLUMN     "keyMessage" TEXT,
ADD COLUMN     "productDetails" TEXT,
ADD COLUMN     "sound" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

UPDATE "Campaign" SET "contentCase" = CASE WHEN "hasAssets" THEN 'READY'::"ContentCase" ELSE 'NONE'::"ContentCase" END;

ALTER TABLE "Campaign" ALTER COLUMN "contentCase" SET NOT NULL,
DROP COLUMN "hasAssets";

-- The team now only sees paid campaigns: unpaid ones wait for the payment.
UPDATE "Campaign" SET "status" = 'PENDING_PAYMENT' WHERE "status" = 'PENDING_REVIEW' AND "fundedAt" IS NULL;

-- CreateTable
CREATE TABLE "CampaignFile" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "campaignId" TEXT,
    "purpose" "CampaignFilePurpose" NOT NULL,
    "kind" "CampaignFileKind" NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFile_key_key" ON "CampaignFile"("key");

-- CreateIndex
CREATE INDEX "CampaignFile_ownerId_createdAt_idx" ON "CampaignFile"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignFile_campaignId_idx" ON "CampaignFile"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignFile" ADD CONSTRAINT "CampaignFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFile" ADD CONSTRAINT "CampaignFile_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
