import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isViewerSpike } from './billing';
import { IntentClassifier, LiveCommentIn } from './intent';
import { LiveService, type SessionRef } from './live.service';
import { DemoSource } from './sources/demo-source';
import type { CommentSource, SourceStatus } from './sources/source';
import { TikTokSource } from './sources/tiktok-source';

interface Running {
  source: CommentSource;
  classifier: IntentClassifier;
  // Comments still being saved or classified, awaited when the live stops.
  pending: Set<Promise<unknown>>;
  // Last viewer count, to spot sudden jumps, and the peak so far.
  viewers: number | null;
  peak: number;
}

export interface RunnableSession {
  id: string;
  liveId: string;
  tiktokUsername: string;
  demo: boolean;
  peakViewers: number;
}

/**
 * Keeps one TikTok connection and one AI classifier per running session, in
 * this process. A restart loses the connections; "Reprendre" reconnects.
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

  isRunning(sessionId: string) {
    return this.running.has(sessionId);
  }

  get usesAi() {
    return Boolean(this.ai);
  }

  /**
   * Starts (or resumes) reading the comments of a session. Callers check who
   * may start it; this only connects.
   */
  async start(session: RunnableSession) {
    const id = session.id;
    if (this.running.has(id)) return true;
    const ref = { id, liveId: session.liveId };

    const source: CommentSource = session.demo
      ? new DemoSource(Number(this.config.get('LIVE_DEMO_INTERVAL_MS') ?? 1800))
      : new TikTokSource(
          session.tiktokUsername,
          this.config.get<string>('EULER_API_KEY'),
        );
    const classifier = new IntentClassifier({
      client: this.ai,
      model: this.config.get<string>('LIVE_AI_MODEL') ?? 'claude-opus-5-5',
      getCatalog: () => this.lives.catalogForAi(session.liveId),
      getCustomers: (users) => this.lives.customersForAi(id, users),
      onResult: async (comment, result) => {
        await this.lives.recordIntent(
          ref,
          comment,
          result,
          this.phoneSeen.delete(`${id}:${comment.id}`),
        );
      },
      onError: (err) =>
        this.logger.warn(`Live ${id}: ${(err as Error).message}`),
    });
    const entry: Running = {
      source,
      classifier,
      pending: new Set(),
      viewers: null,
      peak: session.peakViewers,
    };
    this.running.set(id, entry);

    source.on('comment', (c: LiveCommentIn) => {
      const p = this.onComment(ref, entry, c).catch((err: Error) =>
        this.logger.warn(`Live ${id}: ${err.message}`),
      );
      entry.pending.add(p);
      void p.finally(() => entry.pending.delete(p));
    });
    source.on('viewers', (n: number) => {
      // The first count of a resumed reading is not a jump.
      const spike = entry.viewers != null && isViewerSpike(entry.viewers, n);
      entry.viewers = n;
      entry.peak = Math.max(entry.peak, n);
      void this.lives
        .setViewers(
          id,
          n,
          entry.peak,
          spike ? 'Hausse brutale de spectateurs' : undefined,
        )
        .catch(() => undefined);
    });
    source.on('status', (s: SourceStatus) => {
      void this.lives.setSource(id, s.state, s.message).catch(() => undefined);
    });

    try {
      await source.start();
    } catch (err) {
      this.running.delete(id);
      const message = `Impossible de lire le live de @${session.tiktokUsername} : vérifie qu’il est bien en direct. (${(err as Error).message})`;
      await this.lives.setSource(id, 'error', message);
      this.logger.warn(`Live ${id}: ${(err as Error).message}`);
    }
    return this.running.has(id);
  }

  // Phone numbers seen in comments still waiting for the AI.
  private readonly phoneSeen = new Set<string>();

  private async onComment(ref: SessionRef, entry: Running, c: LiveCommentIn) {
    const saved = await this.lives.recordComment(ref, c);
    if (!saved) return;
    if (saved.phoneSeen) this.phoneSeen.add(`${ref.id}:${c.id}`);
    entry.classifier.add(saved.comment);
  }

  /** Ends the connection, waiting for the comments still being read. */
  async detach(sessionId: string) {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    this.running.delete(sessionId);
    entry.source.stop();
    await Promise.allSettled([...entry.pending]);
    await entry.classifier.stop();
  }
}
