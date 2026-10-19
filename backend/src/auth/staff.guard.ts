import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './jwt.strategy';

// Use after JwtAuthGuard: lets only Viewzo team members through.
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const found = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { role: true },
    });
    if (found?.role !== UserRole.STAFF) throw new ForbiddenException();
    return true;
  }
}
