import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AssignmentStatus,
  CampaignStatus,
  PaymentKind,
  PaymentStatus,
  PostReviewStatus,
  Prisma,
  StaffRole,
  UserRole,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { parsePhone } from '../auth/phone';
import { countryScope, StaffActor } from '../auth/staff';
import { CountriesService } from '../countries/countries.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemberRightsDto } from './dto/add-member.dto';

const MEMBER_SELECT = {
  id: true,
  phone: true,
  email: true,
  country: true,
  staffRole: true,
  staffCountries: true,
  createdAt: true,
} as const;

// From this risk score on, a post counts as a fraud alert.
export const ALERT_SCORE = 50;

// Back-office home and team management.
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
  ) {}

  // What is waiting for the team in their countries, one counter per queue.
  async overview(actor: StaffActor) {
    const user = userInScope(actor);
    const scope = countryScope(actor);
    const [accounts, campaigns, withdrawals, assignments, alerts] =
      await Promise.all([
        this.prisma.socialAccount.count({
          where: { status: AccountStatus.PENDING, user },
        }),
        this.prisma.campaign.count({
          where: {
            status: CampaignStatus.PENDING_REVIEW,
            ...(scope ? { countries: { hasSome: scope } } : {}),
          },
        }),
        this.prisma.payment.count({
          where: {
            kind: PaymentKind.PAYOUT,
            status: PaymentStatus.REQUESTED,
            user,
          },
        }),
        this.prisma.taskAssignment.count({
          where: {
            status: AssignmentStatus.SUBMITTED,
            reviewStatus: PostReviewStatus.TO_REVIEW,
            creator: user,
          },
        }),
        // Posts to review that the fraud rules flag.
        this.prisma.taskAssignment.count({
          where: {
            status: AssignmentStatus.SUBMITTED,
            reviewStatus: PostReviewStatus.TO_REVIEW,
            riskScore: { gte: ALERT_SCORE },
            creator: user,
          },
        }),
      ]);
    return {
      accounts,
      campaigns,
      withdrawals,
      assignments,
      alerts,
      // What the web shows and hides for this member.
      me: { staffRole: actor.role, countries: scope ?? [] },
    };
  }

  // Published posts whose views the team still enters by hand.
  async assignments(actor: StaffActor) {
    const rows = await this.prisma.taskAssignment.findMany({
      where: {
        status: AssignmentStatus.SUBMITTED,
        creator: userInScope(actor),
      },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      include: {
        creator: { select: { phone: true, email: true, country: true } },
        task: {
          include: {
            campaign: { select: { id: true, code: true, title: true } },
          },
        },
      },
    });
    return rows.map((a) => ({
      id: a.id,
      postUrl: a.postUrl,
      submittedAt: a.submittedAt,
      validViews: a.validViews,
      earned: a.earned,
      network: a.task.network,
      contentType: a.task.contentType,
      taskBudget: a.task.budget,
      campaign: a.task.campaign,
      creator: a.creator,
    }));
  }

  members() {
    return this.prisma.user.findMany({
      where: { role: UserRole.STAFF },
      orderBy: { createdAt: 'asc' },
      select: MEMBER_SELECT,
    });
  }

  // The person must have logged in once, so the account exists.
  async addMember(actor: StaffActor, phone: string, rights: MemberRightsDto) {
    const { e164 } = parsePhone(phone, this.config.get('DEFAULT_REGION', 'TG'));
    const user = await this.prisma.user.findUnique({
      where: { phone: e164 },
    });
    if (!user) {
      throw new NotFoundException(
        'Aucun compte avec ce numéro, la personne doit d’abord se connecter',
      );
    }
    return this.setRights(actor, user.id, 'STAFF_ADD', rights);
  }

  async updateMember(actor: StaffActor, id: string, rights: MemberRightsDto) {
    if (actor.userId === id) {
      throw new BadRequestException(
        'Tu ne peux pas changer tes propres droits',
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user?.role !== UserRole.STAFF) throw new NotFoundException();
    return this.setRights(actor, id, 'STAFF_UPDATE', rights);
  }

  async removeMember(actor: StaffActor, id: string) {
    if (actor.userId === id) {
      throw new BadRequestException('Tu ne peux pas te retirer toi-même');
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: MEMBER_SELECT,
      });
      if (!user || !user.staffRole) throw new NotFoundException();
      await tx.user.update({
        where: { id },
        data: { role: UserRole.USER, staffRole: null, staffCountries: [] },
      });
      // Their open back-office sessions end now, not when the token expires.
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        actor,
        action: 'STAFF_REMOVE',
        entity: 'User',
        entityId: id,
        before: { staffRole: user.staffRole, countries: user.staffCountries },
      });
    });
  }

  private async setRights(
    actor: StaffActor,
    id: string,
    action: string,
    rights: MemberRightsDto,
  ) {
    const countries = [
      ...new Set((rights.countries ?? []).map((c) => c.toUpperCase())),
    ];
    if (rights.staffRole === StaffRole.COUNTRY_MANAGER && !countries.length) {
      throw new BadRequestException('Indique le ou les pays du responsable');
    }
    await this.countries.assertAllowed(countries);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { staffRole: true, staffCountries: true },
      });
      const updated = await tx.user.update({
        where: { id },
        data: {
          role: UserRole.STAFF,
          staffRole: rights.staffRole,
          staffCountries: countries,
        },
        select: MEMBER_SELECT,
      });
      await this.audit.record(tx, {
        actor,
        action,
        entity: 'User',
        entityId: id,
        before: {
          staffRole: before.staffRole,
          countries: before.staffCountries,
        },
        after: { staffRole: updated.staffRole, countries },
      });
      return updated;
    });
  }
}

/** Filter on the user (creator, owner) for members limited to some countries. */
export function userInScope(
  actor: StaffActor,
): Prisma.UserWhereInput | undefined {
  const scope = countryScope(actor);
  return scope ? { country: { in: scope } } : undefined;
}
