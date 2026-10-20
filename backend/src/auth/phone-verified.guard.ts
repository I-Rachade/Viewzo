import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ProfileType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './jwt.strategy';

export const PHONE_REQUIRED = {
  code: 'PHONE_REQUIRED',
  message: 'Ajoute ton numéro de téléphone pour continuer',
};

/** A creator has to prove a phone number before doing anything as one. */
export function phoneRequired(user: {
  phoneVerifiedAt: Date | null;
  profiles: { type: ProfileType }[];
}) {
  return (
    !user.phoneVerifiedAt &&
    user.profiles.some((p) => p.type === ProfileType.CREATOR)
  );
}

// Use after JwtAuthGuard on creator actions: an account signed up with an
// e-mail stops here until it has a verified phone number.
@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { phoneVerifiedAt: true, profiles: { select: { type: true } } },
    });
    if (user && phoneRequired(user)) {
      throw new ForbiddenException(PHONE_REQUIRED);
    }
    return true;
  }
}
