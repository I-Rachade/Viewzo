import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StaffRoles } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { AuditService } from './audit.service';

class AuditFiltersDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;
}

// The journal spans every country, so only super admins read it.
@Controller('staff/audit')
@UseGuards(JwtAuthGuard, StaffGuard)
@StaffRoles(StaffRole.SUPER_ADMIN)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() filters: AuditFiltersDto) {
    return this.audit.list(filters);
  }
}
