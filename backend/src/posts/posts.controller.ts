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
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { clientIp } from '../auth/client-ip';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PhoneVerifiedGuard } from '../auth/phone-verified.guard';
import type { AuthUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AddScreenshotDto } from './dto/add-screenshot.dto';
import { MAX_PROOF_BYTES, ProofStorage, UploadedImage } from './proof-storage';
import { ProofSource, ProofsService } from './proofs.service';
import { ReportService } from './report.service';

/** Where a proof came from: the app's device id and the caller's address. */
export function proofSource(req: Request): ProofSource {
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  return {
    deviceId: header('x-device-id')?.slice(0, 100),
    ip: clientIp(req),
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(
    private readonly proofs: ProofsService,
    private readonly report: ReportService,
  ) {}

  @Post('me/assignments/:id/proofs')
  @UseGuards(PhoneVerifiedGuard)
  @UseInterceptors(
    // Without a destination, multer keeps the file in memory.
    FileInterceptor('file', {
      limits: { fileSize: MAX_PROOF_BYTES, files: 1 },
    }),
  )
  async addScreenshot(
    @Req() req: Request & { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() dto: AddScreenshotDto,
  ) {
    await this.proofs.addScreenshot(
      req.user.userId,
      id,
      file,
      dto,
      proofSource(req),
    );
    return { ok: true };
  }

  @Get('me/results')
  @UseGuards(PhoneVerifiedGuard)
  results(@Req() req: { user: AuthUser }) {
    return this.proofs.results(req.user.userId);
  }

  @Get('me/campaigns/:id/report')
  campaignReport(
    @Req() req: { user: AuthUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.report.campaign(req.user.userId, id);
  }
}

// Screenshots, opened from signed links (no login header on <img> tags).
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ProofStorage,
  ) {}

  @Get('proofs/:id')
  @Header('Cache-Control', 'private, max-age=3600')
  @Header('X-Content-Type-Options', 'nosniff')
  async proof(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!this.storage.verify(id, exp, sig)) throw new UnauthorizedException();
    const proof = await this.prisma.postProof.findUnique({ where: { id } });
    if (!proof?.fileKey) throw new UnauthorizedException();
    res.setHeader('Content-Type', proof.mimeType ?? 'application/octet-stream');
    return new StreamableFile(await this.storage.read(proof.fileKey));
  }
}
