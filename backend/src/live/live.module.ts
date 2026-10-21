import { Module } from '@nestjs/common';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import { StaffGuard } from '../auth/staff.guard';
import { WalletModule } from '../wallet/wallet.module';
import { CreatorLiveController } from './creator-live.controller';
import { LiveOffersService } from './live-offers.service';
import { LiveRunnerService } from './live-runner.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { StaffLiveController } from './staff-live.controller';

// "Vente en live TikTok", ported from TackTack. Switched on in the back-office.
@Module({
  imports: [WalletModule],
  controllers: [LiveController, CreatorLiveController, StaffLiveController],
  providers: [
    LiveService,
    LiveRunnerService,
    LiveOffersService,
    StaffGuard,
    PhoneVerifiedGuard,
  ],
})
export class LiveModule {}
