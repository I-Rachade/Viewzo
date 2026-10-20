import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { StaffActor } from '../auth/staff';
import { PrismaService } from '../prisma/prisma.service';
import { isModuleKey, ModuleKey, PLATFORM_MODULES } from './modules';

@Injectable()
export class ModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async isEnabled(key: ModuleKey) {
    const row = await this.prisma.platformModule.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return row?.enabled ?? false;
  }

  /** Keys the web and the app show menus for. */
  async enabled() {
    const rows = await this.prisma.platformModule.findMany({
      where: { enabled: true },
      select: { key: true },
    });
    return rows.map((r) => r.key).filter(isModuleKey);
  }

  /** Back-office: every known module, switched off ones included. */
  async list() {
    const rows = await this.prisma.platformModule.findMany();
    return (Object.keys(PLATFORM_MODULES) as ModuleKey[]).map((key) => {
      const row = rows.find((r) => r.key === key);
      return {
        key,
        ...PLATFORM_MODULES[key],
        enabled: row?.enabled ?? false,
        updatedAt: row?.updatedAt ?? null,
      };
    });
  }

  set(actor: StaffActor, key: string, enabled: boolean) {
    if (!isModuleKey(key)) throw new NotFoundException('Module inconnu');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.platformModule.findUnique({
        where: { key },
        select: { key: true, enabled: true },
      });
      const after = await tx.platformModule.upsert({
        where: { key },
        create: { key, enabled },
        update: { enabled },
        select: { key: true, enabled: true },
      });
      await this.audit.record(tx, {
        actor,
        action: enabled ? 'module.enable' : 'module.disable',
        entity: 'PlatformModule',
        entityId: key,
        before: before ?? { key, enabled: false },
        after,
      });
      return after;
    });
  }
}
