import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { LiveRunnerService } from './live-runner.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { StaffLiveController } from './staff-live.controller';

// "Vente en live TikTok", ported from TackTack. Switched on in the back-office.
@Module({
  controllers: [LiveController, StaffLiveController],
  providers: [LiveService, LiveRunnerService, StaffGuard],
})
export class LiveModule {}
