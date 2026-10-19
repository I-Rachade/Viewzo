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
import type { AuthUser } from '../auth/jwt.strategy';
import { StaffGuard } from '../auth/staff.guard';
import { RecordViewsDto } from './dto/record-views.dto';
import { ReviewWithdrawalDto } from './dto/review-withdrawal.dto';
import { WalletService } from './wallet.service';

// Finance: validates withdrawals one by one and records validated views.
@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('withdrawals')
  queue(
    @Query('status', new ParseEnumPipe(PaymentStatus, { optional: true }))
    status?: PaymentStatus,
  ) {
    return this.wallet.withdrawalQueue(status);
  }

  @Post('withdrawals/:id/review')
  @HttpCode(200)
  review(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWithdrawalDto,
  ) {
    return this.wallet.reviewWithdrawal(
      req.user.userId,
      id,
      dto.decision,
      dto.reason,
    );
  }

  @Post('payments/:id/refresh')
  @HttpCode(200)
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallet.refreshById(id);
  }

  @Post('assignments/:id/views')
  @HttpCode(200)
  recordViews(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordViewsDto,
  ) {
    return this.wallet.recordViews(id, dto.totalViews);
  }
}
