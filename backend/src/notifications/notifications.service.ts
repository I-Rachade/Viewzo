import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}

// In-app messages: the bell on the web and in the app reads them.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never fails the action that triggered it. */
  async notify(userId: string, input: NotificationInput) {
    await this.notifyMany([userId], input);
  }

  async notifyMany(userIds: string[], input: NotificationInput) {
    if (!userIds.length) return;
    try {
      await this.prisma.notification.createMany({
        data: userIds.map((userId) => ({ userId, ...input })),
      });
    } catch (e) {
      this.logger.error(`Notification ${input.type} not saved`, e as Error);
    }
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.unreadCount(userId),
    ]);
    return { unread, items };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { unread: await this.unreadCount(userId) };
  }
}
