import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { CreatorController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import {
  InstagramProfileChecker,
  PROFILE_CHECKERS,
  TelegramProfileChecker,
  YoutubeProfileChecker,
} from './profile-checks';
import { SkillsService } from './skills.service';
import { StaffAccountsController } from './staff-accounts.controller';

@Module({
  controllers: [CreatorController, StaffAccountsController],
  providers: [
    AccountsService,
    SkillsService,
    StaffGuard,
    YoutubeProfileChecker,
    TelegramProfileChecker,
    InstagramProfileChecker,
    {
      provide: PROFILE_CHECKERS,
      useFactory: (...checkers: unknown[]) => checkers,
      inject: [
        YoutubeProfileChecker,
        TelegramProfileChecker,
        InstagramProfileChecker,
      ],
    },
  ],
})
export class CreatorsModule {}
