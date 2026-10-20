import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { StaffCampaignsController } from './staff-campaigns.controller';
import { PostsModule } from '../posts/posts.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule, PostsModule],
  controllers: [CampaignsController, StaffCampaignsController],
  providers: [CampaignsService, StaffGuard],
})
export class CampaignsModule {}
