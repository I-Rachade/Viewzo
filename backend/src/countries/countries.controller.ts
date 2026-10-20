import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { CountriesService } from './countries.service';
import { AddCountryDto, SetCountryDto } from './dto/country.dto';

// Public: sign-up needs the list before anyone is logged in.
@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  enabled() {
    return this.countries.enabled();
  }
}

// Every team member reads the list; only super admins change it.
@Controller('staff/countries')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffCountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  list() {
    return this.countries.list();
  }

  @Post()
  @StaffRoles(StaffRole.SUPER_ADMIN)
  add(@Req() req: StaffRequest, @Body() dto: AddCountryDto) {
    return this.countries.add(req.staff, dto.code);
  }

  @Patch(':code')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  set(
    @Req() req: StaffRequest,
    @Param('code') code: string,
    @Body() dto: SetCountryDto,
  ) {
    return this.countries.set(req.staff, code, dto.enabled);
  }
}
