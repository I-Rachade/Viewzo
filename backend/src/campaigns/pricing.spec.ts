import {
  estimatedViews,
  creatorRatePer1000,
  platformOptions,
  proposeAllocation,
} from './pricing';

describe('platformOptions', () => {
  it('greys out platforms beyond the package and the budget', () => {
    const { options, minBudget, overLimit } = platformOptions('PRO', 70_000, [
      'TIKTOK',
      'WHATSAPP_STATUS',
      'INSTAGRAM',
    ]);
    expect(minBudget).toBe(70_000);
    expect(overLimit).toEqual([]);
    const youtube = options.find((o) => o.network === 'YOUTUBE')!;
    expect(youtube.unavailable).toEqual({
      reason: 'PACKAGE',
      requiredPackage: 'PREMIUM',
    });
    expect(options.find((o) => o.network === 'TIKTOK')!.unavailable).toBeNull();
  });

  it('asks for more budget when the package still has room', () => {
    const { options } = platformOptions('PRO', 50_000, ['TIKTOK']);
    expect(options.find((o) => o.network === 'LINKEDIN')!.unavailable).toEqual({
      reason: 'BUDGET',
      missingAmount: 25_000,
    });
    expect(
      options.find((o) => o.network === 'FACEBOOK')!.unavailable,
    ).toBeNull();
  });

  it('drops the last platforms added when the budget goes down', () => {
    const { overLimit, minBudget } = platformOptions('PRO', 45_000, [
      'TIKTOK',
      'FACEBOOK',
      'INSTAGRAM',
    ]);
    expect(overLimit).toEqual(['INSTAGRAM']);
    expect(minBudget).toBe(45_000);
  });

  it('allows a single platform with Basique', () => {
    const { options, overLimit } = platformOptions('BASIC', 100_000, [
      'TIKTOK',
      'FACEBOOK',
    ]);
    expect(overLimit).toEqual(['FACEBOOK']);
    expect(options.find((o) => o.network === 'FACEBOOK')!.unavailable).toEqual({
      reason: 'PACKAGE',
      requiredPackage: 'PRO',
    });
  });
});

describe('pricing', () => {
  it('splits the budget in proportion to the minimums', () => {
    expect(
      proposeAllocation(70_001, ['TIKTOK', 'WHATSAPP_STATUS', 'INSTAGRAM']),
    ).toEqual([
      { network: 'TIKTOK', budget: 25_001 },
      { network: 'WHATSAPP_STATUS', budget: 20_000 },
      { network: 'INSTAGRAM', budget: 25_000 },
    ]);
  });

  it('applies the content type coefficient', () => {
    expect(estimatedViews(70_000, 'PROVIDED_ASSETS')).toBe(70_000);
    expect(estimatedViews(26_000, 'FACECAM')).toBe(20_000);
    expect(creatorRatePer1000('PROVIDED_ASSETS')).toBe(450);
    expect(creatorRatePer1000('FULL_EDITING')).toBe(720);
  });
});
