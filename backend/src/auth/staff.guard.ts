import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { clientIp } from './client-ip';
import type { AuthUser } from './jwt.strategy';
import { STAFF_ROLES_KEY, StaffActor } from './staff';

// Use after JwtAuthGuard: lets only Viewzo team members with an allowed role
// through, and puts who they are on `req.staff`.
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user: AuthUser; staff?: StaffActor }>();
    const found = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true, staffRole: true, staffCountries: true },
    });
    if (found?.role !== UserRole.STAFF || !found.staffRole) {
      throw new ForbiddenException();
    }
    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      STAFF_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed && !allowed.includes(found.staffRole)) {
      throw new ForbiddenException('Ton rôle ne permet pas cette action');
    }
    req.staff = {
      userId: req.user.userId,
      role: found.staffRole,
      countries: found.staffCountries,
      ip: clientIp(req as never),
    };
    return true;
  }
}
