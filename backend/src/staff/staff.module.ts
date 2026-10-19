import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  controllers: [StaffController],
  providers: [StaffService, StaffGuard],
})
export class StaffModule {}
