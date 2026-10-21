import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import {
  ModuleEnabledGuard,
  RequiresModule,
} from '../modules/module-enabled.guard';
import { AcceptLiveDto, RespondInviteDto } from './dto/live.dto';
import { LiveOffersService } from './live-offers.service';

type Req = { user: AuthUser };

// The creator's side: offers to accept, invitations, and their own lives.
@Controller('me/live-tasks')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@RequiresModule('LIVE_SALES')
export class CreatorLiveController {
  constructor(private readonly offers: LiveOffersService) {}

  @Get()
  home(@Req() req: Req) {
    return this.offers.creatorHome(req.user.userId);
  }

  @Get('sessions/:id')
  board(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.creatorBoard(req.user.userId, id);
  }

  @Post('offers/:id/accept')
  @UseGuards(PhoneVerifiedGuard)
  accept(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptLiveDto,
  ) {
    return this.offers.accept(req.user.userId, id, dto.scheduledAt);
  }

  @Post('sessions/:id/respond')
  @HttpCode(200)
  @UseGuards(PhoneVerifiedGuard)
  respond(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInviteDto,
  ) {
    return this.offers.respond(
      req.user.userId,
      id,
      dto.accept,
      dto.scheduledAt,
    );
  }

  @Patch('sessions/:id')
  reschedule(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptLiveDto,
  ) {
    return this.offers.reschedule(req.user.userId, id, dto.scheduledAt);
  }

  @Post('sessions/:id/withdraw')
  @HttpCode(200)
  withdraw(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.withdraw(req.user.userId, id);
  }

  @Post('sessions/:id/start')
  @HttpCode(200)
  start(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.startAsCreator(req.user.userId, id);
  }

  @Post('sessions/:id/stop')
  @HttpCode(200)
  stop(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.stopAsCreator(req.user.userId, id);
  }
}
