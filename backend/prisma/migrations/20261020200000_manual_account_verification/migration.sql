-- CreateEnum
CREATE TYPE "FollowersSource" AS ENUM ('CREATOR', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AutoRejection" AS ENUM ('NOT_FOUND', 'ANONYMOUS');

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "autoCheckedAt" TIMESTAMP(3),
ADD COLUMN     "autoRejection" "AutoRejection",
ADD COLUMN     "declaredFollowers" INTEGER,
ADD COLUMN     "followersSource" "FollowersSource",
ADD COLUMN     "handleKey" TEXT,
ADD COLUMN     "notAnonymousConfirmedAt" TIMESTAMP(3);

-- Existing accounts: counts so far were entered by the team.
UPDATE "SocialAccount" SET "followersSource" = 'ADMIN'
WHERE "followers" IS NOT NULL OR "avgStatusViews" IS NOT NULL;

-- Same rule as parseHandle for the usual forms (@name, profile links, phone).
UPDATE "SocialAccount" SET "handleKey" = CASE
  WHEN "network" = 'WHATSAPP_STATUS' THEN regexp_replace("handle", '\D', '', 'g')
  ELSE lower(regexp_replace(
    regexp_replace(trim("handle"), '^(https?://)?[^/]*\.[a-z]+/((in|add|c|user|channel|company|s)/)?', '', 'i'),
    '^@|[/?#].*$', '', 'g'))
END;

-- Two creators may already hold the same account: keep the oldest as is and
-- set the others apart, the team sorts them out in the back-office.
UPDATE "SocialAccount" a SET "handleKey" = a."handleKey" || '#' || a."id"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "network", "handleKey" ORDER BY "createdAt") AS n
  FROM "SocialAccount"
) d
WHERE d."id" = a."id" AND d.n > 1;

ALTER TABLE "SocialAccount" ALTER COLUMN "handleKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_network_handleKey_key" ON "SocialAccount"("network", "handleKey");
