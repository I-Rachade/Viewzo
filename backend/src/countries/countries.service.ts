import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isSupportedCountry } from 'libphonenumber-js';
import { AuditService } from '../audit/audit.service';
import type { StaffActor } from '../auth/staff';
import { PrismaService } from '../prisma/prisma.service';

const ROW_SELECT = { code: true, enabled: true } as const;

const upper = (code: string) => code.toUpperCase();

// The countries Viewzo works in, managed by super admins.
@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Throws unless every code is enabled. Accounts already in a country that
   * gets switched off keep working; only new sign-ups and new choices stop.
   */
  async assertAllowed(
    codes: string | string[],
    message = 'Viewzo n’est pas encore ouvert dans ce pays',
  ) {
    const wanted = [
      ...new Set((Array.isArray(codes) ? codes : [codes]).map(upper)),
    ];
    if (!wanted.length) return;
    const open = await this.prisma.allowedCountry.findMany({
      where: { code: { in: wanted }, enabled: true },
      select: { code: true },
    });
    const closed = wanted.filter((c) => !open.some((o) => o.code === c));
    if (closed.length) {
      throw new BadRequestException({
        code: 'COUNTRY_NOT_ALLOWED',
        message: `${message} : ${closed.join(', ')}`,
        countries: closed,
      });
    }
  }

  /** Codes offered by the country pickers. */
  async enabled() {
    const rows = await this.prisma.allowedCountry.findMany({
      where: { enabled: true },
      select: { code: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.code);
  }

  /** Back-office: every country, switched off ones included. */
  list() {
    return this.prisma.allowedCountry.findMany({
      select: ROW_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adds a country, or switches a switched-off one back on. */
  add(actor: StaffActor, raw: string) {
    const code = raw.toUpperCase();
    if (!isSupportedCountry(code)) {
      throw new BadRequestException('Code pays inconnu');
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.allowedCountry.findUnique({
        where: { code },
        select: ROW_SELECT,
      });
      const after = await tx.allowedCountry.upsert({
        where: { code },
        create: { code },
        update: { enabled: true },
        select: ROW_SELECT,
      });
      await this.audit.record(tx, {
        actor,
        action: 'country.add',
        entity: 'AllowedCountry',
        entityId: code,
        before,
        after,
      });
      return after;
    });
  }

  set(actor: StaffActor, raw: string, enabled: boolean) {
    const code = raw.toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.allowedCountry.findUnique({
        where: { code },
        select: ROW_SELECT,
      });
      if (!before) throw new NotFoundException('Pays introuvable');
      const after = await tx.allowedCountry.update({
        where: { code },
        data: { enabled },
        select: ROW_SELECT,
      });
      await this.audit.record(tx, {
        actor,
        action: enabled ? 'country.enable' : 'country.disable',
        entity: 'AllowedCountry',
        entityId: code,
        before,
        after,
      });
      return after;
    });
  }
}
