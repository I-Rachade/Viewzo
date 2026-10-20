import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  AutoRejection,
  FollowersSource,
  NotificationType,
  Prisma,
  ProfileType,
  SocialAccount,
  SocialNetwork,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddAccountDto } from './dto/add-account.dto';
import { ReviewAccountDto } from './dto/review-account.dto';
import { parseHandle, profileUrl } from './handle';
import { judge, PROFILE_CHECKERS } from './profile-checks';
import type { ProfileChecker } from './profile-checks';
import { parseVerificationNumbers, whatsappInstructions } from './whatsapp';

const STAFF_INCLUDE = {
  user: {
    include: {
      accounts: {
        select: { id: true, network: true, handle: true, status: true },
      },
    },
  },
} satisfies Prisma.SocialAccountInclude;

const REVIEW_DELAY_MS = 48 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
// Audience needed for an account to become eligible, whatever the creator level.
const MIN_FOLLOWERS = 1000;
const MIN_AVG_STATUS_VIEWS = 300;

// Shown to the creator when the system refuses an account on its own.
const AUTO_REJECTION_TEXT: Record<AutoRejection, string> = {
  NOT_FOUND:
    'Compte introuvable : vérifie le nom du compte, puis retire-le et ajoute-le à nouveau.',
  ANONYMOUS:
    'Compte anonyme : un compte sans nom ni photo de profil ne peut pas être utilisé sur Viewzo.',
};

const ACCOUNT_STATUS_TEXT: Partial<Record<AccountStatus, string>> = {
  ELIGIBLE: 'éligible',
  NEEDS_FIX: 'à corriger',
  NOT_ELIGIBLE: 'non éligible',
  SUSPENDED: 'suspendu',
};

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PROFILE_CHECKERS) private readonly checkers: ProfileChecker[],
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

  async add(userId: string, dto: AddAccountDto) {
    const { network } = dto;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profiles: true },
    });
    if (!user.profiles.some((p) => p.type === ProfileType.CREATOR)) {
      throw new ForbiddenException("Active d'abord le profil Créateur");
    }
    const parsed = parseHandle(network, dto.handle);
    if (!parsed) {
      throw new BadRequestException(
        network === SocialNetwork.WHATSAPP_STATUS
          ? 'Numéro WhatsApp invalide'
          : 'Nom de compte invalide : écris le nom (@nom) ou colle le lien du profil',
      );
    }
    if (network === SocialNetwork.WHATSAPP_STATUS) {
      // Fail before creating anything the creator could not complete.
      this.whatsappNumber(user.country);
    }

    let account: SocialAccount;
    for (let attempt = 0; ; attempt++) {
      try {
        account = await this.prisma.socialAccount.create({
          data: {
            userId,
            network,
            handle: parsed.name,
            handleKey: parsed.key,
            verificationCode: this.newCode(),
            declaredFollowers: dto.followers ?? null,
            notAnonymousConfirmedAt: new Date(),
          },
        });
        break;
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const target = JSON.stringify(e.meta?.target ?? '');
          if (target.includes('verificationCode') && attempt < 5) continue;
          if (target.includes('handleKey')) {
            throw new ConflictException(
              'Ce compte est déjà inscrit sur Viewzo. Si c’est le tien, contacte le support.',
            );
          }
          throw new ConflictException(
            'Tu as déjà un compte sur ce réseau dans Mes comptes',
          );
        }
        throw e;
      }
    }
    account = await this.precheck(account);
    return this.toView(account, user.country);
  }

  /**
   * Asks the platform about the account where it can: refuses it when it does
   * not exist or is anonymous, and fills in the follower count it finds.
   * Everything else stays with the team.
   */
  private async precheck(account: SocialAccount) {
    const checker = this.checkers.find(
      (c) => c.network === account.network && c.enabled,
    );
    if (!checker) return account;
    let verdict: ReturnType<typeof judge>;
    try {
      verdict = judge(
        await checker.check(parseHandle(account.network, account.handle)!.name),
      );
    } catch (e) {
      this.logger.warn(`Profile check ${account.network}: ${String(e)}`);
      return account;
    }
    const followers = verdict.followers;
    if (!verdict.rejection) {
      return this.prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          autoCheckedAt: new Date(),
          ...(followers !== undefined
            ? { followers, followersSource: FollowersSource.SYSTEM }
            : {}),
        },
      });
    }
    const reason = AUTO_REJECTION_TEXT[verdict.rejection];
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.socialAccount.update({
        where: { id: account.id },
        data: {
          status: AccountStatus.NOT_ELIGIBLE,
          statusReason: reason,
          // No waiting time: the creator can remove it and add the right one.
          retryAfter: null,
          autoRejection: verdict.rejection,
          autoCheckedAt: new Date(),
          ...(followers !== undefined
            ? { followers, followersSource: FollowersSource.SYSTEM }
            : {}),
        },
      });
      await tx.accountReview.create({
        data: {
          accountId: account.id,
          userId: account.userId,
          network: account.network,
          reviewerId: null,
          status: AccountStatus.NOT_ELIGIBLE,
          reason,
        },
      });
      await this.audit.record(tx, {
        actor: null,
        action: 'ACCOUNT_AUTO_REJECTED',
        entity: 'SocialAccount',
        entityId: account.id,
        before: { status: account.status },
        after: {
          status: AccountStatus.NOT_ELIGIBLE,
          rejection: verdict.rejection,
        },
        reason,
      });
      return result;
    });
    await this.notifications.notify(account.userId, {
      type: NotificationType.ACCOUNT_REVIEWED,
      title: `Compte ${account.handle} : non éligible`,
      body: reason,
      link: '/comptes',
    });
    return updated;
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
    const [resubmitted, user] = await Promise.all([
      this.prisma.socialAccount.update({
        where: { id },
        data: {
          status: AccountStatus.PENDING,
          statusReason: null,
          retryAfter: null,
          autoRejection: null,
          submittedAt: new Date(),
        },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    // The creator may have fixed the profile: ask the platform again.
    const updated = await this.precheck(resubmitted);
    return this.toView(updated, user.country);
  }

  // Back-office: accounts waiting for a decision, oldest first.
  // With auto, only the accounts the system refused, to catch its mistakes.
  async queue(
    actor: StaffActor,
    status: AccountStatus = AccountStatus.PENDING,
    auto = false,
  ) {
    const scope = countryScope(actor);
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        ...(auto ? { autoRejection: { not: null } } : { status }),
        ...(scope ? { user: { country: { in: scope } } } : {}),
      },
      orderBy: { submittedAt: 'asc' },
      include: STAFF_INCLUDE,
      take: 100,
    });
    return accounts.map((a) => this.toStaffView(a));
  }

  // Back-office: links a WhatsApp conversation to the creator by its code.
  async findByCode(actor: StaffActor, code: string) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { verificationCode: code.trim().toUpperCase() },
      include: STAFF_INCLUDE,
    });
    if (!account) throw new NotFoundException('Code inconnu');
    assertCountry(actor, account.user.country);
    return this.toStaffView(account);
  }

  async review(actor: StaffActor, id: string, dto: ReviewAccountDto) {
    const account = await this.prisma.socialAccount.findUnique({
      where: { id },
      include: { user: { select: { country: true } } },
    });
    if (!account) throw new NotFoundException();
    assertCountry(actor, account.user.country);
    assertNotSelf(actor, account.userId);
    const followers = dto.followers ?? account.followers;
    const avgStatusViews = dto.avgStatusViews ?? account.avgStatusViews;
    if (dto.status === AccountStatus.ELIGIBLE) {
      this.assertAudience(account.network, followers, avgStatusViews);
    }
    const followersSource = this.followersSource(account, dto);
    const reason = dto.reason?.trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.socialAccount.update({
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
          followersSource,
          autoRejection: null,
        },
        include: STAFF_INCLUDE,
      });
      await tx.accountReview.create({
        data: {
          accountId: id,
          userId: account.userId,
          network: account.network,
          reviewerId: actor.userId,
          status: dto.status,
          reason,
        },
      });
      await this.audit.record(tx, {
        actor,
        action: 'ACCOUNT_REVIEW',
        entity: 'SocialAccount',
        entityId: id,
        before: {
          status: account.status,
          followers: account.followers,
          avgStatusViews: account.avgStatusViews,
        },
        after: { status: dto.status, followers, avgStatusViews },
        reason,
      });
      return result;
    });
    const label = ACCOUNT_STATUS_TEXT[dto.status];
    if (label) {
      await this.notifications.notify(account.userId, {
        type: NotificationType.ACCOUNT_REVIEWED,
        title: `Compte ${account.handle} : ${label}`,
        body: reason ?? 'Résultat de la vérification de ton compte.',
        link: '/comptes',
      });
    }
    return this.toStaffView(updated);
  }

  // Who the count the team saved comes from: a figure the creator declared
  // and the team kept counts as theirs, any other figure as the team's.
  private followersSource(account: SocialAccount, dto: ReviewAccountDto) {
    const given =
      account.network === SocialNetwork.WHATSAPP_STATUS
        ? { value: dto.avgStatusViews, saved: account.avgStatusViews }
        : { value: dto.followers, saved: account.followers };
    if (given.value === undefined || given.value === given.saved) {
      return account.followersSource;
    }
    return given.value === account.declaredFollowers
      ? FollowersSource.CREATOR
      : FollowersSource.ADMIN;
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
      declaredFollowers: account.declaredFollowers,
      autoRejection: account.autoRejection,
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
    account: Prisma.SocialAccountGetPayload<{ include: typeof STAFF_INCLUDE }>,
  ) {
    const name = parseHandle(account.network, account.handle)?.name;
    return {
      id: account.id,
      network: account.network,
      handle: account.handle,
      profileUrl: name ? profileUrl(account.network, name) : null,
      verificationCode: account.verificationCode,
      status: account.status,
      statusReason: account.statusReason,
      followers: account.followers,
      avgStatusViews: account.avgStatusViews,
      declaredFollowers: account.declaredFollowers,
      followersSource: account.followersSource,
      notAnonymousConfirmed: !!account.notAnonymousConfirmedAt,
      autoRejection: account.autoRejection,
      autoCheckedAt: account.autoCheckedAt,
      submittedAt: account.submittedAt,
      user: {
        id: account.user.id,
        phone: account.user.phone,
        email: account.user.email,
        country: account.user.country,
      },
      // The creator's accounts on other networks, so the team sees the whole picture.
      otherAccounts: account.user.accounts
        .filter((a) => a.id !== account.id)
        .map((a) => ({
          network: a.network,
          handle: a.handle,
          status: a.status,
        })),
    };
  }
}
