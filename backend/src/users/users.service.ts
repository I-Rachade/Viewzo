import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

// A verified way to reach and identify a person.
export interface Contact {
  kind: 'email' | 'phone';
  value: string;
}

export const ALREADY_REGISTERED =
  'Un compte existe déjà avec cet identifiant, connecte-toi';
const CONTACT_TAKEN = 'Cet identifiant est déjà utilisé par un autre compte';

function isUniqueViolation(e: unknown) {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

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
      const user = await this.createRanked(country, {
        phone,
        phoneVerifiedAt: new Date(),
      });
      return { user, isNew: true };
    } catch (e) {
      // Two verifications for the same new phone raced; the other one won.
      if (isUniqueViolation(e)) {
        const user = await this.prisma.user.findUniqueOrThrow({
          where: { phone },
          include: { profiles: true },
        });
        return { user, isNew: false };
      }
      throw e;
    }
  }

  findByContact(contact: Contact) {
    return this.prisma.user.findUnique({
      where:
        contact.kind === 'email'
          ? { email: contact.value }
          : { phone: contact.value },
      include: { profiles: true },
    });
  }

  // Sign-up with a verified email or phone, a password and a starting role.
  async register(input: {
    contact: Contact;
    country: string;
    passwordHash: string;
    role: ProfileType;
  }) {
    const { contact, country, passwordHash, role } = input;
    const now = new Date();
    try {
      return await this.createRanked(country, {
        ...(contact.kind === 'email'
          ? { email: contact.value, emailVerifiedAt: now }
          : { phone: contact.value, phoneVerifiedAt: now }),
        passwordHash,
        profiles: { create: { type: role } },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(ALREADY_REGISTERED);
      throw e;
    }
  }

  // Adds or replaces the email or phone of an existing account.
  async setContact(userId: string, contact: Contact) {
    const now = new Date();
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data:
          contact.kind === 'email'
            ? { email: contact.value, emailVerifiedAt: now }
            : { phone: contact.value, phoneVerifiedAt: now },
        include: { profiles: true },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(CONTACT_TAKEN);
      throw e;
    }
  }

  private createRanked(
    country: string,
    data: Omit<Prisma.UserCreateInput, 'country' | 'priorityRank'>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Atomic per-country counter: the rank is assigned once and never changes.
      const counter = await tx.countryCounter.upsert({
        where: { country },
        create: { country, lastRank: 1 },
        update: { lastRank: { increment: 1 } },
      });
      return tx.user.create({
        data: { ...data, country, priorityRank: counter.lastRank },
        include: { profiles: true },
      });
    });
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
      email: user.email,
      hasPassword: user.passwordHash !== null,
      country: user.country,
      priorityRank: user.priorityRank,
      isFounder: user.priorityRank <= limit,
      locale: user.locale,
      // Shows the back-office entry to team members.
      isStaff: user.role === UserRole.STAFF && user.staffRole !== null,
      // What the back-office shows this member; null outside the team.
      staffRole: user.role === UserRole.STAFF ? user.staffRole : null,
      createdAt: user.createdAt,
      profiles: user.profiles.map((p) => ({ type: p.type, level: p.level })),
    };
  }
}
