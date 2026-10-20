import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LiveSaleStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import {
  ModuleEnabledGuard,
  RequiresModule,
} from '../modules/module-enabled.guard';
import { StaffCancelLiveDto } from './dto/lead.dto';
import { LiveRunnerService } from './live-runner.service';
import { LiveService } from './live.service';

// Back-office: every team member sees the lives of their countries;
// moderation stops one.
@Controller('staff/live')
@UseGuards(JwtAuthGuard, StaffGuard, ModuleEnabledGuard)
@RequiresModule('LIVE_SALES')
export class StaffLiveController {
  constructor(
    private readonly lives: LiveService,
    private readonly runner: LiveRunnerService,
  ) {}

  @Get('sales')
  list(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(LiveSaleStatus, { optional: true }))
    status?: LiveSaleStatus,
  ) {
    return this.lives.staffList(req.staff, status);
  }

  @Post('sales/:id/cancel')
  @HttpCode(200)
  @StaffRoles(...MODERATION)
  async cancel(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffCancelLiveDto,
  ) {
    const live = await this.lives.staffCancel(req.staff, id, dto.reason);
    await this.runner.detach(id);
    return live;
  }
}
