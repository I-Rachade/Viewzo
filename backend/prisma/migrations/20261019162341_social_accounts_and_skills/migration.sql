-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'STAFF');

-- CreateEnum
CREATE TYPE "SocialNetwork" AS ENUM ('TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'SNAPCHAT', 'X', 'LINKEDIN', 'THREADS', 'TELEGRAM', 'WHATSAPP_STATUS');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'NEEDS_FIX', 'NOT_ELIGIBLE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CreatorTaskType" AS ENUM ('POST_PROVIDED_VISUAL', 'POST_PROVIDED_VIDEO', 'CREATE_ORIGINAL_VIDEO');

-- CreateEnum
CREATE TYPE "CreatorSpecialty" AS ENUM ('FACECAM', 'VLOG', 'PRODUCT_DEMO', 'UNBOXING', 'TUTORIAL', 'DANCE_CHALLENGE', 'HUMOR_SKETCH', 'STREET_INTERVIEW', 'FULL_EDITING', 'MOTION_DESIGN', 'VOICE_OVER', 'PRODUCT_PHOTO');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "network" "SocialNetwork" NOT NULL,
    "handle" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "retryAfter" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followers" INTEGER,
    "avgStatusViews" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountReview" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "userId" TEXT NOT NULL,
    "network" "SocialNetwork" NOT NULL,
    "reviewerId" TEXT,
    "status" "AccountStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorSkills" (
    "userId" TEXT NOT NULL,
    "taskTypes" "CreatorTaskType"[],
    "specialties" "CreatorSpecialty"[],
    "showsFace" BOOLEAN NOT NULL,
    "phoneModel" TEXT,
    "microphone" TEXT,
    "lighting" TEXT,
    "editingSoftware" TEXT,
    "exampleLinks" TEXT[],
    "languages" TEXT[],
    "countries" TEXT[],
    "cities" TEXT[],
    "themes" TEXT[],
    "tasksPerWeek" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSkills_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_verificationCode_key" ON "SocialAccount"("verificationCode");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_network_key" ON "SocialAccount"("userId", "network");

-- CreateIndex
CREATE INDEX "AccountReview_accountId_createdAt_idx" ON "AccountReview"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountReview_userId_createdAt_idx" ON "AccountReview"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountReview" ADD CONSTRAINT "AccountReview_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSkills" ADD CONSTRAINT "CreatorSkills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
