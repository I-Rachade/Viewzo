-- Codes now go to a phone number or an email address.
ALTER TABLE "OtpChallenge" RENAME COLUMN "phone" TO "target";
ALTER INDEX "OtpChallenge_phone_createdAt_idx" RENAME TO "OtpChallenge_target_createdAt_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "phone" DROP NOT NULL;

-- Existing accounts signed up with an SMS code, so their number is verified.
UPDATE "User" SET "phoneVerifiedAt" = "createdAt" WHERE "phone" IS NOT NULL;

-- Every account keeps at least one way to sign in.
ALTER TABLE "User" ADD CONSTRAINT "User_phone_or_email" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
