import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SessionsService } from './sessions.service';

export interface AuthUser {
  userId: string;
  sessionId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: {
    sub?: string;
    ver?: number;
    sid?: string;
    purpose?: string;
  }): Promise<AuthUser> {
    // Registration tickets are signed with the same key but are not sessions,
    // and tokens from before server-side sessions carry no session id.
    if (payload.purpose || !payload.sub || !payload.sid) {
      throw new UnauthorizedException();
    }
    // A logout, a password change or a removal from the team ends the session
    // at once, not when the access token expires.
    if (
      !(await this.sessions.isActive(
        payload.sid,
        payload.sub,
        payload.ver ?? 0,
      ))
    ) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, sessionId: payload.sid };
  }
}
