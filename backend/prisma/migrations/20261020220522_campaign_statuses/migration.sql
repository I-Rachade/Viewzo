-- New values on their own: PostgreSQL can't use a new enum value in the
-- transaction that adds it.
ALTER TYPE "CampaignStatus" ADD VALUE 'DRAFT';
ALTER TYPE "CampaignStatus" ADD VALUE 'PENDING_PAYMENT';
ALTER TYPE "CampaignStatus" ADD VALUE 'PAUSED';
