import {
  audienceFlag,
  contactLine,
  DEFAULT_LIVE_RATES,
  isViewerSpike,
  livePayout,
  slotCap,
  whatsappLink,
} from './billing';

describe('live billing', () => {
  const rates = DEFAULT_LIVE_RATES;

  it('pays per started 100 viewers at the peak', () => {
    expect(
      livePayout({ peakViewers: 350, minutes: 40, rates, cap: 100_000 }),
    ).toEqual({ cost: 3_000, earned: 1_350 });
  });

  it('pays nothing for a short live or a tiny audience', () => {
    expect(
      livePayout({ peakViewers: 900, minutes: 10, rates, cap: 100_000 }),
    ).toEqual({ cost: 0, earned: 0 });
    expect(
      livePayout({ peakViewers: 99, minutes: 60, rates, cap: 100_000 }),
    ).toEqual({ cost: 0, earned: 0 });
  });

  it('never bills more than the slot share of the budget', () => {
    const cap = slotCap(10_000, 3);
    expect(cap).toBe(3_333);
    expect(livePayout({ peakViewers: 5_000, minutes: 60, rates, cap })).toEqual(
      { cost: 3_333, earned: 1_499 },
    );
  });

  it('flags sudden jumps and audiences above the followers', () => {
    expect(isViewerSpike(100, 900)).toBe(true);
    expect(isViewerSpike(400, 900)).toBe(false);
    expect(isViewerSpike(0, 300)).toBe(false);
    expect(
      audienceFlag({ peakViewers: 2_000, followers: 1_500, spike: false }),
    ).toBe('Plus de spectateurs que d’abonnés');
    expect(
      audienceFlag({ peakViewers: 200, followers: 1_500, spike: false }),
    ).toBeNull();
  });

  it('builds the WhatsApp link and line for the buyer', () => {
    expect(whatsappLink('+228 90 00 00 01', 'VZAB12')).toBe(
      'https://wa.me/22890000001?text=VZAB12',
    );
    expect(contactLine('+22890000001', 'VZAB12')).toBe(
      'Écris VZAB12 à la boutique sur WhatsApp : wa.me/22890000001',
    );
  });
});
