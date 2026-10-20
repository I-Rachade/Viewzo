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
import { CampaignStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { CampaignsService } from './campaigns.service';
import { ReviewCampaignDto } from './dto/review-campaign.dto';

// Moderation: checks the brief and the provided assets before anything is posted.
@Controller('staff/campaigns')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  queue(
    @Req() req: StaffRequest,
    @Query('status', new ParseEnumPipe(CampaignStatus, { optional: true }))
    status?: CampaignStatus,
  ) {
    return this.campaigns.queue(req.staff, status);
  }

  @Post(':id/review')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewCampaignDto,
  ) {
    return this.campaigns.review(req.staff, id, dto);
  }
}
