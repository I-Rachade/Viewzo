import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  Dispute,
  DisputeOutcome,
  DisputeSide,
  DisputeStatus,
  NotificationType,
  PostReviewAction,
  PostReviewStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DecideDisputeDto } from './dto/dispute.dto';

const HOUR = 3600 * 1000;
// An open dispute older than this is flagged in the back-office.
export const DISPUTE_OVERDUE_MS = 72 * HOUR;

export const DISPUTE_OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  KEEP: 'décision maintenue',
  SET_VIEWS: 'vues corrigées',
  REJECT_POST: 'publication refusée',
};

const CONTACT = { id: true, phone: true, email: true, country: true } as const;

/** A dispute as the creator or the advertiser sees it. */
export function disputeView(d: Dispute | undefined) {
  if (!d) return null;
  return {
    id: d.id,
    side: d.side,
    reason: d.reason,
    status: d.status,
    outcome: d.outcome,
    decisionReason: d.decisionReason,
    createdAt: d.createdAt,
    decidedAt: d.decidedAt,
  };
}

/**
 * A creator contests a refusal or a views count, an advertiser a validated
 * post. Opening freezes the post's earnings; the team decides with a reason.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async open(userId: string, assignmentId: string, input: string) {
    const a = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        task: {
          select: { campaign: { select: { advertiserId: true, code: true } } },
        },
      },
    });
    if (!a || a.status !== AssignmentStatus.SUBMITTED) {
      throw new NotFoundException();
    }
    const side =
      a.creatorId === userId
        ? DisputeSide.CREATOR
        : a.task.campaign.advertiserId === userId
          ? DisputeSide.ADVERTISER
          : null;
    if (!side) throw new NotFoundException();
    if (
      side === DisputeSide.CREATOR &&
      a.reviewStatus !== PostReviewStatus.REJECTED &&
      a.reviewStatus !== PostReviewStatus.VALIDATED
    ) {
      throw new BadRequestException(
        'Seul un refus ou un nombre de vues validé peut être contesté',
      );
    }
    if (
      side === DisputeSide.ADVERTISER &&
      a.reviewStatus !== PostReviewStatus.VALIDATED
    ) {
      throw new BadRequestException(
        'Seule une publication validée peut être contestée',
      );
    }
    const reason = input.trim();
    if (reason.length < 5) throw new BadRequestException('Explique le litige');

    const dispute = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `dispute:${assignmentId}`);
      const previous = await tx.dispute.findMany({ where: { assignmentId } });
      if (previous.some((d) => d.status === DisputeStatus.OPEN)) {
        throw new ConflictException(
          'Un litige est déjà ouvert sur cette publication',
        );
      }
      if (previous.some((d) => d.side === side)) {
        throw new ConflictException('Tu as déjà contesté cette publication');
      }
      const created = await tx.dispute.create({
        data: { assignmentId, openedById: userId, side, reason },
      });
      await this.wallet.setFrozen(tx, assignmentId, true);
      await this.audit.record(tx, {
        actor: { userId },
        action: 'dispute.open',
        entity: 'Dispute',
        entityId: created.id,
        after: { assignmentId, side },
        reason,
      });
      return created;
    });
    if (side === DisputeSide.ADVERTISER) {
      await this.notifications.notify(a.creatorId, {
        type: NotificationType.DISPUTE_UPDATED,
        title: `Publication contestée · #${a.task.campaign.code}`,
        body: 'L’annonceur conteste ta publication. Ses gains sont gelés le temps que l’équipe tranche.',
        link: '/resultats',
      });
    }
    return disputeView(dispute);
  }

  /** Back-office queue: open disputes oldest first, flagged after 72 h. */
  async list(actor: StaffActor, status: DisputeStatus = DisputeStatus.OPEN) {
    const scope = countryScope(actor);
    const inScope: Prisma.DisputeWhereInput = scope
      ? { assignment: { creator: { country: { in: scope } } } }
      : {};
    const now = Date.now();
    const overdueBefore = new Date(now - DISPUTE_OVERDUE_MS);
    const [rows, open, overdue] = await Promise.all([
      this.prisma.dispute.findMany({
        where: { ...inScope, status },
        orderBy:
          status === DisputeStatus.OPEN
            ? { createdAt: 'asc' }
            : { decidedAt: 'desc' },
        take: 200,
        include: {
          assignment: {
            include: {
              creator: { select: CONTACT },
              task: {
                select: {
                  network: true,
                  campaign: {
                    select: { id: true, code: true, title: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.dispute.count({
        where: { ...inScope, status: DisputeStatus.OPEN },
      }),
      this.prisma.dispute.count({
        where: {
          ...inScope,
          status: DisputeStatus.OPEN,
          createdAt: { lte: overdueBefore },
        },
      }),
    ]);
    return {
      open,
      overdue,
      items: rows.map((d) => ({
        ...disputeView(d)!,
        overdue:
          d.status === DisputeStatus.OPEN && d.createdAt <= overdueBefore,
        post: {
          id: d.assignment.id,
          network: d.assignment.task.network,
          campaign: d.assignment.task.campaign,
          creator: d.assignment.creator,
          postUrl: d.assignment.postUrl,
          reviewStatus: d.assignment.reviewStatus,
          validViews: d.assignment.validViews,
          earned: d.assignment.earned,
        },
      })),
    };
  }

  async decide(actor: StaffActor, id: string, dto: DecideDisputeDto) {
    const d = await this.prisma.dispute.findUnique({
      where: { id },
      include: {
        assignment: {
          include: {
            creator: { select: { country: true } },
            task: {
              select: {
                campaign: {
                  select: { id: true, advertiserId: true, code: true },
                },
              },
            },
          },
        },
      },
    });
    if (!d) throw new NotFoundException();
    if (d.status !== DisputeStatus.OPEN) {
      throw new ConflictException('Litige déjà tranché');
    }
    const a = d.assignment;
    const { campaign } = a.task;
    assertCountry(actor, a.creator.country);
    assertNotSelf(actor, a.creatorId);
    assertNotSelf(actor, campaign.advertiserId);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Indique la raison');

    // Pays the extra views first; their earnings arrive frozen and are
    // released with the others below.
    if (dto.outcome === DisputeOutcome.SET_VIEWS) {
      await this.wallet.recordViews(a.id, dto.views!, actor, true);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `dispute:${a.id}`);
      const claimed = await tx.dispute.updateMany({
        where: { id, status: DisputeStatus.OPEN },
        data: {
          status: DisputeStatus.RESOLVED,
          outcome: dto.outcome,
          decisionReason: reason,
          decidedById: actor.userId,
          decidedAt: new Date(),
        },
      });
      if (!claimed.count) throw new ConflictException('Litige déjà tranché');
      if (dto.outcome === DisputeOutcome.REJECT_POST) {
        await this.wallet.reverseEarnings(tx, a.id);
        await tx.taskAssignment.update({
          where: { id: a.id },
          data: {
            reviewStatus: PostReviewStatus.REJECTED,
            reviewReason: reason,
            reviewedAt: new Date(),
          },
        });
        await tx.postReview.create({
          data: {
            assignmentId: a.id,
            reviewerId: actor.userId,
            action: PostReviewAction.REJECT,
            reason,
          },
        });
      } else {
        await this.wallet.setFrozen(tx, a.id, false);
      }
      await this.audit.record(tx, {
        actor,
        action: 'dispute.decide',
        entity: 'Dispute',
        entityId: id,
        before: { status: DisputeStatus.OPEN, reviewStatus: a.reviewStatus },
        after: {
          status: DisputeStatus.RESOLVED,
          outcome: dto.outcome,
          views: dto.views,
        },
        reason,
      });
    });
    const message = {
      type: NotificationType.DISPUTE_UPDATED,
      title: `Litige tranché · #${campaign.code}`,
      body: `${capitalize(DISPUTE_OUTCOME_LABELS[dto.outcome])} : ${reason}`,
    };
    await this.notifications.notify(a.creatorId, {
      ...message,
      link: '/resultats',
    });
    if (d.side === DisputeSide.ADVERTISER) {
      await this.notifications.notify(campaign.advertiserId, {
        ...message,
        link: `/campaigns/${campaign.id}`,
      });
    }
    return this.prisma.dispute.findUniqueOrThrow({ where: { id } });
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
