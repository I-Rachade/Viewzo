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
import { PaymentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FINANCE, MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { RecordViewsDto } from './dto/record-views.dto';
import {
  ResolvePayoutDto,
  ReviewWithdrawalDto,
} from './dto/review-withdrawal.dto';
import { WalletService } from './wallet.service';

// Finance validates withdrawals; moderation records validated views.
@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('withdrawals')
  @StaffRoles(...FINANCE)
  queue(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(PaymentStatus, { optional: true }))
    status?: PaymentStatus,
  ) {
    return this.wallet.withdrawalQueue(req.staff, status);
  }

  @Post('withdrawals/:id/review')
  @StaffRoles(...FINANCE)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWithdrawalDto,
  ) {
    return this.wallet.reviewWithdrawal(
      req.staff,
      id,
      dto.decision,
      dto.reason,
    );
  }

  @Post('withdrawals/:id/resolve')
  @StaffRoles(...FINANCE)
  @HttpCode(200)
  resolve(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolvePayoutDto,
  ) {
    return this.wallet.resolvePayout(req.staff, id, dto.outcome, dto.reason);
  }

  @Post('payments/:id/refresh')
  @StaffRoles(...FINANCE)
  @HttpCode(200)
  refresh(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.refreshById(req.staff, id);
  }

  @Post('assignments/:id/views')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  recordViews(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordViewsDto,
  ) {
    return this.wallet.recordViews(id, dto.totalViews, req.staff);
  }
}
