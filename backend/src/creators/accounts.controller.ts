import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { AccountsService } from './accounts.service';
import { AddAccountDto } from './dto/add-account.dto';
import { SkillsDto } from './dto/skills.dto';
import { SkillsService } from './skills.service';

@Controller('me')
@UseGuards(JwtAuthGuard, PhoneVerifiedGuard)
export class CreatorController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly skills: SkillsService,
  ) {}

  @Get('accounts')
  list(@Req() req: { user: AuthUser }) {
    return this.accounts.list(req.user.userId);
  }

  @Post('accounts')
  add(@Req() req: { user: AuthUser }, @Body() dto: AddAccountDto) {
    return this.accounts.add(req.user.userId, dto);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  remove(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accounts.remove(req.user.userId, id);
  }

  @Post('accounts/:id/resubmit')
  @HttpCode(200)
  resubmit(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.accounts.resubmit(req.user.userId, id);
  }

  @Get('skills')
  getSkills(@Req() req: { user: AuthUser }) {
    return this.skills.get(req.user.userId);
  }

  @Put('skills')
  saveSkills(@Req() req: { user: AuthUser }, @Body() dto: SkillsDto) {
    return this.skills.save(req.user.userId, dto);
  }
}
