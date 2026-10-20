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
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { proofSource } from '../posts/posts.controller';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { QuoteDto } from './dto/quote.dto';
import { SubmitPostDto } from './dto/submit-post.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  // Live platform picker: what is greyed out and why, minimum budget, views.
  @Get('campaigns/quote')
  quote(@Query() query: QuoteDto) {
    return this.campaigns.quote(
      query.package,
      query.budget,
      query.platforms ?? [],
    );
  }

  @Post('campaigns')
  create(@Req() req: { user: AuthUser }, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(req.user.userId, dto);
  }

  @Get('me/campaigns')
  listOwn(@Req() req: { user: AuthUser }) {
    return this.campaigns.listOwn(req.user.userId);
  }

  @Get('me/campaigns/:id')
  getOwn(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.getOwn(req.user.userId, id);
  }

  @Get('me/tasks')
  availableTasks(@Req() req: { user: AuthUser }) {
    return this.campaigns.availableTasks(req.user.userId);
  }

  @Post('tasks/:id/accept')
  @UseGuards(PhoneVerifiedGuard)
  accept(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaigns.accept(req.user.userId, id);
  }

  @Get('me/assignments')
  @UseGuards(PhoneVerifiedGuard)
  myAssignments(@Req() req: { user: AuthUser }) {
    return this.campaigns.myAssignments(req.user.userId);
  }

  @Post('me/assignments/:id/submit')
  @UseGuards(PhoneVerifiedGuard)
  @HttpCode(200)
  submit(
    @Req() req: Request & { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitPostDto,
  ) {
    return this.campaigns.submit(
      req.user.userId,
      id,
      dto.postUrl,
      proofSource(req),
    );
  }
}
