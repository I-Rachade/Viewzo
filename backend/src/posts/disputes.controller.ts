import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { DisputesService } from './disputes.service';
import {
  DecideDisputeDto,
  DisputeFiltersDto,
  OpenDisputeDto,
} from './dto/dispute.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  // The post's creator or the campaign's advertiser.
  @Post('me/posts/:id/disputes')
  open(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.disputes.open(req.user.userId, id, dto.reason);
  }
}

@Controller('staff/disputes')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Req() req: StaffRequest, @Query() filters: DisputeFiltersDto) {
    return this.disputes.list(req.staff, filters.status);
  }

  @Post(':id/decide')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  decide(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDisputeDto,
  ) {
    return this.disputes.decide(req.staff, id, dto);
  }
}
