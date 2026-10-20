import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssignmentStatus,
  NotificationType,
  PostReviewStatus,
  ProofKind,
  SocialNetwork,
  ViewSource,
} from '@prisma/client';
import { CampaignFilesService } from '../files/campaign-files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ProofsService, STATUS_PROOF_STEPS } from './proofs.service';
import { ViewCounter } from './view-counters';

export const VIEW_COUNTER_LIST = Symbol('VIEW_COUNTER_LIST');

const HOUR = 3600 * 1000;
const EVERY = 10 * 60 * 1000;

/**
 * Background jobs, every 10 minutes: reminds creators to send the next
 * screenshot of a statut, reads view counts from the platforms that allow
 * it, closes the campaigns that are over and removes campaign files nobody
 * attached.
 */
@Injectable()
export class PostsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostsScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly proofs: ProofsService,
    private readonly wallet: WalletService,
    private readonly files: CampaignFilesService,
    @Inject(VIEW_COUNTER_LIST) private readonly counters: ViewCounter[],
  ) {}

  onModuleInit() {
    // Tests call the jobs directly.
    if (process.env.NODE_ENV === 'test' || this.config.get('JOBS_DISABLED')) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), EVERY);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sendReminders();
      await this.fetchViews();
      await this.wallet.closeDueCampaigns();
      await this.files.purgeOrphans();
    } catch (e) {
      this.logger.error('Background jobs failed', e as Error);
    } finally {
      this.running = false;
    }
  }

  async sendReminders(now = new Date()) {
    const open = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.SUBMITTED,
        reviewStatus: {
          in: [PostReviewStatus.TO_REVIEW, PostReviewStatus.NEEDS_FIX],
        },
        task: { network: SocialNetwork.WHATSAPP_STATUS },
        remindersSent: { lt: STATUS_PROOF_STEPS.length - 1 },
        submittedAt: { gt: new Date(now.getTime() - 26 * HOUR) },
      },
      include: {
        proofs: {
          where: { kind: ProofKind.SCREENSHOT },
          select: { uploadedAt: true },
          orderBy: { uploadedAt: 'asc' },
        },
        task: { select: { campaign: { select: { code: true } } } },
      },
    });
    let sent = 0;
    for (const a of open) {
      const t0 = a.proofs[0]?.uploadedAt.getTime();
      if (t0 === undefined) continue;
      const step = STATUS_PROOF_STEPS[a.remindersSent + 1];
      if (now.getTime() < t0 + step.at * HOUR) continue;
      const alreadySent = a.proofs.some(
        (p) => (p.uploadedAt.getTime() - t0) / HOUR >= step.from,
      );
      // Claimed first, so two servers never send the same reminder.
      const claimed = await this.prisma.taskAssignment.updateMany({
        where: { id: a.id, remindersSent: a.remindersSent },
        data: { remindersSent: a.remindersSent + 1 },
      });
      if (!claimed.count || alreadySent) continue;
      await this.notifications.notify(a.creatorId, {
        type: NotificationType.PROOF_REMINDER,
        title: `Capture ${step.label.toLowerCase()} · #${a.task.campaign.code}`,
        body: 'Ouvre la liste des vues de ton statut et envoie la capture avant qu’il disparaisse.',
        link: '/resultats',
      });
      sent++;
    }
    return sent;
  }

  async fetchViews(now = new Date()) {
    const counters = this.counters.filter((c) => c.enabled);
    if (!counters.length) return 0;
    const due = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.SUBMITTED,
        reviewStatus: { not: PostReviewStatus.REJECTED },
        postUrl: { not: null },
        task: {
          network: { in: counters.map((c) => c.network) },
          campaign: { endsAt: { gt: new Date(now.getTime() - 7 * 24 * HOUR) } },
        },
        OR: [
          { viewsFetchedAt: null },
          { viewsFetchedAt: { lt: new Date(now.getTime() - HOUR) } },
        ],
      },
      select: {
        id: true,
        creatorId: true,
        postUrl: true,
        task: { select: { network: true } },
      },
      orderBy: { viewsFetchedAt: { sort: 'asc', nulls: 'first' } },
      take: 500,
    });
    let read = 0;
    for (const counter of counters) {
      const posts = due.filter((a) => a.task.network === counter.network);
      if (!posts.length) continue;
      let counts = new Map<string, number>();
      try {
        counts = await counter.count(
          posts.map((a) => ({
            assignmentId: a.id,
            creatorId: a.creatorId,
            url: a.postUrl!,
          })),
        );
      } catch (e) {
        this.logger.warn(`${counter.network} views: ${(e as Error).message}`);
      }
      await this.prisma.taskAssignment.updateMany({
        where: { id: { in: posts.map((a) => a.id) } },
        data: { viewsFetchedAt: now },
      });
      for (const [assignmentId, views] of counts) {
        await this.prisma.viewSnapshot.create({
          data: { assignmentId, views, source: ViewSource.API, takenAt: now },
        });
        await this.proofs.refreshRisk(assignmentId);
        read++;
      }
    }
    return read;
  }
}
