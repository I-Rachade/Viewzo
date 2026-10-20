import { Global, Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import {
  CountriesController,
  StaffCountriesController,
} from './countries.controller';
import { CountriesService } from './countries.service';

// Global: sign-up, campaigns, skills and the team check countries against it.
@Global()
@Module({
  controllers: [CountriesController, StaffCountriesController],
  providers: [CountriesService, StaffGuard],
  exports: [CountriesService],
})
export class CountriesModule {}
