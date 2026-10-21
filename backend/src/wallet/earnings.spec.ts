import {
  advertiserCost,
  availableAt,
  billableViews,
  creatorEarning,
  payableViews,
} from './earnings';

describe('earnings', () => {
  it('prices views with the content type coefficient', () => {
    expect(advertiserCost(10_000, 'PROVIDED_ASSETS')).toBe(10_000);
    expect(advertiserCost(10_000, 'FULL_EDITING')).toBe(16_000);
    expect(payableViews(16_000, 'FULL_EDITING')).toBe(10_000);
    expect(payableViews(-5, 'FACECAM')).toBe(0);
    expect(creatorEarning(12_345, 450)).toBe(5_555);
  });

  it('pays nothing below 500 validated views, everything from there', () => {
    expect(billableViews(499)).toBe(0);
    expect(billableViews(500)).toBe(500);
    expect(billableViews(12_000)).toBe(12_000);
  });

  it('holds earnings until next month, 3 days for certified creators', () => {
    const now = new Date('2026-12-15T10:00:00Z');
    expect(availableAt(1, now)).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(availableAt(2, now)).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(availableAt(3, now)).toEqual(new Date('2026-12-18T10:00:00Z'));
  });
});
