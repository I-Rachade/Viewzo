import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StaffActor } from '../auth/staff';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface AuditEntry {
  // Null for actions taken by the system (webhooks, jobs).
  actor: StaffActor | { userId: string; ip?: string } | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

/**
 * Writes to the append-only journal. Pass the transaction of the action so
 * the entry and the change are saved together or not at all.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(db: Db | undefined, entry: AuditEntry) {
    const actor = entry.actor;
    await (db ?? this.prisma).auditLog.create({
      data: {
        actorId: actor?.userId ?? null,
        actorRole: actor && 'role' in actor ? actor.role : null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        reason: entry.reason ?? null,
        ip: actor?.ip ?? null,
      },
    });
  }

  /** Back-office: the journal of one record, or the latest entries. */
  list(filter: { entity?: string; entityId?: string; actorId?: string }) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filter.entity ? { entity: filter.entity } : {}),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

// Dates and other values as plain JSON; undefined stays out of the row.
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
