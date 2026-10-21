import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  CreatorTaskType,
  LiveMode,
  LivePayoutStatus,
  LiveSaleStatus,
  LiveSessionStatus,
  NotificationType,
  Prisma,
  ProfileType,
  SocialNetwork,
  TransactionType,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  assertCountry,
  assertNotSelf,
  countryScope,
  type StaffActor,
} from '../auth/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { availableAt, LEVEL1_EARNINGS_CAP } from '../wallet/earnings';
import { WalletService } from '../wallet/wallet.service';
import {
  BAN_AFTER_WITHDRAWALS,
  DEFAULT_LIVE_RATES,
  EARLY_START_MS,
  LiveRates,
  livePayout,
  MIN_LIVE_FOLLOWERS,
  MIN_PAID_MINUTES,
  slotCap,
  WITHDRAW_BLOCK_DAYS,
  audienceFlag,
} from './billing';
import type { CreateLiveDto } from './dto/live.dto';
import type {
  LiveRateDto,
  PayoutDecisionDto,
  ReviewLiveDto,
} from './dto/staff-live.dto';
import { LiveRunnerService } from './live-runner.service';
import { LiveService, SESSION_SELECT } from './live.service';

const CURRENCY = 'XOF';
const DAY_MS = 24 * 3600 * 1000;
// Longest period an advertiser may give creators to choose their hour.
const MAX_PERIOD_DAYS = 60;
// A creator's live still running this long after the period is stopped.
const OVERRUN_MS = 3 * 3600 * 1000;
const CLOSE_EVERY_MS = 5 * 60 * 1000;

// Sessions that hold one of the offer's places.
const TAKEN: LiveSessionStatus[] = [
  LiveSessionStatus.INVITED,
  LiveSessionStatus.ACCEPTED,
  LiveSessionStatus.RUNNING,
  LiveSessionStatus.ENDED,
];

type Tx = Prisma.TransactionClient;

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;
const DATE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

const isUniqueError = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export interface CreatorEligibility {
  eligible: boolean;
  // Why the creator cannot accept lives, shown on their screen.
  reason: string | null;
  country: string;
  level: number;
  tiktok: { username: string; followers: number } | null;
}

/**
 * Live offers sold by creators: escrow, review by the team, places, the
 * creators' hours and withdrawals, and the pay of each live.
 */
@Injectable()
export class LiveOffersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveOffersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lives: LiveService,
    private readonly runner: LiveRunnerService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (
      this.config.get('NODE_ENV') === 'test' ||
      this.config.get('JOBS_DISABLED') === 'true'
    ) {
      return;
    }
    this.timer = setInterval(() => {
      this.closeDue().catch((err: Error) =>
        this.logger.warn(`Clôture des lives : ${err.message}`),
      );
    }, CLOSE_EVERY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // --- Prices ----------------------------------------------------------------

  async rates(country: string): Promise<LiveRates> {
    const row = await this.prisma.liveRate.findUnique({ where: { country } });
    return row
      ? {
          advertiserPer100: row.advertiserPer100,
          creatorPer100: row.creatorPer100,
          selfFee: row.selfFee,
        }
      : DEFAULT_LIVE_RATES;
  }

  async listRates() {
    const [rows, countries] = await Promise.all([
      this.prisma.liveRate.findMany({ orderBy: { country: 'asc' } }),
      this.prisma.allowedCountry.findMany({
        where: { enabled: true },
        select: { code: true },
        orderBy: { code: 'asc' },
      }),
    ]);
    const codes = [
      ...new Set([
        ...countries.map((c) => c.code),
        ...rows.map((r) => r.country),
      ]),
    ].sort();
    return {
      defaults: DEFAULT_LIVE_RATES,
      rates: codes.map((country) => {
        const row = rows.find((r) => r.country === country);
        return {
          country,
          custom: Boolean(row),
          advertiserPer100:
            row?.advertiserPer100 ?? DEFAULT_LIVE_RATES.advertiserPer100,
          creatorPer100: row?.creatorPer100 ?? DEFAULT_LIVE_RATES.creatorPer100,
          selfFee: row?.selfFee ?? DEFAULT_LIVE_RATES.selfFee,
        };
      }),
    };
  }

  async setRate(actor: StaffActor, country: string, dto: LiveRateDto) {
    if (dto.creatorPer100 > dto.advertiserPer100) {
      throw new BadRequestException(
        'Le créateur ne peut pas gagner plus que ce que paie l’annonceur',
      );
    }
    const code = country.toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.liveRate.findUnique({ where: { country: code } });
      const after = await tx.liveRate.upsert({
        where: { country: code },
        create: { country: code, ...dto },
        update: dto,
      });
      await this.audit.record(tx, {
        actor,
        action: 'live.rate',
        entity: 'LiveRate',
        entityId: code,
        before,
        after,
      });
      return after;
    });
  }

  // --- Advertiser ------------------------------------------------------------

  async createOffer(sellerId: string, dto: CreateLiveDto) {
    await this.lives.assertSeller(sellerId);
    const productIds = await this.lives.checkProducts(sellerId, dto.productIds);
    const whatsapp = `+${dto.whatsapp.replace(/\D/g, '')}`;
    const startsAt = new Date(dto.startsAt);
    const demo = dto.demo ?? false;

    if (dto.mode === LiveMode.SELF) {
      const seller = await this.prisma.user.findUniqueOrThrow({
        where: { id: sellerId },
        select: { country: true },
      });
      const fee = demo ? 0 : (await this.rates(seller.country)).selfFee;
      // The advertiser's own live: no review, no creators, a service fee.
      return this.prisma.liveSale.create({
        data: {
          sellerId,
          title: dto.title.trim(),
          mode: LiveMode.SELF,
          whatsapp,
          startsAt,
          demo,
          productIds,
          serviceFee: fee,
          status: LiveSaleStatus.ACTIVE,
          sessions: {
            create: {
              tiktokUsername: dto.tiktokUsername!.replace(/^@/, '').trim(),
              status: LiveSessionStatus.ACCEPTED,
              scheduledAt: startsAt,
              acceptedAt: new Date(),
            },
          },
        },
        select: { id: true, status: true, mode: true, serviceFee: true },
      });
    }

    const endsAt = new Date(dto.endsAt!);
    if (endsAt <= startsAt) {
      throw new BadRequestException('La fin doit venir après le début');
    }
    if (endsAt <= new Date()) {
      throw new BadRequestException('La période est déjà passée');
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
      throw new BadRequestException(
        `La période dure au plus ${MAX_PERIOD_DAYS} jours`,
      );
    }
    const slots = dto.slots!;
    const budget = dto.budget!;
    if (budget < slots * 1_000) {
      throw new BadRequestException('Compte au moins 1 000 FCFA par créateur');
    }
    return this.prisma.liveSale.create({
      data: {
        sellerId,
        title: dto.title.trim(),
        mode: LiveMode.CREATORS,
        whatsapp,
        startsAt,
        endsAt,
        slots,
        budget,
        countries: [...new Set(dto.countries)],
        demo,
        productIds,
      },
      select: { id: true, status: true, mode: true, budget: true },
    });
  }

  /** Puts the budget in escrow from the wallet; the team then reviews it. */
  async pay(sellerId: string, liveId: string) {
    await this.lives.ownLive(sellerId, liveId);
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      await this.wallet.lock(tx, sellerId);
      const live = await tx.liveSale.findUniqueOrThrow({
        where: { id: liveId },
      });
      if (
        live.mode !== LiveMode.CREATORS ||
        live.fundedAt ||
        live.status !== LiveSaleStatus.PENDING_PAYMENT
      ) {
        throw new ConflictException('Cette offre est déjà payée');
      }
      if (live.endsAt && live.endsAt <= new Date()) {
        throw new ConflictException('La période de cette offre est passée');
      }
      const balance = await this.wallet.spendable(tx, sellerId);
      if (balance < live.budget) {
        throw new BadRequestException(
          `Solde insuffisant : recharge ${fcfa(live.budget - balance)}`,
        );
      }
      await tx.transaction.create({
        data: {
          userId: sellerId,
          type: TransactionType.ESCROW,
          amount: -live.budget,
          currency: CURRENCY,
          liveId,
          note: `Séquestre live « ${live.title} »`,
        },
      });
      await tx.liveSale.update({
        where: { id: liveId },
        data: { fundedAt: new Date(), status: LiveSaleStatus.PENDING_REVIEW },
      });
    });
    return { funded: true as const };
  }

  /** The advertiser withdraws an offer nobody is selling right now. */
  async cancelOwn(sellerId: string, liveId: string) {
    await this.lives.ownLive(sellerId, liveId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const live = await tx.liveSale.findUniqueOrThrow({
        where: { id: liveId },
        include: { sessions: true },
      });
      const closed: LiveSaleStatus[] = [
        LiveSaleStatus.COMPLETED,
        LiveSaleStatus.REJECTED,
        LiveSaleStatus.CANCELLED,
      ];
      if (closed.includes(live.status)) {
        throw new ConflictException('Cette offre est déjà finie');
      }
      if (
        live.sessions.some(
          (s) =>
            s.status === LiveSessionStatus.RUNNING ||
            s.payout === LivePayoutStatus.TO_REVIEW,
        )
      ) {
        throw new ConflictException(
          'Un live de cette offre est en cours ou en vérification',
        );
      }
      if (
        live.mode === LiveMode.SELF &&
        live.sessions.some((s) => s.status === LiveSessionStatus.ENDED)
      ) {
        throw new ConflictException('Ce live est déjà fait');
      }
      const waiting = live.sessions.filter(
        (s) =>
          s.status === LiveSessionStatus.INVITED ||
          s.status === LiveSessionStatus.ACCEPTED,
      );
      await tx.liveSession.updateMany({
        where: { id: { in: waiting.map((s) => s.id) } },
        data: { status: LiveSessionStatus.CANCELLED },
      });
      await tx.liveSale.update({
        where: { id: liveId },
        data: {
          status: LiveSaleStatus.CANCELLED,
          completedAt: new Date(),
        },
      });
      const refunded = await this.refundRemaining(tx, liveId);
      return {
        refunded,
        title: live.title,
        creators: waiting
          .map((s) => s.creatorId)
          .filter((id): id is string => Boolean(id)),
      };
    });
    await this.notifications.notifyMany(result.creators, {
      type: NotificationType.LIVE_UPDATED,
      title: `Live annulé : ${result.title}`,
      body: 'L’annonceur a annulé cette offre. Cela ne compte pas contre toi.',
      link: '/lives',
    });
    return { cancelled: true as const, refunded: result.refunded };
  }

  /** Creators the advertiser can invite to an approved offer. */
  async candidates(sellerId: string, liveId: string) {
    const live = await this.lives.ownLive(sellerId, liveId);
    if (live.mode !== LiveMode.CREATORS) return [];
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: sellerId },
        country: { in: live.countries },
        profiles: { some: { type: ProfileType.CREATOR } },
        skills: { taskTypes: { has: CreatorTaskType.LIVE_SELLING } },
        accounts: {
          some: {
            network: SocialNetwork.TIKTOK,
            status: AccountStatus.ELIGIBLE,
            followers: { gte: MIN_LIVE_FOLLOWERS },
          },
        },
        liveSessions: { none: { liveId } },
        OR: [
          { liveStanding: { is: null } },
          {
            liveStanding: {
              bannedAt: null,
              OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
            },
          },
        ],
      },
      select: {
        id: true,
        firstName: true,
        country: true,
        accounts: {
          where: {
            network: SocialNetwork.TIKTOK,
            status: AccountStatus.ELIGIBLE,
          },
          select: { handleKey: true, followers: true },
          orderBy: { followers: 'desc' },
          take: 1,
        },
      },
      take: 200,
    });
    return users
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        country: u.country,
        tiktokUsername: u.accounts[0]?.handleKey ?? '',
        followers: u.accounts[0]?.followers ?? 0,
      }))
      .sort((a, b) => b.followers - a.followers)
      .slice(0, 50);
  }

  async invite(sellerId: string, liveId: string, creatorId: string) {
    await this.lives.ownLive(sellerId, liveId);
    const ctx = await this.eligibility(creatorId);
    const session = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const live = await this.openOffer(tx, liveId);
      if (creatorId === sellerId || !ctx.eligible || !ctx.tiktok) {
        throw new ForbiddenException(
          'Ce créateur ne peut pas recevoir d’invitation',
        );
      }
      if (!live.countries.includes(ctx.country)) {
        throw new ForbiddenException('Ce créateur n’est pas dans tes pays');
      }
      await this.assertPlaceLeft(tx, live);
      try {
        return await tx.liveSession.create({
          data: {
            liveId,
            creatorId,
            tiktokUsername: ctx.tiktok.username,
            followers: ctx.tiktok.followers,
            status: LiveSessionStatus.INVITED,
            invitedAt: new Date(),
          },
          select: SESSION_SELECT,
        });
      } catch (e) {
        if (isUniqueError(e)) {
          throw new ConflictException('Ce créateur est déjà sur cette offre');
        }
        throw e;
      }
    });
    await this.notifications.notify(creatorId, {
      type: NotificationType.LIVE_UPDATED,
      title: 'Invitation à un live de vente',
      body: 'Un annonceur t’invite à vendre ses produits en live TikTok. Choisis ton heure pour accepter.',
      link: '/lives',
    });
    return session;
  }

  // --- Creator ---------------------------------------------------------------

  /** Whether the creator may accept lives, and why not. */
  async eligibility(userId: string): Promise<CreatorEligibility> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        country: true,
        profiles: { where: { type: ProfileType.CREATOR } },
        skills: { select: { taskTypes: true } },
        liveStanding: true,
        accounts: {
          where: {
            network: SocialNetwork.TIKTOK,
            status: AccountStatus.ELIGIBLE,
          },
          select: { handleKey: true, followers: true },
          orderBy: { followers: 'desc' },
          take: 1,
        },
      },
    });
    const account = user.accounts[0];
    const tiktok = account
      ? { username: account.handleKey, followers: account.followers ?? 0 }
      : null;
    const base = {
      country: user.country,
      level: user.profiles[0]?.level ?? 1,
      tiktok,
    };
    const no = (reason: string) => ({ ...base, eligible: false, reason });
    const standing = user.liveStanding;
    if (!user.profiles.length) return no('Active d’abord le profil Créateur.');
    if (standing?.bannedAt) {
      return no(
        `Tu ne peux plus accepter de lives après ${BAN_AFTER_WITHDRAWALS} retraits de suite.`,
      );
    }
    if (standing?.blockedUntil && standing.blockedUntil > new Date()) {
      return no(
        `Après ton retrait, tu pourras à nouveau accepter des lives le ${DATE.format(standing.blockedUntil)}.`,
      );
    }
    if (!user.skills?.taskTypes.includes(CreatorTaskType.LIVE_SELLING)) {
      return no(
        'Ajoute la compétence « Faire des lives de vente » à ton profil.',
      );
    }
    if (!tiktok) return no('Ajoute un compte TikTok vérifié.');
    if (tiktok.followers < MIN_LIVE_FOLLOWERS) {
      return no(
        `Il faut au moins ${MIN_LIVE_FOLLOWERS.toLocaleString('fr-FR')} abonnés TikTok.`,
      );
    }
    return { ...base, eligible: true, reason: null };
  }

  /** Open offers, invitations and the creator's own lives. */
  async creatorHome(userId: string) {
    const ctx = await this.eligibility(userId);
    const now = new Date();
    const [offers, sessions] = await Promise.all([
      this.prisma.liveSale.findMany({
        where: {
          mode: LiveMode.CREATORS,
          status: LiveSaleStatus.ACTIVE,
          fundedAt: { not: null },
          endsAt: { gt: now },
          countries: { has: ctx.country },
          sellerId: { not: userId },
          sessions: { none: { creatorId: userId } },
        },
        include: {
          seller: { select: { firstName: true } },
          _count: {
            select: { sessions: { where: { status: { in: TAKEN } } } },
          },
        },
        orderBy: { startsAt: 'asc' },
        take: ctx.eligible ? 100 : 0,
      }),
      this.prisma.liveSession.findMany({
        where: { creatorId: userId },
        include: {
          live: {
            include: { seller: { select: { firstName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    const rates = await this.rates(ctx.country);
    const offerView = async (
      live: Prisma.LiveSaleGetPayload<{
        include: { seller: { select: { firstName: true } } };
      }>,
    ) => ({
      id: live.id,
      title: live.title,
      shop: live.seller.firstName,
      startsAt: live.startsAt,
      endsAt: live.endsAt,
      slots: live.slots,
      demo: live.demo,
      ratePer100: live.demo ? 0 : rates.creatorPer100,
      // Most a creator can earn on this offer.
      maxEarning: live.demo
        ? 0
        : Math.floor(
            (slotCap(live.budget, live.slots) * rates.creatorPer100) /
              rates.advertiserPer100,
          ),
      products: (await this.lives.catalog(live.id)).map((p) => ({
        name: p.name,
        price: p.price,
      })),
    });
    return {
      eligibility: ctx,
      rules: {
        minFollowers: MIN_LIVE_FOLLOWERS,
        minMinutes: MIN_PAID_MINUTES,
        blockDays: WITHDRAW_BLOCK_DAYS,
        banAfter: BAN_AFTER_WITHDRAWALS,
      },
      offers: await Promise.all(
        offers
          .filter((o) => o._count.sessions < o.slots)
          .map(async (o) => ({
            ...(await offerView(o)),
            placesLeft: o.slots - o._count.sessions,
          })),
      ),
      sessions: await Promise.all(
        sessions.map(async (s) => ({
          id: s.id,
          status: s.status,
          scheduledAt: s.scheduledAt,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          peakViewers: s.peakViewers,
          payout: s.payout,
          earned: s.earned,
          payoutReason: s.payoutReason,
          offer: await offerView(s.live),
        })),
      ),
    };
  }

  /** The creator's live screen: their buyers only, and the shop's contact. */
  async creatorBoard(userId: string, sessionId: string) {
    const session = await this.ownSession(userId, sessionId);
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: session.liveId },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        demo: true,
        status: true,
        whatsapp: true,
        seller: { select: { firstName: true } },
      },
    });
    const board = await this.lives.board(live.id, live.whatsapp, sessionId);
    return {
      live: { ...live, whatsapp: undefined, shop: live.seller.firstName },
      session: board.sessions[0],
      running: this.runner.isRunning(sessionId),
      ai: this.runner.usesAi,
      stats: board.stats,
      leads: board.leads,
      comments: board.comments,
      products: board.products,
    };
  }

  async accept(userId: string, liveId: string, scheduledAt: string) {
    const ctx = await this.eligibility(userId);
    if (!ctx.eligible || !ctx.tiktok) {
      throw new ForbiddenException(ctx.reason ?? 'Live indisponible');
    }
    const at = new Date(scheduledAt);
    const session = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const live = await this.openOffer(tx, liveId);
      if (live.sellerId === userId) {
        throw new ForbiddenException(
          'Tu ne peux pas accepter tes propres offres',
        );
      }
      if (!live.countries.includes(ctx.country)) {
        throw new ForbiddenException('Cette offre n’est pas pour ton pays');
      }
      this.assertInPeriod(live, at);
      await this.assertPlaceLeft(tx, live);
      try {
        return await tx.liveSession.create({
          data: {
            liveId,
            creatorId: userId,
            tiktokUsername: ctx.tiktok!.username,
            followers: ctx.tiktok!.followers,
            status: LiveSessionStatus.ACCEPTED,
            scheduledAt: at,
            acceptedAt: new Date(),
          },
          select: SESSION_SELECT,
        });
      } catch (e) {
        if (isUniqueError(e)) {
          throw new ConflictException('Tu es déjà sur cette offre');
        }
        throw e;
      }
    });
    await this.tellSeller(liveId, `@${session.tiktokUsername} a accepté`, at);
    return session;
  }

  async respond(
    userId: string,
    sessionId: string,
    accept: boolean,
    scheduledAt?: string,
  ) {
    const session = await this.ownSession(userId, sessionId);
    if (session.status !== LiveSessionStatus.INVITED) {
      throw new ConflictException('Invitation déjà traitée');
    }
    if (!accept) {
      await this.prisma.liveSession.updateMany({
        where: { id: sessionId, status: LiveSessionStatus.INVITED },
        data: { status: LiveSessionStatus.DECLINED },
      });
      await this.tellSeller(
        session.liveId,
        `@${session.tiktokUsername} a refusé l’invitation`,
      );
      return { status: LiveSessionStatus.DECLINED };
    }
    const ctx = await this.eligibility(userId);
    if (!ctx.eligible || !ctx.tiktok) {
      throw new ForbiddenException(ctx.reason ?? 'Live indisponible');
    }
    const at = new Date(scheduledAt!);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${session.liveId}`);
      const live = await this.openOffer(tx, session.liveId);
      this.assertInPeriod(live, at);
      const claimed = await tx.liveSession.updateMany({
        where: { id: sessionId, status: LiveSessionStatus.INVITED },
        data: {
          status: LiveSessionStatus.ACCEPTED,
          scheduledAt: at,
          acceptedAt: new Date(),
          tiktokUsername: ctx.tiktok!.username,
          followers: ctx.tiktok!.followers,
        },
      });
      if (!claimed.count)
        throw new ConflictException('Invitation déjà traitée');
      return tx.liveSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: SESSION_SELECT,
      });
    });
    await this.tellSeller(
      session.liveId,
      `@${updated.tiktokUsername} a accepté ton invitation`,
      at,
    );
    return updated;
  }

  async reschedule(userId: string, sessionId: string, scheduledAt: string) {
    const session = await this.ownSession(userId, sessionId);
    if (session.status !== LiveSessionStatus.ACCEPTED) {
      throw new ConflictException('Seul un live pas encore commencé change');
    }
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: session.liveId },
    });
    const at = new Date(scheduledAt);
    this.assertInPeriod(live, at);
    const updated = await this.prisma.liveSession.update({
      where: { id: sessionId },
      data: { scheduledAt: at },
      select: SESSION_SELECT,
    });
    await this.tellSeller(
      session.liveId,
      `@${updated.tiktokUsername} a changé son heure`,
      at,
    );
    return updated;
  }

  /** Leaving an accepted live: 10 days without lives, banned after three. */
  async withdraw(userId: string, sessionId: string) {
    const session = await this.ownSession(userId, sessionId);
    if (session.status !== LiveSessionStatus.ACCEPTED) {
      throw new ConflictException('Seul un live pas encore commencé se quitte');
    }
    const standing = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${session.liveId}`);
      const claimed = await tx.liveSession.updateMany({
        where: { id: sessionId, status: LiveSessionStatus.ACCEPTED },
        data: { status: LiveSessionStatus.WITHDRAWN },
      });
      if (!claimed.count) throw new ConflictException('Live déjà commencé');
      return this.penalize(tx, userId);
    });
    await this.tellSeller(
      session.liveId,
      `@${session.tiktokUsername} s’est retiré : une place est libre`,
    );
    return { status: LiveSessionStatus.WITHDRAWN, ...standing };
  }

  // --- Running a live --------------------------------------------------------

  async startAsCreator(userId: string, sessionId: string) {
    const session = await this.ownSession(userId, sessionId);
    return this.start(session.id);
  }

  async stopAsCreator(userId: string, sessionId: string) {
    const session = await this.ownSession(userId, sessionId);
    return this.stop(session.id);
  }

  /** The advertiser's own live, started from the offer screen. */
  async startSelf(sellerId: string, liveId: string) {
    return this.start(await this.selfSession(sellerId, liveId));
  }

  async stopSelf(sellerId: string, liveId: string) {
    return this.stop(await this.selfSession(sellerId, liveId));
  }

  private async selfSession(sellerId: string, liveId: string) {
    const live = await this.lives.ownLive(sellerId, liveId);
    if (live.mode !== LiveMode.SELF) {
      throw new ForbiddenException('Ce sont les créateurs qui font ce live');
    }
    const session = await this.prisma.liveSession.findFirst({
      where: { liveId, creatorId: null },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Live introuvable');
    return session.id;
  }

  private async start(sessionId: string) {
    const session = await this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { live: true },
    });
    const { live } = session;
    if (
      session.status !== LiveSessionStatus.ACCEPTED &&
      session.status !== LiveSessionStatus.RUNNING
    ) {
      throw new ConflictException('Ce live est fini');
    }
    if (live.status !== LiveSaleStatus.ACTIVE) {
      throw new ConflictException('Cette offre n’est pas ouverte');
    }
    const now = Date.now();
    if (live.mode === LiveMode.CREATORS) {
      if (now < live.startsAt.getTime() - EARLY_START_MS) {
        throw new ConflictException(
          'La période de cette offre n’a pas encore commencé',
        );
      }
      if (live.endsAt && now >= live.endsAt.getTime()) {
        throw new ConflictException('La période de cette offre est finie');
      }
    }
    if (session.status === LiveSessionStatus.ACCEPTED) {
      if (live.mode === LiveMode.SELF) {
        await this.chargeServiceFee(session.id);
      } else {
        const claimed = await this.prisma.liveSession.updateMany({
          where: { id: sessionId, status: LiveSessionStatus.ACCEPTED },
          data: { status: LiveSessionStatus.RUNNING },
        });
        if (!claimed.count) throw new ConflictException('Live déjà commencé');
      }
      await this.lives.markStarted(sessionId);
    }
    const running = await this.runner.start({
      id: session.id,
      liveId: live.id,
      tiktokUsername: session.tiktokUsername,
      demo: live.demo,
      peakViewers: session.peakViewers,
    });
    const fresh = await this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
    return { ...fresh, running };
  }

  /** Takes the fee of the advertiser's own live, once, at its first start. */
  private async chargeServiceFee(sessionId: string) {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.liveSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: { live: true },
      });
      const { live } = session;
      await this.wallet.lock(tx, `live:${live.id}`);
      await this.wallet.lock(tx, live.sellerId);
      const claimed = await tx.liveSession.updateMany({
        where: { id: sessionId, status: LiveSessionStatus.ACCEPTED },
        data: { status: LiveSessionStatus.RUNNING },
      });
      if (!claimed.count) throw new ConflictException('Live déjà commencé');
      const fee = live.serviceFee ?? 0;
      if (fee <= 0) return;
      const balance = await this.wallet.spendable(tx, live.sellerId);
      if (balance < fee) {
        throw new BadRequestException(
          `Solde insuffisant : le service de lecture des commentaires coûte ${fcfa(fee)}. Recharge ${fcfa(fee - balance)}.`,
        );
      }
      await tx.transaction.create({
        data: {
          userId: live.sellerId,
          type: TransactionType.COMMISSION,
          amount: -fee,
          currency: CURRENCY,
          liveId: live.id,
          liveSessionId: sessionId,
          note: `Lecture des commentaires · live « ${live.title} »`,
        },
      });
    });
  }

  private async stop(sessionId: string) {
    const session = await this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { status: true },
    });
    if (session.status !== LiveSessionStatus.RUNNING) {
      throw new ConflictException('Ce live n’est pas en cours');
    }
    await this.runner.detach(sessionId);
    await this.lives.markEnded(sessionId);
    await this.settle(sessionId);
    return this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
  }

  /**
   * Pays a finished creator's live from the escrow: per 100 viewers at the
   * peak, at the creator's country rate, at most the slot's share. Unusual
   * audiences wait for the team.
   */
  private async settle(sessionId: string) {
    const session = await this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { live: true },
    });
    const { live } = session;
    if (live.mode === LiveMode.SELF) {
      await this.prisma.liveSale.updateMany({
        where: { id: live.id, status: LiveSaleStatus.ACTIVE },
        data: { status: LiveSaleStatus.COMPLETED, completedAt: new Date() },
      });
      return;
    }
    if (!session.creatorId) return;
    const minutes = this.minutes(session);
    if (minutes >= MIN_PAID_MINUTES) {
      await this.prisma.liveCreatorStanding.updateMany({
        where: { userId: session.creatorId },
        data: { withdrawStreak: 0 },
      });
    }
    const flag = audienceFlag({
      peakViewers: session.peakViewers,
      followers: session.followers,
      spike: Boolean(session.flag),
    });
    if (flag && !live.demo && minutes >= MIN_PAID_MINUTES) {
      await this.prisma.liveSession.update({
        where: { id: sessionId },
        data: {
          flag,
          payout: LivePayoutStatus.TO_REVIEW,
          payoutReason: 'Audience à vérifier par l’équipe avant paiement',
        },
      });
      await this.notifications.notify(session.creatorId, {
        type: NotificationType.LIVE_UPDATED,
        title: `Live terminé : ${live.title}`,
        body: 'L’équipe vérifie ton audience avant de te payer.',
        link: '/lives',
      });
      return;
    }
    const earned = await this.payCreator(sessionId, session.peakViewers, null);
    await this.notifications.notify(session.creatorId, {
      type: NotificationType.LIVE_UPDATED,
      title: `Live terminé : ${live.title}`,
      body:
        earned > 0
          ? `${fcfa(earned)} gagnés pour ${session.peakViewers.toLocaleString('fr-FR')} spectateurs au plus fort.`
          : (this.noPayReason(live.demo, minutes, session.peakViewers) ??
            'Pas de gain pour ce live.'),
      link: '/lives',
    });
  }

  private minutes(s: { startedAt: Date | null; endedAt: Date | null }) {
    if (!s.startedAt || !s.endedAt) return 0;
    return (s.endedAt.getTime() - s.startedAt.getTime()) / 60_000;
  }

  private noPayReason(demo: boolean, minutes: number, peak: number) {
    if (demo) return 'Live de démonstration : pas de paiement.';
    if (minutes < MIN_PAID_MINUTES) {
      return `Live de moins de ${MIN_PAID_MINUTES} minutes : pas de paiement.`;
    }
    if (peak < 100) return 'Moins de 100 spectateurs : pas de paiement.';
    return null;
  }

  /** Credits the creator and takes the cost from the escrow. */
  private async payCreator(
    sessionId: string,
    peakViewers: number,
    actor: StaffActor | null,
    reason?: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const head = await tx.liveSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { liveId: true, creatorId: true },
      });
      await this.wallet.lock(tx, `live:${head.liveId}`);
      await this.wallet.lock(tx, head.creatorId!);
      const session = await tx.liveSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: {
          live: true,
          creator: {
            select: {
              country: true,
              profiles: { where: { type: ProfileType.CREATOR } },
            },
          },
        },
      });
      const { live, creator } = session;
      if (
        session.payout === LivePayoutStatus.PAID ||
        session.payout === LivePayoutStatus.REFUSED
      ) {
        throw new ConflictException('Ce live est déjà réglé');
      }
      const minutes = this.minutes(session);
      const rates = await this.rates(creator!.country);
      const remaining = live.budget - live.spent - live.refunded;
      const { cost, earned: due } = live.demo
        ? { cost: 0, earned: 0 }
        : livePayout({
            peakViewers,
            minutes,
            rates,
            cap: Math.min(slotCap(live.budget, live.slots), remaining),
          });
      const level = creator!.profiles[0]?.level ?? 1;
      let earned = due;
      if (level < 2 && earned > 0) {
        const total = await this.wallet.earningsSoFar(tx, session.creatorId!);
        earned = Math.min(earned, Math.max(0, LEVEL1_EARNINGS_CAP - total));
      }
      const payoutReason =
        reason ??
        this.noPayReason(live.demo, minutes, peakViewers) ??
        (earned < due ? 'Plafond des gains du niveau 1 atteint' : null);
      await tx.liveSession.update({
        where: { id: sessionId },
        data: {
          peakViewers,
          cost,
          earned,
          payout: cost > 0 ? LivePayoutStatus.PAID : LivePayoutStatus.NONE,
          payoutReason,
        },
      });
      if (cost > 0) {
        await tx.liveSale.update({
          where: { id: live.id },
          data: { spent: { increment: cost } },
        });
      }
      if (earned > 0) {
        await tx.transaction.create({
          data: {
            userId: session.creatorId!,
            type: TransactionType.EARNING,
            amount: earned,
            currency: CURRENCY,
            availableAt: availableAt(level),
            liveId: live.id,
            liveSessionId: sessionId,
            note: `Live « ${live.title} » · ${peakViewers} spectateurs`,
          },
        });
      }
      if (actor) {
        await this.audit.record(tx, {
          actor,
          action: 'live.payout',
          entity: 'LiveSession',
          entityId: sessionId,
          before: {
            payout: session.payout,
            peakViewers: session.peakViewers,
          },
          after: { payout: LivePayoutStatus.PAID, peakViewers, cost, earned },
          reason: reason ?? null,
        });
      }
      return earned;
    });
  }

  // --- Closing ---------------------------------------------------------------

  /**
   * Offers whose period is over: unanswered invitations lapse, accepted lives
   * never started count as withdrawals, overrunning lives stop, and once no
   * live waits for the team the unspent escrow goes back to the advertiser.
   */
  async closeDue(now = new Date()) {
    const due = await this.prisma.liveSale.findMany({
      where: {
        mode: LiveMode.CREATORS,
        status: LiveSaleStatus.ACTIVE,
        endsAt: { lte: now },
      },
      select: { id: true, endsAt: true },
    });
    let closed = 0;
    for (const live of due) {
      const sessions = await this.prisma.liveSession.findMany({
        where: { liveId: live.id },
        select: {
          id: true,
          status: true,
          creatorId: true,
          payout: true,
          startedAt: true,
        },
      });
      for (const s of sessions) {
        if (
          s.status === LiveSessionStatus.RUNNING &&
          live.endsAt!.getTime() + OVERRUN_MS <= now.getTime()
        ) {
          await this.stop(s.id).catch((err: Error) =>
            this.logger.warn(`Live ${s.id}: ${err.message}`),
          );
        }
      }
      const lapsed = await this.prisma.$transaction(async (tx) => {
        await this.wallet.lock(tx, `live:${live.id}`);
        await tx.liveSession.updateMany({
          where: { liveId: live.id, status: LiveSessionStatus.INVITED },
          data: { status: LiveSessionStatus.DECLINED },
        });
        const missed = await tx.liveSession.findMany({
          where: { liveId: live.id, status: LiveSessionStatus.ACCEPTED },
          select: { id: true, creatorId: true },
        });
        for (const m of missed) {
          await tx.liveSession.update({
            where: { id: m.id },
            data: { status: LiveSessionStatus.MISSED },
          });
          if (m.creatorId) await this.penalize(tx, m.creatorId);
        }
        return missed
          .map((m) => m.creatorId)
          .filter((id): id is string => !!id);
      });
      await this.notifications.notifyMany(lapsed, {
        type: NotificationType.LIVE_UPDATED,
        title: 'Live non fait',
        body: `Tu n’as pas fait le live accepté : cela compte comme un retrait (${WITHDRAW_BLOCK_DAYS} jours sans live).`,
        link: '/lives',
      });
      if (await this.complete(live.id, now)) closed += 1;
    }
    return closed;
  }

  /** Closes an offer once no live runs or waits for the team. */
  private async complete(liveId: string, now: Date) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const busy = await tx.liveSession.count({
        where: {
          liveId,
          OR: [
            { status: LiveSessionStatus.RUNNING },
            { payout: LivePayoutStatus.TO_REVIEW },
          ],
        },
      });
      if (busy) return null;
      const claimed = await tx.liveSale.updateMany({
        where: { id: liveId, status: LiveSaleStatus.ACTIVE },
        data: { status: LiveSaleStatus.COMPLETED, completedAt: now },
      });
      if (!claimed.count) return null;
      const refunded = await this.refundRemaining(tx, liveId);
      await this.audit.record(tx, {
        actor: null,
        action: 'live.complete',
        entity: 'LiveSale',
        entityId: liveId,
        before: { status: LiveSaleStatus.ACTIVE },
        after: { status: LiveSaleStatus.COMPLETED, refunded },
      });
      return tx.liveSale
        .findUniqueOrThrow({
          where: { id: liveId },
          select: { sellerId: true, title: true, spent: true },
        })
        .then((l) => ({ ...l, refunded }));
    });
    if (!result) return false;
    await this.notifications.notify(result.sellerId, {
      type: NotificationType.LIVE_UPDATED,
      title: `Offre terminée : ${result.title}`,
      body:
        result.refunded > 0
          ? `${fcfa(result.spent)} payés aux créateurs, ${fcfa(result.refunded)} non dépensés reviennent sur ton solde.`
          : `${fcfa(result.spent)} payés aux créateurs.`,
      link: `/live/${liveId}`,
    });
    return true;
  }

  private async refundRemaining(tx: Tx, liveId: string) {
    const live = await tx.liveSale.findUniqueOrThrow({ where: { id: liveId } });
    if (!live.fundedAt) return 0;
    const remaining = live.budget - live.spent - live.refunded;
    if (remaining <= 0) return 0;
    await this.wallet.lock(tx, live.sellerId);
    await tx.liveSale.update({
      where: { id: liveId },
      data: { refunded: { increment: remaining } },
    });
    await tx.transaction.create({
      data: {
        userId: live.sellerId,
        type: TransactionType.REFUND,
        amount: remaining,
        currency: CURRENCY,
        liveId,
        note: `Budget non dépensé · live « ${live.title} »`,
      },
    });
    return remaining;
  }

  // --- Back-office -----------------------------------------------------------

  async review(actor: StaffActor, liveId: string, dto: ReviewLiveDto) {
    const live = await this.prisma.liveSale.findUnique({
      where: { id: liveId },
    });
    if (!live) throw new NotFoundException('Offre introuvable');
    assertCountry(actor, live.countries);
    assertNotSelf(actor, live.sellerId);
    const reason = dto.reason?.trim() || null;
    if (dto.status === LiveSaleStatus.REJECTED && !reason) {
      throw new BadRequestException('Donne la raison du refus');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const claimed = await tx.liveSale.updateMany({
        where: { id: liveId, status: LiveSaleStatus.PENDING_REVIEW },
        data: {
          status: dto.status,
          statusReason: reason,
          ...(dto.status === LiveSaleStatus.REJECTED
            ? { completedAt: new Date() }
            : {}),
        },
      });
      if (!claimed.count) throw new ConflictException('Offre déjà traitée');
      const refunded =
        dto.status === LiveSaleStatus.REJECTED
          ? await this.refundRemaining(tx, liveId)
          : 0;
      await this.audit.record(tx, {
        actor,
        action:
          dto.status === LiveSaleStatus.ACTIVE ? 'live.approve' : 'live.reject',
        entity: 'LiveSale',
        entityId: liveId,
        before: { status: live.status },
        after: { status: dto.status, refunded },
        reason,
      });
    });
    await this.notifications.notify(live.sellerId, {
      type: NotificationType.LIVE_UPDATED,
      title:
        dto.status === LiveSaleStatus.ACTIVE
          ? `Offre validée : ${live.title}`
          : `Offre refusée : ${live.title}`,
      body:
        dto.status === LiveSaleStatus.ACTIVE
          ? 'Les créateurs peuvent maintenant l’accepter. Tu peux aussi en inviter.'
          : `${reason} Le budget en séquestre revient sur ton solde.`,
      link: `/live/${liveId}`,
    });
    if (dto.status === LiveSaleStatus.ACTIVE) {
      await this.notifyCreators(liveId);
    }
    return this.prisma.liveSale.findUniqueOrThrow({
      where: { id: liveId },
      select: { id: true, status: true, statusReason: true },
    });
  }

  /** Tells the creators who may accept an offer that just opened. */
  private async notifyCreators(liveId: string) {
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: liveId },
    });
    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: live.sellerId },
        country: { in: live.countries },
        profiles: { some: { type: ProfileType.CREATOR } },
        skills: { taskTypes: { has: CreatorTaskType.LIVE_SELLING } },
        accounts: {
          some: {
            network: SocialNetwork.TIKTOK,
            status: AccountStatus.ELIGIBLE,
            followers: { gte: MIN_LIVE_FOLLOWERS },
          },
        },
        OR: [
          { liveStanding: { is: null } },
          {
            liveStanding: {
              bannedAt: null,
              OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
            },
          },
        ],
      },
      select: { id: true },
      take: 2000,
    });
    await this.notifications.notifyMany(
      users.map((u) => u.id),
      {
        type: NotificationType.LIVE_UPDATED,
        title: `Nouveau live de vente : ${live.title}`,
        body: `${live.slots} place${live.slots > 1 ? 's' : ''}. Accepte et choisis ton heure avant les autres.`,
        link: '/lives',
      },
    );
  }

  /** The team stops an offer (fraud, complaint); its lives end at once. */
  async staffCancel(actor: StaffActor, liveId: string, reason: string) {
    const live = await this.prisma.liveSale.findUnique({
      where: { id: liveId },
      include: { seller: { select: { country: true } }, sessions: true },
    });
    if (!live) throw new NotFoundException('Live introuvable');
    assertCountry(actor, live.seller.country);
    assertNotSelf(actor, live.sellerId);
    const closed: LiveSaleStatus[] = [
      LiveSaleStatus.COMPLETED,
      LiveSaleStatus.REJECTED,
      LiveSaleStatus.CANCELLED,
    ];
    if (closed.includes(live.status)) {
      throw new ConflictException('Ce live est déjà fini');
    }
    for (const s of live.sessions) {
      if (s.status === LiveSessionStatus.RUNNING)
        await this.runner.detach(s.id);
    }
    const creators = await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `live:${liveId}`);
      const open = await tx.liveSession.findMany({
        where: {
          liveId,
          status: {
            in: [
              LiveSessionStatus.INVITED,
              LiveSessionStatus.ACCEPTED,
              LiveSessionStatus.RUNNING,
            ],
          },
        },
        select: { id: true, creatorId: true, startedAt: true },
      });
      for (const s of open) {
        await tx.liveSession.update({
          where: { id: s.id },
          data: {
            status: LiveSessionStatus.CANCELLED,
            endedAt: s.startedAt ? new Date() : null,
            sourceState: 'stopped',
            sourceMessage: 'Live arrêté par l’équipe Viewzo.',
          },
        });
      }
      await tx.liveSession.updateMany({
        where: { liveId, payout: LivePayoutStatus.TO_REVIEW },
        data: { payout: LivePayoutStatus.REFUSED, payoutReason: reason },
      });
      await tx.liveSale.update({
        where: { id: liveId },
        data: {
          status: LiveSaleStatus.CANCELLED,
          statusReason: reason,
          completedAt: new Date(),
        },
      });
      const refunded = await this.refundRemaining(tx, liveId);
      await this.audit.record(tx, {
        actor,
        action: 'live.cancel',
        entity: 'LiveSale',
        entityId: liveId,
        before: { status: live.status },
        after: { status: LiveSaleStatus.CANCELLED, refunded },
        reason,
      });
      return open.map((s) => s.creatorId).filter((id): id is string => !!id);
    });
    await this.notifications.notify(live.sellerId, {
      type: NotificationType.LIVE_UPDATED,
      title: `Offre arrêtée : ${live.title}`,
      body: reason,
      link: `/live/${liveId}`,
    });
    await this.notifications.notifyMany(creators, {
      type: NotificationType.LIVE_UPDATED,
      title: `Live arrêté : ${live.title}`,
      body: 'L’équipe Viewzo a arrêté cette offre. Cela ne compte pas contre toi.',
      link: '/lives',
    });
    return this.prisma.liveSale.findUniqueOrThrow({
      where: { id: liveId },
      select: { id: true, status: true, statusReason: true },
    });
  }

  staffSessions(actor: StaffActor, payout?: LivePayoutStatus) {
    const scope = countryScope(actor);
    return this.prisma.liveSession.findMany({
      where: {
        creatorId: { not: null },
        ...(payout ? { payout } : {}),
        ...(scope ? { creator: { country: { in: scope } } } : {}),
      },
      select: {
        ...SESSION_SELECT,
        creator: { select: { id: true, firstName: true, country: true } },
        live: { select: { id: true, title: true, demo: true } },
      },
      orderBy: { endedAt: 'desc' },
      take: 200,
    });
  }

  /** The team decides on a live whose audience looked unusual. */
  async decidePayout(
    actor: StaffActor,
    sessionId: string,
    dto: PayoutDecisionDto,
  ) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id: sessionId },
      include: {
        creator: { select: { country: true } },
        live: { select: { title: true, sellerId: true } },
      },
    });
    if (!session || !session.creatorId) {
      throw new NotFoundException('Live introuvable');
    }
    assertCountry(actor, session.creator!.country);
    assertNotSelf(actor, session.creatorId);
    assertNotSelf(actor, session.live.sellerId);
    if (session.payout !== LivePayoutStatus.TO_REVIEW) {
      throw new ConflictException('Ce live est déjà réglé');
    }
    const reason = dto.reason?.trim() || null;
    let earned = 0;
    if (dto.decision === 'PAY') {
      earned = await this.payCreator(
        sessionId,
        dto.peakViewers ?? session.peakViewers,
        actor,
        reason,
      );
    } else {
      if (!reason) throw new BadRequestException('Donne la raison du refus');
      await this.prisma.$transaction(async (tx) => {
        await this.wallet.lock(tx, `live:${session.liveId}`);
        const claimed = await tx.liveSession.updateMany({
          where: { id: sessionId, payout: LivePayoutStatus.TO_REVIEW },
          data: { payout: LivePayoutStatus.REFUSED, payoutReason: reason },
        });
        if (!claimed.count)
          throw new ConflictException('Ce live est déjà réglé');
        await this.audit.record(tx, {
          actor,
          action: 'live.payout.refuse',
          entity: 'LiveSession',
          entityId: sessionId,
          before: { payout: session.payout },
          after: { payout: LivePayoutStatus.REFUSED },
          reason,
        });
      });
    }
    await this.notifications.notify(session.creatorId, {
      type: NotificationType.LIVE_UPDATED,
      title: `Live vérifié : ${session.live.title}`,
      body:
        dto.decision === 'PAY'
          ? earned > 0
            ? `${fcfa(earned)} gagnés.`
            : (reason ?? 'Pas de gain pour ce live.')
          : `Pas de paiement : ${reason}`,
      link: '/lives',
    });
    // The offer may have waited for this decision to close.
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: session.liveId },
      select: { status: true, endsAt: true },
    });
    if (
      live.status === LiveSaleStatus.ACTIVE &&
      live.endsAt &&
      live.endsAt <= new Date()
    ) {
      await this.complete(session.liveId, new Date());
    }
    return this.prisma.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
  }

  // --- Helpers ---------------------------------------------------------------

  private async ownSession(userId: string, sessionId: string) {
    const session = await this.prisma.liveSession.findFirst({
      where: { id: sessionId, creatorId: userId },
      select: { id: true, liveId: true, status: true, tiktokUsername: true },
    });
    if (!session) throw new NotFoundException('Live introuvable');
    return session;
  }

  /** An approved, paid offer still in its period. */
  private async openOffer(tx: Tx, liveId: string) {
    const live = await tx.liveSale.findUnique({ where: { id: liveId } });
    if (
      !live ||
      live.mode !== LiveMode.CREATORS ||
      live.status !== LiveSaleStatus.ACTIVE ||
      !live.fundedAt ||
      !live.endsAt ||
      live.endsAt <= new Date()
    ) {
      throw new NotFoundException('Cette offre n’est plus disponible');
    }
    return live;
  }

  private async assertPlaceLeft(tx: Tx, live: { id: string; slots: number }) {
    const taken = await tx.liveSession.count({
      where: { liveId: live.id, status: { in: TAKEN } },
    });
    if (taken >= live.slots) {
      throw new ConflictException('Toutes les places sont prises');
    }
  }

  private assertInPeriod(
    live: { startsAt: Date; endsAt: Date | null },
    at: Date,
  ) {
    const earliest = Math.max(live.startsAt.getTime(), Date.now());
    if (
      at.getTime() < earliest - EARLY_START_MS ||
      (live.endsAt && at >= live.endsAt)
    ) {
      throw new BadRequestException(
        'Choisis une heure à venir, dans la période de l’offre',
      );
    }
  }

  private async penalize(tx: Tx, userId: string) {
    const blockedUntil = new Date(Date.now() + WITHDRAW_BLOCK_DAYS * DAY_MS);
    const standing = await tx.liveCreatorStanding.upsert({
      where: { userId },
      create: { userId, withdrawStreak: 1, blockedUntil },
      update: { withdrawStreak: { increment: 1 }, blockedUntil },
    });
    if (
      standing.withdrawStreak >= BAN_AFTER_WITHDRAWALS &&
      !standing.bannedAt
    ) {
      return tx.liveCreatorStanding.update({
        where: { userId },
        data: { bannedAt: new Date() },
      });
    }
    return standing;
  }

  private async tellSeller(liveId: string, what: string, at?: Date) {
    const live = await this.prisma.liveSale.findUniqueOrThrow({
      where: { id: liveId },
      select: { sellerId: true, title: true },
    });
    const when = at
      ? ` · ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(at)} (UTC)`
      : '';
    await this.notifications.notify(live.sellerId, {
      type: NotificationType.LIVE_UPDATED,
      title: live.title,
      body: `${what}${when}.`,
      link: `/live/${liveId}`,
    });
  }
}
