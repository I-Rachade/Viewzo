import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { CampaignFilesService } from './campaign-files.service';
import type { UploadedFileData } from './campaign-files.service';
import { UploadCampaignFileDto } from './dto/upload-campaign-file.dto';
import { MAX_UPLOAD_BYTES } from './file-types';

@Controller()
export class CampaignFilesController {
  constructor(private readonly files: CampaignFilesService) {}

  @Post('me/campaign-files')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  upload(
    @Req() req: { user: AuthUser },
    @UploadedFile() file: UploadedFileData | undefined,
    @Body() dto: UploadCampaignFileDto,
  ) {
    return this.files.upload(req.user.userId, file, dto.purpose);
  }

  // Opened from signed links (no login header on <img> or <video> tags).
  @Get('files/campaign/:id')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  async open(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, body } = await this.files.open(id, exp, sig);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return new StreamableFile(body);
  }
}
