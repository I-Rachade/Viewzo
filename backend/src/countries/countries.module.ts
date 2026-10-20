import { Module } from '@nestjs/common';
import { StaffGuard } from '../auth/staff.guard';
import {
  CountriesController,
  StaffCountriesController,
} from './countries.controller';
import { CountriesService } from './countries.service';

@Module({
  controllers: [CountriesController, StaffCountriesController],
  providers: [CountriesService, StaffGuard],
})
export class CountriesModule {}
