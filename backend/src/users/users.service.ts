import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProfileType,
  User,
  UserProfile,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type UserWithProfiles = User & { profiles: UserProfile[] };

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findOrCreateByPhone(phone: string, country: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone },
      include: { profiles: true },
    });
    if (existing) return { user: existing, isNew: false };

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // Atomic per-country counter: the rank is assigned once and never changes.
        const counter = await tx.countryCounter.upsert({
          where: { country },
          create: { country, lastRank: 1 },
          update: { lastRank: { increment: 1 } },
        });
        return tx.user.create({
          data: { phone, country, priorityRank: counter.lastRank },
          include: { profiles: true },
        });
      });
      return { user, isNew: true };
    } catch (e) {
      // Two verifications for the same new phone raced; the other one won.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { phone },
          include: { profiles: true },
        });
        return { user, isNew: false };
      }
      throw e;
    }
  }

  async getById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profiles: true },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async activateProfile(userId: string, type: ProfileType) {
    await this.prisma.userProfile.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type },
      update: {},
    });
    return this.getById(userId);
  }

  toView(user: UserWithProfiles) {
    const limit = Number(this.config.get('FOUNDER_BADGE_LIMIT', 1000));
    return {
      id: user.id,
      phone: user.phone,
      country: user.country,
      priorityRank: user.priorityRank,
      isFounder: user.priorityRank <= limit,
      locale: user.locale,
      // Shows the back-office entry to team members.
      isStaff: user.role === UserRole.STAFF,
      createdAt: user.createdAt,
      profiles: user.profiles.map((p) => ({ type: p.type, level: p.level })),
    };
  }
}
