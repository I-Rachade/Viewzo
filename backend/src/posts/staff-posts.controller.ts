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
import { MODERATION, StaffRoles } from '../auth/staff';
import type { StaffRequest } from '../auth/staff';
import { StaffGuard } from '../auth/staff.guard';
import { PostFiltersDto } from './dto/post-filters.dto';
import { ReviewPostDto } from './dto/review-post.dto';
import { StaffPostsService } from './staff-posts.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, StaffGuard)
export class StaffPostsController {
  constructor(private readonly posts: StaffPostsService) {}

  @Get('posts')
  list(@Req() req: StaffRequest, @Query() filters: PostFiltersDto) {
    return this.posts.list(req.staff, filters);
  }

  @Get('posts/:id')
  dossier(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.dossier(req.staff, id);
  }

  @Post('posts/:id/review')
  @StaffRoles(...MODERATION)
  @HttpCode(200)
  review(
    @Req() req: StaffRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPostDto,
  ) {
    return this.posts.review(req.staff, id, dto);
  }

  @Get('creators/:id')
  creator(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.posts.creatorFile(req.staff, id);
  }
}
