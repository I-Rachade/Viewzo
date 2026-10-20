import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoRejection, SocialNetwork } from '@prisma/client';

/** What a platform says about a public account. */
export interface ProfileFacts {
  found: boolean;
  followers?: number;
  // Undefined when the platform does not tell.
  hasName?: boolean;
  hasPicture?: boolean;
}

/**
 * Asks a platform about an account without the creator logging in. Which
 * platforms allow it:
 * - YouTube: channel by handle or id, with an API key (YOUTUBE_API_KEY).
 * - Telegram: public channels and groups, with a bot token
 *   (TELEGRAM_BOT_TOKEN). Personal accounts are not visible to bots.
 * - Instagram: Business and Creator accounts, through Viewzo's own Instagram
 *   Business account (INSTAGRAM_DISCOVERY_USER_ID, INSTAGRAM_DISCOVERY_TOKEN).
 * - TikTok, Facebook, X, Snapchat, LinkedIn, Threads, WhatsApp Statut: no
 *   official way, and their terms forbid reading profile pages. The team
 *   checks them.
 */
export interface ProfileChecker {
  network: SocialNetwork;
  readonly enabled: boolean;
  /** Null when the platform cannot tell (error, private or personal account). */
  check(name: string): Promise<ProfileFacts | null>;
}

const TIMEOUT = 8_000;
const get = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });

@Injectable()
export class YoutubeProfileChecker implements ProfileChecker {
  readonly network = SocialNetwork.YOUTUBE;
  private readonly logger = new Logger(YoutubeProfileChecker.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!this.config.get<string>('YOUTUBE_API_KEY');
  }

  async check(name: string): Promise<ProfileFacts | null> {
    const key = this.config.get<string>('YOUTUBE_API_KEY');
    if (!key) return null;
    const byId = /^UC[\w-]{22}$/.test(name);
    const res = await get(
      `https://www.googleapis.com/youtube/v3/channels?${new URLSearchParams({
        part: 'snippet,statistics',
        ...(byId ? { id: name } : { forHandle: `@${name}` }),
        key,
      })}`,
    );
    if (!res.ok) {
      this.logger.warn(`YouTube API ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      items?: {
        snippet?: { title?: string; thumbnails?: object };
        statistics?: {
          subscriberCount?: string;
          hiddenSubscriberCount?: boolean;
        };
      }[];
    };
    const channel = body.items?.[0];
    if (!channel) return { found: false };
    const followers = Number(channel.statistics?.subscriberCount);
    return {
      found: true,
      followers:
        !channel.statistics?.hiddenSubscriberCount && Number.isFinite(followers)
          ? followers
          : undefined,
      hasName: !!channel.snippet?.title?.trim(),
      // Every channel has a picture, the default one included.
      hasPicture: undefined,
    };
  }
}

@Injectable()
export class TelegramProfileChecker implements ProfileChecker {
  readonly network = SocialNetwork.TELEGRAM;
  private readonly logger = new Logger(TelegramProfileChecker.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return !!this.config.get<string>('TELEGRAM_BOT_TOKEN');
  }

  async check(name: string): Promise<ProfileFacts | null> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return null;
    const api = (method: string) =>
      get(
        `https://api.telegram.org/bot${token}/${method}?${new URLSearchParams({
          chat_id: `@${name}`,
        })}`,
      ).then((r) => r.json() as Promise<{ ok: boolean; result?: unknown }>);
    const chat = await api('getChat');
    // Not found also means a personal account, which bots cannot see.
    if (!chat.ok) return null;
    const info = chat.result as { title?: string; photo?: object };
    const count = await api('getChatMemberCount');
    if (!count.ok) this.logger.warn(`Telegram getChatMemberCount failed`);
    return {
      found: true,
      followers: count.ok ? Number(count.result) : undefined,
      hasName: !!info.title?.trim(),
      hasPicture: !!info.photo,
    };
  }
}

@Injectable()
export class InstagramProfileChecker implements ProfileChecker {
  readonly network = SocialNetwork.INSTAGRAM;
  private readonly logger = new Logger(InstagramProfileChecker.name);

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return (
      !!this.config.get<string>('INSTAGRAM_DISCOVERY_USER_ID') &&
      !!this.config.get<string>('INSTAGRAM_DISCOVERY_TOKEN')
    );
  }

  async check(name: string): Promise<ProfileFacts | null> {
    if (!this.enabled) return null;
    const userId = this.config.get<string>('INSTAGRAM_DISCOVERY_USER_ID')!;
    const res = await get(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(userId)}?${new URLSearchParams(
        {
          fields: `business_discovery.username(${name}){followers_count,name,profile_picture_url}`,
          access_token: this.config.get<string>('INSTAGRAM_DISCOVERY_TOKEN')!,
        },
      )}`,
    );
    // Personal accounts and unknown names answer the same error.
    if (!res.ok) {
      this.logger.debug(`Instagram business discovery ${res.status}`);
      return null;
    }
    const body = (await res.json()) as {
      business_discovery?: {
        followers_count?: number;
        name?: string;
        profile_picture_url?: string;
      };
    };
    const found = body.business_discovery;
    if (!found) return null;
    return {
      found: true,
      followers: found.followers_count,
      hasName: !!found.name?.trim(),
      hasPicture: !!found.profile_picture_url,
    };
  }
}

export const PROFILE_CHECKERS = 'PROFILE_CHECKERS';

/** What the system decides from the platform's answer. */
export function judge(facts: ProfileFacts | null): {
  rejection: AutoRejection | null;
  followers?: number;
} {
  if (!facts) return { rejection: null };
  if (!facts.found) return { rejection: AutoRejection.NOT_FOUND };
  if (facts.hasName === false && facts.hasPicture === false) {
    return { rejection: AutoRejection.ANONYMOUS, followers: facts.followers };
  }
  return { rejection: null, followers: facts.followers };
}
