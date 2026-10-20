import Anthropic from '@anthropic-ai/sdk';
import {
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LiveSaleStatus } from '@prisma/client';
import { IntentClassifier, LiveCommentIn } from './intent';
import { LiveService } from './live.service';
import { DemoSource } from './sources/demo-source';
import type { CommentSource, SourceStatus } from './sources/source';
import { TikTokSource } from './sources/tiktok-source';

interface Running {
  source: CommentSource;
  classifier: IntentClassifier;
  // Comments still being saved or classified, awaited when the live stops.
  pending: Set<Promise<unknown>>;
}

/**
 * Keeps one TikTok connection and one AI classifier per running live, in this
 * process. A restart loses the connections; the seller presses "Reprendre".
 */
@Injectable()
export class LiveRunnerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LiveRunnerService.name);
  private readonly running = new Map<string, Running>();
  private readonly ai: Anthropic | null;

  constructor(
    private readonly lives: LiveService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.ai = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async onApplicationBootstrap() {
    await this.lives.markInterrupted();
  }

  async onModuleDestroy() {
    await Promise.all([...this.running.keys()].map((id) => this.detach(id)));
  }

  isRunning(liveId: string) {
    return this.running.has(liveId);
  }

  get usesAi() {
    return Boolean(this.ai);
  }

  /** Starts (or resumes) reading the comments of a seller's live. */
  async start(sellerId: string, liveId: string) {
    const live = await this.lives.ownLive(sellerId, liveId);
    if (
      live.status !== LiveSaleStatus.SCHEDULED &&
      live.status !== LiveSaleStatus.RUNNING
    ) {
      throw new ConflictException('Ce live est fini');
    }
    if (this.running.has(liveId)) return live;
    const started =
      live.status === LiveSaleStatus.SCHEDULED
        ? await this.lives.markStarted(liveId)
        : live;

    const source: CommentSource = live.demo
      ? new DemoSource(Number(this.config.get('LIVE_DEMO_INTERVAL_MS') ?? 1800))
      : new TikTokSource(
          live.tiktokUsername,
          this.config.get<string>('EULER_API_KEY'),
        );
    const classifier = new IntentClassifier({
      client: this.ai,
      model: this.config.get<string>('LIVE_AI_MODEL') ?? 'claude-opus-5-5',
      getCatalog: () => this.lives.catalogForAi(liveId),
      getCustomers: (users) => this.lives.customersForAi(liveId, users),
      onResult: async (comment, result) => {
        await this.lives.recordIntent(
          liveId,
          comment,
          result,
          this.phoneSeen.delete(`${liveId}:${comment.id}`),
        );
      },
      onError: (err) =>
        this.logger.warn(`Live ${liveId}: ${(err as Error).message}`),
    });
    const entry: Running = { source, classifier, pending: new Set() };
    this.running.set(liveId, entry);

    source.on('comment', (c: LiveCommentIn) => {
      const p = this.onComment(liveId, entry, c).catch((err: Error) =>
        this.logger.warn(`Live ${liveId}: ${err.message}`),
      );
      entry.pending.add(p);
      void p.finally(() => entry.pending.delete(p));
    });
    source.on('viewers', (n: number) => {
      void this.lives.setViewers(liveId, n).catch(() => undefined);
    });
    source.on('status', (s: SourceStatus) => {
      void this.lives
        .setSource(liveId, s.state, s.message)
        .catch(() => undefined);
    });

    try {
      await source.start();
    } catch (err) {
      this.running.delete(liveId);
      const message = `Impossible de lire le live de @${live.tiktokUsername} : vérifie qu’il est bien en direct. (${(err as Error).message})`;
      await this.lives.setSource(liveId, 'error', message);
      this.logger.warn(`Live ${liveId}: ${(err as Error).message}`);
    }
    return { ...started, running: this.running.has(liveId) };
  }

  // Phone numbers seen in comments still waiting for the AI.
  private readonly phoneSeen = new Set<string>();

  private async onComment(liveId: string, entry: Running, c: LiveCommentIn) {
    const saved = await this.lives.recordComment(liveId, c);
    if (!saved) return;
    if (saved.phoneSeen) this.phoneSeen.add(`${liveId}:${c.id}`);
    entry.classifier.add(saved.comment);
  }

  /** Stops reading and closes the live. */
  async stop(sellerId: string, liveId: string) {
    const live = await this.lives.ownLive(sellerId, liveId);
    if (live.status !== LiveSaleStatus.RUNNING) {
      throw new ConflictException('Ce live n’est pas en cours');
    }
    await this.detach(liveId);
    return this.lives.markEnded(liveId);
  }

  /** Ends the connection only, e.g. when the team cancels the live. */
  async detach(liveId: string) {
    const entry = this.running.get(liveId);
    if (!entry) return;
    this.running.delete(liveId);
    entry.source.stop();
    await Promise.allSettled([...entry.pending]);
    await entry.classifier.stop();
  }
}
