-- CreateEnum
CREATE TYPE "LiveSaleStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiveLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'PAID', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PlatformModule" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformModule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "LiveProduct" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSale" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tiktokUsername" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "LiveSaleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "viewers" INTEGER,
    "sourceState" TEXT,
    "sourceMessage" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveLead" (
    "id" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tiktokUser" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "total" INTEGER,
    "reply" TEXT,
    "status" "LiveLeadStatus" NOT NULL DEFAULT 'NEW',
    "phoneSeen" BOOLEAN NOT NULL DEFAULT false,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveComment" (
    "id" TEXT NOT NULL,
    "liveId" TEXT NOT NULL,
    "leadId" TEXT,
    "externalId" TEXT NOT NULL,
    "tiktokUser" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "intent" TEXT,
    "by" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveProduct_sellerId_createdAt_idx" ON "LiveProduct"("sellerId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveSale_sellerId_scheduledAt_idx" ON "LiveSale"("sellerId", "scheduledAt");

-- CreateIndex
CREATE INDEX "LiveSale_status_scheduledAt_idx" ON "LiveSale"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveLead_code_key" ON "LiveLead"("code");

-- CreateIndex
CREATE INDEX "LiveLead_liveId_lastAt_idx" ON "LiveLead"("liveId", "lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveLead_liveId_tiktokUser_key" ON "LiveLead"("liveId", "tiktokUser");

-- CreateIndex
CREATE INDEX "LiveComment_liveId_at_idx" ON "LiveComment"("liveId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LiveComment_liveId_externalId_key" ON "LiveComment"("liveId", "externalId");

-- AddForeignKey
ALTER TABLE "LiveProduct" ADD CONSTRAINT "LiveProduct_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSale" ADD CONSTRAINT "LiveSale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveLead" ADD CONSTRAINT "LiveLead_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveComment" ADD CONSTRAINT "LiveComment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LiveLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
