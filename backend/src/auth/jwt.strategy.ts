import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  userId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub?: string;
    ver?: number;
    purpose?: string;
  }): Promise<AuthUser> {
    // Registration tickets are signed with the same key but are not sessions.
    if (payload.purpose || !payload.sub) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { tokenVersion: true },
    });
    // A password change bumps the version and ends older sessions.
    if (!user || user.tokenVersion !== (payload.ver ?? 0)) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub };
  }
}
