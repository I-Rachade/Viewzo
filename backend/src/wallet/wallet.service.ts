import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssignmentStatus,
  Campaign,
  CampaignStatus,
  NotificationType,
  Payment,
  PaymentKind,
  PostReviewAction,
  PostReviewStatus,
  PaymentStatus,
  Prisma,
  ProfileType,
  TransactionStatus,
  TransactionType,
  ViewSource,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { parsePhone } from '../auth/phone';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto } from './dto/deposit.dto';
import { FundCampaignDto } from './dto/fund-campaign.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import {
  advertiserCost,
  availableAt,
  creatorEarning,
  LEVEL1_EARNINGS_CAP,
  payableViews,
} from './earnings';
import { FLUTTERWAVE_OPERATORS } from './gateways/flutterwave.gateway';
import {
  GatewayNotConfigured,
  GatewayStatus,
  PayinResult,
} from './gateways/gateway';
import { IdentityService } from '../identity/identity.service';
import { namesMatch } from '../identity/names';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentRouter } from './payment-router';

const CURRENCY = 'XOF';
const DEFAULT_MIN_WITHDRAWAL = 1_000;
// From this amount a second finance member must approve a withdrawal.
const DEFAULT_SECOND_APPROVAL_FROM = 100_000;

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly router: PaymentRouter,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  async summary(userId: string) {
    const user = await this.user(userId);
    const now = new Date();
    const [available, held, pendingWithdrawals, campaigns] = await Promise.all([
      this.balance(this.prisma, userId, now),
      this.sum(userId, {
        type: TransactionType.EARNING,
        status: TransactionStatus.COMPLETED,
        availableAt: { gt: now },
      }),
      this.sum(userId, {
        type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING,
      }),
      this.prisma.campaign.findMany({
        where: {
          advertiserId: userId,
          fundedAt: { not: null },
          status: {
            in: [CampaignStatus.PENDING_REVIEW, CampaignStatus.ACTIVE],
          },
        },
        select: { budget: true, spent: true },
      }),
    ]);
    const provider = this.router.providerFor(user.country);
    return {
      currency: CURRENCY,
      available,
      // Earnings in their security hold, withdrawable from `availableAt`.
      held,
      pendingWithdrawals: -pendingWithdrawals,
      // Budgets of the user's campaigns still held in escrow.
      escrow: campaigns.reduce((s, c) => s + c.budget - c.spent, 0),
      minWithdrawal: this.minWithdrawal(),
      withdrawalsOpen: this.maxLevel(user) >= 2,
      provider,
      operators:
        provider === 'flutterwave'
          ? (FLUTTERWAVE_OPERATORS[user.country] ?? [])
          : [],
    };
  }

  async transactions(userId: string) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        type: true,
        amount: true,
        currency: true,
        status: true,
        availableAt: true,
        campaignId: true,
        note: true,
        createdAt: true,
      },
    });
  }

  // ---- Advertiser payments ----------------------------------------------

  /** Puts the campaign budget in escrow, from the wallet or by Mobile Money. */
  async fundCampaign(userId: string, campaignId: string, dto: FundCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign || campaign.advertiserId !== userId) {
      throw new NotFoundException();
    }
    this.assertFundable(campaign);

    if (dto.method === 'MOBILE_MONEY') {
      return this.startPayin(userId, campaign.budget, dto.phone, campaign);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `campaign:${campaignId}`);
      await this.lock(tx, userId);
      const fresh = await tx.campaign.findUniqueOrThrow({
        where: { id: campaignId },
      });
      this.assertFundable(fresh);
      if ((await this.balance(tx, userId, new Date())) < fresh.budget) {
        throw new BadRequestException('Solde insuffisant');
      }
      await this.escrow(tx, fresh);
    });
    return { funded: true as const };
  }

  async deposit(userId: string, dto: DepositDto) {
    return this.startPayin(userId, dto.amount, dto.phone);
  }

  /** Status of one of the user's payments, refreshed from the provider. */
  async paymentStatus(userId: string, reference: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference },
    });
    if (!payment || payment.userId !== userId) throw new NotFoundException();
    const refreshed = await this.refresh(payment);
    return this.toPaymentView(refreshed);
  }

  async handleWebhook(
    provider: string,
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const ref = this.router.byName(provider).webhookRef(body, headers);
    if (!ref) return;
    const payment = ref.reference
      ? await this.prisma.payment.findUnique({
          where: { reference: ref.reference },
        })
      : await this.prisma.payment.findUnique({
          where: {
            provider_providerRef: { provider, providerRef: ref.providerRef! },
          },
        });
    if (!payment || payment.provider !== provider) return;
    await this.refresh(payment);
  }

  // ---- Withdrawals ------------------------------------------------------

  async requestWithdrawal(userId: string, dto: WithdrawDto) {
    const user = await this.user(userId);
    if (this.maxLevel(user) < 2) {
      throw new ForbiddenException(
        'Les retraits s’ouvrent au niveau 2, après vérification de ton identité',
      );
    }
    if (dto.amount < this.minWithdrawal()) {
      throw new BadRequestException(
        `Retrait minimum : ${this.minWithdrawal()} FCFA`,
      );
    }
    const phone = this.phone(user, dto.phone);
    const provider = this.router.providerFor(phone.country);
    if (provider === 'flutterwave') {
      const operators = FLUTTERWAVE_OPERATORS[phone.country] ?? [];
      if (!dto.operator || !operators.includes(dto.operator)) {
        throw new BadRequestException(
          operators.length
            ? `Choisis ton opérateur : ${operators.join(', ')}`
            : 'Retrait Mobile Money indisponible dans ce pays',
        );
      }
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId);
      if ((await this.balance(tx, userId, new Date())) < dto.amount) {
        throw new BadRequestException('Solde disponible insuffisant');
      }
      const created = await tx.payment.create({
        data: {
          userId,
          kind: PaymentKind.PAYOUT,
          provider,
          reference: this.reference('R'),
          amount: dto.amount,
          currency: CURRENCY,
          phone: phone.e164,
          beneficiaryName: dto.beneficiaryName.trim(),
          operator: dto.operator,
          status: PaymentStatus.REQUESTED,
        },
      });
      // Holds the amount until the finance team decides.
      await tx.transaction.create({
        data: {
          userId,
          type: TransactionType.WITHDRAWAL,
          amount: -dto.amount,
          currency: CURRENCY,
          status: TransactionStatus.PENDING,
          paymentId: created.id,
        },
      });
      return created;
    });
    return this.toPaymentView(payment);
  }

  async withdrawals(userId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { userId, kind: PaymentKind.PAYOUT },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return payments.map((p) => this.toPaymentView(p));
  }

  // ---- Back-office ------------------------------------------------------

  async withdrawalQueue(
    actor: StaffActor,
    status: PaymentStatus = PaymentStatus.REQUESTED,
  ) {
    const scope = countryScope(actor);
    const payments = await this.prisma.payment.findMany({
      where: {
        kind: PaymentKind.PAYOUT,
        status,
        ...(scope ? { user: { country: { in: scope } } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        user: {
          select: {
            phone: true,
            country: true,
            profiles: { select: { type: true, level: true } },
          },
        },
      },
    });
    const verified = await this.identity.verifiedNames([
      ...new Set(payments.map((p) => p.userId)),
    ]);
    return payments.map((p) => ({
      ...this.toPaymentView(p),
      beneficiaryName: p.beneficiaryName,
      // Name on the verified ID, and whether the Mobile Money holder matches.
      verifiedName: verified.get(p.userId) ?? null,
      nameMatches:
        verified.has(p.userId) && p.beneficiaryName
          ? namesMatch(verified.get(p.userId)!, p.beneficiaryName)
          : null,
      phone: p.phone,
      operator: p.operator,
      userId: p.userId,
      user: p.user,
      needsSecondApproval: p.amount >= this.secondApprovalFrom(),
      firstApprovedById: p.firstApprovedById,
    }));
  }

  async reviewWithdrawal(
    actor: StaffActor,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason?: string,
  ) {
    const payment = await this.staffPayment(actor, id);
    const note = reason?.trim() || null;

    if (decision === 'REJECT') {
      const rejected = await this.prisma.$transaction(async (tx) => {
        // Claim the request so two members can't decide on it twice.
        const claimed = await tx.payment.updateMany({
          where: { id, status: PaymentStatus.REQUESTED },
          data: {
            status: PaymentStatus.REJECTED,
            reviewedById: actor.userId,
            failureReason: note,
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException('Retrait déjà traité');
        }
        await tx.transaction.update({
          where: { paymentId: id },
          data: {
            status: TransactionStatus.CANCELLED,
            note: note ?? undefined,
          },
        });
        await this.audit.record(tx, {
          actor,
          action: 'WITHDRAWAL_REJECT',
          entity: 'Payment',
          entityId: id,
          before: { status: payment.status },
          after: { status: PaymentStatus.REJECTED },
          reason: note,
        });
        return tx.payment.findUniqueOrThrow({ where: { id } });
      });
      await this.notifyWithdrawal(rejected);
      return this.toPaymentView(rejected);
    }

    // Four eyes: a large withdrawal needs two different finance members.
    if (payment.amount >= this.secondApprovalFrom()) {
      if (!payment.firstApprovedById) {
        const first = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.payment.updateMany({
            where: {
              id,
              status: PaymentStatus.REQUESTED,
              firstApprovedById: null,
            },
            data: {
              firstApprovedById: actor.userId,
              firstApprovedAt: new Date(),
            },
          });
          if (claimed.count === 0) {
            throw new ConflictException('Retrait déjà traité');
          }
          await this.audit.record(tx, {
            actor,
            action: 'WITHDRAWAL_FIRST_APPROVAL',
            entity: 'Payment',
            entityId: id,
            reason: note,
          });
          return tx.payment.findUniqueOrThrow({ where: { id } });
        });
        return { ...this.toPaymentView(first), awaitingSecondApproval: true };
      }
      if (payment.firstApprovedById === actor.userId) {
        throw new ConflictException(
          'Un deuxième membre de la finance doit valider ce retrait',
        );
      }
    }

    // Claim the request so two members can't send it twice.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.REQUESTED },
        data: { status: PaymentStatus.PROCESSING, reviewedById: actor.userId },
      });
      if (result.count > 0) {
        await this.audit.record(tx, {
          actor,
          action: 'WITHDRAWAL_APPROVE',
          entity: 'Payment',
          entityId: id,
          before: { status: PaymentStatus.REQUESTED },
          after: { status: PaymentStatus.PROCESSING },
          reason: note,
        });
      }
      return result.count;
    });
    if (claimed === 0) {
      throw new ConflictException('Retrait déjà traité');
    }

    const { country } = parsePhone(payment.phone, 'TG');
    let result: {
      status: GatewayStatus;
      providerRef?: string;
      reason?: string;
    };
    try {
      result = await this.router.byName(payment.provider).createPayout({
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        phone: payment.phone,
        country,
        beneficiaryName: payment.beneficiaryName ?? '',
        operator: payment.operator ?? undefined,
        notifyUrl: this.notifyUrl(payment.provider),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur du fournisseur';
      if (e instanceof GatewayNotConfigured) {
        // Nothing was sent: back in the queue with the reason.
        await this.prisma.payment.update({
          where: { id },
          data: { status: PaymentStatus.REQUESTED, failureReason: message },
        });
        throw e;
      }
      // The provider may have paid before failing or timing out. Never send
      // again automatically: finance checks and resolves it by hand.
      await this.prisma.payment.update({
        where: { id },
        data: {
          failureReason: `À vérifier chez le fournisseur avant toute action : ${message}`,
        },
      });
      throw e;
    }
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { providerRef: result.providerRef ?? null },
    });
    return this.toPaymentView(
      await this.applyPayout(updated, result.status, result.reason),
    );
  }

  /**
   * Finance closes a withdrawal whose provider answer was lost, after checking
   * the provider's dashboard: sent, or failed and back on the balance.
   */
  async resolvePayout(
    actor: StaffActor,
    id: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    reason: string,
  ) {
    const payment = await this.staffPayment(actor, id);
    if (payment.status !== PaymentStatus.PROCESSING) {
      throw new ConflictException('Ce retrait n’est pas en cours');
    }
    const updated = await this.applyPayout(payment, outcome, reason, actor);
    return this.toPaymentView(updated);
  }

  /** Re-reads a payment's status from its provider (stuck payments). */
  async refreshById(actor: StaffActor, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { user: { select: { country: true } } },
    });
    if (!payment) throw new NotFoundException();
    assertCountry(actor, payment.user.country);
    return this.toPaymentView(await this.refresh(payment));
  }

  /** A payout the back-office acts on: in scope and not the member's own. */
  private async staffPayment(actor: StaffActor, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { user: { select: { country: true } } },
    });
    if (!payment || payment.kind !== PaymentKind.PAYOUT) {
      throw new NotFoundException();
    }
    assertCountry(actor, payment.user.country);
    assertNotSelf(actor, payment.userId);
    return payment;
  }

  /**
   * Records the validated views of a post and credits the creator. Stands in
   * for the automatic view counting, which comes with the anti-fraud module.
   */
  async recordViews(
    assignmentId: string,
    totalViews: number,
    actor: StaffActor,
    // Validating a post that was refused before puts it back in review.
    reopen = false,
  ) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        task: { include: { campaign: true } },
        creator: { select: { country: true } },
      },
    });
    if (!assignment) throw new NotFoundException();
    assertCountry(actor, assignment.creator.country);
    assertNotSelf(actor, assignment.creatorId);
    if (assignment.status !== AssignmentStatus.SUBMITTED) {
      throw new BadRequestException(
        'Le lien de la publication n’a pas été envoyé',
      );
    }
    if (!assignment.task.campaign.fundedAt) {
      throw new BadRequestException('Campagne non financée');
    }
    if (assignment.reviewStatus === PostReviewStatus.REJECTED && !reopen) {
      throw new BadRequestException('Publication refusée');
    }
    if (totalViews < assignment.validViews) {
      throw new BadRequestException(
        `Déjà ${assignment.validViews} vues validées pour cette publication`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // The task budget is shared by every creator on the campaign: one
      // validation at a time per campaign, then per creator for the balance.
      await this.lock(tx, `campaign:${assignment.task.campaignId}`);
      await this.lock(tx, assignment.creatorId);
      const current = await tx.taskAssignment.findUniqueOrThrow({
        where: { id: assignmentId },
        include: {
          task: { include: { campaign: true, assignments: true } },
          creator: { include: { profiles: true } },
        },
      });
      const { task } = current;
      const others = task.assignments.filter((a) => a.id !== current.id);
      const spentOnTask = others.reduce(
        (s, a) => s + advertiserCost(a.validViews, task.contentType),
        0,
      );
      // Views beyond the task budget are not paid.
      const views = Math.min(
        totalViews,
        payableViews(task.budget - spentOnTask, task.contentType),
      );
      let earned = creatorEarning(views, task.creatorRatePer1000);
      const level =
        current.creator.profiles.find((p) => p.type === ProfileType.CREATOR)
          ?.level ?? 1;
      if (level < 2) {
        const total = await this.sumWith(tx, current.creatorId, {
          type: TransactionType.EARNING,
          status: TransactionStatus.COMPLETED,
          assignmentId: { not: current.id },
        });
        earned = Math.min(earned, Math.max(0, LEVEL1_EARNINGS_CAP - total));
        earned = Math.max(earned, current.earned);
      }
      const delta = earned - current.earned;
      const costDelta =
        advertiserCost(views, task.contentType) -
        advertiserCost(current.validViews, task.contentType);
      if (task.campaign.spent + costDelta > task.campaign.budget) {
        throw new ConflictException('Budget de la campagne épuisé');
      }

      const updated = await tx.taskAssignment.update({
        where: { id: current.id },
        data: {
          validViews: views,
          earned,
          reviewStatus: PostReviewStatus.VALIDATED,
          reviewReason: null,
          reviewedAt: new Date(),
        },
      });
      // The views history and the audit trail of the post.
      await tx.viewSnapshot.create({
        data: {
          assignmentId: current.id,
          views: totalViews,
          source: ViewSource.STAFF,
          recordedById: actor.userId,
        },
      });
      await tx.postReview.create({
        data: {
          assignmentId: current.id,
          reviewerId: actor.userId,
          action: PostReviewAction.VIEWS,
          views: totalViews,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'POST_VIEWS',
        entity: 'TaskAssignment',
        entityId: current.id,
        before: {
          validViews: current.validViews,
          earned: current.earned,
          reviewStatus: current.reviewStatus,
        },
        after: {
          validViews: views,
          earned,
          reviewStatus: PostReviewStatus.VALIDATED,
          declaredViews: totalViews,
          campaignCost: costDelta,
        },
      });
      if (costDelta > 0) {
        await tx.campaign.update({
          where: { id: task.campaignId },
          data: { spent: { increment: costDelta } },
        });
      }
      if (delta > 0) {
        await tx.transaction.create({
          data: {
            userId: current.creatorId,
            type: TransactionType.EARNING,
            amount: delta,
            currency: CURRENCY,
            availableAt: availableAt(level),
            campaignId: task.campaignId,
            assignmentId: current.id,
            note: `${views} vues validées · #${task.campaign.code}`,
          },
        });
      }
      return {
        id: updated.id,
        validViews: updated.validViews,
        earned: updated.earned,
        // Views above what the task budget can pay.
        unpaidViews: totalViews - views,
      };
    });
    await this.notifications.notify(assignment.creatorId, {
      type: NotificationType.POST_VALIDATED,
      title: `Publication validée · #${assignment.task.campaign.code}`,
      body: `${result.validViews.toLocaleString('fr-FR')} vues validées, ${result.earned.toLocaleString('fr-FR')} FCFA gagnés au total.`,
      link: '/resultats',
    });
    return result;
  }

  /**
   * Takes back a rejected post's earnings while they are still in their
   * security hold, and returns their cost to the campaign escrow.
   */
  async reverseEarnings(tx: Tx, assignmentId: string) {
    const a = await tx.taskAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      include: { task: true },
    });
    if (a.validViews === 0 && a.earned === 0) return;
    await this.lock(tx, `campaign:${a.task.campaignId}`);
    await this.lock(tx, a.creatorId);
    const now = new Date();
    const earnings = await tx.transaction.findMany({
      where: {
        assignmentId,
        type: TransactionType.EARNING,
        status: TransactionStatus.COMPLETED,
      },
    });
    if (earnings.some((t) => t.availableAt <= now)) {
      throw new ConflictException(
        'Gains déjà disponibles pour le créateur, refus impossible',
      );
    }
    await tx.transaction.updateMany({
      where: { id: { in: earnings.map((t) => t.id) } },
      data: { status: TransactionStatus.CANCELLED },
    });
    await tx.campaign.update({
      where: { id: a.task.campaignId },
      data: {
        spent: { decrement: advertiserCost(a.validViews, a.task.contentType) },
      },
    });
    await tx.taskAssignment.update({
      where: { id: assignmentId },
      data: { validViews: 0, earned: 0 },
    });
  }

  /** Gives back what is left in escrow when a funded campaign is refused. */
  async refundCampaign(tx: Tx, campaignId: string) {
    // Read again under the locks: a payment or a validation may have landed.
    await this.lock(tx, `campaign:${campaignId}`);
    const { advertiserId } = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { advertiserId: true },
    });
    await this.lock(tx, advertiserId);
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    if (!campaign.fundedAt) return 0;
    const remaining = campaign.budget - campaign.spent;
    if (remaining <= 0) return 0;
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { spent: campaign.budget },
    });
    await tx.transaction.create({
      data: {
        userId: campaign.advertiserId,
        type: TransactionType.REFUND,
        amount: remaining,
        currency: CURRENCY,
        campaignId: campaign.id,
        note: `Remboursement #${campaign.code}`,
      },
    });
    return remaining;
  }

  // ---- Internals --------------------------------------------------------

  private async startPayin(
    userId: string,
    amount: number,
    phoneInput: string | undefined,
    campaign?: Campaign,
  ) {
    const user = await this.user(userId);
    const phone = this.phone(user, phoneInput);
    const provider = this.router.providerFor(phone.country);
    const gateway = this.router.byName(provider);
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        kind: PaymentKind.PAYIN,
        provider,
        reference: this.reference('P'),
        amount,
        currency: CURRENCY,
        phone: phone.e164,
        campaignId: campaign?.id,
        status: PaymentStatus.PROCESSING,
      },
    });
    try {
      const started = await gateway.createPayin({
        reference: payment.reference,
        amount,
        currency: CURRENCY,
        phone: phone.e164,
        country: phone.country,
        description: campaign ? `Campagne ${campaign.code}` : 'Recharge Viewzo',
        returnUrl: `${this.webOrigin()}/payments/return?reference=${payment.reference}`,
        notifyUrl: this.notifyUrl(provider),
      });
      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          checkoutUrl: started.checkoutUrl,
          providerRef: started.providerRef ?? null,
        },
      });
      return {
        ...this.toPaymentView(updated),
        checkoutUrl: started.checkoutUrl,
      };
    } catch (e) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason:
            e instanceof Error ? e.message : 'Erreur du fournisseur',
        },
      });
      throw e;
    }
  }

  private async refresh(payment: Payment): Promise<Payment> {
    if (payment.status !== PaymentStatus.PROCESSING) return payment;
    const gateway = this.router.byName(payment.provider);
    if (payment.kind === PaymentKind.PAYIN) {
      return this.applyPayin(payment, await gateway.checkPayin(payment));
    }
    const result = await gateway.checkPayout(payment);
    return this.applyPayout(payment, result.status, result.reason);
  }

  private async applyPayin(payment: Payment, result: PayinResult) {
    if (result.status === 'PROCESSING') return payment;
    let status = result.status;
    let reason = result.reason ?? null;
    // A real provider must say how much was paid; the local test gateway
    // has no amount to report.
    const amountUnknown =
      payment.provider !== 'local' && !Number.isFinite(result.amount);
    if (
      status === 'SUCCEEDED' &&
      (amountUnknown ||
        (Number.isFinite(result.amount) && result.amount! < payment.amount) ||
        (result.currency && result.currency !== payment.currency))
    ) {
      this.logger.error(
        `Payment ${payment.reference}: paid ${result.amount} ${result.currency}, expected ${payment.amount} ${payment.currency}`,
      );
      status = 'FAILED';
      reason = 'Montant reçu différent du montant demandé';
    }

    return this.prisma.$transaction(async (tx) => {
      if (payment.campaignId) {
        await this.lock(tx, `campaign:${payment.campaignId}`);
      }
      await this.lock(tx, payment.userId);
      // Only the first notification changes anything.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PROCESSING },
        data: {
          status:
            status === 'SUCCEEDED'
              ? PaymentStatus.SUCCEEDED
              : PaymentStatus.FAILED,
          failureReason: status === 'FAILED' ? reason : null,
          completedAt: new Date(),
        },
      });
      if (claimed.count > 0) {
        await this.audit.record(tx, {
          actor: null,
          action: 'PAYIN_PROVIDER_RESULT',
          entity: 'Payment',
          entityId: payment.id,
          before: { status: PaymentStatus.PROCESSING },
          after: { status, amount: payment.amount, provider: payment.provider },
          reason,
        });
      }
      if (claimed.count > 0 && status === 'SUCCEEDED') {
        await tx.transaction.create({
          data: {
            userId: payment.userId,
            type: TransactionType.DEPOSIT,
            amount: payment.amount,
            currency: payment.currency,
            paymentId: payment.id,
            campaignId: payment.campaignId,
          },
        });
        if (payment.campaignId) {
          const campaign = await tx.campaign.findUniqueOrThrow({
            where: { id: payment.campaignId },
          });
          // A campaign refused meanwhile leaves the money in the wallet.
          if (this.isFundable(campaign)) await this.escrow(tx, campaign);
        }
      }
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  }

  private async applyPayout(
    payment: Payment,
    status: GatewayStatus,
    reason?: string,
    // Set when finance resolves the payout by hand.
    actor?: StaffActor,
  ) {
    if (status === 'PROCESSING') {
      return this.prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PROCESSING },
        data: {
          status:
            status === 'SUCCEEDED'
              ? PaymentStatus.SUCCEEDED
              : PaymentStatus.FAILED,
          failureReason: status === 'FAILED' ? (reason ?? null) : null,
          completedAt: new Date(),
        },
      });
      if (claimed.count > 0) {
        // A failed payout gives the amount back to the balance.
        await tx.transaction.update({
          where: { paymentId: payment.id },
          data: {
            status:
              status === 'SUCCEEDED'
                ? TransactionStatus.COMPLETED
                : TransactionStatus.CANCELLED,
          },
        });
        await this.audit.record(tx, {
          actor: actor ?? null,
          action: actor ? 'WITHDRAWAL_RESOLVE' : 'WITHDRAWAL_PROVIDER_RESULT',
          entity: 'Payment',
          entityId: payment.id,
          before: { status: PaymentStatus.PROCESSING },
          after: { status, provider: payment.provider },
          reason: reason ?? null,
        });
      }
      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
    if (updated.status !== payment.status) {
      await this.notifyWithdrawal(updated);
    }
    return updated;
  }

  private notifyWithdrawal(p: Payment) {
    const amount = `${p.amount.toLocaleString('fr-FR')} FCFA`;
    const text: Partial<Record<PaymentStatus, [string, string]>> = {
      SUCCEEDED: ['Retrait envoyé', `${amount} envoyés sur ton Mobile Money.`],
      FAILED: [
        'Retrait échoué',
        `${amount} sont revenus sur ton solde. ${p.failureReason ?? ''}`.trim(),
      ],
      REJECTED: [
        'Retrait refusé',
        `${amount} sont revenus sur ton solde. ${p.failureReason ?? ''}`.trim(),
      ],
    };
    const t = text[p.status];
    if (!t || p.kind !== PaymentKind.PAYOUT) return;
    return this.notifications.notify(p.userId, {
      type: NotificationType.WITHDRAWAL_UPDATED,
      title: t[0],
      body: t[1],
      link: '/wallet',
    });
  }

  private async escrow(tx: Tx, campaign: Campaign) {
    await tx.transaction.create({
      data: {
        userId: campaign.advertiserId,
        type: TransactionType.ESCROW,
        amount: -campaign.budget,
        currency: CURRENCY,
        campaignId: campaign.id,
        note: `Séquestre #${campaign.code}`,
      },
    });
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { fundedAt: new Date() },
    });
  }

  private isFundable(campaign: Campaign) {
    return (
      !campaign.fundedAt &&
      (campaign.status === CampaignStatus.PENDING_REVIEW ||
        campaign.status === CampaignStatus.ACTIVE) &&
      campaign.endsAt > new Date()
    );
  }

  private assertFundable(campaign: Campaign) {
    if (campaign.fundedAt) throw new ConflictException('Campagne déjà payée');
    if (!this.isFundable(campaign)) {
      throw new BadRequestException('Cette campagne ne peut plus être payée');
    }
  }

  /**
   * Withdrawable balance: completed entries already available, minus
   * withdrawals still pending.
   */
  private async balance(tx: Tx, userId: string, now: Date) {
    const [available, pending] = await Promise.all([
      this.sumWith(tx, userId, {
        status: TransactionStatus.COMPLETED,
        availableAt: { lte: now },
      }),
      this.sumWith(tx, userId, {
        status: TransactionStatus.PENDING,
        amount: { lt: 0 },
      }),
    ]);
    return available + pending;
  }

  private sum(userId: string, where: Prisma.TransactionWhereInput) {
    return this.sumWith(this.prisma, userId, where);
  }

  private async sumWith(
    tx: Tx,
    userId: string,
    where: Prisma.TransactionWhereInput,
  ) {
    const result = await tx.transaction.aggregate({
      where: { ...where, userId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  /**
   * Serializes changes inside a database transaction: a user id for balance
   * changes, `campaign:<id>` for a campaign's escrow. Always take the campaign
   * lock before the user lock, so two transactions never wait on each other.
   */
  async lock(tx: Tx, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private async user(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profiles: true },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  private maxLevel(user: { profiles: { level: number }[] }) {
    return Math.max(1, ...user.profiles.map((p) => p.level));
  }

  private phone(
    user: { phone: string | null; country: string },
    input?: string,
  ) {
    if (input) return parsePhone(input, user.country);
    // Accounts created with an email have no number until they add one.
    if (!user.phone) {
      throw new BadRequestException('Indique ton numéro Mobile Money');
    }
    return { e164: user.phone, country: user.country };
  }

  private reference(kind: 'P' | 'R') {
    return `VZ${kind}${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private secondApprovalFrom() {
    return Number(
      this.config.get('PAYOUT_SECOND_APPROVAL_FROM') ??
        DEFAULT_SECOND_APPROVAL_FROM,
    );
  }

  private minWithdrawal() {
    return Number(this.config.get('MIN_WITHDRAWAL') ?? DEFAULT_MIN_WITHDRAWAL);
  }

  private webOrigin() {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000')
      .split(',')[0];
  }

  private notifyUrl(provider: string) {
    const api = this.config.get<string>(
      'API_PUBLIC_URL',
      'http://localhost:3001',
    );
    return `${api}/payments/webhooks/${provider}`;
  }

  private toPaymentView(p: Payment) {
    return {
      id: p.id,
      kind: p.kind,
      reference: p.reference,
      provider: p.provider,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      failureReason: p.failureReason,
      campaignId: p.campaignId,
      checkoutUrl: p.status === PaymentStatus.PROCESSING ? p.checkoutUrl : null,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
    };
  }
}
