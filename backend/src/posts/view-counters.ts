import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialNetwork } from '@prisma/client';
import { ConnectionsService } from '../connections/connections.service';

export interface PostRef {
  assignmentId: string;
  creatorId: string;
  url: string;
}

/**
 * Reads a post's view count from its platform. Which platforms allow it:
 * - YouTube: public counts with an API key (YOUTUBE_API_KEY).
 * - X: public metrics with a paid API plan (X_BEARER_TOKEN).
 * - Telegram: public channels show views on the post's embed page.
 * - TikTok, Instagram, Facebook, Threads: only the account owner can read
 *   them, so the creator connects their account (see ConnectionsService).
 * - Snapchat, LinkedIn (personal profiles), WhatsApp Statut: no API, the
 *   count comes from screenshots.
 */
export interface ViewCounter {
  network: SocialNetwork;
  readonly enabled: boolean;
  /** Views per assignment id; posts it can't read are left out. */
  count(posts: PostRef[]): Promise<Map<string, number>>;
}

const TIMEOUT = 15_000;
const get = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });

/** Follows a short link (vm.tiktok.com, fb.watch…) to the full URL. */
async function expand(url: string) {
  try {
    const res = await get(url, { redirect: 'follow', method: 'HEAD' });
    return res.url || url;
  } catch {
    return url;
  }
}

function parse(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function youtubeVideoId(url: string) {
  const u = parse(url);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com') {
    id =
      u.searchParams.get('v') ??
      u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1] ??
      null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export const tiktokVideoId = (url: string) =>
  parse(url)?.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? null;

export const xPostId = (url: string) =>
  parse(url)?.pathname.match(/\/status(?:es)?\/(\d+)/)?.[1] ?? null;

/** Instagram post or reel code, as in /p/CODE/ or /reel/CODE/. */
export const instagramCode = (url: string) =>
  parse(url)?.pathname.match(/\/(?:p|reels?|tv)\/([\w-]+)/)?.[1] ?? null;

export const threadsCode = (url: string) =>
  parse(url)?.pathname.match(/\/post\/([\w-]+)/)?.[1] ?? null;

export function facebookVideoId(url: string) {
  const u = parse(url);
  if (!u) return null;
  return (
    u.searchParams.get('v') ??
    u.pathname.match(/\/(?:videos|reel|watch)\/(?:[^/]+\/)?(\d+)/)?.[1] ??
    null
  );
}

export function telegramPost(url: string) {
  const u = parse(url);
  if (
    !u ||
    !['t.me', 'telegram.me'].includes(u.hostname.replace(/^www\./, ''))
  ) {
    return null;
  }
  const m = u.pathname.match(/^\/(?:s\/)?([A-Za-z]\w{3,})\/(\d+)/);
  return m ? { channel: m[1], id: m[2] } : null;
}

/** "1.2K" → 1200, "3,4M" → 3400000, "950" → 950. */
export function parseCompactCount(text: string) {
  const m = text
    .trim()
    .replace(',', '.')
    .match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const factor = { k: 1e3, m: 1e6 }[m[2].toLowerCase()] ?? 1;
  return Math.round(n * factor);
}

/** First number in a Graph API insights answer, whatever its shape. */
function insightValue(body: unknown) {
  const metric = (
    body as {
      data?: {
        values?: { value?: unknown }[];
        total_value?: { value?: unknown };
      }[];
    }
  ).data?.[0];
  const v = metric?.values?.[0]?.value ?? metric?.total_value?.value;
  return typeof v === 'number' ? v : null;
}

const byCreator = (posts: PostRef[]) => {
  const m = new Map<string, PostRef[]>();
  for (const p of posts) m.set(p.creatorId, [...(m.get(p.creatorId) ?? []), p]);
  return m;
};

@Injectable()
export class YoutubeViewCounter implements ViewCounter {
  readonly network = SocialNetwork.YOUTUBE;
  private readonly logger = new Logger(YoutubeViewCounter.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!this.config.get<string>('YOUTUBE_API_KEY');
  }

  async count(posts: PostRef[]) {
    const result = new Map<string, number>();
    const key = this.config.get<string>('YOUTUBE_API_KEY');
    if (!key) return result;
    const byId = new Map<string, string[]>();
    for (const p of posts) {
      const id = youtubeVideoId(p.url);
      if (id) byId.set(id, [...(byId.get(id) ?? []), p.assignmentId]);
    }
    const ids = [...byId.keys()];
    // At most 50 ids per call.
    for (let i = 0; i < ids.length; i += 50) {
      const res = await get(
        `https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({
          part: 'statistics',
          id: ids.slice(i, i + 50).join(','),
          key,
        })}`,
      );
      if (!res.ok) {
        this.logger.warn(`YouTube API ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        items?: { id: string; statistics?: { viewCount?: string } }[];
      };
      for (const item of body.items ?? []) {
        const views = Number(item.statistics?.viewCount);
        if (!Number.isFinite(views)) continue;
        for (const a of byId.get(item.id) ?? []) result.set(a, views);
      }
    }
    return result;
  }
}

@Injectable()
export class XViewCounter implements ViewCounter {
  readonly network = SocialNetwork.X;
  private readonly logger = new Logger(XViewCounter.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!this.config.get<string>('X_BEARER_TOKEN');
  }

  async count(posts: PostRef[]) {
    const result = new Map<string, number>();
    const token = this.config.get<string>('X_BEARER_TOKEN');
    if (!token) return result;
    const byId = new Map<string, string[]>();
    for (const p of posts) {
      const id = xPostId(p.url);
      if (id) byId.set(id, [...(byId.get(id) ?? []), p.assignmentId]);
    }
    const ids = [...byId.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const res = await get(
        `https://api.x.com/2/tweets?${new URLSearchParams({
          ids: ids.slice(i, i + 100).join(','),
          'tweet.fields': 'public_metrics',
        })}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        this.logger.warn(`X API ${res.status}`);
        continue;
      }
      const body = (await res.json()) as {
        data?: { id: string; public_metrics?: { impression_count?: number } }[];
      };
      for (const t of body.data ?? []) {
        const views = t.public_metrics?.impression_count;
        if (typeof views !== 'number') continue;
        for (const a of byId.get(t.id) ?? []) result.set(a, views);
      }
    }
    return result;
  }
}

// Public Telegram channels: the embed page of a post shows its views.
@Injectable()
export class TelegramViewCounter implements ViewCounter {
  readonly network = SocialNetwork.TELEGRAM;
  readonly enabled = true;

  async count(posts: PostRef[]) {
    const result = new Map<string, number>();
    for (const p of posts) {
      const post = telegramPost(p.url);
      if (!post) continue;
      try {
        const res = await get(
          `https://t.me/${post.channel}/${post.id}?embed=1&mode=tme`,
        );
        if (!res.ok) continue;
        const html = await res.text();
        const raw = html.match(
          /class="tgme_widget_message_views"[^>]*>([^<]+)</,
        )?.[1];
        const views = raw ? parseCompactCount(raw) : null;
        if (views !== null) result.set(p.assignmentId, views);
      } catch {
        // Unreachable this time; tried again at the next round.
      }
    }
    return result;
  }
}

/** Base for platforms where the creator's own login is needed. */
abstract class ConnectedCounter implements ViewCounter {
  abstract readonly network: SocialNetwork;
  /** Env var of the platform app; without it nobody can connect. */
  protected abstract readonly appEnv: string;

  constructor(
    protected readonly config: ConfigService,
    protected readonly connections: ConnectionsService,
  ) {}

  get enabled() {
    return !!this.config.get<string>(this.appEnv);
  }

  async count(posts: PostRef[]) {
    const result = new Map<string, number>();
    for (const [creatorId, mine] of byCreator(posts)) {
      const conn = await this.connections.usable(creatorId, this.network);
      if (!conn) continue;
      try {
        for (const [id, views] of await this.countFor(conn, mine)) {
          result.set(id, views);
        }
      } catch (e) {
        await this.connections.fail(
          creatorId,
          this.network,
          (e as Error).message,
        );
      }
    }
    return result;
  }

  protected abstract countFor(
    conn: { accessToken: string; extra: Record<string, string> },
    posts: PostRef[],
  ): Promise<Map<string, number>>;

  protected async json<T>(res: Response) {
    const body = (await res.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: string };
    };
    if (!res.ok) {
      throw new Error(body.error?.message ?? `${this.network} ${res.status}`);
    }
    return body;
  }
}

@Injectable()
export class TiktokViewCounter extends ConnectedCounter {
  readonly network = SocialNetwork.TIKTOK;
  protected readonly appEnv = 'TIKTOK_CLIENT_KEY';

  constructor(config: ConfigService, connections: ConnectionsService) {
    super(config, connections);
  }

  protected async countFor(conn: { accessToken: string }, posts: PostRef[]) {
    const result = new Map<string, number>();
    const byId = new Map<string, string>();
    for (const p of posts) {
      const id = tiktokVideoId(p.url) ?? tiktokVideoId(await expand(p.url));
      if (id) byId.set(id, p.assignmentId);
    }
    const ids = [...byId.keys()];
    // At most 20 videos per query, and only the creator's own.
    for (let i = 0; i < ids.length; i += 20) {
      const body = await this.json<{
        data?: { videos?: { id: string; view_count?: number }[] };
      }>(
        await get(
          'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${conn.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filters: { video_ids: ids.slice(i, i + 20) },
            }),
          },
        ),
      );
      for (const v of body.data?.videos ?? []) {
        const a = byId.get(v.id);
        if (a && typeof v.view_count === 'number') result.set(a, v.view_count);
      }
    }
    return result;
  }
}

/** Instagram and Threads: list the account's media, match links, read insights. */
abstract class MediaListCounter extends ConnectedCounter {
  protected abstract readonly graph: string;
  protected abstract code(url: string): string | null;

  protected async countFor(conn: { accessToken: string }, posts: PostRef[]) {
    const result = new Map<string, number>();
    const wanted = new Map<string, string>();
    for (const p of posts) {
      const c = this.code(p.url);
      if (c) wanted.set(c, p.assignmentId);
    }
    if (!wanted.size) return result;
    const token = encodeURIComponent(conn.accessToken);
    let next: string | undefined =
      `${this.graph}/me/${this.mediaEdge}?fields=id,permalink&limit=100&access_token=${token}`;
    // The 300 latest posts cover any campaign's period.
    for (let page = 0; next && page < 3 && wanted.size; page++) {
      const body: {
        data?: { id: string; permalink?: string }[];
        paging?: { next?: string };
      } = await this.json(await get(next));
      for (const m of body.data ?? []) {
        const c = m.permalink ? this.code(m.permalink) : null;
        const a = c ? wanted.get(c) : undefined;
        if (!a) continue;
        wanted.delete(c!);
        const insights = await this.json<unknown>(
          await get(
            `${this.graph}/${m.id}/insights?metric=views&access_token=${token}`,
          ),
        );
        const views = insightValue(insights);
        if (views !== null) result.set(a, views);
      }
      next = body.paging?.next;
    }
    return result;
  }

  protected abstract readonly mediaEdge: string;
}

@Injectable()
export class InstagramViewCounter extends MediaListCounter {
  readonly network = SocialNetwork.INSTAGRAM;
  protected readonly appEnv = 'INSTAGRAM_APP_ID';
  protected readonly graph = 'https://graph.instagram.com/v21.0';
  protected readonly mediaEdge = 'media';

  constructor(config: ConfigService, connections: ConnectionsService) {
    super(config, connections);
  }

  protected code(url: string) {
    return instagramCode(url);
  }
}

@Injectable()
export class ThreadsViewCounter extends MediaListCounter {
  readonly network = SocialNetwork.THREADS;
  protected readonly appEnv = 'THREADS_APP_ID';
  protected readonly graph = 'https://graph.threads.net/v1.0';
  protected readonly mediaEdge = 'threads';

  constructor(config: ConfigService, connections: ConnectionsService) {
    super(config, connections);
  }

  protected code(url: string) {
    return threadsCode(url);
  }
}

// Facebook: video and reel views of the pages the creator manages.
@Injectable()
export class FacebookViewCounter extends ConnectedCounter {
  readonly network = SocialNetwork.FACEBOOK;
  protected readonly appEnv = 'FACEBOOK_APP_ID';

  constructor(config: ConfigService, connections: ConnectionsService) {
    super(config, connections);
  }

  protected async countFor(
    conn: { extra: Record<string, string> },
    posts: PostRef[],
  ) {
    const result = new Map<string, number>();
    const pageTokens = Object.values(conn.extra);
    for (const p of posts) {
      const id = facebookVideoId(p.url) ?? facebookVideoId(await expand(p.url));
      if (!id) continue;
      for (const token of pageTokens) {
        const res = await get(
          `https://graph.facebook.com/v21.0/${id}/video_insights?metric=total_video_views,blue_reels_play_count&access_token=${encodeURIComponent(token)}`,
        );
        if (!res.ok) continue;
        const body = (await res.json()) as {
          data?: { name: string; values?: { value?: unknown }[] }[];
        };
        const values = (body.data ?? [])
          .map((m) => m.values?.[0]?.value)
          .filter((v): v is number => typeof v === 'number');
        if (values.length) {
          result.set(p.assignmentId, Math.max(...values));
          break;
        }
      }
    }
    return result;
  }
}

export const VIEW_COUNTERS = [
  YoutubeViewCounter,
  XViewCounter,
  TelegramViewCounter,
  TiktokViewCounter,
  InstagramViewCounter,
  ThreadsViewCounter,
  FacebookViewCounter,
];
