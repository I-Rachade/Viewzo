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
import { StaffGuard } from '../auth/staff.guard';
import { PostFiltersDto } from './dto/post-filters.dto';
import { ReviewPostDto } from './dto/review-post.dto';
import { StaffPostsService } from './staff-posts.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffPostsController {
  constructor(private readonly posts: StaffPostsService) {}

  @Get('posts')
  list(@Query() filters: PostFiltersDto) {
    return this.posts.list(filters);
  }

  @Get('posts/:id')
  dossier(@Param('id', ParseUUIDPipe) id: string) {
    return this.posts.dossier(id);
  }

  @Post('posts/:id/review')
  @HttpCode(200)
  review(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPostDto,
  ) {
    return this.posts.review(req.user.userId, id, dto);
  }

  @Get('creators/:id')
  creator(@Param('id', ParseUUIDPipe) id: string) {
    return this.posts.creatorFile(id);
  }
}
