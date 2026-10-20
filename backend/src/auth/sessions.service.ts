import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Access tokens are short; the refresh token keeps the device signed in.
export const ACCESS_TOKEN_TTL = '15m';
const USER_SESSION_MS = 30 * 24 * 3600 * 1000;
// Back-office sessions end after a working day.
const STAFF_SESSION_MS = 12 * 3600 * 1000;

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Server-side sessions: every sign-in is a row that can be ended (logout,
 * password change, removal from the team). The refresh token is replaced on
 * each use; presenting an old one means it was copied, and ends the session.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async issue(
    user: Pick<User, 'id' | 'role' | 'tokenVersion'>,
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const id = randomBytes(16).toString('hex');
    const refreshToken = this.newToken(id);
    const expiresAt = new Date(Date.now() + this.lifetime(user.role));
    await this.prisma.session.create({
      data: {
        id,
        userId: user.id,
        tokenHash: hash(refreshToken),
        expiresAt,
        userAgent: client.userAgent?.slice(0, 200),
        ip: client.ip,
      },
    });
    return {
      accessToken: await this.access(user, id),
      refreshToken,
      refreshExpiresAt: expiresAt,
    };
  }

  /** A new access token and a new refresh token for a valid refresh token. */
  async refresh(refreshToken: string, client: ClientInfo) {
    const id = refreshToken.split('.')[0] ?? '';
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expirée, reconnecte-toi');
    }
    const next = this.newToken(id);
    // Only the current token may be swapped; a reused old one ends it all.
    const swapped = await this.prisma.session.updateMany({
      where: { id, tokenHash: hash(refreshToken), revokedAt: null },
      data: {
        tokenHash: hash(next),
        lastUsedAt: new Date(),
        ip: client.ip,
        // Sliding for users, fixed for the back-office.
        ...(session.user.role === UserRole.STAFF
          ? {}
          : { expiresAt: new Date(Date.now() + USER_SESSION_MS) }),
      },
    });
    if (swapped.count === 0) {
      await this.revoke(id);
      throw new UnauthorizedException('Session expirée, reconnecte-toi');
    }
    const fresh = await this.prisma.session.findUniqueOrThrow({
      where: { id },
    });
    return {
      user: session.user,
      session: {
        accessToken: await this.access(session.user, id),
        refreshToken: next,
        refreshExpiresAt: fresh.expiresAt,
      } satisfies IssuedSession,
    };
  }

  /** Ends one session, by its id or by its refresh token. */
  async revoke(idOrToken: string) {
    const id = idOrToken.split('.')[0] ?? '';
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Whether an access token's session is still open (checked per request). */
  async isActive(sessionId: string, userId: string, tokenVersion: number) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: { tokenVersion: true } },
      },
    });
    return (
      !!session &&
      session.userId === userId &&
      !session.revokedAt &&
      session.expiresAt > new Date() &&
      session.user.tokenVersion === tokenVersion
    );
  }

  private access(user: Pick<User, 'id' | 'tokenVersion'>, sid: string) {
    return this.jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion, sid },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
  }

  private newToken(sessionId: string) {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  private lifetime(role: UserRole) {
    return role === UserRole.STAFF ? STAFF_SESSION_MS : USER_SESSION_MS;
  }
}

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
