import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { CreatorController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { SkillsService } from './skills.service';
import { StaffAccountsController } from './staff-accounts.controller';

@Module({
  controllers: [CreatorController, StaffAccountsController],
  providers: [AccountsService, SkillsService, StaffGuard],
})
export class CreatorsModule {}
