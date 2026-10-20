import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { AddMemberDto, MemberRightsDto } from './dto/add-member.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('overview')
  overview(@Req() req: StaffRequest) {
    return this.staff.overview(req.staff);
  }

  @Get('assignments')
  @StaffRoles(...MODERATION)
  assignments(@Req() req: StaffRequest) {
    return this.staff.assignments(req.staff);
  }

  // Only super admins see and change who is on the team.
  @Get('members')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  members() {
    return this.staff.members();
  }

  @Post('members')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  addMember(@Req() req: StaffRequest, @Body() dto: AddMemberDto) {
    return this.staff.addMember(req.staff, dto.phone, dto);
  }

  @Patch('members/:id')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  updateMember(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberRightsDto,
  ) {
    return this.staff.updateMember(req.staff, id, dto);
  }

  @Delete('members/:id')
  @StaffRoles(StaffRole.SUPER_ADMIN)
  @HttpCode(204)
  removeMember(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staff.removeMember(req.staff, id);
  }
}
