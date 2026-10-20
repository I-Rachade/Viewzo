import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AssignmentStatus,
  Campaign,
  CampaignPackage,
  CampaignStatus,
  CampaignTask,
  ContentCase,
  ContentType,
  PostReviewStatus,
  CreatorSkills,
  CreatorTaskType,
  NotificationType,
  PostProof,
  Prisma,
  ProfileType,
  SocialNetwork,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { CountriesService } from '../countries/countries.service';
import { CampaignFilesService } from '../files/campaign-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProofSource, ProofsService } from '../posts/proofs.service';
import { linkMatchesNetwork } from '../posts/risk';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ReviewCampaignDto } from './dto/review-campaign.dto';
import {
  CONTENT_TYPES,
  creatorRatePer1000,
  estimatedViews,
  MIN_BUDGET,
  platformOptions,
  proposeAllocation,
} from './pricing';

// Level 1 advertisers: Basique only, at most this much per calendar month.
const UNVERIFIED_MONTHLY_BUDGET = 100_000;

type CampaignWithTasks = Campaign & { tasks: CampaignTask[] };
type FileView = ReturnType<CampaignFilesService['view']>;

// The advertiser may still change or delete a campaign until it is paid.
const EDITABLE: CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.PENDING_PAYMENT,
];

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly proofs: ProofsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
    private readonly files: CampaignFilesService,
  ) {}

  quote(pkg: CampaignPackage, budget: number, platforms: SocialNetwork[]) {
    const result = platformOptions(pkg, budget, platforms);
    const usable = platforms.filter((n) => !result.overLimit.includes(n));
    return {
      ...result,
      allocation:
        usable.length && budget >= result.minBudget
          ? proposeAllocation(budget, usable)
          : [],
      estimatedViews:
        usable.length && budget >= result.minBudget
          ? estimatedViews(budget, ContentType.PROVIDED_ASSETS)
          : 0,
    };
  }

  async create(advertiserId: string, dto: CreateCampaignDto) {
    const profile = await this.advertiserProfile(advertiserId);
    const data = await this.validated(profile.level, dto);
    const draft = dto.draft === true;
    // The monthly cap is checked under a lock, so parallel requests can't
    // both fit under it. Drafts count once they are sent.
    const guard =
      profile.level < 2 && !draft
        ? (tx: Prisma.TransactionClient) =>
            this.assertMonthlyBudget(tx, advertiserId, dto.budget)
        : undefined;
    const campaign = await this.createWithCode(
      guard,
      {
        ...data,
        advertiserId,
        status: draft ? CampaignStatus.DRAFT : CampaignStatus.PENDING_PAYMENT,
        tasks: { create: data.tasks },
      },
      (tx, id) =>
        this.files.attach(
          tx,
          advertiserId,
          id,
          dto.fileIds ?? [],
          dto.briefFileIds ?? [],
        ),
    );
    return this.getOwn(advertiserId, campaign.id);
  }

  /** Replaces a campaign that is not paid yet, files and platforms included. */
  async update(advertiserId: string, id: string, dto: CreateCampaignDto) {
    const profile = await this.advertiserProfile(advertiserId);
    const data = await this.validated(profile.level, dto);
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `campaign:${id}`);
      const campaign = await this.editable(tx, advertiserId, id);
      if (profile.level < 2 && campaign.status !== CampaignStatus.DRAFT) {
        await this.assertMonthlyBudget(tx, advertiserId, dto.budget, id);
      }
      await tx.campaignTask.deleteMany({ where: { campaignId: id } });
      await tx.campaign.update({
        where: { id },
        data: { ...data, tasks: { create: data.tasks } },
      });
      await this.files.attach(
        tx,
        advertiserId,
        id,
        dto.fileIds ?? [],
        dto.briefFileIds ?? [],
      );
    });
    return this.getOwn(advertiserId, id);
  }

  /** Sends a draft: it then waits for the payment. */
  async send(advertiserId: string, id: string) {
    const profile = await this.advertiserProfile(advertiserId);
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `campaign:${id}`);
      const campaign = await this.editable(tx, advertiserId, id);
      if (campaign.status !== CampaignStatus.DRAFT) {
        throw new ConflictException('Campagne déjà envoyée');
      }
      if (campaign.endsAt <= new Date()) {
        throw new BadRequestException('La date de fin est passée');
      }
      if (profile.level < 2) {
        await this.assertMonthlyBudget(tx, advertiserId, campaign.budget, id);
      }
      await tx.campaign.update({
        where: { id },
        data: { status: CampaignStatus.PENDING_PAYMENT },
      });
    });
    return this.getOwn(advertiserId, id);
  }

  /** Deletes a campaign that is not paid yet; its files are cleaned later. */
  async remove(advertiserId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `campaign:${id}`);
      await this.editable(tx, advertiserId, id);
      await tx.campaign.delete({ where: { id } });
    });
  }

  /** Stops new creators from taking the tasks, or opens them again. */
  async setPaused(advertiserId: string, id: string, paused: boolean) {
    const [from, to] = paused
      ? [CampaignStatus.ACTIVE, CampaignStatus.PAUSED]
      : [CampaignStatus.PAUSED, CampaignStatus.ACTIVE];
    await this.prisma.$transaction(async (tx) => {
      await this.wallet.lock(tx, `campaign:${id}`);
      const campaign = await tx.campaign.findUnique({ where: { id } });
      if (!campaign || campaign.advertiserId !== advertiserId) {
        throw new NotFoundException();
      }
      if (campaign.status !== from) {
        throw new ConflictException(
          paused
            ? 'Seule une campagne en cours peut être mise en pause'
            : "Cette campagne n'est pas en pause",
        );
      }
      if (!paused && campaign.endsAt <= new Date()) {
        throw new BadRequestException('La date de fin est passée');
      }
      await tx.campaign.update({ where: { id }, data: { status: to } });
      await this.audit.record(tx, {
        actor: null,
        action: paused ? 'campaign.pause' : 'campaign.resume',
        entity: 'Campaign',
        entityId: id,
        before: { status: from },
        after: { status: to, by: advertiserId },
      });
    });
    return this.getOwn(advertiserId, id);
  }

  private async advertiserProfile(advertiserId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: {
        userId_type: { userId: advertiserId, type: ProfileType.ADVERTISER },
      },
    });
    if (!profile) {
      throw new ForbiddenException("Active d'abord le profil Annonceur");
    }
    return profile;
  }

  private async editable(
    tx: Prisma.TransactionClient,
    advertiserId: string,
    id: string,
  ) {
    const campaign = await tx.campaign.findUnique({ where: { id } });
    if (!campaign || campaign.advertiserId !== advertiserId) {
      throw new NotFoundException();
    }
    if (campaign.fundedAt || !EDITABLE.includes(campaign.status)) {
      throw new ConflictException(
        'Campagne déjà payée : elle ne peut plus être modifiée',
      );
    }
    return campaign;
  }

  /** Checks the form and returns the campaign's fields and tasks. */
  private async validated(level: number, dto: CreateCampaignDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt <= startsAt) {
      throw new BadRequestException('La fin doit être après le début');
    }
    if (
      dto.minDurationSec &&
      dto.maxDurationSec &&
      dto.minDurationSec > dto.maxDurationSec
    ) {
      throw new BadRequestException('Durée minimale supérieure à la maximale');
    }

    await this.countries.assertAllowed(dto.countries);

    const networks = dto.platforms.map((p) => p.network);
    if (new Set(networks).size !== networks.length) {
      throw new BadRequestException('Chaque plateforme une seule fois');
    }
    if (level < 2 && dto.package !== CampaignPackage.BASIC) {
      throw new ForbiddenException(
        'Vérifie ton compte pour accéder aux autres packages',
      );
    }

    const { overLimit } = platformOptions(dto.package, dto.budget, networks);
    if (overLimit.length) {
      throw new BadRequestException(
        `Budget ou package insuffisant pour : ${overLimit.join(', ')}`,
      );
    }

    this.assertContent(dto);
    const allocation = this.allocate(dto);
    const none = dto.contentCase === ContentCase.NONE;
    const text = (v?: string) => v?.trim() || null;

    return {
      title: dto.title.trim(),
      objective: dto.objective,
      countries: [...new Set(dto.countries)],
      cities: dto.cities ?? [],
      startsAt,
      endsAt,
      package: dto.package,
      budget: dto.budget,
      contentCase: dto.contentCase,
      assetUrls: none ? [] : (dto.assetUrls ?? []),
      noAssetsChoice: none ? dto.noAssetsChoice : null,
      keyMessage: dto.keyMessage.trim(),
      callToAction: text(dto.callToAction),
      caption: text(dto.caption),
      sound: text(dto.sound),
      productDetails: text(dto.productDetails),
      shipsProduct: dto.shipsProduct ?? false,
      productPickup: dto.shipsProduct ? dto.productPickup : null,
      faceRequired: dto.faceRequired ?? false,
      language: dto.language.trim(),
      minDurationSec: dto.minDurationSec ?? null,
      maxDurationSec: dto.maxDurationSec ?? null,
      tone: dto.tone ?? null,
      mandatoryElements: dto.mandatoryElements ?? [],
      forbiddenElements: dto.forbiddenElements ?? [],
      examples: dto.examples ?? [],
      tasks: dto.platforms.map((p, position) => ({
        network: p.network,
        contentType: p.contentType,
        budget: allocation[position],
        position,
        creatorRatePer1000: creatorRatePer1000(p.contentType),
      })),
    };
  }

  async listOwn(advertiserId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { advertiserId },
      orderBy: { createdAt: 'desc' },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    const ids = campaigns.map((c) => c.id);
    const [counts, files] = await Promise.all([
      this.assignmentCounts(ids),
      this.files.forCampaigns(ids),
    ]);
    return campaigns.map((c) =>
      this.toAdvertiserView(c, counts.get(c.id), files.get(c.id)),
    );
  }

  async getOwn(advertiserId: string, id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) {
      throw new NotFoundException();
    }
    const [counts, files] = await Promise.all([
      this.assignmentCounts([id]),
      this.files.forCampaigns([id]),
    ]);
    return this.toAdvertiserView(campaign, counts.get(id), files.get(id));
  }

  // Back-office: campaigns waiting for moderation, oldest first.
  async queue(
    actor: StaffActor,
    status: CampaignStatus = CampaignStatus.PENDING_REVIEW,
  ) {
    const scope = countryScope(actor);
    const campaigns = await this.prisma.campaign.findMany({
      where: { status, ...(scope ? { countries: { hasSome: scope } } : {}) },
      orderBy: { createdAt: 'asc' },
      include: {
        tasks: { orderBy: { position: 'asc' } },
        advertiser: { select: { phone: true, email: true, country: true } },
      },
      take: 100,
    });
    const files = await this.files.forCampaigns(campaigns.map((c) => c.id));
    return campaigns.map((c) => ({
      // The moderator checks the files and the brief before anything is posted.
      ...this.toAdvertiserView(c, undefined, files.get(c.id)),
      advertiserId: c.advertiserId,
      advertiser: c.advertiser,
    }));
  }

  async review(actor: StaffActor, id: string, dto: ReviewCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException();
    assertCountry(actor, campaign.countries);
    assertNotSelf(actor, campaign.advertiserId);
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new ConflictException('Campagne déjà traitée');
    }
    const reason = dto.reason?.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Payments to this campaign wait until the decision is saved.
      await this.wallet.lock(tx, `campaign:${id}`);
      // Only one decision wins, even on a double click or two moderators.
      const claimed = await tx.campaign.updateMany({
        where: { id, status: CampaignStatus.PENDING_REVIEW },
        data: { status: dto.status, statusReason: reason },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Campagne déjà traitée');
      }
      await tx.campaignReview.create({
        data: {
          campaignId: id,
          reviewerId: actor.userId,
          status: dto.status,
          reason,
        },
      });
      // A refused campaign gives its escrow back to the advertiser.
      const refunded =
        dto.status === CampaignStatus.REJECTED
          ? await this.wallet.refundCampaign(tx, id)
          : 0;
      await this.audit.record(tx, {
        actor,
        action:
          dto.status === CampaignStatus.ACTIVE
            ? 'CAMPAIGN_APPROVE'
            : 'CAMPAIGN_REJECT',
        entity: 'Campaign',
        entityId: id,
        before: { status: campaign.status },
        after: { status: dto.status, refunded },
        reason,
      });
      return tx.campaign.findUniqueOrThrow({
        where: { id },
        include: { tasks: { orderBy: { position: 'asc' } } },
      });
    });
    await this.notifications.notify(campaign.advertiserId, {
      type: NotificationType.CAMPAIGN_REVIEWED,
      title:
        dto.status === CampaignStatus.ACTIVE
          ? `Campagne validée · #${campaign.code}`
          : `Campagne refusée · #${campaign.code}`,
      body:
        dto.status === CampaignStatus.ACTIVE
          ? updated.fundedAt
            ? 'Les créateurs voient maintenant tes tâches.'
            : 'Paie la campagne pour que les créateurs la voient.'
          : (reason ?? 'Le budget en séquestre revient sur ton solde.'),
      link: `/campaigns/${campaign.id}`,
    });
    if (dto.status === CampaignStatus.ACTIVE && updated.fundedAt) {
      await this.notifyNewTasks(updated);
    }
    return this.toAdvertiserView(updated);
  }

  /** Tells creators who can take a task of a campaign that just opened. */
  private async notifyNewTasks(campaign: CampaignWithTasks) {
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { not: campaign.advertiserId },
        country: { in: campaign.countries },
        accounts: {
          some: {
            status: AccountStatus.ELIGIBLE,
            network: { in: campaign.tasks.map((t) => t.network) },
          },
        },
        skills: { isNot: null },
      },
      select: { id: true },
      take: 2000,
    });
    const ids: string[] = [];
    for (const { id } of candidates) {
      const ctx = await this.creatorContext(id);
      if (
        ctx &&
        campaign.tasks.some(
          (t) =>
            ctx.networks.includes(t.network) && this.canTake(ctx, campaign, t),
        )
      ) {
        ids.push(id);
      }
    }
    await this.notifications.notifyMany(ids, {
      type: NotificationType.NEW_TASK,
      title: `Nouvelle campagne : ${campaign.title}`,
      body: 'Une tâche correspond à ton profil. Accepte-la avant les autres.',
      link: '/taches',
    });
  }

  // Tasks for the right country, skills and level, never the creator's own
  // campaigns. The creator can take them with an eligible account on the
  // network; the others come last, locked, to show which account to add.
  async availableTasks(creatorId: string) {
    const ctx = await this.creatorContext(creatorId);
    if (!ctx) return [];
    const now = new Date();
    const tasks = await this.prisma.campaignTask.findMany({
      where: {
        assignments: { none: { creatorId } },
        campaign: {
          status: CampaignStatus.ACTIVE,
          fundedAt: { not: null },
          startsAt: { lte: now },
          endsAt: { gt: now },
          countries: { has: ctx.country },
          advertiserId: { not: creatorId },
        },
      },
      include: { campaign: true },
      orderBy: { creatorRatePer1000: 'desc' },
      take: 200,
    });
    const open = tasks.filter((t) => this.canTake(ctx, t.campaign, t));
    const files = await this.files.forCampaigns([
      ...new Set(open.map((t) => t.campaignId)),
    ]);
    const view = (t: (typeof open)[number]) =>
      this.toTaskView(t, t.campaign, files.get(t.campaignId));
    const unlocked = (t: CampaignTask) => ctx.networks.includes(t.network);
    return [
      ...open.filter(unlocked).map(view),
      ...open
        .filter((t) => !unlocked(t))
        .map((t) => ({ ...view(t), locked: true })),
    ];
  }

  async accept(creatorId: string, taskId: string) {
    const task = await this.prisma.campaignTask.findUnique({
      where: { id: taskId },
      include: { campaign: true },
    });
    if (!task) throw new NotFoundException();
    const ctx = await this.creatorContext(creatorId);
    const now = new Date();
    if (task.campaign.advertiserId === creatorId) {
      throw new ForbiddenException(
        'Tu ne peux pas accepter les tâches de tes propres campagnes',
      );
    }
    if (
      !ctx ||
      task.campaign.status !== CampaignStatus.ACTIVE ||
      !task.campaign.fundedAt ||
      task.campaign.startsAt > now ||
      task.campaign.endsAt <= now ||
      !ctx.networks.includes(task.network) ||
      !task.campaign.countries.includes(ctx.country) ||
      !this.canTake(ctx, task.campaign, task)
    ) {
      throw new ForbiddenException("Cette tâche n'est pas disponible pour toi");
    }
    try {
      const assignment = await this.prisma.taskAssignment.create({
        data: { taskId, creatorId },
      });
      const files = await this.files.forCampaigns([task.campaignId]);
      return this.toAssignmentView(
        assignment,
        task,
        task.campaign,
        [],
        [],
        files.get(task.campaignId),
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Tâche déjà acceptée');
      }
      throw e;
    }
  }

  async myAssignments(creatorId: string) {
    const assignments = await this.prisma.taskAssignment.findMany({
      where: { creatorId },
      orderBy: { acceptedAt: 'desc' },
      include: {
        task: { include: { campaign: true } },
        proofs: { orderBy: { uploadedAt: 'asc' } },
        snapshots: { select: { views: true, takenAt: true } },
      },
    });
    const files = await this.files.forCampaigns([
      ...new Set(assignments.map((a) => a.task.campaignId)),
    ]);
    return assignments.map((a) =>
      this.toAssignmentView(
        a,
        a.task,
        a.task.campaign,
        a.proofs,
        a.snapshots,
        files.get(a.task.campaignId),
      ),
    );
  }

  async submit(
    creatorId: string,
    id: string,
    postUrl: string,
    source: ProofSource = {},
  ) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id },
      include: { task: { include: { campaign: true } } },
    });
    if (!assignment || assignment.creatorId !== creatorId) {
      throw new NotFoundException();
    }
    this.proofs.assertOpen(assignment);
    if (
      !postUrl.startsWith('https://') ||
      !linkMatchesNetwork(assignment.task.network, postUrl)
    ) {
      throw new BadRequestException(
        "Ce lien n'est pas une publication du bon réseau",
      );
    }
    if (assignment.task.campaign.endsAt <= new Date()) {
      throw new BadRequestException('Échéance dépassée');
    }
    await this.prisma.$transaction(async (tx) => {
      const review = await this.proofs.addLink(tx, assignment, postUrl, source);
      await tx.taskAssignment.update({
        where: { id },
        data: {
          postUrl,
          status: AssignmentStatus.SUBMITTED,
          submittedAt: assignment.submittedAt ?? new Date(),
          ...review,
        },
      });
    });
    await this.proofs.refreshRisk(id);
    const updated = await this.prisma.taskAssignment.findUniqueOrThrow({
      where: { id },
      include: {
        proofs: { orderBy: { uploadedAt: 'asc' } },
        snapshots: { select: { views: true, takenAt: true } },
      },
    });
    const files = await this.files.forCampaigns([assignment.task.campaignId]);
    return this.toAssignmentView(
      updated,
      assignment.task,
      assignment.task.campaign,
      updated.proofs,
      updated.snapshots,
      files.get(assignment.task.campaignId),
    );
  }

  private async assertMonthlyBudget(
    tx: Prisma.TransactionClient,
    advertiserId: string,
    budget: number,
    // The campaign being changed or sent, not counted twice.
    except?: string,
  ) {
    await this.wallet.lock(tx, `monthly-budget:${advertiserId}`);
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const spent = await tx.campaign.aggregate({
      where: {
        advertiserId,
        createdAt: { gte: start },
        status: { notIn: [CampaignStatus.REJECTED, CampaignStatus.DRAFT] },
        ...(except ? { id: { not: except } } : {}),
      },
      _sum: { budget: true },
    });
    if ((spent._sum.budget ?? 0) + budget > UNVERIFIED_MONTHLY_BUDGET) {
      throw new ForbiddenException(
        'Budget maximum de 100 000 FCFA par mois avant vérification',
      );
    }
  }

  private assertContent(dto: CreateCampaignDto) {
    const files = dto.fileIds?.length ?? 0;
    const links = dto.assetUrls?.length ?? 0;
    // Big videos may stay behind a link (a shared folder) until resumable
    // uploads exist.
    switch (dto.contentCase) {
      case ContentCase.READY:
        if (!files && !links) {
          throw new BadRequestException('Ajoute les fichiers à publier');
        }
        break;
      case ContentCase.PARTIAL:
        if (!files && !links) {
          throw new BadRequestException(
            'Ajoute la matière que tu fournis : logo, photos, rushes',
          );
        }
        break;
      case ContentCase.NONE:
        if (!dto.noAssetsChoice) {
          throw new BadRequestException(
            'Choisis des vidéos des créateurs ou le Studio Viewzo',
          );
        }
        if (files) {
          throw new BadRequestException(
            'Sans contenu fourni, ne joins pas de fichier',
          );
        }
        break;
    }
    for (const p of dto.platforms) {
      if (
        p.contentType === ContentType.PROVIDED_ASSETS &&
        dto.contentCase !== ContentCase.READY
      ) {
        throw new BadRequestException(
          'Publication des éléments fournis : il faut un contenu prêt',
        );
      }
      if (
        p.contentType === ContentType.VIDEO_WITH_POSTERS &&
        dto.contentCase === ContentCase.NONE
      ) {
        throw new BadRequestException('Ajoute les affiches à intégrer');
      }
      // WhatsApp Statut needs something ready to post.
      if (
        p.network === SocialNetwork.WHATSAPP_STATUS &&
        dto.contentCase !== ContentCase.READY &&
        dto.noAssetsChoice !== 'STUDIO'
      ) {
        throw new BadRequestException(
          'WhatsApp Statut exige un contenu prêt ou le Studio Viewzo',
        );
      }
    }
  }

  private allocate(dto: CreateCampaignDto) {
    const custom = dto.platforms.map((p) => p.budget);
    if (custom.every((b) => b === undefined)) {
      return proposeAllocation(
        dto.budget,
        dto.platforms.map((p) => p.network),
      ).map((a) => a.budget);
    }
    if (custom.some((b) => b === undefined)) {
      throw new BadRequestException(
        'Répartis le budget sur toutes les plateformes',
      );
    }
    const sum = custom.reduce((a, b) => a! + b!, 0)!;
    if (sum !== dto.budget) {
      throw new BadRequestException('La répartition doit égaler le budget');
    }
    for (const p of dto.platforms) {
      if (p.budget! < MIN_BUDGET[p.network]) {
        throw new BadRequestException(
          `Budget minimum pour ${p.network} : ${MIN_BUDGET[p.network]} FCFA`,
        );
      }
    }
    return custom as number[];
  }

  private async createWithCode(
    guard: ((tx: Prisma.TransactionClient) => Promise<void>) | undefined,
    data: Omit<Prisma.CampaignUncheckedCreateInput, 'code'>,
    after: (tx: Prisma.TransactionClient, id: string) => Promise<void>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (guard) await guard(tx);
          const campaign = await tx.campaign.create({
            data: { ...data, code: `VZ${randomInt(1000, 1_000_000)}` },
          });
          await after(tx, campaign.id);
          return campaign;
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          attempt < 5
        ) {
          continue;
        }
        throw e;
      }
    }
  }

  private async assignmentCounts(campaignIds: string[]) {
    const rows = await this.prisma.taskAssignment.groupBy({
      by: ['taskId'],
      where: { task: { campaignId: { in: campaignIds } } },
      _count: true,
    });
    const tasks = await this.prisma.campaignTask.findMany({
      where: { id: { in: rows.map((r) => r.taskId) } },
      select: { id: true, campaignId: true },
    });
    const byTask = new Map(rows.map((r) => [r.taskId, r._count]));
    const counts = new Map<string, Map<string, number>>();
    for (const t of tasks) {
      const m = counts.get(t.campaignId) ?? new Map<string, number>();
      m.set(t.id, byTask.get(t.id) ?? 0);
      counts.set(t.campaignId, m);
    }
    return counts;
  }

  private async creatorContext(creatorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: creatorId },
      include: {
        profiles: true,
        skills: true,
        accounts: { where: { status: AccountStatus.ELIGIBLE } },
      },
    });
    const creator = user?.profiles.find((p) => p.type === ProfileType.CREATOR);
    if (!user || !creator || !user.skills) return null;
    return {
      country: user.country,
      level: creator.level,
      skills: user.skills,
      networks: user.accounts.map((a) => a.network),
    };
  }

  private canTake(
    ctx: { level: number; skills: CreatorSkills },
    campaign: Campaign,
    task: CampaignTask,
  ) {
    const rule = CONTENT_TYPES[task.contentType];
    const { skills } = ctx;
    if (rule.specialties === null) {
      if (
        !skills.taskTypes.includes(CreatorTaskType.POST_PROVIDED_VISUAL) &&
        !skills.taskTypes.includes(CreatorTaskType.POST_PROVIDED_VIDEO)
      ) {
        return false;
      }
    } else {
      // Unverified creators only post provided posters and videos.
      if (ctx.level < 2) return false;
      if (!skills.taskTypes.includes(CreatorTaskType.CREATE_ORIGINAL_VIDEO)) {
        return false;
      }
      if (
        rule.specialties.length &&
        !rule.specialties.some((s) => skills.specialties.includes(s))
      ) {
        return false;
      }
    }
    if (ctx.level < 2 && campaign.package !== CampaignPackage.BASIC) {
      return false;
    }
    const needsFace =
      campaign.faceRequired || task.contentType === ContentType.FACECAM;
    return !needsFace || skills.showsFace;
  }

  private toAdvertiserView(
    c: CampaignWithTasks,
    counts?: Map<string, number>,
    files: FileView[] = [],
  ) {
    return {
      id: c.id,
      code: c.code,
      title: c.title,
      objective: c.objective,
      countries: c.countries,
      cities: c.cities,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      package: c.package,
      budget: c.budget,
      status: c.status,
      statusReason: c.statusReason,
      // Null until the budget is in escrow.
      fundedAt: c.fundedAt,
      spent: c.spent,
      completedAt: c.completedAt,
      refunded: c.refunded,
      ...this.brief(c, files),
      shipsProduct: c.shipsProduct,
      productPickup: c.productPickup,
      platforms: c.tasks.map((t) => ({
        network: t.network,
        contentType: t.contentType,
        budget: t.budget,
        estimatedViews: estimatedViews(t.budget, t.contentType),
        creators: counts?.get(t.id) ?? 0,
      })),
      estimatedViews: c.tasks.reduce(
        (sum, t) => sum + estimatedViews(t.budget, t.contentType),
        0,
      ),
      createdAt: c.createdAt,
    };
  }

  // What a creator sees: the brief and their rate, never the advertiser's budget.
  // The brief, as the advertiser wrote it and as creators read it.
  private brief(c: Campaign, files: FileView[]) {
    return {
      contentCase: c.contentCase,
      noAssetsChoice: c.noAssetsChoice,
      keyMessage: c.keyMessage,
      callToAction: c.callToAction,
      caption: c.caption,
      sound: c.sound,
      productDetails: c.productDetails,
      assetUrls: c.assetUrls,
      files,
      faceRequired: c.faceRequired,
      language: c.language,
      minDurationSec: c.minDurationSec,
      maxDurationSec: c.maxDurationSec,
      tone: c.tone,
      mandatoryElements: c.mandatoryElements,
      forbiddenElements: c.forbiddenElements,
      examples: c.examples,
    };
  }

  private toTaskView(t: CampaignTask, c: Campaign, files: FileView[] = []) {
    return {
      id: t.id,
      // True when the creator has no eligible account on the network yet.
      locked: false,
      network: t.network,
      contentType: t.contentType,
      creatorRatePer1000: t.creatorRatePer1000,
      campaign: {
        title: c.title,
        hashtag: `#${c.code}`,
        endsAt: c.endsAt,
        ...this.brief(c, files),
      },
    };
  }

  private toAssignmentView(
    a: {
      id: string;
      status: AssignmentStatus;
      postUrl: string | null;
      acceptedAt: Date;
      submittedAt: Date | null;
      reviewStatus: PostReviewStatus;
      reviewReason: string | null;
      validViews: number;
      earned: number;
    },
    t: CampaignTask,
    c: Campaign,
    proofs: PostProof[] = [],
    snapshots: { views: number; takenAt: Date }[] = [],
    files: FileView[] = [],
  ) {
    return {
      id: a.id,
      status: a.status,
      postUrl: a.postUrl,
      acceptedAt: a.acceptedAt,
      submittedAt: a.submittedAt,
      // The team's decision, with the reason shown to the creator.
      reviewStatus: a.reviewStatus,
      reviewReason: a.reviewReason,
      validViews: a.validViews,
      earned: a.earned,
      ...this.proofs.creatorView(t.network, proofs, snapshots),
      task: this.toTaskView(t, c, files),
    };
  }
}
