import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, IsOptional, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { NotificationsService } from './notifications.service';

export class MarkReadDto {
  // Empty or absent: everything is marked read.
  @IsOptional()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids?: string[];
}

@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: { user: AuthUser }) {
    return this.notifications.list(req.user.userId);
  }

  @Get('unread')
  async unread(@Req() req: { user: AuthUser }) {
    return { unread: await this.notifications.unreadCount(req.user.userId) };
  }

  @Post('read')
  @HttpCode(200)
  read(@Req() req: { user: AuthUser }, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(req.user.userId, dto.ids);
  }
}
