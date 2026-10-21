import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  PostProof,
  PostReviewStatus,
  Prisma,
  ProofKind,
  SocialNetwork,
  TaskAssignment,
  TransactionStatus,
  TransactionType,
  ViewSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CAPTURE_WINDOW, capturePlan } from './captures';
import { ProofStorage, UploadedImage } from './proof-storage';
import { assessRisk } from './risk';

const HOUR = 3600 * 1000;

// When a WhatsApp Statut needs a screenshot, counted from the first one.
// A statut disappears after 24 h, so the last one comes just before.
export const STATUS_PROOF_STEPS = [
  { label: 'Au départ', at: 0, from: -Infinity, to: 11 },
  { label: 'Après 12 h', at: 12, from: 11, to: 20 },
  { label: 'Avant 24 h', at: 23, from: 20, to: 25 },
] as const;

/** Where the creator is in the screenshot schedule of a statut. */
export function proofPlan(
  screenshots: { uploadedAt: Date }[],
  now = new Date(),
) {
  const times = screenshots
    .map((p) => p.uploadedAt.getTime())
    .sort((a, b) => a - b);
  const t0 = times[0];
  if (t0 === undefined) {
    return {
      steps: STATUS_PROOF_STEPS.map((s) => ({
        label: s.label,
        dueAt: null,
        doneAt: null,
      })),
      nextDueAt: now,
    };
  }
  const steps = STATUS_PROOF_STEPS.map((step) => {
    const done = times.find((t) => {
      const h = (t - t0) / HOUR;
      return h >= step.from && h < step.to;
    });
    return {
      label: step.label,
      dueAt: new Date(t0 + step.at * HOUR),
      doneAt: done === undefined ? null : new Date(done),
      closesAt: t0 + step.to * HOUR,
    };
  });
  // The next step still open: not done and its window not closed yet.
  const next = steps.find((s) => !s.doneAt && now.getTime() < s.closesAt);
  return {
    steps: steps.map((s) => ({
      label: s.label,
      dueAt: s.dueAt,
      doneAt: s.doneAt,
    })),
    nextDueAt: next?.dueAt ?? null,
  };
}

export const MAX_PROOFS_PER_POST = 20;

export interface ProofSource {
  deviceId?: string;
  ip?: string;
}

// Proofs a creator sends, and the risk score kept up to date with them.
@Injectable()
export class ProofsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProofStorage,
  ) {}

  async addScreenshot(
    creatorId: string,
    assignmentId: string,
    file: UploadedImage | undefined,
    input: { declaredViews: number; capturedAt?: string },
    source: ProofSource,
  ) {
    const assignment = await this.owned(creatorId, assignmentId);
    await this.assertRoom(this.prisma, assignmentId);
    const saved = await this.storage.save(file);
    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : null;
    if (capturedAt && capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException('Date de capture dans le futur');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const proof = await tx.postProof.create({
        data: {
          assignmentId,
          kind: ProofKind.SCREENSHOT,
          fileKey: saved.key,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          sha256: saved.sha256,
          capturedAt,
          declaredViews: input.declaredViews,
          deviceId: source.deviceId,
          ip: source.ip,
        },
      });
      await tx.viewSnapshot.create({
        data: {
          assignmentId,
          views: input.declaredViews,
          source: ViewSource.CREATOR,
          proofId: proof.id,
        },
      });
      await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.SUBMITTED,
          submittedAt: assignment.submittedAt ?? now,
          ...this.backToReview(assignment),
        },
      });
    });
    await this.refreshRisk(assignmentId);
    // The same image on other posts makes those suspicious too.
    const others = await this.prisma.postProof.findMany({
      where: { sha256: saved.sha256, assignmentId: { not: assignmentId } },
      select: { assignmentId: true },
      distinct: ['assignmentId'],
      take: 20,
    });
    for (const o of others) await this.refreshRisk(o.assignmentId);
  }

  /** The post link, sent with "J'ai publié". */
  async addLink(
    tx: Prisma.TransactionClient,
    assignment: TaskAssignment,
    url: string,
    source: ProofSource,
  ) {
    await this.assertRoom(tx, assignment.id);
    await tx.postProof.create({
      data: {
        assignmentId: assignment.id,
        kind: ProofKind.LINK,
        url,
        deviceId: source.deviceId,
        ip: source.ip,
      },
    });
    return this.backToReview(assignment);
  }

  // Enough for a full WhatsApp schedule plus corrections; stops disk filling.
  private async assertRoom(
    db: Prisma.TransactionClient | PrismaService,
    assignmentId: string,
  ) {
    const count = await db.postProof.count({ where: { assignmentId } });
    if (count >= MAX_PROOFS_PER_POST) {
      throw new BadRequestException(
        'Trop de preuves pour cette publication, contacte le support',
      );
    }
  }

  /** Throws when the team refused the post: nothing more can be sent. */
  assertOpen(assignment: TaskAssignment) {
    if (assignment.reviewStatus === PostReviewStatus.REJECTED) {
      throw new ForbiddenException('Publication refusée, envoi impossible');
    }
  }

  // A new proof after "À corriger" puts the post back in the review queue.
  private backToReview(assignment: TaskAssignment) {
    return assignment.reviewStatus === PostReviewStatus.NEEDS_FIX
      ? { reviewStatus: PostReviewStatus.TO_REVIEW, reviewReason: null }
      : {};
  }

  /** Proofs and progress as the creator's app shows them. */
  creatorView(
    network: SocialNetwork,
    proofs: PostProof[],
    snapshots: { views: number; takenAt: Date }[],
    submittedAt: Date | null = null,
  ) {
    const screenshots = proofs.filter((p) => p.kind === ProofKind.SCREENSHOT);
    const latest = [...snapshots].sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    )[0];
    return {
      proofs: proofs.map((p) => this.proofView(p)),
      declaredViews: latest?.views ?? null,
      proofPlan:
        network === SocialNetwork.WHATSAPP_STATUS
          ? proofPlan(screenshots)
          : null,
      // Dated screenshots (H+1 to J+30) for every other network.
      capturePlan:
        network === SocialNetwork.WHATSAPP_STATUS
          ? null
          : capturePlan(submittedAt, screenshots),
    };
  }

  proofView(p: PostProof) {
    return {
      id: p.id,
      kind: p.kind,
      url: p.url,
      fileUrl: p.fileKey ? this.storage.signedUrl(p.id) : null,
      capturedAt: p.capturedAt,
      declaredViews: p.declaredViews,
      uploadedAt: p.uploadedAt,
    };
  }

  /** Recomputes and stores the risk score; returns the signals too. */
  async refreshRisk(assignmentId: string) {
    const a = await this.prisma.taskAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: {
        task: true,
        proofs: true,
        snapshots: true,
      },
    });
    const hashes = a.proofs
      .map((p) => p.sha256)
      .filter((h): h is string => !!h);
    const devices = a.proofs
      .map((p) => p.deviceId)
      .filter((d): d is string => !!d);
    const ips = a.proofs.map((p) => p.ip).filter((d): d is string => !!d);
    const [duplicateImages, shared, account, reviewed, rejected] =
      await Promise.all([
        hashes.length
          ? this.prisma.postProof.count({
              where: { sha256: { in: hashes }, assignmentId: { not: a.id } },
            })
          : 0,
        devices.length || ips.length
          ? this.prisma.postProof.findMany({
              where: {
                OR: [
                  ...(devices.length ? [{ deviceId: { in: devices } }] : []),
                  ...(ips.length ? [{ ip: { in: ips } }] : []),
                ],
                assignment: { creatorId: { not: a.creatorId } },
              },
              select: { assignment: { select: { creatorId: true } } },
              distinct: ['assignmentId'],
              take: 200,
            })
          : [],
        this.prisma.socialAccount.findUnique({
          where: {
            userId_network: { userId: a.creatorId, network: a.task.network },
          },
          select: { followers: true, avgStatusViews: true },
        }),
        this.prisma.taskAssignment.count({
          where: {
            creatorId: a.creatorId,
            id: { not: a.id },
            reviewStatus: {
              in: [PostReviewStatus.VALIDATED, PostReviewStatus.REJECTED],
            },
          },
        }),
        this.prisma.taskAssignment.count({
          where: {
            creatorId: a.creatorId,
            id: { not: a.id },
            reviewStatus: PostReviewStatus.REJECTED,
          },
        }),
      ]);
    const sharedCreators = new Set(shared.map((s) => s.assignment.creatorId));
    const result = assessRisk({
      network: a.task.network,
      acceptedAt: a.acceptedAt,
      postUrl: a.postUrl,
      snapshots: a.snapshots,
      proofs: a.proofs,
      audience: account,
      duplicateImages,
      sharedDeviceCreators: sharedCreators.size,
      history: { reviewed, rejected },
    });
    if (result.score !== a.riskScore) {
      await this.prisma.taskAssignment.update({
        where: { id: a.id },
        data: { riskScore: result.score },
      });
    }
    return { ...result, sharedCreatorIds: [...sharedCreators] };
  }

  /** "Mes résultats": what was validated, earned and why something was refused. */
  async results(creatorId: string) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [counts, totals, month] = await Promise.all([
      this.prisma.taskAssignment.groupBy({
        by: ['reviewStatus'],
        where: { creatorId, status: AssignmentStatus.SUBMITTED },
        _count: true,
      }),
      this.prisma.taskAssignment.aggregate({
        where: { creatorId },
        _sum: { validViews: true, earned: true },
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId: creatorId,
          type: TransactionType.EARNING,
          status: TransactionStatus.COMPLETED,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
    ]);
    const by = (s: PostReviewStatus) =>
      counts.find((c) => c.reviewStatus === s)?._count ?? 0;
    const validated = by(PostReviewStatus.VALIDATED);
    const rejected = by(PostReviewStatus.REJECTED);
    return {
      validViews: totals._sum.validViews ?? 0,
      earned: totals._sum.earned ?? 0,
      earnedThisMonth: month._sum.amount ?? 0,
      toReview: by(PostReviewStatus.TO_REVIEW),
      needsFix: by(PostReviewStatus.NEEDS_FIX),
      validated,
      rejected,
      validationRate:
        validated + rejected
          ? Math.round((validated / (validated + rejected)) * 100)
          : null,
    };
  }

  private async owned(creatorId: string, id: string) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id },
      include: { task: { include: { campaign: true } } },
    });
    if (!assignment || assignment.creatorId !== creatorId) {
      throw new NotFoundException();
    }
    this.assertOpen(assignment);
    // Proofs of a statut can still come in up to a day after the campaign,
    // the dated screenshots of a post until its J+30 step closes.
    const grace =
      assignment.task.network === SocialNetwork.WHATSAPP_STATUS ? 26 * HOUR : 0;
    const datedUntil =
      assignment.submittedAt && !grace
        ? assignment.submittedAt.getTime() + CAPTURE_WINDOW
        : 0;
    if (
      Math.max(assignment.task.campaign.endsAt.getTime() + grace, datedUntil) <=
      Date.now()
    ) {
      throw new BadRequestException('Échéance dépassée');
    }
    return assignment;
  }
}
