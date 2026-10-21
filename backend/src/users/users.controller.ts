import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { ActivateProfileDto } from './dto/activate-profile.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@Req() req: { user: AuthUser }) {
    return this.users.toView(await this.users.getById(req.user.userId));
  }

  @Patch()
  async update(@Req() req: { user: AuthUser }, @Body() dto: UpdateMeDto) {
    return this.users.toView(
      await this.users.setFirstName(req.user.userId, dto.firstName),
    );
  }

  @Post('profiles')
  async activateProfile(
    @Req() req: { user: AuthUser },
    @Body() dto: ActivateProfileDto,
  ) {
    return this.users.toView(
      await this.users.activateProfile(req.user.userId, dto.type),
    );
  }
}
