import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
  PostReviewStatus,
  ProofKind,
  ViewSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProofStorage } from './proof-storage';

const DAY = 24 * 3600 * 1000;

/**
 * Validated views per day, cumulated: for each day, the last validated
 * count of every post at the end of that day.
 */
export function dailyValidated(
  readings: { assignmentId: string; views: number; takenAt: Date }[],
  from: Date,
  to: Date,
) {
  const sorted = [...readings].sort(
    (a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
  );
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const days: { date: string; views: number }[] = [];
  const last = new Map<string, number>();
  let i = 0;
  for (let t = start; t <= to.getTime() && days.length < 120; t += DAY) {
    const end = t + DAY;
    while (i < sorted.length && sorted[i].takenAt.getTime() < end) {
      last.set(sorted[i].assignmentId, sorted[i].views);
      i++;
    }
    let total = 0;
    for (const v of last.values()) total += v;
    days.push({ date: new Date(t).toISOString().slice(0, 10), views: total });
  }
  return days;
}

// The advertiser's live report: what was validated, where, and the proof.
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProofStorage,
  ) {}

  async campaign(advertiserId: string, campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) {
      throw new NotFoundException();
    }
    const posts = await this.prisma.taskAssignment.findMany({
      where: {
        task: { campaignId },
        status: AssignmentStatus.SUBMITTED,
      },
      include: {
        task: { select: { network: true } },
        creator: {
          select: {
            country: true,
            accounts: { select: { network: true, handle: true } },
          },
        },
        proofs: {
          where: { kind: ProofKind.SCREENSHOT },
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
        snapshots: { orderBy: { takenAt: 'desc' }, take: 1 },
      },
    });
    const readings = await this.prisma.viewSnapshot.findMany({
      where: {
        source: ViewSource.STAFF,
        assignment: { task: { campaignId } },
      },
      select: { assignmentId: true, views: true, takenAt: true },
    });

    const validated = posts.filter(
      (p) => p.reviewStatus === PostReviewStatus.VALIDATED,
    );
    const verifiedViews = posts.reduce((s, p) => s + p.validViews, 0);
    // Views creators reported that are not billed: not validated yet,
    // refused, or beyond the budget.
    const declared = posts.reduce(
      (s, p) => s + Math.max(p.snapshots[0]?.views ?? 0, p.validViews),
      0,
    );
    const group = (key: (p: (typeof posts)[number]) => string) => {
      const m = new Map<string, { views: number; posts: number }>();
      for (const p of posts) {
        if (!p.validViews) continue;
        const k = key(p);
        const cur = m.get(k) ?? { views: 0, posts: 0 };
        m.set(k, { views: cur.views + p.validViews, posts: cur.posts + 1 });
      }
      return [...m.entries()]
        .map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => b.views - a.views);
    };
    const end = new Date(
      Math.min(Date.now(), campaign.endsAt.getTime() + 7 * DAY),
    );

    return {
      id: campaign.id,
      code: campaign.code,
      title: campaign.title,
      status: campaign.status,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      budget: campaign.budget,
      spent: campaign.spent,
      // Final report: when the campaign closed and what went back to the wallet.
      completedAt: campaign.completedAt,
      refunded: campaign.refunded,
      verifiedViews,
      unbilledViews: Math.max(0, declared - verifiedViews),
      costPer1000: verifiedViews
        ? Math.round((campaign.spent * 1000) / verifiedViews)
        : null,
      posts: {
        total: posts.length,
        validated: validated.length,
        toReview: posts.filter(
          (p) =>
            p.reviewStatus === PostReviewStatus.TO_REVIEW ||
            p.reviewStatus === PostReviewStatus.NEEDS_FIX,
        ).length,
        rejected: posts.filter(
          (p) => p.reviewStatus === PostReviewStatus.REJECTED,
        ).length,
      },
      byNetwork: group((p) => p.task.network).map(({ key, ...v }) => ({
        network: key,
        ...v,
      })),
      byCountry: group((p) => p.creator.country).map(({ key, ...v }) => ({
        country: key,
        ...v,
      })),
      daily: dailyValidated(readings, campaign.startsAt, end),
      // Only validated posts are shown, with their latest screenshot.
      gallery: validated
        .sort((a, b) => b.validViews - a.validViews)
        .map((p) => ({
          id: p.id,
          network: p.task.network,
          country: p.creator.country,
          handle:
            p.creator.accounts.find((a) => a.network === p.task.network)
              ?.handle ?? null,
          postUrl: p.postUrl,
          views: p.validViews,
          imageUrl: p.proofs[0] ? this.storage.signedUrl(p.proofs[0].id) : null,
          submittedAt: p.submittedAt,
        })),
    };
  }
}
