import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  Prisma,
  ProfileType,
  SocialAccount,
  SocialNetwork,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewAccountDto } from './dto/review-account.dto';
import { parseVerificationNumbers, whatsappInstructions } from './whatsapp';

const REVIEW_DELAY_MS = 48 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
// Audience needed for an account to become eligible, whatever the creator level.
const MIN_FOLLOWERS = 1000;
const MIN_AVG_STATUS_VIEWS = 300;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string) {
    const [user, accounts] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.socialAccount.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return accounts.map((a) => this.toView(a, user.country));
  }

  async add(userId: string, network: SocialNetwork, handle: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profiles: true },
    });
    if (!user.profiles.some((p) => p.type === ProfileType.CREATOR)) {
      throw new ForbiddenException("Active d'abord le profil Créateur");
    }
    if (network === SocialNetwork.WHATSAPP_STATUS) {
      // Fail before creating anything the creator could not complete.
      this.whatsappNumber(user.country);
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const account = await this.prisma.socialAccount.create({
          data: {
            userId,
            network,
            handle: handle.trim(),
            verificationCode: this.newCode(),
          },
        });
        return this.toView(account, user.country);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const target = JSON.stringify(e.meta?.target ?? '');
          if (target.includes('verificationCode') && attempt < 5) continue;
          throw new ConflictException('Ce réseau est déjà dans Mes comptes');
        }
        throw e;
      }
    }
  }

  async remove(userId: string, id: string) {
    const account = await this.getOwned(userId, id);
    // Removing and re-adding must not erase a suspension or the 30-day wait.
    if (account.status === AccountStatus.SUSPENDED || this.mustWait(account)) {
      throw new ForbiddenException('Ce compte ne peut pas être retiré');
    }
    await this.prisma.socialAccount.delete({ where: { id } });
  }

  // Sends an account back to verification once the creator fixed the issue.
  async resubmit(userId: string, id: string) {
    const account = await this.getOwned(userId, id);
    if (account.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Compte suspendu : contacte le support');
    }
    if (
      account.status !== AccountStatus.NEEDS_FIX &&
      account.status !== AccountStatus.NOT_ELIGIBLE
    ) {
      throw new BadRequestException('Ce compte est déjà en vérification');
    }
    if (this.mustWait(account)) {
      throw new BadRequestException(
        'Nouvel essai possible à partir du ' +
          account.retryAfter!.toLocaleDateString('fr-FR'),
      );
    }
    const [updated, user] = await Promise.all([
      this.prisma.socialAccount.update({
        where: { id },
        data: {
          status: AccountStatus.PENDING,
          statusReason: null,
          retryAfter: null,
          submittedAt: new Date(),
        },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    return this.toView(updated, user.country);
  }

  // Back-office: accounts waiting for a decision, oldest first.
  async queue(status: AccountStatus = AccountStatus.PENDING) {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { status },
      orderBy: { submittedAt: 'asc' },
      include: { user: true },
      take: 100,
    });
    return accounts.map((a) => this.toStaffView(a));
  }

  // Back-office: links a WhatsApp conversation to the creator by its code.
  async findByCode(code: string) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { verificationCode: code.trim().toUpperCase() },
      include: { user: true },
    });
    if (!account) throw new NotFoundException('Code inconnu');
    return this.toStaffView(account);
  }

  async review(reviewerId: string, id: string, dto: ReviewAccountDto) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id },
    });
    if (!account) throw new NotFoundException();
    const followers = dto.followers ?? account.followers;
    const avgStatusViews = dto.avgStatusViews ?? account.avgStatusViews;
    if (dto.status === AccountStatus.ELIGIBLE) {
      this.assertAudience(account.network, followers, avgStatusViews);
    }
    const reason = dto.reason?.trim() || null;
    const [updated] = await this.prisma.$transaction([
      this.prisma.socialAccount.update({
        where: { id },
        data: {
          status: dto.status,
          statusReason: reason,
          retryAfter:
            dto.status === AccountStatus.NOT_ELIGIBLE
              ? new Date(Date.now() + RETRY_DELAY_MS)
              : null,
          followers,
          avgStatusViews,
        },
        include: { user: true },
      }),
      this.prisma.accountReview.create({
        data: {
          accountId: id,
          userId: account.userId,
          network: account.network,
          reviewerId,
          status: dto.status,
          reason,
        },
      }),
    ]);
    return this.toStaffView(updated);
  }

  private assertAudience(
    network: SocialNetwork,
    followers: number | null,
    avgStatusViews: number | null,
  ) {
    if (network === SocialNetwork.WHATSAPP_STATUS) {
      if ((avgStatusViews ?? 0) < MIN_AVG_STATUS_VIEWS) {
        throw new BadRequestException(
          `Éligible seulement à partir de ${MIN_AVG_STATUS_VIEWS} vues moyennes par statut`,
        );
      }
    } else if ((followers ?? 0) < MIN_FOLLOWERS) {
      throw new BadRequestException(
        `Éligible seulement à partir de ${MIN_FOLLOWERS} abonnés`,
      );
    }
  }

  private async getOwned(userId: string, id: string) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id },
    });
    if (!account || account.userId !== userId) throw new NotFoundException();
    return account;
  }

  private mustWait(account: SocialAccount) {
    return (
      account.status === AccountStatus.NOT_ELIGIBLE &&
      !!account.retryAfter &&
      account.retryAfter > new Date()
    );
  }

  private newCode() {
    return `VZ-${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
  }

  private whatsappNumber(country: string) {
    const number = parseVerificationNumbers(
      this.config.get<string>('WHATSAPP_VERIFICATION_NUMBERS'),
    ).get(country);
    if (!number) {
      throw new ServiceUnavailableException(
        "WhatsApp Statut n'est pas encore disponible dans ton pays",
      );
    }
    return number;
  }

  private instructions(account: SocialAccount, country: string) {
    if (account.network !== SocialNetwork.WHATSAPP_STATUS) {
      return { kind: 'BIO_CODE' as const, code: account.verificationCode };
    }
    return whatsappInstructions(
      this.whatsappNumber(country),
      account.verificationCode,
    );
  }

  private toView(account: SocialAccount, country: string) {
    return {
      id: account.id,
      network: account.network,
      handle: account.handle,
      status: account.status,
      statusReason: account.statusReason,
      retryAfter: account.retryAfter,
      reviewDueAt:
        account.status === AccountStatus.PENDING
          ? new Date(account.submittedAt.getTime() + REVIEW_DELAY_MS)
          : null,
      followers: account.followers,
      avgStatusViews: account.avgStatusViews,
      // Only needed while the creator still has to prove the account is theirs.
      verification:
        account.status === AccountStatus.PENDING ||
        account.status === AccountStatus.NEEDS_FIX
          ? this.instructions(account, country)
          : null,
      createdAt: account.createdAt,
    };
  }

  private toStaffView(
    account: SocialAccount & { user: { phone: string; country: string } },
  ) {
    return {
      id: account.id,
      network: account.network,
      handle: account.handle,
      verificationCode: account.verificationCode,
      status: account.status,
      statusReason: account.statusReason,
      followers: account.followers,
      avgStatusViews: account.avgStatusViews,
      submittedAt: account.submittedAt,
      user: { phone: account.user.phone, country: account.user.country },
    };
  }
}
