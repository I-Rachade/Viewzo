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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import {
  ModuleEnabledGuard,
  RequiresModule,
} from '../modules/module-enabled.guard';
import { LeadStatusDto, ManualLeadDto } from './dto/lead.dto';
import { CreateLiveDto, InviteDto } from './dto/live.dto';
import { ProductDto, UpdateProductDto } from './dto/product.dto';
import { LiveOffersService } from './live-offers.service';
import { LiveRunnerService } from './live-runner.service';
import { LiveService } from './live.service';

type Req = { user: AuthUser };

// The seller's side of "Vente en live TikTok". Hidden (404) while the module
// is switched off in the back-office.
@Controller('me/live')
@UseGuards(JwtAuthGuard, ModuleEnabledGuard)
@RequiresModule('LIVE_SALES')
export class LiveController {
  constructor(
    private readonly lives: LiveService,
    private readonly offers: LiveOffersService,
    private readonly runner: LiveRunnerService,
  ) {}

  @Get('products')
  products(@Req() req: Req) {
    return this.lives.listProducts(req.user.userId);
  }

  @Post('products')
  addProduct(@Req() req: Req, @Body() dto: ProductDto) {
    return this.lives.createProduct(req.user.userId, dto);
  }

  @Patch('products/:id')
  updateProduct(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.lives.updateProduct(req.user.userId, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(204)
  deleteProduct(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.lives.deleteProduct(req.user.userId, id);
  }

  @Get('sales')
  list(@Req() req: Req) {
    return this.lives.listLives(req.user.userId);
  }

  @Post('sales')
  create(@Req() req: Req, @Body() dto: CreateLiveDto) {
    return this.offers.createOffer(req.user.userId, dto);
  }

  @Get('sales/:id')
  async get(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    const board = await this.lives.dashboard(req.user.userId, id);
    return {
      ...board,
      sessions: board.sessions.map((s) => ({
        ...s,
        running: this.runner.isRunning(s.id),
      })),
      ai: this.runner.usesAi,
    };
  }

  @Post('sales/:id/pay')
  @HttpCode(200)
  pay(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.pay(req.user.userId, id);
  }

  @Post('sales/:id/cancel')
  @HttpCode(200)
  cancel(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.cancelOwn(req.user.userId, id);
  }

  @Get('sales/:id/candidates')
  candidates(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.candidates(req.user.userId, id);
  }

  @Post('sales/:id/invite')
  invite(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteDto,
  ) {
    return this.offers.invite(req.user.userId, id, dto.creatorId);
  }

  // The advertiser's own live only; creators start theirs.
  @Post('sales/:id/start')
  @HttpCode(200)
  start(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.startSelf(req.user.userId, id);
  }

  @Post('sales/:id/stop')
  @HttpCode(200)
  stop(@Req() req: Req, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.stopSelf(req.user.userId, id);
  }

  @Post('sales/:id/leads')
  addLead(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualLeadDto,
  ) {
    return this.lives.addManualLead(req.user.userId, id, dto);
  }

  @Patch('sales/:id/leads/:leadId')
  setLead(
    @Req() req: Req,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: LeadStatusDto,
  ) {
    return this.lives.setLeadStatus(req.user.userId, id, leadId, dto.status);
  }
}
