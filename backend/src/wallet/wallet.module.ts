import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { CinetpayGateway } from './gateways/cinetpay.gateway';
import { FedapayGateway } from './gateways/fedapay.gateway';
import { FlutterwaveGateway } from './gateways/flutterwave.gateway';
import { LocalGateway } from './gateways/local.gateway';
import { PaymentRouter } from './payment-router';
import { StaffWalletController } from './staff-wallet.controller';
import {
  PaymentWebhooksController,
  WalletController,
} from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  controllers: [
    WalletController,
    PaymentWebhooksController,
    StaffWalletController,
  ],
  providers: [
    WalletService,
    PaymentRouter,
    LocalGateway,
    FedapayGateway,
    CinetpayGateway,
    FlutterwaveGateway,
    StaffGuard,
  ],
  exports: [WalletService],
})
export class WalletModule {}
