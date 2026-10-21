import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LivePayoutStatus, LiveSaleStatus, StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import {
  ModuleEnabledGuard,
  RequiresModule,
} from '../modules/module-enabled.guard';
import { StaffCancelLiveDto } from './dto/lead.dto';
import {
  LiveRateDto,
  PayoutDecisionDto,
  ReviewLiveDto,
} from './dto/staff-live.dto';
import { LiveOffersService } from './live-offers.service';
import { LiveService } from './live.service';

// Back-office: every team member sees the offers of their countries;
// moderation reviews them, checks unusual audiences and stops an offer.
// Super admins set the prices per country.
@Controller('staff/live')
@UseGuards(JwtAuthGuard, StaffGuard, ModuleEnabledGuard)
@RequiresModule('LIVE_SALES')
export class StaffLiveController {
  constructor(
    private readonly lives: LiveService,
    private readonly offers: LiveOffersService,
  ) {}

  @Get('sales')
  list(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(LiveSaleStatus, { optional: true }))
    status?: LiveSaleStatus,
  ) {
    return this.lives.staffList(req.staff, status);
  }

  @Post('sales/:id/review')
  @HttpCode(200)
  @StaffRoles(...MODERATION)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewLiveDto,
  ) {
    return this.offers.review(req.staff, id, dto);
  }

  @Post('sales/:id/cancel')
  @HttpCode(200)
  @StaffRoles(...MODERATION)
  cancel(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffCancelLiveDto,
  ) {
    return this.offers.staffCancel(req.staff, id, dto.reason);
  }

  @Get('sessions')
  sessions(
    @Req() req: StaffRequest,
    @Query('payout', new ParseEnumPipe(LivePayoutStatus, { optional: true }))
    payout?: LivePayoutStatus,
  ) {
    return this.offers.staffSessions(req.staff, payout);
  }

  @Post('sessions/:id/payout')
  @HttpCode(200)
  @StaffRoles(...MODERATION)
  payout(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayoutDecisionDto,
  ) {
    return this.offers.decidePayout(req.staff, id, dto);
  }

  @Get('rates')
  rates() {
    return this.offers.listRates();
  }

  @Put('rates/:country')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  setRate(
    @Req() req: StaffRequest,
    @Param('country') country: string,
    @Body() dto: LiveRateDto,
  ) {
    if (!/^[A-Za-z]{2}$/.test(country)) {
      throw new BadRequestException('Code pays invalide');
    }
    return this.offers.setRate(req.staff, country, dto);
  }
}
