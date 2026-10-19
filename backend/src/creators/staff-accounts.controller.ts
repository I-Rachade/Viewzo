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
import type { AuthUser } from '../auth/jwt.strategy';
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
    @Query('status', new ParseEnumPipe(AccountStatus, { optional: true }))
    status?: AccountStatus,
  ) {
    return this.accounts.queue(status);
  }

  @Get('by-code/:code')
  byCode(@Param('code') code: string) {
    return this.accounts.findByCode(code);
  }

  @Post(':id/review')
  @HttpCode(200)
  review(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAccountDto,
  ) {
    return this.accounts.review(req.user.userId, id, dto);
  }
}
