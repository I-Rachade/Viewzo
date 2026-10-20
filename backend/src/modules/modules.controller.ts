import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { SetModuleDto } from './dto/module.dto';
import { ModulesService } from './modules.service';

// Public: the web and the app hide the menus of switched-off modules.
@Controller('modules')
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  enabled() {
    return this.modules.enabled();
  }
}

// Every team member reads the list; only super admins switch modules.
@Controller('staff/modules')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffModulesController {
  constructor(private readonly modules: ModulesService) {}

  @Get()
  list() {
    return this.modules.list();
  }

  @Patch(':key')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  set(
    @Req() req: StaffRequest,
    @Param('key') key: string,
    @Body() dto: SetModuleDto,
  ) {
    return this.modules.set(req.staff, key, dto.enabled);
  }
}
