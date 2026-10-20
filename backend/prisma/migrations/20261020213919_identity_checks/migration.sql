-- CreateEnum
CREATE TYPE "IdentityCheckStatus" AS ENUM ('STARTED', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'ABANDONED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'IDENTITY_REVIEWED';

-- CreateTable
CREATE TABLE "IdentityCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sessionId" TEXT,
    "url" TEXT,
    "status" "IdentityCheckStatus" NOT NULL DEFAULT 'STARTED',
    "providerStatus" TEXT,
    "fullName" TEXT,
    "dateOfBirth" TEXT,
    "documentType" TEXT,
    "documentCountry" TEXT,
    "documentNumberLast4" TEXT,
    "documentNumberHash" TEXT,
    "livenessScore" DOUBLE PRECISION,
    "faceMatchScore" DOUBLE PRECISION,
    "reason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityCheck_sessionId_key" ON "IdentityCheck"("sessionId");

-- CreateIndex
CREATE INDEX "IdentityCheck_userId_createdAt_idx" ON "IdentityCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityCheck_status_createdAt_idx" ON "IdentityCheck"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IdentityCheck_documentNumberHash_idx" ON "IdentityCheck"("documentNumberHash");

-- AddForeignKey
ALTER TABLE "IdentityCheck" ADD CONSTRAINT "IdentityCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
