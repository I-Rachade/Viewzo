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
  UserRole,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { parsePhone } from '../auth/phone';
import { PrismaService } from '../prisma/prisma.service';

const MEMBER_SELECT = {
  id: true,
  phone: true,
  email: true,
  country: true,
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
  ) {}

  // What is waiting for the team, one counter per queue.
  async overview() {
    const [accounts, campaigns, withdrawals, assignments, alerts] =
      await Promise.all([
        this.prisma.socialAccount.count({
          where: { status: AccountStatus.PENDING },
        }),
        this.prisma.campaign.count({
          where: { status: CampaignStatus.PENDING_REVIEW },
        }),
        this.prisma.payment.count({
          where: { kind: PaymentKind.PAYOUT, status: PaymentStatus.REQUESTED },
        }),
        this.prisma.taskAssignment.count({
          where: {
            status: AssignmentStatus.SUBMITTED,
            reviewStatus: PostReviewStatus.TO_REVIEW,
          },
        }),
        // Posts to review that the fraud rules flag.
        this.prisma.taskAssignment.count({
          where: {
            status: AssignmentStatus.SUBMITTED,
            reviewStatus: PostReviewStatus.TO_REVIEW,
            riskScore: { gte: ALERT_SCORE },
          },
        }),
      ]);
    return { accounts, campaigns, withdrawals, assignments, alerts };
  }

  // Published posts whose views the team still enters by hand.
  async assignments() {
    const rows = await this.prisma.taskAssignment.findMany({
      where: { status: AssignmentStatus.SUBMITTED },
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
  async addMember(phone: string) {
    const { e164 } = parsePhone(phone, this.config.get('DEFAULT_REGION', 'TG'));
    const user = await this.prisma.user.findUnique({
      where: { phone: e164 },
    });
    if (!user) {
      throw new NotFoundException(
        'Aucun compte avec ce numéro, la personne doit d’abord se connecter',
      );
    }
    return this.prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.STAFF },
      select: MEMBER_SELECT,
    });
  }

  async removeMember(staffId: string, id: string) {
    if (staffId === id) {
      throw new BadRequestException('Tu ne peux pas te retirer toi-même');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (user?.role !== UserRole.STAFF) throw new NotFoundException();
    await this.prisma.user.update({
      where: { id },
      data: { role: UserRole.USER },
    });
  }
}
