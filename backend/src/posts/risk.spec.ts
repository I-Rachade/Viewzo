import { ProofKind, SocialNetwork, ViewSource } from '@prisma/client';
import { assessRisk, linkMatchesNetwork, RiskInput } from './risk';

const t0 = new Date('2026-10-19T18:00:00Z');
const at = (h: number) => new Date(t0.getTime() + h * 3600 * 1000);

const base = (over: Partial<RiskInput> = {}): RiskInput => ({
  network: SocialNetwork.WHATSAPP_STATUS,
  acceptedAt: at(-2),
  postUrl: null,
  snapshots: [],
  proofs: [
    {
      kind: ProofKind.SCREENSHOT,
      capturedAt: at(0),
      uploadedAt: at(0),
      declaredViews: 10,
    },
  ],
  audience: { followers: null, avgStatusViews: 1100 },
  duplicateImages: 0,
  sharedDeviceCreators: 0,
  history: { reviewed: 0, rejected: 0 },
  ...over,
});

const codes = (input: RiskInput) =>
  assessRisk(input).signals.map((s) => s.code);

describe('assessRisk', () => {
  it('finds nothing in a clean post', () => {
    const r = assessRisk(
      base({
        snapshots: [
          { views: 10, source: ViewSource.CREATOR, takenAt: at(0) },
          { views: 600, source: ViewSource.CREATOR, takenAt: at(12) },
          { views: 1000, source: ViewSource.CREATOR, takenAt: at(23) },
        ],
      }),
    );
    expect(r).toEqual({ score: 0, signals: [] });
  });

  it('flags a night jump and views above the account average', () => {
    const r = assessRisk(
      base({
        snapshots: [
          { views: 1000, source: ViewSource.CREATOR, takenAt: at(8) },
          { views: 2900, source: ViewSource.CREATOR, takenAt: at(9) },
        ],
      }),
    );
    expect(r.signals.map((s) => s.code)).toEqual(['SPIKE', 'ABOVE_AUDIENCE']);
    expect(r.score).toBe(70);
  });

  it('flags reused and undated screenshots', () => {
    expect(
      codes(
        base({
          duplicateImages: 1,
          proofs: [
            {
              kind: ProofKind.SCREENSHOT,
              capturedAt: at(-5),
              uploadedAt: at(0),
              declaredViews: 10,
            },
            {
              kind: ProofKind.SCREENSHOT,
              capturedAt: null,
              uploadedAt: at(12),
              declaredViews: 500,
            },
          ],
        }),
      ),
    ).toEqual([
      'DUPLICATE_IMAGE',
      'CAPTURED_BEFORE_ACCEPT',
      'MISSING_CAPTURE_TIME',
    ]);
  });

  it('flags a link from another network, shared phones and a bad history', () => {
    const r = assessRisk(
      base({
        network: SocialNetwork.TIKTOK,
        postUrl: 'https://www.instagram.com/p/abc',
        proofs: [],
        audience: { followers: 2000, avgStatusViews: null },
        sharedDeviceCreators: 2,
        history: { reviewed: 4, rejected: 2 },
      }),
    );
    expect(r.signals.map((s) => s.code)).toEqual([
      'LINK_MISMATCH',
      'SHARED_DEVICE',
      'HISTORY',
    ]);
    expect(r.score).toBe(65);
  });

  it('caps the score at 100', () => {
    const r = assessRisk(
      base({
        proofs: [],
        duplicateImages: 1,
        sharedDeviceCreators: 1,
        history: { reviewed: 3, rejected: 3 },
        snapshots: [
          { views: 0, source: ViewSource.CREATOR, takenAt: at(0) },
          { views: 5000, source: ViewSource.CREATOR, takenAt: at(1) },
          { views: 4000, source: ViewSource.CREATOR, takenAt: at(2) },
        ],
      }),
    );
    expect(r.score).toBe(100);
  });
});

describe('linkMatchesNetwork', () => {
  it('accepts sub-domains and short links', () => {
    expect(
      linkMatchesNetwork(SocialNetwork.TIKTOK, 'https://vm.tiktok.com/x'),
    ).toBe(true);
    expect(
      linkMatchesNetwork(SocialNetwork.YOUTUBE, 'https://youtu.be/x'),
    ).toBe(true);
    expect(linkMatchesNetwork(SocialNetwork.X, 'https://evil-x.com/x')).toBe(
      false,
    );
    expect(linkMatchesNetwork(SocialNetwork.FACEBOOK, 'pas un lien')).toBe(
      false,
    );
  });
});
