import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

// Codes we generate and check ourselves, for a phone number or an email.
@Injectable()
export class OtpStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(target: string): Promise<string> {
    const last = await this.prisma.otpChallenge.findFirst({
      where: { target },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException(
        'Patiente une minute avant de redemander un code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        target,
        codeHash: this.hash(target, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }

  async check(target: string, code: string): Promise<void> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { target, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge || challenge.attempts >= MAX_ATTEMPTS) {
      throw new UnauthorizedException('Code expiré, demande un nouveau code');
    }

    const expected = Buffer.from(challenge.codeHash, 'hex');
    const actual = Buffer.from(this.hash(target, code), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code incorrect');
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
  }

  private hash(target: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
      .update(`${target}:${code}`)
      .digest('hex');
  }
}
