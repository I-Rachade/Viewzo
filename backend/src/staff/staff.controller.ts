import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { StaffGuard } from '../auth/staff.guard';
import { AddMemberDto } from './dto/add-member.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('overview')
  overview() {
    return this.staff.overview();
  }

  @Get('assignments')
  assignments() {
    return this.staff.assignments();
  }

  @Get('members')
  members() {
    return this.staff.members();
  }

  @Post('members')
  addMember(@Body() dto: AddMemberDto) {
    return this.staff.addMember(dto.phone);
  }

  @Delete('members/:id')
  @HttpCode(204)
  removeMember(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staff.removeMember(req.user.userId, id);
  }
}
