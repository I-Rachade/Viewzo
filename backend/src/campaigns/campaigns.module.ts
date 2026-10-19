import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { StaffCampaignsController } from './staff-campaigns.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [CampaignsController, StaffCampaignsController],
  providers: [CampaignsService, StaffGuard],
})
export class CampaignsModule {}
