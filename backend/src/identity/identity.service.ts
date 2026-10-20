import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdentityCheck,
  IdentityCheckStatus,
  NotificationType,
  Prisma,
  ProfileType,
} from '@prisma/client';
import { createHmac } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { assertCountry, assertNotSelf, countryScope } from '../auth/staff';
import type { StaffActor } from '../auth/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { cleanFirstName } from '../users/users.service';
import { IDENTITY_PROVIDER } from './identity-provider';
import type { IdentityDecision, IdentityProvider } from './identity-provider';

const DAY = 24 * 3600 * 1000;
// A session left unfinished this long is started again from scratch.
const SESSION_TTL_MS = DAY;
// Declined checks allowed per 30 days before the person has to wait.
const MAX_DECLINED = 3;
const DECLINED_WINDOW_MS = 30 * DAY;

// Profiles whose level 2 depends on the identity (specification, "Niveaux").
export const IDENTITY_PROFILES: ProfileType[] = [
  ProfileType.CREATOR,
  ProfileType.ADVERTISER,
];

const OPEN: IdentityCheckStatus[] = [
  IdentityCheckStatus.STARTED,
  IdentityCheckStatus.IN_REVIEW,
];

const GENERIC_DECLINE =
  'Pièce ou selfie non reconnus. Reprends la vérification avec une pièce valide, bien éclairée.';
const DUPLICATE_DOCUMENT = 'Cette pièce est déjà utilisée par un autre compte';

type Tx = Prisma.TransactionClient;

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(IDENTITY_PROVIDER) private readonly provider: IdentityProvider,
  ) {}

  /** What the identity screen shows. */
  async status(userId: string) {
    const [user, last] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        include: { profiles: true },
      }),
      this.latest(userId),
    ]);
    const profiles = user.profiles.filter((p) =>
      IDENTITY_PROFILES.includes(p.type),
    );
    return {
      // Verification is closed until the provider is set up.
      available: this.provider.enabled,
      verified: last?.status === IdentityCheckStatus.APPROVED,
      needsProfile: profiles.length === 0,
      check: last ? this.toView(last) : null,
      retryAfter: await this.retryAfter(userId),
    };
  }

  /** Opens a verification session and returns the page to send the person to. */
  async start(userId: string) {
    if (!this.provider.enabled) {
      throw new ServiceUnavailableException({
        code: 'IDENTITY_CLOSED',
        message: 'La vérification d’identité ouvre bientôt',
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { profiles: true },
    });
    if (!user.profiles.some((p) => IDENTITY_PROFILES.includes(p.type))) {
      throw new BadRequestException(
        'Active d’abord ton profil créateur ou annonceur',
      );
    }

    const last = await this.latest(userId);
    if (last?.status === IdentityCheckStatus.APPROVED) {
      throw new ConflictException('Ton identité est déjà vérifiée');
    }
    if (last?.status === IdentityCheckStatus.IN_REVIEW) {
      throw new ConflictException(
        'Ta vérification est en cours d’examen par l’équipe',
      );
    }
    if (last?.status === IdentityCheckStatus.STARTED) {
      if (last.url && Date.now() - last.createdAt.getTime() < SESSION_TTL_MS) {
        return this.toView(last);
      }
      await this.prisma.identityCheck.updateMany({
        where: { id: last.id, status: IdentityCheckStatus.STARTED },
        data: { status: IdentityCheckStatus.ABANDONED },
      });
    }
    const retryAfter = await this.retryAfter(userId);
    if (retryAfter) {
      throw new ForbiddenException({
        code: 'IDENTITY_RETRY_LATER',
        message: `Trop d’essais refusés : réessaie à partir du ${retryAfter.toLocaleDateString('fr-FR')}`,
      });
    }

    const check = await this.prisma.identityCheck.create({
      data: { userId, provider: this.provider.name },
    });
    try {
      const web = this.config.get<string>(
        'WEB_ORIGIN',
        'http://localhost:3000',
      );
      const session = await this.provider.createSession(
        check.id,
        `${web}/identite?check=${check.id}`,
      );
      const updated = await this.prisma.identityCheck.update({
        where: { id: check.id },
        data: { sessionId: session.sessionId, url: session.url },
      });
      return this.toView(updated);
    } catch (e) {
      await this.prisma.identityCheck.update({
        where: { id: check.id },
        data: { status: IdentityCheckStatus.ABANDONED },
      });
      throw e;
    }
  }

  /** Asks the provider again, after the person comes back from its pages. */
  async refresh(userId: string) {
    const last = await this.latest(userId);
    if (!last) throw new NotFoundException('Aucune vérification en cours');
    const synced = await this.sync(last);
    return this.toView(synced);
  }

  /** Provider notification: the decision is always re-read from its API. */
  async onWebhook(sessionId: string | undefined) {
    if (!sessionId) return;
    const check = await this.prisma.identityCheck.findUnique({
      where: { sessionId },
    });
    if (check) await this.sync(check);
  }

  /** Name on the approved identity, for the finance team's withdrawal checks. */
  async verifiedNames(userIds: string[]) {
    if (!userIds.length) return new Map<string, string>();
    const checks = await this.prisma.identityCheck.findMany({
      where: {
        userId: { in: userIds },
        status: IdentityCheckStatus.APPROVED,
        fullName: { not: null },
      },
      orderBy: { reviewedAt: 'desc' },
      select: { userId: true, fullName: true },
    });
    const names = new Map<string, string>();
    for (const c of checks) {
      if (!names.has(c.userId)) names.set(c.userId, c.fullName!);
    }
    return names;
  }

  // Back-office

  async queue(
    actor: StaffActor,
    status: IdentityCheckStatus = IdentityCheckStatus.IN_REVIEW,
  ) {
    const scope = countryScope(actor);
    const checks = await this.prisma.identityCheck.findMany({
      where: {
        status,
        ...(scope ? { user: { country: { in: scope } } } : {}),
      },
      orderBy: {
        updatedAt: status === IdentityCheckStatus.IN_REVIEW ? 'asc' : 'desc',
      },
      take: 100,
      include: {
        user: {
          select: {
            phone: true,
            email: true,
            country: true,
            profiles: { select: { type: true, level: true } },
          },
        },
      },
    });
    const hashes = checks
      .map((c) => c.documentNumberHash)
      .filter((h): h is string => Boolean(h));
    const sameDocument = hashes.length
      ? await this.prisma.identityCheck.findMany({
          where: { documentNumberHash: { in: hashes } },
          select: { userId: true, documentNumberHash: true },
        })
      : [];
    return checks.map((c) => ({
      ...this.toView(c),
      userId: c.userId,
      user: c.user,
      dateOfBirth: c.dateOfBirth,
      documentCountry: c.documentCountry,
      documentNumberLast4: c.documentNumberLast4,
      livenessScore: c.livenessScore,
      faceMatchScore: c.faceMatchScore,
      providerStatus: c.providerStatus,
      // Other accounts that showed the same document.
      sameDocumentUsers: [
        ...new Set(
          sameDocument
            .filter(
              (s) =>
                s.documentNumberHash === c.documentNumberHash &&
                s.userId !== c.userId,
            )
            .map((s) => s.userId),
        ),
      ],
    }));
  }

  async review(
    actor: StaffActor,
    id: string,
    decision: 'APPROVE' | 'DECLINE',
    reason?: string,
  ) {
    const check = await this.prisma.identityCheck.findUnique({
      where: { id },
      include: { user: { select: { country: true } } },
    });
    if (!check) throw new NotFoundException();
    assertCountry(actor, check.user.country);
    assertNotSelf(actor, check.userId);
    const note = reason?.trim() || null;
    if (decision === 'DECLINE' && !note) {
      throw new BadRequestException('Indique le motif du refus');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Claim the check so two members can't decide on it twice.
      const claimed = await tx.identityCheck.updateMany({
        where: { id, status: IdentityCheckStatus.IN_REVIEW },
        data: {
          status:
            decision === 'APPROVE'
              ? IdentityCheckStatus.APPROVED
              : IdentityCheckStatus.DECLINED,
          reason: note,
          reviewerId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(
          'Cette vérification n’attend plus de décision',
        );
      }
      const after = await tx.identityCheck.findUniqueOrThrow({ where: { id } });
      if (decision === 'APPROVE') await this.raiseLevels(tx, check.userId);
      await this.audit.record(tx, {
        actor,
        action:
          decision === 'APPROVE' ? 'identity.approve' : 'identity.decline',
        entity: 'IdentityCheck',
        entityId: id,
        before: { status: check.status },
        after: { status: after.status },
        reason: note,
      });
      return after;
    });
    await this.notifyDecision(updated);
    return this.toView(updated);
  }

  // Internals

  private latest(userId: string) {
    return this.prisma.identityCheck.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async retryAfter(userId: string) {
    const declined = await this.prisma.identityCheck.findMany({
      where: {
        userId,
        status: IdentityCheckStatus.DECLINED,
        updatedAt: { gte: new Date(Date.now() - DECLINED_WINDOW_MS) },
      },
      orderBy: { updatedAt: 'asc' },
      select: { updatedAt: true },
    });
    if (declined.length < MAX_DECLINED) return null;
    return new Date(
      declined[declined.length - MAX_DECLINED].updatedAt.getTime() +
        DECLINED_WINDOW_MS,
    );
  }

  /** Applies the provider's decision to a check the team has not decided on. */
  private async sync(check: IdentityCheck): Promise<IdentityCheck> {
    if (!OPEN.includes(check.status) || check.reviewerId || !check.sessionId) {
      return check;
    }
    const decision = await this.provider.decision(check.sessionId);
    const data = this.facts(decision);

    let status: IdentityCheckStatus = check.status;
    let reason: string | null = check.reason;
    switch (decision.outcome) {
      case 'PENDING':
        break;
      case 'ABANDONED':
        status = IdentityCheckStatus.ABANDONED;
        break;
      case 'DECLINED':
        status = IdentityCheckStatus.DECLINED;
        reason = decision.warnings.join(' · ') || GENERIC_DECLINE;
        break;
      case 'IN_REVIEW':
        status = IdentityCheckStatus.IN_REVIEW;
        reason = decision.warnings.join(' · ') || null;
        break;
      case 'APPROVED': {
        const duplicate =
          data.documentNumberHash &&
          (await this.prisma.identityCheck.findFirst({
            where: {
              documentNumberHash: data.documentNumberHash,
              userId: { not: check.userId },
              status: {
                in: [
                  IdentityCheckStatus.APPROVED,
                  IdentityCheckStatus.IN_REVIEW,
                ],
              },
            },
            select: { id: true },
          }));
        if (duplicate) {
          status = IdentityCheckStatus.IN_REVIEW;
          reason = DUPLICATE_DOCUMENT;
        } else if (!data.fullName) {
          status = IdentityCheckStatus.IN_REVIEW;
          reason = 'Nom non lu sur la pièce';
        } else {
          status = IdentityCheckStatus.APPROVED;
          reason = null;
        }
        break;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.identityCheck.updateMany({
        where: { id: check.id, status: { in: OPEN }, reviewerId: null },
        data: {
          ...data,
          status,
          reason,
          checkedAt: new Date(),
          ...(status === IdentityCheckStatus.APPROVED
            ? { reviewedAt: new Date() }
            : {}),
        },
      });
      const after = await tx.identityCheck.findUniqueOrThrow({
        where: { id: check.id },
      });
      if (claimed.count === 0 || after.status === check.status) return after;
      if (status === IdentityCheckStatus.APPROVED) {
        await this.raiseLevels(tx, check.userId);
        // Greets the person by the first name on the ID, unless they gave one.
        const firstName = cleanFirstName(decision.firstName);
        if (firstName) {
          await tx.user.updateMany({
            where: { id: check.userId, firstName: null },
            data: { firstName },
          });
        }
      }
      await this.audit.record(tx, {
        actor: null,
        action: `identity.${status.toLowerCase()}`,
        entity: 'IdentityCheck',
        entityId: check.id,
        before: { status: check.status },
        after: { status, providerStatus: decision.providerStatus },
        reason,
      });
      return after;
    });
    if (updated.status !== check.status) await this.notifyDecision(updated);
    return updated;
  }

  private facts(d: IdentityDecision) {
    const number = d.documentNumber?.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    return {
      providerStatus: d.providerStatus,
      fullName: d.fullName ?? null,
      dateOfBirth: d.dateOfBirth ?? null,
      documentType: d.documentType ?? null,
      documentCountry: d.documentCountry ?? null,
      documentNumberLast4: number ? number.slice(-4) : null,
      documentNumberHash: number
        ? createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
            .update(`identity-document:${number}`)
            .digest('hex')
        : null,
      livenessScore: d.livenessScore ?? null,
      faceMatchScore: d.faceMatchScore ?? null,
    };
  }

  /** Level 2 for the creator and advertiser profiles still at level 1. */
  private raiseLevels(tx: Tx, userId: string) {
    return tx.userProfile.updateMany({
      where: { userId, type: { in: IDENTITY_PROFILES }, level: { lt: 2 } },
      data: { level: 2 },
    });
  }

  private async notifyDecision(check: IdentityCheck) {
    const texts: Partial<Record<IdentityCheckStatus, [string, string]>> = {
      APPROVED: [
        'Identité vérifiée',
        'Tu passes au niveau 2 : toutes les tâches et les retraits sont ouverts.',
      ],
      DECLINED: [
        'Vérification d’identité refusée',
        check.reason ?? GENERIC_DECLINE,
      ],
      IN_REVIEW: [
        'Vérification d’identité en examen',
        'L’équipe Viewzo vérifie ton dossier, en général sous 48 h.',
      ],
    };
    const text = texts[check.status];
    if (!text) return;
    await this.notifications.notify(check.userId, {
      type: NotificationType.IDENTITY_REVIEWED,
      title: text[0],
      body: text[1],
      link: '/identite',
    });
  }

  private toView(c: IdentityCheck) {
    return {
      id: c.id,
      status: c.status,
      url: c.status === IdentityCheckStatus.STARTED ? c.url : null,
      fullName: c.fullName,
      documentType: c.documentType,
      reason: c.reason,
      createdAt: c.createdAt,
      reviewedAt: c.reviewedAt,
    };
  }
}
