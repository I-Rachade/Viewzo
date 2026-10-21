import { ContentType } from '@prisma/client';
import { ADVERTISER_PRICE_PER_1000, CONTENT_TYPES } from '../campaigns/pricing';

// Level 1 creators earn at most this much in total until verified.
export const LEVEL1_EARNINGS_CAP = 10_000;

// A post is paid, and billed to the advertiser, from this many validated views.
export const MIN_PAID_VIEWS = 500;

/** Validated views that count for money: none below the threshold. */
export function billableViews(views: number) {
  return views >= MIN_PAID_VIEWS ? views : 0;
}

/** What validated views cost the advertiser, taken from the escrow. */
export function advertiserCost(views: number, contentType: ContentType) {
  return Math.round(
    (views *
      ADVERTISER_PRICE_PER_1000 *
      CONTENT_TYPES[contentType].coefficient) /
      1000,
  );
}

/** Most views the remaining task budget can still pay for. */
export function payableViews(
  remainingBudget: number,
  contentType: ContentType,
) {
  const per1000 =
    ADVERTISER_PRICE_PER_1000 * CONTENT_TYPES[contentType].coefficient;
  return Math.max(0, Math.floor((remainingBudget * 1000) / per1000));
}

export function creatorEarning(views: number, ratePer1000: number) {
  return Math.floor((views * ratePer1000) / 1000);
}

/**
 * When an earning can be withdrawn: the month's earnings are paid the next
 * month (security hold), Certified creators (level 3) after 3 days.
 */
export function availableAt(creatorLevel: number, now = new Date()) {
  if (creatorLevel >= 3) return new Date(now.getTime() + 3 * 24 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
