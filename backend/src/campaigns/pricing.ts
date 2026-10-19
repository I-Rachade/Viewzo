import {
  CampaignPackage,
  ContentType,
  CreatorSpecialty,
  SocialNetwork,
} from '@prisma/client';

// Defaults from the specification (FCFA, West Africa). They become settings
// per country in the back-office later.
export const PACKAGE_ORDER: CampaignPackage[] = [
  CampaignPackage.BASIC,
  CampaignPackage.PRO,
  CampaignPackage.PREMIUM,
  CampaignPackage.ELITE,
];

export const MAX_PLATFORMS: Record<CampaignPackage, number> = {
  BASIC: 1,
  PRO: 3,
  PREMIUM: 6,
  ELITE: Object.keys(SocialNetwork).length,
};

export const MIN_BUDGET: Record<SocialNetwork, number> = {
  LINKEDIN: 50_000,
  YOUTUBE: 40_000,
  TIKTOK: 25_000,
  INSTAGRAM: 25_000,
  FACEBOOK: 20_000,
  WHATSAPP_STATUS: 20_000,
  SNAPCHAT: 20_000,
  X: 20_000,
  THREADS: 20_000,
  TELEGRAM: 15_000,
};

// Price the advertiser pays and what the creator earns, per 1,000 views,
// before the content type coefficient.
export const ADVERTISER_PRICE_PER_1000 = 1_000;
export const CREATOR_RATE_PER_1000 = 450;

interface ContentRule {
  coefficient: number;
  // Specialties of which the creator needs at least one; empty = any creator
  // making original videos; null = posts the provided assets as they are.
  specialties: CreatorSpecialty[] | null;
}

export const CONTENT_TYPES: Record<ContentType, ContentRule> = {
  PROVIDED_ASSETS: { coefficient: 1, specialties: null },
  VIDEO_WITH_POSTERS: { coefficient: 1.2, specialties: [] },
  FACECAM: { coefficient: 1.3, specialties: [CreatorSpecialty.FACECAM] },
  VLOG_DEMO_UNBOXING: {
    coefficient: 1.4,
    specialties: [
      CreatorSpecialty.VLOG,
      CreatorSpecialty.PRODUCT_DEMO,
      CreatorSpecialty.UNBOXING,
    ],
  },
  FULL_EDITING: {
    coefficient: 1.6,
    specialties: [CreatorSpecialty.FULL_EDITING],
  },
  MOTION_DESIGN: {
    coefficient: 1.6,
    specialties: [CreatorSpecialty.MOTION_DESIGN],
  },
  FREE_BRIEF: { coefficient: 1.3, specialties: [] },
};

export function creatorRatePer1000(contentType: ContentType) {
  return Math.round(
    CREATOR_RATE_PER_1000 * CONTENT_TYPES[contentType].coefficient,
  );
}

export function estimatedViews(budget: number, contentType: ContentType) {
  const price =
    ADVERTISER_PRICE_PER_1000 * CONTENT_TYPES[contentType].coefficient;
  return Math.floor((budget / price) * 1000);
}

export type Unavailable =
  | { reason: 'PACKAGE'; requiredPackage: CampaignPackage }
  | { reason: 'BUDGET'; missingAmount: number };

export interface PlatformOption {
  network: SocialNetwork;
  minBudget: number;
  selected: boolean;
  // Why the platform is greyed out; null when it can be used.
  unavailable: Unavailable | null;
}

/**
 * Which platforms the advertiser can pick for a package and budget, with the
 * reason the others are greyed out. `selected` is in the order platforms were
 * added: when the budget drops, the last ones added stop fitting first.
 */
export function platformOptions(
  pkg: CampaignPackage,
  budget: number,
  selected: SocialNetwork[],
) {
  const max = MAX_PLATFORMS[pkg];
  const fitting: SocialNetwork[] = [];
  let used = 0;
  for (const network of selected) {
    if (fitting.length < max && used + MIN_BUDGET[network] <= budget) {
      fitting.push(network);
      used += MIN_BUDGET[network];
    }
  }

  const options: PlatformOption[] = Object.values(SocialNetwork).map(
    (network) => {
      const isSelected = selected.includes(network);
      if (isSelected && fitting.includes(network)) {
        return {
          network,
          minBudget: MIN_BUDGET[network],
          selected: true,
          unavailable: null,
        };
      }
      const count = fitting.length + 1;
      let unavailable: Unavailable | null = null;
      if (count > max) {
        unavailable = {
          reason: 'PACKAGE',
          requiredPackage: PACKAGE_ORDER.find(
            (p) => MAX_PLATFORMS[p] >= count,
          )!,
        };
      } else if (used + MIN_BUDGET[network] > budget) {
        unavailable = {
          reason: 'BUDGET',
          missingAmount: used + MIN_BUDGET[network] - budget,
        };
      }
      return {
        network,
        minBudget: MIN_BUDGET[network],
        selected: isSelected,
        unavailable,
      };
    },
  );

  return {
    options,
    minBudget: used,
    // Selected platforms that no longer fit the package or budget.
    overLimit: selected.filter((n) => !fitting.includes(n)),
  };
}

/** Automatic split of the budget, in proportion to each platform's minimum. */
export function proposeAllocation(budget: number, selected: SocialNetwork[]) {
  const total = selected.reduce((sum, n) => sum + MIN_BUDGET[n], 0);
  const allocation = selected.map((n) =>
    Math.floor((budget * MIN_BUDGET[n]) / total),
  );
  // Rounding leftovers go to the first platform.
  allocation[0] += budget - allocation.reduce((a, b) => a + b, 0);
  return selected.map((network, i) => ({ network, budget: allocation[i] }));
}
