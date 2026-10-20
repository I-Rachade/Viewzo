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
import { AccountStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { AccountsService } from './accounts.service';
import { ReviewAccountDto } from './dto/review-account.dto';

// Back-office endpoints for the verification team.
@Controller('staff/accounts')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffAccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  queue(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(AccountStatus, { optional: true }))
    status?: AccountStatus,
    @Query('auto') auto?: string,
  ) {
    return this.accounts.queue(req.staff, status, auto === '1');
  }

  @Get('by-code/:code')
  byCode(@Req() req: StaffRequest, @Param('code') code: string) {
    return this.accounts.findByCode(req.staff, code);
  }

  @Post(':id/review')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAccountDto,
  ) {
    return this.accounts.review(req.staff, id, dto);
  }
}
