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
  ContentType,
  CreatorSkills,
  CreatorTaskType,
  Prisma,
  ProfileType,
  SocialNetwork,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const profile = await this.prisma.userProfile.findUnique({
      where: {
        userId_type: { userId: advertiserId, type: ProfileType.ADVERTISER },
      },
    });
    if (!profile) {
      throw new ForbiddenException("Active d'abord le profil Annonceur");
    }

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

    const networks = dto.platforms.map((p) => p.network);
    if (new Set(networks).size !== networks.length) {
      throw new BadRequestException('Chaque plateforme une seule fois');
    }
    if (profile.level < 2) {
      if (dto.package !== CampaignPackage.BASIC) {
        throw new ForbiddenException(
          'Vérifie ton compte pour accéder aux autres packages',
        );
      }
      await this.assertMonthlyBudget(advertiserId, dto.budget);
    }

    const { overLimit } = platformOptions(dto.package, dto.budget, networks);
    if (overLimit.length) {
      throw new BadRequestException(
        `Budget ou package insuffisant pour : ${overLimit.join(', ')}`,
      );
    }

    this.assertContent(dto);
    const allocation = this.allocate(dto);

    const campaign = await this.createWithCode({
      advertiserId,
      title: dto.title.trim(),
      objective: dto.objective,
      countries: [...new Set(dto.countries)],
      cities: dto.cities ?? [],
      startsAt,
      endsAt,
      package: dto.package,
      budget: dto.budget,
      hasAssets: dto.hasAssets,
      assetUrls: dto.hasAssets ? (dto.assetUrls ?? []) : [],
      noAssetsChoice: dto.hasAssets ? null : dto.noAssetsChoice,
      shipsProduct: dto.shipsProduct ?? false,
      productPickup: dto.shipsProduct ? dto.productPickup : null,
      faceRequired: dto.faceRequired ?? false,
      language: dto.language.trim(),
      minDurationSec: dto.minDurationSec,
      maxDurationSec: dto.maxDurationSec,
      tone: dto.tone,
      mandatoryElements: dto.mandatoryElements ?? [],
      forbiddenElements: dto.forbiddenElements ?? [],
      examples: dto.examples ?? [],
      tasks: {
        create: dto.platforms.map((p, position) => ({
          network: p.network,
          contentType: p.contentType,
          budget: allocation[position],
          position,
          creatorRatePer1000: creatorRatePer1000(p.contentType),
        })),
      },
    });
    return this.toAdvertiserView(campaign);
  }

  async listOwn(advertiserId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { advertiserId },
      orderBy: { createdAt: 'desc' },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    const counts = await this.assignmentCounts(campaigns.map((c) => c.id));
    return campaigns.map((c) => this.toAdvertiserView(c, counts.get(c.id)));
  }

  async getOwn(advertiserId: string, id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: { tasks: { orderBy: { position: 'asc' } } },
    });
    if (!campaign || campaign.advertiserId !== advertiserId) {
      throw new NotFoundException();
    }
    const counts = await this.assignmentCounts([id]);
    return this.toAdvertiserView(campaign, counts.get(id));
  }

  // Back-office: campaigns waiting for moderation, oldest first.
  async queue(status: CampaignStatus = CampaignStatus.PENDING_REVIEW) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: {
        tasks: { orderBy: { position: 'asc' } },
        advertiser: { select: { phone: true, country: true } },
      },
      take: 100,
    });
    return campaigns.map((c) => ({
      ...this.toAdvertiserView(c),
      // The moderator checks the provided assets before anything is posted.
      assetUrls: c.assetUrls,
      advertiser: c.advertiser,
    }));
  }

  async review(reviewerId: string, id: string, dto: ReviewCampaignDto) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException();
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
      throw new ConflictException('Campagne déjà traitée');
    }
    const reason = dto.reason?.trim() || null;
    const [updated] = await this.prisma.$transaction([
      this.prisma.campaign.update({
        where: { id },
        data: { status: dto.status, statusReason: reason },
        include: { tasks: { orderBy: { position: 'asc' } } },
      }),
      this.prisma.campaignReview.create({
        data: { campaignId: id, reviewerId, status: dto.status, reason },
      }),
    ]);
    return this.toAdvertiserView(updated);
  }

  // Tasks the creator can take now: an eligible account on the network, the
  // right country, skills and level, and never their own campaigns.
  async availableTasks(creatorId: string) {
    const ctx = await this.creatorContext(creatorId);
    if (!ctx) return [];
    const now = new Date();
    const tasks = await this.prisma.campaignTask.findMany({
      where: {
        network: { in: ctx.networks },
        assignments: { none: { creatorId } },
        campaign: {
          status: CampaignStatus.ACTIVE,
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
    return tasks
      .filter((t) => this.canTake(ctx, t.campaign, t))
      .map((t) => this.toTaskView(t, t.campaign));
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
      return this.toAssignmentView(assignment, task, task.campaign);
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
      include: { task: { include: { campaign: true } } },
    });
    return assignments.map((a) =>
      this.toAssignmentView(a, a.task, a.task.campaign),
    );
  }

  async submit(creatorId: string, id: string, postUrl: string) {
    const assignment = await this.prisma.taskAssignment.findUnique({
      where: { id },
      include: { task: { include: { campaign: true } } },
    });
    if (!assignment || assignment.creatorId !== creatorId) {
      throw new NotFoundException();
    }
    if (assignment.task.campaign.endsAt <= new Date()) {
      throw new BadRequestException('Échéance dépassée');
    }
    const updated = await this.prisma.taskAssignment.update({
      where: { id },
      data: {
        postUrl,
        status: AssignmentStatus.SUBMITTED,
        submittedAt: new Date(),
      },
    });
    return this.toAssignmentView(
      updated,
      assignment.task,
      assignment.task.campaign,
    );
  }

  private async assertMonthlyBudget(advertiserId: string, budget: number) {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const spent = await this.prisma.campaign.aggregate({
      where: {
        advertiserId,
        createdAt: { gte: start },
        status: { not: CampaignStatus.REJECTED },
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
    if (dto.hasAssets && !dto.assetUrls?.length) {
      throw new BadRequestException('Ajoute les éléments que tu fournis');
    }
    if (!dto.hasAssets && !dto.noAssetsChoice) {
      throw new BadRequestException(
        'Choisis des vidéos des créateurs ou le Studio Viewzo',
      );
    }
    for (const p of dto.platforms) {
      if (p.contentType === ContentType.PROVIDED_ASSETS && !dto.hasAssets) {
        throw new BadRequestException(
          'Publication des éléments fournis impossible sans fichier',
        );
      }
      if (p.contentType === ContentType.VIDEO_WITH_POSTERS && !dto.hasAssets) {
        throw new BadRequestException('Ajoute les affiches à intégrer');
      }
      // WhatsApp Statut needs something ready to post.
      if (
        p.network === SocialNetwork.WHATSAPP_STATUS &&
        !dto.hasAssets &&
        dto.noAssetsChoice !== 'STUDIO'
      ) {
        throw new BadRequestException(
          'WhatsApp Statut exige des éléments à poster ou le Studio Viewzo',
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
    data: Omit<Prisma.CampaignUncheckedCreateInput, 'code'>,
  ) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.campaign.create({
          data: { ...data, code: `VZ${randomInt(1000, 1_000_000)}` },
          include: { tasks: { orderBy: { position: 'asc' } } },
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

  private toAdvertiserView(c: CampaignWithTasks, counts?: Map<string, number>) {
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
      hasAssets: c.hasAssets,
      noAssetsChoice: c.noAssetsChoice,
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
  private toTaskView(t: CampaignTask, c: Campaign) {
    return {
      id: t.id,
      network: t.network,
      contentType: t.contentType,
      creatorRatePer1000: t.creatorRatePer1000,
      campaign: {
        title: c.title,
        hashtag: `#${c.code}`,
        endsAt: c.endsAt,
        assetUrls: c.assetUrls,
        faceRequired: c.faceRequired,
        language: c.language,
        minDurationSec: c.minDurationSec,
        maxDurationSec: c.maxDurationSec,
        tone: c.tone,
        mandatoryElements: c.mandatoryElements,
        forbiddenElements: c.forbiddenElements,
        examples: c.examples,
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
    },
    t: CampaignTask,
    c: Campaign,
  ) {
    return {
      id: a.id,
      status: a.status,
      postUrl: a.postUrl,
      acceptedAt: a.acceptedAt,
      submittedAt: a.submittedAt,
      task: this.toTaskView(t, c),
    };
  }
}
