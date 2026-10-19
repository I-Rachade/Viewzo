import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { DepositDto } from './dto/deposit.dto';
import { FundCampaignDto } from './dto/fund-campaign.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { WalletService } from './wallet.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('me/wallet')
  summary(@Req() req: { user: AuthUser }) {
    return this.wallet.summary(req.user.userId);
  }

  @Get('me/wallet/transactions')
  transactions(@Req() req: { user: AuthUser }) {
    return this.wallet.transactions(req.user.userId);
  }

  @Post('me/wallet/deposits')
  deposit(@Req() req: { user: AuthUser }, @Body() dto: DepositDto) {
    return this.wallet.deposit(req.user.userId, dto);
  }

  @Get('me/wallet/withdrawals')
  withdrawals(@Req() req: { user: AuthUser }) {
    return this.wallet.withdrawals(req.user.userId);
  }

  @Post('me/wallet/withdrawals')
  withdraw(@Req() req: { user: AuthUser }, @Body() dto: WithdrawDto) {
    return this.wallet.requestWithdrawal(req.user.userId, dto);
  }

  @Post('campaigns/:id/pay')
  @HttpCode(200)
  pay(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FundCampaignDto,
  ) {
    return this.wallet.fundCampaign(req.user.userId, id, dto);
  }

  // Polled by the return page after the provider's checkout.
  @Get('payments/:reference')
  payment(
    @Req() req: { user: AuthUser },
    @Param('reference') reference: string,
  ) {
    return this.wallet.paymentStatus(req.user.userId, reference);
  }
}

// Provider notifications. Public: the status is always re-read from the
// provider's API, so a forged call changes nothing.
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly wallet: WalletService) {}

  @Post(':provider')
  @HttpCode(200)
  async notify(
    @Param('provider') provider: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    await this.wallet.handleWebhook(provider, body ?? {}, headers);
    return { received: true };
  }
}
