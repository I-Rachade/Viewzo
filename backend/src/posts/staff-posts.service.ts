import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AssignmentStatus,
  NotificationType,
  PaymentKind,
  PostReviewAction,
  PostReviewStatus,
  Prisma,
  ProfileType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { creatorEarning } from '../wallet/earnings';
import { WalletService } from '../wallet/wallet.service';
import { PostFiltersDto } from './dto/post-filters.dto';
import { ReviewPostDto } from './dto/review-post.dto';
import { ProofsService } from './proofs.service';

const CONTACT = { id: true, phone: true, email: true, country: true } as const;

// Back-office: every published post, its full file and the decisions on it.
@Injectable()
export class StaffPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proofs: ProofsService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: StaffActor, f: PostFiltersDto) {
    const status = f.status ?? PostReviewStatus.TO_REVIEW;
    const q = f.q?.trim().replace(/^#/, '');
    const scope = countryScope(actor);
    const inScope: Prisma.TaskAssignmentWhereInput = scope
      ? { creator: { country: { in: scope } } }
      : {};
    const where: Prisma.TaskAssignmentWhereInput = {
      AND: [inScope],
      status: AssignmentStatus.SUBMITTED,
      ...(status !== 'ALL' ? { reviewStatus: status } : {}),
      ...(f.network ? { task: { network: f.network } } : {}),
      ...(f.country ? { creator: { country: f.country.toUpperCase() } } : {}),
      ...(q
        ? {
            OR: [
              {
                task: {
                  campaign: { code: { equals: q, mode: 'insensitive' } },
                },
              },
              { creator: { phone: { contains: q } } },
              { creator: { email: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.taskAssignment.findMany({
      where,
      orderBy:
        f.sort === 'date'
          ? [{ submittedAt: 'desc' }]
          : [{ riskScore: 'desc' }, { submittedAt: 'asc' }],
      take: 200,
      include: {
        creator: { select: CONTACT },
        task: {
          include: {
            campaign: { select: { id: true, code: true, title: true } },
          },
        },
        snapshots: { orderBy: { takenAt: 'desc' }, take: 1 },
        _count: { select: { proofs: true } },
      },
    });
    const counts = await this.prisma.taskAssignment.groupBy({
      by: ['reviewStatus'],
      where: { status: AssignmentStatus.SUBMITTED, ...inScope },
      _count: true,
    });
    return {
      counts: Object.fromEntries(
        Object.values(PostReviewStatus).map((s) => [
          s,
          counts.find((c) => c.reviewStatus === s)?._count ?? 0,
        ]),
      ),
      items: rows.map((a) => ({
        id: a.id,
        network: a.task.network,
        contentType: a.task.contentType,
        campaign: a.task.campaign,
        creator: a.creator,
        postUrl: a.postUrl,
        submittedAt: a.submittedAt,
        latestViews: a.snapshots[0]?.views ?? null,
        validViews: a.validViews,
        proofs: a._count.proofs,
        riskScore: a.riskScore,
        reviewStatus: a.reviewStatus,
      })),
    };
  }

  /** Everything known about one post, for the back-office file. */
  async dossier(actor: StaffActor, id: string) {
    const a = await this.prisma.taskAssignment.findUnique({
      where: { id },
      include: {
        task: { include: { campaign: true } },
        creator: {
          select: { ...CONTACT, createdAt: true, profiles: true },
        },
        proofs: { orderBy: { uploadedAt: 'asc' } },
        snapshots: { orderBy: { takenAt: 'asc' } },
        reviews: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!a) throw new NotFoundException();
    assertCountry(actor, a.creator.country);
    const { task, creator } = a;
    const campaign = task.campaign;
    const [risk, account, history, reviewers] = await Promise.all([
      this.proofs.refreshRisk(a.id),
      this.prisma.socialAccount.findUnique({
        where: {
          userId_network: { userId: a.creatorId, network: task.network },
        },
      }),
      this.prisma.taskAssignment.groupBy({
        by: ['reviewStatus'],
        where: { creatorId: a.creatorId, status: AssignmentStatus.SUBMITTED },
        _count: true,
      }),
      this.contacts([
        ...a.reviews.map((r) => r.reviewerId),
        ...a.snapshots
          .map((s) => s.recordedById)
          .filter((x): x is string => !!x),
      ]),
    ]);
    const shared = risk.sharedCreatorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: risk.sharedCreatorIds } },
          select: CONTACT,
        })
      : [];
    const latest = a.snapshots.at(-1)?.views ?? 0;
    const count = (s: PostReviewStatus) =>
      history.find((h) => h.reviewStatus === s)?._count ?? 0;

    const timeline = [
      { at: a.acceptedAt, label: 'Tâche acceptée' },
      ...a.proofs.map((p) => ({
        at: p.uploadedAt,
        label:
          p.kind === 'LINK'
            ? 'Lien envoyé'
            : `Capture envoyée${p.declaredViews !== null ? ` (${p.declaredViews.toLocaleString('fr-FR')} vues)` : ''}`,
      })),
      ...a.snapshots
        .filter((s) => s.source === 'API')
        .map((s) => ({
          at: s.takenAt,
          label: `Relevé automatique : ${s.views.toLocaleString('fr-FR')} vues`,
        })),
      ...a.reviews.map((r) => ({
        at: r.createdAt,
        label: `${REVIEW_LABELS[r.action]}${r.views !== null ? ` · ${r.views.toLocaleString('fr-FR')} vues` : ''}${r.reason ? ` · ${r.reason}` : ''}`,
        by: reviewers.get(r.reviewerId) ?? null,
      })),
    ].sort((x, y) => x.at.getTime() - y.at.getTime());

    return {
      id: a.id,
      reviewStatus: a.reviewStatus,
      reviewReason: a.reviewReason,
      reviewedAt: a.reviewedAt,
      riskScore: risk.score,
      signals: risk.signals,
      network: task.network,
      contentType: task.contentType,
      postUrl: a.postUrl,
      acceptedAt: a.acceptedAt,
      submittedAt: a.submittedAt,
      validViews: a.validViews,
      earned: a.earned,
      latestViews: latest,
      // What the creator would earn if every declared view were validated.
      expectedEarning: creatorEarning(latest, task.creatorRatePer1000),
      creatorRatePer1000: task.creatorRatePer1000,
      taskBudget: task.budget,
      campaign: {
        id: campaign.id,
        code: campaign.code,
        title: campaign.title,
        endsAt: campaign.endsAt,
        language: campaign.language,
        faceRequired: campaign.faceRequired,
        minDurationSec: campaign.minDurationSec,
        maxDurationSec: campaign.maxDurationSec,
        mandatoryElements: campaign.mandatoryElements,
        forbiddenElements: campaign.forbiddenElements,
        assetUrls: campaign.assetUrls,
      },
      creator: {
        ...creator,
        level:
          creator.profiles.find((p) => p.type === ProfileType.CREATOR)?.level ??
          1,
        account: account && {
          id: account.id,
          handle: account.handle,
          status: account.status,
          followers: account.followers,
          avgStatusViews: account.avgStatusViews,
        },
        history: {
          validated: count(PostReviewStatus.VALIDATED),
          rejected: count(PostReviewStatus.REJECTED),
          toReview: count(PostReviewStatus.TO_REVIEW),
          needsFix: count(PostReviewStatus.NEEDS_FIX),
        },
        sharedDevice: shared,
      },
      proofs: a.proofs.map((p) => ({
        ...this.proofs.proofView(p),
        sha256: p.sha256,
        deviceId: p.deviceId,
        ip: p.ip,
      })),
      snapshots: a.snapshots.map((s) => ({
        views: s.views,
        source: s.source,
        takenAt: s.takenAt,
        by: s.recordedById ? (reviewers.get(s.recordedById) ?? null) : null,
      })),
      timeline,
    };
  }

  async review(actor: StaffActor, id: string, dto: ReviewPostDto) {
    const a = await this.prisma.taskAssignment.findUnique({
      where: { id },
      include: {
        task: { include: { campaign: true } },
        creator: { select: { country: true } },
      },
    });
    if (!a || a.status !== AssignmentStatus.SUBMITTED) {
      throw new NotFoundException();
    }
    assertCountry(actor, a.creator.country);
    assertNotSelf(actor, a.creatorId);
    const reason = dto.reason?.trim() || null;
    const code = `#${a.task.campaign.code}`;
    const before = { reviewStatus: a.reviewStatus, validViews: a.validViews };

    switch (dto.decision) {
      case 'VALIDATE': {
        const views = dto.views!;
        if (views < a.validViews) {
          throw new BadRequestException(
            `Déjà ${a.validViews} vues validées pour cette publication`,
          );
        }
        if (views > a.validViews) {
          // Pays the creator, logs the views and notifies them; a refused
          // post is re-opened inside the same transaction.
          await this.wallet.recordViews(id, views, actor, true);
        } else {
          await this.prisma.$transaction(async (tx) => {
            await tx.taskAssignment.update({
              where: { id },
              data: {
                reviewStatus: PostReviewStatus.VALIDATED,
                reviewReason: null,
                reviewedAt: new Date(),
              },
            });
            await this.log(tx, actor, id, PostReviewAction.VALIDATE, {
              before,
              views,
            });
          });
          await this.notifications.notify(a.creatorId, {
            type: NotificationType.POST_VALIDATED,
            title: `Publication validée · ${code}`,
            body: `${views.toLocaleString('fr-FR')} vues validées.`,
            link: '/resultats',
          });
        }
        break;
      }
      case 'NEEDS_FIX':
        this.requireReason(reason);
        await this.prisma.$transaction(async (tx) => {
          await tx.taskAssignment.update({
            where: { id },
            data: {
              reviewStatus: PostReviewStatus.NEEDS_FIX,
              reviewReason: reason,
              reviewedAt: new Date(),
            },
          });
          await this.log(tx, actor, id, PostReviewAction.NEEDS_FIX, {
            before,
            reason,
          });
        });
        await this.notifications.notify(a.creatorId, {
          type: NotificationType.POST_NEEDS_FIX,
          title: `Publication à corriger · ${code}`,
          body: reason!,
          link: '/resultats',
        });
        break;
      case 'REJECT':
        this.requireReason(reason);
        await this.prisma.$transaction(async (tx) => {
          await this.wallet.reverseEarnings(tx, id);
          await tx.taskAssignment.update({
            where: { id },
            data: {
              reviewStatus: PostReviewStatus.REJECTED,
              reviewReason: reason,
              reviewedAt: new Date(),
            },
          });
          await this.log(tx, actor, id, PostReviewAction.REJECT, {
            before,
            reason,
          });
        });
        await this.notifications.notify(a.creatorId, {
          type: NotificationType.POST_REJECTED,
          title: `Publication refusée · ${code}`,
          body: reason!,
          link: '/resultats',
        });
        break;
      case 'SUSPEND_ACCOUNT': {
        this.requireReason(reason);
        const account = await this.prisma.socialAccount.findUnique({
          where: {
            userId_network: { userId: a.creatorId, network: a.task.network },
          },
        });
        if (!account) throw new NotFoundException('Compte réseau introuvable');
        await this.prisma.$transaction(async (tx) => {
          await tx.socialAccount.update({
            where: { id: account.id },
            data: { status: AccountStatus.SUSPENDED, statusReason: reason },
          });
          await tx.accountReview.create({
            data: {
              accountId: account.id,
              userId: a.creatorId,
              network: account.network,
              reviewerId: actor.userId,
              status: AccountStatus.SUSPENDED,
              reason,
            },
          });
          await this.log(tx, actor, id, PostReviewAction.SUSPEND_ACCOUNT, {
            before: { ...before, accountStatus: account.status },
            reason,
          });
        });
        await this.notifications.notify(a.creatorId, {
          type: NotificationType.ACCOUNT_REVIEWED,
          title: `Compte ${account.handle} suspendu`,
          body: reason!,
          link: '/comptes',
        });
        break;
      }
    }
    return this.dossier(actor, id);
  }

  /** One creator on one page: accounts, posts, decisions, money, signals. */
  async creatorFile(actor: StaffActor, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...CONTACT,
        createdAt: true,
        priorityRank: true,
        profiles: true,
        skills: true,
        accounts: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!user) throw new NotFoundException();
    assertCountry(actor, user.country);
    const [posts, accountReviews, earnings, payouts] = await Promise.all([
      this.prisma.taskAssignment.findMany({
        where: { creatorId: userId },
        orderBy: { acceptedAt: 'desc' },
        take: 100,
        include: {
          task: {
            include: {
              campaign: { select: { id: true, code: true, title: true } },
            },
          },
          snapshots: { orderBy: { takenAt: 'desc' }, take: 1 },
        },
      }),
      this.prisma.accountReview.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.transaction.aggregate({
        where: {
          userId,
          type: TransactionType.EARNING,
          status: TransactionStatus.COMPLETED,
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.findMany({
        where: { userId, kind: PaymentKind.PAYOUT },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          amount: true,
          status: true,
          operator: true,
          phone: true,
          failureReason: true,
          createdAt: true,
        },
      }),
    ]);
    const devices = await this.prisma.postProof.findMany({
      where: { assignment: { creatorId: userId }, deviceId: { not: null } },
      select: { deviceId: true },
      distinct: ['deviceId'],
    });
    const sharedWith = devices.length
      ? await this.prisma.postProof.findMany({
          where: {
            deviceId: { in: devices.map((d) => d.deviceId!) },
            assignment: { creatorId: { not: userId } },
          },
          select: { assignment: { select: { creator: { select: CONTACT } } } },
          distinct: ['assignmentId'],
          take: 50,
        })
      : [];
    const reviewers = await this.contacts(
      accountReviews.map((r) => r.reviewerId).filter((x): x is string => !!x),
    );
    const sharedById = new Map(
      sharedWith.map((s) => [s.assignment.creator.id, s.assignment.creator]),
    );
    return {
      ...user,
      earned: earnings._sum.amount ?? 0,
      devices: devices.length,
      sharedDevice: [...sharedById.values()],
      posts: posts.map((a) => ({
        id: a.id,
        network: a.task.network,
        campaign: a.task.campaign,
        status: a.status,
        reviewStatus: a.reviewStatus,
        reviewReason: a.reviewReason,
        riskScore: a.riskScore,
        latestViews: a.snapshots[0]?.views ?? null,
        validViews: a.validViews,
        earned: a.earned,
        acceptedAt: a.acceptedAt,
        submittedAt: a.submittedAt,
      })),
      accountReviews: accountReviews.map((r) => ({
        ...r,
        by: r.reviewerId ? (reviewers.get(r.reviewerId) ?? null) : null,
      })),
      payouts,
    };
  }

  // The post's own history and the audit journal, in the same transaction.
  private async log(
    tx: Prisma.TransactionClient,
    actor: StaffActor,
    assignmentId: string,
    action: PostReviewAction,
    entry: { before: object; views?: number; reason?: string | null },
  ) {
    await tx.postReview.create({
      data: {
        assignmentId,
        reviewerId: actor.userId,
        action,
        views: entry.views ?? null,
        reason: entry.reason ?? null,
      },
    });
    const after = await tx.taskAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: { reviewStatus: true, validViews: true },
    });
    await this.audit.record(tx, {
      actor,
      action: `POST_${action}`,
      entity: 'TaskAssignment',
      entityId: assignmentId,
      before: entry.before,
      after,
      reason: entry.reason,
    });
  }

  private requireReason(reason: string | null) {
    if (!reason) throw new BadRequestException('Indique la raison');
  }

  // How a team member is named in the audit trail.
  private async contacts(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, phone: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u.phone ?? u.email ?? u.id]));
  }
}

const REVIEW_LABELS: Record<PostReviewAction, string> = {
  VIEWS: 'Vues validées',
  VALIDATE: 'Publication validée',
  NEEDS_FIX: 'Correction demandée',
  REJECT: 'Publication refusée',
  SUSPEND_ACCOUNT: 'Compte suspendu',
};
