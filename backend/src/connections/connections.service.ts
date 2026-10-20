import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, SocialConnection, SocialNetwork } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  OAUTH_PROVIDERS,
  OAuthApp,
  OAuthProvider,
  OAuthTokens,
} from './providers';
import { TokenCrypto } from './token-crypto';

const STATE_TTL_MS = 15 * 60 * 1000;
// Refresh a little before the platform says the token expires.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export interface UsableConnection {
  accessToken: string;
  externalId: string | null;
  extra: Record<string, string>;
}

/**
 * Creators connect their TikTok, Instagram, Facebook or Threads account so
 * Viewzo reads their posts' views itself instead of asking for screenshots.
 */
// Networks whose login gives a username to compare with the declared one.
const HANDLE_CHECKED: SocialNetwork[] = [
  SocialNetwork.TIKTOK,
  SocialNetwork.INSTAGRAM,
  SocialNetwork.THREADS,
];

/** "@Kossi_TG", "https://www.tiktok.com/@kossi_tg/" → "kossi_tg". */
export function normalizeHandle(raw: string) {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const last = trimmed.split('/').pop() ?? trimmed;
  return last.replace(/^@/, '').split('?')[0].toLowerCase();
}

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  private readonly crypto: TokenCrypto;
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
    // Tokens sealed before TOKEN_ENCRYPTION_KEY was set used JWT_SECRET;
    // they stay readable until the creator reconnects.
    this.crypto = new TokenCrypto(
      config.get<string>('TOKEN_ENCRYPTION_KEY') || this.secret,
      [
        ...(config.get<string>('TOKEN_ENCRYPTION_KEY_PREVIOUS') ?? '')
          .split(',')
          .map((k) => k.trim()),
        this.secret,
      ],
    );
  }

  /** Every platform, whether it can be connected here and if it is. */
  async list(userId: string) {
    const rows = await this.prisma.socialConnection.findMany({
      where: { userId },
    });
    return OAUTH_PROVIDERS.map((p) => {
      const c = rows.find((r) => r.network === p.network);
      return {
        network: p.network,
        available: !!this.app(p),
        connected: !!c,
        handle: c?.handle ?? null,
        lastError: c?.lastError ?? null,
        connectedAt: c?.createdAt ?? null,
      };
    });
  }

  startUrl(userId: string, network: SocialNetwork) {
    const provider = this.provider(network);
    const app = this.app(provider);
    if (!app) {
      throw new BadRequestException(
        'Connexion pas encore disponible pour ce réseau',
      );
    }
    return {
      url: provider.authorizeUrl(
        app,
        this.redirectUri(network),
        this.state(userId, network),
      ),
    };
  }

  /** The platform sent the creator back: trade the code for tokens. */
  async callback(network: SocialNetwork, code: string, state: string) {
    const userId = this.readState(state, network);
    const provider = this.provider(network);
    const app = this.app(provider);
    if (!app) throw new BadRequestException('Réseau non configuré');
    const tokens = await provider.exchange(
      app,
      code,
      this.redirectUri(network),
    );
    await this.assertSameAccount(userId, network, tokens);
    const data = this.seal(tokens);
    await this.prisma.socialConnection.upsert({
      where: { userId_network: { userId, network } },
      create: { userId, network, ...data },
      update: { ...data, lastError: null },
    });
  }

  /**
   * The platform account must be the one the creator declared in "Mes
   * comptes", and not linked to another Viewzo account: otherwise someone
   * could send their login link to a big creator and count that creator's
   * views as their own.
   */
  private async assertSameAccount(
    userId: string,
    network: SocialNetwork,
    tokens: OAuthTokens,
  ) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { userId_network: { userId, network } },
    });
    if (!account || account.status === AccountStatus.SUSPENDED) {
      throw new BadRequestException({
        message: 'Ajoute d’abord ce compte dans « Mes comptes »',
        code: 'NOT_DECLARED',
      });
    }
    const declared = normalizeHandle(account.handle);
    const connected = tokens.handle ? normalizeHandle(tokens.handle) : null;
    if (
      HANDLE_CHECKED.includes(network) &&
      connected &&
      declared &&
      connected !== declared
    ) {
      throw new BadRequestException({
        message: `Ce compte (@${connected}) n’est pas celui déclaré (@${declared})`,
        code: 'OTHER_ACCOUNT',
      });
    }
    if (tokens.externalId) {
      const other = await this.prisma.socialConnection.findFirst({
        where: {
          network,
          externalId: tokens.externalId,
          userId: { not: userId },
        },
      });
      if (other) {
        throw new BadRequestException({
          message: 'Ce compte est déjà relié à un autre compte Viewzo',
          code: 'LINKED_ELSEWHERE',
        });
      }
    }
  }

  async disconnect(userId: string, network: SocialNetwork) {
    await this.prisma.socialConnection.deleteMany({
      where: { userId, network },
    });
  }

  /** A working token for a creator's account, refreshed when needed. */
  async usable(
    userId: string,
    network: SocialNetwork,
  ): Promise<UsableConnection | null> {
    const row = await this.prisma.socialConnection.findUnique({
      where: { userId_network: { userId, network } },
    });
    if (!row) return null;
    let tokens = this.open(row);
    const provider = this.provider(network);
    const app = this.app(provider);
    if (
      provider.refresh &&
      app &&
      row.expiresAt &&
      row.expiresAt.getTime() - REFRESH_MARGIN_MS < Date.now()
    ) {
      try {
        tokens = { ...tokens, ...(await provider.refresh(app, tokens)) };
        await this.prisma.socialConnection.update({
          where: { id: row.id },
          data: { ...this.seal(tokens), lastError: null },
        });
      } catch (e) {
        await this.fail(userId, network, (e as Error).message);
        return null;
      }
    }
    return {
      accessToken: tokens.accessToken,
      externalId: row.externalId,
      extra: tokens.extra ?? {},
    };
  }

  /** Kept so the creator sees why automatic counting stopped. */
  async fail(userId: string, network: SocialNetwork, message: string) {
    this.logger.warn(`${network} connection of ${userId}: ${message}`);
    await this.prisma.socialConnection.updateMany({
      where: { userId, network },
      data: { lastError: message.slice(0, 300) },
    });
  }

  private seal(t: OAuthTokens) {
    return {
      accessToken: this.crypto.encrypt(t.accessToken),
      refreshToken: t.refreshToken ? this.crypto.encrypt(t.refreshToken) : null,
      expiresAt: t.expiresAt ?? null,
      refreshExpiresAt: t.refreshExpiresAt ?? null,
      externalId: t.externalId ?? null,
      handle: t.handle ?? null,
      extra: t.extra ? this.crypto.encrypt(JSON.stringify(t.extra)) : null,
    };
  }

  private open(row: SocialConnection): OAuthTokens {
    return {
      accessToken: this.crypto.decrypt(row.accessToken),
      refreshToken: row.refreshToken
        ? this.crypto.decrypt(row.refreshToken)
        : undefined,
      expiresAt: row.expiresAt ?? undefined,
      refreshExpiresAt: row.refreshExpiresAt ?? undefined,
      externalId: row.externalId ?? undefined,
      handle: row.handle ?? undefined,
      extra: row.extra
        ? (JSON.parse(this.crypto.decrypt(row.extra)) as Record<string, string>)
        : undefined,
    };
  }

  private provider(network: SocialNetwork) {
    const p = OAUTH_PROVIDERS.find((x) => x.network === network);
    if (!p) throw new NotFoundException();
    return p;
  }

  private app(p: OAuthProvider): OAuthApp | null {
    const clientId = this.config.get<string>(p.env[0]);
    const clientSecret = this.config.get<string>(p.env[1]);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  redirectUri(network: SocialNetwork) {
    const api = this.config.get<string>(
      'API_PUBLIC_URL',
      'http://localhost:3001',
    );
    return `${api}/connections/${network.toLowerCase()}/callback`;
  }

  // Signed so nobody can attach their platform account to someone else.
  private state(userId: string, network: SocialNetwork) {
    const payload = `${userId}.${network}.${Date.now() + STATE_TTL_MS}.${randomBytes(6).toString('hex')}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  private readState(state: string, network: SocialNetwork) {
    const [encoded, sig] = (state ?? '').split('.');
    const payload = Buffer.from(encoded ?? '', 'base64url').toString();
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig ?? '');
    const [userId, net, exp] = payload.split('.');
    if (
      expected.length !== given.length ||
      !timingSafeEqual(expected, given) ||
      net !== network ||
      Number(exp) < Date.now()
    ) {
      throw new BadRequestException('Lien de connexion expiré, recommence');
    }
    return userId;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret)
      .update(`connect:${payload}`)
      .digest('base64url');
  }
}
