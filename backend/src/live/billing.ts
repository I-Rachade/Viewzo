// Money and rules of live selling by creators. Prices per country live in
// LiveRate (back-office); these defaults apply to countries without a row.

export interface LiveRates {
  // What 100 viewers at the peak of a creator's live cost the advertiser.
  advertiserPer100: number;
  // What the creator earns for them; the difference is Viewzo's margin.
  creatorPer100: number;
  // Service fee of an advertiser's own live.
  selfFee: number;
}

// Same margin as campaigns (1,000 FCFA billed, 450 FCFA earned).
export const DEFAULT_LIVE_RATES: LiveRates = {
  advertiserPer100: 1_000,
  creatorPer100: 450,
  selfFee: 2_000,
};

// A creator's live shorter than this is not paid.
export const MIN_PAID_MINUTES = 15;
// TikTok followers a creator needs to accept a live.
export const MIN_LIVE_FOLLOWERS = 1_000;
// After a withdrawal the creator accepts no live for this long.
export const WITHDRAW_BLOCK_DAYS = 10;
// Withdrawals in a row that ban the creator from lives.
export const BAN_AFTER_WITHDRAWALS = 3;
// Creators may start this long before the offer's period opens.
export const EARLY_START_MS = 30 * 60 * 1000;

/** What the advertiser can pay one creator: an equal share of the budget. */
export function slotCap(budget: number, slots: number) {
  return slots > 0 ? Math.floor(budget / slots) : 0;
}

/**
 * Pay of one creator's live: per started 100 viewers at the peak, nothing
 * under the minimum duration, never more than the slot's share of the budget.
 */
export function livePayout(input: {
  peakViewers: number;
  minutes: number;
  rates: LiveRates;
  cap: number;
}) {
  const { peakViewers, minutes, rates, cap } = input;
  if (minutes < MIN_PAID_MINUTES || peakViewers < 100) {
    return { cost: 0, earned: 0 };
  }
  const hundreds = Math.floor(peakViewers / 100);
  const cost = Math.min(hundreds * rates.advertiserPer100, Math.max(0, cap));
  // The creator keeps the same share of what is billed.
  const earned = Math.floor(
    (cost * rates.creatorPer100) / rates.advertiserPer100,
  );
  return { cost, earned };
}

/** A jump between two viewer counts that bought views would explain. */
export function isViewerSpike(previous: number, next: number) {
  return next - previous >= 500 && next > previous * 4;
}

/** Why an audience needs the team before the creator is paid, if it does. */
export function audienceFlag(input: {
  peakViewers: number;
  followers: number | null;
  spike: boolean;
}) {
  const reasons: string[] = [];
  if (input.spike) reasons.push('Hausse brutale de spectateurs');
  if (input.followers != null && input.peakViewers > input.followers) {
    reasons.push('Plus de spectateurs que d’abonnés');
  }
  return reasons.length ? reasons.join(' · ') : null;
}

/** Link that opens a WhatsApp chat with the shop, the buyer's code typed in. */
export function whatsappLink(whatsapp: string, code: string) {
  const digits = whatsapp.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(code)}`;
}

/** Line added to the answer read out in the live. */
export function contactLine(whatsapp: string, code: string) {
  return `Écris ${code} à la boutique sur WhatsApp : wa.me/${whatsapp.replace(/\D/g, '')}`;
}
