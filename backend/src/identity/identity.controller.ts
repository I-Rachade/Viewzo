import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IdentityCheckStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { ReviewIdentityDto } from './dto/review-identity.dto';
import { IdentityService } from './identity.service';

// Identity verification that opens level 2 (all tasks, withdrawals).
@Controller('me/identity')
@UseGuards(JwtAuthGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  status(@Req() req: { user: AuthUser }) {
    return this.identity.status(req.user.userId);
  }

  @Post('start')
  @UseGuards(PhoneVerifiedGuard)
  @HttpCode(200)
  start(@Req() req: { user: AuthUser }) {
    return this.identity.start(req.user.userId);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: { user: AuthUser }) {
    return this.identity.refresh(req.user.userId);
  }
}

// Provider notifications. Public: the decision is always re-read from the
// provider's API, so a forged call changes nothing.
@Controller('identity/webhooks')
export class IdentityWebhooksController {
  constructor(private readonly identity: IdentityService) {}

  @Post('didit')
  @HttpCode(200)
  async didit(@Body() body: { session_id?: unknown }) {
    const id =
      typeof body?.session_id === 'string' ? body.session_id : undefined;
    await this.identity.onWebhook(id);
    return { received: true };
  }
}

@Controller('staff/identity')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffIdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get()
  queue(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(IdentityCheckStatus, { optional: true }))
    status?: IdentityCheckStatus,
  ) {
    return this.identity.queue(req.staff, status);
  }

  @Post(':id/review')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewIdentityDto,
  ) {
    return this.identity.review(req.staff, id, dto.decision, dto.reason);
  }
}
